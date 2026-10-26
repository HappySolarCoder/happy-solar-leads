/**
 * Line diff3 for a notes edit.
 * Diff base→current and base→ours with an LCS line diff, then apply both
 * edit scripts. A line neither side changed is kept once. A change on only
 * one side is that side's text. When the hunks overlap, current's text comes
 * first and ours's changed lines follow. A non-blank ours line already
 * covered by current's change is not written again. A typed blank between
 * two lines that are actually appended stays. An insert at the end of a
 * replacement is part of that overlap, so a server edit and a typed tail
 * both survive. A base line the server deleted is not put back, because it
 * is not a line ours inserted.
 * On top of that: current===base, or current in knownSentNotes, means the
 * edit wins exactly. ours===base means current wins. Only leading and
 * trailing blank lines are trimmed. Two non-blank inputs never collapse to
 * a blank result.
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

type Hunk = { lo: number; hi: number; lines: string[] };

/** Shortest line edit. A match is preferred, so a repeated line aligns with the earliest equal line. */
function diffHunks(base: readonly string[], next: readonly string[]): Hunk[] {
  const n = base.length;
  const m = next.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] = base[i] === next[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const hunks: Hunk[] = [];
  let i = 0;
  let j = 0;
  let lo = -1;
  let hi = -1;
  let lines: string[] = [];
  const flush = () => {
    if (lo < 0) return;
    hunks.push({ lo, hi: hi < 0 ? lo : hi, lines });
    lo = -1;
    hi = -1;
    lines = [];
  };
  while (i < n && j < m) {
    if (base[i] === next[j] && dp[i][j] === dp[i + 1][j + 1] + 1) {
      flush();
      i += 1;
      j += 1;
      continue;
    }
    if (lo < 0) lo = i;
    if (dp[i + 1][j] >= dp[i][j + 1]) {
      hi = i + 1;
      i += 1;
    } else {
      if (hi < 0) hi = i;
      lines.push(next[j]);
      j += 1;
    }
  }
  while (i < n) {
    if (lo < 0) lo = i;
    hi = i + 1;
    i += 1;
  }
  while (j < m) {
    if (lo < 0) lo = n;
    if (hi < 0) hi = n;
    lines.push(next[j]);
    j += 1;
  }
  flush();
  return hunks;
}

function touches(span: { lo: number; hi: number }, hunk: Hunk): boolean {
  if (hunk.lo === hunk.hi) return hunk.lo >= span.lo && hunk.lo <= span.hi;
  if (span.lo === span.hi) return span.lo >= hunk.lo && span.lo <= hunk.hi;
  return hunk.lo <= span.hi && span.lo <= hunk.hi;
}

/** Lines this side writes for base[lo, hi), plus an insert sitting on hi. */
function linesFor(
  base: readonly string[],
  hunks: readonly Hunk[],
  lo: number,
  hi: number,
  includeMatches: boolean,
): string[] {
  const chosen = hunks.filter((hunk) =>
    (hunk.lo === hunk.hi && hunk.lo >= lo && hunk.lo <= hi)
    || (hunk.lo < hi && hunk.hi > lo)
  ).slice().sort((a, b) => a.lo - b.lo || a.hi - b.hi);
  const out: string[] = [];
  let index = lo;
  for (const hunk of chosen) {
    if (includeMatches) {
      while (index < hunk.lo && index < hi) {
        out.push(base[index]);
        index += 1;
      }
    }
    out.push(...hunk.lines);
    if (hunk.hi > index) index = Math.min(hi, hunk.hi);
  }
  if (includeMatches) {
    while (index < hi) {
      out.push(base[index]);
      index += 1;
    }
  }
  return out;
}

/**
 * current's lines, then ours's changed lines that current's own change does
 * not already have. Blanks stay only between two appended lines.
 */
