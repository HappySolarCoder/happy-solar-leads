/**
 * Three ways to combine a notes edit with the text on the server.
 * Server text still equals baseNotes: the edit wins exactly, including a
 * deletion or a full rewrite.
 * The edit starts with that base and the server moved: append only the
 * addition. A same-line addition is written onto the server's last line only
 * when that line is still the base's last line. If the server's last line is
 * a different line, the base's last line plus the full addition is kept on its
 * own line, including lines typed after that extension. An addition that starts
 * a new line keeps its newline. Skip the
 * append only when the server text already ends with that exact addition on a
 * line boundary.
 * Anything else keeps both texts. An empty edit does not wipe a server change.
 */
export function lastLine(text: string): string {
  const index = text.lastIndexOf("\n");
  return index === -1 ? text : text.slice(index + 1);
}

export function endsWithAdditionOnLine(current: string, addition: string): boolean {
  if (!addition || !current.endsWith(addition)) return false;
  if (addition.startsWith("\n")) return true;
  const start = current.length - addition.length;
  return start === 0 || current[start - 1] === "\n";
}

/**
 * A 409 whose server text is the base, or any text this draft already sent,
 * means that earlier text landed. The rep's text then wins exactly.
 * Anything else uses the three-way rule.
 */
export function notesAfterConflict(
  draft: { notes?: string; baseNotes?: string; knownSentNotes?: readonly string[] },
  currentNotes: string,
): { notes: string; baseNotes: string } {
  const edited = draft.notes || "";
  const base = draft.baseNotes || "";
  const known = draft.knownSentNotes || [];
  if (currentNotes === base || known.includes(currentNotes))
    return { notes: edited, baseNotes: currentNotes };
  return rebaseNotes(base, edited, currentNotes);
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
    if (lastLine(current) === lastLine(base)) {
      if (current.endsWith(addition)) return { notes: current, baseNotes: current };
      return { notes: `${current}${addition}`, baseNotes: current };
    }
    const editedLine = `${lastLine(base)}${addition}`;
    if (endsWithAdditionOnLine(current, editedLine)) return { notes: current, baseNotes: current };
    return { notes: current ? `${current}\n${editedLine}` : edit, baseNotes: current };
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

/**
 * The notes text a direct write is about to store, and the server text it was
 * computed against. A later replay of the same draft uses this record instead
 * of running the current===base shortcut on the original edit.
 * Server notes that still equal appliedNotes are already stored.
 * Server notes that moved are rebased from this record's lineage.
 */
export function planNotesWrite(input: {
  currentNotes?: string;
  baseNotes?: string;
  edited: string;
  appliedNotes?: string;
  appliedAgainst?: string;
}): {
  notes: string;
  appliedNotes: string;
  appliedAgainst: string;
  alreadyApplied: boolean;
  replayed: boolean;
} {
  const current = input.currentNotes || "";
  if (typeof input.appliedNotes === "string") {
    if (current === input.appliedNotes) {
      return {
        notes: current,
        appliedNotes: input.appliedNotes,
        appliedAgainst: input.appliedAgainst || "",
        alreadyApplied: true,
        replayed: true,
      };
    }
    const next = rebaseNotes(input.appliedAgainst || "", input.appliedNotes, current);
    return {
      notes: next.notes,
      appliedNotes: next.notes,
      appliedAgainst: current,
      alreadyApplied: false,
      replayed: next.notes === current,
    };
  }
  const first = notesTransactionPatch(current, input.baseNotes, input.edited);
  return {
    notes: first.notes,
    appliedNotes: first.notes,
    appliedAgainst: current,
    alreadyApplied: false,
    replayed: first.replayed,
  };
}
