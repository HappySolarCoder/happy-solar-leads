import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { overlayDrafts } from "../../app/field/deviceStore";
import { commitDirectMutation, type DirectCommitIo } from "../../app/field/directWrites";
import { NOTES_MAX_CHARS, NOTES_TOO_LONG_MESSAGE, saveNotesFromEditor } from "../../app/field/notesLimits";
import { SERVER_DISPO_SLOW_RETRY_MS, deliverFieldDispo, notesDraftUsesRoute, postFieldDispo } from "../../app/field/serverDispo";
import { syncOutbox } from "../../app/field/syncOutbox";
import type { PendingMutation } from "../../app/field/types";
import type { Lead, User } from "../../app/types";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const manager = { id: "manager-1", name: "Manager", role: "manager" } as User;
const territoryOwner = { id: "territory-owner", name: "Territory Owner", role: "setter" } as User;
const otherRep = { id: "rep-a", name: "Rep A", role: "setter" } as User;
const owner = { id: "rep-b", name: "Owner", role: "setter" } as User;
const claimedByB = { claimedBy: "rep-b", territoryId: "territory-1", status: "claimed" };

function notesDraft(actor: User, text: string, route: boolean): PendingMutation {
  return {
    id: `note-${actor.id}-${text.length}`,
    userId: actor.id,
    userName: actor.name,
    leadId: "lead-1",
    createdAt: "2026-10-26T12:00:00.000Z",
    kind: "notes",
    baseStatus: "claimed",
    notes: text,
    baseNotes: "",
    direct: { patch: { notes: text }, ...(route ? { serverDispo: true } : {}) },
  };
}

test("12k and 20k notes on non-owned leads send by the route", async () => {
  for (const actor of [manager, territoryOwner, otherRep]) {
    for (const size of [12_000, 20_000]) {
      const text = "n".repeat(size);
      assert.equal(notesDraftUsesRoute(claimedByB, actor.id, actor.role, text), true, actor.id);
      let posts = 0;
      let committed = 0;
      const saved = await deliverFieldDispo(notesDraft(actor, text, true), actor, {
        getToken: async () => "token",
        post: async (_path, init) => {
          posts += 1;
          const body = JSON.parse(String(init?.body));
          assert.equal(body.kind, "notes");
          assert.equal(body.notes, text);
          return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
        },
        commit: async () => {
          committed += 1;
          return { replayed: false };
        },
      });
      assert.equal(posts, 1, `${actor.id} ${size}`);
      assert.equal(committed, 0, `${actor.id} ${size}`);
      assert.equal(saved.replayed, false);
    }
  }
  assert.equal(notesDraftUsesRoute(claimedByB, owner.id, owner.role, "n".repeat(20_000)), false);
  assert.equal(notesDraftUsesRoute(claimedByB, "admin-1", "admin", "n".repeat(20_000)), false);
});

