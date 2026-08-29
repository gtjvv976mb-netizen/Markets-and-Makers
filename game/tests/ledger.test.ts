// "Today's takings" tells the truth on every path that pays the wallet.
//
// Caught live in the first minutes of a played session: a citizen batch paid the wallet
// while the takings tile read zero. Reading found the class: sellResource and
// fulfillContract credited the wallet with no takings entry at all, and settleCitizenVisit
// booked GROSS into a tile that reads against a NET costs tile. One rule now: takings are
// what actually reached the wallet.

import { beforeEach, describe, expect, it } from "vitest";
import { PLOTS } from "../src/data";
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

function maker(): GameStore {
  const P = PLOTS.filter((p) => p.island === "hearth").sort((a, b) => a.price - b.price)[0]!;
  const s = new GameStore(createFreshState());
  s.selectPlot(P.id); s.leaseSelectedPlot(); s.chooseLicense("greenhouse"); s.placeBuilding();
  s.state.wallet = 10_000;
  return s;
}

describe("today's takings", () => {
  it("books a resource sale as exactly what the wallet received", () => {
    const s = maker();
    s.state.inventory.food = 10;
    const wallet = s.state.wallet, takings = s.state.todayRevenue;
    expect(s.sellResource("food", 5).ok).toBe(true);
    const gained = s.state.wallet - wallet;
    expect(gained, "the sale must actually pay").toBeGreaterThan(0);
    expect(s.state.todayRevenue - takings, "takings = what the wallet received").toBe(gained);
  });

  it("books a citizen visit as exactly what the wallet received", () => {
    const s = maker();
    s.state.inventory.food = 10;
    const wallet = s.state.wallet, takings = s.state.todayRevenue;
    const sale = s.settleCitizenVisit(s.state.ownedPlotId!);
    expect(sale, "the visit must settle").not.toBeNull();
    expect(s.state.todayRevenue - takings).toBe(s.state.wallet - wallet);
  });

  it("books a fulfilled contract as exactly what the wallet received", () => {
    const s = maker();
    const offer = s.contractOffers()[0]!;
    s.state.activeContract = offer;
    s.state.inventory[offer.resource] = offer.quantity;
    const wallet = s.state.wallet, takings = s.state.todayRevenue;
    expect(s.fulfillContract().ok).toBe(true);
    expect(s.state.todayRevenue - takings).toBe(s.state.wallet - wallet);
  });
});
