import { knocksAnywhere } from '@/app/field/closerScope';
import { leadOwnedBy } from '@/app/field/serverDispo';
import type { TerritoryPoint } from '@/app/types/territory';
import { insideTerritory, territoryBounds } from '@/app/utils/territoryManager';
import type { View } from '@/app/homeowners/model';
export type PinScope = TerritoryPoint[][] | undefined; // undefined = admin/manager; [] = no area.
const compiled = new WeakMap<Exclude<PinScope,undefined>,ReturnType<typeof territoryBounds>[]>();
function scopeBounds(polygons:Exclude<PinScope,undefined>) { let bounds=compiled.get(polygons);if(!bounds){bounds=polygons.map(territoryBounds);compiled.set(polygons,bounds);}return bounds; }
export function inPinScope(lat: unknown, lng: unknown, polygons: PinScope) {
  if(!polygons)return true;
  if(typeof lat!=='number' || typeof lng!=='number')return false;
  const bounds=scopeBounds(polygons);
  return polygons.some((p,i) => lat>=bounds[i].south && lat<=bounds[i].north && lng>=bounds[i].west && lng<=bounds[i].east && insideTerritory(lat,lng,p));
}
type KnockMapLead = {
  lat?: unknown;
  lng?: unknown;
  claimedBy?: string;
  assignedTo?: string;
  setterId?: string;
  source?: string;
};

/** In-scope pins, plus a closer's own pins when those sit outside their polygons. */
export function knockMapPins<T extends KnockMapLead>(
  leads: readonly T[],
  pinPolygons: PinScope,
  user: { id?: string | null; role?: unknown } | null | undefined,
): T[] {
  const anywhere = knocksAnywhere(user?.role);
  const uid = typeof user?.id === 'string' ? user.id : '';
  return leads.filter((lead) => inPinScope(lead.lat, lead.lng, pinPolygons) || (anywhere && leadOwnedBy(lead, uid)));
}

export function scopedViews(view: View, polygons: PinScope): View[] {
  if (!polygons) return [view];
  return polygons.map(p => { const b = territoryBounds(p); return { ...view,
    south: Math.max(view.south, b.south), north: Math.min(view.north, b.north),
    west: Math.max(view.west, b.west), east: Math.min(view.east, b.east), polygons: undefined }; })
    .filter(v => v.south < v.north && v.west < v.east);
}
