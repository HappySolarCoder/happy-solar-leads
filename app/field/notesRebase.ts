/**
 * An uncontested edit, where the server notes still equal baseNotes, is stored
 * exactly as typed, including a deletion or a cleared note. A conflict never
 * overwrites and never drops a line. An edit that extends its base contributes
 * only the added tail. A tail is skipped only when the server notes already end
 * with that exact addition on a line boundary. A substring in the middle is not
 * that addition. When the edit cannot be lined up, both texts are kept, joined
 * with a newline.
 */
function endsWithAdditionOnLine(current: string, addition: string): boolean {
  if (!addition || !current.endsWith(addition)) return false;
  if (addition.startsWith("\n")) return true;
  const start = current.length - addition.length;
  return start === 0 || current[start - 1] === "\n";
}

export function rebaseNotes(baseNotes: string, edited: string, currentNotes: string): { notes: string; baseNotes: string } {
  const base = baseNotes || "";
  const current = currentNotes || "";
  const edit = edited || "";
  if (current === base) {
    // A conflict merge can rebuild this exact base, and a replay would then
    // replace it with only the last line. That deletes the server text.
    if (edit && current.endsWith(`\n${edit}`)) return { notes: current, baseNotes: current };
    return { notes: edit, baseNotes: current };
  }
  // The local note already begins with the server text. Keep the new tail once.
  // An empty server note matches every string, so that case stays on the append path.
  if (current && edit.startsWith(current)) {
    const tail = edit.slice(current.length);
    if (!tail || endsWithAdditionOnLine(current, tail)) return { notes: current, baseNotes: current };
    return { notes: `${current}${tail}`, baseNotes: current };
  }
  if (edit.startsWith(base)) {
    const addition = edit.slice(base.length);
    if (!addition || endsWithAdditionOnLine(current, addition)) return { notes: current, baseNotes: current };
    if (base) {
      const separated = addition.startsWith("\n") ? addition : `\n${addition}`;
      if (endsWithAdditionOnLine(current, separated)) return { notes: current, baseNotes: current };
      return { notes: `${current}${separated}`, baseNotes: current };
    }
  }
  if (!edit) return { notes: current, baseNotes: current };
  if (endsWithAdditionOnLine(current, edit)) return { notes: current, baseNotes: current };
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
