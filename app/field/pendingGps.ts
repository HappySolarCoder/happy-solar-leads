import type { Lead } from "@/app/types";
import type { LocationPosition } from "@/app/utils/geolocation";
import { decideKnockGps, finitePoint, outsideBy, type AreaPolygons, type KnockFix } from "@/app/utils/gpsRule";
import { currentAreaActor, knownPolygons, knownPolygonsSync } from "./areaGate";
import {
  GPS_WINDOW_AFTER_MS,
  type GpsUnverifiedReason,
  type LocationPrecision,
} from "./gpsPolicy";
import type { GpsPointSource } from "./knockPoint";
import { SYNC_REASON } from "./syncReasons";
import { recordSyncEvent, reportInBackground, reportParked } from "./syncDiagnostics";
import { bestFixInWindow, currentLocationPrecision, hadFixOutsideWindow, noteWarmFix } from "./warmGps";
import type { PendingMutation } from "./types";

const captures = new Map<string, Promise<void>>();

export type KnockEvaluation = {
  patch: Partial<Lead>;
  gpsVerified: boolean;
  reason?: GpsUnverifiedReason;
  locationPrecision: LocationPrecision;
  distanceM?: number;
  /** Meters past the territory edge. Reported only when the reason is out_of_area. */
  areaDistanceM?: number;
  accuracyM?: number;
  source?: GpsPointSource;
  keepFix: boolean;
};

function windowAnchor(m: PendingMutation): number {
  const tapped = m.direct?.gps?.tappedAt;
  if (typeof tapped === "number" && Number.isFinite(tapped)) return tapped;
  const at = new Date(m.createdAt).getTime();
  return Number.isFinite(at) ? at : Date.now();
}

function pinOf(m: PendingMutation): { lat?: number; lng?: number } {
  const gps = m.direct?.gps;
  return { lat: gps?.lat, lng: gps?.lng };
}

function clientFix(fix: LocationPosition | null): KnockFix | "absent" | "malformed" {
  if (!fix) return "absent";
  const lat = fix.coords?.latitude;
  const lng = fix.coords?.longitude;
  const accuracyM = fix.coords?.accuracy;
  if (typeof lat !== "number" || typeof lng !== "number" || typeof accuracyM !== "number") return "malformed";
  if (fix.timestamp != null && !Number.isFinite(fix.timestamp)) return "malformed";
  const point: KnockFix = { lat, lng, accuracyM };
  if (Number.isFinite(fix.timestamp)) point.capturedAtMs = fix.timestamp;
  return point;
}

