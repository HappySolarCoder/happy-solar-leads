import type { PendingMutation } from "./types";

/**
 * Several unsent notes drafts for one lead each carry the full text.
 * At send time they become one draft: the newest text, with the oldest base.
 * A later draft supersedes the previous one when its base is that text.
 * Legacy drafts that share createdAt and have no queueSeq are ordered by
 * lineage, not by id. When lineage cannot order two drafts, both texts are
 * kept once.
 */
export function notesLineageNewer(
  older: { notes?: string; baseNotes?: string },
  newer: { notes?: string; baseNotes?: string },
): boolean {
  const olderNotes = older.notes || "";
  const newerNotes = newer.notes || "";
  if (olderNotes && newerNotes.startsWith(olderNotes) && newerNotes !== olderNotes) return true;
  if (olderNotes && (newer.baseNotes || "") === olderNotes) return true;
  return false;
}

export function orderQueuedNotes<T extends {
  createdAt?: string;
  id?: string;
  queueSeq?: number;
  notes?: string;
  baseNotes?: string;
}>(rows: readonly T[]): T[] {
  return rows.slice().sort((a, b) => {
    const byTime = (a.createdAt || "").localeCompare(b.createdAt || "");
    if (byTime !== 0) return byTime;
    const aSeq = typeof a.queueSeq === "number" && Number.isFinite(a.queueSeq);
    const bSeq = typeof b.queueSeq === "number" && Number.isFinite(b.queueSeq);
    if (aSeq && bSeq && a.queueSeq !== b.queueSeq) return (a.queueSeq as number) - (b.queueSeq as number);
    if (aSeq !== bSeq) return aSeq ? 1 : -1;
    const aOlder = notesLineageNewer(a, b);
    const bOlder = notesLineageNewer(b, a);
    if (aOlder && !bOlder) return -1;
    if (bOlder && !aOlder) return 1;
    return (a.id || "").localeCompare(b.id || "");
  });
}

/** Shared lines stay once. A text that already extends the other is kept whole. */
export function keepBothNotesOnce(left: string, right: string): string {
  if (!left) return right;
  if (!right) return left;
  if (right.startsWith(left)) return right;
  if (left.startsWith(right)) return left;
  const seen = new Set(left.split("\n"));
  const extra = right.split("\n").filter((line) => !seen.has(line));
  if (!extra.length) return left;
  return `${left}\n${extra.join("\n")}`;
}

function withNotes(m: PendingMutation, notes: string, baseNotes: string, clear: boolean): PendingMutation {
  const next: PendingMutation = {
    ...m,
    notes,
    baseNotes,
    direct: m.direct ? { ...m.direct, patch: { ...m.direct.patch, notes } } : m.direct,
  };
  if (clear) next.clearNotes = true;
  else delete next.clearNotes;
  return next;
}

/** One notes draft for the group. Superseded ids are removed only after send succeeds. */
export function coalesceNotesDrafts(rows: readonly PendingMutation[]): {
  draft: PendingMutation;
  supersededIds: string[];
} {
  const ordered = orderQueuedNotes(rows);
  let acc = ordered[0];
  const supersededIds: string[] = [];
  for (let i = 1; i < ordered.length; i += 1) {
    const next = ordered[i];
    const accNotes = acc.notes || "";
    const nextNotes = next.notes || "";
    const nextBase = next.baseNotes || "";
    const supersedes = nextBase === accNotes;
    const notes = supersedes ? nextNotes : keepBothNotesOnce(accNotes, nextNotes);
    const clear = supersedes && next.clearNotes === true && notes === "";
    supersededIds.push(acc.id);
    acc = withNotes(next, notes, acc.baseNotes || "", clear);
  }
  return { draft: acc, supersededIds };
}
