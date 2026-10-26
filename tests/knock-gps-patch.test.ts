import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  knockGpsPatchFromFix,
  knockGpsPatchUnverified,
} from '../app/utils/knockGpsPatch';

const at = new Date('2026-10-25T16:30:00Z');
const fix = {
  latitude: 42.9,
  longitude: -78.8,
  accuracy: 12,
  timestamp: at,
};

describe('knock GPS disposition patch', () => {
  it('records a close fix as verified and does not add a reason', () => {
    assert.deepEqual(knockGpsPatchFromFix({ ...fix, distanceM: 12 }, 50), {
      knockGpsLat: 42.9,
      knockGpsLng: -78.8,
      knockGpsAccuracy: 12,
      knockGpsTimestamp: at,
      knockDistanceFromAddress: 12,
      gpsDistanceM: 12,
      gpsVerified: true,
    });
  });

  it('keeps a far fix in the patch with too_far instead of dropping the disposition', () => {
    const patch = knockGpsPatchFromFix({ ...fix, distanceM: 5000 }, 50);
    assert.equal(patch.gpsVerified, false);
    assert.equal(patch.gpsUnverifiedReason, 'too_far');
    assert.equal(patch.gpsDistanceM, 5000);
    assert.equal(patch.knockDistanceFromAddress, 5000);
  });

  it('omits gpsDistanceM above 100000 and still marks the knock too far', () => {
    const patch = knockGpsPatchFromFix({ ...fix, distanceM: 250000 }, 50);
    assert.equal(patch.gpsVerified, false);
    assert.equal(patch.gpsUnverifiedReason, 'too_far');
    assert.equal(patch.gpsDistanceM, undefined);
    assert.equal(patch.knockDistanceFromAddress, 250000);
  });

  it('records a missing distance without knock numbers that would fail the rules', () => {
    const patch = knockGpsPatchFromFix({ ...fix, latitude: 120, accuracy: -1 }, 50);
    assert.equal(patch.gpsVerified, false);
    assert.equal(patch.gpsUnverifiedReason, 'other');
    assert.equal(patch.knockGpsLat, undefined);
    assert.equal(patch.knockGpsAccuracy, undefined);
    assert.equal(patch.knockGpsLng, -78.8);
  });

  it('sends only the two optional flags when there is no fix', () => {
    assert.deepEqual(knockGpsPatchUnverified('no_fix'), {
      gpsVerified: false,
      gpsUnverifiedReason: 'no_fix',
    });
  });
});
