import test from "node:test";
import assert from "node:assert/strict";
import { acceptDisposition, resetQueueSeqForTests } from "../../app/field/draftQueue";
import { commitDirectMutation, type DirectCommitIo } from "../../app/field/directWrites";
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
});

test("a new notes draft chains its base to the previous unsent note", async () => {
  resetQueueSeqForTests();
  const first = acceptDisposition([], note("chain-a", "S\nA1", "S"));
  const second = acceptDisposition([first], note("chain-b", "S\nA1\nB1", "S", { createdAt: "2026-10-26T16:00:01.000Z" }));
  assert.equal(second.baseNotes, "S\nA1");
  assert.equal(second.notes, "S\nA1\nB1");
  let rows = [second, first];
  let record = "S";
  const writes: string[] = [];
  const io = leadIo(() => record, (next) => {
    record = next;
    writes.push(next);
  });
  await syncOutbox(outbox(() => rows, (next) => { rows = next; }, async (row) => {
    await deliverFieldDispo(row, owner, {
      getToken: async () => "token",
      commit: async (mutation, user) => commitDirectMutation(mutation, user, io),
      post: async () => { throw Error("chained owned notes must not use the route"); },
    });
  }));
  assert.equal(record, "S\nA1\nB1");
  assertLinesOnce(record, ["S", "A1", "B1"], "chain");
  assert.equal(writes.length, 2);
  assert.equal(rows.length, 0);
});

test("xRpLost and xRpKill keep plain and contested owned notes", async () => {
  const shapes = ["plain", "contested"] as const;
  const modes = ["lost", "kill"] as const;
  for (const shape of shapes) {
    for (const mode of modes) {
      const label = `xRp${mode === "lost" ? "Lost" : "Kill"} ${shape}`;
      const base = shape === "plain" ? "S" : "Gate code 1234\nDog in yard";
      const typed = shape === "plain" ? "S\nA1" : "Dog in yard";
      const start = shape === "plain" ? "S" : "Gate code 1234";
      const expect = shape === "plain" ? "S\nA1" : "Gate code 1234\nDog in yard";
      let record = start;
      const writes: string[] = [];
      const order: string[] = [];
      let ahead: PendingMutation | undefined;
      let rows = [note("x-rp", typed, base)];
      let drop = true;
      const io = leadIo(() => record, (next) => {
        order.push("write");
        record = next;
        writes.push(next);
      }, async (row) => {
        order.push("persist");
        assert.equal(row.appliedNotes, expect, label);
        assert.equal(row.appliedAgainst, start, label);
        ahead = { ...row, syncState: "queued", attempts: 0 };
        delete ahead.nextAttemptAt;
        delete ahead.lastError;
        rows = rows.map((current) => current.id === row.id ? { ...current, ...row } : current);
      });
      const run = () => syncOutbox(outbox(() => rows, (next) => { rows = next; }, async (row) => {
        await deliverFieldDispo(row, owner, {
          getToken: async () => "token",
          commit: async (mutation, user) => commitDirectMutation(mutation, user, io),
          post: async () => { throw Error("owned notes must not use the route"); },
        });
        if (drop) {
          drop = false;
          throw Object.assign(Error("failed to fetch"), { code: "network-request-failed" });
        }
      }, Date.parse(at)));
      await run();
      assert.deepEqual(order, ["persist", "write"], label);
      assert.equal(record, expect, label);
      assert.equal(writes.length, 1, label);
      if (mode === "kill") {
        assert.ok(ahead, label);
        rows = [ahead as PendingMutation];
      }
      drop = false;
      await syncOutbox(outbox(() => rows, (next) => { rows = next; }, async (row) => {
        await deliverFieldDispo(row, owner, {
          getToken: async () => "token",
          commit: async (mutation, user) => commitDirectMutation(mutation, user, io),
          post: async () => { throw Error("owned notes must not use the route"); },
        });
      }, Date.parse(at) + 20 * 60 * 1000));
      assert.equal(writes.length, 1, `${label} replay`);
      assert.equal(record, expect, `${label} replay`);
      assert.equal(rows.length, 0, `${label} removed`);
      await syncOutbox(outbox(() => rows, (next) => { rows = next; }, async () => {
        throw Error("a removed draft must not send again");
      }, Date.parse(at) + 40 * 60 * 1000));
      assert.equal(record, expect, `${label} double`);
      assertLinesOnce(record, shape === "plain" ? ["S", "A1"] : ["Gate code 1234", "Dog in yard"], label);
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
  let record = "S";
  const writes: string[] = [];
  let rows = [
    note("x-co-a", "S\nA1", "S", { queueSeq: 1 }),
    note("x-co-b", "S\nA1\nB1", "S\nA1", { queueSeq: 2 }),
  ];
  let drop = true;
  const io = leadIo(() => record, (next) => {
    record = next;
    writes.push(next);
  }, async (row) => {
    rows = rows.map((current) => current.id === row.id ? { ...current, ...row } : current);
  });
  const send = async (row: PendingMutation) => {
    await deliverFieldDispo(row, owner, {
      getToken: async () => "token",
      commit: async (mutation, user) => commitDirectMutation(mutation, user, io),
      post: async () => { throw Error("owned notes must not use the route"); },
    });
    if (drop && row.id === "x-co-a") {
      drop = false;
      throw Object.assign(Error("failed to fetch"), { code: "network-request-failed" });
    }
  };
  await syncOutbox(outbox(() => rows, (next) => { rows = next; }, send, Date.parse(at)));
  assert.equal(record, "S\nA1");
  assert.equal(rows.some((row) => row.id === "x-co-a"), true);
  await syncOutbox(outbox(() => rows, (next) => { rows = next; }, send, Date.parse(at) + 20 * 60 * 1000));
  assert.equal(record, "S\nA1\nB1");
  assert.notEqual(record, "S\nA1\nB1\nA1");
  assertLinesOnce(record, ["S", "A1", "B1"], "xCoCrashMidRemove");
  assert.equal(writes.length, 2);
  assert.equal(rows.length, 0);
});

test("xCoDiffBases keeps each line once", async () => {
  let record = "S";
  let rows = [
    note("x-co-a1", "S\nA1", "S", { queueSeq: 1 }),
    note("x-co-b1", "S\nOther\nB1", "S", { queueSeq: 2 }),
  ];
  const io = leadIo(() => record, (next) => { record = next; });
  await syncOutbox(outbox(() => rows, (next) => { rows = next; }, async (row) => {
    await deliverFieldDispo(row, owner, {
      getToken: async () => "token",
      commit: async (mutation, user) => commitDirectMutation(mutation, user, io),
      post: async () => { throw Error("owned notes must not use the route"); },
    });
  }));
  assert.notEqual(record, "S\nOther\nA1\nOther\nB1");
  assert.equal(record, "S\nA1\nOther\nB1");
  assertLinesOnce(record, ["S", "A1", "Other", "B1"], "xCoDiffBases");
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
