import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  colorForTerritory,
  colorTerritories,
  membersFromTerritories,
  polygonCentroid,
  shouldRenderTerritoryOverlay,
} from '../app/utils/teamAreas.ts';
import { colorForUserId, getDefaultUserColor } from '../app/utils/userColors.ts';
import type { Territory } from '../app/types/territory.ts';

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

describe('colorForUserId / colorForTerritory', () => {
  it('uses existing user.color, not a hardcoded name map', () => {
    const users = [
      { id: 'u1', color: '#FF0000' },
      { id: 'u2', color: '#00FF00' },
    ];
    assert.equal(colorForUserId('u1', users), '#FF0000');
    assert.equal(colorForTerritory({ userId: 'u2', userColor: '#999999' }, users), '#00FF00');
  });

  it('falls back to territory.userColor, then TERRITORY_COLORS', () => {
    assert.equal(
      colorForTerritory({ userId: 'missing', userColor: '#FF6600' }, []),
      '#FF6600'
    );
    assert.equal(colorForUserId('unknown', []), getDefaultUserColor(0));
  });

  it('paints territories from the user roster', () => {
    const territories = [
      {
        id: 't1',
        userId: 'u1',
        userName: 'Owner One',
        userColor: '#111111',
        polygon: [
          { lat: 42.9, lng: -78.8 },
          { lat: 42.91, lng: -78.8 },
          { lat: 42.91, lng: -78.79 },
        ],
        leadIds: [],
        createdAt: new Date('2026-01-01'),
        createdBy: 'admin',
      },
    ] as Territory[];
    const colored = colorTerritories(territories, [{ id: 'u1', color: '#00FFFF' }]);
    assert.equal(colored[0].userColor, '#00FFFF');
    assert.equal(colored[0].userName, 'Owner One');
  });
});

describe('membersFromTerritories', () => {
  const territories = [
    {
      id: 't1',
      userId: 'u1',
      userName: 'Owner One',
      userColor: '#111111',
      polygon: [
        { lat: 42.9, lng: -78.8 },
        { lat: 42.92, lng: -78.8 },
        { lat: 42.92, lng: -78.78 },
        { lat: 42.9, lng: -78.78 },
      ],
      leadIds: [],
      createdAt: new Date('2026-01-01'),
      createdBy: 'admin',
    },
  ] as Territory[];

  it('places one named pin at the polygon centroid in user.color', () => {
    const members = membersFromTerritories(territories, [{ id: 'u1', color: '#FF0000' }]);
    assert.equal(members.length, 1);
    assert.equal(members[0].id, 'u1');
    assert.equal(members[0].name, 'Owner One');
    assert.equal(members[0].color, '#FF0000');
    const center = polygonCentroid(territories[0].polygon);
    assert.ok(center);
    assert.equal(members[0].lat, center?.lat);
    assert.equal(members[0].lng, center?.lng);
  });

  it('prefers an existing users.currentLocation when present', () => {
    const members = membersFromTerritories(territories, [
      { id: 'u1', name: 'Owner One', color: '#FF0000', currentLocation: { lat: 42.95, lng: -78.7 } },
    ]);
    assert.equal(members[0].lat, 42.95);
    assert.equal(members[0].lng, -78.7);
    assert.equal(members[0].color, '#FF0000');
  });
});
