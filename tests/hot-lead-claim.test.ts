import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { handleHotLeadClaim, type ClaimDb, type ClaimSnap, type ClaimTx } from '../app/utils/server/hotLeads';

const NOW = Date.parse('2026-10-25T16:31:04.120Z');
const ACTION = '2026-10-25T16:31:04.120Z';
const SERVER_TS = { marker: 'server-timestamp' };

class Stamp {
  constructor(readonly ms: number) {}
  toMillis() { return this.ms; }
  static fromMillis(ms: number) { return new Stamp(ms); }
}

class Mem implements ClaimDb {
  docs = new Map<string, Record<string, unknown>>();
  patches: Array<{ path: string; patch: Record<string, unknown> }> = [];
  txCount = 0;

  put(path: string, data: Record<string, unknown>) {
    this.docs.set(path, { ...data });
  }

  async runTransaction<T>(fn: (tx: ClaimTx) => Promise<T>): Promise<T> {
    this.txCount += 1;
    const queued: Array<() => void> = [];
    const tx: ClaimTx = {
      get: async (path) => this.snap(path),
      update: (path, patch) => {
        this.patches.push({ path, patch });
        queued.push(() => {
          const current = this.docs.get(path);
          if (!current) throw new Error(`missing ${path}`);
          Object.assign(current, patch);
        });
      },
      create: (path, data) => {
        queued.push(() => this.docs.set(path, { ...data }));
      },
    };
    const result = await fn(tx);
    for (const job of queued) job();
    return result;
  }

  private snap(path: string): ClaimSnap {
    const data = this.docs.get(path);
    const id = path.slice(path.indexOf('/') + 1);
    if (!data) return { exists: false, id, data: () => undefined };
    return { exists: true, id, data: () => data };
  }
}

