/**
 * Knocking-map pin visibility helpers (no Firestore).
 *
 * LeadMap already keeps poor solar if the pin is claimed/assigned to the
 * acting user or already knocked. applyKnockingFilters used to drop every
 * solarCategory === 'poor' before LeadMap saw it.
 *
 * Viewport/turf caps must prefer newest createdAt (or Date.now() ids).
 * An unordered claimedBy limit(4000) returns oldest __name__ ids, so today's
 * drops never enter the cache after a restart.
 */

export type KnockingPin = {
  id?: string;
  lat?: number;
  lng?: number;
  solarCategory?: string;
  claimedBy?: string | null;
  assignedTo?: string | null;
  source?: string;
  status?: string;
  disposition?: string;
  dispositionedAt?: unknown;
  dispositionHistory?: unknown[] | null;
  createdAt?: unknown;
};

export type MapBox = { south: number; north: number; west: number; east: number };

export const KNOCK_STATUSES = [
  'not-home',
  'interested',
  'not-interested',
  'appointment',
  'sale',
  'dq-credit',
  'shade-dq',
  'follow-up-later',
  'renter',
] as const;

export function leadCreatedAtMs(lead: KnockingPin): number {
  const created = lead.createdAt as { toDate?: () => Date } | Date | string | number | null | undefined;
  if (created instanceof Date && !Number.isNaN(created.getTime())) return created.getTime();
  if (typeof created === 'number' && Number.isFinite(created)) return created;
  if (typeof created === 'string') {
    const parsed = Date.parse(created);
    if (!Number.isNaN(parsed)) return parsed;
  }
  if (created && typeof created.toDate === 'function') {
    const date = created.toDate();
    if (date instanceof Date && !Number.isNaN(date.getTime())) return date.getTime();
  }
  // generateId() is `${Date.now()}-…`
  const idMs = parseInt(String(lead.id || '').split('-')[0], 10);
  return Number.isFinite(idMs) ? idMs : 0;
}

export function sortLeadsNewestFirst<T extends KnockingPin>(leads: T[]): T[] {
  return leads.slice().sort((a, b) => leadCreatedAtMs(b) - leadCreatedAtMs(a));
}

export function pinInBounds(lead: KnockingPin, bounds: MapBox): boolean {
  if (lead.lat == null || lead.lng == null) return false;
  if (!Number.isFinite(Number(lead.lat)) || !Number.isFinite(Number(lead.lng))) return false;
  if (lead.lat < bounds.south || lead.lat > bounds.north) return false;
  if (bounds.west > bounds.east) {
    return lead.lng >= bounds.west || lead.lng <= bounds.east;
  }
  return lead.lng >= bounds.west && lead.lng <= bounds.east;
}

/** In-bounds pins, newest createdAt first, then the viewport cap. */
export function selectNewestInBounds<T extends KnockingPin>(
  leads: T[],
  bounds: MapBox,
  maxLeads: number
): T[] {
  return sortLeadsNewestFirst(leads.filter((lead) => pinInBounds(lead, bounds))).slice(0, maxLeads);
}

export function isDispositionedOrKnocked(lead: KnockingPin): boolean {
  const status = String(lead.status || '').trim();
  if (status && (KNOCK_STATUSES as readonly string[]).includes(status)) return true;
  if (lead.dispositionedAt) return true;
  if (Array.isArray(lead.dispositionHistory) && lead.dispositionHistory.length > 0) return true;
  const disposition = String(lead.disposition || '').trim();
  return Boolean(disposition);
}

export function isOwnedOrManualOrKnocked(lead: KnockingPin, userId?: string | null): boolean {
  if (userId && (lead.claimedBy === userId || lead.assignedTo === userId)) return true;
  if (lead.source === 'manually-added') return true;
  return isDispositionedOrKnocked(lead);
}

/**
 * Keep a knocking prospect unless it is unowned cold turf with poor solar.
 * Missing solarCategory is kept (drop-pin does not set it).
 */
export function shouldKeepKnockingProspect(lead: KnockingPin, userId?: string | null): boolean {
  if (lead.solarCategory !== 'poor') return true;
  return isOwnedOrManualOrKnocked(lead, userId);
}
