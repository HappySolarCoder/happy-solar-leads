import { sameHouse } from "@/app/homeowners/houseIdentity";
import type { Lead } from "@/app/types";

export const HOT_LEAD_ID = /^ghl_[A-Za-z0-9_-]{1,120}$/;
export const HOT_PAGE_SIZE = 200;
/** Runaway guard while following nextCursor. Not a product page limit. */
export const HOT_CURSOR_PAGE_CAP = 50;

export type HotContact = { name?: string; phone?: string; email?: string };

export type HotHistoryEntry = {
  disposition?: string;
  timestamp?: string;
  userId?: string;
  userName?: string;
  notes?: string;
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
};

/** Shown on the hot-lead detail when the route set doNotCall. */
export const DO_NOT_CALL_WARNING = "Do not call";

/** A call control is only offered when the route did not set doNotCall. */
export function hotLeadCallAllowed(pin: { doNotCall?: boolean } | null | undefined): boolean {
  return pin?.doNotCall !== true;
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

const CONVERTED_STATUS = new Set(["appointment", "sale", "sold"]);

/** A knock receipt keeps the pin hot. Appointment and Sold become converted. */
export function hotLeadAfterDispo(pin: HotLeadPin, status: string, disposition: string): HotLeadPin {
  const statusKey = status.trim().toLowerCase();
  const nameKey = disposition.trim().toLowerCase();
  const converted = CONVERTED_STATUS.has(statusKey)
    || nameKey === "appointment set"
    || nameKey === "sale!"
    || nameKey === "sold";
  return {
    ...pin,
    status,
    disposition,
    hotStatus: converted ? "converted" : "worked",
  };
}

export function toHotDisplayLead(pin: HotLeadPin): HotDisplayLead {
  const contact = pin.contacts.find((row) => row.name || row.phone || row.email);
  return {
    id: pin.id,
    name: contact?.name || "Hot lead",
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
 * mapped to the winning house pin. Unlinked hot leads are their own pin.
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
      if (hot.doNotCall === true && previous.doNotCall !== true) attached.set(target, { ...previous, doNotCall: true });
      continue;
    }
    attached.set(target, hot);
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
      const doNotCall = hot.doNotCall === true || current?.doNotCall === true;
      const hotPin: HotLeadPin = current
        ? { ...current, ...(doNotCall ? { doNotCall: true as const } : {}) }
        : hot;
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

export function publishHotLeadIndex(next: Map<string, HotLeadPin>): void {
  hotIndex = next;
}

export function publishHotCapabilities(next: HotCapabilities): void {
  hotCaps = { dispo: next.dispo === true, claim: next.claim === true };
}

export function hotPinForLead(leadId: string): HotLeadPin | null {
  return hotIndex.get(leadId) ?? null;
}

/** Display only. A merged house hides Call when its hot lead is doNotCall. */
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
}
