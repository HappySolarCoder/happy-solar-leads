import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  GO_BACK_OWNER_MS,
  effectiveOwner,
  goBackSetter,
  ownerInstant,
  prepareTerritories,
  stampedOwner,
  territoryFor,
} from '../app/utils/effectiveOwner';
import { ASSIGNMENT_HISTORY_CAP, assignmentStamp } from '../app/utils/territoryAssigneeHistory';

const NOW = Date.parse('2026-11-10T21:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const box = (lat: number, lng: number, d = 0.01) => [
  { lat: lat - d, lng: lng - d },
  { lat: lat - d, lng: lng + d },
  { lat: lat + d, lng: lng + d },
  { lat: lat + d, lng: lng - d },
];
const T = (id: string, userId: string, extra: Record<string, unknown> = {}, poly = box(33.45, -112.07)) => ({
  id,
  data: { userId, userName: userId, userColor: '#123456', polygon: poly, createdAt: '2026-08-03T00:00:00.000Z', ...extra },
});
const pin = (extra: Record<string, unknown> = {}) => ({ lat: 33.45, lng: -112.07, ...extra });

describe('effective owner', () => {
  it('territory rep beats a stale stamp (the Aug 3/10 stamps stop mattering)', () => {
    const terr = prepareTerritories([T('a', 'sawyer')]);
    assert.deepEqual(effectiveOwner(pin({ claimedBy: 'jordan' }), terr, NOW), { ownerId: 'sawyer', source: 'territory', territoryId: 'a' });
  });

  it('newest assignedAt wins; createdAt is the fallback; ties go to the larger id; overlap is flagged', () => {
    const terr = prepareTerritories([
      T('a', 'old-rep', { createdAt: '2026-08-03T00:00:00.000Z' }),
      T('b', 'new-rep', { createdAt: '2026-08-01T00:00:00.000Z', assignedAt: '2026-11-09T00:00:00.000Z' }),
    ]);
    const owner = effectiveOwner(pin(), terr, NOW);
    assert.equal(owner.ownerId, 'new-rep');
    assert.equal(owner.overlap, true);
    const tie = prepareTerritories([T('a', 'x', { assignedAt: '2026-11-01T00:00:00.000Z' }), T('z', 'y', { assignedAt: '2026-11-01T00:00:00.000Z' })]);
    assert.equal(effectiveOwner(pin(), tie, NOW).ownerId, 'y');
    const same = prepareTerritories([T('a', 'x'), T('b', 'x')]);
    assert.equal(effectiveOwner(pin(), same, NOW).overlap, undefined);
  });

  it('reassignment: the next assignee takes over', () => {
    const before = prepareTerritories([T('a', 'evan', { assignedAt: '2026-11-02T00:00:00.000Z' })]);
    const after = prepareTerritories([T('a', 'sawyer', { assignedAt: '2026-11-09T00:00:00.000Z' })]);
    assert.equal(effectiveOwner(pin(), before, NOW).ownerId, 'evan');
    assert.equal(effectiveOwner(pin(), after, NOW).ownerId, 'sawyer');
  });

  it('archived, unassigned, and malformed territories are no territory', () => {
    const terr = prepareTerritories([
      T('a', 'x', { archived: true }),
      T('b', ''),
      T('c', 'x', { polygon: [{ lat: 1, lng: 1 }, { lat: 2, lng: 2 }] }),
      T('d', 'x', { polygon: [{ lat: 'a', lng: 1 }, { lat: 2, lng: 2 }, { lat: 3, lng: 3 }] }),
    ]);
    assert.equal(terr.length, 0);
    assert.deepEqual(effectiveOwner(pin({ assignedTo: 'rep' }), terr, NOW), { ownerId: 'rep', source: 'stamp' });
    assert.deepEqual(effectiveOwner(pin(), terr, NOW), { ownerId: null, source: 'none' });
  });

  it('pins outside every territory, or without coordinates, fall back to the stamp', () => {
    const terr = prepareTerritories([T('a', 'sawyer')]);
    assert.equal(effectiveOwner({ lat: 10, lng: 10, claimedBy: 'jordan' }, terr, NOW).ownerId, 'jordan');
    assert.equal(effectiveOwner({ claimedBy: 'jordan' }, terr, NOW).source, 'stamp');
    assert.equal(territoryFor(NaN, 1, terr), null);
  });

  it('stamp order: claimedBy, assignedTo, manual creator', () => {
    assert.equal(stampedOwner({ claimedBy: 'a', assignedTo: 'b' }), 'a');
    assert.equal(stampedOwner({ assignedTo: 'b' }), 'b');
    assert.equal(stampedOwner({ setterId: 'c', source: 'manually-added' }), 'c');
    assert.equal(stampedOwner({ setterId: 'c', source: 'import' }), null);
  });

  describe('Go Back', () => {
    const terr = prepareTerritories([T('a', 'sawyer')]);
    const goBack = (ageMs: number, extra: Record<string, unknown> = {}) =>
      pin({ status: 'go-back', goBackScheduledBy: 'jordan', dispositionedAt: new Date(NOW - ageMs).toISOString(), ...extra });

    it('stays with the setter through day 90, reverts after', () => {
      assert.equal(effectiveOwner(goBack(GO_BACK_OWNER_MS), terr, NOW).ownerId, 'jordan');
      assert.equal(effectiveOwner(goBack(GO_BACK_OWNER_MS), terr, NOW).source, 'go-back');
      assert.equal(effectiveOwner(goBack(GO_BACK_OWNER_MS + 1), terr, NOW).ownerId, 'sawyer');
      assert.equal(effectiveOwner(goBack(100 * DAY), terr, NOW).source, 'territory');
    });

    it('a new go-back restarts the clock (dispositionedAt is the latest go-back)', () => {
      assert.equal(effectiveOwner(goBack(2 * DAY, { goBackScheduledBy: 'marissa' }), terr, NOW).ownerId, 'marissa');
    });

    it('a later non-go-back dispo ends the exception', () => {
      assert.equal(effectiveOwner(goBack(2 * DAY, { status: 'not-home' }), terr, NOW).ownerId, 'sawyer');
    });

    it('a setter who left reverts at once', () => {
      assert.equal(effectiveOwner(goBack(DAY), terr, NOW, { setterActive: () => false }).ownerId, 'sawyer');
      assert.equal(effectiveOwner(goBack(DAY), terr, NOW, { setterActive: (uid) => uid === 'jordan' }).ownerId, 'jordan');
    });

    it('no dispo time means the window cannot be proven, so the territory rep owns it', () => {
      assert.equal(effectiveOwner(pin({ status: 'go-back', goBackScheduledBy: 'jordan' }), terr, NOW).ownerId, 'sawyer');
    });

    it('setter resolution: goBackScheduledBy, then newest go-back history entry, then claimedBy', () => {
      assert.equal(goBackSetter({ status: 'go-back', goBackScheduledBy: 'a', claimedBy: 'z' }), 'a');
      assert.equal(
        goBackSetter({
          status: 'Go Back',
          claimedBy: 'z',
          dispositionHistory: [
            { disposition: 'Not Home', userId: 'n' },
            { disposition: 'Go Back', userId: 'h' },
          ],
        }),
        'h',
      );
      assert.equal(goBackSetter({ status: 'go-back', claimedBy: 'z' }), 'z');
      assert.equal(goBackSetter({ status: 'not-home', goBackScheduledBy: 'a' }), null);
    });

    it('a go-back in no territory still follows the window, then the stamp', () => {
      const none = prepareTerritories([]);
      assert.equal(effectiveOwner(goBack(DAY), none, NOW).ownerId, 'jordan');
      assert.deepEqual(effectiveOwner(goBack(200 * DAY, { claimedBy: 'old' }), none, NOW), { ownerId: 'old', source: 'stamp' });
    });
  });

  it('ownerInstant reads Timestamp, Date, ISO, seconds, and rejects junk', () => {
    assert.equal(ownerInstant({ toMillis: () => 5 }), 5);
    assert.equal(ownerInstant(new Date(7)), 7);
    assert.equal(ownerInstant('2026-11-10T00:00:00.000Z'), Date.parse('2026-11-10T00:00:00.000Z'));
    assert.equal(ownerInstant({ seconds: 2, nanoseconds: 5_000_000 }), 2005);
    assert.equal(ownerInstant({ _seconds: 3 }), 3000);
    assert.equal(ownerInstant('nope'), null);
    assert.equal(ownerInstant(null), null);
  });
});

