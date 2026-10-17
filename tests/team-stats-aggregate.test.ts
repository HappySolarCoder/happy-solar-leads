import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregate,
  attributeLead,
  contribution,
  emptyCounters,
  isExcludedTestLead,
  isExcludedTestUser,
  resolveRange,
  TIME_RANGES,
  type Counters,
  type TimeRange,
} from '../app/utils/teamStats/aggregate.ts';
import { isExcludedTestLead as isExcludedTestLeadFromStats } from '../app/utils/server/allLeadsStats.ts';

const COUNTER_KEYS = [
  'knocks',
  'conversations',
  'appointments',
  'sales',
  'notHome',
  'notInterested',
  'goBacksScheduled',
  'goBacksConverted',
] as const;

function counters(partial: Partial<Counters> = {}): Counters {
  return { ...emptyCounters(), ...partial };
}

function lead(status: string, extra: Record<string, unknown> = {}) {
  return contribution('lead-1', {
    status,
    dispositionedAt: '2026-10-17T15:00:00.000Z',
    claimedBy: 'user-1',
    ...extra,
  });
}

describe('contribution status rules', () => {
  const cases: Array<{ status: string; expected: Partial<Counters> }> = [
    { status: 'not-home', expected: { knocks: 1, notHome: 1 } },
    { status: 'not-interested', expected: { knocks: 1, notInterested: 1, conversations: 1 } },
    { status: 'interested', expected: { knocks: 1, conversations: 1 } },
    { status: 'appointment', expected: { knocks: 1, appointments: 1, conversations: 1 } },
    { status: 'sale', expected: { knocks: 1, sales: 1, appointments: 1, conversations: 1 } },
    { status: 'go-back', expected: { knocks: 1 } },
    { status: 'house-for-sale', expected: { knocks: 1 } },
  ];

  for (const testCase of cases) {
    it(`counts ${testCase.status}`, () => {
      const row = lead(testCase.status);
      assert.ok(row);
      assert.equal(row.userId, 'user-1');
      assert.deepEqual(row.counters, counters(testCase.expected));
    });
  }

  it('ignores status case variants the page switch does not match', () => {
    const row = lead('Sale');
    assert.ok(row);
    assert.deepEqual(row.counters, counters({ knocks: 1 }));
  });
});

describe('attribution precedence', () => {
  it('prefers dispositionHistory[0].userId over claimedBy and assignedTo', () => {
    assert.equal(attributeLead({
      dispositionHistory: [{ userId: 'history-user' }, { userId: 'older' }],
      claimedBy: 'claimed-user',
      assignedTo: 'assigned-user',
    }), 'history-user');
  });

  it('falls through an empty history userId to claimedBy, then assignedTo', () => {
    assert.equal(attributeLead({
      dispositionHistory: [{ userId: '' }],
      claimedBy: 'claimed-user',
      assignedTo: 'assigned-user',
    }), 'claimed-user');
    assert.equal(attributeLead({
      dispositionHistory: [],
      claimedBy: '',
      assignedTo: 'assigned-user',
    }), 'assigned-user');
    assert.equal(attributeLead({ claimedBy: null, assignedTo: null }), null);
    assert.equal(attributeLead(undefined), null);
  });

  it('returns null from contribution when nobody can be attributed or there is no dispositionedAt', () => {
    assert.equal(contribution('lead-1', {
      status: 'sale',
      dispositionedAt: '2026-10-17T15:00:00.000Z',
    }), null);
    assert.equal(contribution('lead-1', {
      status: 'sale',
      claimedBy: 'user-1',
    }), null);
    assert.equal(contribution('lead-1', {
      status: 'sale',
      claimedBy: 'user-1',
      dispositionedAt: 'not-a-date',
    }), null);
  });

  it('reads a Firestore Timestamp dispositionedAt', () => {
    const row = contribution('lead-1', {
      status: 'interested',
      claimedBy: 'user-1',
      dispositionedAt: { toDate: () => new Date('2026-10-17T15:00:00.000Z') },
    });
    assert.ok(row);
    assert.equal(row.counters.conversations, 1);
  });
});

