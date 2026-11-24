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
export const EMPOWER_RATE_MESSAGE =
  "Too many Empower bumps just now. This one stays queued and will send later.";
/** 404/503, and a 429 without Retry-After, wait at least this long before another POST. */
export const EMPOWER_MIN_RETRY_MS = 60_000;

const LEGACY_STORAGE_KEY = "raydar.empowerBump.queue.v1";
const MAX_DRAFTS = 40;
export const EMPOWER_REQUEST_TIMEOUT_MS = 20_000;
export const EMPOWER_TOKEN_TIMEOUT_MS = 8_000;
const DEFAULT_TIMEOUT_MS = EMPOWER_REQUEST_TIMEOUT_MS;
const MAX_RETRY_AFTER_SEC = 86_400;

type Attempted = { attempted: boolean };

export type EmpowerOutcome =
  | ({ status: "sent" } & Attempted)
  | ({ status: "queued"; message: string } & Attempted)
  | ({ status: "signin"; message: string } & Attempted)
  | ({ status: "invalid"; message: string; conflict?: boolean } & Attempted)
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
  /** Clock for Retry-After and the 404/503 backoff. */
  now?: () => number;
  /** Bound for getToken. The office POST timeout is separate. */
  tokenTimeoutMs?: number;
}

type DraftState = "queued" | "sent" | "ambiguous" | "rejected";

