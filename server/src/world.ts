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

import type { PoolClient } from "pg";
import { pool } from "./database.js";
import { ISLAND_IDS, PLOTS, PLOTS_BY_ID, type PlotSpec } from "./plots.js";
import { TRADES } from "./trades.js";

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
/** Cycles' worth of inputs handed over so a new business can start turning. */
const STARTER_CYCLES = 12;

/** Clamp anything a client sends before it reaches a column. */
function sanitiseUpgrades(raw: unknown): BusinessUpsert["upgrades"] {
  const source = (raw ?? {}) as Record<string, unknown>;
  const out = { yield: 0, capacity: 0, speed: 0, appeal: 0 };
  for (const key of UPGRADE_KEYS) {
    const value = Math.floor(Number(source[key] ?? 0));
    out[key] = Number.isFinite(value) ? Math.min(10, Math.max(0, value)) : 0;
  }
  return out;
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

    await client.query(
      `insert into business (plot_id, owner_player_id, license, condition, upgrades, revision, updated_at)
       values ($1, $2, $3, $4, $5::jsonb, 1, now())
       on conflict (plot_id) do update
         set license = excluded.license,
             condition = excluded.condition,
             upgrades = excluded.upgrades,
             revision = business.revision + 1,
             updated_at = now()`,
      [input.plotId, input.playerId, input.license, condition, JSON.stringify(upgrades)],
    );
    await client.query(
      "update plot set owner_player_id = $2, license = $3, updated_at = now() where id = $1",
      [input.plotId, input.playerId, input.license],
    );

    // A maker who has never traded in the shared world has no account and no shelves, so
    // the authority's tick would find an empty business and do nothing forever. Both are
    // granted once, on the first registration, and never topped up: `do nothing` on
    // conflict is what keeps re-licensing from being a way to print an advance.
    await client.query(
      `insert into currency_account (realm_id, owner_type, owner_id, currency_code, balance)
       values ($1, 'player', $2, 'MERCS', $3)
       on conflict (realm_id, owner_type, owner_id, currency_code) do nothing`,
      [input.realmId, input.playerId, FOUNDERS_ADVANCE],
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
