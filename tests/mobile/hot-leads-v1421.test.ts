import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { groupHouseLeads } from "../../app/homeowners/houseIdentity";
import { deliverFieldDispo, fieldDispoBody, SERVER_DISPO_SLOW_RETRY_MS } from "../../app/field/serverDispo";
import { syncOutbox } from "../../app/field/syncOutbox";
import { commitDirectMutation } from "../../app/field/directWrites";
import { HOT_LEADS_ENABLED } from "../../app/hotLeads/flag";
import { canSeeHotLeads, isDemoAccount } from "../../app/hotLeads/access";
import {
  fetchHotLeadDetail,
  fetchHotLeadMap,
  hotDetailUrl,
  hotMapUrl,
  parseHotLeadPin,
  resetHotLeadFetchForTests,
  type HotFetcher,
} from "../../app/hotLeads/fetch";
import { applyHotFilter, HOT_LEAD_LEGEND, hotLeadFilterVisible } from "../../app/hotLeads/filter";
import {
  DO_NOT_CALL_WARNING,
  hotLeadAfterDispo,
  hotLeadCallAllowed,
  isHotLead,
  mergeHotLeads,
  resetHotLeadStore,
  toHotDisplayLead,
  type HotLeadPin,
} from "../../app/hotLeads/model";
import {
  HOT_CLAIM_PATH,
  HOT_LEAD_AREA_GATE,
  HOT_LEAD_DIRECT_WRITE,
  HOT_LEAD_OLD_SERVER_NOTICE,
  HOT_LEAD_OWNED_MESSAGE,
  HOT_LEAD_PROXIMITY_WARNING,
  HOT_LEAD_ROUTE_SUPPORTS_CONTACT,
  HOT_LEAD_ROUTE_SUPPORTS_PHOTO,
  captureHotKnock,
  hotClaimBody,
  hotLeadEditors,
  hotLeadParkNotice,
  isHotLeadDraft,
  queueHotClaim,
  queueHotKnock,
  queueHotNotes,
} from "../../app/hotLeads/save";
import { fieldPinArtwork, fieldPinZoomTier, HOT_RING_COLOR, withLegacyHotPin } from "../../app/utils/fieldPin";
import type { Lead, User, UserRole } from "../../app/types";
import type { PendingMutation } from "../../app/field/types";

const tapped = new Date("2026-10-30T15:04:00.000Z");

function person(role: UserRole, extra: Record<string, unknown> = {}): User {
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
    ...extra,
  } as User;
}

function lead(id = "lead-1", extra: Partial<Lead> = {}): Lead {
  return {
    id,
    name: "Pat Example",
    address: "100 Example Ave",
    city: "Rochester",
    state: "NY",
    zip: "14607",
    status: "not-home",
    createdAt: tapped,
    lat: 43.16,
    lng: -77.61,
    ...extra,
  };
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
    contacts: [{ name: "Alex Example", phone: "555-0100", email: "alex@example.com" }],
    ghlStage: "New",
    ghlSource: "Example Ads",
    hotStatus: "active",
    claimedBy: null,
    claimedByName: null,
    claimedAt: null,
    status: null,
    disposition: null,
    dispositionedAt: null,
    linkedLeadId: null,
    homeownerId: null,
    ...extra,
  };
}

