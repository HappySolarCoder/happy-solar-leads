import assert from 'node:assert/strict';

const GPS_BOX_PAD_DEG = 0.02;
const ROCHESTER_LAT = 43.1566;
const ROCHESTER_LNG = -77.6088;

function boundsAround(lat, lng, pad = GPS_BOX_PAD_DEG) {
  return { south: lat - pad, north: lat + pad, west: lng - pad, east: lng + pad };
}

function seedPinsInBox(lastPins, cachedLeads, box, max = 400) {
  const inBox = (leads) => {
    if (!box) return leads.slice(0, max);
    const out = [];
    for (const lead of leads) {
      if (lead.lat == null || lead.lng == null) continue;
      if (lead.lat < box.south || lead.lat > box.north) continue;
      if (box.west > box.east) {
        if (!(lead.lng >= box.west || lead.lng <= box.east)) continue;
      } else if (lead.lng < box.west || lead.lng > box.east) {
        continue;
      }
      out.push(lead);
      if (out.length >= max) break;
    }
    return out;
  };
  if (lastPins.length > 0) return inBox(lastPins);
  if (cachedLeads.length > 0 && box) return inBox(cachedLeads);
  return [];
}

const henrietta = boundsAround(43.06, -77.61);
assert.notEqual(Math.abs((henrietta.south + henrietta.north) / 2 - ROCHESTER_LAT) < 0.01, true);
assert.ok(Math.abs((henrietta.north - henrietta.south) - 0.04) < 1e-9);

const rochesterBox = {
  south: ROCHESTER_LAT - 0.12,
  north: ROCHESTER_LAT + 0.12,
  west: ROCHESTER_LNG - 0.16,
  east: ROCHESTER_LNG + 0.16,
};
assert.ok(rochesterBox.north - rochesterBox.south > henrietta.north - henrietta.south);

const lastPins = [
  { id: 'near', lat: 43.06, lng: -77.61 },
  { id: 'roc', lat: ROCHESTER_LAT, lng: ROCHESTER_LNG },
];
const seeded = seedPinsInBox(lastPins, [], henrietta);
assert.deepEqual(seeded.map((l) => l.id), ['near']);

const fromCache = seedPinsInBox([], lastPins, henrietta);
assert.deepEqual(fromCache.map((l) => l.id), ['near']);

const empty = seedPinsInBox([], lastPins, null);
assert.deepEqual(empty, []);

console.log('knocking map seed helpers ok');
