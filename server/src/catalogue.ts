/**
 * Server copy of the resource catalogue and demand constants.
 *
 * These MUST stay in step with game/src/data.ts. They are duplicated rather than shared
 * because the client and server are separate packages; economy.test.ts pins the values
 * that matter so a silent drift fails a build rather than a player's wallet.
 */
export type Buyer = "government" | "citizens";
export type Tier = "civic" | "raw" | "intermediate" | "capital" | "consumer" | "recovered";

export interface ResourceSpec {
  governmentPrice: number; procurementPrice: number; buyer: Buyer; tier: Tier; volatility: number;
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
  waste:     { governmentPrice: 12, procurementPrice: 4,  buyer: "government", tier: "recovered",    volatility: .06 },
};

export const PRESSURE_MIN = 0.72;
export const PRESSURE_MAX = 1.55;
export const MEAN_REVERSION_PER_MINUTE = 0.012;
export const MEAN_REVERSION_CAP = 0.35;

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
export const EPOCH_MM_BUDGET = 60_000;
/** Nobody who contributed should round to nothing, however crowded the realm gets. */
export const MIN_EPOCH_PAYOUT = 25;
/** A share of every fee and tax funds the next epoch instead of only draining the vault. */
export const RESERVE_FUNDING_RATE = 0.35;

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
export const epochIdFor = (at = Date.now()): number => Math.floor(at / (EPOCH_LENGTH_DAYS * 86_400_000));
export const utcDay = (at = Date.now()): string => new Date(at).toISOString().slice(0, 10);
