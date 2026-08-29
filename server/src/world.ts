// The world the server owns.
//
// Until now the authority knew about money and knew where players were standing, but it
// did not know that a single business existed: `business` and `plot` were declared in the
// schema and never written to. That is why every browser ran its own private district —
// nobody could see anyone else's shop, and nothing could tick while its owner was away.
//
// This is the registry that fixes that. It is deliberately only the registry: it records
// what has been built and where, and answers "what is in this district". Settling trade
// against it is the next stage and lives elsewhere, so that a bug here cannot move money.

import { createHash } from "node:crypto";
import { FITTINGS, tileIsBuildable } from "./floor.js";
import type { PoolClient } from "pg";
import { pool } from "./database.js";
import { ISLAND_IDS, PLOTS, PLOTS_BY_ID, type PlotSpec } from "./plots.js";
import { TRADES } from "./trades.js";
import { MarketError, moveCurrency } from "./market.js";

/** A stable command id, so a retried registration settles once rather than twice. */
function keyFor(...parts: string[]): string {
  return createHash("sha1").update(parts.join(":")).digest("hex").slice(0, 32)
    .replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5");
}

export class WorldError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "WorldError";
  }
}

export interface BusinessUpsert {
  realmId: string;
  playerId: string;
  plotId: string;
  license: string;
  condition: number;
  upgrades: { yield: number; capacity: number; speed: number; appeal: number };
  /** Raw equipment layout. Multipliers are DERIVED here, never accepted from a client. */
  floor?: unknown;
}

export interface DistrictBusiness {
  plotId: string;
  island: string;
  license: string;
  condition: number;
  upgrades: { yield: number; capacity: number; speed: number; appeal: number };
  footfall: number;
  /** Truncated owner wallet, so a district can show who built what without leaking one. */
  owner: string;
  mine: boolean;
  updatedAt: string;
}

const UPGRADE_KEYS = ["yield", "capacity", "speed", "appeal"] as const;

/** What a maker opens with, matching the client's own starting wallet. */
export const FOUNDERS_ADVANCE = 750;

/**
 * The most the realm will advance to new makers in any 24 hours.
 *
 * Identities are free — sign-in needs only an off-chain signature — so the per-player
 * "once, never topped up" rule bounds nothing on its own: a thousand wallets is a thousand
 * advances. This caps the realm's exposure to a day's worth while leaving genuine new
 * players unaffected, and the advance now comes OUT of the treasury, so the treasury floor
 * is a second bound underneath it.
 */
export const ADVANCE_DAILY_CAP = 20 * FOUNDERS_ADVANCE;

/**
 * Equipment levels the authority will recognise, and what each one costs.
 *
 * Mirrors the client's UPGRADE_COSTS. The server used to clamp to 0..10 and accept
 * whatever a client asserted inside that — while the tick pays out on those very numbers:
 * capacity multiplies parallel cycles, speed shortens them, yield adds 12% each. Level 10
 * across the board is roughly eleven times the throughput at more than double the quality,
 * for nothing, settled by the authority. The client's own table stops at 4.
 */
export const UPGRADE_COST_MERCS = [0, 70, 150, 280, 520] as const;
export const MAX_UPGRADE_LEVEL = UPGRADE_COST_MERCS.length - 1;
/** Cycles' worth of inputs handed over so a new business can start turning. */
const STARTER_CYCLES = 12;

/** Clamp anything a client sends before it reaches a column. */
function sanitiseUpgrades(raw: unknown): BusinessUpsert["upgrades"] {
  const source = (raw ?? {}) as Record<string, unknown>;
  const out = { yield: 0, capacity: 0, speed: 0, appeal: 0 };
  for (const key of UPGRADE_KEYS) {
    const value = Math.floor(Number(source[key] ?? 0));
    out[key] = Number.isFinite(value) ? Math.min(MAX_UPGRADE_LEVEL, Math.max(0, value)) : 0;
  }
  return out;
}

