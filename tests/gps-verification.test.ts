import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { distanceBetween } from 'geofire-common';
import {
  AREA_EDGE_FLOOR_M,
  GPS_ACCURACY_CREDIT_CAP_M,
  GPS_AREA_EXEMPT_ROLES,
  GPS_CAPTURE_AFTER_MS,
  GPS_CAPTURE_BEFORE_MS,
  GPS_MAX_VERIFIED_ACCURACY_M,
  GPS_REDUCED_ACCURACY_M,
  RADIUS_M,
  decideKnockGps,
  gpsRulePasses,
  isAreaExemptRole,
  outsideBy,
  type LatLng,
} from '../app/utils/gpsRule';

const PIN = { lat: 33.45, lng: -112.07 };

function northOf(origin: LatLng, meters: number): LatLng {
  const kmRadius = 6371;
  let delta = (meters / 1000) / kmRadius * (180 / Math.PI);
  let lat = origin.lat;
  for (let i = 0; i < 8; i += 1) {
    lat = origin.lat + delta;
    const measured = distanceBetween([origin.lat, origin.lng], [lat, origin.lng]) * 1000;
    if (measured === 0) break;
    delta *= meters / measured;
  }
  return { lat, lng: origin.lng };
}

function square(lat: number, lng: number, delta = 0.02): LatLng[] {
  return [
    { lat: lat - delta, lng: lng - delta },
    { lat: lat - delta, lng: lng + delta },
    { lat: lat + delta, lng: lng + delta },
    { lat: lat + delta, lng: lng - delta },
  ];
}

