import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DEFAULT_DISPOSITIONS } from "../../app/types/disposition";
import { overlayDrafts } from "../../app/field/deviceStore";
import { resetParkedReopenForTests, reopenDeniedParked } from "../../app/field/draftMigration";
import { deliverFieldDispo, fieldDispoBody, postFieldDispo } from "../../app/field/serverDispo";
import { syncOutbox, territoryRecoveryRows } from "../../app/field/syncOutbox";
import { readSyncLog, resetSyncLogForTests, syncReportItem } from "../../app/field/syncDiagnostics";
import { SYNC_REASON } from "../../app/field/syncReasons";
import type { PendingMutation } from "../../app/field/types";
import { HOT_DISPO_BLOCK_COPY, HOT_TERRITORY_RECOVERY_LABEL, HOT_VIEW_ONLY_LEGEND, hotDispoBlockMessage } from "../../app/hotLeads/copy";
import { hotLeadDetailState } from "../../app/hotLeads/detailState";
import { HotLeadDetail } from "../../app/hotLeads/HotLeadDetail";
import { fetchHotLeadDetail, fetchHotLeadMap, hotDetailUrl, parseHotLeadPin, resetHotLeadFetchForTests, type HotFetcher } from "../../app/hotLeads/fetch";
import { HOT_LEADS_ENABLED } from "../../app/hotLeads/flag";
import {
  bindHotLeadRefresh,
  hotLeadCanDispo,
  hotPinForLead,
  noteHotDispo,
  noteHotLocal,
  publishHotCapabilities,
  publishHotLeadIndex,
  rememberServerHotPin,
  resetHotLeadStore,
  rollbackHotLead,
  serverHotPin,
  type DispoBlock,
  type HotLeadPin,
} from "../../app/hotLeads/model";
import { queueHotClaim, queueHotKnock, queueHotNotes } from "../../app/hotLeads/save";
import { MobileDataContext } from "../../app/mobile/_components/MobileDataProvider";
import { fieldPinArtwork, HOT_RING_COLOR, HOT_VIEW_ONLY_RING, withLegacyHotPin } from "../../app/utils/fieldPin";
import type { Lead, User, UserRole } from "../../app/types";
import { captureSavePayloads } from "./helpers/savePayloadContract";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const tapped = new Date("2026-10-30T15:04:00.000Z");
const blocks: DispoBlock[] = ["outside_territory", "no_territory", "territory_unknown", "no_coords"];

function read(relative: string): string {
  return readFileSync(path.join(root, relative), "utf8");
}

function person(role: UserRole): User {
  return {
    id: "rep-1",
    name: "Riley Example",
    email: "riley@example.com",
    color: "#335364",
    role,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    approved: true,
    approvalStatus: "approved",
    isActive: true,
    status: "active",
  } as User;
}

