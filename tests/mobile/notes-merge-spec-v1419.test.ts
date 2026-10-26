import test from "node:test";
import assert from "node:assert/strict";
import { acceptDisposition, collapseLegacyNotesQueue, resetQueueSeqForTests, supersededNotesIds } from "../../app/field/draftQueue";
import { diff3NoteLines, notesAfterConflict, rebaseNotes } from "../../app/field/notesRebase";
import { overlayDrafts } from "../../app/field/deviceStore";
import { deliverFieldDispo, postFieldDispo, resetServerClockForTests } from "../../app/field/serverDispo";
import { SYNC_REASON } from "../../app/field/syncReasons";
import { syncOutbox } from "../../app/field/syncOutbox";
import type { PendingMutation } from "../../app/field/types";
import type { Lead, User } from "../../app/types";

// NOTES-MERGE-SPEC (Raydar Mobile, 2026-10-26 9:15 AM MST, clarifications 9:20 AM MST).
const S = "Gate code 1234\nDog in yard";
const at = "2026-10-26T16:00:00.000Z";
const owner = { id: "rep-owner", name: "Owner", role: "setter" } as User;
const manager = { id: "rep-manager", name: "Manager", role: "manager" } as User;
const territory = { id: "rep-territory", name: "Territory", role: "setter" } as User;

function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

type Body = { draftId: string; notes?: string; baseNotes?: string; actionAt?: string; clearNotes?: boolean };

function route(record: { notes: string }, receipts = new Set<string>(), bodies: Body[] = []) {
  return async (_path: string, init?: { body?: unknown }) => {
    const body = JSON.parse(String(init?.body)) as Body;
    bodies.push(body);
    if (receipts.has(body.draftId)) return json(200, { ok: true, duplicate: true });
    const notes = body.notes ?? "";
    const baseNotes = body.baseNotes ?? "";
    if (record.notes !== baseNotes && record.notes !== notes) {
      return json(409, { ok: false, reasonCode: "notes_conflict", currentNotes: record.notes });
    }
    record.notes = notes;
    receipts.add(body.draftId);
    return json(200, { ok: true });
  };
}

function note(id: string, notes: string, baseNotes: string, extra: Partial<PendingMutation> = {}): PendingMutation {
  return {
    id,
    userId: owner.id,
    userName: owner.name,
    leadId: "lead-1",
    createdAt: at,
    kind: "notes",
    baseStatus: "claimed",
    notes,
    baseNotes,
    syncState: "queued",
    attempts: 0,
    direct: { patch: { notes }, serverDispo: true },
    ...extra,
  };
}

function outbox(read: () => PendingMutation[], store: (rows: PendingMutation[]) => void, send: (row: PendingMutation) => Promise<void>, now = Date.parse(at)) {
  return {
    read: async () => read(),
    send,
    remove: async (id: string) => { store(read().filter((row) => row.id !== id)); },
    update: async (row: PendingMutation) => { store(read().map((current) => current.id === row.id ? row : current)); },
    insert: async (row: PendingMutation) => { store([...read(), row]); },
    report: async () => {},
    active: () => true,
    now: () => now,
    random: () => 0,
  };
}

