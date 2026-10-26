// NOTES-MERGE-SPEC "Decisions v5 rulings" (rulings 1, 2, 3, 6) and the V4-answers pending retry.
import test from "node:test";
import assert from "node:assert/strict";
import { NOTES_CLEAR_PENDING_MESSAGE, NOTES_MAX_SENDS, blankNotesUnflagged, postFieldDispo, rememberLandedNotes, resetLandedNotes } from "../../app/field/serverDispo";
import { syncOutbox } from "../../app/field/syncOutbox";
import type { PendingMutation } from "../../app/field/types";
import type { User } from "../../app/types";

const at = "2026-10-26T12:00:00.000Z";
const atMs = Date.parse(at);
const rep = { id: "rep-v5", name: "Rep", role: "setter" } as User;
type Body = { draftId?: string; notes?: string; baseNotes?: string; clearNotes?: boolean };

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
const conflict = (currentNotes: string) => json(409, { ok: false, error: "conflict", reasonCode: "notes_conflict", currentNotes });

function draft(id: string, notes: string, base: string, extra: Partial<PendingMutation> = {}): PendingMutation {
  return {
    id, userId: rep.id, userName: rep.name, leadId: "lead-v5", createdAt: at, kind: "notes", baseStatus: "claimed",
    baseNotes: base, notes, syncState: "queued", attempts: 0,
    direct: { patch: { notes }, serverDispo: true }, ...extra,
  };
}
const clearDraft = (id: string, base: string, extra: Partial<PendingMutation> = {}) =>
  draft(id, "", base, { clearNotes: true, ...extra });

function route(answers: Array<(b: Body) => Response>, bodies: Body[]) {
  return async (_path: string, init?: RequestInit) => {
    const b = JSON.parse(String(init?.body)) as Body;
    bodies.push(b);
    assert.equal(blankNotesUnflagged(b), false, "blank notes never go out without clearNotes:true");
    const next = answers.shift();
    return next ? next(b) : json(200, { ok: true });
  };
}

test("ruling 1: a merge whose result is '' goes out as a flagged clear with base=current; a typed merge that empties keeps current (rule 5, no write)", async () => {
  resetLandedNotes();
  // Clear, base S\nA; another device deleted S: diff3(S\nA, A, '') = '' -> {clearNotes:true, notes:'', baseNotes:'A'}.
  const bodies: Body[] = [];
  await postFieldDispo(clearDraft("c-blank", "S\nA"), rep, {
    getToken: async () => "token", now: () => atMs,
    post: route([() => conflict("A")], bodies),
  });
  assert.deepEqual(bodies.map((b) => [b.notes, b.baseNotes, b.clearNotes ?? null]), [["", "S\nA", true], ["", "A", true]]);
  // Typed: base S\nA, ours S, current A: the empty diff3 of two non-empty sides keeps current; nothing is written.
  resetLandedNotes();
  const typed: Body[] = [];
  const result = await postFieldDispo(draft("t-blank", "S", "S\nA"), rep, {
    getToken: async () => "token", now: () => atMs,
    post: route([() => conflict("A")], typed),
  });
  assert.equal(typed.length, 1);
  assert.deepEqual([result.replayed, result.appliedNotes], [true, "A"]);
});

test("ruling 2 (Own): a clear whose 409 current is a text this device landed earlier lands as ''", async () => {
  resetLandedNotes();
  // Save S\nA1 landed before the clear was saved (stale editor still at S).
  rememberLandedNotes({ userId: rep.id, leadId: "lead-v5" }, "S\nA1", atMs - 1000);
  const bodies: Body[] = [];
  await postFieldDispo(clearDraft("own-clear", "S"), rep, {
    getToken: async () => "token", now: () => atMs,
    post: route([() => conflict("S\nA1")], bodies),
  });
  assert.deepEqual(bodies.map((b) => [b.notes, b.baseNotes, b.clearNotes ?? null]), [["", "S", true], ["", "S\nA1", true]]);
});

