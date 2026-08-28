// Equipment a maker CHOOSES, as opposed to the four they are given.
//
// The upgrade stations are identical in every business and only go up — buying the next
// level when you can afford it is not a decision. Fittings are the opposite: there are
// more of them than fit, each pulls the line a different way, and one only works standing
// beside the station it serves. A station has at most eight neighbours, so floor space
// next to the machine that matters is the scarce thing.
//
// The rule worth protecting hardest: a fitting away from its station does NOTHING. If
// owning it were enough, the placement would be decoration and the whole mechanic empty.

import { beforeEach, describe, expect, it } from "vitest";
import { FITTINGS, FLOOR_COLUMNS, FLOOR_ROWS, PLOTS, tileIsBuildable, type FittingKey, type LicenseKey } from "../src/data";
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

function maker(licence: LicenseKey = "cratemill", purse = 5_000): GameStore {
  const store = new GameStore(createFreshState());
  store.selectPlot(STARTER.id);
  store.leaseSelectedPlot();
  store.chooseLicense(licence);
  store.placeBuilding();
  store.state.wallet = purse;
  return store;
}

/** A buildable, empty tile touching the station this fitting serves. */
function beside(store: GameStore, key: FittingKey): { column: number; row: number } {
  const station = store.equipmentTile(FITTINGS[key].serves);
  for (let dc = -1; dc <= 1; dc += 1) {
    for (let dr = -1; dr <= 1; dr += 1) {
      if (!dc && !dr) continue;
      const column = station.column + dc;
      const row = station.row + dr;
      if (tileIsBuildable(column, row) && store.equipmentAt(column, row) === null
        && store.fittingAt(column, row) === null) return { column, row };
    }
  }
  throw new Error("no free tile beside the station");
}

/** A buildable, empty tile as far from that station as the floor allows. */
function faraway(store: GameStore, key: FittingKey): { column: number; row: number } {
  const station = store.equipmentTile(FITTINGS[key].serves);
  let best: { column: number; row: number } | null = null;
  let bestGap = -1;
  for (let row = 0; row < FLOOR_ROWS; row += 1) {
    for (let column = 0; column < FLOOR_COLUMNS; column += 1) {
      if (!tileIsBuildable(column, row)) continue;
      if (store.equipmentAt(column, row) !== null || store.fittingAt(column, row) !== null) continue;
      const gap = Math.max(Math.abs(column - station.column), Math.abs(row - station.row));
      if (gap > bestGap) { bestGap = gap; best = { column, row }; }
    }
  }
  if (!best || bestGap <= 1) throw new Error("no tile far from the station");
  return best;
}

describe("a fitting only works where it stands", () => {
  it("does its job beside the station it serves", () => {
    const store = maker();
    const spot = beside(store, "hopper");
    expect(store.installFitting("hopper", spot.column, spot.row).ok).toBe(true);
    expect(store.activeFittings()).toContain("hopper");
    expect(store.fittingEffects().output).toBeCloseTo(FITTINGS.hopper.effect.output!, 5);
  });

  it("does NOTHING standing away from it — owned, placed, inert", () => {
    // The rule the whole mechanic rests on. If owning it were enough, where it goes would
    // be decoration.
    const store = maker();
    const spot = faraway(store, "hopper");
    expect(store.installFitting("hopper", spot.column, spot.row).ok).toBe(true);
    expect(store.activeFittings(), "bought but not connected").not.toContain("hopper");
    expect(store.fittingEffects().output, "and the line is unchanged").toBe(1);
  });

  it("starts working the moment it is moved into place", () => {
    const store = maker();
    const away = faraway(store, "governor");
    store.installFitting("governor", away.column, away.row);
    expect(store.fittingEffects().speed).toBe(1);
    const close = beside(store, "governor");
    expect(store.moveFitting("governor", close.column, close.row).ok).toBe(true);
    expect(store.fittingEffects().speed).toBeCloseTo(FITTINGS.governor.effect.speed!, 5);
  });

  it("stops working the moment it is moved away", () => {
    const store = maker();
    const close = beside(store, "rack");
    store.installFitting("rack", close.column, close.row);
    const before = store.storageCapacity();
    const away = faraway(store, "rack");
    store.moveFitting("rack", away.column, away.row);
    expect(store.storageCapacity(), "shelf shrinks back").toBeLessThan(before);
  });
});

describe("the floor is the constraint", () => {
  it("refuses a tile something already stands on", () => {
    const store = maker();
    const station = store.equipmentTile("yield");
    expect(store.installFitting("hopper", station.column, station.row).ok).toBe(false);
  });

  it("refuses to stack two fittings", () => {
    const store = maker();
    const spot = beside(store, "hopper");
    store.installFitting("hopper", spot.column, spot.row);
    expect(store.installFitting("kiln", spot.column, spot.row).ok).toBe(false);
  });

  it("keeps the walkway clear", () => {
    const store = maker();
    expect(store.installFitting("hopper", Math.floor(FLOOR_COLUMNS / 2), 2).ok).toBe(false);
  });

  it("refuses one you already own", () => {
    const store = maker();
    const spot = beside(store, "hopper");
    store.installFitting("hopper", spot.column, spot.row);
    const other = faraway(store, "hopper");
    expect(store.installFitting("hopper", other.column, other.row).ok).toBe(false);
  });
});

describe("fittings cost real money", () => {
  it("charges the purse and refuses when it cannot pay", () => {
    const rich = maker("cratemill", 5_000);
    const spot = beside(rich, "kiln");
    const before = rich.state.wallet;
    rich.installFitting("kiln", spot.column, spot.row);
    expect(before - rich.state.wallet).toBe(FITTINGS.kiln.cost);

    const poor = maker("cratemill", 10);
    const spot2 = beside(poor, "kiln");
    expect(poor.installFitting("kiln", spot2.column, spot2.row).ok).toBe(false);
    expect(poor.state.wallet, "a refusal costs nothing").toBe(10);
  });
});

describe("no arrangement can break the line", () => {
  it("never lets the cycle run instantly, however many fittings are stacked up", () => {
    const store = maker();
    for (const key of Object.keys(FITTINGS) as FittingKey[]) {
      try {
        const spot = beside(store, key);
        store.installFitting(key, spot.column, spot.row);
      } catch { /* no room left beside that station, which is the point */ }
    }
    expect(store.fittingEffects().speed, "speed multiplier stays sane").toBeGreaterThan(0.4);
  });

  it("never consumes less than one input per run", () => {
    // Thrift rounds down; without a floor a sorter would eventually make production free.
    const store = maker();
    const spot = beside(store, "sorter");
    store.installFitting("sorter", spot.column, spot.row);
    for (const perCycle of [1, 2, 5]) {
      expect(store.inputCost(perCycle, 1), `${perCycle} per cycle`).toBeGreaterThanOrEqual(1);
    }
    expect(store.inputCost(0, 4), "but nothing needed stays nothing").toBe(0);
  });

  it("gives every fitting a station that exists and an effect that does something", () => {
    for (const [key, spec] of Object.entries(FITTINGS)) {
      expect(spec.serves, `${key} serves a real station`).toMatch(/^(yield|capacity|speed|appeal)$/);
      expect(Object.keys(spec.effect).length, `${key} actually does something`).toBeGreaterThan(0);
      expect(spec.cost, `${key} costs something`).toBeGreaterThan(0);
    }
  });
});
