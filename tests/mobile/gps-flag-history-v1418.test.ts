import test from "node:test";
import assert from "node:assert/strict";
import { Timestamp } from "firebase/firestore";
import { DEFAULT_DISPOSITIONS } from "../../app/types/disposition";
import type { Lead, LeadDispositionHistoryEntry, User } from "../../app/types";
import type { PendingMutation } from "../../app/field/types";
import { firestoreValue, mergeReportingPatch, reportingPatch } from "../../app/field/directWrites";
import { knockPatch } from "../../app/field/knockPatch";
import { fieldDispoBody, plainFallbackMutation, routeHistoryGpsFlag } from "../../app/field/serverDispo";

const user = { id: "rep", name: "Rep" } as User;
const disposition = DEFAULT_DISPOSITIONS.find((item) => item.id === "not-home")!;
const at = new Date("2026-10-25T15:00:00.000Z");
const older: LeadDispositionHistoryEntry = {
  disposition: "Interested",
  timestamp: new Date("2026-09-01T00:00:00.000Z"),
  userId: "other",
  userName: "Other",
};
const lead = { id: "lead-1", status: "claimed", dispositionHistory: [older] } as Lead;

function draft(patch: Partial<Lead>): PendingMutation {
  return {
    id: "draft-1",
    userId: user.id,
    userName: user.name,
    leadId: lead.id,
    kind: "knock",
    createdAt: at.toISOString(),
    baseStatus: "claimed",
    status: patch.status,
    disposition: patch.dispositionHistory?.[0]?.disposition,
    direct: { patch },
  };
}

test("the new history entry carries the true gpsFlag and earlier entries stay untouched", () => {
  const tooFarExtra = {
    gpsVerified: false as const,
    gpsUnverifiedReason: "too_far" as const,
    gpsDistanceM: 120,
    knockGpsLat: 44,
    knockGpsLng: -77,
    knockGpsAccuracy: 5,
    knockGpsTimestamp: at,
  };
  const knocked = knockPatch(lead, user, user.id, disposition, at, tooFarExtra);
  assert.equal(knocked.dispositionHistory?.[0]?.gpsFlag?.gpsUnverifiedReason, "too_far");
  assert.equal(knocked.dispositionHistory?.[0]?.gpsFlag?.gpsVerified, false);
  assert.equal(knocked.dispositionHistory?.[1], older);

  const direct = reportingPatch(draft(knocked), user);
  assert.equal(direct.gpsUnverifiedReason, "too_far");
  assert.equal(direct.dispositionHistory?.[0]?.gpsFlag?.gpsUnverifiedReason, "too_far");
  assert.equal(direct.dispositionHistory?.[0]?.gpsFlag?.gpsVerified, false);
  const written = firestoreValue(direct) as {
    dispositionedAt: Timestamp;
    dispositionHistory: Array<{ timestamp: Timestamp; gpsFlag?: { gpsUnverifiedReason?: string } }>;
  };
  assert.ok(written.dispositionedAt instanceof Timestamp);
  assert.ok(written.dispositionHistory[0].timestamp instanceof Timestamp);
  assert.equal(written.dispositionHistory[0].gpsFlag?.gpsUnverifiedReason, "too_far");

  const merged = mergeReportingPatch({ dispositionHistory: [older] }, direct);
  assert.equal(merged.patch.dispositionHistory?.[0]?.gpsFlag?.gpsUnverifiedReason, "too_far");
  assert.deepEqual(merged.patch.dispositionHistory?.[1], older);

  const verified = reportingPatch(draft(knockPatch(lead, user, user.id, disposition, at, {
    gpsVerified: true,
    gpsDistanceM: 4,
    knockGpsLat: 43,
    knockGpsLng: -77,
    knockGpsAccuracy: 5,
    knockGpsTimestamp: at,
  })), user);
  assert.equal(verified.dispositionHistory?.[0]?.gpsFlag?.gpsVerified, true);
  assert.equal(verified.dispositionHistory?.[0]?.gpsFlag?.gpsUnverifiedReason, undefined);
  assert.equal("gpsUnverifiedReason" in (verified.dispositionHistory?.[0]?.gpsFlag || {}), false);

  const outside = knockPatch(lead, user, user.id, disposition, at, {
    gpsVerified: false,
    gpsUnverifiedReason: "out_of_area",
    gpsDistanceM: 40,
    knockGpsLat: 44,
    knockGpsLng: -77,
    knockGpsAccuracy: 5,
    knockGpsTimestamp: at,
  });
  const areaDirect = reportingPatch(draft(outside), user);
  assert.equal(areaDirect.gpsUnverifiedReason, "too_far");
  assert.equal(areaDirect.dispositionHistory?.[0]?.gpsFlag?.gpsUnverifiedReason, "out_of_area");

  const plain = reportingPatch(plainFallbackMutation(draft(outside)), user);
  assert.equal(plain.gpsVerified, undefined);
  assert.equal(plain.gpsUnverifiedReason, undefined);
  assert.equal(plain.gpsDistanceM, undefined);
  assert.equal(plain.dispositionHistory?.[0]?.gpsFlag?.gpsUnverifiedReason, "out_of_area");
  assert.ok(plain.dispositionedAt instanceof Date);

  const plainTooFar = reportingPatch(plainFallbackMutation(draft(knocked)), user);
  assert.equal(plainTooFar.gpsUnverifiedReason, undefined);
  assert.equal(plainTooFar.dispositionHistory?.[0]?.gpsFlag?.gpsUnverifiedReason, "too_far");

  const body = fieldDispoBody(draft(knocked), user);
  assert.equal("gpsFlag" in body, false);
  assert.equal(body.gps?.lat, 44);
  const routeFlag = routeHistoryGpsFlag(body, { lat: 43, lng: -77 }, "setter");
  assert.equal(routeFlag.gpsUnverifiedReason, "too_far");
  assert.equal(routeFlag.gpsVerified, false);

  const verifiedBody = fieldDispoBody(draft(knockPatch(lead, user, user.id, disposition, at, {
    gpsVerified: true,
    gpsDistanceM: 0,
    knockGpsLat: 43,
    knockGpsLng: -77,
    knockGpsAccuracy: 5,
    knockGpsTimestamp: at,
  })), user);
  const verifiedRoute = routeHistoryGpsFlag(verifiedBody, { lat: 43, lng: -77 }, "setter");
  assert.equal(verifiedRoute.gpsVerified, true);
  assert.equal(verifiedRoute.gpsUnverifiedReason, undefined);
});
