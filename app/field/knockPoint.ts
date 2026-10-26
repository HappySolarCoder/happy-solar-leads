export type GpsPointSource = "homeowner_corrected" | "lead_stored";

export type KnockPoint = {
  lat: number;
  lng: number;
  source: GpsPointSource;
  /** Present only when the gate measured the corrected homeowner point. */
  homeownerId?: string;
};

type PointLike = { id?: string; lat?: number | null; lng?: number | null };

function finitePoint(point?: PointLike | null): { lat: number; lng: number } | null {
  if (!point || typeof point.lat !== "number" || typeof point.lng !== "number") return null;
  if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return null;
  if (Math.abs(point.lat) > 90 || Math.abs(point.lng) > 180) return null;
  return { lat: point.lat, lng: point.lng };
}

/**
 * The point the map draws for a pin. A corrected homeowner rooftop is used when
 * it differs from the stored lead. This never writes the lead's saved coordinates.
 * LeadMap and the knock gate both call this so they cannot drift apart.
 */
export function displayedKnockPoint(lead: PointLike, homeowner?: PointLike | null): KnockPoint | null {
  const stored = finitePoint(lead);
  const home = finitePoint(homeowner);
  if (home && (!stored || home.lat !== stored.lat || home.lng !== stored.lng)) {
    const homeownerId = typeof homeowner?.id === "string" && homeowner.id.trim() ? homeowner.id.trim() : undefined;
    return {
      lat: home.lat,
      lng: home.lng,
      source: "homeowner_corrected",
      ...(homeownerId ? { homeownerId } : {}),
    };
  }
  if (!stored) return null;
  return { lat: stored.lat, lng: stored.lng, source: "lead_stored" };
}
