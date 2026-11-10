import type { User } from "@/app/types";
import { canSeeHotLeads, type HotLeadProfile } from "./access";
import { HOT_SILENT_BACKOFF_MS, HOT_TRANSIENT_BACKOFF_MS } from "./fetch";
import { HOT_LEADS_ENABLED } from "./flag";
import { HOT_LEAD_ID } from "./model";

export const HOT_OVERVIEW_URL = "/api/hot-leads?mode=points";
export const HOT_OVERVIEW_TTL_MS = 15 * 60 * 1000;
export const HOT_OVERVIEW_MAX_POINTS = 2000;
export const HOT_OVERVIEW_STALE_MS = 24 * 60 * 60 * 1000;
const HOT_OVERVIEW_STORAGE_PREFIX = "raydar.hotOverview.v1:";

export type HotOverviewStatus = "active" | "worked" | "converted" | "retired";
export type HotOverviewPoint = {
  id: string;
  lat: number;
  lng: number;
  hotStatus?: HotOverviewStatus;
};

export type HotOverviewResult = {
  points: HotOverviewPoint[];
  fromCache: boolean;
  unavailable: boolean;
};

const HOT_STATUSES = new Set<HotOverviewStatus>(["active", "worked", "converted", "retired"]);

type OverviewStorage = {
  getItem?: (key: string) => string | null;
  setItem?: (key: string, value: string) => void;
};

type CacheEntry = { at: number; points: HotOverviewPoint[] };

const memory = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<HotOverviewResult>>();
let backoffUntil = 0;

const SKIPPED: HotOverviewResult = { points: [], fromCache: false, unavailable: false };
const UNAVAILABLE: HotOverviewResult = { points: [], fromCache: false, unavailable: true };

export function clearHotOverviewBackoff(): void {
  backoffUntil = 0;
}

export function resetHotOverviewForTests(): void {
  memory.clear();
  inflight.clear();
  backoffUntil = 0;
}

/** Same count rule as the door clusters: 999 stays "999", 1234 becomes "1.2k". */
export function hotOverviewClusterLabel(count: number): string {
  return count >= 1000 ? `${(count / 1000).toFixed(1)}k` : String(count);
}

export function parseHotOverview(data: unknown): HotOverviewPoint[] {
  try {
    if (!data || typeof data !== "object" || Array.isArray(data)) return [];
    const rows = (data as { points?: unknown }).points;
    if (!Array.isArray(rows)) return [];
    const seen = new Set<string>();
    const points: HotOverviewPoint[] = [];
    for (const row of rows) {
      if (points.length >= HOT_OVERVIEW_MAX_POINTS) break;
      if (!row || typeof row !== "object" || Array.isArray(row)) continue;
      const item = row as { id?: unknown; lat?: unknown; lng?: unknown; hotStatus?: unknown };
      if (typeof item.id !== "string" || !HOT_LEAD_ID.test(item.id) || seen.has(item.id)) continue;
      if (typeof item.lat !== "number" || typeof item.lng !== "number") continue;
      if (!Number.isFinite(item.lat) || !Number.isFinite(item.lng)) continue;
      if (item.lat < -90 || item.lat > 90 || item.lng < -180 || item.lng > 180) continue;
      seen.add(item.id);
      const point: HotOverviewPoint = { id: item.id, lat: item.lat, lng: item.lng };
      if (typeof item.hotStatus === "string" && HOT_STATUSES.has(item.hotStatus as HotOverviewStatus)) {
        point.hotStatus = item.hotStatus as HotOverviewStatus;
      }
      points.push(point);
    }
    return points;
  } catch {
    return [];
  }
}

function storageKey(uid: string): string {
  return `${HOT_OVERVIEW_STORAGE_PREFIX}${uid}`;
}

function browserStorage(): OverviewStorage | null {
  try {
    const store = (globalThis as { localStorage?: OverviewStorage }).localStorage;
    if (store && typeof store.getItem === "function" && typeof store.setItem === "function") return store;
  } catch {
    /* A blocked WebView keeps the memory cache only. */
  }
  return null;
}

