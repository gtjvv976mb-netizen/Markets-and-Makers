import {
  AUTO_BUY_PREMIUM, AUTO_MAINTAIN_AT, AUTO_MAINTAIN_COST, AUTO_SELL_BROKER_FEE, BREAKDOWN_CONDITION,
  BREAKDOWN_REPAIR_COST, BREAKDOWN_REPAIR_PARTS, BROKER_PRICE_FLOOR,
  BASE_PLOT_ALLOWANCE, BUSINESS, CAPACITY_DURATION_STEP, CAREER_LEVELS, PLOTS_PER_CAREER_LEVEL, OFFLINE_MAX_HOURS, OPENING_JOBS, OPENING_MAX_SECONDS, OPENING_TIME_SCALE, PRODUCTION_TIME_SCALE, STORAGE_BASE_CAPACITY, STORAGE_PER_CAPACITY_LEVEL, CITIZEN_DEMAND_BUDGET, CIVIC_DEMAND_BUDGET, COHORT_CONTRIBUTION_BASE, CONTRIBUTION_WEIGHT,
  DAILY_GOALS, DEMAND_PRICE_FLOOR, DEMAND_TRANCHE_DECAY, EPOCH_LENGTH_DAYS, EPOCH_MM_BUDGET,
  EVENT_DAYS, EVENT_ISLANDS, EVENT_MAX_BONUS, EVENT_MIN_BONUS, EVENT_REASONS, INITIAL_CITIZEN_POOL,
  INITIAL_MM_RESERVE, INITIAL_SUNMARK_SUPPLY, ISLANDS, MIN_MM_RESERVE, MM_EXCHANGE_BUNDLE, MM_EXCHANGE_FEE_RATE,
  DEMAND_TIER_WEIGHT, MM_REFERENCE_RATE, PLOTS, RESOURCES, SAVE_KEY, SERVICE_AUDIENCE_BUDGET, SPECIALIZATIONS,
  SUNMARK_CODE, TAX_RATE, TUTORIAL, UPGRADE_COSTS, type LicenseKey, type ResourceKey, type SpecializationKey, type UpgradeKey,
} from "./data";

export interface ProductionJob { license: LicenseKey; startedAt: number; completeAt: number; cycles: number; laborCost: number; }
export interface UnitEconomics { inputCost: number; laborCost: number; expectedRevenue: number; expectedTax: number; expectedProfit: number; visitors: number; }
export interface ContractOffer {
  id: string; resource: ResourceKey; quantity: number; grossReward: number; buyer: "government" | "citizens";
  buyerName: string; bonusPercent: number; reputationReward: number; xpReward: number;
}
export interface DailyProgress { date: string; jobs: number; contracts: number; trades: number; visits: number; claimed: boolean; }
export interface EpochProgress { id: number; contribution: number; claimed: boolean; }
export interface DistrictEvent { islandId: string; resource: ResourceKey; multiplier: number; reason: string; endsAt: number; }
export interface Operations { autoProduce: boolean; autoBuy: boolean; autoSell: boolean; }

/**
 * One owned business. The top-level GameState fields are a live VIEW of whichever of
 * these is active, so every existing panel keeps reading the shape it always did; the
 * portfolio is the durable record.
 */
export interface BusinessRecord {
  plotId: string; license: LicenseKey | null; buildingPlaced: boolean;
  job: ProductionJob | null; upgrades: Record<UpgradeKey, number>;
  condition: number; brokenDown: boolean; jobsCompleted: number;
}
export type HaltReason = "running" | "storage" | "demand" | "inputs" | "funds" | "breakdown" | "idle";
export interface ShiftReport {
  hours: number; jobs: number; produced: number; sold: number;
  revenue: number; spent: number; wages: number; halted: HaltReason;
}
export interface ProcurementLedger { date: string; used: Record<ResourceKey, number>; }
export interface EconomySnapshot { at: number; priceIndex: number; confidence: number; treasury: number; citizenPool: number; }

