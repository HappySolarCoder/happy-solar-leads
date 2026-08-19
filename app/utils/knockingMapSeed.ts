import { Lead } from '@/app/types';

export type MapBounds = { south: number; north: number; west: number; east: number };

/** Tight first-fetch box (~1.4 mi). Not the old Rochester ±0.12/0.16 dump. */
export const GPS_BOX_PAD_DEG = 0.02;

export const ROCHESTER_LAT = 43.1566;
export const ROCHESTER_LNG = -77.6088;

export function boundsAround(lat: number, lng: number, pad: number = GPS_BOX_PAD_DEG): MapBounds {
  return {
    south: lat - pad,
    north: lat + pad,
    west: lng - pad,
    east: lng + pad,
  };
}

export function boundsCenter(bounds: MapBounds): [number, number] {
  return [(bounds.south + bounds.north) / 2, (bounds.west + bounds.east) / 2];
}

export function boundsNearlySame(a: MapBounds | null | undefined, b: MapBounds, eps: number = 0.002): boolean {
  if (!a) return false;
  return (
    Math.abs(a.south - b.south) < eps &&
    Math.abs(a.north - b.north) < eps &&
    Math.abs(a.west - b.west) < eps &&
    Math.abs(a.east - b.east) < eps
  );
}

export function isHardcodedRochesterCenter(lat: number, lng: number): boolean {
  return Math.abs(lat - ROCHESTER_LAT) < 0.01 && Math.abs(lng - ROCHESTER_LNG) < 0.01;
}

/**
 * Immediate pins: last mapLeads, else getLeads() cache, clipped to the GPS/last box.
 * Does not hit Firestore.
 */
export function seedPinsInBox(
  lastPins: Lead[],
  cachedLeads: Lead[],
  box: MapBounds | null,
  max: number = 400
): Lead[] {
  const inBox = (leads: Lead[]): Lead[] => {
    if (!box) return leads.slice(0, max);
    const out: Lead[] = [];
    for (const lead of leads) {
      if (lead.lat == null || lead.lng == null) continue;
      if (lead.lat < box.south || lead.lat > box.north) continue;
      if (box.west > box.east) {
        if (!(lead.lng >= box.west || lead.lng <= box.east)) continue;
      } else if (lead.lng < box.west || lead.lng > box.east) {
        continue;
      }
      out.push(lead);
      if (out.length >= max) break;
    }
    return out;
  };

  if (lastPins.length > 0) return inBox(lastPins);
  if (cachedLeads.length > 0 && box) return inBox(cachedLeads);
  return [];
}
