import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  selectNewestInBounds,
  shouldKeepKnockingProspect,
} from '../app/utils/knockingPinVisibility.ts';

const uid = 'FuZw0jYzm3PMzSsNytHgJjGybOD3';
const helm = { south: 43.0, north: 43.02, west: -78.76, east: -78.74 };

function pin(partial: Record<string, unknown>) {
  return {
    id: '1',
    lat: 43.0075,
    lng: -78.75,
    status: 'assigned',
    ...partial,
  };
}

describe('shouldKeepKnockingProspect', () => {
  it('keeps missing solar and non-poor turf', () => {
    assert.equal(shouldKeepKnockingProspect(pin({ solarCategory: undefined }), uid), true);
    assert.equal(shouldKeepKnockingProspect(pin({ solarCategory: 'good' }), uid), true);
  });

  it('strips unowned cold poor turf', () => {
    assert.equal(
      shouldKeepKnockingProspect(pin({ solarCategory: 'poor', claimedBy: null, assignedTo: null, source: 'upload' }), uid),
      false
    );
  });

  it('keeps poor when claimed, assigned, manually-added, or knocked', () => {
    assert.equal(shouldKeepKnockingProspect(pin({ solarCategory: 'poor', claimedBy: uid }), uid), true);
    assert.equal(shouldKeepKnockingProspect(pin({ solarCategory: 'poor', assignedTo: uid }), uid), true);
    assert.equal(shouldKeepKnockingProspect(pin({ solarCategory: 'poor', source: 'manually-added' }), 'other'), true);
    assert.equal(shouldKeepKnockingProspect(pin({ solarCategory: 'poor', status: 'not-home' }), 'other'), true);
  });
});

describe('selectNewestInBounds', () => {
  it('keeps newest createdAt when the viewport cap is 400', () => {
    const leads = [];
    for (let i = 0; i < 420; i++) {
      leads.push(pin({
        id: `${1_700_000_000_000 + i}-old`,
        createdAt: new Date(1_700_000_000_000 + i),
        lat: 43.007,
        lng: -78.75,
      }));
    }
    const today = Array.from({ length: 31 }, (_, i) => pin({
      id: `${1_787_598_000_000 + i}-today`,
      createdAt: new Date(1_787_598_000_000 + i),
      lat: 43.0078,
      lng: -78.748,
    }));
    const kept = selectNewestInBounds([...leads, ...today], helm, 400);
    assert.equal(kept.length, 400);
    const todayKept = kept.filter((l) => String(l.id).includes('-today'));
    assert.equal(todayKept.length, 31);
  });
});

describe('claimedBy 4000 oldest page drops today; next __name__ page restores it', () => {
  it('merges the newer-id tail after an oldest-4000 fill', () => {
    const claimedCount = 4173;
    const ids = Array.from({ length: claimedCount }, (_, i) => `${1_600_000_000_000 + i}-x`);
    const today = ids.slice(-31);
    const firstPage = ids.slice(0, 4000);
    assert.equal(firstPage.some((id) => today.includes(id)), false);

    const tailPage = ids.slice(4000, 8000);
    const merged = [...firstPage, ...tailPage];
    assert.equal(today.every((id) => merged.includes(id)), true);

    const turf = merged.map((id, i) => pin({
      id,
      createdAt: new Date(Number(id.split('-')[0])),
      lat: 43.007 + (i % 10) * 0.0001,
      lng: -78.75,
    }));
    const kept = selectNewestInBounds(turf, helm, 400);
    assert.equal(kept.filter((l) => today.includes(String(l.id))).length, 31);
  });
});