test("diff3 merge rows match the spec (base, ours, current -> result)", () => {
  const rows: [string, string, string, string, string][] = [
    ["xDelPartial", S, `${S}\nA1`, "Gate code 1234", "Gate code 1234\nA1"],
    ["xDelResurrect", S, `${S}\nA1`, "Roof replaced 2019", "Roof replaced 2019\nA1"],
    ["xDelAllThenAdmin", S, `${S}\nA1`, "Admin", "Admin\nA1"],
    ["xDelWithClear", S, `${S}\nA1`, "", "A1"],
    ["xDelReorder", S, `${S}\nA1`, "Dog in yard\nGate code 1234", "Dog in yard\nGate code 1234\nA1"],
    ["xMBlankTypedMoved", S, `${S}\n\nA1`, `${S}\n\nAdmin`, `${S}\n\nAdmin\n\nA1`],
    ["judging example", "Dog", "Dog in yard\nDog", "Gate code 1234", "Gate code 1234\nDog in yard"],
    ["clarification (d)", "Dog", "Dog\nA1\nDog", "Gate code 1234\nDog", "Gate code 1234\nDog\nA1\nDog"],
    ["clarification (a) edited neighbour", "A\nB", "A\nB\nC1", "A\nB2", "A\nB2\nC1"],
    ["clarification (a) deleted neighbour", "A\nB", "A\nB\nC1", "A", "A\nC1"],
    ["server line kept", "A", "A\nC1", "Admin\nA", "Admin\nA\nC1"],
    ["server delete not resurrected", "A\nB\nC", "A\nB\nC\nT", "A\nC", "A\nC\nT"],
    ["ours edits a kept line", "Call after 5", "Call after 5 today", "Call after 5\nDog in yard", "Dog in yard\nCall after 5 today"],
    ["interior blank kept, edge trimmed", "A", "A\n\nB\n", "A\nX", "A\nX\n\nB"],
    ["both delete different lines", S, "Dog in yard", "Gate code 1234", "Gate code 1234"],
  ];
  for (const [label, base, ours, current, expected] of rows) {
    assert.equal(rebaseNotes(base, ours, current).notes, expected, label);
    assert.equal(diff3NoteLines(base, current, ours), expected, label);
    assert.equal(notesAfterConflict({ notes: ours, baseNotes: base }, current).notes, expected, label);
  }
});

test("rules 1-3 take a side as is", () => {
  assert.equal(rebaseNotes("S", "S\nA1", "S").notes, "S\nA1");
  assert.equal(rebaseNotes("S", "S", "S\nAdmin").notes, "S\nAdmin");
  assert.equal(rebaseNotes("S", "S\nA1", "S\nA1").notes, "S\nA1");
  const known = notesAfterConflict({ notes: "S\nA1\nB1", baseNotes: "S", knownSentNotes: ["S\nA1"] }, "S\nA1");
  assert.equal(known.notes, "S\nA1\nB1");
  // Decision 4: rules 1-3 compare edge-trimmed text, and their result is trimmed too.
  assert.equal(rebaseNotes("A", "\n\n", "\n\n").notes, "");
  assert.equal(rebaseNotes("S", "S\n", "S\nAdmin").notes, "S\nAdmin", "ours only added an edge blank: rule 2");
  assert.equal(rebaseNotes("S\n \t", "S\nA1", "\nS").notes, "S\nA1", "whitespace-only edge lines are blank: rule 1");
  assert.equal(rebaseNotes("S", "S\nA1\n", "\nS\nA1").notes, "S\nA1", "rule 3 after trimming");
  const knownTrimmed = notesAfterConflict({ notes: "S\nA1\nB1", baseNotes: "S", knownSentNotes: ["S\nA1"] }, "S\nA1\n\n");
  assert.equal(knownTrimmed.notes, "S\nA1\nB1");
});

test("every merge result has its edge blank lines trimmed", () => {
  assert.equal(rebaseNotes("A", " \nA\nB\n\t", "A\nC").notes, "A\nC\nB");
  assert.equal(rebaseNotes("A", "A\n\nB", "A\nC\n ").notes, "A\nC\n\nB", "inputs are trimmed first; the typed interior blank stays");
  assert.equal(rebaseNotes("A", "A\n\r", "A\nC").notes, "A\nC", "B1: '\\r' is whitespace, so the trailing line is trimmed");
  assert.equal(rebaseNotes("A", "A\n\u00a0\nB", "A\nC\n\u00a0").notes, "A\nC\n\u00a0\nB", "B1 trims current's NBSP edge; ours's interior NBSP line stays");
  assert.equal(rebaseNotes("A", "A\n \nB", "A\n \nC").notes, "A\n \nC\n \nB", "B2: a whitespace-only line is never deduped");
});

