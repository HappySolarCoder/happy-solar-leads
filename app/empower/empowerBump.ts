import { apiFetch } from "@/app/utils/apiFetch";
import { isDeviceOnline } from "@/app/utils/connectivity";
import type { EmpowerBumpPayload } from "./bumpLogic";

/** Boris's route. This client does not implement it. */
export const EMPOWER_BUMP_PATH = "/api/empower-bump";
export const EMPOWER_API_ORIGIN = "https://happy-solar-leads.vercel.app";

export const EMPOWER_AMBIGUOUS_MESSAGE =
  "Couldn't confirm the Empower bump was sent. Don't send it again until you check.";
export const EMPOWER_QUEUED_MESSAGE =
  "Empower bump isn't available yet. Nothing was sent. This bump stays queued on the phone.";
export const EMPOWER_OFFLINE_MESSAGE =
  "Empower bump is saved on this phone. Nothing was sent yet. It will send when you're online.";
export const EMPOWER_SIGN_IN_MESSAGE = "Sign in again, then send.";
export const EMPOWER_PENDING_LABEL = "Empower bump pending";
export const EMPOWER_BUMP_CHANGE = "raydar-empower-bump";

const LEGACY_STORAGE_KEY = "raydar.empowerBump.queue.v1";
const MAX_DRAFTS = 40;
const DEFAULT_TIMEOUT_MS = 20_000;

type Attempted = { attempted: boolean };

export type EmpowerOutcome =
  | ({ status: "sent" } & Attempted)
  | ({ status: "queued"; message: string } & Attempted)
  | ({ status: "signin"; message: string } & Attempted)
  | ({ status: "invalid"; message: string } & Attempted)
  | ({ status: "ambiguous"; message: string } & Attempted);

export interface EmpowerSendDeps {
  /** Signed-in rep. Drafts are stored only under this id. */
  uid: string;
  getToken: (forceRefresh: boolean) => Promise<string>;
  post?: (path: string, init: RequestInit) => Promise<Response>;
  timeoutMs?: number;
  storage?: Pick<Storage, "getItem" | "setItem">;
  /** False means the request cannot leave the phone. */
  online?: () => boolean;
}

type DraftState = "queued" | "sent" | "ambiguous" | "rejected";

interface StoredDraft {
  draftId: string;
  state: DraftState;
  payload: EmpowerBumpPayload;
  message?: string;
}

type Delivery =
  | { kind: "timeout" }
  | { kind: "error"; error: unknown }
  | { kind: "response"; response: Response };

const inflight = new Set<string>();

/**
 * True when the office call was actually attempted.
 * A save that never left the phone does not open scheduling yet.
 */
export function schedulingFollowsBump(outcome: EmpowerOutcome): boolean {
  return outcome.attempted === true;
}

export function empowerNotice(outcome: EmpowerOutcome): string {
  if (outcome.status === "sent") return "Empower bump sent. The door was saved.";
  if (outcome.status === "queued" || outcome.status === "ambiguous") {
    return `${outcome.message} The door was saved.`;
  }
  return outcome.message;
}

/**
 * Save the local knock first. Then make one office call. Then open scheduling.
 * Opening scheduling cannot roll the knock back, and an ambiguous call is not sent again.
 */
export async function finishEmpowerBump(input: {
  saveLocal: () => Promise<void>;
  send: () => Promise<EmpowerOutcome>;
  openScheduling: () => void;
}): Promise<EmpowerOutcome> {
  await input.saveLocal();
  let outcome: EmpowerOutcome;
  try {
    outcome = await input.send();
  } catch (error) {
    outcome = requestNeverLeft(error)
      ? offlineQueued()
      : { status: "ambiguous", message: EMPOWER_AMBIGUOUS_MESSAGE, attempted: true };
  }
  if (schedulingFollowsBump(outcome)) {
    try {
      input.openScheduling();
    } catch {
      // The scheduling screen must not undo a bump that already saved.
    }
  }
  return outcome;
}

export function memoryEmpowerStorage(): Pick<Storage, "getItem" | "setItem"> {
  const rows = new Map<string, string>();
  return {
    getItem: (key) => rows.get(key) ?? null,
    setItem: (key, value) => {
      rows.set(key, value);
    },
  };
}

export function resetEmpowerFlushForTests(): void {
  inflight.clear();
}

function browserStorage(): Pick<Storage, "getItem" | "setItem"> | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function storageKey(uid: string): string {
  return `${LEGACY_STORAGE_KEY}.${uid}`;
}

