import type { Territory, TerritoryPoint } from '../types/territory';

export interface TeamAreaMember {
  id: string;
  name: string;
  color: string;
  lat: number;
  lng: number;
}

export function shouldRenderTerritoryOverlay(
  viewMode: 'map' | 'assignments' | 'territory',
  showTeamAreas: boolean
): boolean {
  return showTeamAreas || viewMode === 'assignments' || viewMode === 'territory';
}

export function polygonCentroid(polygon: TerritoryPoint[] | undefined): { lat: number; lng: number } | null {
  if (!polygon || polygon.length < 3) return null;
  const sum = polygon.reduce<{ lat: number; lng: number; n: number }>(
    (acc, point) => {
      const lat = Number(point.lat);
      const lng = Number(point.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return acc;
      return { lat: acc.lat + lat, lng: acc.lng + lng, n: acc.n + 1 };
    },
    { lat: 0, lng: 0, n: 0 }
  );
  if (sum.n === 0) return null;
  return { lat: sum.lat / sum.n, lng: sum.lng / sum.n };
}

export function colorForTerritory(
  territory: Pick<Territory, 'userId' | 'userColor'>,
  users: Array<{ id: string; color?: string }>
): string {
  const owner = users.find((user) => user.id === territory.userId);
  return owner?.color || territory.userColor || '#FF5F5A';
}

export function colorTerritories(
  territories: Territory[],
  users: Array<{ id: string; color?: string }>
): Territory[] {
  return territories.map((territory) => ({
    ...territory,
    userColor: colorForTerritory(territory, users),
  }));
}

/**
 * Named pins from existing territory polygons (centroid) in each owner's user.color.
 * If a user already has currentLocation on their user doc, prefer that point.
 */
export function membersFromTerritories(
  territories: Territory[],
  users: Array<{ id: string; name?: string; color?: string; currentLocation?: unknown }>
): TeamAreaMember[] {
  const byUser = new Map<string, TeamAreaMember>();

  territories.forEach((territory) => {
    const center = polygonCentroid(territory.polygon);
    if (!center || !territory.userId || byUser.has(territory.userId)) return;
    byUser.set(territory.userId, {
      id: territory.userId,
      name: territory.userName,
      color: colorForTerritory(territory, users),
      lat: center.lat,
      lng: center.lng,
    });
  });

  users.forEach((user) => {
    const loc = user.currentLocation;
    if (!loc || typeof loc !== 'object') return;
    const lat = Number((loc as { lat?: unknown }).lat);
    const lng = Number((loc as { lng?: unknown }).lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    const existing = byUser.get(user.id);
    byUser.set(user.id, {
      id: user.id,
      name: user.name || existing?.name || 'Unknown',
      color: user.color || existing?.color || '#FF5F5A',
      lat,
      lng,
    });
  });

  return Array.from(byUser.values());
}
