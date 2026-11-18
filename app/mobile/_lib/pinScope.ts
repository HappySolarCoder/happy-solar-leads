import { knocksAnywhere } from '@/app/field/closerScope';
import type { TerritoryPoint } from '@/app/types/territory';
import { insideTerritory, territoryBounds } from '@/app/utils/territoryManager';
import type { View } from '@/app/homeowners/model';
export type PinScope = TerritoryPoint[][] | undefined; // undefined = admin/manager/closer; [] = no area.
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

type ScopeUser = { id?: string | null; role?: unknown } | null | undefined;
type ScopeTerritory = { userId?: string; polygon?: TerritoryPoint[] };

function ownPolygons(user: ScopeUser, territories: readonly ScopeTerritory[]): TerritoryPoint[][] {
  const uid = user?.id;
  return territories.filter((territory) => territory.userId === uid && Array.isArray(territory.polygon)).map((territory) => territory.polygon as TerritoryPoint[]);
}

/** Knock-map fetch scope. Closers browse every pin. Setters stay on their own polygons. */
export function pinScopeFor(user: ScopeUser, territories: readonly ScopeTerritory[]): PinScope {
  const role = user?.role;
  if (role === 'admin' || role === 'manager' || knocksAnywhere(role)) return undefined;
  return ownPolygons(user, territories);
}

/** Homeowner rows stay inside a closer's own polygons. Admin and manager stay unscoped. */
export function homeScopeFor(user: ScopeUser, territories: readonly ScopeTerritory[]): PinScope {
  const role = user?.role;
  if (role === 'admin' || role === 'manager') return undefined;
  return ownPolygons(user, territories);
}

/** A closer keeps every pin. Every other role keeps pins inside the polygons (`undefined` keeps them all). */
export function knockMapPins<T extends KnockMapLead>(
  leads: readonly T[],
  pinPolygons: PinScope,
  user: ScopeUser,
): T[] {
  if (knocksAnywhere(user?.role)) return [...leads];
  return leads.filter((lead) => inPinScope(lead.lat, lead.lng, pinPolygons));
}

export function scopedViews(view: View, polygons: PinScope): View[] {
  if (!polygons) return [view];
  return polygons.map(p => { const b = territoryBounds(p); return { ...view,
    south: Math.max(view.south, b.south), north: Math.min(view.north, b.north),
    west: Math.max(view.west, b.west), east: Math.min(view.east, b.east), polygons: undefined }; })
    .filter(v => v.south < v.north && v.west < v.east);
}
