import {
  BUSINESS, CAREER_LEVELS, DAILY_GOALS, INITIAL_CITIZEN_POOL, INITIAL_MM_RESERVE, INITIAL_SUNMARK_SUPPLY, ISLANDS, MIN_MM_RESERVE,
  MM_EXCHANGE_BUNDLE, MM_EXCHANGE_FEE_RATE, MM_REFERENCE_RATE, PLOTS, PROCUREMENT_BASE_QUOTA, RESOURCES, SAVE_KEY, SPECIALIZATIONS,
  SUNMARK_CODE, TAX_RATE, TUTORIAL, UPGRADE_COSTS, type LicenseKey, type ResourceKey, type SpecializationKey, type UpgradeKey,
} from "./data";

export interface ProductionJob { license: LicenseKey; startedAt: number; completeAt: number; cycles: number; laborCost: number; }
export interface UnitEconomics { inputCost: number; laborCost: number; expectedRevenue: number; expectedTax: number; expectedProfit: number; visitors: number; }
export interface ContractOffer {
  id: string; resource: ResourceKey; quantity: number; grossReward: number; buyer: "government" | "citizens";
  buyerName: string; bonusPercent: number; reputationReward: number; xpReward: number;
}
export interface DailyProgress { date: string; jobs: number; contracts: number; trades: number; claimed: boolean; }
export interface ProcurementLedger { date: string; used: Record<ResourceKey, number>; }
export interface EconomySnapshot { at: number; priceIndex: number; confidence: number; treasury: number; citizenPool: number; }

export interface GameState {
  version: 4;
  wallet: number; governmentTreasury: number; citizenPool: number; taxPaid: number; laborPaid: number; reputation: number;
  mmHoldings: number; mmReserve: number; mmExchangeVolume: number;
  experience: number; specialization: SpecializationKey | null; contractsCompleted: number; contractSequence: number;
  activeContract: ContractOffer | null; daily: DailyProgress; procurement: ProcurementLedger; economyHistory: EconomySnapshot[];
  inventory: Record<ResourceKey, number>; marketPressure: Record<ResourceKey, number>; marketLastUpdated: number; servicePriceIndex: number;
  island: string; player: { x: number; z: number }; selectedPlotId: string | null; ownedPlotId: string | null;
  license: LicenseKey | null; buildingPlaced: boolean; job: ProductionJob | null; upgrades: Record<UpgradeKey, number>;
  condition: number; jobsCompleted: number; visitorsServed: number; lifetimeRevenue: number;
  tutorial: Record<(typeof TUTORIAL)[number][0], boolean>;
  feed: Array<{ text: string; tone: "normal" | "success" | "warning"; at: number }>;
}

export interface ActionResult { ok: boolean; message: string; }

const resourceKeys = Object.keys(RESOURCES) as ResourceKey[];
const upgradeKeys: UpgradeKey[] = ["yield", "capacity", "speed", "appeal"];
const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const utcDay = (now = Date.now()): string => new Date(now).toISOString().slice(0, 10);

function blankInventory(): Record<ResourceKey, number> {
  return Object.fromEntries(resourceKeys.map((key) => [key, 0])) as Record<ResourceKey, number>;
}

function balancedMarket(): Record<ResourceKey, number> {
  return Object.fromEntries(resourceKeys.map((key) => [key, 1])) as Record<ResourceKey, number>;
}

function blankProcurement(): Record<ResourceKey, number> {
  return Object.fromEntries(resourceKeys.map((key) => [key, 0])) as Record<ResourceKey, number>;
}

export function createFreshState(): GameState {
  const tutorial = Object.fromEntries(TUTORIAL.map(([key]) => [key, false])) as GameState["tutorial"];
  const today = utcDay();
  return {
    version: 4,
    wallet: 750,
    governmentTreasury: INITIAL_SUNMARK_SUPPLY - INITIAL_CITIZEN_POOL - 750,
    citizenPool: INITIAL_CITIZEN_POOL,
    mmHoldings: 0,
    mmReserve: INITIAL_MM_RESERVE,
    mmExchangeVolume: 0,
    experience: 0,
    specialization: null,
    contractsCompleted: 0,
    contractSequence: 0,
    activeContract: null,
    daily: { date: today, jobs: 0, contracts: 0, trades: 0, claimed: false },
    procurement: { date: today, used: blankProcurement() },
    economyHistory: [],
    taxPaid: 0,
    laborPaid: 0,
    reputation: 0,
    inventory: blankInventory(),
    marketPressure: balancedMarket(),
    marketLastUpdated: Date.now(),
    servicePriceIndex: 1,
    island: "hearth",
    player: { x: 0, z: 34 },
    selectedPlotId: "garden-row",
    ownedPlotId: null,
    license: null,
    buildingPlaced: false,
    job: null,
    upgrades: { yield: 0, capacity: 0, speed: 0, appeal: 0 },
    condition: 100,
    jobsCompleted: 0,
    visitorsServed: 0,
    lifetimeRevenue: 0,
    tutorial,
    feed: [
      { text: "Sunmarks opened as the everyday currency, fully covered by the Civic Vault's 50 million $MM reserve.", tone: "success", at: Date.now() },
      { text: "Fifteen industries now connect utilities, raw materials, manufacturing, commerce, services and recovery.", tone: "normal", at: Date.now() },
    ],
  };
}

