import type { Lead, User } from '@/app/types';
import { getLocation } from '@/app/utils/geolocation';
import { isProximityRequired, PROXIMITY_MAX_DISTANCE_METERS } from '@/app/utils/proximityEnforcement';
import { distanceBetween } from 'geofire-common';

/** Preserve the same distance gate for special outcomes on a newly selected home. */
export async function homeownerKnockGps(lead: Lead, user: User): Promise<Partial<Lead>> {
  let position;
  try { position = await getLocation({ enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }); }
  catch {
    if (isProximityRequired(user)) throw Error('Your location could not be verified. Enable precise location and retry.');
    return {};
  }
  const distance = typeof lead.lat === 'number' && typeof lead.lng === 'number'
    ? distanceBetween([position.coords.latitude, position.coords.longitude], [lead.lat, lead.lng]) * 1000 : undefined;
  if (isProximityRequired(user) && distance === undefined) throw Error('This lead needs valid address coordinates before recording a knock.');
  if (isProximityRequired(user) && distance !== undefined && distance > PROXIMITY_MAX_DISTANCE_METERS)
    throw Error(`Move within ${Math.round(PROXIMITY_MAX_DISTANCE_METERS * 3.281)} feet of this home to record a knock.`);
  return { knockGpsLat: position.coords.latitude, knockGpsLng: position.coords.longitude,
    knockGpsAccuracy: position.coords.accuracy, knockGpsTimestamp: new Date(position.timestamp),
    ...(distance !== undefined ? { knockDistanceFromAddress: distance } : {}) };
}
