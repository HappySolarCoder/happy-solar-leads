import test from "node:test";
import assert from "node:assert/strict";
import { acceptDisposition, collapseLegacyNotesQueue, resetQueueSeqForTests } from "../../app/field/draftQueue";
import { splitNotesAndContact } from "../../app/field/contactSave";
import { commitDirectMutation, reportingPatch, type DirectCommitIo } from "../../app/field/directWrites";
import { compareNotesSend, orderQueuedNotes } from "../../app/field/notesCoalesce";
import { rebaseNotes } from "../../app/field/notesRebase";
import { PHONE_CLOCK_NOTICE, SYNC_REASON } from "../../app/field/syncReasons";
import { putDraft, readDrafts } from "../../app/field/deviceStore";
import { NOTES_OTHER_REP_MESSAGE, parkedNotesNotice, phoneClockNotice } from "../../app/field/notesLimits";
import { SERVER_DISPO_SLOW_RETRY_MS, deliverFieldDispo, postFieldDispo } from "../../app/field/serverDispo";
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
  assert.equal(kept.notes, "Gate code 1234\nCall after 5\nCall after 5 in yard");
  assert.equal(lineCount(kept.notes, "Call after 5 in yard"), 1);
  assert.equal(lineCount(kept.notes, "Call after 5"), 1);
  const keptFull = rebaseNotes(
    "Gate code 1234\nDog",
    "Gate code 1234\nDog in yard\nCall after 5",
    "Gate code 1234\nDog\nAdmin line",
  );
  assert.equal(keptFull.notes, "Gate code 1234\nDog\nAdmin line\nDog in yard\nCall after 5");
  assert.equal(lineCount(keptFull.notes, "Dog in yard"), 1);
  assert.equal(lineCount(keptFull.notes, "Call after 5"), 1);
});

test("a second notes save replaces the unsent draft and keeps its base", async () => {
  resetQueueSeqForTests();
  const first = acceptDisposition([], note("chain-a", "S\nA1", "S"));
  const second = acceptDisposition([first], note("chain-b", "S\nA1\nB1", "S", { createdAt: "2026-10-26T16:00:01.000Z" }));
  assert.equal(second.baseNotes, "S");
  assert.equal(second.notes, "S\nA1\nB1");
  assert.equal(second.createdAt, first.createdAt);
  assert.equal(second.queueSeq, first.queueSeq);
  assert.notEqual(second.id, first.id);
  assert.deepEqual(second.knownSentNotes, ["S\nA1"]);
  let rows = [second];
  const holder = { notes: "S" };
  const receipts = new Set<string>();
  await syncOutbox(outbox(() => rows, (next) => { rows = next; }, async (row) => {
    await deliverFieldDispo(row, owner, {
      getToken: async () => "token",
      commit: async () => { throw Error("owned notes use the route"); },
      post: async (path, init) => {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        assert.equal("knownSentNotes" in body, false);
        return routePost(holder, receipts)(path, init);
      },
    });
  }));
  assert.equal(holder.notes, "S\nA1\nB1");
  assertLinesOnce(holder.notes, ["S", "A1", "B1"], "replace");
  assert.equal(receipts.size, 1);
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
    if (drop) {
      drop = false;
      throw Object.assign(Error("failed to fetch"), { code: "network-request-failed" });
    }
  };
  await syncOutbox(outbox(() => rows, (next) => { rows = next; }, send, Date.parse(at)));
  assert.equal(holder.notes, "S\nA1\nB1");
  assert.equal(rows.length, 1);
  await syncOutbox(outbox(() => rows, (next) => { rows = next; }, send, Date.parse(at) + 20 * 60 * 1000));
  assert.equal(holder.notes, "S\nA1\nB1");
  assert.notEqual(holder.notes, "S\nA1\nB1\nA1");
  assertLinesOnce(holder.notes, ["S", "A1", "B1"], "xCoCrashMidRemove");
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
    assert.ok(sent.includes("legacy-phone-contact"), label);
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
    assert.equal(edit.baseNotes, "S\nA");
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
  const edit = note("restart-edit", "S\nA\nCall after 5", "S\nA", {
    queueSeq: 1,
    createdAt: "2026-10-26T18:00:00.000Z",
    direct: { patch: { notes: "S\nA\nCall after 5" }, serverDispo: true },
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
  assert.equal(holder.notes, "S\nA\nCall after 5");
  assertLinesOnce(holder.notes, ["S", "A", "Call after 5"], "restart");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, "parked-clear");
});

