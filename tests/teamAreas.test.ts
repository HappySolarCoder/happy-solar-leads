import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isRecentTeamLocation,
  membersFromUserRecords,
  parseCurrentLocation,
  shouldPublishTeamLocation,
  shouldRenderTerritoryOverlay,
  TEAM_LOCATION_STALE_MS,
} from '../app/utils/teamAreas.ts';

describe('shouldRenderTerritoryOverlay', () => {
  it('is off on the regular map unless the user toggle is on', () => {
    assert.equal(shouldRenderTerritoryOverlay('map', false), false);
    assert.equal(shouldRenderTerritoryOverlay('map', true), true);
  });

  it('stays on for existing assignment and territory views', () => {
    assert.equal(shouldRenderTerritoryOverlay('assignments', false), true);
    assert.equal(shouldRenderTerritoryOverlay('territory', false), true);
  });
});

describe('parseCurrentLocation / isRecentTeamLocation', () => {
  const now = Date.parse('2026-08-31T15:00:00.000Z');

  it('accepts a recent ISO timestamp', () => {
    const loc = parseCurrentLocation(
      { lat: 42.91, lng: -78.75, timestamp: '2026-08-31T14:50:00.000Z' },
      now
    );
    assert.ok(loc);
    assert.equal(loc?.lat, 42.91);
    assert.equal(loc?.lng, -78.75);
  });

  it('rejects stale locations', () => {
    assert.equal(
      isRecentTeamLocation('2026-08-31T14:00:00.000Z', now, TEAM_LOCATION_STALE_MS),
      false
    );
    assert.equal(
      parseCurrentLocation(
        { lat: 42.91, lng: -78.75, timestamp: '2026-08-31T14:00:00.000Z' },
        now
      ),
      null
    );
  });

  it('rejects invalid coordinates', () => {
    assert.equal(parseCurrentLocation({ lat: 999, lng: -78.75, timestamp: now }, now), null);
    assert.equal(parseCurrentLocation({ lat: 42.91, lng: 'east' }, now), null);
  });

  it('parses Firestore-like {seconds} timestamps', () => {
    const loc = parseCurrentLocation(
      { lat: 42.9, lng: -78.7, timestamp: { seconds: now / 1000 } },
      now
    );
    assert.ok(loc);
    assert.equal(loc?.lat, 42.9);
  });
});

describe('membersFromUserRecords', () => {
  const now = Date.parse('2026-08-31T15:00:00.000Z');

  it('keeps only users with a recent currentLocation', () => {
    const members = membersFromUserRecords(
      [
        {
          id: 'sawyer',
          name: 'Sawyer Vermeesch',
          color: '#FF0000',
          currentLocation: { lat: 42.91, lng: -78.75, timestamp: '2026-08-31T14:55:00.000Z' },
        },
        {
          id: 'stale',
          name: 'Old Pin',
          color: '#00FF00',
          currentLocation: { lat: 42.9, lng: -78.7, timestamp: '2026-08-31T13:00:00.000Z' },
        },
        { id: 'none', name: 'No GPS', color: '#0000FF' },
      ],
      now
    );
    assert.deepEqual(members.map((m) => m.id), ['sawyer']);
    assert.equal(members[0].name, 'Sawyer Vermeesch');
    assert.equal(members[0].color, '#FF0000');
  });
});

describe('shouldPublishTeamLocation', () => {
  it('publishes the first point and ignores tiny GPS jitter', () => {
    const first = { lat: 42.91, lng: -78.75 };
    assert.equal(shouldPublishTeamLocation(null, first), true);
    assert.equal(
      shouldPublishTeamLocation(first, { lat: 42.91001, lng: -78.75001 }),
      false
    );
    assert.equal(
      shouldPublishTeamLocation(first, { lat: 42.911, lng: -78.751 }),
      true
    );
  });
});
