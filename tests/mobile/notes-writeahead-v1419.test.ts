import test from "node:test";
import assert from "node:assert/strict";
import { acceptDisposition, resetQueueSeqForTests } from "../../app/field/draftQueue";
import { splitNotesAndContact } from "../../app/field/contactSave";
import { commitDirectMutation, reportingPatch, type DirectCommitIo } from "../../app/field/directWrites";
import { compareNotesSend, orderQueuedNotes } from "../../app/field/notesCoalesce";
import { rebaseNotes } from "../../app/field/notesRebase";
import { deliverFieldDispo, postFieldDispo } from "../../app/field/serverDispo";
import { SYNC_REASON } from "../../app/field/syncReasons";
import { syncOutbox } from "../../app/field/syncOutbox";
import type { PendingMutation } from "../../app/field/types";
import type { User } from "../../app/types";

const at = "2026-10-26T16:00:00.000Z";
const owner = { id: "rep-owner", name: "Owner", role: "setter" } as User;
const manager = { id: "rep-manager", name: "Manager", role: "manager" } as User;
const territory = { id: "rep-territory", name: "Territory", role: "setter" } as User;
const phone = "555-0142";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function routePost(record: { notes: string }, receipts = new Set<string>()) {
  return async (_path: string, init?: { body?: unknown }) => {
    const body = JSON.parse(String(init?.body)) as { draftId: string; notes?: string; baseNotes?: string };
    if (receipts.has(body.draftId)) return json(200, { ok: true, duplicate: true });
    const notes = body.notes ?? "";
    const baseNotes = body.baseNotes ?? "";
    if (record.notes !== baseNotes && record.notes !== notes) {
      return json(409, { ok: false, reasonCode: "notes_conflict", currentNotes: record.notes });
    }
    if (record.notes !== notes) record.notes = notes;
    receipts.add(body.draftId);
    return json(200, { ok: true });
  };
}

function note(
  id: string,
  notes: string,
  baseNotes: string,
  extra: Partial<PendingMutation> = {},
): PendingMutation {
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
    direct: { patch: { notes } },
    ...extra,
  };
}

function lineCount(text: string, line: string): number {
  return text.split("\n").filter((item) => item === line).length;
}

function assertLinesOnce(text: string, lines: string[], label: string) {
  for (const line of lines) assert.equal(lineCount(text, line), 1, `${label} ${line} in ${JSON.stringify(text)}`);
}

test("a same-line addition is not glued onto a different server line", () => {
  const glued = rebaseNotes("5", "5 in yard", "Gate code 1234\nCall after");
  assert.notEqual(glued.notes, "Gate code 1234\nCall after 5 in yard");
  assert.equal(glued.notes, "Gate code 1234\nCall after\n5 in yard");
  assert.equal(rebaseNotes("5", "5 in yard", glued.notes).notes, glued.notes);
  const kept = rebaseNotes("Call after 5", "Call after 5 in yard", "Gate code 1234\nCall after 5");
  assert.equal(kept.notes, "Gate code 1234\nCall after 5 in yard");
  assert.equal(lineCount(kept.notes, "Call after 5 in yard"), 1);
  const keptFull = rebaseNotes(
    "Gate code 1234\nDog",
    "Gate code 1234\nDog in yard\nCall after 5",
    "Gate code 1234\nDog\nAdmin line",
  );
  assert.equal(keptFull.notes, "Gate code 1234\nDog\nAdmin line\nDog in yard\nCall after 5");
  assert.equal(lineCount(keptFull.notes, "Dog in yard"), 1);
  assert.equal(lineCount(keptFull.notes, "Call after 5"), 1);
});

test("a new notes draft chains its base to the previous unsent note", async () => {
  resetQueueSeqForTests();
  const first = acceptDisposition([], note("chain-a", "S\nA1", "S"));
  const second = acceptDisposition([first], note("chain-b", "S\nA1\nB1", "S", { createdAt: "2026-10-26T16:00:01.000Z" }));
  assert.equal(second.baseNotes, "S\nA1");
  assert.equal(second.notes, "S\nA1\nB1");
  let rows = [second, first];
  const holder = { notes: "S" };
  const receipts = new Set<string>();
  await syncOutbox(outbox(() => rows, (next) => { rows = next; }, async (row) => {
    await deliverFieldDispo(row, owner, {
      getToken: async () => "token",
      commit: async () => { throw Error("owned notes use the route"); },
      post: routePost(holder, receipts),
    });
  }));
  assert.equal(holder.notes, "S\nA1\nB1");
  assertLinesOnce(holder.notes, ["S", "A1", "B1"], "chain");
  assert.equal(receipts.size, 2);
  assert.equal(rows.length, 0);
});

