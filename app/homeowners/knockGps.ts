import type { Lead, User } from '@/app/types';
import { droppedPinGps } from '@/app/field/pendingGps';
import { displayedKnockPoint } from '@/app/field/knockPoint';
import { getLocation } from '@/app/utils/geolocation';

/** Capture a fix for a homeowner knock. A miss still lets the disposition save. */
export async function homeownerKnockGps(lead: Lead, _user: User): Promise<Partial<Lead>> {
  let position;
  try { position = await getLocation({ enableHighAccuracy: true, timeout: 10000 }); }
  catch { return { gpsVerified: false, gpsUnverifiedReason: 'no_fix' }; }
  const point = displayedKnockPoint(lead, lead.homeowner);
  const fields = droppedPinGps(position, point?.lat, point?.lng);
  const knock: Partial<Lead> = {};
  if (fields.knockGpsLat != null) knock.knockGpsLat = fields.knockGpsLat;
  if (fields.knockGpsLng != null) knock.knockGpsLng = fields.knockGpsLng;
  if (fields.knockGpsAccuracy != null) knock.knockGpsAccuracy = fields.knockGpsAccuracy;
  if (fields.knockGpsTimestamp) knock.knockGpsTimestamp = fields.knockGpsTimestamp;
  if (fields.knockDistanceFromAddress != null) knock.knockDistanceFromAddress = fields.knockDistanceFromAddress;
  return knock;
}
