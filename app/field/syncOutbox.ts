import { coerceLegacyContactDraft, hasContactFields, notesWereEdited, splitNotesAndContact } from "./contactSave";
import { compareNotesSend } from "./notesCoalesce";
import { collapseLegacyNotesQueue, compareQueuedDrafts } from "./draftQueue";
import { backoffDelay, classifySyncFailure, effectiveSyncState } from "./draftState";
import { absorbNotesText } from "./notesLimits";
import { SERVER_DISPO_SLOW_RETRY_MS, splitCombinedDraft } from "./serverDispo";
import { recordSyncEvent, reportInBackground, reportParked } from "./syncDiagnostics";
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
  /**
   * NOTES-MERGE-SPEC V4 / v5 ruling 6: ids of notes drafts that went pending (409 after the send cap) in this
   * sync burst. They are not sent again until the next fresh flush; a sync() that only waited on a running flush
   * passes the same set, so its rerun cannot add sends to that flush. Ids that go pending are added here.
   */
  heldNotesPending?: Set<string>;
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
    direct: next.direct ? { ...next.direct, patch: { ...next.direct.patch, notes } } : next.direct,
  };
  if (notes === "" && next.clearNotes === true) merged.clearNotes = true;
  else delete merged.clearNotes;
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
  const next: PendingMutation = {
    ...m,
    notes: rebased.notes,
    baseNotes: rebased.baseNotes,
    direct: rebased.direct ?? m.direct,
  };
  // NOTES-MERGE-SPEC V4: a clear that a 409 turned into plain notes stays plain notes.
  if (rebased.clearNotes) next.clearNotes = true;
  else delete next.clearNotes;
  if (rebased.notesIntent) next.notesIntent = rebased.notesIntent;
  return next;
}

/** A transient failure after a V4 clear conversion keeps the converted draft, so the clear is not re-sent. */
function keepClearConversion(m: PendingMutation, rebased?: PendingMutation): PendingMutation {
  if (!rebased || !m.clearNotes || rebased.clearNotes) return m;
  return withRebasedNotes(m, rebased);
}

/** A GPS-held create has not landed yet. Later drafts for that lead wait. A parked create does not hold them. */
function gpsHeldCreate(m: PendingMutation): boolean {
  const state = effectiveSyncState(m);
  return !!m.direct?.create && state !== "parked" && (!!m.direct?.gps || state === "gps");
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
  let collapsedOnce = false;
  while (deps.active()) {
    const all = (await deps.read())
      .slice()
      .sort(compareNotesSend);
    if (!collapsedOnce && write && deps.insert) {
      collapsedOnce = true;
      const collapsed = collapseLegacyNotesQueue(all);
      if (collapsed !== all) {
        const nextIds = new Set(collapsed.map((row) => row.id));
        for (const row of collapsed) {
          const prev = all.find((item) => item.id === row.id);
          if (!prev) await deps.insert(row);
          else if (prev !== row) await write(row);
        }
        for (const row of all) if (!nextIds.has(row.id)) await deps.remove(row.id);
        continue;
      }
    }
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
    const acceptedIds = new Set<string>();
    for (const m of all) if (holding(m)) deferred.add(m.leadId);
    for (const m of all) if (gpsHeldCreate(m)) deferred.add(m.leadId);
    const ids = new Set(all.map((row) => row.id));
    let flushed = false;
    for (const row of fresh) {
      const coerced = coerceLegacyContactDraft(row);
      if (coerced !== row && write) {
        await write(coerced);
        flushed = true;
      }
      const contactSplit = splitNotesAndContact(coerced, ids);
      if (contactSplit && contactSplit !== "unsafe" && deps.insert) {
        ids.add(contactSplit.contact.id);
        ids.add(contactSplit.notes.id);
        await deps.insert(contactSplit.contact);
        if (contactSplit.notes.id === coerced.id && write) await write(contactSplit.notes);
        else {
          await deps.insert(contactSplit.notes);
          await deps.remove(coerced.id);
        }
        seen.delete(contactSplit.notes.id);
        flushed = true;
      }
    }
    if (flushed) continue;
    let progressed = false;
    for (const m of fresh) {
      if (!deps.active()) return { accepted, retried, parked };
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      const state = effectiveSyncState(m);
      if (m.direct?.gps || state === "gps" || state === "parked") {
        if (gpsHeldCreate(m)) deferred.add(m.leadId);
        continue;
      }
      if (notesTooLongRow(m) && (m.nextAttemptAt ?? 0) > now()) continue;
      if (deps.heldNotesPending?.has(m.id)) {
        deferred.add(m.leadId);
        continue;
      }
      if (holding(m)) {
        deferred.add(m.leadId);
        continue;
      }
      if (deferred.has(m.leadId)) continue;
      progressed = true;
      let current = coerceLegacyContactDraft(m);
      if (current !== m && write) await write(current);
      let absorbedPriors: PendingMutation[] = [];
      const priors = all.filter((row) =>
        notesTooLongRow(row)
        && row.leadId === current.leadId
        && row.id !== current.id
        && compareQueuedDrafts(row, current) < 0
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
          reportInBackground(() => (deps.report ?? reportParked)(current.userId));
          continue;
        }
        await deps.insert(split.knock);
        if (split.notes.id === current.id && write) await write(split.notes);
        else {
          await deps.insert(split.notes);
          await deps.remove(current.id);
        }
        seen.delete(split.notes.id);
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
          // NOTES-MERGE-SPEC V4 answers: a pending clear is retried on the next flush, not after a backoff.
          // One send round per flush (seen), so there is no tight loop.
          nextAttemptAt:
            mode === "retry" && (error as { notesPending?: boolean }).notesPending
              ? undefined
              : mode === "retry"
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
          reportInBackground(() => (deps.report ?? reportParked)(current.userId));
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
        acceptedIds.add(current.id);
        await dropAbsorbed();
        accepted += 1;
        await recordSyncEvent(eventFor(current, "accepted"));
      } catch (caught) {
        const error = caught as Error & { status?: number; code?: string; rebasedDraft?: PendingMutation; retryAfterMs?: number };
        if (error.status === 429) {
          await fail(current, error, "retry");
          continue;
        }
        if ((error as { notesPending?: boolean }).notesPending) {
          // NOTES-MERGE-SPEC V4 / v5 rulings 3 and 6: still 409 after the send cap. Pending as the intent merged
          // against the last current (carrying the intent); no further send in this flush, the next flush sends it.
          deps.heldNotesPending?.add(current.id);
          await fail(withRebasedNotes(current, error.rebasedDraft), error, "retry");
          continue;
        }
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
            acceptedIds.add(current.id);
            await dropAbsorbed();
            accepted += 1;
            await recordSyncEvent(eventFor(current, "accepted"));
          } catch (again) {
            await fail(current, again as Error, "retry");
          }
          continue;
        }
        if (
          outcome.kind === "denial"
          && outcome.parkedReason === SYNC_REASON.notFound
          && current.kind === "notes"
          && all.some((row) =>
            row.leadId === current.leadId
            && row.id !== current.id
            && !!row.direct?.create
            && effectiveSyncState(row) !== "parked"
            && !acceptedIds.has(row.id)
          )
        ) {
          // The home's create is still queued. Parking this 410 would drop the note. Retry on the next flush.
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
        await fail(keepClearConversion(current, error.rebasedDraft), error, "retry");
      }
    }
    if (!progressed) break;
  }
  return { accepted, retried, parked };
}
