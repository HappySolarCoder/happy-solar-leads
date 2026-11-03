import type { Lead } from "@/app/types";
import { HOT_LEADS_ENABLED } from "@/app/hotLeads/flag";
import {
  loadedHotPins,
  type HotHistoryEntry,
  type HotLeadPin,
} from "@/app/hotLeads/model";

export type KnockDraft = {
  kind?: string;
  collection?: string;
  leadId: string;
  direct?: { patch?: Partial<Lead> };
};

export type KnockLeadSet = {
  leads: Lead[];
  /** Hot pin id → promoted lead id. Empty when hot leads are off. */
  aliases: Array<[string, string]>;
};

const detailHistory = new Map<string, HotHistoryEntry[]>();

/** Detail history is not always on the map pin. Counting reads it back when the flag is on. */
export function rememberHotLeadHistory(pin: {
  id: string;
  dispositionHistory?: HotHistoryEntry[];
}): void {
  if (!HOT_LEADS_ENABLED || !pin.id || !pin.dispositionHistory?.length) return;
  detailHistory.set(pin.id, pin.dispositionHistory);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("raydar-hot-history"));
  }
}

export function resetHotKnockSourcesForTests(): void {
  detailHistory.clear();
}

function historyOf(pin: HotLeadPin): HotHistoryEntry[] {
  if (pin.dispositionHistory?.length) return pin.dispositionHistory;
  return detailHistory.get(pin.id) || [];
}

export function hotPinToLead(pin: HotLeadPin): Lead {
  const history = historyOf(pin).map((entry) => ({
    disposition: entry.disposition || "",
    timestamp: (entry.timestamp || "") as unknown as Date,
    userId: entry.userId || "",
    userName: entry.userName || "",
    ...(entry.field?.eventId ? { field: { eventId: entry.field.eventId } } : {}),
  }));
  return {
    id: pin.id,
    name: "",
    address: pin.address,
    city: pin.city || "",
    state: pin.state,
    zip: pin.zip || "",
    status: pin.status || "",
    disposition: pin.disposition || undefined,
    dispositionedAt: pin.dispositionedAt ? new Date(pin.dispositionedAt) : undefined,
    claimedBy: pin.claimedBy || undefined,
    createdAt: pin.ghlCreatedOn ? new Date(pin.ghlCreatedOn) : new Date(0),
    dispositionHistory: history as Lead["dispositionHistory"],
  };
}

function hotDraftLead(draft: KnockDraft, pins: readonly HotLeadPin[]): Lead | null {
  if (draft.collection !== "hotLeads" || draft.kind !== "knock" || !draft.direct?.patch) return null;
  const pin = pins.find((item) => item.id === draft.leadId);
  const id = pin?.id || draft.leadId;
  return {
    name: "",
    address: pin?.address || "",
    city: pin?.city || "",
    state: pin?.state || "",
    zip: pin?.zip || "",
    status: draft.direct.patch.status || pin?.status || "",
    createdAt: new Date(0),
    ...draft.direct.patch,
    id,
  } as Lead;
}

/**
 * Personal, map, and local snapshots stay in one list so a trimmed copy cannot
 * erase a knock. Hot pins and hot drafts are added only when the flag is on.
 */
export function assembleKnockLeads(input: {
  leads: readonly Lead[];
  extras?: readonly Lead[];
  hotPins?: readonly HotLeadPin[];
  hotDrafts?: readonly KnockDraft[];
  enabled?: boolean;
}): KnockLeadSet {
  const enabled = input.enabled ?? HOT_LEADS_ENABLED;
  const extras = input.extras ?? [];
  if (!enabled) {
    return extras.length
      ? { leads: [...input.leads, ...extras], aliases: [] }
      : { leads: [...input.leads], aliases: [] };
  }
  const pins = input.hotPins ?? loadedHotPins();
  const hotLeads = pins.map(hotPinToLead);
  const drafts = (input.hotDrafts || [])
    .map((draft) => hotDraftLead(draft, pins))
    .filter((lead): lead is Lead => !!lead);
  const aliases: Array<[string, string]> = [];
  for (const pin of pins) {
    if (pin.linkedLeadId && pin.linkedLeadId !== pin.id) aliases.push([pin.id, pin.linkedLeadId]);
  }
  return {
    leads: [...input.leads, ...extras, ...hotLeads, ...drafts],
    aliases,
  };
}
