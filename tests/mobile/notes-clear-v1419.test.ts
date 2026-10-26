import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildLeadSaveDrafts } from "../../app/field/contactSave";
import { commitDirectMutation, type DirectCommitIo } from "../../app/field/directWrites";
import { resetParkedReopenForTests, reopenDeniedParked } from "../../app/field/draftMigration";
import { classifySyncFailure } from "../../app/field/draftState";
import { deliverFieldDispo, fieldDispoBody, postFieldDispo } from "../../app/field/serverDispo";
import { syncReportItem } from "../../app/field/syncDiagnostics";
import { SYNC_REASON } from "../../app/field/syncReasons";
import { syncOutbox } from "../../app/field/syncOutbox";
import type { PendingMutation } from "../../app/field/types";
import type { Lead, User } from "../../app/types";
import { result1417 } from "../../scripts/contact-save-matrix-1417";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const at = "2026-10-26T12:00:00.000Z";
const seen = "notes the rep last saw";
const owner = { id: "rep-b", name: "Owner", role: "setter" } as User;
const setter = { id: "rep-b", name: "Setter", role: "setter" } as User;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function clearDraft(route: boolean): PendingMutation {
  return {
    id: "notes-1",
    userId: setter.id,
    userName: setter.name,
    leadId: "lead-1",
    createdAt: at,
    kind: "notes",
    baseStatus: "claimed",
    baseNotes: seen,
    notes: "",
    clearNotes: true,
    syncState: "queued",
    attempts: 0,
    direct: { patch: { notes: "" }, ...(route ? { serverDispo: true } : {}) },
  };
}

function lead(notes = seen): Lead {
  return {
    id: "lead-1",
    name: "Old",
    address: "1 Main",
    city: "Buffalo",
    state: "NY",
    zip: "14201",
    phone: "555",
    notes,
    status: "claimed",
    claimedBy: "rep-other",
    territoryId: "territory-1",
  } as unknown as Lead;
}

test("the 14.17 contact baseline is vendored and does not call git", async () => {
  const fixture = readFileSync(path.join(root, "tests/mobile/fixtures/directWrites-1417.ts.txt"), "utf8");
  const loader = readFileSync(path.join(root, "scripts/contact-save-matrix-1417.ts"), "utf8");
  assert.match(fixture, /053ae9e/);
  assert.match(fixture, /export function directPatch/);
  assert.match(loader, /directWrites-1417\.ts\.txt/);
  assert.doesNotMatch(loader, /git show/);
  assert.equal(await result1417({ patch: { phone: "556" }, leadNotes: seen, deny: false }), "pass");
});

test("a clear on a lead the rep does not own sends notes, baseNotes, and clearNotes", async () => {
  const bodies: Record<string, unknown>[] = [];
  const denied = await deliverFieldDispo(clearDraft(false), setter, {
    getToken: async () => "token",
    commit: async () => {
      throw Object.assign(Error("Missing or insufficient permissions."), { code: "permission-denied" });
    },
    post: async (_path, init) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return json(200, { ok: true });
    },
  });
  assert.equal(denied.replayed, false);
  assert.equal(bodies.length, 1);
  assert.equal(bodies[0].notes, "");
  assert.equal(bodies[0].baseNotes, seen);
  assert.equal(bodies[0].clearNotes, true);
  assert.equal(bodies[0].kind, "notes");
  const routed = fieldDispoBody(clearDraft(true), setter);
  assert.deepEqual(
    { notes: routed.notes, baseNotes: routed.baseNotes, clearNotes: routed.clearNotes },
    { notes: "", baseNotes: seen, clearNotes: true },
  );
  const ordinary = fieldDispoBody({ ...clearDraft(true), notes: "kept", clearNotes: undefined, direct: { patch: { notes: "kept" }, serverDispo: true } }, setter);
  assert.equal(ordinary.clearNotes, undefined);
  assert.equal(Object.prototype.hasOwnProperty.call(ordinary, "clearNotes"), false);
});

test("an owner clear writes notes:'' and does not send clearNotes to Firestore", async () => {
  const updates: Record<string, unknown>[] = [];
  let record: Record<string, unknown> = { notes: seen };
  const io = {
    db: {},
    auth: { currentUser: { uid: owner.id } },
    doc: () => ({ path: "leads/lead-1" }),
    runTransaction: async (_database: unknown, fn: (tx: {
      get: () => Promise<{ exists: () => boolean; data: () => Record<string, unknown> }>;
      update: (_ref: unknown, data: Record<string, unknown>) => void;
    }) => Promise<unknown>) => fn({
      get: async () => ({ exists: () => true, data: () => ({ ...record }) }),
      update: (_ref, data) => {
        updates.push(data);
        record = { ...record, ...data };
      },
    }),
  } as unknown as DirectCommitIo;
  const draft = { ...clearDraft(false), userId: owner.id, userName: owner.name };
  await commitDirectMutation(draft, owner, io);
  assert.deepEqual(updates, [{ notes: "" }]);
  assert.equal(record.notes, "");
  assert.equal(Object.prototype.hasOwnProperty.call(updates[0], "clearNotes"), false);
});

