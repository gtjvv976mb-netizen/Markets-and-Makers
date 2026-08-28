// The three remaining launch-audit holes, and the shape of the fixes.
//
// All three share a root: the authority accepted, without charge or proof, things it then
// paid out on. A free identity got minted money; an asserted upgrade level multiplied real
// server-settled output; and the one entry point with no authentication was also the one
// with no throttle.

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { pool, closeDatabase } from "../src/database.js";
import { registerBusiness, FOUNDERS_ADVANCE, ADVANCE_DAILY_CAP, MAX_UPGRADE_LEVEL, UPGRADE_COST_MERCS } from "../src/world.js";
import { PLOTS } from "../src/plots.js";
import { live as liveDatabase } from "./live-database.js";

const suite = liveDatabase ? describe : describe.skip;
const REALM = "sunwoven-1";
// Every plot in the world, not just the seventeen on hearth: the cap test needs more
// distinct plots than the cap allows advances, or it counts "plot-taken" as "refused" and
// passes with the cap removed.
const FREE_PLOTS = PLOTS.map((p) => p.id);

async function maker(): Promise<string> {
  const row = await pool!.query<{ id: string }>(
    `insert into player (display_name) values ('Maker') returning id`);
  return row.rows[0]!.id;
}

const balance = async (id: string): Promise<number> => Number((await pool!.query<{ balance: string }>(
  `select coalesce(balance,0) as balance from currency_account
    where realm_id=$1 and owner_type='player' and owner_id=$2 and currency_code='MERCS'`,
  [REALM, id])).rows[0]?.balance ?? 0);

const treasury = async (): Promise<number> => Number((await pool!.query<{ balance: string }>(
  `select coalesce(balance,0) as balance from currency_account
    where realm_id=$1 and owner_type='government' and owner_id='treasury' and currency_code='MERCS'`,
  [REALM])).rows[0]?.balance ?? 0);

const supply = async (): Promise<number> => Number((await pool!.query<{ total: string }>(
  `select coalesce(sum(balance),0) as total from currency_account
    where realm_id=$1 and currency_code='MERCS'`, [REALM])).rows[0]!.total);

let plotCursor = 0;
const nextPlot = (): string => FREE_PLOTS[plotCursor++ % FREE_PLOTS.length]!;

// Both suites share the pool, so exactly one close, at module level.
afterAll(async () => { await closeDatabase(); });

suite("the founder's advance", () => {
  beforeEach(async () => {
    for (const t of ["market_listing", "payout_request", "contribution_epoch", "command_receipt", "currency_ledger", "item_ledger", "item_balance", "business", "currency_account"]) {
      await pool!.query(`delete from ${t}`);
    }
    await pool!.query("update plot set owner_player_id = null, license = null");
    await pool!.query(`delete from player`);
    await pool!.query(
      `insert into currency_account (realm_id, owner_type, owner_id, currency_code, balance)
       values ($1,'government','treasury','MERCS',5000000)`, [REALM]);
    plotCursor = 0;
  });
  it("is MOVED from the treasury, not minted", async () => {
    // The property the whole economy is sold on: money is never created, only moved. The
    // advance used to be a bare insert with no debit and no ledger row, so every new
    // wallet inflated the supply by 750 out of nothing.
    const before = await supply();
    const id = await maker();
    await registerBusiness({ realmId: REALM, playerId: id, plotId: nextPlot(), license: "cratemill",
      condition: 100, upgrades: { yield: 0, capacity: 0, speed: 0, appeal: 0 } });
    expect(await balance(id), "the maker was advanced").toBe(FOUNDERS_ADVANCE);
    expect(await supply() - before, "and the money supply did not grow").toBe(0);
  });

  it("leaves a ledger row naming it", async () => {
    const id = await maker();
    await registerBusiness({ realmId: REALM, playerId: id, plotId: nextPlot(), license: "cratemill",
      condition: 100, upgrades: { yield: 0, capacity: 0, speed: 0, appeal: 0 } });
    const rows = await pool!.query(
      `select 1 from currency_ledger where realm_id=$1 and reason='world.advance'`, [REALM]);
    expect(rows.rowCount, "an untraceable grant is not auditable").toBeGreaterThan(0);
  });

  it("advances a given maker only once", async () => {
    const id = await maker();
    await registerBusiness({ realmId: REALM, playerId: id, plotId: nextPlot(), license: "cratemill",
      condition: 100, upgrades: { yield: 0, capacity: 0, speed: 0, appeal: 0 } });
    await registerBusiness({ realmId: REALM, playerId: id, plotId: nextPlot(), license: "shop",
      condition: 100, upgrades: { yield: 0, capacity: 0, speed: 0, appeal: 0 } });
    expect(await balance(id), "re-licensing must not print a second advance").toBe(FOUNDERS_ADVANCE);
  });

  it("stops a sybil at the realm's daily cap", async () => {
    // Identities are free, so "once per player" bounds nothing by itself.
    const wanted = Math.floor(ADVANCE_DAILY_CAP / FOUNDERS_ADVANCE) + 5;
    let refusedForCap = 0;
    for (let i = 0; i < wanted; i += 1) {
      try {
        await registerBusiness({ realmId: REALM, playerId: await maker(), plotId: nextPlot(),
          license: "cratemill", condition: 100, upgrades: { yield: 0, capacity: 0, speed: 0, appeal: 0 } });
      } catch (error) {
        // Count only the refusal under test. Any other failure means the setup is wrong,
        // and counting it would let this pass without a cap existing at all.
        if ((error as Error).message.includes("advanced all it can")) refusedForCap += 1;
        else throw error;
      }
    }
    // Assert on the LEDGER, which is the thing the cap is supposed to bound.
    const advanced = await pool!.query<{ total: string }>(
      `select coalesce(sum(amount),0) as total from currency_ledger
        where realm_id=$1 and reason='world.advance'`, [REALM]);
    expect(Number(advanced.rows[0]!.total), "total advanced today").toBeLessThanOrEqual(ADVANCE_DAILY_CAP);
    expect(refusedForCap, "and the surplus hit the cap specifically").toBeGreaterThan(0);
  });
});

