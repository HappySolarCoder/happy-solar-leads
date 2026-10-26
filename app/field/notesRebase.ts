/**
 * An uncontested edit, where the server notes still equal baseNotes, is stored
 * exactly as typed, including a deletion or a cleared note. A conflict never
 * overwrites. An edit that extends its base contributes only the added tail,
 * and in a contested case that tail always starts on its own line.
 * An empty base, or an edit that cannot be lined up, is appended on its own
 * line when the server does not already contain it.
 */
export function rebaseNotes(baseNotes: string, edited: string, currentNotes: string): { notes: string; baseNotes: string } {
  const base = baseNotes || "";
  const current = currentNotes || "";
  const edit = edited || "";
  if (current === base) return { notes: edit, baseNotes: current };
  // The local note already begins with the server text. Keep the new tail once.
  // An empty server note matches every string, so that case stays on the append path.
  if (current && edit.startsWith(current)) {
    const tail = edit.slice(current.length);
    if (!tail || current.endsWith(tail) || current.includes(tail)) return { notes: current, baseNotes: current };
    return { notes: `${current}${tail}`, baseNotes: current };
  }
  if (edit.startsWith(base)) {
    const addition = edit.slice(base.length);
    if (!addition || current.endsWith(addition) || current.includes(addition)) return { notes: current, baseNotes: current };
    if (base) {
      const separated = addition.startsWith("\n") ? addition : `\n${addition}`;
      return { notes: `${current}${separated}`, baseNotes: current };
    }
  }
  if (!edit || current.includes(edit)) return { notes: current, baseNotes: current };
  return { notes: current ? `${current}\n${edit}` : edit, baseNotes: current };
}

/** Idempotent notes write. A replay whose text already matches does not write again. */
export function notesTransactionPatch(
  currentNotes: string | undefined,
  baseNotes: string | undefined,
  edited: string,
): { notes: string; replayed: boolean } {
  const current = currentNotes || "";
  const applied = rebaseNotes(baseNotes || "", edited, current);
  return { notes: applied.notes, replayed: applied.notes === current };
}
