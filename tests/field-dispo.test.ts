import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { distanceBetween } from 'geofire-common';
import {
  ALLOWED_PATCH_KEYS,
  FIELD_DISPO_GPS_POLICY,
  FIELD_DISPO_MAX_BYTES,
  HISTORY_CAP,
  TERRITORY_QUERY_LIMIT,
  assertAllowedPatch,
  handleFieldDispo,
  type DispoCollection,
  type DispoDb,
  type DispoDocRef,
  type DispoFilter,
  type DispoQuery,
  type DispoSnap,
  type DispoTransaction,
  type FieldDispoDeps,
} from '../app/utils/server/fieldDispo';
import { FIELD_REASON_CODES } from '../app/utils/server/fieldReasonCodes';

const NOW = Date.parse('2026-10-25T16:31:04.120Z');
const ACTION = '2026-10-25T16:31:04.120Z';
const LEAD_LAT = 33.45;
const LEAD_LNG = -112.07;
const DAY = 24 * 60 * 60 * 1000;
const SERVER_TS = { marker: 'server-timestamp' };
const logs: string[] = [];
const originalLog = console.log;
console.log = (...args: unknown[]) => {
  logs.push(args.map((part) => String(part)).join(' '));
};
after(() => {
  console.log = originalLog;
});

class FakeTimestamp {
  readonly ms: number;

  constructor(ms: number) {
    this.ms = ms;
  }

  toMillis(): number {
    return this.ms;
  }

  static fromMillis(ms: number): FakeTimestamp {
    return new FakeTimestamp(ms);
  }
}

type Op =
  | { op: 'collection'; name: string }
  | { op: 'get'; path: string; tx: number | null }
  | { op: 'query'; collectionName: string; filters: readonly DispoFilter[]; limitCount: number | null; tx: number }
  | { op: 'update'; path: string; patch: Record<string, unknown>; tx: number }
  | { op: 'create'; path: string; data: Record<string, unknown>; tx: number };

class FakeDb implements DispoDb {
  readonly docs = new Map<string, Record<string, unknown>>();
  readonly ops: Op[] = [];
  txCount = 0;

  put(path: string, data: Record<string, unknown>): void {
    this.docs.set(path, data);
  }

  collection(name: string): DispoCollection {
    this.ops.push({ op: 'collection', name });
    return {
      name,
      doc: (id: string) => this.doc(name, id),
      where: (field: string, op: string, value: string) => this.query(name, [{ field, op, value }], null),
    };
  }

  async runTransaction<T>(fn: (tx: DispoTransaction) => Promise<T>): Promise<T> {
    const txId = ++this.txCount;
    const queued: Array<() => void> = [];
    const tx: DispoTransaction = {
      get: async (ref) => {
        this.ops.push({ op: 'get', path: ref.path, tx: txId });
        return this.snap(ref.path);
      },
      getQuery: async (query) => {
        this.ops.push({
          op: 'query',
          collectionName: query.collectionName,
          filters: query.filters,
          limitCount: query.limitCount,
          tx: txId,
        });
        return { docs: this.match(query) };
      },
      update: (ref, patch) => {
        this.ops.push({ op: 'update', path: ref.path, patch, tx: txId });
        queued.push(() => {
          const current = this.docs.get(ref.path);
          if (!current) throw new Error(`missing ${ref.path}`);
          Object.assign(current, patch);
        });
      },
      create: (ref, data) => {
        this.ops.push({ op: 'create', path: ref.path, data, tx: txId });
        queued.push(() => {
          if (this.docs.has(ref.path)) throw new Error(`exists ${ref.path}`);
          this.docs.set(ref.path, { ...data });
        });
      },
    };
    const result = await fn(tx);
    for (const job of queued) job();
    return result;
  }

  private doc(name: string, id: string): DispoDocRef {
    const path = `${name}/${id}`;
    return {
      id,
      path,
      get: async () => {
        this.ops.push({ op: 'get', path, tx: null });
        return this.snap(path);
      },
    };
  }

  private query(name: string, filters: readonly DispoFilter[], limitCount: number | null): DispoQuery {
    return {
      kind: 'query',
      collectionName: name,
      filters,
      limitCount,
      limit: (n: number) => this.query(name, filters, n),
    };
  }

  private snap(path: string): DispoSnap {
    const data = this.docs.get(path);
    const id = path.slice(path.indexOf('/') + 1);
    if (!data) return { exists: false, id, data: () => undefined };
    return { exists: true, id, data: () => data };
  }

  private match(query: DispoQuery): DispoSnap[] {
    const prefix = `${query.collectionName}/`;
    let rows = [...this.docs.entries()]
      .filter(([path]) => path.startsWith(prefix))
      .map(([path, data]) => ({ id: path.slice(prefix.length), data }));
    for (const filter of query.filters) {
      rows = rows.filter((row) => row.data[filter.field] === filter.value);
    }
    if (query.limitCount != null) rows = rows.slice(0, query.limitCount);
    return rows.map((row) => ({ exists: true, id: row.id, data: () => row.data }));
  }
}

function square(lat: number, lng: number, delta = 0.02) {
  return [
    { lat: lat - delta, lng: lng - delta },
    { lat: lat - delta, lng: lng + delta },
    { lat: lat + delta, lng: lng + delta },
    { lat: lat + delta, lng: lng - delta },
  ];
}

function approvedUser(overrides: Record<string, unknown> = {}) {
  return {
    role: 'setter',
    isActive: true,
    approved: true,
    approvalStatus: 'approved',
    status: 'active',
    email: 'rep@company.com',
    name: 'Jane Rep',
    ...overrides,
  };
}

function knockBody(overrides: Record<string, unknown> = {}) {
  return {
    draftId: 'draft-1',
    leadId: 'lead-1',
    kind: 'knock',
    actionAt: ACTION,
    status: 'go-back',
    disposition: 'Go Back',
    userName: 'Jane Rep',
    gps: {
      lat: LEAD_LAT,
      lng: LEAD_LNG,
      accuracyM: 8.5,
      capturedAt: new Date(NOW + 2000).toISOString(),
    },
    ...overrides,
  };
}

function pointDueNorth(lat: number, lng: number, meters: number) {
  const kmRadius = 6371;
  let delta = (meters / 1000) / kmRadius * (180 / Math.PI);
  let next = lat;
  for (let i = 0; i < 8; i += 1) {
    next = lat + delta;
    const measured = distanceBetween([lat, lng], [next, lng]) * 1000;
    if (measured === 0) break;
    delta *= meters / measured;
  }
  return { lat: next, lng, distanceM: distanceBetween([lat, lng], [next, lng]) * 1000 };
}

