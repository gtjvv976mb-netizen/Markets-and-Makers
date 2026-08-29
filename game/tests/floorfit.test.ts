import { describe, expect, it } from "vitest";
import { FLOOR_COLUMNS, FLOOR_ROWS, tileIsBuildable, tileToWorld } from "../src/data";
import { ROOM_HALF_WIDTH, ROOM_HALF_DEPTH } from "../src/interiorWorld";

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
    console.log(`room ${ROOM_HALF_WIDTH * 2}x${ROOM_HALF_DEPTH * 2}, ${buildable} buildable tiles, nothing else on the floor`);
    expect(outside, `tiles outside the walls: ${outside.join(" ")}`).toHaveLength(0);
    // This used to assert `> 40`, on my assumption that more buildable tiles meant more floor
    // worth arranging. Measurement said the exact opposite: at 84 tiles a hill-climber and an
    // exhaustive enumeration of 909,298 station arrangements both found the untouched default
    // layout already scoring 98-99% of the theoretical best, because with that much room every
    // adjacency rule is trivially satisfiable. A big floor is not an interesting one. The bay
    // has to be tight enough that a placement can be wrong, and large enough to hold all ten
    // things a maxed-out maker owns.
    expect(buildable, "tight enough that arrangement is a real choice").toBeLessThanOrEqual(32);
    expect(buildable, "roomy enough for 4 machines and 6 fittings").toBeGreaterThanOrEqual(10 + 4);
  });

});
