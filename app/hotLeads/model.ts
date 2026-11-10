import { sameHouse } from "@/app/homeowners/houseIdentity";
import type { Lead } from "@/app/types";
import { DEFAULT_DISPOSITIONS } from "@/app/types/disposition";
import { collectHistoricalStatusIds, isAppointmentSetOrSoldLead } from "@/app/utils/historicalTerritoryPins";

export const HOT_LEAD_ID = /^ghl_[A-Za-z0-9_-]{1,120}$/;
export const HOT_PAGE_SIZE = 200;
export const DISPO_BLOCKS = ["outside_territory", "no_territory", "territory_unknown", "no_coords"] as const;
export type DispoBlock = (typeof DISPO_BLOCKS)[number];

export function isDispoBlock(value: unknown): value is DispoBlock {
  return typeof value === "string" && (DISPO_BLOCKS as readonly string[]).includes(value);
}
/** Runaway guard while following nextCursor. Not a product page limit. */
export const HOT_CURSOR_PAGE_CAP = 50;

export type HotContact = { name?: string; phone?: string; email?: string };

export type HotHistoryEntry = {
  disposition?: string;
  timestamp?: string;
  userId?: string;
  userName?: string;
  notes?: string;
  /** Present when the route already stored the knock's event id. Not a new field. */
  field?: { eventId?: string };
};

export type HotLeadPin = {
  id: string;
  lat: number;
  lng: number;
  address: string;
  city?: string;
  state: string;
  zip?: string;
  contacts: HotContact[];
  ghlStage?: string;
  ghlSource?: string;
  ghlCreatedOn?: string;
  hotStatus: "active" | "worked" | "converted" | "retired";
  claimedBy: string | null;
  claimedByName: string | null;
  claimedAt: string | null;
  status: string | null;
  disposition: string | null;
  dispositionedAt: string | null;
  notes?: string;
  linkedLeadId: string | null;
  homeownerId: string | null;
  gpsVerified?: boolean;
  gpsUnverifiedReason?: string;
  /** Route flag. Do Not Contact means no calling. Knocking still works. */
  doNotCall?: true;
  testData?: true;
  dispositionHistory?: HotHistoryEntry[];
  /**
   * Contract v2. Absent (old server or cache) renders as writable.
   * The server still decides the write. Staff bypass arrives as true.
   */
  canDispo?: boolean;
  dispoBlock?: DispoBlock | null;
};

/** Absent canDispo is writable. Only an explicit false is view-only. */
export function hotLeadCanDispo(pin: { canDispo?: boolean } | null | undefined): boolean {
  return pin?.canDispo !== false;
}

export function hotLeadViewOnly(lead: object | null | undefined): boolean {
  if (!lead) return false;
  const row = lead as { hotLead?: boolean; hotPin?: { canDispo?: boolean } | null };
  return row.hotLead === true && row.hotPin?.canDispo === false;
}

/** Kept for the ordinary-lead detail path. 3PL rows do not render it. */
export const DO_NOT_CALL_WARNING = "Do not call";

/** Every 3PL pin can be called. Dead and Do-not-contact rows are normal pins. */
export function hotLeadCallAllowed(_pin: { doNotCall?: boolean } | null | undefined): boolean {
  return true;
}

export type HotCapabilities = { dispo: boolean; claim: boolean };

export type HotDisplayLead = Lead & {
  hotLead?: true;
  hotOnly?: true;
  hotLeadId?: string;
  hotPin?: HotLeadPin;
};

export function isHotLead(lead: object | null | undefined): boolean {
  return !!lead && (lead as { hotLead?: boolean }).hotLead === true;
}

export function isHotOnlyLead(lead: Lead | null | undefined): lead is HotDisplayLead {
  const row = lead as HotDisplayLead | null | undefined;
  return !!row && row.hotOnly === true && !!row.hotPin && HOT_LEAD_ID.test(row.hotPin.id);
}

/**
 * Instant hotStatus after a knock. Matches the server:
 * converted stays converted; Appointment/Sale (from the dispositions list,
 * including a custom id with that name) becomes converted; anything else,
 * including a retired lead, becomes worked.
 */
export function hotLeadAfterDispo(
  pin: HotLeadPin,
  status: string,
  disposition: string,
  dispositions: Array<{ id?: string | null; name?: string | null }> = DEFAULT_DISPOSITIONS,
): HotLeadPin {
  const extra = new Set(collectHistoricalStatusIds(dispositions));
  const matched = isAppointmentSetOrSoldLead({ status, disposition }, extra);
  const hotStatus: HotLeadPin["hotStatus"] = pin.hotStatus === "converted" || matched ? "converted" : "worked";
  return { ...pin, status, disposition, hotStatus };
}

