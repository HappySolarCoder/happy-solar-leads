import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { distanceBetween } from 'geofire-common';
import { createFieldHandlers } from '../app/utils/server/fieldWork';

const NOW = new Date('2026-10-25T16:31:04.120Z');
const LEAD_LAT = 33.45;
const LEAD_LNG = -112.07;

function isDelete(value: unknown): boolean {
  return Boolean(value)
    && typeof value === 'object'
    && (value as { constructor?: { name?: string } }).constructor?.name === 'DeleteTransform';
}

function northOf(lat: number, lng: number, meters: number) {
  const kmRadius = 6371;
  let delta = (meters / 1000) / kmRadius * (180 / Math.PI);
  let next = lat;
  for (let i = 0; i < 8; i += 1) {
    next = lat + delta;
    const measured = distanceBetween([lat, lng], [next, lng]) * 1000;
    if (measured === 0) break;
    delta *= meters / measured;
  }
  return { lat: next, lng };
}

function square(lat: number, lng: number, delta = 0.05) {
  return [
    { lat: lat - delta, lng: lng - delta },
    { lat: lat - delta, lng: lng + delta },
    { lat: lat + delta, lng: lng + delta },
    { lat: lat + delta, lng: lng - delta },
  ];
}

class FakeDb {
  readonly docs = new Map<string, Record<string, unknown>>();
  readonly gets: string[] = [];
  readonly queries: string[] = [];

  seed(path: string, data: Record<string, unknown>): void {
    this.docs.set(path, { ...data });
  }

  collection(name: string) {
    return {
      doc: (id: string) => this.docRef(name, id),
      where: (field: string, op: string, value: string) => this.query(name, field, op, value, null),
    };
  }

  async runTransaction<T>(fn: (tx: {
    get: (target: { kind: string; path?: string; collectionName?: string; field?: string; value?: string; limitCount?: number | null }) => Promise<unknown>;
    update: (ref: { path: string }, patch: Record<string, unknown>) => void;
  }) => Promise<T>): Promise<T> {
    return fn({
      get: async (target) => {
        if (target.kind === 'query') {
          this.queries.push(`${target.collectionName}:${target.field}:${target.limitCount}`);
          return this.querySnap(target);
        }
        this.gets.push(target.path || '');
        return this.docSnap(target.path || '');
      },
      update: (ref, patch) => {
        const current = this.docs.get(ref.path);
        if (!current) throw new Error(`missing ${ref.path}`);
        for (const [key, value] of Object.entries(patch)) {
          if (isDelete(value)) delete current[key];
          else current[key] = value;
        }
      },
    });
  }

  private docRef(name: string, id: string) {
    return { kind: 'doc' as const, id, path: `${name}/${id}` };
  }

  private query(name: string, field: string, op: string, value: string, limitCount: number | null) {
    return {
      kind: 'query' as const,
      collectionName: name,
      field,
      op,
      value,
      limitCount,
      limit: (n: number) => this.query(name, field, op, value, n),
    };
  }

  private docSnap(path: string) {
    const data = this.docs.get(path);
    return {
      exists: Boolean(data),
      id: path.slice(path.indexOf('/') + 1),
      data: () => data,
    };
  }

  private querySnap(query: { collectionName?: string; field?: string; value?: string; limitCount?: number | null }) {
    const prefix = `${query.collectionName}/`;
    let rows = [...this.docs.entries()]
      .filter(([path]) => path.startsWith(prefix))
      .map(([path, data]) => ({ id: path.slice(prefix.length), data }))
      .filter((row) => row.data[query.field || ''] === query.value);
    if (query.limitCount != null) rows = rows.slice(0, query.limitCount);
    return {
      size: rows.length,
      docs: rows.map((row) => ({ id: row.id, data: () => row.data })),
    };
  }
}

function handlers(db: FakeDb) {
  return createFieldHandlers({
    adminAuth: () => ({ verifyIdToken: async (token: string) => ({ uid: token }) }) as never,
    adminDb: () => db as never,
    now: () => NOW,
  });
}

function seed(db: FakeDb, options: {
  uid?: string;
  role?: string;
  team?: string;
  lead?: Record<string, unknown>;
  territories?: Array<{ id: string; data: Record<string, unknown> }>;
} = {}) {
  const uid = options.uid ?? 'rep';
  db.seed(`users/${uid}`, { role: options.role ?? 'setter', name: 'Rep', team: options.team ?? 'A', isActive: true, approved: true });
  if (uid !== 'rep') db.seed('users/rep', { role: 'setter', name: 'Rep', team: 'A', isActive: true, approved: true });
  db.seed('leads/door', {
    status: 'unclaimed',
    assignedTo: uid === 'manager' ? 'rep' : uid,
    lat: LEAD_LAT,
    lng: LEAD_LNG,
    notes: '',
    ...options.lead,
  });
  db.seed('field_settings/v11', { enabled: { capture: true }, pilotPercent: 100 });
  for (const territory of options.territories ?? []) db.seed(`territories/${territory.id}`, territory.data);
  return uid;
}

