import { beforeEach, describe, expect, it } from "vitest";
import { BUSINESS, INITIAL_MM_RESERVE, INITIAL_SUNMARK_SUPPLY, MIN_MM_RESERVE, RESOURCES, SAVE_KEY, type LicenseKey, type ResourceKey } from "../src/data";
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

describe("Markets & Makers economy", () => {
  it("opens with a fully covered Sunmark monetary base and conserved $MM vault allocation", () => {
    const store = new GameStore(createFreshState());
    expect(store.totalMoneySupply()).toBe(INITIAL_SUNMARK_SUPPLY);
    expect(store.state.mmReserve).toBe(INITIAL_MM_RESERVE);
    expect(store.state.mmHoldings).toBe(0);
    expect(store.totalMMInGameVaults()).toBe(INITIAL_MM_RESERVE);
    expect(store.reserveBackingRatio()).toBe(100);
    expect(store.monetaryPolicyPhase()).toBe("Fully covered");
  });

  it("retires Sunmarks when $MM leaves the vault and issues fewer Sunmarks when it returns", () => {
    const store = new GameStore(createFreshState());
    const openingSunmarks = store.totalMoneySupply();
    const openingTreasury = store.state.governmentTreasury;
    expect(store.buyMMFromReserve().ok).toBe(true);
    expect(store.state.mmHoldings).toBe(100);
    expect(store.state.mmReserve).toBe(INITIAL_MM_RESERVE - 100);
    expect(store.state.governmentTreasury).toBe(openingTreasury + 2);
    expect(store.totalMoneySupply()).toBe(openingSunmarks - 100);
    expect(store.totalMMInGameVaults()).toBe(INITIAL_MM_RESERVE);
    expect(store.sellMMToReserve().ok).toBe(true);
    expect(store.state.mmHoldings).toBe(0);
    expect(store.state.mmReserve).toBe(INITIAL_MM_RESERVE);
    expect(store.totalMoneySupply()).toBe(openingSunmarks - 2);
    expect(store.reserveBackingRatio()).toBeGreaterThan(100);
  });

  it("protects the civic $MM reserve floor", () => {
    const store = new GameStore(createFreshState());
    store.state.mmReserve = MIN_MM_RESERVE;
    expect(store.buyMMFromReserve().ok).toBe(false);
    expect(store.state.mmReserve).toBe(MIN_MM_RESERVE);
    expect(store.state.mmHoldings).toBe(0);
  });

  it("reconstructs the fixed $MM vault allocation from sanitized saved holdings", () => {
    localStorage.setItem(SAVE_KEY, JSON.stringify({ mmHoldings: 900, mmReserve: MIN_MM_RESERVE }));
    const state = loadState();
    expect(state.mmHoldings).toBe(900);
    expect(state.mmReserve).toBe(INITIAL_MM_RESERVE - 900);
    expect(state.mmReserve + state.mmHoldings).toBe(INITIAL_MM_RESERVE);
  });

  it("conserves value when government supplies a resource", () => {
    const store = new GameStore(createFreshState());
    const before = store.totalMoneySupply();
    expect(store.buyResource("water", 2).ok).toBe(true);
    expect(store.state.inventory.water).toBe(2);
    expect(store.totalMoneySupply()).toBe(before);
  });

  it("leases, builds, produces, upgrades and sells workshop output", () => {
    const store = new GameStore(createFreshState());
    store.state.selectedPlotId = "garden-row";
    expect(store.leaseSelectedPlot().ok).toBe(true);
    expect(store.chooseLicense("workshop").ok).toBe(true);
    expect(store.placeBuilding().ok).toBe(true);
    expect(store.startJob(1_000).ok).toBe(true);
    expect(store.collectJob(100_000).ok).toBe(true);
    expect(store.state.inventory.part).toBe(2);
    store.state.inventory.crate += 1;
    expect(store.purchaseUpgrade("yield").ok).toBe(true);
    store.state.inventory.part += 1;
    const walletBeforeSale = store.state.wallet;
    expect(store.sellResource("part").ok).toBe(true);
    expect(store.state.wallet).toBeGreaterThan(walletBeforeSale);
    expect(store.state.taxPaid).toBeGreaterThan(0);
    expect(store.state.tutorial.sold).toBe(true);
  });

  it("grants exactly one starter kit and locks the plot license", () => {
    const store = new GameStore(createFreshState());
    store.state.selectedPlotId = "garden-row";
    store.leaseSelectedPlot();
    expect(store.chooseLicense("workshop").ok).toBe(true);
    const inventoryAfterLicense = { ...store.state.inventory };
    expect(store.chooseLicense("shop").ok).toBe(false);
    expect(store.state.license).toBe("workshop");
    expect(store.state.inventory).toEqual(inventoryAfterLicense);
  });

  it("settles a citizen service from the AI spending pool with tax", () => {
    const store = new GameStore(createFreshState());
    store.state.selectedPlotId = "seabreeze";
    store.leaseSelectedPlot();
    store.chooseLicense("gym");
    store.placeBuilding();
    const citizenBefore = store.state.citizenPool;
    const treasuryBefore = store.state.governmentTreasury;
    expect(store.startJob(10).ok).toBe(true);
    expect(store.state.citizenPool).toBeGreaterThan(citizenBefore);
    expect(store.collectJob(100_000).ok).toBe(true);
    expect(store.state.citizenPool).toBeLessThan(citizenBefore);
    expect(store.state.governmentTreasury).toBeGreaterThan(treasuryBefore);
    expect(store.state.visitorsServed).toBeGreaterThan(0);
  });

  it("moves between islands without duplicating money", () => {
    const store = new GameStore(createFreshState());
    const before = store.totalMoneySupply();
    expect(store.travelTo("sun").ok).toBe(true);
    expect(store.state.island).toBe("sun");
    expect(store.totalMoneySupply()).toBe(before);
    const beforePaidTrip = store.totalMoneySupply();
    expect(store.travelTo("hearth").ok).toBe(true);
    expect(store.totalMoneySupply()).toBe(beforePaidTrip);
  });

  it("raises a resource price when civic supply is used and lowers it when output is sold", () => {
    const store = new GameStore(createFreshState());
    const opening = store.marketBuyPrice("ore");
    expect(store.buyResource("ore", 20).ok).toBe(true);
    expect(store.marketBuyPrice("ore")).toBeGreaterThan(opening);
    store.state.inventory.ore += 30;
    const scarcePrice = store.marketSellPrice("ore");
    expect(store.sellResource("ore", 12).ok).toBe(true);
    expect(store.marketSellPrice("ore")).toBeLessThanOrEqual(scarcePrice);
  });

  it("settles contract rewards from an existing buyer pool without minting Sunmarks", () => {
    const store = new GameStore(createFreshState());
    const before = store.totalMoneySupply();
    const offer = store.contractOffers()[0];
    store.state.inventory[offer.resource] = offer.quantity;
    expect(store.acceptContract(offer.id).ok).toBe(true);
    expect(store.fulfillContract().ok).toBe(true);
    expect(store.totalMoneySupply()).toBe(before);
    expect(store.state.contractsCompleted).toBe(1);
    expect(store.state.tutorial.contracted).toBe(true);
    expect(store.state.experience).toBe(offer.xpReward);
  });

  it("caps ordinary government procurement while leaving verified contracts available", () => {
    const store = new GameStore(createFreshState());
    const quota = store.procurementQuota();
    store.state.inventory.ore = quota + 1;
    expect(store.sellResource("ore", quota).ok).toBe(true);
    expect(store.procurementRemaining("ore")).toBe(0);
    expect(store.sellResource("ore", 1).ok).toBe(false);
    expect(store.contractOffers()).toHaveLength(3);
  });

  it("pays the daily enterprise dividend from the civic treasury rather than minting money", () => {
    const store = new GameStore(createFreshState());
    store.state.daily.jobs = 2;
    store.state.daily.contracts = 1;
    store.state.daily.trades = 2;
    const beforeSupply = store.totalMoneySupply();
    const beforeWallet = store.state.wallet;
    expect(store.claimDailyReward().ok).toBe(true);
    expect(store.state.wallet).toBe(beforeWallet + 80);
    expect(store.totalMoneySupply()).toBe(beforeSupply);
    expect(store.claimDailyReward().ok).toBe(false);
  });

  it("unlocks one permanent specialization through earned career XP", () => {
    const store = new GameStore(createFreshState());
    store.state.license = "workshop";
    store.state.buildingPlaced = true;
    expect(store.chooseSpecialization("efficient").ok).toBe(false);
    store.state.experience = 80;
    expect(store.chooseSpecialization("efficient").ok).toBe(true);
    expect(store.state.specialization).toBe("efficient");
    expect(store.chooseSpecialization("premium").ok).toBe(false);
    Object.assign(store.state.inventory, BUSINESS.workshop.starter);
    expect(store.startJob(1_000).ok).toBe(true);
    expect(store.state.job!.completeAt - store.state.job!.startedAt).toBeLessThan(BUSINESS.workshop.duration * 1000);
  });

  it("makes community enterprises employ more residents and serve more visitors", () => {
    const baseline = new GameStore(createFreshState());
    baseline.state.license = "gym";
    baseline.state.buildingPlaced = true;
    Object.assign(baseline.state.inventory, BUSINESS.gym.starter);
    const baselineVisitors = baseline.unitEconomics()!.visitors;
    const baselineLabor = baseline.unitEconomics()!.laborCost;

    const community = new GameStore(createFreshState());
    community.state.license = "gym";
    community.state.buildingPlaced = true;
    community.state.specialization = "community";
    expect(community.unitEconomics()!.visitors).toBeGreaterThan(baselineVisitors);
    expect(community.unitEconomics()!.laborCost).toBeGreaterThan(baselineLabor);
  });

  it("makes higher service prices reduce attendance through elasticity", () => {
    const store = new GameStore(createFreshState());
    store.state.selectedPlotId = "seabreeze";
    store.leaseSelectedPlot();
    store.chooseLicense("restaurant");
    store.placeBuilding();
    const baseVisitors = store.unitEconomics()!.visitors;
    expect(store.setServicePrice(1.3).ok).toBe(true);
    expect(store.unitEconomics()!.visitors).toBeLessThan(baseVisitors);
  });

  it("connects every tradable resource to at least one producer and one business user or final buyer", () => {
    const businessKeys = Object.keys(BUSINESS) as LicenseKey[];
    const resourceKeys = Object.keys(RESOURCES) as ResourceKey[];
    for (const resource of resourceKeys) {
      const producers = businessKeys.filter((key) => (BUSINESS[key].output[resource] ?? 0) > 0 || (resource === "waste" && (BUSINESS[key].wastePerCycle ?? 0) > 0));
      const users = businessKeys.filter((key) => (BUSINESS[key].inputs[resource] ?? 0) > 0);
      expect(producers.length, `${resource} has no producer`).toBeGreaterThan(0);
      expect(users.length + (RESOURCES[resource].buyer ? 1 : 0), `${resource} has no use`).toBeGreaterThan(0);
    }
  });
});
