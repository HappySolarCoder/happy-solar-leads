import release from "@/app/mobile/_lib/release.json";
import { apiFetch } from "@/app/utils/apiFetch";
import { fieldDatabase } from "./deviceStore";
import {
  SYNC_REPORT_EXTENDED_GPS_KEYS,
  isGpsUnverifiedReason,
  validGpsMeters,
  type GpsUnverifiedReason,
  type LocationPrecision,
} from "./gpsPolicy";
import type { GpsPointSource } from "./knockPoint";
import { SYNC_REASON } from "./syncReasons";
import type { ParkedReason, SyncState } from "./types";

export function appBuildLabel(): string {
  return `${release.version} (${release.build})`.slice(0, 32);
}

export type SyncEvent = {
  id: string;
  userId: string;
  at: number;
  draftId: string;
  leadId: string;
  createdAt: string;
  status?: string;
  disposition?: string;
  state: SyncState | "accepted" | "flagged" | "noted";
  parkedReason?: ParkedReason;
  lastError?: string;
  attempts?: number;
  reported?: boolean;
  gpsUnverifiedReason?: GpsUnverifiedReason;
  locationPrecision?: LocationPrecision;
  distanceM?: number;
  gpsAccuracyM?: number;
  gpsPointSource?: GpsPointSource;
  platform?: string;
  appBuild?: string;
};

export type SyncReportItem = {
  draftId: string;
  leadId: string;
  intendedStatus: string;
  actionAt: string;
  reasonCode: string;
  outcome: "refused" | "flagged_accepted";
  appBuild: string;
  lastError?: string;
  gpsAccuracyM?: number;
  distanceM?: number;
  gpsUnverifiedReason?: GpsUnverifiedReason;
  locationPrecision?: "precise" | "reduced";
};

const memory = new Map<string, SyncEvent[]>();
const reportedIds = new Set<string>();
let routeMissing = false;
let stripExtendedGpsKeys = !SYNC_REPORT_EXTENDED_GPS_KEYS;

const EXTENDED_GPS_KEYS = ["gpsUnverifiedReason", "locationPrecision"] as const;

function mirror(row: SyncEvent) {
  console.info("[raydar-sync]", {
    at: row.at,
    leadId: row.leadId,
    disposition: row.disposition,
    state: row.state,
    parkedReason: row.parkedReason,
    lastError: row.lastError,
    attempts: row.attempts,
  });
}

export async function recordSyncEvent(event: SyncEvent): Promise<void> {
  const row: SyncEvent = {
    ...event,
    lastError: event.lastError?.slice(0, 200),
    reported: event.reported ?? false,
  };
  mirror(row);
  try {
    if (typeof indexedDB === "undefined") {
      const list = (memory.get(row.userId) || []).concat(row).slice(-300);
      memory.set(row.userId, list);
    } else {
      const db = await fieldDatabase();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("diagnostics", "readwrite");
        const store = tx.objectStore("diagnostics");
        store.put(row);
        const all = store.getAll();
        all.onsuccess = () => {
          const mine = (all.result as SyncEvent[])
            .filter((entry) => entry.userId === row.userId)
            .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
          for (const extra of mine.slice(0, Math.max(0, mine.length - 300)))
            store.delete(extra.id);
        };
        tx.oncomplete = () => resolve();
        tx.onabort = tx.onerror = () =>
          reject(tx.error || Error("Could not write the diagnostics log."));
      });
    }
  } catch (error) {
    console.info("[raydar-sync]", (error as Error).message);
  }
  if (typeof window !== "undefined")
    window.dispatchEvent(new CustomEvent("raydar-sync-log"));
}

export async function readSyncLog(userId: string): Promise<SyncEvent[]> {
  if (!userId) return [];
  if (typeof indexedDB === "undefined") return (memory.get(userId) || []).slice();
  try {
    const db = await fieldDatabase();
    const rows = await new Promise<SyncEvent[]>((resolve, reject) => {
      const tx = db.transaction("diagnostics", "readonly");
      const request = tx.objectStore("diagnostics").getAll();
      request.onsuccess = () => resolve((request.result as SyncEvent[]) || []);
      tx.onabort = tx.onerror = () => reject(tx.error || Error("diagnostics"));
    });
    return rows
      .filter((entry) => entry.userId === userId)
      .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))
      .slice(-300);
  } catch {
    return [];
  }
}

async function markReported(userId: string, ids: string[]) {
  for (const id of ids) reportedIds.add(id);
  if (typeof indexedDB === "undefined") {
    const list = memory.get(userId) || [];
    memory.set(
      userId,
      list.map((entry) => (ids.includes(entry.id) ? { ...entry, reported: true } : entry)),
    );
    return;
  }
  const db = await fieldDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("diagnostics", "readwrite");
    const store = tx.objectStore("diagnostics");
    for (const id of ids) {
      const read = store.get(id);
      read.onsuccess = () => {
        const row = read.result as SyncEvent | undefined;
        if (row) store.put({ ...row, reported: true });
      };
    }
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(tx.error || Error("diagnostics"));
  });
}

