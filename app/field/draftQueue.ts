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

/** Next device sequence for this account. Pass only that account's drafts. */
export function nextQueueSeq(existing: readonly { queueSeq?: number }[]): number {
  let max = 0;
  for (const row of existing) {
    if (typeof row.queueSeq === "number" && Number.isFinite(row.queueSeq) && row.queueSeq > max) max = row.queueSeq;
  }
  return max + 1;
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
  return {
    ...pending,
    queueSeq: typeof pending.queueSeq === "number" ? pending.queueSeq : nextQueueSeq(existing),
    syncState: pending.syncState ?? (pending.direct?.gps ? "gps" : "queued"),
    attempts: pending.attempts ?? 0,
  };
}
