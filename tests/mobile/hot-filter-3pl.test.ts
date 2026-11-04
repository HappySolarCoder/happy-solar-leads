import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { groupHouseLeads } from "../../app/homeowners/houseIdentity";
import { HOT_LEAD_ROLE_SETS, HOT_LEAD_ROLE_VARIANT, canSeeHotLeads } from "../../app/hotLeads/access";
import { fetchHotLeadMap, resetHotLeadFetchForTests, type HotFetcher } from "../../app/hotLeads/fetch";
import {
  HOT_FILTER_BADGE,
  HOT_LEAD_LEGEND,
  HOT_LEAD_MIN_ZOOM,
  HOT_LEAD_ZOOM_BANNER,
  applyHotFilter,
  hotFilterStorageKey,
  hotLeadFilterVisible,
  hotLeadZoomBanner,
  readHotFilter,
  writeHotFilter,
} from "../../app/hotLeads/filter";
import { HOT_LEADS_ENABLED } from "../../app/hotLeads/flag";
import {
  DO_NOT_CALL_WARNING,
  hotLeadCallAllowed,
  isHotLead,
  mergeHotLeads,
  type HotLeadPin,
} from "../../app/hotLeads/model";
import type { Lead, User, UserRole } from "../../app/types";
import { captureSavePayloads } from "./helpers/savePayloadContract";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");