/**
 * Clamp a floor layout a client sent before it reaches a column.
 *
 * Only tiles, facings and fitting positions are kept — never a multiplier. A client that sends
 * its own "output: 4.2" is sending money, so the shape simply has nowhere to put one. Every
 * coordinate is bounds-checked and every facing must be one of the four; anything else is
 * dropped rather than corrected, so a malformed floor is a bare floor and never a crash in the
 * tick that has to price it.
 */
function sanitiseFloor(raw: unknown): { tiles: Record<string, { column: number; row: number }>;
                                        facings: Record<string, string>;
                                        fittings: Record<string, { column: number; row: number }> } {
  const source = (raw ?? {}) as Record<string, unknown>;
  const tile = (value: unknown): { column: number; row: number } | null => {
    const entry = (value ?? {}) as Record<string, unknown>;
    const column = Math.floor(Number(entry.column));
    const row = Math.floor(Number(entry.row));
    if (!Number.isFinite(column) || !Number.isFinite(row)) return null;
    if (!tileIsBuildable(column, row)) return null;
    return { column, row };
  };
  const tiles: Record<string, { column: number; row: number }> = {};
  const facings: Record<string, string> = {};
  const fittings: Record<string, { column: number; row: number }> = {};
  const rawTiles = (source.tiles ?? {}) as Record<string, unknown>;
  const rawFacings = (source.facings ?? {}) as Record<string, unknown>;
  const rawFittings = (source.fittings ?? {}) as Record<string, unknown>;
  const taken = new Set<string>();
  for (const key of UPGRADE_KEYS) {
    const spot = tile(rawTiles[key]);
    if (spot && !taken.has(`${spot.column}:${spot.row}`)) {
      tiles[key] = spot;
      taken.add(`${spot.column}:${spot.row}`);
    }
    const facing = rawFacings[key];
    if (typeof facing === "string" && ["N", "E", "S", "W"].includes(facing)) facings[key] = facing;
  }
  for (const key of Object.keys(FITTINGS)) {
    const spot = tile(rawFittings[key]);
    if (spot && !taken.has(`${spot.column}:${spot.row}`)) {
      fittings[key] = spot;
      taken.add(`${spot.column}:${spot.row}`);
    }
  }
  return { tiles, facings, fittings };
}

/**
 * Put the world's plots in the database.
 *
 * Generated from the client's own layout by scripts/export-plots.ts, so the two cannot
 * drift silently. Idempotent: safe on every boot, and the only thing that changes on a
 * re-run is a plot moving district, which the layout never does.
 */
export async function seedPlots(realmId: string): Promise<number> {
  if (!pool) return 0;
  const ids = PLOTS.map((plot) => plot.id);
  const islands = PLOTS.map((plot) => plot.island);
  const result = await pool.query(
    `insert into plot (id, realm_id, island_id)
     select unnest($2::text[]), $1, unnest($3::text[])
     on conflict (id) do update set island_id = excluded.island_id`,
    [realmId, ids, islands],
  );
  return result.rowCount ?? 0;
}

/** Every district the world has plots in. */
export function districts(): readonly string[] {
  return ISLAND_IDS;
}

export function plotSpec(plotId: string): PlotSpec | undefined {
  return PLOTS_BY_ID.get(plotId);
}

/**
 * Record that a player has built, re-licensed or upgraded a business.
 *
 * A plot holds at most one business — the schema says so with a unique constraint — and
 * the owner is whoever first claimed it. A second player upserting the same plot is
 * refused rather than silently taking it, because the alternative is one player deleting
 * another's shop by walking onto it.
 */