export interface GameState {
  version: 4;
  wallet: number; governmentTreasury: number; citizenPool: number; taxPaid: number; laborPaid: number; reputation: number;
  mmHoldings: number; mmReserve: number; mmExchangeVolume: number;
  experience: number; specialization: SpecializationKey | null; contractsCompleted: number; contractSequence: number;
  activeContract: ContractOffer | null; daily: DailyProgress; procurement: ProcurementLedger; economyHistory: EconomySnapshot[];
  epoch: EpochProgress; lifetimeContribution: number; lifetimeMMEarned: number;
  operations: Operations; lastTickAt: number; brokenDown: boolean; lastShift: ShiftReport | null;
  portfolio: Record<string, BusinessRecord>;
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
const epochId = (now = Date.now()): number => Math.floor(now / (EPOCH_LENGTH_DAYS * 86_400_000));

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
    daily: { date: today, jobs: 0, contracts: 0, trades: 0, visits: 0, claimed: false },
    epoch: { id: epochId(), contribution: 0, claimed: false },
    operations: { autoProduce: true, autoBuy: true, autoSell: true },
    portfolio: {},
    lastTickAt: Date.now(), brokenDown: false, lastShift: null,
    lifetimeContribution: 0, lifetimeMMEarned: 0,
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
    const raw = localStorage.getItem(SAVE_KEY) ?? localStorage.getItem("markets-makers-3d-browser-v4");
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
      visits: Math.floor(finite(saved.daily.visits, 0, 0, 99_999)),
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
      epoch: saved.epoch && Math.floor(finite(saved.epoch.id, -1, 0)) === epochId()
        ? { id: epochId(), contribution: finite(saved.epoch.contribution, 0), claimed: Boolean(saved.epoch.claimed) }
        : { id: epochId(), contribution: 0, claimed: false },
      operations: {
        autoProduce: saved.operations?.autoProduce !== false,
        autoBuy: saved.operations?.autoBuy !== false,
        autoSell: saved.operations?.autoSell !== false,
      },
      lastTickAt: finite(saved.lastTickAt, Date.now()),
      brokenDown: Boolean(saved.brokenDown),
      lastShift: null,
      portfolio: (() => {
        const restored: Record<string, BusinessRecord> = {};
        for (const [plotId, entry] of Object.entries(saved.portfolio ?? {})) {
          if (!PLOTS.some((plot) => plot.id === plotId) || !entry) continue;
          const record = entry as Partial<BusinessRecord>;
          const licence = record.license && record.license in BUSINESS ? record.license : null;
          const levels = { yield: 0, capacity: 0, speed: 0, appeal: 0 } as Record<UpgradeKey, number>;
          for (const key of upgradeKeys) levels[key] = Math.floor(finite(record.upgrades?.[key], 0, 0, 3));
          restored[plotId] = {
            plotId, license: licence, buildingPlaced: Boolean(record.buildingPlaced && licence),
            job: record.job && licence && record.job.license === licence ? record.job : null,
            upgrades: levels, condition: finite(record.condition, 100, 0, 100),
            brokenDown: Boolean(record.brokenDown), jobsCompleted: Math.floor(finite(record.jobsCompleted, 0)),
          };
        }
        return restored;
      })(),
      lifetimeContribution: finite(saved.lifetimeContribution, 0),
      lifetimeMMEarned: finite(saved.lifetimeMMEarned, 0),
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
    if (this.state.daily.date !== today) this.state.daily = { date: today, jobs: 0, contracts: 0, trades: 0, visits: 0, claimed: false };
    if (this.state.procurement.date !== today) this.state.procurement = { date: today, used: blankProcurement() };
    const epoch = epochId(now);
    if (this.state.epoch.id !== epoch) this.state.epoch = { id: epoch, contribution: 0, claimed: false };
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
    this.syncActive();
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
    if (this.state.portfolio[plot.id]) return this.result(false, "You already hold that plot.");
    const held = this.ownedPlotIds().length;
    if (held >= this.plotAllowance()) return this.result(false, `Your civic standing supports ${this.plotAllowance()} plot${this.plotAllowance() === 1 ? "" : "s"}. Reach ${this.nextCareerLevel()?.name ?? "the next career level"} to lease another.`);
    if (this.state.island !== plot.island) return this.result(false, "Travel to the plot's island before leasing it.");
    if (this.state.wallet < plot.price) return this.result(false, `You do not have enough ${SUNMARK_CODE} for the lease.`);
    this.state.wallet -= plot.price; this.state.governmentTreasury += plot.price; this.state.tutorial.leased = true; this.addExperience(10);
    this.syncActive();
    this.state.portfolio[plot.id] = {
      plotId: plot.id, license: null, buildingPlaced: false, job: null,
      upgrades: { yield: 0, capacity: 0, speed: 0, appeal: 0 },
      condition: 100, brokenDown: false, jobsCompleted: 0,
    };
    this.loadBusiness(plot.id);
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

  marketBuyPrice(key: ResourceKey): number { return Math.max(1, Math.round(RESOURCES[key].governmentPrice * this.state.marketPressure[key] * this.eventMultiplier(key))); }
  marketSellPrice(key: ResourceKey): number {
    const appeal = 1 + this.state.upgrades.appeal * .05;
    const stabilizer = RESOURCES[key].buyer === "government" ? this.stabilizerMultiplier() : 1;
    const quality = this.state.specialization === "premium" ? 1.08 : 1;
    return Math.max(1, Math.round(RESOURCES[key].procurementPrice * this.state.marketPressure[key] * appeal * stabilizer * quality * this.eventMultiplier(key)));
  }

