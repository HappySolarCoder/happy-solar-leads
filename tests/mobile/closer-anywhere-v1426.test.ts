import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import LeadDetail from "../../app/components/LeadDetail";
import { knocksAnywhere, REDACTED_DOOR_NOTICE } from "../../app/field/closerScope";
import { guardNewPinTerritory, resetTerritoryCheckForTests, type TerritoryCheckDeps } from "../../app/field/territoryCheck";
import { canSeeHotLeads } from "../../app/hotLeads/access";
import { applyHotFilter, hotOnlyLayers } from "../../app/hotLeads/filter";
import { mergeLeadSnapshots } from "../../app/homeowners/houseIdentity";
import { areaPolygonsFor } from "../../app/mobile/_lib/areaFocus";
import {
  callerPopupExempt,
  isTerritoryWarningCancelled,
  noteMobileLeadsMeta,
  resetOwnerCountsForTests,
  rowsForOwnership,
  territoryCheckNeeded,
} from "../../app/mobile/_lib/ownerCounts";
import { homeScopeFor, inPinScope, knockMapPins, pinScopeFor, scopedViews } from "../../app/mobile/_lib/pinScope";
import type { Lead, User } from "../../app/types";
import { DEFAULT_DISPOSITIONS } from "../../app/types/disposition";
import { fieldPinArtwork, fieldPinStyle } from "../../app/utils/fieldPin";
import { mapLeadDoc } from "../../app/utils/firestore";
import { countKnocks, type KnockEvent } from "../../app/utils/knockCount";

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
  assert.deepEqual(knockMapPins(leads, [SQUARE], closer).map((lead) => lead.id), leads.map((lead) => lead.id));
  assert.deepEqual(knockMapPins(leads, [], closer).map((lead) => lead.id), leads.map((lead) => lead.id));
  assert.deepEqual(knockMapPins(leads, [SQUARE], { id: "closer-1", role: "setter" }).map((lead) => lead.id), ["in-other"]);
  assert.deepEqual(knockMapPins(leads, undefined, { id: "admin-1", role: "admin" }).map((lead) => lead.id), leads.map((lead) => lead.id));
  const page = read("app/mobile/knocking/page.tsx");
  assert.match(page, /knockMapPins\(mergeLeadSnapshots\(viewportPins\.leads, leads\), pinPolygons, currentUser\)/);
  assert.match(page, /\[viewportPins\.leads,leads,pinPolygons,currentUser\]/);
  assert.match(page, /pinScopeFor\(currentUser, overlayTerritories\)/);
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

const FAR = { lat: 43.5, lng: -77 };
const VIEW_OUTSIDE = { south: 43.9, north: 44, west: -77.05, east: -76.95, zoom: 16 };
const HIDDEN_LEAD_KEYS = [
  "name", "phone", "email", "notes", "dispositionNotes", "objectionType", "objectionNotes", "goBackNotes",
  "estimatedBill", "hasSouthFacingRoof", "solarMaxPanels", "solarScore", "appointmentDateTime",
  "appointmentOutcome", "appointmentOutcomeAt", "ghlContactId", "ghlOpportunityId", "ghlStatus",
  "pipelineStageId", "tags", "goBackScheduledBy", "goBackScheduledDate", "goBackScheduledTime",
  "fieldDoor", "fieldHandoff", "claimedBy", "assignedTo", "setterId", "claimedAt", "assignedAt", "homeowner",
  "knockGpsLat", "knockGpsLng", "gpsVerified", "gpsUnverifiedReason", "gpsDistanceM",
];

function person(role: User["role"], id: string): User {
  return {
    id,
    name: role,
    email: `${role}@example.test`,
    color: "#476E88",
    role,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  };
}

function redactedRow(): Record<string, unknown> {
  return {
    id: "far-1",
    lat: FAR.lat,
    lng: FAR.lng,
    address: "100 Far St",
    city: "Town",
    state: "AZ",
    zip: "85001",
    status: "not-home",
    disposition: "Not Home",
    dispositionedAt: "2026-11-01T18:00:00.000Z",
    dispositionHistory: [{
      disposition: "Not Home",
      timestamp: "2026-11-01T18:00:00.000Z",
      userId: "other-1",
      userName: "M.",
      field: { eventId: "evt-1" },
    }],
    leadType: "prospect",
    source: "import",
    solarCategory: "good",
    createdAt: "2026-11-01T00:00:00.000Z",
    ownedByMe: false,
    owners: [{ uid: "other-1", name: "M." }],
    ownerSource: "territory",
    inOtherUsersTerritory: true,
    mobileSummary: true,
    contactRedacted: true,
  };
}

