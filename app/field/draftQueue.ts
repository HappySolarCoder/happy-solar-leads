import { effectiveSyncState } from "./draftState";
import { compareNotesSend, hasQueueSeq } from "./notesCoalesce";
import { SYNC_REASON } from "./syncReasons";
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

const DRAFT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/** A receipt key is uid+draftId and has no TTL. A reused id is a silent no-op. */
export function mintDraftId(existing: readonly { id?: string }[]): string {
  const taken = new Set(existing.map((row) => row.id).filter((id): id is string => !!id));
  let id = crypto.randomUUID();
  while (taken.has(id) || !DRAFT_ID_PATTERN.test(id)) id = crypto.randomUUID();
  return id;
}

export function freshDraftId(base: string, suffix: string, existing: ReadonlySet<string>): string {
  const preferred = `${base}-${suffix}`;
  if (DRAFT_ID_PATTERN.test(preferred) && !existing.has(preferred)) return preferred;
  return mintDraftId([...existing].map((id) => ({ id })));
}

function parkedUnapplied(row: PendingMutation): boolean {
  if (row.direct?.gps) return false;
  const state = effectiveSyncState(row);
  if (state === "parked" || state === "gps") return true;
  return row.parkedReason === SYNC_REASON.notesTooLong
    || row.parkedReason === SYNC_REASON.notesRejected
    || row.parkedReason === SYNC_REASON.payloadTooLarge;
}

/**
 * baseNotes chained to a draft that parked or was rejected is not on the
 * server. Walk back to that draft's own baseNotes. A base that is still only
 * the text of an unsent earlier draft is not used either.
 */
export function baseFromAppliedAncestor(
  draft: Pick<PendingMutation, "id" | "kind" | "leadId" | "userId" | "baseNotes">,
  queued: readonly PendingMutation[],
): string {
  if (draft.kind !== "notes") return draft.baseNotes || "";
  let base = draft.baseNotes || "";
  const seen = new Set<string>();
  while (seen.size <= queued.length) {
    const pred = queued
      .filter((row) =>
        row.kind === "notes"
        && row.leadId === draft.leadId
        && row.userId === draft.userId
        && row.id !== draft.id
        && !seen.has(row.id)
        && notesText(row) === base
        && parkedUnapplied(row)
      )
      .sort(compareNotesSend)
      .at(-1);
    if (!pred) return base;
    seen.add(pred.id);
    base = pred.baseNotes || "";
  }
  return base;
}

/**
 * The base a notes draft should send with. A parked or still-unsent predecessor
 * contributes its own base, never its unapplied text. Otherwise the last notes
 * text this flush actually applied wins, so the route hits current===base.
 */
export function notesBaseForSend(
  draft: PendingMutation,
  queued: readonly PendingMutation[],
  lastAppliedNotes?: string,
): PendingMutation {
  if (draft.kind !== "notes") return draft;
  const original = draft.baseNotes || "";
  const walked = baseFromAppliedAncestor(draft, queued);
  if (walked !== original) return { ...draft, baseNotes: walked };
  const notes = draft.notes || "";
  if (
    lastAppliedNotes !== undefined
    && lastAppliedNotes !== original
    && notes.startsWith(lastAppliedNotes)
  ) return { ...draft, baseNotes: lastAppliedNotes };
  return draft;
}

/** A sequenced notes draft waits until every legacy notes row for the lead is sent or parked. */
export function legacyNotesOutstanding(rows: readonly PendingMutation[], draft: PendingMutation): boolean {
  if (draft.kind !== "notes" || !hasQueueSeq(draft)) return false;
  return rows.some((row) =>
    row.kind === "notes"
    && !hasQueueSeq(row)
    && row.leadId === draft.leadId
    && row.userId === draft.userId
    && row.id !== draft.id
    && !row.direct?.gps
    && !parkedUnapplied(row)
    && effectiveSyncState(row) !== "gps"
  );
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
  const id = existing.some((row) => row.id === queued.id) ? mintDraftId(existing) : queued.id;
  return chainNotesBase(existing, id === queued.id ? queued : { ...queued, id });
}
