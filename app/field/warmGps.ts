import { Capacitor } from "@capacitor/core";
import { Geolocation } from "@capacitor/geolocation";
import { watchLocation, type LocationPosition } from "@/app/utils/geolocation";
import { GPS_WINDOW_AFTER_MS, GPS_WINDOW_BEFORE_MS, precisionFromSignals, type LocationPrecision } from "./gpsPolicy";
import { appBuildLabel, recordSyncEvent } from "./syncDiagnostics";

let newest: LocationPosition | null = null;
let samples: LocationPosition[] = [];
let users = 0;
let stop: (() => Promise<void>) | undefined;
let starting = false;
let androidCoarseOnly = false;
let precision: LocationPrecision = "unknown";

function valid(position: LocationPosition): boolean {
  const { latitude, longitude, accuracy } = position.coords;
  return [latitude, longitude, accuracy, position.timestamp].every(Number.isFinite)
    && Math.abs(latitude) <= 90
    && Math.abs(longitude) <= 180
    && accuracy >= 0;
}

export function currentLocationPrecision(): LocationPrecision {
  return precision;
}

export function coarseOnlyFromPermissions(status: { coarseLocation?: string; location?: string } | null | undefined): boolean {
  return status?.coarseLocation === "granted" && status.location !== "granted";
}

/** Android coarse-only permission is reduced accuracy even when the reported error is small. */
export function noteAndroidPermissions(status: { coarseLocation?: string; location?: string } | null | undefined): LocationPrecision {
  androidCoarseOnly = coarseOnlyFromPermissions(status);
  precision = precisionFromSignals({
    platform: "android",
    accuracy: newest?.coords.accuracy,
    androidCoarseOnly,
  });
  if (androidCoarseOnly) {
    void recordSyncEvent({
      id: crypto.randomUUID(),
      userId: "device",
      at: Date.now(),
      draftId: "precision",
      leadId: "device",
      createdAt: new Date().toISOString(),
      state: "noted",
      locationPrecision: "reduced",
      platform: "android",
      appBuild: appBuildLabel(),
      ...(newest ? { gpsAccuracyM: newest.coords.accuracy } : {}),
      gpsUnverifiedReason: "reduced_accuracy",
    });
  }
  return precision;
}

export function noteWarmFix(position: LocationPosition) {
  if (!valid(position)) return;
  if (!newest || position.timestamp >= newest.timestamp) newest = position;
  samples.push(position);
  const cutoff = position.timestamp - GPS_WINDOW_BEFORE_MS - GPS_WINDOW_AFTER_MS;
  samples = samples.filter((sample) => sample.timestamp >= cutoff).slice(-80);
  const platform = devicePlatform();
  const nextPrecision = precisionFromSignals({
    platform,
    accuracy: position.coords.accuracy,
    androidCoarseOnly,
  });
  const becameReduced = nextPrecision === "reduced" && precision !== "reduced";
  precision = nextPrecision;
  if (becameReduced) {
    void recordSyncEvent({
      id: crypto.randomUUID(),
      userId: "device",
      at: Date.now(),
      draftId: "precision",
      leadId: "device",
      createdAt: new Date().toISOString(),
      state: "noted",
      locationPrecision: "reduced",
      platform,
      appBuild: appBuildLabel(),
      gpsAccuracyM: position.coords.accuracy,
      gpsUnverifiedReason: "reduced_accuracy",
    });
  }
}

/** Lowest accuracy (most precise) fix whose timestamp is inside [at−30s, at+15s]. */
export function bestFixInWindow(at: number, now = Date.now()): LocationPosition | null {
  const start = at - GPS_WINDOW_BEFORE_MS;
  const end = Math.min(now, at + GPS_WINDOW_AFTER_MS);
  const eligible = samples.filter((sample) => sample.timestamp >= start && sample.timestamp <= end);
  if (!eligible.length) return null;
  return eligible.reduce((best, sample) => {
    if (sample.coords.accuracy < best.coords.accuracy) return sample;
    if (sample.coords.accuracy === best.coords.accuracy && sample.timestamp > best.timestamp) return sample;
    return best;
  });
}

export function hadFixOutsideWindow(at: number, now = Date.now()): boolean {
  if (bestFixInWindow(at, now)) return false;
  return newest != null;
}

/** @deprecated Use bestFixInWindow. Kept so older callers read the best sample, not the first. */
export function peekWarmFix(at: number, now = Date.now()): LocationPosition | null {
  return bestFixInWindow(at, now);
}

export function resetWarmGpsForTests() {
  newest = null;
  samples = [];
  users = 0;
  stop = undefined;
  starting = false;
  androidCoarseOnly = false;
  precision = "unknown";
}

export function devicePlatform(): "ios" | "android" | "web" {
  try {
    const platform = Capacitor.getPlatform();
    if (platform === "ios" || platform === "android") return platform;
  } catch { /* tests */ }
  return "web";
}

async function refreshCoarsePermission() {
  if (devicePlatform() !== "android") return;
  try {
    noteAndroidPermissions(await Geolocation.checkPermissions());
  } catch { /* permission lookup never blocks a knock */ }
}

/** Keep a high-accuracy watch while a pin sheet is open. The map watch feeds the same buffer. */
export function beginWarmGps(): () => void {
  users += 1;
  if (users === 1 && !stop && !starting) {
    starting = true;
    void refreshCoarsePermission();
    void watchLocation(
      (position) => noteWarmFix(position),
      () => {},
      { enableHighAccuracy: true, timeout: 15000 },
    ).then((cleanup) => {
      starting = false;
      if (users === 0) void cleanup();
      else stop = cleanup;
    });
  }
  let closed = false;
  return () => {
    if (closed) return;
    closed = true;
    users = Math.max(0, users - 1);
    if (users === 0 && stop) {
      const cleanup = stop;
      stop = undefined;
      void cleanup();
    }
  };
}