test("draft ids are unique at queue time and a split keeps the notes id", () => {
  resetQueueSeqForTests();
  const first = acceptDisposition([], note("same-id", "S\nA", "S"));
  const second = acceptDisposition([first], note("same-id", "S\nA\nB", "S"));
  assert.equal(first.id, "same-id");
  assert.notEqual(second.id, first.id);
  assert.equal(second.baseNotes, "S");
  assert.deepEqual(second.knownSentNotes, ["S\nA"]);
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
    note("rate-a", "S\nA", "S", { queueSeq: 1, leadId: "lead-a" }),
    note("rate-b", "S\nB", "S", { queueSeq: 2, leadId: "lead-b", createdAt: "2026-10-26T16:00:01.000Z" }),
  ];
  const holders: Record<string, { notes: string }> = { "lead-a": { notes: "S" }, "lead-b": { notes: "S" } };
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
        return routePost(holders[row.leadId])(path, init);
      },
    });
  }, now));
  await run();
  assert.equal(posts, 2);
  assert.deepEqual(sent, ["rate-a", "rate-b"]);
  assert.equal(rows.find((row) => row.id === "rate-a")?.syncState, "retry");
  assert.equal(rows.find((row) => row.id === "rate-a")?.parkedReason, undefined);
  assert.equal(rows.find((row) => row.id === "rate-b"), undefined);
  assert.equal(holders["lead-a"].notes, "S");
  assert.equal(holders["lead-b"].notes, "S\nB");
  const waiting = rows.find((row) => row.id === "rate-a");
  assert.equal(waiting?.nextAttemptAt, now + 30_000);
  sent.length = 0;
  await run();
  assert.deepEqual(sent, []);
  now += 30_000;
  await run();
  assert.deepEqual(sent, ["rate-a"]);
  assert.equal(holders["lead-a"].notes, "S\nA");
  assert.equal(holders["lead-b"].notes, "S\nB");
  assert.equal(rows.length, 0);
});

test("a 413 parks the note and does not block the next draft", async () => {
  const holder = { notes: "S" };
  let rows = [note("too-big", "S\nA\nBIG", "S", { queueSeq: 1 })];
  const posts: string[] = [];
  const sendNotes = async (row: PendingMutation) => {
    await deliverFieldDispo(row, owner, {
      getToken: async () => "token",
      commit: async (mutation) => {
        if (mutation.kind === "knock") return { replayed: false };
        throw Error("notes use the route");
      },
      post: async (path, init) => {
        const body = JSON.parse(String(init?.body)) as { notes?: string; draftId: string; kind?: string };
        posts.push(body.draftId);
        if ((body.notes || "").includes("BIG")) return json(413, { ok: false, error: "too_large" });
        return routePost(holder)(path, init);
      },
    });
  };
  await syncOutbox(outbox(() => rows, (next) => { rows = next; }, sendNotes));
  const parked = rows.find((row) => row.id === "too-big");
  assert.equal(parked?.syncState, "parked");
  assert.equal(parked?.parkedReason, SYNC_REASON.notesTooLong);
  assert.equal(parked?.notes, "S\nA\nBIG");
  assert.equal(parked?.lastError, "Notes too long");
  assert.equal(holder.notes, "S");
  const next = acceptDisposition(rows, note("after", "S\nC", "S\nA\nBIG", { createdAt: "2026-10-26T16:00:02.000Z" }));
  const knock: PendingMutation = {
    ...note("door", "", ""),
    id: "door",
    kind: "knock",
    status: "not-home",
    disposition: "Not Home",
    queueSeq: 3,
    direct: { patch: { status: "not-home" }, serverDispo: true },
  };
  delete knock.notes;
  delete knock.baseNotes;
  rows = [parked as PendingMutation, next, knock];
  await syncOutbox(outbox(() => rows, (nextRows) => { rows = nextRows; }, sendNotes));
  assert.equal(holder.notes, "S\nC");
  assertLinesOnce(holder.notes, ["S", "C"], "xChMid413");
  assert.ok(posts.includes("door"));
  assert.equal(rows.some((row) => row.id === "too-big"), false);
  assert.equal(rows.some((row) => row.id === "door"), false);
});

test("xOrdSameMsRev sends queueSeq order for two leads saved in the same millisecond", async () => {
  const stamp = at;
  const leadA = note("rev-a", "S\nA", "S", { queueSeq: 2, leadId: "lead-a", createdAt: stamp });
  const leadB = note("rev-b", "S\nB", "S", { queueSeq: 1, leadId: "lead-b", createdAt: stamp });
  const sent: string[] = [];
  let rows = [leadA, leadB];
  await syncOutbox(outbox(() => rows, (next) => { rows = next; }, async (row) => {
    sent.push(row.id);
    await deliverFieldDispo(row, owner, {
      getToken: async () => "token",
      commit: async () => { throw Error("notes use the route"); },
      post: async () => json(200, { ok: true }),
    });
  }));
  assert.deepEqual(sent, ["rev-b", "rev-a"]);
});

test("xLegacyPairNewPair collapses legacy notes to the newest lineage text", () => {
  const older = note("leg-a", "S\nL1", "S");
  const newer = note("leg-b", "S\nL1\nL2", "S\nL1", { createdAt: "2026-10-26T16:00:01.000Z" });
  const ambiguousA = note("amb-a", "S\nA1", "S", { leadId: "lead-2" });
  const ambiguousB = note("amb-b", "S\nOther\nB1", "S", { leadId: "lead-2", createdAt: "2026-10-26T16:00:01.000Z" });
  const collapsed = collapseLegacyNotesQueue([newer, older, ambiguousB, ambiguousA]);
  const lead1 = collapsed.filter((row) => row.leadId === "lead-1" && row.kind === "notes");
  const lead2 = collapsed.filter((row) => row.leadId === "lead-2" && row.kind === "notes");
  assert.equal(lead1.length, 1);
  assert.equal(lead1[0].notes, "S\nL1\nL2");
  assert.equal(lead1[0].baseNotes, "S");
  assert.equal(lead1[0].createdAt, older.createdAt);
  assert.ok(lead1[0].knownSentNotes?.includes("S\nL1"));
  assert.ok(lead1[0].knownSentNotes?.includes("S\nL1\nL2"));
  assert.equal(lead2.length, 1);
  assert.equal(lead2[0].notes, "S\nA1\nOther\nB1");
  assert.equal(lineCount(lead2[0].notes, "S"), 1);
  assert.equal(collapseLegacyNotesQueue(collapsed), collapsed);
});

