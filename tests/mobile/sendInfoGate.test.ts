import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { editorSavePatch, type ContactForm } from "../../app/components/contactPatch";
import { enqueueDirectSave } from "../../app/field/enqueueDirectSave";
import { collapseLegacyNotesQueue } from "../../app/field/draftQueue";
import { migrateDraft, reopenDeniedParked, resetParkedReopenForTests } from "../../app/field/draftMigration";
import { releaseFieldDispoHolds } from "../../app/field/serverDispo";
import { syncOutbox } from "../../app/field/syncOutbox";
import {
  CONNECT_BEFORE_SEND_MESSAGE,
  CONTACT_NOT_ON_PIN_NOTICE,
  CONTACT_OWNER_ONLY_MESSAGE,
  CONTACT_STILL_SAVING_MESSAGE,
  assertContactReadyForSend,
  finishSendInfo,
  parkContactDeniedDrafts,
  patchWithoutLockedContact,
  sendInfoMayWriteContact,
  sendInfoPostDecision,
} from "../../app/field/sendInfoGate";
import type { PendingMutation } from "../../app/field/types";
import type { Lead, User } from "../../app/types";
import { buildSchedulingPayload } from "../../app/utils/schedulingNotification";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const at = "2026-10-26T18:00:00.000Z";
const phone = "7165551212";
const sawyer = { id: "sawyer", name: "Sawyer", role: "setter" } as User;
const steven = { id: "steven", name: "Steven", role: "setter" } as User;
const admin = { id: "admin-1", name: "Ada", role: "admin" } as User;

function manualPin(setterId: string): Lead {
  return {
    id: "pin-steven",
    name: "Pat Home",
    address: "9 Oak",
    city: "Buffalo",
    state: "NY",
    zip: "14201",
    phone: "",
    email: "",
    notes: "",
    status: "appointment",
    source: "manually-added",
    setterId,
  } as Lead;
}

function form(lead: Lead, nextPhone: string, email = ""): ContactForm {
  return {
    name: lead.name,
    address: lead.address,
    city: lead.city,
    state: lead.state,
    zip: lead.zip,
    phone: nextPhone,
    email,
    estimatedBill: "",
    notes: lead.notes || "",
  };
}

function contactOnly(id: string, nextPhone: string, extra: Partial<PendingMutation> = {}): PendingMutation {
  return {
    id,
    userId: sawyer.id,
    userName: sawyer.name,
    leadId: "pin-steven",
    createdAt: at,
    kind: "contact",
    baseStatus: "appointment",
    syncState: "queued",
    direct: { patch: { phone: nextPhone } },
    ...extra,
  };
}

function assertContactKept(row: PendingMutation | undefined, nextPhone: string) {
  assert.ok(row, nextPhone);
  assert.equal(row.kind, "contact");
  assert.equal(row.direct?.patch.phone, nextPhone);
  assert.equal(row.notes, undefined);
  assert.equal(row.baseNotes, undefined);
  assert.equal(Object.prototype.hasOwnProperty.call(row.direct?.patch || {}, "notes"), false);
}

