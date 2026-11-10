import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import release from "../../app/mobile/_lib/release.json";
import { planAreaFocus, type AreaFocusTerritory, type AreaFocusView } from "../../app/mobile/_lib/areaFocus";
import { nativeApiFetch } from "../../app/utils/apiFetch";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function read(relative: string): string {
  return readFileSync(path.join(root, relative), "utf8");
}

function box(lat: number, lng: number, span = 0.02): AreaFocusTerritory["polygon"] {
  return [
    { lat, lng },
    { lat, lng: lng + span },
    { lat: lat + span, lng: lng + span },
    { lat: lat + span, lng },
  ];
}

const arizona: AreaFocusView = { south: 33.4, north: 33.5, west: -112.1, east: -112.0 };

test("T1 mine with an own territory inside the view does not move the map", () => {
  const plan = planAreaFocus({
    mode: "mine",
    userId: "me",
    territories: [
      { userId: "me", polygon: box(43.15, -78.8) },
      { userId: "other", polygon: box(37.7, -122.4) },
    ],
    view: { south: 43.14, north: 43.2, west: -78.82, east: -78.76 },
  });
  assert.equal(plan.fit, null);
  assert.equal(plan.notice, "");
});

test("T2 team focus stays on the nearby cluster and leaves the far outlier out", () => {
  const territories: AreaFocusTerritory[] = [];
  for (let i = 0; i < 71; i += 1) {
    const row = Math.floor(i / 8);
    const col = i % 8;
    territories.push({ userId: `rep-${i}`, polygon: box(43.1 + row * 0.02, -78.9 + col * 0.02, 0.01) });
  }
  territories.push({ userId: "outlier", polygon: box(37.7, -122.4, 0.05) });
  const plan = planAreaFocus({
    mode: "team",
    userId: "rep-0",
    territories,
    view: { south: 42.0, north: 42.2, west: -78.8, east: -78.6 },
  });
  assert.ok(plan.fit);
  assert.equal(plan.fit?.length, 71 * 4);
  assert.ok(plan.fit?.every((point) => point[1] < -70));
  assert.match(plan.notice, /71 team territories/);
  assert.match(plan.notice, /Tap GPS to return to your location/);
  assert.equal(plan.notice.includes("outlier"), false);
});

test("T3 an empty team list explains that nothing was returned", () => {
  const plan = planAreaFocus({
    mode: "team",
    userId: "me",
    territories: [],
    view: arizona,
  });
  assert.equal(plan.fit, null);
  assert.equal(plan.notice, "No team territories were returned for your account.");
});

test("T4 mine with no own territory keeps the existing notice", () => {
  const plan = planAreaFocus({
    mode: "mine",
    userId: "me",
    territories: [{ userId: "other", polygon: box(43.1, -78.8) }],
    view: arizona,
  });
  assert.equal(plan.fit, null);
  assert.equal(plan.notice, "You do not have an assigned territory yet.");
});

test("T5 a view that touches a polygon edge counts as in view", () => {
  const plan = planAreaFocus({
    mode: "team",
    userId: "me",
    territories: [{ userId: "me", polygon: box(43, -78, 1) }],
    view: { south: 42.5, north: 43, west: -77.5, east: -77.2 },
  });
  assert.equal(plan.fit, null);
  assert.equal(plan.notice, "");
});

test("T6 short and NaN polygons are ignored and corners stay cheap", () => {
  const territories: AreaFocusTerritory[] = [];
  for (let i = 0; i < 72; i += 1) {
    const polygon = Array.from({ length: 475 }, (_, j) => ({
      lat: 43.2 + Math.sin(j / 20) * 0.001,
      lng: -78.7 + Math.cos(j / 20) * 0.001,
    }));
    territories.push({ userId: "rep", polygon });
  }
  territories.push({ userId: "rep", polygon: [{ lat: 1, lng: 1 }, { lat: 2, lng: 2 }] });
  territories.push({ userId: "rep", polygon: [{ lat: 1, lng: 1 }, { lat: Number.NaN, lng: 2 }, { lat: 3, lng: 3 }] });
  const started = performance.now();
  const plan = planAreaFocus({
    mode: "team",
    userId: "rep",
    territories,
    view: arizona,
  });
  const elapsed = performance.now() - started;
  assert.ok(elapsed < 50, `planAreaFocus took ${elapsed}ms`);
  assert.equal(plan.fit?.length, 72 * 4);
  assert.match(plan.notice, /72 team territories/);
});

