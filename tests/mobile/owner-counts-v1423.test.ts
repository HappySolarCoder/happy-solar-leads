import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { reopenOwnedByOtherOnResume, resetResumeReopenForTests, RESUME_REOPEN_MS } from "../../app/field/draftMigration";
import { deliverFieldDispo, fieldDispoBody, FIELD_DISPO_PATH, postFieldDispo } from "../../app/field/serverDispo";
import { SYNC_REASON } from "../../app/field/syncReasons";
import { syncOutbox } from "../../app/field/syncOutbox";
import type { PendingMutation } from "../../app/field/types";
import { mergeLeadSnapshots } from "../../app/homeowners/houseIdentity";
import { matchesMapFilters } from "../../app/mobile/_lib/mapFilters";
import { readKnockLedger, rememberCountedKnocks, resetKnockLedgerForTests } from "../../app/mobile/_lib/knockLedger";
import {
  actionEpochMs,
  countedLedgerKey,
  countedToastText,
  EXP_GO_BACK,
  KNOCK_EVENT_CAP,
  ownershipBadge,
  parseMobileKnockEvents,
  pinIsMine,
  resetOwnerCountsForTests,
  rowsForOwnership,
  selectableDispositions,
  shouldWarnTerritory,
  takeCountedToast,
  TERRITORY_WARNING,
} from "../../app/mobile/_lib/ownerCounts";
import { summarizeActivity } from "../../app/mobile/_lib/metrics";
import type { Lead, User } from "../../app/types";
import { DEFAULT_DISPOSITIONS } from "../../app/types/disposition";
import { collectKnockEvents, KNOCK_REPEAT_MS } from "../../app/utils/knockCount";
import { fieldPinArtwork, fieldPinStyle } from "../../app/utils/fieldPin";
import release from "../../app/mobile/_lib/release.json";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const user = { id: "rep", name: "Rep" } as User;
const at = "2026-11-10T18:00:00.000Z";
const atMs = Date.parse(at);

function read(rel: string) {
  return readFileSync(path.join(root, rel), "utf8");
}

