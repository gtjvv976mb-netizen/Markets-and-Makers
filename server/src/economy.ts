import type { PoolClient } from "pg";
import { pool } from "./database.js";
import {
  CITIZEN_DEMAND_BUDGET, CIVIC_DEMAND_BUDGET, DEMAND_PRICE_FLOOR, DEMAND_TIER_WEIGHT, DEMAND_TRANCHE_DECAY,
  DISTRICT_TRADER_BASELINE, EPOCH_EMISSION_RATE, EPOCH_MM_FLOOR, REWARDS_POOL_MM, MEAN_REVERSION_CAP, MEAN_REVERSION_PER_MINUTE, MIN_EPOCH_PAYOUT,
  MOLLAR_PER_MM, PRESSURE_MAX, PRESSURE_MIN, RESERVE_FUNDING_RATE, RESOURCES, clamp, epochIdFor, utcDay,
} from "./catalogue.js";

export class EconomyError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

function db(): NonNullable<typeof pool> {
  if (!pool) throw new EconomyError("no-database", "The shared economy requires a database.");
  return pool;
}

export interface Quote {
  itemKey: string; islandId: string; pressure: number;
  buy: number; sell: number; soldToday: number; districtQuota: number; nextUnit: number;
}

/** Pressure drifts back toward 1.0 over time; this is applied whenever it is read or written. */
async function currentPressure(client: PoolClient, realmId: string, islandId: string, itemKey: string): Promise<number> {
  const row = await client.query<{ pressure: string; age_minutes: string }>(
    `select pressure, extract(epoch from (now() - updated_at)) / 60 as age_minutes
       from market_pressure where realm_id = $1 and island_id = $2 and item_key = $3 for update`,
    [realmId, islandId, itemKey]);
  const found = row.rows[0];
  if (!found) return 1;
  const pressure = Number(found.pressure);
  const reversion = Math.min(MEAN_REVERSION_CAP, Number(found.age_minutes) * MEAN_REVERSION_PER_MINUTE);
  return clamp(pressure + (1 - pressure) * reversion, PRESSURE_MIN, PRESSURE_MAX);
}

async function writePressure(client: PoolClient, realmId: string, islandId: string, itemKey: string, pressure: number): Promise<void> {
  await client.query(
    `insert into market_pressure (realm_id, island_id, item_key, pressure, updated_at)
     values ($1,$2,$3,$4, now())
     on conflict (realm_id, island_id, item_key)
     do update set pressure = excluded.pressure, updated_at = now()`,
    [realmId, islandId, itemKey, clamp(pressure, PRESSURE_MIN, PRESSURE_MAX)]);
}

/** The whole district shares one daily allowance, sized for a population of traders. */
export function districtQuota(itemKey: string): number {
  const spec = RESOURCES[itemKey];
  if (!spec) throw new EconomyError("unknown-item", `No such resource: ${itemKey}`);
  const budget = (spec.buyer === "citizens" ? CITIZEN_DEMAND_BUDGET : CIVIC_DEMAND_BUDGET)
    * DEMAND_TIER_WEIGHT[spec.tier] * DISTRICT_TRADER_BASELINE;
  return Math.max(8, Math.round(budget / spec.procurementPrice));
}

function unitPriceAt(itemKey: string, pressure: number, soldSoFar: number): number {
  const spec = RESOURCES[itemKey]!;
  const quota = districtQuota(itemKey);
  const tranche = Math.floor(soldSoFar / quota);
  const decay = Math.max(DEMAND_PRICE_FLOOR, Math.pow(DEMAND_TRANCHE_DECAY, tranche));
  return Math.max(1, Math.round(spec.procurementPrice * pressure * decay));
}

