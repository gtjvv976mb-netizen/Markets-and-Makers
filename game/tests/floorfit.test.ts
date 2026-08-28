import { describe, expect, it } from "vitest";
import { FLOOR_COLUMNS, FLOOR_ROWS, tileIsBuildable, tileToWorld } from "../src/data";
import { ROOM_HALF_WIDTH, ROOM_HALF_DEPTH, PROP_SLOTS } from "../src/interiorWorld";

describe("the cleared floor fits its room", () => {
  it("keeps every buildable tile inside the walls", () => {
    const outside: string[] = [];
    let buildable = 0;
    for (let row = 0; row < FLOOR_ROWS; row += 1) {
      for (let column = 0; column < FLOOR_COLUMNS; column += 1) {
        if (!tileIsBuildable(column, row)) continue;
        buildable += 1;
        const world = tileToWorld(column, row);
        if (Math.abs(world.x) > ROOM_HALF_WIDTH - 0.8 || Math.abs(world.z) > ROOM_HALF_DEPTH - 0.8) {
          outside.push(`${column},${row}`);
        }
      }
    }
    console.log(`room ${ROOM_HALF_WIDTH * 2}x${ROOM_HALF_DEPTH * 2}, ${buildable} buildable tiles, kit pieces ${PROP_SLOTS.length}`);
    expect(outside, `tiles outside the walls: ${outside.join(" ")}`).toHaveLength(0);
    expect(buildable, "a floor worth arranging").toBeGreaterThan(40);
  });

  it("stands the floor kit clear of the buildable grid", () => {
    for (const [x, z] of PROP_SLOTS) {
      expect(Math.abs(x) < ROOM_HALF_WIDTH, `kit at ${x},${z} inside the room`).toBe(true);
      expect(Math.abs(z) < ROOM_HALF_DEPTH, `kit at ${x},${z} inside the room`).toBe(true);
    }
  });
});
