import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAssignableUsersFromPageData,
  loadUsersWithRosterRetry,
} from '../app/utils/assignableUsersFallback.ts';
import type { Lead, User } from '../app/types/index.ts';
import type { Territory } from '../app/types/territory.ts';

function user(partial: Partial<User> & { id: string; name: string }): User {
  return {
    email: `${partial.id}@example.com`,
    color: '#111111',
    role: 'setter',
    createdAt: new Date('2026-01-01'),
    isActive: true,
    ...partial,
  };
}

describe('buildAssignableUsersFromPageData', () => {
  const currentUser = user({ id: 'admin-1', name: 'Charles', role: 'admin' });

  it('includes currentUser, unique territory owners, and pin assignees/claimers', () => {
    const territories: Territory[] = [
      {
        id: 't1',
        userId: 'setter-1',
        userName: 'Alex',
        userColor: '#ff0000',
        polygon: [],
        leadIds: [],
        createdAt: new Date('2026-02-01'),
        createdBy: 'admin-1',
      },
      {
        id: 't2',
        userId: 'setter-1',
        userName: 'Alex Duplicate',
        userColor: '#00ff00',
        polygon: [],
        leadIds: [],
        createdAt: new Date('2026-02-02'),
        createdBy: 'admin-1',
      },
    ];
    const pins = [
      {
        id: 'lead-1',
        assignedTo: 'setter-2',
        claimedBy: 'setter-3',
        dispositionHistory: [{ userId: 'setter-2', userName: 'Blake' }],
      },
      {
        id: 'lead-2',
        assignedTo: 'admin-1',
        claimedBy: 'setter-1',
      },
    ] as Lead[];

    const roster = buildAssignableUsersFromPageData(currentUser, territories, pins);
    const ids = roster.map(u => u.id).sort();
    assert.deepEqual(ids, ['admin-1', 'setter-1', 'setter-2', 'setter-3']);
    assert.equal(roster.find(u => u.id === 'setter-1')?.name, 'Alex');
    assert.equal(roster.find(u => u.id === 'setter-2')?.name, 'Blake');
    assert.equal(roster.find(u => u.id === 'setter-3')?.name, 'setter-3');
  });

  it('does not fetch or invent users beyond page data', () => {
    const roster = buildAssignableUsersFromPageData(null, [], []);
    assert.deepEqual(roster, []);
  });

  it('marks stub users active so isActive !== false does not wipe the fallback', () => {
    const roster = buildAssignableUsersFromPageData(
      null,
      [{
        id: 't1',
        userId: 'setter-1',
        userName: 'Alex',
        userColor: '#ff0000',
        polygon: [],
        leadIds: [],
        createdAt: new Date('2026-02-01'),
        createdBy: 'admin-1',
      }],
      [],
    );
    assert.equal(roster[0]?.isActive, true);
  });
});

describe('loadUsersWithRosterRetry', () => {
  const alex = user({ id: 'u1', name: 'Alex' });

  it('returns getUsersAsync when it already has names (no retry)', async () => {
    let retries = 0;
    const result = await loadUsersWithRosterRetry(
      async () => [alex],
      async () => {
        retries += 1;
        return [user({ id: 'u2', name: 'Blake' })];
      },
    );
    assert.equal(retries, 0);
    assert.equal(result.users[0]?.id, 'u1');
    assert.equal(result.error, null);
  });

  it('retries getAllUsers once when getUsersAsync returns []', async () => {
    let retries = 0;
    const result = await loadUsersWithRosterRetry(
      async () => [],
      async () => {
        retries += 1;
        return [alex];
      },
    );
    assert.equal(retries, 1);
    assert.equal(result.users[0]?.id, 'u1');
    assert.equal(result.error, null);
  });

  it('retries getAllUsers when getUsersAsync throws, then surfaces getAllUsers failure', async () => {
    const result = await loadUsersWithRosterRetry(
      async () => {
        throw new Error('pre-auth empty');
      },
      async () => {
        throw new Error('Firestore not initialized');
      },
    );
    assert.deepEqual(result.users, []);
    assert.equal(result.error, 'Firestore not initialized');
  });

  it('clears the first-call error when getAllUsers retry returns names', async () => {
    const result = await loadUsersWithRosterRetry(
      async () => {
        throw new Error('cached empty');
      },
      async () => [alex],
    );
    assert.equal(result.users[0]?.id, 'u1');
    assert.equal(result.error, null);
  });
});
