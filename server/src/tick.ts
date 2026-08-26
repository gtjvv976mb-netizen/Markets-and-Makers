// The world tick: the authority running the district itself.
//
// Everything else in this server reacts to a player doing something. This is the part
// that happens anyway — production advancing, Mercedonians walking into shops and buying
// what is on the shelf — whether the owner is logged in, asleep, or has never opened the
// game today. It is what makes the world shared rather than fifteen private simulations
// that happen to agree on prices.
//
// The whole loop is built on one rule: it may only move value that already exists.
// Goods come out of the owner's item ledger, money comes out of the citizens' account,
// and both are double-entry moves through market.ts. Nothing here creates a unit of
// either. The database enforces the same thing underneath — currency_account carries a
// `balance >= 0` check — so a bug in this file becomes a failed transaction rather than
// an inflated realm.

import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { pool } from "./database.js";
import { applySaleWithin, EconomyError } from "./economy.js";
import { command, moveCurrency, takeItems, MarketError } from "./market.js";
import { PLOTS_BY_ID } from "./plots.js";
import { TRADES } from "./trades.js";

const REALM = "sunwoven-1";
const TAX_RATE = 0.05;

/**
 * A stable UUID for a tick's ledger commands.
 *
 * The ledger keys idempotency on a uuid column, and the tick's natural key is a sentence
 * — the plot and the window it covers. Hashing that into a v5-shaped uuid keeps both
 * properties: the database gets the type it wants, and the same window always produces
 * the same key, so a pass that runs twice is refused rather than paid twice.
 */
