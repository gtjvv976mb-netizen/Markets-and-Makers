import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDatabase, pool } from "../src/database.js";
import {
  BASE_POPULATION, CIVIC_DAILY_WAGE, POPULATION_PER_BUSINESS, SPEND_RATE, STATE_INDUSTRIES,
  TREASURY_FLOOR, runCitizenMind, runGovernmentMind, runMinds,
} from "../src/minds.js";
import { runWorldTick } from "../src/tick.js";
import { TRADES } from "../src/trades.js";
import { registerBusiness, seedPlots } from "../src/world.js";
import { live as liveDatabase } from "./live-database.js";

// See live-database.ts: these suites EMPTY their tables, so they refuse to run
// against a database that is not obviously disposable.
const live = liveDatabase;
const suite = live ? describe : describe.skip;
const REALM = "sunwoven-1";

async function player(name: string): Promise<string> {
  const r = await pool!.query<{ id: string }>(
    "insert into player (display_name, wallet_address) values ($1,$2) returning id",
    [name, `W${name}${Math.random().toString(36).slice(2, 10)}`]);
  return r.rows[0]!.id;
}

async function balance(ownerType: string, ownerId: string): Promise<number> {
  const r = await pool!.query<{ balance: string }>(
    "select balance from currency_account where realm_id=$1 and owner_type=$2 and owner_id=$3",
    [REALM, ownerType, ownerId]);
  return Number(r.rows[0]?.balance ?? 0);
}

/** Every Merc Dollar in the realm. If this moves, a mind minted one. */
async function totalCurrency(): Promise<number> {
  const r = await pool!.query<{ total: string }>(
    "select coalesce(sum(balance),0)::text as total from currency_account where realm_id=$1", [REALM]);
  return Number(r.rows[0]!.total);
}

async function civicStock(itemKey: string): Promise<number> {
  const r = await pool!.query<{ quantity: string }>(
    "select quantity from item_balance where realm_id=$1 and owner_type='government' and owner_id='supply' and item_key=$2",
    [REALM, itemKey]);
  return Number(r.rows[0]?.quantity ?? 0);
}

/** Wind a mind's clock back so it has work to do. */
async function ageMind(mind: string, hours: number): Promise<void> {
  await pool!.query(
    "update realm_clock set last_run_at = now() - ($2 || ' hours')::interval where realm_id=$1 and mind=$3",
    [REALM, String(hours), mind]);
}

async function setTreasury(amount: number): Promise<void> {
  await pool!.query(
    `insert into currency_account (realm_id, owner_type, owner_id, currency_code, balance)
     values ($1,'government','treasury','MERCS',$2)
     on conflict (realm_id, owner_type, owner_id, currency_code) do update set balance = $2`,
    [REALM, amount]);
}

