import { beforeEach, describe, expect, it } from "vitest";
import { PLOTS, type LicenseKey } from "../src/data";
import { createFreshState, GameStore } from "../src/state";

/**
 * The client half of the maker market.
 *
 * The authority owns the escrow, the settle and the fee; this side only MIRRORS what it
 * confirms. The thing that must hold here is that mirroring never invents goods or money:
 * a listing is not a sale, a cancellation is not a windfall, and a purchase costs exactly
 * what the server said it cost.
 */

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

const STARTER_PLOT = PLOTS.filter((p) => p.island === "hearth").sort((a, b) => a.price - b.price)[0]!;

function open(licence: LicenseKey = "greenhouse"): GameStore {
  const store = new GameStore(createFreshState());
  store.selectPlot(STARTER_PLOT.id);
  store.leaseSelectedPlot();
  store.chooseLicense(licence);
  store.placeBuilding();
  return store;
}

describe("mirroring the maker market", () => {
  it("takes listed goods off the shelf without paying for them yet", () => {
    // Escrow is not a sale. Counting it as revenue would pay a maker for goods still
    // sitting in the window, and pay them again when somebody actually buys.
    const store = open();
    store.state.inventory.food = 40;
    const wallet = store.state.wallet;
    const revenue = store.state.lifetimeRevenue;

    expect(store.applyMarketListing("food", 25, 14).ok).toBe(true);
    expect(store.state.inventory.food).toBe(15);
    expect(store.state.wallet, "listing must not pay anything").toBe(wallet);
    expect(store.state.lifetimeRevenue, "escrow is not revenue").toBe(revenue);
  });

  it("gives the goods back on a withdrawal, and nothing else", () => {
    const store = open();
    store.state.inventory.food = 40;
    const wallet = store.state.wallet;

    store.applyMarketListing("food", 25, 14);
    expect(store.applyMarketCancel("food", 25).ok).toBe(true);
    expect(store.state.inventory.food, "a round trip through escrow returns exactly what went in").toBe(40);
    expect(store.state.wallet).toBe(wallet);
  });

  it("charges a buyer exactly what the authority settled", () => {
    const store = open();
    const wallet = store.state.wallet;
    // The licence hands over a cycle of inputs, so the shelf is not empty to begin with.
    const heldBefore = store.state.inventory.water;

    // 12 water at 4 each, with the city's 2% already inside `paid`.
    expect(store.applyMarketPurchase("water", 12, 48).ok).toBe(true);
    expect(store.state.inventory.water).toBe(heldBefore + 12);
    expect(store.state.wallet).toBe(wallet - 48);
    expect(store.state.todayExpenses).toBe(48);
  });

  it("counts a sale to another maker as the best kind of trade", () => {
    // Supplying a buyer who chose your price is the most deliberate trade in the game. It
    // must not score below dumping the same goods on the civic counter, which is what
    // auto-sold stock does at the lowest contribution weight in the table.
    const deliberate = open();
    const dumped = open();
    deliberate.state.inventory.food = 40;
    dumped.state.inventory.food = 40;

    deliberate.applyMarketListing("food", 25, 14);
    deliberate.applyMarketSale("food", 25, 350);
    dumped.sellResource("food", 25);

    expect(deliberate.state.epoch.contribution)
      .toBeGreaterThan(dumped.state.epoch.contribution);
  });

  it("pays a seller without conjuring the goods back", () => {
    const store = open();
    store.state.inventory.food = 40;
    store.applyMarketListing("food", 25, 14);
    const held = store.state.inventory.food;

    expect(store.applyMarketSale("food", 25, 343).ok).toBe(true);
    expect(store.state.wallet).toBeGreaterThan(0);
    expect(store.state.inventory.food, "the goods left on listing and must not come back").toBe(held);
  });

  it("never lets a listing overdraw the shelf", () => {
    const store = open();
    store.state.inventory.food = 3;
    store.applyMarketListing("food", 25, 14);
    expect(store.state.inventory.food, "inventory must not go negative").toBe(0);
  });
});