test("owned notes go through the route, and a lost reply or kill replays as duplicate", async () => {
  const moves = [
    { name: "append", start: "S", typed: "S\nL1", base: "S", after: "S\nL1\nAdmin", lines: ["S", "L1", "Admin"] },
    { name: "revert", start: "S\nL1", typed: "S", base: "S\nL1", after: "S\nL1", lines: ["S", "L1"] },
    { name: "other-line", start: "S", typed: "S\nL1", base: "S", after: "S\nOther", lines: ["S", "Other"] },
  ];
  for (const actor of [owner, { id: "admin-1", name: "Admin", role: "admin" } as User]) {
    for (const move of moves) {
      for (const mode of ["lost", "kill"] as const) {
        const label = `${actor.role} ${mode} ${move.name}`;
        const holder = { notes: move.start };
        const receipts = new Set<string>();
        let rows = [note("x-own", move.typed, move.base, { userId: actor.id, userName: actor.name })];
        let drop = true;
        let commits = 0;
        const send = async (row: PendingMutation) => {
          await deliverFieldDispo(row, actor, {
            getToken: async () => "token",
            commit: async () => {
              commits += 1;
              return { replayed: false };
            },
            post: routePost(holder, receipts),
          });
          if (drop) {
            drop = false;
            throw Object.assign(Error("failed to fetch"), { code: "network-request-failed" });
          }
        };
        await syncOutbox(outbox(() => rows, (next) => { rows = next; }, send, Date.parse(at)));
        assert.equal(holder.notes, move.typed, label);
        assert.equal(commits, 0, label);
        if (mode === "kill") rows = [note("x-own", move.typed, move.base, { userId: actor.id, userName: actor.name })];
        holder.notes = move.after;
        drop = false;
        await syncOutbox(outbox(() => rows, (next) => { rows = next; }, send, Date.parse(at) + 20 * 60 * 1000));
        assert.equal(holder.notes, move.after, `${label} server moved`);
        assert.equal(rows.length, 0, label);
        assertLinesOnce(holder.notes, move.lines, label);
        assert.equal(commits, 0, `${label} still route`);
      }
    }
  }
});

test("a lost reply after a committed 200 on the route does not rewrite notes", async () => {
  for (const role of [territory, manager]) {
    for (const shape of ["plain", "contested"] as const) {
      const label = `${role.role} ${shape}`;
      const base = shape === "plain" ? "S" : "Gate code 1234\nDog in yard";
      const typed = shape === "plain" ? "S\nA1" : "Dog in yard";
      const start = shape === "plain" ? "S" : "Gate code 1234";
      const expect = shape === "plain" ? "S\nA1" : "Gate code 1234\nDog in yard";
      let record = start;
      const receipts = new Set<string>();
      let posts = 0;
      let rows = [note("x-route", typed, base, {
        userId: role.id,
        userName: role.name,
        direct: { patch: { notes: typed }, serverDispo: true },
      })];
      let drop = true;
      const send = async (row: PendingMutation) => {
        await deliverFieldDispo(row, role, {
          getToken: async () => "token",
          commit: async () => { throw Error("route notes must not direct-write"); },
          post: async (_path, init) => {
            posts += 1;
            const body = JSON.parse(String(init?.body)) as { draftId: string; notes?: string; baseNotes?: string };
            assert.equal(Object.prototype.hasOwnProperty.call(body, "appliedNotes"), false, label);
            if (receipts.has(body.draftId)) return json(200, { ok: true, duplicate: true });
            const notes = body.notes ?? "";
            const baseNotes = body.baseNotes ?? "";
            if (record !== baseNotes && record !== notes) {
              return json(409, { ok: false, reasonCode: "notes_conflict", currentNotes: record });
            }
            if (record !== notes) record = notes;
            receipts.add(body.draftId);
            return json(200, { ok: true });
          },
        });
        if (drop) {
          drop = false;
          throw Object.assign(Error("failed to fetch"), { code: "network-request-failed" });
        }
      };
      await syncOutbox(outbox(() => rows, (next) => { rows = next; }, send, Date.parse(at)));
      assert.equal(record, expect, label);
      assert.equal(receipts.size, 1, label);
      const posted = posts;
      drop = false;
      await syncOutbox(outbox(() => rows, (next) => { rows = next; }, send, Date.parse(at) + 20 * 60 * 1000));
      assert.equal(record, expect, `${label} replay`);
      assert.ok(posts > posted, `${label} replay posted the same draft`);
      assert.equal(rows.length, 0, label);
      assertLinesOnce(record, shape === "plain" ? ["S", "A1"] : ["Gate code 1234", "Dog in yard"], label);
    }
  }
});

