// NOTES-MERGE-SPEC "Decisions v3" V1-V4, one test (or more) per decision.
import test from "node:test";
import assert from "node:assert/strict";
import { overlayDrafts } from "../../app/field/deviceStore";
import { acceptDisposition, resetQueueSeqForTests } from "../../app/field/draftQueue";
import { commitDirectMutation, type DirectCommitIo } from "../../app/field/directWrites";
import { resetParkedReopenForTests, reopenDeniedParked } from "../../app/field/draftMigration";
import { effectiveSyncState } from "../../app/field/draftState";
import { NOTES_CLEAR_KEPT_NOTICE, clearAfterConflict } from "../../app/field/notesRebase";
import { postFieldDispo } from "../../app/field/serverDispo";
import { recordSyncEvent, reportParked, resetSyncLogForTests, syncReportFailedKinds } from "../../app/field/syncDiagnostics";
import { SYNC_REASON } from "../../app/field/syncReasons";
import { syncOutbox } from "../../app/field/syncOutbox";
import type { PendingMutation } from "../../app/field/types";
import type { Lead, User } from "../../app/types";

const at = "2026-10-26T12:00:00.000Z";
const rep = { id: "rep-m", name: "Manager", role: "manager" } as User;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function clear(base: string, extra: Partial<PendingMutation> = {}): PendingMutation {
  return {
    id: "clear-1",
    userId: rep.id,
    userName: rep.name,
    leadId: "lead-1",
    createdAt: at,
    kind: "notes",
    baseStatus: "claimed",
    baseNotes: base,
    notes: "",
    clearNotes: true,
    syncState: "queued",
    attempts: 0,
    direct: { patch: { notes: "" }, serverDispo: true },
    ...extra,
  };
}

function lead(notes: string): Lead {
  return { id: "lead-1", name: "L", address: "1 Main", city: "Buffalo", state: "NY", zip: "14201", notes, status: "claimed", claimedBy: "rep-other" } as unknown as Lead;
}

function outbox(get: () => PendingMutation[], set: (rows: PendingMutation[]) => void, send: (row: PendingMutation) => Promise<unknown>, report: (userId: string) => Promise<unknown> = async () => {}) {
  return {
    read: async () => get(),
    send,
    remove: async (id: string) => set(get().filter((row) => row.id !== id)),
    update: async (row: PendingMutation) => set(get().map((current) => current.id === row.id ? row : current)),
    report,
    active: () => true,
    now: () => Date.parse(at),
    random: () => 0,
  };
}

test("V1: after a clear parks on a 400 clearNotes, the editor shows the kept notes, never ''", async () => {
  let rows = [clear("Gate code 1234\nDog in yard")];
  const server = "Gate code 1234\nDog in yard\nA1";
  await syncOutbox(outbox(() => rows, (next) => { rows = next; }, (row) => postFieldDispo(row, rep, {
    getToken: async () => "token",
    post: async () => json(400, { ok: false, error: "invalid_payload", reasonCode: "invalid_payload", field: "clearNotes" }),
  })));
  assert.equal(rows[0].syncState, "parked");
  assert.equal(rows[0].parkedReason, SYNC_REASON.notesRejected);
  const shown = overlayDrafts([lead(server)], rows)[0].notes;
  assert.equal(shown, server);
  assert.notEqual(shown, "");
  // Without direct (plain overlay path) the parked clear also never blanks the editor.
  const plain = { ...rows[0], direct: undefined };
  assert.equal(overlayDrafts([lead(server)], [plain])[0].notes, server);
});

test("V2: a sync-report 404 or failure never blocks, delays, or re-orders the queue", async () => {
  const order: string[] = [];
  let rows: PendingMutation[] = [
    { ...clear("S"), id: "a", notes: "S\nA", clearNotes: undefined, direct: { patch: { notes: "S\nA" }, serverDispo: true }, leadId: "lead-a", queueSeq: 1 },
    { ...clear("S"), id: "b", notes: "S\nB", clearNotes: undefined, direct: { patch: { notes: "S\nB" }, serverDispo: true }, leadId: "lead-b", queueSeq: 2 },
  ];
  let reports = 0;
  // A report that never settles and one that throws: the queue still finishes in order.
  for (const report of [() => new Promise<never>(() => {}), async () => { throw Object.assign(Error("404"), { status: 404 }); }]) {
    order.length = 0;
    const snapshot = rows.map((row) => ({ ...row }));
    let local = snapshot;
    const done = await Promise.race([
      syncOutbox(outbox(() => local, (next) => { local = next; }, async (row) => {
        order.push(row.id);
        if (row.id === "a") throw Object.assign(Error("Notes were rejected."), { status: 400, reasonCode: SYNC_REASON.notesRejected });
        return { replayed: false };
      }, async () => { reports += 1; return report(); })),
      new Promise((resolve) => setTimeout(() => resolve("blocked"), 1000)),
    ]);
    assert.notEqual(done, "blocked");
    assert.deepEqual(order, ["a", "b"]);
    assert.equal(local.length, 1);
    assert.equal(local[0].id, "a");
  }
  rows = [];
  assert.ok(reports >= 2);
});

