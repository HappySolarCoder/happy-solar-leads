import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { adminDeletionRequestedLabel } from '../app/utils/accountDeletion.ts';
import {
  handleRequestAccountDeletion,
  type RequestAccountDeletionDeps,
} from '../app/utils/server/requestAccountDeletion.ts';
import {
  DELETE,
  GET,
  HEAD,
  OPTIONS,
  PATCH,
  PUT,
} from '../app/api/account/request-deletion/route.ts';

const SENTINEL = { marker: 'server-timestamp' };
const FORBIDDEN = ['leads', 'visits', 'knocks', 'dispositions', 'territories', 'disposition_history', 'history'];

type Stored = Record<string, unknown>;

function harness(options: {
  authorization?: string | null;
  profile?: Stored | null;
  verifyError?: unknown;
  /** Thrown only when verifyIdToken is called with checkRevoked. The unchecked call succeeds. */
  revokedOnCheck?: 'auth/user-disabled' | 'auth/id-token-revoked';
  setError?: unknown;
  uid?: string;
  email?: string;
} = {}) {
  const uid = options.uid ?? 'uid-setter';
  const users = new Map<string, Stored>();
  if (options.profile) users.set(uid, { ...options.profile });

  const calls = {
    checkRevoked: [] as Array<boolean | undefined>,
    order: [] as string[],
    updateUser: [] as Array<{ uid: string; properties: { disabled: true } }>,
    revoke: [] as string[],
    sets: [] as Array<{ collection: string; id: string; data: Stored; options: { merge?: boolean } }>,
    updates: [] as string[],
    deletes: [] as string[],
    scans: [] as string[],
    collections: [] as string[],
    timestamps: 0,
    logs: [] as string[],
  };

  const db = {
    collection(name: string) {
      calls.collections.push(name);
      return {
        doc(id: string) {
          return {
            async get() {
              const data = name === 'users' ? users.get(id) : undefined;
              if (name !== 'users') calls.scans.push(name);
              return { exists: Boolean(data), data: () => (data ? { ...data } : undefined) };
            },
            async set(data: Stored, setOptions: { merge?: boolean }) {
              calls.order.push(`set:${name}`);
              calls.sets.push({ collection: name, id, data: { ...data }, options: setOptions });
              if (options.setError) throw options.setError;
              if (name === 'users' && setOptions?.merge) {
                users.set(id, { ...(users.get(id) || {}), ...data });
              }
            },
            async update() {
              calls.updates.push(name);
            },
            async delete() {
              calls.deletes.push(name);
            },
          };
        },
        async get() {
          calls.scans.push(name);
        },
        where() {
          calls.scans.push(name);
          return { get: async () => { calls.scans.push(name); return { docs: [] }; } };
        },
      };
    },
  };

  const deps: RequestAccountDeletionDeps = {
    verifyIdToken: async (_token, checkRevoked) => {
      calls.checkRevoked.push(checkRevoked);
      if (options.revokedOnCheck && checkRevoked) throw { code: options.revokedOnCheck };
      if (options.verifyError) throw options.verifyError;
      return { uid, email: options.email ?? 'setter@example.com' };
    },
    auth: {
      updateUser: async (userId, properties) => {
        calls.order.push('updateUser');
        calls.updateUser.push({ uid: userId, properties });
      },
      revokeRefreshTokens: async (userId) => {
        calls.order.push('revokeRefreshTokens');
        calls.revoke.push(userId);
      },
    },
    db,
    serverTimestamp: () => {
      calls.timestamps += 1;
      return SENTINEL;
    },
    log: (line) => {
      calls.logs.push(line);
    },
  };

  return {
    calls,
    users,
    uid,
    run: (authorization = options.authorization === undefined ? 'Bearer token' : options.authorization) =>
      handleRequestAccountDeletion({ authorization, deps }),
  };
}

function assertNoHistoryWrites(calls: ReturnType<typeof harness>['calls']) {
  const touched = new Set<string>([
    ...calls.collections,
    ...calls.sets.map((entry) => entry.collection),
    ...calls.updates,
    ...calls.deletes,
    ...calls.scans,
  ]);
  for (const name of FORBIDDEN) {
    assert.equal(touched.has(name), false, `${name} was written or scanned`);
  }
  assert.deepEqual(calls.updates, []);
  assert.deepEqual(calls.deletes, []);
  assert.deepEqual(calls.scans, []);
  for (const name of calls.collections) {
    assert.equal(name, 'users');
  }
}

const setterProfile = {
  role: 'setter',
  email: 'setter@example.com',
  name: 'Set Ter',
  isActive: true,
  status: 'active',
};

