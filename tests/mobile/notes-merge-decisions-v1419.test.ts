import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NOTES_CLEAR_KEPT_NOTICE, clearAfterConflict, diff3NoteLines, notesAfterConflict, notesAgainstBase, sameNotes } from "../../app/field/notesRebase";
import { blankNotesUnflagged, NOTES_CLEAR_PENDING_MESSAGE, NOTES_MAX_SENDS, postFieldDispo, resetLandedNotes } from "../../app/field/serverDispo";
import type { PendingMutation } from "../../app/field/types";
import type { User } from "../../app/types";

// The shared NOTES-MERGE-SPEC Decisions v2 + v3 + v4 unit cases (E1, B1, B2, T1, G1, V4) and the
// "Decisions v4 answers" cases (v5-Own, v5-Repeat, v5-blankSentUnflagged) and the
// "Decisions v5 rulings" cases (v6-chain intent form with a typed draft, v6-sweepBlank).
// fixtures/notes-merge-decisions.json is a verbatim copy of the spec oracle's
// unitDecisions.json. Each case runs through the 409 path (notesAfterConflict,
// with knownSent) and, without knownSent, through diff3NoteLines.
// write = the merged text differs from the server's.
type Case = { id: string; decision: string; kind?: string; base: string; cur: string; ours: string; known?: string[]; expect: { notes: string; write: boolean } };
type ClearCase = { id: string; decision: string; kind: "clearConflict"; base: string; cur: string; known?: string[]; expect: { result: string; mode: "notes" | "clear"; body: { notes: string; baseNotes: string; clearNotes?: true }; notice: string | null } };
type Body = { notes: string; baseNotes: string; clearNotes?: true };
type ChainCase = { id: string; decision: string; kind: "chain"; mode?: "intent" | "draft"; base: string; currents: string[]; known?: string[]; draft?: string; expect: { bodies: Body[]; final: string } };
type SweepBlankCase = { id: string; decision: string; kind: "sweepBlank"; result: string; expected: string; expect: "exempt" | "unflagged" | null };
type BlankCase = { id: string; decision: string; kind: "blankSent"; body: unknown; expect: boolean };
const all: (Case | ClearCase | ChainCase | BlankCase | SweepBlankCase)[] = JSON.parse(readFileSync(new URL("./fixtures/notes-merge-decisions.json", import.meta.url), "utf8"));
const cases = all.filter((c): c is Case => !c.kind);
const clearCases = all.filter((c): c is ClearCase => c.kind === "clearConflict");
const chainCases = all.filter((c): c is ChainCase => c.kind === "chain");
const blankCases = all.filter((c): c is BlankCase => c.kind === "blankSent");
const sweepBlankCases = all.filter((c): c is SweepBlankCase => c.kind === "sweepBlank");
const user = { id: "rep-m", name: "Manager", role: "manager" } as User;
const clearDraft = (id: string, base: string, known: string[] = []): PendingMutation => ({
  id: `clear-${id}`, userId: user.id, userName: user.name, leadId: "lead-1", createdAt: "2026-10-26T12:00:00.000Z",
  kind: "notes", baseStatus: "claimed", baseNotes: base, notes: "", clearNotes: true, syncState: "queued", attempts: 0,
  ...(known.length ? { knownSentNotes: known } : {}),
  direct: { patch: { notes: "" }, serverDispo: true },
});
const typedDraft = (id: string, notes: string, base: string, known: string[] = []): PendingMutation => ({
  id: `typed-${id}`, userId: user.id, userName: user.name, leadId: "lead-1", createdAt: "2026-10-26T12:00:00.000Z",
  kind: "notes", baseStatus: "claimed", baseNotes: base, notes, syncState: "queued", attempts: 0,
  ...(known.length ? { knownSentNotes: known } : {}),
  direct: { patch: { notes }, serverDispo: true },
});
const wire = (b: Record<string, unknown>) => ({ notes: b.notes, baseNotes: b.baseNotes, ...(b.clearNotes ? { clearNotes: b.clearNotes } : {}) });

