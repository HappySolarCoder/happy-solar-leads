/**
 * Knock GPS policy for 14.18. Proximity never blocks, holds, or parks a dispo.
 * Verified when distance - min(accuracy, ACCURACY_CAP_M) <= GPS_RADIUS_M and accuracy <= ACCURACY_MAX_M.
 * The radius stays one constant so a later centroid adjustment does not fork the gate.
 */
export const GPS_RADIUS_M = 35;
export const ACCURACY_CAP_M = 15;
export const ACCURACY_MAX_M = 65;
export const REDUCED_ACCURACY_METERS = 1000;
export const GPS_WINDOW_BEFORE_MS = 30_000;
export const GPS_WINDOW_AFTER_MS = 15_000;
export const GPS_DISTANCE_MAX_M = 100_000;
/** Direct writes cannot store out_of_area until the Firestore rules accept it. */
export const AREA_REASON_DIRECT_WRITE_SUPPORTED = false;

/** Unverified knocks sync. This build does not hold them. */
export const GPS_UNVERIFIED_POLICY = "flag" as const;

/**
 * Sync-report may include gpsUnverifiedReason and locationPrecision.
 * A 400 that names either key strips both for the rest of this app session.
 */
export const SYNC_REPORT_EXTENDED_GPS_KEYS = true;

export const GPS_UNVERIFIED_REASONS = [
  "no_fix",
  "stale",
  "low_accuracy",
  "reduced_accuracy",
  "out_of_area",
  "too_far",
  "other",
] as const;

export type GpsUnverifiedReason = (typeof GPS_UNVERIFIED_REASONS)[number];
export type LocationPrecision = "precise" | "reduced" | "unknown";

export function isGpsUnverifiedReason(value: unknown): value is GpsUnverifiedReason {
  return typeof value === "string" && (GPS_UNVERIFIED_REASONS as readonly string[]).includes(value);
}

export function validGpsMeters(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= GPS_DISTANCE_MAX_M;
}

/** Shared with the map gate and field-work. Do not copy the thresholds. */
export function knockVerified(distanceM: number, accuracyM: number): boolean {
  if (!Number.isFinite(distanceM) || !Number.isFinite(accuracyM) || accuracyM < 0) return false;
  return distanceM - Math.min(accuracyM, ACCURACY_CAP_M) <= GPS_RADIUS_M
    && accuracyM <= ACCURACY_MAX_M;
}

export function precisionFromSignals(input: {
  platform: "ios" | "android" | "web" | "server";
  accuracy?: number;
  androidCoarseOnly?: boolean;
}): LocationPrecision {
  if (input.platform === "android" && input.androidCoarseOnly) return "reduced";
  if (input.platform === "ios" && typeof input.accuracy === "number" && input.accuracy >= REDUCED_ACCURACY_METERS) {
    return "reduced";
  }
  if (typeof input.accuracy !== "number" || !Number.isFinite(input.accuracy)) return "unknown";
  if (input.platform === "ios" || input.platform === "web" || input.platform === "server") return "precise";
  if (input.platform === "android" && input.androidCoarseOnly === false) return "precise";
  return "unknown";
}

export function classifyKnock(input: {
  hasFix: boolean;
  inWindow: boolean;
  hadStaleFix: boolean;
  accuracyM?: number;
  distanceM?: number;
  precision: LocationPrecision;
  /** Negative, NaN, or a non-finite coordinate. Always no_fix, and this never throws. */
  malformed?: boolean;
  /** Set only after a good fix is outside the rep's territory. Loses to no_fix, stale, accuracy, and reduced. */
  outsideArea?: boolean;
}): { gpsVerified: true } | { gpsVerified: false; reason: GpsUnverifiedReason } {
  try {
    const accuracy = input.accuracyM;
    const accuracyMalformed = typeof accuracy === "number"
      && (!Number.isFinite(accuracy) || accuracy < 0 || accuracy > GPS_DISTANCE_MAX_M);
    if (input.malformed || accuracyMalformed) return { gpsVerified: false, reason: "no_fix" };
    if (!input.hasFix) {
      return { gpsVerified: false, reason: input.hadStaleFix ? "stale" : "no_fix" };
    }
    if (!input.inWindow) return { gpsVerified: false, reason: "stale" };
    // reduced_accuracy is accuracy >= 1000, before low_accuracy. Platform does not decide it.
    if (typeof accuracy === "number" && accuracy >= REDUCED_ACCURACY_METERS) {
      return { gpsVerified: false, reason: "reduced_accuracy" };
    }
    if (typeof accuracy !== "number" || accuracy > ACCURACY_MAX_M) {
      return { gpsVerified: false, reason: "low_accuracy" };
    }
    if (input.outsideArea) return { gpsVerified: false, reason: "out_of_area" };
    if (typeof input.distanceM !== "number" || !Number.isFinite(input.distanceM)) {
      return { gpsVerified: false, reason: "other" };
    }
    if (!knockVerified(input.distanceM, accuracy)) return { gpsVerified: false, reason: "too_far" };
    return { gpsVerified: true };
  } catch {
    return { gpsVerified: false, reason: "no_fix" };
  }
}