test("xChMidClear keeps the latest typed text and the original base", async () => {
  resetQueueSeqForTests();
  const first = acceptDisposition([], note("mid-a", "S\nA", "S"));
  const clear = acceptDisposition([first], note("mid-clear", "", "S\nA", { clearNotes: true }));
  const edit = acceptDisposition([clear], note("mid-b", "S\nA\nB", "S\nA"));
  assert.equal(edit.notes, "S\nA\nB");
  assert.equal(edit.baseNotes, "S");
  assert.equal(edit.createdAt, first.createdAt);
  assert.equal(edit.clearNotes, undefined);
  let rows = [edit];
  const holder = { notes: "S" };
  await syncOutbox(outbox(() => rows, (next) => { rows = next; }, async (row) => {
    await deliverFieldDispo(row, owner, {
      getToken: async () => "token",
      commit: async () => { throw Error("notes use the route"); },
      post: routePost(holder),
    });
  }));
  assert.equal(holder.notes, "S\nA\nB");
  assertLinesOnce(holder.notes, ["S", "A", "B"], "xChMidClear");
  assert.equal(rows.length, 0);
});

test("a 503 then an office edit does not repeat the unsent line", async () => {
  resetQueueSeqForTests();
  const first = acceptDisposition([], note("ret-a", "S\nA", "S"));
  let rows = [first];
  const holder = { notes: "S" };
  let failB = false;
  const send = async (row: PendingMutation) => {
    await deliverFieldDispo(row, owner, {
      getToken: async () => "token",
      commit: async () => { throw Error("notes use the route"); },
      post: async (path, init) => {
        if (failB) return json(503, { ok: false });
        return routePost(holder)(path, init);
      },
    });
  };
  await syncOutbox(outbox(() => rows, (next) => { rows = next; }, send));
  assert.equal(holder.notes, "S\nA");
  const second = acceptDisposition(rows, note("ret-b", "S\nA\nB", "S\nA", { createdAt: "2026-10-26T16:00:01.000Z" }));
  rows = [second];
  failB = true;
  await syncOutbox(outbox(() => rows, (next) => { rows = next; }, send, Date.parse(at) + 60_000));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].syncState, "retry");
  holder.notes = "S\nA\nOffice";
  const third = acceptDisposition(rows, note("ret-c", "S\nA\nB\nC", "S\nA\nB", { createdAt: "2026-10-26T16:00:02.000Z" }));
  rows = [third];
  failB = false;
  await syncOutbox(outbox(() => rows, (next) => { rows = next; }, send, Date.parse(at) + 120_000));
  assert.equal(holder.notes, "S\nA\nOffice\nB\nC");
  assertLinesOnce(holder.notes, ["S", "A", "Office", "B", "C"], "retarget");
  assert.equal(rows.length, 0);
});

test("a lost reply on the old draft id is covered by the replacement", async () => {
  resetQueueSeqForTests();
  const first = acceptDisposition([], note("lost-a", "S\nA", "S"));
  const holder = { notes: "S" };
  const receipts = new Set<string>();
  let rows = [first];
  let drop = true;
  await syncOutbox(outbox(() => rows, (next) => { rows = next; }, async (row) => {
    await deliverFieldDispo(row, owner, {
      getToken: async () => "token",
      commit: async () => { throw Error("notes use the route"); },
      post: routePost(holder, receipts),
    });
    if (drop) {
      drop = false;
      throw Object.assign(Error("failed to fetch"), { code: "network-request-failed" });
    }
  }));
  assert.equal(holder.notes, "S\nA");
  assert.equal(rows.length, 1);
  const replacement = acceptDisposition(rows, note("lost-b", "S\nA\nB", "S\nA", { createdAt: "2026-10-26T16:00:03.000Z" }));
  assert.notEqual(replacement.id, first.id);
  assert.ok(replacement.knownSentNotes?.includes("S\nA"));
  assert.equal(replacement.createdAt, first.createdAt);
  rows = [replacement];
  await syncOutbox(outbox(() => rows, (next) => { rows = next; }, async (row) => {
    await deliverFieldDispo(row, owner, {
      getToken: async () => "token",
      commit: async () => { throw Error("notes use the route"); },
      post: routePost(holder, receipts),
    });
  }, Date.parse(at) + 20 * 60 * 1000));
  assert.equal(holder.notes, "S\nA\nB");
  assertLinesOnce(holder.notes, ["S", "A", "B"], "lost-reply");
  assert.equal(rows.length, 0);
});

