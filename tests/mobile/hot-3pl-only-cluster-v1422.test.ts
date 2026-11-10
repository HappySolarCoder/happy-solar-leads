import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HOT_LEAD_ROLE_SETS, HOT_LEAD_ROLE_VARIANT, canSeeHotLeads } from "../../app/hotLeads/access";
import { HOT_SILENT_BACKOFF_MS, HOT_TRANSIENT_BACKOFF_MS } from "../../app/hotLeads/fetch";
import {
  HOT_LEAD_MIN_ZOOM,
  HOT_LEAD_ZOOM_BANNER,
  applyHotFilter,
  hotLeadZoomBanner,
  hotOnlyLayers,
  type HotPinFilter,
} from "../../app/hotLeads/filter";
import { isHotLead, mergeHotLeads, type HotLeadPin } from "../../app/hotLeads/model";
import {
  HOT_OVERVIEW_MAX_POINTS,
  HOT_OVERVIEW_STALE_MS,
  HOT_OVERVIEW_TTL_MS,
  HOT_OVERVIEW_URL,
  fetchHotOverview,
  hotOverviewClusterLabel,
  parseHotOverview,
  resetHotOverviewForTests,
  type HotOverviewFetcher,
} from "../../app/hotLeads/overview";
import type { Lead, User, UserRole } from "../../app/types";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const KNOCK_COUNT_SHA = "a00be3335708b5b54605b08f11bd37fb9fa5ada20e3c0cb428d57b58bf1dd226";

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

function lead(id: string, extra: Partial<Lead> = {}): Lead {
  return {
    id,
    name: "Pat Example",
    address: `${id} Example Ave`,
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
    linkedLeadId: null,
    homeownerId: null,
    ...extra,
  };
}

function shape(rows: readonly Lead[]) {
  return rows.map((row) => {
    const hot = row as Lead & { hotLead?: boolean; hotOnly?: boolean; hotLeadId?: string };
    return {
      id: row.id,
      hotLead: hot.hotLead === true,
      hotOnly: hot.hotOnly === true,
      hotLeadId: hot.hotLeadId ?? null,
    };
  });
}

function point(id: string, extra: Record<string, unknown> = {}) {
  return { id, lat: 40.7, lng: -74, hotStatus: "active", ...extra };
}

function okResponse(rows: unknown[]): Response {
  return new Response(JSON.stringify({ ok: true, points: rows, truncated: false, generatedAt: "2026-11-10T00:00:00.000Z" }), {
    status: 200,
  });
}

test("T1 hotOnlyLayers is null except 3PL only for a rep who can see the filter", () => {
  for (const filter of ["all", "hide"] as const) {
    assert.equal(hotOnlyLayers(filter, true), null, filter);
    assert.equal(hotOnlyLayers(filter, false), null, filter);
  }
  assert.equal(hotOnlyLayers("only", false), null);
  assert.deepEqual(hotOnlyLayers("only", true), {
    homeowners: false,
    heat: false,
    teamMembers: false,
    otherTerritories: false,
  });
});

test("T2 3PL only hides homeowner dots, heat and other team layers without writing preferences", () => {
  const page = read("app/mobile/knocking/page.tsx");
  assert.match(page, /const only = hotOnlyLayers\(hotFilter, showHotFilter\)/);
  assert.match(page, /showHomeowners=\{areasReady && showHomeowners && !outcomesOnly && dispositionFilter\.length === 0 && leadTypeFilter !== "customers" && knockPeriod === 'all' && !freshPinsOnly && setterFilter === "all" && !only\}/);
  assert.match(page, /heatCells=\{only \? \[\] : heatCells\}/);
  assert.match(page, /teamMembers=\{only \? \[\] : teamMembersForMap\}/);
  assert.match(page, /territories=\{only \? \(showTeamAreas \? ownTerritories : \[\]\) : \(showTeamAreas \? teamAreaTerritories : \[\]\)\}/);
  assert.match(page, /colorTerritories\(overlayTerritories\.filter\(t=>t\.userId===currentUser\?\.id\), coloredUsers\)/);
  assert.match(page, /disabled=\{!!only\}/);
  assert.match(page, /if \(only\) return; setHomePreference/);
  assert.match(page, /Hidden while 3PL only is on\./);
  assert.doesNotMatch(page, /if \(only\) setHomePreference/);
  assert.doesNotMatch(page, /if \(only\) setAreaMode/);
  const helper = read("app/hotLeads/filter.ts");
  const fn = helper.slice(helper.indexOf("export function hotOnlyLayers"), helper.indexOf("export function hotLeadZoomBanner"));
  assert.doesNotMatch(fn, /setHomePreference|setAreaMode|localStorage/);
  const coach = page.slice(page.indexOf("<DoorCoach"), page.indexOf("hotLeads.unavailable"));
  assert.match(coach, /<DoorCoach /);
  assert.match(coach, /<ReturnVisitReminder /);
  assert.doesNotMatch(coach, /\bonly\b/);
});

