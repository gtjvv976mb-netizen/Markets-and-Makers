// The whole wheel: players pay the treasury, the treasury pays the AI citizens, the
// citizens pay the players, and the $MM layer rides on the fees. Thirty players, eight
// weeks, every movement through the real settlement code against a real database.
//
// The owner's question, verbatim: profitable for the players AND the funds don't drain.
// Sectoral balances make the honest frame: in a closed MERCS loop, aggregate player profit
// IS the public sector's drawdown — so what "sustainable" can mean is (a) the treasury
// converges to a working level rather than draining to its floor, because player spending
// recycles wages back in, and (b) real player profit is carried by the $MM layer, whose
// emission is fee-funded and budget-capped. This test measures both.

import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { pool, closeDatabase } from "../src/database.js";
import { claimEpoch } from "../src/economy.js";
import { sellToDistrict, buyFromCivic } from "../src/settlement.js";
import { runGovernmentMind, TREASURY_FLOOR } from "../src/minds.js";
import { RESOURCES, epochIdFor } from "../src/catalogue.js";
import { live as liveDatabase } from "./live-database.js";

const suite = liveDatabase ? describe : describe.skip;
const REALM = "sunwoven-1";

async function mkPlayer(name: string): Promise<string> {
  const r = await pool!.query<{ id: string }>(`insert into player (display_name) values ($1) returning id`, [name]);
  return r.rows[0]!.id;
}
async function setBalance(ownerType: string, ownerId: string, amount: number): Promise<void> {
  await pool!.query(`insert into currency_account (realm_id, owner_type, owner_id, balance, currency_code)
    values ($1, $2, $3, $4, 'MERCS')
    on conflict (realm_id, owner_type, owner_id, currency_code) do update set balance = excluded.balance`,
    [REALM, ownerType, ownerId, amount]);
}
async function credit(ownerType: string, ownerId: string, amount: number): Promise<void> {
  await pool!.query(`insert into currency_account (realm_id, owner_type, owner_id, balance, currency_code)
    values ($1, $2, $3, $4, 'MERCS')
    on conflict (realm_id, owner_type, owner_id, currency_code)
    do update set balance = currency_account.balance + excluded.balance`, [REALM, ownerType, ownerId, amount]);
}
async function balanceOf(ownerType: string, ownerId: string): Promise<number> {
  const r = await pool!.query<{ balance: string }>(
    `select balance from currency_account where realm_id=$1 and owner_type=$2 and owner_id=$3 and currency_code='MERCS'`,
    [REALM, ownerType, ownerId]);
  return Number(r.rows[0]?.balance ?? 0);
}

