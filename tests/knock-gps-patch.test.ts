import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RADIUS_M } from '../app/utils/gpsRule';
import { leadDetailKnockGps } from '../app/utils/leadDetailGps';

const LEAD_LAT = 42.9;
const LEAD_LNG = -78.8;
const CAPTURED = 1_700_000_000_000;

function atMetersNorth(meters: number) {
  return LEAD_LAT + meters / 111_320;
}

function patch(meters: number, accuracy: number, extra: { latitude?: number; accuracy?: number; lead?: boolean } = {}) {
  return leadDetailKnockGps({
    latitude: extra.latitude ?? atMetersNorth(meters),
    longitude: LEAD_LNG,
    accuracy: extra.accuracy ?? accuracy,
    capturedAtMs: CAPTURED,
    actionAtMs: CAPTURED,
    leadLat: extra.lead === false ? undefined : LEAD_LAT,
    leadLng: extra.lead === false ? undefined : LEAD_LNG,
    radiusM: RADIUS_M,
  });
}

describe('lead detail knock GPS patch', () => {
  it('uses RADIUS_M, keeps a passing fix, and stamps the fix time', () => {
    assert.equal(RADIUS_M, 35);
    const result = patch(12, 12);
    assert.equal(result.gpsVerified, true);
    assert.equal(result.gpsUnverifiedReason, null);
    assert.ok(result.gpsDistanceM != null && result.gpsDistanceM < 20);
    assert.equal(result.knockGpsTimestamp?.getTime(), CAPTURED);
  });

  it('flags a far fix as too_far and a malformed fix as no_fix', () => {
    const far = patch(80, 12);
    assert.equal(far.gpsVerified, false);
    assert.equal(far.gpsUnverifiedReason, 'too_far');
    assert.ok(far.knockGpsLat != null);

    const beyond = patch(250_000, 12);
    assert.equal(beyond.gpsVerified, false);
    assert.equal(beyond.gpsUnverifiedReason, 'too_far');
    assert.equal(beyond.gpsDistanceM, null);

    const malformed = patch(0, 12, { latitude: 120, accuracy: -1 });
    assert.equal(malformed.gpsVerified, false);
    assert.equal(malformed.gpsUnverifiedReason, 'no_fix');
    assert.equal(malformed.knockGpsLat, undefined);
  });

  it('keeps other for a usable fix with no lead coordinates', () => {
    const result = patch(0, 8, { lead: false });
    assert.equal(result.gpsVerified, false);
    assert.equal(result.gpsUnverifiedReason, 'other');
    assert.equal(result.knockGpsLat, LEAD_LAT);
  });
});
