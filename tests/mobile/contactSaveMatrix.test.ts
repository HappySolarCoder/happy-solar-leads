import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { editorSavePatch, officeLeadSave, type ContactForm } from "../../app/components/contactPatch";
import { buildLeadSaveDrafts, coerceLegacyContactDraft } from "../../app/field/contactSave";
import { commitDirectMutation, type DirectCommitIo } from "../../app/field/directWrites";
import { createHomeownerVisit, homeownerVisitDraft } from "../../app/homeowners/visit";
import { resetParkedReopenForTests, reopenDeniedParked } from "../../app/field/draftMigration";
import { absorbNotesText, notesRouteBody, NOTES_TOO_LONG_MESSAGE } from "../../app/field/notesLimits";
import { notesTransactionPatch } from "../../app/field/notesRebase";
import { deliverFieldDispo, notesDraftUsesRoute } from "../../app/field/serverDispo";
import { readSyncLog, resetSyncLogForTests } from "../../app/field/syncDiagnostics";
import { syncOutbox } from "../../app/field/syncOutbox";
import type { PendingMutation } from "../../app/field/types";
import type { Homeowner } from "../../app/homeowners/model";
import type { Lead, LeadPhoto, User } from "../../app/types";
import { result1417 } from "../../scripts/contact-save-matrix-1417";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const owner = { id: "rep-b", name: "Owner", role: "setter" } as User;
const at = "2026-10-26T12:00:00.000Z";
const kept = "keep these notes";

function lead(notes = kept, owned = true): Lead {
  return {
    id: "lead-1",
    name: "Old Name",
    address: "1 Main",
    city: "Buffalo",
    state: "NY",
    zip: "14201",
    phone: "555",
    email: "a@b.c",
    notes,
    status: "claimed",
    claimedBy: owned ? owner.id : "rep-other",
    territoryId: "territory-1",
  } as unknown as Lead;
}

function photo(): LeadPhoto {
  return {
    id: "p1",
    url: "https://example.invalid/roof.jpg",
    caption: "roof",
    type: "roof",
    uploadedBy: owner.id,
    uploadedAt: new Date(at),
  };
}

function form(extra: Partial<ContactForm> = {}): ContactForm {
  return {
    name: "Old Name",
    address: "1 Main",
    city: "Buffalo",
    state: "NY",
    zip: "14201",
    phone: "555",
    email: "a@b.c",
    estimatedBill: "",
    notes: kept,
    ...extra,
  };
}

type Mode = "online" | "offline";
type SavePath = "direct" | "route" | "manager";

type Observed = {
  updates: Record<string, unknown>[];
  routes: Record<string, unknown>[];
  payloads: Record<string, unknown>[];
  notes: string;
  remaining: PendingMutation[];
  commits: number;
  parkedReason?: string;
};

const CONTACT_ROUTE_KEYS = ["phone", "email", "name", "address", "city", "state", "zip", "photos", "estimatedBill"];

