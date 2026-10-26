import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { distanceBetween } from 'geofire-common';
import {
  ALLOWED_PATCH_KEYS,
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
          for (const [key, value] of Object.entries(patch)) {
            if (isCleared(value)) delete current[key];
            else current[key] = value;
          }
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
  homeowners?: Array<{ id: string; data: Record<string, unknown> }>;
  now?: () => number;
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
  for (const homeowner of options.homeowners ?? []) db.put(`homeowners/${homeowner.id}`, homeowner.data);
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
    Timestamp: FakeTimestamp,
    serverTimestamp: () => SERVER_TS,
    deleteField: () => ({ marker: 'delete-field' }),
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

function isCleared(value: unknown): boolean {
  return Boolean(value) && typeof value === 'object' && (value as { marker?: string }).marker === 'delete-field';
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
  it('keeps the shared reason codes and does not hold GPS', () => {
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
    const source = readFileSync(new URL('../app/utils/server/fieldDispo.ts', import.meta.url), 'utf8');
    assert.equal(source.includes('FIELD_DISPO_GPS_POLICY'), false);
    assert.equal(source.includes('gps_unverified_held'), false);
    assert.equal(source.includes('outside_50m'), false);
    assert.equal(source.includes('firebase-admin'), false);
    assert.match(source, /@test\.com/);
    assert.match(source, /user-test-/);
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
      { name: 'isTest', user: approvedUser({ isTest: true }) },
      { name: 'testAccount', user: approvedUser({ testAccount: true }) },
      { name: 'accountType', user: approvedUser({ accountType: 'Test' }) },
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
      { name: 'notes type', body: { draftId: 'draft-1', leadId: 'lead-1', kind: 'notes', actionAt: ACTION, notes: 12, baseNotes: '' }, field: 'notes' },
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
        queries: false,
      },
      {
        name: 'assigned to other and not my territory',
        lead: { lat: 10, lng: 10, assignedTo: 'other-rep' },
        territories: [mine],
        status: 403,
        reason: 'owned_by_other',
        queries: false,
      },
      {
        name: 'manual lead I created stays mine',
        lead: { lat: 10, lng: 10, claimedBy: 'other-rep', setterId: uid, source: 'manually-added' },
        territories: [mine],
        body: knockBody({ gps: { lat: 10, lng: 10, accuracyM: 3, capturedAt: new Date(NOW + 1000).toISOString() } }),
        status: 200,
        result: 'applied',
        queries: true,
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
      if (typeof item.lead.territoryId === 'string') {
        assert.equal(
          test.db.ops.some((op) => op.op === 'get' && op.path === `territories/${item.lead.territoryId}`),
          true,
          item.name,
        );
      }
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
    assert.deepEqual(Object.keys(history[1] as object).sort(), ['disposition', 'gpsFlag', 'timestamp', 'userId', 'userName']);
    assert.equal((history[1] as { gpsFlag: { gpsVerified: boolean } }).gpsFlag.gpsVerified, true);

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
    const olderHistory = patch(older.db).dispositionHistory as Array<{ gpsFlag?: { gpsVerified: boolean } }>;
    assert.equal(olderHistory[0].gpsFlag?.gpsVerified, true);
    assert.equal(Object.hasOwn(patch(older.db), 'gpsVerified'), false);
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

  it('saves a 20k-char note on a non-owned lead and a note whose body is over 32 KB', async () => {
    const territory = { id: 'terr-mine', data: { userId: 'uid-setter' } };
    const lead = { claimedBy: 'other-rep', assignedTo: 'other-rep', territoryId: 'terr-mine', notes: '' };
    const save = async (notes: string) => {
      const test = harness({ lead: { ...lead }, territories: [territory] });
      const rawBody = JSON.stringify({
        draftId: 'notes-long',
        leadId: 'lead-1',
        kind: 'notes',
        actionAt: ACTION,
        notes,
        baseNotes: '',
      });
      const result = await test.run(undefined, undefined, { rawBody });
      return { test, result, rawBody };
    };

    const twenty = await save('n'.repeat(20_000));
    assert.equal(twenty.result.status, 200, JSON.stringify(twenty.result.body));
    assert.equal(twenty.result.body.result, 'applied');
    assert.equal(twenty.test.db.docs.get('leads/lead-1')?.notes, 'n'.repeat(20_000));
    assert.equal(twenty.test.db.docs.get('leads/lead-1')?.claimedBy, 'other-rep');

    const wide = 'n'.repeat(40_000);
    const over = await save(wide);
    assert.ok(Buffer.byteLength(over.rawBody, 'utf8') > FIELD_DISPO_MAX_BYTES);
    assert.equal(over.result.status, 200, JSON.stringify(over.result.body));
    assert.equal(over.test.db.docs.get('leads/lead-1')?.notes, wide);
    assert.equal(over.test.db.docs.get('leads/lead-1')?.claimedBy, 'other-rep');
  });

  it('returns 413 payload_too_large when notes or baseNotes exceed 100000 characters', async () => {
    const lead = { claimedBy: 'uid-setter', notes: 'keep' };
    const post = (notes: string, baseNotes = '') => {
      const test = harness({ lead: { ...lead } });
      const rawBody = JSON.stringify({
        draftId: 'notes-cap',
        leadId: 'lead-1',
        kind: 'notes',
        actionAt: ACTION,
        notes,
        baseNotes,
      });
      return test.run(undefined, undefined, { rawBody }).then((result) => ({ test, result }));
    };

    const notes = await post('n'.repeat(100_001));
    assert.equal(notes.result.status, 413, JSON.stringify(notes.result.body));
    assert.deepEqual(notes.result.body, { ok: false, error: 'payload_too_large' });
    assert.equal(notes.test.db.txCount, 0);
    assert.equal(notes.test.db.docs.get('leads/lead-1')?.notes, 'keep');

    const base = await post('ok', 'b'.repeat(100_001));
    assert.equal(base.result.status, 413, JSON.stringify(base.result.body));
    assert.deepEqual(base.result.body, { ok: false, error: 'payload_too_large' });
    assert.equal(base.test.db.docs.get('leads/lead-1')?.notes, 'keep');
  });

  it('still rejects a knock body over 32 KB', async () => {
    const test = harness({ lead: { claimedBy: 'uid-setter', status: 'old' } });
    const rawBody = JSON.stringify({ ...knockBody(), pad: 'x'.repeat(40 * 1024) });
    assert.ok(Buffer.byteLength(rawBody, 'utf8') > FIELD_DISPO_MAX_BYTES);
    const result = await test.run(undefined, undefined, { rawBody });
    assert.equal(result.status, 413, JSON.stringify(result.body));
    assert.deepEqual(result.body, { ok: false, error: 'too_large' });
    assert.equal(test.db.txCount, 0);
    assert.equal(test.db.docs.get('leads/lead-1')?.status, 'old');
  });

  it('keeps both note versions when the client resubmits after a conflict', async () => {
    const serverNotes = 'S'.repeat(20_000);
    const localNotes = 'L'.repeat(20_000);
    const kept = `${serverNotes}\n${localNotes}`;
    const test = harness({
      lead: { claimedBy: 'other-rep', territoryId: 'terr-mine', notes: serverNotes },
      territories: [{ id: 'terr-mine', data: { userId: 'uid-setter' } }],
    });
    const send = (draftId: string, notes: string, baseNotes: string) => test.run(undefined, undefined, {
      rawBody: JSON.stringify({
        draftId,
        leadId: 'lead-1',
        kind: 'notes',
        actionAt: ACTION,
        notes,
        baseNotes,
      }),
    });

    const conflict = await send('notes-both', localNotes, 'stale');
    assert.equal(conflict.status, 409, JSON.stringify(conflict.body));
    assert.equal(conflict.body.reasonCode, 'notes_conflict');
    assert.equal(conflict.body.currentNotes, serverNotes);
    assert.equal(test.db.docs.get('leads/lead-1')?.notes, serverNotes);
    assert.equal(creates(test.db).length, 0);

    const merged = await send('notes-both', kept, serverNotes);
    assert.ok(Buffer.byteLength(JSON.stringify({ notes: kept }), 'utf8') > FIELD_DISPO_MAX_BYTES);
    assert.equal(merged.status, 200, JSON.stringify(merged.body));
    assert.equal(merged.body.result, 'applied');
    assert.equal(test.db.docs.get('leads/lead-1')?.notes, kept);
    assert.equal(test.db.docs.get('leads/lead-1')?.claimedBy, 'other-rep');
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

  it('flags every GPS problem and still saves the knock', async () => {
    const at = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();
    const close = pointDueNorth(LEAD_LAT, LEAD_LNG, 10);
    const far = pointDueNorth(LEAD_LAT, LEAD_LNG, 200);
    const insideRadius = pointDueNorth(LEAD_LAT, LEAD_LNG, 40);

    const flagged: Array<{ name: string; body: Record<string, unknown>; reason: string; keepFix: boolean }> = [
      { name: 'missing', body: knockBody({ gps: undefined }), reason: 'no_fix', keepFix: false },
      { name: 'null gps', body: knockBody({ gps: null }), reason: 'no_fix', keepFix: false },
      { name: '31s before', body: knockBody({ gps: { lat: LEAD_LAT, lng: LEAD_LNG, accuracyM: 5, capturedAt: at(-30001) } }), reason: 'stale', keepFix: true },
      { name: '16s after', body: knockBody({ gps: { lat: LEAD_LAT, lng: LEAD_LNG, accuracyM: 5, capturedAt: at(16000) } }), reason: 'stale', keepFix: true },
      { name: 'low accuracy', body: knockBody({ gps: { lat: LEAD_LAT, lng: LEAD_LNG, accuracyM: 65.1, capturedAt: at(1000) } }), reason: 'low_accuracy', keepFix: true },
      { name: 'accuracy 999', body: knockBody({ gps: { lat: LEAD_LAT, lng: LEAD_LNG, accuracyM: 999, capturedAt: at(1000) } }), reason: 'low_accuracy', keepFix: true },
      { name: 'reduced accuracy', body: knockBody({ gps: { lat: LEAD_LAT, lng: LEAD_LNG, accuracyM: 1000, capturedAt: at(1000) } }), reason: 'reduced_accuracy', keepFix: true },
      { name: 'too far', body: knockBody({ gps: { lat: far.lat, lng: far.lng, accuracyM: 5, capturedAt: at(1000) } }), reason: 'too_far', keepFix: true },
      { name: 'negative accuracy', body: knockBody({ gps: { lat: LEAD_LAT, lng: LEAD_LNG, accuracyM: -1, capturedAt: at(1000) } }), reason: 'no_fix', keepFix: false },
      { name: 'NaN accuracy', body: knockBody({ gps: { lat: LEAD_LAT, lng: LEAD_LNG, accuracyM: Number.NaN, capturedAt: at(1000) } }), reason: 'no_fix', keepFix: false },
      { name: 'NaN latitude', body: knockBody({ gps: { lat: Number.NaN, lng: LEAD_LNG, accuracyM: 5, capturedAt: at(1000) } }), reason: 'no_fix', keepFix: false },
      { name: 'string gps', body: knockBody({ gps: 'nope' }), reason: 'no_fix', keepFix: false },
      { name: 'unknown gps key', body: knockBody({ gps: { lat: LEAD_LAT, lng: LEAD_LNG, accuracyM: 5, capturedAt: at(1000), extra: true } }), reason: 'no_fix', keepFix: false },
      { name: 'bad latitude', body: knockBody({ gps: { lat: 91, lng: LEAD_LNG, accuracyM: 5, capturedAt: at(1000) } }), reason: 'no_fix', keepFix: false },
      { name: 'bad capturedAt', body: knockBody({ gps: { lat: LEAD_LAT, lng: LEAD_LNG, accuracyM: 5, capturedAt: 'yesterday' } }), reason: 'no_fix', keepFix: false },
    ];
    for (const item of flagged) {
      const test = harness();
      const result = await test.run(item.body);
      assert.equal(result.status, 200, `${item.name} ${JSON.stringify(result.body)}`);
      assert.equal(result.body.result, 'applied', item.name);
      const gps = result.body.gps as { reasonCode: string; outcome: string; gpsVerified: boolean; gpsUnverifiedReason: string };
      assert.equal(gps.outcome, 'flagged_accepted', item.name);
      assert.equal(gps.reasonCode, 'gps_unverified_flagged', item.name);
      assert.equal(gps.gpsVerified, false, item.name);
      assert.equal(gps.gpsUnverifiedReason, item.reason, item.name);
      assert.equal(creates(test.db).length, 1, item.name);
      const written = patch(test.db);
      assert.equal(written.gpsVerified, false, item.name);
      assert.equal(written.gpsUnverifiedReason, item.reason, item.name);
      assert.equal(written.status, 'go-back', item.name);
      if (item.keepFix) assert.equal(typeof written.knockGpsLat, 'number', item.name);
      else {
        assert.equal(isCleared(written.knockGpsLat), true, item.name);
        assert.equal(isCleared(written.gpsDistanceM), true, item.name);
        assert.equal(isCleared(written.knockGpsLng), true, item.name);
        assert.equal(isCleared(written.knockGpsAccuracy), true, item.name);
        assert.equal(isCleared(written.knockGpsTimestamp), true, item.name);
        assert.equal(isCleared(written.knockDistanceFromAddress), true, item.name);
      }
      assert.equal(Object.hasOwn(written, 'homeownerId'), false, item.name);
      const flag = (written.dispositionHistory as Array<{ gpsFlag: { gpsUnverifiedReason: string } }>)[0].gpsFlag;
      assert.equal(flag.gpsUnverifiedReason, item.reason, item.name);
    }

    const verifiedCases = [
      { name: 'on the pin', body: knockBody() },
      { name: '5s before', body: knockBody({ gps: { lat: LEAD_LAT, lng: LEAD_LNG, accuracyM: 5, capturedAt: at(-5000) } }) },
      { name: '6s before', body: knockBody({ gps: { lat: LEAD_LAT, lng: LEAD_LNG, accuracyM: 5, capturedAt: at(-6000) } }) },
      { name: '30s before', body: knockBody({ gps: { lat: LEAD_LAT, lng: LEAD_LNG, accuracyM: 5, capturedAt: at(-30000) } }) },
      { name: '15s after', body: knockBody({ gps: { lat: LEAD_LAT, lng: LEAD_LNG, accuracyM: 5, capturedAt: at(15000) } }) },
      { name: '10m', body: knockBody({ gps: { lat: close.lat, lng: close.lng, accuracyM: 8, capturedAt: at(1000) } }) },
      { name: 'accuracy 15 at 40m', body: knockBody({ gps: { lat: insideRadius.lat, lng: insideRadius.lng, accuracyM: 15, capturedAt: at(1000) } }) },
      { name: 'accuracy 65 on the pin', body: knockBody({ gps: { lat: LEAD_LAT, lng: LEAD_LNG, accuracyM: 65, capturedAt: at(1000) } }) },
    ];
    for (const item of verifiedCases) {
      const test = harness();
      const result = await test.run(item.body);
      assert.equal(result.status, 200, `${item.name} ${JSON.stringify(result.body)}`);
      const gps = result.body.gps as { reasonCode: null; outcome: null; gpsVerified: boolean; gpsDistanceM: number };
      assert.equal(gps.gpsVerified, true, item.name);
      assert.equal(gps.outcome, null, item.name);
      assert.equal(gps.reasonCode, null, item.name);
      assert.equal(Object.hasOwn(gps, 'gpsUnverifiedReason'), false, item.name);
      assert.equal(typeof gps.gpsDistanceM, 'number', item.name);
      assert.equal(patch(test.db).gpsVerified, true, item.name);
      assert.equal(isCleared(patch(test.db).gpsUnverifiedReason), true, item.name);
      assert.equal(Object.hasOwn(test.db.docs.get('leads/lead-1') ?? {}, 'gpsUnverifiedReason'), false, item.name);
    }

    const past = harness();
    const pastResult = await past.run(knockBody({
      gps: { lat: far.lat, lng: far.lng, accuracyM: 40, capturedAt: at(1000) },
    }));
    assert.equal((pastResult.body.gps as { gpsUnverifiedReason: string }).gpsUnverifiedReason, 'too_far');

    const clientWins = harness();
    const clientResult = await clientWins.run(knockBody({
      gps: { lat: far.lat, lng: far.lng, accuracyM: 5, capturedAt: at(1000) },
      gpsVerified: true,
      gpsUnverifiedReason: 'no_fix',
      gpsDistanceM: 1,
    }));
    assert.equal(clientResult.status, 200);
    const clientGps = clientResult.body.gps as { gpsVerified: boolean; gpsUnverifiedReason: string; gpsDistanceM: number };
    assert.equal(clientGps.gpsVerified, false);
    assert.equal(clientGps.gpsUnverifiedReason, 'too_far');
    assert.ok(clientGps.gpsDistanceM > 100);
    assert.equal(patch(clientWins.db).gpsDistanceM, clientGps.gpsDistanceM);
    assert.equal(patch(clientWins.db).gpsVerified, false);

    const banned = harness();
    const bannedResult = await banned.run(knockBody({ gpsClientVerified: true }));
    assert.equal(bannedResult.status, 400);
    assert.equal(bannedResult.body.field, 'gpsClientVerified');
    assert.equal(banned.db.txCount, 0);

    const ignoredId = harness();
    await ignoredId.run(knockBody({ homeownerId: 'bad id' }));
    assert.equal(ignoredId.db.ops.some((op) => op.op === 'get' && op.path.startsWith('homeowners/')), false);
    assert.equal(patch(ignoredId.db).gpsVerified, true);

    const home = pointDueNorth(LEAD_LAT, LEAD_LNG, 70);
    const linked = harness({
      lead: { lat: LEAD_LAT, lng: LEAD_LNG, claimedBy: 'uid-setter', address: '123 Main St.', city: 'Phoenix' },
      homeowners: [{ id: 'home-1', data: { lat: home.lat, lng: home.lng, address: '999 Other Rd', city: 'Phoenix' } }],
    });
    const linkedResult = await linked.run(knockBody({
      homeownerId: 'home-1',
      gps: { lat: home.lat, lng: home.lng, accuracyM: 5, capturedAt: at(1000) },
    }));
    assert.equal((linkedResult.body.gps as { gpsVerified: boolean }).gpsVerified, true, JSON.stringify(linkedResult.body.gps));
    assert.equal(linked.db.ops.filter((op) => op.op === 'get' && op.path === 'homeowners/home-1').length, 1);
    assert.equal(Object.hasOwn(patch(linked.db), 'homeownerId'), false);

    const streetPoint = pointDueNorth(LEAD_LAT, LEAD_LNG, 1500);
    const sameStreet = harness({
      lead: { lat: LEAD_LAT, lng: LEAD_LNG, claimedBy: 'uid-setter', address: '123 Main St.', city: 'Phoenix' },
      homeowners: [{ id: 'home-street', data: { lat: streetPoint.lat, lng: streetPoint.lng, street: '123 main st', municipality: 'phoenix' } }],
    });
    const streetResult = await sameStreet.run(knockBody({
      homeownerId: 'home-street',
      gps: { lat: streetPoint.lat, lng: streetPoint.lng, accuracyM: 5, capturedAt: at(1000) },
    }));
    assert.equal((streetResult.body.gps as { gpsVerified: boolean }).gpsVerified, true);

    const spelled = harness({
      lead: { lat: LEAD_LAT, lng: LEAD_LNG, claimedBy: 'uid-setter', address: '123 MAIN ST', city: 'Phoenix' },
      homeowners: [{ id: 'home-spelled', data: { lat: streetPoint.lat, lng: streetPoint.lng, street: '123 Main Street', municipality: 'Phoenix' } }],
    });
    const spelledResult = await spelled.run(knockBody({
      homeownerId: 'home-spelled',
      gps: { lat: streetPoint.lat, lng: streetPoint.lng, accuracyM: 5, capturedAt: at(1000) },
    }));
    assert.equal((spelledResult.body.gps as { gpsVerified: boolean }).gpsVerified, true, JSON.stringify(spelledResult.body.gps));

    const otherStreet = harness({
      lead: { lat: LEAD_LAT, lng: LEAD_LNG, claimedBy: 'uid-setter', address: '123 Main St.', city: 'Phoenix' },
      homeowners: [{ id: 'home-other', data: { lat: streetPoint.lat, lng: streetPoint.lng, address: '9 Side Ave', city: 'Phoenix' } }],
    });
    const otherStreetResult = await otherStreet.run(knockBody({
      homeownerId: 'home-other',
      gps: { lat: streetPoint.lat, lng: streetPoint.lng, accuracyM: 5, capturedAt: at(1000) },
    }));
    assert.equal((otherStreetResult.body.gps as { gpsUnverifiedReason: string }).gpsUnverifiedReason, 'too_far');

    const missingHome = harness();
    const missingHomeResult = await missingHome.run(knockBody({
      homeownerId: 'missing-home',
      gps: { lat: far.lat, lng: far.lng, accuracyM: 5, capturedAt: at(1000) },
    }));
    assert.equal((missingHomeResult.body.gps as { gpsUnverifiedReason: string }).gpsUnverifiedReason, 'too_far');
    assert.equal(missingHome.db.ops.some((op) => op.op === 'get' && op.path === 'homeowners/missing-home'), true);

    const noGpsHome = harness();
    await noGpsHome.run(knockBody({ gps: undefined, homeownerId: 'home-1' }));
    assert.equal(noGpsHome.db.ops.some((op) => op.op === 'get' && op.path.startsWith('homeowners/')), false);

    const closer = harness({ user: approvedUser({ role: 'closer' }), lead: { claimedBy: 'uid-setter' } });
    const closerResult = await closer.run(knockBody({ gps: undefined }));
    assert.equal(closerResult.status, 200);
    assert.equal((closerResult.body.gps as { gpsUnverifiedReason: string }).gpsUnverifiedReason, 'no_fix');

    const optedOut = harness({ user: approvedUser({ features: { proximityEnforcement: false } }) });
    const optedResult = await optedOut.run(knockBody({ gps: { lat: far.lat, lng: far.lng, accuracyM: 5, capturedAt: at(1000) } }));
    assert.equal(optedResult.status, 200);
    assert.equal((optedResult.body.gps as { gpsUnverifiedReason: string }).gpsUnverifiedReason, 'too_far');
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
    const ownedQuery = owned.db.ops.find((op) => op.op === 'query');
    assert.ok(ownedQuery && ownedQuery.op === 'query');
    assert.equal(ownedQuery.collectionName, 'territories');
    assert.equal(ownedQuery.limitCount, TERRITORY_QUERY_LIMIT);
    assert.equal(owned.db.ops.some((op) => op.op === 'get' && op.path.startsWith('territories/')), false);
    assert.deepEqual(collections(owned.db), ['fieldDispoReceipts', 'leads', 'territories', 'users']);

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
    assert.match(route, /FieldValue\.delete\(\)/);
  });

  it('flags area without blocking, and a truncated territory list stays unknown', async () => {
    const at = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();
    const beyond = pointDueNorth(LEAD_LAT + 0.02, LEAD_LNG, 80);
    const mine = { id: 'mine', data: { userId: 'uid-setter', polygon: square(LEAD_LAT, LEAD_LNG) } };

    const outside = harness({ territories: [mine] });
    const outsideResult = await outside.run(knockBody({
      gps: { lat: beyond.lat, lng: beyond.lng, accuracyM: 5, capturedAt: at(1000) },
    }));
    assert.equal(outsideResult.status, 200);
    assert.equal(outsideResult.body.result, 'applied');
    assert.equal((outsideResult.body.gps as { gpsUnverifiedReason: string }).gpsUnverifiedReason, 'out_of_area');

    const nearEdge = pointDueNorth(LEAD_LAT + 0.02, LEAD_LNG, 20);
    const near = harness({ territories: [mine] });
    const nearResult = await near.run(knockBody({
      gps: { lat: nearEdge.lat, lng: nearEdge.lng, accuracyM: 5, capturedAt: at(1000) },
    }));
    assert.equal((nearResult.body.gps as { gpsUnverifiedReason: string }).gpsUnverifiedReason, 'too_far');

    const second = square(beyond.lat, beyond.lng, 0.01);
    const covered = harness({
      territories: [mine, { id: 'other-poly', data: { userId: 'uid-setter', polygon: second } }],
    });
    const coveredResult = await covered.run(knockBody({
      gps: { lat: beyond.lat, lng: beyond.lng, accuracyM: 8, capturedAt: at(1000) },
    }));
    assert.equal((coveredResult.body.gps as { gpsUnverifiedReason: string }).gpsUnverifiedReason, 'too_far');

    const none = harness();
    const noneResult = await none.run(knockBody({
      gps: { lat: beyond.lat, lng: beyond.lng, accuracyM: 5, capturedAt: at(1000) },
    }));
    assert.equal((noneResult.body.gps as { gpsUnverifiedReason: string }).gpsUnverifiedReason, 'too_far');

    const archivedOnly = harness({
      territories: [{ id: 'old', data: { userId: 'uid-setter', archived: true, polygon: square(1, 1) } }],
    });
    const archivedResult = await archivedOnly.run(knockBody());
    assert.equal((archivedResult.body.gps as { gpsVerified: boolean }).gpsVerified, true);

    const closer = harness({
      user: approvedUser({ role: 'closer' }),
      lead: { lat: LEAD_LAT, lng: LEAD_LNG, claimedBy: 'uid-setter' },
      territories: [mine],
    });
    const closerResult = await closer.run(knockBody({
      gps: { lat: beyond.lat, lng: beyond.lng, accuracyM: 5, capturedAt: at(1000) },
    }));
    assert.equal((closerResult.body.gps as { gpsUnverifiedReason: string }).gpsUnverifiedReason, 'out_of_area');

    const admin = harness({
      user: approvedUser({ role: 'admin' }),
      lead: { lat: LEAD_LAT, lng: LEAD_LNG, claimedBy: 'someone' },
      territories: [mine],
    });
    const adminResult = await admin.run(knockBody({
      gps: { lat: beyond.lat, lng: beyond.lng, accuracyM: 5, capturedAt: at(1000) },
    }));
    assert.equal((adminResult.body.gps as { gpsUnverifiedReason: string }).gpsUnverifiedReason, 'too_far');
    assert.equal(admin.db.ops.some((op) => op.op === 'query'), false);

    const manager = harness({
      user: approvedUser({ role: 'manager' }),
      lead: { lat: LEAD_LAT, lng: LEAD_LNG, claimedBy: 'someone' },
      territories: [mine],
    });
    const managerResult = await manager.run(knockBody({
      gps: { lat: beyond.lat, lng: beyond.lng, accuracyM: 5, capturedAt: at(1000) },
    }));
    assert.equal((managerResult.body.gps as { gpsUnverifiedReason: string }).gpsUnverifiedReason, 'too_far');
    assert.equal(manager.db.ops.some((op) => op.op === 'query'), false);

    const blank = harness({ lead: { claimedBy: 'uid-setter' } });
    const blankResult = await blank.run(knockBody());
    assert.equal(blankResult.status, 200);
    assert.equal((blankResult.body.gps as { gpsUnverifiedReason: string }).gpsUnverifiedReason, 'other');
    assert.equal(typeof patch(blank.db).knockGpsLat, 'number');
    assert.equal(isCleared(patch(blank.db).gpsDistanceM), true);

    const territories = Array.from({ length: 200 }, (_, index) => ({
      id: `t-${String(index).padStart(3, '0')}`,
      data: { userId: 'uid-setter', polygon: square(1, 1) },
    }));
    territories.push({ id: 'terr-target', data: { userId: 'uid-setter', polygon: square(40, -70) } });
    const before = logs.length;
    const many = harness({
      lead: { lat: 40, lng: -70, territoryId: 'terr-target' },
      territories,
    });
    const manyResult = await many.run(knockBody({
      gps: { lat: 40, lng: -70, accuracyM: 5, capturedAt: at(1000) },
    }));
    assert.equal(manyResult.status, 200, JSON.stringify(manyResult.body));
    assert.equal((manyResult.body.gps as { gpsVerified: boolean }).gpsVerified, true);
    assert.equal(many.db.ops.some((op) => op.op === 'get' && op.path === 'territories/terr-target'), true);
    const query = many.db.ops.find((op) => op.op === 'query');
    assert.ok(query && query.op === 'query');
    assert.equal(query.limitCount, TERRITORY_QUERY_LIMIT);
    assert.ok(logs.slice(before).includes('[field/dispo] territories_truncated 1'));
  });

  it('clears contradictory gps fields on a newer knock and leaves them on a stale tap', async () => {
    const cleared = harness({
      lead: {
        lat: LEAD_LAT,
        lng: LEAD_LNG,
        claimedBy: 'uid-setter',
        gpsVerified: false,
        gpsUnverifiedReason: 'too_far',
        gpsDistanceM: 80,
        knockGpsLat: 1,
        knockGpsLng: 2,
        knockGpsAccuracy: 3,
        knockGpsTimestamp: 'old',
        knockDistanceFromAddress: 80,
      },
    });
    const clearedResult = await cleared.run(knockBody({ gps: undefined }));
    assert.equal(clearedResult.status, 200);
    const clearedDoc = cleared.db.docs.get('leads/lead-1') ?? {};
    assert.equal(clearedDoc.gpsVerified, false);
    assert.equal(clearedDoc.gpsUnverifiedReason, 'no_fix');
    for (const key of ['gpsDistanceM', 'knockGpsLat', 'knockGpsLng', 'knockGpsAccuracy', 'knockGpsTimestamp', 'knockDistanceFromAddress']) {
      assert.equal(Object.hasOwn(clearedDoc, key), false, key);
    }

    const verified = harness({
      lead: {
        lat: LEAD_LAT,
        lng: LEAD_LNG,
        claimedBy: 'uid-setter',
        gpsVerified: false,
        gpsUnverifiedReason: 'no_fix',
        gpsDistanceM: 12,
        knockGpsLat: 1,
        knockGpsLng: 2,
        knockGpsAccuracy: 9,
        knockGpsTimestamp: 'old',
        knockDistanceFromAddress: 12,
      },
    });
    await verified.run(knockBody());
    const verifiedDoc = verified.db.docs.get('leads/lead-1') ?? {};
    assert.equal(verifiedDoc.gpsVerified, true);
    assert.equal(Object.hasOwn(verifiedDoc, 'gpsUnverifiedReason'), false);
    assert.equal(typeof verifiedDoc.gpsDistanceM, 'number');
    assert.equal(typeof verifiedDoc.knockGpsLat, 'number');

    const older = harness({
      lead: {
        lat: LEAD_LAT,
        lng: LEAD_LNG,
        claimedBy: 'uid-setter',
        dispositionedAt: ACTION,
        gpsVerified: true,
        gpsUnverifiedReason: 'too_far',
        gpsDistanceM: 4,
        knockGpsLat: 9,
        status: 'old',
      },
    });
    const olderResult = await older.run(knockBody({ gps: undefined }));
    assert.equal(olderResult.body.result, 'stale_history_only');
    const olderDoc = older.db.docs.get('leads/lead-1') ?? {};
    assert.equal(olderDoc.gpsUnverifiedReason, 'too_far');
    assert.equal(olderDoc.gpsDistanceM, 4);
    assert.equal(olderDoc.knockGpsLat, 9);
    assert.equal(olderDoc.status, 'old');
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
