// Raydar 14.21 (rep report 10/30): notes must save on every pin, with any disposition or none.
// These tests FAIL at d6b1cb2 (14.20/160) and 15efe05 (live prod) and should pass after the fix.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { knockPatch } from "../../app/field/knockPatch";
import { syncOutbox } from "../../app/field/syncOutbox";
import type { PendingMutation } from "../../app/field/types";
import type { Lead, User } from "../../app/types";
import { decideDirtyNotes, NOTES_SAVED_MESSAGE, NOTES_SAVED_ON_PHONE_MESSAGE, NOTES_SAVED_TOAST_MS, planCloseWithNotes, planUnmountNotesFlush, unmountNotesWriter } from "../../app/field/dirtyNotes";
import { readSyncLog, resetSyncLogForTests } from "../../app/field/syncDiagnostics";
import { dismissMobileOverlay } from "../../app/utils/dismissMobileOverlay";
import { acceptDisposition, resetQueueSeqForTests } from "../../app/field/draftQueue";
import { directPatch, rejectCombinedKnockAndNotes } from "../../app/field/directWrites";
import { enqueueDirectSave } from "../../app/field/enqueueDirectSave";
import { NOTES_BLANK_MESSAGE, NOTES_MAX_CHARS, NOTES_TOO_LONG_MESSAGE } from "../../app/field/notesLimits";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const detail = readFileSync(path.join(root, "app/components/LeadDetail.tsx"), "utf8");

function body(name: string): string {
  const start = detail.indexOf(`const ${name} = async`);
  assert.ok(start >= 0, `${name} not found`);
  const next = detail.indexOf("\n  const ", start + 10);
  return detail.slice(start, next < 0 ? undefined : next);
}

test("baseline: a knock patch never carries textarea notes (knock + notes stay separate drafts)", () => {
  const lead = { id: "l1", status: "unclaimed", notes: "old" } as Lead;
  const user = { id: "rep-a", name: "Rep A", role: "setter" } as User;
  const patch = knockPatch(lead, user, "rep-a", { id: "not-home", name: "Not Home" }, new Date("2026-10-30T19:00:00.000Z"));
  assert.equal("notes" in patch, false);
});

