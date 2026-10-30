import type { User } from "@/app/types";
import { canSeeHotLeads, type HotLeadProfile } from "./access";
import { HOT_LEADS_ENABLED } from "./flag";
import {
  HOT_CURSOR_PAGE_CAP,
  HOT_LEAD_ID,
  HOT_PAGE_SIZE,
  type HotCapabilities,
  type HotContact,
  type HotHistoryEntry,
  type HotLeadPin,
} from "./model";

export const HOT_LEADS_PATH = "/api/hot-leads";
/** Same session backoff as a missing route. Silent failures share it. */
export const HOT_SILENT_BACKOFF_MS = 15 * 60 * 1000;

export type HotView = {
  south: number;
  north: number;
  west: number;
  east: number;
  zoom: number;
};

export type HotMapResult = {
  pins: HotLeadPin[];
  capabilities: HotCapabilities;
  /** Always empty. This layer never asks the user to sign in again. */
  error: "";
};

const EMPTY_CAPS: HotCapabilities = { dispo: false, claim: false };
const EMPTY: HotMapResult = { pins: [], capabilities: EMPTY_CAPS, error: "" };

type Cached = { at: number; pins: HotLeadPin[]; capabilities: HotCapabilities };
const cache = new Map<string, Cached>();
let silentUntil = 0;

export function resetHotLeadFetchForTests(): void {
  cache.clear();
  silentUntil = 0;
}

export function hotMapBoundsOk(view: HotView | null | undefined): view is HotView {
  if (!view) return false;
  const { south, north, west, east, zoom } = view;
  if (![south, north, west, east, zoom].every((n) => typeof n === "number" && Number.isFinite(n))) return false;
  if (zoom < 15) return false;
  if (!(north > south) || !(east > west)) return false;
  if (north - south > 0.06 || east - west > 0.09) return false;
  return true;
}

export function hotMapUrl(view: HotView, cursor?: { id: string; lat: number } | null): string {
  const params = new URLSearchParams({
    mode: "map",
    south: String(view.south),
    north: String(view.north),
    west: String(view.west),
    east: String(view.east),
    zoom: String(view.zoom),
    limit: String(HOT_PAGE_SIZE),
  });
  if (cursor?.id) {
    params.set("after", cursor.id);
    params.set("afterLat", String(cursor.lat));
  }
  return `${HOT_LEADS_PATH}?${params}`;
}

export function hotDetailUrl(id: string): string {
  return `${HOT_LEADS_PATH}?id=${encodeURIComponent(id)}`;
}

function silentStatus(status: number): boolean {
  return status === 401 || status === 403 || status === 404 || status === 405 || status >= 500;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function contact(value: unknown): HotContact | null {
  if (!value || typeof value !== "object") return null;
  const row = value as HotContact;
  const contactRow: HotContact = {};
  const name = text(row.name);
  const phone = text(row.phone);
  const email = text(row.email);
  if (name) contactRow.name = name;
  if (phone) contactRow.phone = phone;
  if (email) contactRow.email = email;
  return name || phone || email ? contactRow : null;
}

export function parseHotLeadPin(value: unknown): HotLeadPin | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<HotLeadPin> & { contacts?: unknown };
  if (typeof row.id !== "string" || !HOT_LEAD_ID.test(row.id)) return null;
  if (typeof row.lat !== "number" || typeof row.lng !== "number") return null;
  if (!Number.isFinite(row.lat) || !Number.isFinite(row.lng)) return null;
  if (typeof row.address !== "string" || !row.address.trim()) return null;
  if (typeof row.state !== "string" || !row.state) return null;
  const contacts = Array.isArray(row.contacts) ? row.contacts.map(contact).filter((item): item is HotContact => !!item) : [];
  if (!contacts.length) return null;
  const status = row.hotStatus;
  if (status !== "active" && status !== "worked" && status !== "converted" && status !== "retired") return null;
  const pin: HotLeadPin = {
    id: row.id,
    lat: row.lat,
    lng: row.lng,
    address: row.address,
    state: row.state,
    contacts,
    hotStatus: status,
    claimedBy: typeof row.claimedBy === "string" ? row.claimedBy : null,
    claimedByName: typeof row.claimedByName === "string" ? row.claimedByName : null,
    claimedAt: typeof row.claimedAt === "string" ? row.claimedAt : null,
    status: typeof row.status === "string" ? row.status : null,
    disposition: typeof row.disposition === "string" ? row.disposition : null,
    dispositionedAt: typeof row.dispositionedAt === "string" ? row.dispositionedAt : null,
    linkedLeadId: typeof row.linkedLeadId === "string" ? row.linkedLeadId : null,
    homeownerId: typeof row.homeownerId === "string" ? row.homeownerId : null,
  };
  const city = text(row.city);
  const zip = text(row.zip);
  const stage = text(row.ghlStage);
  const source = text(row.ghlSource);
  const created = text(row.ghlCreatedOn);
  const notes = text(row.notes);
  if (city) pin.city = city;
  if (zip) pin.zip = zip;
  if (stage) pin.ghlStage = stage;
  if (source) pin.ghlSource = source;
  if (created) pin.ghlCreatedOn = created;
  if (notes) pin.notes = notes;
  if (row.gpsVerified === true || row.gpsVerified === false) pin.gpsVerified = row.gpsVerified;
  if (typeof row.gpsUnverifiedReason === "string") pin.gpsUnverifiedReason = row.gpsUnverifiedReason;
  if (row.testData === true) pin.testData = true;
  if (row.doNotCall === true) pin.doNotCall = true;
  return pin;
}