test("ruling 2: a text that landed after the clear was saved does not count (an older clear never wipes a newer edit)", async () => {
  resetLandedNotes();
  rememberLandedNotes({ userId: rep.id, leadId: "lead-v5" }, "S\nA\nB", atMs + 1000);
  const bodies: Body[] = [];
  await postFieldDispo(clearDraft("old-clear", "S\nA"), rep, {
    getToken: async () => "token", now: () => atMs + 2000,
    post: route([() => conflict("S\nA\nB")], bodies),
  });
  // diff3(S\nA, S\nA\nB, '') = B
  assert.deepEqual(bodies.map((b) => [b.notes, b.baseNotes, b.clearNotes ?? null]), [["", "S\nA", true], ["B", "S\nA\nB", null]]);
});

test("rulings 3 and 6: repeat 409s re-merge the original intent against each fresh current; send 1 of 3 is the original", async () => {
  resetLandedNotes();
  const currents = ["S\nX1", "S\nX1\nX2", "S\nX1\nX2\nX3"];
  const bodies: Body[] = [];
  await assert.rejects(
    () => postFieldDispo(clearDraft("rep-clear", "S"), rep, {
      getToken: async () => "token", now: () => atMs,
      post: route(currents.map((c) => () => conflict(c)), bodies),
    }),
    (error: Error & { notesPending?: boolean; rebasedDraft?: PendingMutation }) => {
      assert.equal(error.message, NOTES_CLEAR_PENDING_MESSAGE);
      assert.equal(error.notesPending, true);
      // Pending as the clear merged against the last current, carrying the original clear intent.
      const d = error.rebasedDraft!;
      assert.deepEqual([d.notes, d.baseNotes, d.clearNotes ?? null], ["X1\nX2\nX3", "S\nX1\nX2\nX3", null]);
      assert.deepEqual(d.notesIntent, { notes: "", baseNotes: "S", clearNotes: true });
      return true;
    },
  );
  assert.equal(bodies.length, NOTES_MAX_SENDS);
  // Each retry uses the fresh current as base, and the merge is diff3(S, current, ''), never the previous result.
  assert.deepEqual(bodies.map((b) => [b.notes, b.baseNotes, b.clearNotes ?? null]), [["", "S", true], ["X1", "S\nX1", null], ["X1\nX2", "S\nX1\nX2", null]]);
  assert.equal(new Set(bodies.map((b) => b.draftId)).size, 1);
});

test("ruling 3 (typed notes): the re-merge uses the original base and the rep's text, never the previous merge", async () => {
  resetLandedNotes();
  const bodies: Body[] = [];
  let rows = [draft("typed-1", "S\nMine", "S")];
  const send = (answers: Array<(b: Body) => Response>) => (row: PendingMutation) =>
    postFieldDispo(row, rep, { getToken: async () => "token", now: () => atMs, post: route(answers, bodies) });
  const box = (answers: Array<(b: Body) => Response>) => ({
    read: async () => rows, send: send(answers),
    remove: async (id: string) => { rows = rows.filter((r) => r.id !== id); },
    update: async (row: PendingMutation) => { rows = rows.map((r) => r.id === row.id ? row : r); },
    report: async () => {}, active: () => true, now: () => atMs, random: () => 0,
  });
  await syncOutbox(box([() => conflict("S\nX1"), () => conflict("S\nX1\nX2")]));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].syncState, "retry");
  assert.equal(rows[0].lastError, NOTES_CLEAR_PENDING_MESSAGE);
  assert.equal(rows[0].nextAttemptAt, undefined, "retried on the next flush");
  assert.equal(rows[0].notes, "S\nMine", "stored as the original intent");
  assert.equal(rows[0].baseNotes, "S");
  await syncOutbox(box([() => conflict("S\nX1\nX2\nX3")]));
  assert.equal(rows.length, 0);
  assert.deepEqual(bodies.map((b) => [b.notes, b.baseNotes]), [
    ["S\nMine", "S"],
    ["S\nX1\nMine", "S\nX1"],
    ["S\nMine", "S"],
    ["S\nX1\nX2\nX3\nMine", "S\nX1\nX2\nX3"],
  ]);
});