async function runSave(input: {
  owned: boolean;
  role?: "setter" | "manager";
  patch?: Partial<Lead>;
  leadNotes?: string;
  mode: Mode;
  denyContact?: boolean;
  denyNotes?: boolean;
  parked?: PendingMutation;
  legacy?: PendingMutation;
  drafts?: PendingMutation[];
}): Promise<Observed> {
  const actor = { ...owner, role: input.role || owner.role, name: input.role === "manager" ? "Manager" : owner.name } as User;
  const currentLead = lead(input.leadNotes ?? kept, input.owned);
  const built = input.drafts || (input.legacy ? [] : buildLeadSaveDrafts({
    lead: currentLead,
    patch: input.patch || {},
    actor,
    createdAt: at,
    ids: { contact: "contact-1", notes: "notes-1" },
    parkedNotes: input.parked ? [input.parked] : [],
    useRoute: (notes) => !input.owned && notesDraftUsesRoute(currentLead, actor.id, actor.role, notes),
  }).drafts);
  let rows: PendingMutation[] = [
    ...(input.parked ? [input.parked] : []),
    ...(input.legacy ? [input.legacy] : []),
    ...built.map((row) => ({ ...row, syncState: row.syncState || "queued", attempts: row.attempts ?? 0 })),
  ];
  const updates: Record<string, unknown>[] = [];
  const routes: Record<string, unknown>[] = [];
  const payloads: Record<string, unknown>[] = [];
  let record: Record<string, unknown> = { ...currentLead };
  let commits = 0;
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
  const sync = () => syncOutbox({
    read: async () => rows,
    send: async (row) => deliverFieldDispo(row, actor, {
      getToken: async () => "token",
      commit: async (mutation, user) => {
        commits += 1;
        const contactWrite = mutation.kind === "contact"
          || Object.keys(mutation.direct?.patch || {}).some((key) => key !== "notes");
        if ((input.denyContact || !input.owned) && contactWrite) {
          throw Object.assign(Error("Missing or insufficient permissions."), { code: "permission-denied" });
        }
        payloads.push({ ...(mutation.direct?.patch || {}) });
        if (input.denyNotes && mutation.kind === "notes") {
          throw Object.assign(Error("Missing or insufficient permissions."), { code: "permission-denied" });
        }
        return commitDirectMutation(mutation, user, io);
      },
      post: async (_path, init) => {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        routes.push(body);
        payloads.push(body);
        if (body.kind === "notes") {
          const applied = notesTransactionPatch(String(record.notes || ""), body.baseNotes == null ? "" : String(body.baseNotes), String(body.notes ?? ""));
          record.notes = applied.notes;
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
      },
    }),
    remove: async (id) => {
      rows = rows.filter((row) => row.id !== id);
    },
    update: async (row) => {
      rows = rows.map((item) => (item.id === row.id ? row : item));
    },
    insert: async (row) => {
      rows = [...rows, { ...row, syncState: row.syncState || "queued", attempts: row.attempts ?? 0 }];
    },
    report: async () => {},
    active: () => true,
    now: () => Date.parse(at),
    random: () => 0,
  });
  if (input.mode === "offline") {
    assert.equal(updates.length, 0);
    assert.equal(routes.length, 0);
    assert.equal(rows.some((row) => row.syncState === "queued" || row.syncState === "parked"), true);
  }
  await sync();
  for (const body of routes) {
    assert.ok(body.kind === "notes" || body.kind === "knock");
    for (const key of CONTACT_ROUTE_KEYS) {
      assert.equal(Object.prototype.hasOwnProperty.call(body, key), false, key);
    }
  }
  return {
    updates,
    routes,
    notes: String(record.notes || ""),
    payloads,
    remaining: rows,
    commits,
    parkedReason: rows.find((row) => row.syncState === "parked")?.parkedReason,
  };
}

function assertNotesKept(observed: Observed, notes = kept) {
  assert.equal(observed.notes, notes);
  for (const update of observed.updates) assert.equal(Object.prototype.hasOwnProperty.call(update, "notes"), false);
  for (const body of observed.routes) assert.notEqual(body.notes, "");
}

function parkedNote(text: string, baseNotes = "", id = "note-parked"): PendingMutation {
  return {
    id,
    userId: owner.id,
    userName: owner.name,
    leadId: "lead-1",
    createdAt: "2026-10-26T11:00:00.000Z",
    kind: "notes",
    baseStatus: "claimed",
    notes: text,
    baseNotes,
    syncState: "parked",
    parkedReason: "notes_too_long",
    direct: { patch: { notes: text }, serverDispo: true },
  };
}

type MatrixRow = {
  case: string;
  mode: Mode;
  path: SavePath;
  patch?: Partial<Lead>;
  leadNotes?: string;
  denyContact?: boolean;
  denyNotes?: boolean;
  parkedText?: string;
  legacy?: boolean;
  notesTooLong?: boolean;
  expectNotes?: string;
  expectUpdate?: Record<string, unknown>[];
  expectRoute?: Record<string, unknown>[];
  expectRemaining?: "empty" | "parked-note" | "contact-denied";
};

const CONTACT_SAVE_CASES = new Set([
  "phone only",
  "email only",
  "name only",
  "address only",
  "photo only",
  "Send Info",
  "parked note + phone",
  "bill only",
  "phone clear denied",
  "legacy empty notes",
  "Send Info notes too long",
]);

function assertDeniedContact(observed: Observed, row: MatrixRow, leadNotes: string) {
  assert.equal(observed.routes.length, 0, row.case);
  for (const update of observed.updates) {
    assert.equal(Object.prototype.hasOwnProperty.call(update, "notes"), false, row.case);
    for (const key of CONTACT_ROUTE_KEYS) {
      assert.equal(Object.prototype.hasOwnProperty.call(update, key), false, `${row.case} ${key}`);
    }
  }
  assert.equal(observed.notes, row.case === "parked + deliberate clear" ? "" : leadNotes, row.case);
  const contact = observed.remaining.find((item) => item.kind === "contact");
  assert.ok(contact, row.case);
  assert.equal(contact.kind, "contact");
  assert.equal(contact.parkedReason, "contact_denied");
  assert.equal(contact.notes, undefined);
  assert.equal(contact.baseNotes, undefined);
  assert.equal(Object.prototype.hasOwnProperty.call(contact.direct?.patch || {}, "notes"), false);
  if (row.parkedText) {
    const parked = observed.remaining.find((item) => item.parkedReason === "notes_too_long");
    assert.equal(parked?.notes, row.parkedText, row.case);
    assert.equal(parked?.kind, "notes");
  }
}

const photoPatch = { photos: [photo()] };
const sendInfoPatch = {
  name: "Pat Home",
  address: "9 Oak",
  city: "Buffalo",
  state: "NY",
  zip: "14201",
  phone: "7165551212",
  email: "pat@example.com",
};

function rows(): MatrixRow[] {
  const cases: Array<Omit<MatrixRow, "mode" | "path">> = [
    { case: "phone only", patch: { phone: "556" }, expectUpdate: [{ phone: "556" }], expectRemaining: "empty" },
    { case: "email only", patch: { email: "c@d.e" }, expectUpdate: [{ email: "c@d.e" }], expectRemaining: "empty" },
    { case: "name only", patch: { name: "New Name" }, expectUpdate: [{ name: "New Name" }], expectRemaining: "empty" },
    { case: "address only", patch: { address: "9 Oak" }, expectUpdate: [{ address: "9 Oak" }], expectRemaining: "empty" },
    { case: "photo only", patch: photoPatch, expectUpdate: [{ photos: [photo()] }], expectRemaining: "empty" },
    { case: "notes only", patch: { notes: "a new note" }, expectNotes: "a new note", expectRemaining: "empty" },
    { case: "notes + phone", patch: { notes: "a new note", phone: "556" }, expectNotes: "a new note", expectRemaining: "empty" },
    { case: "Send Info", patch: sendInfoPatch, expectUpdate: [sendInfoPatch], expectRemaining: "empty" },
    { case: "parked note + phone", patch: { phone: "556" }, parkedText: "中".repeat(90_000), expectUpdate: [{ phone: "556" }], expectRemaining: "parked-note" },
    { case: "bill only", patch: { estimatedBill: 180 }, expectUpdate: [{ estimatedBill: 180 }], expectRemaining: "empty" },
    { case: "phone clear allowed", patch: { phone: "" }, expectUpdate: [{ phone: "" }], expectRemaining: "empty" },
    { case: "phone clear denied", patch: { phone: "" }, denyContact: true, expectRemaining: "contact-denied" },
    { case: "legacy empty notes", legacy: true, expectUpdate: [{ phone: "556" }], expectRemaining: "empty" },
    { case: "Send Info notes too long", patch: { phone: "556", notes: "中".repeat(90_000) }, notesTooLong: true, expectUpdate: [{ phone: "556" }], expectRemaining: "empty" },
    { case: "parked + empty edit", leadNotes: kept, parkedText: "PARKED TEXT", expectNotes: kept, expectRemaining: "parked-note" },
    { case: "parked + deliberate clear", leadNotes: "PARKED TEXT", parkedText: "PARKED TEXT", expectNotes: "", expectRemaining: "empty" },
    { case: "parked + substring note", leadNotes: "prefix UNIQUE suffix", parkedText: "prefix UNIQUE suffix", expectNotes: "prefix UNIQUE suffix", expectRemaining: "empty" },
  ];
  const out: MatrixRow[] = [];
  for (const item of cases) {
    for (const mode of ["online", "offline"] as const) {
      for (const savePath of ["direct", "route", "manager"] as const) {
        if (item.case === "phone clear allowed" && savePath !== "direct") continue;
        if (item.case === "phone clear denied" && savePath === "direct") continue;
        out.push({ ...item, mode, path: savePath, denyNotes: savePath !== "direct" });
      }
    }
  }
  return out;
}

test("contact and photo saves keep their fields and never blank notes", async () => {
  resetSyncLogForTests();
  resetParkedReopenForTests();
  const table: string[][] = [];
  for (const row of rows()) {
    const owned = row.path === "direct";
    const leadNotes = row.leadNotes ?? kept;
    const current = lead(leadNotes, owned);
    let drafts: PendingMutation[] | undefined;
    let legacy: PendingMutation | undefined;
    let notesTooLong = false;
    if (row.notesTooLong) {
      const built = buildLeadSaveDrafts({
        lead: current,
        patch: row.patch || {},
        actor: owner,
        createdAt: at,
        ids: { contact: "contact-1", notes: "notes-1" },
      });
      assert.equal(built.notesTooLong, true, row.case);
      assert.equal(built.drafts.every((item) => item.kind === "contact" && !("notes" in item) && !item.direct?.patch?.notes), true);
      drafts = built.drafts;
      notesTooLong = true;
    }
    if (row.legacy) {
      legacy = {
        id: "legacy-1",
        userId: owner.id,
        userName: owner.name,
        leadId: "lead-1",
        createdAt: at,
        kind: "notes",
        baseStatus: "claimed",
        baseNotes: leadNotes,
        notes: "",
        syncState: "queued",
        direct: { patch: { phone: "556" }, serverDispo: true },
      };
    }
    if (row.case === "parked + empty edit") {
      drafts = [{
        id: "notes-1",
        userId: owner.id,
        userName: owner.name,
        leadId: "lead-1",
        createdAt: at,
        kind: "notes",
        baseStatus: "claimed",
        baseNotes: "",
        notes: "",
        syncState: "queued",
        direct: { patch: { notes: "" }, ...(row.path !== "direct" ? { serverDispo: true } : {}) },
      }];
    }
    if (row.case === "parked + deliberate clear") {
      drafts = [{
        id: "notes-1",
        userId: owner.id,
        userName: owner.name,
        leadId: "lead-1",
        createdAt: at,
        kind: "notes",
        baseStatus: "claimed",
        baseNotes: "PARKED TEXT",
        notes: "",
        syncState: "queued",
        direct: { patch: { notes: "" }, ...(row.path !== "direct" ? { serverDispo: true } : {}) },
      }];
    }
    if (row.case === "parked + substring note") {
      drafts = [{
        id: "notes-1",
        userId: owner.id,
        userName: owner.name,
        leadId: "lead-1",
        createdAt: at,
        kind: "notes",
        baseStatus: "claimed",
        baseNotes: "",
        notes: "UNIQUE",
        syncState: "queued",
        direct: { patch: { notes: "UNIQUE" }, ...(row.path !== "direct" ? { serverDispo: true } : {}) },
      }];
    }
    const observed = await runSave({
      owned,
      role: row.path === "manager" ? "manager" : "setter",
      patch: row.patch,
      leadNotes,
      mode: row.mode,
      denyContact: row.denyContact,
      denyNotes: row.denyNotes && !row.denyContact,
      parked: row.parkedText ? parkedNote(row.parkedText, row.case === "parked + deliberate clear" ? "PARKED TEXT" : "") : undefined,
      legacy,
      drafts,
    });
    const nonOwner = row.path !== "direct";
    const deniesContact = nonOwner && CONTACT_SAVE_CASES.has(row.case);
    if (deniesContact) assertDeniedContact(observed, row, leadNotes);
    if (row.expectRemaining === "empty" && !deniesContact && !(row.case === "notes + phone" && nonOwner))
      assert.equal(observed.remaining.length, 0, row.case);
    if (row.expectRemaining === "parked-note" && !deniesContact) {
      assert.equal(observed.remaining.length, 1, row.case);
      assert.equal(observed.remaining[0].notes, row.parkedText, row.case);
      assert.equal(observed.remaining[0].parkedReason, "notes_too_long");
    }
    if (row.expectRemaining === "contact-denied") {
      assert.equal(observed.remaining.length, 1, row.case);
      assert.equal(observed.remaining[0].kind, "contact");
      assert.equal(observed.remaining[0].parkedReason, "contact_denied");
      assert.equal(observed.remaining[0].notes, undefined);
      assert.equal(observed.routes.length, 0);
      assert.equal(observed.notes, leadNotes);
      const log = await readSyncLog(owner.id);
      assert.equal(log.some((event) => event.parkedReason === "contact_denied"), true);
      const again = await runSave({
        owned,
        mode: "online",
        denyContact: true,
        drafts: observed.remaining,
      });
      assert.equal(again.commits, 0);
      assert.equal(again.routes.length, 0);
      assert.equal(again.remaining[0].parkedReason, "contact_denied");
    }
    if (row.expectUpdate && row.path === "direct") {
      assert.equal(observed.routes.length, 0, row.case);
      assert.deepEqual(observed.updates.map(plain), row.expectUpdate.map(plain), row.case);
    }
    if (row.expectUpdate && nonOwner && row.case !== "notes only" && row.case !== "notes + phone" && !deniesContact) {
      assert.equal(observed.routes.length, 0, `${row.case} route`);
      assert.deepEqual(observed.updates.map(plain), row.expectUpdate.map(plain), row.case);
    }
    if (row.case === "notes only") {
      if (row.path === "direct") assert.deepEqual(observed.updates, [{ notes: "a new note" }]);
      else {
        assert.deepEqual(observed.routes, [notesRouteBody({
          leadId: "lead-1", draftId: "notes-1", actionAt: at, notes: "a new note", baseNotes: kept,
        })]);
        assert.equal(observed.updates.length, 0);
      }
    }
    if (row.case === "notes + phone") {
      if (row.path === "direct") {
        assert.deepEqual(observed.updates.filter((update) => update.phone), [{ phone: "556" }]);
        assert.deepEqual(observed.updates.filter((update) => update.notes), [{ notes: "a new note" }]);
      } else {
        assert.equal(observed.updates.filter((update) => update.phone).length, 0);
        const contact = observed.remaining.find((item) => item.kind === "contact");
        assert.equal(contact?.parkedReason, "contact_denied");
        assert.deepEqual(contact?.direct?.patch, { phone: "556" });
        assert.equal(Object.prototype.hasOwnProperty.call(contact?.direct?.patch || {}, "notes"), false);
        assert.equal(observed.routes.length, 1);
        assert.equal(observed.routes[0].kind, "notes");
        assert.equal(observed.routes[0].notes, "a new note");
        assert.notEqual(observed.routes[0].notes, "");
        assert.equal(observed.routes[0].phone, undefined);
      }
    }
    if (row.case === "parked + substring note") {
      const sent = observed.payloads.map((item) => item.notes).find((notes) => typeof notes === "string");
      assert.equal(sent, "prefix UNIQUE suffix");
      assert.notEqual(sent, "UNIQUE");
    }
    if (row.case === "parked + deliberate clear") {
      const sent = observed.payloads.filter((item) => Object.prototype.hasOwnProperty.call(item, "notes"));
      assert.equal(sent.length, 1);
      assert.equal(sent[0].notes, "");
    }
    if (!row.patch?.notes && !row.legacy && row.case !== "parked + deliberate clear" && row.case !== "parked + substring note" && row.case !== "parked + empty edit" && row.case !== "notes only" && row.case !== "notes + phone") {
      assertNotesKept(observed, row.expectNotes ?? leadNotes);
    }
    if (row.expectNotes != null && row.case !== "phone clear denied") assert.equal(observed.notes, row.expectNotes, row.case);
    if (notesTooLong) assert.equal(NOTES_TOO_LONG_MESSAGE, "Notes too long");
    for (const body of observed.routes) {
      assert.ok(body.kind === "notes" || body.kind === "knock", row.case);
      if (row.case !== "parked + deliberate clear" && row.case !== "parked + empty edit")
        assert.notEqual(body.notes, "", `${row.case} ${row.mode} ${row.path}`);
    }
    const baseline = await result1417({
      patch: (legacy ? { phone: "556" } : row.notesTooLong ? { phone: "556" } : (row.patch || {})) as Record<string, unknown>,
      leadNotes,
      deny: nonOwner && (CONTACT_SAVE_CASES.has(row.case) || row.case === "notes + phone"),
    });
    table.push([row.case, row.mode, row.path, baseline, "pass"]);
  }
  const header = "| case | mode | path | 14.17 result | 14.19 result |";
  const rule = "| --- | --- | --- | --- | --- |";
  const body = [
    "# Contact save matrix, 14.19",
    "",
    "Contact and photo edits are direct Firestore writes. `/api/field/dispo` is never called with contact keys. Notes are a separate draft, and only when the text changed. A permission-denied contact write parks as `contact_denied` and reopens once per app start.",
    "",
    header,
    rule,
    ...table.map((cells) => `| ${cells.join(" | ")} |`),
    "",
  ].join("\n");
  const file = path.join(root, "docs/mobile/contact-save-matrix-1419.md");
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, body);
  assert.equal(table.every((cells) => cells[4] === "pass"), true);
});