function finite(value: unknown, fallback: number, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  return typeof value === "number" && Number.isFinite(value) ? clamp(value, min, max) : fallback;
}

export function loadState(): GameState {
  const fresh = createFreshState();
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return fresh;
    const saved = JSON.parse(raw) as Partial<GameState>;
    const island = ISLANDS.some((entry) => entry.id === saved.island) ? saved.island! : fresh.island;
    const islandConfig = ISLANDS.find((entry) => entry.id === island)!;
    const inventory = blankInventory();
    const marketPressure = balancedMarket();
    for (const key of resourceKeys) {
      inventory[key] = Math.floor(finite(saved.inventory?.[key], 0, 0, 99_999));
      marketPressure[key] = finite(saved.marketPressure?.[key], 1, .7, 1.6);
    }
    const upgrades = { ...fresh.upgrades };
    for (const key of upgradeKeys) upgrades[key] = Math.floor(finite(saved.upgrades?.[key], 0, 0, 3));
    const license = saved.license && saved.license in BUSINESS ? saved.license : null;
    const ownedPlotId = PLOTS.some((plot) => plot.id === saved.ownedPlotId) ? saved.ownedPlotId! : null;
    // Player holdings and the Civic Vault are two sides of one fixed opening
    // allocation. Reconstruct the vault from validated holdings instead of
    // trusting two independently editable local-save fields.
    const mmHoldings = Math.floor(finite(saved.mmHoldings, 0, 0, INITIAL_MM_RESERVE - MIN_MM_RESERVE));
    const mmReserve = INITIAL_MM_RESERVE - mmHoldings;
    const today = utcDay();
    const daily = saved.daily?.date === today ? {
      date: today,
      jobs: Math.floor(finite(saved.daily.jobs, 0, 0, 99)),
      contracts: Math.floor(finite(saved.daily.contracts, 0, 0, 99)),
      trades: Math.floor(finite(saved.daily.trades, 0, 0, 999)),
      claimed: Boolean(saved.daily.claimed),
    } : fresh.daily;
    const procurementUsed = blankProcurement();
    if (saved.procurement?.date === today) {
      for (const key of resourceKeys) procurementUsed[key] = Math.floor(finite(saved.procurement.used?.[key], 0, 0, 99_999));
    }
    const specialization = saved.specialization && saved.specialization in SPECIALIZATIONS ? saved.specialization : null;
    const active = saved.activeContract;
    const activeContract = active && typeof active.id === "string" && resourceKeys.includes(active.resource) ? {
      id: active.id,
      resource: active.resource,
      quantity: Math.floor(finite(active.quantity, 1, 1, 99)),
      grossReward: Math.floor(finite(active.grossReward, 1, 1, 100_000)),
      buyer: active.buyer === "citizens" ? "citizens" as const : "government" as const,
      buyerName: typeof active.buyerName === "string" ? active.buyerName.slice(0, 60) : "Civic buyer",
      bonusPercent: Math.floor(finite(active.bonusPercent, 0, 0, 100)),
      reputationReward: Math.floor(finite(active.reputationReward, 1, 1, 100)),
      xpReward: Math.floor(finite(active.xpReward, 10, 1, 500)),
    } : null;
    return {
      ...fresh,
      wallet: finite(saved.wallet, fresh.wallet), governmentTreasury: finite(saved.governmentTreasury, fresh.governmentTreasury),
      citizenPool: finite(saved.citizenPool, fresh.citizenPool), taxPaid: finite(saved.taxPaid, 0), laborPaid: finite(saved.laborPaid, 0),
      mmHoldings,
      mmReserve,
      mmExchangeVolume: Math.floor(finite(saved.mmExchangeVolume, 0, 0, INITIAL_MM_RESERVE)),
      experience: Math.floor(finite(saved.experience, 0, 0, 10_000_000)),
      specialization,
      contractsCompleted: Math.floor(finite(saved.contractsCompleted, 0, 0, 1_000_000)),
      contractSequence: Math.floor(finite(saved.contractSequence, 0, 0, 1_000_000)),
      activeContract,
      daily,
      procurement: { date: today, used: procurementUsed },
      economyHistory: Array.isArray(saved.economyHistory) ? saved.economyHistory.slice(-24).map((entry) => ({
        at: finite(entry.at, Date.now()), priceIndex: finite(entry.priceIndex, 100, 60, 180), confidence: finite(entry.confidence, 90, 50, 150),
        treasury: finite(entry.treasury, fresh.governmentTreasury), citizenPool: finite(entry.citizenPool, fresh.citizenPool),
      })) : [],
      reputation: Math.floor(finite(saved.reputation, 0)), inventory, marketPressure,
      marketLastUpdated: finite(saved.marketLastUpdated, Date.now()), servicePriceIndex: finite(saved.servicePriceIndex, 1, .85, 1.3),
      island,
      player: { x: finite(saved.player?.x, islandConfig.spawnX, -500, 500), z: finite(saved.player?.z, islandConfig.spawnZ, -500, 500) },
      selectedPlotId: PLOTS.some((plot) => plot.id === saved.selectedPlotId) ? saved.selectedPlotId! : fresh.selectedPlotId,
      ownedPlotId, license, buildingPlaced: Boolean(saved.buildingPlaced && ownedPlotId && license),
      job: saved.job && license && saved.job.license === license ? {
        license, startedAt: finite(saved.job.startedAt, Date.now()), completeAt: finite(saved.job.completeAt, Date.now()),
        cycles: Math.floor(finite(saved.job.cycles, 1, 1, 4)), laborCost: finite(saved.job.laborCost, BUSINESS[license].laborCost, 0),
      } : null,
      upgrades, condition: finite(saved.condition, 100, 0, 100), jobsCompleted: Math.floor(finite(saved.jobsCompleted, 0)),
      visitorsServed: Math.floor(finite(saved.visitorsServed, 0)), lifetimeRevenue: finite(saved.lifetimeRevenue, 0),
      tutorial: { ...fresh.tutorial, ...(saved.tutorial ?? {}) },
      feed: Array.isArray(saved.feed) ? saved.feed.slice(0, 18) as GameState["feed"] : fresh.feed,
    };
  } catch {
    return fresh;
  }
}

