import test from "node:test";
import assert from "node:assert/strict";
import { AREA_BLOCK_MESSAGE } from "../../app/field/areaGate";
import { knockPatch } from "../../app/field/knockPatch";
import {
  PROXIMITY_WARNING_CANCEL,
  PROXIMITY_WARNING_CONFIRM,
  PROXIMITY_WARNING_ENABLED,
  PROXIMITY_WARNING_MESSAGE,
  isProximityWarningCancelled,
  proximityVerdictAtTap,
  resetProximityWarningsForTests,
  saveWithProximityWarning,
  shouldShowProximityWarning,
  type ProximityVerdict,
} from "../../app/field/proximityWarning";
import { DEFAULT_DISPOSITIONS } from "../../app/types/disposition";
import type { Lead, User } from "../../app/types";

const tooFar: ProximityVerdict = { reason: "too_far", keepFix: true, capturedAt: "fresh", optOut: false };
const user = { id: "rep", name: "Rep" } as User;
const disposition = DEFAULT_DISPOSITIONS.find((item) => item.id === "not-home")!;
const lead = { id: "door", status: "claimed", dispositionHistory: [] } as unknown as Lead;

test("the warning is the exact sentence and only appears for an in-window too_far fix", () => {
  assert.equal(PROXIMITY_WARNING_ENABLED, true);
  assert.equal(PROXIMITY_WARNING_MESSAGE, "You are not close to the home. You can mark this home, but leadership will be notified.");
  assert.equal(PROXIMITY_WARNING_CONFIRM, "Mark it anyway");
  assert.equal(PROXIMITY_WARNING_CANCEL, "Cancel");
  const reasons = ["no_fix", "stale", "low_accuracy", "reduced_accuracy", "out_of_area", "other", "too_far"];
  for (const reason of reasons) {
    assert.equal(shouldShowProximityWarning({ reason, keepFix: true, capturedAt: "fresh", optOut: false }), reason === "too_far", reason);
  }
  assert.equal(shouldShowProximityWarning({ ...tooFar, keepFix: false }), false);
  assert.equal(shouldShowProximityWarning({ ...tooFar, capturedAt: "stale" }), false);
  assert.equal(shouldShowProximityWarning({ ...tooFar, capturedAt: "missing" }), false);
  assert.equal(shouldShowProximityWarning({ ...tooFar, capturedAt: "late" }), false);
  assert.equal(shouldShowProximityWarning({ ...tooFar, optOut: true }), false);
  for (const role of ["setter", "closer", "manager", "admin"]) {
    assert.equal(shouldShowProximityWarning(tooFar), true, role);
  }
});

test("Cancel writes nothing and Mark it anyway keeps today's draft and the original tap", async () => {
  resetProximityWarningsForTests();
  const tappedAt = new Date("2026-10-25T12:00:00.000Z");
  const today = knockPatch(lead, user, user.id, disposition, tappedAt, {
    gpsVerified: false,
    gpsUnverifiedReason: "too_far",
    gpsDistanceM: 80,
  });
  let saves = 0;
  let reports = 0;
  await assert.rejects(
    () => saveWithProximityWarning({
      guardId: "cancel",
      checkArea: async () => {},
      verdict: tooFar,
      ask: async (message) => {
        assert.equal(message, PROXIMITY_WARNING_MESSAGE);
        return false;
      },
      save: async () => {
        saves += 1;
        reports += 1;
      },
    }),
    isProximityWarningCancelled,
  );
  assert.equal(saves, 0);
  assert.equal(reports, 0);

  const saved = await saveWithProximityWarning({
    guardId: "confirm",
    checkArea: async () => {},
    verdict: tooFar,
    ask: async () => true,
    save: async () => knockPatch(lead, user, user.id, disposition, tappedAt, {
      gpsVerified: false,
      gpsUnverifiedReason: "too_far",
      gpsDistanceM: 80,
    }),
  });
  assert.deepEqual(saved, today);
  assert.equal(saved.dispositionHistory?.[0]?.userId, user.id);
  assert.equal(saved.dispositionedAt, tappedAt);
  assert.equal(saved.dispositionHistory?.[0]?.gpsFlag?.gpsUnverifiedReason, "too_far");
});

test("one dialog per tap, and the area block wins", async () => {
  resetProximityWarningsForTests();
  let asks = 0;
  let release: (confirmed: boolean) => void = () => {};
  const first = saveWithProximityWarning({
    guardId: "door",
    checkArea: async () => {},
    verdict: tooFar,
    ask: () => {
      asks += 1;
      return new Promise<boolean>((resolve) => {
        release = resolve;
      });
    },
    save: async () => "saved",
  });
  await Promise.resolve();
  await assert.rejects(
    () => saveWithProximityWarning({
      guardId: "door",
      checkArea: async () => {},
      verdict: tooFar,
      ask: async () => {
        asks += 1;
        return true;
      },
      save: async () => "second",
    }),
    isProximityWarningCancelled,
  );
  assert.equal(asks, 1);
  release(true);
  assert.equal(await first, "saved");

  let asked = 0;
  let saved = 0;
  await assert.rejects(
    () => saveWithProximityWarning({
      guardId: "blocked",
      checkArea: async () => {
        throw Error(AREA_BLOCK_MESSAGE);
      },
      verdict: tooFar,
      ask: async () => {
        asked += 1;
        return true;
      },
      save: async () => {
        saved += 1;
      },
    }),
    (error: Error) => error.message === AREA_BLOCK_MESSAGE,
  );
  assert.equal(asked, 0);
  assert.equal(saved, 0);
});

test("the warning is a client computation and ignores a fix that arrives after the tap", async () => {
  resetProximityWarningsForTests();
  const tappedAt = 1_700_000_000_000;
  const original = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = async () => {
    fetches += 1;
    throw Error("offline");
  };
  try {
    const fresh = proximityVerdictAtTap({
      fix: { timestamp: tappedAt, coords: { latitude: 44, longitude: -77, accuracy: 5 } },
      tappedAt,
      pin: { lat: 43, lng: -77 },
      role: "closer",
      optOut: false,
    });
    assert.equal(fresh.reason, "too_far");
    assert.equal(fresh.capturedAt, "fresh");
    assert.equal(shouldShowProximityWarning(fresh), true);
    const late = proximityVerdictAtTap({
      fix: { timestamp: tappedAt + 1000, coords: { latitude: 44, longitude: -77, accuracy: 5 } },
      tappedAt,
      pin: { lat: 43, lng: -77 },
      role: "manager",
      optOut: false,
    });
    assert.equal(late.capturedAt, "late");
    assert.equal(shouldShowProximityWarning(late), false);
    const optedOut = proximityVerdictAtTap({
      fix: { timestamp: tappedAt, coords: { latitude: 44, longitude: -77, accuracy: 5 } },
      tappedAt,
      pin: { lat: 43, lng: -77 },
      role: "admin",
      optOut: true,
    });
    assert.equal(shouldShowProximityWarning(optedOut), false);
    const saved = await saveWithProximityWarning({
      guardId: "offline",
      checkArea: async () => {},
      verdict: fresh,
      ask: async () => true,
      save: async () => "kept",
    });
    assert.equal(saved, "kept");
    assert.equal(fetches, 0);
  } finally {
    globalThis.fetch = original;
  }
});
