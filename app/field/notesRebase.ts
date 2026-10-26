/**
 * Combine a notes edit with the text on the server.
 * Server text still equals baseNotes: the edit wins exactly, including a
 * deletion or a full rewrite.
 * Otherwise each non-blank line of the edit is appended when the server has
 * fewer copies than the edit. A line is skipped only when the server already
 * has that copy. A line the server removed is kept, even when the base had it.
 * Blank lines are not deduped against the server. A typed blank that belongs
 * to an appended line is kept. Leading and trailing blank lines of a merge
 * are removed. Blank lines inside the text stay. A merge that is only blank
 * lines is left as it is. An empty edit does not wipe a server change.
 * The same inputs always return the same text. Replaying the result against
 * a server that already has it adds nothing.
 */
function splitLines(text: string): string[] {
  return text === "" ? [] : text.split("\n");
}

function tally(lines: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const line of lines) counts.set(line, (counts.get(line) || 0) + 1);
  return counts;
}

/** Matches NOTES_MAX_CHARS. A merged note past this stays as separate drafts. */
export const NOTES_MERGE_MAX_CHARS = 100_000;

/**
 * True when keeping `kept` together with any prior text it does not already
 * contain would pass the notes character limit.
 */
export function notesMergeExceedsLimit(parts: readonly string[], kept: string): boolean {
  if (kept.length > NOTES_MERGE_MAX_CHARS) return true;
  let extra = 0;
  for (const text of parts) {
    if (!text || kept.includes(text)) continue;
    extra += text.length;
  }
  return extra > 0 && kept.length + extra > NOTES_MERGE_MAX_CHARS;
}

/** Drop blank lines at the ends. Never erase a non-empty merge down to "". */
export function trimEdgeBlankLines(text: string): string {
  if (!text) return text;
  const lines = text.split("\n");
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start] === "") start += 1;
  while (end > start && lines[end - 1] === "") end -= 1;
  if (start >= end) return text;
  return lines.slice(start, end).join("\n");
}

/**
 * A 409 whose server text is the base, or any text this draft already sent,
 * means that earlier text landed. The rep's text then wins exactly.
 * Server text that contains a sent line plus someone else's edit uses the
 * line rule, so that sent line is not written twice.
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

/**
 * Append edit lines the server does not already have.
 * Non-blank lines use multiset counts. Blank lines are kept when they sit
 * with a line that is actually appended, and are never dropped just because
 * the server has some other blank line.
 * Returns the current text unchanged when nothing is appended, so a replay
 * against that result adds nothing.
 */
function mergeNoteLines(current: string, edit: string): string {
  if (!edit) return current ? trimEdgeBlankLines(current) : current;
  if (!current) return trimEdgeBlankLines(edit);
  const ourLines = splitLines(edit);
  const currentLines = splitLines(current);
  const present = tally(currentLines.filter((line) => line !== ""));
  const extras: string[] = [];
  let pendingBlanks: string[] = [];
  for (const line of ourLines) {
    if (line === "") {
      pendingBlanks.push("");
      continue;
    }
    const have = present.get(line) || 0;
    if (have > 0) {
      present.set(line, have - 1);
      pendingBlanks = [];
      continue;
    }
    extras.push(...pendingBlanks, line);
    pendingBlanks = [];
  }
  if (!extras.length) return current;
  return trimEdgeBlankLines([...currentLines, ...extras].join("\n"));
}

export function rebaseNotes(baseNotes: string, edited: string, currentNotes: string): { notes: string; baseNotes: string } {
  const base = baseNotes || "";
  const current = currentNotes || "";
  const edit = edited || "";
  if (current === base) {
    // An edit that only repeats the server text plus edge blanks is already stored.
    if (edit && trimEdgeBlankLines(edit) === current && mergeNoteLines(current, edit) === current)
      return { notes: current, baseNotes: current };
    return { notes: edit, baseNotes: current };
  }
  if (!edit) return { notes: trimEdgeBlankLines(current), baseNotes: current };
  return { notes: mergeNoteLines(current, edit), baseNotes: current };
}

/**
 * A clear was rejected, so the server still has the clear's base. Append the
 * new typing onto that text even when the two are equal, and drop a leading
 * newline the empty editor left in front of the new line.
 */
export function appendTypedOnto(serverText: string, typed: string): string {
  const current = serverText || "";
  const edit = trimEdgeBlankLines(typed || "");
  if (!edit.trim()) return current;
  if (!current) return edit;
  return mergeNoteLines(current, edit);
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
