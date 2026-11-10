/** Camera plan for an explicit My/Team territories choice. Corners only, never every vertex. */

export type AreaFocusMode = "mine" | "team";

export type AreaFocusPoint = { lat: number; lng: number };

export type AreaFocusTerritory = {
  userId?: string;
  polygon?: readonly AreaFocusPoint[] | null;
};

export type AreaFocusView = {
  south: number;
  north: number;
  west: number;
  east: number;
};

export type AreaFocusPlan = {
  fit: [number, number][] | null;
  notice: string;
};

const CLUSTER_KM = 50;
const EARTH_KM = 6371;

function finitePoint(point: AreaFocusPoint | null | undefined): point is AreaFocusPoint {
  return !!point && Number.isFinite(point.lat) && Number.isFinite(point.lng);
}

/** Same minimum as the overlay hook: fewer than 3 finite points, including NaN, is not a polygon. */
function usablePolygon(polygon: readonly AreaFocusPoint[] | null | undefined): AreaFocusPoint[] | null {
  if (!Array.isArray(polygon) || polygon.length < 3) return null;
  const points = polygon.filter(finitePoint);
  return points.length >= 3 ? points : null;
}

function bbox(points: readonly AreaFocusPoint[]) {
  let south = Infinity;
  let north = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const point of points) {
    if (point.lat < south) south = point.lat;
    if (point.lat > north) north = point.lat;
    if (point.lng < minLng) minLng = point.lng;
    if (point.lng > maxLng) maxLng = point.lng;
  }
  const crosses = maxLng - minLng > 180;
  let latSum = 0;
  let lngSum = 0;
  for (const point of points) {
    latSum += point.lat;
    lngSum += crosses && point.lng < 0 ? point.lng + 360 : point.lng;
  }
  let lng = lngSum / points.length;
  if (lng > 180) lng -= 360;
  return {
    south,
    north,
    west: crosses ? maxLng : minLng,
    east: crosses ? minLng : maxLng,
    center: { lat: latSum / points.length, lng },
  };
}

function lngRanges(west: number, east: number): { west: number; east: number }[] {
  if (![west, east].every(Number.isFinite)) return [];
  if (west <= east) return [{ west, east }];
  return [{ west, east: 180 }, { west: -180, east }];
}

function rangesOverlap(
  a: { west: number; east: number },
  b: { west: number; east: number },
): boolean {
  return a.west <= b.east && b.west <= a.east;
}

function boxesIntersect(
  box: { south: number; north: number; west: number; east: number },
  view: AreaFocusView,
): boolean {
  if (![box.south, box.north, view.south, view.north].every(Number.isFinite)) return false;
  if (box.north < view.south || box.south > view.north) return false;
  const boxLng = lngRanges(box.west, box.east);
  const viewLng = lngRanges(view.west, view.east);
  return boxLng.some((left) => viewLng.some((right) => rangesOverlap(left, right)));
}

function haversineKm(a: AreaFocusPoint, b: AreaFocusPoint): number {
  if (![a.lat, a.lng, b.lat, b.lng].every(Number.isFinite)) return Number.POSITIVE_INFINITY;
  const toRad = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

function viewCenter(view: AreaFocusView): AreaFocusPoint {
  const lat = (view.south + view.north) / 2;
  if (view.west <= view.east) return { lat, lng: (view.west + view.east) / 2 };
  const span = 180 - view.west + (view.east + 180);
  let lng = view.west + span / 2;
  if (lng > 180) lng -= 360;
  return { lat, lng };
}

function corners(box: { south: number; north: number; west: number; east: number }): [number, number][] {
  return [
    [box.south, box.west],
    [box.south, box.east],
    [box.north, box.west],
    [box.north, box.east],
  ];
}

function movedNotice(count: number, mode: AreaFocusMode): string {
  const whose = mode === "mine" ? "your" : "team";
  const noun = count === 1 ? "territory" : "territories";
  return `Moved the map to ${count} ${whose} ${noun}. Tap GPS to return to your location.`;
}

export function planAreaFocus(input: {
  mode: AreaFocusMode;
  userId?: string;
  territories: readonly AreaFocusTerritory[];
  view: AreaFocusView;
}): AreaFocusPlan {
  const displayed = [];
  for (const territory of input.territories) {
    if (input.mode === "mine" && territory.userId !== input.userId) continue;
    const polygon = usablePolygon(territory.polygon);
    if (!polygon) continue;
    displayed.push(bbox(polygon));
  }
  if (!displayed.length) {
    return {
      fit: null,
      notice: input.mode === "mine"
        ? "You do not have an assigned territory yet."
        : "No team territories were returned for your account.",
    };
  }
  if (displayed.some((box) => boxesIntersect(box, input.view))) {
    return { fit: null, notice: "" };
  }
  const center = viewCenter(input.view);
  let nearest = displayed[0];
  let nearestKm = haversineKm(center, displayed[0].center);
  for (const box of displayed.slice(1)) {
    const km = haversineKm(center, box.center);
    if (km < nearestKm) {
      nearest = box;
      nearestKm = km;
    }
  }
  const focus = displayed.filter((box) => haversineKm(box.center, nearest.center) <= CLUSTER_KM);
  return { fit: focus.flatMap(corners), notice: movedNotice(focus.length, input.mode) };
}