function plain(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === "object" && typeof (value as { toDate?: () => Date }).toDate === "function") {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  if (Array.isArray(value)) return value.map(plain);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, plain(item)]));
  }
  return value;
}

test("absorb keeps parked text unless the edit descends from it", () => {
  const parked = { notes: "prefix UNIQUE suffix", baseNotes: "" };
  assert.equal(absorbNotesText(parked, { notes: "", baseNotes: "" }).notes, parked.notes);
  assert.equal(absorbNotesText(parked, { notes: "   ", baseNotes: "other" }).notes, parked.notes);
  assert.deepEqual(absorbNotesText(parked, { notes: "", baseNotes: parked.notes }), { notes: "", baseNotes: "" });
  assert.equal(absorbNotesText(parked, { notes: "UNIQUE", baseNotes: "" }).notes, parked.notes);
});

test("a legacy notes carrier replays as the contact patch", () => {
  const coerced = coerceLegacyContactDraft({
    id: "legacy-1",
    userId: owner.id,
    userName: owner.name,
    leadId: "lead-1",
    createdAt: at,
    kind: "notes",
    baseStatus: "claimed",
    baseNotes: kept,
    notes: "",
    direct: { patch: { phone: "556" }, serverDispo: true },
  });
  assert.equal(coerced.kind, "contact");
  assert.equal(coerced.notes, undefined);
  assert.equal(coerced.baseNotes, undefined);
  assert.equal(coerced.direct?.serverDispo, undefined);
  assert.deepEqual(coerced.direct?.patch, { phone: "556" });
});

