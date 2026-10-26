/**
 * Combine a notes edit with the text on the server.
 * Server text still equals baseNotes: the edit wins exactly, including a
 * deletion or a full rewrite.
 * Otherwise the lines we added, minus lines already in the server text, are
 * appended to that text. A line the server already has is not written again.
 * A pure deletion keeps the server text and restores a kept line the server
 * dropped. Both versions stay when we and the server rewrote the same line.
 * Leading and trailing blank lines of a merge are removed. Blank lines inside
 * the text stay. A merge that is only blank lines is left as it is.
 * An empty edit does not wipe a server change.
 */
function splitLines(text: string): string[] {
  return text === "" ? [] : text.split("\n");
}

function tally(lines: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const line of lines) counts.set(line, (counts.get(line) || 0) + 1);
  return counts;
}

function multisetDiff(source: readonly string[], subtract: readonly string[]): string[] {
  const left = tally(subtract);
  const out: string[] = [];
  for (const line of source) {
    const n = left.get(line) || 0;
    if (n > 0) left.set(line, n - 1);
    else out.push(line);
  }
  return out;
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

export function rebaseNotes(baseNotes: string, edited: string, currentNotes: string): { notes: string; baseNotes: string } {
  const base = baseNotes || "";
  const current = currentNotes || "";
  const edit = edited || "";
  if (current === base) return { notes: edit, baseNotes: current };
  if (!current) return { notes: trimEdgeBlankLines(edit), baseNotes: current };
  if (!edit) return { notes: trimEdgeBlankLines(current), baseNotes: current };
  // Our text already begins with the server text. Keep that tail once.
  if (edit.startsWith(current))
    return { notes: edit.length === current.length ? current : trimEdgeBlankLines(edit), baseNotes: current };

  const baseLines = splitLines(base);
  const ourLines = splitLines(edit);
  const currentLines = splitLines(current);
  const weAdded = multisetDiff(ourLines, baseLines);
  const ourCounts = tally(ourLines);
  const present = tally(currentLines);
  // New lines are appended once. A line the server already has is not written
  // again. A pure deletion restores a kept line the server dropped.
  const extras: string[] = [];
  for (const line of (weAdded.length > 0 ? weAdded : ourLines)) {
    const have = present.get(line) || 0;
    const cap = ourCounts.get(line) || 0;
    if (have >= cap) continue;
    extras.push(line);
    present.set(line, have + 1);
  }
  return { notes: trimEdgeBlankLines([...currentLines, ...extras].join("\n")), baseNotes: current };
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
