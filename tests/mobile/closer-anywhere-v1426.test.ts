import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { knocksAnywhere } from "../../app/field/closerScope";
import { guardNewPinTerritory, resetTerritoryCheckForTests, type TerritoryCheckDeps } from "../../app/field/territoryCheck";
import { areaPolygonsFor } from "../../app/mobile/_lib/areaFocus";
import {
  callerPopupExempt,
  isTerritoryWarningCancelled,
  noteMobileLeadsMeta,
  resetOwnerCountsForTests,
  territoryCheckNeeded,
} from "../../app/mobile/_lib/ownerCounts";
import { knockMapPins } from "../../app/mobile/_lib/pinScope";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BASE = "17dfd28c2d1a41ce25eeddfc4d25db118019594c";
const UID = "closer-1";
const KNOCK_COUNT_SHA = "a00be3335708b5b54605b08f11bd37fb9fa5ada20e3c0cb428d57b58bf1dd226";
const SQUARE = [
  { lat: 43, lng: -77 },
  { lat: 43, lng: -76.99 },
  { lat: 43.01, lng: -76.99 },
  { lat: 43.01, lng: -77 },
];
const INSIDE = { lat: 43.005, lng: -76.995 };
const OUTSIDE = { lat: 43.005, lng: -76.98 };

function read(rel: string) {
  return readFileSync(path.join(root, rel), "utf8");
}

function fresh() {
  resetOwnerCountsForTests();
  resetTerritoryCheckForTests();
}

afterEach(() => fresh());

function warnBody() {
  return {
    ok: true,
    ownership: "territory",
    warn: true,
    popupExempt: false,
    inOtherUsersTerritory: true,
    owners: [{ uid: "owner-1", name: null }],
  };
}

function warnDeps(sends: { n: number }): TerritoryCheckDeps {
  return {
    online: () => true,
    currentUid: () => UID,
    getToken: async () => "TEST_TOKEN",
    now: () => 1_700_000_000_000,
    send: async () => {
      sends.n += 1;
      return Response.json(warnBody());
    },
  };
}

function changedNames(): string[] {
  const names = new Set<string>();
  for (const command of [
    `git diff --name-only ${BASE}`,
    `git diff --cached --name-only ${BASE}`,
    `git diff --name-only ${BASE} HEAD`,
    "git ls-files --others --exclude-standard",
  ]) {
    const output = execSync(command, { cwd: root, encoding: "utf8" });
    for (const line of output.split("\n")) if (line) names.add(line);
  }
  return [...names];
}

test("K1 knocksAnywhere is true only for the closer role", () => {
  assert.equal(knocksAnywhere("closer"), true);
  for (const role of ["setter", "manager", "admin", "sales", "", undefined, "Closer"]) {
    assert.equal(knocksAnywhere(role), false, String(role));
  }
});

test("K2 closers skip the existing-pin warning and other roles stay on the server flag", () => {
  fresh();
  assert.equal(callerPopupExempt(UID, "closer"), true);
  noteMobileLeadsMeta(UID, { ownership: "territory", popupExempt: false });
  assert.equal(callerPopupExempt(UID, "closer"), true);
  assert.equal(callerPopupExempt(UID, "setter"), false);
  assert.equal(callerPopupExempt("", "closer"), false);
  fresh();
  assert.equal(callerPopupExempt(UID), false);
  noteMobileLeadsMeta(UID, { ownership: "territory", popupExempt: true });
  assert.equal(callerPopupExempt(UID), true);
  noteMobileLeadsMeta(UID, { ownership: "territory", popupExempt: false });
  assert.equal(callerPopupExempt(UID), false);
});

test("K3 a closer never calls territory-check and a setter keeps the 169 decision", () => {
  fresh();
  assert.equal(territoryCheckNeeded(UID, "closer"), false);
  noteMobileLeadsMeta(UID, { ownership: "territory", popupExempt: false });
  assert.equal(territoryCheckNeeded(UID, "closer"), false);
  fresh();
  assert.equal(territoryCheckNeeded(UID, "setter"), true);
  noteMobileLeadsMeta(UID, { ownership: "territory", popupExempt: false });
  assert.equal(territoryCheckNeeded(UID, "setter"), true);
  noteMobileLeadsMeta(UID, { ownership: "legacy", popupExempt: false });
  assert.equal(territoryCheckNeeded(UID, "setter"), false);
});

