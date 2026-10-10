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
