import test from "node:test";
import assert from "node:assert/strict";
import { classifySyncFailure } from "../../app/field/draftState";
import { commitDirectMutation, directPatch, firestoreValue, rejectCombinedKnockAndNotes, reportingPatch, type DirectCommitIo } from "../../app/field/directWrites";
import { DISPOSITION_RULES_KEYS, LEGACY_14_17_PATCH_KEYS, deliverFieldDispo, fieldDispoBody, plainFallbackMutation } from "../../app/field/serverDispo";
import { syncOutbox } from "../../app/field/syncOutbox";
import type { PendingMutation } from "../../app/field/types";
import type { Lead, User } from "../../app/types";
import { Timestamp } from "firebase/firestore";

const user = { id: "rep", name: "Rep" } as User;
const owner = { id: "owner-rep", name: "Owner Rep", role: "setter" } as User;
const admin = { id: "admin-rep", name: "Admin Rep", role: "admin" } as User;

function fakeLeadTransaction(leadId: string, notes: string, extra: Record<string, unknown> = {}) {
  const path = `leads/${leadId}`;
  let record: Record<string, unknown> = { notes, ...extra };
  const updates: unknown[] = [];
  const actors: string[] = [];
  let uid = "";
  const io = {
    db: {},
    auth: { get currentUser() { return uid ? { uid } : null; } },
    doc: (_database: unknown, collection: string, id: string) => ({ path: `${collection}/${id}` }),
    runTransaction: async (_database: unknown, fn: (tx: {
      get: (ref: { path: string }) => Promise<{ exists: () => boolean; data: () => Record<string, unknown> }>;
      update: (ref: { path: string }, data: Record<string, unknown>) => void;
    }) => Promise<unknown>) => {
      actors.push(uid);
      return fn({
        get: async (ref) => ({
          exists: () => ref.path === path,
          data: () => ({ ...record }),
        }),
        update: (ref, data) => {
          assert.equal(ref.path, path);
          updates.push(data);
          record = { ...record, ...data };
        },
      });
    },
  };
  return {
    io: io as unknown as DirectCommitIo,
    updates,
    actors,
    notes: () => record.notes,
    setUid: (next: string) => { uid = next; },
  };
}

function notesDraft(actor: User, leadId: string, notes: string, baseNotes: string): PendingMutation {
  return {
    id: `${actor.id}-${leadId}-${notes.length}`,
    userId: actor.id,
    userName: actor.name,
    leadId,
    createdAt: "2026-10-25T15:00:00.000Z",
    kind: "notes",
    baseStatus: "claimed",
    notes,
    baseNotes,
    direct: { patch: { notes } },
  };
}

async function commitNotes(actor: User, store: ReturnType<typeof fakeLeadTransaction>, notes: string, baseNotes: string) {
  store.setUid(actor.id);
  return commitDirectMutation(notesDraft(actor, "lead-1", notes, baseNotes), actor, store.io);
}

test("an uncontested notes edit is stored exactly and a replay writes nothing more", async () => {
  const cases = [
    { name: "delete", server: "Keep this\nDrop this", edit: "Keep this" },
    { name: "clear", server: "Call aftr 5", edit: "" },
    { name: "typo", server: "Call aftr 5", edit: "Call after 5" },
  ];
  for (const item of cases) {
    const store = fakeLeadTransaction("lead-1", item.server, { claimedBy: owner.id });
    const saved = await commitNotes(owner, store, item.edit, item.server);
    assert.equal(saved.replayed, false, item.name);
    assert.equal(saved.lead?.notes, item.edit, item.name);
    assert.equal(store.notes(), item.edit, item.name);
    assert.deepEqual(store.updates, [{ notes: item.edit }], item.name);
    assert.deepEqual(store.actors, [owner.id], item.name);
    const replay = await commitNotes(owner, store, item.edit, item.server);
    assert.equal(replay.replayed, true, item.name);
    assert.equal(replay.lead?.notes, item.edit, item.name);
    assert.equal(store.notes(), item.edit, item.name);
    assert.equal(store.updates.length, 1, item.name);
  }
});