describe('go-back counters', () => {
  it('counts a go-back scheduled by the attributed user, and conversion only for appointment or sale', () => {
    const scheduled = lead('not-home', { goBackScheduledBy: 'user-1' });
    assert.ok(scheduled);
    assert.equal(scheduled.counters.goBacksScheduled, 1);
    assert.equal(scheduled.counters.goBacksConverted, 0);

    const converted = lead('appointment', { goBackScheduledBy: 'user-1' });
    assert.ok(converted);
    assert.equal(converted.counters.goBacksScheduled, 1);
    assert.equal(converted.counters.goBacksConverted, 1);
    assert.equal(converted.counters.appointments, 1);

    const sold = lead('sale', { goBackScheduledBy: 'user-1' });
    assert.ok(sold);
    assert.equal(sold.counters.goBacksConverted, 1);
    assert.equal(sold.counters.sales, 1);

    const interested = lead('interested', { goBackScheduledBy: 'user-1' });
    assert.ok(interested);
    assert.equal(interested.counters.goBacksScheduled, 1);
    assert.equal(interested.counters.goBacksConverted, 0);
  });

  it('does not credit a go-back scheduled by someone else', () => {
    const row = lead('sale', { goBackScheduledBy: 'other-user' });
    assert.ok(row);
    assert.equal(row.counters.goBacksScheduled, 0);
    assert.equal(row.counters.goBacksConverted, 0);
    assert.equal(row.counters.sales, 1);
  });

  it('uses the history user, not claimedBy, when deciding go-back credit', () => {
    const row = contribution('lead-1', {
      status: 'appointment',
      dispositionedAt: '2026-10-17T15:00:00.000Z',
      dispositionHistory: [{ userId: 'history-user' }],
      claimedBy: 'claimed-user',
      goBackScheduledBy: 'claimed-user',
    });
    assert.ok(row);
    assert.equal(row.userId, 'history-user');
    assert.equal(row.counters.goBacksScheduled, 0);
  });
});

