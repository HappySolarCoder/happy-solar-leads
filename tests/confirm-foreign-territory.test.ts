import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { shouldWarnForeignTerritory } from '../app/utils/confirmForeignTerritory.ts';
import { FOREIGN_TERRITORY_WARNING, prepareTerritories, STAFF_POPUP_EXEMPT } from '../app/utils/effectiveOwner.ts';

const box = (lat: number, lng: number, d = 0.01) => [
  { lat: lat - d, lng: lng - d }, { lat: lat - d, lng: lng + d }, { lat: lat + d, lng: lng + d }, { lat: lat + d, lng: lng - d },
];
const terr = (id: string, userId: string, extra: Record<string, unknown> = {}) => ({
  id, data: { userId, polygon: box(33.45, -112.07), createdAt: '2026-08-03T00:00:00.000Z', ...extra },
});
const base = { mode: 'territory' as const, uid: 'steven', role: 'setter', lat: 33.45, lng: -112.07 };

describe('foreign territory warning decision', () => {
  const territories = prepareTerritories([terr('a', 'sawyer')]);

  it('warns every time a rep is in someone else\'s territory', () => {
    assert.equal(shouldWarnForeignTerritory({ ...base, territories }), true);
    assert.equal(shouldWarnForeignTerritory({ ...base, territories }), true);
  });
  it('is off when the flag is not territory', () => {
    assert.equal(shouldWarnForeignTerritory({ ...base, mode: 'legacy', territories }), false);
  });
  it('skips the pin owner, dual owners and territory assignees', () => {
    assert.equal(shouldWarnForeignTerritory({ ...base, uid: 'sawyer', territories }), false);
    const dual = prepareTerritories([terr('a', 'sawyer'), terr('b', 'steven')]);
    assert.equal(shouldWarnForeignTerritory({ ...base, territories: dual }), false);
    const shared = prepareTerritories([terr('a', 'sawyer', { userIds: ['sawyer', 'steven'] })]);
    assert.equal(shouldWarnForeignTerritory({ ...base, territories: shared }), false);
  });
  it('skips a pin in no territory and a missing position', () => {
    assert.equal(shouldWarnForeignTerritory({ ...base, territories, lat: 10, lng: 10 }), false);
    assert.equal(shouldWarnForeignTerritory({ ...base, territories, lat: undefined, lng: undefined }), false);
    assert.equal(shouldWarnForeignTerritory({ ...base, territories: [] }), false);
  });
  it('staff exemption follows the single switch (default true, TBD with Evan)', () => {
    assert.equal(STAFF_POPUP_EXEMPT, true);
    assert.equal(shouldWarnForeignTerritory({ ...base, role: 'admin', territories }), !STAFF_POPUP_EXEMPT);
    assert.equal(shouldWarnForeignTerritory({ ...base, role: 'manager', territories }), !STAFF_POPUP_EXEMPT);
  });
  it('uses Evan\'s exact text', () => {
    assert.equal(FOREIGN_TERRITORY_WARNING, "Warning: You are in another user's territory. Do you wish to place this pin?");
  });
});

describe('the warning is wired into place and dispo', () => {
  it('LeadDetail.handleStatusChange asks before any dispo flow starts; LeadMap asks before saving a dropped pin', () => {
    const detail = readFileSync(new URL('../app/components/LeadDetail.tsx', import.meta.url), 'utf8');
    const status = detail.slice(detail.indexOf('const handleStatusChange'));
    assert.ok(status.indexOf('confirmForeignTerritory') > 0);
    assert.ok(status.indexOf('confirmForeignTerritory') < status.indexOf('isScheduledGoBackStatus(newStatus)'));
    const map = readFileSync(new URL('../app/components/LeadMap.tsx', import.meta.url), 'utf8');
    const save = map.slice(map.indexOf('const handleSaveDroppedLead'));
    assert.ok(save.indexOf('confirmForeignTerritory') > 0);
    assert.ok(save.indexOf('confirmForeignTerritory') < save.indexOf('saveLeadAsync'));
  });
});
