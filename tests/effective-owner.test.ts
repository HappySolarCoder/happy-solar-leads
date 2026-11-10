import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  GO_BACK_OWNER_MS,
  effectiveOwner,
  goBackSetter,
  ownerInstant,
  prepareTerritories,
  stampedOwner,
  territoriesFor,
  isExpiredGoBack,
  foreignTerritoryWarning,
  FOREIGN_TERRITORY_WARNING,
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
    assert.deepEqual(effectiveOwner(pin({ claimedBy: 'jordan' }), terr, NOW), {
      ownerId: 'sawyer',
      ownerIds: ['sawyer'],
      source: 'territory',
      territoryId: 'a',
      territoryIds: ['a'],
    });
  });

  it('overlap = dual owners: both reps own the pin, newest assignment listed first', () => {
    const terr = prepareTerritories([
      T('a', 'old-rep', { createdAt: '2026-08-03T00:00:00.000Z' }),
      T('b', 'new-rep', { createdAt: '2026-08-01T00:00:00.000Z', assignedAt: '2026-11-09T00:00:00.000Z' }),
    ]);
    const owner = effectiveOwner(pin(), terr, NOW);
    assert.deepEqual(owner.ownerIds, ['new-rep', 'old-rep']);
    assert.equal(owner.ownerId, 'new-rep');
    assert.equal(owner.dual, true);
    assert.deepEqual(owner.territoryIds, ['b', 'a']);
    const tie = prepareTerritories([T('a', 'x', { assignedAt: '2026-11-01T00:00:00.000Z' }), T('z', 'y', { assignedAt: '2026-11-01T00:00:00.000Z' })]);
    assert.deepEqual(effectiveOwner(pin(), tie, NOW).ownerIds, ['y', 'x']);
    const same = prepareTerritories([T('a', 'x'), T('b', 'x')]);
    assert.deepEqual(effectiveOwner(pin(), same, NOW).ownerIds, ['x']);
    assert.equal(effectiveOwner(pin(), same, NOW).dual, undefined);
  });

  it('a territory with several assignees (userIds) gives every one of them the pin; userId stays first', () => {
    const terr = prepareTerritories([T('a', 'lead-rep', { userIds: ['second-rep', 'lead-rep', '', 7 as unknown as string] })]);
    assert.deepEqual(terr[0].userIds, ['lead-rep', 'second-rep']);
    const owner = effectiveOwner(pin(), terr, NOW);
    assert.deepEqual(owner.ownerIds, ['lead-rep', 'second-rep']);
    assert.equal(owner.dual, true);
    // A doc without userIds is [userId]: today's single-assignee territories are unchanged.
    assert.deepEqual(prepareTerritories([T('b', 'solo')])[0].userIds, ['solo']);
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
    assert.deepEqual(effectiveOwner(pin({ assignedTo: 'rep' }), terr, NOW), { ownerId: 'rep', ownerIds: ['rep'], source: 'stamp' });
    assert.deepEqual(effectiveOwner(pin(), terr, NOW), { ownerId: null, ownerIds: [], source: 'none' });
  });

  it('pins outside every territory, or without coordinates, fall back to the stamp', () => {
    const terr = prepareTerritories([T('a', 'sawyer')]);
    assert.equal(effectiveOwner({ lat: 10, lng: 10, claimedBy: 'jordan' }, terr, NOW).ownerId, 'jordan');
    assert.equal(effectiveOwner({ claimedBy: 'jordan' }, terr, NOW).source, 'stamp');
    assert.deepEqual(territoriesFor(NaN, 1, terr), []);
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
      assert.deepEqual(effectiveOwner(goBack(200 * DAY, { claimedBy: 'old' }), none, NOW), { ownerId: 'old', ownerIds: ['old'], source: 'stamp' });
    });
  });

  describe('Exp. Go-Back (derived, never stored)', () => {
    const at = (ageMs: number) => new Date(NOW - ageMs).toISOString();
    it('is go-back older than 90 days and nothing else', () => {
      assert.equal(isExpiredGoBack({ status: 'go-back', dispositionedAt: at(GO_BACK_OWNER_MS + 1) }, NOW), true);
      assert.equal(isExpiredGoBack({ status: 'go-back', dispositionedAt: at(GO_BACK_OWNER_MS) }, NOW), false);
      assert.equal(isExpiredGoBack({ status: 'go-back', dispositionedAt: at(5 * DAY) }, NOW), false);
      assert.equal(isExpiredGoBack({ status: 'not-home', dispositionedAt: at(500 * DAY) }, NOW), false);
      assert.equal(isExpiredGoBack({ status: 'go-back' }, NOW), false);
    });
    it('a new dispo ends it: the next status is what is stored and shown', () => {
      const lead = { status: 'go-back', dispositionedAt: at(120 * DAY) };
      assert.equal(isExpiredGoBack(lead, NOW), true);
      assert.equal(isExpiredGoBack({ ...lead, status: 'interested', dispositionedAt: at(0) }, NOW), false);
      // A fresh go-back restarts the clock.
      assert.equal(isExpiredGoBack({ ...lead, dispositionedAt: at(0) }, NOW), false);
    });
    it('its owners are the territory owners', () => {
      const terr = prepareTerritories([T('a', 'sawyer')]);
      const lead = pin({ status: 'go-back', goBackScheduledBy: 'jordan', dispositionedAt: at(120 * DAY) });
      assert.deepEqual(effectiveOwner(lead, terr, NOW).ownerIds, ['sawyer']);
    });
  });

  describe('foreign territory warning', () => {
    const terr = prepareTerritories([T('a', 'sawyer'), T('b', 'jordan')]);
    it('warns a rep who is in nobody-of-theirs territory, every time', () => {
      const r = foreignTerritoryWarning(33.45, -112.07, 'steven', terr);
      assert.equal(r.warn, true);
      assert.deepEqual(r.ownerIds.sort(), ['jordan', 'sawyer']);
      assert.equal(foreignTerritoryWarning(33.45, -112.07, 'steven', terr).warn, true);
    });
    it('skips dual owners, assignees and pins in no territory', () => {
      assert.equal(foreignTerritoryWarning(33.45, -112.07, 'sawyer', terr).warn, false);
      assert.equal(foreignTerritoryWarning(33.45, -112.07, 'jordan', terr).warn, false);
      assert.equal(foreignTerritoryWarning(10, 10, 'steven', terr).warn, false);
      assert.equal(foreignTerritoryWarning(undefined, undefined, 'steven', terr).warn, false);
    });
    it('uses the exact text from Evan', () => {
      assert.equal(FOREIGN_TERRITORY_WARNING, "Warning: You are in another user's territory. Do you wish to place this pin?");
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