test("K4 a closer drops a pin with no request and no popup; a setter still confirms", async () => {
  fresh();
  const closerSends = { n: 0 };
  let closerConfirms = 0;
  const closer = await guardNewPinTerritory({
    uid: UID,
    lat: INSIDE.lat,
    lng: INSIDE.lng,
    role: "closer",
    confirm: () => {
      closerConfirms += 1;
      return true;
    },
    deps: warnDeps(closerSends),
  });
  assert.deepEqual(closer, { checked: false, warned: false });
  assert.equal(closerSends.n, 0);
  assert.equal(closerConfirms, 0);

  fresh();
  const setterSends = { n: 0 };
  let setterConfirms = 0;
  const setter = await guardNewPinTerritory({
    uid: UID,
    lat: INSIDE.lat,
    lng: INSIDE.lng,
    role: "setter",
    confirm: () => {
      setterConfirms += 1;
      return true;
    },
    deps: warnDeps(setterSends),
  });
  assert.deepEqual(setter, { checked: true, warned: true });
  assert.equal(setterSends.n, 1);
  assert.equal(setterConfirms, 1);

  fresh();
  const cancelSends = { n: 0 };
  await assert.rejects(
    () => guardNewPinTerritory({
      uid: UID,
      lat: INSIDE.lat,
      lng: INSIDE.lng,
      role: "setter",
      confirm: () => false,
      deps: warnDeps(cancelSends),
    }),
    (error: unknown) => isTerritoryWarningCancelled(error),
  );
  assert.equal(cancelSends.n, 1);
});

