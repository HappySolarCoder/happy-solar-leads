import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Timestamp } from 'firebase-admin/firestore';
import { FIELD_REASON_CODES } from '../app/utils/server/fieldReasonCodes.ts';
import {
  SYNC_REPORT_LIMIT,
  SYNC_REPORT_MAX_BYTES,
  SYNC_REPORT_DEFAULT_WINDOW_MS,
  SYNC_REPORT_MAX_WINDOW_MS,
  handleFieldSyncReportGet,
  handleFieldSyncReportPost,
  type FieldSyncReportDeps,
  type SyncReportResult,
} from '../app/utils/server/fieldSyncReport.ts';

const NOW = Date.parse('2026-10-25T16:31:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const SERVER_TIMESTAMP = { __type: 'serverTimestamp' };

const CANONICAL_REASON_CODES = [
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
] as const;

const OUTCOMES = ['refused', 'flagged_accepted'] as const;

function approvedUser(overrides: Record<string, unknown> = {}) {
  return {
    role: 'setter',
    name: 'Riley Rep',
    email: 'rep@company.com',
    isActive: true,
    approved: true,
    approvalStatus: 'approved',
    status: 'active',
    deleted: false,
    deletionPending: false,
    ...overrides,
  };
}

function item(overrides: Record<string, unknown> = {}) {
  return {
    draftId: 'legacy-draft_42',
    leadId: '1760000000000-abc123xyz',
    intendedStatus: 'go-back',
    actionAt: '2026-10-25T16:31:00.000Z',
    reasonCode: 'permission_denied',
    outcome: 'refused',
    appBuild: '14.18 (158)',
    ...overrides,
  };
}

type QueryCall = { method: string; args: unknown[] };

function harness(overrides: {
  uid?: string;
  user?: Record<string, unknown>;
  exists?: boolean;
  authorization?: string | null;
  verifyError?: unknown;
  now?: () => number;
  createError?: { code?: unknown } | ((id: string) => unknown);
  listDocs?: Array<{ id: string; data: Record<string, unknown> }>;
  listError?: unknown;
  cursorMissing?: boolean;
} = {}) {
  const creates: Array<{ id: string; data: Record<string, unknown> }> = [];
  const methods: string[] = [];
  const collections: string[] = [];
  const queryCalls: QueryCall[] = [];
  const userReads: string[] = [];
  const rateLimitStore = new Map<string, number[]>();
  const revoked: boolean[] = [];

  function queryApi() {
    return {
      where(field: string, op: string, value: unknown) {
        queryCalls.push({ method: 'where', args: [field, op, value] });
        return queryApi();
      },
      orderBy(field: string, direction: 'asc' | 'desc') {
        queryCalls.push({ method: 'orderBy', args: [field, direction] });
        return queryApi();
      },
      limit(n: number) {
        queryCalls.push({ method: 'limit', args: [n] });
        return queryApi();
      },
      startAfter(snapshot: unknown) {
        queryCalls.push({ method: 'startAfter', args: [snapshot] });
        return queryApi();
      },
      async get() {
        methods.push('query.get');
        queryCalls.push({ method: 'get', args: [] });
        if (overrides.listError) throw overrides.listError;
        return {
          docs: (overrides.listDocs ?? []).map((doc) => ({
            id: doc.id,
            data: () => doc.data,
          })),
        };
      },
    };
  }

  const deps: FieldSyncReportDeps = {
    verifyIdToken: async (_token, checkRevoked) => {
      revoked.push(checkRevoked);
      if (overrides.verifyError) throw overrides.verifyError;
      return { uid: overrides.uid ?? 'uid-approved', email: 'rep@company.com' };
    },
    getUser: async (uid) => {
      userReads.push(uid);
      return {
        exists: overrides.exists !== false,
        data: overrides.exists === false ? undefined : (overrides.user ?? approvedUser()),
      };
    },
    now: overrides.now ?? (() => NOW),
    rateLimitStore,
    toTimestamp: (millis) => Timestamp.fromMillis(millis),
    serverTimestamp: () => SERVER_TIMESTAMP,
    collection(name) {
      collections.push(name);
      if (name !== 'fieldSyncReports') {
        methods.push(`collection:${name}`);
        throw new Error(`unexpected collection ${name}`);
      }
      const query = queryApi();
      return {
        ...query,
        doc(id: string) {
          return {
            async create(data: Record<string, unknown>) {
              methods.push('create');
              const error = typeof overrides.createError === 'function'
                ? overrides.createError(id)
                : overrides.createError;
              if (error) throw error;
              creates.push({ id, data });
            },
            async get() {
              methods.push('doc.get');
              const exists = overrides.cursorMissing !== true;
              return {
                exists,
                id,
                snapshot: { id, kind: 'snapshot' },
                data: () => (exists ? { id } : undefined),
              };
            },
            async set() {
              methods.push('set');
              throw new Error('set is not allowed');
            },
            async update() {
              methods.push('update');
              throw new Error('update is not allowed');
            },
            async delete() {
              methods.push('delete');
              throw new Error('delete is not allowed');
            },
          };
        },
      };
    },
  };

  return {
    creates,
    methods,
    collections,
    queryCalls,
    userReads,
    revoked,
    post(body: unknown, authorization?: string | null) {
      return handleFieldSyncReportPost({
        authorization: authorization === undefined
          ? (overrides.authorization === undefined ? 'Bearer good-token' : overrides.authorization)
          : authorization,
        body,
        deps,
      });
    },
    postRaw(rawBody: string, authorization?: string | null) {
      return handleFieldSyncReportPost({
        authorization: authorization === undefined ? 'Bearer good-token' : authorization,
        rawBody,
        deps,
      });
    },
    get(params: Record<string, string> = {}, authorization?: string | null) {
      return handleFieldSyncReportGet({
        authorization: authorization === undefined ? 'Bearer good-token' : authorization,
        searchParams: new URLSearchParams(params),
        deps,
      });
    },
  };
}

function assertNoValue(result: SyncReportResult, value: string) {
  assert.equal(JSON.stringify(result.body).includes(value), false);
}

describe('field sync report auth', () => {
  it('rejects a missing or garbled Authorization header', async () => {
    for (const authorization of [null, '', 'Bearer', 'Basic abc', 'Token abc']) {
      const test = harness({ authorization });
      const result = await test.post({ reports: [item()] });
      assert.equal(result.status, 401, String(authorization));
      assert.equal(test.creates.length, 0);
      assert.equal(test.collections.length, 0);
    }
  });

  it('rejects an auth error from verifyIdToken', async () => {
    const test = harness({ verifyError: { code: 'auth/id-token-revoked' } });
    const result = await test.post({ reports: [item()] });
    assert.equal(result.status, 401);
    assert.deepEqual(test.revoked, [true]);
    assert.equal(test.creates.length, 0);
  });

  it('rejects profiles that are not approved active field roles', async () => {
    const cases: Array<{ exists?: boolean; user?: Record<string, unknown> }> = [
      { exists: false },
      { user: approvedUser({ approvalStatus: 'pending', approved: false }) },
      { user: approvedUser({ isActive: false }) },
      { user: approvedUser({ status: 'inactive' }) },
      { user: approvedUser({ deleted: true }) },
      { user: approvedUser({ deletionPending: true }) },
      { user: approvedUser({ deletedAt: '2026-10-01T00:00:00.000Z' }) },
      { user: approvedUser({ role: 'viewer' }) },
      { user: { role: 'setter' } },
    ];
    for (const profile of cases) {
      const test = harness(profile);
      const result = await test.post({ reports: [item()] });
      assert.equal(result.status, 403);
      assert.equal(result.body.error, 'This account is not approved.');
      assert.equal(test.creates.length, 0);
      assert.equal(test.collections.length, 0);
    }
  });

  it('rejects TEST accounts with no writes', async () => {
    const cases = [
      { uid: 'uid-team', user: approvedUser({ team: 'TEST' }) },
      { uid: 'uid-data', user: approvedUser({ testData: true }) },
      { uid: 'uid-flag', user: approvedUser({ isTestAccount: true }) },
      { uid: 'user-test-1', user: approvedUser({ email: 'seed@company.com' }) },
      { uid: 'uid-email', user: approvedUser({ email: 'Evan@Test.com' }) },
    ];
    for (const profile of cases) {
      const test = harness(profile);
      const result = await test.post({ reports: [item()] });
      assert.equal(result.status, 403, profile.uid);
      assert.equal(result.body.error, 'Test accounts cannot send reports.');
      assert.equal(test.creates.length, 0);
      assert.equal(test.collections.length, 0);
      assert.deepEqual(test.userReads, [profile.uid]);
    }
  });
});

describe('field sync report validation', () => {
  it('rejects an empty batch, 51 items, and a body over 64 KB', async () => {
    const empty = harness();
    const emptyResult = await empty.post({ reports: [] });
    assert.equal(emptyResult.status, 400);
    assert.equal(emptyResult.body.field, 'reports');
    assert.equal(empty.creates.length, 0);

    const tooMany = harness();
    const reports = Array.from({ length: 51 }, (_, index) => item({ draftId: `draft_${index}` }));
    const tooManyResult = await tooMany.post({ reports });
    assert.equal(tooManyResult.status, 400);
    assert.equal(tooManyResult.body.field, 'reports');
    assert.equal(tooMany.creates.length, 0);
    assert.equal(tooMany.collections.length, 0);

    const huge = harness();
    const hugeResult = await huge.postRaw('x'.repeat(SYNC_REPORT_MAX_BYTES + 1));
    assert.equal(hugeResult.status, 413);
    assert.equal(hugeResult.body.error, 'Payload too large');
    assert.equal(huge.creates.length, 0);

    const atLimit = harness();
    const atLimitResult = await atLimit.postRaw('x'.repeat(SYNC_REPORT_MAX_BYTES));
    assert.equal(atLimitResult.status, 400);
    assert.equal(atLimitResult.body.field, 'body');
    assert.equal(atLimit.creates.length, 0);
  });

  it('accepts a non-UUID draft id and rejects over-length and bad characters', async () => {
    const acceptedId = 'legacy-draft_42';
    const maxId = 'a'.repeat(128);
    const uuidShaped = '550e8400-e29b-41d4-a716-446655440000';
    const ok = harness();
    const accepted = await ok.post({
      reports: [
        item({ draftId: acceptedId }),
        item({ draftId: maxId }),
        item({ draftId: uuidShaped }),
      ],
    });
    assert.equal(accepted.status, 200);
    assert.deepEqual(ok.creates.map((entry) => entry.id), [
      `uid-approved_${acceptedId}`,
      `uid-approved_${maxId}`,
      `uid-approved_${uuidShaped}`,
    ]);

    const longId = 'b'.repeat(129);
    const long = harness();
    const longResult = await long.post({ reports: [item({ draftId: longId })] });
    assert.equal(longResult.status, 400);
    assert.equal(longResult.body.field, 'draftId');
    assert.equal(longResult.body.index, 0);
    assertNoValue(longResult, longId);
    assert.equal(long.creates.length, 0);

    for (const bad of ['has/slash', 'has.dot', 'has:colon', 'has space', '.', '..', '']) {
      const test = harness();
      const result = await test.post({ reports: [item({ draftId: bad })] });
      assert.equal(result.status, 400, JSON.stringify(bad));
      assert.equal(result.body.field, 'draftId');
      assert.equal(result.body.index, 0);
      assert.equal(test.creates.length, 0);
      if (bad.includes('/')) assertNoValue(result, bad);
    }
  });

  it('rejects the other field caps and truncates lastError', async () => {
    const caps: Array<{ field: string; value: unknown; echo?: string }> = [
      { field: 'leadId', value: 'lead/with/slash', echo: 'lead/with/slash' },
      { field: 'leadId', value: '..' },
      { field: 'leadId', value: '.' },
      { field: 'leadId', value: 'c'.repeat(1501), echo: 'c'.repeat(1501) },
      { field: 'intendedStatus', value: 's'.repeat(65), echo: 's'.repeat(65) },
      { field: 'appBuild', value: 'b'.repeat(33), echo: 'b'.repeat(33) },
    ];
    for (const cap of caps) {
      const test = harness();
      const result = await test.post({ reports: [item({ [cap.field]: cap.value })] });
      assert.equal(result.status, 400, cap.field);
      assert.equal(result.body.field, cap.field);
      assert.equal(result.body.index, 0);
      assert.equal(test.creates.length, 0);
      if (cap.echo) assertNoValue(result, cap.echo);
    }

    const marker = 'ENDMARKER';
    const lastError = `${'e'.repeat(5000 - marker.length)}${marker}`;
    const stored = harness();
    const result = await stored.post({ reports: [item({ lastError })] });
    assert.equal(result.status, 200);
    assert.equal(stored.creates[0].data.lastError, 'e'.repeat(500));
    assert.equal(String(stored.creates[0].data.lastError).includes(marker), false);
    assertNoValue(result, marker);

    const cleaned = harness();
    const cleanedResult = await cleaned.post({
      reports: [item({ lastError: 'a\u0000b\u0007c\nd' })],
    });
    assert.equal(cleanedResult.status, 200);
    assert.equal(cleaned.creates[0].data.lastError, 'abc\nd');

    const longLeadId = `L${'x'.repeat(1499)}`;
    const accepted = harness();
    const acceptedResult = await accepted.post({
      reports: [
        item({ draftId: 'lead_web', leadId: '1760000000000-abc123xyz' }),
        item({ draftId: 'lead_space', leadId: 'house 12, unit B' }),
        item({ draftId: 'lead_long', leadId: longLeadId }),
      ],
    });
    assert.equal(acceptedResult.status, 200);
    assert.deepEqual(accepted.creates.map((entry) => entry.data.leadId), [
      '1760000000000-abc123xyz',
      'house 12, unit B',
      longLeadId,
    ]);
  });

  it('rejects bad enums and accepts every reason code with both outcomes', async () => {
    const badReason = harness();
    const reasonResult = await badReason.post({ reports: [item({ reasonCode: 'gps_maybe' })] });
    assert.equal(reasonResult.status, 400);
    assert.equal(reasonResult.body.field, 'reasonCode');
    assertNoValue(reasonResult, 'gps_maybe');
    assert.equal(badReason.creates.length, 0);

    const badOutcome = harness();
    const outcomeResult = await badOutcome.post({ reports: [item({ outcome: 'accepted' })] });
    assert.equal(outcomeResult.status, 400);
    assert.equal(outcomeResult.body.field, 'outcome');
    assertNoValue(outcomeResult, 'accepted');
    assert.equal(badOutcome.creates.length, 0);

    assert.deepEqual([...FIELD_REASON_CODES], [...CANONICAL_REASON_CODES]);
    const reports = FIELD_REASON_CODES.flatMap((reasonCode, reasonIndex) => (
      OUTCOMES.map((outcome, outcomeIndex) => item({
        draftId: `mix_${reasonIndex}_${outcomeIndex}`,
        reasonCode,
        outcome,
      }))
    ));
    const test = harness();
    const result = await test.post({ reports });
    assert.equal(result.status, 200);
    assert.equal(result.body.created, CANONICAL_REASON_CODES.length * OUTCOMES.length);
    assert.deepEqual(
      test.creates.map((entry) => [entry.data.reasonCode, entry.data.outcome]),
      reports.map((report) => [report.reasonCode, report.outcome]),
    );
  });

  it('rejects bad meter values and omits meters that were not sent', async () => {
    const rejected = [-1, Number.NaN, Number.POSITIVE_INFINITY, '12', 100_001];
    for (const value of rejected) {
      for (const field of ['gpsAccuracyM', 'distanceM']) {
        const test = harness();
        const result = await test.post({ reports: [item({ [field]: value })] });
        assert.equal(result.status, 400, `${field} ${String(value)}`);
        assert.equal(result.body.field, field);
        assert.equal(result.body.index, 0);
        assert.equal(test.creates.length, 0);
      }
    }

    const bounds = harness();
    const result = await bounds.post({
      reports: [
        item({ draftId: 'meters_zero', gpsAccuracyM: 0, distanceM: 0 }),
        item({ draftId: 'meters_max', gpsAccuracyM: 100_000, distanceM: 100_000 }),
        item({ draftId: 'meters_omit' }),
      ],
    });
    assert.equal(result.status, 200);
    assert.equal(bounds.creates[0].data.gpsAccuracyM, 0);
    assert.equal(bounds.creates[0].data.distanceM, 0);
    assert.equal(bounds.creates[1].data.gpsAccuracyM, 100_000);
    assert.equal(bounds.creates[2].data.gpsAccuracyM, undefined);
    assert.equal(Object.prototype.hasOwnProperty.call(bounds.creates[2].data, 'gpsAccuracyM'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(bounds.creates[2].data, 'distanceM'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(bounds.creates[2].data, 'lastError'), false);
  });

  it('rejects actionAt outside the window and stores ISO and millis as Timestamps', async () => {
    const tooOld = new Date(NOW - 31 * DAY).toISOString();
    const tooNew = new Date(NOW + 2 * DAY).toISOString();
    for (const actionAt of [tooOld, tooNew, 'not-a-date', '1700000000000']) {
      const test = harness();
      const result = await test.post({ reports: [item({ actionAt })] });
      assert.equal(result.status, 400, String(actionAt));
      assert.equal(result.body.field, 'actionAt');
      assert.equal(test.creates.length, 0);
    }

    const edge = harness();
    const oldest = NOW - 30 * DAY;
    const newest = NOW + DAY;
    const result = await edge.post({
      reports: [
        item({ draftId: 'iso_now', actionAt: new Date(NOW).toISOString() }),
        item({ draftId: 'millis_now', actionAt: NOW }),
        item({ draftId: 'iso_old', actionAt: new Date(oldest).toISOString() }),
        item({ draftId: 'millis_new', actionAt: newest }),
      ],
    });
    assert.equal(result.status, 200);
    for (const [index, millis] of [NOW, NOW, oldest, newest].entries()) {
      const stored = edge.creates[index].data.actionAt;
      assert.ok(stored instanceof Timestamp);
      assert.equal(stored.toMillis(), millis);
    }
  });

  it('rejects unknown keys and duplicate draft ids before any write', async () => {
    const top = harness();
    const topResult = await top.post({ reports: [item()], uid: 'attacker' });
    assert.equal(topResult.status, 400);
    assert.equal(topResult.body.field, 'uid');
    assert.equal(topResult.body.index, undefined);
    assertNoValue(topResult, 'attacker');
    assert.equal(top.creates.length, 0);

    const nested = harness();
    const nestedResult = await nested.post({ reports: [{ ...item(), uid: 'attacker' }] });
    assert.equal(nestedResult.status, 400);
    assert.equal(nestedResult.body.field, 'uid');
    assert.equal(nestedResult.body.index, 0);
    assertNoValue(nestedResult, 'attacker');
    assert.equal(nested.creates.length, 0);

    const extra = harness();
    const extraResult = await extra.post({ reports: [{ ...item(), note: 'secret note' }] });
    assert.equal(extraResult.status, 400);
    assert.equal(extraResult.body.field, 'note');
    assertNoValue(extraResult, 'secret note');
    assert.equal(extra.creates.length, 0);

    const duplicate = harness();
    const duplicateResult = await duplicate.post({
      reports: [item({ draftId: 'same_id' }), item({ draftId: 'same_id' })],
    });
    assert.equal(duplicateResult.status, 400);
    assert.equal(duplicateResult.body.field, 'draftId');
    assert.equal(duplicateResult.body.index, 1);
    assert.equal(duplicate.creates.length, 0);
  });
});

describe('field sync report writes', () => {
  it('stores a write-once doc under the token uid', async () => {
    const test = harness({ uid: 'token-uid', user: approvedUser({ name: ` ${'N'.repeat(130)} `, role: 'closer' }) });
    const result = await test.post({
      reports: [item({
        draftId: 'legacy-draft_42',
        lastError: 'rules denied the write',
        gpsAccuracyM: 12.5,
        distanceM: 37,
        intendedStatus: '  go-back  ',
      })],
    });
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, { ok: true, created: 1, duplicate: 0, failed: 0 });
    assert.equal(test.creates.length, 1);
    const created = test.creates[0];
    assert.equal(created.id, 'token-uid_legacy-draft_42');
    assert.equal(created.data.uid, 'token-uid');
    assert.equal(created.data.userRole, 'closer');
    assert.equal(created.data.userName, 'N'.repeat(120));
    assert.equal(created.data.schemaVersion, 1);
    assert.equal(created.data.createdAt, SERVER_TIMESTAMP);
    assert.equal(created.data.intendedStatus, 'go-back');
    assert.equal(created.data.lastError, 'rules denied the write');
    assert.equal(created.data.gpsAccuracyM, 12.5);
    assert.equal(created.data.distanceM, 37);
    assert.equal(created.data.leadId, '1760000000000-abc123xyz');
    assert.deepEqual(test.collections, ['fieldSyncReports']);
    assert.deepEqual(test.methods, ['create']);
    assert.deepEqual(test.userReads, ['token-uid']);
    assertNoValue(result, 'rules denied the write');
  });

  it('counts an already-exists create as a duplicate', async () => {
    const numeric = harness({ createError: { code: 6 } });
    const numericResult = await numeric.post({ reports: [item()] });
    assert.equal(numericResult.status, 200);
    assert.deepEqual(numericResult.body, { ok: true, created: 0, duplicate: 1, failed: 0 });

    const named = harness({ createError: { code: 'already-exists' } });
    const namedResult = await named.post({ reports: [item()] });
    assert.equal(namedResult.status, 200);
    assert.equal(namedResult.body.duplicate, 1);
  });

  it('returns 500 only when every create fails', async () => {
    const allFailed = harness({ createError: { code: 13 } });
    const failedResult = await allFailed.post({ reports: [item(), item({ draftId: 'other_draft' })] });
    assert.equal(failedResult.status, 500);
    assert.deepEqual(failedResult.body, { ok: false, created: 0, duplicate: 0, failed: 2 });
    assert.equal(JSON.stringify(failedResult.body).includes('13'), false);

    const mixed = harness({
      createError: (id) => (id.endsWith('bad_draft') ? { code: 13 } : undefined),
    });
    const mixedResult = await mixed.post({
      reports: [item({ draftId: 'good_draft' }), item({ draftId: 'bad_draft' })],
    });
    assert.equal(mixedResult.status, 200);
    assert.deepEqual(mixedResult.body, { ok: true, created: 1, duplicate: 0, failed: 1 });
  });

  it('rate limits the 11th request inside 60 seconds', async () => {
    let now = NOW;
    const test = harness({ now: () => now });
    for (let index = 0; index < SYNC_REPORT_LIMIT; index += 1) {
      const result = await test.post({ reports: [item({ draftId: `rate_${index}` })] });
      assert.equal(result.status, 200, String(index));
    }
    const blocked = await test.post({ reports: [item({ draftId: 'rate_blocked' })] });
    assert.equal(blocked.status, 429);
    assert.equal(blocked.body.error, 'Too many reports');
    const retryAfter = Number(blocked.headers?.['Retry-After']);
    assert.equal(Number.isInteger(retryAfter), true);
    assert.ok(retryAfter >= 1 && retryAfter <= 60);
    assert.equal(test.creates.some((entry) => entry.id.endsWith('rate_blocked')), false);

    now += 60_000;
    const allowed = await test.post({ reports: [item({ draftId: 'rate_next', actionAt: now })] });
    assert.equal(allowed.status, 200);
    assert.equal(allowed.body.created, 1);
  });

  it('never calls set, update, delete, or another collection', async () => {
    const test = harness();
    await test.post({ reports: [item()] });
    assert.deepEqual(test.methods, ['create']);
    assert.deepEqual(test.collections, ['fieldSyncReports']);
    assert.equal(test.methods.includes('set'), false);
    assert.equal(test.methods.includes('update'), false);
    assert.equal(test.methods.includes('delete'), false);
  });
});

describe('field sync report list', () => {
  it('lets managers and admins list and rejects other roles and TEST accounts', async () => {
    for (const role of ['setter', 'closer']) {
      const test = harness({ user: approvedUser({ role }) });
      const result = await test.get();
      assert.equal(result.status, 403, role);
      assert.equal(result.body.error, 'Not allowed.');
      assert.equal(test.collections.length, 0);
    }

    const testAccount = harness({ user: approvedUser({ role: 'manager', team: 'TEST' }) });
    const testResult = await testAccount.get();
    assert.equal(testResult.status, 403);
    assert.equal(testResult.body.error, 'Test accounts cannot view reports.');
    assert.equal(testAccount.collections.length, 0);

    for (const role of ['manager', 'admin']) {
      const test = harness({ user: approvedUser({ role, name: 'Ada Manager' }) });
      const result = await test.get();
      assert.equal(result.status, 200, role);
      assert.deepEqual(result.body, { items: [], nextCursor: null });
      assert.deepEqual(test.queryCalls.find((call) => call.method === 'limit')?.args, [50]);
      const from = test.queryCalls.find((call) => call.method === 'where' && call.args[1] === '>=');
      const to = test.queryCalls.find((call) => call.method === 'where' && call.args[1] === '<');
      assert.equal((from?.args[2] as Timestamp).toMillis(), NOW - SYNC_REPORT_DEFAULT_WINDOW_MS);
      assert.equal((to?.args[2] as Timestamp).toMillis(), NOW);
    }
  });

  it('rejects bad limits and a window longer than 31 days', async () => {
    for (const limit of ['0', '101', 'abc', '50.5', '-1', '01']) {
      const test = harness({ user: approvedUser({ role: 'manager' }) });
      const result = await test.get({ limit });
      assert.equal(result.status, 400, limit);
      assert.equal(result.body.field, 'limit');
      assert.equal(test.collections.length, 0);
      assertNoValue(result, limit);
    }

    const wide = harness({ user: approvedUser({ role: 'admin' }) });
    const from = new Date(NOW - 32 * DAY).toISOString();
    const to = new Date(NOW).toISOString();
    const wideResult = await wide.get({ from, to });
    assert.equal(wideResult.status, 400);
    assert.equal(wideResult.body.field, 'from');
    assert.equal(wide.collections.length, 0);

    const exact = harness({ user: approvedUser({ role: 'admin' }) });
    const exactResult = await exact.get({
      from: new Date(NOW - SYNC_REPORT_MAX_WINDOW_MS).toISOString(),
      to: new Date(NOW).toISOString(),
    });
    assert.equal(exactResult.status, 200);
  });

  it('uses a 7 day window and passes reasonCode, limit, and cursor to the query', async () => {
    const listedAt = Timestamp.fromMillis(NOW - 1000);
    const actedAt = Timestamp.fromMillis(NOW);
    const test = harness({
      user: approvedUser({ role: 'manager' }),
      listDocs: [
        {
          id: 'uid-approved_legacy-draft_42',
          data: {
            reasonCode: 'outside_50m',
            outcome: 'refused',
            createdAt: listedAt,
            actionAt: actedAt,
            lastError: 'held by gps policy',
          },
        },
      ],
    });
    const result = await test.get({ reasonCode: 'outside_50m', limit: '1', cursor: 'uid-approved_legacy-draft_42' });
    assert.equal(result.status, 200);
    assert.deepEqual(result.body.nextCursor, 'uid-approved_legacy-draft_42');
    const items = result.body.items as Array<Record<string, unknown>>;
    assert.equal(items.length, 1);
    assert.equal(items[0].id, 'uid-approved_legacy-draft_42');
    assert.equal(items[0].createdAt, new Date(NOW - 1000).toISOString());
    assert.equal(items[0].actionAt, new Date(NOW).toISOString());
    assert.equal(items[0].reasonCode, 'outside_50m');

    const wheres = test.queryCalls.filter((call) => call.method === 'where');
    assert.deepEqual(wheres[0].args, ['reasonCode', '==', 'outside_50m']);
    const from = wheres.find((call) => call.args[0] === 'createdAt' && call.args[1] === '>=');
    const to = wheres.find((call) => call.args[0] === 'createdAt' && call.args[1] === '<');
    assert.ok(from?.args[2] instanceof Timestamp);
    assert.ok(to?.args[2] instanceof Timestamp);
    assert.equal((from.args[2] as Timestamp).toMillis(), NOW - SYNC_REPORT_DEFAULT_WINDOW_MS);
    assert.equal((to.args[2] as Timestamp).toMillis(), NOW);
    assert.deepEqual(test.queryCalls.find((call) => call.method === 'orderBy')?.args, ['createdAt', 'desc']);
    assert.deepEqual(test.queryCalls.find((call) => call.method === 'limit')?.args, [1]);
    assert.deepEqual(test.queryCalls.find((call) => call.method === 'startAfter')?.args, [{ id: 'uid-approved_legacy-draft_42', kind: 'snapshot' }]);
    assert.equal(test.methods.includes('create'), false);
    assert.equal(test.methods.includes('set'), false);
    assert.deepEqual(test.collections, ['fieldSyncReports', 'fieldSyncReports']);
  });

  it('rejects a missing cursor and maps a missing index to 503', async () => {
    const missing = harness({ user: approvedUser({ role: 'admin' }), cursorMissing: true });
    const missingResult = await missing.get({ cursor: 'uid-approved_gone' });
    assert.equal(missingResult.status, 400);
    assert.equal(missingResult.body.field, 'cursor');
    assert.equal(missing.queryCalls.some((call) => call.method === 'get'), false);

    const building = harness({ user: approvedUser({ role: 'admin' }), listError: { code: 9 } });
    const buildingResult = await building.get({ reasonCode: 'not_found' });
    assert.equal(buildingResult.status, 503);
    assert.deepEqual(buildingResult.body, { error: 'Index building' });

    const filtered = harness({ user: approvedUser({ role: 'manager' }) });
    const filteredResult = await filtered.get({ reasonCode: 'out_of_territory' });
    assert.equal(filteredResult.status, 200);
    assert.deepEqual(
      filtered.queryCalls.find((call) => call.args[0] === 'reasonCode')?.args,
      ['reasonCode', '==', 'out_of_territory'],
    );

    const unknown = harness({ user: approvedUser({ role: 'admin' }) });
    const unknownResult = await unknown.get({ reasonCode: 'gps_maybe' });
    assert.equal(unknownResult.status, 400);
    assert.equal(unknownResult.body.field, 'reasonCode');
    assertNoValue(unknownResult, 'gps_maybe');
    assert.equal(unknown.collections.length, 0);
  });
});

describe('field sync report wiring', () => {
  it('keeps the route on create() and the rules file closed', () => {
    const route = readFileSync(new URL('../app/api/field/sync-report/route.ts', import.meta.url), 'utf8');
    const helper = readFileSync(new URL('../app/utils/server/fieldSyncReport.ts', import.meta.url), 'utf8');
    const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
    const indexes = JSON.parse(readFileSync(new URL('../firestore.indexes.json', import.meta.url), 'utf8')) as {
      indexes: Array<{ collectionGroup?: string; queryScope?: string; fields?: Array<{ fieldPath: string; order: string }> }>;
    };

    assert.equal(helper.includes('firebase-admin'), false);
    assert.match(helper, /FIELD_REASON_CODES/);
    assert.equal(helper.includes('out_of_territory'), false);
    assert.deepEqual([...FIELD_REASON_CODES], [...CANONICAL_REASON_CODES]);
    assert.equal(/\b(leads|territories)\b/.test(helper), false);
    assert.equal(/\b(leads|territories)\b/.test(route), false);
    assert.match(route, /ref\.create\(/);
    assert.equal(/\.(?:update|delete|merge)\(|(?<!store)\.set\(/.test(route), false);
    assert.equal(/\.(?:update|delete|merge)\(|(?<!store)\.set\(/.test(helper), false);
    assert.match(route, /export const runtime = 'nodejs'/);
    assert.match(route, /export const dynamic = 'force-dynamic'/);
    assert.match(route, /private, no-store/);
    assert.equal(/export async function (PUT|PATCH|DELETE)/.test(route), false);
    assert.equal(rules.includes('fieldSyncReports'), false);

    const index = indexes.indexes.find((entry) => entry.collectionGroup === 'fieldSyncReports');
    assert.ok(index);
    assert.equal(index.queryScope, 'COLLECTION');
    assert.deepEqual(index.fields, [
      { fieldPath: 'reasonCode', order: 'ASCENDING' },
      { fieldPath: 'createdAt', order: 'DESCENDING' },
    ]);
  });
});