test("a non-owner setter posts the form once and does not queue a contact draft", async () => {
  const pin = manualPin(steven.id);
  assert.equal("claimedBy" in pin, false);
  assert.equal("assignedTo" in pin, false);
  assert.equal("territoryId" in pin, false);
  assert.equal(sendInfoMayWriteContact(true, pin, sawyer.id, sawyer.role), false);
  const editor = form(pin, phone, "");
  const gated = patchWithoutLockedContact(false, editorSavePatch(pin, editor, false));
  assert.equal(gated.contactSkipped, true);
  assert.equal(gated.patch, null);
  const queued: PendingMutation[] = [];
  if (gated.patch) {
    await enqueueDirectSave({
      lead: pin,
      patch: gated.patch,
      actor: sawyer,
      createdAt: at,
      ids: { contact: "contact-new", notes: "notes-new" },
      enqueue: async (draft) => { queued.push(draft); },
    });
  }
  assert.equal(queued.length, 0);
  const held = contactOnly("already-parked", "7165550000", {
    syncState: "parked",
    parkedReason: "contact_denied",
  });
  const store = [held];
  const parked = parkContactDeniedDrafts(store, pin.id);
  assert.equal(parked.length, 0);
  assert.equal(store.length, 1);
  assertContactKept(store[0], "7165550000");
  const built = buildSchedulingPayload(editor, pin);
  assert.equal(built.ok, true);
  if (!built.ok) return;
  assert.equal(built.payload.phone, phone);
  assert.equal(built.payload.email, undefined);
  const decision = sendInfoPostDecision({ online: true, canWriteContact: false, contactDenied: false });
  assert.equal(decision.post, true);
  assert.equal(decision.notice, CONTACT_NOT_ON_PIN_NOTICE);
  let posts = 0;
  let postedPhone = "";
  const sent = await finishSendInfo({
    online: true,
    canWriteContact: false,
    confirm: async () => {
      parkContactDeniedDrafts(store, pin.id);
    },
    post: async () => {
      posts += 1;
      postedPhone = built.payload.phone;
    },
  });
  assert.equal(posts, 1);
  assert.equal(sent.posted, 1);
  assert.equal(sent.notice, CONTACT_NOT_ON_PIN_NOTICE);
  assert.equal(postedPhone, phone);
  assert.equal(queued.filter((row) => row.kind === "contact").length, 0);
  assert.equal(store.length, 1);
  let ambiguousPosts = 0;
  await assert.rejects(() => finishSendInfo({
    online: true,
    canWriteContact: false,
    confirm: async () => {},
    post: async () => {
      ambiguousPosts += 1;
      throw Error("ambiguous");
    },
  }), /ambiguous/);
  assert.equal(ambiguousPosts, 1);
  const modal = readFileSync(path.join(root, "app/components/LeadEditorModal.tsx"), "utf8");
  const hook = readFileSync(path.join(root, "app/field/useFieldData.ts"), "utf8");
  assert.match(modal, /patchWithoutLockedContact/);
  assert.match(modal, /alert\(CONTACT_OWNER_ONLY_MESSAGE\)/);
  assert.match(modal, /setSendNotice\(result\.notice\)/);
  assert.match(hook, /await parkDeniedContact\(leadId\)/);
  assert.match(hook, /Never delete them/);
  assert.equal(CONTACT_OWNER_ONLY_MESSAGE, "Only the pin owner or an admin can change contact info. Use Send Info to pass it to the Scheduling Manager.");
});

test("an owner or admin still saves contact info, then posts", async () => {
  for (const actor of [steven, admin]) {
    const pin = manualPin(steven.id);
    assert.equal(sendInfoMayWriteContact(true, pin, actor.id, actor.role), true, actor.role);
    const queued: PendingMutation[] = [];
    const order: string[] = [];
    await enqueueDirectSave({
      lead: pin,
      patch: { phone },
      actor,
      createdAt: at,
      ids: { contact: `contact-${actor.id}`, notes: `notes-${actor.id}` },
      enqueue: async (draft) => {
        order.push("save");
        queued.push(draft);
      },
    });
    assert.equal(queued.length, 1, actor.role);
    assert.equal(queued[0].kind, "contact", actor.role);
    assert.deepEqual(queued[0].direct?.patch, { phone }, actor.role);
    let posts = 0;
    const sent = await finishSendInfo({
      online: true,
      canWriteContact: true,
      confirm: async () => { order.push("confirm"); },
      post: async () => {
        posts += 1;
        order.push("post");
      },
    });
    assert.equal(posts, 1, actor.role);
    assert.equal(sent.posted, 1, actor.role);
    assert.equal(sent.notice, null, actor.role);
    assert.deepEqual(order, ["save", "confirm", "post"], actor.role);
  }
});

test("an allowed writer's queued contact draft blocks Send Info while it is still saving", async () => {
  const drafts = [contactOnly("still-saving", phone, { userId: steven.id, syncState: "queued" })];
  assert.throws(
    () => assertContactReadyForSend(drafts, "pin-steven"),
    (error: Error) => error.message === CONTACT_STILL_SAVING_MESSAGE,
  );
  let posts = 0;
  await assert.rejects(() => finishSendInfo({
    online: true,
    canWriteContact: true,
    confirm: async () => { assertContactReadyForSend(drafts, "pin-steven"); },
    post: async () => { posts += 1; },
  }), (error: Error) => error.message === CONTACT_STILL_SAVING_MESSAGE);
  assert.equal(posts, 0);
  assert.doesNotThrow(() => assertContactReadyForSend([
    contactOnly("parked-ok", phone, { syncState: "parked", parkedReason: "contact_denied" }),
  ], "pin-steven"));
});

test("an offline non-owner does not post", async () => {
  const pin = manualPin(steven.id);
  assert.equal(sendInfoMayWriteContact(true, pin, sawyer.id, "setter"), false);
  const store = [contactOnly("offline-phone", phone)];
  const parked = parkContactDeniedDrafts(store, pin.id);
  assert.equal(parked.length, 1);
  assert.equal(store.length, 1);
  assert.equal(store[0].id, "offline-phone");
  const kept = store.map((row) => parked.find((next) => next.id === row.id) ?? row);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].syncState, "parked");
  assert.equal(kept[0].parkedReason, "contact_denied");
  assertContactKept(kept[0], phone);
  let posts = 0;
  const sent = await finishSendInfo({
    online: false,
    canWriteContact: false,
    confirm: async () => {
      parkContactDeniedDrafts(kept, pin.id);
    },
    post: async () => { posts += 1; },
  });
  assert.equal(posts, 0);
  assert.equal(sent.posted, 0);
  assert.equal(sent.notice, CONNECT_BEFORE_SEND_MESSAGE);
  assert.notEqual(sent.notice, CONTACT_NOT_ON_PIN_NOTICE);
  assert.equal(kept.length, 1);
});