export function evaluateKnockFix(
  m: PendingMutation,
  fix: LocationPosition | null,
  options: {
    now?: number;
    precision?: LocationPrecision;
    stale?: boolean;
    role?: string;
    polygons?: AreaPolygons;
  } = {},
): KnockEvaluation {
  const at = windowAnchor(m);
  const precision = options.precision ?? currentLocationPrecision();
  const source = m.direct?.gps?.source;
  const empty = (reason: GpsUnverifiedReason, keepFix = false): KnockEvaluation => ({
    patch: { gpsVerified: false, gpsUnverifiedReason: reason },
    gpsVerified: false,
    reason,
    locationPrecision: precision,
    accuracyM: fix?.coords.accuracy,
    source,
    keepFix,
  });
  try {
    if (!fix && options.stale) return empty("stale");
    const pin = pinOf(m);
    const reference = finitePoint(pin.lat, pin.lng);
    const decision = decideKnockGps({
      fix: clientFix(fix),
      actionAtMs: at,
      reference,
      role: options.role,
      polygons: options.polygons,
    });
    const patch: Partial<Lead> = { gpsVerified: decision.gpsVerified };
    if (!decision.gpsVerified && decision.gpsUnverifiedReason) patch.gpsUnverifiedReason = decision.gpsUnverifiedReason;
    if (decision.keepFix && fix && Number.isFinite(fix.coords.latitude) && Number.isFinite(fix.coords.longitude)) {
      patch.knockGpsLat = fix.coords.latitude;
      patch.knockGpsLng = fix.coords.longitude;
      patch.knockGpsAccuracy = fix.coords.accuracy;
      if (Number.isFinite(fix.timestamp)) patch.knockGpsTimestamp = new Date(fix.timestamp);
    }
    if (decision.gpsDistanceM != null) {
      patch.gpsDistanceM = decision.gpsDistanceM;
      patch.knockDistanceFromAddress = decision.gpsDistanceM;
    }
    let areaDistanceM: number | undefined;
    if (decision.gpsUnverifiedReason === "out_of_area" && Array.isArray(options.polygons) && fix) {
      const point = finitePoint(fix.coords.latitude, fix.coords.longitude);
      if (point) {
        let nearest = Infinity;
        for (const polygon of options.polygons) {
          const distance = outsideBy(point, polygon);
          if (distance < nearest) nearest = distance;
        }
        if (Number.isFinite(nearest)) areaDistanceM = nearest;
      }
    }
    return {
      patch,
      gpsVerified: decision.gpsVerified,
      ...(!decision.gpsVerified ? { reason: decision.gpsUnverifiedReason } : {}),
      locationPrecision: precision,
      distanceM: decision.gpsDistanceM,
      ...(areaDistanceM == null ? {} : { areaDistanceM }),
      accuracyM: fix?.coords.accuracy,
      source,
      keepFix: decision.keepFix,
    };
  } catch {
    return empty("no_fix");
  }
}

function applyResult(m: PendingMutation, evaluation: KnockEvaluation): PendingMutation {
  const patch = { ...(m.direct?.patch || {}), ...evaluation.patch };
  if (evaluation.gpsVerified) delete patch.gpsUnverifiedReason;
  const direct = { ...(m.direct || { patch }), patch };
  delete direct.gps;
  const next: PendingMutation = { ...m, syncState: "queued", direct };
  delete next.blocked;
  delete next.error;
  delete next.parkedReason;
  delete next.lastError;
  return next;
}

async function logUnverified(m: PendingMutation, evaluation: KnockEvaluation) {
  if (evaluation.gpsVerified || !evaluation.reason) return;
  await recordSyncEvent({
    id: crypto.randomUUID(),
    userId: m.userId,
    at: Date.now(),
    draftId: m.id,
    leadId: m.leadId,
    createdAt: m.createdAt,
    status: m.status,
    disposition: m.disposition,
    state: "flagged",
    parkedReason: SYNC_REASON.gpsUnverifiedFlagged,
    gpsUnverifiedReason: evaluation.reason,
    locationPrecision: evaluation.locationPrecision,
    distanceM: evaluation.reason === "out_of_area" && evaluation.areaDistanceM != null ? evaluation.areaDistanceM : evaluation.distanceM,
    gpsAccuracyM: evaluation.accuracyM,
    gpsPointSource: evaluation.source,
    attempts: m.attempts ?? 0,
  });
  reportInBackground(() => reportParked(m.userId));
}

function pageHidden(): boolean {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}

/** Attach the best in-window fix, or flag the knock. Never parks and never throws for GPS. */
export function stageKnockGps(m: PendingMutation, now = Date.now()): PendingMutation {
  const gps = m.direct?.gps;
  if (!gps) return { ...m, syncState: m.syncState ?? "queued" };
  const at = windowAnchor(m);
  if (now < at + GPS_WINDOW_AFTER_MS && now <= gps.deadline) return { ...m, syncState: "gps" };
  const fix = bestFixInWindow(at, now);
  const actor = currentAreaActor();
  const evaluation = evaluateKnockFix(m, fix, {
    now,
    stale: hadFixOutsideWindow(at, now),
    role: actor?.id === m.userId ? actor.role : undefined,
    polygons: actor?.id === m.userId ? knownPolygonsSync(m.userId)?.polygons : undefined,
  });
  const next = applyResult(m, evaluation);
  if (!evaluation.gpsVerified) void logUnverified(next, evaluation);
  return next;
}