test("T3 3PL only keeps linked and unlinked 3PL rows and leaves all and hide unchanged", () => {
  const ordinary = [1, 2, 3, 4, 5].map((n) => lead(`ord-${n}`, {
    address: `${100 + n} Separate Ave`,
    city: `City${n}`,
    lat: 40 + n * 0.5,
    lng: -75 - n * 0.5,
  }));
  const linkedA = pin({
    id: "ghl_linked_a",
    linkedLeadId: "ord-1",
    address: "101 Separate Ave",
    city: "City1",
    lat: 40.5,
    lng: -75.5,
  });
  const linkedB = pin({
    id: "ghl_linked_b",
    linkedLeadId: "ord-2",
    address: "102 Separate Ave",
    city: "City2",
    lat: 41,
    lng: -76,
  });
  const unlinked = pin({
    id: "ghl_unlinked_1",
    linkedLeadId: null,
    address: "9 Free St",
    city: "Elsewhere",
    state: "NJ",
    lat: 33,
    lng: -90,
  });
  const merged = mergeHotLeads(ordinary, [linkedA, linkedB, unlinked]);
  const only = applyHotFilter(merged.leads, "only");
  assert.equal(only.length, 3);
  assert.deepEqual(only.map((row) => row.id), ["ord-1", "ord-2", "ghl_unlinked_1"]);
  assert.ok(only.every((row) => isHotLead(row)));
  assert.deepEqual(applyHotFilter(mergeHotLeads(ordinary, []).leads, "only"), []);

  const allFixture = [
    { id: "ord-1", hotLead: true, hotOnly: false, hotLeadId: "ghl_linked_a" },
    { id: "ord-2", hotLead: true, hotOnly: false, hotLeadId: "ghl_linked_b" },
    { id: "ord-3", hotLead: false, hotOnly: false, hotLeadId: null },
    { id: "ord-4", hotLead: false, hotOnly: false, hotLeadId: null },
    { id: "ord-5", hotLead: false, hotOnly: false, hotLeadId: null },
    { id: "ghl_unlinked_1", hotLead: true, hotOnly: true, hotLeadId: "ghl_unlinked_1" },
  ];
  const hideFixture = [
    { id: "ord-1", hotLead: false, hotOnly: false, hotLeadId: null },
    { id: "ord-2", hotLead: false, hotOnly: false, hotLeadId: null },
    { id: "ord-3", hotLead: false, hotOnly: false, hotLeadId: null },
    { id: "ord-4", hotLead: false, hotOnly: false, hotLeadId: null },
    { id: "ord-5", hotLead: false, hotOnly: false, hotLeadId: null },
  ];
  assert.deepEqual(shape(applyHotFilter(merged.leads, "all")), allFixture);
  assert.deepEqual(shape(applyHotFilter(merged.leads, "hide")), hideFixture);
  assert.deepEqual(shape(applyHotFilter(merged.leads, "all" satisfies HotPinFilter)), allFixture);
});

