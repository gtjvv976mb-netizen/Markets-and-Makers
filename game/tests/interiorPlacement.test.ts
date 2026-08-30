/**
 * Can a new maker actually put a machine on their floor?
 *
 * They could not. A business opens with all four stations at level 0; interiorWorld hides a
 * level-0 station (`root.visible = level > 0`) and resolveSelection skips one, so the only
 * route to purchaseUpgrade — stand next to it and press E — was unreachable. The Build tray
 * said "Not installed · drag to place", placing wrote a tile for a machine that does not
 * exist, and nothing appeared. No error, no toast, no clue.
 *
 * These tests are written against the STORE, because that is where the rules live and where
 * they can be checked without a WebGL context.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { FITTINGS, FLOOR_WALKWAY_COLUMN, PLOTS, UPGRADE_COSTS, type ResourceKey } from "../src/data";
import { GameStore } from "../src/state";

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
  Object.defineProperty(globalThis, "window", {
    value: { setTimeout: () => 0, clearTimeout: () => undefined, addEventListener: () => undefined },
    configurable: true,
  });
});

const PLOT = PLOTS.filter((p) => p.island === "hearth").sort((a, b) => a.price - b.price)[0]!;

/** A maker with a built greenhouse, money, and the materials the first upgrade wants. */
function openBusiness(): GameStore {
  const store = new GameStore();
  store.state.island = PLOT.island;
  store.state.wallet = 20_000;
  store.state.selectedPlotId = PLOT.id;
  store.leaseSelectedPlot();
  store.chooseLicense("greenhouse");
  store.placeBuilding();
  for (const [key, count] of Object.entries(UPGRADE_COSTS[1]!.resources)) {
    store.state.inventory[key as ResourceKey] += (count as number) * 4;
  }
  return store;
}

/** A buildable tile that is not the walkway and holds nothing. */
function freeTile(store: GameStore, wanted = 0): { column: number; row: number } {
  let seen = 0;
  for (let row = 0; row < 8; row += 1) {
    for (let column = 0; column < 8; column += 1) {
      if (column === FLOOR_WALKWAY_COLUMN) continue;
      if (store.equipmentAt(column, row) !== null) continue;
      if (store.fittingAt(column, row) !== null) continue;
      if (seen++ === wanted) return { column, row };
    }
  }
  throw new Error("no free tile");
}

