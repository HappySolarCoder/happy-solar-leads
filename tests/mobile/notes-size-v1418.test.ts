import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { overlayDrafts } from "../../app/field/deviceStore";
import { commitDirectMutation, type DirectCommitIo } from "../../app/field/directWrites";
import {
  KNOCK_ROUTE_BODY_MAX_BYTES,
  NOTES_MAX_CHARS,
  NOTES_ROUTE_BODY_MAX_BYTES,
  NOTES_TOO_LONG_MESSAGE,
  notesQueuedBody,
  notesRouteBodyBytes,
  saveNotesFromEditor,
  utf8Bytes,
} from "../../app/field/notesLimits";
import { deliverFieldDispo, notesDraftUsesRoute, postFieldDispo } from "../../app/field/serverDispo";
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

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("a route 413, a notes field 400, and a body over 256 KB park as notes_too_long", async () => {
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
    let posts = 0;
    const run = () => syncOutbox({
      read: async () => rows,
      send: async (row) => postFieldDispo(row, otherRep, {
        getToken: async () => "token",
        post: async () => {
          posts += 1;
          return json(item.status, item.body);
        },
      }),
      remove: async () => {
        removed = true;
      },
      update: async (row) => {
        rows = [row];
      },
      report: async () => {},
      active: () => true,
      now: () => now,
      random: () => 0,
    });
    await run();
    assert.equal(removed, false, item.name);
    assert.equal(posts, 1, item.name);
    assert.equal(rows[0].syncState, "parked", item.name);
    assert.equal(rows[0].parkedReason, "notes_too_long", item.name);
    assert.equal(rows[0].notes, item.notes, item.name);
    assert.equal(rows[0].routeHold, undefined, item.name);
    assert.equal(rows[0].nextAttemptAt, undefined, item.name);
    const shown = overlayDrafts([{ id: "lead-1", notes: "", status: "claimed" } as Lead], rows);
    assert.equal(shown[0].notes, item.notes, item.name);
    await run();
    assert.equal(posts, 1, `${item.name} is not retried`);
  }

  const heavy = "中".repeat(90_000);
  let posts = 0;
  let heavyRows = [notesDraft(manager, heavy, true)];
  const runHeavy = () => syncOutbox({
    read: async () => heavyRows,
    send: async (row) => postFieldDispo(row, manager, {
      getToken: async () => "token",
      post: async () => {
        posts += 1;
        return json(200, {});
      },
    }),
    remove: async () => {
      throw Error("must not drop");
    },
    update: async (row) => {
      heavyRows = [row];
    },
    report: async () => {},
    active: () => true,
    now: () => now,
    random: () => 0,
  });
  await runHeavy();
  assert.equal(posts, 0);
  assert.equal(heavy.length < NOTES_MAX_CHARS, true);
  assert.equal(heavyRows[0].syncState, "parked");
  assert.equal(heavyRows[0].parkedReason, "notes_too_long");
  assert.equal(heavyRows[0].notes, heavy);
  const shown = overlayDrafts([{ id: "lead-1", notes: "", status: "claimed" } as Lead], heavyRows);
  assert.equal(shown[0].notes, heavy);
  await runHeavy();
  assert.equal(posts, 0);
  assert.match(readFileSync(path.join(root, "app/field/FieldWorkspace.tsx"), "utf8"), /event\.parkedReason/);
  assert.equal(KNOCK_ROUTE_BODY_MAX_BYTES, 32 * 1024);
  assert.equal(NOTES_ROUTE_BODY_MAX_BYTES, 256 * 1024);
});