export async function quote(realmId: string, islandId: string, itemKey: string): Promise<Quote> {
  const spec = RESOURCES[itemKey];
  if (!spec) throw new EconomyError("unknown-item", `No such resource: ${itemKey}`);
  const client = await db().connect();
  try {
    const pressure = await currentPressure(client, realmId, islandId, itemKey);
    const sold = await client.query<{ units: string }>(
      `select units from demand_day where realm_id=$1 and island_id=$2 and item_key=$3 and day=$4`,
      [realmId, islandId, itemKey, utcDay()]);
    const soldToday = Number(sold.rows[0]?.units ?? 0);
    return {
      itemKey, islandId, pressure: Number(pressure.toFixed(4)),
      buy: Math.max(1, Math.round(spec.governmentPrice * pressure)),
      sell: unitPriceAt(itemKey, pressure, 0),
      soldToday, districtQuota: districtQuota(itemKey),
      nextUnit: unitPriceAt(itemKey, pressure, soldToday),
    };
  } finally { client.release(); }
}

export async function islandBoard(realmId: string, islandId: string): Promise<Quote[]> {
  return Promise.all(Object.keys(RESOURCES).map((key) => quote(realmId, islandId, key)));
}

/**
 * Record a sale into the district. This is the call that makes the economy shared: one
 * player's selling moves the price and consumes the allowance that every other player in
 * that district is trading against.
 */
export interface SalePricing { gross: number; firstUnit: number; lastUnit: number; pressure: number; contribution: number }

export interface SaleInput {
  realmId: string; islandId: string; itemKey: string; quantity: number;
  playerId: string; contributionWeight: number; at?: number;
}

/**
 * Price a sale, consume district demand and credit contribution, INSIDE a caller's
 * transaction. Settlement must do this in the same transaction that moves the goods and
 * the money, or a replayed command re-prices the market even though the ledger is
 * idempotent — which moves prices for everyone twice for one sale.
 */
export async function applySaleWithin(client: PoolClient, input: SaleInput): Promise<SalePricing> {
  const spec = RESOURCES[input.itemKey];
  if (!spec) throw new EconomyError("unknown-item", `No such resource: ${input.itemKey}`);
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) throw new EconomyError("bad-quantity", "Quantity must be a positive whole number.");
  const at = input.at ?? Date.now();
  {
    const pressure = await currentPressure(client, input.realmId, input.islandId, input.itemKey);
    const day = utcDay(at);
    const soldRow = await client.query<{ units: string }>(
      `select units from demand_day
        where realm_id=$1 and island_id=$2 and item_key=$3 and day=$4 for update`,
      [input.realmId, input.islandId, input.itemKey, day]);
    let sold = Number(soldRow.rows[0]?.units ?? 0);

    let gross = 0, firstUnit = 0, lastUnit = 0;
    for (let i = 0; i < input.quantity; i += 1) {
      const price = unitPriceAt(input.itemKey, pressure, sold);
      if (i === 0) firstUnit = price;
      lastUnit = price;
      gross += price;
      sold += 1;
    }

    await client.query(
      `insert into demand_day (realm_id, island_id, item_key, day, units) values ($1,$2,$3,$4,$5)
       on conflict (realm_id, island_id, item_key, day) do update set units = excluded.units`,
      [input.realmId, input.islandId, input.itemKey, day, sold]);

    const moved = clamp(pressure - spec.volatility * Math.sqrt(input.quantity) * .09, PRESSURE_MIN, PRESSURE_MAX);
    await writePressure(client, input.realmId, input.islandId, input.itemKey, moved);

    const contribution = gross * input.contributionWeight;
    const epoch = epochIdFor(at);
    await client.query(
      `insert into contribution_epoch (realm_id, epoch_id, player_id, contribution)
       values ($1,$2,$3,$4)
       on conflict (realm_id, epoch_id, player_id)
       do update set contribution = contribution_epoch.contribution + excluded.contribution`,
      [input.realmId, epoch, input.playerId, contribution]);

    return { gross, firstUnit, lastUnit, pressure: moved, contribution };
  }
}

