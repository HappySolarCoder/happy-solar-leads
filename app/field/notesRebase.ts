/**
 * Line diff3 for a notes edit (NOTES-MERGE-SPEC, 2026-10-26).
 * Both sides are aligned to the base with an LCS line diff, so a typed line
 * equal to a base line is still an insert. A base line matched on both sides
 * is stable. Between stable lines:
 * - only current changed: current's lines;
 * - only ours changed: ours's lines;
 * - both made the same change: written once;
 * - otherwise the hunks overlap: current's lines (minus base lines ours
 *   deleted or edited), then the lines ours inserted. A base line ours only
 *   kept is not written again, so a line the server deleted stays deleted.
 *   A non-blank inserted line that current's hunk also inserted is written
 *   once. Typed blank lines stay while that hunk still adds typed text.
 *   An insert next to a base line the server edited or deleted is part of
 *   that overlap, current's hunk first.
 * On top of that (compared after trimming edge blank lines): current===base,
 * or current in knownSentNotes, means the edit wins. ours===base means current
 * wins. current===ours is already stored. Every result has its leading and
 * trailing blank lines trimmed; a line of only spaces or tabs counts as blank
 * for that. Two non-blank inputs never collapse to a blank result: current wins.
 * The same inputs always return the same text. Replaying the result adds nothing.
 */
function splitLines(text: string): string[] {
  return text === "" ? [] : text.split("\n");
}

function tally(lines: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const line of lines) counts.set(line, (counts.get(line) || 0) + 1);
  return counts;
}

/**
 * LCS alignment. match[i] is the index in `next` that base[i] aligns with,
 * or -1. A match is preferred, so a repeated line aligns with the earliest
 * equal line.
 */
function alignToBase(base: readonly string[], next: readonly string[]): number[] {
  const n = base.length;
  const m = next.length;
  const match = new Array<number>(n).fill(-1);
  if (!n || !m) return match;
  const width = m + 1;
  const dp = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i * width + j] = base[i] === next[j]
        ? dp[(i + 1) * width + j + 1] + 1
        : Math.max(dp[(i + 1) * width + j], dp[i * width + j + 1]);
    }
  }
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (base[i] === next[j] && dp[i * width + j] === dp[(i + 1) * width + j + 1] + 1) {
      match[i] = j;
      i += 1;
      j += 1;
    } else if (dp[(i + 1) * width + j] >= dp[i * width + j + 1]) i += 1;
    else j += 1;
  }
  return match;
}

function sameLines(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) if (a[index] !== b[index]) return false;
  return true;
}

/** Blank: whitespace only by JS trim() (NOTES-MERGE-SPEC B1). */
function isBlankLine(line: string): boolean {
  return line.trim() === "";
}

/** Drop blank (whitespace-only) lines at the ends. Only blank lines gives "". */
export function trimEdgeBlankLines(text: string): string {
  if (!text) return text;
  const lines = text.split("\n");
  let start = 0;
  let end = lines.length;
  while (start < end && isBlankLine(lines[start])) start += 1;
  while (end > start && isBlankLine(lines[end - 1])) end -= 1;
  return lines.slice(start, end).join("\n");
}

/** Same notes once edge blank lines are trimmed (no write needed). */
export function sameNotes(a: string | undefined, b: string | undefined): boolean {
  return trimEdgeBlankLines(a || "") === trimEdgeBlankLines(b || "");
}

/**
 * Overlapping hunks: current's lines, then ours's inserted lines.
 * Base lines current kept but ours deleted or edited take ours (dropped).
 * A non-blank insert current's hunk also inserted is written once.
 * Blank (whitespace-only) lines are never deduped (B2).
 */
function overlap(
  currentLines: readonly string[],
  currentKeptBase: readonly boolean[],
  oursInserted: readonly string[],
  baseLoOurs: (index: number) => boolean,
): string[] {
  const out: string[] = [];
  const currentInserted = new Map<string, number>();
  for (let index = 0; index < currentLines.length; index += 1) {
    if (currentKeptBase[index]) {
      if (baseLoOurs(index)) out.push(currentLines[index]);
      continue;
    }
    out.push(currentLines[index]);
    const line = currentLines[index];
    if (!isBlankLine(line)) currentInserted.set(line, (currentInserted.get(line) || 0) + 1);
  }
  for (const line of oursInserted) {
    const seen = isBlankLine(line) ? 0 : currentInserted.get(line) || 0;
    if (seen > 0) currentInserted.set(line, seen - 1);
    else out.push(line);
  }
  return out;
}

/**
 * Every input is edge-trimmed first. Rules 1-3 compare the trimmed texts and
 * return one side: current===base gives ours; ours===base or current===ours
 * gives current. Rule 4 runs diff3 on the trimmed texts and trims the result
 * (rule 5). Two non-blank inputs that merge to blank give current (nothing to send).
 */
