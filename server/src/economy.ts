import type { PoolClient } from "pg";
import { pool } from "./database.js";
import {
  CITIZEN_DEMAND_BUDGET, CIVIC_DEMAND_BUDGET, DEMAND_PRICE_FLOOR, DEMAND_TIER_WEIGHT, DEMAND_TRANCHE_DECAY,
  DISTRICT_TRADER_BASELINE, EPOCH_EMISSION_RATE, EPOCH_MM_FLOOR, REWARDS_POOL_MM, MEAN_REVERSION_CAP, MEAN_REVERSION_PER_MINUTE, MIN_EPOCH_PAYOUT,
  CHAIN_CYCLES_PER_DAY, CHAIN_PREMIUM_MAX, DEPTH_PRICE_IMPACT, DISTRICT_BASE_TRADES, DISTRICT_NEIGHBOUR_WEIGHT,
  CURRENCY_CODE, MERC_DOLLARS_PER_MM, PRESSURE_MAX, PRESSURE_MIN, RESERVE_FUNDING_RATE, RESOURCES, clamp, epochIdFor, utcDay,
} from "./catalogue.js";
import { TRADES } from "./trades.js";

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
  currencyCode: typeof CURRENCY_CODE;
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

/**
 * Units of each good the district's own trades consume as INPUTS, per cycle.
 *
 * Summed from the generated recipe table rather than typed out, so it cannot drift from
 * what the trades actually consume. Households and the civic buyer are not the only
 * customers: a shop burns two food a cycle, a cratemill two timber, a workshop two ore.
 * Without this the supply chain existed in the recipes and nowhere in the market, and a
 * primary producer's only buyer was a civic budget that saturated in a morning.
 */
const CHAIN_DRAW: Record<string, number> = (() => {
  const draw: Record<string, number> = {};
  for (const key of Object.keys(RESOURCES)) draw[key] = 0;
  for (const trade of Object.values(TRADES)) {
    for (const [key, perCycle] of Object.entries(trade.inputs)) draw[key] = (draw[key] ?? 0) + perCycle;
  }
  return draw;
})();

/**
 * Derived demand: what the district's businesses want, as opposed to its households.
 *
 * CHAIN_DRAW is one of every trade. A district running DISTRICT_TRADER_BASELINE businesses
 * is that fraction of a full chain, which keeps this honest about the size of the place
 * rather than assuming a city.
 */
export function derivedDemand(itemKey: string, neighbours = 0): number {
  const draw = CHAIN_DRAW[itemKey] ?? 0;
  if (draw <= 0) return 0;
  const trades = DISTRICT_BASE_TRADES + Math.max(0, neighbours) * DISTRICT_NEIGHBOUR_WEIGHT;
  return draw * CHAIN_CYCLES_PER_DAY * trades;
}

/**
 * How many businesses are trading in a district.
 *
 * Read once per settlement and threaded through the pricing, never per unit priced — a
 * query inside the price loop would run eleven times for one board and once per unit for
 * a big sale.
 */
export async function countDistrictBusinesses(
  client: PoolClient, realmId: string, islandId: string,
): Promise<number> {
  const row = await client.query<{ n: string }>(
    `select count(*)::int as n from business b
       join plot p on p.id = b.plot_id
      where p.realm_id = $1 and p.island_id = $2`,
    [realmId, islandId]);
  return Number(row.rows[0]?.n ?? 0);
}

/** The whole district shares one daily allowance, sized for a population of traders. */
export function districtQuota(itemKey: string, neighbours = 0): number {
  const spec = RESOURCES[itemKey];
  if (!spec) throw new EconomyError("unknown-item", `No such resource: ${itemKey}`);
  const budget = (spec.buyer === "citizens" ? CITIZEN_DEMAND_BUDGET : CIVIC_DEMAND_BUDGET)
    * DEMAND_TIER_WEIGHT[spec.tier] * DISTRICT_TRADER_BASELINE;
  return Math.max(8, Math.round(budget / spec.procurementPrice + derivedDemand(itemKey, neighbours)));
}

/** What a good is worth here because the district's own businesses want it. */
export function chainPremium(itemKey: string, neighbours = 0): number {
  const total = Math.max(1, districtQuota(itemKey, neighbours));
  return 1 + Math.min(1, derivedDemand(itemKey, neighbours) / total) * CHAIN_PREMIUM_MAX;
}

/** The price of one more unit at a given pressure and day's sales. Exported to be tested. */
export function unitPriceAt(itemKey: string, pressure: number, soldSoFar: number, neighbours = 0): number {
  const spec = RESOURCES[itemKey]!;
  const quota = districtQuota(itemKey, neighbours);
  const tranche = Math.floor(soldSoFar / quota);
  const decay = Math.max(DEMAND_PRICE_FLOOR, Math.pow(DEMAND_TRANCHE_DECAY, tranche));
  const asked = Math.round(spec.procurementPrice * pressure * decay * chainPremium(itemKey, neighbours));
  // The civic supplier must never sell a good for less than the district pays for it, or
  // buying at the counter and selling it straight back is free money.
  const ceiling = Math.max(1, Math.round(spec.governmentPrice * pressure) - 1);
  return Math.max(1, Math.min(ceiling, asked));
}