test("replaying an applied owned draft leaves the server notes unchanged", async () => {
  const cases = [
    { base: "Gate code 1234\nDog in yard", edit: "Dog in yard", server: "Gate code 1234" },
    { base: "S", edit: "S\nA1", server: "S" },
    { base: "Call after 5", edit: "Call after 5 in yard", server: "Gate code 1234\nCall after 5" },
    { base: "5", edit: "5 in yard", server: "Gate code 1234\nCall after" },
  ];
  for (const item of cases) {
    let record = item.server;
    let draft = note(`sweep-${item.edit.length}-${item.server.length}`, item.edit, item.base);
    const io = leadIo(() => record, (next) => { record = next; }, async (row) => { draft = row; });
    const first = await commitDirectMutation(draft, owner, io);
    assert.equal(first.replayed, false, item.edit);
    const settled = record;
    for (let n = 0; n < 5; n += 1) {
      const again = await commitDirectMutation(draft, owner, io);
      assert.equal(again.replayed, true, `${item.edit} ${n}`);
      assert.equal(record, settled, `${item.edit} ${n}`);
    }
  }
});

test("xCoCrashMidRemove does not append A1 again", async () => {
  const holder = { notes: "S" };
  const receipts = new Set<string>();
  let rows = [
    note("x-co-a", "S\nA1", "S", { queueSeq: 1 }),
    note("x-co-b", "S\nA1\nB1", "S\nA1", { queueSeq: 2 }),
  ];
  let drop = true;
  const send = async (row: PendingMutation) => {
    await deliverFieldDispo(row, owner, {
      getToken: async () => "token",
      commit: async () => { throw Error("owned notes use the route"); },
      post: routePost(holder, receipts),
    });
    if (drop && row.id === "x-co-a") {
      drop = false;
      throw Object.assign(Error("failed to fetch"), { code: "network-request-failed" });
    }
  };
  await syncOutbox(outbox(() => rows, (next) => { rows = next; }, send, Date.parse(at)));
  assert.equal(holder.notes, "S\nA1");
  assert.equal(rows.some((row) => row.id === "x-co-a"), true);
  await syncOutbox(outbox(() => rows, (next) => { rows = next; }, send, Date.parse(at) + 20 * 60 * 1000));
  assert.equal(holder.notes, "S\nA1\nB1");
  assert.notEqual(holder.notes, "S\nA1\nB1\nA1");
  assertLinesOnce(holder.notes, ["S", "A1", "B1"], "xCoCrashMidRemove");
  assert.equal(receipts.size, 2);
  assert.equal(rows.length, 0);
});

test("xCoDiffBases keeps each line once", async () => {
  const holder = { notes: "S" };
  let rows = [
    note("x-co-a1", "S\nA1", "S", { queueSeq: 1 }),
    note("x-co-b1", "S\nOther\nB1", "S", { queueSeq: 2 }),
  ];
  await syncOutbox(outbox(() => rows, (next) => { rows = next; }, async (row) => {
    await deliverFieldDispo(row, owner, {
      getToken: async () => "token",
      commit: async () => { throw Error("owned notes use the route"); },
      post: routePost(holder),
    });
  }));
  assert.notEqual(holder.notes, "S\nOther\nA1\nOther\nB1");
  assert.equal(holder.notes, "S\nA1\nOther\nB1");
  assertLinesOnce(holder.notes, ["S", "A1", "Other", "B1"], "xCoDiffBases");
  assert.equal(rows.length, 0);
});

