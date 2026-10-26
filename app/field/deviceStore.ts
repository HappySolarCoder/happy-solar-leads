import type { Lead, User } from "@/app/types";
import type { FieldConfig, PendingMutation } from "./types";
import { mergeReportingPatch, reportingPatch } from './directWrites';
import { compareQueuedDrafts } from './draftQueue';
export type PreparedArea = {
  userId: string;
  at: number;
  user: User;
  leads: Lead[];
  config: FieldConfig;
};
let connection: Promise<IDBDatabase> | undefined;
export function fieldDatabase() {
  return database();
}
function database() {
  return (connection ??= new Promise((resolve, reject) => {
    const r = indexedDB.open("raydar-field-v11", 3);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains("drafts")) db.createObjectStore("drafts", { keyPath: "id" });
      if (!db.objectStoreNames.contains("areas")) db.createObjectStore("areas", { keyPath: "userId" });
      if (!db.objectStoreNames.contains("diagnostics")) db.createObjectStore("diagnostics", { keyPath: "id" });
      if (!db.objectStoreNames.contains("territoryPolygons")) db.createObjectStore("territoryPolygons", { keyPath: "userId" });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => {
      connection = undefined;
      reject(Error("Device storage unavailable. Nothing was saved."));
    };
  }));
}
async function request<T>(
  store: string,
  mode: IDBTransactionMode,
  run: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode),
      r = run(tx.objectStore(store));
    let value: T;
    r.onsuccess = () => {
      value = r.result;
    };
    tx.oncomplete = () => resolve(value);
    tx.onabort = tx.onerror = () =>
      reject(
        Error(
          "Device storage is full or unavailable. Keep this screen open and retry.",
        ),
      );
  });
}
export const readDrafts = async (uid: string) =>
  (await request<PendingMutation[]>("drafts", "readonly", (s) => s.getAll()))
    .filter((x) => x.userId === uid)
    .sort(compareQueuedDrafts);
export const putDraft = (m: PendingMutation) =>
  request("drafts", "readwrite", (s) => s.put(m));
/** GPS completion is a compare/update in one transaction: a discarded draft
 * must never be recreated by an asynchronous location callback. */
export async function updatePendingGpsDraft(m: PendingMutation) {
  const db = await database();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction('drafts', 'readwrite'), store = tx.objectStore('drafts');
    const read = store.get(m.id);
    read.onsuccess = () => {
      const current = read.result as PendingMutation | undefined;
      if (current?.userId === m.userId && current.direct?.gps) store.put(m);
    };
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(Error('Could not save GPS verification. The knock remains unsynced for review.'));
  });
}
export const removeDraft = (id: string) =>
  request("drafts", "readwrite", (s) => s.delete(id));
export const putArea = (a: PreparedArea) =>
  request("areas", "readwrite", (s) => s.put(a));
export async function readArea(uid: string) {
  const a = await request<PreparedArea | undefined>("areas", "readonly", (s) =>
    s.get(uid),
  );
  return a && a.userId === uid && Date.now() - a.at < 24 * 3600000 ? a : null;
}
export const clearArea = (uid: string) =>
  request("areas", "readwrite", (s) => s.delete(uid));

/** The signed-in rep's own territory polygons from /api/team-areas. Not a lead cache. */
export type TerritoryPolygonCache = {
  userId: string;
  at: number;
  polygons: { lat: number; lng: number }[][];
  truncated?: boolean;
};

export const putTerritoryPolygons = (row: TerritoryPolygonCache) =>
  request("territoryPolygons", "readwrite", (s) => s.put(row));

export async function readTerritoryPolygons(userId: string): Promise<TerritoryPolygonCache | null> {
  if (!userId || typeof indexedDB === "undefined") return null;
  try {
    const row = await request<TerritoryPolygonCache | undefined>("territoryPolygons", "readonly", (s) => s.get(userId));
    return row && row.userId === userId && Array.isArray(row.polygons) ? row : null;
  } catch {
    return null;
  }
}

function byAction(a: PendingMutation, b: PendingMutation) {
  return compareQueuedDrafts(a, b);
}

/**
 * A clear the route refused (400 clearNotes). The server kept its notes, so
 * the editor shows those, and typing after it appends to them.
 */
function refusedClear(m: PendingMutation): boolean {
  return m.kind === "notes"
    && m.clearNotes === true
    && !(m.notes ?? m.direct?.patch?.notes)
    && m.parkedReason === "notes_rejected";
}

/** Provisional overlay only; no source objects or live history are changed.
 * Queued, retrying, GPS, and parked drafts all show the rep's newest local dispo. */
export function overlayDrafts(
  leads: Lead[],
  drafts: PendingMutation[],
): Lead[] {
  if (drafts.some(m => m.direct)) {
    const map = new Map(leads.map(l => [l.id, l]));
    for (const m of drafts.filter(m => m.direct).sort(byAction)) {
      const lead = map.get(m.leadId) || m.direct?.create;
      if (!lead || !m.direct || refusedClear(m)) continue;
      try {
        const patch = reportingPatch(m, { id: m.userId, name: m.userName || 'Pending sync' } as User);
        map.set(lead.id, { ...lead, ...mergeReportingPatch(lead, patch).patch });
      } catch { /* Malformed drafts stay in the diagnostics log. */ }
    }
    return overlayDrafts([...map.values()], drafts.filter(m => !m.direct));
  }
  const byId = new Map<string, PendingMutation[]>();
  for (const m of [...drafts].sort(byAction)) {
    const list = byId.get(m.leadId) || [];
    list.push(m);
    byId.set(m.leadId, list);
  }
  return leads.map((l) => {
    const ms = byId.get(l.id);
    if (!ms) return l;
    let next = { ...l };
    for (const m of ms) {
      if (m.kind === "notes" && !refusedClear(m)) next = { ...next, notes: m.notes };
      if (
        m.kind === "knock" &&
        m.status &&
        !next.dispositionHistory?.some((h) => h.field?.eventId === m.id)
      ) {
        const at = new Date(m.createdAt);
        const history = [
          {
            disposition: m.disposition || m.status,
            timestamp: at,
            userId: m.userId,
            userName: "Pending sync",
            field: m.observation,
          },
          ...(next.dispositionHistory || []),
        ].sort((a, b) => +new Date(b.timestamp) - +new Date(a.timestamp));
        const newer = !next.dispositionedAt || at.getTime() >= +new Date(next.dispositionedAt);
        next = {
          ...next,
          dispositionHistory: history,
          ...(newer
            ? {
                status: m.status,
                dispositionedAt: at,
                ...(m.goBackScheduledDate
                  ? {
                      goBackScheduledDate: new Date(m.goBackScheduledDate),
                      goBackScheduledTime: m.goBackScheduledTime,
                      goBackNotes: m.goBackNotes,
                      goBackScheduledBy: m.userId,
                    }
                  : {}),
              }
            : {}),
        };
      }
    }
    return next;
  });
}