function knock(patch: Partial<PendingMutation> = {}): PendingMutation {
  return {
    id: "draft-1",
    userId: "rep",
    userName: "Rep",
    leadId: "lead-1",
    createdAt: at,
    kind: "knock",
    baseStatus: "claimed",
    baseNotes: "",
    status: "not-home",
    disposition: "Not Home",
    syncState: "queued",
    attempts: 0,
    direct: { patch: { status: "not-home" }, serverDispo: true },
    ...patch,
  };
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function countedBody(patch: Record<string, unknown> = {}) {
  return {
    ok: true,
    draftId: "draft-1",
    result: "counted_only",
    duplicate: false,
    eventId: "rep_draft-1",
    actionAt: at,
    owner: { uid: "owner-1", name: "Ada" },
    owners: [{ uid: "owner-1", name: "Ada" }],
    ...patch,
  };
}

function lead(patch: Partial<Lead> = {}): Lead {
  return {
    id: "lead-1",
    name: "Pin",
    address: "1 Test St",
    city: "Town",
    state: "AZ",
    zip: "85001",
    status: "go-back",
    createdAt: new Date(atMs),
    dispositionedAt: new Date(atMs),
    ...patch,
  };
}

function denied() {
  return Object.assign(Error("permission-denied"), { code: "permission-denied", status: 403 });
}

test("flag off: a 403 owned_by_other parks once and the save payload is unchanged", async () => {
  const row = knock({ direct: { patch: { status: "not-home" } } });
  const bodies: unknown[] = [];
  let commits = 0;
  await assert.rejects(() => deliverFieldDispo(row, user, {
    commit: async () => {
      commits += 1;
      throw denied();
    },
    getToken: async () => "token",
    post: async (route, init) => {
      assert.equal(route, FIELD_DISPO_PATH);
      bodies.push(JSON.parse(String(init?.body)));
      return json(403, { ok: false, error: "forbidden", reasonCode: "owned_by_other" });
    },
  }));
  assert.equal(commits, 2);
  assert.equal(bodies.length, 1);
  assert.deepEqual(bodies[0], fieldDispoBody(row, user));

  let rows = [knock()];
  let sends = 0;
  await syncOutbox({
    read: async () => rows,
    send: async () => {
      sends += 1;
      throw Object.assign(Error("owned"), { status: 403, reasonCode: SYNC_REASON.ownedByOther });
    },
    remove: async () => {
      throw Error("must not remove");
    },
    update: async (next) => {
      rows = [next];
    },
    active: () => true,
  });
  assert.equal(sends, 1);
  assert.equal(rows[0].syncState, "parked");
  assert.equal(rows[0].parkedReason, "owned_by_other");
  assert.equal(rows[0].id, "draft-1");
  assert.equal(rows[0].createdAt, at);
});

test("flag off: applied, stale_history_only and duplicate stay on today's 200 path", async () => {
  const applied = await postFieldDispo(knock(), user, {
    getToken: async () => "token",
    post: async () => json(200, { ok: true, result: "applied" }),
  });
  assert.equal(applied.replayed, false);
  assert.equal(applied.countedOnly, undefined);
  assert.equal(applied.lead, undefined);

  const stale = await postFieldDispo(knock(), user, {
    getToken: async () => "token",
    post: async () => json(200, { ok: true, result: "stale_history_only" }),
  });
  assert.equal(stale.replayed, false);
  assert.equal(stale.countedOnly, undefined);

  const duplicate = await postFieldDispo(knock(), user, {
    getToken: async () => "token",
    post: async () => json(200, { ok: true, result: "applied", duplicate: true }),
  });
  assert.equal(duplicate.replayed, true);
  assert.equal(duplicate.countedOnly, undefined);
});

test("flag off: missing ownership fields do not change a counter or a badge", () => {
  const stripped = rowsForOwnership<Lead & Record<string, unknown>>("rep", {
    ownership: "legacy",
    leads: [lead({ ownedByMe: false, owners: [{ uid: "owner-1", name: "Ada" }], expiredGoBack: true, inOtherUsersTerritory: true })],
  });
  assert.equal(stripped[0].ownedByMe, undefined);
  assert.equal(stripped[0].expiredGoBack, undefined);
  assert.equal(ownershipBadge(stripped[0]), null);
  assert.equal(parseMobileKnockEvents(undefined, "rep").length, 0);
  const before = fieldPinStyle(lead());
  assert.notEqual(before.color, EXP_GO_BACK.color);
  assert.equal(shouldWarnTerritory({ active: false, popupExempt: false, row: { inOtherUsersTerritory: true } }), false);
});

test("counted_only clears the draft, skips the plain patch, and leaves lead undefined", async () => {
  let commits = 0;
  const saved = await deliverFieldDispo(knock({ direct: { patch: { status: "not-home" } } }), user, {
    commit: async () => {
      commits += 1;
      throw denied();
    },
    getToken: async () => "token",
    post: async () => json(200, countedBody()),
  });
  assert.equal(commits, 1);
  assert.equal(saved.countedOnly, true);
  assert.equal(saved.lead, undefined);
  assert.equal(saved.owner?.name, "Ada");
  assert.equal("lead" in countedBody(), false);

  let rows = [knock()];
  await syncOutbox({
    read: async () => rows,
    send: async () => saved,
    remove: async () => {
      rows = [];
    },
    update: async () => {
      throw Error("must not park");
    },
    active: () => true,
  });
  assert.equal(rows.length, 0);

  const again = await postFieldDispo(knock(), user, {
    getToken: async () => "token",
    post: async () => json(200, countedBody({ duplicate: true })),
  });
  assert.equal(again.countedOnly, true);
  assert.equal(again.duplicate, true);
  assert.equal(again.replayed, true);
  assert.equal(again.lead, undefined);
});

test("notes and a hot-lead note treat counted_only as unexpected; a 3PL knock is done", async () => {
  const notes = knock({ id: "draft-notes", kind: "notes", notes: "Left a card", status: undefined, disposition: undefined });
  await assert.rejects(
    () => postFieldDispo(notes, user, {
      getToken: async () => "token",
      post: async () => json(200, countedBody()),
    }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === SYNC_REASON.invalidPayload,
  );
  const hotNotes = knock({ id: "draft-hot-notes", kind: "notes", notes: "Left a card", collection: "hotLeads", status: undefined });
  await assert.rejects(
    () => deliverFieldDispo(hotNotes, user, {
      getToken: async () => "token",
      post: async () => json(200, countedBody()),
    }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === SYNC_REASON.invalidPayload,
  );
  const hot = await postFieldDispo(knock({ collection: "hotLeads" }), user, {
    getToken: async () => "token",
    post: async () => json(200, countedBody({ owner: null, owners: [] })),
  });
  assert.equal(hot.countedOnly, true);
  assert.equal(hot.lead, undefined);
  assert.equal(hot.owner, null);
});

test("the ledger key is leadId|userId|dispositionId|epoch ms and both sources count once", async () => {
  resetKnockLedgerForTests();
  resetOwnerCountsForTests();
  const iso = at;
  const ms = actionEpochMs(iso);
  assert.equal(ms, atMs);
  assert.equal(actionEpochMs(atMs), atMs);
  const key = countedLedgerKey("lead-1", "rep", "not-home", atMs);
  assert.equal(key, `lead-1|rep|not-home|${atMs}`);
  assert.equal(key.includes("|"), true);
  await rememberCountedKnocks("rep", [{ leadId: "lead-1", userId: "rep", dispositionId: "not-home", at: ms! }]);
  await rememberCountedKnocks("rep", [{ leadId: "lead-1", userId: "rep", dispositionId: "not-home", at: ms! }]);
  await rememberCountedKnocks("rep", parseMobileKnockEvents([{ leadId: "lead-1", at: ms, dispositionId: "not-home" }], "rep"));
  const ledger = await readKnockLedger("rep", DEFAULT_DISPOSITIONS, atMs + 1000);
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].key, key);
  const once = collectKnockEvents([lead({
    dispositionHistory: [{ disposition: "Not Home", timestamp: new Date(atMs), userId: "rep", userName: "" }],
  })], DEFAULT_DISPOSITIONS, { ledger });
  assert.equal(once.length, 1);

  resetKnockLedgerForTests();
  const start = atMs;
  await rememberCountedKnocks("rep", [
    { leadId: "door", userId: "rep", dispositionId: "not-home", at: start },
    { leadId: "door", userId: "rep", dispositionId: "not-home", at: start + 60_000 },
  ], start + 86_400_000);
  const close = await readKnockLedger("rep", DEFAULT_DISPOSITIONS, start + 86_400_000);
  assert.equal(collectKnockEvents([], DEFAULT_DISPOSITIONS, { ledger: close }).length, 1);
  assert.equal(KNOCK_REPEAT_MS, 120_000);

  resetKnockLedgerForTests();
  await rememberCountedKnocks("rep", [
    { leadId: "door", userId: "rep", dispositionId: "not-home", at: start },
    { leadId: "door", userId: "rep", dispositionId: "not-home", at: start + KNOCK_REPEAT_MS + 1 },
  ], start + 86_400_000);
  const apart = await readKnockLedger("rep", DEFAULT_DISPOSITIONS, start + 86_400_000);
  assert.equal(collectKnockEvents([], DEFAULT_DISPOSITIONS, { ledger: apart }).length, 2);
});

test("knockEvents drops a non-array, the cap, a bad time, a foreign user and excluded dispos", () => {
  assert.deepEqual(parseMobileKnockEvents({ leadId: "lead-1" }, "rep"), []);
  assert.deepEqual(parseMobileKnockEvents([{ leadId: "lead-1", dispositionId: "not-home", at: "nope" }], "rep"), []);
  assert.deepEqual(parseMobileKnockEvents([{ leadId: "lead-1", dispositionId: "not-home", at: atMs, userId: "other" }], "rep"), []);
  assert.deepEqual(parseMobileKnockEvents([
    { leadId: "lead-1", dispositionId: "shade-dq", at: atMs },
    { leadId: "lead-1", dispositionId: "has-solar", at: atMs },
    { leadId: "lead-1", dispositionId: "already-has-solar", at: atMs },
  ], "rep"), []);
  const many = Array.from({ length: KNOCK_EVENT_CAP + 1 }, (_, index) => ({
    leadId: `lead-${index}`,
    dispositionId: "not-home",
    at: atMs + index,
  }));
  assert.equal(parseMobileKnockEvents(many, "rep").length, KNOCK_EVENT_CAP);
  const kept = parseMobileKnockEvents([{ leadId: "lead-1", dispositionId: "not-home", at: atMs }], "rep");
  assert.equal(kept.length, 1);
  const from = new Date(atMs - 1000);
  const until = new Date(atMs + 86_400_000);
  const home = summarizeActivity([], "rep", DEFAULT_DISPOSITIONS, from, until, { ledger: kept.map((row) => ({ ...row, key: countedLedgerKey(row.leadId, row.userId, row.dispositionId, row.at) })) });
  const knocking = summarizeActivity([], "rep", DEFAULT_DISPOSITIONS, from, until, { ledger: kept.map((row) => ({ ...row, key: countedLedgerKey(row.leadId, row.userId, row.dispositionId, row.at) })) });
  const stats = summarizeActivity([], "rep", DEFAULT_DISPOSITIONS, from, until, { ledger: kept.map((row) => ({ ...row, key: countedLedgerKey(row.leadId, row.userId, row.dispositionId, row.at) })) });
  assert.equal(home.knocks, 1);
  assert.equal(knocking.knocks, home.knocks);
  assert.equal(stats.knocks, home.knocks);
  for (const file of ["app/mobile/page.tsx", "app/mobile/knocking/page.tsx", "app/mobile/stats/page.tsx"]) {
    assert.match(read(file), /ledger:\s*knockLedger/);
  }
});

test("the counted toast names the owner, joins extras, and shows once per draft", () => {
  resetOwnerCountsForTests();
  assert.equal(countedToastText({ uid: "owner-1", name: "Ada" }, [{ uid: "owner-1", name: "Ada" }]), "Counted. This pin belongs to Ada");
  assert.equal(
    countedToastText({ uid: "owner-1", name: "Ada" }, [{ uid: "owner-1", name: "Ada" }, { uid: "owner-2", name: "Bea" }]),
    "Counted. This pin belongs to Ada +1",
  );
  assert.equal(countedToastText(null, []), "Counted.");
  assert.equal(countedToastText({ uid: "owner-1", name: null }, []), "Counted. This pin belongs to another rep.");
  assert.equal(countedToastText({ uid: "owner-1", name: "Ada" }, []).includes("owner-1"), false);
  assert.equal(takeCountedToast("draft-1", false), true);
  assert.equal(takeCountedToast("draft-1", false), false);
  assert.equal(takeCountedToast("draft-2", true), false);
  assert.equal(takeCountedToast("draft-2", false), false);
  assert.match(read("app/mobile/_lib/ownerCounts.ts"), /raydar:knock-counted/);
  assert.match(read("app/field/useFieldData.ts"), /KNOCK_COUNTED_EVENT/);
  assert.match(read("app/mobile/knocking/page.tsx"), /KNOCK_COUNTED_EVENT/);
  assert.match(read("app/mobile/knocking/page.tsx"), /4000/);
});

test("ownedByMe false badges the owner, true is mine, and merge keeps the fields", () => {
  assert.equal(ownershipBadge(lead({ ownedByMe: false, owners: [{ uid: "owner-1", name: "Ada" }] })), "Owned by Ada");
  assert.equal(ownershipBadge(lead({ ownedByMe: false, owners: [] })), "Owned by another rep");
  assert.equal(ownershipBadge(lead({ ownedByMe: true, owners: [{ uid: "rep", name: "Rep" }] })), null);
  assert.equal(ownershipBadge(lead()), null);
  assert.equal(pinIsMine(lead({ claimedBy: "other", ownedByMe: true }), "rep"), true);
  assert.equal(pinIsMine(lead({ claimedBy: "rep" }), "rep"), true);
  assert.equal(pinIsMine(lead({ claimedBy: "other", ownedByMe: false }), "rep"), false);
  const older = lead({
    ownedByMe: false,
    owners: [{ uid: "owner-1", name: "Ada" }],
    ownerSource: "territory",
    expiredGoBack: true,
    inOtherUsersTerritory: true,
    dispositionedAt: new Date(atMs - 1000),
  });
  const newer = lead({ dispositionedAt: new Date(atMs) });
  const [merged] = mergeLeadSnapshots([older], [newer]);
  assert.equal(merged.ownedByMe, false);
  assert.equal(merged.owners?.[0]?.name, "Ada");
  assert.equal(merged.expiredGoBack, true);
  assert.equal(merged.inOtherUsersTerritory, true);
  assert.equal(merged.ownerSource, "territory");
  const kept = rowsForOwnership<Lead>("rep", {
    ownership: "territory",
    popupExempt: false,
    leads: [older],
  });
  assert.equal(kept[0].ownedByMe, false);
  assert.equal(kept[0].inOtherUsersTerritory, true);
});

test("Exp. Go-Back is display-only, knockable, and absent from every picker", () => {
  const shown = fieldPinStyle(lead({ status: "go-back", expiredGoBack: true }));
  assert.equal(shown.label, "Exp. Go-Back");
  assert.equal(shown.color, "#a16207");
  assert.equal(shown.exp, true);
  const art = fieldPinArtwork(lead({ status: "go-back", expiredGoBack: true }), undefined, 18);
  assert.match(decodeURIComponent(art.url), /↺|\\u21ba|\u21ba/);
  assert.match(art.label, /Exp\. Go-Back/);
  const plain = fieldPinStyle(lead({ status: "go-back" }));
  assert.equal(plain.label === "Exp. Go-Back", false);
  assert.equal(selectableDispositions([{ id: "not-home", name: "Not Home" }, { id: EXP_GO_BACK.id, name: EXP_GO_BACK.label }]).some((row) => row.id === EXP_GO_BACK.id), false);
  assert.match(read("app/components/LeadDetail.tsx"), /newStatus === 'exp-go-back'/);
  assert.match(read("app/components/AddLeadModal.tsx"), /EXP_GO_BACK\.id/);
  assert.equal(matchesMapFilters(lead({ status: "not-home", expiredGoBack: true }), "all", [EXP_GO_BACK.id], DEFAULT_DISPOSITIONS), true);
  assert.equal(matchesMapFilters(lead({ status: "not-home" }), "all", [EXP_GO_BACK.id], DEFAULT_DISPOSITIONS), false);
  assert.equal(matchesMapFilters(lead({ status: "go-back" }), "all", ["go-back"], DEFAULT_DISPOSITIONS), true);
});

test("the territory warning follows the server flags and keeps the original tap", () => {
  assert.equal(TERRITORY_WARNING, "Warning: You are in another user's territory. Do you wish to place this pin?");
  const row = { inOtherUsersTerritory: true, ownedByMe: false };
  assert.equal(shouldWarnTerritory({ active: true, popupExempt: false, row }), true);
  assert.equal(shouldWarnTerritory({ active: true, popupExempt: true, row }), false);
  assert.equal(shouldWarnTerritory({ active: true, popupExempt: false, row: { inOtherUsersTerritory: true, ownedByMe: true } }), false);
  assert.equal(shouldWarnTerritory({ active: true, popupExempt: false, row: null }), false);
  assert.equal(shouldWarnTerritory({ active: false, popupExempt: false, row }), false);
  const detail = read("app/components/LeadDetail.tsx");
  const tap = detail.indexOf("const knockedAt = new Date()");
  const warn = detail.indexOf("allowTerritory(knockedAt)");
  const save = detail.indexOf("await recordField('knock', { status: newStatus }");
  assert.equal(tap >= 0 && tap < warn && warn < save, true);
  assert.match(detail, /!allowTerritory\(knockedAt\)\) return/);
  assert.match(read("app/components/LeadMap.tsx"), /territoryWarningCancelled\(\)/);
  assert.match(read("app/components/AddLeadModal.tsx"), /isTerritoryWarningCancelled/);
});

