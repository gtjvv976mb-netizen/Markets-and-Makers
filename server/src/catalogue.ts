/**
 * Server copy of the resource catalogue and demand constants.
 *
 * These MUST stay in step with game/src/data.ts. They are duplicated rather than shared
 * because the client and server are separate packages; economy.test.ts pins the values
 * that matter so a silent drift fails a build rather than a player's wallet.
 */
export type Buyer = "government" | "citizens";
export type Tier = "civic" | "raw" | "intermediate" | "capital" | "consumer" | "recovered";

export const REALM_NAME = "Mercedonia";
export const CITIZEN_NAME = "Mercedonians";
export const CURRENCY_NAME = "Merc Dollars";
export const CURRENCY_CODE = "MERCS";

export interface ResourceSpec {
  governmentPrice: number; procurementPrice: number; buyer: Buyer; tier: Tier; volatility: number; civicSupply?: boolean;
}

export const RESOURCES: Record<string, ResourceSpec> = {
  water:     { governmentPrice: 6,  procurementPrice: 3,  buyer: "government", tier: "civic",        volatility: .08 },
  power:     { governmentPrice: 8,  procurementPrice: 4,  buyer: "government", tier: "civic",        volatility: .10 },
  ore:       { governmentPrice: 14, procurementPrice: 10, buyer: "government", tier: "raw",          volatility: .16 },
  timber:    { governmentPrice: 13, procurementPrice: 9,  buyer: "government", tier: "raw",          volatility: .14 },
  food:      { governmentPrice: 15, procurementPrice: 12, buyer: "citizens",   tier: "consumer",     volatility: .18 },
  crate:     { governmentPrice: 22, procurementPrice: 17, buyer: "government", tier: "intermediate", volatility: .13 },
  part:      { governmentPrice: 48, procurementPrice: 40, buyer: "government", tier: "intermediate", volatility: .14 },
  equipment: { governmentPrice: 86, procurementPrice: 72, buyer: "government", tier: "capital",      volatility: .12 },
  material:  { governmentPrice: 58, procurementPrice: 48, buyer: "government", tier: "capital",      volatility: .12 },
  supply:    { governmentPrice: 25, procurementPrice: 20, buyer: "citizens",   tier: "consumer",     volatility: .20 },
  // Scrap is a by-product of production, never sold by the civic supplier. This MUST match data.ts.
  waste:     { governmentPrice: 12, procurementPrice: 4,  buyer: "government", tier: "recovered",    volatility: .06, civicSupply: false },
};

export const PRESSURE_MIN = 0.72;
export const PRESSURE_MAX = 1.55;
export const MEAN_REVERSION_PER_MINUTE = 0.012;
// Most of a day's price shock has washed out by the next morning. At the old 0.35 a market
// pushed to its floor by one day's trading was still depressed the next, so depression
// compounded and every producer converged on the clamp. Mirrors the client's value.
export const MEAN_REVERSION_CAP = 0.6;

/**
 * How hard one trade moves a price, as a share of the good's volatility.
 *
 * Impact used to be an absolute sqrt(quantity) step, which was tuned for hand-sized trades
 * and ruinous under the world tick: one ordinary day of production floored the price of the
 * maker's own goods, and the profitability gate then correctly refused to produce anything
 * ever again. Measured on the client model, which had the identical bug: a greenhouse's
 * food went 12 -> 9 on day one and never recovered, turning +390/day into -20/day.
 */
export const DEPTH_PRICE_IMPACT = 1.2;

/** Cycles a day the district's trades are assumed to run. Mirrors the client. */
export const CHAIN_CYCLES_PER_DAY = 26;

/** How many of each trade a district runs before any real maker turns up. */
export const DISTRICT_BASE_TRADES = 1;

/** What one more real business in the district adds, as a share of a base trade. */
export const DISTRICT_NEIGHBOUR_WEIGHT = 0.5;

/** The most a chain hungry for a good will pay over the reference price. */
export const CHAIN_PREMIUM_MAX = 0.35;

