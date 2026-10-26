import type { User } from "@/app/types";
import { coerceLegacyContactDraft } from "./contactSave";
import { reportingPatch } from "./directWrites";
import { NOTES_ACTION_AT_RETRY_MESSAGE, PHONE_CLOCK_NOTICE, SYNC_REASON } from "./syncReasons";
import type { ParkedReason, PendingMutation } from "./types";

const LEGACY_REASON: Record<string, ParkedReason> = {
  proximity: SYNC_REASON.outside50m,
  "gps-unverified": SYNC_REASON.gpsUnverifiedHeld,
  denied: SYNC_REASON.permissionDenied,
  missing: SYNC_REASON.notFound,
  historical: SYNC_REASON.historicalPin,
  invalid: SYNC_REASON.invalidPayload,
};

const GPS_HELD = new Set<string>([
  SYNC_REASON.outside50m,
  SYNC_REASON.gpsUnverifiedHeld,
  SYNC_REASON.gpsUnverifiedFlagged,
  "proximity",
  "gps-unverified",
]);

const reopenedSessions = new Set<string>();

/** A notes actionAt park. A cold start must not send that stale body again. */
function parkedForActionAt(row: PendingMutation): boolean {
  if (row.kind !== "notes") return false;
  return row.lastError === PHONE_CLOCK_NOTICE || row.lastError === NOTES_ACTION_AT_RETRY_MESSAGE;
}

/**
 * One pass per cold start. Parked denials are tried again.
 * notes_too_long, notes_rejected, combined_draft, and contact_denied are
 * included, except a notes draft parked for actionAt. That one stays parked
 * so the stale request is not sent on every launch. This pass does not set
 * clearNotes. A reopened blank is not a clear.
 */
export function reopenDeniedParked(
  drafts: PendingMutation[],
  uid: string,
): PendingMutation[] {
  if (reopenedSessions.has(uid)) return drafts;
  reopenedSessions.add(uid);
  return drafts.map((m) => {
    if (m.syncState !== "parked" || parkedForActionAt(m)) return m;
    return { ...m, syncState: "queued", nextAttemptAt: undefined };
  });
}

export function resetParkedReopenForTests() {
  reopenedSessions.clear();
}

/**
 * Upgrade a draft saved by 14.17 or earlier. Running this again returns the same object.
 * GPS holds and blocks are re-queued as flagged dispos with their original action time.
 */
function withCurrentReason(m: PendingMutation): PendingMutation {
  const next = m.parkedReason ? LEGACY_REASON[m.parkedReason] : undefined;
  return next ? { ...m, parkedReason: next } : m;
}

function alreadyFlagged(m: PendingMutation): boolean {
  return m.syncState === "queued"
    && !m.blocked
    && !m.direct?.gps
    && typeof m.direct?.patch?.gpsVerified === "boolean";
}

function heldForGps(m: PendingMutation): boolean {
  if (alreadyFlagged(m)) return false;
  const reason = String(m.parkedReason || "");
  if (GPS_HELD.has(reason)) return true;
  if ((m.blocked || m.syncState === "parked") && !!m.direct?.gps) return true;
  if (m.blocked && /164 feet|could not verify|GPS capture|precise location|outside 50/i.test(`${m.error || ""} ${m.lastError || ""}`)) {
    return true;
  }
  if (m.syncState === "gps" && m.direct?.gps && m.direct.gps.deadline <= Date.now()) return true;
  return false;
}

function gpsReasonForHeld(m: PendingMutation): "no_fix" | "stale" | "too_far" | "low_accuracy" {
  const text = `${m.error || ""} ${m.lastError || ""} ${m.parkedReason || ""}`;
  if (/164 feet|outside_50m|proximity|too far/i.test(text)) return "too_far";
  if (/accuracy/i.test(text)) return "low_accuracy";
  if (/stale|old fix/i.test(text)) return "stale";
  return "no_fix";
}

function flagHeldGps(m: PendingMutation): PendingMutation {
  const reason = gpsReasonForHeld(m);
  const patch = { ...(m.direct?.patch || {}), gpsVerified: false as const, gpsUnverifiedReason: reason };
  const direct = { ...(m.direct || { patch }), patch };
  delete direct.gps;
  const next: PendingMutation = {
    ...m,
    syncState: "queued",
    direct,
    attempts: m.attempts ?? 0,
  };
  delete next.blocked;
  delete next.error;
  delete next.parkedReason;
  delete next.lastError;
  return next;
}

export function migrateDraft(
  m: PendingMutation,
  actor?: { id: string; name: string },
): PendingMutation {
  const current = coerceLegacyContactDraft(m);
  if (heldForGps(current)) {
    const flagged = flagHeldGps(current);
    return flagged === current ? current : flagged;
  }
  if (current.syncState) return withCurrentReason(current);
  if (current.blocked && !current.direct?.gps) {
    const next: PendingMutation = {
      ...current,
      syncState: "queued",
      attempts: 0,
      lastError: current.error,
    };
    delete next.blocked;
    return next;
  }
  if (!current.direct && current.kind !== "handoff") {
    if (!actor || actor.id !== current.userId) return current;
    try {
      const next: PendingMutation = {
        ...current,
        userName: current.userName || actor.name,
        direct: { patch: reportingPatch(current, { id: actor.id, name: actor.name } as User), legacy: true },
        syncState: "queued",
        attempts: 0,
      };
      delete next.blocked;
      delete next.error;
      return next;
    } catch (e) {
      const next: PendingMutation = {
        ...current,
        syncState: "parked",
        parkedReason: SYNC_REASON.invalidPayload,
        lastError: (e as Error).message,
        attempts: 0,
      };
      delete next.blocked;
      return next;
    }
  }
  if (current.direct?.gps) return { ...current, syncState: "gps", attempts: current.attempts ?? 0 };
  if (current.direct || current.kind === "handoff")
    return { ...current, syncState: current.kind === "handoff" ? "parked" : "queued", parkedReason: current.kind === "handoff" ? SYNC_REASON.invalidPayload : undefined, attempts: current.attempts ?? 0 };
  return current;
}
