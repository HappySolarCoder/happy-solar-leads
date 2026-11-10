import { insideTerritory, territoryBounds } from './territoryManager';

/**
 * Evan's ownership rule (Nov 10 2026):
 *  1. The rep most recently assigned the territory that contains the pin owns it.
 *  2. Exception: a Go Back stays with the rep who set it for 90 days from that
 *     dispo, then reverts to the territory rep.
 *  3. A pin in no (live) territory keeps its stamped owner (claimedBy, assignedTo,
 *     or the rep who added it by hand).
 *
 * Pure and read-time only. Nothing here writes. The server gate
 * (fieldDispo.ts) and the web map (LeadMap.tsx) both call it, so there is one
 * definition of "whose pin is this".
 */
export const GO_BACK_OWNER_MS = 90 * 24 * 60 * 60 * 1000;

export type OwnerSource = 'go-back' | 'territory' | 'stamp' | 'none';

export type PreparedTerritory = {
  id: string;
  userId: string;
  userName?: string;
  userColor?: string;
  /** Epoch ms of the latest assignment. assignedAt, else createdAt, else 0. */
  assignedAtMs: number;
  polygon: Array<{ lat: number; lng: number }>;
  bounds: { south: number; north: number; west: number; east: number };
};

export type EffectiveOwner = {
  ownerId: string | null;
  source: OwnerSource;
  territoryId?: string;
  /** More than one live territory contains the pin and they name different reps. */
  overlap?: boolean;
};

export type EffectiveOwnerOptions = {
  /**
   * Whether the Go Back setter can still hold pins (not deleted, deactivated,
   * or pending deletion). Return false to revert at once. Default: active.
   */
  setterActive?: (uid: string) => boolean;
};

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Timestamp, Date, ISO string, number, or {seconds,nanoseconds}. Invalid is null. */
export function ownerInstant(value: unknown): number | null {
  if (value == null || value === '') return null;
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value !== 'object') return null;
  const stamp = value as {
    toMillis?: () => number;
    seconds?: unknown;
    nanoseconds?: unknown;
    _seconds?: unknown;
    _nanoseconds?: unknown;
  };
  if (typeof stamp.toMillis === 'function') {
    try {
      const ms = stamp.toMillis();
      return typeof ms === 'number' && Number.isFinite(ms) ? ms : null;
    } catch {
      return null;
    }
  }
  const seconds = typeof stamp.seconds === 'number' ? stamp.seconds : typeof stamp._seconds === 'number' ? stamp._seconds : null;
  if (seconds == null || !Number.isFinite(seconds)) return null;
  const nanos = typeof stamp.nanoseconds === 'number' ? stamp.nanoseconds : typeof stamp._nanoseconds === 'number' ? stamp._nanoseconds : 0;
  return seconds * 1000 + Math.floor(nanos / 1e6);
}

function polygonFrom(value: unknown): Array<{ lat: number; lng: number }> | null {
  if (!Array.isArray(value) || value.length < 3) return null;
  const points: Array<{ lat: number; lng: number }> = [];
  for (const point of value) {
    if (!point || typeof point !== 'object') return null;
    const { lat, lng } = point as { lat?: unknown; lng?: unknown };
    if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    points.push({ lat, lng });
  }
  return points;
}

/**
 * Keeps live territories only: not archived, an assignee, a polygon of 3+
 * valid points. Archived territories are "no territory" (edge case 5).
 */
export function prepareTerritories(
  rows: ReadonlyArray<{ id: string; data: Record<string, unknown> }>,
): PreparedTerritory[] {
  const out: PreparedTerritory[] = [];
  for (const row of rows) {
    const data = row.data;
    if (!data || data.archived) continue;
    const userId = str(data.userId);
    if (!userId) continue;
    const polygon = polygonFrom(data.polygon);
    if (!polygon) continue;
    out.push({
      id: row.id,
      userId,
      userName: typeof data.userName === 'string' ? data.userName : undefined,
      userColor: typeof data.userColor === 'string' ? data.userColor : undefined,
      assignedAtMs: ownerInstant(data.assignedAt) ?? ownerInstant(data.createdAt) ?? 0,
      polygon,
      bounds: territoryBounds(polygon),
    });
  }
  return out;
}

/** Most recently assigned live territory containing the point. Ties go to the larger id. */
export function territoryFor(
  lat: unknown,
  lng: unknown,
  territories: readonly PreparedTerritory[],
): { territory: PreparedTerritory; overlap: boolean } | null {
  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  let best: PreparedTerritory | null = null;
  let overlap = false;
  for (const territory of territories) {
    const b = territory.bounds;
    if (lat < b.south || lat > b.north || lng < b.west || lng > b.east) continue;
    if (!insideTerritory(lat, lng, territory.polygon)) continue;
    if (!best) {
      best = territory;
      continue;
    }
    if (best.userId !== territory.userId) overlap = true;
    if (
      territory.assignedAtMs > best.assignedAtMs ||
      (territory.assignedAtMs === best.assignedAtMs && territory.id > best.id)
    ) {
      best = territory;
    }
  }
  return best ? { territory: best, overlap } : null;
}

function isGoBackKey(value: unknown): boolean {
  return typeof value === 'string' && value.trim().toLowerCase().replace(/\s+/g, '-') === 'go-back';
}

/** The rep who set the current Go Back, or null when the pin is not a Go Back. */
export function goBackSetter(lead: Record<string, unknown>): string | null {
  if (!isGoBackKey(lead.status)) return null;
  const scheduled = str(lead.goBackScheduledBy);
  if (scheduled) return scheduled;
  const history = Array.isArray(lead.dispositionHistory) ? lead.dispositionHistory : [];
  // History is newest first (fieldDispo.mergeHistory). Take the newest go-back entry.
  for (const entry of history) {
    if (!entry || typeof entry !== 'object') continue;
    const row = entry as { disposition?: unknown; userId?: unknown };
    if (isGoBackKey(row.disposition) && str(row.userId)) return str(row.userId);
  }
  return str(lead.claimedBy) || null;
}

/** Owner by stamp only: claimedBy, else assignedTo, else the rep who added the pin by hand. */
export function stampedOwner(lead: Record<string, unknown>): string | null {
  const claimed = str(lead.claimedBy);
  if (claimed) return claimed;
  const assigned = str(lead.assignedTo);
  if (assigned) return assigned;
  if (lead.source === 'manually-added' && str(lead.setterId)) return str(lead.setterId);
  return null;
}

export function effectiveOwner(
  lead: Record<string, unknown>,
  territories: readonly PreparedTerritory[],
  nowMs: number,
  options: EffectiveOwnerOptions = {},
): EffectiveOwner {
  const setter = goBackSetter(lead);
  if (setter) {
    const at = ownerInstant(lead.dispositionedAt);
    const active = options.setterActive ? options.setterActive(setter) : true;
    // age < 0 (clock skew) still counts as inside the window.
    if (at != null && active && nowMs - at <= GO_BACK_OWNER_MS) {
      return { ownerId: setter, source: 'go-back' };
    }
  }
  const hit = territoryFor(lead.lat, lead.lng, territories);
  if (hit) {
    return {
      ownerId: hit.territory.userId,
      source: 'territory',
      territoryId: hit.territory.id,
      ...(hit.overlap ? { overlap: true } : {}),
    };
  }
  const stamp = stampedOwner(lead);
  return stamp ? { ownerId: stamp, source: 'stamp' } : { ownerId: null, source: 'none' };
}
