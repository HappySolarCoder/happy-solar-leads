import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  handleCreateProfile,
  ProfileExistsError,
  SELF_SIGNUP_CLOSED,
} from '../app/utils/server/createProfile.ts';

const NOW = new Date('2026-10-17T15:00:00.000Z');

function harness(overrides: {
  exists?: boolean;
  signupEnabled?: boolean;
  authorization?: string | null;
  email?: string;
  body?: Record<string, unknown>;
} = {}) {
  const created: Array<{ uid: string; data: Record<string, unknown> }> = [];
  const verified: boolean[] = [];
  return {
    created,
    verified,
    run: () => handleCreateProfile({
      authorization: overrides.authorization === undefined ? 'Bearer token' : overrides.authorization,
      body: overrides.body ?? { name: 'New Rep', email: 'body-must-not-win@evil.test', requestedRole: 'manager' },
      signupEnabled: overrides.signupEnabled ?? true,
      deps: {
        verifyIdToken: async (_token, checkRevoked) => {
          verified.push(checkRevoked);
          return { uid: 'uid-new', email: overrides.email ?? 'real.rep@example.com' };
        },
        createUserDoc: async (uid, data) => {
          if (overrides.exists) throw new ProfileExistsError();
          created.push({ uid, data });
        },
        now: () => NOW,
        color: () => '#112233',
      },
    }),
  };
}

describe('create-profile', () => {
  it('creates a pending setter profile and takes email from the token', async () => {
    const test = harness();
    const result = await test.run();
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, { success: true, needsApproval: true, assignedRole: 'setter' });
    assert.equal(test.created.length, 1);
    assert.equal(test.created[0].uid, 'uid-new');
    assert.deepEqual(test.verified, [true]);
    assert.deepEqual(test.created[0].data, {
      id: 'uid-new',
      name: 'New Rep',
      email: 'real.rep@example.com',
      role: 'setter',
      requestedRole: 'manager',
      approved: false,
      approvalStatus: 'pending',
      approvalRequestedAt: NOW,
      createdAt: NOW,
      status: 'Pending Approval',
      isActive: false,
      color: '#112233',
    });
  });

  it('sanitizes an unknown requested role to setter', async () => {
    const test = harness({ body: { name: 'New Rep', requestedRole: 'owner' } });
    const result = await test.run();
    assert.equal(result.status, 200);
    assert.equal(test.created[0].data.requestedRole, 'setter');
    assert.equal(test.created[0].data.role, 'setter');
  });

  it('returns 409 when the user doc already exists and does not merge', async () => {
    const test = harness({ exists: true });
    const result = await test.run();
    assert.equal(result.status, 409);
    assert.deepEqual(result.body, { error: 'Account already exists' });
    assert.equal(test.created.length, 0);
  });

  it('returns 403 when self sign-up is disabled', async () => {
    const test = harness({ signupEnabled: false, authorization: null });
    const result = await test.run();
    assert.equal(result.status, 403);
    assert.deepEqual(result.body, { error: SELF_SIGNUP_CLOSED });
    assert.equal(test.created.length, 0);
    assert.equal(test.verified.length, 0);
  });
});
