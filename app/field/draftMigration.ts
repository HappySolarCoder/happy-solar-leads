import type { User } from "@/app/types";
import { reportingPatch } from "./directWrites";
import { SYNC_REASON } from "./syncReasons";
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

/**
 * One pass per cold start. Parked denials are tried again.
 * notes_too_long and combined_draft are included. They reopen at most once
 * per app start. That is bounded, and fine.
 */
export function reopenDeniedParked(
  drafts: PendingMutation[],
  uid: string,
): PendingMutation[] {
  if (reopenedSessions.has(uid)) return drafts;
  reopenedSessions.add(uid);
  return drafts.map((m) => {
    if (m.syncState !== "parked") return m;
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
  if (heldForGps(m)) {
    const flagged = flagHeldGps(m);
    return flagged === m ? m : flagged;
  }
  if (m.syncState) return withCurrentReason(m);
  if (m.blocked && !m.direct?.gps) {
    const next: PendingMutation = {
      ...m,
      syncState: "queued",
      attempts: 0,
      lastError: m.error,
    };
    delete next.blocked;
    return next;
  }
  if (!m.direct && m.kind !== "handoff") {
    if (!actor || actor.id !== m.userId) return m;
    try {
      const next: PendingMutation = {
        ...m,
        userName: m.userName || actor.name,
        direct: { patch: reportingPatch(m, { id: actor.id, name: actor.name } as User), legacy: true },
        syncState: "queued",
        attempts: 0,
      };
      delete next.blocked;
      delete next.error;
      return next;
    } catch (e) {
      const next: PendingMutation = {
        ...m,
        syncState: "parked",
        parkedReason: SYNC_REASON.invalidPayload,
        lastError: (e as Error).message,
        attempts: 0,
      };
      delete next.blocked;
      return next;
    }
  }
  if (m.direct?.gps) return { ...m, syncState: "gps", attempts: m.attempts ?? 0 };
  if (m.direct || m.kind === "handoff")
    return { ...m, syncState: m.kind === "handoff" ? "parked" : "queued", parkedReason: m.kind === "handoff" ? SYNC_REASON.invalidPayload : undefined, attempts: m.attempts ?? 0 };
  return m;
}
