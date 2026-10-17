import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildStatsLeadQuery,
  handleAllLeadsStats,
  isExcludedTestLead,
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

  it('clamps a manager since date older than 62 days', async () => {
    const test = statsHarness('manager', '1970-01-01');
    const result = await test.run();
    assert.equal(result.status, 200);
    assert.equal(test.bounds.length, 1);
    assert.equal(test.bounds[0]!.getTime(), NOW.getTime() - STATS_WINDOW_MS);
  });

  it('keeps a manager since date inside the 62-day window', async () => {
    const recent = '2026-10-01T00:00:00.000Z';
    const test = statsHarness('manager', recent);
    const result = await test.run();
    assert.equal(result.status, 200);
    assert.equal(test.bounds[0]!.toISOString(), recent);
  });

  it('falls back to 62 days when a manager since date is invalid', async () => {
    const test = statsHarness('manager', 'not-a-date');
    const result = await test.run();
    assert.equal(result.status, 200);
    assert.equal(test.bounds[0]!.getTime(), NOW.getTime() - STATS_WINDOW_MS);
  });

  it('leaves an admin since date outside the window unchanged', async () => {
    const test = statsHarness('admin', '1970-01-01');
    const result = await test.run();
    assert.equal(result.status, 200);
    assert.equal(test.bounds[0]!.toISOString(), new Date('1970-01-01').toISOString());
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
    assert.equal(STATS_SELECT_FIELDS.includes('testData'), true);
    assert.equal(STATS_SELECT_FIELDS.includes('isTestAccount'), true);
  });
});

describe('test lead exclusion', () => {
  const excluded: Array<{ id: string; data: Record<string, unknown> }> = [
    { id: 'testData-true', data: { status: 'appointment', testData: true } },
    { id: 'testData-true-string', data: { status: 'appointment', testData: 'true' } },
    { id: 'testData-1', data: { status: 'appointment', testData: 1 } },
    { id: 'testData-1-string', data: { status: 'appointment', testData: '1' } },
    { id: 'testData-yes', data: { status: 'appointment', testData: 'yes' } },
    { id: 'testData-nested-true', data: { status: 'appointment', meta: { testData: true } } },
    { id: 'testData-nested-true-string', data: { account: { profile: { testData: 'true' } } } },
    { id: 'testData-nested-1', data: { visits: [{ testData: 1 }] } },
    { id: 'testData-nested-1-string', data: { wrap: { testData: '1' } } },
    { id: 'testData-nested-yes', data: { wrap: { inner: { testData: 'yes' } } } },
    { id: 'isTestAccount-true', data: { isTestAccount: true } },
    { id: 'isTestAccount-true-string', data: { isTestAccount: 'true' } },
    { id: 'isTestAccount-1', data: { isTestAccount: 1 } },
    { id: 'isTestAccount-1-string', data: { isTestAccount: '1' } },
    { id: 'isTestAccount-yes', data: { isTestAccount: 'yes' } },
    { id: 'isTestAccount-nested', data: { owner: { isTestAccount: true } } },
    { id: 'TEST-upper', data: { status: 'sale', testData: false } },
    { id: 'test-lower', data: { status: 'sale' } },
    { id: 'Test-mixed', data: { status: 'sale' } },
  ];

  const kept: Array<{ id: string; data: Record<string, unknown> }> = [
    { id: 'lead-real', data: { status: 'appointment', claimedBy: 'rep-1' } },
    { id: 'testData-false', data: { status: 'knock', testData: false } },
    { id: 'testData-zero', data: { status: 'knock', testData: 0 } },
    { id: 'testData-null', data: { status: 'knock', testData: null } },
    { id: 'testData-nested-false', data: { meta: { testData: false } } },
    { id: 'isTestAccount-false', data: { isTestAccount: false } },
    { id: 'isTestAccount-zero', data: { isTestAccount: 0 } },
    { id: 'isTestAccount-null', data: { isTestAccount: null } },
    { id: 'TESTIMONIAL', data: { status: 'appointment', testData: null } },
  ];

  it('classifies every test variant as excluded and every control as kept', () => {
    for (const doc of excluded) {
      assert.equal(isExcludedTestLead(doc.id, doc.data), true, doc.id);
    }
    for (const doc of kept) {
      assert.equal(isExcludedTestLead(doc.id, doc.data), false, doc.id);
    }
  });

  it('drops test leads from the stats response and keeps real leads unchanged', async () => {
    const result = await handleAllLeadsStats({
      authorization: 'Bearer token',
      sinceParam: null,
      deps: {
        ...authDeps('manager'),
        now: () => NOW,
        loadLeads: async () => [richLead, ...kept, ...excluded],
      },
    });

    assert.equal(result.status, 200);
    assert.ok('leads' in result.body);
    assert.deepEqual(
      result.body.leads.map((lead) => lead.id),
      [richLead.id, ...kept.map((doc) => doc.id)],
    );

    const real = result.body.leads[0];
    assert.equal(real.status, 'appointment');
    assert.equal(Object.hasOwn(real, 'testData'), false);
    assert.equal(Object.hasOwn(real, 'isTestAccount'), false);
    assert.equal(Object.hasOwn(real, 'name'), false);

    const falseFlag = result.body.leads.find((lead) => lead.id === 'testData-false');
    assert.ok(falseFlag);
    assert.equal(falseFlag.status, 'knock');
    assert.deepEqual(Object.keys(falseFlag).sort(), [
      'assignedTo',
      'claimedBy',
      'dispositionHistory',
      'dispositionedAt',
      'goBackScheduledBy',
      'id',
      'status',
    ]);
  });
});
