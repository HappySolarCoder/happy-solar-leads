import test from "node:test";
import assert from "node:assert/strict";
import type { TerritoryPoint } from "../../app/types/territory";
import {
  AREA_BLOCK_MESSAGE,
  AREA_CACHE_MAX_AGE_MS,
  AREA_EDGE_FLOOR_M,
  AREA_FLAG_NO_TERRITORY,
  AREA_GATE_CLOSERS,
  AREA_GATE_NO_TERRITORY,
  AREA_GATE_OWNED_LEADS,
  AREA_REASON_DIRECT_WRITE_SUPPORTED,
  assertDropPinArea,
  distanceToPolygonMeters,
  evaluateAreaGate,
  knownPolygons,
  nearestTerritoryMeters,
  noteAreaActor,
  rememberOwnPolygons,
  resetAreaCacheForTests,
  usablePolygonCache,
  type AreaFix,
} from "../../app/field/areaGate";
import { directPatch } from "../../app/field/directWrites";
import { classifyKnock } from "../../app/field/gpsPolicy";
import { resolveDraftGps } from "../../app/field/pendingGps";
import { readSyncLog, reportParked, resetSyncLogForTests, syncReportItem } from "../../app/field/syncDiagnostics";
import { noteWarmFix, resetWarmGpsForTests } from "../../app/field/warmGps";
import type { PendingMutation } from "../../app/field/types";

const METERS = 111_320;

function square(south: number, west: number, size = 0.01): TerritoryPoint[] {
  return [
    { lat: south, lng: west },
    { lat: south + size, lng: west },
    { lat: south + size, lng: west + size },
    { lat: south, lng: west + size },
  ];
}

function northOf(polygon: TerritoryPoint[], meters: number): AreaFix {
  const north = Math.max(...polygon.map((point) => point.lat));
  const west = Math.min(...polygon.map((point) => point.lng));
  const east = Math.max(...polygon.map((point) => point.lng));
  return {
    lat: north + meters / METERS,
    lng: (west + east) / 2,
    accuracyM: 10,
    reduced: false,
  };
}

const home = square(43, -77);
const setter = { role: "setter" as const, owned: false, polygons: [home], polygonsKnown: true };

test("proximity boundaries, malformed fixes, and reason order never throw", () => {
  assert.equal(classifyKnock({ hasFix: true, inWindow: true, hadStaleFix: false, accuracyM: 15, distanceM: 50, precision: "precise" }).gpsVerified, true);
  const far = classifyKnock({ hasFix: true, inWindow: true, hadStaleFix: false, accuracyM: 15, distanceM: 51, precision: "precise" });
  assert.equal(far.gpsVerified, false);
  if (!far.gpsVerified) assert.equal(far.reason, "too_far");
  const low = classifyKnock({ hasFix: true, inWindow: true, hadStaleFix: false, accuracyM: 66, distanceM: 0, precision: "precise" });
  if (!low.gpsVerified) assert.equal(low.reason, "low_accuracy");
  for (const accuracyM of [Number.NaN, -5]) {
    const outcome = classifyKnock({ hasFix: true, inWindow: true, hadStaleFix: true, accuracyM, distanceM: Number.NaN, precision: "precise", malformed: !Number.isFinite(accuracyM) });
    assert.equal(outcome.gpsVerified, false);
    if (!outcome.gpsVerified) assert.equal(outcome.reason, "no_fix");
  }
  const order = [
    classifyKnock({ hasFix: false, inWindow: false, hadStaleFix: false, precision: "precise", outsideArea: true }),
    classifyKnock({ hasFix: true, inWindow: false, hadStaleFix: false, accuracyM: 5, distanceM: 1, precision: "precise", outsideArea: true }),
    classifyKnock({ hasFix: true, inWindow: true, hadStaleFix: false, accuracyM: 66, distanceM: 1, precision: "precise", outsideArea: true }),
    classifyKnock({ hasFix: true, inWindow: true, hadStaleFix: false, accuracyM: 5, distanceM: 1, precision: "reduced", outsideArea: true }),
    classifyKnock({ hasFix: true, inWindow: true, hadStaleFix: false, accuracyM: 5, distanceM: 80, precision: "precise", outsideArea: true }),
    classifyKnock({ hasFix: true, inWindow: true, hadStaleFix: false, accuracyM: 5, distanceM: 80, precision: "precise" }),
  ];
  assert.deepEqual(order.map((outcome) => outcome.gpsVerified ? "verified" : outcome.reason), [
    "no_fix",
    "stale",
    "low_accuracy",
    "reduced_accuracy",
    "out_of_area",
    "too_far",
  ]);
});