function appendChanged(currentFull: readonly string[], currentChanges: readonly string[], oursDelta: readonly string[]): string[] {
  const have = tally(currentChanges.filter((line) => line !== ""));
  const keep = oursDelta.map((line) => {
    if (line === "") return false;
    const seen = have.get(line) || 0;
    if (seen > 0) {
      have.set(line, seen - 1);
      return false;
    }
    return true;
  });
  const extras: string[] = [];
  for (let index = 0; index < oursDelta.length; index += 1) {
    const line = oursDelta[index];
    if (line !== "") {
      if (keep[index]) extras.push(line);
      continue;
    }
    let before = false;
    let after = false;
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      if (oursDelta[cursor] === "") continue;
      before = keep[cursor];
      break;
    }
    for (let cursor = index + 1; cursor < oursDelta.length; cursor += 1) {
      if (oursDelta[cursor] === "") continue;
      after = keep[cursor];
      break;
    }
    if (before && after) extras.push("");
  }
  return [...currentFull, ...extras];
}

function isLinePrefix(base: readonly string[], current: readonly string[]): boolean {
  if (!current.length || current.length > base.length) return false;
  for (let index = 0; index < current.length; index += 1) {
    if (current[index] !== base[index]) return false;
  }
  return current.length < base.length;
}

/** Ours still begins with the base, then adds lines. The base was not rewritten. */
function extendsBase(base: readonly string[], ours: readonly string[]): boolean {
  if (ours.length < base.length) return false;
  for (let index = 0; index < base.length; index += 1) {
    if (ours[index] !== base[index]) return false;
  }
  return true;
}

function hasNonBlank(lines: readonly string[]): boolean {
  return lines.some((line) => line !== "");
}

/** Drop blank lines at the ends. A merge that is only blank lines stays as it is. */
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
 * A line may appear at most as often as the stricter of "either side" and
 * "what current already has, plus what ours added beyond the base".
 */
function capLineCounts(lines: readonly string[], base: readonly string[], current: readonly string[], ours: readonly string[]): string[] {
  const baseCounts = tally(base.filter((line) => line !== ""));
  const currentCounts = tally(current.filter((line) => line !== ""));
  const oursCounts = tally(ours.filter((line) => line !== ""));
  const used = new Map<string, number>();
  const kept: string[] = [];
  for (const line of lines) {
    if (line === "") {
      kept.push(line);
      continue;
    }
    const currentCount = currentCounts.get(line) || 0;
    const oursCount = oursCounts.get(line) || 0;
    const added = Math.max(0, oursCount - (baseCounts.get(line) || 0));
    // max(current, added) is a fixed point: a replay sees this count as current
    // and does not append another copy. It is still within current+added.
    const cap = Math.max(currentCount, added);
    const seen = used.get(line) || 0;
    if (seen >= cap) continue;
    used.set(line, seen + 1);
    kept.push(line);
  }
  return kept;
}

function finishMerge(lines: string[], base: readonly string[], current: readonly string[], ours: readonly string[]): string {
  const capped = capLineCounts(lines, base, current, ours);
  let text = capped.join("\n");
  if (!hasNonBlank(capped) && hasNonBlank(current) && hasNonBlank(ours)) {
    text = current.join("\n");
  }
  return trimEdgeBlankLines(text);
}

/** Ours-only lines, skipping a non-blank line the merge has already emitted. */
function appendUncovered(already: readonly string[], oursDelta: readonly string[]): string[] {
  return appendChanged(already, already, oursDelta).slice(already.length);
}

/**
 * Apply both line edit scripts. Overlapping hunks emit current, then the
 * ours lines that hunk added.
 */