test("the Decisions v2 + v3 unit cases all hold", () => {
  assert.equal(all.length, 80);
  assert.equal(cases.length, 43);
  for (const c of cases) {
    const notes = notesAfterConflict({ notes: c.ours, baseNotes: c.base, knownSentNotes: c.known || [] }, c.cur).notes;
    assert.equal(notes, c.expect.notes, `${c.decision} ${c.id}`);
    assert.equal(!sameNotes(notes, c.cur), c.expect.write, `${c.decision} ${c.id} write`);
    if (!(c.known || []).length) assert.equal(diff3NoteLines(c.base, c.cur, c.ours), c.expect.notes, `${c.decision} ${c.id} diff3`);
  }
});

test("E1/G1: a notes save never sends an edge blank line (JS trim() whitespace)", () => {
  for (const [edit, sent] of [
    ["\nC1", "C1"], ["\n\nC1\n", "C1"], ["\r\nC1", "C1"], [" \u00a0\nC1\n\u2028", "C1"],
    ["\ufeff\nS\n\nA1\n\t", "S\n\nA1"], ["", ""], ["\u0085\nC1", "\u0085\nC1"],
  ] as const) {
    assert.equal(notesAgainstBase("S\nA1", edit), sent, JSON.stringify(edit));
    assert.equal(notesAgainstBase("", edit), sent, JSON.stringify(edit));
  }
});