test("two phones keep both notes on an owned lead and an admin lead", async () => {
  assert.notEqual(owner.id, admin.id);
  for (const actor of [owner, admin]) {
    const store = fakeLeadTransaction("lead-1", "seed", {
      claimedBy: actor.role === "admin" ? "owner-rep" : actor.id,
    });
    const phone1 = await commitNotes(actor, store, "seed\nfrom phone 1", "seed");
    assert.equal(phone1.replayed, false, actor.id);
    const phone2 = await commitNotes(actor, store, "seed\nfrom phone 2", "seed");
    assert.equal(phone2.replayed, false, actor.id);
    assert.equal(store.notes(), "seed\nfrom phone 1\nfrom phone 2", actor.id);
    assert.deepEqual(store.actors, [actor.id, actor.id], actor.id);
    const replay = await commitNotes(actor, store, "seed\nfrom phone 2", "seed");
    assert.equal(replay.replayed, true, actor.id);
    assert.equal(store.notes(), "seed\nfrom phone 1\nfrom phone 2", actor.id);
    assert.equal(store.updates.length, 2, actor.id);
  }
});

test("a route notes conflict retries the plain patch with the rebased text", async () => {
  let posts = 0;
  let committed: PendingMutation | undefined;
  await deliverFieldDispo({
    id: "note-1",
    userId: user.id,
    userName: user.name,
    leadId: "lead-1",
    createdAt: "2026-10-25T15:00:00.000Z",
    kind: "notes",
    baseStatus: "claimed",
    notes: "local only",
    baseNotes: "",
    direct: { patch: { notes: "local only" }, serverDispo: true },
  }, user, {
    getToken: async () => "token",
    post: async () => {
      posts += 1;
      return new Response(JSON.stringify({ currentNotes: "phone two" }), {
        status: 409,
        headers: { "content-type": "application/json" },
      });
    },
    commit: async (draft) => {
      committed = draft;
      return { replayed: false };
    },
  });
  assert.equal(posts, 2);
  assert.equal(committed?.notes, "phone two\nlocal only");
  assert.equal(committed?.direct?.patch.notes, "phone two\nlocal only");
});

test("a notes transaction that cannot finish stays queued", async () => {
  const codes = ["unavailable", "deadline-exceeded", "aborted", "failed-precondition", "network-request-failed", "offline"];
  for (const code of codes) {
    const outcome = classifySyncFailure(Object.assign(Error("transaction failed"), { code }));
    assert.equal(outcome.kind, "transient", code);
    assert.equal(outcome.parkedReason, undefined, code);
    let rows: PendingMutation[] = [{
      id: `draft-${code}`,
      userId: "rep",
      leadId: "lead-1",
      createdAt: "2026-10-25T15:00:00.000Z",
      kind: "notes",
      baseStatus: "claimed",
      baseNotes: "seed",
      notes: "seed\nfrom phone 1",
      syncState: "queued",
      attempts: 0,
      direct: { patch: { notes: "seed\nfrom phone 1" } },
    }];
    let removed = false;
    await syncOutbox({
      read: async () => rows,
      send: async () => {
        throw Object.assign(Error("transaction failed"), { code });
      },
      remove: async () => {
        removed = true;
      },
      update: async (row) => {
        rows = [row];
      },
      report: async () => {
        throw Error("must not park");
      },
      active: () => true,
      now: () => Date.parse("2026-10-25T15:00:00.000Z"),
      random: () => 0,
    });
    assert.equal(removed, false, code);
    assert.equal(rows[0].syncState, "retry", code);
    assert.equal(rows[0].parkedReason, undefined, code);
    assert.equal(rows[0].notes, "seed\nfrom phone 1", code);
  }
  for (const message of ["Failed to fetch", "The client is offline"]) {
    const outcome = classifySyncFailure(Error(message));
    assert.equal(outcome.kind, "transient", message);
    assert.equal(outcome.parkedReason, undefined, message);
  }
});

