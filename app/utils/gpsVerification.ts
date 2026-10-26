import { distanceBetween } from 'geofire-common';

/**
 * One shared GPS rule for the dispo route and LeadDetail.
 * A fix is verified only when d - min(accuracy, 40) <= 75 and accuracy <= 65.
 * GPS never blocks a disposition. A failed check is stored as a flag.
 */
export const GPS_ACCURACY_CREDIT_CAP_M = 40;
export const GPS_VERIFIED_MAX_ADJUSTED_M = 75;
export const GPS_MAX_VERIFIED_ACCURACY_M = 65;
export const GPS_DISTANCE_MAX_M = 100_000;
/** Homeowner doc may replace the lead as the reference point inside this radius. */
export const GPS_HOMEOWNER_NEAR_LEAD_M = 75;
/** Same street and municipality may stretch the homeowner reference out to this radius. */
export const GPS_HOMEOWNER_SAME_STREET_M = 2_000;
export const GPS_CAPTURE_BEFORE_MS = 5_000;
export const GPS_CAPTURE_AFTER_MS = 15_000;

export const GPS_UNVERIFIED_REASONS = [
  'no_fix',
  'stale',
  'low_accuracy',
  'reduced_accuracy',
  'too_far',
  'other',
] as const;

export type GpsUnverifiedReason = (typeof GPS_UNVERIFIED_REASONS)[number];

const REASON_SET: ReadonlySet<string> = new Set(GPS_UNVERIFIED_REASONS);

export function isGpsUnverifiedReason(value: unknown): value is GpsUnverifiedReason {
  return typeof value === 'string' && REASON_SET.has(value);
}

export type LatLng = { lat: number; lng: number };

export type KnockFix = LatLng & {
  accuracyM: number;
  capturedAtMs?: number;
};

export type GpsFlag = {
  gpsVerified: boolean;
  gpsUnverifiedReason?: GpsUnverifiedReason;
  gpsDistanceM?: number;
};

export type GpsDecision = GpsFlag & {
  /** False when the fix is missing or malformed. Coordinates are not stored. */
  keepFix: boolean;
};

export function metersBetween(a: LatLng, b: LatLng): number {
  return distanceBetween([a.lat, a.lng], [b.lat, b.lng]) * 1000;
}

/** d - min(acc, 40) <= 75 && acc <= 65. Both bounds are inclusive. */
export function gpsRulePasses(distanceM: number, accuracyM: number): boolean {
  return distanceM - Math.min(accuracyM, GPS_ACCURACY_CREDIT_CAP_M) <= GPS_VERIFIED_MAX_ADJUSTED_M
    && accuracyM <= GPS_MAX_VERIFIED_ACCURACY_M;
}

export function finitePoint(lat: unknown, lng: unknown): LatLng | null {
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

export function storeableDistance(distanceM: number | null): number | undefined {
  if (distanceM == null || !Number.isFinite(distanceM) || distanceM < 0 || distanceM > GPS_DISTANCE_MAX_M) {
    return undefined;
  }
  return distanceM;
}

function captureIsStale(fix: KnockFix, actionAtMs: number | undefined): boolean {
  if (fix.capturedAtMs == null || actionAtMs == null) return false;
  const delta = fix.capturedAtMs - actionAtMs;
  return delta < -GPS_CAPTURE_BEFORE_MS || delta > GPS_CAPTURE_AFTER_MS;
}

/**
 * Server (and LeadDetail) reason for an unverified fix.
 * Stale capture wins, then accuracy above 65 m, then a miss inside the
 * 40–65 m band (reduced_accuracy), then too_far. `other` is only for a
 * malformed fix that is dropped. `no_fix` is only for a missing fix.
 */
export function decideKnockGps(input: {
  fix: KnockFix | 'absent' | 'malformed';
  actionAtMs?: number;
  reference: LatLng | null;
}): GpsDecision {
  if (input.fix === 'absent') {
    return { gpsVerified: false, gpsUnverifiedReason: 'no_fix', keepFix: false };
  }
  if (input.fix === 'malformed') {
    return { gpsVerified: false, gpsUnverifiedReason: 'other', keepFix: false };
  }

  const fix = input.fix;
  const rawDistance = input.reference ? metersBetween(fix, input.reference) : null;
  const gpsDistanceM = storeableDistance(rawDistance);
  const base = gpsDistanceM == null ? {} : { gpsDistanceM };

  if (captureIsStale(fix, input.actionAtMs)) {
    return { gpsVerified: false, gpsUnverifiedReason: 'stale', keepFix: true, ...base };
  }
  if (!(Number.isFinite(fix.accuracyM) && fix.accuracyM >= 0)) {
    return { gpsVerified: false, gpsUnverifiedReason: 'other', keepFix: false };
  }
  if (fix.accuracyM > GPS_MAX_VERIFIED_ACCURACY_M) {
    return { gpsVerified: false, gpsUnverifiedReason: 'low_accuracy', keepFix: true, ...base };
  }
  const passes = gpsDistanceM != null && gpsRulePasses(gpsDistanceM, fix.accuracyM);
  if (passes) return { gpsVerified: true, keepFix: true, ...base };
  const reason: GpsUnverifiedReason = fix.accuracyM > GPS_ACCURACY_CREDIT_CAP_M ? 'reduced_accuracy' : 'too_far';
  return { gpsVerified: false, gpsUnverifiedReason: reason, keepFix: true, ...base };
}

export function gpsFlagOf(decision: GpsDecision): GpsFlag {
  const flag: GpsFlag = { gpsVerified: decision.gpsVerified };
  if (decision.gpsUnverifiedReason) flag.gpsUnverifiedReason = decision.gpsUnverifiedReason;
  if (decision.gpsDistanceM != null) flag.gpsDistanceM = decision.gpsDistanceM;
  return flag;
}

/**
 * Fields LeadDetail merges into a door-knock update. Never includes a
 * user-visible message. A far or inaccurate fix is saved and flagged.
 */
export function leadDetailKnockGps(
  position: { lat: number; lng: number; accuracyM: number } | null,
  lead: { lat?: number; lng?: number },
): { fields: Record<string, number | boolean | string>; gpsFlag: GpsFlag; keepFix: boolean } {
  let fix: KnockFix | 'absent' | 'malformed' = 'absent';
  if (position) {
    const point = finitePoint(position.lat, position.lng);
    if (!point || typeof position.accuracyM !== 'number' || !Number.isFinite(position.accuracyM)) {
      fix = 'malformed';
    } else {
      fix = { ...point, accuracyM: position.accuracyM };
    }
  }
  const decision = decideKnockGps({
    fix,
    reference: finitePoint(lead.lat, lead.lng),
  });
  const fields: Record<string, number | boolean | string> = { gpsVerified: decision.gpsVerified };
  if (decision.gpsUnverifiedReason) fields.gpsUnverifiedReason = decision.gpsUnverifiedReason;
  if (decision.gpsDistanceM != null) fields.gpsDistanceM = decision.gpsDistanceM;
  if (decision.keepFix && position) {
    fields.knockGpsLat = position.lat;
    fields.knockGpsLng = position.lng;
    fields.knockGpsAccuracy = position.accuracyM;
    if (decision.gpsDistanceM != null) fields.knockDistanceFromAddress = decision.gpsDistanceM;
  }
  return { fields, gpsFlag: gpsFlagOf(decision), keepFix: decision.keepFix };
}
