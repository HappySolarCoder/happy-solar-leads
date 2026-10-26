/**
 * Three ways to combine a notes edit with the text on the server.
 * Server text still equals baseNotes: the edit wins exactly, including a
 * deletion or a full rewrite.
 * The edit starts with that base and the server moved: append only the
 * addition. An addition that continues the last line is appended directly.
 * An addition that starts a new line keeps its newline. Skip the append only
 * when the server text already ends with that exact addition on a line
 * boundary. A same-line extension is skipped only when the server text
 * already ends with the exact addition.
 * Anything else keeps both texts. An empty edit does not wipe a server change.
 */
export function endsWithAdditionOnLine(current: string, addition: string): boolean {
  if (!addition || !current.endsWith(addition)) return false;
  if (addition.startsWith("\n")) return true;
  const start = current.length - addition.length;
  return start === 0 || current[start - 1] === "\n";
}

export function rebaseNotes(baseNotes: string, edited: string, currentNotes: string): { notes: string; baseNotes: string } {
  const base = baseNotes || "";
  const current = currentNotes || "";
  const edit = edited || "";
  if (current === base) return { notes: edit, baseNotes: current };
  // Nothing on the server to preserve. The typed note wins, including its base.
  if (!current) return { notes: edit, baseNotes: current };
  // The local note already begins with the server text. Keep the new tail once.
  if (current && edit.startsWith(current)) {
    const tail = edit.slice(current.length);
    if (!tail || endsWithAdditionOnLine(current, tail)) return { notes: current, baseNotes: current };
    return { notes: `${current}${tail}`, baseNotes: current };
  }
  if (edit.startsWith(base)) {
    const addition = edit.slice(base.length);
    if (!addition) {
      if (!edit || endsWithAdditionOnLine(current, edit)) return { notes: current, baseNotes: current };
      return { notes: current ? `${current}\n${edit}` : edit, baseNotes: current };
    }
    if (endsWithAdditionOnLine(current, addition)) return { notes: current, baseNotes: current };
    if (addition.startsWith("\n") || !base) {
      const separated = addition.startsWith("\n") ? addition : `\n${addition}`;
      if (endsWithAdditionOnLine(current, separated)) return { notes: current, baseNotes: current };
      return { notes: `${current}${separated}`, baseNotes: current };
    }
    if (current.endsWith(addition)) return { notes: current, baseNotes: current };
    return { notes: `${current}${addition}`, baseNotes: current };
  }
  if (!edit) return { notes: current, baseNotes: current };
  if (endsWithAdditionOnLine(current, edit)) return { notes: current, baseNotes: current };
  return { notes: current ? `${current}\n${edit}` : edit, baseNotes: current };
}

/**
 * Idempotent notes write. When the server text still equals baseNotes the
 * edit is stored as typed and rebase is not called. A replay whose text
 * already matches does not write again.
 */
export function notesTransactionPatch(
  currentNotes: string | undefined,
  baseNotes: string | undefined,
  edited: string,
): { notes: string; replayed: boolean } {
  const current = currentNotes || "";
  const base = baseNotes || "";
  if (current === base) return { notes: edited, replayed: edited === current };
  const applied = rebaseNotes(base, edited, current);
  return { notes: applied.notes, replayed: applied.notes === current };
}