function user(role: string, extra: Record<string, unknown> = {}) {
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

function harness(options: { role?: string; uid?: string; user?: Record<string, unknown>; lead?: Record<string, unknown> | null } = {}) {
  const db = new Mem();
  const uid = options.uid ?? 'uid-closer';
  const role = options.role ?? 'closer';
  db.put(`users/${uid}`, options.user ?? user(role));
  if (options.lead !== null) {
    db.put('hotLeads/ghl_opp1', options.lead ?? {
      lat: 43.1,
      lng: -77.6,
      ghl: { opportunityId: 'opp1' },
      contacts: [{ name: 'Test Person', phone: '5550101' }],
      notes: 'keep',
      hotStatus: 'active',
    });
  }
  return {
    db,
    run(body: Record<string, unknown> | string) {
      const rawBody = typeof body === 'string' ? body : JSON.stringify(body);
      return handleHotLeadClaim({
        authorization: 'Bearer good-token',
        rawBody,
        deps: {
          verifyIdToken: async () => ({ uid }),
          getUser: async () => ({ exists: true, data: db.docs.get(`users/${uid}`) }),
          db,
          now: () => NOW,
          Timestamp: Stamp,
          serverTimestamp: () => SERVER_TS,
        },
      });
    },
  };
}

function claim(overrides: Record<string, unknown> = {}) {
  return {
    draftId: 'draft-1',
    hotLeadId: 'ghl_opp1',
    action: 'claim',
    actionAt: ACTION,
    userName: 'Jane Rep',
    ...overrides,
  };
}

describe('POST /api/hot-leads/claim', () => {
  it('claims, replays, and leaves every other field alone', async () => {
    const test = harness();
    const first = await test.run(claim());
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(first.body.result, 'applied');
    assert.equal(first.body.duplicate, false);
    assert.equal(first.body.claimedBy, 'uid-closer');
    const doc = test.db.docs.get('hotLeads/ghl_opp1') ?? {};
    assert.equal(doc.claimedBy, 'uid-closer');
    assert.equal(doc.claimedByName, 'Jane Rep');
    assert.equal((doc.claimedAt as Stamp).toMillis(), NOW);
    assert.equal(doc.notes, 'keep');
    assert.deepEqual(doc.ghl, { opportunityId: 'opp1' });
    assert.deepEqual(Object.keys(test.db.patches[0].patch).sort(), ['claimedAt', 'claimedBy', 'claimedByName', 'updatedAt']);
    const again = await test.run(claim());
    assert.equal(again.status, 200);
    assert.equal(again.body.duplicate, true);
    assert.equal(again.body.result, 'applied');
    assert.equal(test.db.patches.length, 1);

    const otherDraft = await test.run(claim({ draftId: 'draft-2' }));
    assert.equal(otherDraft.status, 200, JSON.stringify(otherDraft.body));
    assert.equal(otherDraft.body.result, 'unchanged');
    assert.equal(otherDraft.body.duplicate, false);
    assert.equal(test.db.patches.length, 1);
  });

  it('conflicts, releases, and enforces the role gate', async () => {
    const logs: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => { logs.push(args.map(String).join(' ')); };
    try {
      const owned = harness({ lead: {
        claimedBy: 'other-rep',
        claimedByName: 'Other Rep',
        notes: 'keep',
        ghl: { stage: 'New' },
      } });
      const conflict = await owned.run(claim());
      assert.equal(conflict.status, 409);
      assert.equal(conflict.body.reasonCode, 'owned_by_other');
      assert.equal(conflict.body.claimedByName, 'Other Rep');
      assert.equal(owned.db.patches.length, 0);
      assert.equal(logs.join('\n').includes('Other Rep'), false);

      const closerRelease = await owned.run(claim({ draftId: 'draft-rel', action: 'release' }));
      assert.equal(closerRelease.status, 403);
      assert.equal(closerRelease.body.reasonCode, 'owned_by_other');
      assert.equal(owned.db.docs.get('hotLeads/ghl_opp1')?.claimedBy, 'other-rep');

      const manager = harness({
        role: 'manager',
        uid: 'uid-manager',
        lead: { claimedBy: 'other-rep', claimedByName: 'Other Rep', notes: 'keep' },
      });
      const released = await manager.run(claim({ draftId: 'draft-mgr', action: 'release' }));
      assert.equal(released.status, 200, JSON.stringify(released.body));
      assert.equal(released.body.claimedBy, null);
      assert.equal(manager.db.docs.get('hotLeads/ghl_opp1')?.claimedBy, null);
      assert.equal(manager.db.docs.get('hotLeads/ghl_opp1')?.claimedAt, null);
      assert.equal(manager.db.docs.get('hotLeads/ghl_opp1')?.notes, 'keep');

      const mine = harness({ lead: { claimedBy: 'uid-closer', claimedByName: 'Jane Rep', notes: 'keep' } });
      const self = await mine.run(claim({ draftId: 'draft-self', action: 'release' }));
      assert.equal(self.status, 200, JSON.stringify(self.body));
      assert.equal(mine.db.docs.get('hotLeads/ghl_opp1')?.claimedBy, null);

      const setter = harness({ role: 'setter', uid: 'uid-setter' });
      const denied = await setter.run(claim());
      assert.equal(denied.status, 403);
      assert.equal(denied.body.reasonCode, 'permission_denied');
      assert.equal(setter.db.txCount, 0);

      const testAccount = harness({ user: user('closer', { team: 'TEST' }) });
      const hidden = await testAccount.run(claim());
      assert.equal(hidden.status, 403);
      assert.equal(testAccount.db.txCount, 0);

      const secret = harness({ lead: { testData: true, notes: 'keep' } });
      const missing = await secret.run(claim());
      assert.equal(missing.status, 404);
      assert.equal(secret.db.patches.length, 0);
    } finally {
      console.log = original;
    }
  });

  it('rejects a replay whose receipt collection is leads', async () => {
    const test = harness();
    test.db.put('fieldDispoReceipts/uid-closer_draft-1', {
      leadId: 'ghl_opp1',
      kind: 'claim',
      collection: 'leads',
      response: { ok: true, draftId: 'draft-1', result: 'applied', duplicate: false, claimedBy: 'uid-closer' },
    });
    const result = await test.run(claim());
    assert.equal(result.status, 409);
    assert.equal(result.body.field, 'collection');
    assert.equal(test.db.docs.get('hotLeads/ghl_opp1')?.claimedBy, undefined);

    const kind = harness();
    kind.db.put('fieldDispoReceipts/uid-closer_draft-1', {
      leadId: 'ghl_opp1',
      kind: 'knock',
      collection: 'hotLeads',
      response: { ok: true, draftId: 'draft-1', result: 'applied', duplicate: false },
    });
    const kindResult = await kind.run(claim());
    assert.equal(kindResult.status, 409);
    assert.equal(kindResult.body.field, 'kind');
    assert.equal(kind.db.patches.length, 0);

    const other = harness();
    other.db.put('fieldDispoReceipts/uid-closer_draft-1', {
      leadId: 'ghl_other',
      kind: 'claim',
      collection: 'hotLeads',
      response: { ok: true, draftId: 'draft-1', result: 'applied', duplicate: false, claimedBy: 'uid-closer' },
    });
    const otherResult = await other.run(claim());
    assert.equal(otherResult.status, 409);
    assert.equal(otherResult.body.field, 'leadId');
    assert.equal(other.db.patches.length, 0);
  });
});
