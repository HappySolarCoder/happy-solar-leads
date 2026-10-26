import type { TerritoryPoint } from "@/app/types/territory";
import { insideTerritory } from "@/app/utils/territoryManager";
import type { LocationPosition } from "@/app/utils/geolocation";
import { ACCURACY_MAX_M, AREA_REASON_DIRECT_WRITE_SUPPORTED, type LocationPrecision } from "./gpsPolicy";
export { AREA_REASON_DIRECT_WRITE_SUPPORTED };
import { recordSyncEvent, reportParked } from "./syncDiagnostics";
import { bestFixInWindow, currentLocationPrecision } from "./warmGps";

/** Closers stay ungated until this is turned on. */
export const AREA_GATE_CLOSERS = false;
/** A rep with no territory is not blocked and is not flagged. */
export const AREA_GATE_NO_TERRITORY = "ungated" as "ungated" | "block";
/** Pending Charles. No extra reason value while this is false. */
export const AREA_FLAG_NO_TERRITORY = false;
/** Owned leads save with a hidden out_of_area flag. Pending Evan. */
export const AREA_GATE_OWNED_LEADS = "exempt" as "exempt" | "block";
export const AREA_EDGE_FLOOR_M = 30;
export const AREA_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const AREA_BLOCK_MESSAGE = "You are not in your assigned area.";

const METERS_PER_DEGREE_LAT = 111_320;

export type AreaFix = {
  lat: number;
  lng: number;
  accuracyM: number;
  reduced: boolean;
};

export type AreaDecision =
  | { action: "allow" }
  | { action: "flag"; reason: "out_of_area"; distanceM: number }
  | { action: "block"; message: typeof AREA_BLOCK_MESSAGE; distanceM: number; accuracyM: number };

type PolygonCache = {
  userId: string;
  at: number;
  polygons: TerritoryPoint[][];
};

type AreaActor = {
  id: string;
  role?: string;
  proximityOptOut: boolean;
};

const memory = new Map<string, PolygonCache>();
let actor: AreaActor | null = null;

export function noteAreaActor(user: { id: string; role?: string; features?: { proximityEnforcement?: boolean } } | null) {
  actor = user
    ? { id: user.id, role: user.role, proximityOptOut: user.features?.proximityEnforcement === false }
    : null;
}

export function currentAreaActor(): AreaActor | null {
  return actor;
}

export function resetAreaCacheForTests() {
  memory.clear();
  actor = null;
}

export function usablePolygonCache(row: PolygonCache | null | undefined, now = Date.now()): TerritoryPoint[][] | null {
  if (!row || !Array.isArray(row.polygons)) return null;
  if (!Number.isFinite(row.at) || now - row.at > AREA_CACHE_MAX_AGE_MS || now < row.at) return null;
  return row.polygons;
}

/** Remember the rep's own polygons from the team-areas response. Empty is a known answer. */
export function rememberOwnPolygons(userId: string, polygons: TerritoryPoint[][], at = Date.now()) {
  if (!userId) return;
  const row: PolygonCache = {
    userId,
    at,
    polygons: polygons.filter((polygon) => Array.isArray(polygon) && polygon.length >= 3),
  };
  memory.set(userId, row);
  void import("./deviceStore")
    .then((store) => store.putTerritoryPolygons(row))
    .catch(() => { /* an offline cache miss never blocks a knock */ });
}

export function knownPolygonsSync(userId: string, now = Date.now()): PolygonCache | null {
  const row = memory.get(userId);
  return row && usablePolygonCache(row, now) ? row : null;
}

export async function knownPolygons(userId: string, now = Date.now()): Promise<PolygonCache | null> {
  const cached = knownPolygonsSync(userId, now);
  if (cached) return cached;
  try {
    const store = await import("./deviceStore");
    const row = await store.readTerritoryPolygons(userId);
    const polygons = usablePolygonCache(row, now);
    if (!row || !polygons) return null;
    const fresh = { ...row, polygons };
    memory.set(userId, fresh);
    return fresh;
  } catch {
    return null;
  }
}

function goodFix(fix: AreaFix | null): fix is AreaFix {
  if (!fix || fix.reduced) return false;
  if (![fix.lat, fix.lng, fix.accuracyM].every(Number.isFinite)) return false;
  return fix.accuracyM >= 0 && fix.accuracyM <= ACCURACY_MAX_M;
}

