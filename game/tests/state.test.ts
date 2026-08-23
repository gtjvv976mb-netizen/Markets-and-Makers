import { beforeEach, describe, expect, it } from "vitest";
import { BREAKDOWN_CONDITION, BUSINESS, CAPACITY_DURATION_STEP, OFFLINE_MAX_HOURS, COHORT_CONTRIBUTION_BASE, DEMAND_PRICE_FLOOR, EPOCH_MM_BUDGET, INITIAL_MM_RESERVE, INITIAL_SUNMARK_SUPPLY, MIN_MM_RESERVE, RESOURCES, SAVE_KEY, type LicenseKey, type ResourceKey } from "../src/data";
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

  it("issues Sunmarks when earned $MM is spent back into the economy", () => {
    const store = new GameStore(createFreshState());
    const openingSunmarks = store.totalMoneySupply();
    store.state.mmHoldings = 100;
    store.state.mmReserve = INITIAL_MM_RESERVE - 100;
    expect(store.sellMMToReserve().ok).toBe(true);
    expect(store.state.mmHoldings).toBe(0);
    expect(store.state.mmReserve).toBe(INITIAL_MM_RESERVE);
    expect(store.totalMoneySupply()).toBe(openingSunmarks + 98);
  });

  it("cannot be bought: $MM is only distributed against contribution", () => {
    const store = new GameStore(createFreshState());
    expect("buyMMFromReserve" in store).toBe(false);
    expect(store.epochShare()).toBe(0);
    expect(store.projectedEpochMM()).toBe(0);
    expect(store.claimEpochRewards().ok).toBe(false);
    expect(store.state.mmHoldings).toBe(0);
  });

  it("pays a share of a FIXED epoch budget, so more grinding cannot release more $MM", () => {
    const modest = new GameStore(createFreshState());
    modest.state.epoch.contribution = COHORT_CONTRIBUTION_BASE;      // equal to the rest of the realm
    const grinder = new GameStore(createFreshState());
    grinder.state.epoch.contribution = COHORT_CONTRIBUTION_BASE * 50; // fifty times the effort

    expect(modest.epochShare()).toBeCloseTo(0.5, 6);
    expect(grinder.epochShare()).toBeCloseTo(50 / 51, 6);

    // 50x the work yields well under 2x the payout, and never more than the budget.
    expect(grinder.projectedEpochMM()).toBeLessThan(modest.projectedEpochMM() * 2);
    expect(grinder.projectedEpochMM()).toBeLessThanOrEqual(EPOCH_MM_BUDGET);
  });

  it("protects the civic $MM reserve floor", () => {
    const store = new GameStore(createFreshState());
    store.state.mmReserve = MIN_MM_RESERVE;
    store.state.epoch.contribution = COHORT_CONTRIBUTION_BASE * 1_000;
    expect(store.projectedEpochMM()).toBe(0);
    expect(store.claimEpochRewards().ok).toBe(false);
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
    expect(store.collectJob(store.state.job!.completeAt).ok).toBe(true);
    expect(store.state.inventory.part).toBe(BUSINESS.workshop.output.part);
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
    expect(store.collectJob(store.state.job!.completeAt).ok).toBe(true);
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

  it("softens local demand past the daily quota instead of refusing the sale", () => {
    const store = new GameStore(createFreshState());
    const quota = store.dailyQuota("ore");
    store.state.inventory.ore = quota * 4;
    const fullPrice = store.marketSellPrice("ore");
    expect(store.demandSaleGross("ore", 1).firstUnit).toBe(fullPrice);

    // Fill well past the day's full-price allowance in one order.
    const bulk = store.demandSaleGross("ore", quota * 3);
    expect(bulk.firstUnit).toBe(fullPrice);
    expect(bulk.lastUnit).toBeLessThan(fullPrice);
    expect(bulk.lastUnit).toBeGreaterThanOrEqual(Math.floor(fullPrice * DEMAND_PRICE_FLOOR));

    // Saturated demand still clears — it just pays less. This is what stops an
    // upgraded business from being unable to operate at all.
    expect(store.sellResource("ore", quota * 3).ok).toBe(true);
    expect(store.state.inventory.ore).toBe(quota);
    expect(store.sellResource("ore", quota).ok).toBe(true);
    expect(store.contractOffers()).toHaveLength(3);
  });

  it("never lets an upgraded business become unable to produce", () => {
    for (const license of Object.keys(BUSINESS) as LicenseKey[]) {
      const state = createFreshState();
      state.wallet = 500_000;
      state.ownedPlotId = "garden-row"; state.license = license; state.buildingPlaced = true;
      state.upgrades = { yield: 3, capacity: 3, speed: 3, appeal: 3 };
      const store = new GameStore(state);
      const config = BUSINESS[license];
      const cycles = 4;
      for (const key of Object.keys(RESOURCES) as ResourceKey[]) {
        const need = (config.inputs[key] ?? 0) * cycles;
        if (need) store.state.inventory[key] = need;
      }
      expect(store.startJob().ok, `${license} could not start a fully upgraded job`).toBe(true);
    }
  });

  it("gates how many plots a player may hold on civic standing", () => {
    const store = new GameStore(createFreshState());
    store.state.wallet = 50_000;
    expect(store.plotAllowance()).toBe(1);

    store.state.selectedPlotId = "garden-row";
    expect(store.leaseSelectedPlot().ok).toBe(true);
    store.state.selectedPlotId = "seabreeze";
    expect(store.leaseSelectedPlot().ok).toBe(false);
    expect(store.ownedPlotIds()).toEqual(["garden-row"]);

    // Career progress buys room for another shop.
    store.state.experience = 5_000;
    expect(store.plotAllowance()).toBeGreaterThan(1);
    expect(store.leaseSelectedPlot().ok).toBe(true);
    expect(store.ownedPlotIds()).toEqual(["garden-row", "seabreeze"]);
  });

  it("keeps each business's own equipment and upgrades when switching between them", () => {
    const store = new GameStore(createFreshState());
    store.state.wallet = 50_000;
    store.state.experience = 5_000;
    store.state.selectedPlotId = "garden-row";
    store.leaseSelectedPlot();
    store.chooseLicense("workshop");
    store.placeBuilding();
    store.state.condition = 61;

    store.state.selectedPlotId = "seabreeze";
    store.leaseSelectedPlot();
    store.chooseLicense("greenhouse");
    store.placeBuilding();
    store.state.condition = 94;

    expect(store.state.license).toBe("greenhouse");
    expect(store.switchBusiness("garden-row").ok).toBe(true);
    expect(store.state.license).toBe("workshop");
    expect(store.state.condition).toBe(61);

    expect(store.switchBusiness("seabreeze").ok).toBe(true);
    expect(store.state.license).toBe("greenhouse");
    expect(store.state.condition).toBe(94);
  });

  it("runs every owned business during one unattended shift", () => {
    const build = (plots: Array<[string, LicenseKey]>) => {
      const store = new GameStore(createFreshState());
      store.state.wallet = 60_000;
      store.state.experience = 5_000;
      for (const [plotId, licence] of plots) {
        store.state.selectedPlotId = plotId;
        expect(store.leaseSelectedPlot().ok, `could not lease ${plotId}`).toBe(true);
        expect(store.chooseLicense(licence).ok).toBe(true);
        store.placeBuilding();
      }
      store.state.lastTickAt = Date.now() - 24 * 3_600_000;
      const opening = store.state.wallet;
      const report = store.catchUp();
      return { report, net: store.state.wallet - opening, store };
    };
    const one = build([["garden-row", "workshop"]]);
    const two = build([["garden-row", "workshop"], ["seabreeze", "cratemill"]]);

    expect(two.report.jobs).toBeGreaterThan(one.report.jobs);
    expect(two.net).toBeGreaterThan(one.net);
    // The business that was open before the shift is still the one open after it.
    expect(two.store.state.ownedPlotId).toBe("seabreeze");
    expect(two.store.ownedPlotIds()).toHaveLength(2);
  });

  it("restores a whole portfolio from a saved game", () => {
    const store = new GameStore(createFreshState());
    store.state.wallet = 50_000;
    store.state.experience = 5_000;
    store.state.selectedPlotId = "garden-row";
    store.leaseSelectedPlot(); store.chooseLicense("workshop"); store.placeBuilding();
    store.state.selectedPlotId = "seabreeze";
    store.leaseSelectedPlot(); store.chooseLicense("greenhouse"); store.placeBuilding();
    store.purchaseUpgrade("yield");

    const restored = new GameStore(loadState());
    expect(restored.ownedPlotIds()).toEqual(["garden-row", "seabreeze"]);
    expect(restored.state.portfolio["garden-row"]!.license).toBe("workshop");
    expect(restored.state.portfolio.seabreeze!.license).toBe("greenhouse");
  });

  it("never runs an unattended shift at a loss, for any licence", () => {
    const losers: string[] = [];
    for (const license of Object.keys(BUSINESS) as LicenseKey[]) {
      const state = createFreshState();
      state.wallet = 20_000;
      state.ownedPlotId = "garden-row"; state.license = license; state.buildingPlaced = true;
      state.upgrades = { yield: 2, capacity: 2, speed: 2, appeal: 2 };
      state.lastTickAt = Date.now() - 24 * 3_600_000;
      const store = new GameStore(state);
      const opening = store.state.wallet;
      store.catchUp();
      const net = store.state.wallet - opening;
      if (net <= 0) losers.push(`${license} (${net})`);
    }
    // A business that loses money while you sleep is a trap in a passive game.
    expect(losers, `licences losing money unattended: ${losers.join(", ")}`).toEqual([]);
  });

  it("stops producing when the next job cannot pay for itself", () => {
    const state = createFreshState();
    state.wallet = 20_000;
    state.ownedPlotId = "garden-row"; state.license = "factory"; state.buildingPlaced = true;
    state.lastTickAt = Date.now() - 24 * 3_600_000;
    const store = new GameStore(state);
    const report = store.catchUp();
    // It halts on saturated demand, not on a full shelf or a breakdown.
    expect(report.halted).toBe("demand");
    expect(report.jobs).toBeGreaterThan(0);
  });

  it("caps offline accrual so nobody has to set an alarm", () => {
    const run = (hours: number) => {
      const state = createFreshState();
      state.wallet = 20_000;
      state.ownedPlotId = "garden-row"; state.license = "factory"; state.buildingPlaced = true;
      state.lastTickAt = Date.now() - hours * 3_600_000;
      const store = new GameStore(state);
      const opening = store.state.wallet;
      const report = store.catchUp();
      return { credited: report.hours, net: store.state.wallet - opening };
    };
    const day = run(24);
    const week = run(168);
    expect(week.credited).toBeLessThanOrEqual(OFFLINE_MAX_HOURS);
    expect(week.net).toBe(day.net);
  });

  it("rewards attention: active play earns more and contributes far more", () => {
    const build = () => {
      const state = createFreshState();
      state.wallet = 20_000;
      state.ownedPlotId = "garden-row"; state.license = "factory"; state.buildingPlaced = true;
      state.upgrades = { yield: 2, capacity: 2, speed: 2, appeal: 2 };
      state.lastTickAt = Date.now() - 24 * 3_600_000;
      return new GameStore(state);
    };
    const passive = build();
    const passiveOpen = passive.state.wallet;
    passive.catchUp();

    const active = build();
    const activeOpen = active.state.wallet;
    active.state.operations.autoSell = false;
    active.catchUp();
    for (const key of Object.keys(RESOURCES) as ResourceKey[]) {
      const spare = active.state.inventory[key] - (BUSINESS.factory.inputs[key] ?? 0) * 3;
      if (spare > 0) active.sellResource(key, spare);
    }
    for (let i = 0; i < 3; i += 1) {
      const offer = active.contractOffers()[0];
      if (!offer) break;
      active.state.inventory[offer.resource] += offer.quantity;
      active.acceptContract(offer.id);
      active.fulfillContract();
    }
    expect(active.state.wallet - activeOpen).toBeGreaterThan(passive.state.wallet - passiveOpen);
    // Contribution is the $MM lever, and it must reward showing up much more than earnings do.
    expect(active.state.epoch.contribution).toBeGreaterThan(passive.state.epoch.contribution * 3);
  });

  it("treats a breakdown as a crisis only a person can clear", () => {
    const state = createFreshState();
    state.wallet = 20_000;
    state.ownedPlotId = "garden-row"; state.license = "factory"; state.buildingPlaced = true;
    state.brokenDown = true;
    state.condition = 10;
    state.lastTickAt = Date.now() - 24 * 3_600_000;
    const store = new GameStore(state);
    const report = store.catchUp();
    expect(report.halted).toBe("breakdown");
    expect(report.jobs).toBe(0);
    expect(store.startJob().ok).toBe(false);

    store.state.inventory.part = 2;
    expect(store.repairBreakdown().ok).toBe(true);
    expect(store.state.brokenDown).toBe(false);
    expect(store.state.condition).toBeGreaterThan(BREAKDOWN_CONDITION);
  });

  it("makes every licence viable at level zero on civic-priced inputs", () => {
    const losers: string[] = [];
    for (const license of Object.keys(BUSINESS) as LicenseKey[]) {
      const state = createFreshState();
      state.wallet = 500_000;
      state.ownedPlotId = "garden-row"; state.license = license; state.buildingPlaced = true;
      const store = new GameStore(state);
      const config = BUSINESS[license];
      for (const key of Object.keys(RESOURCES) as ResourceKey[]) {
        const need = config.inputs[key] ?? 0;
        if (need) store.buyResource(key, need);
      }
      const opening = store.state.wallet;
      expect(store.startJob().ok).toBe(true);
      expect(store.collectJob(store.state.job!.completeAt).ok).toBe(true);
      for (const key of Object.keys(RESOURCES) as ResourceKey[]) {
        const spare = store.state.inventory[key];
        if (spare > 0) store.sellResource(key, spare);
      }
      const net = store.state.wallet - opening;
      if (net <= 0) losers.push(`${license} (${net})`);
    }
    // A licence a new player cannot profit from is a trap, not a choice.
    expect(losers, `unprofitable licences at level 0: ${losers.join(", ")}`).toEqual([]);
  });

  it("charges time for extra capacity rather than giving free throughput", () => {
    const build = (capacity: 0 | 3) => {
      const state = createFreshState();
      state.wallet = 500_000;
      state.ownedPlotId = "garden-row"; state.license = "factory"; state.buildingPlaced = true;
      state.upgrades = { yield: 0, capacity, speed: 0, appeal: 0 };
      const store = new GameStore(state);
      for (const key of Object.keys(RESOURCES) as ResourceKey[]) {
        const need = (BUSINESS.factory.inputs[key] ?? 0) * (1 + capacity);
        if (need) store.state.inventory[key] = need;
      }
      const at = Date.now();
      expect(store.startJob(at).ok).toBe(true);
      return (store.state.job!.completeAt - at) / 1000;
    };
    const base = build(0);
    const wide = build(3);
    // 4 batches take 2.35x the time, not 1x.
    expect(wide).toBeCloseTo(base * (1 + CAPACITY_DURATION_STEP * 3), 5);
    expect(wide).toBeGreaterThan(base);
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
    // Lean Operations must shorten the job relative to an identical unspecialised shop,
    // whatever the absolute time scale happens to be.
    const plain = new GameStore(createFreshState());
    plain.state.ownedPlotId = "garden-row"; plain.state.license = "workshop"; plain.state.buildingPlaced = true;
    plain.state.jobsCompleted = store.state.jobsCompleted;
    expect(store.jobDuration("workshop")).toBeLessThan(plain.jobDuration("workshop"));
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