test("xNpBehindOlder, xNpAheadOfNewer, and xNpBetween keep the phone and do not duplicate L1", async () => {
  const roles = [
    { name: "owned", user: owner, route: false },
    { name: "manager", user: manager, route: true },
    { name: "territory", user: territory, route: true },
  ];
  const layouts = ["xNpBehindOlder", "xNpAheadOfNewer", "xNpBetween"] as const;
  for (const role of roles) {
    for (const layout of layouts) {
      const label = `${layout} ${role.name}`;
      const older = note("x-np-old", "S\nL1", "S", { createdAt: "2026-10-26T16:00:00.000Z" });
      const legacy = note("x-np-phone", "S\nL1\nL2", "S\nL1", {
        createdAt: "2026-10-26T16:00:01.000Z",
        direct: { patch: { notes: "S\nL1\nL2", phone }, ...(role.route ? { serverDispo: true } : {}) },
      });
      const newer = note("x-np-new", "S\nL1\nL2\nL3", "S\nL1\nL2", { createdAt: "2026-10-26T16:00:02.000Z" });
      const rowsFor = {
        xNpBehindOlder: [older, legacy],
        xNpAheadOfNewer: [legacy, newer],
        xNpBetween: [older, legacy, newer],
      }[layout];
      let rows: PendingMutation[] = rowsFor.map((row) => ({
        ...row,
        userId: role.user.id,
        userName: role.user.name,
        direct: {
          ...row.direct,
          patch: { ...row.direct?.patch },
          ...(role.route ? { serverDispo: true } : {}),
        },
      }));
      let record: Record<string, unknown> = { notes: "S" };
      const receipts = new Set<string>();
      const io = {
        db: {},
        auth: { currentUser: { uid: role.user.id } },
        doc: () => ({ path: "leads/lead-1" }),
        runTransaction: async (_database: unknown, fn: (tx: {
          get: () => Promise<{ exists: () => boolean; data: () => Record<string, unknown> }>;
          update: (_ref: unknown, data: Record<string, unknown>) => void;
        }) => Promise<unknown>) => fn({
          get: async () => ({ exists: () => true, data: () => ({ ...record }) }),
          update: (_ref, data) => { record = { ...record, ...data }; },
        }),
      } as unknown as DirectCommitIo;
      await syncOutbox({
        read: async () => rows,
        send: async (row) => deliverFieldDispo(row, role.user, {
          getToken: async () => "token",
          commit: async (mutation, user) => {
            if (mutation.kind === "contact" && role.name !== "owned") {
              throw Object.assign(Error("Missing or insufficient permissions."), { code: "permission-denied" });
            }
            return commitDirectMutation(mutation, user, io);
          },
          post: async (_path, init) => {
            const body = JSON.parse(String(init?.body)) as { draftId: string; notes?: string; baseNotes?: string };
            if (receipts.has(body.draftId)) return json(200, { ok: true, duplicate: true });
            const notes = body.notes ?? "";
            const baseNotes = body.baseNotes ?? "";
            const current = String(record.notes ?? "");
            if (current !== baseNotes && current !== notes) {
              return json(409, { ok: false, reasonCode: "notes_conflict", currentNotes: current });
            }
            if (current !== notes) record = { ...record, notes };
            receipts.add(body.draftId);
            return json(200, { ok: true });
          },
        }),
        remove: async (id) => { rows = rows.filter((row) => row.id !== id); },
        update: async (row) => { rows = rows.map((current) => current.id === row.id ? row : current); },
        insert: async (row) => { rows = [...rows, row]; },
        report: async () => {},
        active: () => true,
        now: () => Date.parse(at) + 60 * 60 * 1000,
        random: () => 0,
      });
      const text = String(record.notes ?? "");
      assert.equal(lineCount(text, "L1"), 1, label);
      assert.equal(lineCount(text, "L2"), 1, label);
      if (layout !== "xNpBehindOlder") assert.equal(lineCount(text, "L3"), 1, label);
      if (role.name === "owned") {
        assert.equal(record.phone, phone, label);
        assert.equal(rows.some((row) => row.direct?.patch?.phone === phone), false, label);
      } else {
        const held = rows.find((row) => row.direct?.patch?.phone === phone);
        assert.ok(held, label);
        assert.equal(held?.kind, "contact", label);
        assert.equal(held?.parkedReason, SYNC_REASON.contactDenied, label);
      }
    }
  }
});