test("K5 LeadDetail passes the role and LeadMap still guards before the save", () => {
  const detail = read("app/components/LeadDetail.tsx");
  assert.match(detail, /callerPopupExempt\(currentUser\?\.id, currentUser\?\.role\)/);
  const map = read("app/components/LeadMap.tsx");
  assert.match(map, /guardNewPinTerritory\(\{[^}]*role: currentUser\?\.role/);
  assert.equal(map.includes("callerPopupExempt"), false);
  const fn = map.slice(map.indexOf("const handleSaveDroppedLead"), map.indexOf("const handleLocateMe"));
  const acted = fn.indexOf("const actedAt");
  const actor = fn.indexOf("const actorUid");
  const placed = fn.indexOf("const placedAt");
  const guardAt = fn.indexOf("guardNewPinTerritory(");
  assert.ok(acted >= 0 && acted < actor && actor < placed && placed < guardAt);
  assert.ok(guardAt < fn.indexOf("crypto.randomUUID()"));
  assert.ok(guardAt < fn.indexOf("saveManualLead("));
});

test("K6 a closer keeps their own out-of-scope pins and everyone else stays scoped", () => {
  const leads = [
    { id: "in-other", ...INSIDE, claimedBy: "other", assignedTo: "other" },
    { id: "out-claimed", ...OUTSIDE, claimedBy: "closer-1" },
    { id: "out-assigned", ...OUTSIDE, assignedTo: "closer-1" },
    { id: "out-manual", ...OUTSIDE, setterId: "closer-1", source: "manually-added" },
    { id: "out-other", ...OUTSIDE, claimedBy: "other", assignedTo: "other", setterId: "other", source: "manually-added" },
  ];
  const closer = { id: "closer-1", role: "closer" };
  assert.deepEqual(knockMapPins(leads, [SQUARE], closer).map((lead) => lead.id), [
    "in-other",
    "out-claimed",
    "out-assigned",
    "out-manual",
  ]);
  assert.deepEqual(knockMapPins(leads, [], closer).map((lead) => lead.id), [
    "out-claimed",
    "out-assigned",
    "out-manual",
  ]);
  assert.deepEqual(knockMapPins(leads, [SQUARE], { id: "closer-1", role: "setter" }).map((lead) => lead.id), ["in-other"]);
  assert.deepEqual(knockMapPins(leads, undefined, { id: "admin-1", role: "admin" }).map((lead) => lead.id), leads.map((lead) => lead.id));
  const page = read("app/mobile/knocking/page.tsx");
  assert.match(page, /knockMapPins\(mergeLeadSnapshots\(viewportPins\.leads, leads\), pinPolygons, currentUser\)/);
  assert.match(page, /\[viewportPins\.leads,leads,pinPolygons,currentUser\?\.id,currentUser\?\.role\]/);
  assert.match(page, /const pinPolygons = useMemo\(\(\) => currentUser && \['admin','manager'\]\.includes\(currentUser\.role\) \? undefined : overlayTerritories\.filter\(t => t\.userId === currentUser\?\.id\)\.map\(t => t\.polygon\)/);
});

test("K7 the diff adds no sales role and leaves the gates and knock counter untouched", () => {
  const hash = createHash("sha256").update(readFileSync(path.join(root, "app/utils/knockCount.ts"))).digest("hex");
  assert.equal(hash, KNOCK_COUNT_SHA);
  const names = changedNames();
  for (const file of [
    "app/field/areaGate.ts",
    "app/utils/proximityEnforcement.ts",
    "app/utils/gpsRule.ts",
    "app/field/serverDispo.ts",
    "app/field/useFieldData.ts",
    "app/utils/knockCount.ts",
    "app/page.tsx",
    "firestore.rules",
    "firestore.indexes.json",
  ]) {
    assert.equal(names.includes(file), false, file);
  }
  for (const name of names) {
    assert.equal(name.startsWith("app/api/") || name.startsWith("app/utils/server/") || name.startsWith("scripts/"), false, name);
  }
  const added: string[] = [];
  const diff = execSync(`git diff -U0 ${BASE} -- app`, { cwd: root, encoding: "utf8" });
  for (const line of diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) added.push(line);
  }
  const untracked = execSync("git ls-files --others --exclude-standard -- app", { cwd: root, encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
  for (const file of untracked) added.push(...read(file).split("\n"));
  assert.equal(added.some((line) => line.includes("'sales'") || line.includes('"sales"')), false);
  assert.equal(read("app/field/closerScope.ts").includes("import "), false);
});

test("T2 team polygons follow the area mode and 3PL only no longer replaces them", () => {
  const territories = [
    { id: "mine", userId: "closer-1" },
    { id: "other", userId: "setter-2" },
  ];
  assert.deepEqual(areaPolygonsFor("mine", territories, "closer-1").map((row) => row.id), ["mine"]);
  assert.deepEqual(areaPolygonsFor("team", territories, "closer-1").map((row) => row.id), ["mine", "other"]);
  assert.deepEqual(areaPolygonsFor("off", territories, "closer-1"), []);
  const page = read("app/mobile/knocking/page.tsx");
  const prop = page.split("\n").find((line) => line.includes("territories={"));
  assert.equal(prop?.trim(), "territories={showTeamAreas ? teamAreaTerritories : []}");
  assert.equal(prop?.includes("only"), false);
  assert.match(page, /teamMembers=\{only \? \[\] : teamMembersForMap\}/);
  assert.match(page, /heatCells=\{only \? \[\] : heatCells\}/);
  assert.match(page, /useState<'off'\|'mine'\|'team'>\('mine'\)/);
});

test("V1 and V2 release 14.26 build 170 matches and the diff stays off the server", () => {
  const release = JSON.parse(read("app/mobile/_lib/release.json"));
  assert.equal(release.version, "14.26");
  assert.equal(release.build, 170);
  const project = read("ios/App/App.xcodeproj/project.pbxproj");
  assert.deepEqual([...project.matchAll(/MARKETING_VERSION = ([0-9.]+);/g)].map((match) => match[1]), ["14.26", "14.26"]);
  assert.deepEqual([...project.matchAll(/CURRENT_PROJECT_VERSION = (\d+);/g)].map((match) => match[1]), ["170", "170"]);
  const gradle = read("android/app/build.gradle");
  assert.match(gradle, /versionName "14\.26"/);
  assert.match(gradle, /versionCode 170\b/);
  const hash = createHash("sha256").update(read("app/utils/knockCount.ts")).digest("hex");
  assert.equal(hash, KNOCK_COUNT_SHA);
  const names = changedNames();
  const forbidden = (name: string) => name.startsWith("app/api/")
    || name.startsWith("app/utils/server/")
    || name.startsWith("scripts/")
    || name === "firestore.rules"
    || name === "firestore.indexes.json"
    || name === "app/page.tsx"
    || name === "app/utils/knockCount.ts"
    || (name.startsWith("ios/") && name !== "ios/App/App.xcodeproj/project.pbxproj")
    || (name.startsWith("android/") && name !== "android/app/build.gradle");
  for (const name of names) assert.equal(forbidden(name), false, name);
});