test("a future actionAt stays retryable and does not change the timestamp", async () => {
  const now = Date.parse(at);
  const createdAt = new Date(now + 11 * 60 * 1000).toISOString();
  let rows = [note("future", "S\nL1", "S", { createdAt, direct: { patch: { notes: "S\nL1" }, serverDispo: true } })];
  const seenAt: string[] = [];
  await syncOutbox(outbox(() => rows, (next) => { rows = next; }, async (row) => {
    await postFieldDispo(row, owner, {
      now: () => now,
      getToken: async () => "token",
      post: async (_path, init) => {
        const body = JSON.parse(String(init?.body)) as { actionAt?: string };
        seenAt.push(body.actionAt || "");
        return json(400, { ok: false, field: "actionAt" });
      },
    });
  }, now));
  assert.deepEqual(seenAt, [createdAt]);
  assert.equal(rows[0].syncState, "retry");
  assert.equal(rows[0].parkedReason, undefined);
  assert.equal(rows[0].createdAt, createdAt);
  assert.equal(rows[0].lastError, PHONE_CLOCK_NOTICE);
  assert.equal(phoneClockNotice(rows, "lead-1"), PHONE_CLOCK_NOTICE);
  await syncOutbox(outbox(() => rows, (next) => { rows = next; }, async () => {
    throw Error("must not resend before the backoff");
  }, now + 1000));
  assert.equal(rows[0].createdAt, createdAt);
});

test("a random notes queue keeps every line once and does not drop a phone", async () => {
  const random = mulberry32(1419);
  const server = { notes: "S", phone: "" };
  let rows: PendingMutation[] = [];
  const typed = new Set<string>(["S"]);
  const phones = new Set<string>();
  resetQueueSeqForTests();
  for (let step = 0; step < 12; step += 1) {
    const line = `L${step}`;
    typed.add(line);
    const previous = rows.find((row) => row.kind === "notes" && isQueued(row));
    const base = previous?.notes || server.notes;
    const notes = `${base}\n${line}`;
    const withPhone = random() < 0.35;
    const phoneValue = `555-01${step}`;
    if (withPhone) phones.add(phoneValue);
    const draft = note(`step-${step}`, notes, base, {
      createdAt: new Date(Date.parse(at) + step * 1000).toISOString(),
      direct: { patch: withPhone ? { notes, phone: phoneValue } : { notes }, serverDispo: true },
    });
    const queued = previous ? acceptDisposition(rows.filter(isQueued), { ...draft, queueSeq: undefined }) : acceptDisposition([], draft);
    rows = [
      ...rows.filter((row) => row.kind !== "notes" || !isQueued(row) || row.id === queued.id),
      queued,
    ];
    if (withPhone) {
      const contact = splitNotesAndContact(draft, new Set(rows.map((row) => row.id)));
      if (contact && contact !== "unsafe") rows = [...rows.filter((row) => row.id !== draft.id), contact.contact, queued];
    }
  }
  const faults = new Set<string>();
  await syncOutbox(outbox(() => rows, (next) => { rows = next; }, async (row) => {
    if (row.kind === "contact") {
      if (random() < 0.25) {
        throw Object.assign(Error("Missing or insufficient permissions."), { code: "permission-denied" });
      }
      server.phone = String(row.direct?.patch.phone || server.phone);
      return;
    }
    await deliverFieldDispo(row, owner, {
      getToken: async () => "token",
      commit: async () => { throw Error("notes use the route"); },
      post: async (path, init) => {
        const body = JSON.parse(String(init?.body)) as { draftId: string; notes?: string; baseNotes?: string; phone?: string; knownSentNotes?: unknown };
        assert.equal(body.phone, undefined);
        assert.equal(body.knownSentNotes, undefined);
        if (!faults.has(body.draftId) && random() < 0.3) {
          faults.add(body.draftId);
          return json(503, {});
        }
        if (random() < 0.2) {
          server.notes = `${server.notes}\nOffice${body.draftId.slice(0, 4)}`;
          typed.add(server.notes.split("\n").at(-1) as string);
        }
        return routePost(server)(path, init);
      },
    });
  }));
  for (const line of server.notes.split("\n")) {
    assert.equal(lineCount(server.notes, line), 1, line);
    assert.ok(typed.has(line), line);
  }
  const pending = rows.find((row) => row.kind === "notes");
  const pendingText = pending?.notes || "";
  for (const line of pendingText.split("\n")) {
    if (!line) continue;
    assert.ok(typed.has(line) || server.notes.split("\n").includes(line), line);
  }
  for (const phoneValue of phones) {
    const held = rows.some((row) => row.kind === "contact" && row.direct?.patch.phone === phoneValue);
    assert.ok(server.phone === phoneValue || held, phoneValue);
  }
});