suite("the minds that keep the district alive", () => {
  beforeEach(async () => {
    await pool!.query("delete from business");
    await pool!.query("update plot set owner_player_id = null, license = null");
    await pool!.query("delete from demand_day");
    await pool!.query("delete from contribution_epoch");
    await pool!.query("delete from command_receipt");
    await pool!.query("delete from item_ledger");
    await pool!.query("delete from currency_ledger");
    await pool!.query("delete from item_balance");
    await pool!.query("delete from currency_account");
    await seedPlots(REALM);
    await setTreasury(8_000_000);
    await pool!.query(
      `insert into currency_account (realm_id, owner_type, owner_id, currency_code, balance)
       values ($1,'player','citizens','MERCS',0)
       on conflict (realm_id, owner_type, owner_id, currency_code) do update set balance = 0`, [REALM]);
    await pool!.query(
      `insert into realm_clock (realm_id, mind) values ($1,'government'), ($1,'citizens')
       on conflict (realm_id, mind) do update set last_run_at = now()`, [REALM]);
  });

  afterAll(async () => {
    await pool!.query("delete from business");
    await pool!.query("update plot set owner_player_id = null, license = null");
    await pool!.query("delete from command_receipt");
    await pool!.query("delete from contribution_epoch");
    await pool!.query("delete from item_ledger");
    await pool!.query("delete from currency_ledger");
    await pool!.query("delete from item_balance where owner_type = 'player'");
    await pool!.query("delete from currency_account where owner_type = 'player' and owner_id <> 'citizens'");
    await closeDatabase();
  });

  describe("the government", () => {
    it("pays the Mercedonians, which is where all demand comes from", async () => {
      // The hole this closes: before the government mind, the citizens' account was only
      // ever debited. It drained, and the district would have stopped buying in silence.
      await ageMind("government", 24);
      const before = await balance("player", "citizens");
      const report = await runGovernmentMind();

      expect(report.wagesPaid).toBeGreaterThan(0);
      expect(await balance("player", "citizens")).toBe(before + report.wagesPaid + report.productionCost);
    });

    it("pays for it out of the treasury, and mints nothing", async () => {
      await ageMind("government", 24);
      const supply = await totalCurrency();
      const treasuryBefore = await balance("government", "treasury");
      const report = await runGovernmentMind();

      expect(await totalCurrency()).toBe(supply);
      expect(await balance("government", "treasury"))
        .toBe(treasuryBefore - report.wagesPaid - report.productionCost);
    });

    it("counts a bigger district as more mouths to feed", async () => {
      const alice = await player("alice");
      await registerBusiness({ realmId: REALM, playerId: alice, plotId: "GX072", license: "shop",
        condition: 100, upgrades: { yield: 0, capacity: 0, speed: 0, appeal: 0 } });
      await ageMind("government", 24);
      const report = await runGovernmentMind();
      expect(report.population).toBe(BASE_POPULATION + POPULATION_PER_BUSINESS);
    });

    it("goes into austerity rather than overdrawing when the treasury is thin", async () => {
      // A thin treasury pays a smaller wage; households then spend less and tax falls
      // further. That feedback is the point — an economy that cannot have a bad week is
      // not an economy.
      await setTreasury(TREASURY_FLOOR + 1_000);
      await ageMind("government", 24);
      const report = await runGovernmentMind();

      expect(report.austerity).toBe(true);
      expect(report.wagesPaid).toBeLessThan(report.wageBill);
      expect(await balance("government", "treasury")).toBeGreaterThanOrEqual(0);
    });

    it("spends nothing at all once the treasury is at its floor", async () => {
      await setTreasury(TREASURY_FLOOR);
      await ageMind("government", 24);
      const report = await runGovernmentMind();
      expect(report.wagesPaid).toBe(0);
      expect(report.productionCost).toBe(0);
    });

    it("runs the state industries to restock the civic supplier", async () => {
      await ageMind("government", 24);
      const before = await civicStock("water");
      const report = await runGovernmentMind();
      expect(report.produced.water ?? 0).toBeGreaterThan(0);
      expect(await civicStock("water")).toBeGreaterThan(before);
    });

    it("stops making a resource once the shelf is at target", async () => {
      await pool!.query(
        `insert into item_balance (realm_id, owner_type, owner_id, item_key, quantity)
         values ($1,'government','supply','water',$2)
         on conflict (realm_id, owner_type, owner_id, item_key) do update set quantity = $2`,
        [REALM, STATE_INDUSTRIES.water!.target + 100]);
      await ageMind("government", 24);
      const report = await runGovernmentMind();
      expect(report.produced.water ?? 0).toBe(0);
    });

    it("does nothing twice when run twice", async () => {
      await ageMind("government", 24);
      const first = await runGovernmentMind();
      const second = await runGovernmentMind();
      expect(first.wagesPaid).toBeGreaterThan(0);
      expect(second.wagesPaid).toBe(0);
    });

    it("bills a longer absence proportionally, not infinitely", async () => {
      await ageMind("government", 24 * 30);          // a month away
      const report = await runGovernmentMind();
      // Capped at 26 hours of elapsed time, so a month offline is not a month of wages.
      expect(report.elapsedHours).toBeLessThanOrEqual(26);
      expect(report.wageBill).toBeLessThan(BASE_POPULATION * CIVIC_DAILY_WAGE * 2);
    });
  });

  describe("the Mercedonians", () => {
    it("hold something back rather than spending every last Merc Dollar", async () => {
      await pool!.query(
        "update currency_account set balance = 100000 where realm_id=$1 and owner_type='player' and owner_id='citizens'", [REALM]);
      await ageMind("citizens", 24);
      const report = await runCitizenMind();
      expect(report.spendingPower).toBe(Math.floor(report.purse * SPEND_RATE));
      expect(report.spendingPower).toBeLessThan(report.purse);
    });

    it("want finished goods, not ore", async () => {
      await pool!.query(
        "update currency_account set balance = 100000 where realm_id=$1 and owner_type='player' and owner_id='citizens'", [REALM]);
      await ageMind("citizens", 24);
      const report = await runCitizenMind();
      expect(Object.keys(report.appetite).length).toBeGreaterThan(0);
      expect(report.appetite.ore).toBeUndefined();
    });

    it("stop wanting anything when their pockets are empty", async () => {
      await ageMind("citizens", 24);
      const report = await runCitizenMind();
      expect(report.purse).toBe(0);
      expect(report.spendingPower).toBe(0);
      for (const wanted of Object.values(report.appetite)) expect(wanted).toBe(0);
    });

    it("moves no money of its own", async () => {
      await ageMind("citizens", 24);
      const supply = await totalCurrency();
      await runCitizenMind();
      expect(await totalCurrency()).toBe(supply);
    });
  });

  describe("the circuit, closed", () => {
    it("keeps a district trading for a simulated month without minting a Merc Dollar", async () => {
      // The whole point of both minds: wages create demand, demand feeds businesses,
      // businesses pay tax, tax funds wages. Run it round thirty times and prove the
      // realm's money only ever moved.
      const alice = await player("alice");
      const bob = await player("bob");
      await registerBusiness({ realmId: REALM, playerId: alice, plotId: "GX072", license: "greenhouse",
        condition: 100, upgrades: { yield: 0, capacity: 0, speed: 0, appeal: 0 } });
      await registerBusiness({ realmId: REALM, playerId: bob, plotId: "GX036", license: "shop",
        condition: 100, upgrades: { yield: 0, capacity: 0, speed: 0, appeal: 0 } });

      const opening = await totalCurrency();
      let traded = 0;
      for (let day = 0; day < 30; day += 1) {
        await ageMind("government", 24);
        await ageMind("citizens", 24);
        await pool!.query("update business set last_tick_at = now() - interval '24 hours'");
        await runMinds();
        const tick = await runWorldTick();
        traded += tick.sold;
        expect(await totalCurrency(), `money supply moved on day ${day + 1}`).toBe(opening);
      }

      // And it was a living economy, not a stalled one.
      expect(traded, "nobody bought anything all month").toBeGreaterThan(0);
      expect(await balance("player", "citizens")).toBeGreaterThan(0);
    });

    it("gets money to households that businesses can then earn", async () => {
      const alice = await player("alice");
      await registerBusiness({ realmId: REALM, playerId: alice, plotId: "GX072", license: "shop",
        condition: 100, upgrades: { yield: 0, capacity: 0, speed: 0, appeal: 0 } });
      await pool!.query(
        `insert into item_balance (realm_id, owner_type, owner_id, item_key, quantity)
         values ($1,'player',$2,$3,200)
         on conflict (realm_id, owner_type, owner_id, item_key) do update set quantity = 200`,
        [REALM, alice, TRADES.shop!.retailItems[0]!]);

      // With no wages paid, the citizens cannot buy: the shop's takings are nil.
      await pool!.query("update business set last_tick_at = now() - interval '24 hours'");
      const broke = await runWorldTick();
      expect(broke.gross).toBe(0);

      // Pay them, and the very same shop starts selling.
      await ageMind("government", 24);
      await runGovernmentMind();
      await pool!.query("update business set last_tick_at = now() - interval '24 hours'");
      const paid = await runWorldTick();
      expect(paid.gross).toBeGreaterThan(0);
    });
  });
});