function readStored(uid: string, storage: OverviewStorage | null): CacheEntry | null {
  if (!storage?.getItem) return null;
  try {
    const raw = storage.getItem(storageKey(uid));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { at?: unknown; points?: unknown };
    if (!parsed || typeof parsed.at !== "number" || !Number.isFinite(parsed.at)) return null;
    return { at: parsed.at, points: parseHotOverview({ points: parsed.points }) };
  } catch {
    return null;
  }
}

function writeStored(uid: string, entry: CacheEntry, storage: OverviewStorage | null): void {
  if (!storage?.setItem) return;
  try {
    storage.setItem(storageKey(uid), JSON.stringify({ at: entry.at, points: entry.points }));
  } catch {
    /* A blocked WebView keeps the memory cache only. */
  }
}

function ageOk(entry: CacheEntry, now: number, maxAge: number): boolean {
  return now >= entry.at && now - entry.at < maxAge;
}

function readCache(uid: string, storage: OverviewStorage | null): CacheEntry | null {
  return memory.get(uid) ?? readStored(uid, storage);
}

function failureBackoff(status: number): number | null {
  if (status === 400 || status === 404 || status === 405) return HOT_SILENT_BACKOFF_MS;
  if (status === 401 || status === 403 || status >= 500) return HOT_TRANSIENT_BACKOFF_MS;
  return null;
}

function fromFailure(cached: CacheEntry | null, now: number): HotOverviewResult {
  if (cached && ageOk(cached, now, HOT_OVERVIEW_STALE_MS)) {
    return { points: cached.points, fromCache: true, unavailable: false };
  }
  return UNAVAILABLE;
}

export type HotOverviewFetcher = (
  url: string,
  init: { headers: { Authorization: string } },
) => Promise<Response>;

async function loadOverview(input: {
  user: HotLeadProfile | User;
  token: string;
  fetcher: HotOverviewFetcher;
  now: number;
  storage: OverviewStorage | null;
}): Promise<HotOverviewResult> {
  const uid = input.user.id;
  const cached = readCache(uid, input.storage);
  if (cached && ageOk(cached, input.now, HOT_OVERVIEW_TTL_MS)) {
    memory.set(uid, cached);
    return { points: cached.points, fromCache: true, unavailable: false };
  }
  if (input.now < backoffUntil) return fromFailure(cached, input.now);
  let response: Response;
  try {
    response = await input.fetcher(HOT_OVERVIEW_URL, {
      headers: { Authorization: `Bearer ${input.token}` },
    });
  } catch {
    backoffUntil = input.now + HOT_TRANSIENT_BACKOFF_MS;
    return fromFailure(cached, input.now);
  }
  const wait = failureBackoff(response.status);
  if (wait != null) {
    backoffUntil = input.now + wait;
    return fromFailure(cached, input.now);
  }
  if (!response.ok) {
    backoffUntil = input.now + HOT_TRANSIENT_BACKOFF_MS;
    return fromFailure(cached, input.now);
  }
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    backoffUntil = input.now + HOT_TRANSIENT_BACKOFF_MS;
    return fromFailure(cached, input.now);
  }
  const points = parseHotOverview(data);
  const entry = { at: input.now, points };
  memory.set(uid, entry);
  writeStored(uid, entry, input.storage);
  return { points, fromCache: false, unavailable: false };
}

/**
 * One lightweight point list per rep. Never throws, never logs rows, and never
 * touches the viewport pin cache. A missing route stays quiet for 15 minutes.
 */
export function fetchHotOverview(input: {
  user: HotLeadProfile | User | null;
  token: string;
  fetcher: HotOverviewFetcher;
  now?: number;
  enabled?: boolean;
  roles?: readonly string[];
  storage?: OverviewStorage | null;
}): Promise<HotOverviewResult> {
  const enabled = input.enabled ?? HOT_LEADS_ENABLED;
  const user = input.user;
  if (!enabled || !canSeeHotLeads(user, input.roles) || !input.token || !user?.id) {
    return Promise.resolve(SKIPPED);
  }
  const existing = inflight.get(user.id);
  if (existing) return existing;
  const run = loadOverview({
    user,
    token: input.token,
    fetcher: input.fetcher,
    now: input.now ?? Date.now(),
    storage: input.storage === undefined ? browserStorage() : input.storage,
  }).catch(() => UNAVAILABLE);
  inflight.set(user.id, run);
  void run.finally(() => {
    if (inflight.get(user.id) === run) inflight.delete(user.id);
  });
  return run;
}
