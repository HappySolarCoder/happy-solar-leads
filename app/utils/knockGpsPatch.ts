/** Optional GPS fields on a door-knock disposition. The save always proceeds. */

export const GPS_DISTANCE_MAX_M = 100_000;
export const KNOCK_METERS_MAX = 1_000_000;

export const GPS_UNVERIFIED_REASONS = [
  'no_fix',
  'stale',
  'low_accuracy',
  'reduced_accuracy',
  'too_far',
  'other',
] as const;

export type GpsUnverifiedReason = (typeof GPS_UNVERIFIED_REASONS)[number];

export interface KnockFix {
  latitude: number;
  longitude: number;
  accuracy: number;
  timestamp: Date;
  distanceM?: number;
}

export interface KnockGpsPatch {
  knockGpsLat?: number;
  knockGpsLng?: number;
  knockGpsAccuracy?: number;
  knockGpsTimestamp?: Date;
  knockDistanceFromAddress?: number;
  gpsVerified?: boolean;
  gpsUnverifiedReason?: GpsUnverifiedReason;
  gpsDistanceM?: number;
}

function finiteIn(value: number | undefined, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

/**
 * Fields merged into the direct disposition update after a GPS fix.
 * Out-of-range numbers are omitted so the rules do not reject the disposition.
 * `proximityMaxM` only chooses verified vs `too_far`; it never drops the patch.
 */
export function knockGpsPatchFromFix(fix: KnockFix, proximityMaxM: number): KnockGpsPatch {
  const patch: KnockGpsPatch = {};
  if (finiteIn(fix.latitude, -90, 90)) patch.knockGpsLat = fix.latitude;
  if (finiteIn(fix.longitude, -180, 180)) patch.knockGpsLng = fix.longitude;
  if (finiteIn(fix.accuracy, 0, KNOCK_METERS_MAX)) patch.knockGpsAccuracy = fix.accuracy;
  if (fix.timestamp instanceof Date) patch.knockGpsTimestamp = fix.timestamp;
  if (finiteIn(fix.distanceM, 0, KNOCK_METERS_MAX)) patch.knockDistanceFromAddress = fix.distanceM;
  if (finiteIn(fix.distanceM, 0, GPS_DISTANCE_MAX_M)) patch.gpsDistanceM = fix.distanceM;

  if (finiteIn(fix.distanceM, 0, proximityMaxM)) {
    patch.gpsVerified = true;
    return patch;
  }

  patch.gpsVerified = false;
  patch.gpsUnverifiedReason =
    typeof fix.distanceM === 'number' && Number.isFinite(fix.distanceM) && fix.distanceM > proximityMaxM
      ? 'too_far'
      : 'other';
  return patch;
}

/** No fix. The disposition update still includes only the two optional flags. */
export function knockGpsPatchUnverified(reason: GpsUnverifiedReason): KnockGpsPatch {
  return { gpsVerified: false, gpsUnverifiedReason: reason };
}