test("a route 413, a notes field 400, and a body over 256 KB stay queued as notes_too_long", async () => {
  const now = Date.parse("2026-10-26T12:00:00.000Z");
  const text = "n".repeat(20_000);
  const cases: Array<{ name: string; status: number; body: Record<string, unknown>; notes: string }> = [
    { name: "413", status: 413, body: { error: "payload_too_large" }, notes: text },
    { name: "400 notes", status: 400, body: { error: "invalid_payload", field: "notes" }, notes: text },
    { name: "400 baseNotes", status: 400, body: { error: "invalid_payload", field: "baseNotes" }, notes: text },
  ];
  for (const item of cases) {
    let rows = [notesDraft(otherRep, item.notes, true)];
    let removed = false;
    await syncOutbox({
      read: async () => rows,
      send: async (row) => postFieldDispo(row, otherRep, {
        getToken: async () => "token",
        post: async () => new Response(JSON.stringify(item.body), {
          status: item.status,
          headers: { "content-type": "application/json" },
        }),
      }),
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
      now: () => now,
      random: () => 0,
    });
    assert.equal(removed, false, item.name);
    assert.equal(rows[0].syncState, "queued", item.name);
    assert.equal(rows[0].parkedReason, "notes_too_long", item.name);
    assert.equal(rows[0].notes, item.notes, item.name);
    assert.equal(rows[0].routeHold, "field-dispo", item.name);
    assert.equal(rows[0].nextAttemptAt, now + SERVER_DISPO_SLOW_RETRY_MS, item.name);
    const shown = overlayDrafts([{ id: "lead-1", notes: "", status: "claimed" } as Lead], rows);
    assert.equal(shown[0].notes, item.notes, item.name);
  }

  const heavy = "€".repeat(90_000);
  let posts = 0;
  let heavyRows = [notesDraft(manager, heavy, true)];
  await syncOutbox({
    read: async () => heavyRows,
    send: async (row) => postFieldDispo(row, manager, {
      getToken: async () => "token",
      post: async () => {
        posts += 1;
        return new Response("{}", { status: 200 });
      },
    }),
    remove: async () => {
      throw Error("must not drop");
    },
    update: async (row) => {
      heavyRows = [row];
    },
    report: async () => {
      throw Error("must not park");
    },
    active: () => true,
    now: () => now,
    random: () => 0,
  });
  assert.equal(posts, 0);
  assert.equal(heavy.length < NOTES_MAX_CHARS, true);
  assert.equal(heavyRows[0].syncState, "queued");
  assert.equal(heavyRows[0].parkedReason, "notes_too_long");
  assert.equal(heavyRows[0].notes, heavy);
  assert.match(readFileSync(path.join(root, "app/field/FieldWorkspace.tsx"), "utf8"), /event\.parkedReason/);
});

test("notes over 100000 characters are blocked in the editor and nothing is queued", async () => {
  const queued: string[] = [];
  await assert.rejects(
    () => saveNotesFromEditor("x".repeat(NOTES_MAX_CHARS + 1), async (text) => {
      queued.push(text);
    }),
    (error: Error) => error.message === NOTES_TOO_LONG_MESSAGE,
  );
  assert.equal(queued.length, 0);
  await saveNotesFromEditor("x".repeat(NOTES_MAX_CHARS), async (text) => {
    queued.push(text);
  });
  assert.equal(queued.length, 1);
  assert.equal(queued[0].length, NOTES_MAX_CHARS);
  const editor = readFileSync(path.join(root, "app/components/LeadDetail.tsx"), "utf8");
  assert.match(editor, /NOTES_TOO_LONG_MESSAGE/);
  assert.match(editor, /saveNotesFromEditor/);
  assert.match(editor, /notes\.length > NOTES_MAX_CHARS/);
});

test("an owner direct write of a 20k note still saves", async () => {
  const text = "o".repeat(20_000);
  let record = { notes: "" };
  const updates: unknown[] = [];
  const io = {
    db: {},
    auth: { currentUser: { uid: owner.id } },
    doc: () => ({ path: "leads/lead-1" }),
    runTransaction: async (_database: unknown, fn: (tx: {
      get: (ref: { path: string }) => Promise<{ exists: () => boolean; data: () => { notes: string } }>;
      update: (ref: { path: string }, data: { notes: string }) => void;
    }) => Promise<unknown>) => fn({
      get: async () => ({ exists: () => true, data: () => ({ ...record }) }),
      update: (_ref, data) => {
        updates.push(data);
        record = { ...record, ...data };
      },
    }),
  };
  const saved = await commitDirectMutation(notesDraft(owner, text, false), owner, io as unknown as DirectCommitIo);
  assert.equal(saved.replayed, false);
  assert.equal(saved.lead?.notes, text);
  assert.equal(record.notes, text);
  assert.deepEqual(updates, [{ notes: text }]);
  let posts = 0;
  await deliverFieldDispo(notesDraft(owner, text, false), owner, {
    getToken: async () => "token",
    post: async () => {
      posts += 1;
      return new Response("{}", { status: 500 });
    },
    commit: async (draft) => {
      assert.equal(draft.direct?.patch.notes, text);
      return { replayed: false };
    },
  });
  assert.equal(posts, 0);
});
