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
export function scopedViews(view: View, polygons: PinScope): View[] {
  if (!polygons) return [view];
  return polygons.map(p => { const b = territoryBounds(p); return { ...view,
    south: Math.max(view.south, b.south), north: Math.min(view.north, b.north),
    west: Math.max(view.west, b.west), east: Math.min(view.east, b.east), polygons: undefined }; })
    .filter(v => v.south < v.north && v.west < v.east);
}
