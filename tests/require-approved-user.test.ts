import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  HttpError,
  isDeniedAccount,
  requireApprovedUser,
  type RequireApprovedUserDeps,
} from '../app/utils/server/requireApprovedUser.ts';

const activeLegacy = { role: 'setter' };

function deps(user: { exists: boolean; data?: Record<string, unknown> }, verifyError?: unknown): RequireApprovedUserDeps & { calls: { checkRevoked: boolean[] } } {
  const calls = { checkRevoked: [] as boolean[] };
  return {
    calls,
    verifyIdToken: async (_token, checkRevoked) => {
      calls.checkRevoked.push(checkRevoked);
      if (verifyError) throw verifyError;
      return { uid: 'uid-1', email: 'rep@example.com' };
    },
    getUser: async () => user,
  };
}

describe('isDeniedAccount', () => {
  it('allows legacy docs that omit approval fields', () => {
    assert.equal(isDeniedAccount(true, {}), false);
    assert.equal(isDeniedAccount(true, { role: 'closer', isActive: true }), false);
    assert.equal(isDeniedAccount(true, { deleted: false, deletionPending: false, approved: true, approvalStatus: 'approved' }), false);
  });

  it('denies a missing user and each deny-list flag on its own', () => {
    assert.equal(isDeniedAccount(false, undefined), true);
    assert.equal(isDeniedAccount(true, undefined), true);
    assert.equal(isDeniedAccount(true, { deleted: true }), true);
    assert.equal(isDeniedAccount(true, { deletionPending: true }), true);
    assert.equal(isDeniedAccount(true, { isActive: false }), true);
    assert.equal(isDeniedAccount(true, { approved: false }), true);
    assert.equal(isDeniedAccount(true, { approvalStatus: 'pending' }), true);
  });
});

describe('requireApprovedUser', () => {
  it('returns uid, user, and role after a revoked-token check', async () => {
    const harness = deps({ exists: true, data: { ...activeLegacy, role: 'manager' } });
    const approved = await requireApprovedUser('Bearer good-token', harness);
    assert.equal(approved.uid, 'uid-1');
    assert.equal(approved.role, 'manager');
    assert.equal(approved.user.role, 'manager');
    assert.deepEqual(harness.calls.checkRevoked, [true]);
  });

  it('returns 401 when the bearer token is missing or rejected', async () => {
    const harness = deps({ exists: true, data: activeLegacy });
    await assert.rejects(() => requireApprovedUser(null, harness), (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.status, 401);
      return true;
    });
    await assert.rejects(() => requireApprovedUser('Basic abc', harness), (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.status, 401);
      return true;
    });

    const rejected = deps({ exists: true, data: activeLegacy }, { code: 'auth/id-token-revoked' });
    await assert.rejects(() => requireApprovedUser('Bearer stale', rejected), (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.status, 401);
      return true;
    });
  });

  it('returns 403 JSON-shaped errors for every deny-list case', async () => {
    const cases = [
      { exists: false, data: undefined },
      { exists: true, data: undefined },
      { exists: true, data: { deleted: true, role: 'admin' } },
      { exists: true, data: { deletionPending: true, role: 'admin' } },
      { exists: true, data: { isActive: false, role: 'manager' } },
      { exists: true, data: { approved: false, role: 'manager' } },
      { exists: true, data: { approvalStatus: 'pending', role: 'admin', approved: true, isActive: true } },
    ];

    for (const user of cases) {
      const harness = deps(user);
      await assert.rejects(() => requireApprovedUser('Bearer good-token', harness), (error: unknown) => {
        assert.ok(error instanceof HttpError);
        assert.equal(error.status, 403);
        assert.equal(error.message, 'This account is not approved.');
        return true;
      });
    }
  });
});
