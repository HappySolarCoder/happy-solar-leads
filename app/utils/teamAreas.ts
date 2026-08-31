import type { Territory } from '@/app/types/territory';

export const TEAM_LOCATION_STALE_MS = 30 * 60 * 1000;
export const TEAM_AREAS_REFRESH_MS = 30 * 1000;
export const TEAM_LOCATION_MIN_MOVE_METERS = 40;

export interface TeamAreaMember {
  id: string;
  name: string;
  color: string;
  lat: number;
  lng: number;
  lastUpdate?: string;
}

export interface TeamAreasOverlay {
  territories: Territory[];
  members: TeamAreaMember[];
}

export function shouldRenderTerritoryOverlay(
  viewMode: 'map' | 'assignments' | 'territory',
  showTeamAreas: boolean
): boolean {
  return showTeamAreas || viewMode === 'assignments' || viewMode === 'territory';
}

export function parseLocationTimestamp(value: unknown): number | null {
  if (value == null) return null;
  try {
    if (typeof (value as { toDate?: () => Date }).toDate === 'function') {
      return (value as { toDate: () => Date }).toDate().getTime();
    }
    if (value instanceof Date) return value.getTime();
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const parsed = Date.parse(value);
      return Number.isNaN(parsed) ? null : parsed;
    }
    if (typeof value === 'object' && value && 'seconds' in value) {
      const seconds = Number((value as { seconds: number }).seconds);
      return Number.isFinite(seconds) ? seconds * 1000 : null;
    }
  } catch {
    return null;
  }
  return null;
}

export function isRecentTeamLocation(
  timestamp: unknown,
  now = Date.now(),
  maxAgeMs = TEAM_LOCATION_STALE_MS
): boolean {
  const ms = parseLocationTimestamp(timestamp);
  if (ms == null) return false;
  return now - ms <= maxAgeMs;
}

export function parseCurrentLocation(
  raw: unknown,
  now = Date.now(),
  maxAgeMs = TEAM_LOCATION_STALE_MS
): { lat: number; lng: number; lastUpdate?: string } | null {
  if (!raw || typeof raw !== 'object') return null;
  const loc = raw as { lat?: unknown; lng?: unknown; timestamp?: unknown };
  const lat = Number(loc.lat);
  const lng = Number(loc.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  if (loc.timestamp != null && !isRecentTeamLocation(loc.timestamp, now, maxAgeMs)) {
    return null;
  }
  const ms = parseLocationTimestamp(loc.timestamp);
  return {
    lat,
    lng,
    lastUpdate: ms != null ? new Date(ms).toISOString() : undefined,
  };
}

export function membersFromUserRecords(
  users: Array<{
    id: string;
    name?: string;
    color?: string;
    currentLocation?: unknown;
  }>,
  now = Date.now()
): TeamAreaMember[] {
  const members: TeamAreaMember[] = [];
  for (const user of users) {
    const loc = parseCurrentLocation(user.currentLocation, now);
    if (!loc) continue;
    members.push({
      id: user.id,
      name: user.name || 'Unknown',
      color: user.color || '#FF5F5A',
      lat: loc.lat,
      lng: loc.lng,
      lastUpdate: loc.lastUpdate,
    });
  }
  return members;
}

export function haversineMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function shouldPublishTeamLocation(
  previous: { lat: number; lng: number } | null,
  next: { lat: number; lng: number },
  minMoveMeters = TEAM_LOCATION_MIN_MOVE_METERS
): boolean {
  if (!previous) return true;
  return haversineMeters(previous, next) >= minMoveMeters;
}

export async function fetchTeamAreasViaApi(
  getToken: () => Promise<string | null>
): Promise<TeamAreasOverlay | null> {
  const token = await getToken();
  if (!token) return null;

  const res = await fetch('/api/team-areas', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;

  const data = await res.json();
  const territories = Array.isArray(data.territories) ? data.territories : [];
  const members = Array.isArray(data.members) ? data.members : [];
  return { territories, members };
}

export async function publishTeamLocation(
  lat: number,
  lng: number,
  getToken: () => Promise<string | null>
): Promise<boolean> {
  const token = await getToken();
  if (!token) return false;

  const res = await fetch('/api/team-areas', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ lat, lng }),
  });
  return res.ok;
}

export async function loadTeamAreasOverlay(
  getToken: () => Promise<string | null>,
  loadClientTerritories: () => Promise<Territory[]>
): Promise<TeamAreasOverlay> {
  try {
    const fromApi = await fetchTeamAreasViaApi(getToken);
    if (fromApi) return fromApi;
  } catch (error) {
    console.warn('[teamAreas] API overlay fetch failed, falling back to client territories', error);
  }

  try {
    const territories = await loadClientTerritories();
    return { territories, members: [] };
  } catch (error) {
    console.warn('[teamAreas] Client territory fallback failed', error);
    return { territories: [], members: [] };
  }
}