function harness(options: {
  uid?: string;
  user?: Record<string, unknown>;
  exists?: boolean;
  lead?: Record<string, unknown> | null;
  leadId?: string;
  territories?: Array<{ id: string; data: Record<string, unknown> }>;
  receipts?: Array<{ id: string; data: Record<string, unknown> }>;
  now?: () => number;
  gpsPolicy?: 'hold' | 'flag';
  verifyError?: unknown;
  authorization?: string | null;
} = {}) {
  const db = new FakeDb();
  const uid = options.uid ?? 'uid-setter';
  const exists = options.exists !== false;
  if (exists) db.put(`users/${uid}`, options.user ?? approvedUser());
  const leadId = options.leadId ?? 'lead-1';
  if (options.lead !== null) {
    db.put(`leads/${leadId}`, options.lead ?? { lat: LEAD_LAT, lng: LEAD_LNG, claimedBy: uid });
  }
  for (const territory of options.territories ?? []) db.put(`territories/${territory.id}`, territory.data);
  for (const receipt of options.receipts ?? []) db.put(`fieldDispoReceipts/${receipt.id}`, receipt.data);
  const revoked: boolean[] = [];
  const deps: FieldDispoDeps = {
    verifyIdToken: async (_token, checkRevoked) => {
      revoked.push(checkRevoked);
      if (options.verifyError) throw options.verifyError;
      return { uid, email: 'rep@company.com' };
    },
    getUser: async (id) => {
      const snap = await db.collection('users').doc(id).get();
      return { exists: snap.exists, data: snap.data() };
    },
    db,
    now: options.now ?? (() => NOW),
    rateLimitStore: new Map(),
    gpsPolicy: options.gpsPolicy,
    Timestamp: FakeTimestamp,
    serverTimestamp: () => SERVER_TS,
  };
  return {
    db,
    uid,
    revoked,
    run(body?: unknown, authorization?: string | null, extra: { rawBody?: string; bodyBytes?: number } = {}) {
      const header = authorization === undefined ? (options.authorization === undefined ? 'Bearer good-token' : options.authorization) : authorization;
      if (extra.rawBody !== undefined || extra.bodyBytes !== undefined) {
        return handleFieldDispo({
          authorization: header,
          rawBody: extra.rawBody,
          bodyBytes: extra.bodyBytes,
          body,
          deps,
        });
      }
      return handleFieldDispo({ authorization: header, body, deps });
    },
  };
}

function collections(db: FakeDb): string[] {
  return [...new Set(db.ops.filter((op) => op.op === 'collection').map((op) => op.name))].sort();
}

function updates(db: FakeDb) {
  return db.ops.filter((op) => op.op === 'update');
}

function creates(db: FakeDb) {
  return db.ops.filter((op) => op.op === 'create');
}

function patch(db: FakeDb): Record<string, unknown> {
  const last = updates(db).at(-1);
  assert.ok(last && last.op === 'update');
  return last.patch;
}

