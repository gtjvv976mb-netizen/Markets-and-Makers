// The apron: the working floor in front of a machine.
//
// The bay made placement possible; this is what makes it matter. Two numbers set the design,
// and both were measured rather than chosen:
//
//   Counting only OBJECTS standing on an apron gave a deliberately-bad level-4 layout 95% and
//   a considered one 94% — a swing of -1.3%. With one-tile machines in a 28-tile bay, aprons
//   almost never collide with an object, so nothing was ever contested. The scarce thing is
//   the working floor itself, so an overlapping apron is what costs you.
//
//   An apron three deep reaches from one bank across the aisle into the far bank, so every
//   machine contested every other and the AUTHORED DEFAULT scored 80% — a 20% tax on players
//   who never touched their floor. At two deep the default scores 100%.

import { beforeEach, describe, expect, it } from "vitest";
import {
  APRON_DEPTH, APRON_MIN_CLEARANCE, apronTiles, DEFAULT_EQUIPMENT_TILES, FACINGS, FITTINGS,
  FLOOR_WALKWAY_COLUMN, PLOTS, servicedTiles, tileIsBuildable,
  type FittingKey, type UpgradeKey,
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

const KEYS = Object.keys(DEFAULT_EQUIPMENT_TILES) as UpgradeKey[];
const STARTER = PLOTS.filter((p) => p.island === "hearth").sort((a, b) => a.price - b.price)[0]!;

function maker(level = 0): GameStore {
  const store = new GameStore(createFreshState());
  store.selectPlot(STARTER.id);
  store.leaseSelectedPlot();
  store.chooseLicense("greenhouse");
  store.placeBuilding();
  store.state.wallet = 5_000_000;
  for (const key of KEYS) store.state.upgrades[key] = level;
  return store;
}

describe("a machine with nothing bought is charged nothing", () => {
  it("gives a level-0 floor full clearance however it is arranged", () => {
    // No blank-room paralysis and no patch-day punishment: the penalty scales the machine's
    // own upgrade bonus, and zero times anything is zero.
    const store = maker(0);
    store.state.equipmentTiles = { yield: { column: 4, row: 0 }, capacity: { column: 5, row: 0 },
                                   speed: { column: 4, row: 1 }, appeal: { column: 5, row: 1 } };
    for (const key of KEYS) expect(store.apronClearance(key), key).toBe(1);
  });

  it("has no apron at all until something is bought", () => {
    expect(APRON_DEPTH[0]).toBe(0);
    expect(apronTiles({ column: 4, row: 3 }, "E", 0)).toHaveLength(0);
  });
});

describe("the authored default is a good layout", () => {
  it("scores full clearance even at max level", () => {
    // The game chose this arrangement, so it must not be the arrangement the game punishes.
    const store = maker(4);
    for (const key of KEYS) {
      expect(store.apronClearance(key), `${key} on the authored default`).toBe(1);
    }
  });
});

describe("the apron is the floor in front, and only in front", () => {
  it("lies on the facing side", () => {
    const tiles = apronTiles({ column: 4, row: 3 }, "E", 4);
    expect(tiles.length).toBeGreaterThan(0);
    for (const tile of tiles) expect(tile.column, "east means greater column").toBeGreaterThan(4);
  });

  it("turns with the machine", () => {
    const seen = FACINGS.map((facing) => JSON.stringify(apronTiles({ column: 4, row: 3 }, facing, 4)));
    expect(new Set(seen).size, "each facing must give a different apron").toBe(4);
  });

  it("never runs off the floor", () => {
    for (const facing of FACINGS) {
      for (const tile of apronTiles({ column: 0, row: 0 }, facing, 4)) {
        expect(tile.column).toBeGreaterThanOrEqual(0);
        expect(tile.row).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe("two machines cannot work the same floor", () => {
  it("costs both of them when their aprons overlap", () => {
    const store = maker(4);
    // Face two machines into each other across one bay column.
    store.state.equipmentTiles = { ...store.state.equipmentTiles,
      yield: { column: 4, row: 0 }, capacity: { column: 4, row: 2 } };
    store.state.equipmentFacing = { yield: "S", capacity: "N" };
    expect(store.apronClearance("yield"), "yield is squeezed").toBeLessThan(1);
    expect(store.apronClearance("capacity"), "capacity is squeezed").toBeLessThan(1);
  });

  it("treats the aisle as breathing room, not as a squeeze", () => {
    // The walkway and the shop floor beyond it hold no machines. Counting them as contested
    // floored every clearance at 0.70 simultaneously — a flat tax on everyone and a decision
    // for no one.
    // Level 2, so the apron is one deep and lands squarely ON the aisle and nowhere else.
    // (At level 4 it is two deep and reaches past the aisle into the far bank, which IS
    // contestable floor — so that case would prove nothing about the walkway.)
    const store = maker(2);
    store.state.equipmentTiles = { ...store.state.equipmentTiles,
      yield: { column: FLOOR_WALKWAY_COLUMN - 1, row: 3 } };
    store.state.equipmentFacing = { yield: "E" };   // faces straight at the walkway
    expect(APRON_DEPTH[2], "this test relies on a one-deep apron").toBe(1);
    for (const tile of store.apronOf("yield")) {
      expect(tileIsBuildable(tile.column, tile.row), "the whole apron must be open ground").toBe(false);
    }
    expect(store.apronClearance("yield")).toBe(1);
  });

  it("never falls below the floor, however bad the layout", () => {
    const store = maker(4);
    const bay = servicedTiles();
    store.state.equipmentTiles = Object.fromEntries(KEYS.map((k, i) => [k, bay[i]!])) as never;
    store.state.equipmentFacing = Object.fromEntries(KEYS.map((k) => [k, "S"])) as never;
    store.state.fittings = Object.fromEntries(
      (Object.keys(FITTINGS) as FittingKey[]).map((k, i) => [k, bay[4 + i]!])) as never;
    for (const key of KEYS) {
      expect(store.apronClearance(key), key).toBeGreaterThanOrEqual(APRON_MIN_CLEARANCE);
      expect(store.apronClearance(key), key).toBeLessThanOrEqual(1);
    }
  });

  it("does not punish a machine for its own fitting", () => {
    // A hopper feeding the yield station belongs on the yield station's apron.
    const store = maker(4);
    store.state.equipmentTiles = { ...store.state.equipmentTiles, yield: { column: 4, row: 3 } };
    store.state.equipmentFacing = { yield: "N" };
    const clear = store.apronClearance("yield");
    store.state.fittings = { hopper: { column: 4, row: 2 } };
    expect(FITTINGS.hopper.serves).toBe("yield");
    expect(store.apronClearance("yield"), "its own fitting is welcome").toBe(clear);
  });
});

describe("reach grows with the machine", () => {
  it("still counts a fitting that merely touches, exactly as before", () => {
    // Nothing may disconnect on patch day.
    const store = maker(0);
    const station = store.equipmentTile("yield");
    const beside = servicedTiles().find((tile) =>
      Math.abs(tile.column - station.column) <= 1 && Math.abs(tile.row - station.row) <= 1
      && !(tile.column === station.column && tile.row === station.row))!;
    expect(store.fittingIsConnected("hopper", beside.column, beside.row)).toBe(true);
  });

  it("never counts the machine's own tile", () => {
    const store = maker(4);
    const station = store.equipmentTile("yield");
    expect(store.fittingIsConnected("hopper", station.column, station.row)).toBe(false);
  });
});

describe("turning a machine", () => {
  it("cycles through all four faces and comes back", () => {
    const store = maker(2);
    const start = store.equipmentFacing("yield");
    const seen = new Set([start]);
    for (let i = 0; i < 3; i += 1) { store.rotateEquipment("yield"); seen.add(store.equipmentFacing("yield")); }
    expect(seen.size, "all four faces reachable").toBe(4);
    store.rotateEquipment("yield");
    expect(store.equipmentFacing("yield"), "and back to where it started").toBe(start);
  });

  it("defaults to facing the aisle", () => {
    const store = maker(2);
    for (const key of KEYS) {
      const tile = store.equipmentTile(key);
      const expected = tile.column < FLOOR_WALKWAY_COLUMN ? "E" : "W";
      expect(store.equipmentFacing(key), `${key} should face the walkway`).toBe(expected);
    }
  });

  it("survives a save and a reload", () => {
    const store = maker(2);
    store.rotateEquipment("yield");
    const turned = store.equipmentFacing("yield");
    const reloaded = new GameStore(JSON.parse(JSON.stringify(store.state)));
    expect(reloaded.equipmentFacing("yield")).toBe(turned);
  });

  it("ignores a hand-edited facing that is not a facing", () => {
    const store = maker(2);
    store.state.equipmentFacing = { yield: "SOUTHWEST" as never };
    const reloaded = new GameStore(createFreshState());
    expect(FACINGS).toContain(reloaded.equipmentFacing("yield"));
  });
});

describe("layout is worth thinking about", () => {
  it("separates a careless floor from a considered one", () => {
    // Searched rather than hand-picked: my hand-authored "good" and "bad" layouts measured a
    // NEGATIVE swing, because I was guessing at what the rule rewarded.
    const store = maker(4);
    const bay = servicedTiles();
    const fittingKeys = Object.keys(FITTINGS) as FittingKey[];
    let seed = 12345;
    const rnd = (): number => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const value = (): number => {
      const clear = KEYS.map((k) => store.apronClearance(k));
      const effects = store.fittingEffects();
      return (clear.reduce((a, b) => a + b, 0) / 4) * effects.output * effects.price * effects.storage;
    };
    let best = -1, worst = Number.POSITIVE_INFINITY;
    for (let trial = 0; trial < 1500; trial += 1) {
      const pool = [...bay].sort(() => rnd() - 0.5);
      store.state.equipmentTiles = Object.fromEntries(KEYS.map((k, i) => [k, pool[i]!])) as never;
      store.state.equipmentFacing = Object.fromEntries(
        KEYS.map((k) => [k, FACINGS[Math.floor(rnd() * FACINGS.length)]!])) as never;
      store.state.fittings = Object.fromEntries(
        fittingKeys.map((k, i) => [k, pool[KEYS.length + i]!])) as never;
      const v = value();
      if (v > best) best = v;
      if (v < worst) worst = v;
    }
    expect(worst, "the search must have found something").toBeGreaterThan(0);
    expect(best / worst, `spread was only ${(best / worst).toFixed(2)}x — layout does not matter enough`)
      .toBeGreaterThan(1.5);
  });

  it("keeps every bay tile legal to build on", () => {
    for (const tile of servicedTiles()) expect(tileIsBuildable(tile.column, tile.row)).toBe(true);
  });
});