/** Standalone sale in its own transaction, for callers that are not already in one. */
export async function recordSale(input: SaleInput): Promise<SalePricing> {
  const client = await db().connect();
  try {
    await client.query("begin");
    const result = await applySaleWithin(client, input);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally { client.release(); }
}

/** Buying from the civic supplier pushes the district price up for everyone. */
export interface PurchaseInput { realmId: string; islandId: string; itemKey: string; quantity: number }

export async function applyPurchaseWithin(client: PoolClient, input: PurchaseInput): Promise<{ cost: number; pressure: number }> {
  const spec = RESOURCES[input.itemKey];
  if (!spec) throw new EconomyError("unknown-item", `No such resource: ${input.itemKey}`);
  const pressure = await currentPressure(client, input.realmId, input.islandId, input.itemKey);
  const cost = Math.max(1, Math.round(spec.governmentPrice * pressure)) * input.quantity;
  const moved = clamp(pressure + spec.volatility * Math.sqrt(input.quantity) * .09, PRESSURE_MIN, PRESSURE_MAX);
  await writePressure(client, input.realmId, input.islandId, input.itemKey, moved);
  return { cost, pressure: moved };
}

export async function recordPurchase(input: PurchaseInput): Promise<{ cost: number; pressure: number }> {
  const client = await db().connect();
  try {
    await client.query("begin");
    const result = await applyPurchaseWithin(client, input);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally { client.release(); }
}

export interface EpochStanding {
  epochId: number; mine: number; cohort: number; total: number;
  share: number; projected: number; budget: number; contributors: number;
}

/**
 * The cohort is now the real sum of everyone else's contribution, not a constant. A floor
 * keeps a crowded realm from rounding small contributors down to nothing.
 */
export async function epochStanding(realmId: string, playerId: string, at = Date.now()): Promise<EpochStanding> {
  const epochId = epochIdFor(at);
  const totals = await db().query<{ total: string; contributors: string; mine: string }>(
    `select coalesce(sum(contribution),0) as total,
            count(*) filter (where contribution > 0) as contributors,
            coalesce(sum(contribution) filter (where player_id = $3), 0) as mine
       from contribution_epoch where realm_id = $1 and epoch_id = $2`,
    [realmId, epochId, playerId]);
  const row = totals.rows[0]!;
  const total = Number(row.total);
  const mine = Number(row.mine);
  const budget = await epochBudget(realmId, epochId);
  const share = total > 0 ? mine / total : 0;
  const projected = mine <= 0 ? 0 : Math.max(MIN_EPOCH_PAYOUT, Math.floor(budget * share));
  return { epochId, mine, cohort: total - mine, total, share, projected, budget, contributors: Number(row.contributors) };
}

/**
 * Base budget plus what last epoch's fees contributed.
 *
 * Fees are collected in Maker Dollars and the budget is denominated in $MM, so the
 * contribution has to be converted at the peg. Adding the raw figure over-credited the
 * reward pool by the peg ratio, and applying RESERVE_FUNDING_RATE here as well as at the
 * call site applied it twice.
 */
export async function epochBudget(realmId: string, epochId: number): Promise<number> {
  const funded = await db().query<{ amount: string }>(
    `select coalesce(sum(amount),0) as amount from reserve_funding where realm_id = $1 and epoch_id = $2`,
    [realmId, epochId - 1]);
  const mollars = Number(funded.rows[0]?.amount ?? 0);
  const drawn = await db().query<{ total: string }>(
    `select coalesce(sum(claimed_units),0) as total from contribution_epoch where realm_id = $1`, [realmId]);
  const remaining = Math.max(0, REWARDS_POOL_MM - Number(drawn.rows[0]?.total ?? 0));
  const endowment = Math.max(Math.min(EPOCH_MM_FLOOR, remaining), Math.floor(remaining * EPOCH_EMISSION_RATE));
  return endowment + Math.floor(mollars / MOLLAR_PER_MM);
}

/**
 * Route a share of a fee or tax into the reserve so emission has a source, not just a
 * balance. `amount` is in Maker Dollars; the share is applied here, once.
 */
export async function fundReserve(realmId: string, mollarAmount: number, source: string, at = Date.now()): Promise<void> {
  const contribution = Math.floor(mollarAmount * RESERVE_FUNDING_RATE);
  if (contribution <= 0) return;
  await db().query(
    `insert into reserve_funding (realm_id, epoch_id, amount, source) values ($1,$2,$3,$4)`,
    [realmId, epochIdFor(at), contribution, source]);
}