export function toHotDisplayLead(pin: HotLeadPin): HotDisplayLead {
  const contact = pin.contacts.find((row) => row.name || row.phone || row.email);
  return {
    id: pin.id,
    name: contact?.name || "3PL lead",
    address: pin.address,
    city: pin.city || "",
    state: pin.state,
    zip: pin.zip || "",
    phone: contact?.phone,
    email: contact?.email,
    status: pin.status || "assigned",
    disposition: pin.disposition || undefined,
    lat: pin.lat,
    lng: pin.lng,
    createdAt: pin.ghlCreatedOn ? new Date(pin.ghlCreatedOn) : new Date(0),
    claimedBy: pin.claimedBy || undefined,
    notes: pin.notes,
    source: "hot-lead",
    hotLead: true,
    hotOnly: true,
    hotLeadId: pin.id,
    hotPin: pin,
    ...(pin.testData ? { testData: true } : {}),
  };
}

/**
 * One pin per linked lead. The link is the route's linkedLeadId, optionally
 * mapped to the winning house pin. Unlinked 3PL leads are their own pin.
 * Lead objects passed in are not mutated.
 */
export function mergeHotLeads(
  leads: readonly Lead[],
  hotLeads: readonly HotLeadPin[],
  pinIdForLead?: ReadonlyMap<string, string>,
): { leads: Lead[]; index: Map<string, HotLeadPin> } {
  const index = new Map<string, HotLeadPin>();
  if (!hotLeads.length) return { leads: leads as Lead[], index };
  const byId = new Map(leads.map((lead) => [lead.id, lead]));
  const attached = new Map<string, HotLeadPin>();
  const consumed = new Set<string>();
  const extras = new Map<string, string>();
  for (const hot of hotLeads) {
    if (!HOT_LEAD_ID.test(hot.id) || !Number.isFinite(hot.lat) || !Number.isFinite(hot.lng)) continue;
    const linked = hot.linkedLeadId;
    const winner = linked ? (pinIdForLead?.get(linked) || linked) : "";
    const target = winner && byId.has(winner) ? winner : linked && byId.has(linked) ? linked : "";
    if (!target) continue;
    const previous = attached.get(target);
    if (previous) {
      consumed.add(hot.id);
      extras.set(hot.id, target);
      continue;
    }
    attached.set(target, withoutDoNotCall(hot));
    consumed.add(hot.id);
  }
  const merged = leads.map((lead) => {
    const hot = attached.get(lead.id);
    if (!hot) return lead;
    index.set(lead.id, hot);
    if (hot.linkedLeadId) index.set(hot.linkedLeadId, hot);
    index.set(hot.id, hot);
    const display: HotDisplayLead = { ...lead, hotLead: true, hotOnly: undefined, hotLeadId: hot.id, hotPin: hot };
    delete display.hotOnly;
    return display;
  });
  for (const hot of hotLeads) {
    if (consumed.has(hot.id) || !HOT_LEAD_ID.test(hot.id)) continue;
    if (!Number.isFinite(hot.lat) || !Number.isFinite(hot.lng)) continue;
    if (byId.has(hot.id)) continue;
    const display = toHotDisplayLead(hot);
    const mateIndex = merged.findIndex((lead) => isHotLead(lead) && sameHouse(display, lead));
    if (mateIndex >= 0) {
      const mate = merged[mateIndex] as HotDisplayLead;
      const current = mate.hotPin;
      const hotPin: HotLeadPin = withoutDoNotCall(current ? { ...current } : hot);
      const next: HotDisplayLead = { ...mate, hotLead: true, hotLeadId: mate.hotLeadId || hot.id, hotPin };
      if (!mate.hotOnly) delete next.hotOnly;
      merged[mateIndex] = next;
      index.set(mate.id, hotPin);
      index.set(hot.id, hotPin);
      if (current) index.set(current.id, hotPin);
      continue;
    }
    merged.push(display);
    index.set(hot.id, hot);
  }
  for (const [hotId, target] of extras) {
    const pin = index.get(target);
    if (pin) index.set(hotId, pin);
  }
  return { leads: merged, index };
}

let hotIndex = new Map<string, HotLeadPin>();
let hotCaps: HotCapabilities = { dispo: false, claim: false };
let onLocalPins: ((pins: HotLeadPin[]) => void) | null = null;
/** Last pin the server returned. Optimistic knocks, notes and claims sit on top. */
let serverPins = new Map<string, HotLeadPin>();
const detailListeners = new Set<(pin: HotLeadPin) => void>();
let refreshHotLead: ((id: string) => Promise<HotLeadPin | null>) | null = null;

function withoutDoNotCall(pin: HotLeadPin): HotLeadPin {
  if (pin.doNotCall !== true) return pin;
  const next = { ...pin };
  delete next.doNotCall;
  return next;
}

function clonePin(pin: HotLeadPin): HotLeadPin {
  return {
    ...pin,
    contacts: pin.contacts.map((row) => ({ ...row })),
    dispositionHistory: pin.dispositionHistory?.map((row) => ({ ...row })),
  };
}

function findHotPin(id: string): HotLeadPin | undefined {
  for (const pin of hotIndex.values()) if (pin.id === id) return pin;
  return undefined;
}

function uniquePins(): HotLeadPin[] {
  const byId = new Map<string, HotLeadPin>();
  for (const pin of hotIndex.values()) if (!byId.has(pin.id)) byId.set(pin.id, pin);
  return [...byId.values()];
}

