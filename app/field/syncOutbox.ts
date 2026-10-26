import { backoffDelay, classifySyncFailure, effectiveSyncState } from "./draftState";
import { SERVER_DISPO_SLOW_RETRY_MS } from "./serverDispo";
import { recordSyncEvent, reportParked } from "./syncDiagnostics";
import type { PendingMutation } from "./types";

export type SyncOutboxDeps = {
  read: () => Promise<PendingMutation[]>;
  send: (m: PendingMutation) => Promise<unknown>;
  remove: (id: string) => Promise<unknown>;
  update?: (m: PendingMutation) => Promise<unknown>;
  /** @deprecated 14.17 writer. Still accepted so older tests can pass a no-op. */
  block?: (m: PendingMutation) => Promise<unknown>;
  report?: (userId: string) => Promise<unknown>;
  active: () => boolean;
  now?: () => number;
  random?: () => number;
};

function eventFor(m: PendingMutation, state: PendingMutation["syncState"] | "accepted") {
  return {
    id: crypto.randomUUID(),
    userId: m.userId,
    at: Date.now(),
    draftId: m.id,
    leadId: m.leadId,
    createdAt: m.createdAt,
    status: m.status,
    disposition: m.disposition,
    state: state || "queued",
    parkedReason: m.parkedReason,
    lastError: m.lastError,
    attempts: m.attempts,
  } as const;
}

/** Drains every lead it can. A failure never stops the next lead. */
export async function syncOutbox(deps: SyncOutboxDeps): Promise<{
  accepted: number;
  retried: number;
  parked: number;
}> {
  const now = () => deps.now?.() ?? Date.now();
  const random = deps.random ?? Math.random;
  const write = deps.update ?? deps.block;
  const seen = new Set<string>();
  let accepted = 0,
    retried = 0,
    parked = 0;
  while (deps.active()) {
    const all = (await deps.read())
      .slice()
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    const fresh = all.filter((m) => !seen.has(m.id));
    if (!fresh.length) break;
    const holding = (m: PendingMutation) => {
      const state = effectiveSyncState(m);
      const due = (m.nextAttemptAt ?? 0) > now();
      return due && (state === "retry" || (state === "queued" && m.routeHold === "field-dispo"));
    };
    const deferred = new Set<string>();
    for (const m of all) if (holding(m)) deferred.add(m.leadId);
    let progressed = false;
    for (const m of fresh) {
      if (!deps.active()) return { accepted, retried, parked };
      seen.add(m.id);
      const state = effectiveSyncState(m);
      if (m.direct?.gps || state === "gps" || state === "parked") continue;
      if (holding(m)) {
        deferred.add(m.leadId);
        continue;
      }
      if (deferred.has(m.leadId)) continue;
      progressed = true;
      const fail = async (
        current: PendingMutation,
        error: Error,
        mode: "retry" | "parked",
      ) => {
        const attempts = (current.attempts ?? 0) + 1;
        const retryAfterMs = (error as { retryAfterMs?: number }).retryAfterMs;
        const next: PendingMutation = {
          ...current,
          syncState: mode,
          attempts,
          lastError: error.message,
          nextAttemptAt:
            mode === "retry"
              ? now() +
                (Number.isFinite(retryAfterMs)
                  ? Math.min(15 * 60_000, Math.max(0, retryAfterMs as number))
                  : backoffDelay(attempts, random))
              : undefined,
          parkedReason: mode === "parked" ? current.parkedReason : undefined,
        };
        delete next.blocked;
        delete next.error;
        if (write) await write(next);
        await recordSyncEvent(eventFor(next, mode));
        if (mode === "retry") {
          retried += 1;
          deferred.add(current.leadId);
        } else {
          parked += 1;
          try { await (deps.report ?? reportParked)(current.userId); } catch { /* sync-report never stops a dispo */ }
        }
      };
      try {
        await deps.send(m);
        await deps.remove(m.id);
        accepted += 1;
        await recordSyncEvent(eventFor(m, "accepted"));
      } catch (caught) {
        const error = caught as Error & { status?: number; code?: string };
        const outcome = classifySyncFailure(error);
        if (outcome.kind === "gps-pending") continue;
        if (outcome.kind === "slow") {
          const next: PendingMutation = {
            ...m,
            syncState: "queued",
            attempts: (m.attempts ?? 0) + 1,
            nextAttemptAt: now() + SERVER_DISPO_SLOW_RETRY_MS,
            routeHold: "field-dispo",
            lastError: error.message,
          };
          delete next.blocked;
          delete next.error;
          if (outcome.parkedReason) next.parkedReason = outcome.parkedReason;
          else delete next.parkedReason;
          if (write) await write(next);
          retried += 1;
          deferred.add(m.leadId);
          await recordSyncEvent(eventFor(next, "queued"));
          continue;
        }
        if (outcome.kind === "conflict") {
          try {
            await deps.send(m);
            await deps.remove(m.id);
            accepted += 1;
            await recordSyncEvent(eventFor(m, "accepted"));
          } catch (again) {
            await fail(m, again as Error, "retry");
          }
          continue;
        }
        if (outcome.kind === "denial") {
          await fail(
            { ...m, parkedReason: outcome.parkedReason },
            error,
            "parked",
          );
          continue;
        }
        await fail(m, error, "retry");
      }
    }
    if (!progressed) break;
  }
  return { accepted, retried, parked };
}