function installMemoryIndexedDb() {
  if (typeof globalThis.indexedDB !== "undefined") return;
  type Store = Map<string, unknown>;
  const databases = new Map<string, { stores: Map<string, Store> }>();
  const open = (name: string) => {
    const request = {
      result: undefined as { objectStoreNames: { contains: (store: string) => boolean }; createObjectStore: (store: string) => void; transaction: (store: string) => unknown } | undefined,
      onupgradeneeded: null as null | (() => void),
      onsuccess: null as null | (() => void),
      onerror: null as null | (() => void),
    };
    queueMicrotask(() => {
      let db = databases.get(name);
      if (!db) {
        db = { stores: new Map() };
        databases.set(name, db);
        request.result = databaseHandle(db);
        request.onupgradeneeded?.();
      }
      request.result = databaseHandle(db);
      request.onsuccess?.();
    });
    return request;
  };
  const databaseHandle = (db: { stores: Map<string, Store> }) => ({
    objectStoreNames: { contains: (store: string) => db.stores.has(store) },
    createObjectStore: (store: string) => {
      if (!db.stores.has(store)) db.stores.set(store, new Map());
    },
    transaction: (store: string) => {
      const data = db.stores.get(store) ?? new Map();
      let pending = 0;
      let settled = false;
      const tx = {
        oncomplete: null as null | (() => void),
        onerror: null as null | (() => void),
        onabort: null as null | (() => void),
        objectStore: () => ({
          put: (value: { id: string }) => schedule(() => {
            data.set(value.id, structuredClone(value));
            return value.id;
          }),
          get: (key: string) => schedule(() => {
            const row = data.get(key);
            return row === undefined ? undefined : structuredClone(row);
          }),
          getAll: () => schedule(() => [...data.values()].map((row) => structuredClone(row))),
          delete: (key: string) => schedule(() => {
            data.delete(key);
          }),
        }),
      };
      const schedule = (produce: () => unknown) => {
        pending += 1;
        const req = { result: undefined as unknown, onsuccess: null as null | (() => void), onerror: null as null | (() => void) };
        queueMicrotask(() => {
          req.result = produce();
          req.onsuccess?.();
          pending -= 1;
          if (pending === 0 && !settled) {
            settled = true;
            queueMicrotask(() => tx.oncomplete?.());
          }
        });
        return req;
      };
      queueMicrotask(() => {
        if (pending === 0 && !settled) {
          settled = true;
          tx.oncomplete?.();
        }
      });
      return tx;
    },
  });
  Object.defineProperty(globalThis, "indexedDB", { value: { open }, configurable: true });
}

function lineCounts(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  if (!text) return counts;
  for (const line of text.split("\n")) counts.set(line, (counts.get(line) || 0) + 1);
  return counts;
}

test("rebase does not re-append a line the server already has", () => {
  const example = rebaseNotes("Dog", "Dog in yard\nGate code 1234", "Dog in yard\nCall after 5");
  assert.equal(example.notes, "Dog in yard\nCall after 5\nGate code 1234");
  assert.equal(example.baseNotes, "Dog in yard\nCall after 5");
  const random = mulberry32(19);
  const alphabet = ["Dog", "Dog in yard", "Gate code 1234", "Call after 5", "Admin", ""];
  const pick = () => Array.from({ length: Math.floor(random() * 4) }, () => alphabet[Math.floor(random() * alphabet.length)]).join("\n");
  for (let i = 0; i < 200; i += 1) {
    const base = pick();
    const ours = pick();
    const current = pick();
    const applied = rebaseNotes(base, ours, current);
    const currentCounts = lineCounts(current);
    const ourCounts = lineCounts(ours);
    const resultCounts = lineCounts(applied.notes);
    for (const line of new Set([...currentCounts.keys(), ...ourCounts.keys(), ...resultCounts.keys()])) {
      const cap = Math.max(currentCounts.get(line) || 0, ourCounts.get(line) || 0);
      assert.ok(
        (resultCounts.get(line) || 0) <= cap,
        `${JSON.stringify(line)} in ${JSON.stringify({ base, ours, current, result: applied.notes })}`,
      );
    }
  }
});

test("xChMidClear trims leading and trailing blank lines without emptying a merge", () => {
  assert.equal(rebaseNotes("S\nA", "\nB", "\n").notes, "B");
  assert.equal(rebaseNotes("S", "\nB", "").notes, "B");
  assert.equal(rebaseNotes("A", "A\n\nB", "A").notes, "A\n\nB");
  const onlyBlank = rebaseNotes("A", "\n\n", "\n\n");
  assert.notEqual(onlyBlank.notes, "");
  assert.match(onlyBlank.notes, /^\n/);
});

test("xK1LostLanded does not append a legacy note the server already has", async () => {
  const legacy = note("legacy-l1", "S\nL1", "S");
  delete legacy.knownSentNotes;
  let rows = collapseLegacyNotesQueue([legacy]);
  assert.deepEqual(rows[0].knownSentNotes, ["S\nL1"]);
  const holder = { notes: "S\nL1\nAdmin" };
  await syncOutbox(outbox(() => rows, (next) => { rows = next; }, async (row) => {
    await deliverFieldDispo(row, owner, {
      getToken: async () => "token",
      commit: async () => { throw Error("notes use the route"); },
      post: routePost(holder),
    });
  }));
  assert.equal(holder.notes, "S\nL1\nAdmin");
  assert.equal(lineCount(holder.notes, "L1"), 1);
  assert.equal(lineCount(holder.notes, "Admin"), 1);
  assert.equal(rows.length, 0);
});

test("xK1NotLanded still sends a legacy note the server does not have", async () => {
  const legacy = note("legacy-miss", "S\nL1", "S");
  delete legacy.knownSentNotes;
  let rows = collapseLegacyNotesQueue([legacy]);
  const holder = { notes: "S\nAdmin" };
  await syncOutbox(outbox(() => rows, (next) => { rows = next; }, async (row) => {
    await deliverFieldDispo(row, owner, {
      getToken: async () => "token",
      commit: async () => { throw Error("notes use the route"); },
      post: routePost(holder),
    });
  }));
  assert.equal(holder.notes, "S\nAdmin\nL1");
  assert.equal(lineCount(holder.notes, "L1"), 1);
  assert.equal(rows.length, 0);
});