test("an over-limit notes save tells territory and manager the notes are too long", async () => {
  for (const actor of [territory, manager]) {
    const draft = note("x-long", "n".repeat(20_000), "", {
      userId: actor.id,
      userName: actor.name,
      direct: { patch: { notes: "n".repeat(20_000) }, serverDispo: true },
    });
    await assert.rejects(
      () => postFieldDispo(draft, actor, {
        getToken: async () => "token",
        post: async () => json(413, { ok: false, error: "payload_too_large", reasonCode: "payload_too_large" }),
      }),
      (error: Error) => error.message === "Notes too long",
    );
  }
});

test("compareNotesSend is a strict total order", () => {
  const random = mulberry32(1419);
  const rows = Array.from({ length: 24 }, (_, index) => ({
    id: `r-${index}-${Math.floor(random() * 1000)}`,
    createdAt: new Date(Date.parse(at) + Math.floor(random() * 5) * 1000).toISOString(),
    queueSeq: random() < 0.45 ? undefined : Math.floor(random() * 6),
    notes: `S\n${index}`,
    baseNotes: random() < 0.5 ? "S" : `S\n${(index + 1) % 7}`,
  }));
  const cycle = [
    { id: "b", createdAt: at, queueSeq: 2, notes: "S\nB1", baseNotes: "S\nC1" },
    { id: "c", createdAt: at, queueSeq: 1, notes: "S\nC1", baseNotes: "S\nA1" },
    { id: "a", createdAt: at, notes: "S\nA1", baseNotes: "S\nB1" },
  ];
  const all = [...rows, ...cycle];
  for (const left of all) {
    for (const right of all) {
      const forward = compareNotesSend(left, right);
      const back = compareNotesSend(right, left);
      const sign = (value: number) => value < 0 ? -1 : value > 0 ? 1 : 0;
      assert.equal(sign(forward) + sign(back), 0);
    }
  }
  for (const left of all) {
    for (const mid of all) {
      for (const right of all) {
        if (compareNotesSend(left, mid) < 0 && compareNotesSend(mid, right) < 0) {
          assert.ok(compareNotesSend(left, right) < 0);
        }
        if (compareNotesSend(left, mid) === 0) {
          assert.equal(compareNotesSend(left, right), compareNotesSend(mid, right));
        }
      }
    }
  }
  assert.deepEqual(orderQueuedNotes(cycle).map((row) => row.id), ["a", "c", "b"]);
});

test("a legacy row is sent before a newer queueSeq note and is not appended again", async () => {
  for (const actor of [manager, territory]) {
    const label = actor.role || "setter";
    const legacy = note("legacy-phone", "S\nL1", "S", {
      createdAt: "2026-10-26T16:00:02.000Z",
      userId: actor.id,
      userName: actor.name,
      direct: { patch: { notes: "S\nL1", phone }, serverDispo: true },
    });
    const newer = note("notes-only", "S\nL1\nL2", "S", {
      createdAt: "2026-10-26T16:00:00.000Z",
      queueSeq: 4,
      userId: actor.id,
      userName: actor.name,
      direct: { patch: { notes: "S\nL1\nL2" }, serverDispo: true },
    });
    let rows = [newer, legacy];
    const holder = { notes: "S" };
    const sent: string[] = [];
    await syncOutbox({
      read: async () => rows,
      send: async (row) => {
        sent.push(row.id);
        await deliverFieldDispo(row, actor, {
          getToken: async () => "token",
          commit: async () => {
            throw Object.assign(Error("Missing or insufficient permissions."), { code: "permission-denied" });
          },
          post: routePost(holder),
        });
      },
      remove: async (id) => { rows = rows.filter((row) => row.id !== id); },
      update: async (row) => { rows = rows.map((current) => current.id === row.id ? row : current); },
      insert: async (row) => { rows = [...rows, row]; },
      report: async () => {},
      active: () => true,
      now: () => Date.parse(at) + 60 * 60 * 1000,
      random: () => 0,
    });
    assert.equal(sent[0], "legacy-phone", label);
    assert.equal(holder.notes, "S\nL1\nL2", label);
    assertLinesOnce(holder.notes, ["S", "L1", "L2"], label);
    assert.notEqual(holder.notes, "S\nL1\nL2\nL1", label);
  }
});