test("a whitespace-only edit sends no notes draft and never posts blank notes without clearNotes", async () => {
  const built = buildLeadSaveDrafts({
    lead: lead(seen),
    patch: { notes: "   " },
    actor: setter,
    createdAt: at,
    ids: { notes: "notes-1" },
  });
  assert.equal(built.drafts.length, 0);
  const withPhone = buildLeadSaveDrafts({
    lead: lead(seen),
    patch: { notes: " \n ", phone: "556" },
    actor: setter,
    createdAt: at,
    ids: { contact: "contact-1", notes: "notes-1" },
  });
  assert.equal(withPhone.drafts.length, 1);
  assert.equal(withPhone.drafts[0].kind, "contact");
  assert.equal(withPhone.drafts[0].direct?.patch.notes, undefined);
  let posts = 0;
  let rows: PendingMutation[] = [{
    ...clearDraft(true),
    notes: "   ",
    clearNotes: undefined,
    baseNotes: seen,
    direct: { patch: { notes: "   " }, serverDispo: true },
  }];
  await syncOutbox({
    read: async () => rows,
    send: async (row) => deliverFieldDispo(row, setter, {
      getToken: async () => "token",
      post: async () => {
        posts += 1;
        return json(200, { ok: true });
      },
      commit: async () => {
        throw Error("must not write whitespace notes");
      },
    }),
    remove: async () => {
      throw Error("must not drop");
    },
    update: async (row) => {
      rows = [row];
    },
    report: async () => {},
    active: () => true,
    now: () => Date.parse(at),
    random: () => 0,
  });
  assert.equal(posts, 0);
  assert.equal(rows[0].syncState, "parked");
  assert.equal(rows[0].parkedReason, SYNC_REASON.notesRejected);
  assert.equal(rows[0].notes, "   ");
  await syncOutbox({
    read: async () => rows,
    send: async () => {
      posts += 1;
    },
    remove: async () => {},
    update: async () => {},
    report: async () => {},
    active: () => true,
    now: () => Date.parse(at),
    random: () => 0,
  });
  assert.equal(posts, 0);
});

test("notes_empty, notes_clear_mismatch, and a clearNotes 400 park as notes_rejected with no retry", async () => {
  const cases = [
    { name: "notes_empty", notes: "keep this text", status: 400, body: { ok: false, error: "invalid_payload", reasonCode: "notes_empty", field: "notes" } },
    { name: "notes_clear_mismatch", notes: "", status: 400, body: { ok: false, error: "invalid_payload", reasonCode: "notes_clear_mismatch", field: "notes" } },
    { name: "clearNotes field", notes: "", status: 400, body: { ok: false, error: "invalid_payload", reasonCode: "invalid_payload", field: "clearNotes" } },
  ];
  for (const item of cases) {
    let posts = 0;
    let rows = [item.notes === "" ? clearDraft(true) : {
      ...clearDraft(true),
      notes: item.notes,
      clearNotes: undefined,
      direct: { patch: { notes: item.notes }, serverDispo: true },
    }];
    const run = () => syncOutbox({
      read: async () => rows,
      send: async (row) => postFieldDispo(row, setter, {
        getToken: async () => "token",
        post: async (_path, init) => {
          posts += 1;
          const body = JSON.parse(String(init?.body)) as { clearNotes?: boolean; notes?: string };
          if (item.notes === "") {
            assert.equal(body.notes, "");
            assert.equal(body.clearNotes, true);
          } else {
            assert.equal(body.clearNotes, undefined);
          }
          return json(item.status, item.body);
        },
      }),
      remove: async () => {
        throw Error("must not drop");
      },
      update: async (row) => {
        rows = [row];
      },
      report: async () => {},
      active: () => true,
      now: () => Date.parse(at),
      random: () => 0,
    });
    await run();
    assert.equal(posts, 1, item.name);
    assert.equal(rows[0].syncState, "parked", item.name);
    assert.equal(rows[0].parkedReason, SYNC_REASON.notesRejected, item.name);
    assert.equal(rows[0].notes, item.notes, item.name);
    assert.equal(rows[0].baseNotes, seen, item.name);
    if (item.notes === "") assert.equal(rows[0].clearNotes, true, item.name);
    assert.equal(fieldDispoBody(rows[0], setter).clearNotes, item.notes === "" ? true : undefined, item.name);
    await run();
    assert.equal(posts, 1, `${item.name} is not retried`);
  }
  resetParkedReopenForTests();
  const parked = clearDraft(true);
  parked.syncState = "parked";
  parked.parkedReason = SYNC_REASON.notesRejected;
  const reopened = reopenDeniedParked([parked], setter.id);
  assert.equal(reopened[0].syncState, "queued");
  assert.equal(reopened[0].clearNotes, true);
  assert.equal(reopened[0].notes, "");
  const again = reopenDeniedParked([{ ...reopened[0], syncState: "parked" }], setter.id);
  assert.equal(again[0].syncState, "parked");
  const reported = syncReportItem({
    id: "event-1",
    userId: setter.id,
    at: 1,
    draftId: parked.id,
    leadId: parked.leadId,
    createdAt: at,
    state: "parked",
    parkedReason: SYNC_REASON.notesRejected,
    attempts: 1,
  });
  assert.equal(reported.reasonCode, SYNC_REASON.invalidPayload);
});