test("D1-1 pin scope opens the map for a closer and homeowner scope stays on their polygons", () => {
  const territories = [{ userId: "closer-1", polygon: SQUARE }, { userId: "setter-1", polygon: SQUARE }];
  const closer = person("closer", "closer-1");
  const setter = person("setter", "setter-1");
  assert.equal(pinScopeFor(closer, territories), undefined);
  assert.deepEqual(pinScopeFor(setter, territories), [SQUARE]);
  assert.deepEqual(pinScopeFor(person("setter", "nobody"), territories), []);
  assert.equal(pinScopeFor(person("admin", "admin-1"), territories), undefined);
  assert.equal(pinScopeFor(person("manager", "manager-1"), territories), undefined);
  assert.deepEqual(homeScopeFor(closer, territories), [SQUARE]);
  assert.deepEqual(homeScopeFor(setter, territories), [SQUARE]);
  assert.equal(homeScopeFor(person("admin", "admin-1"), territories), undefined);
  assert.equal(homeScopeFor(person("manager", "manager-1"), territories), undefined);
});

test("D1-2 a closer keeps another rep's pin far outside their polygons and the view still requests", () => {
  const territories = [{ userId: "closer-1", polygon: SQUARE }];
  const closer = person("closer", "closer-1");
  const leads = [
    { id: "inside-other", ...INSIDE, claimedBy: "other-1" },
    { id: "far-other", ...FAR, claimedBy: "other-1", assignedTo: "other-1" },
  ];
  assert.deepEqual(knockMapPins(leads, pinScopeFor(closer, territories), closer).map((lead) => lead.id), ["inside-other", "far-other"]);
  assert.equal(scopedViews(VIEW_OUTSIDE, undefined).length, 1);
  const rows = rowsForOwnership<Record<string, unknown>>(UID, { ownership: "territory", leads: [redactedRow()] });
  const mapped = rows.map((row) => mapLeadDoc({ id: row.id, data: () => row }));
  assert.equal(mapped.length, 1);
  assert.equal(mapped[0]?.contactRedacted, true);
  assert.equal(inPinScope(mapped[0]?.lat, mapped[0]?.lng, pinScopeFor(closer, territories)), true);
});

test("D1-3 a setter keeps only in-polygon pins and makes no request outside them", () => {
  const territories = [{ userId: "setter-1", polygon: SQUARE }];
  const setter = person("setter", "setter-1");
  const leads = [
    { id: "inside-other", ...INSIDE, claimedBy: "other-1" },
    { id: "far-other", ...FAR, claimedBy: "other-1", assignedTo: "other-1" },
  ];
  const polygons = pinScopeFor(setter, territories);
  assert.deepEqual(knockMapPins(leads, polygons, setter).map((lead) => lead.id), ["inside-other"]);
  assert.equal(scopedViews(VIEW_OUTSIDE, polygons).length, 0);
});

test("D1-4 a closer viewport cache key carries no polygons and differs from the setter key", () => {
  const territories = [{ userId: "closer-1", polygon: SQUARE }, { userId: "setter-1", polygon: SQUARE }];
  const closerKey = JSON.stringify(["closer-1", "closer", pinScopeFor(person("closer", "closer-1"), territories)]);
  const setterKey = JSON.stringify(["setter-1", "setter", pinScopeFor(person("setter", "setter-1"), territories)]);
  assert.equal(closerKey, '["closer-1","closer",null]');
  assert.equal(closerKey.includes("lat"), false);
  assert.notEqual(closerKey, setterKey);
  assert.equal(setterKey.includes("43"), true);
});

