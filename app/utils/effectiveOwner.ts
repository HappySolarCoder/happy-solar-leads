import { insideTerritory, territoryBounds } from './territoryManager';

/**
 * Evan's ownership rule (Nov 10 2026):
 *  1. Every rep assigned to a live territory that contains the pin owns it.
 *     Overlapping territories and territories with several assignees give a
 *     pin DUAL owners: any of them may knock, dispo and claim it, and each sees
 *     it as theirs. A knock is credited to whoever knocked.
 *  2. Exception: a Go Back stays with the rep who set it for 90 days from that
 *     dispo, then reverts to the territory owners and is shown as the
 *     system-only 'Exp. Go-Back' pin type (derived, never written).
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
  /** Primary assignee (the legacy single-owner field). */
  userId: string;
  /** Every assignee: userId first, then any extra userIds on the doc. */
  userIds: string[];
  userName?: string;
  userColor?: string;
  /** Epoch ms of the latest assignment. assignedAt, else createdAt, else 0. */
  assignedAtMs: number;
  polygon: Array<{ lat: number; lng: number }>;
  bounds: { south: number; north: number; west: number; east: number };
};

export type EffectiveOwner = {
  /** First owner, kept for single-owner callers. Null when nobody owns the pin. */
  ownerId: string | null;
  /** Every owner. Dual owners are equal: any of them may work the pin. */
  ownerIds: string[];
  source: OwnerSource;
  territoryId?: string;
  territoryIds?: string[];
  /** The pin has more than one owner because territories overlap or are shared. */
  dual?: boolean;
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
    const extra = Array.isArray(data.userIds) ? data.userIds.map(str).filter(Boolean) : [];
    out.push({
      id: row.id,
      userId,
      userIds: [...new Set([userId, ...extra])],
      userName: typeof data.userName === 'string' ? data.userName : undefined,
      userColor: typeof data.userColor === 'string' ? data.userColor : undefined,
      assignedAtMs: ownerInstant(data.assignedAt) ?? ownerInstant(data.createdAt) ?? 0,
      polygon,
      bounds: territoryBounds(polygon),
    });
  }
  return out;
}

/** Every live territory containing the point, newest assignment first (ties: larger id first). */
export function territoriesFor(
  lat: unknown,
  lng: unknown,
  territories: readonly PreparedTerritory[],
): PreparedTerritory[] {
  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) return [];
  const hits: PreparedTerritory[] = [];
  for (const territory of territories) {
    const b = territory.bounds;
    if (lat < b.south || lat > b.north || lng < b.west || lng > b.east) continue;
    if (insideTerritory(lat, lng, territory.polygon)) hits.push(territory);
  }
  hits.sort((x, y) => y.assignedAtMs - x.assignedAtMs || (x.id < y.id ? 1 : x.id > y.id ? -1 : 0));
  return hits;
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

/** Go Back older than 90 days from its dispo. Derived at read time; nothing is written. */
export function isExpiredGoBack(lead: Record<string, unknown>, nowMs: number): boolean {
  if (!isGoBackKey(lead.status)) return false;
  const at = ownerInstant(lead.dispositionedAt);
  return at != null && nowMs - at > GO_BACK_OWNER_MS;
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
      return { ownerId: setter, ownerIds: [setter], source: 'go-back' };
    }
  }
  const hits = territoriesFor(lead.lat, lead.lng, territories);
  if (hits.length > 0) {
    const ownerIds = [...new Set(hits.flatMap((territory) => territory.userIds))];
    return {
      ownerId: ownerIds[0],
      ownerIds,
      source: 'territory',
      territoryId: hits[0].id,
      territoryIds: hits.map((territory) => territory.id),
      ...(ownerIds.length > 1 ? { dual: true } : {}),
    };
  }
  const stamp = stampedOwner(lead);
  return stamp
    ? { ownerId: stamp, ownerIds: [stamp], source: 'stamp' }
    : { ownerId: null, ownerIds: [], source: 'none' };
}

/**
 * Warning popup rule. A rep placing or dispositioning a pin inside live
 * territories that none of them is assigned to gets the warning every time.
 * No territory at the point, or the rep is an assignee of any containing
 * territory (dual owner), means no warning.
 */
export const FOREIGN_TERRITORY_WARNING =
  "Warning: You are in another user's territory. Do you wish to place this pin?";

export function foreignTerritoryWarning(
  lat: unknown,
  lng: unknown,
  uid: string,
  territories: readonly PreparedTerritory[],
): { warn: boolean; ownerIds: string[] } {
  const hits = territoriesFor(lat, lng, territories);
  if (hits.length === 0) return { warn: false, ownerIds: [] };
  const ownerIds = [...new Set(hits.flatMap((territory) => territory.userIds))];
  return { warn: !ownerIds.includes(uid), ownerIds };
}

/**
 * Whether managers and admins skip the foreign-territory warning popup.
 * FINAL (Evan, Nov 10 2:21 PM): managers and admins skip the popup. Matches
 * today's territory-gate exemption for staff. Single switch, read server-side (mobile-leads
 * `popupExempt`) and by the web popup.
 */
export const STAFF_POPUP_EXEMPT = true;

export function popupExemptFor(role: unknown): boolean {
  return STAFF_POPUP_EXEMPT && (role === 'admin' || role === 'manager');
}

/** System-only pin type for a Go Back older than 90 days. Derived, never stored, never selectable. */
export const EXP_GO_BACK = { id: 'exp-go-back', label: 'Exp. Go-Back', color: '#a16207', icon: '\u21ba' } as const;

/** Pin color for an owned pin: the viewer's own color when they are an owner, else the first owner's. */
export function ownerDisplayColor(
  ownerIds: readonly string[],
  viewerId: string | undefined,
  colorOf: (uid: string) => string | undefined,
): string | undefined {
  if (viewerId && ownerIds.includes(viewerId)) {
    const mine = colorOf(viewerId);
    if (mine) return mine;
  }
  for (const id of ownerIds) {
    const color = colorOf(id);
    if (color) return color;
  }
  return undefined;
}
