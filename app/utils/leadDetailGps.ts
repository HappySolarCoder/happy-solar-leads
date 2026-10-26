import {
  GPS_UNVERIFIED_REASONS,
  RADIUS_M,
  decideKnockGps,
  finitePoint,
  type GpsUnverifiedReason,
  type KnockFix,
} from './gpsRule';

/**
 * Direct knock patch for LeadDetail. The radius is RADIUS_M and the reason
 * list is GPS_UNVERIFIED_REASONS, including out_of_area. decideKnockGps marks
 * a malformed fix no_fix. Clients send other only for a usable fix whose lead
 * has no coordinates. null means delete that gps* flag on a re-knock.
 */
export function leadDetailKnockGps(input: {
  latitude: number;
  longitude: number;
  accuracy: number;
  /** GPS fix time, position.timestamp. Not Date.now(). */
  capturedAtMs: number;
  actionAtMs: number;
  leadLat?: number;
  leadLng?: number;
  /** The shared radius. LeadDetail passes RADIUS_M and does not keep another. */
  radiusM: typeof RADIUS_M;
}): {
  knockGpsLat?: number;
  knockGpsLng?: number;
  knockGpsAccuracy?: number;
  knockGpsTimestamp?: Date;
  knockDistanceFromAddress?: number;
  gpsVerified: boolean;
  gpsUnverifiedReason: GpsUnverifiedReason | null;
  gpsDistanceM: number | null;
} {
  if (input.radiusM !== RADIUS_M) {
    throw new Error('LeadDetail must use RADIUS_M from gpsRule');
  }
  const point = finitePoint(input.latitude, input.longitude);
  const accuracyOk = Number.isFinite(input.accuracy) && input.accuracy >= 0;
  const fix: KnockFix | 'malformed' = point && accuracyOk
    ? { lat: point.lat, lng: point.lng, accuracyM: input.accuracy, capturedAtMs: input.capturedAtMs }
    : 'malformed';
  const decision = decideKnockGps({
    fix,
    actionAtMs: input.actionAtMs,
    reference: finitePoint(input.leadLat, input.leadLng),
  });
  const reason = decision.gpsUnverifiedReason;
  const clientReason: GpsUnverifiedReason | null = reason != null && GPS_UNVERIFIED_REASONS.includes(reason)
    ? reason
    : reason == null
      ? null
      : 'no_fix';
  const write = {
    gpsVerified: decision.gpsVerified,
    gpsUnverifiedReason: clientReason,
    gpsDistanceM: decision.gpsDistanceM ?? null,
  };
  if (!decision.keepFix || fix === 'malformed') return write;
  return {
    ...write,
    knockGpsLat: fix.lat,
    knockGpsLng: fix.lng,
    knockGpsAccuracy: fix.accuracyM,
    knockGpsTimestamp: new Date(input.capturedAtMs),
    ...(decision.gpsDistanceM != null ? { knockDistanceFromAddress: decision.gpsDistanceM } : {}),
  };
}