test("a rejected clear then an edit does not append the note twice", async () => {
  for (const actor of [manager, territory]) {
    resetQueueSeqForTests();
    const clear = acceptDisposition([], note("ms-clear", "", "S\nA", {
      clearNotes: true,
      userId: actor.id,
      userName: actor.name,
      direct: { patch: { notes: "" }, serverDispo: true },
    }));
    const edit = acceptDisposition([clear], note("ms-edit", "S\nA\nB", "S\nA", {
      userId: actor.id,
      userName: actor.name,
      createdAt: "2026-10-26T16:00:01.000Z",
      direct: { patch: { notes: "S\nA\nB" }, serverDispo: true },
    }));
    assert.equal(edit.baseNotes, "");
    let rows = [edit, clear];
    const holder = { notes: "S\nA" };
    await syncOutbox({
      read: async () => rows,
      send: async (row) => deliverFieldDispo(row, actor, {
        getToken: async () => "token",
        commit: async () => { throw Error("notes use the route"); },
        post: async (_path, init) => {
          const body = JSON.parse(String(init?.body)) as { clearNotes?: boolean; notes?: string; baseNotes?: string };
          if (body.clearNotes) return json(409, { ok: false, reasonCode: "notes_conflict", currentNotes: holder.notes });
          return routePost(holder)(_path, init);
        },
      }),
      remove: async (id) => { rows = rows.filter((row) => row.id !== id); },
      update: async (row) => { rows = rows.map((current) => current.id === row.id ? row : current); },
      report: async () => {},
      active: () => true,
      now: () => Date.parse(at),
      random: () => 0,
    });
    assert.equal(holder.notes, "S\nA\nB", actor.id);
    assert.notEqual(holder.notes, "S\nA\nS\nA\nB");
    assert.equal(rows.some((row) => row.id === "ms-clear" && row.parkedReason === SYNC_REASON.notesRejected), true);
    assert.equal(rows.some((row) => row.id === "ms-edit"), false);
  }
});

test("a parked clear survives a queue restart without doubling the next edit", async () => {
  resetQueueSeqForTests();
  const parked = note("parked-clear", "", "S\nA", {
    clearNotes: true,
    queueSeq: 9,
    syncState: "parked",
    parkedReason: SYNC_REASON.notesRejected,
    direct: { patch: { notes: "" }, serverDispo: true },
  });
  const edit = note("restart-edit", "S\nA\nB", "", {
    queueSeq: 1,
    createdAt: "2026-10-26T18:00:00.000Z",
    direct: { patch: { notes: "S\nA\nB" }, serverDispo: true },
  });
  let rows = [edit, parked];
  const holder = { notes: "S\nA" };
  await syncOutbox(outbox(() => rows, (next) => { rows = next; }, async (row) => {
    await deliverFieldDispo(row, owner, {
      getToken: async () => "token",
      commit: async () => { throw Error("notes use the route"); },
      post: routePost(holder),
    });
  }));
  assert.equal(holder.notes, "S\nA\nB");
  assertLinesOnce(holder.notes, ["S", "A", "B"], "restart");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, "parked-clear");
});

test("draft ids are unique at queue time and a split keeps the notes id", () => {
  resetQueueSeqForTests();
  const first = acceptDisposition([], note("same-id", "S\nA", "S"));
  const second = acceptDisposition([first], note("same-id", "S\nA\nB", "S"));
  assert.equal(first.id, "same-id");
  assert.notEqual(second.id, first.id);
  assert.equal(second.baseNotes, "S\nA");
  const combined = note("combo", "S\nL2", "S", { direct: { patch: { notes: "S\nL2", phone } } });
  const split = splitNotesAndContact(combined, new Set(["combo"]));
  assert.notEqual(split, "unsafe");
  assert.notEqual(split, null);
  if (split && split !== "unsafe") {
    assert.equal(split.notes.id, "combo");
    assert.notEqual(split.contact.id, "combo");
    assert.notEqual(split.contact.id, split.notes.id);
    assert.equal(split.contact.direct?.patch.phone, phone);
    assert.equal(Object.prototype.hasOwnProperty.call(split.contact.direct?.patch || {}, "notes"), false);
  }
});

