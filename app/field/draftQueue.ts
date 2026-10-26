import { effectiveSyncState } from "./draftState";
import { compareNotesSend } from "./notesCoalesce";
import type { FieldMutation, PendingMutation } from "./types";

/**
 * Queue order. createdAt wins when it differs, so a draft saved before sequences
 * existed stays in time order. Same-millisecond drafts use queueSeq. A missing
 * sequence is not zero: it sorts by createdAt, then id.
 */
export function compareQueuedDrafts(
  a: { createdAt?: string; id?: string; queueSeq?: number },
  b: { createdAt?: string; id?: string; queueSeq?: number },
): number {
  const byTime = (a.createdAt || "").localeCompare(b.createdAt || "");
  if (byTime !== 0) return byTime;
  const aSeq = typeof a.queueSeq === "number" && Number.isFinite(a.queueSeq);
  const bSeq = typeof b.queueSeq === "number" && Number.isFinite(b.queueSeq);
  if (aSeq && bSeq && a.queueSeq !== b.queueSeq) return (a.queueSeq as number) - (b.queueSeq as number);
  if (aSeq !== bSeq) return aSeq ? 1 : -1;
  return (a.id || "").localeCompare(b.id || "");
}

const queueSeqFloor = new Map<string, number>();

/** Tests that assert the first sequence start from an empty counter. */
export function resetQueueSeqForTests(): void {
  queueSeqFloor.clear();
}

/**
 * Next device sequence for this account. Pass only that account's drafts.
 * The counter increments synchronously, so two saves in one turn that both
 * see the same snapshot still get distinct sequences.
 */
export function nextQueueSeq(existing: readonly { queueSeq?: number }[], userId = ""): number {
  let max = 0;
  for (const row of existing) {
    if (typeof row.queueSeq === "number" && Number.isFinite(row.queueSeq) && row.queueSeq > max) max = row.queueSeq;
  }
  const seq = Math.max(max, queueSeqFloor.get(userId) ?? 0) + 1;
  queueSeqFloor.set(userId, seq);
  return seq;
}

function notesText(row: Pick<PendingMutation, "notes" | "direct">): string {
  if (typeof row.notes === "string") return row.notes;
  const patchNotes = row.direct?.patch?.notes;
  return typeof patchNotes === "string" ? patchNotes : "";
}

/**
 * Point a new notes draft at the unsent notes draft that will send immediately
 * before it. After that draft applies, the server equals this base, so this
 * draft hits current===base and wins exactly.
 */
export function chainNotesBase(existing: readonly PendingMutation[], next: PendingMutation): PendingMutation {
  if (next.kind !== "notes") return next;
  const prior = existing
    .filter((row) =>
      row.kind === "notes"
      && row.leadId === next.leadId
      && row.userId === next.userId
      && row.id !== next.id
      && !row.direct?.gps
      && effectiveSyncState(row) !== "parked"
      && effectiveSyncState(row) !== "gps"
      && compareNotesSend(row, next) < 0
    )
    .sort(compareNotesSend)
    .at(-1);
  if (!prior) return next;
  return { ...next, baseNotes: notesText(prior) };
}

/** A new dispo always joins the queue. Older drafts for the same lead stay. */
export function acceptDisposition(
  existing: PendingMutation[],
  next: FieldMutation,
): PendingMutation {
  if (existing.length >= 500) {
    console.warn(
      "You have 500 pending changes. Sync or review them before adding more.",
    );
    throw Error(
      "You have 500 pending changes. Sync or review them before adding more.",
    );
  }
  const pending = next as PendingMutation;
  const alreadyQueued = typeof pending.queueSeq === "number" && Number.isFinite(pending.queueSeq);
  const queued: PendingMutation = {
    ...pending,
    queueSeq: alreadyQueued ? pending.queueSeq : nextQueueSeq(existing, pending.userId),
    syncState: pending.syncState ?? (pending.direct?.gps ? "gps" : "queued"),
    attempts: pending.attempts ?? 0,
  };
  if (alreadyQueued) return queued;
  return chainNotesBase(existing, queued);
}