export async function registerBusiness(input: BusinessUpsert): Promise<DistrictBusiness> {
  if (!pool) throw new WorldError("database-unavailable", "The realm database is not configured.");
  const spec = PLOTS_BY_ID.get(input.plotId);
  if (!spec) throw new WorldError("unknown-plot", `No plot named ${input.plotId} exists in this world.`);
  if (!input.license) throw new WorldError("license-required", "A business needs a licence.");

  const upgrades = sanitiseUpgrades(input.upgrades);
  const condition = Math.min(100, Math.max(0, Math.floor(Number(input.condition) || 0)));
  const floor = sanitiseFloor(input.floor);

  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(
      `insert into plot (id, realm_id, island_id) values ($1, $2, $3)
       on conflict (id) do nothing`,
      [input.plotId, input.realmId, spec.island],
    );

    const held = await client.query<{ owner_player_id: string }>(
      "select owner_player_id from business where plot_id = $1 for update",
      [input.plotId],
    );
    if (held.rowCount && held.rows[0]!.owner_player_id !== input.playerId) {
      throw new WorldError("plot-taken", "Another maker already holds that plot.");
    }

    // What the authority already recognises for this plot, read BEFORE the upsert
    // overwrites it. The tick settles real output against these numbers.
    const standing = await client.query<{ upgrades: BusinessUpsert["upgrades"]; floor: { fittings?: Record<string, unknown> } | null }>(
      "select upgrades, floor from business where plot_id = $1", [input.plotId]);

    // A maker who has never traded in the shared world has no account and no shelves, so
    // the authority's tick would find an empty business and do nothing forever. Both are
    // granted once, on the first registration, and never topped up.
    //
    // The advance is MOVED from the treasury, never minted.
    //
    // It used to be an insert with no debit and no ledger row — every new wallet added 750
    // MERCS to the money supply out of nothing, which is the one thing this economy claims
    // it never does. With free identities that is an unbounded mint, and it would have
    // falsified the conservation property on the very first sybil.
    //
    // Now it is a transfer, so it appears in the ledger, it is bounded by what the treasury
    // holds, and the realm's daily cap bounds it again.
    const existing = await client.query(
      `select 1 from currency_account
        where realm_id=$1 and owner_type='player' and owner_id=$2 and currency_code='MERCS'`,
      [input.realmId, input.playerId]);
    if (!existing.rowCount) {
      const advancedToday = await client.query<{ total: string }>(
        `select coalesce(sum(amount),0) as total from currency_ledger
          where realm_id=$1 and reason='world.advance' and created_at > now() - interval '24 hours'`,
        [input.realmId]);
      if (Number(advancedToday.rows[0]!.total) + FOUNDERS_ADVANCE > ADVANCE_DAILY_CAP) {
        throw new WorldError("advance-exhausted",
          "The city has advanced all it can to new makers today. Try again tomorrow.");
      }
      await client.query(
        `insert into currency_account (realm_id, owner_type, owner_id, currency_code, balance)
         values ($1, 'player', $2, 'MERCS', 0)
         on conflict (realm_id, owner_type, owner_id, currency_code) do nothing`,
        [input.realmId, input.playerId]);
      // Best effort, deliberately. The advance is a courtesy from a solvent city, not a
      // precondition for joining one: refusing to register a business because the treasury
      // is thin would turn a bad week for Mercedonia into a closed door for every new
      // player, which is the worst possible moment to lose them. They open at zero and
      // trade their way up instead.
      try {
        await moveCurrency(client, input.realmId, keyFor("advance", input.playerId), FOUNDERS_ADVANCE,
          { type: "government", id: "treasury" }, { type: "player", id: input.playerId }, "world.advance");
      } catch (error) {
        if (!(error instanceof MarketError)) throw error;
      }
    }
    // Equipment, priced. This runs AFTER the advance so a new maker can spend it, and
    // after the ownership check so it can never charge someone for another's plot.
    //
    // A business that did not exist a moment ago opens at level 0 — nobody is born with
    // equipment, and pinning it here means the very first registration cannot assert its
    // way to eleven times the throughput. Everything above 0 is bought, one level at a
    // time, out of the maker's own balance and into the treasury through the ledger.
    const priorUpgrades = standing.rows[0]?.upgrades;
    if (!priorUpgrades) {
      for (const key of UPGRADE_KEYS) upgrades[key] = 0;
    } else {
      let owed = 0;
      for (const key of UPGRADE_KEYS) {
        const from = Math.min(MAX_UPGRADE_LEVEL, Math.max(0, Math.floor(Number(priorUpgrades[key] ?? 0))));
        for (let level = from + 1; level <= upgrades[key]; level += 1) owed += UPGRADE_COST_MERCS[level] ?? 0;
        // Reporting a level BELOW what is held is allowed and not refunded: a client that
        // has fallen behind may send an older state without paying to catch up.
        if (upgrades[key] < from) upgrades[key] = from;
      }
      if (owed > 0) {
        // Insufficient funds throws, rolling the whole registration back — an upgrade
        // nobody paid for is never recorded.
        await moveCurrency(client, input.realmId, keyFor("upgrade", input.plotId, String(upgrades.yield),
          String(upgrades.capacity), String(upgrades.speed), String(upgrades.appeal)), owed,
          { type: "player", id: input.playerId }, { type: "government", id: "treasury" }, "business.upgrade");
      }
    }

    // Fittings are PURCHASES, and the authority had no record of them: sanitiseFloor checked
    // where one stood and never whether it had been bought. Once the route forwards a floor
    // that is 1,700 $MM of multipliers for the asking. Charged here on exactly the pattern
    // the upgrade ladder above uses — the difference against what was already recorded, paid
    // through the ledger, insufficient funds throwing and rolling the registration back.
    const priorFloor = (standing.rows[0] as { floor?: { fittings?: Record<string, unknown> } } | undefined)?.floor;
    const alreadyHeld = new Set(Object.keys(priorFloor?.fittings ?? {}));
    let fittingsOwed = 0;
    const bought: string[] = [];
    for (const key of Object.keys(floor.fittings)) {
      if (alreadyHeld.has(key)) continue;
      fittingsOwed += FITTINGS[key as keyof typeof FITTINGS]?.cost ?? 0;
      bought.push(key);
    }
    if (fittingsOwed > 0) {
      await moveCurrency(client, input.realmId, keyFor("fitting", input.plotId, ...bought.sort()),
        fittingsOwed, { type: "player", id: input.playerId },
        { type: "government", id: "treasury" }, "business.fitting");
    }

    await client.query(
      `insert into business (plot_id, owner_player_id, license, condition, upgrades, floor, revision, updated_at)
       values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, 1, now())
       on conflict (plot_id) do update
         set license = excluded.license,
             condition = excluded.condition,
             upgrades = excluded.upgrades,
             floor = excluded.floor,
             revision = business.revision + 1,
             updated_at = now()`,
      [input.plotId, input.playerId, input.license, condition, JSON.stringify(upgrades), JSON.stringify(floor)],
    );
    await client.query(
      "update plot set owner_player_id = $2, license = $3, updated_at = now() where id = $1",
      [input.plotId, input.playerId, input.license],
    );

    const trade = TRADES[input.license];
    if (trade) {
      for (const [itemKey, perCycle] of Object.entries(trade.inputs)) {
        if (perCycle <= 0) continue;
        await client.query(
          `insert into item_balance (realm_id, owner_type, owner_id, item_key, quantity)
           values ($1, 'player', $2, $3, $4)
           on conflict (realm_id, owner_type, owner_id, item_key) do nothing`,
          [input.realmId, input.playerId, itemKey, perCycle * STARTER_CYCLES],
        );
      }
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }

  const listed = await districtBusinesses(input.realmId, spec.island, input.playerId);
  const mine = listed.find((entry) => entry.plotId === input.plotId);
  if (!mine) throw new WorldError("register-failed", "The business was not recorded.");
  return mine;
}