export class GameStore {
  state: GameState;
  private listeners = new Set<() => void>();

  constructor(state = loadState()) { this.state = state; this.rollCalendar(); }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }

  private rollCalendar(now = Date.now()): void {
    const today = utcDay(now);
    if (this.state.daily.date !== today) this.state.daily = { date: today, jobs: 0, contracts: 0, trades: 0, claimed: false };
    if (this.state.procurement.date !== today) this.state.procurement = { date: today, used: blankProcurement() };
  }

  private addExperience(amount: number): void {
    this.state.experience += Math.max(0, Math.floor(amount));
  }

  private recordEconomy(): void {
    this.state.economyHistory.push({
      at: Date.now(), priceIndex: this.marketPriceIndex(), confidence: this.consumerConfidenceIndex(),
      treasury: this.state.governmentTreasury, citizenPool: this.state.citizenPool,
    });
    this.state.economyHistory = this.state.economyHistory.slice(-24);
  }

  private commit(message?: string, tone: GameState["feed"][number]["tone"] = "normal"): void {
    this.rollCalendar();
    if (message) {
      this.state.feed.unshift({ text: message, tone, at: Date.now() });
      this.state.feed = this.state.feed.slice(0, 18);
    }
    localStorage.setItem(SAVE_KEY, JSON.stringify(this.state));
    this.listeners.forEach((listener) => listener());
  }

  private result(ok: boolean, message: string): ActionResult { if (!ok) this.commit(message, "warning"); return { ok, message }; }

  private rebalanceMarket(now = Date.now()): void {
    const minutes = Math.max(0, (now - this.state.marketLastUpdated) / 60_000);
    const meanReversion = Math.min(.35, minutes * .012);
    for (const key of resourceKeys) this.state.marketPressure[key] += (1 - this.state.marketPressure[key]) * meanReversion;
    this.state.marketLastUpdated = now;
  }

  private moveMarket(key: ResourceKey, direction: 1 | -1, amount: number): void {
    const change = RESOURCES[key].volatility * Math.sqrt(amount) * .09 * direction;
    this.state.marketPressure[key] = clamp(this.state.marketPressure[key] + change, .72, 1.55);
  }

  markTutorial(key: keyof GameState["tutorial"]): void { if (!this.state.tutorial[key]) { this.state.tutorial[key] = true; this.commit(); } }
  updatePlayer(island: string, x: number, z: number): void { this.state.island = island; this.state.player.x = x; this.state.player.z = z; }
  savePosition(): void { this.commit(); }
  selectPlot(plotId: string): void { if (PLOTS.some((plot) => plot.id === plotId)) { this.state.selectedPlotId = plotId; this.commit(); } }

  leaseSelectedPlot(): ActionResult {
    const plot = PLOTS.find((entry) => entry.id === this.state.selectedPlotId);
    if (!plot) return this.result(false, "Select a starter plot first.");
    if (this.state.ownedPlotId) return this.result(false, "The prototype allows one active city lease.");
    if (this.state.island !== plot.island) return this.result(false, "Travel to the plot's island before leasing it.");
    if (this.state.wallet < plot.price) return this.result(false, `You do not have enough ${SUNMARK_CODE} for the lease.`);
    this.state.wallet -= plot.price; this.state.governmentTreasury += plot.price; this.state.ownedPlotId = plot.id; this.state.tutorial.leased = true; this.addExperience(10);
    this.commit(`You leased ${plot.name} for ${plot.price} ${SUNMARK_CODE}.`, "success");
    return this.result(true, "Plot leased.");
  }

  chooseLicense(key: LicenseKey): ActionResult {
    if (!this.state.ownedPlotId) return this.result(false, "Lease a plot before selecting a business.");
    if (this.state.buildingPlaced) return this.result(false, "The built business license is locked for this prototype.");
    if (this.state.license) return this.result(false, `${BUSINESS[this.state.license].name} is already licensed to this plot.`);
    const config = BUSINESS[key];
    if (this.state.wallet < config.licenseCost) return this.result(false, `This license needs ${config.licenseCost} ${SUNMARK_CODE}.`);
    this.state.wallet -= config.licenseCost; this.state.governmentTreasury += config.licenseCost; this.state.license = key; this.state.tutorial.licensed = true; this.addExperience(15);
    for (const resource of resourceKeys) this.state.inventory[resource] += config.starter[resource] ?? 0;
    this.commit(`${config.name} licensed for ${config.licenseCost} ${SUNMARK_CODE}. One operating cycle was delivered as an in-kind starter grant.`, "success");
    return this.result(true, "License selected.");
  }

  placeBuilding(): ActionResult {
    if (!this.state.ownedPlotId || !this.state.license) return this.result(false, "Lease a plot and choose a license first.");
    if (this.state.buildingPlaced) return this.result(false, "Your business is already built.");
    this.state.buildingPlaced = true; this.state.tutorial.built = true; this.addExperience(20);
    this.commit(`${BUSINESS[this.state.license].name} opened on your plot.`, "success");
    return this.result(true, "Business built.");
  }

  marketBuyPrice(key: ResourceKey): number { return Math.max(1, Math.round(RESOURCES[key].governmentPrice * this.state.marketPressure[key])); }
  marketSellPrice(key: ResourceKey): number {
    const appeal = 1 + this.state.upgrades.appeal * .05;
    const stabilizer = RESOURCES[key].buyer === "government" ? this.stabilizerMultiplier() : 1;
    const quality = this.state.specialization === "premium" ? 1.08 : 1;
    return Math.max(1, Math.round(RESOURCES[key].procurementPrice * this.state.marketPressure[key] * appeal * stabilizer * quality));
  }

  buyResource(key: ResourceKey, quantity = 1): ActionResult {
    this.rollCalendar();
    this.rebalanceMarket();
    const amount = Math.max(1, Math.floor(quantity));
    const unitPrice = this.marketBuyPrice(key); const cost = unitPrice * amount;
    if (this.state.wallet < cost) return this.result(false, `You need ${cost} ${SUNMARK_CODE}.`);
    this.state.wallet -= cost; this.state.governmentTreasury += cost; this.state.inventory[key] += amount; this.state.daily.trades += amount; this.moveMarket(key, 1, amount);
    this.commit(`Civic fallback supplied ${amount} ${RESOURCES[key].short} at ${unitPrice} ${SUNMARK_CODE} each. Scarcity moved the market price.`, "success");
    return this.result(true, "Resource purchased.");
  }

  private inputMultiplier(): number { return 1 + this.state.upgrades.capacity; }

  startJob(now = Date.now()): ActionResult {
    this.rollCalendar(now);
    if (!this.state.buildingPlaced || !this.state.license) return this.result(false, "Build your licensed business first.");
    if (this.state.job) return this.result(false, "A production job is already active.");
    if (this.state.condition < 20) return this.result(false, "Repair the equipment before starting another job.");
    const config = BUSINESS[this.state.license]; const cycles = this.inputMultiplier();
    const laborMultiplier = this.state.specialization === "community" ? 1.1 : 1;
    const laborCost = Math.ceil(config.laborCost * cycles * laborMultiplier);
    for (const key of resourceKeys) {
      const required = (config.inputs[key] ?? 0) * cycles;
      if (this.state.inventory[key] < required) return this.result(false, `Buy ${required} ${RESOURCES[key].short} to run this job.`);
    }
    if (this.state.wallet < laborCost) return this.result(false, `Payroll needs ${laborCost} ${SUNMARK_CODE}.`);
    for (const key of resourceKeys) this.state.inventory[key] -= (config.inputs[key] ?? 0) * cycles;
    this.state.wallet -= laborCost; this.state.citizenPool += laborCost; this.state.laborPaid += laborCost;
    const operations = this.state.specialization === "efficient" ? .9 : 1;
    const speed = Math.max(.52, (1 - this.state.upgrades.speed * .12) * operations);
    this.state.job = { license: this.state.license, startedAt: now, completeAt: now + config.duration * speed * 1000, cycles, laborCost };
    this.commit(`${config.name} began ${cycles} cycle${cycles === 1 ? "" : "s"}; ${laborCost} ${SUNMARK_CODE} entered citizen households as wages.`, "success");
    return this.result(true, "Job started.");
  }

  private serviceVisitors(config: (typeof BUSINESS)[LicenseKey], cycles: number): number {
    if (!config.servicePayout) return 0;
    const appeal = 1 + this.state.upgrades.appeal * .15;
    const specialization = this.state.specialization === "community" ? 1.15 : this.state.specialization === "premium" ? 1.08 : 1;
    const throughput = (1 + this.state.upgrades.yield * .12) * specialization;
    const priceResponse = Math.pow(1 / this.state.servicePriceIndex, config.priceElasticity ?? 1);
    return Math.max(1, Math.ceil((config.baseVisitors ?? 4) * cycles * appeal * throughput * (this.consumerConfidenceIndex() / 100) * priceResponse));
  }

  private serviceGross(config: (typeof BUSINESS)[LicenseKey], cycles: number): number {
    return Math.round(this.serviceVisitors(config, cycles) * (config.servicePayout ?? 0) * this.state.servicePriceIndex);
  }

  collectJob(now = Date.now()): ActionResult {
    this.rollCalendar(now);
    const job = this.state.job;
    if (!job || !this.state.license) return this.result(false, "No production job is ready.");
    if (now < job.completeAt) return this.result(false, "The current job is still running.");
    const config = BUSINESS[job.license];
    if (config.servicePayout) {
      const visitors = this.serviceVisitors(config, job.cycles); const gross = this.serviceGross(config, job.cycles); const tax = Math.floor(gross * TAX_RATE);
      if (this.state.citizenPool < gross) return this.result(false, "Citizen spending pool is temporarily exhausted.");
      this.state.citizenPool -= gross; this.state.wallet += gross - tax; this.state.governmentTreasury += tax;
      this.state.taxPaid += tax; this.state.lifetimeRevenue += gross; this.state.visitorsServed += visitors;
    } else {
      for (const key of resourceKeys) {
        const base = (config.output[key] ?? 0) * job.cycles;
        const quality = this.state.specialization === "premium" ? .1 : 0;
        if (base > 0) this.state.inventory[key] += Math.max(base, Math.round(base * (1 + this.state.upgrades.yield * .12 + quality)));
      }
    }
    if (config.wastePerCycle) this.state.inventory.waste += config.wastePerCycle * job.cycles;
    this.state.job = null; this.state.condition = Math.max(0, this.state.condition - 3 - job.cycles * 2);
    this.state.jobsCompleted += 1; this.state.daily.jobs += 1;
    this.state.reputation += 1 + Math.floor(this.state.upgrades.appeal / 2) + (this.state.specialization === "community" ? 1 : 0);
    this.addExperience(Math.round((12 + job.cycles * 4) * (this.state.specialization === "community" ? 1.25 : 1)));
    this.state.tutorial.produced = true;
    if (config.servicePayout) this.state.tutorial.sold = true;
    this.recordEconomy();
    this.commit(`${config.name} settled output, wages, depreciation${config.wastePerCycle ? " and recoverable scrap" : ""}.`, "success");
    return this.result(true, "Job collected.");
  }

  sellResource(key: ResourceKey, quantity = 1): ActionResult {
    this.rollCalendar();
    this.rebalanceMarket();
    const amount = Math.max(1, Math.floor(quantity));
    if (this.state.inventory[key] < amount) return this.result(false, `You do not hold ${amount} ${RESOURCES[key].short}.`);
    const citizenDemand = RESOURCES[key].buyer === "citizens";
    if (!citizenDemand && amount > this.procurementRemaining(key)) return this.result(false, `Today's civic procurement quota has ${this.procurementRemaining(key)} ${RESOURCES[key].short} remaining. Use a contract or wait for the next civic day.`);
    const unitPrice = this.marketSellPrice(key); const gross = unitPrice * amount; const tax = Math.floor(gross * TAX_RATE);
    const buyerPool = citizenDemand ? this.state.citizenPool : this.state.governmentTreasury;
    if (buyerPool < gross) return this.result(false, `${citizenDemand ? "AI-citizen demand" : "Government procurement"} is temporarily exhausted.`);
    this.state.inventory[key] -= amount;
    if (citizenDemand) this.state.citizenPool -= gross; else this.state.governmentTreasury -= gross;
    this.state.wallet += gross - tax; this.state.governmentTreasury += tax; this.state.taxPaid += tax; this.state.lifetimeRevenue += gross;
    if (!citizenDemand) this.state.procurement.used[key] += amount;
    this.state.daily.trades += amount; this.addExperience(Math.max(2, amount * 2));
    this.state.reputation += Math.max(1, Math.floor(amount / 2)); this.state.tutorial.sold = true; this.moveMarket(key, -1, amount);
    this.recordEconomy();
    this.commit(`${citizenDemand ? "AI citizens" : "Civic procurement"} bought ${amount} ${RESOURCES[key].short} at ${unitPrice} ${SUNMARK_CODE}; ${tax} ${SUNMARK_CODE} tax returned to government.`, "success");
    return this.result(true, "Sale settled.");
  }

  reserveBuyCost(amount = MM_EXCHANGE_BUNDLE): number {
    const principal = Math.round(amount * MM_REFERENCE_RATE);
    return principal + Math.max(1, Math.ceil(principal * MM_EXCHANGE_FEE_RATE));
  }

  reserveSellPayout(amount = MM_EXCHANGE_BUNDLE): number {
    const principal = Math.round(amount * MM_REFERENCE_RATE);
    return Math.max(0, principal - Math.max(1, Math.ceil(principal * MM_EXCHANGE_FEE_RATE)));
  }

  buyMMFromReserve(amount = MM_EXCHANGE_BUNDLE): ActionResult {
    const units = Math.floor(amount);
    if (units < MM_EXCHANGE_BUNDLE || units > 1_000 || units % MM_EXCHANGE_BUNDLE !== 0) return this.result(false, `Reserve trades use ${MM_EXCHANGE_BUNDLE} $MM bundles, up to 1,000 per order.`);
    if (this.state.mmReserve - units < MIN_MM_RESERVE) return this.result(false, "The Civic Vault reserve floor has been reached. New redemptions are paused.");
    const cost = this.reserveBuyCost(units);
    if (this.state.wallet < cost) return this.result(false, `You need ${cost} ${SUNMARK_CODE} for this reserve order.`);
    const fee = cost - Math.round(units * MM_REFERENCE_RATE);
    this.state.wallet -= cost;
    this.state.governmentTreasury += fee;
    this.state.mmReserve -= units;
    this.state.mmHoldings += units;
    this.state.mmExchangeVolume += units;
    this.commit(`${units} $MM moved from the Civic Vault to your reserve holdings. ${units * MM_REFERENCE_RATE} ${SUNMARK_CODE} were retired and ${fee} ${SUNMARK_CODE} entered the stabilization fund.`, "success");
    return this.result(true, "$MM reserve acquired.");
  }

  sellMMToReserve(amount = MM_EXCHANGE_BUNDLE): ActionResult {
    const units = Math.floor(amount);
    if (units < MM_EXCHANGE_BUNDLE || units > 1_000 || units % MM_EXCHANGE_BUNDLE !== 0) return this.result(false, `Reserve trades use ${MM_EXCHANGE_BUNDLE} $MM bundles, up to 1,000 per order.`);
    if (this.state.mmHoldings < units) return this.result(false, `You need ${units} $MM in reserve holdings.`);
    const payout = this.reserveSellPayout(units);
    this.state.mmHoldings -= units;
    this.state.mmReserve += units;
    this.state.wallet += payout;
    this.state.mmExchangeVolume += units;
    this.commit(`${units} $MM returned to the Civic Vault and ${payout} new ${SUNMARK_CODE} entered circulation after the reserve spread.`, "success");
    return this.result(true, "$MM reserve sold.");
  }

  setServicePrice(index: number): ActionResult {
    if (!this.state.license || !BUSINESS[this.state.license].servicePayout) return this.result(false, "This business sells goods rather than admission or service visits.");
    const allowed = [.85, 1, 1.15, 1.3]; const selected = allowed.find((value) => Math.abs(value - index) < .001);
    if (!selected) return this.result(false, "Choose a supported service price.");
    this.state.servicePriceIndex = selected; this.commit(`Service price set to ${Math.round(selected * 100)}% of the district reference price.`, "success");
    return this.result(true, "Price updated.");
  }

  purchaseUpgrade(key: UpgradeKey): ActionResult {
    if (!this.state.buildingPlaced || !this.state.license) return this.result(false, "Build a business before installing equipment.");
    const current = this.state.upgrades[key];
    if (current >= 3) return this.result(false, "This improvement is already at level 3.");
    const cost = UPGRADE_COSTS[current + 1];
    if (this.state.wallet < cost.sunmarks) return this.result(false, `You need ${cost.sunmarks} ${SUNMARK_CODE}.`);
    for (const resource of resourceKeys) { const needed = cost.resources[resource] ?? 0; if (this.state.inventory[resource] < needed) return this.result(false, `You need ${needed} ${RESOURCES[resource].short}.`); }
    this.state.wallet -= cost.sunmarks; this.state.governmentTreasury += cost.sunmarks;
    for (const resource of resourceKeys) this.state.inventory[resource] -= cost.resources[resource] ?? 0;
    this.state.upgrades[key] += 1; this.state.tutorial.upgraded = true; this.addExperience(18 + (current + 1) * 7);
    this.commit(`${key[0].toUpperCase()}${key.slice(1)} improved to level ${current + 1}.`, "success");
    return this.result(true, "Upgrade installed.");
  }

  maintainBusiness(): ActionResult {
    if (this.state.condition >= 100) return this.result(false, "Equipment condition is already 100%.");
    if (this.state.wallet < 20 || this.state.inventory.part < 1) return this.result(false, `Maintenance needs 20 ${SUNMARK_CODE} and one Utility Part.`);
    this.state.wallet -= 20; this.state.citizenPool += 12; this.state.governmentTreasury += 8; this.state.laborPaid += 12;
    this.state.inventory.part -= 1; this.state.condition = Math.min(100, this.state.condition + 35);
    this.commit("Maintenance restored equipment condition; most of the fee became technician wages.", "success");
    return this.result(true, "Maintenance complete.");
  }

  chooseSpecialization(key: SpecializationKey): ActionResult {
    if (!this.state.buildingPlaced || !this.state.license) return this.result(false, "Build a business before choosing an operating model.");
    if (this.careerLevel().level < 2) return this.result(false, `Reach ${CAREER_LEVELS[1].name} at ${CAREER_LEVELS[1].xp} XP to specialize.`);
    if (this.state.specialization) return this.result(false, `${SPECIALIZATIONS[this.state.specialization].name} is already your permanent operating model.`);
    this.state.specialization = key;
    this.addExperience(20);
    this.commit(`${SPECIALIZATIONS[key].name} adopted as your enterprise specialization.`, "success");
    return this.result(true, "Specialization selected.");
  }

  procurementQuota(): number {
    return PROCUREMENT_BASE_QUOTA + (this.careerLevel().level - 1) * 4 + this.state.upgrades.appeal * 2;
  }

  procurementRemaining(key: ResourceKey): number {
    this.rollCalendar();
    if (RESOURCES[key].buyer === "citizens") return 99_999;
    return Math.max(0, this.procurementQuota() - this.state.procurement.used[key]);
  }

  contractOffers(): ContractOffer[] {
    const preferred: ResourceKey[] = [];
    if (this.state.license) {
      const config = BUSINESS[this.state.license];
      preferred.push(...Object.keys(config.output) as ResourceKey[]);
      if (!preferred.length) preferred.push(...Object.keys(config.inputs) as ResourceKey[]);
    }
    const fallback: ResourceKey[] = ["food", "part", "timber", "ore", "supply", "crate", "water", "power", "material", "equipment", "waste"];
    const candidates = [...new Set([...preferred, ...fallback])];
    const offers: ContractOffer[] = [];
    const level = this.careerLevel().level;
    for (let index = 0; index < 3; index += 1) {
      const position = (this.state.contractSequence * 2 + index) % candidates.length;
      const resource = candidates[position];
      const quantity = Math.min(10, 2 + ((this.state.contractSequence + index) % 3) + Math.floor(level / 2));
      const bonusPercent = 10 + Math.min(15, level * 2 + index * 2);
      const unit = this.marketSellPrice(resource);
      const grossReward = Math.max(quantity, Math.ceil(quantity * unit * (1 + bonusPercent / 100)));
      const buyer = RESOURCES[resource].buyer;
      offers.push({
        id: `contract-${this.state.contractSequence}-${index}-${resource}`,
        resource, quantity, grossReward, buyer,
        buyerName: buyer === "citizens" ? "Sunwoven Household Cooperative" : index === 0 ? "Civic Works Office" : "Regional Trade Guild",
        bonusPercent, reputationReward: 2 + Math.floor(level / 2), xpReward: 22 + quantity * 3,
      });
    }
    return offers;
  }

  acceptContract(id: string): ActionResult {
    if (this.state.activeContract) return this.result(false, "Finish or release your active contract first.");
    const offer = this.contractOffers().find((entry) => entry.id === id);
    if (!offer) return this.result(false, "That order is no longer on the board.");
    this.state.activeContract = offer;
    this.commit(`${offer.buyerName} reserved an order for ${offer.quantity} ${RESOURCES[offer.resource].short}.`, "success");
    return this.result(true, "Contract accepted.");
  }

  releaseContract(): ActionResult {
    if (!this.state.activeContract) return this.result(false, "No active contract to release.");
    this.state.activeContract = null;
    this.state.reputation = Math.max(0, this.state.reputation - 1);
    this.state.contractSequence += 1;
    this.commit("Contract released; reliability fell slightly and the board rotated.", "warning");
    return this.result(true, "Contract released.");
  }

  fulfillContract(): ActionResult {
    this.rollCalendar();
    const contract = this.state.activeContract;
    if (!contract) return this.result(false, "Accept a contract first.");
    if (this.state.inventory[contract.resource] < contract.quantity) return this.result(false, `This order still needs ${contract.quantity - this.state.inventory[contract.resource]} ${RESOURCES[contract.resource].short}.`);
    const buyerPool = contract.buyer === "citizens" ? this.state.citizenPool : this.state.governmentTreasury;
    if (buyerPool < contract.grossReward) return this.result(false, `${contract.buyerName} cannot settle this order until its budget recovers.`);
    const tax = Math.floor(contract.grossReward * TAX_RATE);
    this.state.inventory[contract.resource] -= contract.quantity;
    if (contract.buyer === "citizens") this.state.citizenPool -= contract.grossReward;
    else this.state.governmentTreasury -= contract.grossReward;
    this.state.wallet += contract.grossReward - tax;
    this.state.governmentTreasury += tax;
    this.state.taxPaid += tax;
    this.state.lifetimeRevenue += contract.grossReward;
    this.state.reputation += contract.reputationReward;
    this.addExperience(contract.xpReward);
    this.state.contractsCompleted += 1;
    this.state.daily.contracts += 1;
    this.state.daily.trades += contract.quantity;
    this.state.tutorial.contracted = true;
    this.moveMarket(contract.resource, -1, contract.quantity);
    this.state.activeContract = null;
    this.state.contractSequence += 1;
    this.recordEconomy();
    this.commit(`${contract.buyerName} paid ${contract.grossReward} ${SUNMARK_CODE} for the completed order; ${tax} ${SUNMARK_CODE} tax funded public services.`, "success");
    return this.result(true, "Contract fulfilled.");
  }

  refreshContracts(): ActionResult {
    const fee = 5;
    if (this.state.wallet < fee) return this.result(false, `A new verified board costs ${fee} ${SUNMARK_CODE}.`);
    this.state.wallet -= fee;
    this.state.governmentTreasury += fee;
    this.state.contractSequence += 1;
    this.commit("The Trade Guild verified three new orders.", "success");
    return this.result(true, "Contract board refreshed.");
  }

  claimDailyReward(): ActionResult {
    this.rollCalendar();
    if (this.state.daily.claimed) return this.result(false, "Today's enterprise dividend is already claimed.");
    if (this.state.daily.jobs < DAILY_GOALS.jobs || this.state.daily.contracts < DAILY_GOALS.contracts || this.state.daily.trades < DAILY_GOALS.trades) return this.result(false, "Complete every daily enterprise goal first.");
    if (this.state.governmentTreasury < DAILY_GOALS.reward) return this.result(false, "The civic development budget is temporarily exhausted.");
    this.state.governmentTreasury -= DAILY_GOALS.reward;
    this.state.wallet += DAILY_GOALS.reward;
    this.state.daily.claimed = true;
    this.addExperience(DAILY_GOALS.xp);
    this.commit(`Civic development paid ${DAILY_GOALS.reward} ${SUNMARK_CODE} and ${DAILY_GOALS.xp} XP for today's verified economic activity.`, "success");
    return this.result(true, "Daily enterprise dividend claimed.");
  }

  travelTo(islandId: string): ActionResult {
    this.rollCalendar();
    const island = ISLANDS.find((entry) => entry.id === islandId);
    if (!island) return this.result(false, "That route is unavailable.");
    if (this.state.island === islandId) return this.result(false, `You are already on ${island.name}.`);
    const fare = this.state.tutorial.traveled ? 10 : 0;
    if (this.state.wallet < fare) return this.result(false, `You need 10 ${SUNMARK_CODE} for this ferry route.`);
    this.state.wallet -= fare; this.state.governmentTreasury += fare; this.state.island = island.id; this.state.player = { x: island.spawnX, z: island.spawnZ }; this.addExperience(4);
    this.state.tutorial.traveled = true; this.commit(`Ferry arrived at ${island.name}${fare ? ` for 10 ${SUNMARK_CODE}` : " on your free first trip"}.`, "success");
    return this.result(true, "Travel complete.");
  }

  reset(): void { this.state = createFreshState(); this.commit("A new local Sunwoven Reach was created.", "success"); }

  consumerConfidenceIndex(): number {
    const activity = Math.min(14, this.state.jobsCompleted * 1.2 + this.state.reputation * .45);
    const liquidity = clamp((this.state.citizenPool / INITIAL_CITIZEN_POOL - 1) * 18, -12, 8);
    return Math.round(clamp(90 + activity + liquidity, 75, 118));
  }

  stabilizerMultiplier(): number { return 1 + Math.max(0, 100 - this.consumerConfidenceIndex()) / 200; }

  marketPriceIndex(): number {
    let weighted = 0; let weights = 0;
    for (const key of resourceKeys) { weighted += this.state.marketPressure[key] * RESOURCES[key].indexWeight; weights += RESOURCES[key].indexWeight; }
    return Math.round((weighted / weights) * 100);
  }

  economicPhase(): string {
    if (this.marketPriceIndex() >= 110) return "Supply constrained";
    if (this.state.citizenPool < INITIAL_CITIZEN_POOL * .72) return "Household demand slowdown";
    if (this.consumerConfidenceIndex() < 92) return "Demand support active";
    if (this.state.jobsCompleted < 3) return "Enterprise formation";
    if (this.consumerConfidenceIndex() >= 108) return "Broad-based growth";
    return "Balanced expansion";
  }

  reserveBackingRatio(): number {
    const sunmarks = Math.max(1, this.totalMoneySupply());
    return (this.state.mmReserve * MM_REFERENCE_RATE / sunmarks) * 100;
  }

  monetaryPolicyPhase(): string {
    const coverage = this.reserveBackingRatio();
    if (coverage < 100) return "Redemption restricted";
    if (coverage < 110) return "Fully covered";
    return "Reserve surplus";
  }

  unitEconomics(): UnitEconomics | null {
    if (!this.state.license) return null;
    const config = BUSINESS[this.state.license]; const cycles = this.inputMultiplier();
    let inputCost = 0;
    for (const key of resourceKeys) inputCost += (config.inputs[key] ?? 0) * cycles * this.marketBuyPrice(key);
    const laborCost = Math.ceil(config.laborCost * cycles * (this.state.specialization === "community" ? 1.1 : 1));
    let expectedRevenue = 0; let visitors = 0;
    if (config.servicePayout) { visitors = this.serviceVisitors(config, cycles); expectedRevenue = this.serviceGross(config, cycles); }
    else {
      for (const key of resourceKeys) {
        const base = (config.output[key] ?? 0) * cycles;
        const quality = this.state.specialization === "premium" ? .1 : 0;
        if (base) expectedRevenue += Math.max(base, Math.round(base * (1 + this.state.upgrades.yield * .12 + quality))) * this.marketSellPrice(key);
      }
      if (config.wastePerCycle) expectedRevenue += config.wastePerCycle * cycles * this.marketSellPrice("waste");
    }
    const expectedTax = Math.floor(expectedRevenue * TAX_RATE);
    return { inputCost, laborCost, expectedRevenue, expectedTax, expectedProfit: expectedRevenue - expectedTax - inputCost - laborCost, visitors };
  }

  totalMoneySupply(): number { return this.state.wallet + this.state.governmentTreasury + this.state.citizenPool; }
  totalMMInGameVaults(): number { return this.state.mmReserve + this.state.mmHoldings; }
  citizenCount(): number { return 120 + this.state.reputation * 4 + this.state.upgrades.appeal * 25 + Math.floor(this.state.visitorsServed / 5); }
  careerLevel(): (typeof CAREER_LEVELS)[number] {
    return [...CAREER_LEVELS].reverse().find((entry) => this.state.experience >= entry.xp) ?? CAREER_LEVELS[0];
  }
  nextCareerLevel(): (typeof CAREER_LEVELS)[number] | null {
    return CAREER_LEVELS.find((entry) => entry.xp > this.state.experience) ?? null;
  }
  careerProgress(): number {
    const current = this.careerLevel(); const next = this.nextCareerLevel();
    if (!next) return 100;
    return Math.round(((this.state.experience - current.xp) / Math.max(1, next.xp - current.xp)) * 100);
  }
  netWorth(): number {
    let inventoryValue = 0;
    for (const key of resourceKeys) inventoryValue += this.state.inventory[key] * this.marketSellPrice(key);
    return Math.floor(this.state.wallet + inventoryValue + this.state.mmHoldings * MM_REFERENCE_RATE);
  }
  dailyComplete(): boolean {
    return this.state.daily.jobs >= DAILY_GOALS.jobs && this.state.daily.contracts >= DAILY_GOALS.contracts && this.state.daily.trades >= DAILY_GOALS.trades;
  }
  economyTrend(): "improving" | "steady" | "softening" {
    const history = this.state.economyHistory;
    if (history.length < 2) return "steady";
    const delta = history.at(-1)!.confidence - history[0].confidence;
    return delta >= 3 ? "improving" : delta <= -3 ? "softening" : "steady";
  }
  nextTutorial(): (typeof TUTORIAL)[number] | null { return TUTORIAL.find(([key]) => !this.state.tutorial[key]) ?? null; }
}