describe('territory assignee history', () => {
  it('stamps assignedAt/assignedBy and appends, capped at 20', () => {
    let history: unknown;
    let stamp = assignmentStamp(history, 'u0', 'admin', '2026-11-10T00:00:00.000Z');
    assert.deepEqual(stamp, {
      assignedAt: '2026-11-10T00:00:00.000Z',
      assignedBy: 'admin',
      assignmentHistory: [{ userId: 'u0', at: '2026-11-10T00:00:00.000Z', by: 'admin' }],
    });
    for (let i = 1; i < 30; i += 1) {
      stamp = assignmentStamp(stamp.assignmentHistory, `u${i}`, 'admin', `2026-11-${10 + (i % 15)}T00:00:00.000Z`);
    }
    assert.equal(stamp.assignmentHistory.length, ASSIGNMENT_HISTORY_CAP);
    assert.equal(stamp.assignmentHistory.at(-1)?.userId, 'u29');
    assert.equal(stamp.assignmentHistory[0].userId, 'u10');
  });

  it('ignores a malformed previous value', () => {
    assert.equal(assignmentStamp('x', 'u', 'a').assignmentHistory.length, 1);
    assert.equal(assignmentStamp([null, { nope: 1 }], 'u', 'a').assignmentHistory.length, 1);
  });
});