suite("equipment must be paid for", () => {
  beforeEach(async () => {
    for (const t of ["market_listing", "payout_request", "contribution_epoch", "command_receipt", "currency_ledger", "item_ledger", "item_balance", "business", "currency_account"]) {
      await pool!.query(`delete from ${t}`);
    }
    await pool!.query("update plot set owner_player_id = null, license = null");
    await pool!.query(`delete from player`);
    await pool!.query(
      `insert into currency_account (realm_id, owner_type, owner_id, currency_code, balance)
       values ($1,'government','treasury','MERCS',5000000)`, [REALM]);
    plotCursor = 0;
  });

  it("refuses a level the maker cannot afford", async () => {
    // The exploit: the tick multiplies output by these numbers, so an asserted level is
    // the same as being handed the goods it would produce.
    const id = await maker();
    const plot = nextPlot();
    await registerBusiness({ realmId: REALM, playerId: id, plotId: plot, license: "cratemill",
      condition: 100, upgrades: { yield: 0, capacity: 0, speed: 0, appeal: 0 } });

    const maxed = { yield: MAX_UPGRADE_LEVEL, capacity: MAX_UPGRADE_LEVEL, speed: MAX_UPGRADE_LEVEL, appeal: MAX_UPGRADE_LEVEL };
    const cost = 4 * UPGRADE_COST_MERCS.slice(1).reduce((a, b) => a + b, 0);
    expect(cost, "maxing out costs more than the advance").toBeGreaterThan(FOUNDERS_ADVANCE);

    await expect(registerBusiness({ realmId: REALM, playerId: id, plotId: plot, license: "cratemill",
      condition: 100, upgrades: maxed })).rejects.toThrow();

    const stored = await pool!.query<{ upgrades: Record<string, number> }>(
      "select upgrades from business where plot_id=$1", [plot]);
    expect(stored.rows[0]!.upgrades.capacity, "nothing was recorded").toBe(0);
  });

  it("charges the maker and pays the treasury when they can afford it", async () => {
    const id = await maker();
    const plot = nextPlot();
    await registerBusiness({ realmId: REALM, playerId: id, plotId: plot, license: "cratemill",
      condition: 100, upgrades: { yield: 0, capacity: 0, speed: 0, appeal: 0 } });

    const purseBefore = await balance(id);
    const vaultBefore = await treasury();
    await registerBusiness({ realmId: REALM, playerId: id, plotId: plot, license: "cratemill",
      condition: 100, upgrades: { yield: 1, capacity: 0, speed: 0, appeal: 0 } });

    expect(purseBefore - await balance(id), "charged the level-1 price").toBe(UPGRADE_COST_MERCS[1]);
    expect(await treasury() - vaultBefore, "and the city received it").toBe(UPGRADE_COST_MERCS[1]);
  });

  it("opens a brand-new business at zero, whatever it asked for", async () => {
    // Asserting `<= MAX_UPGRADE_LEVEL` was too weak to be worth running: sanitiseUpgrades
    // clamps to 4 anyway, so it could not tell "pinned to zero" from "clamped to four" and
    // passed with the pin removed. Nobody is born with equipment; the number must be 0.
    const id = await maker();
    const plot = nextPlot();
    await registerBusiness({ realmId: REALM, playerId: id, plotId: plot, license: "cratemill",
      condition: 100, upgrades: { yield: 99, capacity: 99, speed: 99, appeal: 99 } as never });
    const stored = await pool!.query<{ upgrades: Record<string, number> }>(
      "select upgrades from business where plot_id=$1", [plot]);
    for (const key of ["yield", "capacity", "speed", "appeal"]) {
      expect(stored.rows[0]!.upgrades[key], `${key} on a new business`).toBe(0);
    }
    expect(await balance(id), "and nothing was charged for equipment it did not get")
      .toBe(FOUNDERS_ADVANCE);
  });

  it("lets a client report a LOWER level without being charged", async () => {
    const id = await maker();
    const plot = nextPlot();
    await registerBusiness({ realmId: REALM, playerId: id, plotId: plot, license: "cratemill",
      condition: 100, upgrades: { yield: 1, capacity: 0, speed: 0, appeal: 0 } });
    const purseBefore = await balance(id);
    await registerBusiness({ realmId: REALM, playerId: id, plotId: plot, license: "cratemill",
      condition: 100, upgrades: { yield: 0, capacity: 0, speed: 0, appeal: 0 } });
    expect(await balance(id), "a stale client must not be charged to catch up").toBe(purseBefore);
  });
});