function installMemoryIndexedDb() {
  if (typeof globalThis.indexedDB !== "undefined") return;
  type Store = Map<string, unknown>;
  const databases = new Map<string, { stores: Map<string, Store> }>();
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
  const open = (name: string) => {
    const request = {
      result: undefined as ReturnType<typeof databaseHandle> | undefined,
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
  Object.defineProperty(globalThis, "indexedDB", { value: { open }, configurable: true });
}

async function runSync(rows: PendingMutation[], send: (row: PendingMutation) => Promise<void>) {
  const removed: string[] = [];
  let current = rows.map((row) => ({ ...row }));
  await syncOutbox({
    read: async () => current,
    send,
    remove: async (id) => {
      removed.push(id);
      current = current.filter((row) => row.id !== id);
    },
    update: async (row) => {
      current = current.map((item) => (item.id === row.id ? row : item));
    },
    insert: async (row) => {
      current = [...current, row];
    },
    active: () => true,
    now: () => Date.parse(at),
    random: () => 0,
  });
  return { rows: current, removed };
}

test("a contact-only draft survives sync without being dropped", async () => {
  const queued = contactOnly("sync-queued", phone);
  const parked = contactOnly("sync-parked", "7165550000", {
    syncState: "parked",
    parkedReason: "contact_denied",
  });
  const synced = await runSync([queued, parked], async (row) => {
    if (row.kind === "contact") throw Object.assign(Error("Failed to fetch"), { code: "unavailable" });
  });
  assert.deepEqual(synced.removed, []);
  assert.equal(synced.rows.length, 2);
  assertContactKept(synced.rows.find((row) => row.id === "sync-queued"), phone);
  assertContactKept(synced.rows.find((row) => row.id === "sync-parked"), "7165550000");
  assert.equal(synced.rows.find((row) => row.id === "sync-parked")?.parkedReason, "contact_denied");
  assert.equal(synced.rows.find((row) => row.id === "sync-parked")?.syncState, "parked");
});

test("a contact-only draft survives a conflict without being dropped", async () => {
  const synced = await runSync([contactOnly("sync-conflict", phone)], async () => {
    throw Object.assign(Error("transaction conflict"), { code: "aborted", status: 409 });
  });
  assert.deepEqual(synced.removed, []);
  assert.equal(synced.rows.length, 1);
  assertContactKept(synced.rows[0], phone);
  assert.equal(synced.rows[0].syncState, "retry");
});

test("a contact-only draft survives an app restart without being dropped", async () => {
  installMemoryIndexedDb();
  resetParkedReopenForTests();
  const { putDraft, readDrafts, removeDraft } = await import("../../app/field/deviceStore");
  const queued = contactOnly("restart-queued", phone);
  const parked = contactOnly("restart-parked", "7165550000", {
    syncState: "parked",
    parkedReason: "contact_denied",
  });
  const note: PendingMutation = {
    id: "restart-note",
    userId: sawyer.id,
    userName: sawyer.name,
    leadId: "pin-steven",
    createdAt: at,
    kind: "notes",
    baseStatus: "appointment",
    baseNotes: "",
    notes: "gate code",
    syncState: "queued",
    direct: { patch: { notes: "gate code" } },
  };
  await putDraft(queued);
  await putDraft(parked);
  await putDraft(note);
  let drafts = await readDrafts(sawyer.id);
  const migrated = drafts.map((row) => migrateDraft(row, sawyer));
  const opened = releaseFieldDispoHolds(reopenDeniedParked(migrated, sawyer.id));
  const collapsed = collapseLegacyNotesQueue(opened);
  const kept = new Set(collapsed.map((row) => row.id));
  for (const row of collapsed) {
    const prev = drafts.find((item) => item.id === row.id);
    if (prev !== row) await putDraft(row);
  }
  for (const row of drafts) if (!kept.has(row.id)) await removeDraft(row.id);
  drafts = await readDrafts(sawyer.id);
  assertContactKept(drafts.find((row) => row.id === "restart-queued"), phone);
  const reopened = drafts.find((row) => row.id === "restart-parked");
  assertContactKept(reopened, "7165550000");
  assert.equal(reopened?.syncState, "queued");
  assert.ok(drafts.some((row) => row.id === "restart-note"));
  assert.equal(drafts.filter((row) => row.kind === "contact").length, 2);
});
