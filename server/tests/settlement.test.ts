import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { pool, closeDatabase } from "../src/database.js";
import { buyFromCivic, sellToDistrict, stockCivicSupply } from "../src/settlement.js";
import { quote } from "../src/economy.js";
import { EconomyError } from "../src/economy.js";
import { live as liveDatabase } from "./live-database.js";

// See live-database.ts: these suites EMPTY their tables, so they refuse to run
// against a database that is not obviously disposable.
const live = liveDatabase;
const suite = live ? describe : describe.skip;
const REALM = "sunwoven-1";

async function seed(parts: number, coins: number): Promise<string> {
  const created = await pool!.query<{ id: string }>(`insert into player (display_name) values ('Trader') returning id`);
  const id = created.rows[0]!.id;
  await pool!.query(
    `insert into item_balance values ($1,'player',$2,'part',$3)
     on conflict (realm_id,owner_type,owner_id,item_key) do update set quantity = excluded.quantity`,
    [REALM, id, parts]);
  await pool!.query(
    `insert into currency_account (realm_id,owner_type,owner_id,balance,currency_code) values ($1,'player',$2,$3,'MERCS')
     on conflict (realm_id,owner_type,owner_id,currency_code) do update set balance = excluded.balance`,
    [REALM, id, coins]);
  await pool!.query(
    `insert into currency_account (realm_id,owner_type,owner_id,balance,currency_code) values ($1,'government','treasury',5000000,'MERCS')
     on conflict (realm_id,owner_type,owner_id,currency_code) do update set balance = 5000000`, [REALM]);
  return id;
}

suite("server-authoritative settlement", () => {
  beforeEach(async () => {
    for (const table of ["demand_day","market_pressure","contribution_epoch","reserve_funding",
                         "item_ledger","item_balance","currency_ledger","currency_account","command_receipt"]) {
      await pool!.query(`delete from ${table}`);
    }
  });
  afterAll(async () => { await closeDatabase(); });

  it("prices a sale on the server and moves goods and money together", async () => {
    const player = await seed(100, 0);
    const sale = await sellToDistrict({ idempotencyKey: randomUUID(), playerId: player, islandId: "hearth", itemKey: "part", quantity: 20 });
    expect(sale.gross).toBeGreaterThan(0);
    expect(sale.net).toBe(sale.gross - sale.tax);

    const held = await pool!.query(`select quantity from item_balance where owner_id=$1 and item_key='part'`, [player]);
    expect(Number(held.rows[0].quantity)).toBe(80);
    const paid = await pool!.query(`select balance from currency_account where owner_id=$1`, [player]);
    expect(Number(paid.rows[0].balance)).toBe(sale.net);
  });

  it("does not move the district price twice when a command is replayed", async () => {
    // Regression: pricing, demand and contribution used to run OUTSIDE the idempotency
    // boundary, so a retried request re-priced the market for every player even though
    // the ledger movement itself was idempotent.
    const player = await seed(100, 0);
    const key = randomUUID();
    const first = await sellToDistrict({ idempotencyKey: key, playerId: player, islandId: "hearth", itemKey: "part", quantity: 20 });
    const afterFirst = await quote(REALM, "hearth", "part");

    const replay = await sellToDistrict({ idempotencyKey: key, playerId: player, islandId: "hearth", itemKey: "part", quantity: 20 });
    const afterReplay = await quote(REALM, "hearth", "part");

    expect(replay).toEqual(first);
    expect(afterReplay.soldToday).toBe(20);
    expect(afterReplay.pressure).toBe(afterFirst.pressure);

    const held = await pool!.query(`select quantity from item_balance where owner_id=$1 and item_key='part'`, [player]);
    expect(Number(held.rows[0].quantity)).toBe(80);

    const contribution = await pool!.query(`select contribution from contribution_epoch where player_id=$1`, [player]);
    expect(Number(contribution.rows[0].contribution)).toBeCloseTo(first.contribution, 4);
  });

  it("refuses to sell goods the player does not hold, and moves nothing", async () => {
    const player = await seed(3, 0);
    await expect(sellToDistrict({ idempotencyKey: randomUUID(), playerId: player, islandId: "hearth", itemKey: "part", quantity: 20 }))
      .rejects.toThrow();
    const held = await pool!.query(`select quantity from item_balance where owner_id=$1 and item_key='part'`, [player]);
    expect(Number(held.rows[0].quantity)).toBe(3);
    const paid = await pool!.query(`select balance from currency_account where owner_id=$1`, [player]);
    expect(Number(paid.rows[0].balance)).toBe(0);
  });

  it("settles a civic purchase and refuses goods the supplier does not sell", async () => {
    const player = await seed(0, 5_000);
    await stockCivicSupply("ore", 500);
    const buy = await buyFromCivic({ idempotencyKey: randomUUID(), playerId: player, islandId: "hearth", itemKey: "ore", quantity: 5 });
    expect(buy.quantity).toBe(5);
    const held = await pool!.query(`select quantity from item_balance where owner_id=$1 and item_key='ore'`, [player]);
    expect(Number(held.rows[0].quantity)).toBe(5);

    await expect(buyFromCivic({ idempotencyKey: randomUUID(), playerId: player, islandId: "hearth", itemKey: "waste", quantity: 1 }))
      .rejects.toThrow(EconomyError);
  });

  it("routes a share of tax into the reserve so emission has a source", async () => {
    const player = await seed(200, 0);
    await sellToDistrict({ idempotencyKey: randomUUID(), playerId: player, islandId: "hearth", itemKey: "part", quantity: 60 });
    const funded = await pool!.query<{ total: string }>(`select coalesce(sum(amount),0) as total from reserve_funding`);
    expect(Number(funded.rows[0]!.total)).toBeGreaterThan(0);
  });
});
