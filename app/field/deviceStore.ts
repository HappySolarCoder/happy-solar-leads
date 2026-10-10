import type { Lead, User } from "@/app/types";
import type { FieldConfig, PendingMutation } from "./types";
export type PreparedArea = {
  userId: string;
  at: number;
  user: User;
  leads: Lead[];
  config: FieldConfig;
};
let connection: Promise<IDBDatabase> | undefined;
function database() {
  return (connection ??= new Promise((resolve, reject) => {
    const r = indexedDB.open("raydar-field-v11", 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore("drafts", { keyPath: "id" });
      r.result.createObjectStore("areas", { keyPath: "userId" });
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
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
export const putDraft = (m: PendingMutation) =>
  request("drafts", "readwrite", (s) => s.put(m));
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

/** Provisional overlay only; no source objects or live history are changed. */
export function overlayDrafts(
  leads: Lead[],
  drafts: PendingMutation[],
): Lead[] {
  const byId = new Map<string, PendingMutation[]>(),
    blocked = new Set<string>();
  for (const m of drafts) {
    if (m.blocked) {
      blocked.add(m.leadId);
      continue;
    }
    if (blocked.has(m.leadId)) continue;
    const list = byId.get(m.leadId) || [];
    list.push(m);
    byId.set(m.leadId, list);
  }
  return leads.map((l) => {
    const ms = byId.get(l.id);
    if (!ms) return l;
    let next = { ...l };
    for (const m of ms) {
      if (m.kind === "notes") next = { ...next, notes: m.notes };
      if (
        m.kind === "knock" &&
        m.status &&
        !next.dispositionHistory?.some((h) => h.field?.eventId === m.id)
      ) {
        next = {
          ...next,
          status: m.status,
          dispositionedAt: new Date(m.createdAt),
          dispositionHistory: [
            {
              disposition: m.disposition || m.status,
              timestamp: new Date(m.createdAt),
              userId: m.userId,
              userName: "Pending sync",
              field: m.observation,
            },
            ...(next.dispositionHistory || []),
          ],
          ...(m.goBackScheduledDate
            ? {
                goBackScheduledDate: new Date(m.goBackScheduledDate),
                goBackScheduledTime: m.goBackScheduledTime,
                goBackNotes: m.goBackNotes,
                goBackScheduledBy: m.userId,
              }
            : {}),
        };
      }
    }
    return next;
  });
}