export function diff3NoteLines(baseText: string, currentText: string, oursText: string): string {
  const base = splitLines(baseText);
  const current = splitLines(currentText);
  const ours = splitLines(oursText);
  if (oursText === baseText) return finishMerge(current.slice(), base, current, ours);
  // The server is still a prefix of the base and the edit kept every base line.
  // Those lines were not deleted on the server; the save has not landed yet.
  if (isLinePrefix(base, current) && extendsBase(base, ours)) return trimEdgeBlankLines(oursText);
  const currentHunks = diffHunks(base, current);
  const oursHunks = diffHunks(base, ours);
  const out: string[] = [];
  let pos = 0;
  const usedCurrent = new Set<number>();
  const usedOurs = new Set<number>();
  const nextHunk = (hunks: Hunk[], used: Set<number>, at: number) =>
    hunks.findIndex((hunk, index) => !used.has(index) && hunk.lo === at);

  while (pos <= base.length) {
    const currentIndex = nextHunk(currentHunks, usedCurrent, pos);
    const oursIndex = nextHunk(oursHunks, usedOurs, pos);
    if (currentIndex < 0 && oursIndex < 0) {
      if (pos < base.length) out.push(base[pos]);
      pos += 1;
      continue;
    }
    const span = { lo: pos, hi: pos };
    const takenCurrent: number[] = [];
    const takenOurs: number[] = [];
    let grew = true;
    while (grew) {
      grew = false;
      currentHunks.forEach((hunk, index) => {
        if (usedCurrent.has(index) || takenCurrent.includes(index) || !touches(span, hunk)) return;
        takenCurrent.push(index);
        span.lo = Math.min(span.lo, hunk.lo);
        span.hi = Math.max(span.hi, hunk.hi);
        grew = true;
      });
      oursHunks.forEach((hunk, index) => {
        if (usedOurs.has(index) || takenOurs.includes(index) || !touches(span, hunk)) return;
        takenOurs.push(index);
        span.lo = Math.min(span.lo, hunk.lo);
        span.hi = Math.max(span.hi, hunk.hi);
        grew = true;
      });
    }
    for (const index of takenCurrent) usedCurrent.add(index);
    for (const index of takenOurs) usedOurs.add(index);
    const currentPicked = takenCurrent.map((index) => currentHunks[index]);
    const oursPicked = takenOurs.map((index) => oursHunks[index]);
    const currentFull = linesFor(base, currentPicked, span.lo, span.hi, true);
    const currentChanges = linesFor(base, currentPicked, span.lo, span.hi, false);
    const oursDelta = linesFor(base, oursPicked, span.lo, span.hi, false);
    if (takenCurrent.length && takenOurs.length) out.push(...appendChanged(currentFull, currentChanges, oursDelta));
    else if (takenCurrent.length) out.push(...currentFull);
    else if (!oursDelta.length && span.hi > span.lo) {
      for (let index = span.lo; index < span.hi; index += 1) out.push(base[index]);
    } else out.push(...appendUncovered(out, oursDelta));
    // A zero-width insert sits before base[span.lo]. That line is still ahead.
    pos = span.lo === span.hi ? span.lo : span.hi;
    if (pos === span.lo && span.lo === span.hi && pos === base.length) pos += 1;
  }
  return finishMerge(out, base, current, ours);
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
  if (currentNotes === base || known.includes(currentNotes))
    return { notes: trimEdgeBlankLines(edited), baseNotes: currentNotes };
  return rebaseNotes(base, edited, currentNotes);
}

function nonBlankCounts(text: string): Map<string, number> {
  return tally(splitLines(text).filter((line) => line !== ""));
}

/**
 * True when the editor was empty and the rep typed new lines under a leading
 * blank ("\nC1"). Those lines are not in the anchor text.
 */
function isLeadingFragment(anchor: string, edit: string): boolean {
  if (!anchor || !edit.startsWith("\n")) return false;
  const anchorCounts = nonBlankCounts(anchor);
  let added = false;
  for (const line of splitLines(edit)) {
    if (line === "") continue;
    if ((anchorCounts.get(line) || 0) > 0) return false;
    added = true;
  }
  return added;
}

export function rebaseNotes(baseNotes: string, edited: string, currentNotes: string): { notes: string; baseNotes: string } {
  const base = baseNotes || "";
  const current = currentNotes || "";
  const edit = edited || "";
  if (current === base) return { notes: trimEdgeBlankLines(edit), baseNotes: current };
  if (!edit || edit === base) return { notes: trimEdgeBlankLines(current), baseNotes: current };
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
  if (!edit.trim()) return current;
  if (!current) return edit;
  return diff3NoteLines("", current, edit);
}

/** A "\nC1" fragment is appended onto the anchor. Any other edit is unchanged. */
export function notesAgainstBase(baseNotes: string, notes: string): string {
  const base = baseNotes || "";
  const edit = notes || "";
  if (!isLeadingFragment(base, edit)) return edit;
  return appendTypedOnto(base, edit);
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
