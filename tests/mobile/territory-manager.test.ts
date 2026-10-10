import test from "node:test";
import assert from "node:assert/strict";
import {
  assignableTerritoryLead,
  insideTerritory,
  inManagerTeam,
  mayManageTerritories,
  mayReceiveTerritory,
  polygonsOverlap,
  validateTerritoryPolygon,
} from "../../app/utils/territoryManager";
const square = [
  { lat: 0, lng: 0 },
  { lat: 0, lng: 0.01 },
  { lat: 0.01, lng: 0.01 },
  { lat: 0.01, lng: 0 },
];
test("validates geographic boundaries and refuses crossing, duplicate, oversized or invalid coordinates", () => {
  assert.equal(validateTerritoryPolygon(square).length, 4);
  assert.equal(validateTerritoryPolygon([...square, square[0]]).length, 4);
  for (const p of [
    square.slice(0, 2),
    [square[0], square[2], square[1], square[3]],
    [...square, square[1]],
    square.map((p) => ({ ...p, lat: p.lat * 1000 })),
    [{ lat: NaN, lng: 0 }, ...square],
  ])
    assert.throws(() => validateTerritoryPolygon(p));
  assert.equal(insideTerritory(0.005, 0.005, square), true);
  assert.equal(insideTerritory(0, 0, square), true);
  assert.equal(insideTerritory(0.02, 0.005, square), false);
  assert.equal(insideTerritory(null, 0, square), false);
  const concave = [
    { lat: 0, lng: 0 },
    { lat: 0, lng: 0.02 },
    { lat: 0.02, lng: 0.02 },
    { lat: 0.01, lng: 0.01 },
    { lat: 0.02, lng: 0 },
  ];
  assert.equal(insideTerritory(0.019, 0.01, concave), false); // Inside box, outside actual polygon.
});
test("detects overlap, containment and crossing without just checking the bounding box", () => {
  assert.equal(
    polygonsOverlap(
      square,
      square.map((p) => ({ lat: p.lat + 0.005, lng: p.lng + 0.005 }))
    ),
    true
  );
  assert.equal(
    polygonsOverlap(
      square,
      square.map((p) => ({ lat: p.lat + 0.02, lng: p.lng + 0.02 }))
    ),
    false
  );
  assert.equal(
    polygonsOverlap(
      square,
      square.map((p) => ({ lat: p.lat / 2 + 0.001, lng: p.lng / 2 + 0.001 }))
    ),
    true
  );
});
test("manager authorization is approved and team scoped; missing team does not grant access", () => {
  const actor = {
    id: "m",
    name: "M",
    color: "",
    role: "manager",
    team: "Rochester",
  };
  assert.equal(mayManageTerritories(actor), true);
  assert.equal(mayManageTerritories({ ...actor, approved: false }), false);
  assert.equal(mayManageTerritories({ ...actor, role: "setter" }), false);
  assert.equal(inManagerTeam(actor, { ...actor, id: "rep" }), true);
  assert.equal(
    inManagerTeam(actor, { ...actor, id: "rep", team: "Buffalo" }),
    false
  );
  assert.equal(
    inManagerTeam({ ...actor, team: "" }, { ...actor, id: "rep", team: "" }),
    false
  );
  assert.equal(
    inManagerTeam(
      { ...actor, role: "admin" },
      { ...actor, id: "rep", team: "Buffalo" }
    ),
    true
  );
  assert.equal(mayReceiveTerritory({ ...actor, isActive: false }), false);
});
test("bulk assignment never takes claimed, worked, manual, customer, or another owner’s pins", () => {
  const lead = { status: "unclaimed" };
  assert.equal(assignableTerritoryLead(lead, "new"), true);
  assert.equal(
    assignableTerritoryLead({ ...lead, assignedTo: "old" }, "new"),
    false
  );
  assert.equal(
    assignableTerritoryLead(
      { ...lead, status: "assigned", assignedTo: "old" },
      "new",
      "old"
    ),
    true
  );
  for (const change of [
    { claimedBy: "old" },
    { leadType: "customer" },
    { source: "manually-added" },
    { status: "not-home" },
    { appointmentOutcome: "Sold" },
    { ghlStatus: "confirmed" },
    { dispositionedAt: "2026-01-01" },
    { dispositionHistory: [{}] },
    { setterId: "owner" },
  ])
    assert.equal(
      assignableTerritoryLead({ ...lead, ...change }, "new", "old"),
      false
    );
});
