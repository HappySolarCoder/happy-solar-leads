import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decideKnockGps, type KnockFix } from "../../app/utils/gpsRule";
import { PROXIMITY_WARNING_ENABLED, shouldShowProximityWarning } from "../../app/field/proximityWarning";

const fixturePath = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures/gps-rule-vectors.json");
const polygon = [
  { lat: 43, lng: -77.01 },
  { lat: 43, lng: -76.99 },
  { lat: 43.01, lng: -76.99 },
  { lat: 43.01, lng: -77.01 },
];
const ACTION = 1_700_000_000_000;

type Encoded = number | "NaN" | "string:12";
type Row = {
  role: string;
  optOut: boolean;
  platform: "ios" | "android";
  capturedAt: "fresh" | "stale" | "missing";
  accuracy: Encoded;
  fix: { lat: Encoded; lng: Encoded; accuracyM: Encoded; capturedAtMs?: number };
  reference: { lat: number; lng: number } | null;
  polygons: "none" | "edge";
  expected: { gpsVerified: boolean; gpsUnverifiedReason?: string; gpsDistanceM?: number; keepFix: boolean };
  showProximityWarning: boolean;
};

function decode(value: Encoded): number {
  if (value === "NaN") return Number.NaN;
  if (value === "string:12") return Number.NaN;
  return value;
}

test("client gpsRule matches the #170 vectors, including the proximity warning column", () => {
  const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as { sourceCommit: string; count: number; rows: Row[] };
  assert.equal(fixture.sourceCommit, "69a3167d0ddf3629fd5d6eea2a48705cd533a347");
  assert.ok(fixture.rows.length >= 1271);
  assert.equal(fixture.count, fixture.rows.length);
  const seen = new Set<string>();
  for (const row of fixture.rows) {
    seen.add(`${row.role}|${row.platform}|${row.optOut}|${row.capturedAt}|${row.accuracy}|${row.polygons}`);
    const numeric = row.accuracy !== "string:12";
    const fix: KnockFix | "malformed" = numeric
      ? {
          lat: decode(row.fix.lat),
          lng: decode(row.fix.lng),
          accuracyM: decode(row.fix.accuracyM),
          ...(row.fix.capturedAtMs == null ? {} : { capturedAtMs: row.fix.capturedAtMs }),
        }
      : "malformed";
    const decision = decideKnockGps({
      fix,
      actionAtMs: ACTION,
      reference: row.reference,
      role: row.role,
      polygons: row.polygons === "edge" ? [polygon] : undefined,
    });
    assert.deepEqual(decision, row.expected);
    const derived = PROXIMITY_WARNING_ENABLED
      && !row.optOut
      && row.expected.gpsUnverifiedReason === "too_far"
      && row.expected.keepFix === true
      && row.capturedAt === "fresh";
    assert.equal(row.showProximityWarning, derived);
    assert.equal(shouldShowProximityWarning({
      reason: row.expected.gpsUnverifiedReason,
      keepFix: row.expected.keepFix,
      capturedAt: row.capturedAt,
      optOut: row.optOut,
    }), derived);
  }
  assert.ok(seen.has("setter|ios|false|fresh|15|none"));
  assert.ok(seen.has("closer|android|true|stale|1000|none"));
  assert.ok(seen.has("manager|ios|false|missing|0|none"));
  assert.ok(seen.has("admin|android|true|fresh|100000|none"));
});
