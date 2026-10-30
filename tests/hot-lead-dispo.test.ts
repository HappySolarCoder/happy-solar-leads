import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  handleFieldDispo,
  type DispoCollection,
  type DispoDb,
  type DispoQuery,
  type DispoSnap,
  type DispoTransaction,
  type FieldDispoDeps,
} from '../app/utils/server/fieldDispo';
import { HOT_LEAD_DISPOSITION_READ_LIMIT, hotStatusAfterKnock } from '../app/utils/server/hotLeadStatus';

const NOW = Date.parse('2026-10-25T16:31:04.120Z');
const ACTION = '2026-10-25T16:31:04.120Z';
const LATER = new Date(NOW + 5 * 60 * 1000).toISOString();
const SERVER_TS = { marker: 'server-timestamp' };
const DELETED = { marker: 'delete' };

class Stamp {
  constructor(readonly ms: number) {}
  toMillis() { return this.ms; }
  static fromMillis(ms: number) { return new Stamp(ms); }
}

class Mem implements DispoDb {
  docs = new Map<string, Record<string, unknown>>();
  ops: string[] = [];
  caps: number[] = [];
  patches: Array<{ path: string; patch: Record<string, unknown> }> = [];

  put(path: string, data: Record<string, unknown>) {
    this.docs.set(path, { ...data });
  }

  collection(name: string): DispoCollection {
    this.ops.push(name);
    const query = (limitCount: number | null): DispoQuery => ({
      kind: 'query',
      collectionName: name,
      filters: [],
      limitCount,
      limit: (n: number) => query(n),
    });
    return {
      name,
      doc: (id: string) => ({
        id,
        path: `${name}/${id}`,
        get: async () => this.snap(`${name}/${id}`),
      }),
      where: (field: string, op: string, value: string) => ({
        kind: 'query' as const,
        collectionName: name,
        filters: [{ field, op, value }],
        limitCount: null,
        limit(n: number) {
          return { kind: 'query' as const, collectionName: name, filters: [{ field, op, value }], limitCount: n, limit: () => this };
        },
      }),
      cappedGet: (n: number) => {
        this.caps.push(n);
        return query(n);
      },
    };
  }

  async runTransaction<T>(fn: (tx: DispoTransaction) => Promise<T>): Promise<T> {
    const queued: Array<() => void> = [];
    const tx: DispoTransaction = {
      get: async (ref) => this.snap(ref.path),
      getQuery: async (query) => {
        const prefix = `${query.collectionName}/`;
        let rows = [...this.docs.entries()].filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'));
        for (const filter of query.filters) {
          rows = rows.filter(([, data]) => data[filter.field] === filter.value);
        }
        if (query.limitCount != null) rows = rows.slice(0, query.limitCount);
        return {
          docs: rows.map(([path, data]) => ({ exists: true, id: path.slice(prefix.length), data: () => data })),
        };
      },
      update: (ref, patch) => {
        this.patches.push({ path: ref.path, patch });
        queued.push(() => {
          const current = this.docs.get(ref.path);
          if (!current) throw new Error(`missing ${ref.path}`);
          for (const [key, value] of Object.entries(patch)) {
            if (value && typeof value === 'object' && (value as { marker?: string }).marker === 'delete') delete current[key];
            else current[key] = value;
          }
        });
      },
      create: (ref, data) => {
        queued.push(() => this.docs.set(ref.path, { ...data }));
      },
    };
    const result = await fn(tx);
    for (const job of queued) job();
    return result;
  }

  private snap(path: string): DispoSnap {
    const data = this.docs.get(path);
    const id = path.slice(path.indexOf('/') + 1);
    if (!data) return { exists: false, id, data: () => undefined };
    return { exists: true, id, data: () => data };
  }
}

function approved(role: string, extra: Record<string, unknown> = {}) {
  return {
    role,
    isActive: true,
    approved: true,
    approvalStatus: 'approved',
    status: 'active',
    email: 'rep@company.com',
    name: 'Jane Rep',
    ...extra,
  };
}

