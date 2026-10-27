import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { enqueueDirectSave } from "../../app/field/enqueueDirectSave";
import { commitDirectMutation, directPatch, type DirectCommitIo } from "../../app/field/directWrites";
import { deliverFieldDispo, fieldDispoBody } from "../../app/field/serverDispo";
import {
  CONTACT_NOT_ON_PIN_NOTICE,
  CONTACT_NOT_SENT_MESSAGE,
  contactDraftBlocksSendInfo,
  finishSendInfo,
  parkContactDeniedDrafts,
  repMayWriteContactFields,
  sendInfoMayWriteContact,
  sendInfoPostDecision,
} from "../../app/field/sendInfoGate";
import { syncOutbox } from "../../app/field/syncOutbox";
import type { PendingMutation } from "../../app/field/types";
import type { Lead, User } from "../../app/types";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const at = "2026-10-26T12:00:00.000Z";
const kept = "keep these notes";
const owner = { id: "rep-b", name: "Owner", role: "setter" } as User;
const setter = { id: "rep-b", name: "Setter", role: "setter" } as User;
const manager = { id: "rep-b", name: "Manager", role: "manager" } as User;

function lead(owned: boolean): Lead {
  return {
    id: "lead-1",
    name: "Old Name",
    address: "1 Main",
    city: "Buffalo",
    state: "NY",
    zip: "14201",
    phone: "555",
    notes: kept,
    status: "claimed",
    claimedBy: owned ? "rep-b" : "rep-other",
    territoryId: "territory-1",
  } as unknown as Lead;
}