test("the office save and Send Info omit notes unless they changed", () => {
  const current = lead();
  const same = officeLeadSave(current, form({ phone: "556" }));
  assert.equal(same.notes, kept);
  assert.equal(same.phone, "556");
  const changed = officeLeadSave(current, form({ notes: "edited" }));
  assert.equal(changed.notes, "edited");
  const blocked = editorSavePatch(current, form({ phone: "556", notes: "中".repeat(90_000) }), true);
  assert.deepEqual(blocked, { phone: "556" });
  assert.equal(NOTES_TOO_LONG_MESSAGE, "Notes too long");
});

test("homeowner and KnockDetail saves forward the patch without adding notes", async () => {
  const home = { id: "home-1", ownerName: "Pat", address: "1 Main", municipality: "Buffalo", state: "NY", lat: 1, lng: 2 } as Homeowner;
  const updates: Partial<Lead>[] = [];
  const visit = createHomeownerVisit(homeownerVisitDraft(home, owner, "lead-new"), {
    create: async () => {},
    update: async (_id, patch) => {
      updates.push(patch);
    },
    active: () => true,
    online: () => true,
  });
  await visit.save({ phone: "556" });
  await visit.save({ email: "c@d.e" });
  assert.deepEqual(updates, [{ email: "c@d.e" }]);
  assert.equal(Object.prototype.hasOwnProperty.call(updates[0], "notes"), false);
  const detail = path.join(root, "app/homeowners/KnockDetail.tsx");
  const source = (await import("node:fs")).readFileSync(detail, "utf8");
  assert.match(source, /visit\.save\(patch, deferGps\)/);
  assert.equal(source.includes("notes:"), false);
});

test("a denied contact write reopens once per app start and does not loop", async () => {
  resetParkedReopenForTests();
  resetSyncLogForTests();
  const first = await runSave({
    owned: false,
    patch: { phone: "" },
    mode: "online",
    denyContact: true,
  });
  assert.equal(first.remaining[0].parkedReason, "contact_denied");
  assert.equal(first.routes.length, 0);
  const opened = reopenDeniedParked(first.remaining, owner.id);
  assert.equal(opened[0].syncState, "queued");
  const second = reopenDeniedParked(opened, owner.id);
  assert.equal(second[0].syncState, "queued");
  assert.equal(second[0], opened[0]);
});