function harness(options: {
  role?: string;
  uid?: string;
  user?: Record<string, unknown>;
  lead?: Record<string, unknown> | null;
  leadId?: string;
  dispositions?: Array<{ id: string; name: string }>;
} = {}) {
  const db = new Mem();
  const uid = options.uid ?? 'uid-closer';
  const role = options.role ?? 'closer';
  db.put(`users/${uid}`, options.user ?? approved(role));
  const leadId = options.leadId ?? 'ghl_opp1';
  if (options.lead !== null) {
    db.put(`hotLeads/${leadId}`, options.lead ?? {
      lat: 43.1,
      lng: -77.6,
      address: '10 Main Street',
      contacts: [{ name: 'Test Person', phone: '5550101', email: 'test.person@example.com' }],
      ghl: { opportunityId: 'opp1', stage: 'New' },
      geo: { source: 'census' },
      import: { batchId: 'b', rowHash: 'h' },
      homeownerId: 'home-1',
      linkedLeadId: 'lead-1',
      hotStatus: 'active',
      doNotCall: true,
    });
  }
  for (const item of options.dispositions ?? [{ id: 'not-home', name: 'Not Home' }]) {
    db.put(`dispositions/${item.id}`, { name: item.name });
  }
  const deps: FieldDispoDeps = {
    verifyIdToken: async () => ({ uid, email: 'rep@company.com' }),
    getUser: async (id) => {
      const snap = await db.collection('users').doc(id).get();
      return { exists: snap.exists, data: snap.data() };
    },
    db,
    now: () => NOW,
    rateLimitStore: new Map(),
    Timestamp: Stamp,
    serverTimestamp: () => SERVER_TS,
    deleteField: () => DELETED,
  };
  return {
    db,
    uid,
    run(body: Record<string, unknown>) {
      return handleFieldDispo({ authorization: 'Bearer good-token', body, deps });
    },
  };
}

function knock(overrides: Record<string, unknown> = {}) {
  return {
    draftId: 'draft-1',
    leadId: 'ghl_opp1',
    kind: 'knock',
    actionAt: ACTION,
    status: 'not-home',
    disposition: 'Not Home',
    userName: 'Jane Rep',
    collection: 'hotLeads',
    gps: { lat: 43.1, lng: -77.6, accuracyM: 8, capturedAt: ACTION },
    ...overrides,
  };
}

