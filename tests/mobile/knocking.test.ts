import test from "node:test";
import assert from "node:assert/strict";
import {
  buildLeadViewportIndex,
  queryLeadViewport,
} from "../../app/utils/mapViewport.ts";
import { fieldPinArtwork } from "../../app/utils/fieldPin.ts";
import {
  suggestDoors,
  sessionAppointments,
} from "../../app/mobile/_lib/doorCoach.ts";
import type { Lead } from "../../app/types/index.ts";
const now = new Date(2026, 9, 8, 12);
const base: Lead = {
  id: "a",
  name: "Test",
  address: "1 Example",
  city: "Rochester",
  state: "NY",
  zip: "",
  status: "assigned",
  createdAt: now,
  assignedTo: "rep",
  lat: 43.1566,
  lng: -77.6088,
};

test("viewport selects a small area from 10,000 pins without copying lead objects", () => {
  const leads = Array.from({ length: 10000 }, (_, i) => ({
    ...base,
    id: String(i),
    lat: 40 + i * 0.001,
  }));
  const index = buildLeadViewportIndex([
    ...leads,
    { ...base, id: "invalid", lat: NaN },
  ]);
  const picked = queryLeadViewport(index, {
    south: 43,
    north: 43.01,
    west: -78,
    east: -77,
  });
  assert.equal(index.length, 10000);
  assert.equal(picked.length, 11);
  assert.equal(picked[0], leads[3000]);
  assert.equal(
    queryLeadViewport(index, { south: 43, north: 44, west: 0, east: 1 }).length,
    0,
  );
});
test("viewport accepts zero coordinates and crossing the date line", () => {
  const index = buildLeadViewportIndex([
    { ...base, lat: 0, lng: 179 },
    { ...base, id: "b", lat: 0, lng: -179 },
    { ...base, id: "c", lat: 0, lng: 0 },
  ]);
  assert.equal(
    queryLeadViewport(index, { south: -1, north: 1, west: 178, east: -178 })
      .length,
    2,
  );
  assert.equal(
    queryLeadViewport(index, { south: -1, north: 1, west: -1, east: 1 }).length,
    1,
  );
});
test("pin has independent status/outcome symbols, selection state and simple zoomed-out artwork", () => {
  const lead: Lead = {
    ...base,
    status: "appointment",
    appointmentOutcome: "No Show",
    solarCategory: "great",
  };
  const pin = fieldPinArtwork(lead, undefined, 17);
  assert.equal(pin.url, fieldPinArtwork(lead, undefined, 17).url);
  assert.ok(pin.label.includes("GHL No show"));
  assert.equal(pin.style.kind, "appointment");
  assert.notEqual(pin.url, fieldPinArtwork(lead, undefined, 17, true).url);
  assert.ok(fieldPinArtwork(lead, undefined, 11).size < pin.size);
  assert.ok(!decodeURIComponent(pin.url).includes("<animate"));
  assert.equal(lead.status, "appointment");
});
test("next door queue prioritizes due go-backs and excludes other reps, negative statuses and future visits", () => {
  const leads = [
    base,
    { ...base, id: "warm", status: "interested" },
    {
      ...base,
      id: "due",
      status: "go-back",
      goBackScheduledDate: new Date(2026, 9, 7),
    },
    {
      ...base,
      id: "future",
      status: "go-back",
      goBackScheduledDate: new Date(2026, 9, 9),
    },
    { ...base, id: "dnc", status: "do-not-knock" },
    { ...base, id: "negative", status: "not-interested" },
    { ...base, id: "other", assignedTo: "other" },
    { ...base, id: "sold", appointmentOutcome: "Sold" },
    { ...base, id: "far", lat: 44 },
    { ...base, id: "today", status: "not-home", dispositionedAt: now },
    { ...base, id: "unknown", status: "custom-status" },
  ];
  assert.deepEqual(
    suggestDoors(leads, "rep", [base.lat!, base.lng!], now).map(
      (x) => x.lead.id,
    ),
    ["due", "warm", "a"],
  );
  assert.deepEqual(suggestDoors(leads, "rep", undefined, now), []);
});
test("focus counts unique actual appointments by this rep since session start, including later outcome changes", () => {
  const event = {
    disposition: "Appointment Set",
    userId: "rep",
    userName: "Rep",
    timestamp: new Date(2026, 9, 8, 11),
  };
  const history = {
    ...base,
    status: "sale",
    dispositionHistory: [event, event],
  };
  const foreign = {
    ...base,
    id: "foreign",
    status: "appointment",
    dispositionedAt: now,
    claimedBy: "other",
    assignedTo: "other",
  };
  const outcomeOnly = { ...base, id: "outcome", appointmentOutcome: "Sold" };
  assert.equal(
    sessionAppointments(
      [history, foreign, outcomeOnly],
      "rep",
      new Date(2026, 9, 8, 10).toISOString(),
    ),
    1,
  );
  assert.equal(
    sessionAppointments(
      [history],
      "rep",
      new Date(2026, 9, 8, 11, 30).toISOString(),
    ),
    0,
  );
});
