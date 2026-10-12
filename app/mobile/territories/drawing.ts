import type { TerritoryPoint } from "@/app/types/territory";
export type DrawingTool = "rectangle" | "corners" | "freehand";
export function rectangleCorners(
  a: TerritoryPoint,
  b: TerritoryPoint
): TerritoryPoint[] {
  const north = Math.max(a.lat, b.lat),
    south = Math.min(a.lat, b.lat);
  const west = Math.min(a.lng, b.lng),
    east = Math.max(a.lng, b.lng);
  return [
    { lat: north, lng: west },
    { lat: north, lng: east },
    { lat: south, lng: east },
    { lat: south, lng: west },
  ];
}

export type ScreenPoint = { x: number; y: number };
const distance = (a: ScreenPoint,b: ScreenPoint) => Math.hypot(a.x-b.x,a.y-b.y);
/** Close a finger trace without requiring a perfect last point. Only tiny loops
 * are removed; a real crossed neighborhood is left for explicit corner repair. */
export function cleanFingerTrace(input: ScreenPoint[]): ScreenPoint[] {
  let points=input.filter((p,i)=>!i || distance(p,input[i-1])>=2).map(p=>({...p}));
  if(points.length<3)return points;
  // A finish close to the starting point means the ring is complete. Discard
  // that noisy tail rather than adding a crossing closing edge.
  const first=points[0];
  const returned=points.findIndex((p,i)=>i>=3 && distance(p,first)<=18 && points.slice(0,i).some(q=>distance(q,first)>36));
  if(returned>=3)points=points.slice(0,returned);
  for(let i=0;i<points.length-2;i++)for(let j=i+2;j<points.length;j++){
    if(distance(points[i],points[j])<=8 && points.slice(i,j+1).every(p=>distance(p,points[i])<=24)) {
      points.splice(i+1,j-i);j=i+1;
    }
  }
  return points;
}
