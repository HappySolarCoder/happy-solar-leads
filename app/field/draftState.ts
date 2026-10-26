import { FIELD_DISPO_UNAVAILABLE, SYNC_REASON } from "./syncReasons";
import type { ParkedReason, PendingMutation, SyncState } from "./types";

export function effectiveSyncState(m: PendingMutation): SyncState {
  if (m.syncState) return m.syncState;
  if (m.direct?.gps) return "gps";
  if (m.blocked) return "parked";
  return "queued";
}

/** Scheduling waits on work that can still reach the server. Parked denials do not. */
export function draftBlocksScheduling(m: PendingMutation): boolean {
  const state = effectiveSyncState(m);
  if (state === "parked") return false;
  if (m.direct?.gps) return true;
  return state === "queued" || state === "retry" || state === "gps";
}

export function schedulingHold(
  drafts: PendingMutation[],
  leadId: string,
): string | null {
  return drafts.some((m) => m.leadId === leadId && draftBlocksScheduling(m))
    ? "Wait a moment and try again. This lead is still syncing."
    : null;
}

const BACKOFF_BASE_MS = 30_000;
const BACKOFF_CAP_MS = 15 * 60_000;

/** 30s, doubling, capped at 15 minutes, with jitter. */
export function backoffDelay(
  attempts: number,
  random: () => number = Math.random,
): number {
  const step = Math.max(1, attempts);
  const base = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** (step - 1));
  const jitter = 0.8 + random() * 0.4;
  return Math.round(base * jitter);
}

export type FailureKind = "transient" | "conflict" | "denial" | "gps-pending" | "slow";

export function classifySyncFailure(
  error: Error & { status?: number; code?: string },
): { kind: FailureKind; parkedReason?: ParkedReason } {
  const status = error.status || 0;
  const code = String(error.code || "");
  const message = error.message || "";
  if (/GPS verification is still pending/i.test(message))
    return { kind: "gps-pending" };
  if (code === FIELD_DISPO_UNAVAILABLE)
    return { kind: "slow" };
  if (status === 401 || status === 408 || status === 429 || status >= 500)
    return { kind: "transient" };
  const reason = knownReason(code) || knownReason(String((error as { reasonCode?: string }).reasonCode || ""));
  if (reason === SYNC_REASON.notesConflict || /Notes changed on another device/i.test(message))
    return { kind: "transient" };
  // A notes transaction that cannot finish stays queued. Never park or drop it.
  if (
    code === "unavailable"
    || code === "deadline-exceeded"
    || code === "aborted"
    || code === "failed-precondition"
    || code === "network-request-failed"
    || code === "offline"
    || /offline|network|failed to fetch/i.test(message)
  ) return { kind: "transient" };
  // Park. A 15-minute retry cannot shrink the body, and it must not hold the lead.
  if (reason === SYNC_REASON.notesTooLong)
    return { kind: "denial", parkedReason: SYNC_REASON.notesTooLong };
  if (status === 413 || reason === SYNC_REASON.payloadTooLarge)
    return { kind: "slow", parkedReason: SYNC_REASON.payloadTooLarge };
  if (reason) return { kind: "denial", parkedReason: reason };
  if (/Legacy handoff|Invalid knock time|Use the claim\/unclaim|Draft id is not/i.test(message))
    return { kind: "denial", parkedReason: SYNC_REASON.invalidPayload };
  if (code === "permission-denied" || /permission-denied/i.test(message))
    return { kind: "denial", parkedReason: SYNC_REASON.permissionDenied };
  if (status === 410 || status === 404 || /lead is missing/i.test(message))
    return { kind: "denial", parkedReason: SYNC_REASON.notFound };
  if (status === 403 && /historical/i.test(message))
    return { kind: "denial", parkedReason: SYNC_REASON.historicalPin };
  if (/different account|owned by another/i.test(message))
    return { kind: "denial", parkedReason: SYNC_REASON.ownedByOther };
  if (status === 403) return { kind: "denial", parkedReason: SYNC_REASON.other };
  if (status === 400 || status === 409)
    return { kind: "denial", parkedReason: SYNC_REASON.invalidPayload };
  return { kind: "transient" };
}

function knownReason(value: string): ParkedReason | undefined {
  return (Object.values(SYNC_REASON) as string[]).includes(value) ? (value as ParkedReason) : undefined;
}