test("rule 5 never returns blank from two non-blank inputs", () => {
  assert.equal(rebaseNotes("A\nB", "B", "A").notes, "A");
  assert.notEqual(rebaseNotes("A\nB", "\nB", "A\n").notes.trim(), "");
});

test("a re-stamp of the same text keeps the draftId on the 400 retry, the clock clamp, and the age re-stamp", async () => {
  const now = Date.parse(at);
  // 400 actionAt retry, then accept.
  resetServerClockForTests();
  {
    let rows = [note("same-400", "S\nL1", "S", { createdAt: new Date(now + 11 * 60 * 1000).toISOString() })];
    const ids: string[] = [];
    const holder = { notes: "S" };
    let first = true;
    await syncOutbox(outbox(() => rows, (next) => { rows = next; }, async (row) => {
      await postFieldDispo(row, owner, {
        now: () => now,
        getToken: async () => "token",
        post: async (path, init) => {
          const body = JSON.parse(String(init?.body)) as Body;
          ids.push(body.draftId);
          if (first) { first = false; return json(400, { ok: false, field: "actionAt" }); }
          return route(holder)(path, init);
        },
      });
    }, now));
    assert.deepEqual(ids, ["same-400", "same-400"]);
    assert.equal(holder.notes, "S\nL1");
    assert.equal(rows.length, 0);
  }
  // Date-header clamp before the next send.
  resetServerClockForTests();
  {
    const serverNow = Date.parse("2026-10-26T15:00:00.000Z");
    const phoneNow = serverNow + 20 * 60 * 1000;
    const clamped = new Date(serverNow - 30_000).toISOString();
    let rows = [note("same-clock", "S\nL1", "S", { createdAt: new Date(phoneNow).toISOString() })];
    const ids: string[] = [];
    await syncOutbox(outbox(() => rows, (next) => { rows = next; }, async (row) => {
      await postFieldDispo(row, owner, {
        now: () => phoneNow,
        getToken: async () => "token",
        post: async (_path, init) => {
          const body = JSON.parse(String(init?.body)) as Body;
          ids.push(body.draftId);
          const ok = body.actionAt === clamped;
          return json(ok ? 200 : 400, ok ? { ok: true } : { ok: false, field: "actionAt" }, { date: new Date(serverNow).toUTCString() });
        },
      });
    }, phoneNow));
    assert.deepEqual(ids, ["same-clock", "same-clock"]);
    assert.equal(rows.length, 0);
  }
  // Over-25-day age re-stamp with no new save.
  resetServerClockForTests();
  {
    let rows = [note("same-age", "S\nL1", "S", { createdAt: new Date(now - 31 * 24 * 60 * 60 * 1000).toISOString() })];
    const holder = { notes: "S" };
    const bodies: Body[] = [];
    await syncOutbox(outbox(() => rows, (next) => { rows = next; }, async (row) => {
      await deliverFieldDispo(row, owner, {
        now: () => now,
        getToken: async () => "token",
        commit: async () => { throw Error("notes use the route"); },
        post: route(holder, new Set(), bodies),
      });
    }, now));
    assert.deepEqual(bodies.map((body) => body.draftId), ["same-age"]);
    assert.equal(bodies[0].actionAt, new Date(now).toISOString());
    assert.equal(holder.notes, "S\nL1");
  }
  resetServerClockForTests();
});

