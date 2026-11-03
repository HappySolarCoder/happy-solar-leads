import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Lead } from '../app/types/index.ts';
import type { Disposition } from '../app/types/disposition.ts';
import { calculateDailyMetrics } from '../app/utils/aiManager.ts';
import {
  activityKnocksByUser,
  countDashboardKnocks,
  countMonthlyKnocks,
  countSetterKnocks,
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

const noon = (month: number, monthDay: number, hour = 12, minute = 0) =>
  new Date(2026, month, monthDay, hour, minute, 0, 0);

describe('monthly goal knocks', () => {
  const november = new Date(2026, 10, 15, 9);

  it('counts every in-month visit for that rep and ignores Shade DQ and Has Solar', () => {
    const row = lead('door', {
      status: 'shade-dq',
      claimedBy: 'u2',
      dispositionedAt: noon(11, 2),
      dispositionHistory: [
        visit('Shade DQ', noon(11, 2), 'u2'),
        visit('Has Solar', noon(10, 20), 'u1'),
        visit('Not Home', noon(10, 4), 'u1'),
        visit('Not Home', noon(10, 3), 'u1'),
        visit('Golden Home', noon(9, 30), 'u1'),
      ],
    });
    assert.equal(countMonthlyKnocks([row], DISPOSITIONS, 'u1', november), 2);
    assert.equal(countMonthlyKnocks([row], DISPOSITIONS, 'u2', november), 0);
  });

  it('includes the first and last millisecond of the local month', () => {
    const start = new Date(2026, 10, 1, 0, 0, 0, 0);
    const end = new Date(2026, 10, 30, 23, 59, 59, 999);
    const row = lead('edges', {
      dispositionHistory: [
        visit('Not Home', start, 'u1', 'a'),
        visit('Not Home', end, 'u1', 'b'),
        visit('Not Home', new Date(2026, 11, 1, 0, 0, 0, 0), 'u1', 'c'),
      ],
    });
    assert.equal(countMonthlyKnocks([row], DISPOSITIONS, 'u1', november), 2);
  });
});

describe('dashboard knocks', () => {
  const now = new Date(2026, 10, 3, 18, 0, 0, 0);

  it('counts the local calendar day and does not use KNOCK_STATUS_IDS', () => {
    const row = lead('door', {
      status: 'shade-dq',
      dispositionedAt: noon(10, 3, 19),
      dispositionHistory: [
        visit('Shade DQ', noon(10, 3, 19), 'u1'),
        visit('Not Home', new Date(2026, 10, 3, 0, 0, 0, 0), 'u1', 'midnight'),
        visit('Golden Home', noon(10, 2, 23), 'u1'),
        visit('Already Has Solar', noon(10, 3, 8), 'u2'),
      ],
    });
    // Shade DQ is in KNOCK_STATUS_IDS for map pins. It still does not count.
    // Golden Home is not in that list. It counts on its own day only.
    assert.equal(countDashboardKnocks([row], DISPOSITIONS, now), 1);
    assert.equal(countDashboardKnocks([row], DISPOSITIONS, new Date(2026, 10, 2, 8)), 1);
  });

  it('keeps the morning knock after an afternoon Shade DQ on the same day', () => {
    const row = lead('redo', {
      status: 'shade-dq',
      dispositionedAt: noon(10, 3, 19),
      dispositionHistory: [
        visit('Shade DQ', noon(10, 3, 19), 'u2'),
        visit('Not Home', noon(10, 3, 9), 'u1'),
      ],
    });
    assert.equal(countDashboardKnocks([row], DISPOSITIONS, now), 1);
  });
});

describe('activity map knocks', () => {
  it('credits the history actor, excludes shade, and keeps every visit that day', () => {
    const latest = noon(10, 3, 16);
    const earlier = noon(10, 3, 9);
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
        visit('Not Home', noon(10, 3, 8), 'u1', 'morning'),
        visit('Top 10', noon(10, 4, 8), 'u1', 'tomorrow'),
      ],
    });
    const grouped = activityKnocksByUser([row], DISPOSITIONS, '2026-11-03');
    const u1 = grouped.get('u1') || [];
    assert.equal(u1.length, 2);
    assert.equal(grouped.has('u2'), false);
    assert.equal(u1[0].dispositionedAt?.getTime(), noon(10, 3, 8).getTime());
    assert.equal(u1[1].dispositionedAt?.getTime(), earlier.getTime());
    assert.equal(u1[1].status, 'spoke-with-non-homeowner');
    assert.equal(u1[1].disposition, 'Spoke with Non Homeowner ');
    assert.equal(u1[0].claimedBy, 'u2');
  });

  it('uses the local day from midnight through 23:59:59.999', () => {
    const row = lead('edges', {
      dispositionHistory: [
        visit('Not Home', new Date(2026, 10, 3, 0, 0, 0, 0), 'u1', 'start'),
        visit('Call Scheduling Manager', new Date(2026, 10, 3, 23, 59, 59, 999), 'u1', 'end'),
        visit('Not Home', new Date(2026, 10, 4, 0, 0, 0, 0), 'u1', 'next'),
      ],
    });
    assert.equal(activityKnocksByUser([row], DISPOSITIONS, '2026-11-03').get('u1')?.length, 2);
  });
});

