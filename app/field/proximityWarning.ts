import type { LocationPosition } from "@/app/utils/geolocation";
import { GPS_CAPTURE_BEFORE_MS } from "@/app/utils/gpsRule";
import { evaluateKnockFix } from "./pendingGps";
import type { PendingMutation } from "./types";

/** Confirmed by Evan on Oct 25, 2026. The warning is on for every role that is not opted out. */
export const PROXIMITY_WARNING_ENABLED = true;
export const PROXIMITY_WARNING_MESSAGE = "You are not close to the home. You can mark this home, but leadership will be notified.";
export const PROXIMITY_WARNING_CONFIRM = "Mark it anyway";
export const PROXIMITY_WARNING_CANCEL = "Cancel";

export class ProximityWarningCancelled extends Error {
  constructor() {
    super("Proximity warning cancelled.");
    this.name = "ProximityWarningCancelled";
  }
}

export function isProximityWarningCancelled(error: unknown): boolean {
  return error instanceof ProximityWarningCancelled;
}

export type ProximityCapturedAt = "fresh" | "stale" | "missing" | "late";

export type ProximityVerdict = {
  reason?: string;
  keepFix: boolean;
  capturedAt: ProximityCapturedAt;
  optOut: boolean;
};

/**
 * True only for a usable, in-window too_far fix. Opt-out hides it.
 * no_fix, stale, low_accuracy, reduced_accuracy, out_of_area, other, and a
 * fix that arrives after the tap stay hidden flags.
 */
export function shouldShowProximityWarning(verdict: ProximityVerdict, enabled = PROXIMITY_WARNING_ENABLED): boolean {
  return enabled
    && !verdict.optOut
    && verdict.reason === "too_far"
    && verdict.keepFix
    && verdict.capturedAt === "fresh";
}

const openTaps = new Set<string>();

export function resetProximityWarningsForTests() {
  openTaps.clear();
}

/** The fix already in hand at the tap. A later reading is `late` and does not warn. */
export function proximityVerdictAtTap(input: {
  fix: LocationPosition | null;
  tappedAt: number;
  pin?: { lat?: number; lng?: number } | null;
  role?: string;
  optOut: boolean;
  polygons?: ReadonlyArray<ReadonlyArray<{ lat: number; lng: number }>> | null;
}): ProximityVerdict {
  const capturedAt: ProximityCapturedAt = !input.fix || !Number.isFinite(input.fix.timestamp)
    ? "missing"
    : input.fix.timestamp > input.tappedAt
      ? "late"
      : input.fix.timestamp < input.tappedAt - GPS_CAPTURE_BEFORE_MS
        ? "stale"
        : "fresh";
  const draft = {
    id: "tap",
    userId: "rep",
    leadId: "tap",
    createdAt: new Date(input.tappedAt).toISOString(),
    kind: "knock",
    baseStatus: "available",
    direct: {
      patch: {},
      gps: {
        ...(Number.isFinite(input.pin?.lat) ? { lat: input.pin?.lat } : {}),
        ...(Number.isFinite(input.pin?.lng) ? { lng: input.pin?.lng } : {}),
        tappedAt: input.tappedAt,
        deadline: input.tappedAt,
        required: true,
      },
    },
  } as PendingMutation;
  const evaluation = evaluateKnockFix(draft, input.fix, {
    now: Math.max(input.tappedAt, input.fix?.timestamp ?? input.tappedAt),
    role: input.role,
    polygons: input.polygons ?? undefined,
  });
  return {
    reason: evaluation.reason,
    keepFix: evaluation.keepFix,
    capturedAt,
    optOut: input.optOut,
  };
}

/**
 * Area check runs first. A block throws before the dialog opens.
 * Cancel writes nothing. Confirm calls save once, with the tap the caller already captured.
 * A second call for the same tap while the dialog is open does not ask again.
 */
export async function saveWithProximityWarning<T>(input: {
  /** Stable for one door or one dropped pin, so a double-tap cannot open a second dialog. */
  guardId: string;
  checkArea: () => Promise<void>;
  verdict: ProximityVerdict;
  ask: (message: string) => Promise<boolean>;
  save: () => Promise<T>;
}): Promise<T> {
  await input.checkArea();
  if (shouldShowProximityWarning(input.verdict)) {
    if (openTaps.has(input.guardId)) throw new ProximityWarningCancelled();
    openTaps.add(input.guardId);
    try {
      const confirmed = await input.ask(PROXIMITY_WARNING_MESSAGE);
      if (!confirmed) throw new ProximityWarningCancelled();
    } finally {
      openTaps.delete(input.guardId);
    }
  }
  return input.save();
}
