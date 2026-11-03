import type { Lead } from "@/app/types";
import { DEFAULT_DISPOSITIONS, type Disposition } from "@/app/types/disposition";
import {
  knockEvents,
  type KnockEvent,
} from "@/app/utils/knockCount";

export const KNOCK_LEDGER_RETENTION_MS = 45 * 24 * 60 * 60 * 1000;
export const KNOCK_LEDGER_EVENT = "raydar-knock-ledger";

type LedgerRow = {
  key: string;
  leadId: string;
  userId: string;
  at: number;
  dispositionId: string;
  eventId?: string;
};

type LedgerStore = {
  read(uid: string): Promise<LedgerRow[]>;
  put(uid: string, rows: LedgerRow[]): Promise<void>;
  remove(uid: string, keys: string[]): Promise<void>;
  wipe(uid: string): Promise<void>;
};

const memory = new Map<string, Map<string, LedgerRow>>();
let activeAccount: string | null = null;
let dispositions: readonly Disposition[] = DEFAULT_DISPOSITIONS;

export function knockLedgerDatabaseName(uid: string): string {
  return `raydar-knock-ledger:${uid}`;
}

function table(uid: string): Map<string, LedgerRow> {
  let rows = memory.get(uid);
  if (!rows) {
    rows = new Map();
    memory.set(uid, rows);
  }
  return rows;
}

const memoryStore: LedgerStore = {
  async read(uid) {
    return [...table(uid).values()];
  },
  async put(uid, rows) {
    const saved = table(uid);
    for (const row of rows) saved.set(row.key, row);
  },
  async remove(uid, keys) {
    const saved = table(uid);
    for (const key of keys) saved.delete(key);
  },
  async wipe(uid) {
    memory.delete(uid);
  },
};

const connections = new Map<string, Promise<IDBDatabase>>();

function openLedger(uid: string): Promise<IDBDatabase> {
  const existing = connections.get(uid);
  if (existing) return existing;
  const name = knockLedgerDatabaseName(uid);
  const opened = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("events")) {
        db.createObjectStore("events", { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      connections.delete(uid);
      reject(request.error ?? Error("Knock ledger unavailable."));
    };
  });
  connections.set(uid, opened);
  return opened;
}

function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? Error("Knock ledger unavailable."));
  });
}

const idbStore: LedgerStore = {
  async read(uid) {
    const db = await openLedger(uid);
    const rows = await idbRequest(db.transaction("events", "readonly").objectStore("events").getAll());
    return Array.isArray(rows) ? (rows as LedgerRow[]) : [];
  },
  async put(uid, rows) {
    if (!rows.length) return;
    const db = await openLedger(uid);
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("events", "readwrite");
      const store = tx.objectStore("events");
      for (const row of rows) store.put(row);
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(tx.error ?? Error("Knock ledger unavailable."));
    });
  },
  async remove(uid, keys) {
    if (!keys.length) return;
    const db = await openLedger(uid);
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("events", "readwrite");
      const store = tx.objectStore("events");
      for (const key of keys) store.delete(key);
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(tx.error ?? Error("Knock ledger unavailable."));
    });
  },
  async wipe(uid) {
    const pending = connections.get(uid);
    connections.delete(uid);
    if (pending) {
      try {
        (await pending).close();
      } catch {
        /* Closing a failed connection still allows deleteDatabase. */
      }
    }
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(knockLedgerDatabaseName(uid));
      request.onsuccess = () => resolve();
      request.onblocked = () => resolve();
      request.onerror = () => reject(request.error ?? Error("Knock ledger unavailable."));
    });
  },
};

function store(): LedgerStore {
  if (typeof indexedDB === "undefined") return memoryStore;
  return idbStore;
}

export function setKnockLedgerDispositions(next: readonly Disposition[]): void {
  dispositions = next.length ? next : DEFAULT_DISPOSITIONS;
}

export function resetKnockLedgerForTests(): void {
  memory.clear();
  activeAccount = null;
  dispositions = DEFAULT_DISPOSITIONS;
  connections.clear();
}

function rowsFor(uid: string, lead: Lead, now: number): LedgerRow[] {
  const cutoff = now - KNOCK_LEDGER_RETENTION_MS;
  return knockEvents(lead, dispositions)
    .filter((event) => event.userId === uid && event.at >= cutoff)
    .map((event) => ({
      key: event.key,
      leadId: event.leadId,
      userId: event.userId,
      at: event.at,
      dispositionId: event.dispositionId,
      ...(event.key.includes("|") ? {} : { eventId: event.key }),
    }));
}

function notify(uid: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(KNOCK_LEDGER_EVENT, { detail: { uid } }));
}

/** Append this rep's counted knocks. Excluded dispositions are not stored, and nothing is removed. */
export async function rememberAcknowledgedKnocks(
  uid: string,
  lead: Lead,
  now = Date.now(),
): Promise<void> {
  if (!uid || !lead?.id) return;
  const rows = rowsFor(uid, lead, now);
  if (!rows.length) return;
  await store().put(uid, rows);
  notify(uid);
}

export async function readKnockLedger(
  uid: string,
  list: readonly Disposition[] = dispositions,
  now = Date.now(),
): Promise<KnockEvent[]> {
  if (!uid) return [];
  const cutoff = now - KNOCK_LEDGER_RETENTION_MS;
  let rows: LedgerRow[] = [];
  try {
    rows = await store().read(uid);
  } catch {
    return [];
  }
  const expired = rows.filter((row) => !(row.at >= cutoff)).map((row) => row.key);
  if (expired.length) {
    try {
      await store().remove(uid, expired);
    } catch {
      /* A failed prune keeps the row until the next read. Counting still ignores it. */
    }
  }
  const events: KnockEvent[] = [];
  for (const row of rows) {
    if (!(row.at >= cutoff)) continue;
    const [event] = knockEvents(
      {
        id: row.leadId,
        dispositionHistory: [
          {
            disposition: row.dispositionId,
            timestamp: new Date(row.at),
            userId: row.userId,
            userName: "",
            ...(row.eventId ? { field: { eventId: row.eventId } } : {}),
          },
        ],
      } as Lead,
      list,
    );
    if (event) events.push(event);
  }
  return events;
}

/**
 * Sign-out keeps the store so the same account still has its knocks.
 * Switching to a different account deletes the previous account's database.
 * A reload starts with no in-memory account, so it does not delete anything.
 */
export async function syncKnockLedgerAccount(nextUid: string | null): Promise<void> {
  if (!nextUid) return;
  const previous = activeAccount;
  activeAccount = nextUid;
  if (!previous || previous === nextUid) return;
  try {
    await store().wipe(previous);
  } catch {
    /* The next account still reads only its own database. */
  }
}
