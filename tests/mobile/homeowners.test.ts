import test from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { geohashForLocation } from "geofire-common";
import {
  applyRead,
  buildHouseIndex,
  hashNumber,
  inView,
  mergeHomeowners,
  missingRanges,
  normalized,
  numberHash,
  occupancyLabel,
  parseHomeowner,
  planRanges,
  suspectedRenter,
  tileComplete,
  TILE_SIZE,
  TTL,
  type Homeowner,
  type HomeTile,
  type View,
} from "../../app/homeowners/model";
import {
  HomeownerLoader,
  type HomeownerState,
} from "../../app/homeowners/loader";
import { homeownerPinArtwork } from "../../app/homeowners/artwork";
import { fieldPinArtwork } from "../../app/utils/fieldPin";
import type { Lead } from "../../app/types";
const view: View = {
  south: 43.15,
  north: 43.154,
  west: -77.605,
  east: -77.6,
  zoom: 17,
};
function home(id = "h1", patch: Partial<Homeowner> = {}): Homeowner {
  const lat = 43.152,
    lng = -77.602,
    geohash = geohashForLocation([lat, lng], 9);
  return {
    id,
    address: "100 Main St",
    addressNorm: "100 MAIN ST",
    municipality: "Rochester",
    state: "NY",
    ownerName: "Demo Owner",
    occupancyStatus: "Owner-Occupied",
    mailingCity: "",
    mailingZip: "",
    propertyType: "1 Family",
    lat,
    lng,
    geohash,
    geohash5: geohash.slice(0, 5),
    ...patch,
  };
}
function lead(id = "k1", patch: Partial<Lead> = {}): Lead {
  return {
    id,
    address: "100 Main Street APT 2",
    city: "Rochester",
    state: "NY",
    zip: "14620",
    name: "Fictional lead",
    status: "not-home",
    lat: 43.152,
    lng: -77.602,
    createdAt: new Date(),
    dispositionedAt: new Date("2026-10-10T12:00:00Z"),
    ...patch,
  };
}
const empty = (tile: string): HomeTile => ({
  tile,
  docs: {},
  receipts: [],
  touched: 0,
});
function run(loader: HomeownerLoader, v = view) {
  return new Promise<HomeownerState>((resolve) =>
    loader.request(v, (s) => {
      if (!s.loading) resolve(s);
    }),
  );
}
test("renter boolean overrides raw estimate including false; parser exposes only approved fields", () => {
  const h = home("x", { occupancyStatus: "Absentee / Possible Renter" });
  assert.equal(suspectedRenter(h), true);
  assert.equal(occupancyLabel({ ...h, suspectedRenter: false }), "Owner");
  assert.equal(
    occupancyLabel({ ...h, suspectedRenter: true }),
    "Suspected renter",
  );
  assert.equal(
    suspectedRenter({ ...h, suspectedRenter: "false" as unknown as boolean }),
    true,
  );
  const p = parseHomeowner("snapshot-id", {
    ...h,
    sourceFileId: "private-provenance",
    suspectedRenter: false,
  })!;
  assert.equal(p.id, "snapshot-id");
  assert.equal("sourceFileId" in p, false);
  assert.equal(p.geohash5, p.geohash.slice(0, 5));
  assert.equal(parseHomeowner("bad", { ...h, geohash: "invalid" }), null);
});
test("exact normalization, latest visit, proximity fallback and unmatched pins stay immutable", () => {
  assert.equal(normalized("100 N. Main Street, # 2", true), "100 N MAIN ST");
  assert.equal(normalized("100 North Main St UNIT B", true), "100 N MAIN ST");
  const old = lead("old", { dispositionedAt: new Date("2026-10-09") }),
    latest = lead("latest"),
    unmatched = lead("other", {
      address: "600 Elsewhere",
      lat: 43.5,
      lng: -77.8,
    });
  const input = [old, latest, unmatched],
    before = JSON.stringify(input);
  const merged = mergeHomeowners([home()], buildHouseIndex(input));
  assert.equal(merged.gray.length, 0);
  assert.equal(merged.byLead.get("latest")?.ownerName, "Demo Owner");
  assert.deepEqual([...merged.hiddenLeadIds], ["old"]);
  assert.equal(JSON.stringify(input), before);
  assert.equal(
    mergeHomeowners(
      [home("near", { municipality: "Different town", lat: 43.15215 })],
      buildHouseIndex([latest]),
    ).gray.length,
    0,
  );
  assert.equal(
    mergeHomeowners(
      [home("far", { municipality: "Other town", lat: 43.153 })],
      buildHouseIndex([latest]),
    ).gray.length,
    1,
  );
  const closer = lead("closer", {
    address: "Another address",
    city: "Other town",
    lat: 43.15201,
  });
  assert.ok(
    mergeHomeowners(
      [home("near", { municipality: "Other city" })],
      buildHouseIndex([latest, closer]),
    ).byLead.has("latest"),
  );
});
test("viewport planning is bounded, street-level only and covers the visible rectangle", () => {
  assert.equal(planRanges({ ...view, zoom: 14 }).size, 0);
  assert.equal(planRanges({ ...view, south: 30, north: 45 }).size, 0);
  for (const v of [
    view,
    { south: 42.9, north: 42.906, west: -78.875, east: -78.865, zoom: 16 },
  ]) {
    const planned = planRanges(v);
    assert.ok(planned.size > 0 && planned.size <= 32);
    for (const ranges of planned.values())
      for (const r of ranges) {
        assert.ok(r.hi > r.lo && r.hi - r.lo <= TILE_SIZE);
        assert.equal(hashNumber(numberHash(r.lo)), r.lo);
      }
    for (let i = 0; i <= 10; i++)
      for (let j = 0; j <= 10; j++) {
        const h = geohashForLocation(
            [
              v.south + ((v.north - v.south) * i) / 10,
              v.west + ((v.east - v.west) * j) / 10,
            ],
            9,
          ),
          n = hashNumber(h);
        assert.ok(
          planned.get(h.slice(0, 5))?.some((r) => n >= r.lo && n < r.hi),
        );
      }
  }
});
test("partial bounds cannot mark a tile complete; dense reads wait for narrower zoom; TTL expires", () => {
  const h = home(),
    lo = hashNumber(h.geohash5),
    full = { lo, hi: lo + TILE_SIZE },
    small = { lo, hi: lo + 100 };
  let t = applyRead(empty(h.geohash5), small, [h], 1, 17, 1000);
  assert.equal(tileComplete(t, 2000), false);
  assert.equal(missingRanges(t, [small], 17, 2000).ranges.length, 0);
  assert.equal(missingRanges(t, [full], 17, 2000).ranges[0].lo, lo + 100);
  t = applyRead(t, full, [], 500, 15, 2000);
  assert.equal(tileComplete(t, 3000), false);
  assert.equal(missingRanges(t, [full], 15, 3000).dense, true);
  assert.equal(
    missingRanges(t, [{ lo: lo + 100, hi: lo + 200 }], 17, 3000).ranges.length,
    1,
  );
  t = applyRead(t, full, [], 0, 17, 4000);
  assert.equal(tileComplete(t, 5000), true);
  assert.equal(tileComplete(t, 4000 + TTL + 1), false);
});
test("cache reuse including empty bounds and false positives makes zero repeat queries or offline queries", async () => {
  const disk = new Map<string, HomeTile>();
  let calls = 0;
  const fixtures = [
    home(),
    home("outside", {
      lat: 43.1543,
      geohash: geohashForLocation([43.1543, -77.602], 9),
      geohash5: geohashForLocation([43.1543, -77.602], 5),
    }),
  ];
  const deps = {
    read: async (k: string) => structuredClone(disk.get(k) || empty(k)),
    save: async (t: HomeTile) => {
      disk.set(t.tile, structuredClone(t));
    },
    fetch: async (r: { lo: number; hi: number }) => {
      calls++;
      const docs = fixtures.filter((h) => {
        const n = hashNumber(h.geohash);
        return n >= r.lo && n < r.hi;
      });
      return { docs, rawCount: docs.length };
    },
    online: () => true,
  };
  const first = await run(new HomeownerLoader(deps));
  assert.equal(first.homes.length, 1);
  assert.ok(calls > 0);
  const saved = calls;
  await run(new HomeownerLoader(deps));
  assert.equal(calls, saved);
  const offline = await run(
    new HomeownerLoader({ ...deps, online: () => false }),
  );
  assert.equal(offline.homes[0].ownerName, "Demo Owner");
  assert.equal(calls, saved);
  assert.ok(
    [...disk.values()].some((t) => t.docs.outside),
    "fetched false positives must be saved before a coverage receipt",
  );
  await run(new HomeownerLoader(deps), { ...view, zoom: 10 });
  assert.equal(calls, saved);
});
test("read budgets, stale camera cancellation and dense ranges do not loop", async () => {
  let calls = 0;
  const disk = new Map<string, HomeTile>();
  const deps = {
    read: async (k: string) => disk.get(k) || empty(k),
    save: async (t: HomeTile) => {
      disk.set(t.tile, t);
    },
    fetch: async () => {
      calls++;
      return { docs: [], rawCount: 500 };
    },
    online: () => true,
  };
  const result = await run(new HomeownerLoader(deps), {
    ...view,
    south: 43.145,
    north: 43.16,
    zoom: 15,
  });
  assert.ok(result.reads <= 2000 && result.queries <= 12);
  assert.equal(result.partial, true);
  const before = calls;
  await run(new HomeownerLoader(deps), {
    ...view,
    south: 43.145,
    north: 43.16,
    zoom: 15,
  });
  assert.equal(calls, before, "dense bounds may not be blindly retried");
  let resolveRead:
    | ((value: { docs: Homeowner[]; rawCount: number }) => void)
    | undefined;
  const outputs: HomeownerState[] = [];
  const loader = new HomeownerLoader({
    ...deps,
    read: async (k) => empty(k),
    fetch: () =>
      new Promise((r) => {
        resolveRead = r;
      }),
  });
  loader.request(view, (s) => outputs.push(s));
  await new Promise((r) => setTimeout(r, 10));
  loader.cancel();
  const count = outputs.length;
  resolveRead?.({ docs: [home()], rawCount: 1 });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(outputs.length, count);
});
test("gray variants keep existing pin silhouette and worked-pin artwork untouched", () => {
  const before = fieldPinArtwork(lead(), undefined, 18).url;
  const owner = homeownerPinArtwork(false, 18),
    renter = homeownerPinArtwork(true, 18);
  assert.equal(owner.size, 30);
  assert.notEqual(owner.url, renter.url);
  assert.ok(decodeURIComponent(renter.url).includes("data-renter"));
  assert.ok(decodeURIComponent(owner.url).includes("M24 53 8 35V13"));
  assert.equal(fieldPinArtwork(lead(), undefined, 18).url, before);
});
test("spatial matching 10,000 existing pins avoids an all-pairs join", () => {
  const leads = Array.from({ length: 10000 }, (_, i) =>
    lead(`k${i}`, {
      address: `${i + 100} Sample Rd`,
      lat: 43.1 + (i % 100) * 0.0004,
      lng: -77.65 + Math.floor(i / 100) * 0.0004,
    }),
  );
  const homes = leads
    .slice(0, 1500)
    .map((l, i) =>
      home(`h${i}`, {
        addressNorm: l.address.toUpperCase(),
        lat: l.lat!,
        lng: l.lng!,
      }),
    );
  const start = performance.now(),
    result = mergeHomeowners(homes, buildHouseIndex(leads));
  assert.equal(result.gray.length, 0);
  assert.ok(
    performance.now() - start < 1000,
    "10k lead matching should complete under 1 second on test host",
  );
  assert.equal(inView(home(), view), true);
});