test("V4 answers: a pending clear is sent again on the very next flush, at most 3 sends per flush", async () => {
  resetLandedNotes();
  const bodies: Body[] = [];
  let rows = [clearDraft("pend-clear", "S")];
  const answers: Array<(b: Body) => Response> = [1, 2, 3, 4].map((k) => () => conflict(`S\nX${k}`));
  const box = {
    read: async () => rows,
    send: (row: PendingMutation) => postFieldDispo(row, rep, { getToken: async () => "token", now: () => atMs, post: route(answers, bodies) }),
    remove: async (id: string) => { rows = rows.filter((r) => r.id !== id); },
    update: async (row: PendingMutation) => { rows = rows.map((r) => r.id === row.id ? row : r); },
    report: async () => {}, active: () => true, now: () => atMs, random: () => 0,
  };
  await syncOutbox(box);
  assert.equal(bodies.length, 3);
  assert.equal(rows[0].syncState, "retry");
  assert.equal(rows[0].clearNotes, undefined);
  assert.deepEqual([rows[0].notes, rows[0].baseNotes], ["X3", "S\nX3"]);
  assert.deepEqual(rows[0].notesIntent, { notes: "", baseNotes: "S", clearNotes: true });
  await syncOutbox(box);
  assert.equal(rows.length, 0);
  assert.equal(bodies.length, 5);
  // The next flush sends the stored merge first; its 409 re-merges the clear intent (base S), not the stored merge.
  assert.deepEqual(bodies.slice(3).map((b) => [b.notes, b.baseNotes, b.clearNotes ?? null]), [["X3", "S\nX3", null], ["X4", "S\nX4", null]]);
});

test("V4 answers: a sync that only waited on a running flush does not re-send a draft that went pending in it", async () => {
  // Repro (smoke xClrRepeat409, 15efe05): 13 sync() calls queued behind one flush; after the flush went pending at
  // send 3, a waiter's rerun sent the pending clear twice more (5 sends in one harness flush window).
  resetLandedNotes();
  const bodies: Array<Record<string, unknown>> = [];
  let k = 0;
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    const b = JSON.parse(String(init.body)); bodies.push(b); k += 1;
    return k <= 4 ? conflict(["S", ...Array.from({ length: k }, (_, i) => `X${i + 1}`)].join("\n")) : json(200, { ok: true, lead: { id: "lead-v5" } });
  }) as typeof fetch;
  let rows: PendingMutation[] = [draft("clr-wait", "", "S", { clearNotes: true, direct: { patch: { notes: "" }, serverDispo: true } })];
  const held = new Set<string>();
  const box = {
    read: async () => rows.map((r) => ({ ...r })),
    send: (m: PendingMutation) => postFieldDispo(m, rep, { getToken: async () => "tok" }),
    remove: async (id: string) => { rows = rows.filter((r) => r.id !== id); },
    update: async (m: PendingMutation) => { rows = rows.map((r) => (r.id === m.id ? m : r)); },
    active: () => true,
    heldNotesPending: held,
  };
  await syncOutbox(box); // the flush: original send + 2 re-merges, then pending
  assert.equal(bodies.length, NOTES_MAX_SENDS);
  assert.deepEqual([...held], ["clr-wait"]);
  await syncOutbox(box); // a waiter's rerun inside the same burst
  await syncOutbox(box);
  assert.equal(bodies.length, NOTES_MAX_SENDS, "no send of the pending draft until the next fresh flush");
  assert.equal(rows.length, 1);
  held.clear(); // next fresh flush
  await syncOutbox(box);
  assert.equal(rows.length, 0);
  assert.deepEqual(bodies.slice(3).map((b) => [b.notes, b.baseNotes, b.clearNotes ?? null]), [["X1\nX2\nX3", "S\nX1\nX2\nX3", null], ["X1\nX2\nX3\nX4", "S\nX1\nX2\nX3\nX4", null]]);
});

