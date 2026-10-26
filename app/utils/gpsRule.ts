import { distanceBetween } from 'geofire-common';
import { insideTerritory } from '@/app/utils/territoryManager';

/**
 * Shared GPS verification rule for the dispo route and direct disposition saves.
 * Import `gpsRulePasses` and the capture-window constants from here so the
 * client and the server use one rule.
 *
 * A fix is verified only when d - min(accuracyM, 15) <= RADIUS_M and
 * accuracyM <= 65. RADIUS_M is the single radius knob and defaults to 35.
 * GPS never blocks a disposition. A failed check is stored as a flag.
 *
 * Quality reasons are decided before area and distance. reduced_accuracy
 * (accuracy >= 1000) is chosen before low_accuracy (accuracy > 65). The
 * coarser band is inside the low-accuracy band, so the other order would
 * make reduced_accuracy unreachable.
 * After those, out_of_area wins over too_far. `other` is only a usable fix
 * whose lead has no coordinates. Malformed client GPS is `no_fix`.
 */
export const RADIUS_M = 35;
export const GPS_ACCURACY_CREDIT_CAP_M = 15;
export const GPS_MAX_VERIFIED_ACCURACY_M = 65;
export const GPS_REDUCED_ACCURACY_M = 1_000;
export const GPS_DISTANCE_MAX_M = 100_000;
/** Homeowner doc may replace the lead as the reference point inside this radius. */
export const GPS_HOMEOWNER_NEAR_LEAD_M = 75;
/** Same street and municipality may stretch the homeowner reference out to this radius. */
export const GPS_HOMEOWNER_SAME_STREET_M = 2_000;
/** Inclusive. capturedAt may be this far before actionAt and still count. */
export const GPS_CAPTURE_BEFORE_MS = 30_000;
/** Inclusive. capturedAt may be this far after actionAt and still count. */
export const GPS_CAPTURE_AFTER_MS = 15_000;
/** A fix inside this distance of a polygon edge is not out of the area. */
export const AREA_EDGE_FLOOR_M = 30;
/** These roles are never flagged out_of_area. Distance and accuracy still apply. */
export const GPS_AREA_EXEMPT_ROLES = ['admin', 'manager'] as const;

export const GPS_UNVERIFIED_REASONS = [
  'no_fix',
  'stale',
  'low_accuracy',
  'reduced_accuracy',
  'out_of_area',
  'too_far',
  'other',
] as const;

export type GpsUnverifiedReason = (typeof GPS_UNVERIFIED_REASONS)[number];

const REASON_SET: ReadonlySet<string> = new Set(GPS_UNVERIFIED_REASONS);
const EXEMPT_ROLES: ReadonlySet<string> = new Set(GPS_AREA_EXEMPT_ROLES);
const EARTH_RADIUS_M = 6_371_000;

export function isGpsUnverifiedReason(value: unknown): value is GpsUnverifiedReason {
  return typeof value === 'string' && REASON_SET.has(value);
}

