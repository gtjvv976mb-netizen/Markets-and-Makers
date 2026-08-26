import { beforeEach, describe, expect, it, vi } from "vitest";

// The whole point of this file: pretend the authority is ticking the district, and prove
// this client then settles nothing. With the world tick on, every sale the server makes
// is also a sale the client could make — and a shopkeeper paid by both is a realm that
// mints money on every customer.
vi.mock("../src/realm", () => ({
  worldRunsOnServer: () => true,
  isSynced: () => true,
  refreshWorldOwner: async () => "server",
  forgetWorldOwner: () => {},
  registerBusiness: async () => ({ status: "offline" }),
  fetchDistrict: async () => null,
  sellToDistrict: async () => ({ status: "offline" }),
  buyFromCivic: async () => ({ status: "offline" }),
  fetchBoard: async () => null,
}));

const { createFreshState, GameStore } = await import("../src/state");
const { RESOURCES } = await import("../src/data");

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

function openShop(): InstanceType<typeof GameStore> {
  const store = new GameStore(createFreshState());
  store.state.selectedPlotId = "GX072";
  expect(store.leaseSelectedPlot().ok).toBe(true);
  expect(store.chooseLicense("shop").ok).toBe(true);
  expect(store.placeBuilding().ok).toBe(true);
  const retail = Object.keys(store.state.inventory)
    .find((key) => RESOURCES[key as keyof typeof RESOURCES]?.buyer === "citizens")!;
  store.state.inventory[retail as "supply"] = 300;
  store.state.citizenPool = 2_000_000;
  return store;
}

describe("when the authority runs the district", () => {
  it("settles no counter trade of its own", () => {
    const store = openShop();
    const wallet = store.state.wallet;
    const supply = store.totalMoneySupply();

    for (let i = 0; i < 20; i += 1) {
      expect(store.settleCitizenVisit("GX072")).toBeNull();
    }

    expect(store.state.wallet).toBe(wallet);
    expect(store.totalMoneySupply()).toBe(supply);
  });

  it("takes nothing off the shelf", () => {
    const store = openShop();
    const retail = Object.keys(store.state.inventory)
      .find((key) => RESOURCES[key as keyof typeof RESOURCES]?.buyer === "citizens")! as "supply";
    const stock = store.state.inventory[retail];
    for (let i = 0; i < 20; i += 1) store.settleCitizenVisit("GX072");
    expect(store.state.inventory[retail]).toBe(stock);
  });

  it("earns no contribution, so a share cannot be counted twice", () => {
    const store = openShop();
    const before = store.state.epoch.contribution;
    for (let i = 0; i < 20; i += 1) store.settleCitizenVisit("GX072");
    expect(store.state.epoch.contribution).toBe(before);
  });

  it("does not re-settle an absence the server already ticked", () => {
    // The dangerous one. The authority ticks whether or not this browser is open, so a
    // night away is already paid for by the time the player comes back.
    const store = openShop();
    store.state.operations.autoProduce = false;
    const wallet = store.state.wallet;

    store.state.lastTickAt = Date.now() - 18 * 3_600_000;
    const report = store.catchUp();

    expect(report.sold).toBe(0);
    expect(report.revenue).toBe(0);
    expect(store.state.wallet).toBeLessThanOrEqual(wallet);
  });

  it("still lets the player trade by hand", () => {
    // Deferring footfall is not going read-only: a deliberate sale is a command the
    // player issued, and it settles wherever trades settle.
    const store = openShop();
    const retail = Object.keys(store.state.inventory)
      .find((key) => RESOURCES[key as keyof typeof RESOURCES]?.buyer === "citizens")! as "supply";
    const wallet = store.state.wallet;
    expect(store.sellResource(retail, 1).ok).toBe(true);
    expect(store.state.wallet).toBeGreaterThan(wallet);
  });
});