  buyResource(key: ResourceKey, quantity = 1): ActionResult {
    this.rollCalendar();
    this.rebalanceMarket();
    const amount = Math.max(1, Math.floor(quantity));
    if (RESOURCES[key].civicSupply === false) return this.result(false, `${RESOURCES[key].name} is recovered from production, not sold by the civic supplier.`);
    const unitPrice = this.marketBuyPrice(key); const cost = unitPrice * amount;
    if (this.state.wallet < cost) return this.result(false, `You need ${cost} ${SUNMARK_CODE}.`);
    this.state.wallet -= cost; this.state.governmentTreasury += cost; this.state.inventory[key] += amount; this.state.daily.trades += amount; this.moveMarket(key, 1, amount);
    this.commit(`Civic fallback supplied ${amount} ${RESOURCES[key].short} at ${unitPrice} ${SUNMARK_CODE} each. Scarcity moved the market price.`, "success");
    return this.result(true, "Resource purchased.");
  }

  private inputMultiplier(): number { return 1 + this.state.upgrades.capacity; }

  /** Seconds for one job. The single source of truth for manual and unattended runs. */
  jobDuration(license: LicenseKey, cycles = this.inputMultiplier()): number {
    const config = BUSINESS[license];
    const operations = this.state.specialization === "efficient" ? .9 : 1;
    const speed = Math.max(.52, (1 - this.state.upgrades.speed * .12) * operations);
    const batchLoad = 1 + CAPACITY_DURATION_STEP * (cycles - 1);
    const opening = this.state.jobsCompleted < OPENING_JOBS;
    const scale = opening ? PRODUCTION_TIME_SCALE * OPENING_TIME_SCALE : PRODUCTION_TIME_SCALE;
    const seconds = config.duration * speed * batchLoad * scale;
    return opening ? Math.min(seconds, OPENING_MAX_SECONDS) : seconds;
  }

