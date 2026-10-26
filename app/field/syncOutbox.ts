import { coerceLegacyContactDraft, hasContactFields, notesWereEdited, splitNotesAndContact } from "./contactSave";
import { backoffDelay, classifySyncFailure, effectiveSyncState } from "./draftState";
import { absorbNotesText } from "./notesLimits";
import { SERVER_DISPO_SLOW_RETRY_MS, splitCombinedDraft } from "./serverDispo";
import { recordSyncEvent, reportParked } from "./syncDiagnostics";
import { SYNC_REASON } from "./syncReasons";
import type { PendingMutation } from "./types";

export type SyncOutboxDeps = {
  read: () => Promise<PendingMutation[]>;
  send: (m: PendingMutation) => Promise<unknown>;
  remove: (id: string) => Promise<unknown>;
  update?: (m: PendingMutation) => Promise<unknown>;
  /** Writes a draft created by splitting a combined knock and note. */
  insert?: (m: PendingMutation) => Promise<unknown>;
  /** @deprecated 14.17 writer. Still accepted so older tests can pass a no-op. */
  block?: (m: PendingMutation) => Promise<unknown>;
  report?: (userId: string) => Promise<unknown>;
  active: () => boolean;
  now?: () => number;
  random?: () => number;
};

function notesTooLongRow(m: PendingMutation): boolean {
  return m.kind === "notes" && m.parkedReason === SYNC_REASON.notesTooLong;
}

/** A later notes draft replaces or rebases onto a notes_too_long row. One note is sent. */
function absorbNotesTooLong(next: PendingMutation, priors: PendingMutation[]): PendingMutation {
  let notes = next.notes || "";
  let baseNotes = next.baseNotes || "";
  for (const prior of priors) {
    const absorbed = absorbNotesText(
      { notes: prior.notes || "", baseNotes: prior.baseNotes || "" },
      { notes, baseNotes },
    );
    notes = absorbed.notes;
    baseNotes = absorbed.baseNotes;
  }
  const merged: PendingMutation = {
    ...next,
    notes,
    baseNotes,
    ...(notes === "" ? { clearNotes: true } : {}),
    direct: next.direct ? { ...next.direct, patch: { ...next.direct.patch, notes } } : next.direct,
  };
  delete merged.parkedReason;
  delete merged.nextAttemptAt;
  delete merged.routeHold;
  delete merged.lastError;
  delete merged.blocked;
  delete merged.error;
  return merged;
}

function withRebasedNotes(m: PendingMutation, rebased?: PendingMutation): PendingMutation {
  if (!rebased) return m;
  return {
    ...m,
    notes: rebased.notes,
    baseNotes: rebased.baseNotes,
    direct: rebased.direct ?? m.direct,
  };
}

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
    // notes_too_long is parked, or still waiting from today's slow retry. Either way
    // it does not hold the lead: a knock is a different kind and syncs. A later notes
    // draft absorbs it. Every other hold still defers that lead.
    const holding = (m: PendingMutation) => {
      if (notesTooLongRow(m)) return false;
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
      if (notesTooLongRow(m) && (m.nextAttemptAt ?? 0) > now()) continue;
      if (holding(m)) {
        deferred.add(m.leadId);
        continue;
      }
      if (deferred.has(m.leadId)) continue;
      progressed = true;
      let current = coerceLegacyContactDraft(m);
      if (current !== m && write) await write(current);
      const ids = new Set(all.map((row) => row.id));
      const contactSplit = splitNotesAndContact(current, ids);
      if (contactSplit && contactSplit !== "unsafe" && deps.insert) {
        await deps.insert(contactSplit.contact);
        await deps.insert(contactSplit.notes);
        await deps.remove(current.id);
        continue;
      }
      let absorbedPriors: PendingMutation[] = [];
      const priors = all.filter((row) =>
        notesTooLongRow(row)
        && row.leadId === current.leadId
        && row.id !== current.id
        && (row.createdAt < current.createdAt || (row.createdAt === current.createdAt && row.id < current.id))
      );
      const blank = typeof current.notes === "string" && !current.notes.trim();
      const exactClear = current.notes === "";
      const descendedClear = exactClear && priors.some((row) => (row.notes || "") !== "" && current.baseNotes === row.notes);
      const absorb = current.kind === "notes"
        && !hasContactFields(current)
        && notesWereEdited(current)
        && typeof current.notes === "string"
        && (!blank || descendedClear)
        && priors.length > 0;
      if (absorb) {
        current = absorbNotesTooLong(current, priors);
        if (write) await write(current);
        // The parked row stays until this replacement is saved.
        absorbedPriors = priors;
      }
      const split = splitCombinedDraft(current, ids);
      if (split) {
        if (split === "unsafe" || !deps.insert) {
          const parkedDraft: PendingMutation = {
            ...current,
            syncState: "parked",
            attempts: (current.attempts ?? 0) + 1,
            parkedReason: SYNC_REASON.combinedDraft,
            lastError: "Save the knock and the note as separate actions.",
          };
          delete parkedDraft.blocked;
          delete parkedDraft.error;
          delete parkedDraft.nextAttemptAt;
          if (write) await write(parkedDraft);
          parked += 1;
          await recordSyncEvent(eventFor(parkedDraft, "parked"));
          try { await (deps.report ?? reportParked)(current.userId); } catch { /* sync-report never stops a dispo */ }
          continue;
        }
        await deps.insert(split.knock);
        await deps.insert(split.notes);
        await deps.remove(current.id);
        continue;
      }
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
      const dropAbsorbed = async () => {
        for (const prior of absorbedPriors) {
          seen.add(prior.id);
          await deps.remove(prior.id);
        }
      };
      try {
        await deps.send(current);
        await deps.remove(current.id);
        await dropAbsorbed();
        accepted += 1;
        await recordSyncEvent(eventFor(current, "accepted"));
      } catch (caught) {
        const error = caught as Error & { status?: number; code?: string; rebasedDraft?: PendingMutation };
        const outcome = classifySyncFailure(error);
        const kept = outcome.kind === "denial" ? withRebasedNotes(current, error.rebasedDraft) : current;
        if (outcome.kind === "gps-pending") continue;
        if (outcome.kind === "slow") {
          const next: PendingMutation = {
            ...current,
            syncState: "queued",
            attempts: (current.attempts ?? 0) + 1,
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
          deferred.add(current.leadId);
          await recordSyncEvent(eventFor(next, "queued"));
          continue;
        }
        if (outcome.kind === "conflict") {
          try {
            await deps.send(current);
            await deps.remove(current.id);
            await dropAbsorbed();
            accepted += 1;
            await recordSyncEvent(eventFor(current, "accepted"));
          } catch (again) {
            await fail(current, again as Error, "retry");
          }
          continue;
        }
        if (outcome.kind === "denial") {
          await fail(
            { ...kept, parkedReason: outcome.parkedReason },
            error,
            "parked",
          );
          continue;
        }
        await fail(current, error, "retry");
      }
    }
    if (!progressed) break;
  }
  return { accepted, retried, parked };
}