describe("a new maker can install a machine by placing it", () => {
  it("opens with every machine uninstalled — the state that made the floor a dead end", () => {
    const store = openBusiness();
    const levels = Object.values(store.state.upgrades);
    console.log(`FRESH BUSINESS upgrade levels: ${JSON.stringify(store.state.upgrades)}`);
    expect(levels.every((level) => level === 0)).toBe(true);
  });

  it("BUYS the machine when it is placed, and the fitters make it appear", () => {
    const store = openBusiness();
    const tile = freeTile(store);
    const before = store.state.wallet;
    const result = store.installEquipmentAt("yield", tile.column, tile.row);
    const job = store.installation();
    console.log(`INSTALL ok=${result.ok} · wallet ${before} -> ${store.state.wallet}`
      + ` (cost ${UPGRADE_COSTS[1]!.mercDollars}) · fitters queued for ${job?.key} lvl ${job?.level}`
      + ` in ${job?.secondsLeft}s`);
    expect(result.ok).toBe(true);
    expect(store.state.wallet).toBe(before - UPGRADE_COSTS[1]!.mercDollars);
    expect(store.equipmentAt(tile.column, tile.row)).toBe("yield");
    // Machines do not appear the instant they are bought — a crew has to fit them. What
    // matters is that the purchase HAPPENED, which is what no path could reach before.
    expect(job?.key).toBe("yield");
    expect(job?.level).toBe(1);

    // And when the crew finishes, the level rises — which is what applyLevels reads to
    // make the station visible in the room.
    store.catchUp(Date.now() + (job!.secondsLeft + 5) * 1000);
    console.log(`AFTER FITTING level=${store.state.upgrades.yield} (this is what makes it visible)`);
    expect(store.state.upgrades.yield).toBe(1);
  });

  it("CHARGES NOTHING when the tile is refused", () => {
    // The room commits a placement wherever the ghost was released without asking whether
    // it is legal, so buying before checking would take payment for a machine with nowhere
    // to go. This is the ordering the whole change turns on.
    const store = openBusiness();
    const before = store.state.wallet;
    const result = store.installEquipmentAt("yield", FLOOR_WALKWAY_COLUMN, 2);
    console.log(`WALKWAY ok=${result.ok} wallet ${before} -> ${store.state.wallet} · "${result.message}"`);
    expect(result.ok).toBe(false);
    expect(store.state.wallet).toBe(before);
    expect(store.state.upgrades.yield).toBe(0);
  });

  it("charges nothing when another machine already stands there", () => {
    const store = openBusiness();
    const tile = freeTile(store);
    store.installEquipmentAt("yield", tile.column, tile.row);
    const before = store.state.wallet;
    const result = store.installEquipmentAt("speed", tile.column, tile.row);
    console.log(`OCCUPIED ok=${result.ok} wallet unchanged=${store.state.wallet === before} · "${result.message}"`);
    expect(result.ok).toBe(false);
    expect(store.state.wallet).toBe(before);
    expect(store.state.upgrades.speed).toBe(0);
  });

  it("charges nothing, and says the whole bill, when the maker cannot afford it", () => {
    const store = openBusiness();
    store.state.wallet = 1;
    const tile = freeTile(store);
    const result = store.installEquipmentAt("yield", tile.column, tile.row);
    console.log(`BROKE ok=${result.ok} · "${result.message}"`);
    expect(result.ok).toBe(false);
    expect(store.state.wallet).toBe(1);
    expect(result.message).toMatch(/more MERCS|need/i);
  });

  it("moves a machine that is still with the fitters, instead of selling it twice", () => {
    // Dragging a machine whose crew had not finished tried to BUY it again and was refused
    // with "the fitters are still installing your X" — a refusal about the wrong thing.
    const store = openBusiness();
    const first = freeTile(store);
    store.installEquipmentAt("yield", first.column, first.row);
    const after = store.state.wallet;
    const second = freeTile(store, 3);
    const moved = store.installEquipmentAt("yield", second.column, second.row);
    console.log(`MOVE WHILE FITTING ok=${moved.ok} · wallet unchanged=${store.state.wallet === after}`
      + ` · now at ${JSON.stringify(store.equipmentTile("yield"))}`);
    expect(moved.ok).toBe(true);
    expect(store.state.wallet).toBe(after);
    expect(store.equipmentAt(second.column, second.row)).toBe("yield");
  });

  it("moves an installed machine without charging again", () => {
    const store = openBusiness();
    const first = freeTile(store);
    store.installEquipmentAt("yield", first.column, first.row);
    store.catchUp(Date.now() + 3_600_000);
    expect(store.state.upgrades.yield).toBe(1);
    const after = store.state.wallet;
    const second = freeTile(store, 3);
    const moved = store.installEquipmentAt("yield", second.column, second.row);
    console.log(`MOVE ok=${moved.ok} level still ${store.state.upgrades.yield} · wallet unchanged=${store.state.wallet === after}`);
    expect(moved.ok).toBe(true);
    expect(store.state.upgrades.yield).toBe(1);
    expect(store.state.wallet).toBe(after);
    expect(store.equipmentAt(second.column, second.row)).toBe("yield");
  });
});

describe("a machine may not be parked on a fitting", () => {
  it("refuses the tile a fitting stands on", () => {
    // canPlaceEquipment held this rule and had ZERO callers, while placeEquipment — the one
    // players use — checked only the walkway and other machines. The authority's
    // sanitiseFloor seats stations first and bins any fitting whose tile is taken, so the
    // browser would have gone on crediting a fitting the server had dropped.
    const store = openBusiness();
    const tile = freeTile(store);
    const fitting = Object.keys(FITTINGS)[0]! as keyof typeof FITTINGS;
    const installed = store.installFitting(fitting, tile.column, tile.row);
    expect(installed.ok).toBe(true);

    const result = store.installEquipmentAt("yield", tile.column, tile.row);
    console.log(`ON A FITTING ok=${result.ok} · "${result.message}"`);
    expect(result.ok).toBe(false);
    expect(store.fittingAt(tile.column, tile.row)).toBe(fitting);
    expect(store.canPlaceEquipment("yield", tile.column, tile.row)).toBe(false);
  });
});
