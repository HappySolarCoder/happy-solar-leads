import type { HistoricalTerritoryPin, Lead } from '../types';
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

type HistoryEntry = {
  disposition?: string | null;
  timestamp?: Date | string | number | null;
  userName?: string | null;
};

export type PastPinDetails = {
  appointmentSetAt?: Date;
  setterName?: string;
  dispositionLabel?: string;
};

function blankToUndefined(value: unknown): string | undefined {
  const text = String(value ?? '').trim();
  return text || undefined;
}

/** Epoch is the route's stand-in for a missing Firestore timestamp. */
function asValidDate(value: unknown): Date | undefined {
  if (value == null || value === '') return undefined;
  const date = value instanceof Date ? value : new Date(value as string | number);
  if (Number.isNaN(date.getTime()) || date.getTime() === 0) return undefined;
  return date;
}

function isAppointmentSetLabel(value: unknown): boolean {
  const label = normalizeDispositionLabel(value);
  return Boolean(label) && APPOINTMENT_LABELS.has(label);
}

/**
 * Date comes from the appointment-set history entry (earliest, when it was
 * first set). If that entry has no usable timestamp, fall back to
 * dispositionedAt. The setter is that entry's display name only.
 */
export function resolvePastPinDetails(lead: {
  disposition?: string | null;
  dispositionedAt?: Date | string | number | null;
  appointmentSetAt?: Date | string | number | null;
  historicalSetByName?: string | null;
  dispositionHistory?: HistoryEntry[] | null;
}): PastPinDetails {
  const history = lead.dispositionHistory ?? [];
  let chosen: { timestamp?: Date; userName?: string } | undefined;

  for (const entry of history) {
    if (!isAppointmentSetLabel(entry.disposition)) continue;
    const timestamp = asValidDate(entry.timestamp);
    const userName = blankToUndefined(entry.userName);
    if (!chosen) {
      chosen = { timestamp, userName };
      continue;
    }
    if (timestamp && (!chosen.timestamp || timestamp.getTime() < chosen.timestamp.getTime())) {
      chosen = { timestamp, userName };
    } else if (!chosen.userName && userName && !timestamp) {
      chosen = { ...chosen, userName };
    }
  }

  const appointmentSetAt = chosen?.timestamp
    ?? asValidDate(lead.appointmentSetAt)
    ?? asValidDate(lead.dispositionedAt);

  const setterName = chosen?.userName
    ?? (history.length > 0 ? undefined : blankToUndefined(lead.historicalSetByName));

  return {
    appointmentSetAt,
    setterName,
    dispositionLabel: blankToUndefined(lead.disposition),
  };
}

/** "Sep 3, 2026". Undefined when the value is missing or not a real date. */
export function formatAppointmentSetDate(value: unknown): string | undefined {
  const date = asValidDate(value);
  if (!date) return undefined;
  const formatted = date.toLocaleDateString('en-US', {
    timeZone: 'America/New_York',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  if (!formatted || formatted.toLowerCase() === 'invalid date') return undefined;
  return formatted;
}

/** Lines for the past-pin popup. Missing fields are omitted. */
export function pastPinPopupLines(lead: {
  disposition?: string | null;
  dispositionedAt?: Date | string | number | null;
  appointmentSetAt?: Date | string | number | null;
  historicalSetByName?: string | null;
  dispositionHistory?: HistoryEntry[] | null;
}): string[] {
  const details = resolvePastPinDetails(lead);
  const lines: string[] = [];
  const dateLabel = formatAppointmentSetDate(details.appointmentSetAt);
  if (dateLabel) lines.push(`Appt set ${dateLabel}`);
  if (details.setterName) lines.push(`Set by ${details.setterName}`);
  if (details.dispositionLabel) lines.push(details.dispositionLabel);
  return lines;
}

/** Map payload: address, outcome, appointment date, and setter display name. */
export function toPublicHistoricalPin(lead: Lead): HistoricalTerritoryPin {
  const details = resolvePastPinDetails(lead);
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
    disposition: details.dispositionLabel,
    dispositionedAt: asValidDate(lead.dispositionedAt),
    appointmentSetAt: details.appointmentSetAt,
    createdAt: lead.createdAt || asValidDate(lead.dispositionedAt) || new Date(0),
    historicalTerritoryPin: true,
    historicalSetByName: details.setterName,
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