export function diff3NoteLines(baseText: string, currentText: string, oursText: string): string {
  const trimmedBase = trimEdgeBlankLines(baseText);
  const trimmedCurrent = trimEdgeBlankLines(currentText);
  const trimmedOurs = trimEdgeBlankLines(oursText);
  if (trimmedCurrent === trimmedBase) return trimmedOurs;
  if (trimmedOurs === trimmedBase || trimmedCurrent === trimmedOurs) return trimmedCurrent;
  const base = splitLines(trimmedBase);
  const current = splitLines(trimmedCurrent);
  const ours = splitLines(trimmedOurs);
  const toOurs = alignToBase(base, ours);
  const toCurrent = alignToBase(base, current);
  const out: string[] = [];
  let i = 0;
  let o = 0;
  let c = 0;
  for (;;) {
    if (i < base.length && toOurs[i] === o && toCurrent[i] === c) {
      out.push(base[i]);
      i += 1;
      o += 1;
      c += 1;
      continue;
    }
    let k = i;
    while (k < base.length && (toOurs[k] < 0 || toCurrent[k] < 0)) k += 1;
    const oEnd = k < base.length ? toOurs[k] : ours.length;
    const cEnd = k < base.length ? toCurrent[k] : current.length;
    const baseChunk = base.slice(i, k);
    const oursChunk = ours.slice(o, oEnd);
    const currentChunk = current.slice(c, cEnd);
    if (sameLines(oursChunk, baseChunk)) out.push(...currentChunk);
    else if (sameLines(currentChunk, baseChunk) || sameLines(currentChunk, oursChunk)) out.push(...oursChunk);
    else {
      const oursKept = new Set<number>();
      for (let b = i; b < k; b += 1) if (toOurs[b] >= 0) oursKept.add(b);
      const currentBaseAt = new Map<number, number>();
      for (let b = i; b < k; b += 1) if (toCurrent[b] >= 0) currentBaseAt.set(toCurrent[b] - c, b);
      const oursMatched = new Set<number>();
      for (let b = i; b < k; b += 1) if (toOurs[b] >= 0) oursMatched.add(toOurs[b] - o);
      out.push(...overlap(
        currentChunk,
        currentChunk.map((_, index) => currentBaseAt.has(index)),
        oursChunk.filter((_, index) => !oursMatched.has(index)),
        (index) => oursKept.has(currentBaseAt.get(index) as number),
      ));
    }
    if (k >= base.length) break;
    i = k;
    o = oEnd;
    c = cEnd;
  }
  const merged = trimEdgeBlankLines(out.join("\n"));
  return merged || !trimmedOurs ? merged : trimmedCurrent;
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

/**
 * A 409 whose server text is the base, or any text this draft already sent,
 * means that earlier text landed. The rep's text then wins exactly.
 * Server text that moved uses the same diff3 as every other notes merge.
 */
export function notesAfterConflict(
  draft: { notes?: string; baseNotes?: string; knownSentNotes?: readonly string[] },
  currentNotes: string,
): { notes: string; baseNotes: string } {
  const edited = draft.notes || "";
  const base = draft.baseNotes || "";
  const known = draft.knownSentNotes || [];
  if (sameNotes(currentNotes, base) || known.some((text) => sameNotes(text, currentNotes)))
    return { notes: trimEdgeBlankLines(edited), baseNotes: currentNotes };
  return rebaseNotes(base, edited, currentNotes);
}

/** NOTES-MERGE-SPEC V4: shown when a clear met newer notes and other people's lines were kept. */
export const NOTES_CLEAR_KEPT_NOTICE = "Notes changed on another device. Other people's new notes were kept.";

/**
 * NOTES-MERGE-SPEC V4: a clear that met a 409 (the server notes moved) is ours = "".
 * Returns diff3(base, current, "") with edge blank lines trimmed: base lines are
 * deleted, lines the server added are kept. "" means clear (current is a text
 * this draft sent, or nothing but base lines and blank lines remain).
 */
export function clearAfterConflict(
  draft: { baseNotes?: string; knownSentNotes?: readonly string[] },
  currentNotes: string,
): string {
  // specOracle clearConflict(base, current) = specMerge(base, current, ''). "Decisions v4 answers": when current is a
  // text this device already sent (knownSentNotes), rule 1 applies and the clear lands as ''.
  return notesAfterConflict({ notes: "", baseNotes: draft.baseNotes, knownSentNotes: draft.knownSentNotes }, currentNotes).notes;
}

export function rebaseNotes(baseNotes: string, edited: string, currentNotes: string): { notes: string; baseNotes: string } {
  const base = baseNotes || "";
  const current = currentNotes || "";
  const edit = edited || "";
  return { notes: diff3NoteLines(base, current, edit), baseNotes: current };
}

/**
 * A clear was rejected, so the server still has the clear's base. Append the
 * new typing onto that text. The empty editor's leading newline is not part
 * of the typed line.
 */
export function appendTypedOnto(serverText: string, typed: string): string {
  const current = serverText || "";
  const edit = trimEdgeBlankLines(typed || "");
  if (!edit) return current;
  if (!current) return edit;
  return diff3NoteLines("", current, edit);
}

/**
 * The text a notes save sends: the editor's text with edge blank lines trimmed
 * (NOTES-MERGE-SPEC E1/G1: "\nC1" is sent as "C1", never appended onto the
 * base, and no leading or trailing blank line is ever sent). A clear stays "".
 */
export function notesAgainstBase(_baseNotes: string, notes: string): string {
  return trimEdgeBlankLines(notes || "");
}

/**
 * Idempotent notes write. The edit is the diff3 of base, server, and the
 * typed text. A replay whose text already matches does not write again.
 */
export function notesTransactionPatch(
  currentNotes: string | undefined,
  baseNotes: string | undefined,
  edited: string,
): { notes: string; replayed: boolean } {
  const current = currentNotes || "";
  const base = baseNotes || "";
  const prepared = notesAgainstBase(base, edited);
  const applied = rebaseNotes(base, prepared, current);
  return { notes: applied.notes, replayed: sameNotes(applied.notes, current) };
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
    if (sameNotes(current, input.appliedNotes)) {
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
      replayed: sameNotes(next.notes, current),
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