test("notes over the char cap or the full route body are blocked at input and nothing is queued", async () => {
  const queued: string[] = [];
  const enqueue = async (text: string) => {
    queued.push(text);
  };
  await assert.rejects(
    () => saveNotesFromEditor("x".repeat(NOTES_MAX_CHARS + 1), enqueue, { leadId: "lead-1", baseNotes: "" }),
    (error: Error) => error.message === NOTES_TOO_LONG_MESSAGE,
  );
  assert.equal(queued.length, 0);
  await saveNotesFromEditor("x".repeat(NOTES_MAX_CHARS), enqueue, { leadId: "lead-1", baseNotes: "" });
  assert.equal(queued.length, 1);
  assert.equal(queued[0].length, NOTES_MAX_CHARS);

  const emoji = "😀".repeat(60_000);
  const emojiBase = "a".repeat(30_000);
  const emojiBody = notesQueuedBody({ leadId: "lead-1", notes: emoji, baseNotes: emojiBase });
  assert.equal(utf8Bytes(emoji) <= NOTES_ROUTE_BODY_MAX_BYTES, true);
  assert.equal(emojiBody.bytes > NOTES_ROUTE_BODY_MAX_BYTES, true);
  assert.equal(emojiBody.tooLong, true);
  await assert.rejects(
    () => saveNotesFromEditor(emoji, enqueue, { leadId: "lead-1", baseNotes: emojiBase }),
    (error: Error) => error.message === NOTES_TOO_LONG_MESSAGE,
  );
  assert.equal(queued.length, 1);

  const cjk = "中".repeat(90_000);
  const cjkBody = notesQueuedBody({ leadId: "lead-1", notes: cjk, baseNotes: "" });
  assert.equal(cjk.length < NOTES_MAX_CHARS, true);
  assert.equal(cjkBody.bytes > NOTES_ROUTE_BODY_MAX_BYTES, true);
  await assert.rejects(
    () => saveNotesFromEditor(cjk, enqueue, { leadId: "lead-1", baseNotes: "" }),
    (error: Error) => error.message === NOTES_TOO_LONG_MESSAGE,
  );

  const apostrophes = "\u2019".repeat(87_382);
  const apostropheBody = notesQueuedBody({ leadId: "lead-1", notes: apostrophes, baseNotes: "" });
  assert.equal(apostrophes.length < NOTES_MAX_CHARS, true);
  assert.equal(utf8Bytes(apostrophes) > NOTES_ROUTE_BODY_MAX_BYTES, true);
  assert.equal(apostropheBody.tooLong, true);
  await assert.rejects(
    () => saveNotesFromEditor(apostrophes, enqueue, { leadId: "lead-1", baseNotes: "" }),
    (error: Error) => error.message === NOTES_TOO_LONG_MESSAGE,
  );
  assert.equal(queued.length, 1);

  const editor = readFileSync(path.join(root, "app/components/LeadDetail.tsx"), "utf8");
  const modal = readFileSync(path.join(root, "app/components/LeadEditorModal.tsx"), "utf8");
  assert.match(editor, /NOTES_TOO_LONG_MESSAGE/);
  assert.match(editor, /saveNotesFromEditor/);
  assert.match(editor, /notesQueuedBody/);
  assert.match(editor, /notesTooLong/);
  assert.match(modal, /NOTES_TOO_LONG_MESSAGE/);
  assert.match(modal, /notesQueuedBody/);
  assert.match(modal, /if \(notesTooLong\) return/);
  assert.match(modal, /disabled=\{isSaving \|\| notesTooLong\}/);
});

test("99k notes plus 99k baseNotes stay under 256 KB and send", async () => {
  const notes = "a".repeat(99_000);
  const baseNotes = "b".repeat(99_000);
  const draft = { ...notesDraft(manager, notes, true), baseNotes };
  const bytes = notesRouteBodyBytes({
    leadId: draft.leadId,
    draftId: draft.id,
    actionAt: draft.createdAt,
    notes,
    baseNotes,
  });
  assert.equal(bytes <= NOTES_ROUTE_BODY_MAX_BYTES, true);
  let posts = 0;
  await deliverFieldDispo(draft, manager, {
    getToken: async () => "token",
    post: async (_path, init) => {
      posts += 1;
      const body = JSON.parse(String(init?.body));
      assert.equal(body.notes, notes);
      assert.equal(body.baseNotes, baseNotes);
      return json(200, { ok: true });
    },
    commit: async () => {
      throw Error("must use the route");
    },
  });
  assert.equal(posts, 1);
});