async function saveThroughEnqueue(input: {
  actor: User;
  owned: boolean;
  patch: Partial<Lead>;
  denyContact?: boolean;
}) {
  const current = lead(input.owned);
  const queued: PendingMutation[] = [];
  await enqueueDirectSave({
    lead: current,
    patch: directPatch(input.patch),
    actor: input.actor,
    createdAt: at,
    ids: { contact: "contact-1", notes: "notes-1" },
    enqueue: async (draft) => {
      queued.push({ ...draft, syncState: "queued", attempts: 0 });
    },
  });
  let rows = queued.map((row) => ({ ...row }));
  const updates: Record<string, unknown>[] = [];
  const routes: Record<string, unknown>[] = [];
  let record: Record<string, unknown> = { ...current };
  const io = {
    db: {},
    auth: { currentUser: { uid: input.actor.id } },
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
  await syncOutbox({
    read: async () => rows,
    send: async (row) => deliverFieldDispo(row, input.actor, {
      getToken: async () => "token",
      commit: async (mutation, user) => {
        const contactWrite = mutation.kind === "contact"
          || Object.keys(mutation.direct?.patch || {}).some((key) => key !== "notes");
        if (input.denyContact && contactWrite) {
          throw Object.assign(Error("Missing or insufficient permissions."), { code: "permission-denied" });
        }
        return commitDirectMutation(mutation, user, io);
      },
      post: async (_path, init) => {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        routes.push(body);
        if (body.kind === "notes" && typeof body.notes === "string") record = { ...record, notes: body.notes };
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
    }),
    remove: async (id) => {
      rows = rows.filter((row) => row.id !== id);
    },
    update: async (row) => {
      rows = rows.map((item) => (item.id === row.id ? row : item));
    },
    insert: async (row) => {
      rows = [...rows, { ...row, syncState: row.syncState || "queued", attempts: 0 }];
    },
    report: async () => {},
    active: () => true,
    now: () => Date.parse(at),
    random: () => 0,
  });
  return { queued, updates, routes, remaining: rows, notes: String(record.notes || "") };
}

test("useFieldData save entry points queue contact and notes separately", () => {
  const hook = readFileSync(path.join(root, "app/field/useFieldData.ts"), "utf8");
  const save = hook.slice(hook.indexOf("const enqueueDirect"), hook.indexOf("const parkDeniedContact"));
  assert.match(save, /enqueueDirectSave\(/);
  assert.match(hook, /Offline, and this role may write contact fields: the draft stays durably/);
  assert.match(hook, /Send Info does not post/);
  const modal = readFileSync(path.join(root, "app/components/LeadEditorModal.tsx"), "utf8");
  assert.match(modal, /finishSendInfo/);
  assert.match(modal, /setSendNotice\(result\.notice\)/);
  assert.match(modal, /CONTACT_NOT_SENT_MESSAGE/);
  assert.match(readFileSync(path.join(root, "app/components/LeadDetail.tsx"), "utf8"), /prepareSendInfo\(lead\.id\)/);
  assert.match(hook, /contactDraftBlocksSendInfo\(drafts, leadId\)/);
  assert.match(hook, /if \(!DIRECT_MOBILE_WRITES\)/);
  assert.match(modal, /sendInfoMayWriteContact\(DIRECT_MOBILE_WRITES/);
});

test("contact-only queues and writes only the changed fields", async () => {
  const saved = await saveThroughEnqueue({ actor: owner, owned: true, patch: { phone: "556", notes: kept } });
  assert.equal(saved.queued.length, 1);
  assert.equal(saved.queued[0].kind, "contact");
  assert.equal("notes" in saved.queued[0], false);
  assert.equal(saved.queued[0].baseNotes, undefined);
  assert.deepEqual(saved.queued[0].direct?.patch, { phone: "556" });
  assert.equal(Object.prototype.hasOwnProperty.call(saved.queued[0].direct?.patch || {}, "notes"), false);
  assert.deepEqual(saved.updates, [{ phone: "556" }]);
  assert.deepEqual(saved.routes, []);
  assert.equal(saved.notes, kept);
  assert.deepEqual(saved.remaining, []);
});

test("notes plus contact persists both fields", async () => {
  const saved = await saveThroughEnqueue({
    actor: owner,
    owned: true,
    patch: { phone: "556", notes: "a new note" },
  });
  assert.deepEqual(saved.queued.map((row) => ({
    kind: row.kind,
    patch: row.direct?.patch,
    notes: row.notes,
  })), [
    { kind: "contact", patch: { phone: "556" }, notes: undefined },
    { kind: "notes", patch: { notes: "a new note" }, notes: "a new note" },
  ]);
  assert.deepEqual(saved.updates, [{ phone: "556" }]);
  assert.equal(saved.routes.length, 1);
  assert.equal(saved.routes[0].kind, "notes");
  assert.equal(saved.routes[0].notes, "a new note");
  assert.equal(saved.routes[0].draftId, "notes-1");
  assert.equal(saved.notes, "a new note");
  assert.deepEqual(saved.remaining, []);
});

test("notes-only writes the note", async () => {
  const saved = await saveThroughEnqueue({ actor: owner, owned: true, patch: { notes: "only the note" } });
  assert.equal(saved.queued.length, 1);
  assert.equal(saved.queued[0].kind, "notes");
  assert.deepEqual(saved.queued[0].direct?.patch, { notes: "only the note" });
  assert.deepEqual(saved.updates, []);
  assert.equal(saved.routes.length, 1);
  assert.equal(saved.routes[0].kind, "notes");
  assert.equal(saved.routes[0].notes, "only the note");
  assert.equal(saved.routes[0].draftId, "notes-1");
  assert.equal(saved.notes, "only the note");
});

test("a permission-denied contact write is held and never sent to the route", async () => {
  for (const actor of [setter, manager]) {
    const saved = await saveThroughEnqueue({
      actor,
      owned: false,
      patch: { phone: "556", email: "c@d.e" },
      denyContact: true,
    });
    assert.equal(saved.queued.length, 1, actor.role);
    assert.equal(saved.queued[0].kind, "contact");
    assert.deepEqual(saved.queued[0].direct?.patch, { phone: "556", email: "c@d.e" });
    assert.equal(Object.prototype.hasOwnProperty.call(saved.queued[0].direct?.patch || {}, "notes"), false);
    assert.deepEqual(saved.updates, [], actor.role);
    assert.deepEqual(saved.routes, [], actor.role);
    assert.equal(saved.remaining.length, 1);
    assert.equal(saved.remaining[0].kind, "contact");
    assert.equal(saved.remaining[0].parkedReason, "contact_denied");
    assert.equal(saved.remaining[0].notes, undefined);
    assert.equal(saved.notes, kept);
    assert.equal(repMayWriteContactFields(lead(false), actor.id, actor.role), false);
  }
  const owned = lead(true);
  assert.equal(repMayWriteContactFields(owned, owner.id, "setter"), true);
  assert.equal(repMayWriteContactFields(lead(false), "admin", "admin"), true);
  const parked = parkContactDeniedDrafts([{
    id: "contact-1",
    userId: setter.id,
    userName: setter.name,
    leadId: "lead-1",
    createdAt: at,
    kind: "contact",
    baseStatus: "claimed",
    syncState: "queued",
    direct: { patch: { phone: "556" } },
  }], "lead-1");
  assert.equal(parked.length, 1);
  assert.equal(parked[0].kind, "contact");
  assert.equal(parked[0].parkedReason, "contact_denied");
  assert.equal(parked[0].syncState, "parked");
  assert.deepEqual(parked[0].direct?.patch, { phone: "556" });
});

test("the disposition body builder throws when a notes draft has no notes string", () => {
  const draft = {
    id: "notes-1",
    userId: owner.id,
    userName: owner.name,
    leadId: "lead-1",
    createdAt: at,
    kind: "notes" as const,
    baseStatus: "claimed",
    direct: { patch: { phone: "556" } },
  };
  assert.throws(() => fieldDispoBody(draft, owner), /does not include a note/);
  assert.throws(() => fieldDispoBody({ ...draft, notes: undefined, direct: { patch: {} } }, owner), /does not include a note/);
});

test("Send Info still posts when the contact save is denied", async () => {
  let posts = 0;
  const roleBlocked = await finishSendInfo({
    online: true,
    canWriteContact: false,
    confirm: async () => {
      throw Object.assign(Error(CONTACT_NOT_SENT_MESSAGE), { code: "contact_denied" });
    },
    post: async () => { posts += 1; },
  });
  assert.equal(posts, 1);
  assert.equal(roleBlocked.posted, 1);
  assert.equal(roleBlocked.notice, CONTACT_NOT_ON_PIN_NOTICE);
  const writeDenied = await finishSendInfo({
    online: true,
    canWriteContact: true,
    confirm: async () => {
      throw Object.assign(Error("Missing or insufficient permissions."), { code: "permission-denied" });
    },
    post: async () => { posts += 1; },
  });
  assert.equal(posts, 2);
  assert.equal(writeDenied.posted, 1);
  assert.equal(writeDenied.notice, CONTACT_NOT_ON_PIN_NOTICE);
});

test("Send Info posts once when the contact save is allowed online", async () => {
  let posts = 0;
  const sent = await finishSendInfo({
    online: true,
    canWriteContact: true,
    confirm: async () => {},
    post: async () => { posts += 1; },
  });
  assert.equal(posts, 1);
  assert.equal(sent.posted, 1);
  assert.equal(sent.notice, null);
});

test("Send Info stays unposted offline when an allowed contact write is queued", async () => {
  let posts = 0;
  const decision = sendInfoPostDecision({ online: false, canWriteContact: true, contactDenied: false });
  assert.equal(decision.post, false);
  assert.equal(decision.notice, undefined);
  await assert.rejects(() => finishSendInfo({
    online: false,
    canWriteContact: true,
    confirm: async () => { throw Error("Connect before sending the scheduling request."); },
    post: async () => { posts += 1; },
  }), /Connect before sending the scheduling request/);
  assert.equal(posts, 0);
  await assert.rejects(() => finishSendInfo({
    online: true,
    canWriteContact: true,
    confirm: async () => {},
    post: async () => {
      posts += 1;
      throw Error("ambiguous");
    },
  }), /ambiguous/);
  assert.equal(posts, 1);
});

test("Send Info does not post when any contact draft is parked or unsent", async () => {
  const contact = {
    id: "contact-1",
    userId: owner.id,
    userName: owner.name,
    leadId: "lead-1",
    createdAt: at,
    kind: "contact" as const,
    baseStatus: "claimed",
    syncState: "parked" as const,
    parkedReason: "not_found" as const,
    direct: { patch: { phone: "556" } },
  };
  assert.equal(contactDraftBlocksSendInfo([contact], "lead-1"), true);
  assert.equal(contactDraftBlocksSendInfo([{ ...contact, syncState: "queued", parkedReason: undefined }], "lead-1"), true);
  assert.equal(contactDraftBlocksSendInfo([{ ...contact, kind: "notes", notes: "kept" }], "lead-1"), false);
  let posts = 0;
  const blocked = await finishSendInfo({
    online: true,
    canWriteContact: true,
    contactPending: true,
    confirm: async () => {},
    post: async () => { posts += 1; },
  });
  assert.equal(posts, 0);
  assert.equal(blocked.posted, 0);
  assert.equal(blocked.notice, CONTACT_NOT_SENT_MESSAGE);
});

test("the contact write gate applies only to native builds", () => {
  const unowned = lead(false);
  assert.equal(sendInfoMayWriteContact(false, unowned, setter.id, "manager"), true);
  assert.equal(sendInfoMayWriteContact(false, unowned, setter.id, "setter"), true);
  assert.equal(sendInfoMayWriteContact(true, unowned, setter.id, "manager"), false);
  assert.equal(sendInfoMayWriteContact(true, unowned, setter.id, "setter"), false);
  assert.equal(sendInfoMayWriteContact(true, unowned, "admin", "admin"), true);
  assert.equal(sendInfoMayWriteContact(true, null, setter.id, "setter"), true);
});