test("resume requeues only owned_by_other, once an hour, per account, under the pending cap", () => {
  resetResumeReopenForTests();
  const now = 1_700_000_000_000;
  const parked = knock({
    id: "parked-1",
    syncState: "parked",
    parkedReason: SYNC_REASON.ownedByOther,
    createdAt: at,
  });
  const otherReason = knock({
    id: "other-reason",
    syncState: "parked",
    parkedReason: SYNC_REASON.outOfTerritory,
  });
  const otherAccount = knock({
    id: "other-account",
    userId: "other",
    syncState: "parked",
    parkedReason: SYNC_REASON.ownedByOther,
  });
  const opened = reopenOwnedByOtherOnResume([parked, otherReason, otherAccount], "rep", now);
  assert.equal(opened[0].syncState, "queued");
  assert.equal(opened[0].id, "parked-1");
  assert.equal(opened[0].createdAt, at);
  assert.equal(opened[1], otherReason);
  assert.equal(opened[2], otherAccount);
  const held = reopenOwnedByOtherOnResume(opened.map((row) => row.id === "parked-1" ? { ...row, syncState: "parked", parkedReason: SYNC_REASON.ownedByOther } : row), "rep", now + 1000);
  assert.equal(held[0].syncState, "parked");
  const later = reopenOwnedByOtherOnResume([parked], "rep", now + RESUME_REOPEN_MS);
  assert.equal(later[0].syncState, "queued");
  resetResumeReopenForTests();
  const otherUser = reopenOwnedByOtherOnResume([parked], "other", now);
  assert.equal(otherUser[0], parked);
  const full = Array.from({ length: 500 }, (_, index) => knock({ id: `queued-${index}`, syncState: "queued" }));
  const capped = reopenOwnedByOtherOnResume([...full, parked], "rep", now);
  assert.equal(capped.at(-1), parked);
  assert.match(read("app/field/useFieldData.ts"), /appStateChange/);
  assert.match(read("app/field/useFieldData.ts"), /reopenOwnedByOtherOnResume/);
  const send = read("app/field/useFieldData.ts");
  assert.equal(send.indexOf("settleCountedOnly") < send.indexOf("acknowledgeMobileLead(actor"), true);
});

