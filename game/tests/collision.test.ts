import { describe, expect, it } from "vitest";
import { ObstacleField, PLAYER_RADIUS, route, type Blocker } from "../src/collision";

/** Every leg of a route must be walkable end to end, not merely its waypoints. */
function legsAreClear(
  field: ObstacleField,
  startX: number,
  startZ: number,
  path: Array<{ x: number; z: number }>,
): boolean {
  let fromX = startX;
  let fromZ = startZ;
  for (const point of path) {
    const span = Math.hypot(point.x - fromX, point.z - fromZ);
    const steps = Math.max(1, Math.ceil(span / 0.2));
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      if (field.blocked(fromX + (point.x - fromX) * t, fromZ + (point.z - fromZ) * t, PLAYER_RADIUS, false)) {
        return false;
      }
    }
    fromX = point.x;
    fromZ = point.z;
  }
  return true;
}

describe("obstacle field", () => {
  it("blocks a body standing inside a footprint", () => {
    const field = new ObstacleField();
    field.addBox(0, 0, 15, 15);
    expect(field.blocked(0, 0)).toBe(true);
    expect(field.blocked(7, 0)).toBe(true);
  });

  it("clears a body standing its own radius outside", () => {
    const field = new ObstacleField();
    field.addBox(0, 0, 15, 15);
    // The wall is at x=7.5; a body of PLAYER_RADIUS is clear from 7.5+r onwards.
    expect(field.blocked(7.5 + PLAYER_RADIUS + 0.01, 0)).toBe(false);
    expect(field.blocked(20, 20)).toBe(false);
  });

  it("finds footprints far from the origin, across grid cells", () => {
    const field = new ObstacleField();
    field.addBox(-73, 7, 15.04, 11.28);
    expect(field.blocked(-73, 7)).toBe(true);
    expect(field.blocked(-73, 20)).toBe(false);
  });

  it("pushes a trapped body out along the shallower axis", () => {
    const field = new ObstacleField();
    field.addBox(0, 0, 20, 4);
    // Deep in x, shallow in z: the way out is in z.
    const pushed = field.push(1, 1.4);
    expect(pushed.moved).toBe(true);
    expect(field.blocked(pushed.x, pushed.z)).toBe(false);
    expect(Math.abs(pushed.z)).toBeGreaterThan(2);
    expect(pushed.x).toBeCloseTo(1, 5);
  });

  it("leaves a body that is already clear exactly where it stands", () => {
    const field = new ObstacleField();
    field.addBox(0, 0, 10, 10);
    const pushed = field.push(30, 30);
    expect(pushed.moved).toBe(false);
    expect(pushed.x).toBe(30);
    expect(pushed.z).toBe(30);
  });

  it("counts moving footprints as solid, and re-reads them each query", () => {
    const field = new ObstacleField();
    let car: Blocker = { x: 5, z: 0, halfX: 2, halfZ: 1 };
    field.setMovers(() => [car]);
    expect(field.blocked(5, 0)).toBe(true);
    car = { x: 40, z: 0, halfX: 2, halfZ: 1 };
    expect(field.blocked(5, 0)).toBe(false);
  });
});

describe("routing", () => {
  it("returns the straight line when nothing is in the way", () => {
    const field = new ObstacleField();
    const path = route(field, 0, 0, 20, 0);
    expect(path).toEqual([{ x: 20, z: 0 }]);
  });

  it("routes around a building instead of giving up", () => {
    const field = new ObstacleField();
    field.addBox(0, 0, 15, 15);
    const path = route(field, 0, -20, 0, 20);
    expect(path).not.toBeNull();
    expect(path!.length).toBeGreaterThan(1);
    expect(legsAreClear(field, 0, -20, path!)).toBe(true);
    const end = path![path!.length - 1]!;
    expect(Math.hypot(end.x - 0, end.z - 20)).toBeLessThan(0.001);
  });

  it("finds no route when the goal is walled off on every side", () => {
    const field = new ObstacleField();
    // A closed box around the goal, walls thicker than the body.
    field.addBox(0, -6, 14, 2);
    field.addBox(0, 6, 14, 2);
    field.addBox(-6, 0, 2, 14);
    field.addBox(6, 0, 2, 14);
    expect(route(field, 30, 30, 0, 0)).toBeNull();
  });

  it("walks to the edge of a building when the click lands on its roof", () => {
    const field = new ObstacleField();
    field.addBox(0, 0, 15, 15);
    const path = route(field, 0, -20, 0, 0);
    expect(path).not.toBeNull();
    const end = path![path!.length - 1]!;
    expect(field.blocked(end.x, end.z, PLAYER_RADIUS, false)).toBe(false);
    expect(legsAreClear(field, 0, -20, path!)).toBe(true);
  });

  it("threads a gap that is wide enough and refuses one that is not", () => {
    // Walls long enough to seal the corridor: anything shorter and the router is
    // right to walk around the end, which is what the first draft of this fixture
    // actually measured.
    const wide = new ObstacleField();
    wide.addBox(-31, 0, 60, 2);
    wide.addBox(31, 0, 60, 2);   // a 2 m gap at x=0
    const through = route(wide, 0, -12, 0, 12);
    expect(through).not.toBeNull();
    expect(legsAreClear(wide, 0, -12, through!)).toBe(true);

    const narrow = new ObstacleField();
    narrow.addBox(-30.3, 0, 60, 2);
    narrow.addBox(30.3, 0, 60, 2); // a 0.6 m gap: narrower than the body
    expect(route(narrow, 0, -12, 0, 12)).toBeNull();
  });

  it("ignores traffic when routing, so a route does not go stale behind a car", () => {
    const field = new ObstacleField();
    field.setMovers(() => [{ x: 10, z: 0, halfX: 2, halfZ: 1 }]);
    expect(route(field, 0, 0, 20, 0)).toEqual([{ x: 20, z: 0 }]);
  });
});