test("a rebase that grows past 256 KB parks notes_too_long and is not retried", async () => {
  const now = Date.parse("2026-10-26T12:00:00.000Z");
  const local = "n".repeat(1_000);
  const server = "中".repeat(90_000);
  let rows = [notesDraft(otherRep, local, true)];
  let posts = 0;
  const run = () => syncOutbox({
    read: async () => rows,
    send: async (row) => postFieldDispo(row, otherRep, {
      getToken: async () => "token",
      post: async () => {
        posts += 1;
        return json(409, { currentNotes: server });
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
    now: () => now,
    random: () => 0,
  });
  await run();
  assert.equal(posts, 1);
  assert.equal(rows[0].syncState, "parked");
  assert.equal(rows[0].parkedReason, "notes_too_long");
  assert.equal(rows[0].notes?.includes(server), true);
  assert.equal(rows[0].notes?.includes(local), true);
  const shown = overlayDrafts([{ id: "lead-1", notes: "", status: "claimed" } as Lead], rows);
  assert.equal(shown[0].notes, rows[0].notes);
  await run();
  assert.equal(posts, 1);
});

test("a parked oversize note does not block a later knock, and a shrink resolves it", async () => {
  const now = Date.parse("2026-10-26T12:05:00.000Z");
  const huge = "中".repeat(90_000);
  const parked: PendingMutation = {
    ...notesDraft(otherRep, huge, true),
    id: "note-parked",
    syncState: "parked",
    parkedReason: "notes_too_long",
    baseNotes: "",
    createdAt: "2026-10-26T12:00:00.000Z",
  };
  const knock: PendingMutation = {
    id: "knock-1",
    userId: otherRep.id,
    userName: otherRep.name,
    leadId: "lead-1",
    createdAt: "2026-10-26T12:01:00.000Z",
    kind: "knock",
    baseStatus: "claimed",
    baseNotes: "",
    status: "not-home",
    disposition: "Not Home",
    syncState: "queued",
    direct: { patch: { status: "not-home" }, serverDispo: true },
  };
  let rows = [parked, knock];
  const sent: string[] = [];
  const drain = () => syncOutbox({
    read: async () => rows,
    send: async (row) => {
      sent.push(`${row.kind}:${row.id}`);
      if (row.kind === "notes") {
        return postFieldDispo(row, otherRep, {
          getToken: async () => "token",
          post: async (_path, init) => {
            const body = JSON.parse(String(init?.body)) as { notes?: string; baseNotes?: string };
            sent.push(`body:${body.notes?.length}:${body.baseNotes?.length}`);
            return json(200, { ok: true });
          },
        });
      }
      return { replayed: false };
    },
    remove: async (id) => {
      rows = rows.filter((row) => row.id !== id);
    },
    update: async (row) => {
      rows = rows.map((item) => (item.id === row.id ? row : item));
    },
    report: async () => {},
    active: () => true,
    now: () => now,
    random: () => 0,
  });
  await drain();
  assert.deepEqual(sent, ["knock:knock-1"]);
  assert.equal(rows.some((row) => row.id === "note-parked"), true);
  assert.equal(rows.some((row) => row.kind === "knock"), false);

  const shrunk: PendingMutation = {
    ...notesDraft(otherRep, huge.slice(0, 100), true),
    id: "note-shrunk",
    baseNotes: huge,
    createdAt: "2026-10-26T12:02:00.000Z",
    syncState: "queued",
  };
  rows = [...rows, shrunk];
  sent.length = 0;
  await drain();
  assert.deepEqual(sent, ["notes:note-shrunk", "body:100:0"]);
  assert.equal(rows.length, 0);

  const waiting: PendingMutation = {
    ...parked,
    id: "note-waiting",
    syncState: "queued",
    routeHold: "field-dispo",
    nextAttemptAt: now + 60_000,
    createdAt: "2026-10-26T12:00:00.000Z",
  };
  const laterKnock: PendingMutation = { ...knock, id: "knock-2", createdAt: "2026-10-26T12:03:00.000Z" };
  rows = [waiting, laterKnock];
  sent.length = 0;
  await drain();
  assert.deepEqual(sent, ["knock:knock-2"]);
  assert.equal(rows.some((row) => row.id === "note-waiting"), true);
  assert.equal(rows.some((row) => row.kind === "knock"), false);
});

test("a later unrelated note rebases onto the parked text and only one note is sent", async () => {
  const now = Date.parse("2026-10-26T12:05:00.000Z");
  const parked: PendingMutation = {
    ...notesDraft(otherRep, "Keep this sentence.", true),
    id: "note-parked",
    syncState: "parked",
    parkedReason: "notes_too_long",
    baseNotes: "",
    createdAt: "2026-10-26T12:00:00.000Z",
  };
  const later: PendingMutation = {
    ...notesDraft(otherRep, "A different sentence.", true),
    id: "note-later",
    baseNotes: "",
    createdAt: "2026-10-26T12:02:00.000Z",
    syncState: "queued",
  };
  let rows = [parked, later];
  const bodies: string[] = [];
  await syncOutbox({
    read: async () => rows,
    send: async (row) => postFieldDispo(row, otherRep, {
      getToken: async () => "token",
      post: async (_path, init) => {
        const body = JSON.parse(String(init?.body)) as { notes?: string };
        bodies.push(body.notes || "");
        return json(200, { ok: true });
      },
    }),
    remove: async (id) => {
      rows = rows.filter((row) => row.id !== id);
    },
    update: async (row) => {
      rows = rows.map((item) => (item.id === row.id ? row : item));
    },
    report: async () => {},
    active: () => true,
    now: () => now,
    random: () => 0,
  });
  assert.equal(bodies.length, 1);
  assert.equal(bodies[0].includes("Keep this sentence."), true);
  assert.equal(bodies[0].includes("A different sentence."), true);
  assert.equal(rows.length, 0);
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
