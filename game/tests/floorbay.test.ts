// The serviced bay, and the migration that has to carry every existing floor into it.
//
// The bay cuts the buildable floor from 84 tiles to 28. That is the change that makes
// placement matter at all — measured, an exhaustive enumeration of 909,298 arrangements found
// the untouched default layout already scoring 98-99% of the theoretical best at 84 tiles, so
// no adjacency rule could ever have bound. But it means every save written before it has
// machines standing on tiles that no longer exist.

import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_EQUIPMENT_TILES, FITTINGS, FLOOR_COLUMNS, FLOOR_ROWS, FLOOR_WALKWAY_COLUMN,
  servicedTiles, tileIsBuildable, type FittingKey,
} from "../src/data";
import { SAVE_KEY } from "../src/data";
import { createFreshState, GameStore, loadState } from "../src/state";

class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length(): number { return this.data.size; }
  clear(): void { this.data.clear(); }
  getItem(key: string): string | null { return this.data.get(key) ?? null; }
  key(index: number): string | null { return [...this.data.keys()][index] ?? null; }
  removeItem(key: string): void { this.data.delete(key); }
  setItem(key: string, value: string): void { this.data.set(key, value); }
}

beforeEach(() => {
  Object.defineProperty(globalThis, "localStorage", { value: new MemoryStorage(), configurable: true });
});

/** Write a save the way a player from before the bay would have left it. */
function seed(extra: Record<string, unknown>): void {
  const base = createFreshState();
  localStorage.setItem(SAVE_KEY, JSON.stringify({ ...base, ...extra }));
}

describe("the serviced bay", () => {
  it("is the whole floor, except the walkway", () => {
    // The 28-tile bay was the measured answer to "placement cannot matter on 84 tiles";
    // the owner's spec overruled it — equipment goes ANYWHERE on the floor. Placement
    // pressure now comes from the apron rules alone, at whatever strength the space leaves
    // them, and that trade-off is the owner's to make.
    const tiles = servicedTiles();
    expect(tiles.length).toBe(FLOOR_COLUMNS * FLOOR_ROWS - FLOOR_ROWS);
    for (const tile of tiles) expect(tile.column).not.toBe(FLOOR_WALKWAY_COLUMN);
  });

  it("leaves the walkway open end to end", () => {
    for (let row = 0; row < FLOOR_ROWS; row += 1) {
      expect(tileIsBuildable(FLOOR_WALKWAY_COLUMN, row), `row ${row}`).toBe(false);
    }
  });

  it("has room for every machine and every fitting at once", () => {
    // Ten things must fit, or a maxed-out player cannot lay their floor at all.
    const needed = Object.keys(DEFAULT_EQUIPMENT_TILES).length + Object.keys(FITTINGS).length;
    expect(servicedTiles().length).toBeGreaterThanOrEqual(needed);
  });

  it("seats every authored default inside itself", () => {
    for (const [key, tile] of Object.entries(DEFAULT_EQUIPMENT_TILES)) {
      expect(tileIsBuildable(tile.column, tile.row), `${key} default is off the bay`).toBe(true);
    }
  });

  it("rejects only the walkway", () => {
    let outside = 0;
    for (let row = 0; row < FLOOR_ROWS; row += 1) {
      for (let column = 0; column < FLOOR_COLUMNS; column += 1) {
        if (!tileIsBuildable(column, row)) outside += 1;
      }
    }
    expect(outside, "one open column from the door to the back wall").toBe(FLOOR_ROWS);
  });
});