test("D1-5 3PL visibility stays variant A and 3PL only still drops ordinary pins", () => {
  assert.equal(canSeeHotLeads(person("setter", "setter-1")), false);
  assert.equal(canSeeHotLeads(person("closer", "closer-1")), true);
  assert.deepEqual(hotOnlyLayers("only", true), {
    homeowners: false,
    heat: false,
    teamMembers: false,
    otherTerritories: false,
  });
  const widened = [
    { id: "ordinary", lat: FAR.lat, lng: FAR.lng, address: "100 Far St", city: "Town", state: "AZ", zip: "85001", status: "not-home", createdAt: new Date(), name: "" } as Lead,
    { id: "hot-1", lat: FAR.lat, lng: FAR.lng, address: "100 Far St", city: "Town", state: "AZ", zip: "85001", status: "not-home", createdAt: new Date(), name: "", hotLead: true } as Lead,
  ];
  assert.deepEqual(applyHotFilter(widened, "only").map((lead) => lead.id), ["hot-1"]);
});

test("D1-6 a redacted door renders no contact data and does not read the lead", () => {
  const secretName = "Hidden Name";
  const secretPhone = "555-0199";
  const secretEmail = "door@example.test";
  const lead = {
    ...redactedRow(),
    name: secretName,
    phone: secretPhone,
    email: secretEmail,
    notes: "private note",
    createdAt: new Date("2026-11-01T00:00:00.000Z"),
  } as Lead;
  const homeowner = {
    id: "home-1",
    address: "100 Far St",
    addressNorm: "100 FAR ST",
    municipality: "Town",
    state: "AZ",
    ownerName: secretName,
    occupancyStatus: "owner",
    mailingCity: "Town",
    mailingZip: "85001",
    propertyType: "house",
    lat: FAR.lat,
    lng: FAR.lng,
    geohash: "9tbq5",
    geohash5: "9tbq5",
  };
  const markup = renderToStaticMarkup(createElement(LeadDetail, {
    lead,
    currentUser: person("closer", "closer-1"),
    onClose: () => {},
    onUpdate: () => {},
    fieldMemory: true,
    homeowner,
    dispositionOptions: DEFAULT_DISPOSITIONS,
  }));
  assert.equal(markup.includes("tel:"), false);
  assert.equal(markup.includes("mailto:"), false);
  assert.equal(markup.includes(secretPhone), false);
  assert.equal(markup.includes(secretEmail), false);
  assert.equal(markup.includes(secretName), false);
  assert.equal(markup.includes("Homeowner record"), false);
  assert.equal(markup.includes("Homeowner information"), false);
  assert.equal(markup.includes("Loading door details"), false);
  assert.equal(markup.replace(/&#x27;/g, "'").includes(REDACTED_DOOR_NOTICE), true);
  assert.equal(markup.includes("private note"), false);
  assert.equal(markup.includes("100 Far St"), true);
  const knock = markup.slice(markup.indexOf('aria-label="NH — Not Home"'), markup.indexOf(">", markup.indexOf('aria-label="NH — Not Home"')));
  assert.equal(knock.includes("disabled"), false);
  const wrapper = read("app/components/LeadDetail.tsx");
  const fn = wrapper.slice(wrapper.indexOf("export default function LeadDetail"));
  assert.ok(fn.indexOf("if (redacted) return;") < fn.indexOf("getDoc("));
  assert.match(fn, /void getDoc\(doc\(db,'leads',id\)\)/);
  assert.match(fn, /if\(summary && \(!full \|\| full\.id!==id\) && !error && isDeviceOnline\(\)\)return <MobileDialog title="Door details"/);
  assert.match(fn, /Loading door details…/);
  assert.match(fn, /if \(redacted\) return <LeadDetailContent \{\.\.\.props\} homeowner=\{undefined\} lead=\{props\.lead\} \/>/);
});

test("D1-7 a redacted viewport row keeps no hidden contact keys for the offline area cache", () => {
  const rows = rowsForOwnership<Record<string, unknown>>("closer-1", { ownership: "territory", leads: [redactedRow()] });
  const mapped = mapLeadDoc({ id: rows[0]?.id, data: () => rows[0] });
  assert.equal(mapped.contactRedacted, true);
  const mappedRow = mapped as unknown as Record<string, unknown>;
  for (const key of HIDDEN_LEAD_KEYS) assert.equal(mappedRow[key] == null, true, key);
  const history = mapped.dispositionHistory?.[0] as Record<string, unknown> | undefined;
  assert.deepEqual(Object.keys(history ?? {}).sort(), ["disposition", "field", "timestamp", "userId", "userName"]);
  assert.deepEqual(Object.keys((history?.field as object) ?? {}).sort(), ["eventId"]);
  const stored = JSON.parse(JSON.stringify(mapped)) as Record<string, unknown>;
  for (const key of HIDDEN_LEAD_KEYS) assert.equal(Object.prototype.hasOwnProperty.call(stored, key), false, key);
});

test("D1-8 the knock page scopes pins and homeowners separately and canSeeAllLeads stays staff-only", () => {
  const page = read("app/mobile/knocking/page.tsx");
  assert.match(page, /const pinPolygons = useMemo\(\(\) => pinScopeFor\(currentUser, overlayTerritories\), \[currentUser, overlayTerritories\]\);/);
  assert.match(page, /const homePolygons = useMemo\(\(\) => homeScopeFor\(currentUser, overlayTerritories\), \[currentUser, overlayTerritories\]\);/);
  assert.match(page, /useViewportLeads\(currentUser, viewport, pinPolygons, areasReady\)/);
  assert.match(page, /pinPolygons=\{homePolygons\}/);
  const types = read("app/types/index.ts");
  assert.match(types, /contactRedacted\?: boolean;/);
  assert.match(types, /export function canSeeAllLeads\(role: UserRole\): boolean \{\n  return role === 'manager' \|\| role === 'admin';\n\}/);
  const hash = createHash("sha256").update(read("app/utils/knockCount.ts")).digest("hex");
  assert.equal(hash, KNOCK_COUNT_SHA);
  const added: string[] = [];
  const diff = execSync(`git diff -U0 ${BASE} -- app`, { cwd: root, encoding: "utf8" });
  for (const line of diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) added.push(line);
  }
  assert.equal(added.some((line) => line.includes("'sales'") || line.includes('"sales"')), false);
});

function showsClaim(markup: string): boolean {
  return />\s*Claim\s*</.test(markup);
}

function showsUnclaim(markup: string): boolean {
  return />\s*Unclaim\s*</.test(markup);
}

function doorDetail(lead: Lead, role: User["role"], id: string) {
  return renderToStaticMarkup(createElement(LeadDetail, {
    lead,
    currentUser: person(role, id),
    onClose: () => {},
    onUpdate: () => {},
    fieldMemory: true,
    dispositionOptions: DEFAULT_DISPOSITIONS,
  }));
}

function serverRedacted(withOwnership: boolean): Record<string, unknown> {
  const row: Record<string, unknown> = {
    id: "far-1",
    lat: FAR.lat,
    lng: FAR.lng,
    address: "100 Far St",
    city: "Town",
    state: "AZ",
    zip: "85001",
    status: "not-home",
    disposition: "Not Home",
    dispositionedAt: "2026-11-18T18:00:00.000Z",
    leadType: "prospect",
    source: "import",
    solarCategory: "good",
    createdAt: "2026-11-01T00:00:00.000Z",
    dispositionHistory: [{
      disposition: "Not Home",
      timestamp: "2026-11-18T18:00:00.000Z",
      userId: "other-1",
      userName: "J.",
      field: { eventId: "evt-1" },
    }],
    mobileSummary: true,
    contactRedacted: true,
  };
  if (withOwnership) {
    row.ownedByMe = false;
    row.owners = [{ uid: "other-1", name: "J." }];
    row.ownerSource = "territory";
    row.inOtherUsersTerritory = true;
  }
  return row;
}

test("D1-9 a redacted door hides claim controls and a setter summary still shows Claim", () => {
  const redacted = {
    ...serverRedacted(true),
    createdAt: new Date("2026-11-01T00:00:00.000Z"),
    owners: [{ uid: "other-1", name: "J." }],
  } as Lead;
  delete (redacted as { claimedBy?: string }).claimedBy;
  const markup = doorDetail(redacted, "closer", "closer-1");
  assert.equal(showsClaim(markup), false);
  assert.equal(showsUnclaim(markup), false);
  assert.equal(markup.includes("Claimed by"), false);
  assert.equal(markup.includes("Owner: J."), true);
  assert.match(markup, /aria-label="NH — Not Home"/);
  assert.equal(markup.replace(/&#x27;/g, "'").includes(REDACTED_DOOR_NOTICE), true);
  const bare = { ...serverRedacted(false), createdAt: new Date("2026-11-01T00:00:00.000Z") } as Lead;
  const quiet = doorDetail(bare, "closer", "closer-1");
  assert.equal(quiet.includes("Owner:"), false);
  assert.equal(quiet.includes("Claimed by"), false);
  assert.equal(showsClaim(quiet), false);
  const setterLead = {
    id: "plain-1",
    lat: INSIDE.lat,
    lng: INSIDE.lng,
    address: "1 Own St",
    city: "Town",
    state: "AZ",
    zip: "85001",
    status: "not-home",
    name: "Plain Door",
    createdAt: new Date("2026-11-01T00:00:00.000Z"),
    mobileSummary: true,
  } as Lead;
  const setterMarkup = doorDetail(setterLead, "setter", "setter-1");
  assert.equal(showsClaim(setterMarkup), true);
  assert.equal(setterMarkup.includes("Claimed by"), false);
});

test("D1-10 the PR 199 redacted shape renders a pin with or without ownership keys", () => {
  const closer = person("closer", "closer-1");
  for (const withOwnership of [true, false]) {
    const payload = serverRedacted(withOwnership);
    assert.equal("expiredGoBack" in payload, false);
    assert.equal("claimedBy" in payload, false);
    assert.equal("name" in payload, false);
    const rows = rowsForOwnership<Record<string, unknown>>("closer-1", { ownership: "territory", leads: [payload] });
    const mapped = mapLeadDoc({ id: rows[0]?.id, data: () => rows[0] });
    assert.equal(mapped.contactRedacted, true);
    assert.equal(mapped.expiredGoBack, undefined);
    const kept = knockMapPins([mapped], pinScopeFor(closer, [{ userId: "closer-1", polygon: SQUARE }]), closer);
    assert.deepEqual(kept.map((lead) => lead.id), ["far-1"]);
    const disposition = DEFAULT_DISPOSITIONS.find((row) => row.id === "not-home");
    const style = fieldPinStyle(mapped, disposition);
    assert.equal(style.exp, false);
    const artwork = fieldPinArtwork(mapped, disposition, 16);
    assert.equal(typeof artwork.url, "string");
    assert.equal(artwork.style.exp, false);
  }
});

test("D1-11 a newer redacted row replaces an older full row without reviving contact fields", () => {
  fresh();
  noteMobileLeadsMeta("closer-1", { ownership: "territory", popupExempt: false });
  const older = {
    id: "far-1",
    lat: FAR.lat,
    lng: FAR.lng,
    address: "100 Far St",
    city: "Town",
    state: "AZ",
    zip: "85001",
    status: "not-home",
    name: "Full Name",
    phone: "555-0199",
    email: "door@example.test",
    notes: "full notes",
    claimedBy: "other-1",
    createdAt: new Date("2026-11-01T00:00:00.000Z"),
    dispositionedAt: new Date("2026-11-01T12:00:00.000Z"),
    ownedByMe: false,
    owners: [{ uid: "other-1", name: "Full N." }],
  } as Lead;
  const newer = {
    ...serverRedacted(true),
    createdAt: new Date("2026-11-01T00:00:00.000Z"),
    dispositionedAt: new Date("2026-11-18T18:00:00.000Z"),
  } as Lead;
  const [merged] = mergeLeadSnapshots([older], [newer]);
  assert.equal(merged?.contactRedacted, true);
  assert.equal("name" in (merged ?? {}), false);
  assert.equal("phone" in (merged ?? {}), false);
  assert.equal("email" in (merged ?? {}), false);
  assert.equal("notes" in (merged ?? {}), false);
  assert.equal(merged?.ownedByMe, false);
});

test("D1-12 a closer knock on another rep's redacted pin counts once", () => {
  const at = Date.parse("2026-11-18T18:00:00.000Z");
  const lead = {
    ...serverRedacted(true),
    createdAt: new Date("2026-11-01T00:00:00.000Z"),
    dispositionedAt: new Date(at),
    dispositionHistory: [{
      disposition: "Not Home",
      timestamp: new Date(at),
      userId: "closer-1",
      userName: "J.",
    }],
  } as Lead;
  const ledger: KnockEvent[] = [{
    key: `far-1|closer-1|not-home|${at}`,
    leadId: "far-1",
    userId: "closer-1",
    at,
    dispositionId: "not-home",
  }];
  assert.equal(countKnocks([lead], DEFAULT_DISPOSITIONS, { userId: "closer-1" }), 1);
  assert.equal(countKnocks([lead], DEFAULT_DISPOSITIONS, { userId: "closer-1", ledger }), 1);
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