test("V4 + v5-Own: the clearConflict unit cases hold on the client's 409 path (result, one POST body, notice)", async () => {
  assert.equal(clearCases.length, 15);
  for (const c of clearCases) {
    assert.equal(clearAfterConflict({ baseNotes: c.base, knownSentNotes: c.known || [] }, c.cur), c.expect.result, c.id);
    const bodies: Record<string, unknown>[] = [];
    const draft = clearDraft(c.id, c.base, c.known || []);
    const result = await postFieldDispo(draft, user, {
      getToken: async () => "token",
      post: async (_path, init) => {
        bodies.push(JSON.parse(String(init?.body)));
        return bodies.length === 1
          ? new Response(JSON.stringify({ ok: false, reasonCode: "notes_conflict", currentNotes: c.cur }), { status: 409 })
          : new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
    });
    if (!c.cur.trim()) {
      // C6-1 (11:14 AM): the merge trims to '' and current is already '', so it has landed and nothing is sent.
      // clearAfterConflict above still equals the oracle's result; only the (unreachable on 15efe05) follow-up POST is skipped.
      assert.equal(c.expect.result, "", c.id);
      assert.equal(bodies.length, 1, `${c.id}: C6-1 landed, no POST after the 409`);
      assert.equal((result as { replayed?: boolean }).replayed, true, c.id);
      continue;
    }
    assert.equal(bodies.length, 2, `${c.id}: one POST after the 409`);
    const sent = bodies[1];
    assert.deepEqual({ notes: sent.notes, baseNotes: sent.baseNotes, ...(sent.clearNotes ? { clearNotes: sent.clearNotes } : {}) }, c.expect.body, c.id);
    assert.equal(Object.prototype.hasOwnProperty.call(sent, "clearNotes"), c.expect.mode === "clear", `${c.id} clearNotes`);
    assert.equal(result.notice ?? null, c.expect.notice, `${c.id} notice`);
  }
  assert.equal(NOTES_CLEAR_KEPT_NOTICE, clearCases.find((c) => c.expect.notice)?.expect.notice);
});

test("v5-Repeat + v6 ruling 3: each 409 re-merges the original intent against the fresh current, <=3 sends per flush, then pending", async () => {
  assert.equal(chainCases.length, 8);
  for (const c of chainCases) {
    const draftText = c.draft ?? "";
    if (c.mode === "draft") {
      // Informational in the spec; the client follows the gated intent form.
      continue;
    }
    resetLandedNotes();
    // Stateless per current: the body after a 409 on current k is expect.bodies[k].
    c.currents.forEach((cur, k) => {
      const merged = draftText === ""
        ? clearAfterConflict({ baseNotes: c.base, knownSentNotes: c.known || [] }, cur)
        : notesAfterConflict({ notes: draftText, baseNotes: c.base, knownSentNotes: c.known || [] }, cur).notes;
      const b = c.expect.bodies[k];
      assert.equal(merged, b.notes, `${c.id} #${k}`);
      assert.equal(merged === "" ? true : undefined, b.clearNotes, `${c.id} #${k} clearNotes`);
    });
    // Wire: the server answers 409 with each current in turn; after that it answers 409 (with its notes) to a stale
    // baseNotes and 200 to a send based on its notes. Flushes repeat with the stored draft (the original intent).
    let served = 0; let server = c.base; let last409 = -1;
    const remerges: { k: number; body: Record<string, unknown> }[] = [];
    let flushes = 0; let done = false;
    while (!done && flushes < 6) {
      flushes += 1; let sends = 0; last409 = -1;
      const queued = draftText === "" ? clearDraft(c.id, c.base, c.known || []) : typedDraft(c.id, draftText, c.base, c.known || []);
      try {
        await postFieldDispo(queued, user, {
          getToken: async () => "token",
          post: async (_path, init) => {
            sends += 1;
            const body = JSON.parse(String(init?.body));
            assert.equal(blankNotesUnflagged(body), false, `${c.id}: blank notes always carry clearNotes`);
            if (last409 >= 0) remerges.push({ k: last409, body });
            if (served < c.currents.length) {
              last409 = served; server = c.currents[served++];
              return new Response(JSON.stringify({ ok: false, reasonCode: "notes_conflict", currentNotes: server }), { status: 409 });
            }
            if (!sameNotes(body.baseNotes ?? "", server)) {
              last409 = c.currents.length - 1;
              return new Response(JSON.stringify({ ok: false, reasonCode: "notes_conflict", currentNotes: server }), { status: 409 });
            }
            server = body.clearNotes === true ? "" : body.notes;
            return new Response(JSON.stringify({ ok: true }), { status: 200 });
          },
        });
        done = true;
      } catch (error) {
        assert.equal((error as Error).message, NOTES_CLEAR_PENDING_MESSAGE, `${c.id}: pending, not parked`);
      }
      assert.ok(sends <= NOTES_MAX_SENDS, `${c.id}: ${sends} sends in one flush`);
    }
    assert.ok(done, `${c.id}: lands on a later flush`);
    for (const r of remerges) assert.deepEqual(wire(r.body), c.expect.bodies[r.k], `${c.id}: re-merge after current #${r.k}`);
    // The last current always gets its re-merge sent, unless it is a no-op write (notes equal to its base, rule 3).
    const k = c.currents.length - 1; const b = c.expect.bodies[k];
    if (b.notes !== b.baseNotes || b.clearNotes) assert.ok(remerges.some((r) => r.k === k), `${c.id}: re-merge after the last current was sent`);
    assert.equal(server, c.expect.final, `${c.id} final`);
  }
});

test("v5-blankSentUnflagged: the client's wire check matches the unit cases (JS trim set, clearNotes must be true)", () => {
  assert.equal(blankCases.length, 8);
  for (const c of blankCases) assert.equal(blankNotesUnflagged(c.body), c.expect, c.id);
});

test("v6-sweepBlank: a blank merge goes out only as the flagged clear '' (exempt); whitespace-only blanks never go out", () => {
  assert.equal(sweepBlankCases.length, 6);
  for (const c of sweepBlankCases) {
    if (c.expect === null) {
      // Not blank under JS trim: sent as plain notes, and the wire check lets it through.
      assert.equal(blankNotesUnflagged({ notes: c.result }), false, c.id);
      continue;
    }
    // Blank under JS trim: as plain notes the wire check always blocks it.
    assert.equal(blankNotesUnflagged({ notes: c.result }), true, c.id);
    // Only the exact '' can go out, and only as a flagged clear; the spec must also expect '' (exempt).
    const flaggable = c.result === "" && blankNotesUnflagged({ notes: c.result, clearNotes: true }) === false;
    assert.equal(flaggable && c.expected === "" ? "exempt" : "unflagged", c.expect, c.id);
  }
});
