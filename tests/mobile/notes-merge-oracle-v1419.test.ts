import test from "node:test";
import assert from "node:assert/strict";
import { diff3NoteLines, rebaseNotes } from "../../app/field/notesRebase";

// NOTES-MERGE-SPEC (Raydar Mobile, 2026-10-26) with the 9:40 AM and 9:51 AM MST Decisions.
// Reference merge, written apart from the app code. It follows the shared
// oracle (harness/specOracle.ts, Decisions v2) plus B1/B2: inputs edge-trimmed
// first (blank = line.trim() === "", B1), rules 1-3 on the trimmed texts,
// diff3 with the earliest-copy LCS (tie: skip the base line first, T1), blank
// lines never deduped (B2), and a trimmed result (Decision 4, E1, G1).
const lines = (text: string): string[] => (text === "" ? [] : text.split("\n"));
const blank = (line: string) => line.trim() === "";
const same = (a: string[], b: string[]) => a.length === b.length && a.every((line, k) => line === b[k]);

function trim(text: string): string {
  const all = lines(text);
  let start = 0;
  let end = all.length;
  while (start < end && blank(all[start])) start += 1;
  while (end > start && blank(all[end - 1])) end -= 1;
  return all.slice(start, end).join("\n");
}

// Earliest-copy LCS: equal heads always match; on a tie skip the base line.
function lcs(a: string[], b: string[]): number[] {
  const n = a.length;
  const m = b.length;
  const table: Int32Array[] = [];
  for (let i = 0; i <= n; i += 1) table.push(new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const map = new Array<number>(n).fill(-1);
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { map[i] = j; i += 1; j += 1; }
    else if (table[i + 1][j] >= table[i][j + 1]) i += 1;
    else j += 1;
  }
  return map;
}

function referenceDiff3(baseText: string, currentText: string, oursText: string): string[] {
  const B = lines(baseText);
  const C = lines(currentText);
  const O = lines(oursText);
  const toC = lcs(B, C);
  const toO = lcs(B, O);
  const cMatched = new Set(toC.filter((x) => x >= 0));
  const oMatched = new Set(toO.filter((x) => x >= 0));
  const out: string[] = [];
  let b = 0;
  let c = 0;
  let o = 0;
  const region = (be: number, ce: number, oe: number) => {
    const Bs = B.slice(b, be);
    const Cs = C.slice(c, ce);
    const Os = O.slice(o, oe);
    const cChanged = !same(Cs, Bs);
    const oChanged = !same(Os, Bs);
    if (!cChanged && !oChanged) out.push(...Bs);
    else if (!oChanged || same(Cs, Os)) out.push(...Cs);
    else if (!cChanged) out.push(...Os);
    else {
      // Overlap: current's inserted lines, then ours's inserted lines minus
      // non-blank lines current's hunk also inserted (by count).
      const ci = Cs.filter((_, k) => !cMatched.has(c + k));
      const oi = Os.filter((_, k) => !oMatched.has(o + k));
      const left = new Map<string, number>();
      for (const line of ci) left.set(line, (left.get(line) || 0) + 1);
      out.push(...ci);
      for (const line of oi) {
        const count = left.get(line) || 0;
        if (count > 0 && !blank(line)) left.set(line, count - 1);
        else out.push(line);
      }
    }
  };
  for (let i = 0; i < B.length; i += 1) {
    if (toC[i] >= 0 && toO[i] >= 0) {
      region(i, toC[i], toO[i]);
      out.push(B[i]);
      b = i + 1;
      c = toC[i] + 1;
      o = toO[i] + 1;
    }
  }
  region(B.length, C.length, O.length);
  return out;
}

function referenceMerge(base: string, current: string, ours: string): string {
  const tb = trim(base);
  const tc = trim(current);
  const to = trim(ours);
  if (tc === tb) return to;
  if (to === tb || tc === to) return tc;
  const merged = trim(referenceDiff3(tb, tc, to).join("\n"));
  return !merged && tc && to ? tc : merged;
}

function generator(seed: number) {
  let state = seed;
  const rnd = () => (state = (state * 1103515245 + 12345) % 2147483648) / 2147483648;
  const pool = ["Gate code 1234", "Dog", "A1", "B1", "", "", " ", "\t", " \t", "\r", "\u00a0", "\u2003", " \r", "A1 ", "Dog in yard", "Admin", "C1"];
  const pick = () => pool[Math.floor(rnd() * pool.length)];
  const mutate = (from: string[]) => {
    const next = [...from];
    const edits = Math.floor(rnd() * 5);
    for (let q = 0; q < edits; q += 1) {
      const op = rnd();
      const at = Math.floor(rnd() * (next.length + 1));
      if (op < 0.4) next.splice(at, 0, pick());
      else if (op < 0.7 && next.length) next.splice(Math.min(at, next.length - 1), 1);
      else if (next.length) next[Math.min(at, next.length - 1)] = pick();
    }
    return next;
  };
  return () => {
    const base = Array.from({ length: Math.floor(rnd() * 8) }, pick);
    const side = () => (rnd() < 0.1 ? [...base] : mutate(base));
    const pad = (text: string) => (rnd() < 0.15 ? pick() + "\n" : "") + text + (rnd() < 0.15 ? "\n" + pick() : "");
    return [pad(base.join("\n")), pad(side().join("\n")), pad(side().join("\n"))] as const;
  };
}

test("diff3NoteLines equals the spec reference on 50,000 random cases", () => {
  const next = generator(20261026);
  let mismatches = 0;
  const examples: string[] = [];
  for (let n = 0; n < 50_000; n += 1) {
    const [base, current, ours] = next();
    const want = referenceMerge(base, current, ours);
    const got = diff3NoteLines(base, current, ours);
    const rebased = rebaseNotes(base, ours, current).notes;
    if (got !== want || rebased !== want) {
      mismatches += 1;
      if (examples.length < 5) examples.push(JSON.stringify({ base, current, ours, got, rebased, want }));
    }
  }
  assert.equal(mismatches, 0, examples.join("\n"));
});

test("the reference reproduces the spec rows", () => {
  const S = "Gate code 1234\nDog in yard";
  assert.equal(referenceMerge(S, "Gate code 1234", `${S}\nA1`), "Gate code 1234\nA1");
  assert.equal(referenceMerge(S, `${S}\n\nAdmin`, `${S}\n\nA1`), `${S}\n\nAdmin\n\nA1`);
  assert.equal(referenceMerge("A\nB", "A", "B"), "A");
  assert.equal(referenceMerge("S", "S\n", "S\nAdmin"), "S\nAdmin");
});
