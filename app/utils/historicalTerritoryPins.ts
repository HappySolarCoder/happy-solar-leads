import type { Lead } from '../types';
import type { Territory } from '../types/territory';
import { findLeadTerritory } from './territoryAssignment';

/**
 * Field reps only receive leads they claimed or that are assigned to them
 * (`getLeadsForUser`). Other reps' Appointment Set / Sold doors inside the
 * viewer's polygon never reach the map. These helpers pick just those pins.
 */

const CANONICAL_STATUS_IDS = new Set(['appointment', 'sale', 'sold']);

const APPOINTMENT_LABELS = new Set([
  'appointment set',
  'appointment',
  'appt set',
  'appt',
]);

const SOLD_LABELS = new Set(['sold', 'sale']);

export function normalizeDispositionLabel(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[!?.]+/g, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isAppointmentSetOrSoldLabel(value: unknown): boolean {
  const label = normalizeDispositionLabel(value);
  if (!label) return false;
  return APPOINTMENT_LABELS.has(label) || SOLD_LABELS.has(label);
}

/**
 * Current outcome only. A later Not Home / Go Back / House for Sale does not
 * qualify, even if history once said Appointment Set.
 * `extraStatusIds` covers custom disposition docs whose display name is
 * Appointment Set or Sold but whose id is not the built-in one.
 */
export function isAppointmentSetOrSoldLead(
  lead: { status?: string | null; disposition?: string | null },
  extraStatusIds?: ReadonlySet<string>,
): boolean {
  const status = String(lead.status || '').trim();
  if (status) {
    if (CANONICAL_STATUS_IDS.has(status.toLowerCase())) return true;
    if (extraStatusIds?.has(status)) return true;
    if (isAppointmentSetOrSoldLabel(status)) return true;
    return false;
  }
  return isAppointmentSetOrSoldLabel(lead.disposition);
}

export function collectHistoricalStatusIds(
  dispositions: Array<{ id?: string | null; name?: string | null }>,
): string[] {
  const ids = new Set<string>([
    'appointment',
    'sale',
    'sold',
    'Appointment Set',
    'Appointment',
    'Sold',
    'Sale',
    'Sale!',
  ]);

  for (const disposition of dispositions) {
    const id = String(disposition.id || '').trim();
    if (!id) continue;
    const name = String(disposition.name || '').trim();
    if (
      isAppointmentSetOrSoldLabel(name) ||
      isAppointmentSetOrSoldLabel(id) ||
      CANONICAL_STATUS_IDS.has(id.toLowerCase())
    ) {
      ids.add(id);
    }
  }

  return Array.from(ids);
}

/** Same ownership rule the field map already uses for "my pins". */
export function isOwnLead(
  lead: { claimedBy?: string | null; assignedTo?: string | null },
  userId: string,
): boolean {
  if (!userId) return false;
  return lead.claimedBy === userId || lead.assignedTo === userId;
}

export function selectHistoricalTerritoryPins(
  leads: Lead[],
  userId: string,
  territories: Territory[],
  extraStatusIds?: ReadonlySet<string>,
): Lead[] {
  if (!userId) return [];
  const mine = territories.filter(
    (territory) => territory.userId === userId && territory.polygon && territory.polygon.length >= 3,
  );
  if (mine.length === 0) return [];

  const selected: Lead[] = [];
  for (const lead of leads) {
    if (isOwnLead(lead, userId)) continue;
    if (!isAppointmentSetOrSoldLead(lead, extraStatusIds)) continue;
    if (!findLeadTerritory(lead, mine)) continue;
    selected.push(lead);
  }
  return selected;
}

/** Map payload: address and outcome only. No phone, email, notes, or photos. */
export function toPublicHistoricalPin(lead: Lead): Lead {
  const historyName = lead.dispositionHistory?.[0]?.userName?.trim();
  const setBy = lead.historicalSetByName?.trim() || historyName || undefined;
  return {
    id: lead.id,
    name: lead.name || 'Past pin',
    address: lead.address || '',
    city: lead.city || '',
    state: lead.state || '',
    zip: lead.zip || '',
    lat: lead.lat,
    lng: lead.lng,
    status: lead.status,
    disposition: lead.disposition,
    dispositionedAt: lead.dispositionedAt,
    createdAt: lead.createdAt || lead.dispositionedAt || new Date(0),
    claimedBy: lead.claimedBy,
    assignedTo: lead.assignedTo,
    historicalTerritoryPin: true,
    historicalSetByName: setBy,
  };
}

/**
 * Append other reps' past pins without replacing a pin the viewer already has.
 * Existing objects stay untouched so own-pin colors do not change.
 */
export function mergeHistoricalTerritoryPins(
  existing: Lead[],
  historical: Lead[],
  userId?: string,
): Lead[] {
  if (!historical.length) return existing;
  const seen = new Set(existing.map((lead) => lead.id));
  const extra: Lead[] = [];
  for (const pin of historical) {
    if (!pin?.historicalTerritoryPin) continue;
    if (!pin.id || seen.has(pin.id)) continue;
    if (pin.lat == null || pin.lng == null) continue;
    if (userId && isOwnLead(pin, userId)) continue;
    seen.add(pin.id);
    extra.push(pin);
  }
  return extra.length ? [...existing, ...extra] : existing;
}
