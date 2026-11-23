import { apiFetch } from "@/app/utils/apiFetch";
import type { EmpowerBumpPayload } from "./bumpLogic";

/** Boris's route. This client does not implement it. */
export const EMPOWER_BUMP_PATH = "/api/empower-bump";
export const EMPOWER_API_ORIGIN = "https://happy-solar-leads.vercel.app";

export const EMPOWER_AMBIGUOUS_MESSAGE =
  "Couldn't confirm the Empower bump was sent. Don't send it again until you check.";
export const EMPOWER_QUEUED_MESSAGE =
  "Empower bump isn't available yet. Nothing was sent. This bump stays queued on the phone.";
export const EMPOWER_SIGN_IN_MESSAGE = "Sign in again, then send.";

const STORAGE_KEY = "raydar.empowerBump.queue.v1";
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
  getToken: (forceRefresh: boolean) => Promise<string>;
  post?: (path: string, init: RequestInit) => Promise<Response>;
  timeoutMs?: number;
  storage?: Pick<Storage, "getItem" | "setItem">;
}

type DraftState = "queued" | "sent" | "ambiguous";

interface StoredDraft {
  draftId: string;
  state: DraftState;
  payload: EmpowerBumpPayload;
}

/**
 * True when the office call was actually attempted. A saved door with no request
 * (signed out before the POST) does not open scheduling yet.
 * Queued (404/503) and ambiguous (timeout, 500, 502, network) both follow through.
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
  } catch {
    outcome = { status: "ambiguous", message: EMPOWER_AMBIGUOUS_MESSAGE, attempted: true };
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
  let raw = "";
  return {
    getItem: () => raw,
    setItem: (_key, value) => {
      raw = value;
    },
  };
}

function browserStorage(): Pick<Storage, "getItem" | "setItem"> | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function readDrafts(storage: Pick<Storage, "getItem" | "setItem"> | undefined): StoredDraft[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { drafts?: StoredDraft[] };
    if (!parsed || !Array.isArray(parsed.drafts)) return [];
    return parsed.drafts.filter((row) => row && typeof row.draftId === "string" && row.payload && row.state);
  } catch {
    return [];
  }
}

function writeDrafts(storage: Pick<Storage, "getItem" | "setItem"> | undefined, drafts: StoredDraft[]): void {
  if (!storage) return;
  const queued = drafts.filter((row) => row.state !== "sent");
  const sent = drafts.filter((row) => row.state === "sent");
  const room = MAX_DRAFTS - queued.length;
  const kept = room >= 0 ? [...queued, ...sent.slice(-room)] : queued.slice(-MAX_DRAFTS);
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, drafts: kept }));
  } catch {
    // The door save stands even when the phone cannot store the office draft.
  }
}

function upsert(storage: Pick<Storage, "getItem" | "setItem"> | undefined, next: StoredDraft): void {
  const drafts = readDrafts(storage).filter((row) => row.draftId !== next.draftId);
  drafts.push(next);
  writeDrafts(storage, drafts);
}

export function storedEmpowerState(
  draftId: string,
  storage: Pick<Storage, "getItem" | "setItem"> | undefined,
): DraftState | null {
  return readDrafts(storage).find((row) => row.draftId === draftId)?.state ?? null;
}

function signin(attempted: boolean): EmpowerOutcome {
  return { status: "signin", message: EMPOWER_SIGN_IN_MESSAGE, attempted };
}

function ambiguous(): EmpowerOutcome {
  return { status: "ambiguous", message: EMPOWER_AMBIGUOUS_MESSAGE, attempted: true };
}

function queued(): EmpowerOutcome {
  return { status: "queued", message: EMPOWER_QUEUED_MESSAGE, attempted: true };
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

async function outcomeForStatus(response: Response): Promise<EmpowerOutcome> {
  const status = response.status;
  if (status >= 200 && status < 300) return { status: "sent", attempted: true };
  if (status === 401) return signin(true);
  if (status === 400) return { status: "invalid", message: safeServerError(status, await readJson(response)), attempted: true };
  if (status === 404 || status === 503) return queued();
  return ambiguous();
}

type Delivery =
  | { kind: "timeout" }
  | { kind: "error" }
  | { kind: "response"; response: Response };

/** One POST. A timeout is not followed by another POST. */
async function deliver(
  post: (path: string, init: RequestInit) => Promise<Response>,
  payload: EmpowerBumpPayload,
  token: string,
  timeoutMs: number,
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
    .then(() => post(EMPOWER_BUMP_PATH, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    }))
    .then((response) => ({ kind: "response", response }) as Delivery)
    .catch(() => ({ kind: "error" }) as Delivery);
  const winner = await Promise.race([attempt, timeout]);
  if (timer) clearTimeout(timer);
  return winner;
}

/**
 * Idempotent by draft id. The only automatic retry is one token refresh after 401.
 * 404 and 503 leave the draft queued. Timeout, 500, 502, and network errors are ambiguous
 * and are never retried, including by a later call with the same draft id.
 */
export async function deliverEmpowerBump(
  payload: EmpowerBumpPayload,
  deps: EmpowerSendDeps,
): Promise<EmpowerOutcome> {
  const storage = deps.storage ?? browserStorage();
  const existing = readDrafts(storage).find((row) => row.draftId === payload.draftId);
  if (existing?.state === "sent") return { status: "sent", attempted: false };
  if (existing?.state === "ambiguous") return ambiguousAttemptSkipped();

  upsert(storage, { draftId: payload.draftId, state: "queued", payload });
  const post = deps.post ?? apiFetch;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let token: string;
  try {
    token = await deps.getToken(false);
  } catch {
    return signin(false);
  }
  if (!token) return signin(false);

  const first = await deliver(post, payload, token, timeoutMs);
  let outcome: EmpowerOutcome;
  if (first.kind === "response" && first.response.status === 401) {
    let refreshed: string;
    try {
      refreshed = await deps.getToken(true);
    } catch {
      outcome = signin(true);
      remember(storage, payload, outcome);
      return outcome;
    }
    if (!refreshed) {
      outcome = signin(true);
      remember(storage, payload, outcome);
      return outcome;
    }
    outcome = await finish(await deliver(post, payload, refreshed, timeoutMs));
  } else {
    outcome = await finish(first);
  }
  remember(storage, payload, outcome);
  return outcome;
}

function ambiguousAttemptSkipped(): EmpowerOutcome {
  return { status: "ambiguous", message: EMPOWER_AMBIGUOUS_MESSAGE, attempted: false };
}

function remember(
  storage: Pick<Storage, "getItem" | "setItem"> | undefined,
  payload: EmpowerBumpPayload,
  outcome: EmpowerOutcome,
): void {
  if (outcome.status === "sent") {
    upsert(storage, { draftId: payload.draftId, state: "sent", payload });
    return;
  }
  if (outcome.status === "ambiguous") {
    upsert(storage, { draftId: payload.draftId, state: "ambiguous", payload });
    return;
  }
  upsert(storage, { draftId: payload.draftId, state: "queued", payload });
}

async function finish(delivery: Delivery): Promise<EmpowerOutcome> {
  if (delivery.kind !== "response") return ambiguous();
  return outcomeForStatus(delivery.response);
}