test("the route body sends goBack or objection, never both", () => {
  const at = "2026-10-25T15:00:00.000Z";
  const base = {
    id: "draft-1",
    userId: user.id,
    userName: user.name,
    leadId: "lead-1",
    createdAt: at,
    kind: "knock" as const,
    baseStatus: "claimed",
    direct: { patch: {} as Partial<Lead> },
  };
  const goBack = fieldDispoBody({
    ...base,
    status: "go-back",
    disposition: "Go Back",
    direct: {
      patch: {
        status: "go-back",
        objectionType: "cost" as Lead["objectionType"],
        objectionNotes: "no",
        goBackScheduledDate: new Date("2026-10-26T15:00:00.000Z"),
        goBackScheduledTime: "10:00",
        goBackNotes: "return",
      },
    },
  }, user);
  assert.equal(goBack.objection, undefined);
  assert.equal(goBack.goBack?.notes, "return");
  const objection = fieldDispoBody({
    ...base,
    status: "not-interested",
    disposition: "Not Interested",
    direct: {
      patch: {
        status: "not-interested",
        objectionType: "cost" as Lead["objectionType"],
        objectionNotes: "price",
        goBackScheduledDate: new Date("2026-10-26T15:00:00.000Z"),
        goBackScheduledTime: "10:00",
      },
    },
  }, user);
  assert.equal(objection.goBack, undefined);
  assert.equal(objection.objection?.type, "cost");
});

test("a knock and a note cannot share one patch", () => {
  assert.throws(
    () => directPatch({
      notes: "hello",
      dispositionHistory: [{ disposition: "Not Home", timestamp: new Date(), userId: "rep", userName: "Rep" }],
    }),
    /Save the knock and the note as separate actions\./,
  );
  assert.throws(
    () => rejectCombinedKnockAndNotes({
      notes: "hello",
      dispositionHistory: [{ disposition: "Not Home", timestamp: new Date(), userId: "rep", userName: "Rep" }],
    }),
    /Save the knock and the note as separate actions\./,
  );
  assert.equal(directPatch({ notes: "hello", dispositionHistory: [] }).notes, "hello");
  assert.equal(directPatch({ notes: "hello" }).notes, "hello");
});

test("the plain fallback drops only keys 14.17 did not carry", () => {
  const at = new Date("2026-10-25T15:00:00.000Z");
  const patch = {
    status: "not-home",
    dispositionedAt: at,
    dispositionHistory: [{ disposition: "Not Home", timestamp: at, userId: "rep", userName: "Rep" }],
    knockGpsLat: 43,
    knockGpsLng: -77,
    knockGpsAccuracy: 5,
    knockGpsTimestamp: at,
    gpsVerified: false,
    gpsUnverifiedReason: "too_far" as const,
    gpsDistanceM: 80,
    bogusField: "drop-me",
  } as Partial<Lead>;
  const mutation: PendingMutation = {
    id: "draft-1",
    userId: user.id,
    userName: user.name,
    leadId: "lead-1",
    createdAt: at.toISOString(),
    kind: "knock",
    baseStatus: "claimed",
    status: "not-home",
    disposition: "Not Home",
    direct: { patch },
  };
  const plain = plainFallbackMutation(mutation);
  const keys = Object.keys(plain.direct?.patch || {});
  assert.equal(keys.includes("bogusField"), false);
  assert.equal(keys.includes("gpsVerified"), false);
  assert.equal(keys.includes("gpsUnverifiedReason"), false);
  assert.equal(keys.includes("gpsDistanceM"), false);
  assert.ok(plain.direct?.patch.dispositionedAt instanceof Date);
  assert.ok(plain.direct?.patch.knockGpsTimestamp instanceof Date);
  const written = reportingPatch(plain, user);
  const stored = firestoreValue(written) as { dispositionedAt: Timestamp; knockGpsTimestamp: Timestamp };
  assert.ok(stored.dispositionedAt instanceof Timestamp);
  assert.ok(stored.knockGpsTimestamp instanceof Timestamp);
  const allowed = new Set<string>([...DISPOSITION_RULES_KEYS, ...LEGACY_14_17_PATCH_KEYS]);
  for (const key of Object.keys(written)) assert.equal(allowed.has(key), true, key);
  assert.equal(fieldDispoBody(mutation, user).kind, "knock");
});
