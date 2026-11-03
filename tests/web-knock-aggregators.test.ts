import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Lead } from '../app/types/index.ts';
import type { Disposition } from '../app/types/disposition.ts';
import { calculateDailyMetrics } from '../app/utils/aiManager.ts';
import { phoenixDayWindow } from '../app/utils/phoenixDay.ts';
import {
  activityKnocksByUser,
  countDashboardKnocks,
  countMonthlyKnocks,
  countSetterKnocks,
  knockIndex,
  mergeSetterKnockCounts,
  teamMapStats,
} from '../app/utils/webKnockCounts.ts';

const epoch = new Date(0);

function dispo(id: string, name: string, countsAsDoorKnock = true): Disposition {
  return {
    id,
    name,
    countsAsDoorKnock,
    color: '#000000',
    icon: 'circle',
    order: 0,
    isDefault: true,
    createdAt: epoch,
    updatedAt: epoch,
  };
}

const DISPOSITIONS = [
  dispo('not-home', 'Not Home'),
  dispo('interested', 'Interested'),
  dispo('not-interested', 'Not Interested'),
  dispo('appointment', 'Appointment Set'),
  dispo('go-back', 'Go Back'),
  dispo('golden-home', 'Golden Home'),
  dispo('top-10', 'Top 10'),
  dispo('call-scheduling-manager', 'Call Scheduling Manager'),
  dispo('spoke-with-non-homeowner', 'Spoke with Non Homeowner '),
  dispo('shade-dq', 'Shade DQ', false),
  dispo('has-solar', 'Has Solar', false),
  dispo('claimed', 'My Targets', false),
  dispo('unclaimed', 'Available', false),
];

function lead(id: string, patch: Partial<Lead> = {}): Lead {
  return {
    id,
    name: 'Door',
    address: '1 Test',
    city: 'Phoenix',
    state: 'AZ',
    zip: '85001',
    status: 'assigned',
    createdAt: new Date(2026, 10, 1),
    ...patch,
  };
}

function visit(disposition: string, at: Date, userId: string, eventId?: string) {
  return {
    disposition,
    timestamp: at,
    userId,
    userName: 'Rep',
    ...(eventId ? { field: { eventId } } : {}),
  } as NonNullable<Lead['dispositionHistory']>[number];
}

const utc = (iso: string) => new Date(iso);

describe('monthly goal knocks', () => {
  const november = utc('2026-11-15T19:00:00.000Z');

  it('counts every Phoenix-month visit for that rep and ignores Shade DQ and Has Solar', () => {
    const row = lead('door', {
      status: 'shade-dq',
      claimedBy: 'u2',
      dispositionedAt: utc('2026-12-02T19:00:00.000Z'),
      dispositionHistory: [
        visit('Shade DQ', utc('2026-12-02T19:00:00.000Z'), 'u2'),
        visit('Has Solar', utc('2026-11-20T19:00:00.000Z'), 'u1'),
        visit('Not Home', utc('2026-11-04T19:00:00.000Z'), 'u1', 'a'),
        visit('Not Home', utc('2026-11-03T19:00:00.000Z'), 'u1', 'b'),
        visit('Golden Home', utc('2026-10-30T19:00:00.000Z'), 'u1'),
      ],
    });
    assert.equal(countMonthlyKnocks([row], DISPOSITIONS, 'u1', november), 2);
    assert.equal(countMonthlyKnocks([row], DISPOSITIONS, 'u2', november), 0);
  });

  it('includes Phoenix midnight and excludes the next month', () => {
    const row = lead('edges', {
      dispositionHistory: [
        visit('Not Home', utc('2026-11-01T07:00:00.000Z'), 'u1', 'a'),
        visit('Not Home', utc('2026-12-01T06:59:59.999Z'), 'u1', 'b'),
        visit('Not Home', utc('2026-12-01T07:00:00.000Z'), 'u1', 'c'),
      ],
    });
    assert.equal(countMonthlyKnocks([row], DISPOSITIONS, 'u1', november), 2);
  });
});