function view() {
  return { south: 43.15, north: 43.17, west: -77.63, east: -77.6, zoom: 17 };
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function decode(url: string) {
  return decodeURIComponent(url.slice("data:image/svg+xml,".length));
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

test("flag defaults off and the hot layer is role, test and demo gated", () => {
  assert.equal(HOT_LEADS_ENABLED, process.env.NEXT_PUBLIC_HOT_LEADS === "1");
  assert.equal(HOT_LEADS_ENABLED, false);
  assert.equal(canSeeHotLeads(person("closer")), true);
  assert.equal(canSeeHotLeads(person("manager")), true);
  assert.equal(canSeeHotLeads(person("admin")), true);
  assert.equal(canSeeHotLeads(person("setter")), false);
  assert.equal(canSeeHotLeads(null), false);
  assert.equal(canSeeHotLeads(person("closer", { isActive: false })), false);
  assert.equal(canSeeHotLeads(person("closer", { approved: false })), false);
  assert.equal(canSeeHotLeads(person("closer", { approvalStatus: "pending" })), false);
  assert.equal(canSeeHotLeads(person("closer", { deleted: true })), false);
  assert.equal(canSeeHotLeads(person("closer", { isTestAccount: true })), false);
  assert.equal(canSeeHotLeads(person("admin", { testData: true })), false);
  assert.equal(canSeeHotLeads(person("manager", { team: "TEST" })), false);
  assert.equal(isDemoAccount(person("closer", { email: "demo@example.com" })), true);
  assert.equal(canSeeHotLeads(person("admin", { id: "demo-admin", email: "demo@example.com" })), false);
  assert.equal(canSeeHotLeads(person("closer", { demo: true })), false);
  assert.equal(hotLeadFilterVisible(person("setter"), true), false);
  assert.equal(hotLeadFilterVisible(person("closer"), false), false);
  assert.equal(hotLeadFilterVisible(person("closer"), true), true);
  assert.equal(hotLeadFilterVisible(person("closer", { team: "TEST" }), true), false);
});

test("setters, test accounts, demo accounts and a disabled flag never call /api/hot-leads", async () => {
  resetHotLeadFetchForTests();
  const calls: string[] = [];
  const fetcher: HotFetcher = async (url) => {
    calls.push(url);
    return json(200, { hotLeads: [pin()], nextCursor: null, capabilities: { dispo: true, claim: true } });
  };
  for (const user of [
    person("setter"),
    person("closer", { isTestAccount: true }),
    person("admin", { email: "demo@example.com", id: "demo" }),
    null,
  ]) {
    const result = await fetchHotLeadMap({ user, view: view(), token: "tok", fetcher, enabled: true });
    assert.deepEqual(result.pins, []);
    assert.equal(result.error, "");
  }
  const off = await fetchHotLeadMap({ user: person("closer"), view: view(), token: "tok", fetcher, enabled: false });
  assert.deepEqual(off.pins, []);
  assert.equal(calls.length, 0);
  assert.equal(queueHotKnock({
    enabled: false, user: person("closer"), pin: pin(), draftId: "d1", tappedAt: tapped, status: "not-home", disposition: "Not Home",
  }), null);
});

test("closer, manager and admin fetch page size 200 and follow the cursor", async () => {
  resetHotLeadFetchForTests();
  const calls: string[] = [];
  let page = 0;
  const fetcher: HotFetcher = async (url) => {
    calls.push(url);
    page += 1;
    const id = `ghl_page_${page}`;
    return json(200, {
      hotLeads: [pin({ id, lat: 43.15 + page / 1000 })],
      nextCursor: page < 4 ? { id, lat: 43.15 + page / 1000 } : null,
      capabilities: { dispo: true, claim: true },
    });
  };
  for (const role of ["closer", "manager", "admin"] as const) {
    resetHotLeadFetchForTests();
    calls.length = 0;
    page = 0;
    const result = await fetchHotLeadMap({ user: person(role), view: view(), token: "tok", fetcher, enabled: true });
    assert.equal(result.error, "");
    assert.equal(result.pins.length, 4);
    assert.equal(result.capabilities.dispo, true);
    assert.equal(result.capabilities.claim, true);
    assert.equal(calls.length, 4);
    assert.match(calls[0], /limit=200/);
    assert.doesNotMatch(calls[0], /[?&]after=/);
    assert.match(calls[1], /limit=200/);
    assert.match(calls[1], /after=ghl_page_1/);
    assert.match(calls[3], /after=ghl_page_3/);
  }
  assert.equal(hotMapUrl(view()).includes("mode=one"), false);
});

test("detail uses ?id= and does not send mode=one", async () => {
  resetHotLeadFetchForTests();
  const calls: string[] = [];
  const fetcher: HotFetcher = async (url) => {
    calls.push(url);
    return json(200, {
      hotLead: { ...pin(), dispositionHistory: [{ disposition: "Not Home", timestamp: tapped.toISOString(), userName: "Riley Example" }] },
    });
  };
  const id = "ghl_opp_example_1";
  assert.equal(hotDetailUrl(id), `/api/hot-leads?id=${id}`);
  assert.equal(hotDetailUrl(id).includes("mode=one"), false);
  const result = await fetchHotLeadDetail({ user: person("closer"), id, token: "tok", fetcher, enabled: true });
  assert.equal(calls[0], `/api/hot-leads?id=${id}`);
  assert.equal(result.error, "");
  assert.equal(result.hotLead?.dispositionHistory?.[0]?.disposition, "Not Home");
  const setter = await fetchHotLeadDetail({ user: person("setter"), id, token: "tok", fetcher, enabled: true });
  assert.equal(setter.hotLead, null);
  assert.equal(calls.length, 1);
});

test("403, 404, 405, 401 and 5xx are silent: no pins, no sign-in copy, no lead-cache clear", async () => {
  const leadCache = { clears: 0, clear() { this.clears += 1; } };
  const hook = readFileSync(new URL("../../app/hooks/useHotLeads.ts", import.meta.url), "utf8");
  const fetchSrc = readFileSync(new URL("../../app/hotLeads/fetch.ts", import.meta.url), "utf8");
  assert.doesNotMatch(hook, /Sign in again or check your territory/);
  assert.doesNotMatch(hook, /useViewportLeads/);
  assert.doesNotMatch(fetchSrc, /cache\.delete\(cachedKey\)/);
  assert.doesNotMatch(fetchSrc, /leadCache/);
  for (const status of [403, 404, 405, 401, 500, 503]) {
    resetHotLeadFetchForTests();
    let calls = 0;
    const fetcher: HotFetcher = async () => {
      calls += 1;
      return json(status, { error: status === 401 ? "unauthenticated" : "not_allowed" });
    };
    const first = await fetchHotLeadMap({
      user: person("closer"), view: view(), token: "tok", fetcher, enabled: true, now: 1_000,
    });
    assert.deepEqual(first.pins, []);
    assert.equal(first.error, "");
    assert.equal(JSON.stringify(first).includes("Sign in"), false);
    const second = await fetchHotLeadMap({
      user: person("closer"), view: view(), token: "tok", fetcher, enabled: true, now: 1_000 + 60_000,
    });
    assert.deepEqual(second.pins, []);
    assert.equal(calls, 1);
    assert.equal(leadCache.clears, 0);
  }
});

test("a network failure keeps the last hot pins and a 500 does not", async () => {
  resetHotLeadFetchForTests();
  let mode: "ok" | "throw" | "500" = "ok";
  const fetcher: HotFetcher = async () => {
    if (mode === "throw") throw Error("failed to fetch");
    if (mode === "500") return json(500, { error: "internal" });
    return json(200, { hotLeads: [pin()], nextCursor: null, capabilities: { dispo: true, claim: false } });
  };
  const ok = await fetchHotLeadMap({ user: person("closer"), view: view(), token: "tok", fetcher, enabled: true, now: 10 });
  assert.equal(ok.pins.length, 1);
  assert.equal(ok.capabilities.claim, false);
  mode = "throw";
  const kept = await fetchHotLeadMap({ user: person("closer"), view: view(), token: "tok", fetcher, enabled: true, now: 11 });
  assert.equal(kept.pins.length, 1);
  assert.equal(kept.error, "");
  resetHotLeadFetchForTests();
  mode = "ok";
  await fetchHotLeadMap({ user: person("closer"), view: view(), token: "tok", fetcher, enabled: true, now: 10 });
  mode = "500";
  const hidden = await fetchHotLeadMap({ user: person("closer"), view: view(), token: "tok", fetcher, enabled: true, now: 12 });
  assert.deepEqual(hidden.pins, []);
  assert.equal(hidden.error, "");
});

test("hot pins merge by linked lead id in one pin and do not mutate leads", () => {
  const house = lead("house-1");
  const older = lead("older", { address: "100 Example Ave" });
  const before = JSON.stringify([house, older]);
  const linked = pin({ id: "ghl_linked_house", linkedLeadId: "house-1", address: "100 Example Ave" });
  const merged = mergeHotLeads([house], [linked]);
  assert.equal(merged.leads.length, 1);
  assert.equal(merged.leads[0].id, "house-1");
  assert.equal(isHotLead(merged.leads[0]), true);
  assert.equal((house as { hotLead?: boolean }).hotLead, undefined);
  assert.equal(JSON.stringify([house, older]), before);
  const unlinked = pin({ id: "ghl_unlinked_pin", linkedLeadId: null, address: "100 Example Ave" });
  assert.equal(mergeHotLeads([house], [unlinked]).leads.length, 2);
  const index = new Map([["older", "house-1"], ["house-1", "house-1"]]);
  const viaHouse = mergeHotLeads([house], [pin({ id: "ghl_via_house", linkedLeadId: "older" })], index);
  assert.equal(viaHouse.leads.length, 1);
  assert.equal(isHotLead(viaHouse.leads[0]), true);
  const rows = [lead("a", { address: "1 Example St" }), lead("b", { address: "2 Example St" })];
  const grouped = groupHouseLeads(rows);
  const snapshot = grouped.pins.map((row) => row.id);
  const untouched = mergeHotLeads(grouped.pins, []);
  assert.equal(untouched.leads, grouped.pins);
  assert.deepEqual(groupHouseLeads(rows).pins.map((row) => row.id), snapshot);
  const filtered = applyHotFilter(merged.leads, "hide");
  assert.equal(isHotLead(filtered[0]), false);
  assert.equal(applyHotFilter(mergeHotLeads([house], [unlinked]).leads, "only").length, 1);
});

test("pin art keeps a non-hot pin unchanged and marks a hot pin at every zoom", () => {
  const plainLead = lead("plain", { status: "appointment", appointmentOutcome: "No Show", solarCategory: "great" });
  const plain = fieldPinArtwork(plainLead, undefined, 18);
  const plainSvg = decode(plain.url);
  assert.equal(plain.url, fieldPinArtwork(plainLead, undefined, 18, false, false).url);
  assert.equal(plainSvg.includes("data-hot-lead"), false);
  assert.equal(plainSvg.includes(HOT_RING_COLOR), false);
  assert.match(plainSvg, /x="29" y="0" width="19" height="18"/);
  assert.equal(plain.label.startsWith("Hot lead"), false);
  const hotLead = { ...plainLead, hotLead: true as const };
  for (const zoom of [10, 12, 14, 16, 17, 18, 19]) {
    const art = fieldPinArtwork(hotLead, undefined, zoom, false, true);
    const svg = decode(art.url);
    assert.match(svg, /data-hot-lead="true"/);
    assert.match(svg, new RegExp(HOT_RING_COLOR));
    assert.equal(art.label.startsWith("Hot lead · "), true);
    const compact = zoom < 17;
    if (compact) assert.equal(svg.includes("M9.2 2.2"), false);
    else assert.match(svg, /M9\.2 2\.2/);
  }
  const warm = fieldPinArtwork(hotLead, undefined, 18, false, true);
  const warmSvg = decode(warm.url);
  assert.match(warmSvg, /data-warm-lead="true"/);
  assert.match(warmSvg, /data-hot-lead="true" transform="translate\(20 0\)"/);
  assert.match(warmSvg, /x="29" y="36" width="19" height="18"/);
  const cold = fieldPinArtwork({ ...lead("cold", { status: "not-home" }), solarCategory: undefined, tags: [], source: "manual" }, undefined, 18, false, true);
  assert.match(decode(cold.url), /data-hot-lead="true" transform="translate\(0 0\)"/);
  assert.doesNotMatch(decode(cold.url), /data-warm-lead/);
  const selected = decode(fieldPinArtwork(hotLead, undefined, 16, true, true).url);
  assert.match(selected, /#F4C84A/);
  assert.match(selected, new RegExp(HOT_RING_COLOR));
  assert.notEqual(HOT_RING_COLOR.toLowerCase(), "#f4c84a");
  assert.ok(contrast(HOT_RING_COLOR, "#ffffff") >= 3);
  assert.ok(contrast(HOT_RING_COLOR, "#f2efe9") >= 3);
  const fresh = lead("fresh", { status: "assigned" });
  assert.ok(fieldPinArtwork(fresh, undefined, 18, false, true).size > fieldPinArtwork(fresh, undefined, 18).size);
  assert.equal(fieldPinZoomTier(18), 4);
  const legacy = withLegacyHotPin("<div>pin</div>");
  assert.match(legacy, /data-hot-lead="true"/);
  assert.match(legacy, /🔥/);
  assert.match(legacy, new RegExp(HOT_RING_COLOR));
  assert.equal(fieldPinArtwork(plainLead, undefined, 17).url, fieldPinArtwork(plainLead, undefined, 17).url);
});

test("knock, notes and claim drafts use the hot route and keep the tap time", async () => {
  const user = person("closer");
  const hot = pin();
  let gpsStarted = 0;
  const draft = await captureHotKnock({
    enabled: true,
    user,
    pin: hot,
    draftId: "draft-hot-1",
    tappedAt: tapped,
    status: "not-home",
    disposition: "Not Home",
    readGps: async () => {
      gpsStarted = Date.now();
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { lat: 43.2, lng: -77.7, accuracyM: 8, capturedAt: "2026-10-30T15:04:05.000Z" };
    },
  });
  assert.ok(draft);
  assert.equal(draft?.createdAt, tapped.toISOString());
  assert.ok(gpsStarted >= tapped.getTime());
  assert.equal(draft?.collection, "hotLeads");
  assert.equal(draft?.leadId, hot.id);
  assert.equal(HOT_LEAD_AREA_GATE, false);
  assert.equal(HOT_LEAD_PROXIMITY_WARNING, false);
  assert.equal(HOT_LEAD_DIRECT_WRITE, false);
  const body = fieldDispoBody(draft as PendingMutation, user);
  assert.equal(body.collection, "hotLeads");
  assert.equal(body.leadId, "ghl_opp_example_1");
  assert.equal(body.actionAt, tapped.toISOString());
  assert.equal(body.kind, "knock");
  assert.equal(JSON.stringify(body).includes("ghlStage"), false);
  assert.equal(JSON.stringify(body).includes("opportunity"), false);
  assert.equal(JSON.stringify(body).includes("555-0100"), false);
  assert.equal((draft?.direct?.patch as { gpsUnverifiedReason?: string }).gpsUnverifiedReason, undefined);
  assert.equal(body.gps?.lat, 43.2);
  const notes = queueHotNotes({
    enabled: true, user, pin: hot, draftId: "draft-notes-1", tappedAt: tapped, notes: "Left a card", baseNotes: "",
  });
  const notesBody = fieldDispoBody(notes as PendingMutation, user);
  assert.equal(notesBody.collection, "hotLeads");
  assert.equal(notesBody.kind, "notes");
  assert.equal(notesBody.leadId, hot.id);
  const claim = queueHotClaim({
    enabled: true, user, pin: hot, draftId: "draft-claim-1", tappedAt: tapped, action: "claim",
  });
  const claimBody = hotClaimBody(claim as PendingMutation);
  assert.deepEqual(Object.keys(claimBody).sort(), ["action", "actionAt", "draftId", "hotLeadId", "userName"]);
  assert.equal(claimBody.action, "claim");
  assert.equal(claimBody.actionAt, tapped.toISOString());
  assert.equal(claimBody.hotLeadId, hot.id);
  assert.equal(JSON.stringify(claimBody).includes("collection"), false);
  assert.ok(Buffer.byteLength(JSON.stringify(claimBody)) <= 2048);
  assert.deepEqual(hotLeadEditors(), { contact: false, photo: false });
  assert.equal(HOT_LEAD_ROUTE_SUPPORTS_CONTACT, false);
  assert.equal(HOT_LEAD_ROUTE_SUPPORTS_PHOTO, false);
  const ordinary = fieldDispoBody({
    id: "draft-plain", userId: user.id, userName: user.name, leadId: "lead-1", createdAt: tapped.toISOString(),
    kind: "knock", baseStatus: "claimed", status: "not-home", disposition: "Not Home",
    direct: { patch: { status: "not-home" } },
  }, user);
  assert.equal("collection" in ordinary, false);
});

test("hot saves never use a direct write, and a 400 parks with a notice", async () => {
  const user = person("admin");
  const hot = pin();
  const knock = queueHotKnock({
    enabled: true, user, pin: hot, draftId: "draft-hot-2", tappedAt: tapped, status: "appointment", disposition: "Appointment Set",
    gps: { lat: 40, lng: -70, accuracyM: 12, capturedAt: tapped.toISOString() },
  }) as PendingMutation;
  let commits = 0;
  let posted = "";
  let body = "";
  await assert.rejects(() => commitDirectMutation(knock, user), /not written directly|disposition route/);
  const denied = await deliverFieldDispo(knock, user, {
    getToken: async () => "token",
    commit: async () => { commits += 1; return { replayed: false }; },
    post: async (path, init) => {
      posted = path;
      body = String(init.body);
      return json(400, { field: "collection" });
    },
  }).catch((error: Error) => error);
  assert.equal(commits, 0);
  assert.equal(posted, "/api/field/dispo");
  assert.match(body, /"collection":"hotLeads"/);
  assert.equal((denied as Error).message, HOT_LEAD_OLD_SERVER_NOTICE);
  const contact = { ...knock, kind: "contact" as const, direct: { patch: { phone: "555-0199" } } };
  const contactError = await deliverFieldDispo(contact, user, {
    getToken: async () => "token",
    commit: async () => { commits += 1; return { replayed: false }; },
    post: async () => json(200, {}),
  }).catch((error: Error) => error);
  assert.equal(commits, 0);
  assert.equal((contactError as Error).message, HOT_LEAD_OLD_SERVER_NOTICE);
  let stored: PendingMutation | undefined;
  const removed: string[] = [];
  await syncOutbox({
    read: async () => [knock],
    send: async () => { throw Object.assign(Error(HOT_LEAD_OLD_SERVER_NOTICE), { status: 400, reasonCode: "invalid_payload" }); },
    remove: async (id) => { removed.push(id); },
    update: async (row) => { stored = row; },
    active: () => true,
    now: () => 5_000,
    random: () => 0.5,
  });
  assert.deepEqual(removed, []);
  assert.equal(stored?.syncState, "parked");
  assert.equal(stored?.collection, "hotLeads");
  assert.equal(stored?.lastError, HOT_LEAD_OLD_SERVER_NOTICE);
  assert.equal(hotLeadParkNotice([stored!]), HOT_LEAD_OLD_SERVER_NOTICE);
});

test("404, 405 and 5xx stay queued on the hot-leads slow retry and are not rewritten as leads", async () => {
  const user = person("closer");
  const hot = queueHotNotes({
    enabled: true, user, pin: pin(), draftId: "draft-hold-1", tappedAt: tapped, notes: "Card", baseNotes: "",
  }) as PendingMutation;
  for (const status of [404, 405, 500, 502]) {
    let stored: PendingMutation | undefined;
    const removed: string[] = [];
    await syncOutbox({
      read: async () => [{ ...hot, id: `draft-hold-${status}` }],
      send: async () => { throw Object.assign(Error("not ready"), { status, code: "hot-leads-hold" }); },
      remove: async (id) => { removed.push(id); },
      update: async (row) => { stored = row; },
      active: () => true,
      now: () => 8_000,
      random: () => 0.5,
    });
    assert.deepEqual(removed, []);
    assert.equal(stored?.syncState, "queued");
    assert.equal(stored?.routeHold, "hot-leads");
    assert.equal(stored?.collection, "hotLeads");
    assert.equal(stored?.nextAttemptAt, 8_000 + SERVER_DISPO_SLOW_RETRY_MS);
    assert.notEqual(stored?.leadId.startsWith("ghl_"), false);
  }
});

test("offline replay keeps the draft id, treats a duplicate as success, and sends in queueSeq order", async () => {
  const user = person("closer");
  const first = queueHotKnock({
    enabled: true, user, pin: pin({ id: "ghl_first" }), draftId: "draft-a", tappedAt: tapped, status: "not-home", disposition: "Not Home",
  }) as PendingMutation;
  const second = queueHotClaim({
    enabled: true, user, pin: pin({ id: "ghl_second" }), draftId: "draft-b", tappedAt: tapped, action: "release",
  }) as PendingMutation;
  first.queueSeq = 2;
  second.queueSeq = 1;
  let online = false;
  const sent: string[] = [];
  const removed = new Set<string>();
  const rows = [first, second];
  const read = async () => rows.filter((row) => !removed.has(row.id));
  await syncOutbox({
    read,
    send: async (row) => {
      if (!online) throw Object.assign(Error("failed to fetch"), { code: "offline" });
      sent.push(row.id);
    },
    remove: async (id) => { removed.add(id); },
    update: async () => {},
    active: () => true,
    now: () => 1_000,
    random: () => 0.5,
  });
  assert.equal(removed.size, 0);
  online = true;
  await syncOutbox({
    read,
    send: async (row) => { sent.push(row.id); },
    remove: async (id) => { removed.add(id); },
    update: async () => {},
    active: () => true,
    now: () => 2_000,
    random: () => 0.5,
  });
  assert.deepEqual(sent, ["draft-b", "draft-a"]);
  assert.deepEqual([...removed].sort(), ["draft-a", "draft-b"]);
  let path = "";
  const duplicate = await deliverFieldDispo(second, user, {
    getToken: async () => "token",
    commit: async () => { throw Error("direct"); },
    post: async (url) => {
      path = url;
      return json(200, { ok: true, draftId: second.id, result: "unchanged", duplicate: true, claimedBy: null });
    },
  });
  assert.equal(path, HOT_CLAIM_PATH);
  assert.equal(duplicate.replayed, true);
  const owned = await deliverFieldDispo(second, user, {
    getToken: async () => "token",
    commit: async () => { throw Error("direct"); },
    post: async () => json(409, { ok: false, error: "conflict", reasonCode: "owned_by_other", claimedByName: "Someone Else" }),
  }).catch((error: Error) => error);
  assert.match((owned as Error).message, /someone else/i);
  assert.match((owned as Error).message, /Someone Else/);
  assert.equal(HOT_LEAD_OWNED_MESSAGE.includes("someone else"), true);
});

test("a hot pin stays hot after a dispo and is still absent for a setter", async () => {
  resetHotLeadStore();
  const hot = pin({ hotStatus: "active" });
  const worked = hotLeadAfterDispo(hot, "not-home", "Not Home");
  const converted = hotLeadAfterDispo(hot, "appointment", "Appointment Set");
  const sold = hotLeadAfterDispo(hot, "sale", "Sale!");
  assert.equal(worked.hotStatus, "worked");
  assert.equal(converted.hotStatus, "converted");
  assert.equal(sold.hotStatus, "converted");
  assert.equal(isHotLead(toHotDisplayLead(worked)), true);
  assert.equal(isHotLead(toHotDisplayLead(converted)), true);
  assert.equal(canSeeHotLeads(person("setter")), false);
  resetHotLeadFetchForTests();
  let calls = 0;
  const fetcher: HotFetcher = async () => { calls += 1; return json(200, { hotLeads: [worked], nextCursor: null, capabilities: { dispo: true, claim: true } }); };
  const hidden = await fetchHotLeadMap({ user: person("setter"), view: view(), token: "tok", fetcher, enabled: true });
  assert.deepEqual(hidden.pins, []);
  assert.equal(calls, 0);
  const seen = await fetchHotLeadMap({ user: person("closer"), view: view(), token: "tok", fetcher, enabled: true });
  assert.equal(isHotLead(toHotDisplayLead(seen.pins[0])), true);
  assert.equal(isHotLeadDraft({ collection: "hotLeads", kind: "knock" }), true);
});

test("doNotCall hides the call control, warns, and still allows a knock", () => {
  const flagged = pin({ doNotCall: true });
  const open = pin();
  assert.equal(hotLeadCallAllowed(flagged), false);
  assert.equal(hotLeadCallAllowed(open), true);
  assert.equal(hotLeadCallAllowed(null), true);
  assert.equal(DO_NOT_CALL_WARNING, "Do not call");
  const parsed = parseHotLeadPin({ ...flagged, doNotCall: true });
  assert.equal(parsed?.doNotCall, true);
  assert.equal(parseHotLeadPin({ ...open, doNotCall: false } as unknown)?.doNotCall, undefined);
  assert.equal(parseHotLeadPin(open)?.doNotCall, undefined);
  const knocked = queueHotKnock({
    enabled: true,
    user: person("closer"),
    pin: flagged,
    draftId: "draft-dnc",
    tappedAt: tapped,
    status: "not-home",
    disposition: "Not Home",
  });
  assert.equal(knocked?.kind, "knock");
  assert.equal(knocked?.collection, "hotLeads");
  assert.equal(knocked?.leadId, flagged.id);
  const after = hotLeadAfterDispo(flagged, "not-home", "Not Home");
  assert.equal(after.doNotCall, true);
  assert.equal(after.hotStatus, "worked");
  assert.equal(isHotLead(toHotDisplayLead(after)), true);
  const detail = readFileSync(new URL("../../app/hotLeads/HotLeadDetail.tsx", import.meta.url), "utf8");
  assert.match(detail, /DO_NOT_CALL_WARNING/);
  assert.match(detail, /hotLeadCallAllowed/);
  assert.match(detail, /role="alert"/);
  assert.match(detail, /tel:/);
  assert.match(detail, /!noCall \? <a href=\{`tel:/);
});

test("the map filter copy and the hot hook stay out of the lead sign-in path", () => {
  const page = readFileSync(new URL("../../app/mobile/knocking/page.tsx", import.meta.url), "utf8");
  const detail = readFileSync(new URL("../../app/hotLeads/HotLeadDetail.tsx", import.meta.url), "utf8");
  assert.equal(HOT_LEAD_LEGEND, "Hot lead (purchased inbound)");
  assert.equal(page.includes("HOT_LEAD_LEGEND"), true);
  assert.match(page, /setHotFilter\('all'\)/);
  assert.match(page, /hotLeadFilterVisible/);
  assert.doesNotMatch(detail, /Send Info to Scheduling Manager/);
  assert.doesNotMatch(detail, /photoUrl/);
  assert.doesNotMatch(detail, /sendInfo/i);
  assert.match(detail, /tel:/);
  assert.match(detail, /mailto:/);
});