test("a 409 on a clear stays a conflict and keeps clearNotes", async () => {
  let posts = 0;
  const bodies: { notes?: string; clearNotes?: boolean; baseNotes?: string }[] = [];
  let rows = [clearDraft(true)];
  await syncOutbox({
    read: async () => rows,
    send: async (row) => postFieldDispo(row, setter, {
      getToken: async () => "token",
      post: async (_path, init) => {
        posts += 1;
        bodies.push(JSON.parse(String(init?.body)));
        return json(409, { ok: false, error: "conflict", reasonCode: "notes_conflict", currentNotes: "someone else" });
      },
    }),
    remove: async () => {
      throw Error("must not drop");
    },
    update: async (row) => {
      rows = [row];
    },
    report: async () => {},
    active: () => true,
    now: () => Date.parse(at),
    random: () => 0,
  });
  assert.equal(posts, 1);
  assert.equal(bodies.length, 1);
  assert.equal(bodies[0].notes, "");
  assert.equal(bodies[0].baseNotes, seen);
  assert.equal(bodies[0].clearNotes, true);
  assert.equal(rows[0].syncState, "retry");
  assert.equal(rows[0].notes, "");
  assert.equal(rows[0].clearNotes, true);
  assert.equal(rows[0].baseNotes, seen);
  assert.match(rows[0].lastError || "", /Notes changed on another device/);
  assert.equal(classifySyncFailure(Object.assign(Error("Notes changed on another device. Review this draft."), {
    status: 409,
    reasonCode: SYNC_REASON.notesConflict,
  })).kind, "transient");
});

test("a 413 with reasonCode payload_too_large is classified from the body", async () => {
  assert.deepEqual(
    classifySyncFailure(Object.assign(Error("too big"), { status: 413, reasonCode: SYNC_REASON.payloadTooLarge })),
    { kind: "slow", parkedReason: SYNC_REASON.payloadTooLarge },
  );
  let posts = 0;
  let rows: PendingMutation[] = [{
    ...clearDraft(true),
    notes: "still here",
    clearNotes: undefined,
    direct: { patch: { notes: "still here" }, serverDispo: true },
  }];
  await syncOutbox({
    read: async () => rows,
    send: async (row) => postFieldDispo(row, setter, {
      getToken: async () => "token",
      post: async () => {
        posts += 1;
        return json(413, { ok: false, error: "payload_too_large", reasonCode: "payload_too_large" });
      },
    }),
    remove: async () => {
      throw Error("must not drop");
    },
    update: async (row) => {
      rows = [row];
    },
    report: async () => {},
    active: () => true,
    now: () => Date.parse(at),
    random: () => 0,
  });
  assert.equal(posts, 1);
  assert.equal(rows[0].syncState, "queued");
  assert.equal(rows[0].parkedReason, SYNC_REASON.payloadTooLarge);
  assert.equal(rows[0].routeHold, "field-dispo");
  assert.equal(rows[0].notes, "still here");
  assert.match(readFileSync(path.join(root, "app/field/notesLimits.ts"), "utf8"), /15efe05/);
  assert.match(readFileSync(path.join(root, "docs/mobile-next/RELEASE-V14.19.md"), "utf8"), /Requires #175 deployed/);
});