test("V2: sync-report is posted at most once per session per failure kind, with no retry loop", async () => {
  for (const failure of [404, 0, 401, 500] as const) {
    resetSyncLogForTests();
    let requests = 0;
    for (let i = 0; i < 5; i += 1) {
      await recordSyncEvent({ id: `event-${failure}-${i}`, userId: "rep", at: 1, draftId: `draft-${i}`, leadId: "lead-1", createdAt: at, state: "parked", parkedReason: SYNC_REASON.notesRejected, attempts: 1 });
      await reportParked("rep", {
        session: true,
        probe: async () => { requests += 1; return 204; },
        post: async () => { requests += 1; return failure; },
      });
    }
    assert.equal(requests, 2, `status ${failure}: one probe and one post`);
    assert.equal(syncReportFailedKinds().length, 1, `status ${failure}`);
  }
  resetSyncLogForTests();
  let probes = 0;
  for (let i = 0; i < 5; i += 1) {
    await recordSyncEvent({ id: `probe-${i}`, userId: "rep", at: 1, draftId: `probe-draft-${i}`, leadId: "lead-1", createdAt: at, state: "parked", parkedReason: SYNC_REASON.notesRejected, attempts: 1 });
    await reportParked("rep", { session: true, probe: async () => { probes += 1; return 404; }, post: async () => { throw Error("never posts"); } });
  }
  assert.equal(probes, 1);
  resetSyncLogForTests();
  assert.deepEqual(syncReportFailedKinds(), []);
});

test("V3: a parked clear stays parked across later syncs and cold starts; only a new save replaces it", async () => {
  resetParkedReopenForTests();
  resetQueueSeqForTests();
  const parked = clear("S\nA", { syncState: "parked", parkedReason: SYNC_REASON.notesRejected, queueSeq: 3 });
  const reopened = reopenDeniedParked([parked], rep.id);
  assert.equal(reopened[0].syncState, "parked");
  // Even if a stored row says queued/retry, a refused clear is parked.
  for (const syncState of ["queued", "retry", undefined] as const) {
    assert.equal(effectiveSyncState({ ...parked, syncState }), "parked");
  }
  let posts = 0;
  let rows: PendingMutation[] = [{ ...parked, syncState: "queued" }];
  for (let i = 0; i < 3; i += 1) {
    await syncOutbox(outbox(() => rows, (next) => { rows = next; }, (row) => postFieldDispo(row, rep, {
      getToken: async () => "token",
      post: async () => { posts += 1; return json(200, { ok: true }); },
    })));
  }
  assert.equal(posts, 0);
  assert.equal(rows.length, 1);
  const { syncState: _s, parkedReason: _p, queueSeq: _q, attempts: _a, clearNotes: _c, ...fresh } = parked;
  const save = acceptDisposition(rows, { ...fresh, id: "new-save", notes: "S\nA\nC1", baseNotes: "S\nA", direct: { patch: { notes: "S\nA\nC1" }, serverDispo: true } });
  assert.equal(save.clearNotes, undefined);
  assert.equal(save.notes, "S\nA\nC1");
  assert.notEqual(effectiveSyncState(save), "parked");
});

test("V4: a 409 clear runs diff3(base, current, ''); a non-blank result goes out as plain notes with base=current", async () => {
  assert.equal(clearAfterConflict({ baseNotes: "S\nA" }, "S\nA\nC1"), "C1");
  const bodies: { notes?: string; baseNotes?: string; clearNotes?: boolean }[] = [];
  const server = { notes: "S\nA\nC1" };
  const result = await postFieldDispo(clear("S\nA"), rep, {
    getToken: async () => "token",
    post: async (_path, init) => {
      const body = JSON.parse(String(init?.body));
      bodies.push(body);
      if (body.baseNotes !== server.notes) return json(409, { ok: false, reasonCode: "notes_conflict", currentNotes: server.notes });
      server.notes = body.notes;
      return json(200, { ok: true });
    },
  });
  assert.deepEqual(bodies.map((b) => [b.notes, b.baseNotes, b.clearNotes]), [["", "S\nA", true], ["C1", "S\nA\nC1", undefined]]);
  assert.equal(server.notes, "C1");
  assert.equal(result.notice, NOTES_CLEAR_KEPT_NOTICE);
  assert.equal(NOTES_CLEAR_KEPT_NOTICE, "Notes changed on another device. Other people's new notes were kept.");
});