describe('shared GPS verification rule', () => {
  it('verifies d - min(acc, 15) <= RADIUS_M and acc <= 65, inclusive', () => {
    assert.equal(RADIUS_M, 35);
    assert.equal(GPS_ACCURACY_CREDIT_CAP_M, 15);
    assert.equal(GPS_MAX_VERIFIED_ACCURACY_M, 65);
    assert.equal(GPS_REDUCED_ACCURACY_M, 1000);
    assert.equal(GPS_CAPTURE_BEFORE_MS, 30_000);
    assert.equal(GPS_CAPTURE_AFTER_MS, 15_000);
    assert.equal(AREA_EDGE_FLOOR_M, 30);
    assert.deepEqual([...GPS_AREA_EXEMPT_ROLES], ['admin', 'manager']);
    assert.equal(isAreaExemptRole('closer'), false);

    assert.equal(gpsRulePasses(50, 15), true);
    assert.equal(gpsRulePasses(50.1, 15), false);
    assert.equal(gpsRulePasses(35, 0), true);
    assert.equal(gpsRulePasses(35.1, 0), false);
    assert.equal(gpsRulePasses(50, 65), true);
    assert.equal(gpsRulePasses(50.1, 65), false);
    assert.equal(gpsRulePasses(0, 65.1), false);
    assert.equal(gpsRulePasses(0, 1000), false);
    assert.equal(gpsRulePasses(0, 0), true);
  });

  it('stores malformed fixes as no_fix and a lead with no coordinates as other', () => {
    const missing = decideKnockGps({ fix: 'absent', reference: PIN });
    assert.equal(missing.gpsUnverifiedReason, 'no_fix');
    assert.equal(missing.keepFix, false);

    const malformed = decideKnockGps({ fix: 'malformed', reference: PIN });
    assert.equal(malformed.gpsUnverifiedReason, 'no_fix');
    assert.equal(malformed.keepFix, false);

    const negative = decideKnockGps({ fix: { ...PIN, accuracyM: -1 }, reference: PIN });
    assert.equal(negative.gpsUnverifiedReason, 'no_fix');
    assert.equal(negative.keepFix, false);

    const nanAccuracy = decideKnockGps({ fix: { ...PIN, accuracyM: Number.NaN }, reference: PIN });
    assert.equal(nanAccuracy.gpsUnverifiedReason, 'no_fix');

    const nanLat = decideKnockGps({ fix: { lat: Number.NaN, lng: PIN.lng, accuracyM: 5 }, reference: PIN });
    assert.equal(nanLat.gpsUnverifiedReason, 'no_fix');
    assert.equal(nanLat.keepFix, false);

    const outOfRange = decideKnockGps({ fix: { lat: 91, lng: PIN.lng, accuracyM: 5 }, reference: PIN });
    assert.equal(outOfRange.gpsUnverifiedReason, 'no_fix');
    const badLng = decideKnockGps({ fix: { lat: PIN.lat, lng: 181, accuracyM: 5 }, reference: PIN });
    assert.equal(badLng.gpsUnverifiedReason, 'no_fix');

    const noLead = decideKnockGps({ fix: { ...PIN, accuracyM: 8 }, reference: null });
    assert.equal(noLead.gpsUnverifiedReason, 'other');
    assert.equal(noLead.keepFix, true);
    assert.equal(noLead.gpsDistanceM, undefined);
  });

  it('applies the capture window and accuracy bands before area and distance', () => {
    const onPin = { ...PIN, accuracyM: 5 };
    const staleBefore = decideKnockGps({
      fix: { ...onPin, capturedAtMs: 0 },
      actionAtMs: GPS_CAPTURE_BEFORE_MS + 1,
      reference: PIN,
    });
    assert.equal(staleBefore.gpsUnverifiedReason, 'stale');
    const freshBefore = decideKnockGps({
      fix: { ...onPin, capturedAtMs: 0 },
      actionAtMs: GPS_CAPTURE_BEFORE_MS,
      reference: PIN,
    });
    assert.equal(freshBefore.gpsVerified, true);

    const staleAfter = decideKnockGps({
      fix: { ...onPin, capturedAtMs: GPS_CAPTURE_AFTER_MS + 1 },
      actionAtMs: 0,
      reference: PIN,
    });
    assert.equal(staleAfter.gpsUnverifiedReason, 'stale');
    const freshAfter = decideKnockGps({
      fix: { ...onPin, capturedAtMs: GPS_CAPTURE_AFTER_MS },
      actionAtMs: 0,
      reference: PIN,
    });
    assert.equal(freshAfter.gpsVerified, true);

    const low = decideKnockGps({ fix: { ...PIN, accuracyM: 65.1 }, reference: PIN });
    assert.equal(low.gpsUnverifiedReason, 'low_accuracy');
    const justLow = decideKnockGps({ fix: { ...PIN, accuracyM: 999 }, reference: PIN });
    assert.equal(justLow.gpsUnverifiedReason, 'low_accuracy');
    const reduced = decideKnockGps({ fix: { ...PIN, accuracyM: 1000 }, reference: PIN });
    assert.equal(reduced.gpsUnverifiedReason, 'reduced_accuracy');
    const coarser = decideKnockGps({ fix: { ...PIN, accuracyM: 5000 }, reference: PIN });
    assert.equal(coarser.gpsUnverifiedReason, 'reduced_accuracy');

    const atCap = decideKnockGps({ fix: { ...PIN, accuracyM: 65 }, reference: PIN });
    assert.equal(atCap.gpsVerified, true);
    assert.equal(atCap.gpsDistanceM, 0);
  });

  it('flags out_of_area only outside every polygon by more than max(acc, 30m)', () => {
    const area = square(PIN.lat, PIN.lng);
    const northEdge = { lat: PIN.lat + 0.02, lng: PIN.lng };
    const near = northOf(northEdge, 20);
    const beyond = northOf(northEdge, 40);
    const farLead = northOf(PIN, 500);

    assert.equal(outsideBy(PIN, area), 0);
    const nearDistance = outsideBy(near, area);
    const beyondDistance = outsideBy(beyond, area);
    assert.ok(nearDistance > 15 && nearDistance < 25, String(nearDistance));
    assert.ok(beyondDistance > 35 && beyondDistance < 45, String(beyondDistance));

    const inside = decideKnockGps({
      fix: { ...PIN, accuracyM: 5 },
      reference: PIN,
      role: 'setter',
      polygons: [area],
    });
    assert.equal(inside.gpsVerified, true);

    const nearEdge = decideKnockGps({
      fix: { ...near, accuracyM: 5 },
      reference: farLead,
      role: 'setter',
      polygons: [area],
    });
    assert.equal(nearEdge.gpsUnverifiedReason, 'too_far');

    const outside = decideKnockGps({
      fix: { ...beyond, accuracyM: 5 },
      reference: PIN,
      role: 'setter',
      polygons: [area],
    });
    assert.equal(outside.gpsUnverifiedReason, 'out_of_area');

    const wideAccuracy = decideKnockGps({
      fix: { ...beyond, accuracyM: 50 },
      reference: PIN,
      role: 'setter',
      polygons: [area],
    });
    assert.equal(wideAccuracy.gpsUnverifiedReason, 'too_far');

    const second = square(beyond.lat, beyond.lng, 0.001);
    const coveredByOther = decideKnockGps({
      fix: { ...beyond, accuracyM: 5 },
      reference: PIN,
      role: 'closer',
      polygons: [area, second],
    });
    assert.equal(coveredByOther.gpsUnverifiedReason, 'too_far');

    const exempt = decideKnockGps({
      fix: { ...beyond, accuracyM: 5 },
      reference: farLead,
      role: 'admin',
      polygons: [area],
    });
    assert.equal(exempt.gpsUnverifiedReason, 'too_far');
    const manager = decideKnockGps({
      fix: { ...beyond, accuracyM: 5 },
      reference: farLead,
      role: 'manager',
      polygons: [area],
    });
    assert.equal(manager.gpsUnverifiedReason, 'too_far');

    const noTerritory = decideKnockGps({
      fix: { ...farLead, accuracyM: 5 },
      reference: PIN,
      role: 'setter',
      polygons: [],
    });
    assert.equal(noTerritory.gpsUnverifiedReason, 'too_far');

    const unknown = decideKnockGps({
      fix: { ...beyond, accuracyM: 5 },
      reference: PIN,
      role: 'setter',
      polygons: 'unknown',
    });
    assert.equal(unknown.gpsUnverifiedReason, 'too_far');

    const staleBeatsArea = decideKnockGps({
      fix: { ...beyond, accuracyM: 5, capturedAtMs: 0 },
      actionAtMs: 31_000,
      reference: PIN,
      role: 'setter',
      polygons: [area],
    });
    assert.equal(staleBeatsArea.gpsUnverifiedReason, 'stale');

    const reducedBeatsArea = decideKnockGps({
      fix: { ...beyond, accuracyM: 1000 },
      reference: PIN,
      role: 'setter',
      polygons: [area],
    });
    assert.equal(reducedBeatsArea.gpsUnverifiedReason, 'reduced_accuracy');

    const lowBeatsArea = decideKnockGps({
      fix: { ...beyond, accuracyM: 66 },
      reference: PIN,
      role: 'setter',
      polygons: [area],
    });
    assert.equal(lowBeatsArea.gpsUnverifiedReason, 'low_accuracy');

    const noFixBeatsArea = decideKnockGps({
      fix: 'malformed',
      reference: PIN,
      role: 'setter',
      polygons: [area],
    });
    assert.equal(noFixBeatsArea.gpsUnverifiedReason, 'no_fix');

    const areaBeatsMissingLead = decideKnockGps({
      fix: { ...beyond, accuracyM: 5 },
      reference: null,
      role: 'setter',
      polygons: [area],
    });
    assert.equal(areaBeatsMissingLead.gpsUnverifiedReason, 'out_of_area');

    const corners = 2_197;
    const edge = square(PIN.lat, PIN.lng);
    const perEdge = Math.floor(corners / 4);
    const dense: LatLng[] = [];
    for (let side = 0; side < 4; side += 1) {
      const from = edge[side];
      const to = edge[(side + 1) % 4];
      const steps = side === 3 ? corners - dense.length : perEdge;
      for (let step = 0; step < steps; step += 1) {
        const t = step / steps;
        dense.push({ lat: from.lat + (to.lat - from.lat) * t, lng: from.lng + (to.lng - from.lng) * t });
      }
    }
    assert.equal(dense.length, corners);
    assert.equal(outsideBy(PIN, dense), 0);
    assert.ok(outsideBy(beyond, dense) > AREA_EDGE_FLOOR_M);
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