test("T7 antimeridian, negative longitude and southern fixtures do not throw", () => {
  assert.doesNotThrow(() => {
    const plan = planAreaFocus({
      mode: "team",
      userId: "me",
      territories: [
        { userId: "me", polygon: [{ lat: -33.9, lng: 151.2 }, { lat: -33.8, lng: 151.3 }, { lat: -33.85, lng: 151.1 }] },
        { userId: "me", polygon: [{ lat: 10, lng: 170 }, { lat: 10.2, lng: -170 }, { lat: 10.1, lng: 175 }] },
        { userId: "me", polygon: [{ lat: 1, lng: -10 }, { lat: 2, lng: -11 }, { lat: 1.5, lng: -10.5 }] },
      ],
      view: { south: -34, north: -33.7, west: 170, east: -170 },
    });
    assert.ok(plan.notice === "" || plan.fit === null || Array.isArray(plan.fit));
  });
});

test("choosing Team or My remembers a pending focus and Off or a refresh does not move the map", () => {
  const page = read("app/mobile/knocking/page.tsx");
  const handler = page.slice(page.indexOf("function onAreaMode"), page.indexOf("function onZoomMine"));
  assert.match(handler, /setAreaNotice\(''\)/);
  assert.match(handler, /setZoomMinePending\(false\)/);
  assert.match(handler, /mode === 'off'/);
  assert.match(handler, /setPendingAreaFocus\(null\)/);
  assert.match(handler, /setPendingAreaFocus\(\{ mode, token: areaFocusToken\.current \}\)/);
  const effect = page.slice(page.indexOf("if (!pendingAreaFocus"), page.indexOf("function onAreaMode"));
  assert.ok(effect.indexOf("return") < effect.indexOf("setFitAreaBounds"));
  assert.match(effect, /planAreaFocus\(/);
  assert.match(page, /onZoomMine=\{onZoomMine\}/);
  assert.match(page.slice(page.indexOf("function onZoomMine"), page.indexOf("// Fetch weather")), /setZoomMinePending\(true\)/);
  const hook = read("app/hooks/useTeamAreasOverlay.ts");
  assert.match(hook, /export function useTeamAreasOverlay\(enabled: boolean, userId\?: string\)/);
});

test("loading territories is visible in the header only while areas are on", () => {
  const page = read("app/mobile/knocking/page.tsx");
  assert.match(page, /areaMode !== 'off' && areasLoading && <MobileNotice>Loading territories…<\/MobileNotice>/);
  assert.match(page, /Retry areas/);
  const shell = read("app/mobile/_components/MobileShell.tsx");
  assert.match(shell, /Loading areas…/);
});

test("closers and setters are told team mode is their own territories; admin and manager are not", () => {
  const page = read("app/mobile/knocking/page.tsx");
  assert.match(page, /areaMode === 'team' && !\['admin', 'manager'\]\.includes\(currentUser\.role\)/);
  assert.match(page, /Your account shows its own territories only\./);
  const route = read("app/api/team-areas/route.ts");
  assert.match(route, /ownOnly/);
});

test("A1 native team-areas accepts a large string or object body and sends the android build headers", async () => {
  process.env.NEXT_PUBLIC_API_BASE_URL = "https://example.com";
  const territories = Array.from({ length: 72 }, (_, i) => ({
    id: `t-${i}`,
    archived: false,
    polygon: Array.from({ length: 80 }, (_, j) => ({
      lat: 43 + i * 0.001,
      lng: -78 + j * 0.0001,
      note: "x".repeat(280),
    })),
  }));
  const body = { territories, members: [] as [] };
  const encoded = JSON.stringify(body);
  assert.ok(encoded.length > 1_500_000, `payload was ${encoded.length} bytes`);
  const seen: { headers?: Record<string, string>; disableRedirects?: boolean }[] = [];
  async function load(data: unknown) {
    const response = await nativeApiFetch("/api/team-areas?summary=1", {}, async (request) => {
      seen.push({ headers: request.headers, disableRedirects: request.disableRedirects });
      return { status: 200, data, headers: {}, url: request.url };
    }, "android");
    return response.json() as Promise<{ territories: { id: string }[] }>;
  }
  const fromString = await load(encoded);
  const fromObject = await load(body);
  assert.equal(fromString.territories.length, 72);
  assert.equal(fromObject.territories.length, 72);
  assert.equal(fromString.territories[0]?.id, "t-0");
  assert.equal(fromObject.territories[71]?.id, "t-71");
  assert.equal(fromString.territories[3]?.id, fromObject.territories[3]?.id);
  for (const request of seen) {
    assert.equal(request.headers?.["X-Raydar-Build"], String(release.build));
    assert.equal(request.headers?.["X-Raydar-Platform"], "android");
    assert.equal(request.disableRedirects, true);
  }
});

test("A2 a failed areas read shows the retry notice and retry drops the 30s cache", () => {
  const hook = read("app/hooks/useTeamAreasOverlay.ts");
  assert.match(hook, /throw Error\('Territories could not load\. Tap Retry areas\.'\)/);
  assert.match(hook, /throw Error\('Sign in to load territories\.'\)/);
  assert.match(hook, /'Territories could not load\. Tap Retry areas\.'/);
  assert.match(hook, /cache\.delete\(userId\)/);
  assert.match(hook, /setAttempt\(v => v \+ 1\)/);
  const page = read("app/mobile/knocking/page.tsx");
  assert.match(page, /areasError && showTeamAreas/);
  assert.match(page, /onClick=\{retryAreas\}>Retry areas/);
});

test("A3 a signed-out areas read retries once when auth becomes ready and does not loop", () => {
  const hook = read("app/hooks/useTeamAreasOverlay.ts");
  assert.match(hook, /Sign in to load territories\./);
  assert.match(hook, /authRetryUsed/);
  assert.match(hook, /auth\?\.onAuthStateChanged/);
  assert.match(hook, /if \(!active \|\| authRetryUsed\) return;/);
  assert.match(hook, /user\?\.uid !== userId/);
  const subscribe = hook.indexOf("auth?.onAuthStateChanged");
  const secondCatch = hook.indexOf(".catch(fail)", subscribe);
  assert.ok(subscribe > 0);
  assert.ok(secondCatch > subscribe);
  assert.equal(hook.slice(secondCatch).includes("onAuthStateChanged"), false);
  assert.match(hook, /export function useTeamAreasOverlay\(enabled: boolean, userId\?: string\)/);
});

test("A4 the areas menu ignores an inside pointer and closes on an outside pointer or item click", () => {
  const shell = read("app/mobile/_components/MobileShell.tsx");
  const menu = shell.slice(shell.indexOf("const [areasOpen"), shell.indexOf("export function SectionHeading"));
  assert.match(menu, /document\.addEventListener\('pointerdown', close\)/);
  assert.match(menu, /if \(!areaRoot\.current\?\.contains\(e\.target as Node\)\) setAreasOpen\(false\)/);
  const items = menu.slice(menu.indexOf("['mine','My territories']"), menu.indexOf("Zoom to mine"));
  assert.match(items, /onClick=\{\(\)=>\{onAreaMode\?\.\(mode\);setAreasOpen\(false\);\}\}/);
  assert.equal(items.match(/onAreaMode\?\.\(mode\)/g)?.length, 1);
});

test("release 14.22 build 165 is the same number in the app, iOS and Android", () => {
  assert.equal(release.version, "14.22");
  assert.equal(release.build, 165);
  const project = read("ios/App/App.xcodeproj/project.pbxproj");
  assert.deepEqual([...project.matchAll(/MARKETING_VERSION = ([0-9.]+);/g)].map((match) => match[1]), ["14.22", "14.22"]);
  assert.deepEqual([...project.matchAll(/CURRENT_PROJECT_VERSION = (\d+);/g)].map((match) => match[1]), ["165", "165"]);
  const gradle = read("android/app/build.gradle");
  assert.match(gradle, /versionName "14\.22"/);
  assert.match(gradle, /versionCode 165\b/);
  assert.match(read("tests/mobile/silent-sync-v1418.test.ts"), /X-Raydar-Build"\], "165"/);
});