describe('dashboard knocks', () => {
  const now = utc('2026-11-03T20:00:00.000Z');

  it('uses the Phoenix day and only the requested setter when a viewer id is passed', () => {
    const row = lead('door', {
      status: 'shade-dq',
      dispositionedAt: utc('2026-11-03T23:00:00.000Z'),
      dispositionHistory: [
        visit('Shade DQ', utc('2026-11-03T23:00:00.000Z'), 'u1', 'shade'),
        visit('Not Home', utc('2026-11-03T07:00:00.000Z'), 'u1', 'midnight'),
        visit('Golden Home', utc('2026-11-03T05:30:00.000Z'), 'u1', 'previous'),
        visit('Not Home', utc('2026-11-03T18:00:00.000Z'), 'u2', 'other'),
        visit('Already Has Solar', utc('2026-11-03T16:00:00.000Z'), 'u1', 'solar'),
      ],
    });
    assert.equal(countDashboardKnocks([row], DISPOSITIONS, now), 2);
    assert.equal(countDashboardKnocks([row], DISPOSITIONS, now, 'u1'), 1);
    assert.equal(countDashboardKnocks([row], DISPOSITIONS, now, 'u2'), 1);
    assert.equal(countDashboardKnocks([row], DISPOSITIONS, utc('2026-11-02T20:00:00.000Z'), 'u1'), 1);
  });

  it('keeps the morning knock after an afternoon Shade DQ on the same Phoenix day', () => {
    const row = lead('redo', {
      status: 'shade-dq',
      dispositionedAt: utc('2026-11-04T02:00:00.000Z'),
      dispositionHistory: [
        visit('Shade DQ', utc('2026-11-04T02:00:00.000Z'), 'u2', 'shade'),
        visit('Not Home', utc('2026-11-03T16:00:00.000Z'), 'u1', 'morning'),
      ],
    });
    assert.equal(countDashboardKnocks([row], DISPOSITIONS, now), 1);
    assert.equal(countDashboardKnocks([row], DISPOSITIONS, now, 'u2'), 0);
  });
});

describe('activity map knocks', () => {
  it('credits the history actor, excludes shade, and keeps every Phoenix-day visit', () => {
    const latest = utc('2026-11-03T23:00:00.000Z');
    const earlier = utc('2026-11-03T16:00:00.000Z');
    const morning = utc('2026-11-03T15:00:00.000Z');
    const row = lead('door', {
      status: 'shade-dq',
      claimedBy: 'u2',
      disposition: 'Shade DQ',
      dispositionedAt: latest,
      lat: 33.4,
      lng: -112.1,
      dispositionHistory: [
        visit('Shade DQ', latest, 'u2', 'shade'),
        visit('Spoke with Non Homeowner ', earlier, 'u1', 'spoke'),
        visit('Not Home', morning, 'u1', 'morning'),
        visit('Top 10', utc('2026-11-04T15:00:00.000Z'), 'u1', 'tomorrow'),
      ],
    });
    const grouped = activityKnocksByUser([row], DISPOSITIONS, '2026-11-03');
    const u1 = grouped.get('u1') || [];
    assert.equal(u1.length, 2);
    assert.equal(grouped.has('u2'), false);
    assert.equal(u1[0].dispositionedAt?.getTime(), morning.getTime());
    assert.equal(u1[1].dispositionedAt?.getTime(), earlier.getTime());
    assert.equal(u1[1].status, 'spoke-with-non-homeowner');
    assert.equal(u1[1].disposition, 'Spoke with Non Homeowner ');
    assert.equal(u1[0].claimedBy, 'u2');
  });

  it('uses the Phoenix day from midnight through the instant before the next midnight', () => {
    const row = lead('edges', {
      dispositionHistory: [
        visit('Not Home', utc('2026-11-03T07:00:00.000Z'), 'u1', 'start'),
        visit('Call Scheduling Manager', utc('2026-11-04T06:59:59.999Z'), 'u1', 'end'),
        visit('Not Home', utc('2026-11-04T07:00:00.000Z'), 'u1', 'next'),
      ],
    });
    assert.equal(activityKnocksByUser([row], DISPOSITIONS, '2026-11-03').get('u1')?.length, 2);
  });
});