describe('field dispo', { concurrency: 1 }, () => {
  it('keeps the shared reason codes and the hold policy', () => {
    assert.deepEqual([...FIELD_REASON_CODES], [
      'gps_unverified_held',
      'gps_unverified_flagged',
      'outside_50m',
      'permission_denied',
      'out_of_territory',
      'owned_by_other',
      'historical_pin',
      'not_found',
      'stale_tap',
      'notes_conflict',
      'invalid_payload',
      'other',
    ]);
    assert.equal(FIELD_DISPO_GPS_POLICY, 'hold');
    assert.throws(() => assertAllowedPatch({ claimedBy: 'uid-setter', status: 'go-back' }));
    assert.doesNotThrow(() => assertAllowedPatch({ status: 'go-back', notes: 'ok' }));
  });

  it('rejects a missing or garbled bearer and an auth failure', async () => {
    const missing = harness({ authorization: null });
    const missingResult = await missing.run(knockBody());
    assert.equal(missingResult.status, 401);
    assert.deepEqual(missingResult.body, { ok: false, error: 'unauthenticated' });
    assert.deepEqual(collections(missing.db), []);

    const garbled = harness();
    const garbledResult = await garbled.run(knockBody(), 'Token abc');
    assert.equal(garbledResult.status, 401);
    assert.equal((await garbled.run(knockBody(), 'Bearer')).status, 401);

    const revoked = harness({ verifyError: { code: 'auth/id-token-revoked' } });
    const revokedResult = await revoked.run(knockBody());
    assert.equal(revokedResult.status, 401);
    assert.deepEqual(collections(revoked.db), []);

    const boom = harness({ verifyError: new Error('backend down') });
    await assert.rejects(() => boom.run(knockBody()));
  });

  it('rejects profiles the rules would not treat as an active field writer', async () => {
    const cases: Array<{ name: string; exists?: boolean; user?: Record<string, unknown> }> = [
      { name: 'missing', exists: false },
      { name: 'pending', user: approvedUser({ approvalStatus: 'pending', approved: false }) },
      { name: 'inactive flag', user: approvedUser({ isActive: false }) },
      { name: 'inactive status', user: approvedUser({ status: 'inactive' }) },
      { name: 'deleted', user: approvedUser({ deleted: true }) },
      { name: 'deletion pending', user: approvedUser({ deletionPending: true }) },
      { name: 'deleted at', user: approvedUser({ deletedAt: '2026-01-01T00:00:00.000Z' }) },
      { name: 'viewer', user: approvedUser({ role: 'viewer' }) },
    ];
    for (const item of cases) {
      const test = harness({ exists: item.exists, user: item.user });
      const result = await test.run(knockBody());
      assert.equal(result.status, 403, item.name);
      assert.equal(result.body.reasonCode, 'permission_denied', item.name);
      assert.equal(result.body.error, 'forbidden', item.name);
      assert.deepEqual(collections(test.db), ['users'], item.name);
    }
  });

  it('allows a legacy rep whose missing flags match the rules defaults', async () => {
    const test = harness({
      user: { role: 'closer' },
      lead: { lat: LEAD_LAT, lng: LEAD_LNG, claimedBy: 'uid-setter' },
    });
    const result = await test.run(knockBody({ gps: undefined }));
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.result, 'applied');
  });

  it('rejects TEST accounts before any lead, territory, or receipt read', async () => {
    const cases: Array<{ name: string; uid?: string; user: Record<string, unknown> }> = [
      { name: 'team', user: approvedUser({ team: 'TEST' }) },
      { name: 'testData', user: approvedUser({ testData: true }) },
      { name: 'isTestAccount', user: approvedUser({ isTestAccount: true }) },
      { name: 'uid', uid: 'user-test-4', user: approvedUser({ email: 'seed@company.com' }) },
      { name: 'email', user: approvedUser({ email: 'Evan@Test.com' }) },
    ];
    for (const item of cases) {
      const test = harness({ uid: item.uid, user: item.user, lead: { claimedBy: item.uid ?? 'uid-setter' } });
      const result = await test.run(knockBody());
      assert.equal(result.status, 403, item.name);
      assert.equal(result.body.reasonCode, 'permission_denied', item.name);
      const ops = test.db.ops;
      assert.deepEqual(collections(test.db), ['users'], item.name);
      assert.equal(ops.some((op) => op.op === 'get' && !op.path.startsWith('users/')), false, item.name);
      assert.equal(ops.some((op) => op.op === 'query' || op.op === 'update' || op.op === 'create'), false, item.name);
    }
  });

  it('rejects a draft that is not safe to write', async () => {
    const bad: Array<{ name: string; body: Record<string, unknown>; field: string }> = [
      { name: 'dot draft', body: knockBody({ draftId: 'a.b' }), field: 'draftId' },
      { name: 'colon draft', body: knockBody({ draftId: 'a:b' }), field: 'draftId' },
      { name: 'slash draft', body: knockBody({ draftId: 'a/b' }), field: 'draftId' },
      { name: 'long draft', body: knockBody({ draftId: 'a'.repeat(129) }), field: 'draftId' },
      { name: 'long lead', body: knockBody({ leadId: 'a'.repeat(1501) }), field: 'leadId' },
      { name: 'dot lead', body: knockBody({ leadId: '..' }), field: 'leadId' },
      { name: 'slash lead', body: knockBody({ leadId: 'a/b' }), field: 'leadId' },
      { name: 'handoff', body: knockBody({ kind: 'handoff' }), field: 'kind' },
      { name: 'claimed', body: knockBody({ status: 'claimed' }), field: 'status' },
      { name: 'unclaimed', body: knockBody({ status: 'unclaimed' }), field: 'status' },
      { name: 'photos', body: knockBody({ photos: [] }), field: 'photos' },
      { name: 'name', body: knockBody({ name: 'Pat' }), field: 'name' },
      { name: 'email', body: knockBody({ email: 'a@b.com' }), field: 'email' },
      { name: 'claimedBy', body: knockBody({ claimedBy: 'other' }), field: 'claimedBy' },
      { name: 'territoryId', body: knockBody({ territoryId: 'terr-1' }), field: 'territoryId' },
      { name: 'uid', body: knockBody({ uid: 'uid-setter' }), field: 'uid' },
      { name: 'both followups', body: knockBody({
        goBack: { scheduledDate: '2026-10-28T00:00:00.000Z' },
        objection: { type: 'other' },
      }), field: 'goBack' },
      { name: 'notes length', body: { draftId: 'draft-1', leadId: 'lead-1', kind: 'notes', actionAt: ACTION, notes: 'n'.repeat(10001), baseNotes: '' }, field: 'notes' },
      { name: 'goBack notes', body: knockBody({ goBack: { scheduledDate: '2026-10-28T00:00:00.000Z', notes: 'n'.repeat(2001) } }), field: 'goBack.notes' },
      { name: 'goBack time', body: knockBody({ goBack: { scheduledDate: '2026-10-28T00:00:00.000Z', scheduledTime: '1'.repeat(17) } }), field: 'goBack.scheduledTime' },
      { name: 'objection type', body: knockBody({ objection: { type: 'nope' } }), field: 'objection.type' },
      { name: 'objection notes', body: knockBody({ objection: { type: 'other', notes: 'n'.repeat(2001) } }), field: 'objection.notes' },
      { name: 'client distance', body: knockBody({ knockDistanceFromAddress: 1 }), field: 'knockDistanceFromAddress' },
      { name: 'knock notes', body: knockBody({ notes: 'nope' }), field: 'notes' },
    ];
    for (const item of bad) {
      const test = harness();
      const result = await test.run(item.body);
      assert.equal(result.status, 400, item.name);
      assert.equal(result.body.reasonCode, 'invalid_payload', item.name);
      assert.equal(result.body.field, item.field, item.name);
      assert.equal(test.db.txCount, 0, item.name);
    }

    const ok = harness();
    const okResult = await ok.run(knockBody({ draftId: 'a'.repeat(128) }));
    assert.equal(okResult.status, 200, JSON.stringify(okResult.body));
    assert.deepEqual(ok.revoked, [true]);
  });

  it('rejects a body over 32KB and a non-ISO action time', async () => {
    const tooBig = harness();
    const big = await tooBig.run(undefined, undefined, { rawBody: 'x'.repeat(FIELD_DISPO_MAX_BYTES + 1) });
    assert.equal(big.status, 413);
    assert.deepEqual(big.body, { ok: false, error: 'too_large' });
    assert.equal(tooBig.db.txCount, 0);

    const declared = harness();
    const declaredResult = await declared.run(knockBody(), undefined, { bodyBytes: FIELD_DISPO_MAX_BYTES + 1 });
    assert.equal(declaredResult.status, 413);

    const badJson = harness();
    const badJsonResult = await badJson.run(undefined, undefined, { rawBody: '{' });
    assert.equal(badJsonResult.status, 400);
    assert.equal(badJsonResult.body.field, 'body');

    const dates: Array<{ name: string; actionAt: unknown; status: number }> = [
      { name: 'millis', actionAt: NOW, status: 400 },
      { name: '31 days', actionAt: new Date(NOW - 31 * DAY).toISOString(), status: 400 },
      { name: '11 min', actionAt: new Date(NOW + 11 * 60 * 1000).toISOString(), status: 400 },
      { name: 'unparseable', actionAt: 'yesterday', status: 400 },
    ];
    for (const item of dates) {
      const test = harness();
      const result = await test.run(knockBody({ actionAt: item.actionAt, gps: { ...knockBody().gps, capturedAt: ACTION } }));
      assert.equal(result.status, item.status, item.name);
      if (item.status === 400) assert.equal(result.body.field, 'actionAt', item.name);
    }

    const edge = harness();
    const actionAt = new Date(NOW - 30 * DAY).toISOString();
    const edgeResult = await edge.run(knockBody({
      actionAt,
      gps: { lat: LEAD_LAT, lng: LEAD_LNG, accuracyM: 5, capturedAt: actionAt },
    }));
    assert.equal(edgeResult.status, 200, JSON.stringify(edgeResult.body));
    const ahead = harness();
    const aheadAt = new Date(NOW + 10 * 60 * 1000).toISOString();
    const aheadResult = await ahead.run(knockBody({
      actionAt: aheadAt,
      gps: { lat: LEAD_LAT, lng: LEAD_LNG, accuracyM: 5, capturedAt: aheadAt },
    }));
    assert.equal(aheadResult.status, 200, JSON.stringify(aheadResult.body));
    assert.ok(patch(ahead.db).dispositionedAt instanceof FakeTimestamp);
    assert.equal((patch(ahead.db).dispositionedAt as FakeTimestamp).toMillis(), Date.parse(aheadAt));
  });

  it('follows the ownership table and today\'s territory rule', async () => {
    const uid = 'uid-setter';
    const mine = { id: 'terr-mine', data: { userId: uid, polygon: square(LEAD_LAT, LEAD_LNG) } };
    const cases: Array<{
      name: string;
      user?: Record<string, unknown>;
      lead: Record<string, unknown>;
      territories?: Array<{ id: string; data: Record<string, unknown> }>;
      body?: Record<string, unknown>;
      status: number;
      reason?: string;
      result?: string;
      queries?: boolean;
    }> = [
      {
        name: 'unowned inside polygon without territoryId',
        lead: { lat: LEAD_LAT, lng: LEAD_LNG },
        territories: [mine],
        status: 200,
        result: 'applied',
        queries: true,
      },
      {
        name: 'unowned outside polygon but territoryId is mine',
        lead: { lat: 40, lng: -70, territoryId: 'terr-mine' },
        territories: [mine],
        body: knockBody({ gps: { lat: 40, lng: -70, accuracyM: 5, capturedAt: new Date(NOW + 1000).toISOString() } }),
        status: 200,
        result: 'applied',
        queries: true,
      },
      {
        name: 'another rep claimed pin in my territory is allowed',
        lead: { lat: LEAD_LAT, lng: LEAD_LNG, claimedBy: 'other-rep', territoryId: 'terr-mine' },
        territories: [mine],
        status: 200,
        result: 'applied',
        queries: true,
      },
      {
        name: 'another rep assigned pin in my territory is allowed',
        lead: { lat: LEAD_LAT, lng: LEAD_LNG, assignedTo: 'other-rep', territoryId: 'terr-mine' },
        territories: [mine],
        status: 200,
        result: 'applied',
        queries: true,
      },
      {
        name: 'archived territory id still matches today\'s rules',
        lead: { lat: 40, lng: -70, claimedBy: 'other-rep', territoryId: 'terr-old' },
        territories: [{ id: 'terr-old', data: { userId: uid, archived: true, polygon: square(40, -70) } }],
        body: knockBody({ gps: { lat: 40, lng: -70, accuracyM: 4, capturedAt: new Date(NOW + 1000).toISOString() } }),
        status: 200,
        result: 'applied',
        queries: true,
      },
      {
        name: 'claimed by other inside my polygon but not my territoryId',
        lead: { lat: LEAD_LAT, lng: LEAD_LNG, claimedBy: 'other-rep' },
        territories: [mine],
        status: 403,
        reason: 'owned_by_other',
        queries: true,
      },
      {
        name: 'assigned to other and not my territory',
        lead: { lat: 10, lng: 10, assignedTo: 'other-rep' },
        territories: [mine],
        status: 403,
        reason: 'owned_by_other',
        queries: true,
      },
      {
        name: 'manual lead I created stays mine',
        lead: { lat: 10, lng: 10, claimedBy: 'other-rep', setterId: uid, source: 'manually-added' },
        territories: [mine],
        body: knockBody({ gps: { lat: 10, lng: 10, accuracyM: 3, capturedAt: new Date(NOW + 1000).toISOString() } }),
        status: 200,
        result: 'applied',
        queries: false,
      },
      {
        name: 'archived polygon is not containment',
        lead: { lat: LEAD_LAT, lng: LEAD_LNG },
        territories: [{ id: 'terr-arch', data: { userId: uid, archived: true, polygon: square(LEAD_LAT, LEAD_LNG) } }],
        status: 403,
        reason: 'out_of_territory',
        queries: true,
      },
      {
        name: 'two-point polygon is not containment',
        lead: { lat: LEAD_LAT, lng: LEAD_LNG },
        territories: [{ id: 'terr-short', data: { userId: uid, polygon: [{ lat: LEAD_LAT, lng: LEAD_LNG }, { lat: LEAD_LAT + 1, lng: LEAD_LNG }] } }],
        status: 403,
        reason: 'out_of_territory',
        queries: true,
      },
      {
        name: 'unowned outside every polygon',
        lead: { lat: 10, lng: 10 },
        territories: [mine],
        status: 403,
        reason: 'out_of_territory',
        queries: true,
      },
      {
        name: 'missing coordinates and not owned',
        lead: {},
        territories: [mine],
        status: 403,
        reason: 'out_of_territory',
        queries: true,
      },
      {
        name: 'manager on a lead claimed by someone else',
        user: approvedUser({ role: 'manager' }),
        lead: { lat: LEAD_LAT, lng: LEAD_LNG, claimedBy: 'other-rep', assignedTo: 'other-rep' },
        status: 200,
        result: 'applied',
        queries: false,
      },
      {
        name: 'admin without gps',
        user: approvedUser({ role: 'admin' }),
        lead: { claimedBy: 'other-rep' },
        body: knockBody({ gps: undefined }),
        status: 200,
        result: 'applied',
        queries: false,
      },
      {
        name: 'historical pin',
        user: approvedUser({ role: 'admin' }),
        lead: { historicalTerritoryPin: true, claimedBy: 'uid-setter' },
        body: knockBody({ gps: undefined }),
        status: 403,
        reason: 'historical_pin',
        queries: false,
      },
      {
        name: 'test lead',
        lead: { lat: LEAD_LAT, lng: LEAD_LNG, claimedBy: uid, testData: true },
        status: 403,
        reason: 'permission_denied',
        queries: false,
      },
      {
        name: 'excluded test lead',
        lead: { lat: LEAD_LAT, lng: LEAD_LNG, claimedBy: uid, isExcludedTestLead: true },
        status: 403,
        reason: 'permission_denied',
        queries: false,
      },
    ];

    for (const item of cases) {
      const test = harness({ user: item.user, lead: item.lead, territories: item.territories });
      const result = await test.run(item.body ?? knockBody());
      assert.equal(result.status, item.status, `${item.name} ${JSON.stringify(result.body)}`);
      if (item.reason) assert.equal(result.body.reasonCode, item.reason, item.name);
      if (item.result) assert.equal(result.body.result, item.result, item.name);
      const queried = test.db.ops.some((op) => op.op === 'query');
      assert.equal(queried, item.queries, item.name);
      if (item.status !== 200) {
        assert.equal(creates(test.db).length, 0, item.name);
        assert.equal(updates(test.db).length, 0, item.name);
      }
    }
  });

  it('writes only allowlisted keys and recomputes distance', async () => {
    const moved = pointDueNorth(LEAD_LAT, LEAD_LNG, 12);
    const plain = harness({ lead: { lat: LEAD_LAT, lng: LEAD_LNG, claimedBy: 'uid-setter', goBackNotes: 'keep', claimedAt: 'stay' } });
    const plainResult = await plain.run(knockBody({
      gps: { lat: moved.lat, lng: moved.lng, accuracyM: 6, capturedAt: new Date(NOW + 1000).toISOString() },
    }));
    assert.equal(plainResult.status, 200);
    const plainPatch = patch(plain.db);
    assert.ok(Object.keys(plainPatch).every((key) => ALLOWED_PATCH_KEYS.has(key)));
    for (const key of ['claimedBy', 'claimedAt', 'assignedTo', 'assignedAt', 'territoryId', 'setterId', 'source', 'photos', 'name', 'address', 'email']) {
      assert.equal(Object.hasOwn(plainPatch, key), false, key);
    }
    assert.equal(plainPatch.knockDistanceFromAddress, distanceBetween([moved.lat, moved.lng], [LEAD_LAT, LEAD_LNG]) * 1000);
    assert.equal(plain.db.docs.get('leads/lead-1')?.goBackNotes, 'keep');
    assert.equal(plain.db.docs.get('leads/lead-1')?.claimedBy, 'uid-setter');

    const goBack = harness();
    await goBack.run(knockBody({
      goBack: { scheduledDate: '2026-10-28T00:00:00.000Z', scheduledTime: '14:30', notes: 'After 5' },
    }));
    const goBackPatch = patch(goBack.db);
    assert.ok(Object.keys(goBackPatch).every((key) => ALLOWED_PATCH_KEYS.has(key)));
    assert.equal(goBackPatch.goBackScheduledBy, 'uid-setter');
    assert.equal(goBackPatch.goBackScheduledTime, '14:30');
    assert.equal(goBackPatch.goBackNotes, 'After 5');
    assert.ok(goBackPatch.goBackScheduledDate instanceof FakeTimestamp);
    assert.equal(Object.hasOwn(goBackPatch, 'objectionType'), false);

    const objection = harness({ uid: 'uid-closer', user: approvedUser({ role: 'closer' }), lead: { claimedBy: 'uid-closer' } });
    await objection.run(knockBody({ objection: { type: 'need-to-think' }, gps: undefined }));
    const objectionPatch = patch(objection.db);
    assert.equal(objectionPatch.objectionRecordedBy, 'uid-closer');
    assert.equal(objectionPatch.objectionType, 'need-to-think');
    assert.equal(objectionPatch.objectionNotes, '');
    assert.equal(Object.hasOwn(objectionPatch, 'goBackScheduledBy'), false);

    const notes = harness({ user: approvedUser({ role: 'closer' }), lead: { claimedBy: 'uid-setter', notes: 'old' } });
    await notes.run({ draftId: 'draft-notes', leadId: 'lead-1', kind: 'notes', actionAt: ACTION, notes: 'new note', baseNotes: 'old' });
    assert.deepEqual(Object.keys(patch(notes.db)), ['notes']);
  });

  it('merges history newest-first without rewriting old entries', async () => {
    const newer = Object.freeze({ disposition: 'Newer', timestamp: new FakeTimestamp(NOW + 10_000), userId: 'u2', userName: 'Newer Name' });
    const older = Object.freeze({ disposition: 'Older', timestamp: new FakeTimestamp(NOW - 10_000), userId: 'u3', userName: 'Older Name' });
    const noTs = Object.freeze({ disposition: 'None', userId: 'u4', userName: 'No Time' });
    const ordered = harness({
      lead: { lat: LEAD_LAT, lng: LEAD_LNG, claimedBy: 'uid-setter', dispositionHistory: [newer, older, noTs] },
    });
    await ordered.run(knockBody());
    const history = patch(ordered.db).dispositionHistory as unknown[];
    assert.equal(history[0], newer);
    assert.equal(history[2], older);
    assert.equal(history[3], noTs);
    assert.equal((history[1] as { userId: string }).userId, 'uid-setter');
    assert.equal((history[1] as { disposition: string }).disposition, 'Go Back');
    assert.deepEqual(Object.keys(history[1] as object).sort(), ['disposition', 'timestamp', 'userId', 'userName']);

    const replay = harness({
      lead: {
        lat: LEAD_LAT,
        lng: LEAD_LNG,
        claimedBy: 'uid-setter',
        dispositionHistory: [{ disposition: 'Go Back', timestamp: new FakeTimestamp(NOW), userId: 'uid-setter', userName: 'Jane Rep' }],
      },
    });
    await replay.run(knockBody());
    assert.equal(Object.hasOwn(patch(replay.db), 'dispositionHistory'), false);

    const different = harness({
      lead: {
        lat: LEAD_LAT,
        lng: LEAD_LNG,
        claimedBy: 'uid-setter',
        dispositionHistory: [{ disposition: 'Not Home', timestamp: new FakeTimestamp(NOW), userId: 'uid-setter', userName: 'Jane Rep' }],
      },
    });
    await different.run(knockBody());
    const changed = patch(different.db).dispositionHistory as Array<{ disposition: string }>;
    assert.equal(changed.length, 2);
    assert.equal(changed[0].disposition, 'Not Home');
    assert.equal(changed[1].disposition, 'Go Back');

    const existing = Array.from({ length: HISTORY_CAP }, (_, index) => ({
      disposition: `old-${index}`,
      timestamp: new FakeTimestamp(NOW + 60_000 + index),
      userId: 'other',
      userName: 'Other',
    }));
    const capped = harness({
      lead: { lat: LEAD_LAT, lng: LEAD_LNG, claimedBy: 'uid-setter', dispositionHistory: existing },
    });
    const before = logs.length;
    await capped.run(knockBody());
    const cappedHistory = patch(capped.db).dispositionHistory as Array<{ userId: string; disposition: string }>;
    assert.equal(cappedHistory.length, HISTORY_CAP);
    assert.equal(cappedHistory.some((entry) => entry.userId === 'uid-setter' && entry.disposition === 'Go Back'), true);
    assert.equal(cappedHistory.includes(existing[HISTORY_CAP - 1] as never), false);
    assert.match(logs.slice(before).join('\n'), /\[field\/dispo\] history_capped \d+/);
  });

  it('keeps an older tap in history and leaves status alone', async () => {
    const older = harness({
      lead: {
        lat: LEAD_LAT,
        lng: LEAD_LNG,
        claimedBy: 'uid-setter',
        status: 'not-home',
        disposition: 'Not Home',
        dispositionedAt: new FakeTimestamp(NOW + 60_000),
      },
    });
    const olderResult = await older.run(knockBody());
    assert.equal(olderResult.status, 200);
    assert.equal(olderResult.body.result, 'stale_history_only');
    assert.equal(olderResult.body.reasonCode, 'stale_tap');
    assert.equal(olderResult.body.serverDispositionedAt, new Date(NOW + 60_000).toISOString());
    assert.deepEqual(Object.keys(patch(older.db)), ['dispositionHistory']);
    assert.equal(creates(older.db).length, 1);
    assert.equal(older.db.docs.get('leads/lead-1')?.status, 'not-home');

    const equal = harness({
      lead: {
        lat: LEAD_LAT,
        lng: LEAD_LNG,
        claimedBy: 'uid-setter',
        status: 'not-home',
        dispositionedAt: new FakeTimestamp(NOW),
      },
    });
    const equalResult = await equal.run(knockBody());
    assert.equal(equalResult.body.result, 'stale_history_only');
    assert.deepEqual(Object.keys(patch(equal.db)), ['dispositionHistory']);

    const newer = harness({
      lead: {
        lat: LEAD_LAT,
        lng: LEAD_LNG,
        claimedBy: 'uid-setter',
        dispositionedAt: new FakeTimestamp(NOW - 60_000),
      },
    });
    const newerResult = await newer.run(knockBody());
    assert.equal(newerResult.body.result, 'applied');
    assert.equal(patch(newer.db).status, 'go-back');

    const asString = harness({
      lead: {
        lat: LEAD_LAT,
        lng: LEAD_LNG,
        claimedBy: 'uid-setter',
        status: 'not-home',
        dispositionedAt: '2026-10-25T18:00:00.000Z',
      },
    });
    const stringResult = await asString.run(knockBody());
    assert.equal(stringResult.body.result, 'stale_history_only');
    assert.equal(stringResult.body.serverDispositionedAt, '2026-10-25T18:00:00.000Z');
    assert.equal(asString.db.docs.get('leads/lead-1')?.status, 'not-home');

    const unparseable = harness({
      lead: { lat: LEAD_LAT, lng: LEAD_LNG, claimedBy: 'uid-setter', dispositionedAt: 'not-a-time', status: 'old' },
    });
    const unparseableResult = await unparseable.run(knockBody());
    assert.equal(unparseableResult.body.result, 'applied');
    assert.equal(patch(unparseable.db).status, 'go-back');
  });

  it('saves notes only when the base still matches', async () => {
    const applied = harness({ user: approvedUser({ role: 'closer' }), lead: { claimedBy: 'uid-setter', notes: 'old' } });
    const appliedResult = await applied.run({
      draftId: 'notes-1',
      leadId: 'lead-1',
      kind: 'notes',
      actionAt: ACTION,
      notes: 'new',
      baseNotes: 'old',
    });
    assert.equal(appliedResult.status, 200);
    assert.equal(appliedResult.body.result, 'applied');
    assert.equal(applied.db.docs.get('leads/lead-1')?.notes, 'new');

    const same = harness({ user: approvedUser({ role: 'closer' }), lead: { claimedBy: 'uid-setter', notes: 'hello' } });
    const sameResult = await same.run({
      draftId: 'notes-2',
      leadId: 'lead-1',
      kind: 'notes',
      actionAt: ACTION,
      notes: 'hello',
      baseNotes: 'old',
    });
    assert.equal(sameResult.status, 200);
    assert.equal(sameResult.body.result, 'applied');
    assert.equal(updates(same.db).length, 0);
    assert.equal(creates(same.db).length, 1);

    const conflict = harness({ user: approvedUser({ role: 'closer' }), lead: { claimedBy: 'uid-setter', notes: 'server copy' } });
    const conflictResult = await conflict.run({
      draftId: 'notes-3',
      leadId: 'lead-1',
      kind: 'notes',
      actionAt: ACTION,
      notes: 'mine',
      baseNotes: 'old',
    });
    assert.equal(conflictResult.status, 409);
    assert.equal(conflictResult.body.reasonCode, 'notes_conflict');
    assert.equal(conflictResult.body.currentNotes, 'server copy');
    assert.deepEqual(conflictResult.body.serverUpdatedFields, ['notes']);
    assert.equal(updates(conflict.db).length, 0);
    assert.equal(creates(conflict.db).length, 0);
    assert.equal(conflict.db.docs.get('leads/lead-1')?.notes, 'server copy');

    const retry = await conflict.run({
      draftId: 'notes-3',
      leadId: 'lead-1',
      kind: 'notes',
      actionAt: ACTION,
      notes: 'mine',
      baseNotes: 'server copy',
    });
    assert.equal(retry.status, 200);
    assert.equal(retry.body.duplicate, false);
    assert.equal(conflict.db.docs.get('leads/lead-1')?.notes, 'mine');
    assert.equal(creates(conflict.db).length, 1);
  });

  it('replays a stored receipt without writing again', async () => {
    const test = harness();
    const first = await test.run(knockBody({ disposition: 'First' }));
    assert.equal(first.status, 200);
    assert.equal(first.body.duplicate, false);
    const updateCount = updates(test.db).length;
    const createCount = creates(test.db).length;
    assert.equal(updateCount, 1);
    assert.equal(createCount, 1);
    const writeTx = test.db.ops.filter((op) => op.op === 'update' || op.op === 'create').map((op) => op.tx);
    assert.deepEqual(writeTx, [1, 1]);
    const stored = test.db.docs.get('fieldDispoReceipts/uid-setter_draft-1');
    assert.equal(stored?.uid, 'uid-setter');
    assert.equal(stored?.draftId, 'draft-1');
    assert.equal(stored?.leadId, 'lead-1');
    assert.equal(stored?.kind, 'knock');
    assert.equal(stored?.result, 'applied');
    assert.equal(stored?.createdAt, SERVER_TS);
    assert.equal((stored?.response as { duplicate?: boolean }).duplicate, false);

    const second = await test.run(knockBody({ disposition: 'Second', status: 'not-home' }));
    assert.equal(second.status, 200);
    assert.equal(second.body.duplicate, true);
    assert.equal(second.body.result, 'applied');
    assert.equal(updates(test.db).length, updateCount);
    assert.equal(creates(test.db).length, createCount);
    assert.equal(test.db.docs.get('leads/lead-1')?.disposition, 'First');

    test.db.docs.delete('leads/lead-1');
    const afterDelete = await test.run(knockBody());
    assert.equal(afterDelete.status, 200);
    assert.equal(afterDelete.body.duplicate, true);

    const denied = harness({ lead: { lat: 1, lng: 1, claimedBy: 'other-rep' } });
    const deniedResult = await denied.run(knockBody());
    assert.equal(deniedResult.status, 403);
    assert.equal(creates(denied.db).length, 0);
    const deniedAgain = await denied.run(knockBody());
    assert.equal(deniedAgain.status, 403);
    assert.equal(creates(denied.db).length, 0);
  });

  it('holds or flags GPS from the single policy constant', async () => {
    const at = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();
    const inside = pointDueNorth(LEAD_LAT, LEAD_LNG, 50);
    const outside = pointDueNorth(LEAD_LAT, LEAD_LNG, 50.1);
    while (inside.distanceM > 50) {
      const nudged = pointDueNorth(LEAD_LAT, LEAD_LNG, inside.distanceM - 0.01);
      inside.lat = nudged.lat;
      inside.distanceM = nudged.distanceM;
    }
    while (outside.distanceM <= 50.1) {
      const nudged = pointDueNorth(LEAD_LAT, LEAD_LNG, outside.distanceM + 0.01);
      outside.lat = nudged.lat;
      outside.distanceM = nudged.distanceM;
    }
    assert.ok(inside.distanceM <= 50);
    assert.ok(outside.distanceM > 50.1);

    const holdCases: Array<{ name: string; user?: Record<string, unknown>; lead?: Record<string, unknown>; body: Record<string, unknown>; status: number; reason?: string }> = [
      { name: 'missing', body: knockBody({ gps: undefined }), status: 403, reason: 'gps_unverified_held' },
      { name: '6s before', body: knockBody({ gps: { lat: LEAD_LAT, lng: LEAD_LNG, accuracyM: 5, capturedAt: at(-6000) } }), status: 403, reason: 'gps_unverified_held' },
      { name: '16s after', body: knockBody({ gps: { lat: LEAD_LAT, lng: LEAD_LNG, accuracyM: 5, capturedAt: at(16000) } }), status: 403, reason: 'gps_unverified_held' },
      { name: '5s before', body: knockBody({ gps: { lat: LEAD_LAT, lng: LEAD_LNG, accuracyM: 5, capturedAt: at(-5000) } }), status: 200 },
      { name: '15s after', body: knockBody({ gps: { lat: LEAD_LAT, lng: LEAD_LNG, accuracyM: 5, capturedAt: at(15000) } }), status: 200 },
      { name: '50.0', body: knockBody({ gps: { lat: inside.lat, lng: inside.lng, accuracyM: 5, capturedAt: at(1000) } }), status: 200 },
      { name: '50.1', body: knockBody({ gps: { lat: outside.lat, lng: outside.lng, accuracyM: 5, capturedAt: at(1000) } }), status: 403, reason: 'outside_50m' },
      {
        name: 'closer',
        user: approvedUser({ role: 'closer' }),
        lead: { claimedBy: 'uid-setter' },
        body: knockBody({ gps: undefined }),
        status: 200,
      },
      {
        name: 'opt out',
        user: approvedUser({ features: { proximityEnforcement: false } }),
        body: knockBody({ gps: undefined }),
        status: 200,
      },
    ];
    for (const item of holdCases) {
      const test = harness({ user: item.user, lead: item.lead, gpsPolicy: 'hold' });
      const result = await test.run(item.body);
      assert.equal(result.status, item.status, `${item.name} ${JSON.stringify(result.body)}`);
      if (item.reason) {
        assert.equal(result.body.reasonCode, item.reason, item.name);
        assert.equal(creates(test.db).length, 0, item.name);
      }
    }

    const flagCases: Array<{ name: string; body: Record<string, unknown>; reason: string }> = [
      { name: 'missing', body: knockBody({ gps: undefined }), reason: 'gps_unverified_flagged' },
      { name: '6s before', body: knockBody({ gps: { lat: LEAD_LAT, lng: LEAD_LNG, accuracyM: 5, capturedAt: at(-6000) } }), reason: 'gps_unverified_flagged' },
      { name: '16s after', body: knockBody({ gps: { lat: LEAD_LAT, lng: LEAD_LNG, accuracyM: 5, capturedAt: at(16000) } }), reason: 'gps_unverified_flagged' },
      { name: '50.1', body: knockBody({ gps: { lat: outside.lat, lng: outside.lng, accuracyM: 5, capturedAt: at(1000) } }), reason: 'outside_50m' },
    ];
    for (const item of flagCases) {
      const test = harness({ gpsPolicy: 'flag' });
      const result = await test.run(item.body);
      assert.equal(result.status, 200, `${item.name} ${JSON.stringify(result.body)}`);
      const gps = result.body.gps as { reasonCode: string; outcome: string; distanceM: number | null };
      assert.equal(gps.outcome, 'flagged_accepted', item.name);
      assert.equal(gps.reasonCode, item.reason, item.name);
      assert.equal(creates(test.db).length, 1, item.name);
      assert.equal(test.db.docs.get('leads/lead-1')?.status, 'go-back', item.name);
    }

    const flaggedFar = harness({ gpsPolicy: 'flag' });
    await flaggedFar.run(knockBody({ gps: { lat: outside.lat, lng: outside.lng, accuracyM: 9, capturedAt: at(1000) } }));
    assert.equal(patch(flaggedFar.db).knockGpsLat, outside.lat);
    assert.equal(typeof patch(flaggedFar.db).knockDistanceFromAddress, 'number');

    const flaggedEarly = harness({ gpsPolicy: 'flag' });
    await flaggedEarly.run(knockBody({ gps: { lat: LEAD_LAT, lng: LEAD_LNG, accuracyM: 5, capturedAt: at(-6000) } }));
    assert.equal(Object.hasOwn(patch(flaggedEarly.db), 'knockGpsLat'), false);

    const closerFlag = harness({
      gpsPolicy: 'flag',
      user: approvedUser({ role: 'closer' }),
      lead: { claimedBy: 'uid-setter' },
    });
    const closerResult = await closerFlag.run(knockBody({ gps: undefined }));
    assert.equal(closerResult.status, 200);
    assert.equal((closerResult.body.gps as { outcome: null }).outcome, null);
  });

  it('rate limits the 61st request in a 60 second window', async () => {
    let now = NOW;
    const test = harness({ now: () => now });
    for (let i = 0; i < 60; i += 1) {
      const result = await test.run(knockBody({ draftId: `draft-${i}` }));
      assert.equal(result.status, 200, String(i));
    }
    const limited = await test.run(knockBody({ draftId: 'draft-60' }));
    assert.equal(limited.status, 429);
    assert.equal(limited.body.error, 'rate_limited');
    assert.equal(limited.body.retryAfterSeconds, 60);
    assert.equal(limited.headers?.['Retry-After'], '60');
    assert.equal(test.db.docs.has('fieldDispoReceipts/uid-setter_draft-60'), false);

    now = NOW + 60_000;
    const later = new Date(NOW + 1000).toISOString();
    const next = await test.run(knockBody({
      draftId: 'draft-61',
      actionAt: later,
      gps: { lat: LEAD_LAT, lng: LEAD_LNG, accuracyM: 5, capturedAt: later },
    }));
    assert.equal(next.status, 200);
    assert.equal(next.body.result, 'applied');
  });

  it('never reports a missing lead as 404', async () => {
    const missing = harness({ lead: null });
    const result = await missing.run(knockBody());
    assert.equal(result.status, 410);
    assert.deepEqual(result.body, { ok: false, error: 'not_found', reasonCode: 'not_found' });
    assert.equal(creates(missing.db).length, 0);

    const statuses = [
      (await harness({ authorization: null }).run(knockBody())).status,
      (await harness({ exists: false }).run(knockBody())).status,
      (await harness().run(knockBody({ kind: 'handoff' }))).status,
      result.status,
    ];
    assert.equal(statuses.includes(404), false);
  });

  it('touches only the bounded documents and never set, merge, or delete', async () => {
    const admin = harness({
      user: approvedUser({ role: 'admin' }),
      lead: { claimedBy: 'other-rep' },
    });
    await admin.run(knockBody({ gps: undefined }));
    assert.deepEqual(collections(admin.db), ['fieldDispoReceipts', 'leads', 'users']);
    assert.equal(admin.db.ops.some((op) => op.op === 'query'), false);

    const owned = harness();
    await owned.run(knockBody());
    assert.equal(owned.db.ops.some((op) => op.op === 'query'), false);
    assert.deepEqual(collections(owned.db), ['fieldDispoReceipts', 'leads', 'users']);

    const unowned = harness({
      lead: { lat: LEAD_LAT, lng: LEAD_LNG },
      territories: [{ id: 'terr-mine', data: { userId: 'uid-setter', polygon: square(LEAD_LAT, LEAD_LNG) } }],
    });
    await unowned.run(knockBody());
    const query = unowned.db.ops.find((op) => op.op === 'query');
    assert.ok(query && query.op === 'query');
    assert.equal(query.collectionName, 'territories');
    assert.deepEqual(query.filters, [{ field: 'userId', op: '==', value: 'uid-setter' }]);
    assert.equal(query.limitCount, TERRITORY_QUERY_LIMIT);
    assert.deepEqual(collections(unowned.db), ['fieldDispoReceipts', 'leads', 'territories', 'users']);

    for (const db of [admin.db, owned.db, unowned.db]) {
      for (const op of db.ops) {
        assert.equal(op.op === 'update' || op.op === 'create' || op.op === 'get' || op.op === 'query' || op.op === 'collection', true);
        if (op.op === 'update') assert.match(op.path, /^leads\//);
        if (op.op === 'create') assert.match(op.path, /^fieldDispoReceipts\//);
        if (op.op === 'get') assert.match(op.path, /^(users|leads|fieldDispoReceipts)\//);
      }
    }

    const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
    assert.equal(rules.includes('fieldDispoReceipts'), false);
    const route = readFileSync(new URL('../app/api/field/dispo/route.ts', import.meta.url), 'utf8');
    assert.equal(/export async function GET/.test(route), false);
    assert.match(route, /export const runtime = 'nodejs'/);
    assert.match(route, /export const dynamic = 'force-dynamic'/);
    assert.equal(route.includes('process.env'), false);
    assert.equal(route.includes('FIELD_DISPO_GPS_POLICY'), false);
  });

  it('logs status codes without notes, names, or GPS', async () => {
    const secret = 'SECRET-NOTE-VALUE';
    const name = 'SECRET-NAME';
    const test = harness({ user: approvedUser({ role: 'closer', name }), lead: { claimedBy: 'uid-setter', notes: 'other' } });
    const before = logs.length;
    await test.run({
      draftId: 'notes-secret',
      leadId: 'lead-1',
      kind: 'notes',
      actionAt: ACTION,
      notes: secret,
      baseNotes: 'old',
    });
    const lines = logs.slice(before);
    assert.ok(lines.length > 0);
    for (const line of lines) {
      assert.equal(line.includes(secret), false);
      assert.equal(line.includes(name), false);
      assert.equal(line.includes(String(LEAD_LAT)), false);
      assert.match(line, /^\[field\/dispo\] /);
    }
  });
});
