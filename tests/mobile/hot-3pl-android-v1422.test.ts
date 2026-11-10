import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Lead } from "../../app/types";
import type { HotLeadPin } from "../../app/hotLeads/model";
import { fieldPinArtwork, HOT_RING_COLOR, withLegacyHotPin } from "../../app/utils/fieldPin";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function read(relative: string): string {
  return readFileSync(path.join(root, relative), "utf8");
}

function channel(hex: string, index: number) {
  const value = parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16) / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function contrast(hex: string, against: string) {
  const lum = (color: string) => {
    const [r, g, b] = [0, 1, 2].map((index) => channel(color, index));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [light, dark] = [lum(hex), lum(against)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

function pin(extra: Partial<HotLeadPin> = {}): HotLeadPin {
  return {
    id: "ghl_opp_example_1",
    lat: 43.161,
    lng: -77.611,
    address: "200 Example Ave",
    city: "Rochester",
    state: "NY",
    zip: "14607",
    contacts: [{ name: "Alex Example", phone: "555-0199" }],
    hotStatus: "active",
    claimedBy: null,
    claimedByName: null,
    claimedAt: null,
    status: null,
    disposition: null,
    dispositionedAt: null,
    linkedLeadId: null,
    homeownerId: null,
    ...extra,
  };
}

function house(extra: Partial<Lead> = {}): Lead {
  return {
    id: "house-1",
    name: "Alex Example",
    address: "200 Example Ave",
    city: "Rochester",
    state: "NY",
    zip: "14607",
    status: "assigned",
    createdAt: new Date("2026-10-30T15:04:00.000Z"),
    lat: 43.161,
    lng: -77.611,
    ...extra,
  } as Lead;
}

function svg(url: string) {
  return decodeURIComponent(url.slice("data:image/svg+xml,".length));
}

test("every 3PL pin uses the gold outline and a dashed ring means view only", () => {
  assert.equal(HOT_RING_COLOR, "#B8860B");
  assert.notEqual(HOT_RING_COLOR.toLowerCase(), "#f4c84a");
  assert.ok(contrast(HOT_RING_COLOR, "#ffffff") >= 3);
  const fieldPin = read("app/utils/fieldPin.ts");
  assert.equal(fieldPin.includes("#E8590C"), false);
  assert.equal(fieldPin.includes("#334155"), false);
  assert.equal(fieldPin.includes("HOT_VIEW_ONLY_RING"), false);
  assert.match(fieldPin, /warm \? 20 : 0/);
  const open = fieldPinArtwork({ ...house(), hotLead: true, hotPin: pin() }, undefined, 18, false, true);
  const locked = fieldPinArtwork(
    { ...house(), hotLead: true, hotPin: pin({ canDispo: false, dispoBlock: "outside_territory" }) },
    undefined,
    18,
    false,
    true,
  );
  const selected = fieldPinArtwork({ ...house(), hotLead: true, hotPin: pin() }, undefined, 16, true, true);
  assert.match(svg(open.url), new RegExp(`stroke="${HOT_RING_COLOR}"`));
  assert.equal(svg(open.url).includes("stroke-dasharray"), false);
  assert.equal(svg(open.url).includes("data-hot-view-only"), false);
  assert.match(svg(locked.url), new RegExp(`stroke="${HOT_RING_COLOR}"`));
  assert.match(svg(locked.url), /stroke-dasharray/);
  assert.match(svg(locked.url), /data-hot-view-only="true"/);
  assert.match(svg(selected.url), /#F4C84A/);
  assert.match(svg(selected.url), new RegExp(HOT_RING_COLOR));
  const legacy = withLegacyHotPin("<div>pin</div>", true);
  assert.match(legacy, /data-hot-view-only="true"/);
  assert.match(legacy, new RegExp(HOT_RING_COLOR));
  assert.match(legacy, /dashed/);
  const section = read("app/hotLeads/HotLeadFilterSection.tsx");
  assert.match(section, /3PL lead — view only|HOT_VIEW_ONLY_LEGEND/);
  assert.match(section, /dashed \$\{HOT_RING_COLOR\}/);
  const warm = svg(fieldPinArtwork(
    { ...house({ solarCategory: "great", tags: ["solar-data"] }), hotLead: true, hotPin: pin() },
    undefined,
    18,
    false,
    true,
  ).url);
  assert.match(warm, /data-hot-lead="true" transform="translate\(20 0\)"/);
});