describe('hot lead dispo', () => {
  it('decides converted from the dispositions collection, not a hardcoded id', () => {
    const source = readFileSync(new URL('../app/utils/server/hotLeadStatus.ts', import.meta.url), 'utf8');
    const dispo = readFileSync(new URL('../app/utils/server/fieldDispo.ts', import.meta.url), 'utf8');
    assert.equal(source.includes("'appointment'"), false);
    assert.equal(source.includes("'sale'"), false);
    assert.equal(source.includes("'sold'"), false);
    assert.equal(source.includes('appointmentOutcome'), false);
    assert.match(source, /collectHistoricalStatusIds/);
    assert.match(source, /isAppointmentSetOrSoldLead/);
    assert.equal(dispo.includes('appointmentOutcome'), false);
    assert.equal(hotStatusAfterKnock({ status: 'appt-set', disposition: 'Appointment Set' }, []), 'converted');
    assert.equal(hotStatusAfterKnock({ status: 'field-42', disposition: 'Appointment Set' }, []), 'worked');
    assert.equal(hotStatusAfterKnock(
      { status: 'field-42', disposition: 'Appointment Set' },
      [{ id: 'field-42', name: 'Appointment Set' }],
    ), 'converted');
    assert.equal(hotStatusAfterKnock({ status: 'sold', disposition: 'Sold' }, []), 'converted');
    assert.equal(hotStatusAfterKnock(
      { status: 'not-home', disposition: 'Not Home' },
      [{ id: 'appt-set', name: 'Appointment Set' }],
    ), 'worked');
  });

  it('lets a closer dispo an unclaimed or someone else\'s hot lead and refuses a setter', async () => {
    const open = harness();
    const applied = await open.run(knock());
    assert.equal(applied.status, 200, JSON.stringify(applied.body));
    assert.equal(applied.body.result, 'applied');
    assert.equal(applied.body.duplicate, false);
    const doc = open.db.docs.get('hotLeads/ghl_opp1') ?? {};
    assert.equal(doc.status, 'not-home');
    assert.equal(doc.hotStatus, 'worked');
    assert.equal(doc.dispositionedBy, 'uid-closer');
    assert.equal((doc.dispositionedAt as Stamp).toMillis(), NOW);
    assert.equal(doc.updatedAt, SERVER_TS);
    assert.deepEqual(doc.ghl, { opportunityId: 'opp1', stage: 'New' });
    assert.equal((doc.contacts as Array<{ phone?: string }>)[0].phone, '5550101');
    assert.equal(doc.homeownerId, 'home-1');
    assert.equal(doc.linkedLeadId, 'lead-1');
    assert.equal(doc.doNotCall, true);
    assert.equal(doc.lat, 43.1);
    assert.deepEqual(doc.geo, { source: 'census' });
    assert.equal(open.db.ops.includes('territories'), false);
    assert.equal(open.db.ops.includes('leads'), false);
    assert.equal(open.db.ops.includes('homeowners'), false);
    assert.deepEqual(open.db.caps, [HOT_LEAD_DISPOSITION_READ_LIMIT]);
    const patchKeys = Object.keys(open.db.patches[0].patch);
    for (const key of ['ghl', 'contacts', 'lat', 'lng', 'geo', 'import', 'homeownerId', 'linkedLeadId', 'notes', 'doNotCall']) {
      assert.equal(patchKeys.includes(key), false, key);
    }
    const receipt = open.db.docs.get('fieldDispoReceipts/uid-closer_draft-1');
    assert.equal(receipt?.collection, 'hotLeads');

    const claimed = harness({ lead: { lat: 43.1, lng: -77.6, claimedBy: 'other-rep', hotStatus: 'active' } });
    const byCloser = await claimed.run(knock({ draftId: 'draft-claimed' }));
    assert.equal(byCloser.status, 200, JSON.stringify(byCloser.body));
    assert.equal(claimed.db.ops.includes('territories'), false);

    const manager = harness({
      role: 'manager',
      uid: 'uid-manager',
      lead: { lat: 43.1, lng: -77.6, claimedBy: 'other-rep', hotStatus: 'active' },
    });
    const byManager = await manager.run(knock({ draftId: 'draft-mgr' }));
    assert.equal(byManager.status, 200, JSON.stringify(byManager.body));

    const setter = harness({ role: 'setter', uid: 'uid-setter' });
    const denied = await setter.run(knock());
    assert.equal(denied.status, 403);
    assert.equal(denied.body.reasonCode, 'permission_denied');
    assert.equal(setter.db.ops.includes('hotLeads'), false);
    assert.equal(setter.db.patches.length, 0);
  });

  it('replays a receipt and rejects a different collection', async () => {
    const test = harness();
    const first = await test.run(knock());
    assert.equal(first.status, 200);
    const updates = test.db.patches.length;
    const second = await test.run(knock({ status: 'interested', disposition: 'Interested' }));
    assert.equal(second.status, 200);
    assert.equal(second.body.duplicate, true);
    assert.equal(second.body.result, 'applied');
    assert.equal(test.db.patches.length, updates);

    const mismatch = await test.run(knock({ collection: 'leads', leadId: 'ghl_opp1' }));
    assert.equal(mismatch.status, 409, JSON.stringify(mismatch.body));
    assert.equal(mismatch.body.field, 'collection');
    assert.equal(test.db.docs.get('hotLeads/ghl_opp1')?.status, 'not-home');

    const unknown = harness();
    const bad = await unknown.run(knock({ collection: 'pins' }));
    assert.equal(bad.status, 400);
    assert.equal(bad.body.field, 'collection');
    assert.equal(unknown.db.patches.length, 0);

    const leads = harness({ lead: null });
    leads.db.put('leads/lead-1', { lat: 43.1, lng: -77.6, claimedBy: 'uid-closer' });
    const ordinary = await leads.run({ ...knock({ collection: 'leads', leadId: 'lead-1', draftId: 'draft-lead' }), collection: 'leads' });
    assert.equal(ordinary.status, 200, JSON.stringify(ordinary.body));
    assert.equal(leads.db.docs.get('fieldDispoReceipts/uid-closer_draft-lead')?.collection, 'leads');
    assert.equal(leads.db.caps.length, 0);
    assert.equal(leads.db.ops.includes('hotLeads'), false);
  });

  it('merges notes with the same 409 shape and still flags a far GPS', async () => {
    const notes = harness({ lead: {
      lat: 43.1,
      lng: -77.6,
      notes: 'server copy',
      ghl: { stage: 'New' },
      contacts: [{ phone: '5550101' }],
      hotStatus: 'active',
    } });
    const conflict = await notes.run({
      draftId: 'draft-notes',
      leadId: 'ghl_opp1',
      kind: 'notes',
      actionAt: ACTION,
      collection: 'hotLeads',
      notes: 'new note',
      baseNotes: 'stale',
    });
    assert.equal(conflict.status, 409);
    assert.equal(conflict.body.reasonCode, 'notes_conflict');
    assert.equal(conflict.body.currentNotes, 'server copy');
    assert.deepEqual(conflict.body.serverUpdatedFields, ['notes']);
    assert.equal(notes.db.patches.length, 0);

    const saved = await notes.run({
      draftId: 'draft-notes-2',
      leadId: 'ghl_opp1',
      kind: 'notes',
      actionAt: ACTION,
      collection: 'hotLeads',
      notes: 'new note',
      baseNotes: 'server copy',
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal(notes.db.docs.get('hotLeads/ghl_opp1')?.notes, 'new note');
    assert.equal(notes.db.docs.get('hotLeads/ghl_opp1')?.hotStatus, 'active');
    assert.deepEqual(notes.db.docs.get('hotLeads/ghl_opp1')?.ghl, { stage: 'New' });

    const mismatch = await notes.run({
      draftId: 'draft-clear',
      leadId: 'ghl_opp1',
      kind: 'notes',
      actionAt: ACTION,
      collection: 'hotLeads',
      notes: 'keep',
      clearNotes: true,
      baseNotes: 'new note',
    });
    assert.equal(mismatch.status, 400);
    assert.equal(mismatch.body.reasonCode, 'notes_clear_mismatch');

    const far = harness({
      dispositions: [{ id: 'field-42', name: 'Appointment Set' }],
      lead: {
        lat: 43.1,
        lng: -77.6,
        hotStatus: 'converted',
        appointmentOutcome: 'sold',
        ghl: { opportunityId: 'opp1' },
        contacts: [{ name: 'Test Person' }],
        notes: 'keep me',
      },
    });
    const flagged = await far.run(knock({
      draftId: 'draft-far',
      gps: { lat: 43.102, lng: -77.6, accuracyM: 5, capturedAt: ACTION },
    }));
    assert.equal(flagged.status, 200, JSON.stringify(flagged.body));
    assert.equal(flagged.body.result, 'applied');
    const gps = flagged.body.gps as { gpsVerified: boolean; gpsUnverifiedReason: string };
    assert.equal(gps.gpsVerified, false);
    assert.equal(gps.gpsUnverifiedReason, 'too_far');
    const flaggedDoc = far.db.docs.get('hotLeads/ghl_opp1') ?? {};
    assert.equal(flaggedDoc.gpsVerified, false);
    assert.equal(flaggedDoc.hotStatus, 'worked');
    assert.equal(flaggedDoc.appointmentOutcome, 'sold');
    assert.equal(flaggedDoc.notes, 'keep me');

    const custom = await far.run(knock({
      draftId: 'draft-appt',
      actionAt: LATER,
      status: 'field-42',
      disposition: 'Appointment Set',
      gps: { lat: 43.1, lng: -77.6, accuracyM: 5, capturedAt: LATER },
    }));
    assert.equal(custom.status, 200, JSON.stringify(custom.body));
    assert.equal(far.db.docs.get('hotLeads/ghl_opp1')?.hotStatus, 'converted');
    assert.equal(far.db.docs.get('hotLeads/ghl_opp1')?.status, 'field-42');

    const legacy = harness({
      dispositions: [{ id: 'not-home', name: 'Not Home' }],
      lead: { lat: 43.1, lng: -77.6, hotStatus: 'active', ghl: { opportunityId: 'opp1' } },
    });
    const sold = await legacy.run(knock({ draftId: 'draft-sold', status: 'sold', disposition: 'Sold' }));
    assert.equal(sold.status, 200, JSON.stringify(sold.body));
    assert.equal(legacy.db.docs.get('hotLeads/ghl_opp1')?.hotStatus, 'converted');

    const away = await legacy.run(knock({
      draftId: 'draft-away',
      actionAt: LATER,
      status: 'not-home',
      disposition: 'Not Home',
    }));
    assert.equal(away.status, 200, JSON.stringify(away.body));
    assert.equal(legacy.db.docs.get('hotLeads/ghl_opp1')?.hotStatus, 'worked');
    assert.equal(legacy.db.docs.get('hotLeads/ghl_opp1')?.status, 'not-home');
  });

  it('hides a testData hot lead from a real account', async () => {
    const test = harness({ lead: { lat: 43.1, lng: -77.6, testData: true, hotStatus: 'active' } });
    const result = await test.run(knock());
    assert.equal(result.status, 404);
    assert.equal(result.body.error, 'not_found');
    assert.equal(test.db.patches.length, 0);
    assert.equal(test.db.docs.get('hotLeads/ghl_opp1')?.testData, true);
  });
});