export function isAreaExemptRole(role: string): boolean {
  return EXEMPT_ROLES.has(role);
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

/** Polygons the route already counted. `unknown` means the list was truncated. */
export type AreaPolygons = ReadonlyArray<ReadonlyArray<LatLng>> | 'unknown';

export function metersBetween(a: LatLng, b: LatLng): number {
  return distanceBetween([a.lat, a.lng], [b.lat, b.lng]) * 1000;
}

/** d - min(acc, 15) <= RADIUS_M && acc <= 65. Both bounds are inclusive. */
export function gpsRulePasses(distanceM: number, accuracyM: number): boolean {
  return distanceM - Math.min(accuracyM, GPS_ACCURACY_CREDIT_CAP_M) <= RADIUS_M
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

/**
 * Meters from a point to the outside of a polygon. Zero when the point is
 * inside or on the boundary (`insideTerritory`). There is no vertex cap:
 * live polygons run past two thousand corners. Fewer than three points
 * cannot contain a point.
 */
export function outsideBy(point: LatLng, polygon: ReadonlyArray<LatLng>): number {
  if (!finitePoint(point.lat, point.lng)) return Number.POSITIVE_INFINITY;
  if (polygon.length < 3) return Number.POSITIVE_INFINITY;
  const ring = polygon as Array<{ lat: number; lng: number }>;
  if (insideTerritory(point.lat, point.lng, ring)) return 0;
  const closed = polygon[0].lat === polygon[polygon.length - 1].lat
    && polygon[0].lng === polygon[polygon.length - 1].lng;
  const edges = closed ? polygon.length - 1 : polygon.length;
  if (edges < 3) return Number.POSITIVE_INFINITY;
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < edges; i += 1) {
    const distance = metersToSegment(point, polygon[i], polygon[(i + 1) % polygon.length]);
    if (distance < best) best = distance;
  }
  return best;
}

function metersToSegment(point: LatLng, start: LatLng, end: LatLng): number {
  const lat0 = point.lat * Math.PI / 180;
  const xOf = (lng: number) => (lng - point.lng) * Math.PI / 180 * Math.cos(lat0) * EARTH_RADIUS_M;
  const yOf = (lat: number) => (lat - point.lat) * Math.PI / 180 * EARTH_RADIUS_M;
  const ax = xOf(start.lng);
  const ay = yOf(start.lat);
  const dx = xOf(end.lng) - ax;
  const dy = yOf(end.lat) - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(ax, ay);
  const t = Math.max(0, Math.min(1, (-ax * dx + -ay * dy) / len2));
  return Math.hypot(ax + t * dx, ay + t * dy);
}

function captureIsStale(fix: KnockFix, actionAtMs: number | undefined): boolean {
  if (fix.capturedAtMs == null || actionAtMs == null) return false;
  const delta = fix.capturedAtMs - actionAtMs;
  return delta < -GPS_CAPTURE_BEFORE_MS || delta > GPS_CAPTURE_AFTER_MS;
}

function usableFix(fix: KnockFix): boolean {
  if (!finitePoint(fix.lat, fix.lng)) return false;
  if (typeof fix.accuracyM !== 'number' || !Number.isFinite(fix.accuracyM)) return false;
  return fix.accuracyM >= 0 && fix.accuracyM <= GPS_DISTANCE_MAX_M;
}

function outsideEveryPolygon(fix: KnockFix, polygons: ReadonlyArray<ReadonlyArray<LatLng>>): boolean {
  let nearest = Number.POSITIVE_INFINITY;
  for (const polygon of polygons) {
    const distance = outsideBy(fix, polygon);
    if (distance < nearest) nearest = distance;
    if (nearest === 0) return false;
  }
  return nearest > Math.max(fix.accuracyM, AREA_EDGE_FLOOR_M);
}

/**
 * Reason for an unverified fix. Missing and malformed fixes are no_fix and
 * do not touch geofire. A usable fix with no lead coordinates is other,
 * unless a quality or area reason already won.
 */
export function decideKnockGps(input: {
  fix: KnockFix | 'absent' | 'malformed';
  actionAtMs?: number;
  reference: LatLng | null;
  role?: string;
  polygons?: AreaPolygons;
}): GpsDecision {
  if (input.fix === 'absent' || input.fix === 'malformed' || !usableFix(input.fix)) {
    return { gpsVerified: false, gpsUnverifiedReason: 'no_fix', keepFix: false };
  }

  const fix = input.fix;
  const rawDistance = input.reference ? metersBetween(fix, input.reference) : null;
  const gpsDistanceM = storeableDistance(rawDistance);
  const base = gpsDistanceM == null ? {} : { gpsDistanceM };

  if (captureIsStale(fix, input.actionAtMs)) {
    return { gpsVerified: false, gpsUnverifiedReason: 'stale', keepFix: true, ...base };
  }
  if (fix.accuracyM >= GPS_REDUCED_ACCURACY_M) {
    return { gpsVerified: false, gpsUnverifiedReason: 'reduced_accuracy', keepFix: true, ...base };
  }
  if (fix.accuracyM > GPS_MAX_VERIFIED_ACCURACY_M) {
    return { gpsVerified: false, gpsUnverifiedReason: 'low_accuracy', keepFix: true, ...base };
  }
  const polygons = input.polygons;
  const checkArea = polygons != null
    && polygons !== 'unknown'
    && polygons.length > 0
    && !isAreaExemptRole(input.role ?? '');
  if (checkArea && outsideEveryPolygon(fix, polygons)) {
    return { gpsVerified: false, gpsUnverifiedReason: 'out_of_area', keepFix: true, ...base };
  }
  if (!input.reference) {
    return { gpsVerified: false, gpsUnverifiedReason: 'other', keepFix: true };
  }
  if (gpsDistanceM == null || !gpsRulePasses(gpsDistanceM, fix.accuracyM)) {
    return { gpsVerified: false, gpsUnverifiedReason: 'too_far', keepFix: true, ...base };
  }
  return { gpsVerified: true, keepFix: true, ...base };
}

export function gpsFlagOf(decision: GpsDecision): GpsFlag {
  const flag: GpsFlag = { gpsVerified: decision.gpsVerified };
  if (decision.gpsUnverifiedReason) flag.gpsUnverifiedReason = decision.gpsUnverifiedReason;
  if (decision.gpsDistanceM != null) flag.gpsDistanceM = decision.gpsDistanceM;
  return flag;
}