/**
 * Persist first. The window is anchored at the tap. A background, a kill, or a
 * missing fix flags no_fix instead of failing, and does not block the dispo.
 */
export function resolveDraftGps(m: PendingMutation, deps: {
  read: () => Promise<PendingMutation[]>;
  put: (m: PendingMutation) => Promise<unknown>;
  active: () => boolean;
  locate?: () => Promise<LocationPosition>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  backgrounded?: () => boolean;
  precision?: LocationPrecision;
}): Promise<void> {
  if (!m.direct?.gps || !deps.active()) return Promise.resolve();
  const running = captures.get(m.id);
  if (running) return running;
  const task = (async () => {
    const now = () => deps.now?.() ?? Date.now();
    const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); }));
    const at = windowAnchor(m);
    const deadline = Math.min(m.direct?.gps?.deadline ?? at + GPS_WINDOW_AFTER_MS, at + GPS_WINDOW_AFTER_MS);
    const interrupted = () => deps.backgrounded?.() === true || pageHidden();
    try {
      if (!interrupted() && now() < deadline && deps.locate) {
        try {
          noteWarmFix(await deps.locate());
        } catch { /* no fresh reading; the buffer may still hold the map watch */ }
      }
      const left = deadline - now();
      if (!interrupted() && left > 0) await sleep(left);
    } catch { /* ending the wait is not a failed knock */ }
    if (!deps.active()) return;
    const current = (await deps.read()).find((draft) => draft.id === m.id);
    if (!current?.direct?.gps || !deps.active()) return;
    const clock = now();
    const anchor = windowAnchor(current);
    const buffered = bestFixInWindow(anchor, clock);
    const fix = interrupted() && !buffered ? null : buffered;
    const precision = deps.precision ?? currentLocationPrecision();
    const signedIn = currentAreaActor();
    const polygons = signedIn?.id === current.userId ? (await knownPolygons(current.userId, clock))?.polygons : undefined;
    const evaluation = evaluateKnockFix(current, fix, {
      now: clock,
      precision,
      stale: !fix && !interrupted() && hadFixOutsideWindow(anchor, clock),
      role: signedIn?.id === current.userId ? signedIn.role : undefined,
      polygons,
    });
    if (interrupted() && !fix) {
      evaluation.gpsVerified = false;
      evaluation.reason = "no_fix";
      evaluation.patch = { gpsVerified: false, gpsUnverifiedReason: "no_fix" };
    }
    const next = applyResult(current, evaluation);
    await deps.put(next);
    if (!evaluation.gpsVerified) await logUnverified(next, evaluation);
  })();
  captures.set(m.id, task);
  void task.finally(() => { if (captures.get(m.id) === task) captures.delete(m.id); }).catch(() => {});
  return task;
}

/** Fields stored on a dropped pin. Uses the fix's own timestamp and always includes distance when the pin has a point. */
export function droppedPinGps(
  position: LocationPosition,
  pinLat?: number,
  pinLng?: number,
  precision: LocationPrecision = "precise",
): Partial<Lead> {
  const draft = {
    id: "drop",
    userId: "rep",
    leadId: "drop",
    createdAt: new Date(position.timestamp).toISOString(),
    kind: "knock",
    baseStatus: "available",
    direct: {
      patch: {},
      gps: {
        ...(Number.isFinite(pinLat) ? { lat: pinLat } : {}),
        ...(Number.isFinite(pinLng) ? { lng: pinLng } : {}),
        deadline: position.timestamp + GPS_WINDOW_AFTER_MS,
        required: true,
        tappedAt: position.timestamp,
        source: "lead_stored" as const,
      },
    },
  } as PendingMutation;
  return evaluateKnockFix(draft, position, { now: position.timestamp + 1, precision, stale: false }).patch;
}