for (const handler of ["handleStatusChange", "handleObjectionSave", "handleGoBackSave"]) {
  test(`${handler}: unsaved typed notes are queued as a notes draft before the native panel closes`, () => {
    const src = body(handler);
    const close = src.indexOf("onClose()");
    assert.ok(close >= 0, `${handler} should close the panel in native`);
    // Fix contract: a dirty-notes save (helper name is the fix's choice) runs before onClose.
    const save = src.search(/saveDirtyNotes|saveReportingPatch\(\{\s*notes/);
    assert.ok(save >= 0 && save < close, `${handler} closes the panel without saving typed notes`);
  });
}

test("native Save Notes shows a confirmation (today only web shows 'Notes saved.')", () => {
  const src = body("handleSaveNotes");
  assert.doesNotMatch(src, /if \(!DIRECT_MOBILE_WRITES\) setFieldMessage\('Notes saved\.'\)/);
});

test("a notes draft on a new home waits for its GPS-held create instead of hitting the route (410 -> parked)", async () => {
  const at = "2026-10-30T19:00:00.000Z";
  const create = { id: "home-1", status: "not-home", notes: "", claimedBy: "rep-a" } as unknown as Lead;
  const knock = {
    id: "k1", kind: "knock", leadId: "home-1", userId: "rep-a", createdAt: at, queueSeq: 1,
    status: "not-home", syncState: "gps",
    direct: { patch: { status: "not-home" }, create, gps: { deadline: Date.now() + 15_000, required: false } },
  } as unknown as PendingMutation;
  const notes = {
    id: "n1", kind: "notes", leadId: "home-1", userId: "rep-a", createdAt: at, queueSeq: 2,
    notes: "gate code 1234", baseNotes: "", syncState: "queued", direct: { patch: { notes: "gate code 1234" } },
  } as unknown as PendingMutation;
  const rows = [knock, notes];
  const sent: string[] = [];
  let loops = 0;
  await syncOutbox({
    read: async () => rows,
    send: async (m) => { sent.push(m.id); throw Object.assign(Error("Lead is missing"), { status: 410 }); },
    remove: async () => undefined,
    update: async (m) => { const i = rows.findIndex((r) => r.id === m.id); if (i >= 0) rows[i] = m; },
    active: () => ++loops < 20,
  });
  assert.deepEqual(sent, [], "notes were sent before the home's create landed");
});

const actor = { id: "rep-a", name: "Rep A", role: "setter" } as User;
const at = new Date("2026-10-30T19:00:00.000Z");

const knockPaths: Array<{ name: string; status: string; label: string; extra?: Partial<Lead> }> = [
  { name: "not-home", status: "not-home", label: "Not Home" },
  { name: "interested", status: "interested", label: "Interested" },
  { name: "appointment", status: "appointment", label: "Appointment Set" },
  { name: "sale", status: "sale", label: "Sale!" },
  { name: "custom plain", status: "custom-door", label: "Custom Door" },
  { name: "not-interested", status: "not-interested", label: "Not Interested", extra: {
    objectionType: "too-expensive", objectionNotes: "too much", objectionRecordedAt: at, objectionRecordedBy: actor.id,
  } },
  { name: "go-back", status: "go-back", label: "Go Back", extra: {
    goBackScheduledDate: at, goBackScheduledTime: "15:00", goBackNotes: "modal note", goBackScheduledBy: actor.id,
  } },
  { name: "house-for-sale", status: "house-for-sale", label: "House for Sale", extra: {
    goBackScheduledDate: at, goBackScheduledTime: "", goBackNotes: "sign in the yard", goBackScheduledBy: actor.id,
  } },
];

function door(notes: string): Lead {
  return { id: "l1", status: "unclaimed", notes, claimedBy: actor.id } as Lead;
}

async function queueKnockAndNotes(input: {
  status: string;
  label: string;
  typed: string;
  saved?: string;
  extra?: Partial<Lead>;
  summaryOnly?: boolean;
}) {
  resetQueueSeqForTests();
  const lead = door(input.saved ?? "");
  const decision = decideDirtyNotes({
    summaryOnly: input.summaryOnly,
    currentNotes: lead.notes || "",
    typedNotes: input.typed,
    leadId: lead.id,
  });
  const patch = directPatch(knockPatch(lead, actor, actor.id, { id: input.status, name: input.label }, at, input.extra));
  rejectCombinedKnockAndNotes(patch);
  let existing: PendingMutation[] = [];
  const knock = acceptDisposition(existing, {
    id: `knock-${input.status}`,
    userId: actor.id,
    userName: actor.name,
    leadId: lead.id,
    createdAt: at.toISOString(),
    kind: "knock",
    baseStatus: lead.status,
    baseNotes: lead.notes || "",
    status: input.status,
    disposition: input.label,
    direct: { patch },
  } as PendingMutation);
  existing = [knock];
  if (decision.kind === "save") {
    await enqueueDirectSave({
      lead,
      patch: { notes: decision.notes },
      actor,
      createdAt: at.toISOString(),
      ids: { contact: `contact-${input.status}`, notes: `notes-${input.status}` },
      enqueue: async (draft) => {
        existing.push(acceptDisposition(existing, draft));
      },
    });
  }
  return { existing, decision, patch };
}

for (const item of knockPaths) {
  test(`${item.name}: dirty notes queue one knock draft then one notes draft for the same actor`, async () => {
    const { existing } = await queueKnockAndNotes({ ...item, typed: "gate code 1234", saved: "old" });
    const knocks = existing.filter((row) => row.kind === "knock");
    const notes = existing.filter((row) => row.kind === "notes");
    assert.equal(knocks.length, 1);
    assert.equal(notes.length, 1);
    assert.equal(knocks[0].userId, actor.id);
    assert.equal(notes[0].userId, actor.id);
    assert.equal(notes[0].userName, actor.name);
    assert.ok((notes[0].createdAt || "") >= (knocks[0].createdAt || ""));
    assert.ok((notes[0].queueSeq || 0) > (knocks[0].queueSeq || 0));
    assert.equal(notes[0].notes, "gate code 1234");
    assert.equal("notes" in (knocks[0].direct?.patch || {}), false);
    assert.equal(knocks[0].direct?.patch?.status, item.status);
  });

  test(`${item.name}: clean notes do not queue a notes draft`, async () => {
    const { existing, decision } = await queueKnockAndNotes({ ...item, typed: "old", saved: "old" });
    assert.equal(decision.kind, "clean");
    assert.equal(existing.filter((row) => row.kind === "knock").length, 1);
    assert.equal(existing.filter((row) => row.kind === "notes").length, 0);
  });

  test(`${item.name}: whitespace or too-long notes keep the knock and queue no notes draft`, async () => {
    for (const typed of ["   ", "x".repeat(NOTES_MAX_CHARS + 1)]) {
      const { existing, decision } = await queueKnockAndNotes({ ...item, typed, saved: "old" });
      assert.equal(decision.kind, "notice");
      assert.ok(decision.kind === "notice" && (decision.message === NOTES_BLANK_MESSAGE || decision.message === NOTES_TOO_LONG_MESSAGE));
      assert.equal(existing.filter((row) => row.kind === "knock").length, 1);
      assert.equal(existing.filter((row) => row.kind === "notes").length, 0);
    }
  });
}

test("unclaim queues dirty textarea notes and does not invent a knock", async () => {
  resetQueueSeqForTests();
  const lead = door("old");
  const decision = decideDirtyNotes({ currentNotes: "old", typedNotes: "gate code 1234", leadId: lead.id });
  assert.equal(decision.kind, "save");
  const drafts: PendingMutation[] = [];
  if (decision.kind === "save") {
    await enqueueDirectSave({
      lead,
      patch: { notes: decision.notes },
      actor,
      createdAt: at.toISOString(),
      ids: { contact: "contact-unclaim", notes: "notes-unclaim" },
      enqueue: async (draft) => { drafts.push(acceptDisposition(drafts, draft)); },
    });
  }
  assert.equal(drafts.filter((row) => row.kind === "knock").length, 0);
  assert.equal(drafts.filter((row) => row.kind === "notes").length, 1);
  assert.equal(drafts[0].userId, actor.id);
  assert.match(body("handleStatusChange"), /saveDirtyNotes\(knockedAt\)/);
});

test("scheduling-manager save queues dirty textarea notes without folding them into a knock", async () => {
  assert.match(detail, /onSave=\{\(\) => \{[\s\S]*?saveDirtyNotes/);
  resetQueueSeqForTests();
  const lead = door("");
  const decision = decideDirtyNotes({ currentNotes: "", typedNotes: "gate code 1234", leadId: lead.id });
  assert.equal(decision.kind, "save");
  const drafts: PendingMutation[] = [];
  await enqueueDirectSave({
    lead,
    patch: { phone: "555-0100" },
    actor,
    createdAt: at.toISOString(),
    ids: { contact: "contact-editor", notes: "notes-editor-unused" },
    enqueue: async (draft) => { drafts.push(acceptDisposition(drafts, draft)); },
  });
  if (decision.kind === "save") {
    await enqueueDirectSave({
      lead,
      patch: { notes: decision.notes },
      actor,
      createdAt: at.toISOString(),
      ids: { contact: "contact-editor-notes", notes: "notes-editor" },
      enqueue: async (draft) => { drafts.push(acceptDisposition(drafts, draft)); },
    });
  }
  assert.equal(drafts.filter((row) => row.kind === "knock").length, 0);
  assert.equal(drafts.filter((row) => row.kind === "contact").length, 1);
  assert.equal(drafts.filter((row) => row.kind === "notes").length, 1);
  assert.equal(drafts.find((row) => row.kind === "notes")?.userId, actor.id);
  assert.equal("notes" in (drafts.find((row) => row.kind === "contact")?.direct?.patch || {}), false);
});

test("Save Notes and the auto-save both confirm, on web and on the phone", () => {
  const saved = body("handleSaveNotes");
  const auto = body("saveDirtyNotes");
  assert.match(saved, /NOTES_SAVED_ON_PHONE_MESSAGE/);
  assert.match(saved, /NOTES_SAVED_MESSAGE/);
  assert.match(auto, /NOTES_SAVED_ON_PHONE_MESSAGE/);
  assert.match(auto, /setFieldMessage\(parked \|\| message/);
  assert.equal(NOTES_SAVED_MESSAGE, "Notes saved.");
  assert.match(NOTES_SAVED_ON_PHONE_MESSAGE, /Notes saved on this phone/);
});

test("disposition handlers capture the actor before awaiting GPS", () => {
  for (const name of ["handleStatusChange", "handleObjectionSave", "handleGoBackSave"]) {
    const src = body(name);
    const captured = src.indexOf("const actor = currentUser");
    const gps = src.indexOf("await homeownerKnockGps");
    assert.ok(captured >= 0 && gps >= 0 && captured < gps, name);
    assert.match(src, /knockPatch\(lead, actor,/);
    assert.match(src, /saveDirtyNotes\(/);
  }
});

function homeRows(notesFirst = false): PendingMutation[] {
  const atIso = "2026-10-30T19:00:00.000Z";
  const create = { id: "home-1", status: "not-home", notes: "", claimedBy: "rep-a" } as unknown as Lead;
  const knock = {
    id: "k1", kind: "knock", leadId: "home-1", userId: "rep-a", userName: "Rep A", createdAt: atIso,
    queueSeq: notesFirst ? 2 : 1,
    status: "not-home", syncState: "gps",
    direct: { patch: { status: "not-home" }, create, gps: { deadline: Date.now() + 15_000, required: false } },
  } as unknown as PendingMutation;
  const notes = {
    id: "n1", kind: "notes", leadId: "home-1", userId: "rep-a", userName: "Rep A", createdAt: atIso,
    queueSeq: notesFirst ? 1 : 2,
    notes: "gate code 1234", baseNotes: "", syncState: "queued",
    direct: { patch: { notes: "gate code 1234" } },
  } as unknown as PendingMutation;
  return [knock, notes];
}

test("a GPS-held create plus notes waits, then sends create then notes, and a replay writes once", async () => {
  let rows = homeRows(true);
  const sent: string[] = [];
  const applied = new Set<string>();
  let writes = 0;
  let hold = true;
  let loops = 0;
  const run = () => syncOutbox({
    read: async () => rows.map((row) => ({ ...row, direct: row.direct ? { ...row.direct } : row.direct })),
    send: async (m) => {
      sent.push(m.id);
      if (hold) throw Object.assign(Error("Lead is missing"), { status: 410 });
      if (applied.has(m.id)) return;
      applied.add(m.id);
      writes += 1;
    },
    remove: async (id) => { rows = rows.filter((row) => row.id !== id); },
    update: async (m) => { rows = rows.map((row) => row.id === m.id ? m : row); },
    active: () => ++loops < 40,
  });
  await run();
  assert.deepEqual(sent, [], "notes were sent before the home's create landed");
  assert.equal(writes, 0);

  hold = false;
  // The knock is enqueued first, so it keeps the earlier queueSeq once GPS clears.
  rows = rows.map((row) => {
    const direct = row.direct ? { ...row.direct } : undefined;
    if (direct?.gps) delete direct.gps;
    return { ...row, syncState: "queued" as const, queueSeq: row.id === "k1" ? 1 : 2, direct };
  });
  sent.length = 0;
  loops = 0;
  await run();
  assert.deepEqual(sent, ["k1", "n1"]);
  assert.equal(writes, 2);
  assert.equal(rows.length, 0);

  rows = homeRows(false).map((row) => {
    if (!row.direct?.gps) return { ...row, syncState: "queued" as const };
    const direct = { ...row.direct };
    delete direct.gps;
    return { ...row, syncState: "queued" as const, direct };
  });
  sent.length = 0;
  loops = 0;
  await run();
  assert.deepEqual(sent, ["k1", "n1"]);
  assert.equal(writes, 2, "replaying the same create and notes drafts does not write again");
});

test("a notes 410 while the home's create is still queued retries instead of parking", async () => {
  resetSyncLogForTests();
  const atIso = "2026-10-30T19:00:00.000Z";
  const create = { id: "home-2", status: "not-home", notes: "", claimedBy: "rep-a" } as unknown as Lead;
  let created = false;
  let rows: PendingMutation[] = [
    {
      id: "n1", kind: "notes", leadId: "home-2", userId: "rep-a", createdAt: atIso, queueSeq: 1,
      notes: "gate code 1234", baseNotes: "", syncState: "queued",
      direct: { patch: { notes: "gate code 1234" } },
    } as unknown as PendingMutation,
    {
      id: "k1", kind: "knock", leadId: "home-2", userId: "rep-a", createdAt: atIso, queueSeq: 2,
      status: "not-home", syncState: "queued",
      direct: { patch: { status: "not-home" }, create },
    } as unknown as PendingMutation,
  ];
  const sent: string[] = [];
  let loops = 0;
  const run = () => syncOutbox({
    read: async () => rows.map((row) => ({ ...row })),
    send: async (m) => {
      if (m.kind === "notes" && !created) throw Object.assign(Error("Lead is missing"), { status: 410 });
      sent.push(m.id);
      if (m.direct?.create) created = true;
    },
    remove: async (id) => { rows = rows.filter((row) => row.id !== id); },
    update: async (m) => { rows = rows.map((row) => row.id === m.id ? m : row); },
    active: () => ++loops < 30,
  });
  await run();
  const note = rows.find((row) => row.id === "n1");
  assert.equal(created, true);
  assert.equal(note?.syncState, "queued");
  assert.equal(note?.parkedReason, undefined);
  assert.deepEqual(sent, ["k1"]);
  const waiting = (await readSyncLog("rep-a")).filter((event) => event.draftId === "n1" && event.state === "retry");
  assert.equal(waiting.length, 1);
  assert.match(waiting[0]?.lastError || "", /missing/i);
  loops = 0;
  await run();
  assert.deepEqual(sent, ["k1", "n1"]);
  assert.equal(rows.length, 0);
});

test("a GPS-held knock on a lead that already exists does not hold that lead's notes", async () => {
  const atIso = "2026-10-30T19:00:00.000Z";
  const rows: PendingMutation[] = [
    {
      id: "k1", kind: "knock", leadId: "lead-existing", userId: "rep-a", createdAt: atIso, queueSeq: 1,
      status: "not-home", syncState: "gps",
      direct: { patch: { status: "not-home" }, gps: { deadline: Date.now() + 15_000, required: false } },
    } as unknown as PendingMutation,
    {
      id: "n1", kind: "notes", leadId: "lead-existing", userId: "rep-a", createdAt: atIso, queueSeq: 2,
      notes: "gate code 1234", baseNotes: "", syncState: "queued",
      direct: { patch: { notes: "gate code 1234" } },
    } as unknown as PendingMutation,
  ];
  const sent: string[] = [];
  let loops = 0;
  await syncOutbox({
    read: async () => rows,
    send: async (m) => { sent.push(m.id); },
    remove: async () => undefined,
    update: async () => undefined,
    active: () => ++loops < 20,
  });
  assert.deepEqual(sent, ["n1"]);
});

const knockingPage = readFileSync(path.join(root, "app/mobile/knocking/page.tsx"), "utf8");

async function draftsForClose(input: { typed: string; saved?: string; summaryOnly?: boolean; flushed?: string | null }) {
  resetQueueSeqForTests();
  const lead = door(input.saved ?? "");
  const plan = planCloseWithNotes({
    summaryOnly: input.summaryOnly,
    currentNotes: lead.notes || "",
    typedNotes: input.typed,
    leadId: lead.id,
    flushedNotes: input.flushed ?? null,
  });
  const drafts: PendingMutation[] = [];
  if (plan.action === "close" && plan.queued) {
    await enqueueDirectSave({
      lead,
      patch: { notes: plan.notes },
      actor,
      createdAt: at.toISOString(),
      ids: { contact: "c-close", notes: "n-close" },
      enqueue: async (draft) => { drafts.push(acceptDisposition(drafts, draft)); },
    });
  }
  return { plan, drafts };
}

test("X close with dirty notes queues one notes draft and closes", async () => {
  assert.equal((detail.match(/data-raydar-back-close onClick=\{closeWithNotes\}/g) || []).length, 2);
  assert.match(body("closeWithNotes"), /planCloseWithNotes\(/);
  assert.match(body("closeWithNotes"), /saveDirtyNotes\(at\)/);
  const { plan, drafts } = await draftsForClose({ typed: "gate code 1234" });
  assert.equal(plan.action, "close");
  assert.equal(plan.queued, true);
  assert.equal(drafts.filter((row) => row.kind === "notes").length, 1);
  assert.equal(drafts[0]?.notes, "gate code 1234");
  assert.equal(drafts[0]?.userId, actor.id);
});

test("Android Back clicks the same close button and queues one notes draft", async () => {
  const overlay = readFileSync(path.join(root, "app/utils/dismissMobileOverlay.ts"), "utf8");
  assert.match(overlay, /\[data-raydar-back-close\]/);
  const queued: string[] = [];
  const button = {
    disabled: false,
    getClientRects: () => [{ width: 1, height: 1 }],
    click: () => {
      const plan = planCloseWithNotes({
        summaryOnly: false,
        currentNotes: "",
        typedNotes: "gate code 1234",
        leadId: "l1",
        flushedNotes: null,
      });
      if (plan.action === "close" && plan.queued) queued.push(plan.notes);
    },
  };
  const rootDoc = {
    querySelectorAll(selector: string) {
      if (selector === "dialog[open]") return [];
      return [button];
    },
  };
  assert.equal(dismissMobileOverlay(rootDoc as unknown as Document), true);
  assert.deepEqual(queued, ["gate code 1234"]);
});

test("a clean close queues no notes draft", async () => {
  const { plan, drafts } = await draftsForClose({ typed: "old", saved: "old" });
  assert.equal(plan.action, "close");
  assert.equal(plan.queued, false);
  assert.equal(drafts.length, 0);
});

test("whitespace or too-long notes keep the panel open and queue no draft", () => {
  for (const typed of ["   ", "x".repeat(NOTES_MAX_CHARS + 1)]) {
    const plan = planCloseWithNotes({
      summaryOnly: false,
      currentNotes: "old",
      typedNotes: typed,
      leadId: "l1",
      flushedNotes: null,
    });
    assert.equal(plan.action, "stay");
    assert.ok(plan.action === "stay" && (plan.notice === NOTES_BLANK_MESSAGE || plan.notice === NOTES_TOO_LONG_MESSAGE));
  }
  assert.match(body("closeWithNotes"), /if \(plan\.action === 'stay'\)/);
  assert.match(body("closeWithNotes"), /setFieldMessage\(plan\.notice\)/);
  assert.doesNotMatch(body("closeWithNotes").slice(0, body("closeWithNotes").indexOf("if (plan.queued)")), /onClose\(/);
});

test("unmount with dirty notes queues one draft, and a close then unmount does not queue a second", async () => {
  const lead = door("");
  const dirty = {
    summaryOnly: false,
    currentNotes: "",
    typedNotes: "gate code 1234",
    leadId: lead.id,
    flushedNotes: null as string | null,
  };
  const first = planUnmountNotesFlush(dirty);
  assert.ok(first);
  const drafts: PendingMutation[] = [];
  await enqueueDirectSave({
    lead,
    patch: { notes: first?.notes || "" },
    actor,
    createdAt: at.toISOString(),
    ids: { contact: "c-unmount", notes: "n-unmount" },
    enqueue: async (draft) => { drafts.push(acceptDisposition([], draft)); },
  });
  assert.equal(drafts.filter((row) => row.kind === "notes").length, 1);
  assert.equal(planUnmountNotesFlush({ ...dirty, flushedNotes: first?.flushedNotes || null }), null);

  const closed = planCloseWithNotes(dirty);
  assert.equal(closed.action, "close");
  assert.equal(closed.queued, true);
  assert.equal(planUnmountNotesFlush({ ...dirty, flushedNotes: closed.flushedNotes }), null);
  const cleanup = detail.slice(detail.indexOf("planUnmountNotesFlush("), detail.indexOf("flushUnsentNotesRef.current(plan.notes, at)"));
  assert.match(detail, /enqueueDirect\(currentLead, \{ notes: text \}, undefined, false, point, at\)/);
  assert.doesNotMatch(cleanup, /await |homeownerKnockGps/);
});

test("a summary pin closes without a notes draft", async () => {
  const { plan, drafts } = await draftsForClose({ typed: "gate code 1234", summaryOnly: true });
  assert.equal(plan.action, "close");
  assert.equal(plan.queued, false);
  assert.equal(drafts.length, 0);
  assert.equal(planUnmountNotesFlush({
    summaryOnly: true,
    currentNotes: "",
    typedNotes: "gate code 1234",
    leadId: "l1",
    flushedNotes: null,
  }), null);
});

test("the map keeps the notes confirmation after the panel closes", () => {
  assert.equal(NOTES_SAVED_TOAST_MS, 4_000);
  assert.match(knockingPage, /const closeLeadDetail = \(message\?: string\) => \{/);
  assert.match(knockingPage, /if \(message\) setNotesSavedNotice\(message\)/);
  assert.match(knockingPage, /setTimeout\(\(\) => setNotesSavedNotice\(''\), NOTES_SAVED_TOAST_MS\)/);
  assert.match(knockingPage, /\{notesSavedNotice \? <MobileNotice>\{notesSavedNotice\}<\/MobileNotice> : null\}/);
  const noticeAt = knockingPage.indexOf("{notesSavedNotice ? <MobileNotice>");
  const panelAt = knockingPage.indexOf("{selectedLead && showLeadDetail && (");
  assert.ok(noticeAt >= 0 && panelAt > noticeAt, "the banner stays mounted after the lead panel unmounts");
  assert.match(detail, /onClose\(NOTES_SAVED_ON_PHONE_MESSAGE\)/);
  assert.equal(NOTES_SAVED_ON_PHONE_MESSAGE, "Notes saved on this phone. They'll sync when you're online.");
});

test("unclaim queues notes and syncs them before unclaimLead, and a denial still unclaims", () => {
  const src = body("handleStatusChange");
  const save = src.indexOf("if (newStatus === 'unclaimed') notesHold = await saveDirtyNotes(knockedAt)");
  const sync = src.indexOf("field?.ensureLeadSynced(lead.id)");
  const unclaim = src.indexOf("await unclaimLead(lead.id)");
  const holdReturn = src.indexOf("if (notesHold) return");
  assert.ok(save >= 0 && save < sync && sync < unclaim && unclaim < holdReturn);
  assert.doesNotMatch(src.slice(save, unclaim), /if \(notesHold\) return/);
});

function unmountFlushSource(): string {
  const start = detail.indexOf("flushUnsentNotesRef.current = (text, at) => {");
  const end = detail.indexOf("useEffect(() => {\n    return () => {", start);
  assert.ok(start >= 0 && end > start, "unmount flush not found");
  return detail.slice(start, end);
}

test("unmountNotesWriter follows saveReportingPatch on native and writes nothing on web", () => {
  assert.equal(unmountNotesWriter({ direct: true, hasSaveLeadPatch: true, hasEnqueue: true }), "saveLeadPatch");
  assert.equal(unmountNotesWriter({ direct: true, hasSaveLeadPatch: true, hasEnqueue: false }), "saveLeadPatch");
  assert.equal(unmountNotesWriter({ direct: true, hasSaveLeadPatch: false, hasEnqueue: true }), "enqueue");
  assert.equal(unmountNotesWriter({ direct: true, hasSaveLeadPatch: false, hasEnqueue: false }), "none");
  for (const hasSaveLeadPatch of [true, false]) {
    for (const hasEnqueue of [true, false]) {
      assert.equal(unmountNotesWriter({ direct: false, hasSaveLeadPatch, hasEnqueue }), "none");
    }
  }
});

test("the unmount cleanup uses unmountNotesWriter, catches the write, and never calls updateLeadAsync", () => {
  const flush = unmountFlushSource();
  assert.match(flush, /unmountNotesWriter\(/);
  assert.match(flush, /\.catch\(\(error\) => reportSilent\(error\)\)/);
  assert.doesNotMatch(flush, /updateLeadAsync/);
  const effect = detail.slice(detail.indexOf("return () => {\n      const typed = notesRef.current"));
  assert.doesNotMatch(effect.slice(0, effect.indexOf("}, []);")), /updateLeadAsync/);
});

test("a native unmount of an unvisited homeowner pin uses saveLeadPatch, not a bare notes enqueue", () => {
  assert.equal(unmountNotesWriter({ direct: true, hasSaveLeadPatch: true, hasEnqueue: true }), "saveLeadPatch");
  const knock = readFileSync(path.join(root, "app/homeowners/KnockDetail.tsx"), "utf8");
  assert.match(knock, /fieldMemory/);
  assert.match(knock, /unvisitedHome=\{!visit\.saved\}/);
  assert.match(knock, /saveLeadPatch=/);
  const flush = unmountFlushSource();
  const patchCall = flush.indexOf("saveLeadPatch({ notes: text })");
  const enqueueCall = flush.indexOf("field.enqueueDirect(currentLead, { notes: text }");
  assert.ok(patchCall >= 0 && enqueueCall > patchCall);
  assert.doesNotMatch(flush.slice(patchCall, enqueueCall), /enqueueDirect\(/);
});