function writeHotPin(next: HotLeadPin, notifyDetail: boolean): void {
  const nextIndex = new Map<string, HotLeadPin>();
  let hit = false;
  for (const [key, pin] of hotIndex) {
    if (pin.id === next.id) {
      nextIndex.set(key, next);
      hit = true;
    } else nextIndex.set(key, pin);
  }
  if (hit) {
    hotIndex = nextIndex;
    onLocalPins?.(uniquePins());
  }
  if (notifyDetail) for (const fn of detailListeners) fn(next);
}

function snapshotIfNeeded(id: string): void {
  if (serverPins.has(id)) return;
  const current = findHotPin(id);
  if (current) serverPins.set(id, clonePin(current));
}

/** Network copy. Replaces any optimistic snapshot for this pin. */
export function rememberServerHotPin(pin: HotLeadPin): void {
  serverPins.set(pin.id, clonePin(pin));
}

export function rememberServerHotPinIfAbsent(pin: HotLeadPin): void {
  if (!serverPins.has(pin.id)) serverPins.set(pin.id, clonePin(pin));
}

/** A saved hot write. The index already shows what the server accepted. */
export function confirmHotServerPin(id: string): void {
  const current = findHotPin(id);
  if (current) serverPins.set(id, clonePin(current));
}

export function serverHotPin(id: string): HotLeadPin | null {
  const pin = serverPins.get(id);
  return pin ? clonePin(pin) : null;
}

export function subscribeHotLeadDetail(id: string, fn: (pin: HotLeadPin) => void): () => void {
  const listener = (pin: HotLeadPin) => {
    if (pin.id === id) fn(pin);
  };
  detailListeners.add(listener);
  return () => {
    detailListeners.delete(listener);
  };
}

/** mode=one refresh after a territory refusal. One registration; the map hook owns it. */
export function bindHotLeadRefresh(fn: (id: string) => Promise<HotLeadPin | null>): () => void {
  refreshHotLead = fn;
  return () => {
    if (refreshHotLead === fn) refreshHotLead = null;
  };
}

/**
 * Drop the optimistic status, claim and notes back to the last server copy,
 * then re-fetch mode=one. A refresh failure keeps that copy.
 */
export async function rollbackHotLead(id: string): Promise<void> {
  const saved = serverPins.get(id);
  if (saved) writeHotPin(clonePin(saved), true);
  try {
    const fresh = await refreshHotLead?.(id);
    if (fresh && fresh.id === id) {
      rememberServerHotPin(fresh);
      writeHotPin(fresh, true);
    }
  } catch {
    /* The parked draft still shows the last server copy. */
  }
}

/** Optimistic claim, release or notes. Does not tell the open detail to reset. */
export function noteHotLocal(id: string, patch: Partial<HotLeadPin>): void {
  snapshotIfNeeded(id);
  const current = findHotPin(id);
  if (!current) return;
  writeHotPin({ ...current, ...patch }, false);
}

export function publishHotLeadIndex(next: Map<string, HotLeadPin>): void {
  hotIndex = next;
}

export function publishHotCapabilities(next: HotCapabilities): void {
  hotCaps = { dispo: next.dispo === true, claim: next.claim === true };
}

export function hotPinForLead(leadId: string): HotLeadPin | null {
  return hotIndex.get(leadId) ?? null;
}

/** Pins already on the map. The same pin can be indexed under more than one key. */
export function loadedHotPins(): HotLeadPin[] {
  const byId = new Map<string, HotLeadPin>();
  for (const pin of hotIndex.values()) {
    if (!byId.has(pin.id)) byId.set(pin.id, pin);
  }
  return [...byId.values()];
}

/** Display only. A merged 3PL house does not inherit doNotCall, so Call stays available. */
export function suppressLeadCall(lead: { id: string; hotPin?: HotLeadPin | null } | null | undefined): boolean {
  if (!lead) return false;
  const pin = lead.hotPin ?? hotPinForLead(lead.id);
  return !!pin && !hotLeadCallAllowed(pin);
}

export function hotCapabilities(): HotCapabilities {
  return hotCaps;
}

export function bindHotPins(fn: (pins: HotLeadPin[]) => void): () => void {
  onLocalPins = fn;
  return () => {
    if (onLocalPins === fn) onLocalPins = null;
  };
}

export function noteHotDispo(id: string, status: string, disposition: string): void {
  snapshotIfNeeded(id);
  const nextIndex = new Map<string, HotLeadPin>();
  const byId = new Map<string, HotLeadPin>();
  let hit = false;
  for (const [key, pin] of hotIndex) {
    const updated = pin.id === id ? hotLeadAfterDispo(pin, status, disposition) : pin;
    if (pin.id === id) hit = true;
    nextIndex.set(key, updated);
    if (!byId.has(updated.id)) byId.set(updated.id, updated);
  }
  if (!hit) return;
  hotIndex = nextIndex;
  onLocalPins?.([...byId.values()]);
}

export function resetHotLeadStore(): void {
  hotIndex = new Map();
  hotCaps = { dispo: false, claim: false };
  onLocalPins = null;
  serverPins = new Map();
  detailListeners.clear();
  refreshHotLead = null;
}