describe("carrying an old floor into the bay", () => {
  it("never destroys a fitting somebody paid for", () => {
    // The old sanitiser DROPPED any fitting that failed tileIsBuildable. Shrinking the floor
    // under that rule would have deleted up to six purchases of 240-360 MM each, silently.
    seed({
      equipmentTiles: { yield: { column: 2, row: 2 }, capacity: { column: 10, row: 2 },
                        speed: { column: 2, row: 4 }, appeal: { column: 10, row: 4 } },
      fittings: { hopper: { column: 1, row: 2 }, kiln: { column: 11, row: 2 },
                  governor: { column: 0, row: 5 }, sorter: { column: 12, row: 0 },
                  rack: { column: 1, row: 6 }, counter: { column: 11, row: 6 } },
    });
    const state = loadState();
    const kept = Object.keys(state.fittings) as FittingKey[];
    expect(kept.sort(), "every paid fitting must survive the move")
      .toEqual(["counter", "governor", "hopper", "kiln", "rack", "sorter"]);
    for (const key of kept) {
      const tile = state.fittings[key]!;
      expect(tileIsBuildable(tile.column, tile.row), `${key} landed off the bay`).toBe(true);
    }
  });

  it("keeps left-hand machines on the left and right on the right", () => {
    seed({
      equipmentTiles: { yield: { column: 2, row: 1 }, capacity: { column: 10, row: 1 },
                        speed: { column: 1, row: 5 }, appeal: { column: 11, row: 5 } },
      fittings: {},
    });
    const tiles = loadState().equipmentTiles;
    expect(tiles.yield!.column, "yield was on the left").toBeLessThan(FLOOR_WALKWAY_COLUMN);
    expect(tiles.speed!.column, "speed was on the left").toBeLessThan(FLOOR_WALKWAY_COLUMN);
    expect(tiles.capacity!.column, "capacity was on the right").toBeGreaterThan(FLOOR_WALKWAY_COLUMN);
    expect(tiles.appeal!.column, "appeal was on the right").toBeGreaterThan(FLOOR_WALKWAY_COLUMN);
  });

  it("keeps the rows a player chose", () => {
    seed({
      equipmentTiles: { yield: { column: 2, row: 0 }, capacity: { column: 10, row: 3 },
                        speed: { column: 2, row: 6 }, appeal: { column: 10, row: 6 } },
      fittings: {},
    });
    const tiles = loadState().equipmentTiles;
    expect(tiles.yield!.row).toBe(0);
    expect(tiles.capacity!.row).toBe(3);
    expect(tiles.speed!.row).toBe(6);
    expect(tiles.appeal!.row).toBe(6);
  });

  it("never stacks two things on one tile", () => {
    seed({
      equipmentTiles: { yield: { column: 0, row: 0 }, capacity: { column: 0, row: 0 },
                        speed: { column: 0, row: 0 }, appeal: { column: 0, row: 0 } },
      fittings: Object.fromEntries((Object.keys(FITTINGS) as FittingKey[]).map((k) => [k, { column: 0, row: 0 }])),
    });
    const state = loadState();
    const seen = new Set<string>();
    for (const tile of [...Object.values(state.equipmentTiles), ...Object.values(state.fittings)]) {
      const id = `${tile.column}:${tile.row}`;
      expect(seen.has(id), `two things on ${id}`).toBe(false);
      seen.add(id);
      expect(tileIsBuildable(tile.column, tile.row)).toBe(true);
    }
    expect(seen.size, "all ten must be seated").toBe(10);
  });

  it("leaves a floor that was already legal completely alone", () => {
    // Walkway-relative, so growing the grid cannot silently turn this seed illegal — its
    // first version put capacity on column 8, which BECAME the walkway when the floor grew,
    // and the sanitiser was then correctly relocating a tile this test swore was legal.
    const W = FLOOR_WALKWAY_COLUMN;
    const legal = { yield: { column: W - 4, row: 0 }, capacity: { column: W + 2, row: 0 },
                    speed: { column: W - 3, row: 6 }, appeal: { column: W + 1, row: 6 } };
    seed({ equipmentTiles: legal, fittings: { hopper: { column: W - 4, row: 1 } } });
    const state = loadState();
    expect(state.equipmentTiles).toMatchObject(legal);
    expect(state.fittings.hopper).toMatchObject({ column: W - 4, row: 1 });
  });

  it("still lets a migrated player move things afterwards", () => {
    seed({ equipmentTiles: { yield: { column: 2, row: 2 } }, fittings: {} });
    const store = new GameStore(loadState());
    const free = servicedTiles().find((tile) =>
      !Object.values(store.state.equipmentTiles).some((t) => t.column === tile.column && t.row === tile.row))!;
    expect(store.placeEquipment("yield", free.column, free.row).ok).toBe(true);
  });
});