/** Release a plot the player holds, so it can be leased by someone else. */
export async function releaseBusiness(playerId: string, plotId: string): Promise<boolean> {
  if (!pool) return false;
  const result = await pool.query(
    "delete from business where plot_id = $1 and owner_player_id = $2",
    [plotId, playerId],
  );
  if (result.rowCount) {
    await pool.query("update plot set owner_player_id = null, license = null, updated_at = now() where id = $1", [plotId]);
  }
  return (result.rowCount ?? 0) > 0;
}

/**
 * Everything built in one district.
 *
 * This is the answer to "why can I not see anyone else's shop": nothing ever asked. The
 * wallet is truncated to its ends — enough to tell two neighbours apart, not enough to
 * publish an address the owner did not choose to share.
 */
export async function districtBusinesses(
  realmId: string,
  islandId: string,
  viewerPlayerId?: string,
): Promise<DistrictBusiness[]> {
  if (!pool) return [];
  const result = await pool.query<{
    plot_id: string; island_id: string; license: string; condition: number;
    upgrades: BusinessUpsert["upgrades"]; owner_player_id: string;
    wallet_address: string | null; updated_at: Date;
  }>(
    `select b.plot_id, p.island_id, b.license, b.condition, b.upgrades,
            b.owner_player_id, pl.wallet_address, b.updated_at
       from business b
       join plot p on p.id = b.plot_id
       left join player pl on pl.id = b.owner_player_id
      where p.realm_id = $1 and p.island_id = $2
      order by b.updated_at desc
      limit 500`,
    [realmId, islandId],
  );

  return result.rows.map((row) => {
    const wallet = row.wallet_address ?? "";
    return {
      plotId: row.plot_id,
      island: row.island_id,
      license: row.license,
      condition: row.condition,
      upgrades: sanitiseUpgrades(row.upgrades),
      footfall: PLOTS_BY_ID.get(row.plot_id)?.footfall ?? 0,
      owner: wallet ? `${wallet.slice(0, 4)}…${wallet.slice(-4)}` : "unclaimed",
      mine: viewerPlayerId !== undefined && row.owner_player_id === viewerPlayerId,
      updatedAt: row.updated_at.toISOString(),
    };
  });
}