function readDrafts(storage: Pick<Storage, "getItem" | "setItem"> | undefined, uid: string): StoredDraft[] {
  if (!storage || !uid) return [];
  try {
    const raw = storage.getItem(storageKey(uid));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { drafts?: StoredDraft[] };
    if (!parsed || !Array.isArray(parsed.drafts)) return [];
    return parsed.drafts.filter((row) => row && typeof row.draftId === "string" && row.payload && row.state);
  } catch {
    return [];
  }
}

function notify(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(EMPOWER_BUMP_CHANGE));
}

function writeDrafts(
  storage: Pick<Storage, "getItem" | "setItem"> | undefined,
  uid: string,
  drafts: StoredDraft[],
): void {
  if (!storage || !uid) return;
  const queued = drafts.filter((row) => row.state !== "sent");
  const sent = drafts.filter((row) => row.state === "sent");
  const room = MAX_DRAFTS - queued.length;
  const kept = room >= 0 ? [...queued, ...sent.slice(-room)] : queued.slice(-MAX_DRAFTS);
  try {
    storage.setItem(storageKey(uid), JSON.stringify({ v: 1, drafts: kept }));
    notify();
  } catch {
    // The door save stands even when the phone cannot store the office draft.
  }
}

function upsert(
  storage: Pick<Storage, "getItem" | "setItem"> | undefined,
  uid: string,
  next: StoredDraft,
): void {
  const drafts = readDrafts(storage, uid).filter((row) => row.draftId !== next.draftId);
  drafts.push(next);
  writeDrafts(storage, uid, drafts);
}

export function storedEmpowerState(
  draftId: string,
  storage: Pick<Storage, "getItem" | "setItem"> | undefined,
  uid: string,
): DraftState | null {
  return readDrafts(storage, uid).find((row) => row.draftId === draftId)?.state ?? null;
}

/** Queued office calls for this rep and door. Ambiguous drafts are not pending. */
export function empowerBumpPending(
  uid: string | undefined,
  leadId: string,
  storage?: Pick<Storage, "getItem" | "setItem">,
): boolean {
  if (!uid || !leadId) return false;
  return readDrafts(storage ?? browserStorage(), uid).some((row) => row.state === "queued" && row.payload.leadId === leadId);
}

function signin(attempted: boolean): EmpowerOutcome {
  return { status: "signin", message: EMPOWER_SIGN_IN_MESSAGE, attempted };
}

function ambiguous(): EmpowerOutcome {
  return { status: "ambiguous", message: EMPOWER_AMBIGUOUS_MESSAGE, attempted: true };
}

function offlineQueued(): EmpowerOutcome {
  return { status: "queued", message: EMPOWER_OFFLINE_MESSAGE, attempted: false };
}

function routeQueued(): EmpowerOutcome {
  return { status: "queued", message: EMPOWER_QUEUED_MESSAGE, attempted: true };
}

function deviceOnline(deps: EmpowerSendDeps): boolean {
  if (deps.online) return deps.online() !== false;
  // A missing onLine flag is not airplane mode. Only an explicit false stays on the phone.
  return isDeviceOnline() !== false;
}

export function requestNeverLeft(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  return (error as { empowerPhase?: string }).empowerPhase === "before-send";
}

function safeServerError(status: number, body: unknown): string {
  const error = body && typeof body === "object" && "error" in body
    ? (body as { error?: unknown }).error
    : undefined;
  if (
    typeof error === "string"
    && error.length > 0
    && error.length <= 200
    && !/http/i.test(error)
    && !/webhook/i.test(error)
    && !/token/i.test(error)
  ) {
    return error;
  }
  return `Empower bump was rejected (${status}).`;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function outcomeForStatus(response: Response, refreshed: boolean): Promise<EmpowerOutcome> {
  const status = response.status;
  if (status >= 200 && status < 300) return { status: "sent", attempted: true };
  if (status === 401) return signin(true);
  if (status === 403 && refreshed) return signin(true);
  if (status === 404 || status === 503) return routeQueued();
  if (status >= 500) return ambiguous();
  return { status: "invalid", message: safeServerError(status, await readJson(response)), attempted: true };
}

/** One POST. A timeout is not followed by another POST. */
async function deliver(
  post: (path: string, init: RequestInit) => Promise<Response>,
  payload: EmpowerBumpPayload,
  token: string,
  timeoutMs: number,
  online: boolean,
): Promise<Delivery> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<Delivery>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({ kind: "timeout" });
    }, timeoutMs);
  });
  const attempt = Promise.resolve()
    .then(() => {
      if (!online) {
        throw Object.assign(new Error("offline"), { empowerPhase: "before-send" });
      }
      return post(EMPOWER_BUMP_PATH, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    })
    .then((response) => ({ kind: "response", response }) as Delivery)
    .catch((error: unknown) => ({ kind: "error", error }) as Delivery);
  const winner = await Promise.race([attempt, timeout]);
  if (timer) clearTimeout(timer);
  return winner;
}