export function syncReportItem(event: SyncEvent, includeExtended = !stripExtendedGpsKeys): SyncReportItem {
  const flagged = event.state === "flagged" || event.gpsUnverifiedReason != null;
  const item: SyncReportItem = {
    draftId: event.draftId,
    leadId: event.leadId,
    intendedStatus: (event.status || event.disposition || "unknown").slice(0, 64),
    actionAt: event.createdAt,
    reasonCode: flagged ? SYNC_REASON.gpsUnverifiedFlagged : (event.parkedReason || SYNC_REASON.other),
    outcome: flagged ? "flagged_accepted" : "refused",
    appBuild: (event.appBuild || appBuildLabel()).slice(0, 32),
  };
  if (event.lastError) item.lastError = event.lastError.slice(0, 500);
  if (validGpsMeters(event.gpsAccuracyM)) item.gpsAccuracyM = event.gpsAccuracyM;
  if (validGpsMeters(event.distanceM)) item.distanceM = event.distanceM;
  if (includeExtended && flagged) {
    if (isGpsUnverifiedReason(event.gpsUnverifiedReason)) item.gpsUnverifiedReason = event.gpsUnverifiedReason;
    if (event.locationPrecision === "precise" || event.locationPrecision === "reduced") {
      item.locationPrecision = event.locationPrecision;
    }
  }
  return item;
}

export type SyncReportPostResult = number | { status: number; body?: unknown; raw?: string };

function readPostResult(value: SyncReportPostResult): { status: number; body?: unknown; raw?: string } {
  return typeof value === "number" ? { status: value } : value;
}

/** Match the live 400 `{ error, field, index? }`. Never match on `error`. Substring only when the body is not JSON. */
export function extendedGpsKeyRejected(result: { status: number; body?: unknown; raw?: string }): boolean {
  if (result.status !== 400) return false;
  if (result.body && typeof result.body === "object") {
    const field = (result.body as { field?: unknown }).field;
    return field === "gpsUnverifiedReason" || field === "locationPrecision";
  }
  const raw = result.raw ?? "";
  if (!raw) return false;
  return raw.includes("gpsUnverifiedReason") || raw.includes("locationPrecision");
}

function withoutExtendedKeys(item: SyncReportItem): SyncReportItem {
  const next = { ...item };
  for (const key of EXTENDED_GPS_KEYS) delete next[key];
  return next;
}

async function defaultProbe(): Promise<number> {
  if (typeof window === "undefined" || routeMissing) return 404;
  try {
    const response = await apiFetch("/api/field/sync-report", { method: "GET" });
    return response.status;
  } catch {
    return 0;
  }
}

async function defaultPost(items: SyncReportItem[]): Promise<SyncReportPostResult> {
  if (typeof window === "undefined") return 404;
  try {
    const { auth } = await import("@/app/utils/firebase");
    const token = await auth?.currentUser?.getIdToken();
    if (!token) return 401;
    const response = await apiFetch("/api/field/sync-report", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ reports: items }),
    });
    const raw = await response.text();
    let body: unknown;
    try { body = raw ? JSON.parse(raw) : undefined; } catch { body = undefined; }
    return { status: response.status, body, raw };
  } catch {
    return 0;
  }
}

/** Bounded, idempotent report. A 404 means the route is not deployed: no-op, no retry loop, no UI. */
export async function reportParked(
  userId: string,
  deps?: {
    probe?: () => Promise<number>;
    post?: (items: SyncReportItem[]) => Promise<SyncReportPostResult>;
  },
): Promise<{ sent: number; status: number }> {
  try {
    if (!deps && routeMissing) return { sent: 0, status: 404 };
    const pending = (await readSyncLog(userId)).filter(
      (event) =>
        (event.state === "parked" || event.state === "flagged") &&
        event.draftId &&
        !event.reported &&
        !reportedIds.has(event.draftId),
    );
    const batch = pending.slice(0, 50);
    if (!batch.length) return { sent: 0, status: 0 };
    let status = 0;
    try {
      status = await (deps?.probe ?? defaultProbe)();
    } catch {
      return { sent: 0, status: 0 };
    }
    if (status === 404) {
      if (!deps) routeMissing = true;
      return { sent: 0, status: 404 };
    }
    if (status === 0) return { sent: 0, status: 0 };
    const post = deps?.post ?? defaultPost;
    let items = batch.map((event) => syncReportItem(event, !stripExtendedGpsKeys));
    let posted = readPostResult(await post(items));
    if (extendedGpsKeyRejected(posted) && !stripExtendedGpsKeys) {
      stripExtendedGpsKeys = true;
      items = items.map(withoutExtendedKeys);
      posted = readPostResult(await post(items));
    }
    if (posted.status === 404) {
      if (!deps) routeMissing = true;
      return { sent: 0, status: 404 };
    }
    if (posted.status >= 200 && posted.status < 300) {
      for (const event of batch) reportedIds.add(event.draftId);
      await markReported(userId, batch.map((event) => event.id));
      return { sent: batch.length, status: posted.status };
    }
    return { sent: 0, status: posted.status };
  } catch {
    return { sent: 0, status: 0 };
  }
}

export function resetSyncLogForTests() {
  memory.clear();
  reportedIds.clear();
  routeMissing = false;
  stripExtendedGpsKeys = !SYNC_REPORT_EXTENDED_GPS_KEYS;
}