describe('setter stats knocks', () => {
  const now = utc('2026-11-03T20:00:00.000Z');

  it('counts Phoenix-day visit history and skips shade and solar', () => {
    const row = lead('door', {
      status: 'has-solar',
      claimedBy: 'u2',
      dispositionedAt: utc('2026-11-03T21:00:00.000Z'),
      dispositionHistory: [
        visit('Has Solar', utc('2026-11-03T21:00:00.000Z'), 'u2', 'solar'),
        visit('Shade DQ', utc('2026-11-03T20:00:00.000Z'), 'u1', 'shade'),
        visit('Not Home', utc('2026-11-03T18:00:00.000Z'), 'u1', 'today'),
        visit('Not Home', utc('2026-11-03T07:00:00.000Z'), 'u1', 'midnight'),
        visit('Golden Home', utc('2026-11-02T18:00:00.000Z'), 'u1', 'yesterday'),
      ],
    });
    assert.deepEqual(countSetterKnocks([row], DISPOSITIONS, 'today', now), { u1: 2 });
    assert.deepEqual(countSetterKnocks([row], DISPOSITIONS, 'yesterday', now), { u1: 1 });
  });

  it('still counts an in-window visit after the lead is re-dispositioned outside that window', () => {
    const row = lead('later', {
      status: 'shade-dq',
      dispositionedAt: utc('2026-11-04T18:00:00.000Z'),
      dispositionHistory: [
        visit('Shade DQ', utc('2026-11-04T18:00:00.000Z'), 'u2', 'later'),
        visit('Not Interested', utc('2026-11-03T18:00:00.000Z'), 'u1', 'today'),
      ],
    });
    assert.deepEqual(countSetterKnocks([row], DISPOSITIONS, 'today', now), { u1: 1 });
  });

  it('opens a setter row for a rep who only has history credit', () => {
    const rows = new Map<string, { userId: string; knocks: number }>();
    mergeSetterKnockCounts(rows, { u1: 2 }, (userId) => ({ userId, knocks: 0 }));
    assert.equal(rows.get('u1')?.knocks, 2);
    mergeSetterKnockCounts(rows, { u1: 3 }, (userId) => ({ userId, knocks: 0 }));
    assert.equal(rows.size, 1);
    assert.equal(rows.get('u1')?.knocks, 3);
  });
});

describe('team map knocks', () => {
  const now = utc('2026-11-03T20:00:00.000Z');

  it('credits the history actor and includes counted dispositions the old knock list missed', () => {
    const row = lead('door', {
      status: 'not-home',
      claimedBy: 'u2',
      dispositionedAt: utc('2026-11-03T18:00:00.000Z'),
      dispositionHistory: [
        visit('Not Home', utc('2026-11-03T18:00:00.000Z'), 'u1', 'home'),
        visit('Golden Home', utc('2026-11-03T19:00:00.000Z'), 'u1', 'gold'),
        visit('Top 10', utc('2026-11-03T20:00:00.000Z'), 'u1', 'top'),
        visit('Call Scheduling Manager', utc('2026-11-03T21:00:00.000Z'), 'u1', 'call'),
        visit('Shade DQ', utc('2026-11-03T22:00:00.000Z'), 'u1', 'shade'),
      ],
    });
    assert.equal(teamMapStats([row], DISPOSITIONS, 'u1', 'today', now).doors, 4);
    assert.equal(teamMapStats([row], DISPOSITIONS, 'u2', 'today', now).doors, 0);
  });

  it('keeps appointments on claimedBy and the same exclusive day window', () => {
    const appointment = lead('appt', {
      status: 'appointment',
      claimedBy: 'u2',
      dispositionedAt: utc('2026-11-03T18:00:00.000Z'),
      dispositionHistory: [visit('Appointment Set', utc('2026-11-03T18:00:00.000Z'), 'u1', 'appt')],
    });
    const beforeMidnight = lead('before', {
      status: 'sale',
      claimedBy: 'u2',
      dispositionedAt: utc('2026-11-03T06:59:59.999Z'),
      dispositionHistory: [visit('Not Home', utc('2026-11-03T06:59:59.999Z'), 'u1', 'before')],
    });
    const stats = teamMapStats([appointment, beforeMidnight], DISPOSITIONS, 'u2', 'today', now);
    assert.equal(stats.appointments, 1);
    assert.equal(stats.doors, 0);
    assert.equal(teamMapStats([appointment], DISPOSITIONS, 'u1', 'today', now).doors, 1);
    assert.equal(teamMapStats([appointment], DISPOSITIONS, 'u1', 'today', now).appointments, 0);
  });
});

