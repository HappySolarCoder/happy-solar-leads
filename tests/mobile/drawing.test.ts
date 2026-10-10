import test from "node:test";
import assert from "node:assert/strict";
import { rectangleCorners } from "../../app/mobile/territories/drawing.ts";
import {
  validateTerritoryPolygon,
  insideTerritory,
} from "../../app/utils/territoryManager.ts";
test("rectangle creates four valid corners regardless of which diagonal is tapped first", () => {
  const a = { lat: 43.15, lng: -77.61 },
    b = { lat: 43.16, lng: -77.6 };
  const polygon = rectangleCorners(a, b);
  assert.equal(validateTerritoryPolygon(polygon).length, 4);
  assert.deepEqual(rectangleCorners(b, a), polygon);
  assert.equal(insideTerritory(43.155, -77.605, polygon), true);
  assert.throws(() => validateTerritoryPolygon(rectangleCorners(a, a)));
});