function keyFor(...parts: string[]): string {
  const hex = createHash("sha256").update(parts.join(":")).digest("hex").slice(0, 32);
  const version = `5${hex.slice(13, 16)}`;
  const variant = ((parseInt(hex.slice(16, 17), 16) & 0x3) | 0x8).toString(16) + hex.slice(17, 20);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${version}-${variant}-${hex.slice(20, 32)}`;
}

/**
 * What unattended trade is worth toward the $MM pool.
 *
 * Below the 0.3 a player earns serving the counter in person, above the 0.05 of dumping
 * stock on the city. Markets & Makers is an idle game as well as an active one: a shop
 * that traded all night did work the district needed and is paid for it. What it is not
 * is yield on holding — a plot with nothing built on it ticks to nothing at all, because
 * nothing traded.
 */
export const IDLE_CONTRIBUTION_WEIGHT = 0.18;

/** Customers an hour at a corner scoring 1.0, before appeal. Mirrors the client. */
const VISITS_PER_HOUR = 4;
/** A single pass never settles more than this per business, however long the gap. */
const MAX_VISITS_PER_PASS = 90;
/** Ignore gaps below this: a tick that fires twice in a second should do nothing twice. */
const MIN_ELAPSED_SECONDS = 5;

export interface BusinessTick {
  plotId: string;
  island: string;
  license: string;
  ownerPlayerId: string;
  footfall: number;
  appeal: number;
  elapsedHours: number;
  cyclesProduced: number;
  unitsSold: number;
  gross: number;
  net: number;
}

export interface TickReport {
  businesses: number;
  produced: number;
  sold: number;
  gross: number;
  skipped: number;
  results: BusinessTick[];
}

interface BusinessRow {
  plot_id: string; island_id: string; license: string; owner_player_id: string;
  upgrades: { yield: number; capacity: number; speed: number; appeal: number };
  broken: boolean; elapsed_seconds: string;
}

/** Stock the owner actually holds, as the ledger sees it. */
async function held(client: PoolClient, playerId: string, itemKey: string): Promise<number> {
  const row = await client.query<{ quantity: string }>(
    `select quantity from item_balance
      where realm_id=$1 and owner_type='player' and owner_id=$2 and item_key=$3 for update`,
    [REALM, playerId, itemKey]);
  return Number(row.rows[0]?.quantity ?? 0);
}

/**
 * Advance production for one business.
 *
 * Deterministic from the licence, the upgrades and the time elapsed — which is the whole
 * reason the authority can run it without trusting anybody. A cycle that cannot be paid
 * for in inputs simply does not happen; there is no debt and no partial cycle.
 */
async function produce(
  client: PoolClient, row: BusinessRow, commandId: string, elapsedHours: number,
): Promise<number> {
  const trade = TRADES[row.license];
  if (!trade || trade.durationSeconds <= 0) return 0;

  // Speed shortens a cycle, capacity runs more of them at once. Same curve as the client.
  const seconds = trade.durationSeconds * Math.max(0.25, 1 - row.upgrades.speed * 0.12);
  const parallel = 1 + row.upgrades.capacity;
  const possible = Math.floor((elapsedHours * 3_600) / seconds) * parallel;
  if (possible <= 0) return 0;

  const inputs = Object.entries(trade.inputs);
  let cycles = Math.min(possible, 40);

  // Cut the run to what the shelves can actually feed.
  for (const [itemKey, perCycle] of inputs) {
    if (perCycle <= 0) continue;
    cycles = Math.min(cycles, Math.floor(await held(client, row.owner_player_id, itemKey) / perCycle));
  }
  if (cycles <= 0) return 0;

  for (const [itemKey, perCycle] of inputs) {
    if (perCycle <= 0) continue;
    await takeItems(client, REALM, keyFor(commandId, "in", itemKey), itemKey, perCycle * cycles,
      { type: "player", id: row.owner_player_id }, { type: "government", id: "consumed" }, "tick.produce");
  }

  const qualityBonus = 1 + row.upgrades.yield * 0.12;
  for (const [itemKey, perCycle] of Object.entries(trade.output)) {
    if (perCycle <= 0) continue;
    const made = Math.max(perCycle * cycles, Math.round(perCycle * cycles * qualityBonus));
    await takeItems(client, REALM, keyFor(commandId, "out", itemKey), itemKey, made,
      { type: "government", id: "supply" }, { type: "player", id: row.owner_player_id }, "tick.produce");
  }
  if (trade.wastePerCycle > 0) {
    await takeItems(client, REALM, keyFor(commandId, "waste"), "waste", trade.wastePerCycle * cycles,
      { type: "government", id: "supply" }, { type: "player", id: row.owner_player_id }, "tick.produce");
  }
  return cycles;
}

/**
 * Sell to the Mercedonians who walked in while nobody was watching.
 *
 * Visits are the corner's footfall times the hours elapsed, so where a shop was built is
 * what earns. Pricing goes through applySaleWithin, which means these customers consume
 * the SAME district demand as a player selling by hand — two shops on one street compete
 * for one day's appetite rather than each getting their own.
 */
async function serveCounter(
  client: PoolClient, row: BusinessRow, commandId: string, elapsedHours: number, footfall: number,
): Promise<{ units: number; gross: number; net: number }> {
  const trade = TRADES[row.license];
  if (!trade) return { units: 0, gross: 0, net: 0 };

  const appeal = 1 + row.upgrades.appeal * 0.15;
  const wanted = Math.min(MAX_VISITS_PER_PASS, Math.floor(footfall * VISITS_PER_HOUR * appeal * elapsedHours));
  if (wanted <= 0) return { units: 0, gross: 0, net: 0 };

  // Households buy finished goods. A mine's ore has no counter trade, by design.
  const itemKey = trade.retailItems[0];
  if (!itemKey) return { units: 0, gross: 0, net: 0 };

  const stock = await held(client, row.owner_player_id, itemKey);
  const units = Math.min(wanted, stock);
  if (units <= 0) return { units: 0, gross: 0, net: 0 };

  const priced = await applySaleWithin(client, {
    realmId: REALM, islandId: row.island_id, itemKey, quantity: units,
    playerId: row.owner_player_id, contributionWeight: IDLE_CONTRIBUTION_WEIGHT,
  });
  const tax = Math.floor(priced.gross * TAX_RATE);
  const net = priced.gross - tax;

  await takeItems(client, REALM, keyFor(commandId, "sell"), itemKey, units,
    { type: "player", id: row.owner_player_id }, { type: "government", id: "consumed" }, "tick.counter");
  // The citizens' account is finite and checked non-negative by the column itself, so a
  // district that has spent its money simply stops buying until payroll refills it.
  await moveCurrency(client, REALM, keyFor(commandId, "pay"), net,
    { type: "player", id: "citizens" }, { type: "player", id: row.owner_player_id }, "tick.counter");
  if (tax > 0) {
    await moveCurrency(client, REALM, keyFor(commandId, "tax"), tax,
      { type: "player", id: "citizens" }, { type: "government", id: "treasury" }, "tick.counter");
  }
  return { units, gross: priced.gross, net };
}

/**
 * Run one pass over every business in the realm.
 *
 * Each business settles in its own transaction under its own idempotency key, so one
 * shop failing — an empty citizens' account, a bad recipe — cannot roll back the street.
 */
export async function runWorldTick(now = Date.now()): Promise<TickReport> {
  const report: TickReport = { businesses: 0, produced: 0, sold: 0, gross: 0, skipped: 0, results: [] };
  if (!pool) return report;

  const due = await pool.query<BusinessRow>(
    `select b.plot_id, p.island_id, b.license, b.owner_player_id, b.upgrades,
            (b.condition <= 0) as broken,
            extract(epoch from (now() - b.last_tick_at))::text as elapsed_seconds
       from business b join plot p on p.id = b.plot_id
      where p.realm_id = $1
      order by b.last_tick_at asc
      limit 500`,
    [REALM]);

  for (const row of due.rows) {
    const elapsedSeconds = Number(row.elapsed_seconds);
    if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < MIN_ELAPSED_SECONDS || row.broken) {
      report.skipped += 1;
      continue;
    }
    const elapsedHours = Math.min(26, elapsedSeconds / 3_600);
    const footfall = PLOTS_BY_ID.get(row.plot_id)?.footfall ?? 0;
    // The key is the plot and the window it covers, so a pass that runs twice over the
    // same window is refused by the ledger rather than paying twice.
    const window = `tick:${row.plot_id}:${Math.floor(now / 1000)}`;
    const commandId = keyFor(window);

    try {
      const settled = await command(commandId, "world.tick", row.owner_player_id, async (client) => {
        const cycles = await produce(client, row, window, elapsedHours);
        const counter = await serveCounter(client, row, window, elapsedHours, footfall);
        await client.query("update business set last_tick_at = now() where plot_id = $1", [row.plot_id]);
        return { cycles, counter };
      });

      report.businesses += 1;
      report.produced += settled.cycles;
      report.sold += settled.counter.units;
      report.gross += settled.counter.gross;
      report.results.push({
        plotId: row.plot_id, island: row.island_id, license: row.license,
        ownerPlayerId: row.owner_player_id, footfall,
        appeal: row.upgrades.appeal, elapsedHours,
        cyclesProduced: settled.cycles, unitsSold: settled.counter.units,
        gross: settled.counter.gross, net: settled.counter.net,
      });
    } catch (error) {
      // One shop's problem is not the street's. Move the clock on anyway, or a business
      // that always fails would accumulate elapsed time and eventually settle a huge pass.
      report.skipped += 1;
      console.error(`tick: ${row.plot_id} failed`, error);
      await pool.query("update business set last_tick_at = now() where plot_id = $1", [row.plot_id]);
    }
  }

  return report;
}