async function quoteWithin(
  client: PoolClient, realmId: string, islandId: string, itemKey: string, neighbours: number,
): Promise<Quote> {
  const spec = RESOURCES[itemKey];
  if (!spec) throw new EconomyError("unknown-item", `No such resource: ${itemKey}`);
  const pressure = await currentPressure(client, realmId, islandId, itemKey);
  const sold = await client.query<{ units: string }>(
    `select units from demand_day where realm_id=$1 and island_id=$2 and item_key=$3 and day=$4`,
    [realmId, islandId, itemKey, utcDay()]);
  const soldToday = Number(sold.rows[0]?.units ?? 0);
  return {
    itemKey, islandId, pressure: Number(pressure.toFixed(4)),
    buy: Math.max(1, Math.round(spec.governmentPrice * pressure)),
    sell: unitPriceAt(itemKey, pressure, 0, neighbours),
    soldToday, districtQuota: districtQuota(itemKey, neighbours),
    nextUnit: unitPriceAt(itemKey, pressure, soldToday, neighbours), currencyCode: CURRENCY_CODE,
  };
}

export async function quote(realmId: string, islandId: string, itemKey: string): Promise<Quote> {
  const client = await db().connect();
  try {
    const neighbours = await countDistrictBusinesses(client, realmId, islandId);
    return await quoteWithin(client, realmId, islandId, itemKey, neighbours);
  } finally { client.release(); }
}

/**
 * The whole board on ONE connection.
 *
 * This used to call quote() per resource, which took a connection out of the pool for each
 * of the eleven goods and counted the district eleven times. On a starter plan that is a
 * good way to exhaust the pool from a single player opening the trade screen.
 */
export async function islandBoard(realmId: string, islandId: string): Promise<Quote[]> {
  const client = await db().connect();
  try {
    const neighbours = await countDistrictBusinesses(client, realmId, islandId);
    const board: Quote[] = [];
    for (const key of Object.keys(RESOURCES)) {
      board.push(await quoteWithin(client, realmId, islandId, key, neighbours));
    }
    return board;
  } finally { client.release(); }
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
    // One read for the whole settlement; the district does not change mid-sale.
    const neighbours = await countDistrictBusinesses(client, input.realmId, input.islandId);
    const day = utcDay(at);
    const soldRow = await client.query<{ units: string }>(
      `select units from demand_day
        where realm_id=$1 and island_id=$2 and item_key=$3 and day=$4 for update`,
      [input.realmId, input.islandId, input.itemKey, day]);
    let sold = Number(soldRow.rows[0]?.units ?? 0);

    let gross = 0, firstUnit = 0, lastUnit = 0;
    for (let i = 0; i < input.quantity; i += 1) {
      const price = unitPriceAt(input.itemKey, pressure, sold, neighbours);
      if (i === 0) firstUnit = price;
      lastUnit = price;
      gross += price;
      sold += 1;
    }

    await client.query(
      `insert into demand_day (realm_id, island_id, item_key, day, units) values ($1,$2,$3,$4,$5)
       on conflict (realm_id, island_id, item_key, day) do update set units = excluded.units`,
      [input.realmId, input.islandId, input.itemKey, day, sold]);

    // Impact is the size of the trade relative to the DEPTH of the market, not an absolute
    // step. See DEPTH_PRICE_IMPACT: the absolute version let one ordinary day of production
    // drive a maker's own goods to the clamp and kept them there.
    const depth = Math.max(1, districtQuota(input.itemKey, neighbours));
    const impact = Math.sqrt(Math.min(1, input.quantity / depth));
    const moved = clamp(pressure - spec.volatility * impact * DEPTH_PRICE_IMPACT, PRESSURE_MIN, PRESSURE_MAX);
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
  // Same depth scaling as the sale side; an asymmetric impact would let a buy-then-sell
  // round trip ratchet the price in one direction.
  const neighbours = await countDistrictBusinesses(client, input.realmId, input.islandId);
  const depth = Math.max(1, districtQuota(input.itemKey, neighbours));
  const impact = Math.sqrt(Math.min(1, input.quantity / depth));
  const moved = clamp(pressure + spec.volatility * impact * DEPTH_PRICE_IMPACT, PRESSURE_MIN, PRESSURE_MAX);
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
 * Fees are collected in Merc Dollars and the budget is denominated in $MM, so the
 * contribution has to be converted at the peg. Adding the raw figure over-credited the
 * reward pool by the peg ratio, and applying RESERVE_FUNDING_RATE here as well as at the
 * call site applied it twice.
 */
export async function epochBudget(realmId: string, epochId: number): Promise<number> {
  const funded = await db().query<{ amount: string }>(
    `select coalesce(sum(amount),0) as amount from reserve_funding where realm_id = $1 and epoch_id = $2`,
    [realmId, epochId - 1]);
  const mercDollars = Number(funded.rows[0]?.amount ?? 0);
  const drawn = await db().query<{ total: string }>(
    `select coalesce(sum(claimed_units),0) as total from contribution_epoch where realm_id = $1`, [realmId]);
  const remaining = Math.max(0, REWARDS_POOL_MM - Number(drawn.rows[0]?.total ?? 0));
  const endowment = Math.max(Math.min(EPOCH_MM_FLOOR, remaining), Math.floor(remaining * EPOCH_EMISSION_RATE));
  return endowment + Math.floor(mercDollars / MERC_DOLLARS_PER_MM);
}

/**
 * Route a share of a fee or tax into the reserve so emission has a source, not just a
 * balance. `amount` is in Merc Dollars; the share is applied here, once.
 */
export async function fundReserve(realmId: string, mercDollarAmount: number, source: string, at = Date.now()): Promise<void> {
  const contribution = Math.floor(mercDollarAmount * RESERVE_FUNDING_RATE);
  if (contribution <= 0) return;
  await db().query(
    `insert into reserve_funding (realm_id, epoch_id, amount, source) values ($1,$2,$3,$4)`,
    [realmId, epochIdFor(at), contribution, source]);
}