/** Businesses the tick loop should run, across the whole realm. */
export async function allBusinesses(realmId: string, client?: PoolClient): Promise<DistrictBusiness[]> {
  const runner = client ?? pool;
  if (!runner) return [];
  const result = await runner.query<{
    plot_id: string; island_id: string; license: string; condition: number;
    upgrades: BusinessUpsert["upgrades"]; owner_player_id: string; updated_at: Date;
  }>(
    `select b.plot_id, p.island_id, b.license, b.condition, b.upgrades, b.owner_player_id, b.updated_at
       from business b join plot p on p.id = b.plot_id
      where p.realm_id = $1`,
    [realmId],
  );
  return result.rows.map((row) => ({
    plotId: row.plot_id,
    island: row.island_id,
    license: row.license,
    condition: row.condition,
    upgrades: sanitiseUpgrades(row.upgrades),
    footfall: PLOTS_BY_ID.get(row.plot_id)?.footfall ?? 0,
    owner: row.owner_player_id,
    mine: false,
    updatedAt: row.updated_at.toISOString(),
  }));
}

export interface MakerHoldings {
  wallet: number;
  inventory: Record<string, number>;
  businesses: DistrictBusiness[];
}

/**
 * What a maker actually owns, according to the ledger.
 *
 * The client keeps its own copy of the purse and the shelves in localStorage, which was
 * fine while every browser ran a private world. Once the authority is ticking, that copy
 * is a cache of something it does not own: the server has been buying inputs, making
 * goods and selling them while the tab was shut. This is the truth to reconcile against.
 */
export async function makerHoldings(realmId: string, playerId: string): Promise<MakerHoldings> {
  if (!pool) return { wallet: 0, inventory: {}, businesses: [] };

  const [money, goods, owned] = await Promise.all([
    pool.query<{ balance: string }>(
      `select balance from currency_account
        where realm_id=$1 and owner_type='player' and owner_id=$2 and currency_code='MERCS'`,
      [realmId, playerId]),
    pool.query<{ item_key: string; quantity: string }>(
      `select item_key, quantity from item_balance
        where realm_id=$1 and owner_type='player' and owner_id=$2 and quantity > 0`,
      [realmId, playerId]),
    pool.query<{ plot_id: string; island_id: string }>(
      `select b.plot_id, p.island_id from business b join plot p on p.id = b.plot_id
        where p.realm_id=$1 and b.owner_player_id=$2`,
      [realmId, playerId]),
  ]);

  const inventory: Record<string, number> = {};
  for (const row of goods.rows) inventory[row.item_key] = Number(row.quantity);

  const businesses: DistrictBusiness[] = [];
  for (const island of new Set(owned.rows.map((row) => row.island_id))) {
    const listed = await districtBusinesses(realmId, island, playerId);
    businesses.push(...listed.filter((entry) => entry.mine));
  }

  return { wallet: Number(money.rows[0]?.balance ?? 0), inventory, businesses };
}