describe('POST /api/account/request-deletion', () => {
  it('returns 401 when the bearer token is missing or invalid', async () => {
    const missing = harness({ profile: setterProfile });
    const noHeader = await missing.run(null);
    assert.equal(noHeader.status, 401);
    assert.deepEqual(noHeader.body, { ok: false, error: 'Missing credentials' });
    assert.deepEqual(missing.calls.checkRevoked, []);

    const basic = harness({ profile: setterProfile });
    const wrongScheme = await basic.run('Basic abc');
    assert.equal(wrongScheme.status, 401);
    assert.deepEqual(wrongScheme.body, { ok: false, error: 'Missing credentials' });

    const rejected = harness({ profile: setterProfile, verifyError: { code: 'auth/id-token-expired' } });
    const invalid = await rejected.run('Bearer stale');
    assert.equal(invalid.status, 401);
    assert.deepEqual(invalid.body, { ok: false, error: 'Sign in again.' });
    assert.deepEqual(rejected.calls.checkRevoked, [true]);
    assert.equal(rejected.calls.updateUser.length, 0);
    assert.equal(rejected.calls.sets.length, 0);
    assertNoHistoryWrites(rejected.calls);
  });

  it('returns 403 for an admin and does not disable or rewrite the profile', async () => {
    const test = harness({
      profile: {
        role: 'admin',
        email: 'admin@example.com',
        name: 'Ada Min',
        isActive: true,
        status: 'active',
      },
      email: 'admin@example.com',
    });
    const result = await test.run();
    assert.equal(result.status, 403);
    assert.deepEqual(result.body, { ok: false, error: 'admin-accounts-cannot-self-delete' });
    assert.equal(test.calls.updateUser.length, 0);
    assert.equal(test.calls.revoke.length, 0);
    assert.equal(test.calls.sets.length, 0);
    assert.equal(test.calls.timestamps, 0);
    assert.deepEqual(test.calls.logs, []);
    assert.equal(test.users.get(test.uid)?.email, 'admin@example.com');
    assertNoHistoryWrites(test.calls);
  });

  it('disables a setter, revokes refresh tokens, and merges only the deletion fields', async () => {
    const test = harness({ profile: setterProfile });
    const result = await test.run();
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, { ok: true, disabled: true });
    assert.deepEqual(test.calls.checkRevoked, [true]);
    assert.deepEqual(test.calls.order, ['set:users', 'updateUser', 'revokeRefreshTokens']);
    assert.deepEqual(test.calls.updateUser, [{ uid: 'uid-setter', properties: { disabled: true } }]);
    assert.deepEqual(test.calls.revoke, ['uid-setter']);
    assert.equal(test.calls.sets.length, 1);
    assert.equal(test.calls.sets[0].collection, 'users');
    assert.equal(test.calls.sets[0].id, 'uid-setter');
    assert.deepEqual(test.calls.sets[0].options, { merge: true });
    assert.deepEqual(test.calls.sets[0].data, {
      isActive: false,
      status: 'deletion-requested',
      deletionRequestedAt: SENTINEL,
    });
    const stored = test.users.get('uid-setter');
    assert.equal(stored?.email, 'setter@example.com');
    assert.equal(stored?.name, 'Set Ter');
    assert.equal(stored?.role, 'setter');
    assert.equal(stored?.isActive, false);
    assert.deepEqual(test.calls.logs, ['[account-deletion-requested] uid=uid-setter role=setter']);
    assert.equal(test.calls.logs[0].includes('setter@example.com'), false);
    assert.equal(test.calls.logs[0].includes('Set Ter'), false);
    assertNoHistoryWrites(test.calls);
  });

  it('returns 200 on a second call without rewriting deletionRequestedAt', async () => {
    const test = harness({ profile: setterProfile });
    const first = await test.run();
    const second = await test.run();
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.deepEqual(second.body, { ok: true, disabled: true });
    assert.equal(test.calls.sets.length, 1);
    assert.equal(test.calls.timestamps, 1);
    assert.deepEqual(test.calls.revoke, ['uid-setter']);
    assert.equal(test.calls.updateUser.length, 2);
    assert.equal(test.users.get('uid-setter')?.deletionRequestedAt, SENTINEL);
    assert.equal(test.users.get('uid-setter')?.email, 'setter@example.com');
    assert.deepEqual(test.calls.logs, [
      '[account-deletion-requested] uid=uid-setter role=setter',
      '[account-deletion-requested] uid=uid-setter role=setter',
    ]);
    assertNoHistoryWrites(test.calls);
  });

  it('disables Auth and writes a minimal doc when the profile is missing', async () => {
    const test = harness({ profile: null, uid: 'uid-missing' });
    const result = await test.run();
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, { ok: true, disabled: true });
    assert.deepEqual(test.calls.updateUser, [{ uid: 'uid-missing', properties: { disabled: true } }]);
    assert.deepEqual(test.calls.revoke, ['uid-missing']);
    assert.deepEqual(test.calls.sets[0].data, {
      isActive: false,
      status: 'deletion-requested',
      deletionRequestedAt: SENTINEL,
    });
    assert.deepEqual(test.users.get('uid-missing'), {
      isActive: false,
      status: 'deletion-requested',
      deletionRequestedAt: SENTINEL,
    });
    assert.deepEqual(test.calls.logs, ['[account-deletion-requested] uid=uid-missing role=']);
    assertNoHistoryWrites(test.calls);
  });

  it('returns 5xx and leaves Auth enabled when the profile write fails', async () => {
    const test = harness({ profile: setterProfile, setError: new Error('firestore unavailable') });
    const result = await test.run();
    assert.ok(result.status >= 500 && result.status < 600);
    assert.deepEqual(result.body, { ok: false, error: 'Internal error' });
    assert.equal(test.calls.updateUser.length, 0);
    assert.equal(test.calls.revoke.length, 0);
    assert.deepEqual(test.calls.order, ['set:users']);
    assert.equal(test.users.get('uid-setter')?.status, 'active');
    assert.equal(test.users.get('uid-setter')?.isActive, true);
    assert.equal(test.calls.logs.length, 0);
    assertNoHistoryWrites(test.calls);
  });

  it('accepts a disabled or revoked token when the profile is already deletion-requested', async () => {
    for (const code of ['auth/user-disabled', 'auth/id-token-revoked'] as const) {
      const test = harness({
        revokedOnCheck: code,
        email: 'setter@example.com',
        profile: {
          role: 'setter',
          email: 'setter@example.com',
          name: 'Set Ter',
          isActive: false,
          status: 'deletion-requested',
          deletionRequestedAt: 'original-timestamp',
        },
      });
      const result = await test.run('Bearer same-token');
      assert.equal(result.status, 200, code);
      assert.deepEqual(result.body, { ok: true, disabled: true });
      assert.deepEqual(test.calls.checkRevoked, [true, undefined]);
      assert.equal(test.calls.sets.length, 0);
      assert.equal(test.calls.timestamps, 0);
      assert.equal(test.calls.revoke.length, 0);
      assert.deepEqual(test.calls.updateUser, [{ uid: 'uid-setter', properties: { disabled: true } }]);
      assert.equal(test.users.get('uid-setter')?.deletionRequestedAt, 'original-timestamp');
      assert.equal(test.users.get('uid-setter')?.email, 'setter@example.com');
      assert.equal(test.calls.logs[0].includes('setter@example.com'), false);
      assertNoHistoryWrites(test.calls);
    }
  });

  it('returns 401 for a disabled or revoked token when the profile is not deletion-requested', async () => {
    for (const code of ['auth/user-disabled', 'auth/id-token-revoked'] as const) {
      const test = harness({
        revokedOnCheck: code,
        profile: setterProfile,
      });
      const result = await test.run('Bearer same-token');
      assert.equal(result.status, 401, code);
      assert.deepEqual(result.body, { ok: false, error: 'Sign in again.' });
      assert.deepEqual(test.calls.checkRevoked, [true, undefined]);
      assert.equal(test.calls.updateUser.length, 0);
      assert.equal(test.calls.revoke.length, 0);
      assert.equal(test.calls.sets.length, 0);
      assert.equal(test.calls.timestamps, 0);
      assert.equal(test.users.get('uid-setter')?.status, 'active');
      assert.equal(test.users.get('uid-setter')?.isActive, true);
      assert.deepEqual(test.calls.logs, []);
      assertNoHistoryWrites(test.calls);
    }
  });

  it('does not call lead or territory writers', async () => {
    const test = harness({ profile: setterProfile });
    await test.run();
    assert.equal(test.calls.sets.length, 1);
    assert.equal(test.calls.sets[0].collection, 'users');
    assertNoHistoryWrites(test.calls);
  });
});

describe('request-deletion route methods', () => {
  it('returns 405 for every method other than POST', async () => {
    for (const handler of [GET, PUT, PATCH, DELETE, HEAD, OPTIONS]) {
      const response = handler();
      assert.equal(response.status, 405);
      assert.equal(response.headers.get('Allow'), 'POST');
      assert.deepEqual(await response.json(), { ok: false, error: 'method-not-allowed' });
    }
  });
});

describe('admin deletion-requested label', () => {
  it('shows deletion-requested as a distinct label and leaves activity separate', () => {
    assert.equal(adminDeletionRequestedLabel('deletion-requested'), 'deletion-requested');
    assert.equal(adminDeletionRequestedLabel('active'), null);
    assert.equal(adminDeletionRequestedLabel('Pending Approval'), null);
    assert.equal(adminDeletionRequestedLabel(undefined), null);
  });
});