describe('test lead and test user exclusion', () => {
  it('shares one isExcludedTestLead implementation with all-leads stats', () => {
    assert.equal(isExcludedTestLead, isExcludedTestLeadFromStats);
  });

  const excludedLeads: Array<{ id: string; data: Record<string, unknown> }> = [
    { id: 'TEST-appreview-ayu', data: { status: 'sale', claimedBy: 'user-1', dispositionedAt: '2026-10-17T15:00:00.000Z' } },
    { id: 'test-lower', data: { status: 'sale' } },
    { id: 'Test-mixed', data: { status: 'sale' } },
    { id: 'real-1', data: { testData: true } },
    { id: 'real-2', data: { testData: 'true' } },
    { id: 'real-3', data: { testData: 1 } },
    { id: 'real-4', data: { testData: '1' } },
    { id: 'real-5', data: { testData: 'yes' } },
    { id: 'real-6', data: { meta: { testData: true } } },
    { id: 'real-7', data: { isTestAccount: 'YES' } },
    { id: 'real-8', data: { owner: { isTestAccount: 1 } } },
  ];

  const keptLeads: Array<{ id: string; data: Record<string, unknown> }> = [
    { id: 'lead-real', data: { testData: false } },
    { id: 'TESTIMONIAL', data: { status: 'sale' } },
    { id: 'tester', data: { isTestAccount: 0 } },
    { id: 'nested-false', data: { meta: { testData: false, isTestAccount: null } } },
  ];

  it('drops TEST- ids, including TEST-appreview-*, and truthy test flags', () => {
    for (const doc of excludedLeads) assert.equal(isExcludedTestLead(doc.id, doc.data), true, doc.id);
    for (const doc of keptLeads) assert.equal(isExcludedTestLead(doc.id, doc.data), false, doc.id);
    assert.equal(contribution('TEST-appreview-1', {
      status: 'sale',
      dispositionedAt: '2026-10-17T15:00:00.000Z',
      claimedBy: 'user-1',
    }), null);
  });

  it('drops team TEST exactly, TEST- user ids, and truthy user flags, and keeps Testing', () => {
    assert.equal(isExcludedTestUser('ayuRSQAI8Tckd7HfFCr96rdBd633', { team: 'TEST' }), true);
    assert.equal(isExcludedTestUser('user-1', { team: 'test' }), true);
    assert.equal(isExcludedTestUser('user-1', { team: ' Test ' }), true);
    assert.equal(isExcludedTestUser('user-1', { team: 'Testing' }), false);
    assert.equal(isExcludedTestUser('user-1', { team: 'TEST TEAM' }), false);
    assert.equal(isExcludedTestUser('user-1', { team: 'Buffalo' }), false);
    assert.equal(isExcludedTestUser('TEST-appreview', { team: 'Buffalo' }), true);
    assert.equal(isExcludedTestUser('test-lower', { team: 'Rochester' }), true);
    assert.equal(isExcludedTestUser('user-1', { team: 'Buffalo', isTestAccount: true }), true);
    assert.equal(isExcludedTestUser('user-1', { team: 'Buffalo', testData: 'yes' }), true);
    assert.equal(isExcludedTestUser('user-1', { team: 'Buffalo', profile: { isTestAccount: '1' } }), true);
    assert.equal(isExcludedTestUser('user-1', { team: 'Buffalo', isTestAccount: false, testData: 0 }), false);
  });

  it('leaves excluded users out of setters and totals', () => {
    const rows = [
      { id: 'lead-a', data: { status: 'sale', dispositionedAt: '2026-10-17T15:00:00.000Z', claimedBy: 'setter-a' } },
      { id: 'lead-b', data: { status: 'not-home', dispositionedAt: '2026-10-17T15:00:00.000Z', claimedBy: 'setter-test' } },
      { id: 'TEST-appreview-9', data: { status: 'appointment', dispositionedAt: '2026-10-17T15:00:00.000Z', claimedBy: 'setter-a' } },
    ];
    const result = aggregate(rows, new Set(['setter-test']));
    assert.deepEqual(result.setters.map((setter) => setter.userId), ['setter-a']);
    assert.equal(result.totals.knocks, 1);
    assert.equal(result.totals.sales, 1);
    assert.equal(result.totals.appointments, 1);
    assert.equal(result.setters[0].knocks, 1);
  });
});

