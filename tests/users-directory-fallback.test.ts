import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { User } from '../app/types/index.ts';
import { isPermissionDenied, rosterOnDirectoryError } from '../app/utils/usersDirectory.ts';

const sessionUser = {
  id: 'demo',
  name: 'App Review',
  email: 'demo@example.com',
  color: '#abcdef',
  role: 'setter',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
} as User;

describe('rosterOnDirectoryError', () => {
  it('returns the session user on permission-denied and does not use a stale roster', () => {
    const cached = [{ ...sessionUser, id: 'someone-else', name: 'Other' }];
    const fallback = rosterOnDirectoryError({ code: 'permission-denied' }, sessionUser, cached);
    assert.deepEqual(fallback.map((user) => user.id), ['demo']);
  });

  it('accepts the namespaced Firestore permission code', () => {
    assert.equal(isPermissionDenied({ code: 'firestore/permission-denied' }), true);
    const fallback = rosterOnDirectoryError(
      { code: 'firestore/permission-denied' },
      sessionUser,
      [],
    );
    assert.equal(fallback[0]?.id, 'demo');
  });

  it('returns the cache for other failures and an empty list when there is no session', () => {
    const cached = [sessionUser];
    assert.deepEqual(rosterOnDirectoryError({ code: 'unavailable' }, sessionUser, cached), cached);
    assert.deepEqual(rosterOnDirectoryError({ code: 'permission-denied' }, null, cached), cached);
    assert.deepEqual(rosterOnDirectoryError(new Error('boom'), null, null), []);
  });
});