test("T4 homeowner reads and the homeowner status follow showHomeowners", () => {
  const map = read("app/components/LeadMap.tsx");
  assert.match(map, /useHomeowners\(homeownerMap, currentUser, showHomeowners && !homeownerFixture, pinPolygons\)/);
  assert.match(map, /\{showHomeowners && <HomeownerStatus/);
});

test("T5 parseHotOverview keeps valid points and drops everything else", () => {
  const valid = parseHotOverview({
    points: [{
      id: "ghl_ok_1",
      lat: 40.7,
      lng: -74,
      hotStatus: "worked",
      address: "secret street",
      contacts: [{ phone: "555-0100" }],
      notes: "private note",
    }],
    ok: true,
  });
  assert.deepEqual(valid, [{ id: "ghl_ok_1", lat: 40.7, lng: -74, hotStatus: "worked" }]);
  assert.equal("address" in valid[0], false);
  assert.equal("contacts" in valid[0], false);
  assert.equal("notes" in valid[0], false);

  const mixed = parseHotOverview({
    points: [
      point("ghl_keep"),
      point("not-an-id"),
      point("ghl_nan", { lat: Number.NaN }),
      point("ghl_inf", { lng: Number.POSITIVE_INFINITY }),
      point("ghl_lat", { lat: 91 }),
      point("ghl_lng", { lng: -181 }),
      point("ghl_keep"),
      { id: "ghl_status", lat: 1, lng: 2, hotStatus: "nope", address: "hidden" },
      null,
      "row",
    ],
  });
  assert.deepEqual(mixed, [
    { id: "ghl_keep", lat: 40.7, lng: -74, hotStatus: "active" },
    { id: "ghl_status", lat: 1, lng: 2 },
  ]);

  assert.deepEqual(parseHotOverview(null), []);
  assert.deepEqual(parseHotOverview("points"), []);
  assert.deepEqual(parseHotOverview([]), []);
  assert.deepEqual(parseHotOverview({ points: "no" }), []);
  assert.deepEqual(parseHotOverview({ hotLeads: [point("ghl_ignored")] }), []);
  const evil: { points?: unknown } = {};
  Object.defineProperty(evil, "points", { get() { throw new Error("boom"); } });
  assert.deepEqual(parseHotOverview(evil), []);

  const many = Array.from({ length: 5000 }, (_, index) => point(`ghl_row_${index}`, { lat: index / 100 - 20 }));
  const capped = parseHotOverview({ points: many });
  assert.equal(capped.length, HOT_OVERVIEW_MAX_POINTS);
  assert.equal(capped[0]?.id, "ghl_row_0");
  assert.equal(capped[1999]?.id, "ghl_row_1999");
  assert.equal(capped.some((row) => row.id === "ghl_row_2000"), false);
});

test("T6 fetchHotOverview skips the wrong accounts and reuses a fresh cache", async () => {
  const calls: string[] = [];
  const fetcher: HotOverviewFetcher = async (url) => {
    calls.push(url);
    return okResponse([point("ghl_one")]);
  };
  const blocked: Array<{ label: string; user: User | null; token: string; enabled: boolean; extra?: Record<string, unknown> }> = [
    { label: "setter", user: person("setter"), token: "tok", enabled: true },
    { label: "signed-out", user: null, token: "tok", enabled: true },
    { label: "flag-off", user: person("closer"), token: "tok", enabled: false },
    { label: "test", user: person("closer", { team: "TEST" }), token: "tok", enabled: true },
    { label: "demo", user: person("manager", { demo: true }), token: "tok", enabled: true },
    { label: "no-token", user: person("admin"), token: "", enabled: true },
  ];
  for (const row of blocked) {
    resetHotOverviewForTests();
    calls.length = 0;
    const result = await fetchHotOverview({
      user: row.user,
      token: row.token,
      fetcher,
      enabled: row.enabled,
      now: 10_000,
    });
    assert.equal(calls.length, 0, row.label);
    assert.deepEqual(result.points, [], row.label);
    assert.equal(result.unavailable, false, row.label);
  }

  for (const role of ["closer", "manager", "admin"] as const) {
    resetHotOverviewForTests();
    calls.length = 0;
    const user = person(role, { id: `rep-${role}` });
    const first = await fetchHotOverview({ user, token: "tok", fetcher, enabled: true, now: 20_000 });
    assert.equal(calls.length, 1, role);
    assert.equal(calls[0], HOT_OVERVIEW_URL, role);
    assert.equal(first.fromCache, false, role);
    assert.deepEqual(first.points, [{ id: "ghl_one", lat: 40.7, lng: -74, hotStatus: "active" }]);
    const second = await fetchHotOverview({ user, token: "tok", fetcher, enabled: true, now: 20_000 + HOT_OVERVIEW_TTL_MS - 1 });
    assert.equal(calls.length, 1, `${role} memory`);
    assert.equal(second.fromCache, true);
  }

  resetHotOverviewForTests();
  calls.length = 0;
  const stored = new Map<string, string>();
  const storage = {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => { stored.set(key, value); },
  };
  const user = person("closer");
  await fetchHotOverview({ user, token: "tok", fetcher, enabled: true, now: 30_000, storage });
  assert.equal(calls.length, 1);
  assert.equal(stored.has("raydar.hotOverview.v1:rep-1"), true);
  resetHotOverviewForTests();
  await fetchHotOverview({ user, token: "tok", fetcher, enabled: true, now: 30_000 + 5_000, storage });
  assert.equal(calls.length, 1);
  await fetchHotOverview({ user, token: "tok", fetcher, enabled: true, now: 30_000 + HOT_OVERVIEW_TTL_MS, storage });
  assert.equal(calls.length, 2);
});

test("T7 a missing route stays quiet and a stale cache is reused", async () => {
  const closer = person("closer");
  for (const status of [404, 405, 400]) {
    resetHotOverviewForTests();
    let calls = 0;
    const fetcher: HotOverviewFetcher = async () => {
      calls += 1;
      return new Response("missing", { status });
    };
    const now = 1_000_000;
    const first = await fetchHotOverview({ user: closer, token: "tok", fetcher, enabled: true, now });
    assert.equal(calls, 1, String(status));
    assert.equal(first.unavailable, true, String(status));
    assert.deepEqual(first.points, [], String(status));
    await fetchHotOverview({ user: closer, token: "tok", fetcher, enabled: true, now: now + HOT_TRANSIENT_BACKOFF_MS });
    assert.equal(calls, 1, `${status} is not a 60s backoff`);
    await fetchHotOverview({ user: closer, token: "tok", fetcher, enabled: true, now: now + HOT_SILENT_BACKOFF_MS - 1 });
    assert.equal(calls, 1, `${status} quiet for 15 min`);
  }

  for (const status of [401, 403, 500]) {
    resetHotOverviewForTests();
    let calls = 0;
    const fetcher: HotOverviewFetcher = async () => {
      calls += 1;
      return new Response("no", { status });
    };
    const now = 2_000_000;
    await fetchHotOverview({ user: closer, token: "tok", fetcher, enabled: true, now });
    await fetchHotOverview({ user: closer, token: "tok", fetcher, enabled: true, now: now + HOT_TRANSIENT_BACKOFF_MS - 1 });
    assert.equal(calls, 1, `${status} holds for 60s`);
    await fetchHotOverview({ user: closer, token: "tok", fetcher, enabled: true, now: now + HOT_TRANSIENT_BACKOFF_MS });
    assert.equal(calls, 2, `${status} retries after 60s`);
  }

  resetHotOverviewForTests();
  let mode: "ok" | "fail" = "ok";
  let calls = 0;
  const cached = point("ghl_cached_1");
  const fetcher: HotOverviewFetcher = async () => {
    calls += 1;
    if (mode === "fail") throw new Error("network down");
    return okResponse([cached]);
  };
  const seededAt = 50_000_000;
  const seeded = await fetchHotOverview({ user: closer, token: "tok", fetcher, enabled: true, now: seededAt });
  assert.deepEqual(seeded.points, [{ id: "ghl_cached_1", lat: 40.7, lng: -74, hotStatus: "active" }]);
  mode = "fail";
  const stale = await fetchHotOverview({
    user: closer,
    token: "tok",
    fetcher,
    enabled: true,
    now: seededAt + 2 * 60 * 60 * 1000,
  });
  assert.equal(calls, 2);
  assert.equal(stale.fromCache, true);
  assert.equal(stale.unavailable, false);
  assert.deepEqual(stale.points, seeded.points);

  resetHotOverviewForTests();
  const empty = await fetchHotOverview({
    user: closer,
    token: "tok",
    enabled: true,
    now: 3,
    fetcher: async () => { throw new Error("no cache"); },
  });
  assert.equal(empty.unavailable, true);
  assert.deepEqual(empty.points, []);
  await assert.doesNotReject(() => fetchHotOverview({
    user: closer,
    token: "tok",
    enabled: true,
    now: 4,
    fetcher: async () => Promise.reject(new Error("rejected")),
  }));
  assert.ok(HOT_OVERVIEW_STALE_MS > 2 * 60 * 60 * 1000);
});

test("T8 cluster labels match the door-cluster rule", () => {
  assert.equal(hotOverviewClusterLabel(1), "1");
  assert.equal(hotOverviewClusterLabel(7), "7");
  assert.equal(hotOverviewClusterLabel(10), "10");
  assert.equal(hotOverviewClusterLabel(999), "999");
  assert.equal(hotOverviewClusterLabel(1000), "1.0k");
  assert.equal(hotOverviewClusterLabel(1234), "1.2k");
});

test("T9 the zoom banner is unchanged unless the overview is ready", () => {
  assert.equal(hotLeadZoomBanner("only", 14), "Zoom in to see 3PL leads.");
  assert.equal(hotLeadZoomBanner("only", 14.9), "Zoom in to see 3PL leads.");
  assert.equal(hotLeadZoomBanner("only", 15), null);
  assert.equal(hotLeadZoomBanner("all", 10), null);
  assert.equal(hotLeadZoomBanner("hide", 10), null);
  assert.equal(hotLeadZoomBanner("only", 12, true), null);
  assert.equal(hotLeadZoomBanner("only", 12, false), HOT_LEAD_ZOOM_BANNER);
  assert.equal(hotLeadZoomBanner("only", 15, false), null);
  assert.equal(hotLeadZoomBanner("all", 12, false), null);
  assert.equal(HOT_LEAD_MIN_ZOOM, 15);
});

test("T10 the overview cluster layer is separate and only shows below zoom 15 in 3PL only", () => {
  const map = read("app/components/LeadMap.tsx");
  const block = map.slice(map.indexOf("3PL overview clusters"), map.indexOf("end 3PL overview clusters"));
  assert.ok(block.length > 0);
  assert.match(block, /L\.markerClusterGroup\(/);
  assert.match(block, /disableClusteringAtZoom: 15/);
  assert.match(block, /zoomToBoundsOnClick: true/);
  assert.match(block, /filter === 'only' && hotLayerZoom < 15/);
  assert.match(block, /map\.removeLayer\(group\)/);
  assert.match(block, /L\.circleMarker/);
  assert.match(block, /setView\(\[point\.lat, point\.lng\], 16, \{ animate: true \}\)/);
  assert.match(block, /hotOverviewClusterLabel/);
  assert.doesNotMatch(block, /mergeHotLeads|publishHotLeadIndex|rememberServerHotPin/);
  assert.match(map, /hotLeadZoomBanner\(filter, hotLayerZoom, hotOverviewReady\)/);
  assert.match(map, /hotOverviewReady,/);
  const page = read("app/mobile/knocking/page.tsx");
  assert.match(page, /useHotOverview\(/);
  assert.match(page, /hotFilter === 'only' && \(viewport\?\.zoom \?\? mapZoom\) < HOT_LEAD_MIN_ZOOM/);
  assert.match(page, /hotOverview=\{hotOverview\.points\}/);
});

test("T11 the overview client does not read Firestore", () => {
  for (const file of ["app/hotLeads/overview.ts", "app/hooks/useHotOverview.ts"]) {
    const source = read(file);
    assert.doesNotMatch(source, /firebase\/firestore/);
    assert.doesNotMatch(source, /rememberServerHotPin/);
    assert.doesNotMatch(source, /mergeHotLeads/);
    assert.doesNotMatch(source, /publishHotLeadIndex/);
  }
  const hook = read("app/hooks/useHotOverview.ts");
  assert.match(hook, /apiFetch/);
  assert.match(hook, /getIdToken\(\)/);
  assert.match(hook, /addEventListener\("online", wake\)/);
  assert.match(hook, /visibilitychange/);
  assert.match(hook, /appStateChange/);
  assert.match(hook, /clearHotOverviewBackoff\(\)/);
  assert.doesNotMatch(read("app/hotLeads/overview.ts"), /from ["']@\/app\/utils\/firebase["']/);
});

test("T12 parsing 2,000 overview points stays under 25ms", () => {
  const rows = Array.from({ length: 2000 }, (_, index) => point(`ghl_fast_${index}`));
  const started = performance.now();
  const parsed = parseHotOverview({ points: rows });
  const elapsed = performance.now() - started;
  assert.equal(parsed.length, 2000);
  assert.ok(elapsed < 25, `parse took ${elapsed}ms`);
  const labelStarted = performance.now();
  let last = "";
  for (let count = 0; count < 1000; count += 1) last = hotOverviewClusterLabel(count);
  const labelElapsed = performance.now() - labelStarted;
  assert.equal(last, "999");
  assert.ok(labelElapsed < 25, `labels took ${labelElapsed}ms`);
  const source = read("app/hotLeads/overview.ts");
  const labelFn = source.slice(source.indexOf("export function hotOverviewClusterLabel"), source.indexOf("export function parseHotOverview"));
  assert.doesNotMatch(labelFn, /\bfor\b|\bwhile\b/);
});

test("T13 setters never call the overview and the production role set stays A", async () => {
  assert.equal(HOT_LEAD_ROLE_VARIANT, "A");
  const roles = HOT_LEAD_ROLE_SETS.A;
  assert.equal(canSeeHotLeads(person("closer"), roles), true);
  assert.equal(canSeeHotLeads(person("manager"), roles), true);
  assert.equal(canSeeHotLeads(person("admin"), roles), true);
  assert.equal(canSeeHotLeads(person("setter"), roles), false);
  resetHotOverviewForTests();
  let calls = 0;
  const fetcher: HotOverviewFetcher = async () => {
    calls += 1;
    return okResponse([point("ghl_hidden")]);
  };
  const result = await fetchHotOverview({
    user: person("setter"),
    token: "tok",
    fetcher,
    enabled: true,
    now: 80_000,
    roles,
  });
  assert.equal(calls, 0);
  assert.deepEqual(result.points, []);
});

test("T14 release 14.22 build 166 is the same number everywhere", () => {
  const release = JSON.parse(read("app/mobile/_lib/release.json"));
  assert.equal(release.version, "14.22");
  assert.equal(release.build, 166);
  const project = read("ios/App/App.xcodeproj/project.pbxproj");
  assert.deepEqual([...project.matchAll(/MARKETING_VERSION = ([0-9.]+);/g)].map((match) => match[1]), ["14.22", "14.22"]);
  assert.deepEqual([...project.matchAll(/CURRENT_PROJECT_VERSION = (\d+);/g)].map((match) => match[1]), ["166", "166"]);
  const gradle = read("android/app/build.gradle");
  assert.match(gradle, /versionName "14\.22"/);
  assert.match(gradle, /versionCode 166\b/);
  assert.match(read("tests/mobile/silent-sync-v1418.test.ts"), /X-Raydar-Build"\], "166"/);
  assert.match(read("tests/mobile/release-v1418.test.ts"), /build 166/);
  assert.match(read("tests/mobile/hot-3pl-android-v1422.test.ts"), /release\.build, 166/);
});

test("T15 knockCount.ts is unchanged and this change does not touch the server", () => {
  const hash = createHash("sha256").update(read("app/utils/knockCount.ts")).digest("hex");
  assert.equal(hash, KNOCK_COUNT_SHA);
  const status = execSync(
    "git status --porcelain -- app/api app/utils/server firestore.rules firestore.indexes.json app/utils/knockCount.ts app/page.tsx",
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(status.trim(), "");
});