test("xK2InFlight applies the replacement onto the text that landed", async () => {
  resetQueueSeqForTests();
  const first = acceptDisposition([], note("flight-a", "S\nL1", "S"));
  const second = acceptDisposition([first], note("flight-b", "S\nL1\nL2", "S"));
  assert.notEqual(second.id, first.id);
  assert.deepEqual(second.knownSentNotes, ["S\nL1"]);
  const holder = { notes: "S\nL1" };
  let rows = [second];
  await syncOutbox(outbox(() => rows, (next) => { rows = next; }, async (row) => {
    await deliverFieldDispo(row, owner, {
      getToken: async () => "token",
      commit: async () => { throw Error("notes use the route"); },
      post: routePost(holder),
    });
  }));
  assert.equal(holder.notes, "S\nL1\nL2");
  assert.equal(lineCount(holder.notes, "L1"), 1);
  assert.equal(rows.length, 0);
});

test("xK3OtherEdit409 keeps the other edit and does not repeat our line", () => {
  const draft = note("other-edit", "S\nA1", "S", { knownSentNotes: ["S\nA1"] });
  assert.equal(rebaseNotes("S", "S\nA1", "S\nOther").notes, "S\nOther\nA1");
  assert.equal(rebaseNotes("S", "S\nA1", "S\nA1\nOther").notes, "S\nA1\nOther");
  assert.equal(lineCount(rebaseNotes("S", "S\nA1", "S\nA1\nOther").notes, "A1"), 1);
  assert.equal(draft.knownSentNotes?.[0], "S\nA1");
});

test("xK4KillReplace gives the replacement a new id and keeps the killed text", () => {
  resetQueueSeqForTests();
  const first = acceptDisposition([], note("kill-a", "S\nA1", "S"));
  const second = acceptDisposition([first], note("kill-b", "S\nA1\nB1", "S"));
  assert.notEqual(second.id, "kill-a");
  assert.notEqual(second.id, "kill-b");
  assert.equal(second.notes, "S\nA1\nB1");
  assert.deepEqual(second.knownSentNotes, ["S\nA1"]);
});

test("xK4KillKnownSent remembers at most ten replaced texts", () => {
  resetQueueSeqForTests();
  let current = acceptDisposition([], note("k0", "S\n0", "S"));
  const previous: string[] = [];
  for (let i = 1; i <= 12; i += 1) {
    previous.push(current.notes || "");
    current = acceptDisposition([current], note(`k${i}`, `S\n${i}`, "S", {
      createdAt: new Date(Date.parse(at) + i * 1000).toISOString(),
    }));
  }
  assert.equal(current.knownSentNotes?.length, 10);
  assert.deepEqual(current.knownSentNotes, previous.slice(-10));
});

test("xK4KnownSurvivesRestart reads knownSentNotes back from IndexedDB", async () => {
  installMemoryIndexedDb();
  const draft = note("persist-known", "S\nL1\nL2", "S", { knownSentNotes: ["S\nL1", "S\nL1\nL2"] });
  await putDraft(draft);
  const rows = await readDrafts(owner.id);
  assert.deepEqual(rows.find((row) => row.id === "persist-known")?.knownSentNotes, ["S\nL1", "S\nL1\nL2"]);
});

test("xK5ClearReplacesText keeps one clear and the text it replaced", () => {
  resetQueueSeqForTests();
  const text = acceptDisposition([], note("text-a", "S\nA1", "S"));
  const clear = acceptDisposition([text], note("clear-a", "", "S\nA1", { clearNotes: true }));
  assert.equal(clear.notes, "");
  assert.equal(clear.clearNotes, true);
  assert.equal(clear.baseNotes, "S");
  assert.deepEqual(clear.knownSentNotes, ["S\nA1"]);
});

test("xK5TextReplacesClear drops the clear flag and remembers the empty text", () => {
  resetQueueSeqForTests();
  const clear = acceptDisposition([], note("clear-b", "", "S", { clearNotes: true }));
  const text = acceptDisposition([clear], note("text-b", "S\nB1", ""));
  assert.equal(text.notes, "S\nB1");
  assert.equal(text.clearNotes, undefined);
  assert.ok(text.knownSentNotes?.includes(""));
});

test("xK5ClearAfterLanded clears the text this draft already sent", async () => {
  resetQueueSeqForTests();
  const text = acceptDisposition([], note("landed", "S\nA1", "S"));
  const clear = acceptDisposition([text], note("clear-landed", "", "S\nA1", { clearNotes: true }));
  const holder = { notes: "S\nA1" };
  let rows = [clear];
  const bodies: { notes?: string; baseNotes?: string; clearNotes?: boolean }[] = [];
  let commits = 0;
  await syncOutbox(outbox(() => rows, (next) => { rows = next; }, async (row) => {
    await deliverFieldDispo(row, owner, {
      getToken: async () => "token",
      commit: async () => {
        commits += 1;
        throw Error("notes use the route");
      },
      post: async (_path, init) => {
        const body = JSON.parse(String(init?.body)) as { notes?: string; baseNotes?: string; clearNotes?: boolean };
        bodies.push(body);
        if (body.clearNotes && holder.notes !== (body.baseNotes || "") && holder.notes !== "")
          return json(409, { ok: false, reasonCode: "notes_conflict", currentNotes: holder.notes });
        if (body.clearNotes) holder.notes = "";
        return json(200, { ok: true });
      },
    });
  }));
  assert.equal(commits, 0);
  assert.equal(holder.notes, "");
  assert.equal(bodies.at(-1)?.clearNotes, true);
  assert.equal(bodies.at(-1)?.notes, "");
  assert.equal(bodies.at(-1)?.baseNotes, "S\nA1");
  assert.equal(rows.length, 0);
});

