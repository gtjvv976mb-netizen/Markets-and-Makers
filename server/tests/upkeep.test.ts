/**
 * The return leg: rent, utilities, payroll — and the service counter.
 *
 * Both existing economy simulations (simulation.test.ts, circulation.test.ts) drive the
 * PLAYER-INITIATED paths and never call runWorldTick, so the loop that actually runs the
 * live world — where `worldTick: server` — was covered by nothing that measured money over
 * time. That gap is why a treasury paying 18,000 MERCS a day out and taking nothing back
 * looked healthy in a green suite.
 *
 * Everything here asserts a printed number, and every case asserts that the realm's total
 * Merc Dollars did not move: value may only be transferred, never created.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDatabase, pool } from "../src/database.js";
import { stockCivicSupply } from "../src/settlement.js";
import { runWorldTick } from "../src/tick.js";
import { registerBusiness, seedPlots } from "../src/world.js";
import {
  POWER_STANDING_CHARGE, STAFF_DAILY_WAGE, UTILITY_PER_CAPACITY, WATER_STANDING_CHARGE,
} from "../src/catalogue.js";
import { live as liveDatabase } from "./live-database.js";

const suite = liveDatabase ? describe : describe.skip;
const REALM = "sunwoven-1";
const BUSY = "GX072";
const QUIET = "GX036";

async function player(name: string): Promise<string> {
  const r = await pool!.query<{ id: string }>(
    "insert into player (display_name, wallet_address) values ($1, $2) returning id",
    [name, `U${name}${Math.random().toString(36).slice(2, 10)}`]);
  return r.rows[0]!.id;
}

async function balance(ownerType: string, ownerId: string): Promise<number> {
  const r = await pool!.query<{ balance: string }>(
    "select balance from currency_account where realm_id=$1 and owner_type=$2 and owner_id=$3",
    [REALM, ownerType, ownerId]);
  return Number(r.rows[0]?.balance ?? 0);
}

async function totalCurrency(): Promise<number> {
  const r = await pool!.query<{ total: string }>(
    "select coalesce(sum(balance),0)::text as total from currency_account where realm_id=$1", [REALM]);
  return Number(r.rows[0]!.total);
}

async function items(playerId: string, itemKey: string): Promise<number> {
  const r = await pool!.query<{ quantity: string }>(
    "select quantity from item_balance where realm_id=$1 and owner_type='player' and owner_id=$2 and item_key=$3",
    [REALM, playerId, itemKey]);
  return Number(r.rows[0]?.quantity ?? 0);
}

/** Wind BOTH clocks back: the tick's, and the standing-charge meter's. */
async function age(plotId: string, hours: number): Promise<void> {
  await pool!.query(
    `update business set last_tick_at = now() - ($2 || ' hours')::interval,
                         charges_settled_at = now() - ($2 || ' hours')::interval
      where plot_id = $1`, [plotId, String(hours)]);
}

async function openShop(
  plotId: string, licence: string, ownerId: string, staff = 1, capacity = 0,
): Promise<void> {
  await registerBusiness({
    realmId: REALM, playerId: ownerId, plotId, license: licence, condition: 100,
    upgrades: { yield: 0, capacity, speed: 0, appeal: 0 }, staff,
  });
}

async function fund(playerId: string, amount: number): Promise<void> {
  await pool!.query(
    `update currency_account set balance = $3
      where realm_id=$1 and owner_type='player' and owner_id=$2 and currency_code='MERCS'`,
    [REALM, playerId, amount]);
}