function roleGated(role?: string): boolean {
  if (role === "manager" || role === "admin") return false;
  if (role === "closer") return AREA_GATE_CLOSERS;
  return role === "setter" || role === "sales";
}

type Box = { south: number; north: number; west: number; east: number };

function boxOf(polygon: TerritoryPoint[]): Box {
  let south = Infinity;
  let north = -Infinity;
  let west = Infinity;
  let east = -Infinity;
  for (const point of polygon) {
    if (point.lat < south) south = point.lat;
    if (point.lat > north) north = point.lat;
    if (point.lng < west) west = point.lng;
    if (point.lng > east) east = point.lng;
  }
  return { south, north, west, east };
}

function bboxGapMeters(lat: number, lng: number, box: Box): number {
  const metersPerDegreeLng = METERS_PER_DEGREE_LAT * Math.cos((lat * Math.PI) / 180);
  const dLat = lat < box.south ? (box.south - lat) * METERS_PER_DEGREE_LAT : lat > box.north ? (lat - box.north) * METERS_PER_DEGREE_LAT : 0;
  const dLng = lng < box.west ? (box.west - lng) * metersPerDegreeLng : lng > box.east ? (lng - box.east) * metersPerDegreeLng : 0;
  return Math.hypot(dLat, dLng);
}

/** Meters from the point to the nearest edge. A bbox farther than `best` skips the vertices. */
export function distanceToPolygonMeters(lat: number, lng: number, polygon: TerritoryPoint[], best = Infinity): number {
  if (polygon.length < 2 || !Number.isFinite(lat) || !Number.isFinite(lng)) return Infinity;
  const gap = bboxGapMeters(lat, lng, boxOf(polygon));
  if (gap >= best) return best;
  const metersPerDegreeLng = METERS_PER_DEGREE_LAT * Math.cos((lat * Math.PI) / 180);
  let min = Infinity;
  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index];
    const end = polygon[(index + 1) % polygon.length];
    const ax = (start.lng - lng) * metersPerDegreeLng;
    const ay = (start.lat - lat) * METERS_PER_DEGREE_LAT;
    const bx = (end.lng - lng) * metersPerDegreeLng;
    const by = (end.lat - lat) * METERS_PER_DEGREE_LAT;
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, (-ax * dx + -ay * dy) / lengthSquared));
    const distance = Math.hypot(ax + t * dx, ay + t * dy);
    if (distance < min) min = distance;
    if (min === 0) break;
  }
  return min;
}

export function nearestTerritoryMeters(lat: number, lng: number, polygons: TerritoryPoint[][]): { inside: boolean; distanceM: number } {
  let distanceM = Infinity;
  for (const polygon of polygons) {
    if (polygon.length < 3) continue;
    const gap = bboxGapMeters(lat, lng, boxOf(polygon));
    if (gap === 0 && insideTerritory(lat, lng, polygon)) return { inside: true, distanceM: 0 };
    if (gap >= distanceM) continue;
    const edge = distanceToPolygonMeters(lat, lng, polygon, distanceM);
    if (edge < distanceM) distanceM = edge;
  }
  return { inside: false, distanceM };
}

/** Visible block only when every gate condition holds. Otherwise allow, or flag an owned lead. */
export function evaluateAreaGate(input: {
  role?: string;
  proximityOptOut?: boolean;
  owned: boolean;
  fix: AreaFix | null;
  polygons: TerritoryPoint[][] | null;
  polygonsKnown: boolean;
}): AreaDecision {
  const allow: AreaDecision = { action: "allow" };
  if (input.proximityOptOut || !roleGated(input.role) || !goodFix(input.fix)) return allow;
  if (!input.polygonsKnown || !input.polygons) return allow;
  if (input.polygons.length === 0) {
    if (AREA_GATE_NO_TERRITORY === "ungated") {
      if (!AREA_FLAG_NO_TERRITORY) return allow;
      return { action: "flag", reason: "out_of_area", distanceM: 0 };
    }
    return { action: "block", message: AREA_BLOCK_MESSAGE, distanceM: 0, accuracyM: input.fix.accuracyM };
  }
  const nearest = nearestTerritoryMeters(input.fix.lat, input.fix.lng, input.polygons);
  if (nearest.inside) return allow;
  const limit = Math.max(input.fix.accuracyM, AREA_EDGE_FLOOR_M);
  if (!(nearest.distanceM > limit)) return allow;
  if (input.owned && AREA_GATE_OWNED_LEADS === "exempt") {
    return { action: "flag", reason: "out_of_area", distanceM: nearest.distanceM };
  }
  return { action: "block", message: AREA_BLOCK_MESSAGE, distanceM: nearest.distanceM, accuracyM: input.fix.accuracyM };
}