function pin(extra: Partial<HotLeadPin> = {}): HotLeadPin {
  return {
    id: "ghl_opp_example_1",
    lat: 43.161,
    lng: -77.611,
    address: "200 Example Ave",
    city: "Rochester",
    state: "NY",
    zip: "14607",
    contacts: [{ name: "Alex Example", phone: "555-0199", email: "alex@example.com" }],
    hotStatus: "active",
    claimedBy: null,
    claimedByName: null,
    claimedAt: null,
    status: null,
    disposition: null,
    dispositionedAt: null,
    notes: "existing note",
    linkedLeadId: null,
    homeownerId: null,
    ...extra,
  };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function channel(hex: string, index: number) {
  const value = parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16) / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function contrast(hex: string, against: string) {
  const lum = (color: string) => {
    const [r, g, b] = [0, 1, 2].map((index) => channel(color, index));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [light, dark] = [lum(hex), lum(against)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

function renderDetail(row: HotLeadPin, role: UserRole = "closer"): string {
  publishHotCapabilities({ dispo: true, claim: true });
  return renderToStaticMarkup(createElement(
    MobileDataContext.Provider,
    { value: { field: { enqueue: async () => {}, drafts: [], discard: async () => {} } } as never },
    createElement(HotLeadDetail, { pin: row, user: person(role), dispositions: DEFAULT_DISPOSITIONS }),
  )).replace(/&#x27;/g, "'");
}

function houseLead(): Lead {
  return {
    id: pin().id,
    name: "Alex Example",
    address: "200 Example Ave",
    city: "Rochester",
    state: "NY",
    zip: "14607",
    status: "assigned",
    notes: "existing note",
    createdAt: tapped,
    lat: 43.161,
    lng: -77.611,
  } as Lead;
}

test("view-only copy is exact for every dispo block, and absent canDispo stays writable", () => {
  assert.equal(
    HOT_DISPO_BLOCK_COPY.outside_territory,
    "This 3PL lead is outside your assigned territory. You can view it, but you can't knock, claim or add notes.",
  );
  assert.equal(
    HOT_DISPO_BLOCK_COPY.no_territory,
    "You don't have an assigned territory, so 3PL leads are view-only. Ask your manager to assign one.",
  );
  assert.equal(
    HOT_DISPO_BLOCK_COPY.territory_unknown,
    "We couldn't confirm your territory, so this 3PL lead is view-only right now.",
  );
  assert.equal(HOT_DISPO_BLOCK_COPY.no_coords, "This 3PL lead has no map location, so it's view-only.");
  assert.equal(hotDispoBlockMessage(undefined), HOT_DISPO_BLOCK_COPY.outside_territory);
  assert.equal(hotDispoBlockMessage("nope"), HOT_DISPO_BLOCK_COPY.outside_territory);
  const writable = { canWrite: true, caps: { claim: true, dispo: true }, userId: "rep-1", role: "closer" };
  for (const block of blocks) {
    const state = hotLeadDetailState({ pin: { canDispo: false, dispoBlock: block, claimedBy: null }, ...writable });
    assert.equal(state.viewOnly, true, block);
    assert.equal(state.message, HOT_DISPO_BLOCK_COPY[block], block);
    assert.equal(state.showClaim, false, block);
    assert.equal(state.showRelease, false, block);
    assert.equal(state.showKnocks, false, block);
    assert.equal(state.showSave, false, block);
    assert.equal(state.notesReadOnly, true, block);
  }
  const open = hotLeadDetailState({ pin: { claimedBy: null }, ...writable });
  assert.equal(hotLeadCanDispo({}), true);
  assert.equal(hotLeadCanDispo(undefined), true);
  assert.equal(open.viewOnly, false);
  assert.equal(open.message, null);
  assert.equal(open.showClaim, true);
  assert.equal(open.showKnocks, true);
  assert.equal(open.showSave, true);
  assert.equal(open.notesReadOnly, false);
  const managerOpen = hotLeadDetailState({
    pin: { canDispo: true, dispoBlock: null, claimedBy: "other" },
    ...writable,
    role: "manager",
  });
  assert.equal(managerOpen.viewOnly, false);
  assert.equal(managerOpen.showKnocks, true);
  assert.equal(managerOpen.showRelease, true);
  const managerLocked = hotLeadDetailState({
    pin: { canDispo: false, dispoBlock: "outside_territory", claimedBy: null },
    ...writable,
    role: "admin",
  });
  assert.equal(managerLocked.showKnocks, false);
  assert.equal(managerLocked.showClaim, false);
});

test("the rendered 3PL detail hides knock, claim, notes save and Call for each block", () => {
  resetHotLeadStore();
  const openHtml = renderDetail(pin());
  assert.match(openHtml, /Claim/);
  assert.match(openHtml, /Not Home/);
  assert.match(openHtml, /Save 3PL lead notes/);
  assert.match(openHtml, /tel:555-0199/);
  assert.equal(openHtml.includes("readOnly"), false);
  assert.equal(openHtml.includes("readonly"), false);
  assert.equal(openHtml.includes(HOT_DISPO_BLOCK_COPY.outside_territory), false);
  for (const block of blocks) {
    const html = renderDetail(pin({ canDispo: false, dispoBlock: block }));
    assert.match(html, new RegExp(HOT_DISPO_BLOCK_COPY[block].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.equal(html.includes(">Claim<"), false, block);
    assert.equal(html.includes(">Release<"), false, block);
    assert.equal(html.includes(">Not Home<"), false, block);
    assert.equal(html.includes("Save 3PL lead notes"), false, block);
    assert.match(html, /readOnly|readonly/);
    assert.match(html, /data-hot-view-only="true"/);
  }
  const dncOpen = renderDetail(pin({ doNotCall: true }));
  const dncLocked = renderDetail(pin({ doNotCall: true, canDispo: false, dispoBlock: "no_territory" }));
  assert.match(dncOpen, /Do not call/);
  assert.match(dncLocked, /Do not call/);
  assert.equal(dncOpen.includes("tel:"), false);
  assert.equal(dncLocked.includes("tel:"), false);
  assert.match(dncOpen, /Claim/);
  assert.equal(dncLocked.includes(">Claim<"), false);
  assert.match(dncLocked, new RegExp(HOT_DISPO_BLOCK_COPY.no_territory.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  resetHotLeadStore();
});

test("map pins with canDispo false use the view-only ring and legend", () => {
  const open = pin();
  const locked = pin({ canDispo: false, dispoBlock: "outside_territory" });
  const openLead = { ...houseLead(), hotLead: true as const, hotPin: open };
  const lockedLead = { ...houseLead(), hotLead: true as const, hotPin: locked };
  const openArt = fieldPinArtwork(openLead, undefined, 18, false, true);
  const lockedArt = fieldPinArtwork(lockedLead, undefined, 18, false, true);
  const lockedSmall = fieldPinArtwork(lockedLead, undefined, 12, false, true);
  assert.equal(openArt.label.startsWith("3PL lead · "), true);
  assert.equal(lockedArt.label.startsWith(`${HOT_VIEW_ONLY_LEGEND} · `), true);
  assert.match(decodeURIComponent(lockedArt.url), /data-hot-view-only="true"/);
  assert.match(decodeURIComponent(lockedArt.url), /stroke-dasharray/);
  assert.match(decodeURIComponent(lockedArt.url), new RegExp(HOT_VIEW_ONLY_RING));
  assert.equal(decodeURIComponent(lockedArt.url).includes(HOT_RING_COLOR), false);
  assert.match(decodeURIComponent(lockedSmall.url), /data-hot-view-only="true"/);
  assert.match(decodeURIComponent(openArt.url), new RegExp(HOT_RING_COLOR));
  assert.equal(decodeURIComponent(openArt.url).includes("data-hot-view-only"), false);
  const legacy = withLegacyHotPin("<div>pin</div>", true);
  assert.match(legacy, /data-hot-view-only="true"/);
  assert.equal(legacy.includes("🔥"), false);
  assert.match(withLegacyHotPin("<div>pin</div>"), /🔥/);
  assert.ok(contrast(HOT_VIEW_ONLY_RING, "#ffffff") >= 3);
  assert.ok(contrast(HOT_VIEW_ONLY_RING, "#f2efe9") >= 3);
  const section = read("app/hotLeads/HotLeadFilterSection.tsx");
  assert.match(section, /HOT_VIEW_ONLY_LEGEND/);
  assert.equal(HOT_VIEW_ONLY_LEGEND, "3PL lead — view only");
  assert.match(read("app/components/LeadMap.tsx"), /hotLeadViewOnly/);
});

test("parsed map and detail pins carry canDispo, and a missing field stays writable", async () => {
  resetHotLeadStore();
  resetHotLeadFetchForTests();
  const fetcher: HotFetcher = async (url) => {
    if (url.includes("mode=map")) {
      return json(200, {
        hotLeads: [pin({ canDispo: false, dispoBlock: "no_territory" })],
        nextCursor: null,
        capabilities: { dispo: true, claim: true },
      });
    }
    return json(200, { hotLead: pin({ canDispo: true, dispoBlock: null }) });
  };
  const map = await fetchHotLeadMap({
    user: person("closer"),
    view: { south: 43.1, north: 43.14, west: -77.64, east: -77.6, zoom: 16 },
    token: "tok",
    fetcher,
    enabled: true,
  });
  assert.equal(map.pins[0]?.canDispo, false);
  assert.equal(map.pins[0]?.dispoBlock, "no_territory");
  assert.equal(serverHotPin(map.pins[0].id)?.dispoBlock, "no_territory");
  const one = await fetchHotLeadDetail({ user: person("closer"), id: pin().id, token: "tok", fetcher, enabled: true });
  assert.equal(one.hotLead?.canDispo, true);
  assert.equal(one.hotLead?.dispoBlock, null);
  assert.equal(hotDetailUrl(pin().id).includes("mode=map"), false);
  assert.match(hotDetailUrl(pin().id), /[?&]id=/);
  const absent = parseHotLeadPin(pin());
  assert.equal(absent?.canDispo, undefined);
  assert.equal(hotLeadCanDispo(absent), true);
  const unknown = parseHotLeadPin({ ...pin(), canDispo: false, dispoBlock: "later" });
  assert.equal(unknown?.canDispo, false);
  assert.equal(unknown?.dispoBlock, "outside_territory");
  resetHotLeadStore();
  resetHotLeadFetchForTests();
});

test("a territory 403 parks the hot draft, rolls back, refetches mode=one, and never writes leads", async () => {
  resetHotLeadStore();
  resetSyncLogForTests();
  resetParkedReopenForTests();
  const user = person("closer");
  const original = pin();
  rememberServerHotPin(original);
  publishHotLeadIndex(new Map([[original.id, original]]));
  noteHotDispo(original.id, "not-home", "Not Home");
  noteHotLocal(original.id, { notes: "optimistic note", claimedBy: user.id, claimedByName: user.name });
  assert.equal(hotPinForLead(original.id)?.status, "not-home");
  assert.equal(hotPinForLead(original.id)?.notes, "optimistic note");
  let refreshes = 0;
  bindHotLeadRefresh(async (id) => {
    refreshes += 1;
    assert.equal(id, original.id);
    return { ...original, canDispo: false, dispoBlock: "outside_territory" };
  });
  const knock = queueHotKnock({
    enabled: true, user, pin: original, draftId: "draft-hot-knock", tappedAt: tapped,
    status: "not-home", disposition: "Not Home",
  }) as PendingMutation;
  if (knock.direct?.gps) delete knock.direct.gps;
  knock.syncState = "queued";
  const notes = queueHotNotes({
    enabled: true, user, pin: original, draftId: "draft-hot-notes", tappedAt: new Date(tapped.getTime() + 1000),
    notes: "optimistic note", baseNotes: "existing note",
  }) as PendingMutation;
  notes.syncState = "queued";
  const rows = [knock, notes];
  const removed = new Set<string>();
  const posts: { path: string; body: string }[] = [];
  const commits: string[] = [];
  let online = false;
  let clock = 10_000;
  const send = async (row: PendingMutation) => {
    if (!online) throw Object.assign(Error("failed to fetch"), { code: "offline" });
    return deliverFieldDispo(row, user, {
      getToken: async () => "token",
      commit: async () => {
        commits.push(row.leadId);
        throw Object.assign(Error("direct"), { status: 500, code: "direct-not-used" });
      },
      post: async (pathName, init) => {
        posts.push({ path: pathName, body: String(init?.body ?? "") });
        return json(403, {
          ok: false,
          error: "forbidden",
          reasonCode: "out_of_territory",
          dispoBlock: "outside_territory",
        });
      },
    });
  };
  const run = () => syncOutbox({
    read: async () => rows.filter((row) => !removed.has(row.id)),
    send,
    remove: async (id) => { removed.add(id); },
    update: async (row) => {
      const index = rows.findIndex((item) => item.id === row.id);
      if (index >= 0) rows[index] = row;
    },
    active: () => true,
    now: () => clock,
    random: () => 0.5,
  });
  await run();
  assert.equal(posts.length, 0);
  assert.equal(rows.some((row) => row.syncState === "retry" || row.syncState === "queued"), true);
  online = true;
  clock += 60 * 60 * 1000;
  await run();
  assert.equal(removed.size, 0);
  assert.equal(posts.length, 2);
  assert.deepEqual(posts.map((row) => row.path), ["/api/field/dispo", "/api/field/dispo"]);
  for (const post of posts) {
    const body = JSON.parse(post.body) as Record<string, unknown>;
    assert.equal(body.collection, "hotLeads");
    assert.equal("canDispo" in body, false);
    assert.equal("dispoBlock" in body, false);
  }
  assert.deepEqual(commits, []);
  for (const row of rows) {
    assert.equal(row.syncState, "parked");
    assert.equal(row.parkedReason, SYNC_REASON.outOfTerritory);
    assert.equal(row.routeHold, undefined);
    assert.equal(row.lastError, HOT_DISPO_BLOCK_COPY.outside_territory);
  }
  assert.equal(hotPinForLead(original.id)?.status, null);
  assert.equal(hotPinForLead(original.id)?.notes, "existing note");
  assert.equal(hotPinForLead(original.id)?.claimedBy, null);
  assert.equal(hotPinForLead(original.id)?.canDispo, false);
  assert.equal(refreshes, 2);
  const sent = posts.length;
  for (let cycle = 0; cycle < 3; cycle += 1) {
    clock += 60 * 60 * 1000;
    await run();
  }
  assert.equal(posts.length, sent);
  assert.equal(removed.size, 0);
  const reopened = reopenDeniedParked(rows, user.id);
  assert.equal(reopened.every((row) => row.syncState === "parked"), true);
  clock += 60 * 60 * 1000;
  await syncOutbox({
    read: async () => reopened,
    send,
    remove: async (id) => { removed.add(id); },
    update: async () => {},
    active: () => true,
    now: () => clock,
    random: () => 0.5,
  });
  assert.equal(posts.length, sent);
  const parkedEvents = (await readSyncLog(user.id)).filter((event) => event.state === "parked");
  assert.equal(parkedEvents.length >= 2, true);
  for (const event of parkedEvents) assert.equal(syncReportItem(event).reasonCode, "out_of_territory");
  const recovery = territoryRecoveryRows(rows);
  assert.equal(recovery.length, 2);
  assert.deepEqual(recovery[0]?.actions, ["dismiss"]);
  assert.equal(recovery[0]?.label, HOT_TERRITORY_RECOVERY_LABEL);
  assert.equal(recovery[0]?.label, "Not saved: outside your territory");
  const over = overlayDrafts([houseLead()], rows);
  assert.equal(over[0]?.status, "assigned");
  assert.equal(over[0]?.notes, "existing note");
  resetHotLeadStore();
  resetSyncLogForTests();
});

test("a queued claim is parked the same way, and an in-territory knock is saved", async () => {
  resetHotLeadStore();
  resetSyncLogForTests();
  const user = person("closer");
  const original = pin();
  rememberServerHotPin(original);
  publishHotLeadIndex(new Map([[original.id, original]]));
  noteHotLocal(original.id, { claimedBy: user.id, claimedByName: user.name });
  bindHotLeadRefresh(async () => ({ ...original, canDispo: false, dispoBlock: "no_coords" }));
  const claim = queueHotClaim({
    enabled: true, user, pin: original, draftId: "draft-hot-claim", tappedAt: tapped, action: "claim",
  }) as PendingMutation;
  claim.syncState = "queued";
  const rows = [claim];
  const posts: string[] = [];
  await syncOutbox({
    read: async () => rows,
    send: async (row) => deliverFieldDispo(row, user, {
      getToken: async () => "token",
      commit: async () => { throw Error("direct"); },
      post: async (pathName, init) => {
        posts.push(pathName + String(init?.body ?? ""));
        return json(403, { ok: false, error: "forbidden", reasonCode: "out_of_territory" });
      },
    }),
    remove: async () => { throw Error("removed"); },
    update: async (row) => { rows[0] = row; },
    active: () => true,
    now: () => 20_000,
    random: () => 0.5,
  });
  assert.equal(rows[0]?.syncState, "parked");
  assert.equal(rows[0]?.parkedReason, SYNC_REASON.outOfTerritory);
  assert.equal(rows[0]?.lastError, HOT_DISPO_BLOCK_COPY.outside_territory);
  assert.equal(hotPinForLead(original.id)?.claimedBy, null);
  assert.match(posts[0] || "", /\/api\/hot-leads\/claim/);
  assert.equal((posts[0] || "").includes("canDispo"), false);
  const list = territoryRecoveryRows(rows);
  assert.deepEqual(list[0]?.actions, ["dismiss"]);
  const ui = read("app/field/TerritoryRecoveryList.tsx");
  assert.match(ui, /Dismiss/);
  assert.equal(/\bRetry\b/.test(ui), false);
  assert.match(read("app/components/LeadMap.tsx"), /TerritoryRecoveryList/);
  assert.match(read("app/field/FieldWorkspace.tsx"), /TerritoryRecoveryList/);

  resetHotLeadStore();
  const saved = pin();
  rememberServerHotPin(saved);
  publishHotLeadIndex(new Map([[saved.id, saved]]));
  noteHotDispo(saved.id, "not-home", "Not Home");
  const knock = queueHotKnock({
    enabled: true, user, pin: saved, draftId: "draft-hot-ok", tappedAt: tapped,
    status: "not-home", disposition: "Not Home",
  }) as PendingMutation;
  if (knock.direct?.gps) delete knock.direct.gps;
  knock.syncState = "queued";
  const kept = [knock];
  const gone = new Set<string>();
  await syncOutbox({
    read: async () => kept.filter((row) => !gone.has(row.id)),
    send: async (row) => deliverFieldDispo(row, user, {
      getToken: async () => "token",
      commit: async () => { throw Error("direct"); },
      post: async () => json(200, { ok: true }),
    }),
    remove: async (id) => { gone.add(id); },
    update: async (row) => { kept[0] = row; },
    active: () => true,
    now: () => 30_000,
    random: () => 0.5,
  });
  assert.deepEqual([...gone], ["draft-hot-ok"]);
  assert.equal(hotPinForLead(saved.id)?.status, "not-home");
  let leadsDenied: Error | undefined;
  try {
    await postFieldDispo({
      id: "draft-lead",
      userId: user.id,
      userName: user.name,
      leadId: "lead-1",
      createdAt: tapped.toISOString(),
      kind: "knock",
      baseStatus: "claimed",
      status: "not-home",
      disposition: "Not Home",
      direct: { patch: { status: "not-home" } },
    }, user, {
      getToken: async () => "token",
      post: async () => json(403, { reasonCode: "out_of_territory", dispoBlock: "outside_territory" }),
    });
  } catch (error) {
    leadsDenied = error as Error;
  }
  assert.ok(leadsDenied);
  assert.equal(leadsDenied.message, "The disposition route denied this knock.");
  const hotBody = fieldDispoBody(knock, user);
  assert.equal("canDispo" in hotBody, false);
  assert.equal(hotBody.collection, "hotLeads");
  resetHotLeadStore();
  resetSyncLogForTests();
});

test("other dispo blocks use their copy, and a queued in-territory note is not a territory park", async () => {
  resetHotLeadStore();
  const user = person("manager");
  const original = pin();
  for (const block of ["no_territory", "territory_unknown", "no_coords"] as const) {
    rememberServerHotPin(original);
    publishHotLeadIndex(new Map([[original.id, { ...original }]]));
    const draft = queueHotNotes({
      enabled: true, user, pin: original, draftId: `draft-${block}`, tappedAt: tapped,
      notes: "Card", baseNotes: "existing note",
    }) as PendingMutation;
    let error: (Error & { reasonCode?: string }) | undefined;
    try {
      await deliverFieldDispo(draft, user, {
        getToken: async () => "token",
        commit: async () => { throw Error("direct"); },
        post: async () => json(403, { ok: false, error: "forbidden", reasonCode: "out_of_territory", dispoBlock: block }),
      });
    } catch (caught) {
      error = caught as Error & { reasonCode?: string };
    }
    assert.ok(error);
    assert.equal(error.reasonCode, "out_of_territory");
    assert.equal(error.message, HOT_DISPO_BLOCK_COPY[block]);
  }
  resetHotLeadStore();
});

test("save payloads on the direct and route paths stay byte-identical to base", async () => {
  const golden = JSON.parse(read("tests/mobile/fixtures/save-payloads-05037a3.json")) as Record<string, unknown>;
  const actual = await captureSavePayloads();
  for (const kind of ["knock", "dispo", "notes", "contact", "claim", "release", "go-back", "objection"]) {
    assert.deepEqual(actual[kind], golden[kind], kind);
  }
  assert.equal(JSON.stringify(actual), JSON.stringify(golden));
  const encoded = JSON.stringify(actual);
  assert.equal(encoded.includes("canDispo"), false);
  assert.equal(encoded.includes("dispoBlock"), false);
});

test("the gate adds no client request field, no knock count, and the flag stays off", () => {
  assert.equal(existsSync(path.join(root, "app/utils/knockCount.ts")), false);
  assert.equal(HOT_LEADS_ENABLED, false);
  assert.match(read("app/hotLeads/flag.ts"), /NEXT_PUBLIC_HOT_LEADS === "1"/);
  const client = [
    "app/hotLeads/model.ts",
    "app/hotLeads/fetch.ts",
    "app/hotLeads/save.ts",
    "app/hotLeads/HotLeadDetail.tsx",
    "app/hotLeads/detailState.ts",
    "app/hotLeads/copy.ts",
    "app/hooks/useHotLeads.ts",
  ].map(read).join("\n");
  assert.equal(client.includes("insideTerritory"), false);
  assert.equal(client.includes("loadTerritories"), false);
  assert.match(read("app/hooks/useHotLeads.ts"), /bindHotLeadRefresh/);
  assert.match(read("app/hooks/useHotLeads.ts"), /fetchHotLeadDetail/);
  const queued = queueHotKnock({
    enabled: true,
    user: person("closer"),
    pin: pin({ canDispo: false, dispoBlock: "outside_territory" }),
    draftId: "draft-still-queues",
    tappedAt: tapped,
    status: "not-home",
    disposition: "Not Home",
  });
  assert.equal(queued?.collection, "hotLeads");
  assert.equal(queued?.kind, "knock");
  const hook = read("app/hotLeads/save.ts");
  assert.equal(hook.includes("canDispo"), false);
});

test("rollback without a refresh restores the last server copy", async () => {
  resetHotLeadStore();
  const original = pin({ notes: "server notes" });
  rememberServerHotPin(original);
  publishHotLeadIndex(new Map([[original.id, original]]));
  noteHotDispo(original.id, "appointment", "Appointment Set");
  noteHotLocal(original.id, { notes: "typed", claimedBy: "rep-1" });
  await rollbackHotLead(original.id);
  assert.equal(hotPinForLead(original.id)?.status, null);
  assert.equal(hotPinForLead(original.id)?.notes, "server notes");
  assert.equal(hotPinForLead(original.id)?.claimedBy, null);
  resetHotLeadStore();
});