test("release 14.23 build 167 is wired and knockCount.ts is unchanged", () => {
  const hash = createHash("sha256").update(readFileSync(path.join(root, "app/utils/knockCount.ts"))).digest("hex");
  assert.equal(hash, "a00be3335708b5b54605b08f11bd37fb9fa5ada20e3c0cb428d57b58bf1dd226");
  assert.equal(release.version, "14.23");
  assert.equal(release.build, 167);
  const project = read("ios/App/App.xcodeproj/project.pbxproj");
  assert.deepEqual([...project.matchAll(/MARKETING_VERSION = ([0-9.]+);/g)].map((match) => match[1]), ["14.23", "14.23"]);
  assert.deepEqual([...project.matchAll(/CURRENT_PROJECT_VERSION = (\d+);/g)].map((match) => match[1]), ["167", "167"]);
  const gradle = read("android/app/build.gradle");
  assert.match(gradle, /versionName "14\.23"/);
  assert.match(gradle, /versionCode 167\b/);
  assert.match(read("tests/mobile/silent-sync-v1418.test.ts"), /X-Raydar-Build"\], "167"/);
  for (const file of [
    "app/mobile/_lib/ownerCounts.ts",
    "app/field/useFieldData.ts",
    "app/hooks/useLiveLeads.ts",
    "app/hooks/useViewportLeads.ts",
    "app/components/LeadDetail.tsx",
    "app/components/LeadMap.tsx",
  ]) {
    assert.equal(read(file).includes("fieldKnockEvents"), false, file);
    assert.equal(read(file).includes("getDocs("), false, file);
  }
});
