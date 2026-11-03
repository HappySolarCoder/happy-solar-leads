import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Lead } from '../app/types/index.ts';
import type { Disposition } from '../app/types/disposition.ts';
import { KNOCK_STATUS_IDS } from '../app/types/disposition.ts';
import {
  EXCLUDED_KNOCK_KEYS,
  NON_KNOCK_KEYS,
  collectKnockEvents,
  countKnocks,
  isCountedKnock,
  knockEvents,
  knocksByDay,
  knocksByUser,
  normalizeDispoKey,
  type KnockCountOptions,
  type KnockEvent,
} from '../app/utils/knockCount.ts';

const epoch = new Date(0);

function dispo(id: string, name: string, countsAsDoorKnock: boolean): Disposition {
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

/** Prod-shaped 17-doc list. countsAsDoorKnock false is exactly the four non-knock ids. */
const COUNTED: Array<[string, string]> = [
  ['not-home', 'Not Home'],
  ['interested', 'Interested'],
  ['not-interested', 'Not Interested'],
  ['appointment', 'Appointment Set'],
  ['call-scheduling-manager', 'Call Scheduling Manager'],
  ['sale', 'Sale!'],
  ['go-back', 'Go Back'],
  ['dq-credit', 'DQ Credit'],
  ['house-for-sale', 'House for Sale'],
  ['renter', 'Renter'],
  ['golden-home', 'Golden Home'],
  ['top-10', 'Top 10'],
  ['spoke-with-non-homeowner', 'Spoke with Non Homeowner '],
];
const NOT_KNOCKS: Array<[string, string]> = [
  ['unclaimed', 'Available'],
  ['claimed', 'My Targets'],
  ['shade-dq', 'Shade DQ'],
  ['has-solar', 'Has Solar'],
];
const PROD = [
  ...NOT_KNOCKS.map(([id, name]) => dispo(id, name, false)),
  ...COUNTED.map(([id, name]) => dispo(id, name, true)),
];

const day = (monthDay: number, hour = 15) => new Date(2026, 9, monthDay, hour);
const mon = day(5);
const tue = day(6);

function lead(id: string, patch: Partial<Lead> = {}): Lead {
  return {
    id,
    name: 'Door',
    address: '1 Test',
    city: 'Phoenix',
    state: 'AZ',
    zip: '85001',
    status: 'assigned',
    createdAt: day(1),
    ...patch,
  };
}

function visit(
  disposition: string,
  at: unknown,
  userId = 'u1',
  eventId?: string,
) {
  return {
    disposition,
    timestamp: at,
    userId,
    userName: 'Rep',
    ...(eventId ? { field: { eventId } } : {}),
  } as NonNullable<Lead['dispositionHistory']>[number];
}

function knocks(rows: Lead[], opts: KnockCountOptions = {}) {
  return countKnocks(rows, PROD, opts);
}

describe('knock count helper', () => {
  it('counts each of the 13 prod dispositions and none of the exclusion or ownership set', () => {
    for (const [id, name] of COUNTED) {
      assert.equal(knocks([lead(id, { dispositionHistory: [visit(id, mon)] })]), 1, id);
      assert.equal(knocks([lead(`${id}-name`, { dispositionHistory: [visit(name, mon)] })]), 1, name);
    }
    for (const [id, name] of NOT_KNOCKS) {
      assert.equal(knocks([lead(id, { dispositionHistory: [visit(id, mon)] })]), 0, id);
      assert.equal(knocks([lead(`${id}-name`, { dispositionHistory: [visit(name, mon)] })]), 0, name);
    }
    assert.equal(knocks([lead('already', { dispositionHistory: [visit('Already Has Solar', mon)] })]), 0);
    for (const status of ['claimed', 'unclaimed', 'available', 'my-targets', '', 'assigned', 'unassigned', 'new', 'not-knocked']) {
      assert.equal(
        knocks([lead(status || 'blank', { status, dispositionedAt: mon, claimedBy: 'u1' })]),
        0,
        status || '(blank)',
      );
    }
    // Unknown legacy strings count. Only the exclusion set and the unworked set are zero.
    assert.equal(knocks([lead('legacy-unknown', { status: 'follow-up-later', dispositionedAt: mon, claimedBy: 'u1' })]), 1);
    assert.equal(knocks([lead('legacy-new', { status: 'new', dispositionedAt: mon, claimedBy: 'u1' })]), 0);
    assert.equal(isCountedKnock('follow-up-later'), true);
    assert.equal(isCountedKnock('new'), false);
    assert.equal(EXCLUDED_KNOCK_KEYS.has('shade-dq'), true);
    assert.equal(NON_KNOCK_KEYS.has('claimed'), true);
  });

  it('matches disposition id or normalized name, including a trailing space', () => {
    assert.equal(normalizeDispoKey('Not Home', PROD), 'not-home');
    assert.equal(normalizeDispoKey('not-home', PROD), 'not-home');
    assert.equal(normalizeDispoKey('Spoke with Non Homeowner ', PROD), 'spoke-with-non-homeowner');
    for (const raw of ['Not Home', 'not-home', 'Spoke with Non Homeowner ']) {
      assert.equal(knocks([lead(raw, { dispositionHistory: [visit(raw, mon)] })]), 1, raw);
    }
  });

  it('keeps an earlier knock when a later disposition is Shade DQ or Has Solar', () => {
    const shade = lead('shade', {
      status: 'shade-dq',
      dispositionedAt: tue,
      claimedBy: 'u2',
      dispositionHistory: [visit('Shade DQ', tue, 'u2'), visit('Not Home', mon, 'u1')],
    });
    const solar = lead('solar', {
      status: 'has-solar',
      dispositionedAt: tue,
      dispositionHistory: [visit('Has Solar', tue), visit('Not Interested', mon)],
    });
    assert.equal(knocks([shade], { userId: 'u1' }), 1);
    assert.equal(knocks([shade], { userId: 'u2' }), 0);
    assert.equal(knocks([solar], { userId: 'u1' }), 1);
  });

  it('counts both visits when a counted disposition follows an excluded one', () => {
    const row = lead('return', {
      status: 'go-back',
      dispositionHistory: [visit('Go Back', day(7)), visit('Has Solar', tue), visit('Not Home', mon)],
    });
    assert.equal(knocks([row], { userId: 'u1' }), 2);
  });

  it('counts the later knock when Shade DQ comes first', () => {
    const row = lead('after-shade', {
      status: 'not-home',
      dispositionHistory: [visit('Not Home', tue), visit('shade-dq', mon)],
    });
    assert.equal(knocks([row], { userId: 'u1' }), 1);
  });

  it('does not drop a Not Home knock when the lead is later claimed or unclaimed', () => {
    const claimed = lead('claimed-after', {
      status: 'claimed',
      claimedBy: 'u1',
      dispositionedAt: tue,
      dispositionHistory: [visit('Not Home', mon, 'u1')],
    });
    const unclaimed = lead('unclaimed-after', {
      status: 'unclaimed',
      dispositionedAt: tue,
      dispositionHistory: [visit('Not Home', mon, 'u1')],
    });
    assert.equal(knocks([claimed]), 1);
    assert.equal(knocks([unclaimed]), 1);
  });

  it('keeps each day when the same door is knocked twice', () => {
    const row = lead('repeat', {
      status: 'not-home',
      dispositionedAt: tue,
      dispositionHistory: [visit('Not Home', tue), visit('Not Home', mon)],
    });
    const start = new Date(2026, 9, 5);
    const end = new Date(2026, 9, 6);
    assert.equal(knocks([row], { start, end }), 1);
    assert.equal(knocks([row], { start: end, end: new Date(2026, 9, 7) }), 1);
    assert.equal(knocks([row], { start, end: new Date(2026, 9, 7) }), 2);
    assert.deepEqual(knocksByDay([row], PROD), {
      '2026-10-05': 1,
      '2026-10-06': 1,
    });
  });

  it('credits each rep and does not move an earlier knock to the later rep', () => {
    const row = lead('two-reps', {
      status: 'interested',
      claimedBy: 'u2',
      dispositionHistory: [visit('Interested', tue, 'u2'), visit('Not Home', mon, 'u1')],
    });
    assert.equal(knocks([row], { userId: 'u1' }), 1);
    assert.equal(knocks([row], { userId: 'u2' }), 1);
    assert.deepEqual(knocksByUser([row], PROD), { u1: 1, u2: 1 });
  });

  it('counts one event when the same eventId is replayed, and two when the ids differ', () => {
    const once = visit('Not Home', mon, 'u1', 'evt-1');
    const replayed = lead('replay', { dispositionHistory: [once, { ...once }] });
    assert.equal(knocks([replayed]), 1);
    const delayed = lead('delayed', {
      dispositionHistory: [
        visit('Interested', tue, 'u1', 'evt-2'),
        visit('Not Home', mon, 'u1', 'evt-1'),
      ],
    });
    assert.equal(knocks([delayed]), 2);
    assert.equal(knocksByDay([delayed], PROD)['2026-10-05'], 1);
    assert.equal(knocksByDay([delayed], PROD)['2026-10-06'], 1);
    const otherDevice = lead('other-device', {
      dispositionHistory: [visit('Not Home', mon, 'u1', 'evt-1')],
    });
    assert.equal(knocks([replayed, otherDevice]), 1);
    const secondDevice = lead('second-device', {
      dispositionHistory: [visit('Not Home', tue, 'u1', 'evt-9')],
    });
    assert.equal(knocks([replayed, secondDevice]), 2);
  });

  it('unions snapshots of the same lead and never lets a shorter copy remove an event', () => {
    const full = lead('door', {
      dispositionHistory: [visit('Go Back', tue, 'u1', 'evt-2'), visit('Not Home', mon, 'u1', 'evt-1')],
    });
    const trimmed = lead('door', {
      dispositionHistory: [visit('Go Back', tue, 'u1', 'evt-2')],
    });
    const ack = lead('door', {
      dispositionHistory: [visit('Not Home', mon, 'u1', 'evt-1')],
    });
    assert.equal(knocks([full]), 2);
    assert.equal(knocks([trimmed]), 1);
    assert.equal(knocks([full, trimmed, ack]), 2);
    assert.equal(knocks([trimmed, ack]), 2);
  });

  it('ignores a notes-only or go-back reschedule that adds no history entry', () => {
    const before = lead('notes', {
      status: 'not-home',
      notes: '',
      dispositionHistory: [visit('Not Home', mon)],
    });
    const notesOnly = { ...before, notes: 'left a card' };
    const rescheduled = { ...before, goBackScheduledDate: tue, goBackNotes: 'after 5' };
    assert.equal(knocks([before]), 1);
    assert.equal(knocks([notesOnly]), 1);
    assert.equal(knocks([rescheduled]), 1);
  });

  it('uses one legacy event from status or dispositionId when history is empty', () => {
    assert.equal(knocks([lead('legacy', { status: 'not-home', dispositionedAt: mon, claimedBy: 'u1' })]), 1);
    assert.equal(knocks([lead('legacy-solar', { status: 'has-solar', dispositionedAt: mon, claimedBy: 'u1' })]), 0);
    const byDispositionId = lead('by-id', {
      status: 'assigned',
      dispositionedAt: mon,
      assignedTo: 'u2',
    }) as Lead & { dispositionId?: string };
    byDispositionId.dispositionId = 'interested';
    assert.equal(knocks([byDispositionId], { userId: 'u2' }), 1);
    assert.equal(knocks([byDispositionId], { userId: 'u1' }), 0);
    assert.equal(knocks([lead('no-actor', { status: 'not-home', dispositionedAt: mon })]), 0);
  });

  it('parses every timestamp shape and skips an invalid one', () => {
    const shapes: unknown[] = [
      mon,
      mon.toISOString(),
      mon.getTime(),
      { seconds: Math.floor(mon.getTime() / 1000), nanoseconds: (mon.getTime() % 1000) * 1e6 },
      { toDate: () => mon },
      { toMillis: () => mon.getTime() },
    ];
    for (const at of shapes) {
      assert.equal(knocks([lead(String(at), { dispositionHistory: [visit('Not Home', at)] })]), 1);
    }
    const skipped = lead('bad-time', {
      dispositionHistory: [visit('Not Home', 'not-a-date'), visit('Not Home', mon, 'u1')],
    });
    assert.equal(knocks([skipped]), 1);
    assert.equal(knockEvents(lead('only-bad', { dispositionHistory: [visit('Not Home', 'not-a-date')] }), PROD).length, 0);
    assert.equal(knockEvents(lead('no-user', { dispositionHistory: [visit('Not Home', mon, ' ')] }), PROD).length, 0);
  });

  it('treats countKnocks start as inclusive and end as exclusive', () => {
    const row = lead('bounds', { dispositionHistory: [visit('Not Home', mon)] });
    assert.equal(knocks([row], { start: mon, end: new Date(mon.getTime() + 1) }), 1);
    assert.equal(knocks([row], { start: new Date(mon.getTime() + 1) }), 0);
    assert.equal(knocks([row], { end: mon }), 0);
  });

  it('agrees with the prod config: countsAsDoorKnock false is exactly claimed, unclaimed, shade-dq, has-solar', () => {
    assert.equal(PROD.length, 17);
    const falses = PROD.filter((row) => !row.countsAsDoorKnock).map((row) => row.id).sort();
    assert.deepEqual(falses, ['claimed', 'has-solar', 'shade-dq', 'unclaimed']);
    for (const row of PROD) {
      assert.equal(isCountedKnock(row.id), row.countsAsDoorKnock, row.id);
      assert.equal(isCountedKnock(normalizeDispoKey(row.name, PROD)), row.countsAsDoorKnock, row.name);
    }
    // Map visibility still treats Shade DQ as a knock pin. Counters do not.
    assert.equal(KNOCK_STATUS_IDS.includes('shade-dq'), true);
    assert.equal(isCountedKnock('shade-dq'), false);
  });

  it('unions a ledger event the loaded leads no longer contain', () => {
    const event: KnockEvent = {
      key: 'ledger-1',
      leadId: 'missing',
      userId: 'u1',
      at: mon.getTime(),
      dispositionId: 'not-home',
    };
    assert.equal(countKnocks([], PROD, { ledger: [event], userId: 'u1' }), 1);
    const loaded = lead('missing', { dispositionHistory: [visit('Not Home', mon, 'u1', 'ledger-1')] });
    assert.equal(countKnocks([loaded], PROD, { ledger: [event] }), 1);
    assert.equal(collectKnockEvents([loaded], PROD, { ledger: [event] }).length, 1);
  });
});