  startJob(now = Date.now()): ActionResult {
    this.rollCalendar(now);
    if (!this.state.buildingPlaced || !this.state.license) return this.result(false, "Build your licensed business first.");
    if (this.state.job) return this.result(false, "A production job is already active.");
    if (this.state.brokenDown) return this.result(false, "The line is broken down. Send an emergency repair crew first.");
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
    const duration = this.jobDuration(this.state.license, cycles);
    this.state.job = { license: this.state.license, startedAt: now, completeAt: now + duration * 1000, cycles, laborCost };
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

  /** Visits a district will pay full price for today. */
  dailyAudience(): number {
    const growth = 1 + (this.careerLevel().level - 1) * .18 + this.state.upgrades.appeal * .1;
    return Math.max(8, Math.round(SERVICE_AUDIENCE_BUDGET * growth));
  }

  audienceRemaining(): number {
    return Math.max(0, this.dailyAudience() - this.state.daily.visits);
  }

  /**
   * Service revenue decays past the day's audience exactly as goods prices do. Without
   * this a short-cycle service runs all night and prints, because nothing else stops it.
   */
  private serviceGross(config: (typeof BUSINESS)[LicenseKey], cycles: number): number {
    const visitors = this.serviceVisitors(config, cycles);
    const audience = Math.max(1, this.dailyAudience());
    const unit = (config.servicePayout ?? 0) * this.state.servicePriceIndex;
    let used = this.state.daily.visits;
    let gross = 0;
    for (let i = 0; i < visitors; i += 1) {
      const tranche = Math.floor(used / audience);
      gross += unit * Math.max(DEMAND_PRICE_FLOOR, Math.pow(DEMAND_TRANCHE_DECAY, tranche));
      used += 1;
    }
    return Math.round(gross);
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
      this.state.daily.visits += visitors;
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
    const sale = this.demandSaleGross(key, amount);
    const gross = sale.gross; const tax = Math.floor(gross * TAX_RATE);
    const buyerPool = citizenDemand ? this.state.citizenPool : this.state.governmentTreasury;
    if (buyerPool < gross) return this.result(false, `${citizenDemand ? "AI-citizen demand" : "Government procurement"} is temporarily exhausted.`);
    this.state.inventory[key] -= amount;
    if (citizenDemand) this.state.citizenPool -= gross; else this.state.governmentTreasury -= gross;
    this.state.wallet += gross - tax; this.state.governmentTreasury += tax; this.state.taxPaid += tax; this.state.lifetimeRevenue += gross;
    this.state.procurement.used[key] += amount;
    this.addContribution(gross, citizenDemand ? "household" : "civic");
    this.state.daily.trades += amount; this.addExperience(Math.max(2, amount * 2));
    this.state.reputation += Math.max(1, Math.floor(amount / 2)); this.state.tutorial.sold = true; this.moveMarket(key, -1, amount);
    this.recordEconomy();
    const buyer = citizenDemand ? "Households" : "The city";
    const softened = sale.lastUnit < sale.firstUnit
      ? ` They had enough by the end — the last ones only fetched ${sale.lastUnit} each.`
      : ` They will take ${this.procurementRemaining(key)} more at this price today.`;
    this.commit(`${buyer} bought ${amount} ${RESOURCES[key].short} for ${gross} ${SUNMARK_CODE}.${softened}`, "success");
    return this.result(true, "Sale settled.");
  }

  reserveSellPayout(amount = MM_EXCHANGE_BUNDLE): number {
    const principal = Math.round(amount * MM_REFERENCE_RATE);
    return Math.max(0, principal - Math.max(1, Math.ceil(principal * MM_EXCHANGE_FEE_RATE)));
  }

  /** Your share of this epoch's fixed budget. Grinding harder raises your share, never the budget. */
  epochShare(): number {
    const mine = this.state.epoch.contribution;
    return mine <= 0 ? 0 : mine / (mine + COHORT_CONTRIBUTION_BASE);
  }

  projectedEpochMM(): number {
    const budgeted = Math.floor(EPOCH_MM_BUDGET * this.epochShare());
    return Math.max(0, Math.min(budgeted, this.state.mmReserve - MIN_MM_RESERVE));
  }

  epochEndsAt(): number { return (this.state.epoch.id + 1) * EPOCH_LENGTH_DAYS * 86_400_000; }

  /**
   * $MM cannot be bought. It is distributed once per epoch from a fixed budget, divided by
   * contribution share, so a larger or busier population dilutes every payout rather than
   * draining the vault faster. This is the whole anti-farm property of the design.
   */
  claimEpochRewards(now = Date.now()): ActionResult {
    this.rollCalendar(now);
    if (this.state.epoch.claimed) return this.result(false, "This epoch's distribution is already claimed.");
    if (this.state.epoch.contribution <= 0) return this.result(false, "Fulfil an order or supply the district to earn a contribution share.");
    const units = this.projectedEpochMM();
    if (units <= 0) return this.result(false, "Your contribution share does not yet round to a whole $MM.");
    this.state.mmReserve -= units;
    this.state.mmHoldings += units;
    this.state.lifetimeMMEarned += units;
    this.state.epoch.claimed = true;
    this.addExperience(40);
    this.commit(`Epoch distribution paid ${units} $MM for a ${(this.epochShare() * 100).toFixed(2)}% contribution share of the ${EPOCH_MM_BUDGET.toLocaleString()} $MM budget.`, "success");
    return this.result(true, "Epoch rewards claimed.");
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

  // ---------------------------------------------------------------------
  // Passive operations
  // ---------------------------------------------------------------------

  /** Write the live view back into the durable record. Called before every save. */
  private syncActive(): void {
    const plotId = this.state.ownedPlotId;
    if (!plotId) return;
    this.state.portfolio[plotId] = {
      plotId,
      license: this.state.license,
      buildingPlaced: this.state.buildingPlaced,
      job: this.state.job,
      upgrades: { ...this.state.upgrades },
      condition: this.state.condition,
      brokenDown: this.state.brokenDown,
      jobsCompleted: this.state.jobsCompleted,
    };
  }

  /** Make one owned business the live view. */
  private loadBusiness(plotId: string): boolean {
    const record = this.state.portfolio[plotId];
    if (!record) return false;
    this.state.ownedPlotId = plotId;
    this.state.license = record.license;
    this.state.buildingPlaced = record.buildingPlaced;
    this.state.job = record.job;
    this.state.upgrades = { ...record.upgrades };
    this.state.condition = record.condition;
    this.state.brokenDown = record.brokenDown;
    this.state.jobsCompleted = record.jobsCompleted;
    return true;
  }

  /** Plots a player may hold at once, earned through civic standing. */
  plotAllowance(): number {
    return BASE_PLOT_ALLOWANCE + Math.floor(this.careerLevel().level * PLOTS_PER_CAREER_LEVEL);
  }

  ownedPlotIds(): string[] {
    return PLOTS.filter((plot) => this.state.portfolio[plot.id]).map((plot) => plot.id);
  }

  switchBusiness(plotId: string): ActionResult {
    if (plotId === this.state.ownedPlotId) return this.result(false, "That business is already open.");
    this.syncActive();
    if (!this.loadBusiness(plotId)) return this.result(false, "You do not hold that plot.");
    const plot = PLOTS.find((entry) => entry.id === plotId)!;
    this.commit(`Now managing ${plot.name}.`, "success");
    return this.result(true, "Business switched.");
  }

  storageCapacity(): number {
    return STORAGE_BASE_CAPACITY + this.state.upgrades.capacity * STORAGE_PER_CAPACITY_LEVEL;
  }

  storedUnits(): number {
    return resourceKeys.reduce((total, key) => total + this.state.inventory[key], 0);
  }

  storageFull(): boolean { return this.storedUnits() >= this.storageCapacity(); }

  setOperation(key: keyof Operations, value: boolean): ActionResult {
    this.state.operations[key] = value;
    this.commit(`${key === "autoProduce" ? "Continuous production" : key === "autoBuy" ? "Standing input orders" : "Broker sales"} ${value ? "enabled" : "paused"}.`, "success");
    return this.result(true, "Operations updated.");
  }

  /** A breakdown halts the line until a person deals with it. Timers cannot clear it. */
  repairBreakdown(): ActionResult {
    if (!this.state.brokenDown) return this.result(false, "Nothing is broken down.");
    if (this.state.wallet < BREAKDOWN_REPAIR_COST) return this.result(false, `Emergency repair costs ${BREAKDOWN_REPAIR_COST} ${SUNMARK_CODE}.`);
    if (this.state.inventory.part < BREAKDOWN_REPAIR_PARTS) return this.result(false, `Emergency repair needs ${BREAKDOWN_REPAIR_PARTS} Utility Parts.`);
    this.state.wallet -= BREAKDOWN_REPAIR_COST;
    this.state.citizenPool += Math.round(BREAKDOWN_REPAIR_COST * .7);
    this.state.governmentTreasury += BREAKDOWN_REPAIR_COST - Math.round(BREAKDOWN_REPAIR_COST * .7);
    this.state.inventory.part -= BREAKDOWN_REPAIR_PARTS;
    this.state.condition = Math.min(100, this.state.condition + 55);
    this.state.brokenDown = false;
    this.addExperience(25);
    this.commit("Emergency crew restored the line. Production resumes.", "success");
    return this.result(true, "Repaired.");
  }

  /** Sell unattended through a broker, who keeps a cut. Selling by hand always pays more. */
  private brokerSell(key: ResourceKey, amount: number): { sold: number; revenue: number } {
    if (amount <= 0) return { sold: 0, revenue: 0 };
    // Only sell the units that still clear above the floor; hold the rest.
    let sellable = 0;
    const floor = RESOURCES[key].procurementPrice * BROKER_PRICE_FLOOR;
    while (sellable < amount && this.demandSaleGross(key, sellable + 1).lastUnit >= floor) sellable += 1;
    if (sellable <= 0) return { sold: 0, revenue: 0 };
    amount = sellable;
    const sale = this.demandSaleGross(key, amount);
    const gross = Math.max(0, Math.round(sale.gross * (1 - AUTO_SELL_BROKER_FEE)));
    const citizenDemand = RESOURCES[key].buyer === "citizens";
    const pool = citizenDemand ? this.state.citizenPool : this.state.governmentTreasury;
    if (pool < gross || gross <= 0) return { sold: 0, revenue: 0 };
    const tax = Math.floor(gross * TAX_RATE);
    this.state.inventory[key] -= amount;
    if (citizenDemand) this.state.citizenPool -= gross; else this.state.governmentTreasury -= gross;
    this.state.wallet += gross - tax;
    this.state.governmentTreasury += tax;
    this.state.taxPaid += tax;
    this.state.lifetimeRevenue += gross;
    this.state.procurement.used[key] += amount;
    this.state.tutorial.sold = true;
    this.addContribution(gross, "auto");
    this.moveMarket(key, -1, amount);
    return { sold: amount, revenue: gross - tax };
  }

  /**
   * Replay the time the player was away. Production, procurement and sales run on a
   * clock; the run stops at the first thing that genuinely needs a person — a full
   * warehouse, an unaffordable input, or a breakdown.
   */
  /**
   * Replay the absence for EVERY owned business, then restore whichever one was open.
   * Each replays the same wall-clock window; they compete for the same district demand,
   * so a second shop on the same island genuinely cannibalises the first.
   */
  catchUp(now = Date.now()): ShiftReport {
    const owned = this.ownedPlotIds();
    if (owned.length <= 1) return this.catchUpOne(now);

    const openAt = this.state.ownedPlotId;
    const windowStart = this.state.lastTickAt;
    const total: ShiftReport = { hours: 0, jobs: 0, produced: 0, sold: 0, revenue: 0, spent: 0, wages: 0, halted: "idle" };

    for (const plotId of owned) {
      this.syncActive();
      if (!this.loadBusiness(plotId)) continue;
      this.state.lastTickAt = windowStart;
      const one = this.catchUpOne(now);
      total.hours = Math.max(total.hours, one.hours);
      total.jobs += one.jobs;
      total.produced += one.produced;
      total.sold += one.sold;
      total.revenue += one.revenue;
      total.spent += one.spent;
      total.wages += one.wages;
      if (one.halted !== "idle" && total.halted === "idle") total.halted = one.halted;
    }

    this.syncActive();
    if (openAt) this.loadBusiness(openAt);
    this.state.lastTickAt = now;
    this.state.lastShift = total;
    return total;
  }

  private catchUpOne(now = Date.now()): ShiftReport {
    const report: ShiftReport = { hours: 0, jobs: 0, produced: 0, sold: 0, revenue: 0, spent: 0, wages: 0, halted: "idle" };
    const license = this.state.license;
    if (!license || !this.state.buildingPlaced) { this.state.lastTickAt = now; return report; }

    const config = BUSINESS[license];
    const budget = Math.min(now - this.state.lastTickAt, OFFLINE_MAX_HOURS * 3_600_000);
    if (budget <= 0) { this.state.lastTickAt = now; return report; }

    let clock = this.state.lastTickAt;
    const until = clock + budget;
    report.hours = budget / 3_600_000;

    // Finish whatever was already on the floor.
    if (this.state.job && this.state.job.completeAt <= until) {
      clock = Math.max(clock, this.state.job.completeAt);
      // Count what the in-flight job actually yielded, so the report cannot read
      // "1 job, 0 made".
      const before = this.storedUnits();
      this.collectJob(this.state.job.completeAt);
      report.produced += Math.max(0, this.storedUnits() - before);
      report.jobs += 1;
    }

    if (!this.state.operations.autoProduce) {
      this.state.lastTickAt = now;
      report.halted = this.state.job ? "running" : "idle";
      return report;
    }

    let day = utcDay(clock);
    for (let guard = 0; guard < 400; guard += 1) {
      if (this.state.brokenDown) { report.halted = "breakdown"; break; }

      // Routine upkeep is automatic. It only becomes a crisis when it cannot be paid for.
      if (this.state.condition <= AUTO_MAINTAIN_AT) {
        if (this.state.inventory.part < 1 && this.state.operations.autoBuy) {
          const unit = Math.max(1, Math.round(this.marketBuyPrice("part") * (1 + AUTO_BUY_PREMIUM)));
          if (this.state.wallet >= unit + AUTO_MAINTAIN_COST) {
            this.state.wallet -= unit;
            this.state.governmentTreasury += unit;
            this.state.inventory.part += 1;
            report.spent += unit;
          }
        }
        if (this.state.wallet >= AUTO_MAINTAIN_COST && this.state.inventory.part >= 1) {
          this.state.wallet -= AUTO_MAINTAIN_COST;
          this.state.citizenPool += 12;
          this.state.governmentTreasury += AUTO_MAINTAIN_COST - 12;
          this.state.laborPaid += 12;
          this.state.inventory.part -= 1;
          this.state.condition = Math.min(100, this.state.condition + 35);
          report.spent += AUTO_MAINTAIN_COST;
        } else if (this.state.condition <= BREAKDOWN_CONDITION) {
          this.state.brokenDown = true;
          report.halted = "breakdown";
          break;
        }
      }

      // A new civic day refreshes demand mid-absence.
      const clockDay = utcDay(clock);
      if (clockDay !== day) { this.state.procurement = { date: clockDay, used: blankProcurement() }; day = clockDay; }

      const cycles = this.inputMultiplier();
      const duration = this.jobDuration(license, cycles) * 1000;
      if (clock + duration > until) { report.halted = "running"; break; }

      if (this.storageFull()) { report.halted = "storage"; break; }

      // Would this job pay for itself at today's *decayed* prices? An operator who keeps
      // producing into a saturated market is not passive, just careless.
      const laborEstimate = Math.ceil(config.laborCost * cycles * (this.state.specialization === "community" ? 1.1 : 1));
      let inputEstimate = 0;
      for (const key of resourceKeys) {
        const need = (config.inputs[key] ?? 0) * cycles;
        if (need > 0) inputEstimate += need * Math.round(this.marketBuyPrice(key) * (1 + AUTO_BUY_PREMIUM));
      }
      let revenueEstimate = 0;
      if (config.servicePayout) {
        revenueEstimate = this.serviceGross(config, cycles);
      } else {
        for (const key of resourceKeys) {
          const base = (config.output[key] ?? 0) * cycles;
          if (base <= 0) continue;
          const made = Math.max(base, Math.round(base * (1 + this.state.upgrades.yield * .12)));
          revenueEstimate += this.demandSaleGross(key, made).gross * (1 - AUTO_SELL_BROKER_FEE);
        }
      }
      if (revenueEstimate * (1 - TAX_RATE) <= inputEstimate + laborEstimate) {
        report.halted = "demand";
        break;
      }

      // Inputs: buy what is missing, at an unattended premium.
      let starved = false;
      for (const key of resourceKeys) {
        const need = (config.inputs[key] ?? 0) * cycles;
        const missing = need - this.state.inventory[key];
        if (missing <= 0) continue;
        if (!this.state.operations.autoBuy) { starved = true; break; }
        const unit = Math.max(1, Math.round(this.marketBuyPrice(key) * (1 + AUTO_BUY_PREMIUM)));
        const cost = unit * missing;
        if (this.state.wallet < cost) { starved = true; break; }
        this.state.wallet -= cost;
        this.state.governmentTreasury += cost;
        this.state.inventory[key] += missing;
        this.moveMarket(key, 1, missing);
        report.spent += cost;
      }
      if (starved) { report.halted = this.state.operations.autoBuy ? "funds" : "inputs"; break; }

      const laborMultiplier = this.state.specialization === "community" ? 1.1 : 1;
      const laborCost = Math.ceil(config.laborCost * cycles * laborMultiplier);
      if (this.state.wallet < laborCost) { report.halted = "funds"; break; }

      for (const key of resourceKeys) this.state.inventory[key] -= (config.inputs[key] ?? 0) * cycles;
      this.state.wallet -= laborCost;
      this.state.citizenPool += laborCost;
      this.state.laborPaid += laborCost;
      report.wages += laborCost;

      clock += duration;

      if (config.servicePayout) {
        const gross = this.serviceGross(config, cycles);
        if (this.state.citizenPool >= gross) {
          const tax = Math.floor(gross * TAX_RATE);
          this.state.citizenPool -= gross;
          this.state.wallet += gross - tax;
          this.state.governmentTreasury += tax;
          this.state.taxPaid += tax;
          this.state.lifetimeRevenue += gross;
          const served = this.serviceVisitors(config, cycles);
          this.state.visitorsServed += served;
          this.state.daily.visits += served;
          this.state.tutorial.sold = true;
          this.addContribution(gross, "auto");
          report.revenue += gross - tax;
        }
      } else {
        for (const key of resourceKeys) {
          const base = (config.output[key] ?? 0) * cycles;
          if (base <= 0) continue;
          const made = Math.max(base, Math.round(base * (1 + this.state.upgrades.yield * .12)));
          this.state.inventory[key] += made;
          report.produced += made;
          if (this.state.operations.autoSell) {
            const sale = this.brokerSell(key, made);
            report.sold += sale.sold;
            report.revenue += sale.revenue;
          }
        }
      }
      if (config.wastePerCycle) this.state.inventory.waste += config.wastePerCycle * cycles;

      this.state.condition = Math.max(0, this.state.condition - 3 - cycles * 2);
      this.state.jobsCompleted += 1;
      this.state.daily.jobs += 1;
      this.state.tutorial.produced = true;
      report.jobs += 1;
      if (this.state.condition <= BREAKDOWN_CONDITION) { this.state.brokenDown = true; report.halted = "breakdown"; break; }
    }

    this.state.lastTickAt = now;
    this.state.lastShift = report;
    if (report.jobs > 0) {
      this.commit(`While you were away: ${report.jobs} job${report.jobs === 1 ? "" : "s"}, ${report.produced} units made, ${report.revenue} ${SUNMARK_CODE} net.`, "success");
    }
    return report;
  }

  // ---------------------------------------------------------------------
  // District demand shocks
  // ---------------------------------------------------------------------

  /** Same answer for everyone on the same day: derived, never stored. */
  private static hash(seed: string): number {
    let value = 2166136261;
    for (let i = 0; i < seed.length; i += 1) {
      value ^= seed.charCodeAt(i);
      value = Math.imul(value, 16777619) >>> 0;
    }
    return value >>> 0;
  }

  /** The shock running on one island right now, if any. */
  districtEvent(islandId: string, now = Date.now()): DistrictEvent | null {
    const period = Math.floor(now / (EVENT_DAYS * 86_400_000));
    const islandIndex = ISLANDS.findIndex((entry) => entry.id === islandId);
    if (islandIndex < 0) return null;

    // Only a few islands run a shock at once, so travelling somewhere means something.
    // One island is always guaranteed: without it roughly one period in twenty has no
    // shock anywhere, and there is nowhere worth sailing to.
    const anchor = GameStore.hash(`${period}:anchor`) % ISLANDS.length;
    const draw = GameStore.hash(`${period}:${islandId}`);
    if (islandIndex !== anchor && draw % ISLANDS.length >= EVENT_ISLANDS) return null;

    const tradable = resourceKeys.filter((key) => RESOURCES[key].civicSupply !== false);
    const resource = tradable[GameStore.hash(`${period}:${islandId}:res`) % tradable.length]!;
    const span = EVENT_MAX_BONUS - EVENT_MIN_BONUS;
    const bonus = EVENT_MIN_BONUS + (GameStore.hash(`${period}:${islandId}:bonus`) % 1000) / 1000 * span;
    const reason = EVENT_REASONS[GameStore.hash(`${period}:${islandId}:why`) % EVENT_REASONS.length]!;

    return {
      islandId, resource,
      multiplier: 1 + Math.round(bonus * 100) / 100,
      reason,
      endsAt: (period + 1) * EVENT_DAYS * 86_400_000,
    };
  }

  /** Every island's shock, for the ferry map. */
  districtEvents(now = Date.now()): DistrictEvent[] {
    return ISLANDS.map((island) => this.districtEvent(island.id, now)).filter((entry): entry is DistrictEvent => entry !== null);
  }

  /** How much a shock moves a price on the island the player is standing on. */
  private eventMultiplier(key: ResourceKey): number {
    const event = this.districtEvent(this.state.island);
    return event && event.resource === key ? event.multiplier : 1;
  }

  /**
   * Units of one resource that clear at full price today, derived from a daily VALUE budget.
   * Cheap bulk goods therefore get a large unit allowance and capital goods a small one,
   * which is what stops a utility from flooding its own market on the first job.
   */
  dailyQuota(key: ResourceKey): number {
    const resource = RESOURCES[key];
    const budget = (resource.buyer === "citizens" ? CITIZEN_DEMAND_BUDGET : CIVIC_DEMAND_BUDGET) * DEMAND_TIER_WEIGHT[resource.tier];
    const growth = 1 + (this.careerLevel().level - 1) * .18 + this.state.upgrades.appeal * .1;
    return Math.max(4, Math.round((budget * growth) / resource.procurementPrice));
  }

  procurementQuota(): number { return this.dailyQuota("part"); }

  procurementRemaining(key: ResourceKey): number {
    this.rollCalendar();
    return Math.max(0, this.dailyQuota(key) - this.state.procurement.used[key]);
  }

  /**
   * Local demand softens instead of stopping. Every further tranche the size of the daily
   * quota clears at DEMAND_TRANCHE_DECAY of the previous one, never below DEMAND_PRICE_FLOOR,
   * so saturating a market costs you margin but never bricks the business for the day.
   */
  demandSaleGross(key: ResourceKey, amount: number): { gross: number; firstUnit: number; lastUnit: number } {
    const quota = Math.max(1, this.dailyQuota(key));
    const unit = this.marketSellPrice(key);
    let used = this.state.procurement.used[key];
    let gross = 0, firstUnit = 0, lastUnit = 0;
    for (let i = 0; i < amount; i += 1) {
      const tranche = Math.floor(used / quota);
      const multiplier = Math.max(DEMAND_PRICE_FLOOR, Math.pow(DEMAND_TRANCHE_DECAY, tranche));
      const price = Math.max(1, Math.round(unit * multiplier));
      if (i === 0) firstUnit = price;
      lastUnit = price;
      gross += price;
      used += 1;
    }
    return { gross, firstUnit, lastUnit };
  }

  /** Contribution is what converts into $MM. Serving a named buyer's order counts most. */
  private addContribution(gross: number, kind: keyof typeof CONTRIBUTION_WEIGHT): void {
    const gained = gross * CONTRIBUTION_WEIGHT[kind];
    this.state.epoch.contribution += gained;
    this.state.lifetimeContribution += gained;
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

  /**
   * The order a player can most plausibly fill right now: best pay per unit still
   * missing. This is what the world pin advertises, so the highest-paying action is
   * also the most visible one.
   */
  bestOffer(): ContractOffer | null {
    const offers = this.contractOffers();
    if (!offers.length) return null;
    const score = (offer: ContractOffer): number => {
      const missing = Math.max(0, offer.quantity - this.state.inventory[offer.resource]);
      const perUnit = offer.grossReward / Math.max(1, offer.quantity);
      // Prefer good money, and prefer orders you can nearly fill already.
      return perUnit * (1 + (offer.quantity - missing) / Math.max(1, offer.quantity));
    };
    return offers.reduce((best, offer) => (score(offer) > score(best) ? offer : best), offers[0]!);
  }

  /** What this district is paying well for today, and how much it will still absorb. */
  demandHighlights(limit = 3): Array<{ key: ResourceKey; price: number; remaining: number; held: number }> {
    return resourceKeys
      .filter((key) => RESOURCES[key].civicSupply !== false || this.state.inventory[key] > 0)
      .map((key) => ({
        key,
        price: this.marketSellPrice(key),
        remaining: this.procurementRemaining(key),
        held: this.state.inventory[key],
      }))
      .filter((row) => row.remaining > 0)
      .sort((a, b) => (b.price * Math.min(b.remaining, 40)) - (a.price * Math.min(a.remaining, 40)))
      .slice(0, limit);
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
    this.addContribution(contract.grossReward, "contract");
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