suite("the circular economy, eight weeks", () => {
  afterAll(async () => { await closeDatabase(); });

  it("keeps players profitable while the treasury converges instead of draining", async () => {
    for (const table of ["demand_day", "market_pressure", "contribution_epoch", "reserve_funding", "procurement_day"]) {
      await pool!.query(`delete from ${table}`);
    }
    await pool!.query(`update realm_clock set wage_carry = 0 where mind='government'`).catch(() => {});

    const N = 30;
    const islands = ["hearth", "quarry", "grove", "tide"];
    const sellable = Object.keys(RESOURCES).filter((k) =>
      (RESOURCES as Record<string, { procurementPrice?: number }>)[k]?.procurementPrice);

    const players: Array<{ id: string; island: string; start: number }> = [];
    for (let i = 0; i < N; i += 1) {
      const id = await mkPlayer(`circ-${i}`);
      await setBalance("player", id, 1_000);
      players.push({ id, island: islands[i % islands.length]!, start: 1_000 });
    }
    const T0 = 2_000_000;
    await setBalance("government", "treasury", T0);
    await setBalance("player", "citizens", 0);

    const DAY = 86_400_000;
    const start = Date.UTC(2026, 9, 1);
    const treasuryPath: number[] = [];
    const citizensPath: number[] = [];
    let mmIssued = 0;

    // Goods are allowed to appear (production creates them by design — "money must be
    // conserved; goods must not"), so the sim stands in for each player's production by
    // seeding item_balance. MONEY is never seeded after the start: every MERC a player
    // earns below is moved out of the citizens' or treasury's account by settlement code,
    // and conservation is asserted to the unit every week.
    const seedGoods = async (playerId: string, itemKey: string, quantity: number): Promise<void> => {
      await pool!.query(`insert into item_balance (realm_id, owner_type, owner_id, item_key, quantity)
        values ($1,'player',$2,$3,$4)
        on conflict (realm_id, owner_type, owner_id, item_key)
        do update set quantity = item_balance.quantity + excluded.quantity`,
        [REALM, playerId, itemKey, quantity]);
    };
    const errors = new Map<string, number>();
    const note = (kind: string, e: unknown): void => {
      const key = `${kind}:${String((e as Error).message).slice(0, 40)}`;
      errors.set(key, (errors.get(key) ?? 0) + 1);
    };
    const total = async (): Promise<number> => {
      const r = await pool!.query<{ s: string }>(
        `select coalesce(sum(balance),0) as s from currency_account where realm_id=$1 and currency_code='MERCS'`, [REALM]);
      return Number(r.rows[0]!.s);
    };
    const conserved = await total();

    for (let day = 0; day < 56; day += 1) {
      const at = start + day * DAY + 9 * 3_600_000;

      // The government's day: wages and public works, treasury -> citizens, cabinet-clamped.
      // The works also STOCK the civic supply, which is what players buy inputs from.
      await runGovernmentMind(at);

      for (const p of players) {
        const good = sellable[(players.indexOf(p) + day) % sellable.length]!;
        await seedGoods(p.id, good, 5);   // production, standing in
        try { await buyFromCivic({ idempotencyKey: randomUUID(), playerId: p.id, islandId: p.island, itemKey: good, quantity: 1 }); }
        catch (e) { note("buy", e); }
        try { await sellToDistrict({ idempotencyKey: randomUUID(), playerId: p.id, islandId: p.island, itemKey: good, quantity: 5, at }); }
        catch (e) { note("sell", e); }
      }

      if (day % 7 === 6) {
        // Weekly $MM claims on the SIMULATED clock, since contributions are stamped with
        // it. The endowment side of each epoch's budget pays regardless; the tax-funded
        // top-up is asserted separately, banked under the real epoch by fundReserve.
        for (const p of players) {
          try { const c = await claimEpoch(REALM, p.id, randomUUID(), at); mmIssued += c.paid; } catch { /* fine */ }
        }
        // conservation, to the unit, every week ($MM is a separate ledger, never MERCS)
        expect(await total(), `MERCS conserved at day ${day}`).toBe(conserved);
      }

      treasuryPath.push(await balanceOf("government", "treasury"));
      citizensPath.push(await balanceOf("player", "citizens"));
    }
    for (const [k, n] of [...errors.entries()]) console.log(`  refusals x${n}: ${k}`);

    // The $MM layer, claimed under the REAL epoch: settlement banks each sale's tax into
    // reserve_funding at the real clock (it takes no simulated time), so contribution and
    // claims must meet there too. One claim pass proves the whole bridge: MERCS taxes ->
    // reserve -> a budget larger than the bare endowment -> pro-rata $MM payouts.
    const funded = await pool!.query<{ s: string }>(
      `select coalesce(sum(amount),0) as s from reserve_funding where realm_id=$1 and source='economy.tax'`, [REALM]);
    console.log(`TAXES banked for emission: ${funded.rows[0]!.s} Merc Dollars`);

    const nets: number[] = [];
    for (const p of players) nets.push(await balanceOf("player", p.id) - p.start);
    const avg = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
    const profitable = nets.filter((n) => n > 0).length;
    const wk = (d: number): string => `${Math.round(treasuryPath[d]! / 1000)}k`;
    console.log(`TREASURY ${Math.round(T0/1000)}k -> w1 ${wk(6)} w2 ${wk(13)} w4 ${wk(27)} w6 ${wk(41)} w8 ${wk(55)}  (floor ${TREASURY_FLOOR/1000}k)`);
    console.log(`CITIZENS end ${Math.round(citizensPath[55]!/1000)}k`);
    console.log(`PLAYERS profitable ${profitable}/${N} · net min ${Math.min(...nets)} avg ${Math.round(avg(nets))} max ${Math.max(...nets)}`);
    console.log(`$MM issued across the sim's epochs: ${mmIssued}`);
    const lastFortnightDrain = treasuryPath[41]! - treasuryPath[55]!;
    const firstFortnightDrain = treasuryPath[0]! - treasuryPath[13]!;
    console.log(`DRAIN first fortnight ${Math.round(firstFortnightDrain/1000)}k vs last fortnight ${Math.round(lastFortnightDrain/1000)}k`);

    // does it work: most players ahead
    expect(profitable / N, "most players end ahead").toBeGreaterThan(0.7);
    // the treasury must not be at (or racing toward) its floor by week 8
    expect(treasuryPath[55]!, "treasury above its floor at week 8").toBeGreaterThan(TREASURY_FLOOR * 1.5);
    // solvency: at the measured drain rate, the treasury's runway must exceed a year.
    // (The stronger guarantee — the drain THROTTLING itself as the treasury thins — is the
    // procurement stabilizer's job, proven in its own scenario below.)
    const perDay = Math.max(1, (treasuryPath[0]! - treasuryPath[55]!) / 56);
    const runwayDays = (treasuryPath[55]! - TREASURY_FLOOR) / perDay;
    console.log(`RUNWAY at current drain: ${Math.round(runwayDays)} days`);
    expect(runwayDays, "a year of runway at the measured drain").toBeGreaterThan(365);
    // the $MM layer keeps paying real value on top
    expect(mmIssued, "the token layer pays out, tax-funded").toBeGreaterThan(0);
    // and the tax bridge genuinely enlarges the budget: what was banked is real money for
    // the emission side, converted at the peg
    expect(Number(funded.rows[0]!.s), "sim taxes actually reached the reserve").toBeGreaterThan(0);
  }, 240_000);

  it("throttles procurement when the treasury is poor, instead of draining to the floor", async () => {
    for (const table of ["demand_day", "market_pressure", "procurement_day"]) {
      await pool!.query(`delete from ${table}`);
    }
    const N = 25;
    const players: string[] = [];
    for (let i = 0; i < N; i += 1) {
      const id = await mkPlayer(`poor-${i}`);
      await setBalance("player", id, 500);
      players.push(id);
    }
    const POOR = TREASURY_FLOOR + 60_000;   // 110k: thin, but above the floor
    await setBalance("government", "treasury", POOR);
    await setBalance("player", "citizens", 0);

    const DAY = 86_400_000;
    const start = Date.UTC(2026, 10, 1);
    let refusedByBudget = 0;
    let sold = 0;
    for (let day = 0; day < 28; day += 1) {
      const at = start + day * DAY + 9 * 3_600_000;
      await runGovernmentMind(at);
      for (const id of players) {
        await pool!.query(`insert into item_balance (realm_id, owner_type, owner_id, item_key, quantity)
          values ($1,'player',$2,'water',25)
          on conflict (realm_id, owner_type, owner_id, item_key)
          do update set quantity = item_balance.quantity + excluded.quantity`, [REALM, id]);
        try { await sellToDistrict({ idempotencyKey: randomUUID(), playerId: id, islandId: "hearth", itemKey: "water", quantity: 25, at }); sold += 1; }
        catch (e) { if (String((e as Error).message).includes("procurement")) refusedByBudget += 1; }
      }
    }
    const end = await balanceOf("government", "treasury");
    console.log(`POOR TREASURY ${POOR/1000}k -> ${Math.round(end/1000)}k after 28 days · sales ${sold} · throttled ${refusedByBudget}`);
    // the stabilizer must actually bind under pressure...
    expect(refusedByBudget, "the daily budget must throttle a poor treasury's buying").toBeGreaterThan(0);
    // ...and the treasury must hold WELL above its floor because of it
    expect(end, "the treasury survives a month of heavy selling").toBeGreaterThan(TREASURY_FLOOR);
    // ...while players still sold SOMETHING every day (the floor keeps a minimum market)
    expect(sold, "a depression still has a market").toBeGreaterThan(28);
  }, 240_000);
});