test("an actionAt older than 30 days parks and is not resent with a new time", async () => {
  const createdAt = new Date(Date.parse(at) - 40 * 24 * 60 * 60 * 1000).toISOString();
  let rows = [note("old-action", "S\nL1", "S", { createdAt, direct: { patch: { notes: "S\nL1" }, serverDispo: true } })];
  const seenAt: string[] = [];
  let posts = 0;
  const run = (now: number) => syncOutbox(outbox(() => rows, (next) => { rows = next; }, async (row) => {
    await postFieldDispo(row, owner, {
      getToken: async () => "token",
      post: async (_path, init) => {
        posts += 1;
        const body = JSON.parse(String(init?.body)) as { actionAt?: string };
        seenAt.push(body.actionAt || "");
        return json(400, { ok: false, error: "invalid_payload", field: "actionAt" });
      },
    });
  }, now));
  await run(Date.parse(at));
  assert.equal(posts, 1);
  assert.equal(seenAt[0], createdAt);
  assert.equal(rows[0].syncState, "parked");
  assert.equal(rows[0].parkedReason, SYNC_REASON.notesRejected);
  assert.equal(rows[0].createdAt, createdAt);
  assert.equal(rows[0].notes, "S\nL1");
  await run(Date.parse(at) + 60 * 60 * 1000);
  assert.equal(posts, 1);
});

test("a 429 with Retry-After waits and then sends in the same order", async () => {
  let rows = [
    note("rate-a", "S\nA", "S", { queueSeq: 1 }),
    note("rate-b", "S\nA\nB", "S\nA", { queueSeq: 2, createdAt: "2026-10-26T16:00:01.000Z" }),
  ];
  const holder = { notes: "S" };
  const sent: string[] = [];
  let posts = 0;
  let now = Date.parse(at);
  const run = () => syncOutbox(outbox(() => rows, (next) => { rows = next; }, async (row) => {
    sent.push(row.id);
    await deliverFieldDispo(row, owner, {
      getToken: async () => "token",
      commit: async () => { throw Error("notes use the route"); },
      post: async (path, init) => {
        posts += 1;
        if (posts === 1) {
          return new Response(JSON.stringify({ ok: false, error: "rate_limited" }), {
            status: 429,
            headers: { "content-type": "application/json", "retry-after": "30" },
          });
        }
        return routePost(holder)(path, init);
      },
    });
  }, now));
  await run();
  assert.equal(posts, 1);
  assert.deepEqual(sent, ["rate-a"]);
  assert.equal(rows.find((row) => row.id === "rate-a")?.syncState, "retry");
  assert.equal(rows.find((row) => row.id === "rate-a")?.parkedReason, undefined);
  assert.equal(rows.find((row) => row.id === "rate-b")?.syncState, "queued");
  assert.equal(holder.notes, "S");
  const waiting = rows.find((row) => row.id === "rate-a");
  assert.equal(waiting?.nextAttemptAt, now + 30_000);
  sent.length = 0;
  await run();
  assert.deepEqual(sent, []);
  now += 30_000;
  await run();
  assert.deepEqual(sent, ["rate-a", "rate-b"]);
  assert.equal(holder.notes, "S\nA\nB");
  assert.equal(rows.length, 0);
});