export function areaFixFromPosition(position: LocationPosition | null, precision: LocationPrecision): AreaFix | null {
  if (!position) return null;
  return {
    lat: position.coords.latitude,
    lng: position.coords.longitude,
    accuracyM: position.coords.accuracy,
    reduced: precision === "reduced",
  };
}

async function recordAreaRefusal(input: {
  userId: string;
  leadId: string;
  createdAt: string;
  status?: string;
  disposition?: string;
  distanceM: number;
  accuracyM: number;
}) {
  try {
    await recordSyncEvent({
      id: crypto.randomUUID(),
      userId: input.userId,
      at: Date.now(),
      draftId: `area-${crypto.randomUUID()}`,
      leadId: input.leadId,
      createdAt: input.createdAt,
      status: input.status,
      disposition: input.disposition,
      state: "parked",
      gpsUnverifiedReason: "out_of_area",
      distanceM: input.distanceM,
      gpsAccuracyM: input.accuracyM,
      lastError: AREA_BLOCK_MESSAGE,
      attempts: 0,
    });
    await reportParked(input.userId);
  } catch {
    /* A sync-report 400 must never change the knock. */
  }
}

async function refuseIfOutside(input: {
  user: { id: string; role?: string; features?: { proximityEnforcement?: boolean } };
  leadId: string;
  createdAt: string;
  status?: string;
  disposition?: string;
  owned: boolean;
  fix: AreaFix | null;
}): Promise<void> {
  const polygons = await knownPolygons(input.user.id);
  const decision = evaluateAreaGate({
    role: input.user.role,
    proximityOptOut: input.user.features?.proximityEnforcement === false,
    owned: input.owned,
    fix: input.fix,
    polygons: polygons?.polygons ?? null,
    polygonsKnown: !!polygons,
  });
  if (decision.action !== "block") return;
  await recordAreaRefusal({
    userId: input.user.id,
    leadId: input.leadId,
    createdAt: input.createdAt,
    status: input.status,
    disposition: input.disposition,
    distanceM: decision.distanceM,
    accuracyM: decision.accuracyM,
  });
  throw Error(AREA_BLOCK_MESSAGE);
}

/** Tap-time gate for a sheet knock. No fix saves. A later fix only flags. */
export async function assertAssignedAreaAtTap(input: {
  user: { id: string; role?: string; features?: { proximityEnforcement?: boolean } };
  lead: { id: string; claimedBy?: string; assignedTo?: string };
  tappedAt: number;
  status?: string;
  disposition?: string;
}): Promise<void> {
  const position = bestFixInWindow(input.tappedAt, Date.now());
  await refuseIfOutside({
    user: input.user,
    leadId: input.lead.id,
    createdAt: new Date(input.tappedAt).toISOString(),
    status: input.status,
    disposition: input.disposition,
    owned: input.lead.claimedBy === input.user.id || input.lead.assignedTo === input.user.id,
    fix: areaFixFromPosition(position, currentLocationPrecision()),
  });
}

/** Drop-pin creation uses the same gate. The new pin is not an owned lead yet. */
export async function assertDropPinArea(input: {
  user: { id: string; role?: string; features?: { proximityEnforcement?: boolean } };
  fix: LocationPosition | null;
  leadId: string;
  tappedAt: number;
}): Promise<void> {
  await refuseIfOutside({
    user: input.user,
    leadId: input.leadId,
    createdAt: new Date(input.tappedAt).toISOString(),
    owned: false,
    fix: areaFixFromPosition(input.fix, currentLocationPrecision()),
  });
}

export async function areaDecisionForDraft(input: {
  userId: string;
  role?: string;
  proximityOptOut?: boolean;
  owned: boolean;
  fix: AreaFix | null;
  now?: number;
}): Promise<AreaDecision> {
  const polygons = await knownPolygons(input.userId, input.now);
  return evaluateAreaGate({
    role: input.role,
    proximityOptOut: input.proximityOptOut,
    owned: input.owned,
    fix: input.fix,
    polygons: polygons?.polygons ?? null,
    polygonsKnown: !!polygons,
  });
}