interface StoredDraft {
  draftId: string;
  state: DraftState;
  payload: EmpowerBumpPayload;
  message?: string;
  /** Do not POST this queued draft again until this time. */
  nextAttemptAt?: number;
  /** Set only when this row can be moved off the old unscoped key. */
  uid?: string;
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
  if (outcome.status === "queued" || outcome.status === "ambiguous" || (outcome.status === "invalid" && outcome.conflict)) {
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

function clock(deps: EmpowerSendDeps): number {
  return deps.now?.() ?? Date.now();
}

/** Move legacy rows onto this rep only when the stored record names them. The old key stays. */
function migrateAttributedLegacy(
  storage: Pick<Storage, "getItem" | "setItem"> | undefined,
  uid: string,
): void {
  if (!storage || !uid) return;
  const raw = storage.getItem(LEGACY_STORAGE_KEY);
  if (!raw) return;
  let parsed: { uid?: unknown; drafts?: unknown };
  try {
    parsed = JSON.parse(raw) as { uid?: unknown; drafts?: unknown };
  } catch {
    return;
  }
  if (!Array.isArray(parsed.drafts)) return;
  const envelopeUid = typeof parsed.uid === "string" ? parsed.uid : undefined;
  const mine: StoredDraft[] = [];
  const rest: unknown[] = [];
  for (const row of parsed.drafts) {
    if (!row || typeof row !== "object") {
      rest.push(row);
      continue;
    }
    const record = row as StoredDraft;
    const owner = typeof record.uid === "string" ? record.uid : envelopeUid;
    if (owner === uid && typeof record.draftId === "string" && record.payload && record.state) mine.push(record);
    else rest.push(row);
  }
  if (!mine.length) return;
  const current = readDrafts(storage, uid);
  const ids = new Set(current.map((row) => row.draftId));
  for (const row of mine) {
    if (!ids.has(row.draftId)) current.push(row);
  }
  writeDrafts(storage, uid, current);
  storage.setItem(LEGACY_STORAGE_KEY, JSON.stringify({ ...parsed, drafts: rest }));
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

function retryAfterMs(response: Response): number {
  const raw = response.headers.get("retry-after");
  if (raw != null && /^\d+$/.test(raw.trim())) {
    const seconds = Number(raw.trim());
    if (seconds >= 1 && seconds <= MAX_RETRY_AFTER_SEC) return seconds * 1000;
  }
  return EMPOWER_MIN_RETRY_MS;
}

async function outcomeForStatus(
  response: Response,
  refreshed: boolean,
  now: number,
): Promise<{ outcome: EmpowerOutcome; nextAttemptAt?: number }> {
  const status = response.status;
  if (status >= 200 && status < 300) return { outcome: { status: "sent", attempted: true } };
  if (status === 401) return { outcome: signin(true) };
  if (status === 403 && refreshed) return { outcome: signin(true) };
  if (status === 404 || status === 503) {
    return { outcome: routeQueued(), nextAttemptAt: now + EMPOWER_MIN_RETRY_MS };
  }
  if (status === 429) {
    return {
      outcome: { status: "queued", message: EMPOWER_RATE_MESSAGE, attempted: true },
      nextAttemptAt: now + retryAfterMs(response),
    };
  }
  if (status >= 500) return { outcome: ambiguous() };
  const invalid: EmpowerOutcome = {
    status: "invalid",
    message: safeServerError(status, await readJson(response)),
    attempted: true,
    ...(status === 409 ? { conflict: true } : {}),
  };
  return { outcome: invalid };
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
          "Idempotency-Key": payload.draftId,
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

async function classify(
  delivery: Delivery,
  refreshed: boolean,
  online: boolean,
  now: number,
): Promise<{ outcome: EmpowerOutcome; nextAttemptAt?: number }> {
  if (delivery.kind === "timeout") return { outcome: ambiguous() };
  if (delivery.kind === "error") {
    if (!online || requestNeverLeft(delivery.error)) return { outcome: offlineQueued() };
    return { outcome: ambiguous() };
  }
  return outcomeForStatus(delivery.response, refreshed, now);
}

function remember(
  storage: Pick<Storage, "getItem" | "setItem"> | undefined,
  uid: string,
  payload: EmpowerBumpPayload,
  outcome: EmpowerOutcome,
  nextAttemptAt?: number,
): void {
  if (outcome.status === "sent") {
    upsert(storage, uid, { draftId: payload.draftId, state: "sent", payload, uid });
    return;
  }
  if (outcome.status === "ambiguous") {
    upsert(storage, uid, { draftId: payload.draftId, state: "ambiguous", payload, message: outcome.message, uid });
    return;
  }
  if (outcome.status === "invalid") {
    upsert(storage, uid, { draftId: payload.draftId, state: "rejected", payload, message: outcome.message, uid });
    return;
  }
  upsert(storage, uid, {
    draftId: payload.draftId,
    state: "queued",
    payload,
    uid,
    message: outcome.status === "queued" ? outcome.message : undefined,
    ...(nextAttemptAt != null ? { nextAttemptAt } : {}),
  });
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

async function readToken(
  getToken: (forceRefresh: boolean) => Promise<string>,
  forceRefresh: boolean,
  timeoutMs: number,
): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const token = await Promise.race([
      getToken(forceRefresh),
      new Promise<string>((_, reject) => {
        timer = setTimeout(() => reject(new Error("token-timeout")), timeoutMs);
      }),
    ]);
    return token;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function sendEmpowerBump(
  payload: EmpowerBumpPayload,
  deps: EmpowerSendDeps,
): Promise<EmpowerOutcome> {
  const storage = deps.storage ?? browserStorage();
  migrateAttributedLegacy(storage, deps.uid);
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
  const tokenTimeoutMs = deps.tokenTimeoutMs ?? EMPOWER_TOKEN_TIMEOUT_MS;

  let token: string;
  try {
    token = await readToken(deps.getToken, false, tokenTimeoutMs);
  } catch {
    return signin(false);
  }
  if (!token) return signin(false);

  const now = clock(deps);
  const first = await deliver(post, payload, token, timeoutMs, online);
  let classified: { outcome: EmpowerOutcome; nextAttemptAt?: number };
  if (first.kind === "response" && first.response.status === 401) {
    let refreshed: string;
    try {
      refreshed = await readToken(deps.getToken, true, tokenTimeoutMs);
    } catch {
      const outcome = signin(true);
      remember(storage, deps.uid, payload, outcome);
      return outcome;
    }
    if (!refreshed) {
      const outcome = signin(true);
      remember(storage, deps.uid, payload, outcome);
      return outcome;
    }
    const second = await deliver(post, payload, refreshed, timeoutMs, deviceOnline(deps));
    classified = await classify(second, true, deviceOnline(deps), clock(deps));
  } else {
    classified = await classify(first, false, online, now);
  }
  remember(storage, deps.uid, payload, classified.outcome, classified.nextAttemptAt);
  return classified.outcome;
}

/**
 * Re-sends only queued drafts, once each. Ambiguous, rejected, and sent drafts are left alone.
 * The draft id does not change, so the server can dedupe. Overlapping triggers share one in-flight lock.
 */
export async function flushQueuedEmpowerBumps(deps: EmpowerSendDeps): Promise<number> {
  if (!deps.uid || !deviceOnline(deps)) return 0;
  const storage = deps.storage ?? browserStorage();
  migrateAttributedLegacy(storage, deps.uid);
  const now = clock(deps);
  const rows = readDrafts(storage, deps.uid).filter((row) => (
    row.state === "queued" && (row.nextAttemptAt == null || row.nextAttemptAt <= now)
  ));
  let attempted = 0;
  for (const row of rows) {
    await deliverEmpowerBump(row.payload, deps);
    attempted += 1;
  }
  return attempted;
}

/**
 * Cold start can wake before Firebase restores currentUser. Flush again when a
 * uid is actually available, from onAuthStateChanged or authStateReady.
 */
export function subscribeEmpowerAuthFlush(deps: {
  subscribe: (listener: (uid: string | null) => void) => () => void;
  whenReady?: () => Promise<void>;
  onSignedIn: () => void;
}): () => void {
  let stopped = false;
  const stop = deps.subscribe((uid) => {
    if (!stopped && uid) deps.onSignedIn();
  });
  void deps.whenReady?.().then(() => {
    if (!stopped) deps.onSignedIn();
  }).catch(() => {});
  return () => {
    stopped = true;
    stop();
  };
}
