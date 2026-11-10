import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Lead, User, UserRole } from "../../app/types";
import { DEFAULT_DISPOSITIONS } from "../../app/types/disposition";
import { HOT_LEAD_ROLE_SETS, canSeeHotLeads, isDemoAccount } from "../../app/hotLeads/access";
import { HOT_DISPO_BLOCK_COPY } from "../../app/hotLeads/copy";
import { hotLeadDetailState } from "../../app/hotLeads/detailState";
import {
  clearHotLeadBackoff,
  fetchHotLeadMap,
  HOT_PINS_UNAVAILABLE,
  HOT_SILENT_BACKOFF_MS,
  HOT_TRANSIENT_BACKOFF_MS,
  resetHotLeadFetchForTests,
  type HotFetcher,
} from "../../app/hotLeads/fetch";
import {
  applyHotFilter,
  hotFilterStorageKey,
  hotLeadFilterVisible,
  hotLeadZoomBanner,
  readHotFilter,
  writeHotFilter,
} from "../../app/hotLeads/filter";
import { HOT_LEADS_ENABLED } from "../../app/hotLeads/flag";
import { HotLeadDetail } from "../../app/hotLeads/HotLeadDetail";
import {
  DISPO_BLOCKS,
  hotLeadCallAllowed,
  isHotLead,
  mergeHotLeads,
  publishHotCapabilities,
  resetHotLeadStore,
  suppressLeadCall,
  type HotLeadPin,
} from "../../app/hotLeads/model";
import { MOBILE_BUILD_LABEL } from "../../app/mobile/_lib/startupDiagnostics";
import { MobileDataContext } from "../../app/mobile/_components/MobileDataProvider";
import { fieldPinArtwork, HOT_RING_COLOR, withLegacyHotPin } from "../../app/utils/fieldPin";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function read(relative: string): string {
  return readFileSync(path.join(root, relative), "utf8");
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

function pin(extra: Partial<HotLeadPin> = {}): HotLeadPin {
  return {
    id: "ghl_opp_example_1",
    lat: 43.161,
    lng: -77.611,
    address: "200 Example Ave",
    city: "Rochester",
    state: "NY",
    zip: "14607",
    contacts: [{ name: "Alex Example", phone: "555-0199" }],
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

function house(extra: Partial<Lead> = {}): Lead {
  return {
    id: "house-1",
    name: "Alex Example",
    address: "200 Example Ave",
    city: "Rochester",
    state: "NY",
    zip: "14607",
    status: "assigned",
    createdAt: new Date("2026-10-30T15:04:00.000Z"),
    lat: 43.161,
    lng: -77.611,
    ...extra,
  } as Lead;
}

function svg(url: string) {
  return decodeURIComponent(url.slice("data:image/svg+xml,".length));
}

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

function view(zoom = 17) {
  return { south: 43.15, north: 43.17, west: -77.63, east: -77.6, zoom };
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function renderDetail(row: HotLeadPin): string {
  publishHotCapabilities({ dispo: true, claim: true });
  return renderToStaticMarkup(createElement(
    MobileDataContext.Provider,
    { value: { field: { enqueue: async () => {}, drafts: [], discard: async () => {} } } as never },
    createElement(HotLeadDetail, { pin: row, user: person("closer"), dispositions: DEFAULT_DISPOSITIONS }),
  ));
}

test("every 3PL pin uses the gold outline and a dashed ring means view only", () => {
  assert.equal(HOT_RING_COLOR, "#B8860B");
  assert.notEqual(HOT_RING_COLOR.toLowerCase(), "#f4c84a");
  assert.ok(contrast(HOT_RING_COLOR, "#ffffff") >= 3);
  const fieldPin = read("app/utils/fieldPin.ts");
  assert.equal(fieldPin.includes("#E8590C"), false);
  assert.equal(fieldPin.includes("#334155"), false);
  assert.equal(fieldPin.includes("HOT_VIEW_ONLY_RING"), false);
  assert.match(fieldPin, /warm \? 20 : 0/);
  const open = fieldPinArtwork({ ...house(), hotLead: true, hotPin: pin() }, undefined, 18, false, true);
  const locked = fieldPinArtwork(
    { ...house(), hotLead: true, hotPin: pin({ canDispo: false, dispoBlock: "outside_territory" }) },
    undefined,
    18,
    false,
    true,
  );
  const selected = fieldPinArtwork({ ...house(), hotLead: true, hotPin: pin() }, undefined, 16, true, true);
  assert.match(svg(open.url), new RegExp(`stroke="${HOT_RING_COLOR}"`));
  assert.equal(svg(open.url).includes("stroke-dasharray"), false);
  assert.equal(svg(open.url).includes("data-hot-view-only"), false);
  assert.match(svg(locked.url), new RegExp(`stroke="${HOT_RING_COLOR}"`));
  assert.match(svg(locked.url), /stroke-dasharray/);
  assert.match(svg(locked.url), /data-hot-view-only="true"/);
  assert.match(svg(selected.url), /#F4C84A/);
  assert.match(svg(selected.url), new RegExp(HOT_RING_COLOR));
  const legacy = withLegacyHotPin("<div>pin</div>", true);
  assert.match(legacy, /data-hot-view-only="true"/);
  assert.match(legacy, new RegExp(HOT_RING_COLOR));
  assert.match(legacy, /dashed/);
  const section = read("app/hotLeads/HotLeadFilterSection.tsx");
  assert.match(section, /3PL lead — view only|HOT_VIEW_ONLY_LEGEND/);
  assert.match(section, /dashed \$\{HOT_RING_COLOR\}/);
  const warm = svg(fieldPinArtwork(
    { ...house({ solarCategory: "great", tags: ["solar-data"] }), hotLead: true, hotPin: pin() },
    undefined,
    18,
    false,
    true,
  ).url);
  assert.match(warm, /data-hot-lead="true" transform="translate\(20 0\)"/);
});

test("a 3PL doNotCall flag does not hide Call or transfer onto a merged house", () => {
  const flagged = pin({ doNotCall: true });
  assert.equal(hotLeadCallAllowed(flagged), true);
  assert.equal(hotLeadCallAllowed(null), true);
  const detail = read("app/hotLeads/HotLeadDetail.tsx");
  assert.doesNotMatch(detail, /DO_NOT_CALL_WARNING/);
  assert.doesNotMatch(detail, /Do not call/);
  const houseLead = house({ phone: "555-0101", address: "100 Example Ave", lat: 43.16, lng: -77.61 });
  const merged = mergeHotLeads([houseLead], [pin({
    id: "ghl_house_a",
    linkedLeadId: "house-1",
    doNotCall: true,
    address: "100 Example Ave",
    lat: 43.16,
    lng: -77.61,
  })]);
  assert.equal(merged.leads.length, 1);
  assert.equal((merged.leads[0] as { hotPin?: { doNotCall?: boolean } }).hotPin?.doNotCall, undefined);
  assert.equal(suppressLeadCall(merged.leads[0]), false);
  const ordinary = fieldPinArtwork(house({ status: "do-not-contact" }), undefined, 18, false, false);
  assert.equal(svg(ordinary.url).includes(HOT_RING_COLOR), false);
  assert.match(read("app/utils/fieldPin.ts"), /do-not-contact/);
  assert.match(read("app/field/analysis.ts"), /donotcontact/);
});

test("3PL visibility follows role sets A and B and stays hidden when the flag is off", () => {
  for (const variant of ["A", "B"] as const) {
    const roles = HOT_LEAD_ROLE_SETS[variant];
    assert.equal(canSeeHotLeads(person("closer"), roles), true, variant);
    assert.equal(canSeeHotLeads(person("manager"), roles), true, variant);
    assert.equal(canSeeHotLeads(person("admin"), roles), true, variant);
    assert.equal(canSeeHotLeads(person("setter"), roles), roles.includes("setter"), variant);
    assert.equal(canSeeHotLeads(person("closer", { isActive: false }), roles), false);
    assert.equal(canSeeHotLeads(person("closer", { approved: false }), roles), false);
    assert.equal(canSeeHotLeads(person("closer", { approvalStatus: "pending" }), roles), false);
    assert.equal(canSeeHotLeads(person("admin", { isTestAccount: true }), roles), false);
    assert.equal(canSeeHotLeads(person("closer", { email: "demo@example.com" }), roles), false);
    assert.equal(isDemoAccount(person("closer", { demo: true })), true);
    assert.equal(hotLeadFilterVisible(person("closer"), false, roles), false);
  }
  assert.equal(canSeeHotLeads(person("setter")), false);
  assert.equal(HOT_LEADS_ENABLED, false);
});

test("the 3PL filter keeps one pin per house and does not fetch below zoom 15", async () => {
  const mem = new Map<string, string>();
  const storage = {
    getItem: (key: string) => mem.get(key) ?? null,
    setItem: (key: string, value: string) => { mem.set(key, value); },
  };
  writeHotFilter("uid-a", "only", storage);
  writeHotFilter("uid-b", "hide", storage);
  assert.equal(readHotFilter("uid-a", storage), "only");
  assert.equal(readHotFilter("uid-b", storage), "hide");
  assert.equal(hotFilterStorageKey("uid-a"), "raydar.hotFilter.v1:uid-a");
  const merged = mergeHotLeads(
    [house({ status: "not-home", address: "100 Example Ave", lat: 43.16, lng: -77.61 })],
    [pin({ id: "ghl_house_a", linkedLeadId: "house-1", address: "100 Example Ave", lat: 43.16, lng: -77.61 })],
  );
  assert.equal(merged.leads.length, 1);
  assert.equal(applyHotFilter(merged.leads, "only").length, 1);
  assert.equal(isHotLead(applyHotFilter(merged.leads, "only")[0]), true);
  assert.equal(applyHotFilter(merged.leads, "all").length, 1);
  const hidden = applyHotFilter(merged.leads, "hide");
  assert.equal(hidden.length, 1);
  assert.equal(isHotLead(hidden[0]), false);
  assert.equal(hotLeadZoomBanner("only", 14), "Zoom in to see 3PL leads.");
  resetHotLeadFetchForTests();
  let calls = 0;
  const fetcher: HotFetcher = async () => {
    calls += 1;
    return json(200, { hotLeads: [], nextCursor: null, capabilities: { dispo: true, claim: true } });
  };
  const zoomedOut = await fetchHotLeadMap({ user: person("closer"), view: view(14), token: "tok", fetcher, enabled: true });
  assert.deepEqual(zoomedOut.pins, []);
  assert.equal(calls, 0);
});

test("view-only 3PL detail copy blocks Claim, Knock and Save, and staff canDispo stays writable", () => {
  for (const block of DISPO_BLOCKS) {
    const state = hotLeadDetailState({
      pin: { canDispo: false, dispoBlock: block },
      canWrite: true,
      caps: { claim: true, dispo: true },
      userId: "rep-1",
      role: "closer",
    });
    assert.equal(state.viewOnly, true, block);
    assert.equal(state.showClaim, false, block);
    assert.equal(state.showKnocks, false, block);
    assert.equal(state.showSave, false, block);
    assert.equal(state.message, HOT_DISPO_BLOCK_COPY[block], block);
  }
  const absent = hotLeadDetailState({
    pin: {},
    canWrite: true,
    caps: { claim: true, dispo: true },
    userId: "rep-1",
    role: "closer",
  });
  assert.equal(absent.viewOnly, false);
  assert.equal(absent.showKnocks, true);
  const staff = hotLeadDetailState({
    pin: { canDispo: true },
    canWrite: true,
    caps: { claim: true, dispo: true },
    userId: "mgr",
    role: "manager",
  });
  assert.equal(staff.viewOnly, false);
  assert.equal(staff.showKnocks, true);
  resetHotLeadStore();
  const html = renderDetail(pin({ canDispo: false, dispoBlock: "outside_territory" }));
  assert.equal(html.includes(">Claim<"), false);
  assert.equal(html.includes(">Not Home<"), false);
  assert.equal(html.includes("Save 3PL lead notes"), false);
  assert.match(html, /data-hot-view-only="true"/);
  resetHotLeadStore();
});

test("401 and 503 back off for 60 seconds, 404 for 15 minutes, and retry fetches once", async () => {
  assert.equal(HOT_TRANSIENT_BACKOFF_MS, 60_000);
  assert.equal(HOT_SILENT_BACKOFF_MS, 15 * 60 * 1000);
  assert.doesNotMatch(HOT_PINS_UNAVAILABLE, /sign in/i);
  for (const status of [401, 503, 404]) {
    resetHotLeadFetchForTests();
    let calls = 0;
    const fetcher: HotFetcher = async () => {
      calls += 1;
      return json(status, { error: "unavailable" });
    };
    const failed = await fetchHotLeadMap({
      user: person("closer"), view: view(), token: "tok", fetcher, enabled: true, now: 1_000,
    });
    assert.equal(failed.unavailable, true);
    assert.equal(failed.error, "");
    assert.equal(JSON.stringify(failed).toLowerCase().includes("sign in"), false);
    assert.deepEqual(failed.pins, []);
    const windowMs = status === 404 ? HOT_SILENT_BACKOFF_MS : HOT_TRANSIENT_BACKOFF_MS;
    await fetchHotLeadMap({
      user: person("closer"), view: view(), token: "tok", fetcher, enabled: true, now: 1_000 + windowMs - 1,
    });
    assert.equal(calls, 1);
    clearHotLeadBackoff();
    const again = await fetchHotLeadMap({
      user: person("closer"), view: view(), token: "tok", fetcher, enabled: true, now: 1_000 + windowMs - 1,
    });
    assert.equal(calls, 2);
    assert.equal(again.unavailable, true);
  }
  resetHotLeadFetchForTests();
  let calls = 0;
  const fetcher: HotFetcher = async () => {
    calls += 1;
    if (calls === 1) return json(401, { error: "unavailable" });
    return json(200, { hotLeads: [pin()], nextCursor: null, capabilities: { dispo: true, claim: true } });
  };
  const failed = await fetchHotLeadMap({
    user: person("closer"), view: view(), token: "tok", fetcher, enabled: true, now: 5_000,
  });
  assert.equal(failed.unavailable, true);
  clearHotLeadBackoff();
  const ok = await fetchHotLeadMap({
    user: person("closer"), view: view(), token: "tok", fetcher, enabled: true, now: 5_001,
  });
  assert.equal(calls, 2);
  assert.equal(ok.unavailable, false);
  assert.equal(ok.pins.length, 1);
  const hook = read("app/hooks/useHotLeads.ts");
  const page = read("app/mobile/knocking/page.tsx");
  assert.match(hook, /clearHotLeadBackoff\(\)/);
  assert.match(hook, /addEventListener\("online", wake\)/);
  assert.match(hook, /visibilitychange/);
  assert.match(hook, /appStateChange/);
  assert.match(hook, /no "Sign in again"/);
  assert.doesNotMatch(hook, /useViewportLeads/);
  assert.match(page, /HOT_PINS_UNAVAILABLE/);
  assert.match(page, /hotLeads\.retry\(\)/);
  assert.doesNotMatch(HOT_PINS_UNAVAILABLE, /sign in/i);
});

test("the build label adds 3PL only when the hot-lead flag is on", () => {
  assert.equal(HOT_LEADS_ENABLED, process.env.NEXT_PUBLIC_HOT_LEADS === "1");
  assert.equal(MOBILE_BUILD_LABEL.includes(" · 3PL"), HOT_LEADS_ENABLED);
  const source = read("app/mobile/_lib/startupDiagnostics.ts");
  assert.match(source, /HOT_LEADS_ENABLED \? " · 3PL" : ""/);
  assert.match(read("app/hotLeads/flag.ts"), /NEXT_PUBLIC_HOT_LEADS === "1"/);
});

test("knock count and the save-payload fixture stay byte-identical", () => {
  const knock = createHash("sha256").update(readFileSync(path.join(root, "app/utils/knockCount.ts"))).digest("hex");
  assert.equal(knock, "a00be3335708b5b54605b08f11bd37fb9fa5ada20e3c0cb428d57b58bf1dd226");
  const fixture = createHash("sha256").update(readFileSync(path.join(root, "tests/mobile/fixtures/save-payloads-05037a3.json"))).digest("hex");
  assert.equal(fixture, "5edf564aae7aa546fc2b8a479ea4ed2c63453ebf39679c546ab050734b0aaa51");
});