test("the area gate blocks only a good fix outside every assigned polygon", () => {
  assert.equal(AREA_GATE_NO_TERRITORY, "ungated");
  assert.equal(AREA_FLAG_NO_TERRITORY, false);
  assert.equal(AREA_GATE_OWNED_LEADS, "exempt");
  assert.equal(AREA_GATE_CLOSERS, false);
  assert.equal(AREA_REASON_DIRECT_WRITE_SUPPORTED, false);
  assert.equal(AREA_EDGE_FLOOR_M, 30);
  const inside = evaluateAreaGate({ ...setter, fix: { lat: 43.005, lng: -76.995, accuracyM: 10, reduced: false } });
  assert.equal(inside.action, "allow");
  const near = evaluateAreaGate({ ...setter, fix: northOf(home, 10) });
  assert.equal(near.action, "allow");
  const outside = northOf(home, 80);
  const measured = distanceToPolygonMeters(outside.lat, outside.lng, home);
  assert.ok(Math.abs(measured - 80) < 2, `edge distance ${measured}`);
  const blocked = evaluateAreaGate({ ...setter, fix: outside });
  assert.equal(blocked.action, "block");
  if (blocked.action === "block") {
    assert.equal(blocked.message, "You are not in your assigned area.");
    assert.equal(blocked.message, AREA_BLOCK_MESSAGE);
    assert.ok(blocked.distanceM > 30);
  }
  const union = evaluateAreaGate({
    ...setter,
    polygons: [home, square(outside.lat - 0.001, outside.lng - 0.001, 0.002)],
    fix: outside,
  });
  assert.equal(union.action, "allow");
  assert.equal(nearestTerritoryMeters(43.005, -76.995, [home]).inside, true);
  for (const role of ["manager", "admin", "closer"] as const) {
    assert.equal(evaluateAreaGate({ ...setter, role, fix: outside }).action, "allow", role);
  }
  assert.equal(evaluateAreaGate({ ...setter, role: "sales", fix: outside }).action, "block");
  const none = evaluateAreaGate({ ...setter, polygons: [], fix: outside });
  assert.equal(none.action, "allow");
  const unknown = evaluateAreaGate({ ...setter, polygonsKnown: false, polygons: null, fix: outside });
  assert.equal(unknown.action, "allow");
  const owned = evaluateAreaGate({ ...setter, owned: true, fix: outside });
  assert.equal(owned.action, "flag");
  if (owned.action === "flag") assert.equal(owned.reason, "out_of_area");
  assert.equal(evaluateAreaGate({ ...setter, fix: { ...outside, accuracyM: 66 } }).action, "allow");
  assert.equal(evaluateAreaGate({ ...setter, fix: { ...outside, reduced: true } }).action, "allow");
  assert.equal(evaluateAreaGate({ ...setter, fix: { ...outside, accuracyM: -1 } }).action, "allow");
  assert.equal(evaluateAreaGate({ ...setter, fix: { lat: Number.NaN, lng: -77, accuracyM: 5, reduced: false } }).action, "allow");
  assert.equal(evaluateAreaGate({ ...setter, proximityOptOut: true, fix: outside }).action, "allow");
  assert.equal(directPatch({ gpsVerified: false, gpsUnverifiedReason: "out_of_area" }).gpsUnverifiedReason, "too_far");
});