export const DEMAND_TRANCHE_DECAY = 0.72;
export const DEMAND_PRICE_FLOOR = 0.34;
export const CIVIC_DEMAND_BUDGET = 1_350;
export const CITIZEN_DEMAND_BUDGET = 1_750;
export const DEMAND_TIER_WEIGHT: Record<Tier, number> = {
  civic: 1, raw: 1.15, intermediate: 1.7, capital: 2.6, consumer: 1.05, recovered: .6,
};

/**
 * A district's daily allowance is shared by everyone trading in it, so it is sized for a
 * population rather than one shop. Per-player budgets are this divided by active traders.
 */
export const DISTRICT_TRADER_BASELINE = 8;

export const EPOCH_LENGTH_DAYS = 7;
/** Emission is a share of what remains, not a fixed number. Must match game/src/data.ts. */
export const EPOCH_EMISSION_RATE = 0.003;
export const EPOCH_MM_FLOOR = 8_000;
export const REWARDS_POOL_MM = 25_000_000;
/**
 * 75,000, matching what the funding maths has ALWAYS emitted.
 *
 * This said 60,000 for its whole life while fundReserve and the peg derived ~75,140 per
 * epoch — confirmed three independent ways, most recently by a forty-player simulation that
 * issued 74,775 real units under the claim lock. The owner's call, made 2026-08-30 with
 * "make it more profitable": the emitted number is the intended number. The one red test
 * that guarded this discrepancy goes green with this line.
 */
export const EPOCH_MM_BUDGET = 75_000;
/** Nobody who contributed should round to nothing, however crowded the realm gets. */
export const MIN_EPOCH_PAYOUT = 25;
/**
 * The procurement stabilizer: what the treasury may spend buying goods each day, as a share
 * of what it holds above its floor — Chile's structural-balance rule in one line. When the
 * treasury is rich the cap sits far above real demand and no player ever meets it; as the
 * treasury thins, procurement thins with it, so the drain decays toward equilibrium instead
 * of running linearly into the floor. The floor keeps a minimum market alive even in a
 * depression, exactly like the payroll floor keeps citizens fed.
 */
export const PROCUREMENT_SHARE_CAP = 0.005;
export const PROCUREMENT_DAY_FLOOR = 500;

/** A share of every fee and tax funds the next epoch instead of only draining the vault. */
/**
 * Standing charges, payroll and the service counter — mirrors of game/src/data.ts.
 *
 * The browser has always billed these; the authority never did, so on a server world the
 * treasury's return leg did not exist. Same numbers on both sides, pinned by economy.test.ts,
 * because a business is shown one overhead in the HUD and must be charged that one offline.
 */
export const WATER_STANDING_CHARGE = 6;
export const POWER_STANDING_CHARGE = 8;
export const UTILITY_PER_CAPACITY = 7;
export const STAFF_DAILY_WAGE = 14;

/** The absence a business keeps earning — and being billed — for. */
export const OFFLINE_MAX_HOURS = 26;
export const OFFLINE_HOURS_PER_CAPACITY = 6;

/** Customers a service can serve in a day before its takings start to decay. */
export const SERVICE_AUDIENCE_BUDGET = 260;

export const RESERVE_FUNDING_RATE = 0.35;
/** Peg: one USDT of $MM buys 10,000 Merc Dollars. Must match game/src/data.ts. */
export const MERC_DOLLARS_PER_USD = 10_000;
export const MM_REFERENCE_PRICE_USD = 0.01;
/** Merc Dollars per $MM at the reference price. Fees are collected in MERCS, budgets in $MM. */
export const MERC_DOLLARS_PER_MM = MERC_DOLLARS_PER_USD * MM_REFERENCE_PRICE_USD;

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
export const epochIdFor = (at = Date.now()): number => Math.floor(at / (EPOCH_LENGTH_DAYS * 86_400_000));
export const utcDay = (at = Date.now()): string => new Date(at).toISOString().slice(0, 10);