describe('resolveRange', () => {
  const oct17 = new Date('2026-10-17T15:00:00.000Z');
  const nov1 = new Date('2026-11-01T15:00:00.000Z');
  const nov2 = new Date('2026-11-02T15:00:00.000Z');
  const nov8 = new Date('2026-11-08T15:00:00.000Z');
  const monday = new Date('2026-10-19T15:00:00.000Z');

  function window(range: TimeRange, tz: string, now: Date) {
    const resolved = resolveRange(range, tz, now);
    assert.equal(resolved.ok, true);
    if (!resolved.ok) throw new Error('unreachable');
    return {
      from: resolved.from?.toISOString() ?? null,
      to: resolved.to?.toISOString() ?? null,
    };
  }

  const nyOct17: Record<TimeRange, { from: string | null; to: string | null }> = {
    today: { from: '2026-10-17T04:00:00.000Z', to: null },
    yesterday: { from: '2026-10-16T04:00:00.000Z', to: '2026-10-17T04:00:00.000Z' },
    last7days: { from: '2026-10-10T15:00:00.000Z', to: null },
    thisweek: { from: '2026-10-11T04:00:00.000Z', to: null },
    lastweek: { from: '2026-10-04T04:00:00.000Z', to: null },
    thismonth: { from: '2026-10-01T04:00:00.000Z', to: null },
    lastmonth: { from: '2026-09-01T04:00:00.000Z', to: '2026-10-01T04:00:00.000Z' },
    all: { from: null, to: null },
  };

  const phxOct17: Record<TimeRange, { from: string | null; to: string | null }> = {
    today: { from: '2026-10-17T07:00:00.000Z', to: null },
    yesterday: { from: '2026-10-16T07:00:00.000Z', to: '2026-10-17T07:00:00.000Z' },
    last7days: { from: '2026-10-10T15:00:00.000Z', to: null },
    thisweek: { from: '2026-10-11T07:00:00.000Z', to: null },
    lastweek: { from: '2026-10-04T07:00:00.000Z', to: null },
    thismonth: { from: '2026-10-01T07:00:00.000Z', to: null },
    lastmonth: { from: '2026-09-01T07:00:00.000Z', to: '2026-10-01T07:00:00.000Z' },
    all: { from: null, to: null },
  };

  for (const range of TIME_RANGES) {
    it(`${range} in America/New_York on 2026-10-17`, () => {
      assert.deepEqual(window(range, 'America/New_York', oct17), nyOct17[range]);
    });

    it(`${range} in America/Phoenix on 2026-10-17`, () => {
      assert.deepEqual(window(range, 'America/Phoenix', oct17), phxOct17[range]);
    });
  }

  it('keeps last7days rolling and identical in both zones', () => {
    assert.equal(window('last7days', 'America/New_York', oct17).from, window('last7days', 'America/Phoenix', oct17).from);
  });

  it('starts the week on Sunday, including the Monday after', () => {
    assert.equal(window('thisweek', 'America/New_York', monday).from, '2026-10-18T04:00:00.000Z');
    assert.notEqual(window('thisweek', 'America/New_York', monday).from, '2026-10-19T04:00:00.000Z');
  });

  it('handles the 2026-11-01 DST fallback in New York and ignores it in Phoenix', () => {
    assert.equal(window('today', 'America/New_York', nov1).from, '2026-11-01T04:00:00.000Z');
    assert.equal(window('thisweek', 'America/New_York', nov1).from, '2026-11-01T04:00:00.000Z');
    assert.equal(window('today', 'America/Phoenix', nov1).from, '2026-11-01T07:00:00.000Z');
    assert.equal(window('thisweek', 'America/Phoenix', nov1).from, '2026-11-01T07:00:00.000Z');
    assert.equal(window('yesterday', 'America/New_York', nov2).from, '2026-11-01T05:00:00.000Z');
    assert.equal(window('yesterday', 'America/New_York', nov2).to, '2026-11-02T05:00:00.000Z');
    assert.equal(window('thisweek', 'America/New_York', nov8).from, '2026-11-08T05:00:00.000Z');
    assert.equal(window('lastweek', 'America/New_York', nov8).from, '2026-11-01T05:00:00.000Z');
    assert.equal(window('today', 'America/Phoenix', nov2).from, '2026-11-02T07:00:00.000Z');
  });

  it('defaults a missing time zone to America/New_York and rejects bad range or tz', () => {
    const fallback = resolveRange('today', null, oct17);
    assert.equal(fallback.ok, true);
    if (fallback.ok) {
      assert.equal(fallback.tz, 'America/New_York');
      assert.equal(fallback.from?.toISOString(), '2026-10-17T04:00:00.000Z');
    }
    assert.equal(resolveRange('today', '   ', oct17).ok, true);
    assert.equal(resolveRange('nope', 'America/New_York', oct17).ok, false);
    assert.equal(resolveRange('', 'America/New_York', oct17).ok, false);
    assert.equal(resolveRange('today', 'Not/AZone', oct17).ok, false);
  });

  it('exposes every counter key', () => {
    assert.deepEqual(Object.keys(emptyCounters()).sort(), [...COUNTER_KEYS].sort());
  });
});