test("a 413 parks the note and does not block the next draft", async () => {
  const holder = { notes: "S" };
  let rows = [
    note("long-mid", "S\nA\nBIG", "S\nA", { queueSeq: 2 }),
    note("after", "S\nA\nC", "S\nA\nBIG", { queueSeq: 3, createdAt: "2026-10-26T16:00:02.000Z" }),
    note("first", "S\nA", "S", { queueSeq: 1 }),
  ];
  const posts: string[] = [];
  await syncOutbox(outbox(() => rows, (next) => { rows = next; }, async (row) => {
    await deliverFieldDispo(row, owner, {
      getToken: async () => "token",
      commit: async () => { throw Error("notes use the route"); },
      post: async (path, init) => {
        const body = JSON.parse(String(init?.body)) as { notes?: string; draftId: string };
        posts.push(body.draftId);
        if ((body.notes || "").includes("BIG")) return json(413, { ok: false, error: "too_large" });
        return routePost(holder)(path, init);
      },
    });
  }));
  assert.equal(holder.notes, "S\nA\nC");
  assert.equal(posts.filter((id) => id === "long-mid").length, 1);
  assert.ok(posts.includes("after"));
  assert.ok(posts.includes("first"));
  const parked = rows.find((row) => row.id === "long-mid");
  assert.equal(parked?.syncState, "parked");
  assert.equal(parked?.parkedReason, SYNC_REASON.notesTooLong);
  assert.equal(parked?.notes, "S\nA\nBIG");
  assert.equal(parked?.lastError, "Notes too long");
  assert.equal(rows.some((row) => row.id === "after" || row.id === "first"), false);
  assertLinesOnce(holder.notes, ["S", "A", "C"], "xChMid413");

  let firstRows = [
    note("too-big", "BIG", "S", { queueSeq: 1, userId: manager.id, userName: manager.name }),
    note("next", "S\nNext", "S", { queueSeq: 2, userId: manager.id, userName: manager.name }),
  ];
  const firstHolder = { notes: "S" };
  const firstPosts: string[] = [];
  await syncOutbox(outbox(() => firstRows, (next) => { firstRows = next; }, async (row) => {
    await deliverFieldDispo(row, manager, {
      getToken: async () => "token",
      commit: async () => { throw Error("notes use the route"); },
      post: async (path, init) => {
        const body = JSON.parse(String(init?.body)) as { notes?: string; draftId: string };
        firstPosts.push(body.draftId);
        if (body.notes === "BIG") return json(413, {});
        return routePost(firstHolder)(path, init);
      },
    });
  }));
  assert.equal(firstPosts.filter((id) => id === "too-big").length, 1);
  assert.ok(firstPosts.includes("next"));
  assert.equal(firstHolder.notes, "S\nNext");
  assert.equal(firstRows[0].id, "too-big");
  assert.equal(firstRows[0].parkedReason, SYNC_REASON.notesTooLong);
  assert.equal(firstRows[0].notes, "BIG");
});

test("a direct notes write does not set updatedAt or lastActivity", () => {
  const patch = reportingPatch(note("direct-notes", "S\nA", "S"), owner);
  assert.deepEqual(Object.keys(patch).sort(), ["notes"]);
  assert.equal(Object.prototype.hasOwnProperty.call(patch, "updatedAt"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(patch, "lastActivity"), false);
});

function mulberry32(seed: number) {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let next = Math.imul(state ^ (state >>> 15), 1 | state);
    next = (next + Math.imul(next ^ (next >>> 7), 61 | next)) ^ next;
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

function leadIo(
  read: () => string,
  write: (notes: string) => void,
  persistDraft?: (row: PendingMutation) => Promise<void>,
): DirectCommitIo {
  return {
    db: {},
    auth: { currentUser: { uid: owner.id } },
    doc: () => ({ path: "leads/lead-1" }),
    persistDraft,
    runTransaction: async (_database: unknown, fn: (tx: {
      get: () => Promise<{ exists: () => boolean; data: () => { notes: string } }>;
      update: (_ref: unknown, data: { notes?: string }) => void;
    }) => Promise<unknown>) => fn({
      get: async () => ({ exists: () => true, data: () => ({ notes: read() }) }),
      update: (_ref, data) => {
        if (typeof data.notes === "string") write(data.notes);
      },
    }),
  } as unknown as DirectCommitIo;
}

function outbox(
  read: () => PendingMutation[],
  store: (rows: PendingMutation[]) => void,
  send: (row: PendingMutation) => Promise<void>,
  now = Date.parse(at),
) {
  return {
    read: async () => read(),
    send,
    remove: async (id: string) => { store(read().filter((row) => row.id !== id)); },
    update: async (row: PendingMutation) => {
      store(read().map((current) => current.id === row.id ? row : current));
    },
    insert: async (row: PendingMutation) => { store([...read(), row]); },
    report: async () => {},
    active: () => true,
    now: () => now,
    random: () => 0,
  };
}