function knock(gps: Record<string, unknown> | null, uid = 'rep') {
  return {
    id: `knock-${uid}-${JSON.stringify(gps).length}`,
    userId: uid,
    leadId: 'door',
    createdAt: NOW.toISOString(),
    kind: 'knock',
    baseStatus: 'unclaimed',
    status: 'not-home',
    observation: {
      eventId: 'knock-1',
      timeZone: 'America/Phoenix',
      ...(gps ? { gps } : {}),
    },
  };
}

async function post(db: FakeDb, body: unknown, uid = 'rep') {
  const res = await handlers(db).POST(new NextRequest('https://example.com/api/field-work', {
    method: 'POST',
    headers: { Authorization: `Bearer ${uid}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }));
  return { status: res.status, body: await res.json(), lead: db.docs.get('leads/door') ?? {} };
}

describe('legacy field-work GPS', () => {
  it('saves a knock 200 m away with too_far', async () => {
    const db = new FakeDb();
    seed(db, { territories: [{ id: 'mine', data: { userId: 'rep', polygon: square(LEAD_LAT, LEAD_LNG) } }] });
    const far = northOf(LEAD_LAT, LEAD_LNG, 200);
    const result = await post(db, knock({ lat: far.lat, lng: far.lng, accuracy: 8, timestamp: NOW.toISOString() }));
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.ok, true);
    assert.equal(result.lead.status, 'not-home');
    assert.equal(result.lead.gpsVerified, false);
    assert.equal(result.lead.gpsUnverifiedReason, 'too_far');
    assert.ok(Number(result.lead.gpsDistanceM) > 150);
  });

  it('saves malformed GPS as no_fix', async () => {
    const db = new FakeDb();
    seed(db);
    const result = await post(db, knock({ lat: 91, lng: LEAD_LNG, accuracy: -1, timestamp: NOW.toISOString() }));
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.lead.status, 'not-home');
    assert.equal(result.lead.gpsVerified, false);
    assert.equal(result.lead.gpsUnverifiedReason, 'no_fix');
    assert.equal(Object.hasOwn(result.lead, 'gpsDistanceM'), false);
    assert.equal(Object.hasOwn(result.lead, 'knockGpsLat'), false);
    const flag = (result.lead.dispositionHistory as Array<{ gpsFlag: { gpsUnverifiedReason: string } }>)[0].gpsFlag;
    assert.equal(flag.gpsUnverifiedReason, 'no_fix');
  });

  it('saves a knock outside every polygon as out_of_area', async () => {
    const db = new FakeDb();
    seed(db, { territories: [{ id: 'away', data: { userId: 'rep', polygon: square(1, 1, 0.01) } }] });
    const result = await post(db, knock({ lat: LEAD_LAT, lng: LEAD_LNG, accuracy: 8, timestamp: NOW.toISOString() }));
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.lead.gpsVerified, false);
    assert.equal(result.lead.gpsUnverifiedReason, 'out_of_area');
    assert.equal(result.lead.status, 'not-home');
  });

  it('does not flag a manager out_of_area', async () => {
    const db = new FakeDb();
    seed(db, {
      uid: 'manager',
      role: 'manager',
      team: 'A',
      territories: [{ id: 'away', data: { userId: 'manager', polygon: square(1, 1, 0.01) } }],
    });
    const result = await post(db, knock({ lat: LEAD_LAT, lng: LEAD_LNG, accuracy: 8, timestamp: NOW.toISOString() }, 'manager'), 'manager');
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.lead.gpsVerified, true);
    assert.equal(Object.hasOwn(result.lead, 'gpsUnverifiedReason'), false);
    assert.equal(result.lead.gpsDistanceM, 0);
  });

  it('verifies a good fix', async () => {
    const db = new FakeDb();
    seed(db, { territories: [{ id: 'mine', data: { userId: 'rep', polygon: square(LEAD_LAT, LEAD_LNG) } }] });
    const result = await post(db, knock({ lat: LEAD_LAT, lng: LEAD_LNG, accuracy: 8, timestamp: NOW.toISOString() }));
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.lead.gpsVerified, true);
    assert.equal(result.lead.gpsDistanceM, 0);
    assert.equal(Object.hasOwn(result.lead, 'gpsUnverifiedReason'), false);
    assert.equal(result.lead.knockGpsLat, LEAD_LAT);
    assert.equal(result.lead.status, 'not-home');
  });

  it('still rejects a pin that changed while offline', async () => {
    const db = new FakeDb();
    seed(db, { lead: { status: 'not-home' } });
    const result = await post(db, knock({ lat: LEAD_LAT, lng: LEAD_LNG, accuracy: 8, timestamp: NOW.toISOString() }));
    assert.equal(result.status, 409);
    assert.match(String(result.body.error), /changed while you were offline/);
    assert.equal(Object.hasOwn(result.lead, 'gpsVerified'), false);
    assert.equal(typeof FieldValue.delete, 'function');
  });

  it('saves a knock that has no baseStatus', async () => {
    const db = new FakeDb();
    seed(db, { lead: { status: 'not-interested' } });
    const drafted = knock({ lat: LEAD_LAT, lng: LEAD_LNG, accuracy: 8, timestamp: NOW.toISOString() });
    const { baseStatus, ...body } = drafted;
    assert.equal(baseStatus, 'unclaimed');
    assert.equal(Object.hasOwn(body, 'baseStatus'), false);
    const result = await post(db, body);
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.lead.status, 'not-home');
    assert.equal(result.lead.gpsVerified, true);
  });

  it('does not treat setterId alone as ownership', async () => {
    const db = new FakeDb();
    seed(db, {
      lead: { assignedTo: 'other', claimedBy: 'other', setterId: 'rep', source: 'canvass' },
    });
    const result = await post(db, knock(null));
    assert.equal(result.status, 403, JSON.stringify(result.body));
    assert.equal(result.lead.status, 'unclaimed');
    assert.equal(db.queries.length, 0);
    assert.equal(db.gets.some((path) => path.startsWith('territories/')), false);
  });

  it('allows a manually-added lead the rep created', async () => {
    const db = new FakeDb();
    seed(db, {
      lead: { assignedTo: 'other', claimedBy: 'other', setterId: 'rep', source: 'manually-added' },
    });
    const result = await post(db, knock(null));
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.lead.status, 'not-home');
    assert.equal(db.queries.length, 0);
  });

  it('reads lead.territoryId directly and queries the territory list once for the area flag', async () => {
    const db = new FakeDb();
    seed(db, {
      lead: {
        assignedTo: 'other',
        claimedBy: 'other',
        setterId: 'rep',
        source: 'canvass',
        territoryId: 'mine',
      },
      territories: [{ id: 'mine', data: { userId: 'rep', polygon: square(1, 1, 0.01) } }],
    });
    const result = await post(db, knock({ lat: LEAD_LAT, lng: LEAD_LNG, accuracy: 8, timestamp: NOW.toISOString() }));
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.lead.status, 'not-home');
    assert.equal(result.lead.gpsUnverifiedReason, 'out_of_area');
    assert.deepEqual(db.gets.filter((path) => path.startsWith('territories/')), ['territories/mine']);
    assert.equal(db.queries.length, 1);

    const inside = new FakeDb();
    seed(inside, {
      lead: { assignedTo: 'other', claimedBy: 'other', setterId: 'someone', source: 'canvass' },
      territories: [{ id: 'mine', data: { userId: 'rep', polygon: square(LEAD_LAT, LEAD_LNG) } }],
    });
    const denied = await post(inside, knock({ lat: LEAD_LAT, lng: LEAD_LNG, accuracy: 8, timestamp: NOW.toISOString() }));
    assert.equal(denied.status, 403, JSON.stringify(denied.body));
    assert.equal(inside.queries.length, 0);
    assert.equal(denied.lead.status, 'unclaimed');
  });
});

function notesBody(notes: string, baseNotes = '') {
  return {
    id: `notes-${notes.length}-${baseNotes.length}`,
    userId: 'rep',
    leadId: 'door',
    createdAt: NOW.toISOString(),
    kind: 'notes',
    notes,
    baseNotes,
  };
}

describe('legacy field-work notes size', () => {
  it('saves notes of 20 KB and 90 KB', async () => {
    for (const size of [20 * 1024, 90 * 1024]) {
      const db = new FakeDb();
      seed(db);
      const notes = 'n'.repeat(size);
      const result = await post(db, notesBody(notes));
      assert.equal(result.status, 200, `${size} ${JSON.stringify(result.body)}`);
      assert.equal(result.lead.notes, notes);
    }
  });

  it('rejects notes or baseNotes longer than 100000 characters', async () => {
    const db = new FakeDb();
    seed(db, { lead: { notes: 'keep' } });
    const notes = await post(db, notesBody('n'.repeat(100001)));
    assert.equal(notes.status, 413, JSON.stringify(notes.body));
    assert.equal(notes.body.reason, 'payload_too_large');
    assert.equal(notes.lead.notes, 'keep');

    const base = await post(db, notesBody('ok', 'b'.repeat(100001)));
    assert.equal(base.status, 413, JSON.stringify(base.body));
    assert.equal(base.body.reason, 'payload_too_large');
    assert.equal(base.lead.notes, 'keep');
  });

  it('still rejects a non-notes body over 32 KB', async () => {
    const db = new FakeDb();
    seed(db);
    const body = {
      ...knock({ lat: LEAD_LAT, lng: LEAD_LNG, accuracy: 8, timestamp: NOW.toISOString() }),
      observation: {
        eventId: 'knock-1',
        timeZone: 'America/Phoenix',
        pad: 'x'.repeat(40 * 1024),
      },
    };
    const result = await post(db, body);
    assert.equal(result.status, 413, JSON.stringify(result.body));
    assert.match(String(result.body.error), /too large/);
    assert.equal(result.body.reason, undefined);
    assert.equal(result.lead.status, 'unclaimed');
  });
});
