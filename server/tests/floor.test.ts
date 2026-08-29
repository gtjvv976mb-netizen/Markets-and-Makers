// The authority's floor rule must agree with the browser's, exactly.
//
// Both suites execute shared/floor-fixtures.json. A change made to one engine and not the
// other turns both red on the same named fixture, which is the only way a spatial rule
// running in two places fails loudly rather than in somebody's balance.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { floorEffects, type FloorLayout, type FloorEffects } from "../src/floor.js";

interface Fixture { name: string; layout: FloorLayout; expected: FloorEffects }

const fixtures = JSON.parse(
  readFileSync(resolve(process.cwd(), "../shared/floor-fixtures.json"), "utf8"),
) as Fixture[];

describe("the authority computes the same floor as the browser", () => {
  it("has fixtures to check", () => {
    expect(fixtures.length, "no fixtures loaded — the path is wrong").toBeGreaterThan(20);
  });

  for (const fixture of fixtures) {
    it(`agrees on ${fixture.name}`, () => {
      const actual = floorEffects(fixture.layout);
      // Named field by field so a mismatch says WHICH multiplier drifted.
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
