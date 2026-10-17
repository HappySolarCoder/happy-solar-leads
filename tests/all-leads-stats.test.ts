import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildStatsLeadQuery,
  handleAllLeadsStats,
  STATS_SELECT_FIELDS,
  STATS_WINDOW_MS,
} from '../app/utils/server/allLeadsStats.ts';
import type { RequireApprovedUserDeps } from '../app/utils/server/requireApprovedUser.ts';

const NOW = new Date('2026-10-17T12:00:00.000Z');
const PII = ['name', 'address', 'phone', 'email', 'lat', 'lng', 'notes', 'city', 'state', 'zip'];

const richLead = {
  id: 'lead-1',
  data: {
    name: 'Hidden Homeowner',
    address: '123 Secret St',
    city: 'Phoenix',
    state: 'AZ',
    zip: '85001',
    phone: '555-0100',
    email: 'hidden@example.com',
    lat: 33.4,
    lng: -112.1,
    notes: 'private note',
    status: 'appointment',
    dispositionedAt: { toDate: () => new Date('2026-10-01T00:00:00.000Z') },
    claimedBy: 'rep-1',
    assignedTo: 'rep-2',
    goBackScheduledBy: 'rep-1',
    dispositionHistory: [
      { userId: 'rep-1', userName: 'Hidden Homeowner', notes: 'full history note', phone: '555-0100' },
      { userId: 'someone-else', userName: 'Second', notes: 'older note' },
    ],
  },
};

function authDeps(role: string, flags: Record<string, unknown> = {}): RequireApprovedUserDeps {
  return {
    verifyIdToken: async () => ({ uid: 'uid-' + role, email: role + '@example.com' }),
    getUser: async () => ({
      exists: true,
      data: { role, approved: true, isActive: true, approvalStatus: 'approved', ...flags },
    }),
  };
}

function statsHarness(role: string, sinceParam: string | null, flags: Record<string, unknown> = {}) {
  const bounds: Array<Date | null> = [];
  return {
    bounds,
    run: () => handleAllLeadsStats({
      authorization: 'Bearer token',
      sinceParam,
      deps: {
        ...authDeps(role, flags),
        now: () => NOW,
        loadLeads: async (bound) => {
          bounds.push(bound);
          return [richLead];
        },
      },
    }),
  };
}

describe('all-leads stats access', () => {
  it('returns 403 for a setter or closer', async () => {
    for (const role of ['setter', 'closer']) {
      const test = statsHarness(role, null);
      const result = await test.run();
      assert.equal(result.status, 403);
      assert.equal(test.bounds.length, 0);
      assert.equal('leads' in result.body, false);
    }
  });

  it('returns 200 for a manager or admin with no PII fields', async () => {
    for (const role of ['manager', 'admin']) {
      const test = statsHarness(role, null);
      const result = await test.run();
      assert.equal(result.status, 200);
      assert.ok('leads' in result.body);
      const lead = result.body.leads[0];
      assert.deepEqual(Object.keys(lead).sort(), [
        'assignedTo',
        'claimedBy',
        'dispositionHistory',
        'dispositionedAt',
        'goBackScheduledBy',
        'id',
        'status',
      ]);
      assert.equal(lead.status, 'appointment');
      assert.equal(lead.dispositionedAt, '2026-10-01T00:00:00.000Z');
      assert.deepEqual(lead.dispositionHistory, [{ userId: 'rep-1' }]);
      assert.deepEqual(Object.keys(lead.dispositionHistory[0]), ['userId']);
      const serialized = JSON.stringify(result.body);
      for (const field of ['Hidden Homeowner', '123 Secret St', '555-0100', 'hidden@example.com', 'private note', 'full history note', 'older note']) {
        assert.equal(serialized.includes(field), false, field);
      }
      for (const key of PII) assert.equal(Object.hasOwn(lead, key), false);
    }
  });

  it('uses a 62-day bound when since is omitted', async () => {
    const test = statsHarness('manager', null);
    const result = await test.run();
    assert.equal(result.status, 200);
    assert.equal(test.bounds.length, 1);
    assert.ok(test.bounds[0] instanceof Date);
    assert.equal(test.bounds[0]!.getTime(), NOW.getTime() - STATS_WINDOW_MS);
    assert.equal(STATS_WINDOW_MS, 62 * 24 * 60 * 60 * 1000);
  });

  it('lets only an admin skip the bound with since=all', async () => {
    const manager = statsHarness('manager', 'all');
    const managerResult = await manager.run();
    assert.equal(managerResult.status, 403);
    assert.equal(manager.bounds.length, 0);

    const admin = statsHarness('admin', 'all');
    const adminResult = await admin.run();
    assert.equal(adminResult.status, 200);
    assert.deepEqual(admin.bounds, [null]);
  });
});

describe('buildStatsLeadQuery', () => {
  it('selects only the non-PII stats fields and applies the since bound', () => {
    const calls: unknown[][] = [];
    const query = {
      where(field: string, op: string, value: unknown) {
        calls.push(['where', field, op, value]);
        return query;
      },
      select(...fields: string[]) {
        calls.push(['select', ...fields]);
        return query;
      },
    };
    const bound = new Date('2026-08-16T12:00:00.000Z');
    buildStatsLeadQuery(query, bound);
    assert.deepEqual(calls, [
      ['where', 'dispositionedAt', '>=', bound],
      ['select', ...STATS_SELECT_FIELDS],
    ]);
    for (const key of PII) assert.equal(STATS_SELECT_FIELDS.includes(key as never), false);

    calls.length = 0;
    buildStatsLeadQuery(query, null);
    assert.deepEqual(calls, [['select', ...STATS_SELECT_FIELDS]]);
  });
});
