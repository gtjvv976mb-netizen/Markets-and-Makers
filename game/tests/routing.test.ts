// The router sees terrain, detours around it, and stays cheap enough to replan mid-walk.
//
// Found in live play: route() planned a straight "clear" line across ground whose height
// sample was null (obstacles-only vision), and the avatar could only slide along its edge.
// The fix threads a walkability standard through the search, the straight-line shortcut and
// the smoothing pass — and because the standard is answered by raycasts in the real world,
// the search had to move from a linear-scan open list (one cold cross-island route measured
// 16.5 SECONDS of main-thread stall) to a real heap, with results memoised on the router's
// own 1-unit lattice.

import { describe, expect, it } from "vitest";
import { ObstacleField, route } from "../src/collision";

const field = new ObstacleField();

describe("terrain-aware routing", () => {
  it("detours around ground the mover cannot stand on", () => {
    // A null-terrain wall at x=5 with a gap at z>=8: the straight line crosses the wall.
    const walkable = (x: number, _z: number): boolean => !(x > 4 && x < 6 && _z < 8);
    const legs = route(field, 0, 0, 10, 0, { isWalkable: walkable });
    expect(legs, "a route must exist through the gap").not.toBeNull();
    // walk the returned polyline and assert no sampled point is unwalkable
    let fromX = 0, fromZ = 0;
    for (const leg of legs!) {
      const span = Math.hypot(leg.x - fromX, leg.z - fromZ);
      const steps = Math.max(1, Math.ceil(span / 0.4));
      for (let i = 0; i <= steps; i += 1) {
        const t = i / steps;
        const x = fromX + (leg.x - fromX) * t;
        const z = fromZ + (leg.z - fromZ) * t;
        expect(walkable(x, z), `path crosses bad ground at (${x.toFixed(1)},${z.toFixed(1)})`).toBe(true);
      }
      fromX = leg.x; fromZ = leg.z;
    }
  });

  it("smoothing does not re-cross what the search detoured around", () => {
    // A thin wall with one narrow gate far off the straight line: smoothing that ignored
    // walkability would cut the corner straight back through the wall.
    const walkable = (x: number, z: number): boolean => !(x > 9 && x < 11 && Math.abs(z) < 14 && !(z > 10 && z < 12));
    const legs = route(field, 0, 0, 20, 0, { isWalkable: walkable });
    expect(legs).not.toBeNull();
    let fromX = 0, fromZ = 0, crossed = false;
    for (const leg of legs!) {
      const span = Math.hypot(leg.x - fromX, leg.z - fromZ);
      const steps = Math.max(1, Math.ceil(span / 0.3));
      for (let i = 0; i <= steps; i += 1) {
        const t = i / steps;
        if (!walkable(fromX + (leg.x - fromX) * t, fromZ + (leg.z - fromZ) * t)) crossed = true;
      }
      fromX = leg.x; fromZ = leg.z;
    }
    expect(crossed, "smoothed path re-crossed the wall").toBe(false);
  });

  it("routes a long distance in milliseconds, not seconds", () => {
    // The heap + a permissive walkability: pure search cost. Node timing is honest.
    const t0 = performance.now();
    for (let i = 0; i < 20; i += 1) {
      const legs = route(field, -80, -80, 80, 80, { isWalkable: () => true });
      expect(legs).not.toBeNull();
    }
    const ms = performance.now() - t0;
    expect(ms, `20 cross-island routes took ${ms.toFixed(0)}ms`).toBeLessThan(500);
  });

  it("asks the walkability oracle a bounded number of times", () => {
    let calls = 0;
    const walkable = (x: number, z: number): boolean => { calls += 1; return !(x > 20 && x < 22 && z < 30); };
    route(field, 0, 0, 60, 60, { isWalkable: walkable });
    // The budget the world grants per route is 4,000 fresh raycasts; the search itself must
    // stay in that order of magnitude or the budget silently disables terrain vision.
    expect(calls, `oracle asked ${calls} times`).toBeLessThan(30_000);
  });
});
