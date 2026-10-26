import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  GPS_ACCURACY_CREDIT_CAP_M,
  GPS_MAX_VERIFIED_ACCURACY_M,
  GPS_VERIFIED_MAX_ADJUSTED_M,
  decideKnockGps,
  gpsRulePasses,
} from '../app/utils/gpsRule';

describe('shared GPS verification rule', () => {
  it('uses d - min(acc, 40) <= 75 and acc <= 65, inclusive', () => {
    assert.equal(GPS_ACCURACY_CREDIT_CAP_M, 40);
    assert.equal(GPS_VERIFIED_MAX_ADJUSTED_M, 75);
    assert.equal(GPS_MAX_VERIFIED_ACCURACY_M, 65);
    assert.equal(gpsRulePasses(115, 65), true);
    assert.equal(gpsRulePasses(115.1, 65), false);
    assert.equal(gpsRulePasses(115, 40), true);
    assert.equal(gpsRulePasses(115.1, 40), false);
    assert.equal(gpsRulePasses(10, 65.1), false);
    assert.equal(gpsRulePasses(0, 0), true);
  });

  it('names every unverified reason without refusing the save', () => {
    const reference = { lat: 33.45, lng: -112.07 };
    const missing = decideKnockGps({ fix: 'absent', reference });
    assert.equal(missing.gpsUnverifiedReason, 'no_fix');
    assert.equal(missing.keepFix, false);

    const malformed = decideKnockGps({ fix: 'malformed', reference });
    assert.equal(malformed.gpsUnverifiedReason, 'other');
    assert.equal(malformed.keepFix, false);

    const stale = decideKnockGps({
      fix: { ...reference, accuracyM: 5, capturedAtMs: 0 },
      actionAtMs: 6_000,
      reference,
    });
    assert.equal(stale.gpsUnverifiedReason, 'stale');
    assert.equal(stale.keepFix, true);

    const low = decideKnockGps({ fix: { ...reference, accuracyM: 66 }, reference });
    assert.equal(low.gpsUnverifiedReason, 'low_accuracy');
    assert.equal(low.gpsVerified, false);

    const onPin = decideKnockGps({ fix: { ...reference, accuracyM: 65 }, reference });
    assert.equal(onPin.gpsVerified, true);
    assert.equal(onPin.gpsUnverifiedReason, undefined);
    assert.equal(onPin.gpsDistanceM, 0);
  });

  it('leaves LeadDetail and the map pin gate for the rules PR', () => {
    const detail = readFileSync(new URL('../app/components/LeadDetail.tsx', import.meta.url), 'utf8');
    assert.equal(detail.includes('gpsRule'), false);
    assert.equal(detail.includes('leadDetailKnockGps'), false);
    assert.equal(detail.includes('not close enough'), true);

    const map = readFileSync(new URL('../app/components/LeadMap.tsx', import.meta.url), 'utf8');
    assert.equal(map.includes('PROXIMITY_MAX_DISTANCE_METERS'), true);
  });
});
