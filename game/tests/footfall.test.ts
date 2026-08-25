import { beforeEach, describe, expect, it } from "vitest";
import { BUSINESS, CONTRIBUTION_WEIGHT, DEMAND_PRICE_FLOOR, RESOURCES, type LicenseKey } from "../src/data";
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

/** A built, working business on a known plot. */
function open(licence: LicenseKey, plotId = "garden-row"): GameStore {
  const store = new GameStore(createFreshState());
  store.state.selectedPlotId = plotId;
  expect(store.leaseSelectedPlot().ok).toBe(true);
  if (store.chooseLicense(licence).ok === false) {
    // Enterprise trades are tendered; outbid the city first.
    const round = store.franchiseRound(licence);
    if (round) {
      store.state.wallet = round.minimum + 500;
      store.placeFranchiseBid(licence, round.minimum);
    }
    expect(store.chooseLicense(licence).ok).toBe(true);
  }
  expect(store.placeBuilding().ok).toBe(true);
  return store;
}

/** The first thing this trade makes that households actually buy. */
function retailGood(licence: LicenseKey): string | null {
  return Object.keys(BUSINESS[licence].output)
    .find((key) => RESOURCES[key as keyof typeof RESOURCES].buyer === "citizens") ?? null;
}

describe("footfall settles the sale", () => {
  it("moves money without creating any", () => {
    const store = open("shop");
    const good = retailGood("shop")!;
    store.state.inventory[good as "supply"] += 5;

    const supplyBefore = store.totalMoneySupply();
    const sale = store.settleCitizenVisit("garden-row");

    expect(sale).not.toBeNull();
    expect(sale!.gross).toBeGreaterThan(0);
    // The whole point: a customer redistributes the money supply, never enlarges it.
    expect(store.totalMoneySupply()).toBe(supplyBefore);
  });

  it("takes the goods off the shelf, one customer one unit", () => {
    const store = open("shop");
    const good = retailGood("shop")! as "supply";
    store.state.inventory[good] = 3;
    store.settleCitizenVisit("garden-row");
    expect(store.state.inventory[good]).toBe(2);
  });

  it("pays the player out of the citizens' pockets, and the city its tax", () => {
    const store = open("shop");
    store.state.inventory[retailGood("shop")! as "supply"] += 3;
    const wallet = store.state.wallet;
    const pool = store.state.citizenPool;
    const treasury = store.state.governmentTreasury;

    const sale = store.settleCitizenVisit("garden-row")!;
    const tax = store.state.governmentTreasury - treasury;

    expect(store.state.citizenPool).toBe(pool - sale.gross);
    expect(store.state.wallet).toBe(wallet + sale.gross - tax);
    expect(tax).toBeGreaterThanOrEqual(0);
  });

  it("counts as household trade, worth six times what the auto-seller earns", () => {
    const store = open("shop");
    store.state.inventory[retailGood("shop")! as "supply"] += 3;
    const before = store.state.epoch.contribution;
    const sale = store.settleCitizenVisit("garden-row")!;
    const gained = store.state.epoch.contribution - before;

    expect(gained).toBeCloseTo(sale.gross * CONTRIBUTION_WEIGHT.household, 6);
    expect(CONTRIBUTION_WEIGHT.household / CONTRIBUTION_WEIGHT.auto).toBeCloseTo(6, 9);
  });

  it("sells nothing when the shelf is empty", () => {
    const store = open("shop");
    store.state.inventory[retailGood("shop")! as "supply"] = 0;
    const supply = store.totalMoneySupply();
    expect(store.settleCitizenVisit("garden-row")).toBeNull();
    expect(store.totalMoneySupply()).toBe(supply);
  });

  it("sells nothing from a business that has broken down", () => {
    const store = open("shop");
    store.state.inventory[retailGood("shop")! as "supply"] += 5;
    store.state.brokenDown = true;
    store.state.portfolio["garden-row"]!.brokenDown = true;
    expect(store.settleCitizenVisit("garden-row")).toBeNull();
  });

  it("sells nothing at a plot the player does not hold", () => {
    const store = open("shop");
    expect(store.settleCitizenVisit("no-such-plot")).toBeNull();
  });

  it("gives a mine no counter trade — households do not buy ore", () => {
    const store = open("mine");
    store.state.inventory.ore += 20;
    const supply = store.totalMoneySupply();
    expect(store.settleCitizenVisit("garden-row")).toBeNull();
    expect(store.totalMoneySupply()).toBe(supply);
  });

  it("refuses rather than overdrawing the citizens' pool", () => {
    const store = open("shop");
    store.state.inventory[retailGood("shop")! as "supply"] += 5;
    store.state.citizenPool = 0;
    expect(store.settleCitizenVisit("garden-row")).toBeNull();
    expect(store.state.citizenPool).toBe(0);
  });

  it("saturates: a queue of customers pays less each, and never below the floor", () => {
    const store = open("shop");
    const good = retailGood("shop")! as "supply";
    store.state.inventory[good] = 400;
    store.state.citizenPool = 5_000_000;

    const takings: number[] = [];
    for (let i = 0; i < 300; i += 1) {
      const sale = store.settleCitizenVisit("garden-row");
      if (sale) takings.push(sale.gross);
    }
    expect(takings.length).toBeGreaterThan(50);
    const first = takings[0]!;
    const last = takings[takings.length - 1]!;
    expect(last).toBeLessThan(first);
    // The floor holds: a unit never becomes free, however saturated the district.
    expect(last).toBeGreaterThanOrEqual(1);
    expect(last).toBeGreaterThanOrEqual(Math.floor(first * DEMAND_PRICE_FLOOR) - 1);
  });

  it("conserves the money supply across a whole day of trade", () => {
    const store = open("shop");
    store.state.inventory[retailGood("shop")! as "supply"] = 500;
    store.state.citizenPool = 5_000_000;
    const supply = store.totalMoneySupply();
    for (let i = 0; i < 500; i += 1) store.settleCitizenVisit("garden-row");
    expect(store.totalMoneySupply()).toBe(supply);
  });

  it("serves a service trade without needing stock, and counts the visitor", () => {
    const store = open("gym");
    const served = store.state.visitorsServed;
    const supply = store.totalMoneySupply();
    const sale = store.settleCitizenVisit("garden-row");

    expect(sale).not.toBeNull();
    expect(sale!.kind).toBe("service");
    expect(sale!.resource).toBeNull();
    expect(store.state.visitorsServed).toBe(served + 1);
    expect(store.totalMoneySupply()).toBe(supply);
  });

  it("never queues another walker — a sale at the door cannot dispatch its own customer", () => {
    // recordCitizenActivity is what world.ts reads to send citizens out. If footfall
    // appended to it, each arrival would summon the next and the loop would print money.
    const store = open("shop");
    store.state.inventory[retailGood("shop")! as "supply"] += 10;
    const sequence = store.state.citizenActivitySequence;
    const queued = store.state.citizenActivity.length;

    for (let i = 0; i < 5; i += 1) store.settleCitizenVisit("garden-row");

    expect(store.state.citizenActivitySequence).toBe(sequence);
    expect(store.state.citizenActivity.length).toBe(queued);
  });
});