describe('ai manager doors knocked', () => {
  it('counts history visits on the Phoenix day and not the latest claimed lead', () => {
    const first = utc('2026-11-04T00:00:00.000Z');
    const second = utc('2026-11-04T01:00:00.000Z');
    const date = utc('2026-11-03T19:00:00.000Z');
    const counted = lead('counted', {
      status: 'shade-dq',
      claimedBy: 'someone-else',
      disposition: 'Shade DQ',
      dispositionHistory: [
        visit('Shade DQ', second, 'u2', 'shade'),
        visit('Not Home', first, 'u1', 'a'),
        visit('Interested', second, 'u1', 'b'),
      ],
    });
    const outside = lead('outside', {
      claimedBy: 'u1',
      knockGpsTimestamp: utc('2026-11-01T19:00:00.000Z'),
      disposition: 'Appointment Set',
      dispositionHistory: [visit('Not Home', utc('2026-11-01T19:00:00.000Z'), 'u1', 'old')],
    });
    const metrics = calculateDailyMetrics('u1', 'Rep', [counted, outside], date, DISPOSITIONS);
    assert.equal(metrics.date, '2026-11-03');
    assert.equal(metrics.doorsKnocked, 2);
    assert.equal(metrics.pace, 2);
    assert.equal(metrics.primeTimeKnocks, 2);
    assert.equal(metrics.primeTimePercentage, 100);
    assert.equal(metrics.appointments, 0);
    const other = calculateDailyMetrics('u2', 'Other', [counted], date, DISPOSITIONS);
    assert.equal(other.doorsKnocked, 0);
  });

  it('does not count a visit on the neighboring Phoenix day', () => {
    const date = utc('2026-11-03T19:00:00.000Z');
    const row = lead('utc', {
      dispositionHistory: [
        visit('Not Home', utc('2026-11-03T23:30:00.000Z'), 'u1', 'in'),
        visit('Not Home', utc('2026-11-04T07:00:00.000Z'), 'u1', 'out'),
        visit('Not Home', utc('2026-11-03T06:59:59.999Z'), 'u1', 'before'),
      ],
    });
    assert.equal(calculateDailyMetrics('u1', 'Rep', [row], date, DISPOSITIONS).doorsKnocked, 1);
  });
});

describe('knock index benchmark', () => {
  it('indexes 50k leads for 30 users in under 1000ms', () => {
    const users = Array.from({ length: 30 }, (_, index) => `u${index}`);
    const leads: Lead[] = [];
    const base = Date.parse('2026-11-03T15:00:00.000Z');
    for (let i = 0; i < 50000; i += 1) {
      const userId = users[i % 30];
      leads.push(lead(`L${i}`, {
        dispositionHistory: [
          visit('Not Home', new Date(base + i), userId, `e${i}a`),
          visit('Interested', new Date(base + i + 3 * 60 * 1000), userId, `e${i}b`),
          visit('Go Back', new Date(base + i + 6 * 60 * 1000), userId, `e${i}c`),
        ],
      }));
    }
    const started = performance.now();
    const index = knockIndex(leads, DISPOSITIONS);
    let total = 0;
    for (const id of users) total += index.byUser.get(id)?.length ?? 0;
    const indexMs = performance.now() - started;
    const day = phoenixDayWindow(new Date(base));
    const aiStarted = performance.now();
    let doors = 0;
    for (const id of users) {
      doors += calculateDailyMetrics(id, id, leads, new Date(day.startMs + 12 * 60 * 60 * 1000), DISPOSITIONS).doorsKnocked;
    }
    const aiMs = performance.now() - aiStarted;
    console.log(`benchmark index ${indexMs.toFixed(1)}ms aiManager ${aiMs.toFixed(1)}ms`);
    assert.equal(total, 150000);
    assert.equal(doors, 150000);
    assert.ok(indexMs < 1000, `index ${indexMs.toFixed(1)}ms`);
    assert.ok(aiMs < 1000, `aiManager ${aiMs.toFixed(1)}ms`);
  });
});
