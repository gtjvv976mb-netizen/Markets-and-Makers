// The browser's floor rule must agree with the authority's, exactly.
//
// Same fixtures as server/tests/floor.test.ts. Change one engine without the other and BOTH
// suites go red on the same named fixture — which is the point, because the alternative is
// a maker being shown one production number and paid a different one.

import { describe, expect, it } from "vitest";
// Vite's ?raw, NOT node:fs — this is the browser package and it has no @types/node. Reaching
// for node:fs here has broken the build twice already.
import fixturesRaw from "../../shared/floor-fixtures.json?raw";
import { floorEffects, type FloorLayout, type FloorEffects } from "../src/floorEffects";

interface Fixture { name: string; layout: FloorLayout; expected: FloorEffects }

const fixtures = JSON.parse(fixturesRaw as string) as Fixture[];

describe("the browser computes the floor the fixtures pin", () => {
  it("has fixtures to check", () => {
    expect(fixtures.length).toBeGreaterThan(20);
  });

  it("covers the range the rule can produce, not just easy cases", () => {
    // A fixture set that only ever exercises one answer proves nothing.
    const clearances = fixtures.flatMap((f) => Object.values(f.expected.clearance));
    expect(Math.min(...clearances), "some fixture must be a squeezed floor").toBeLessThan(1);
    expect(Math.max(...clearances), "and some must be a clean one").toBe(1);
    expect(new Set(fixtures.map((f) => f.expected.connected.length)).size,
      "fixtures must differ in how many fittings reach").toBeGreaterThan(1);
  });

  for (const fixture of fixtures) {
    it(`agrees on ${fixture.name}`, () => {
      const actual = floorEffects(fixture.layout);
      expect(actual.clearance, "clearance").toEqual(fixture.expected.clearance);
      expect([...actual.connected].sort(), "connected fittings").toEqual([...fixture.expected.connected].sort());
      expect(actual.output, "output").toBeCloseTo(fixture.expected.output, 10);
      expect(actual.speed, "speed").toBeCloseTo(fixture.expected.speed, 10);
      expect(actual.price, "price").toBeCloseTo(fixture.expected.price, 10);
      expect(actual.storage, "storage").toBeCloseTo(fixture.expected.storage, 10);
      expect(actual.inputThrift, "inputThrift").toBeCloseTo(fixture.expected.inputThrift, 10);
      expect(actual.benches, "benches").toBe(fixture.expected.benches);
      expect(actual.frontage, "frontage").toBe(fixture.expected.frontage);
    });
  }
});
