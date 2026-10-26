/**
 * Send order for notes drafts on one lead. They are not merged.
 * queueSeq is the order this device queued them. Drafts saved before
 * sequences existed fall back to createdAt, then to text lineage when
 * those tie, then to id.
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
  const aSeq = typeof a.queueSeq === "number" && Number.isFinite(a.queueSeq);
  const bSeq = typeof b.queueSeq === "number" && Number.isFinite(b.queueSeq);
  if (aSeq && bSeq && a.queueSeq !== b.queueSeq) return (a.queueSeq as number) - (b.queueSeq as number);
  const byTime = (a.createdAt || "").localeCompare(b.createdAt || "");
  if (byTime !== 0) return byTime;
  if (aSeq !== bSeq) return aSeq ? 1 : -1;
  const aOlder = notesLineageNewer(a, b);
  const bOlder = notesLineageNewer(b, a);
  if (aOlder && !bOlder) return -1;
  if (bOlder && !aOlder) return 1;
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