test("V4: a 409 clear whose diff3 result is blank clears once with base=current and no notice", async () => {
  const bodies: { notes?: string; baseNotes?: string; clearNotes?: boolean }[] = [];
  const result = await postFieldDispo(clear("S\nA"), rep, {
    getToken: async () => "token",
    post: async (_path, init) => {
      const body = JSON.parse(String(init?.body));
      bodies.push(body);
      return bodies.length === 1 ? json(409, { ok: false, reasonCode: "notes_conflict", currentNotes: "A" }) : json(200, { ok: true });
    },
  });
  assert.deepEqual(bodies.map((b) => [b.notes, b.baseNotes, b.clearNotes]), [["", "S\nA", true], ["", "A", true]]);
  assert.equal(result.notice, undefined);
  // Decisions v4 answers: a clear still answered 409 gets at most 3 sends per flush, then stays pending (not parked, no tight loop).
  let posts = 0;
  let rows = [clear("S\nA")];
  await syncOutbox(outbox(() => rows, (next) => { rows = next; }, (row) => postFieldDispo(row, rep, {
    getToken: async () => "token",
    post: async () => { posts += 1; return json(409, { ok: false, reasonCode: "notes_conflict", currentNotes: "A" }); },
  })));
  assert.equal(posts, 3);
  assert.equal(rows[0].syncState, "retry");
  assert.notEqual(rows[0].syncState, "parked");
  assert.match(String(rows[0].lastError ?? rows[0].error ?? ""), /Pending\. Notes changed on another device\./);
  // V4 answers: retried on the next flush (no backoff); one send round per flush, so no tight loop.
  assert.equal(rows[0].nextAttemptAt, undefined, "retried on the next flush");
});

test("V4 repeat 409: each 409 re-merges against the fresh current notes (another device keeps typing)", async () => {
  const bodies: { notes?: string; baseNotes?: string; clearNotes?: boolean }[] = [];
  const currents = ["S\nX1", "S\nX1\nY1"];
  const result = await postFieldDispo(clear("S"), rep, {
    getToken: async () => "token",
    post: async (_path, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      const cur = currents[bodies.length - 1];
      return cur ? json(409, { ok: false, reasonCode: "notes_conflict", currentNotes: cur }) : json(200, { ok: true });
    },
  });
  assert.deepEqual(bodies.map((b) => [b.notes, b.baseNotes, b.clearNotes]), [
    ["", "S", true],
    ["X1", "S\nX1", undefined],
    ["X1\nY1", "S\nX1\nY1", undefined],
  ]);
  assert.equal(result.notice, NOTES_CLEAR_KEPT_NOTICE);
});

test("V4: an owner (direct) clear over newer server lines keeps them and returns the notice", async () => {
  for (const [record0, expected, notice] of [["S\nA\nC1", "C1", NOTES_CLEAR_KEPT_NOTICE], ["S\nA", "", undefined], ["A", "", undefined]] as const) {
    let record: Record<string, unknown> = { notes: record0 };
    const updates: Record<string, unknown>[] = [];
    const io = {
      db: {},
      auth: { currentUser: { uid: rep.id } },
      doc: () => ({ path: "leads/lead-1" }),
      runTransaction: async (_d: unknown, fn: (tx: unknown) => Promise<unknown>) => fn({
        get: async () => ({ exists: () => true, data: () => ({ ...record }) }),
        update: (_ref: unknown, data: Record<string, unknown>) => { updates.push(data); record = { ...record, ...data }; },
      }),
    } as unknown as DirectCommitIo;
    const draft = clear("S\nA", { direct: { patch: { notes: "" } } });
    const result = await commitDirectMutation(draft, rep, io) as { notice?: string } | undefined;
    assert.equal(record.notes, expected, record0);
    assert.equal(result?.notice, notice, record0);
    for (const update of updates) assert.equal(Object.prototype.hasOwnProperty.call(update, "clearNotes"), false);
  }
});