function readCaps(data: { capabilities?: { dispo?: unknown; claim?: unknown } } | null): HotCapabilities {
  return {
    dispo: data?.capabilities?.dispo === true,
    claim: data?.capabilities?.claim === true,
  };
}

function remember(key: string, value: Cached): void {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > 6) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

export type HotFetcher = (url: string, init: { headers: { Authorization: string } }) => Promise<Response>;

/**
 * Viewport pages of 200, following nextCursor.
 * 401, 403, 404, 405 and 5xx return no pins and no error.
 * This function cannot see the lead cache and must not be given one.
 */
export async function fetchHotLeadMap(input: {
  user: HotLeadProfile | User | null;
  view: HotView | null;
  token: string;
  fetcher: HotFetcher;
  enabled?: boolean;
  now?: number;
  pageCap?: number;
}): Promise<HotMapResult> {
  const enabled = input.enabled ?? HOT_LEADS_ENABLED;
  if (!enabled || !canSeeHotLeads(input.user) || !input.token) return EMPTY;
  if (!hotMapBoundsOk(input.view)) return EMPTY;
  const now = input.now ?? Date.now();
  if (now < silentUntil) return EMPTY;
  const key = [input.user?.id, input.view.south, input.view.north, input.view.west, input.view.east, input.view.zoom]
    .map((part) => String(part))
    .join(":");
  const saved = cache.get(key);
  let cursor: { id: string; lat: number } | null = null;
  const pins: HotLeadPin[] = [];
  const seen = new Set<string>();
  const cursors = new Set<string>();
  let capabilities = EMPTY_CAPS;
  const cap = input.pageCap ?? HOT_CURSOR_PAGE_CAP;
  try {
    for (let page = 0; page < cap; page += 1) {
      const response = await input.fetcher(hotMapUrl(input.view, cursor), {
        headers: { Authorization: `Bearer ${input.token}` },
      });
      if (silentStatus(response.status)) {
        silentUntil = now + HOT_SILENT_BACKOFF_MS;
        return EMPTY;
      }
      if (!response.ok) return saved ? { pins: saved.pins, capabilities: saved.capabilities, error: "" } : EMPTY;
      const data = await response.json() as {
        hotLeads?: unknown[];
        nextCursor?: { id?: unknown; lat?: unknown } | null;
        capabilities?: { dispo?: unknown; claim?: unknown };
      };
      capabilities = readCaps(data);
      for (const row of data.hotLeads || []) {
        const pin = parseHotLeadPin(row);
        if (!pin || seen.has(pin.id) || pin.testData === true) continue;
        seen.add(pin.id);
        pins.push(pin);
      }
      const next = data.nextCursor;
      if (!next || typeof next.id !== "string" || !next.id || typeof next.lat !== "number" || !Number.isFinite(next.lat)) break;
      const mark = `${next.id}:${next.lat}`;
      if (cursors.has(mark)) break;
      cursors.add(mark);
      cursor = { id: next.id, lat: next.lat };
    }
  } catch {
    return saved ? { pins: saved.pins, capabilities: saved.capabilities, error: "" } : EMPTY;
  }
  const value = { pins, capabilities, error: "" as const };
  remember(key, { at: now, pins, capabilities });
  return value;
}

export async function fetchHotLeadDetail(input: {
  user: HotLeadProfile | User | null;
  id: string;
  token: string;
  fetcher: HotFetcher;
  enabled?: boolean;
  now?: number;
}): Promise<{ hotLead: HotLeadPin | null; error: "" }> {
  const enabled = input.enabled ?? HOT_LEADS_ENABLED;
  if (!enabled || !canSeeHotLeads(input.user) || !input.token || !HOT_LEAD_ID.test(input.id)) return { hotLead: null, error: "" };
  const now = input.now ?? Date.now();
  if (now < silentUntil) return { hotLead: null, error: "" };
  try {
    const response = await input.fetcher(hotDetailUrl(input.id), {
      headers: { Authorization: `Bearer ${input.token}` },
    });
    if (silentStatus(response.status)) {
      silentUntil = now + HOT_SILENT_BACKOFF_MS;
      return { hotLead: null, error: "" };
    }
    if (!response.ok) return { hotLead: null, error: "" };
    const data = await response.json() as { hotLead?: unknown; dispositionHistory?: unknown };
    const pin = parseHotLeadPin(data.hotLead);
    if (!pin || pin.testData === true) return { hotLead: null, error: "" };
    const history = Array.isArray((data.hotLead as { dispositionHistory?: unknown })?.dispositionHistory)
      ? ((data.hotLead as { dispositionHistory: unknown[] }).dispositionHistory)
      : [];
    const dispositionHistory: HotHistoryEntry[] = history.slice(0, 50).map((entry) => {
      const row = entry as HotHistoryEntry;
      return {
        disposition: text(row?.disposition),
        timestamp: text(row?.timestamp),
        userId: text(row?.userId),
        userName: text(row?.userName),
        notes: text(row?.notes),
      };
    });
    return { hotLead: { ...pin, dispositionHistory }, error: "" };
  } catch {
    return { hotLead: null, error: "" };
  }
}