test("a re-stamped draft that already landed is deduped by its receipt", async () => {
  resetServerClockForTests();
  const now = Date.parse(at);
  const holder = { notes: "S" };
  const receipts = new Set<string>();
  // First attempt landed but the reply was lost; the retry is re-stamped from the server clock.
  await route(holder, receipts)("/api", { body: JSON.stringify({ draftId: "landed", notes: "S\nL1", baseNotes: "S" }) });
  holder.notes = "S\nL1\nAdmin";
  let rows = [note("landed", "S\nL1", "S", { createdAt: new Date(now - 31 * 24 * 60 * 60 * 1000).toISOString() })];
  await syncOutbox(outbox(() => rows, (next) => { rows = next; }, async (row) => {
    await deliverFieldDispo(row, owner, {
      now: () => now,
      getToken: async () => "token",
      commit: async () => { throw Error("notes use the route"); },
      post: route(holder, receipts),
    });
  }, now));
  assert.equal(holder.notes, "S\nL1\nAdmin");
  assert.equal(rows.length, 0);
  resetServerClockForTests();
});

test("a 409 whose current equals ours counts as landed and writes nothing", async () => {
  const bodies: Body[] = [];
  let writes = 0;
  const result = await postFieldDispo(note("landed-409", "S\nA1", "S"), owner, {
    getToken: async () => "token",
    post: async (_path, init) => {
      bodies.push(JSON.parse(String(init?.body)) as Body);
      if (bodies.length > 1) writes += 1;
      return json(409, { ok: false, reasonCode: "notes_conflict", currentNotes: "S\nA1" });
    },
  });
  assert.equal(bodies.length, 1);
  assert.equal(writes, 0);
  assert.equal((result as { replayed?: boolean }).replayed, true);
});

test("a 409 whose merge equals current writes nothing", async () => {
  const bodies: Body[] = [];
  const result = await postFieldDispo(note("merge-is-current", "Dog in yard", S), owner, {
    getToken: async () => "token",
    post: async (_path, init) => {
      bodies.push(JSON.parse(String(init?.body)) as Body);
      return json(409, { ok: false, reasonCode: "notes_conflict", currentNotes: "Gate code 1234" });
    },
  });
  assert.equal(bodies.length, 1);
  assert.equal((result as { replayed?: boolean }).replayed, true);
});

function midClearQueue(actor: User) {
  resetQueueSeqForTests();
  const who = { userId: actor.id, userName: actor.name };
  const a = acceptDisposition([], note("a", "S\nA1", "S", { ...who }));
  const clear = acceptDisposition([a], note("b", "", "S\nA1", {
    ...who,
    createdAt: "2026-10-26T16:00:01.000Z",
    clearNotes: true,
    direct: { patch: { notes: "" }, serverDispo: true },
  }));
  let rows = [clear];
  const typed = note("c", "\nC1", "", { ...who, createdAt: "2026-10-26T16:00:02.000Z", direct: { patch: { notes: "\nC1" }, serverDispo: true } });
  const after = acceptDisposition(rows, typed);
  const gone = supersededNotesIds(rows, after);
  rows = [...rows.filter((row) => !gone.includes(row.id)), after];
  return { clear, after, rows };
}

// NOTES-MERGE-SPEC E: a clear that was never sent folds with the typing after
// it into one save of the editor's text, exactly (rule 1). A bare leading
// newline is never sent.
test("xChMidClear: an unsent clear and the typing after it fold into one save of C1", () => {
  for (const actor of [owner, territory, manager]) {
    const { clear, after, rows } = midClearQueue(actor);
    assert.equal(clear.clearNotes, true, actor.role);
    assert.equal(clear.notes, "", actor.role);
    assert.equal(clear.baseNotes, "S", actor.role);
    assert.equal(after.notes, "C1", actor.role);
    assert.equal(after.direct?.patch?.notes, "C1", actor.role);
    assert.equal(after.baseNotes, "S", actor.role);
    assert.equal(after.clearNotes, undefined, actor.role);
    assert.deepEqual(rows.map((row) => row.id), [after.id], actor.role);
    assert.deepEqual(collapseLegacyNotesQueue(rows).map((row) => row.notes), ["C1"], actor.role);
  }
});