describe('setter stats knocks', () => {
  const now = new Date(2026, 10, 3, 15, 0, 0, 0);

  it('counts visit history in the existing exclusive window and skips shade and solar', () => {
    const today = new Date(2026, 10, 3, 0, 0, 0, 1);
    const midnight = new Date(2026, 10, 3, 0, 0, 0, 0);
    const yesterday = new Date(2026, 10, 2, 18, 0, 0, 0);
    const row = lead('door', {
      status: 'has-solar',
      claimedBy: 'u2',
      dispositionedAt: noon(10, 3, 14),
      dispositionHistory: [
        visit('Has Solar', noon(10, 3, 14), 'u2', 'solar'),
        visit('Shade DQ', noon(10, 3, 13), 'u1', 'shade'),
        visit('Not Home', today, 'u1', 'today'),
        visit('Not Home', midnight, 'u1', 'midnight'),
        visit('Golden Home', yesterday, 'u1', 'yesterday'),
      ],
    });
    assert.deepEqual(countSetterKnocks([row], DISPOSITIONS, 'today', now), { u1: 1 });
    assert.deepEqual(countSetterKnocks([row], DISPOSITIONS, 'yesterday', now), { u1: 1 });
  });

  it('still counts an in-window visit after the lead is re-dispositioned outside that window', () => {
    const row = lead('later', {
      status: 'shade-dq',
      dispositionedAt: noon(10, 4),
      dispositionHistory: [
        visit('Shade DQ', noon(10, 4), 'u2'),
        visit('Not Interested', noon(10, 3, 11), 'u1'),
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
  const now = new Date(2026, 10, 3, 15, 0, 0, 0);

  it('credits the history actor and includes counted dispositions the old knock list missed', () => {
    const row = lead('door', {
      status: 'not-home',
      claimedBy: 'u2',
      dispositionedAt: noon(10, 3, 11),
      dispositionHistory: [
        visit('Not Home', noon(10, 3, 11), 'u1', 'home'),
        visit('Golden Home', noon(10, 3, 12), 'u1', 'gold'),
        visit('Top 10', noon(10, 3, 13), 'u1', 'top'),
        visit('Call Scheduling Manager', noon(10, 3, 14), 'u1', 'call'),
        visit('Shade DQ', noon(10, 3, 15), 'u1', 'shade'),
      ],
    });
    assert.equal(teamMapStats([row], DISPOSITIONS, 'u1', 'today', now).doors, 4);
    assert.equal(teamMapStats([row], DISPOSITIONS, 'u2', 'today', now).doors, 0);
  });

  it('keeps appointments on claimedBy and the same exclusive day window', () => {
    const appointment = lead('appt', {
      status: 'appointment',
      claimedBy: 'u2',
      dispositionedAt: noon(10, 3, 11),
      dispositionHistory: [visit('Appointment Set', noon(10, 3, 11), 'u1')],
    });
    const midnight = lead('midnight', {
      status: 'sale',
      claimedBy: 'u2',
      dispositionedAt: new Date(2026, 10, 3, 0, 0, 0, 0),
      dispositionHistory: [visit('Not Home', new Date(2026, 10, 3, 0, 0, 0, 0), 'u1', 'mid')],
    });
    const stats = teamMapStats([appointment, midnight], DISPOSITIONS, 'u2', 'today', now);
    assert.equal(stats.appointments, 1);
    assert.equal(stats.doors, 0);
    assert.equal(teamMapStats([appointment], DISPOSITIONS, 'u1', 'today', now).doors, 1);
    assert.equal(teamMapStats([appointment], DISPOSITIONS, 'u1', 'today', now).appointments, 0);
  });
});

describe('ai manager doors knocked', () => {
  it('counts history visits on the UTC day and not the latest claimed lead', () => {
    const first = new Date(2026, 10, 3, 17, 0, 0, 0);
    const second = new Date(2026, 10, 3, 18, 0, 0, 0);
    const date = new Date(first.toISOString().slice(0, 10));
    const counted = lead('counted', {
      status: 'shade-dq',
      claimedBy: 'someone-else',
      disposition: 'Shade DQ',
      dispositionHistory: [
        visit('Shade DQ', second, 'u2'),
        visit('Not Home', first, 'u1', 'a'),
        visit('Interested', second, 'u1', 'b'),
      ],
    });
    const outside = lead('outside', {
      claimedBy: 'u1',
      knockGpsTimestamp: new Date(first.getTime() - 48 * 3600 * 1000),
      disposition: 'Appointment Set',
      dispositionHistory: [visit('Not Home', new Date(first.getTime() - 48 * 3600 * 1000), 'u1', 'old')],
    });
    const metrics = calculateDailyMetrics('u1', 'Rep', [counted, outside], date, DISPOSITIONS);
    assert.equal(metrics.doorsKnocked, 2);
    assert.equal(metrics.pace, 2);
    assert.equal(metrics.primeTimeKnocks, 2);
    assert.equal(metrics.primeTimePercentage, 100);
    assert.equal(metrics.appointments, 0);
    const other = calculateDailyMetrics('u2', 'Other', [counted], date, DISPOSITIONS);
    assert.equal(other.doorsKnocked, 0);
  });

  it('does not count a UTC-adjacent visit on the neighboring UTC day', () => {
    const date = new Date('2026-11-03T00:00:00.000Z');
    const row = lead('utc', {
      dispositionHistory: [
        visit('Not Home', new Date('2026-11-03T23:30:00.000Z'), 'u1', 'in'),
        visit('Not Home', new Date('2026-11-04T00:00:00.000Z'), 'u1', 'out'),
        visit('Not Home', new Date('2026-11-02T23:59:59.999Z'), 'u1', 'before'),
      ],
    });
    assert.equal(calculateDailyMetrics('u1', 'Rep', [row], date, DISPOSITIONS).doorsKnocked, 1);
  });
});
