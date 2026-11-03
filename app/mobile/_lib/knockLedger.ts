import type { Lead } from "@/app/types";
import { DEFAULT_DISPOSITIONS, type Disposition } from "@/app/types/disposition";
import {
  knockEvents,
  type KnockEvent,
} from "@/app/utils/knockCount";

export const KNOCK_LEDGER_RETENTION_MS = 45 * 24 * 60 * 60 * 1000;
export const KNOCK_LEDGER_MAX_ROWS = 20_000;
export const KNOCK_LEDGER_EVENT = "raydar-knock-ledger";
const LAST_ACCOUNT_KEY = "raydar-knock-ledger-uid";

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
/** Survives an in-memory restart in tests. The browser copy is localStorage. */
let persistedUid: string | null = null;
let dispositions: readonly Disposition[] = DEFAULT_DISPOSITIONS;

function readPersistedUid(): string | null {
  if (persistedUid) return persistedUid;
  try {
    if (typeof localStorage !== "undefined") {
      const saved = localStorage.getItem(LAST_ACCOUNT_KEY);
      if (saved) return saved;
    }
  } catch {
    /* Private mode still keeps the in-memory copy for this process. */
  }
  return null;
}

function writePersistedUid(uid: string | null): void {
  persistedUid = uid;
  try {
    if (typeof localStorage === "undefined") return;
    if (uid) localStorage.setItem(LAST_ACCOUNT_KEY, uid);
    else localStorage.removeItem(LAST_ACCOUNT_KEY);
  } catch {
    /* The module copy still tracks the account until the process ends. */
  }
}

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
  writePersistedUid(null);
  dispositions = DEFAULT_DISPOSITIONS;
  connections.clear();
}

/** Drop the process memory, the way an app restart does. The saved uid stays. */
export function restartKnockLedgerSessionForTests(): void {
  activeAccount = null;
  persistedUid = null;
}

function freshRows(rows: LedgerRow[], now: number): { keep: LedgerRow[]; drop: string[] } {
  const cutoff = now - KNOCK_LEDGER_RETENTION_MS;
  const expired: string[] = [];
  const fresh: LedgerRow[] = [];
  for (const row of rows) {
    if (row.at >= cutoff) fresh.push(row);
    else expired.push(row.key);
  }
  fresh.sort((a, b) => a.at - b.at || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const overflow = Math.max(0, fresh.length - KNOCK_LEDGER_MAX_ROWS);
  return {
    keep: fresh.slice(overflow),
    drop: expired.concat(fresh.slice(0, overflow).map((row) => row.key)),
  };
}

async function trimLedger(uid: string, now: number): Promise<LedgerRow[]> {
  const rows = await store().read(uid);
  const trimmed = freshRows(rows, now);
  if (trimmed.drop.length) {
    try {
      await store().remove(uid, trimmed.drop);
    } catch {
      /* Counting uses the trimmed list even if the delete does not land. */
    }
  }
  return trimmed.keep;
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

/** Append this rep's counted knocks. Excluded dispositions are not stored. */
export async function rememberAcknowledgedKnocks(
  uid: string,
  lead: Lead,
  now = Date.now(),
): Promise<void> {
  if (!uid || !lead?.id) return;
  const rows = rowsFor(uid, lead, now);
  if (!rows.length) return;
  await store().put(uid, rows);
  try {
    await trimLedger(uid, now);
  } catch {
    /* The next read trims retention and the row cap. */
  }
  notify(uid);
}

export async function readKnockLedger(
  uid: string,
  list: readonly Disposition[] = dispositions,
  now = Date.now(),
): Promise<KnockEvent[]> {
  if (!uid) return [];
  let rows: LedgerRow[] = [];
  try {
    rows = await trimLedger(uid, now);
  } catch {
    return [];
  }
  const events: KnockEvent[] = [];
  for (const row of rows) {
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
 * The last uid is stored on the device. After a restart, signing in as
 * someone else still deletes the previous account's database.
 */
export async function syncKnockLedgerAccount(nextUid: string | null): Promise<void> {
  if (!nextUid) return;
  const previous = readPersistedUid() || activeAccount;
  activeAccount = nextUid;
  if (previous && previous !== nextUid) {
    try {
      await store().wipe(previous);
    } catch {
      /* Leave the saved uid so the next sign-in tries the wipe again. */
      return;
    }
  }
  writePersistedUid(nextUid);
}