async function classify(delivery: Delivery, refreshed: boolean, online: boolean): Promise<EmpowerOutcome> {
  if (delivery.kind === "timeout") return ambiguous();
  if (delivery.kind === "error") {
    if (!online || requestNeverLeft(delivery.error)) return offlineQueued();
    return ambiguous();
  }
  return outcomeForStatus(delivery.response, refreshed);
}

function remember(
  storage: Pick<Storage, "getItem" | "setItem"> | undefined,
  uid: string,
  payload: EmpowerBumpPayload,
  outcome: EmpowerOutcome,
): void {
  if (outcome.status === "sent") {
    upsert(storage, uid, { draftId: payload.draftId, state: "sent", payload });
    return;
  }
  if (outcome.status === "ambiguous") {
    upsert(storage, uid, { draftId: payload.draftId, state: "ambiguous", payload, message: outcome.message });
    return;
  }
  if (outcome.status === "invalid") {
    upsert(storage, uid, { draftId: payload.draftId, state: "rejected", payload, message: outcome.message });
    return;
  }
  upsert(storage, uid, { draftId: payload.draftId, state: "queued", payload, message: outcome.status === "queued" ? outcome.message : undefined });
}

/**
 * Idempotent by draft id. The only automatic retry inside one call is one token refresh after 401.
 * 404 and 503, and a request that never left the phone, stay queued.
 * Timeout, a drop after send, and a 5xx other than 503 are ambiguous and are never retried.
 * 400 and 409 are terminal: shown once, not queued.
 */
export async function deliverEmpowerBump(
  payload: EmpowerBumpPayload,
  deps: EmpowerSendDeps,
): Promise<EmpowerOutcome> {
  if (!deps.uid) return signin(false);
  const lock = `${deps.uid}:${payload.draftId}`;
  if (inflight.has(lock)) return { status: "queued", message: EMPOWER_QUEUED_MESSAGE, attempted: false };
  inflight.add(lock);
  try {
    return await sendEmpowerBump(payload, deps);
  } finally {
    inflight.delete(lock);
  }
}

async function sendEmpowerBump(
  payload: EmpowerBumpPayload,
  deps: EmpowerSendDeps,
): Promise<EmpowerOutcome> {
  const storage = deps.storage ?? browserStorage();
  const existing = readDrafts(storage, deps.uid).find((row) => row.draftId === payload.draftId);
  if (existing?.state === "sent") return { status: "sent", attempted: false };
  if (existing?.state === "ambiguous") return { status: "ambiguous", message: existing.message || EMPOWER_AMBIGUOUS_MESSAGE, attempted: false };
  if (existing?.state === "rejected") {
    return { status: "invalid", message: existing.message || "Empower bump was rejected.", attempted: false };
  }

  upsert(storage, deps.uid, { draftId: payload.draftId, state: "queued", payload });
  const online = deviceOnline(deps);
  if (!online) return offlineQueued();

  const post = deps.post ?? apiFetch;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let token: string;
  try {
    token = await deps.getToken(false);
  } catch {
    return signin(false);
  }
  if (!token) return signin(false);

  const first = await deliver(post, payload, token, timeoutMs, online);
  let outcome: EmpowerOutcome;
  if (first.kind === "response" && first.response.status === 401) {
    let refreshed: string;
    try {
      refreshed = await deps.getToken(true);
    } catch {
      outcome = signin(true);
      remember(storage, deps.uid, payload, outcome);
      return outcome;
    }
    if (!refreshed) {
      outcome = signin(true);
      remember(storage, deps.uid, payload, outcome);
      return outcome;
    }
    const second = await deliver(post, payload, refreshed, timeoutMs, deviceOnline(deps));
    outcome = await classify(second, true, deviceOnline(deps));
  } else {
    outcome = await classify(first, false, online);
  }
  remember(storage, deps.uid, payload, outcome);
  return outcome;
}

/**
 * Re-sends only queued drafts, once each. Ambiguous, rejected, and sent drafts are left alone.
 * The draft id does not change, so the server can dedupe. Overlapping triggers share one in-flight lock.
 */
export async function flushQueuedEmpowerBumps(deps: EmpowerSendDeps): Promise<number> {
  if (!deps.uid || !deviceOnline(deps)) return 0;
  const storage = deps.storage ?? browserStorage();
  const rows = readDrafts(storage, deps.uid).filter((row) => row.state === "queued");
  let attempted = 0;
  for (const row of rows) {
    await deliverEmpowerBump(row.payload, deps);
    attempted += 1;
  }
  return attempted;
}
