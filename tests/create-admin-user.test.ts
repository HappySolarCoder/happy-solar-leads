import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAdminCreatedUserDoc,
  handleCreateAdminUser,
  type CreateAdminUserDeps,
} from '../app/utils/server/createAdminUser.ts';

const PASSWORD = 'TempPass-should-not-be-logged';
const TOKEN = 'id-token-should-not-be-logged';
const NOW = new Date('2026-10-17T12:00:00.000Z');

const activeAdmin = {
  exists: true,
  data: { role: 'admin', isActive: true, approved: true, approvalStatus: 'approved', status: 'active' },
};

function body(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Jane Setter',
    email: 'jane.setter@example.com',
    password: PASSWORD,
    role: 'setter',
    ...overrides,
  };
}

function deps(user: { exists: boolean; data?: Record<string, unknown> }, partial: Partial<CreateAdminUserDeps> = {}): CreateAdminUserDeps & {
  calls: { create: unknown[]; set: unknown[]; deleted: string[] };
} {
  const calls = { create: [] as unknown[], set: [] as unknown[], deleted: [] as string[] };
  return {
    calls,
    verifyIdToken: async () => ({ uid: 'admin-1', email: 'admin@example.com' }),
    getUser: async () => user,
    createUser: async (input) => {
      calls.create.push(input);
      return { uid: 'uid-created' };
    },
    setUserDoc: async (uid, data) => {
      calls.set.push({ uid, data });
    },
    deleteUser: async (uid) => {
      calls.deleted.push(uid);
    },
    now: () => NOW,
    color: () => '#112233',
    ...partial,
  };
}

describe('POST /api/admin/create-user', () => {
  it('lets an active admin create the Auth user and the same users doc the client used to write', async () => {
    const harness = deps(activeAdmin);
    const result = await handleCreateAdminUser({
      authorization: `Bearer ${TOKEN}`,
      body: body({ role: 'closer', email: '  Closer@Example.com  ' }),
      deps: harness,
    });

    assert.equal(result.status, 200);
    assert.deepEqual(result.body, { uid: 'uid-created' });
    assert.deepEqual(harness.calls.create, [{
      email: 'Closer@Example.com',
      password: PASSWORD,
      displayName: 'Jane Setter',
    }]);
    assert.deepEqual(harness.calls.set, [{
      uid: 'uid-created',
      data: buildAdminCreatedUserDoc({
        uid: 'uid-created',
        name: 'Jane Setter',
        email: 'Closer@Example.com',
        role: 'closer',
        createdAt: NOW,
        color: '#112233',
      }),
    }]);
    assert.deepEqual(harness.calls.deleted, []);
  });

  it('returns 403 for a manager and a rep, and 401 when unauthenticated', async () => {
    const manager = deps({
      exists: true,
      data: { role: 'manager', isActive: true, approved: true, approvalStatus: 'approved' },
    });
    const managerResult = await handleCreateAdminUser({
      authorization: `Bearer ${TOKEN}`,
      body: body(),
      deps: manager,
    });
    assert.equal(managerResult.status, 403);
    assert.equal(manager.calls.create.length, 0);

    const rep = deps({
      exists: true,
      data: { role: 'setter', isActive: true, approved: true, approvalStatus: 'approved' },
    });
    const repResult = await handleCreateAdminUser({
      authorization: `Bearer ${TOKEN}`,
      body: body(),
      deps: rep,
    });
    assert.equal(repResult.status, 403);
    assert.equal(rep.calls.create.length, 0);

    const anonymous = deps(activeAdmin);
    const unsigned = await handleCreateAdminUser({
      authorization: null,
      body: body(),
      deps: anonymous,
    });
    assert.equal(unsigned.status, 401);
    assert.equal(anonymous.calls.create.length, 0);

    const inactiveAdmin = deps({
      exists: true,
      data: { role: 'admin', isActive: false, approved: true, approvalStatus: 'approved' },
    });
    const inactive = await handleCreateAdminUser({
      authorization: `Bearer ${TOKEN}`,
      body: body(),
      deps: inactiveAdmin,
    });
    assert.equal(inactive.status, 403);
    assert.equal(inactiveAdmin.calls.create.length, 0);
  });

  it('rolls back the Auth user when the users doc write fails and does not log the password or token', async () => {
    const logs: string[] = [];
    const harness = deps(activeAdmin, {
      setUserDoc: async () => {
        const error = new Error('firestore unavailable') as Error & { code?: string };
        error.code = 'firestore/unavailable';
        throw error;
      },
    });

    const result = await handleCreateAdminUser({
      authorization: `Bearer ${TOKEN}`,
      body: body(),
      deps: harness,
      logger: (message) => logs.push(message),
    });

    assert.equal(result.status, 500);
    assert.deepEqual(result.body, { error: 'Internal error' });
    assert.deepEqual(harness.calls.deleted, ['uid-created']);
    const logged = logs.join('\n');
    assert.equal(logged.includes(PASSWORD), false);
    assert.equal(logged.includes(TOKEN), false);
    assert.match(logged, /profile firestore\/unavailable/);
  });
});