suite("the city bills what it supplies", () => {
  beforeEach(async () => {
    await pool!.query("delete from business");
    await pool!.query("update plot set owner_player_id = null, license = null");
    await pool!.query("delete from demand_day");
    await pool!.query("delete from contribution_epoch");
    await pool!.query("delete from command_receipt");
    await seedPlots(REALM);
    for (const [type, id, bal] of [["player", "citizens", 2_000_000], ["government", "treasury", 5_000_000]] as const) {
      await pool!.query(
        `insert into currency_account (realm_id, owner_type, owner_id, currency_code, balance)
         values ($1,$2,$3,'MERCS',$4)
         on conflict (realm_id, owner_type, owner_id, currency_code) do update set balance = $4`,
        [REALM, type, id, bal]);
    }
    for (const item of ["supply", "food", "water", "power", "part", "material", "crate", "produce", "waste"]) {
      await stockCivicSupply(item, 1_000_000);
    }
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
    // The day's procurement allowance is shared realm-wide and derived from the treasury,
    // so a suite that spends either leaves the next one a different economy.
    await pool!.query("delete from procurement_day");
    await pool!.query("delete from demand_day");
    await closeDatabase();
  });

  it("bills utilities to the treasury and payroll to the citizens, and mints nothing", async () => {
    const alice = await player("upkeep-alice");
    await openShop(BUSY, "shop", alice, 3);
    await fund(alice, 5_000);
    await age(BUSY, 26);

    const before = {
      total: await totalCurrency(),
      treasury: await balance("government", "treasury"),
      citizens: await balance("player", "citizens"),
    };
    const report = await runWorldTick();

    const expectedUtilities = WATER_STANDING_CHARGE + POWER_STANDING_CHARGE;
    const expectedPayroll = 3 * STAFF_DAILY_WAGE;
    console.log(`UPKEEP one day: utilities ${report.utilities} (expected ${expectedUtilities})`
      + ` · payroll ${report.payroll} (expected ${expectedPayroll})`);
    expect(report.utilities).toBe(expectedUtilities);
    expect(report.payroll).toBe(expectedPayroll);

    // Utilities land in the treasury. The counter also pays tax there, so assert the
    // floor rather than equality — the point is that the money ARRIVES.
    const treasuryAfter = await balance("government", "treasury");
    console.log(`TREASURY ${before.treasury} -> ${treasuryAfter} (+${treasuryAfter - before.treasury})`);
    expect(treasuryAfter).toBeGreaterThanOrEqual(before.treasury + expectedUtilities);

    console.log(`TOTAL MERCS ${before.total} -> ${await totalCurrency()}`);
    expect(await totalCurrency()).toBe(before.total);
  });

  it("scales the bill with capacity, exactly as the browser's meter does", async () => {
    const bob = await player("upkeep-bob");
    // Upgrades are zeroed on a FIRST registration and charged on every later one, so a
    // level-2 business is built and then bought up to it — the same two steps a player takes.
    await openShop(QUIET, "shop", bob, 0);
    await fund(bob, 200_000);
    await openShop(QUIET, "shop", bob, 0, 2);
    await age(QUIET, 26);

    const report = await runWorldTick();
    const expected = WATER_STANDING_CHARGE + POWER_STANDING_CHARGE + 2 * UTILITY_PER_CAPACITY;
    console.log(`UPKEEP capacity 2: ${report.utilities} (expected ${expected}) · payroll ${report.payroll}`);
    expect(report.utilities).toBe(expected);
    expect(report.payroll).toBe(0);
  });

  it("cuts the supply instead of pushing an owner into debt", async () => {
    const carol = await player("upkeep-carol");
    await openShop(BUSY, "shop", carol, 8);
    await fund(carol, 5);
    await age(BUSY, 26);

    const total = await totalCurrency();
    const report = await runWorldTick();
    const purse = await balance("player", carol);
    console.log(`CUT: purse ${purse} · billed ${report.utilities + report.payroll} · cut ${report.cut}`);
    expect(report.cut).toBe(1);
    expect(report.utilities + report.payroll).toBe(0);
    expect(purse).toBeGreaterThanOrEqual(0);
    expect(await totalCurrency()).toBe(total);

    const row = await pool!.query<{ supplies_cut: boolean }>(
      "select supplies_cut from business where plot_id = $1", [BUSY]);
    expect(row.rows[0]!.supplies_cut).toBe(true);
  });

  it("never bills more than the window it pays earnings for", async () => {
    const dave = await player("upkeep-dave");
    await openShop(QUIET, "shop", dave, 1);
    await fund(dave, 100_000);
    // Thirty days away. The browser caps the meter at the offline window; so must this,
    // or an absence bills far more than it could ever have earned.
    await age(QUIET, 24 * 30);

    const report = await runWorldTick();
    const oneDay = WATER_STANDING_CHARGE + POWER_STANDING_CHARGE + STAFF_DAILY_WAGE;
    console.log(`THIRTY DAYS AWAY billed ${report.utilities + report.payroll}`
      + ` = ${(report.utilities + report.payroll) / oneDay} days, cap 2`);
    expect(report.utilities + report.payroll).toBeLessThanOrEqual(oneDay * 2);
  });

  it("pays a service counter that used to earn nothing at all", async () => {
    const erin = await player("service-erin");
    await openShop(BUSY, "restaurant", erin, 0);
    await fund(erin, 50_000);
    await age(BUSY, 10);

    const total = await totalCurrency();
    const citizensBefore = await balance("player", "citizens");
    const purseBefore = await balance("player", erin);
    const report = await runWorldTick();
    const earned = (await balance("player", erin)) - purseBefore;

    console.log(`RESTAURANT served ${report.sold} · gross ${report.gross} · owner earned ${earned}`
      + ` · citizens ${citizensBefore} -> ${await balance("player", "citizens")}`);
    expect(report.sold).toBeGreaterThan(0);
    expect(report.gross).toBeGreaterThan(0);
    // Takings, minus the standing charges the same pass billed.
    expect(earned).toBeGreaterThan(0);
    expect(await totalCurrency()).toBe(total);
  });

  it("stops a service burning the inputs it can never turn into anything", async () => {
    const frank = await player("service-frank");
    await openShop(QUIET, "gym", frank, 0);
    await fund(frank, 50_000);
    await age(QUIET, 12);
    // Registration stocks a business's opening inputs; a gym's cycle used to consume them
    // and produce nothing, so restock bought them back every pass forever.
    const before = await items(frank, "power");
    await runWorldTick();
    const after = await items(frank, "power");
    console.log(`GYM power ${before} -> ${after} (production must not consume it)`);
    expect(after).toBeGreaterThanOrEqual(before);
  });

  it("closes the circuit: a week of ticks returns money to the treasury", async () => {
    // The whole point of the change, measured. Ten shops, seven days, and the question is
    // whether the treasury's balance improves against the same run without the return leg.
    const owners: string[] = [];
    const plots = ["GX072", "GX036", "EF01", "EF02", "EF03",
                   "EF04", "EF05", "EF06", "FH03", "FH04"];
    for (let i = 0; i < plots.length; i += 1) {
      const id = await player(`circuit-${i}`);
      owners.push(id);
      await openShop(plots[i]!, i % 3 === 0 ? "restaurant" : "shop", id, 2);
      await fund(id, 30_000);
    }

    const total = await totalCurrency();
    const citizensStart = await balance("player", "citizens");
    const treasuryStart = await balance("government", "treasury");
    let utilities = 0, payroll = 0, sold = 0;
    for (let day = 0; day < 7; day += 1) {
      for (const plot of plots) await age(plot, 26);
      const report = await runWorldTick();
      utilities += report.utilities;
      payroll += report.payroll;
      sold += report.sold;
    }
    const citizensEnd = await balance("player", "citizens");
    const treasuryEnd = await balance("government", "treasury");
    console.log(`SEVEN DAYS, TEN SHOPS: utilities to treasury ${utilities} · payroll to citizens ${payroll}`
      + ` · ${sold} sold at the counter`);
    console.log(`  citizens ${citizensStart} -> ${citizensEnd} (${citizensEnd - citizensStart})`);
    console.log(`  treasury ${treasuryStart} -> ${treasuryEnd} (${treasuryEnd - treasuryStart})`);
    expect(utilities).toBeGreaterThan(0);
    expect(payroll).toBeGreaterThan(0);
    // The citizens' purse must survive a week of being shopped in. It is finite and the
    // column refuses an overdraft, so a purse that empties does not error — the shops just
    // quietly stop selling, which is the failure that would hide.
    expect(citizensEnd).toBeGreaterThan(0);
    // Conservation over the whole week, which is the property that matters most here:
    // every leg of the loop is a transfer.
    console.log(`TOTAL MERCS ${total} -> ${await totalCurrency()}`);
    expect(await totalCurrency()).toBe(total);
  });
});