function read(relative: string): string {
  return readFileSync(path.join(root, relative), "utf8");
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

function lead(id = "lead-1", extra: Partial<Lead> = {}): Lead {
  return {
    id,
    name: "Pat Example",
    address: "100 Example Ave",
    city: "Rochester",
    state: "NY",
    zip: "14607",
    status: "not-home",
    createdAt: new Date("2026-10-30T15:04:00.000Z"),
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
    address: "100 Example Ave",
    city: "Rochester",
    state: "NY",
    zip: "14607",
    contacts: [{ name: "Alex Example", phone: "555-0100" }],
    hotStatus: "active",
    claimedBy: null,
    claimedByName: null,
    claimedAt: null,
    status: "not-home",
    disposition: "Not Home",
    dispositionedAt: null,
    linkedLeadId: "older-visit",
    homeownerId: null,
    ...extra,
  };
}

function view(zoom = 17) {
  return { south: 43.15, north: 43.17, west: -77.63, east: -77.6, zoom };
}

test("the shipped role variant is A and both variants are proven by injecting the set", async () => {
  assert.equal(HOT_LEAD_ROLE_VARIANT, "A");
  assert.equal(HOT_LEADS_ENABLED, false);
  const calls: string[] = [];
  const fetcher: HotFetcher = async (url) => {
    calls.push(url);
    return new Response(JSON.stringify({ hotLeads: [pin({ linkedLeadId: null, id: "ghl_page_1" })], nextCursor: null, capabilities: { dispo: true, claim: true } }), { status: 200 });
  };
  for (const variant of ["A", "B"] as const) {
    const roles = HOT_LEAD_ROLE_SETS[variant];
    for (const role of ["setter", "closer", "manager", "admin"] as const) {
      const allowed = (roles as readonly string[]).includes(role);
      assert.equal(canSeeHotLeads(person(role), roles), allowed, `${variant} ${role}`);
      assert.equal(hotLeadFilterVisible(person(role), true, roles), allowed, `${variant} filter ${role}`);
      assert.equal(hotLeadFilterVisible(person(role), false, roles), false, `${variant} flag ${role}`);
      resetHotLeadFetchForTests();
      calls.length = 0;
      const result = await fetchHotLeadMap({
        user: person(role),
        view: view(),
        token: "tok",
        fetcher,
        enabled: true,
        roles,
      });
      assert.equal(result.pins.length, allowed ? 1 : 0, `${variant} fetch ${role}`);
      assert.equal(calls.length, allowed ? 1 : 0, `${variant} requests ${role}`);
    }
  }
  resetHotLeadFetchForTests();
  calls.length = 0;
  const off = await fetchHotLeadMap({ user: person("closer"), view: view(), token: "tok", fetcher, enabled: false });
  assert.equal(off.pins.length, 0);
  assert.equal(calls.length, 0);
});

test("hot-lead role lists live only in the variant constant", () => {
  const roleList = /\[\s*['"](?:setter|closer|manager|admin)['"](?:\s*,\s*['"](?:setter|closer|manager|admin)['"])+\s*\]/;
  const roots = [path.join(root, "app/hotLeads")];
  const server = path.join(root, "app/utils/server");
  if (existsSync(server)) {
    for (const name of readdirSync(server)) {
      if (name.startsWith("hotLead")) roots.push(path.join(server, name));
    }
  }
  const files: string[] = [];
  const walk = (target: string) => {
    if (!existsSync(target)) return;
    for (const name of readdirSync(target, { withFileTypes: true })) {
      const full = path.join(target, name.name);
      if (name.isDirectory()) walk(full);
      else if (/\.(ts|tsx|mjs|js)$/.test(name.name)) files.push(full);
    }
  };
  for (const target of roots) walk(target);
  assert.ok(files.some((file) => file.endsWith(`${path.sep}access.ts`)));
  for (const file of files) {
    let text = readFileSync(file, "utf8");
    if (file.endsWith(`${path.sep}access.ts`)) {
      text = text.replace(/export const HOT_LEAD_ROLE_SETS = \{[\s\S]*?\} as const;/, "");
    }
    assert.equal(roleList.test(text), false, file);
  }
});

test("user-facing copy says 3PL lead", () => {
  assert.equal(HOT_LEAD_LEGEND, "3PL lead");
  assert.equal(HOT_LEAD_ZOOM_BANNER, "Zoom in to see 3PL leads.");
  assert.equal(HOT_FILTER_BADGE, "3PL");
  assert.equal(DO_NOT_CALL_WARNING, "Do not call");
  const files = [
    "app/hotLeads/HotLeadDetail.tsx",
    "app/hotLeads/HotLeadFilterSection.tsx",
    "app/hotLeads/filter.ts",
    "app/hotLeads/model.ts",
    "app/hotLeads/save.ts",
    "app/components/LeadMap.tsx",
    "app/components/LeadDetail.tsx",
    "app/mobile/knocking/page.tsx",
    "app/field/serverDispo.ts",
  ];
  for (const file of files) {
    assert.equal(/hot lead/i.test(read(file)), false, file);
  }
  const detail = read("app/hotLeads/HotLeadDetail.tsx");
  assert.match(detail, /aria-label="3PL lead notes"/);
  assert.match(detail, />3PL lead</);
  assert.match(detail, /Save 3PL lead notes/);
  assert.match(detail, /Close 3PL lead/);
  assert.match(read("app/field/serverDispo.ts"), /This 3PL lead could not be saved\./);
  const section = read("app/hotLeads/HotLeadFilterSection.tsx");
  assert.match(section, /<legend>3PL leads<\/legend>/);
  const all = section.indexOf("All pins");
  const only = section.indexOf("3PL only");
  const hide = section.indexOf("Hide 3PL");
  assert.ok(all > 0 && all < only && only < hide);
});

test("the 3PL section sits in the mobile Filters sheet and the web filter panel", () => {
  const page = read("app/mobile/knocking/page.tsx");
  const sheet = page.slice(page.indexOf('title="Map filters"'), page.indexOf("Show map"));
  assert.match(sheet, /showHotFilter && <HotLeadFilterSection/);
  assert.doesNotMatch(sheet, /Hot leads only|Hide hot leads|<legend>Hot leads<\/legend>/);
  const menu = read("app/components/AppMenu.tsx");
  assert.ok(menu.indexOf("Filter by Disposition") < menu.indexOf("<HotLeadFilterSection"));
  assert.match(menu, /HOT_FILTER_BADGE/);
  assert.match(read("app/page.tsx"), /hotFilter=\{showHotFilter \? hotFilter : 'all'\}/);
  assert.match(read("app/page.tsx"), /onHotFilterChange=\{setHotFilter\}/);
  const toolbar = read("app/mobile/_components/MobileShell.tsx");
  assert.match(toolbar, /filterBadge/);
  assert.match(page, /filterBadge=\{showHotFilter && hotFilter !== 'all' \? HOT_FILTER_BADGE : undefined\}/);
});

test("the 3PL choice is saved per user and composes after status and one pin per house", () => {
  assert.equal(hotFilterStorageKey("uid-a"), "raydar.hotFilter.v1:uid-a");
  const mem = new Map<string, string>();
  const storage = {
    getItem: (key: string) => mem.get(key) ?? null,
    setItem: (key: string, value: string) => { mem.set(key, value); },
  };
  assert.equal(readHotFilter("uid-a", storage), "all");
  writeHotFilter("uid-a", "only", storage);
  writeHotFilter("uid-b", "hide", storage);
  assert.equal(readHotFilter("uid-a", storage), "only");
  assert.equal(readHotFilter("uid-b", storage), "hide");
  assert.equal(readHotFilter("uid-c", storage), "all");
  writeHotFilter("uid-a", "nope" as "all", storage);
  mem.set(hotFilterStorageKey("uid-a"), "nope");
  assert.equal(readHotFilter("uid-a", storage), "all");

  const house = lead("house-1", { status: "not-home", address: "100 Example Ave", city: "Rochester", state: "NY" });
  const older = lead("older-visit", { status: "not-home", address: "100 Example Ave", city: "Rochester", state: "NY", lat: 43.1601, lng: -77.6101 });
  const other = lead("other-house", { status: "appointment", address: "9 Other St", city: "Rochester", state: "NY", lat: 43.2, lng: -77.7 });
  const statusFiltered = [house, older, other].filter((row) => row.status === "not-home");
  const grouped = groupHouseLeads(statusFiltered);
  assert.equal(grouped.pins.length, 1);
  const winners = new Map<string, string>();
  for (const [id, group] of grouped.byLead) if (group[0]) winners.set(id, group[0].id);
  const merged = mergeHotLeads(grouped.pins, [pin({ doNotCall: true })], winners);
  assert.equal(merged.leads.length, 1);
  const only = applyHotFilter(merged.leads, "only");
  assert.equal(only.length, 1);
  assert.equal(isHotLead(only[0]), true);
  const hidden = applyHotFilter(merged.leads, "hide");
  assert.equal(hidden.length, 1);
  assert.equal(hidden[0].id, only[0].id);
  assert.equal(isHotLead(hidden[0]), false);
  const map = read("app/components/LeadMap.tsx");
  const memo = map.slice(map.indexOf("const leads = useMemo"), map.indexOf("const viewportIndex"));
  assert.ok(memo.indexOf("houseIndex.grouped") < memo.indexOf("applyHotFilter"));
});

test("zoom below 15 with 3PL only shows the banner and does not fetch", async () => {
  assert.equal(HOT_LEAD_MIN_ZOOM, 15);
  assert.equal(hotLeadZoomBanner("only", 14), "Zoom in to see 3PL leads.");
  assert.equal(hotLeadZoomBanner("only", 14.9), "Zoom in to see 3PL leads.");
  assert.equal(hotLeadZoomBanner("only", 15), null);
  assert.equal(hotLeadZoomBanner("all", 10), null);
  assert.equal(hotLeadZoomBanner("hide", 10), null);
  resetHotLeadFetchForTests();
  let calls = 0;
  const fetcher: HotFetcher = async () => {
    calls += 1;
    return new Response("{}", { status: 200 });
  };
  const zoomedOut = await fetchHotLeadMap({
    user: person("closer"),
    view: view(14),
    token: "tok",
    fetcher,
    enabled: true,
  });
  assert.deepEqual(zoomedOut.pins, []);
  assert.equal(calls, 0);
  const fetchSource = read("app/hotLeads/fetch.ts");
  assert.match(fetchSource, /zoom < 15/);
  assert.equal(fetchSource.includes("mode=all"), false);
  assert.equal(fetchSource.includes("mode: \"all\""), false);
  const map = read("app/components/LeadMap.tsx");
  assert.match(map, /hotLeadZoomBanner/);
  assert.match(map, /hotZoomNotice/);
  assert.match(map, /filter === 'only' && hotLeadZoomBanner/);
});

test("a do-not-call 3PL pin hides Call, shows the chip, and still allows a knock", () => {
  const flagged = pin({ doNotCall: true });
  assert.equal(hotLeadCallAllowed(flagged), false);
  const detail = read("app/hotLeads/HotLeadDetail.tsx");
  assert.match(detail, /role="alert"/);
  assert.match(detail, /DO_NOT_CALL_WARNING/);
  assert.match(detail, /!noCall \? <a href=\{`tel:/);
  assert.match(detail, /stageHotKnock/);
  assert.doesNotMatch(detail, /noCall \? null : [\s\S]{0,80}knock\(/);
  const leadDetail = read("app/components/LeadDetail.tsx");
  assert.match(leadDetail, /suppressLeadCall\(lead\)/);
  assert.match(leadDetail, /DO_NOT_CALL_WARNING/);
  assert.match(leadDetail, /tel:\$\{lead\.phone\}/);
});

test("this line does not add knockCount.ts", () => {
  assert.equal(existsSync(path.join(root, "app/utils/knockCount.ts")), false);
});

test("save payloads on the direct and route paths match 05037a3", async () => {
  const golden = JSON.parse(read("tests/mobile/fixtures/save-payloads-05037a3.json")) as Record<string, {
    leads?: { direct: { updates: string[] }; route: { posts: { path: string; body: string }[] } };
    hot?: { direct: { updates: string[] }; route: { posts: { path: string; body: string }[] } };
  }>;
  const actual = await captureSavePayloads() as typeof golden;
  for (const kind of ["knock", "dispo", "notes", "contact", "claim", "release", "go-back", "objection"]) {
    assert.ok(golden[kind], kind);
    assert.deepEqual(actual[kind], golden[kind], kind);
  }
  assert.equal(JSON.stringify(actual), JSON.stringify(golden));
});
