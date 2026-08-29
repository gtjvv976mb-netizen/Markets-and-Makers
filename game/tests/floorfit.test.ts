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
    // The floor's size has now been set BOTH ways by measurement-versus-spec. Measurement
    // said 84 tiles lets every adjacency rule be trivially satisfied, so a 28-tile bay was
    // built; the owner then ruled that equipment goes ANYWHERE on the floor, which wins.
    // What this test still owes: the whole floor minus exactly one walkway column, and room
    // for everything a maxed-out maker owns.
    expect(buildable).toBe(FLOOR_COLUMNS * FLOOR_ROWS - FLOOR_ROWS);
    expect(buildable, "roomy enough for 4 machines and 6 fittings").toBeGreaterThanOrEqual(10 + 4);
  });

});
