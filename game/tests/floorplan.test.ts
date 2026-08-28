// The production floor as something a maker lays out.
//
// Equipment used to sit at four authored positions, the same in every business in the
// city, so a floor was something you filled rather than arranged and two greenhouses were
// the same room twice. It is a grid now, and where a machine stands is the owner's call.
//
// The rules worth protecting: nothing may sit off the grid, nothing may block the walkway
// that leads to the back of the room, two machines may not share a tile, and a save can
// never strand a machine somewhere its owner cannot reach.

import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_EQUIPMENT_TILES, FLOOR_COLUMNS, FLOOR_ROWS, FLOOR_TILE, FLOOR_WALKWAY_COLUMN,
  PLOTS, SAVE_KEY, tileIsBuildable, tileToWorld, worldToTile, type LicenseKey, type UpgradeKey,
} from "../src/data";
import { createFreshState, GameStore } from "../src/state";

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

const STARTER = PLOTS.filter((p) => p.island === "hearth").sort((a, b) => a.price - b.price)[0]!;

function maker(licence: LicenseKey = "cratemill"): GameStore {
  const store = new GameStore(createFreshState());
  store.selectPlot(STARTER.id);
  store.leaseSelectedPlot();
  store.chooseLicense(licence);
  store.placeBuilding();
  return store;
}

/** A tile that is on the grid, buildable, and holds nothing. */
function freeTile(store: GameStore): { column: number; row: number } {
  for (let row = 0; row < FLOOR_ROWS; row += 1) {
    for (let column = 0; column < FLOOR_COLUMNS; column += 1) {
      if (tileIsBuildable(column, row) && store.equipmentAt(column, row) === null) return { column, row };
    }
  }
  throw new Error("the floor has no free tile — the grid is too small for four machines");
}

describe("tiles and world positions agree", () => {
  it("round-trips every tile on the floor", () => {
    // If these disagree, a machine dropped under the cursor lands somewhere else.
    for (let row = 0; row < FLOOR_ROWS; row += 1) {
      for (let column = 0; column < FLOOR_COLUMNS; column += 1) {
        const world = tileToWorld(column, row);
        expect(worldToTile(world.x, world.z), `tile ${column},${row}`).toEqual({ column, row });
      }
    }
  });

  it("snaps a position between two tiles to the nearer one", () => {
    const a = tileToWorld(2, 2);
    const nudged = worldToTile(a.x + FLOOR_TILE * 0.3, a.z + FLOOR_TILE * 0.3);
    expect(nudged).toEqual({ column: 2, row: 2 });
  });

  it("clamps a position off the floor back onto it", () => {
    const far = worldToTile(9_999, 9_999);
    expect(far.column).toBe(FLOOR_COLUMNS - 1);
    expect(far.row).toBe(FLOOR_ROWS - 1);
    const behind = worldToTile(-9_999, -9_999);
    expect(behind).toEqual({ column: 0, row: 0 });
  });
});

describe("the walkway stays open", () => {
  it("refuses the whole centre column", () => {
    for (let row = 0; row < FLOOR_ROWS; row += 1) {
      expect(tileIsBuildable(FLOOR_WALKWAY_COLUMN, row), `row ${row}`).toBe(false);
    }
  });

  it("refuses a placement into it, with a reason", () => {
    const store = maker();
    const outcome = store.placeEquipment("yield", FLOOR_WALKWAY_COLUMN, 2);
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toMatch(/walkway/i);
  });

  it("leaves the authored layout clear of it", () => {
    for (const [key, tile] of Object.entries(DEFAULT_EQUIPMENT_TILES)) {
      expect(tileIsBuildable(tile.column, tile.row), `${key} starts somewhere buildable`).toBe(true);
    }
  });
});

describe("two machines cannot share a tile", () => {
  it("refuses a tile another machine already holds", () => {
    const store = maker();
    const taken = store.equipmentTile("capacity");
    const outcome = store.placeEquipment("yield", taken.column, taken.row);
    expect(outcome.ok).toBe(false);
    expect(store.equipmentTile("yield"), "and the mover did not move").toEqual(DEFAULT_EQUIPMENT_TILES.yield);
  });

  it("lets a machine be dropped back where it already stands", () => {
    // Picking one up and changing your mind must not be a move you cannot undo.
    const store = maker();
    const here = store.equipmentTile("yield");
    expect(store.placeEquipment("yield", here.column, here.row).ok).toBe(true);
  });

  it("moves a machine to an empty tile", () => {
    const store = maker();
    const spot = freeTile(store);
    expect(store.placeEquipment("speed", spot.column, spot.row).ok).toBe(true);
    expect(store.equipmentTile("speed")).toEqual(spot);
    expect(store.equipmentAt(spot.column, spot.row)).toBe("speed");
  });

  it("frees the tile it came from", () => {
    const store = maker();
    const from = store.equipmentTile("appeal");
    const to = freeTile(store);
    store.placeEquipment("appeal", to.column, to.row);
    expect(store.equipmentAt(from.column, from.row), "the old tile is empty").toBeNull();
  });

  it("starts with all four on distinct tiles", () => {
    const store = maker();
    const seen = new Set<string>();
    for (const key of Object.keys(DEFAULT_EQUIPMENT_TILES) as UpgradeKey[]) {
      const tile = store.equipmentTile(key);
      seen.add(`${tile.column}:${tile.row}`);
    }
    expect(seen.size, "four machines, four tiles").toBe(4);
  });
});

describe("a save can never strand a machine", () => {
  // Go through the REAL load path: write a save, then construct with no argument, which
  // is what the game does on boot. Passing a state object straight to the constructor
  // skips loadState entirely — and so skips the very sanitiser under test.
  const load = (tiles: unknown): GameStore => {
    maker();
    const raw = JSON.parse(localStorage.getItem(SAVE_KEY)!);
    raw.equipmentTiles = tiles;
    localStorage.setItem(SAVE_KEY, JSON.stringify(raw));
    return new GameStore();
  };

  it("pulls a machine off the grid back to its authored spot", () => {
    const store = load({ yield: { column: 99, row: 99 } });
    expect(store.equipmentTile("yield")).toEqual(DEFAULT_EQUIPMENT_TILES.yield);
  });

  it("pulls a machine out of the walkway", () => {
    const store = load({ speed: { column: FLOOR_WALKWAY_COLUMN, row: 1 } });
    expect(tileIsBuildable(store.equipmentTile("speed").column, store.equipmentTile("speed").row)).toBe(true);
  });

  it("refuses to stack two machines a hand-edited save put on one tile", () => {
    const store = load({ yield: { column: 2, row: 2 }, capacity: { column: 2, row: 2 } });
    const a = store.equipmentTile("yield");
    const b = store.equipmentTile("capacity");
    expect(`${a.column}:${a.row}`, "they were separated").not.toBe(`${b.column}:${b.row}`);
  });

  it("survives junk instead of a layout", () => {
    for (const junk of [null, "nonsense", 42, { yield: "over there" }]) {
      const store = load(junk);
      for (const key of Object.keys(DEFAULT_EQUIPMENT_TILES) as UpgradeKey[]) {
        const tile = store.equipmentTile(key);
        expect(tileIsBuildable(tile.column, tile.row), `${key} with junk ${JSON.stringify(junk)}`).toBe(true);
      }
    }
  });
});
