import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildLeadSaveDrafts, coerceLegacyContactDraft } from "../../app/field/contactSave";
import { acceptDisposition, compareQueuedDrafts } from "../../app/field/draftQueue";
import { commitDirectMutation, type DirectCommitIo } from "../../app/field/directWrites";
import { migrateDraft, resetParkedReopenForTests, reopenDeniedParked } from "../../app/field/draftMigration";
import { classifySyncFailure } from "../../app/field/draftState";
import { NOTES_BLANK_MESSAGE, NOTES_UNSAVED_MESSAGE, parkedNotesBanner, parkedNotesNotice, whitespaceNotesChange } from "../../app/field/notesLimits";
import { rebaseNotes } from "../../app/field/notesRebase";
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

const gate = "Gate code…";

function blankDraft(actor: User, notes = "", route = false): PendingMutation {
  return {
    id: "legacy-blank",
    userId: actor.id,
    userName: actor.name,
    leadId: "lead-1",
    createdAt: at,
    kind: "notes",
    baseStatus: "claimed",
    baseNotes: gate,
    notes,
    syncState: "queued",
    attempts: 0,
    direct: { patch: { notes }, ...(route ? { serverDispo: true } : {}) },
  };
}

test("legacy blank notes and reopened notes_too_long blanks park as notes_rejected", async () => {
  const roles = [
    { name: "owner", user: owner, route: false },
    { name: "setter", user: { ...setter, id: "rep-setter" } as User, route: true },
    { name: "manager", user: { id: "rep-manager", name: "Manager", role: "manager" } as User, route: true },
  ];
  for (const role of roles) {
    for (const shape of ["legacy", "leftover"] as const) {
      resetParkedReopenForTests();
      const updates: Record<string, unknown>[] = [];
      let record: Record<string, unknown> = { notes: gate };
      const io = {
        db: {},
        auth: { currentUser: { uid: role.user.id } },
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
      const notes = shape === "legacy" && role.name === "manager" ? "   " : "";
      let rows = [blankDraft(role.user, notes, role.route)];
      if (shape === "leftover") {
        rows = [{
          ...rows[0],
          notes: "",
          syncState: "parked",
          parkedReason: SYNC_REASON.notesTooLong,
          direct: { patch: { notes: "" }, ...(role.route ? { serverDispo: true } : {}) },
        }];
        rows = reopenDeniedParked(rows, role.user.id);
        assert.equal(rows[0].syncState, "queued", `${role.name} ${shape}`);
        assert.notEqual(rows[0].clearNotes, true, `${role.name} ${shape} reopen`);
      }
      const migrated = migrateDraft(rows[0], role.user);
      assert.notEqual(migrated.clearNotes, true, `${role.name} ${shape} migrate`);
      assert.notEqual(coerceLegacyContactDraft(rows[0]).clearNotes, true, `${role.name} ${shape} coerce`);
      assert.equal(coerceLegacyContactDraft(rows[0]).kind, "notes");
      let posts = 0;
      const run = () => syncOutbox({
        read: async () => rows,
        send: async (row) => deliverFieldDispo(row, role.user, {
          getToken: async () => "token",
          commit: async (mutation, user) => commitDirectMutation(mutation, user, io),
          post: async () => {
            posts += 1;
            return json(200, { ok: true });
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
      assert.equal(posts, 0, `${role.name} ${shape} posts`);
      assert.equal(updates.length, 0, `${role.name} ${shape} writes`);
      assert.equal(record.notes, gate, `${role.name} ${shape} notes`);
      assert.equal(rows[0].syncState, "parked", `${role.name} ${shape}`);
      assert.equal(rows[0].parkedReason, SYNC_REASON.notesRejected, `${role.name} ${shape}`);
      assert.notEqual(rows[0].clearNotes, true, `${role.name} ${shape} flag`);
      await run();
      assert.equal(posts, 0, `${role.name} ${shape} second sync`);
      assert.equal(updates.length, 0, `${role.name} ${shape} second writes`);
    }
  }
  const carrier = coerceLegacyContactDraft({
    ...blankDraft(owner),
    direct: { patch: { phone: "556" } },
  });
  assert.equal(carrier.kind, "contact");
  assert.equal(carrier.clearNotes, undefined);
  assert.equal(carrier.notes, undefined);
});

test("rebaseNotes keeps typed text and does not duplicate a clear-then-type", () => {
  const server = "Gate code 1234\nDog in yard";
  const dog = rebaseNotes("Older text", "Older text\nDog", server);
  assert.equal(dog.notes, `${server}\nDog`);
  assert.equal(rebaseNotes(dog.baseNotes, dog.notes, dog.notes).notes, dog.notes);
  const call = rebaseNotes("Older text", "Older text\nCall", "Call after 5");
  assert.equal(call.notes, "Call after 5\nCall");
  assert.equal(rebaseNotes(call.baseNotes, call.notes, call.notes).notes, call.notes);
  const middle = rebaseNotes("", "Dog", "prefix Dog suffix");
  assert.equal(middle.notes, "prefix Dog suffix\nDog");
  const line = "Gate code 1234";
  const base = `${line}\nCall after 5`;
  const once = rebaseNotes(base, "Call after 5", line);
  assert.equal(once.notes, `${line}\nCall after 5`);
  const twice = rebaseNotes(base, "Call after 5", once.notes);
  assert.equal(twice.notes, once.notes);
  assert.equal(rebaseNotes(once.baseNotes, once.notes, once.notes).notes, once.notes);
  assert.equal(once.notes.includes(line), true);
  assert.equal(once.notes.includes("Call after 5"), true);
  assert.deepEqual(rebaseNotes("", "Gate code…\nCall after 5", "Gate code…"), {
    notes: "Gate code…\nCall after 5",
    baseNotes: "Gate code…",
  });
  const typed = rebaseNotes("", "Gate code…\nCall after 5", "Gate code…").notes;
  assert.equal(rebaseNotes("", "Gate code…\nCall after 5", typed).notes, typed);
  assert.equal(rebaseNotes("", "Call after 5", "Dog in yard").notes, "Dog in yard\nCall after 5");
});

test("parked note reasons are visible and a whitespace save is not treated as saved", () => {
  assert.equal(whitespaceNotesChange("Gate code…", "   "), true);
  assert.equal(whitespaceNotesChange("Gate code…", ""), false);
  assert.equal(whitespaceNotesChange("Gate code…", "Gate code…"), false);
  const rejected = parkedNotesNotice([{
    leadId: "lead-1",
    kind: "notes",
    notes: "",
    syncState: "parked",
    parkedReason: SYNC_REASON.notesRejected,
  }], "lead-1");
  assert.equal(rejected, "These notes weren't saved. Blank notes aren't sent.");
  assert.equal(parkedNotesNotice([{
    leadId: "lead-1",
    kind: "notes",
    notes: "",
    clearNotes: true,
    syncState: "parked",
    parkedReason: SYNC_REASON.notesRejected,
  }], "lead-1"), "These notes weren't saved. The server rejected this clear.");
  assert.equal(parkedNotesNotice([{
    leadId: "lead-1",
    kind: "notes",
    syncState: "parked",
    parkedReason: SYNC_REASON.notesTooLong,
  }], "lead-1"), "These notes weren't saved. Too long.");
  assert.equal(parkedNotesBanner([{
    leadId: "lead-2",
    kind: "notes",
    syncState: "parked",
    parkedReason: SYNC_REASON.notesConflict,
  }]), "Notes changed on another device.");
  assert.equal(parkedNotesNotice([{
    leadId: "lead-1",
    kind: "notes",
    syncState: "retry",
    lastError: "Notes changed on another device. Review this draft.",
  }], "lead-1"), "Pending. Notes changed on another device.");
  assert.equal(parkedNotesBanner([{
    leadId: "lead-9",
    kind: "notes",
    syncState: "retry",
    lastError: "Notes changed on another device. Review this draft.",
  }]), "Pending. Notes changed on another device.");
  assert.equal(parkedNotesNotice([{
    leadId: "lead-1",
    kind: "notes",
    syncState: "queued",
    parkedReason: SYNC_REASON.notesRejected,
  }], "lead-1"), null);
  const detail = readFileSync(path.join(root, "app/components/LeadDetail.tsx"), "utf8");
  const modal = readFileSync(path.join(root, "app/components/LeadEditorModal.tsx"), "utf8");
  const workspace = readFileSync(path.join(root, "app/field/FieldWorkspace.tsx"), "utf8");
  const tools = readFileSync(path.join(root, "app/mobile/field-tools/page.tsx"), "utf8");
  assert.match(detail, /fieldMessage !== NOTES_BLANK_MESSAGE/);
  assert.match(detail, /NOTES_BLANK_MESSAGE/);
  assert.match(detail, /parkedNotesNotice/);
  assert.match(detail, /whitespaceNotesChange/);
  assert.match(modal, /NOTES_BLANK_MESSAGE/);
  assert.match(modal, /setNotesNotice\(NOTES_BLANK_MESSAGE\)/);
  assert.match(modal, /parkedNotesNotice/);
  assert.doesNotMatch(modal, /if \(notesTooLong\) return/);
  assert.match(workspace, /parkedNotesBanner/);
  assert.match(workspace, /rf-notice/);
  assert.match(tools, /drafts=\{field\.drafts\}/);
  assert.equal(NOTES_BLANK_MESSAGE, "Notes weren't saved because they're blank.");
  assert.equal(NOTES_UNSAVED_MESSAGE, "These notes weren't saved.");
});

test("same-millisecond clear and type leave the queue in the order the rep acted", async () => {
  const atSame = "2026-10-26T12:00:00.000Z";
  assert.ok(compareQueuedDrafts(
    { createdAt: "2026-10-26T12:00:00.001Z", id: "a" },
    { createdAt: "2026-10-26T12:00:00.000Z", id: "z" },
  ) > 0);
  assert.ok(compareQueuedDrafts({ createdAt: atSame, id: "a" }, { createdAt: atSame, id: "z" }) < 0);
  assert.ok(compareQueuedDrafts(
    { createdAt: atSame, id: "a", queueSeq: 2 },
    { createdAt: atSame, id: "z", queueSeq: 1 },
  ) > 0);
  const cases: {
    name: string;
    start: string;
    first: { id: string; notes: string; baseNotes: string; clearNotes?: boolean };
    second: { id: string; notes: string; baseNotes: string; clearNotes?: boolean };
    expect: string;
  }[] = [
    {
      name: "clear-then-type",
      start: "Gate code",
      first: { id: "z-clear", notes: "", baseNotes: "Gate code", clearNotes: true },
      second: { id: "a-type", notes: "Call after 5", baseNotes: "" },
      expect: "Call after 5",
    },
    {
      name: "type-then-clear",
      start: "Gate code",
      first: { id: "z-type", notes: "Dog", baseNotes: "Gate code" },
      second: { id: "a-clear", notes: "", baseNotes: "Dog", clearNotes: true },
      expect: "",
    },
  ];
  for (const item of cases) {
    const draft = (part: (typeof cases)[number]["first"]): PendingMutation => ({
      id: part.id,
      userId: owner.id,
      userName: owner.name,
      leadId: "lead-1",
      createdAt: atSame,
      kind: "notes",
      baseStatus: "claimed",
      baseNotes: part.baseNotes,
      notes: part.notes,
      ...(part.clearNotes ? { clearNotes: true } : {}),
      direct: { patch: { notes: part.notes } },
    });
    const first = acceptDisposition([], draft(item.first));
    const second = acceptDisposition([first], draft(item.second));
    assert.equal(first.queueSeq, 1, item.name);
    assert.equal(second.queueSeq, 2, item.name);
    assert.equal(acceptDisposition([first, second], first).queueSeq, 1, `${item.name} replay`);
    assert.ok(second.id < first.id, item.name);
    let rows = [second, first];
    let record: Record<string, unknown> = { notes: item.start };
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
          record = { ...record, ...data };
        },
      }),
    } as unknown as DirectCommitIo;
    await syncOutbox({
      read: async () => rows,
      send: async (row) => deliverFieldDispo(row, owner, {
        getToken: async () => "token",
        commit: async (mutation, user) => commitDirectMutation(mutation, user, io),
        post: async () => {
          throw Error("same-millisecond notes must not use the route");
        },
      }),
      remove: async (id) => {
        rows = rows.filter((row) => row.id !== id);
      },
      update: async (row) => {
        rows = rows.map((current) => (current.id === row.id ? row : current));
      },
      report: async () => {},
      active: () => true,
      now: () => Date.parse(atSame),
      random: () => 0,
    });
    assert.equal(record.notes ?? "", item.expect, item.name);
    assert.equal(rows.length, 0, item.name);
    assert.equal(rows.some((row) => row.syncState === "retry"), false, item.name);
  }
  const hook = readFileSync(path.join(root, "app/field/useFieldData.ts"), "utf8");
  assert.match(hook, /readDrafts\(uid\)/);
  assert.match(hook, /acceptDisposition\(drafts, m\)/);
});