test("xK6LegacyNpPlusNotes collapses a phone note and a second note without repeating lines", () => {
  const withPhone = note("np-a", "S\nA1", "S", { direct: { patch: { notes: "S\nA1", phone } } });
  const extra = note("np-b", "S\nB1", "S", { createdAt: "2026-10-26T16:00:01.000Z" });
  delete withPhone.knownSentNotes;
  delete extra.knownSentNotes;
  const collapsed = collapseLegacyNotesQueue([withPhone, extra]);
  const notes = collapsed.filter((row) => row.kind === "notes");
  const contact = collapsed.filter((row) => row.kind === "contact");
  assert.equal(notes.length, 1);
  assert.equal(contact.length, 1);
  assert.equal(lineCount(notes[0].notes || "", "A1"), 1);
  assert.equal(lineCount(notes[0].notes || "", "B1"), 1);
  assert.equal(lineCount(notes[0].notes || "", "S"), 1);
  assert.ok(notes[0].knownSentNotes?.includes("S\nA1"));
  assert.ok(notes[0].knownSentNotes?.includes("S\nB1"));
  assert.equal(contact[0].direct?.patch.phone, phone);
});

test("xK6LegacySameMsRev keeps A1 and B1 once when two legacy notes share a timestamp", () => {
  const left = note("ms-a", "S\nA1", "S");
  const right = note("ms-b", "S\nB1", "S");
  delete left.knownSentNotes;
  delete right.knownSentNotes;
  delete left.queueSeq;
  delete right.queueSeq;
  const collapsed = collapseLegacyNotesQueue([right, left]);
  const notes = collapsed.filter((row) => row.kind === "notes");
  assert.equal(notes.length, 1);
  assert.equal(lineCount(notes[0].notes || "", "A1"), 1);
  assert.equal(lineCount(notes[0].notes || "", "B1"), 1);
  assert.equal(lineCount(notes[0].notes || "", "S"), 1);
  assert.ok(notes[0].knownSentNotes?.includes("S\nA1"));
  assert.ok(notes[0].knownSentNotes?.includes("S\nB1"));
});

test("a notes 403 owned_by_other parks with the notes notice and does not write directly", async () => {
  let commits = 0;
  let rows = [note("owned-other", "S\nL1", "S")];
  await syncOutbox(outbox(() => rows, (next) => { rows = next; }, async (row) => {
    await deliverFieldDispo(row, owner, {
      getToken: async () => "token",
      commit: async () => {
        commits += 1;
        return { replayed: false };
      },
      post: async () => json(403, { ok: false, reasonCode: "owned_by_other" }),
    });
  }));
  assert.equal(commits, 0);
  assert.equal(rows[0].syncState, "parked");
  assert.equal(rows[0].parkedReason, SYNC_REASON.ownedByOther);
  assert.equal(rows[0].notes, "S\nL1");
  assert.equal(rows[0].lastError, NOTES_OTHER_REP_MESSAGE);
  assert.equal(parkedNotesNotice(rows, "lead-1"), NOTES_OTHER_REP_MESSAGE);
  assert.equal((rows[0].lastError || "").includes("denied this knock"), false);
  await syncOutbox(outbox(() => rows, (next) => { rows = next; }, async () => {
    throw Error("must not resend");
  }));
});

test("a 429 on one lead does not stall the other two", async () => {
  const knockFor = (id: string, leadId: string, queueSeq: number): PendingMutation => ({
    id,
    userId: owner.id,
    userName: owner.name,
    leadId,
    createdAt: at,
    queueSeq,
    kind: "knock",
    baseStatus: "claimed",
    status: "not-home",
    disposition: "Not Home",
    syncState: "queued",
    attempts: 0,
    direct: { patch: { status: "not-home" }, serverDispo: true },
  });
  let rows = [
    note("pace-a", "S\nA", "S", { queueSeq: 1, leadId: "lead-a" }),
    knockFor("pace-a-knock", "lead-a", 2),
    note("pace-b", "S\nB", "S", { queueSeq: 3, leadId: "lead-b", createdAt: "2026-10-26T16:00:01.000Z" }),
    knockFor("pace-c-knock", "lead-c", 4),
  ];
  const holders: Record<string, { notes: string }> = {
    "lead-a": { notes: "S" },
    "lead-b": { notes: "S" },
  };
  const sent: string[] = [];
  let now = Date.parse(at);
  let limited = false;
  const run = () => syncOutbox({
    read: async () => rows,
    send: async (row) => {
      sent.push(row.id);
      await deliverFieldDispo(row, owner, {
        getToken: async () => "token",
        commit: async () => { throw Error("direct write must not run"); },
        post: async (path, init) => {
          if (row.id === "pace-a" && !limited) {
            limited = true;
            return new Response(JSON.stringify({ ok: false, error: "rate_limited" }), {
              status: 429,
              headers: { "content-type": "application/json", "retry-after": "30" },
            });
          }
          if (row.kind === "knock") return json(200, { ok: true, historyAppended: true });
          return routePost(holders[row.leadId])(path, init);
        },
      });
    },
    remove: async (id: string) => { rows = rows.filter((row) => row.id !== id); },
    update: async (row) => { rows = rows.map((current) => current.id === row.id ? row : current); },
    insert: async (row) => { rows = [...rows, row]; },
    report: async () => {},
    active: () => true,
    now: () => now,
    random: () => 0,
  });
  await run();
  assert.deepEqual(sent, ["pace-a", "pace-b", "pace-c-knock"]);
  assert.equal(rows.find((row) => row.id === "pace-a")?.syncState, "retry");
  assert.equal(rows.find((row) => row.id === "pace-a-knock")?.syncState, "queued");
  assert.equal(holders["lead-b"].notes, "S\nB");
  assert.equal(holders["lead-a"].notes, "S");
  sent.length = 0;
  await run();
  assert.deepEqual(sent, []);
  now += 30_000;
  await run();
  assert.deepEqual(sent, ["pace-a", "pace-a-knock"]);
  assert.equal(holders["lead-a"].notes, "S\nA");
  assert.equal(rows.length, 0);
});