test("a fresh polygon cache can block and a stale cache cannot", async () => {
  resetAreaCacheForTests();
  const staleAt = Date.now() - AREA_CACHE_MAX_AGE_MS - 1_000;
  rememberOwnPolygons("rep", [home], staleAt);
  assert.equal(usablePolygonCache({ userId: "rep", at: staleAt, polygons: [home] }), null);
  assert.equal(await knownPolygons("rep"), null);
  resetAreaCacheForTests();
  rememberOwnPolygons("rep", [home]);
  const cached = await knownPolygons("rep");
  assert.equal(cached?.polygons.length, 1);
  const blocked = evaluateAreaGate({
    role: "setter",
    owned: false,
    fix: northOf(home, 80),
    polygons: cached?.polygons ?? null,
    polygonsKnown: !!cached,
  });
  assert.equal(blocked.action, "block");
});

test("a fix that arrives after the tap flags out_of_area and does not un-save", async () => {
  resetWarmGpsForTests();
  resetAreaCacheForTests();
  resetSyncLogForTests();
  noteAreaActor({ id: "rep", role: "setter" });
  rememberOwnPolygons("rep", [square(44, -77)]);
  const tap = Date.now();
  noteWarmFix({ timestamp: tap, coords: { latitude: 43, longitude: -77, accuracy: 8 } });
  const pending: PendingMutation = {
    id: "late-fix",
    userId: "rep",
    userName: "Rep",
    leadId: "lead-1",
    createdAt: new Date(tap).toISOString(),
    kind: "knock",
    baseStatus: "claimed",
    status: "not-home",
    disposition: "Not Home",
    syncState: "gps",
    attempts: 0,
    direct: {
      patch: { status: "not-home" },
      gps: { lat: 43, lng: -77, tappedAt: tap, deadline: tap + 15_000, required: true, areaOwned: false },
    },
  };
  let saved: PendingMutation | undefined;
  await resolveDraftGps(pending, {
    read: async () => [pending],
    put: async (draft) => { saved = draft; },
    active: () => true,
    sleep: async () => {},
    now: () => tap + 20_000,
    precision: "precise",
    locate: async () => ({ timestamp: tap, coords: { latitude: 43, longitude: -77, accuracy: 8 } }),
  });
  assert.equal(saved?.syncState, "queued");
  assert.equal(saved?.direct?.patch.status, "not-home");
  assert.equal(saved?.direct?.patch.gpsVerified, false);
  assert.equal(saved?.direct?.patch.gpsUnverifiedReason, "out_of_area");
  assert.equal(saved?.blocked, undefined);
});

test("a drop pin outside the area is refused with the exact message and a sync-report", async () => {
  resetAreaCacheForTests();
  resetSyncLogForTests();
  rememberOwnPolygons("rep", [home]);
  const tappedAt = Date.now();
  await assert.rejects(
    () => assertDropPinArea({
      user: { id: "rep", role: "setter" },
      fix: { timestamp: tappedAt, coords: { latitude: northOf(home, 80).lat, longitude: northOf(home, 80).lng, accuracy: 10 } },
      leadId: "drop-1",
      tappedAt,
    }),
    (error: Error) => error.message === AREA_BLOCK_MESSAGE,
  );
  const events = await readSyncLog("rep");
  const refusal = events.find((event) => event.gpsUnverifiedReason === "out_of_area" && event.state === "parked");
  assert.ok(refusal);
  const item = syncReportItem(refusal!);
  assert.equal(item.reasonCode, "out_of_area");
  assert.equal(item.outcome, "refused");
  assert.equal(item.gpsAccuracyM, 10);
  assert.ok((item.distanceM || 0) > 30);
  const posted = await reportParked("rep", {
    probe: async () => 204,
    post: async () => ({ status: 400, body: { error: "Invalid report", field: "reports" } }),
  });
  assert.equal(posted.status, 400);
  assert.equal(posted.sent, 0);
});