test("C6-1 / v6 sweepAB4: server cleared, rep reordered duplicate lines: the client merge keeps the spec's line, never ''", async () => {
  const { diff3NoteLines, rebaseNotes } = await import("../../app/field/notesRebase");
  // The 57a3ccd sweepAB4 blankSentUnflagged examples (build returned '' where the spec keeps a line).
  const cases: Array<[string, string, string, string]> = [
    ["Gate code 1234\nGate code 1234\nDog in yard", "", "Gate code 1234\nDog in yard\nGate code 1234", "Gate code 1234"],
    ["Gate code 1234\nGate code 1234\nDog in yard", "", "Dog in yard\nGate code 1234", "Gate code 1234"],
    ["Gate code 1234\nGate code 1234\nDog in yard", "", "Dog in yard\nGate code 1234\nGate code 1234", "Dog in yard"],
    ["Gate code 1234\nGate code 1234\nDog", "", "Gate code 1234\nDog\nGate code 1234", "Gate code 1234"],
  ];
  for (const [b, c, o, want] of cases) assert.equal(diff3NoteLines(b, c, o), want, JSON.stringify({ b, c, o }));
  // aca724f's case: a whitespace-only result is trimmed to '' (never a raw '\n').
  assert.equal(rebaseNotes("Dog in yard", "Dog in yard\n", "").notes, "");
  for (const [b, c, o] of [["Dog in yard", "", "Dog in yard\n"], ["A", "\n", " \n\t"], ["A\nB", " ", "\n"]]) {
    const r = diff3NoteLines(b, c, o);
    assert.ok(r === "" || r.trim() !== "", `whitespace-only merge ${JSON.stringify(r)}`);
  }
});

test("C6-1: a merge that trims to '' onto a blank current has landed (no send); onto a non-blank current it goes as a flagged clear", async () => {
  resetLandedNotes();
  // Typed: base 'Dog in yard', rep 'Dog in yard\n' (no real change), the server was cleared meanwhile -> merge '' and current '' -> landed.
  const bodies: Body[] = [];
  globalThis.fetch = (async (_u: string, init: RequestInit) => { bodies.push(JSON.parse(String(init.body))); return conflict(""); }) as typeof fetch;
  const typed = await postFieldDispo(draft("c61-typed", "Dog in yard\n", "Dog in yard"), rep, { getToken: async () => "tok" });
  assert.equal(bodies.length, 1, "nothing is sent after the 409");
  assert.equal((typed as { replayed?: boolean }).replayed, true);
  for (const b of bodies) assert.equal(blankNotesUnflagged(b), false);
  // Clear onto a whitespace-only current: blank merge, blank current -> landed, no second send.
  bodies.length = 0;
  globalThis.fetch = (async (_u: string, init: RequestInit) => { bodies.push(JSON.parse(String(init.body))); return conflict("\n \n"); }) as typeof fetch;
  const clear = await postFieldDispo(draft("c61-clear", "", "S", { clearNotes: true, direct: { patch: { notes: "" }, serverDispo: true } }), rep, { getToken: async () => "tok" });
  assert.equal(bodies.length, 1);
  assert.equal((clear as { replayed?: boolean }).replayed, true);
  // Clear whose base lines are all that is left on a non-blank current: '' sent flagged (ruling v5-1), never raw.
  bodies.length = 0; let n = 0;
  globalThis.fetch = (async (_u: string, init: RequestInit) => { bodies.push(JSON.parse(String(init.body))); n += 1; return n === 1 ? conflict("S\n") : json(200, { ok: true, lead: { id: "lead-v5" } }); }) as typeof fetch;
  await postFieldDispo(draft("c61-clear2", "", "S\nA", { clearNotes: true, direct: { patch: { notes: "" }, serverDispo: true } }), rep, { getToken: async () => "tok" });
  assert.equal(bodies.length, 2);
  assert.deepEqual([bodies[1].notes, bodies[1].clearNotes, bodies[1].baseNotes], ["", true, "S\n"]);
  for (const b of bodies) assert.equal(blankNotesUnflagged(b), false);
});