test("xChMidClear: the folded save lands C1 for every actor, with no clear sent", async () => {
  for (const actor of [owner, territory, manager]) {
    for (const refusesClears of [false, true]) {
      const { rows: queued } = midClearQueue(actor);
      let rows = queued;
      const holder = { notes: "S" };
      const bodies: Body[] = [];
      await syncOutbox(outbox(() => rows, (next) => { rows = next; }, async (row) => {
        await deliverFieldDispo(row, actor, {
          getToken: async () => "token",
          commit: async () => { throw Error("notes use the route"); },
          post: async (path, init) => {
            const body = JSON.parse(String(init?.body)) as Body;
            if (refusesClears && body.clearNotes === true) {
              bodies.push(body);
              return json(400, { ok: false, error: "invalid_payload", field: "clearNotes" });
            }
            return route(holder, new Set(), bodies)(path, init);
          },
        });
      }));
      const label = `${actor.role} refusesClears=${refusesClears}`;
      assert.equal(holder.notes, "C1", label);
      assert.equal(rows.length, 0, label);
      assert.equal(bodies.length, 1, label);
      assert.equal(bodies[0].notes, "C1", label);
      assert.equal(bodies[0].clearNotes, undefined, label);
    }
  }
});

async function parkedClear(actor: User, kept: string) {
  resetQueueSeqForTests();
  const who = { userId: actor.id, userName: actor.name };
  let rows = [acceptDisposition([], note("b", "", kept, {
    ...who,
    clearNotes: true,
    direct: { patch: { notes: "" }, serverDispo: true },
  }))];
  const holder = { notes: kept };
  await syncOutbox(outbox(() => rows, (next) => { rows = next; }, async (row) => {
    await deliverFieldDispo(row, actor, {
      getToken: async () => "token",
      commit: async () => { throw Error("notes use the route"); },
      post: async () => json(400, { ok: false, error: "invalid_payload", field: "clearNotes" }),
    });
  }));
  return { rows, holder, who };
}

// NOTES-MERGE-SPEC E: a parked clear keeps the server notes. The editor shows
// them again, and typing after it appends (S + A1 + C1).
test("a parked clear shows the kept notes in the editor", async () => {
  const kept = "S\nA1";
  const { rows } = await parkedClear(territory, kept);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].syncState, "parked");
  assert.equal(rows[0].parkedReason, SYNC_REASON.notesRejected);
  const lead = { id: "lead-1", notes: kept } as unknown as Lead;
  assert.equal(overlayDrafts([lead], rows)[0].notes, kept);
  assert.equal(overlayDrafts([lead], rows.map((row) => ({ ...row, direct: undefined })))[0].notes, kept);
});

test("typing after a parked clear appends to the kept notes and lands S+A1+C1", async () => {
  for (const actor of [territory, manager]) {
    for (const typedText of ["S\nA1\nC1", "\nC1", "C1"]) {
      const kept = "S\nA1";
      const parked = await parkedClear(actor, kept);
      let rows = parked.rows;
      const typed = note("c", typedText, kept, {
        ...parked.who,
        createdAt: "2026-10-26T16:00:02.000Z",
        direct: { patch: { notes: typedText }, serverDispo: true },
      });
      const after = acceptDisposition(rows, typed);
      const label = `${actor.role} ${JSON.stringify(typedText)}`;
      assert.equal(after.notes, "S\nA1\nC1", label);
      assert.equal(after.clearNotes, undefined, label);
      const gone = supersededNotesIds(rows, after);
      rows = [...rows.filter((row) => !gone.includes(row.id)), after];
      assert.equal(rows.length, 1, label);
      const holder = parked.holder;
      await syncOutbox(outbox(() => rows, (next) => { rows = next; }, async (row) => {
        await deliverFieldDispo(row, actor, {
          getToken: async () => "token",
          commit: async () => { throw Error("notes use the route"); },
          post: route(holder),
        });
      }));
      assert.equal(holder.notes, "S\nA1\nC1", label);
      assert.equal(rows.length, 0, label);
    }
  }
});
