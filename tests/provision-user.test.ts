import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import {
  handleProvisionPost,
  secretsMatch,
  type ProvisionDeps,
} from '../app/utils/provisionUser.ts';
import { validatePasswordChange } from '../app/utils/passwordChange.ts';

const SECRET = 'provision-test-secret';
const TEMP_PASSWORD = 'TempPass-should-not-be-logged';
const NOW = new Date('2026-10-06T16:00:00.000Z');

function body(overrides: Record<string, unknown> = {}) {
  return {
    email: 'New.Rep@Example.com',
    firstName: 'Evan',
    lastName: 'Day',
    role: 'FMA',
    territory: 'Rochester',
    tempPassword: TEMP_PASSWORD,
    ...overrides,
  };
}

function deps(partial: Partial<ProvisionDeps> = {}): ProvisionDeps & {
  calls: { create: unknown[]; set: unknown[]; deleted: string[] };
} {
  const calls = { create: [] as unknown[], set: [] as unknown[], deleted: [] as string[] };
  return {
    calls,
    getUserByEmail: async () => null,
    getProfileExists: async () => false,
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

describe('provision authorization', () => {
  it('rejects a missing, malformed, or wrong bearer token', async () => {
    const harness = deps();
    const cases = [null, '', 'Basic ' + SECRET, 'Bearer wrong-secret', 'Bearer ' + SECRET + ' extra'];
    for (const authorization of cases) {
      const result = await handleProvisionPost({
        authorization,
        secret: SECRET,
        body: body(),
        deps: harness,
      });
      assert.equal(result.status, 401);
      assert.deepEqual(result.body, { error: 'Unauthorized' });
    }
    assert.equal(harness.calls.create.length, 0);
    assert.equal(harness.calls.set.length, 0);
  });

  it('rejects every caller when the secret is not configured', async () => {
    const harness = deps();
    const result = await handleProvisionPost({
      authorization: 'Bearer ' + SECRET,
      secret: undefined,
      body: body(),
      deps: harness,
    });
    assert.equal(result.status, 401);
    assert.equal(harness.calls.create.length, 0);
  });

  it('compares secrets without caring about length', () => {
    assert.equal(secretsMatch(SECRET, SECRET), true);
    assert.equal(secretsMatch('short', SECRET), false);
    assert.equal(secretsMatch(SECRET + SECRET, SECRET), false);
  });
});

describe('POST /api/admin/provision-user auth rejection', () => {
  const original = process.env.RAYDAR_PROVISION_SECRET;

  beforeEach(() => {
    delete process.env.RAYDAR_PROVISION_SECRET;
  });

  afterEach(() => {
    if (original === undefined) delete process.env.RAYDAR_PROVISION_SECRET;
    else process.env.RAYDAR_PROVISION_SECRET = original;
  });

  it('returns 401 from the route and does not log the password', async () => {
    process.env.RAYDAR_PROVISION_SECRET = SECRET;
    const logs: string[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      logs.push(args.map((arg) => String(arg)).join(' '));
    };
    try {
      const { POST } = await import('../app/api/admin/provision-user/route.ts');
      const request = new NextRequest('http://localhost/api/admin/provision-user', {
        method: 'POST',
        headers: {
          authorization: 'Bearer not-the-secret',
          'content-type': 'application/json',
        },
        body: JSON.stringify(body()),
      });
      const response = await POST(request);
      assert.equal(response.status, 401);
      const payload = await response.json();
      assert.deepEqual(payload, { error: 'Unauthorized' });
      assert.equal(logs.some((line) => line.includes(TEMP_PASSWORD)), false);
    } finally {
      console.error = originalError;
    }
  });
});

describe('provision create and idempotent re-create', () => {
  it('creates the auth user and the same profile admins save for a field rep', async () => {
    const harness = deps();
    const logs: string[] = [];
    const originalLog = console.log;
    const originalError = console.error;
    console.log = (...args: unknown[]) => logs.push(args.map(String).join(' '));
    console.error = (...args: unknown[]) => logs.push(args.map(String).join(' '));
    try {
      const result = await handleProvisionPost({
        authorization: `Bearer ${SECRET}`,
        secret: SECRET,
        body: body(),
        deps: harness,
        logger: (message) => logs.push(message),
      });
      assert.equal(result.status, 200);
      assert.deepEqual(result.body, { uid: 'uid-created', created: true });
      assert.equal(harness.calls.create.length, 1);
      assert.deepEqual(harness.calls.create[0], {
        email: 'new.rep@example.com',
        password: TEMP_PASSWORD,
        displayName: 'Evan Day',
      });
      assert.deepEqual(harness.calls.set[0], {
        uid: 'uid-created',
        data: {
          id: 'uid-created',
          name: 'Evan Day',
          email: 'new.rep@example.com',
          role: 'setter',
          requestedRole: 'setter',
          approved: true,
          approvalStatus: 'approved',
          createdAt: NOW,
          status: 'active',
          isActive: true,
          color: '#112233',
          mustChangePassword: true,
          territory: 'Rochester',
        },
      });
      assert.equal(logs.some((line) => line.includes(TEMP_PASSWORD)), false);
    } finally {
      console.log = originalLog;
      console.error = originalError;
    }
  });

  it('returns the existing uid and does not change the password when the email exists', async () => {
    let passwordWrites = 0;
    const harness = deps({
      getUserByEmail: async () => ({ uid: 'uid-existing' }),
      getProfileExists: async () => true,
      createUser: async () => {
        passwordWrites += 1;
        throw new Error('createUser must not run for an existing email');
      },
    });
    const result = await handleProvisionPost({
      authorization: `Bearer ${SECRET}`,
      secret: SECRET,
      body: body({ tempPassword: 'Different-Temp-9' }),
      deps: harness,
    });
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, { uid: 'uid-existing', created: false });
    assert.equal(passwordWrites, 0);
    assert.equal(harness.calls.set.length, 0);
    assert.equal(harness.calls.deleted.length, 0);
  });

  it('treats an email-already-exists race as an idempotent re-create', async () => {
    let lookups = 0;
    const harness = deps({
      getUserByEmail: async () => {
        lookups += 1;
        return lookups === 1 ? null : { uid: 'uid-race' };
      },
      getProfileExists: async () => true,
      createUser: async () => {
        throw Object.assign(new Error('exists'), { code: 'auth/email-already-exists' });
      },
    });
    const result = await handleProvisionPost({
      authorization: `Bearer ${SECRET}`,
      secret: SECRET,
      body: body(),
      deps: harness,
    });
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, { uid: 'uid-race', created: false });
    assert.equal(harness.calls.set.length, 0);
  });

  it('does not include the password when creation fails', async () => {
    const logs: string[] = [];
    const harness = deps({
      createUser: async () => {
        throw Object.assign(new Error(`boom ${TEMP_PASSWORD}`), { code: 'auth/internal-error' });
      },
    });
    const result = await handleProvisionPost({
      authorization: `Bearer ${SECRET}`,
      secret: SECRET,
      body: body(),
      deps: harness,
      logger: (message) => logs.push(message),
    });
    assert.equal(result.status, 500);
    assert.deepEqual(result.body, { error: 'Internal error' });
    assert.equal(JSON.stringify(result).includes(TEMP_PASSWORD), false);
    assert.equal(logs.join('\n').includes(TEMP_PASSWORD), false);
    assert.equal(harness.calls.set.length, 0);
  });
});

describe('validatePasswordChange', () => {
  it('requires 8 characters and a matching confirmation', () => {
    assert.equal(validatePasswordChange({ currentPassword: '', newPassword: '12345678', confirmPassword: '12345678' }), 'Enter your current password.');
    assert.equal(validatePasswordChange({ currentPassword: 'old-pass', newPassword: 'short', confirmPassword: 'short' }), 'New password must be at least 8 characters.');
    assert.equal(validatePasswordChange({ currentPassword: 'old-pass', newPassword: 'long-enough', confirmPassword: 'different' }), 'New password and confirmation do not match.');
    assert.equal(validatePasswordChange({ currentPassword: 'long-enough', newPassword: 'long-enough', confirmPassword: 'long-enough' }), 'New password must be different from your current password.');
    assert.equal(validatePasswordChange({ currentPassword: 'old-password', newPassword: 'new-password', confirmPassword: 'new-password' }), null);
  });
});
