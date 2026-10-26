/**
 * Send order for notes drafts on one lead. They are not merged.
 * This is a strict total order: legacy rows (no queueSeq) first, then
 * queueSeq, then createdAt, then id. Text lineage is not part of the order.
 */
export function hasQueueSeq(row: { queueSeq?: number }): boolean {
  return typeof row.queueSeq === "number" && Number.isFinite(row.queueSeq);
}

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

export function compareNotesSend(a: {
  createdAt?: string;
  id?: string;
  queueSeq?: number;
  notes?: string;
  baseNotes?: string;
}, b: {
  createdAt?: string;
  id?: string;
  queueSeq?: number;
  notes?: string;
  baseNotes?: string;
}): number {
  const aSeq = hasQueueSeq(a);
  const bSeq = hasQueueSeq(b);
  if (aSeq !== bSeq) return aSeq ? 1 : -1;
  if (aSeq && bSeq && a.queueSeq !== b.queueSeq) return (a.queueSeq as number) - (b.queueSeq as number);
  const byTime = (a.createdAt || "").localeCompare(b.createdAt || "");
  if (byTime !== 0) return byTime;
  return (a.id || "").localeCompare(b.id || "");
}

export function orderQueuedNotes<T extends {
  createdAt?: string;
  id?: string;
  queueSeq?: number;
  notes?: string;
  baseNotes?: string;
}>(rows: readonly T[]): T[] {
  return rows.slice().sort(compareNotesSend);
}