test("xK7Knock413 keeps a knock queued as payload_too_large and resends it", async () => {
  let posts = 0;
  let now = Date.parse(at);
  let rows: PendingMutation[] = [{
    id: "knock-413",
    userId: owner.id,
    userName: owner.name,
    leadId: "lead-k",
    createdAt: at,
    queueSeq: 1,
    kind: "knock",
    baseStatus: "claimed",
    status: "not-home",
    disposition: "Not Home",
    syncState: "queued",
    attempts: 0,
    direct: { patch: { status: "not-home" }, serverDispo: true },
  }];
  const run = () => syncOutbox({
    read: async () => rows,
    send: async (row) => deliverFieldDispo(row, owner, {
      getToken: async () => "token",
      commit: async () => { throw Error("direct write must not run"); },
      post: async () => {
        posts += 1;
        if (posts === 1) return json(413, { ok: false, error: "payload_too_large", reasonCode: "payload_too_large" });
        return json(200, { ok: true, historyAppended: true });
      },
    }),
    remove: async (id) => { rows = rows.filter((row) => row.id !== id); },
    update: async (row) => { rows = rows.map((current) => current.id === row.id ? row : current); },
    insert: async (row) => { rows = [...rows, row]; },
    report: async () => {},
    active: () => true,
    now: () => now,
    random: () => 0,
  });
  await run();
  assert.equal(posts, 1);
  assert.equal(rows[0].syncState, "queued");
  assert.equal(rows[0].parkedReason, SYNC_REASON.payloadTooLarge);
  assert.equal(rows[0].routeHold, "field-dispo");
  assert.notEqual(rows[0].parkedReason, SYNC_REASON.notesTooLong);
  await run();
  assert.equal(posts, 1);
  now += SERVER_DISPO_SLOW_RETRY_MS;
  await run();
  assert.equal(posts, 2);
  assert.equal(rows.length, 0);
});

test("xK7Knock413AfterNotes resends the knock and leaves the note saved", async () => {
  let knockPosts = 0;
  let now = Date.parse(at);
  const holder = { notes: "S" };
  let rows: PendingMutation[] = [
    note("note-then-knock", "S\nL1", "S", { queueSeq: 1, leadId: "lead-k7" }),
    {
      id: "knock-after-notes",
      userId: owner.id,
      userName: owner.name,
      leadId: "lead-k7",
      createdAt: "2026-10-26T16:00:01.000Z",
      queueSeq: 2,
      kind: "knock",
      baseStatus: "claimed",
      status: "not-home",
      disposition: "Not Home",
      syncState: "queued",
      attempts: 0,
      direct: { patch: { status: "not-home" }, serverDispo: true },
    },
  ];
  const run = () => syncOutbox({
    read: async () => rows,
    send: async (row) => deliverFieldDispo(row, owner, {
      getToken: async () => "token",
      commit: async () => { throw Error("direct write must not run"); },
      post: async (path, init) => {
        if (row.kind === "knock") {
          knockPosts += 1;
          if (knockPosts === 1) return json(413, { ok: false, reasonCode: "payload_too_large" });
          return json(200, { ok: true, historyAppended: true });
        }
        return routePost(holder)(path, init);
      },
    }),
    remove: async (id) => { rows = rows.filter((row) => row.id !== id); },
    update: async (row) => { rows = rows.map((current) => current.id === row.id ? row : current); },
    insert: async (row) => { rows = [...rows, row]; },
    report: async () => {},
    active: () => true,
    now: () => now,
    random: () => 0,
  });
  await run();
  assert.equal(holder.notes, "S\nL1");
  assert.equal(knockPosts, 1);
  const waiting = rows.find((row) => row.id === "knock-after-notes");
  assert.equal(waiting?.syncState, "queued");
  assert.equal(waiting?.parkedReason, SYNC_REASON.payloadTooLarge);
  assert.equal(rows.some((row) => row.kind === "notes"), false);
  now += SERVER_DISPO_SLOW_RETRY_MS;
  await run();
  assert.equal(knockPosts, 2);
  assert.equal(rows.length, 0);
  assert.equal(holder.notes, "S\nL1");
});

function isQueued(row: PendingMutation): boolean {
  return row.syncState !== "parked" && row.syncState !== "gps";
}

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
