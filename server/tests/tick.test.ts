import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDatabase, pool } from "../src/database.js";
import { stockCivicSupply } from "../src/settlement.js";
import { IDLE_CONTRIBUTION_WEIGHT, runWorldTick } from "../src/tick.js";
import { TRADES } from "../src/trades.js";
import { FOUNDERS_ADVANCE, makerHoldings, registerBusiness, seedPlots } from "../src/world.js";
import { epochIdFor } from "../src/catalogue.js";

const live = Boolean(process.env.DATABASE_URL);
const suite = live ? describe : describe.skip;
const REALM = "sunwoven-1";

/** A busy corner and a quiet one, so siting can be compared. */
const BUSY = "GX072";
const QUIET = "GX036";

async function player(name: string): Promise<string> {
  const r = await pool!.query<{ id: string }>(
    "insert into player (display_name, wallet_address) values ($1, $2) returning id",
    [name, `W${name}${Math.random().toString(36).slice(2, 10)}`],
  );
  return r.rows[0]!.id;
}

async function giveItems(playerId: string, itemKey: string, quantity: number): Promise<void> {
  await pool!.query(
    `insert into item_balance (realm_id, owner_type, owner_id, item_key, quantity)
     values ($1,'player',$2,$3,$4)
     on conflict (realm_id, owner_type, owner_id, item_key)
     do update set quantity = item_balance.quantity + excluded.quantity`,
    [REALM, playerId, itemKey, quantity]);
}

async function items(playerId: string, itemKey: string): Promise<number> {
  const r = await pool!.query<{ quantity: string }>(
    "select quantity from item_balance where realm_id=$1 and owner_type='player' and owner_id=$2 and item_key=$3",
    [REALM, playerId, itemKey]);
  return Number(r.rows[0]?.quantity ?? 0);
}

async function balance(ownerType: string, ownerId: string): Promise<number> {
  const r = await pool!.query<{ balance: string }>(
    "select balance from currency_account where realm_id=$1 and owner_type=$2 and owner_id=$3",
    [REALM, ownerType, ownerId]);
  return Number(r.rows[0]?.balance ?? 0);
}

/** Every Merc Dollar the realm knows about. If this moves, something minted. */
async function totalCurrency(): Promise<number> {
  const r = await pool!.query<{ total: string }>(
    "select coalesce(sum(balance),0)::text as total from currency_account where realm_id=$1", [REALM]);
  return Number(r.rows[0]!.total);
}

async function contribution(playerId: string): Promise<number> {
  const r = await pool!.query<{ contribution: string }>(
    "select contribution from contribution_epoch where realm_id=$1 and epoch_id=$2 and player_id=$3",
    [REALM, epochIdFor(), playerId]);
  return Number(r.rows[0]?.contribution ?? 0);
}

/** Wind a business's clock back so the next pass sees elapsed time. */
async function age(plotId: string, hours: number): Promise<void> {
  await pool!.query(
    "update business set last_tick_at = now() - ($2 || ' hours')::interval where plot_id = $1",
    [plotId, String(hours)]);
}

async function openShop(plotId: string, licence: string, ownerId: string, appeal = 0): Promise<void> {
  await registerBusiness({
    realmId: REALM, playerId: ownerId, plotId, license: licence,
    condition: 100, upgrades: { yield: 0, capacity: 0, speed: 0, appeal },
  });
}

suite("the world ticks without anybody watching", () => {
  beforeEach(async () => {
    await pool!.query("delete from business");
    await pool!.query("update plot set owner_player_id = null, license = null");
    await pool!.query("delete from demand_day");
    await pool!.query("delete from contribution_epoch");
    await pool!.query("delete from command_receipt");
    await seedPlots(REALM);
    await pool!.query(
      `insert into currency_account (realm_id, owner_type, owner_id, currency_code, balance)
       values ($1,'player','citizens','MERCS',2000000)
       on conflict (realm_id, owner_type, owner_id, currency_code)
       do update set balance = 2000000`, [REALM]);
    for (const item of ["supply", "food", "water", "power", "part", "material", "crate", "produce", "waste"]) {
      await stockCivicSupply(item, 1_000_000);
    }
  });

  afterAll(async () => {
    // Put the shared tables back. A tick writes a command receipt against the owner and
    // moves value through the ledgers, and every one of those rows carries a player
    // foreign key — which is what blocks auth.test.ts from clearing players by wallet
    // address. Deleted in dependency order: ledger before account, receipts before the
    // players they name.
    await pool!.query("delete from business");
    await pool!.query("update plot set owner_player_id = null, license = null");
    await pool!.query("delete from command_receipt");
    await pool!.query("delete from contribution_epoch");
    await pool!.query("delete from item_ledger");
    await pool!.query("delete from currency_ledger");
    await pool!.query("delete from item_balance where owner_type = 'player'");
    await pool!.query("delete from currency_account where owner_type = 'player' and owner_id <> 'citizens'");
  });

  it("sells a stocked shop's goods to passers-by while the owner is away", async () => {
    const alice = await player("alice");
    await openShop(BUSY, "shop", alice);
    const retail = TRADES.shop!.retailItems[0]!;
    await giveItems(alice, retail, 200);
    await age(BUSY, 8);

    const citizensBefore = await balance("player", "citizens");
    const report = await runWorldTick();

    expect(report.sold).toBeGreaterThan(0);
    expect(report.gross).toBeGreaterThan(0);
    // The citizens paid for exactly what they carried off. Not asserting the shelf
    // shrank or the purse grew: the same pass restocks from the civic supplier and runs
    // production, and a shop that makes 10 units a cycle can easily end the pass with
    // MORE stock than it started with, having sold all day.
    expect(citizensBefore - (await balance("player", "citizens"))).toBe(report.gross);
    void retail;
  });

  it("creates no money doing it", async () => {
    const alice = await player("alice");
    await openShop(BUSY, "shop", alice);
    await giveItems(alice, TRADES.shop!.retailItems[0]!, 300);
    await age(BUSY, 12);

    const before = await totalCurrency();
    await runWorldTick();
    expect(await totalCurrency()).toBe(before);
  });

  it("pays the owner out of the citizens' pocket, and the city its tax", async () => {
    const alice = await player("alice");
    await openShop(BUSY, "shop", alice);
    await giveItems(alice, TRADES.shop!.retailItems[0]!, 200);
    await age(BUSY, 10);

    const citizensBefore = await balance("player", "citizens");
    const treasuryBefore = await balance("government", "treasury");
    const ownerBefore = await balance("player", alice);

    const report = await runWorldTick();

    const ownerGain = (await balance("player", alice)) - ownerBefore;
    const taxGain = (await balance("government", "treasury")) - treasuryBefore;
    const citizensSpend = citizensBefore - (await balance("player", "citizens"));

    expect(ownerGain + taxGain).toBe(citizensSpend);
    expect(ownerGain + taxGain).toBe(report.gross);
  });

  it("earns real contribution, at the idle weight", async () => {
    const alice = await player("alice");
    await openShop(BUSY, "shop", alice);
    await giveItems(alice, TRADES.shop!.retailItems[0]!, 200);
    await age(BUSY, 10);

    const report = await runWorldTick();
    expect(await contribution(alice)).toBeCloseTo(report.gross * IDLE_CONTRIBUTION_WEIGHT, 4);
  });

  it("earns more on a busy corner than a quiet one", async () => {
    const alice = await player("alice");
    const bob = await player("bob");
    await openShop(BUSY, "shop", alice);
    await openShop(QUIET, "shop", bob);
    const retail = TRADES.shop!.retailItems[0]!;
    await giveItems(alice, retail, 300);
    await giveItems(bob, retail, 300);
    await age(BUSY, 12);
    await age(QUIET, 12);

    const report = await runWorldTick();
    const busy = report.results.find((r) => r.plotId === BUSY)!;
    const quiet = report.results.find((r) => r.plotId === QUIET)!;

    expect(busy.footfall).toBeGreaterThan(quiet.footfall);
    expect(busy.unitsSold).toBeGreaterThan(quiet.unitsSold);
  });

  it("pays nothing for holding a plot with nothing built on it", async () => {
    // "No passive yield" in one test: idle earns because the business TRADED.
    const alice = await player("alice");
    await pool!.query("update plot set owner_player_id = $2 where id = $1", [BUSY, alice]);
    const before = await totalCurrency();
    const report = await runWorldTick();
    expect(report.businesses).toBe(0);
    expect(await totalCurrency()).toBe(before);
  });

  it("sells nothing from an empty shelf", async () => {
    const alice = await player("alice");
    await openShop(BUSY, "shop", alice);
    // A new business opens with starter inputs and would otherwise produce its own stock.
    await pool!.query("delete from item_balance where owner_type='player' and owner_id=$1", [alice]);
    await pool!.query("update currency_account set balance = 0 where owner_type='player' and owner_id=$1", [alice]);
    await age(BUSY, 24);
    const before = await balance("player", alice);
    const report = await runWorldTick();
    expect(report.sold).toBe(0);
    expect(await balance("player", alice)).toBe(before);
  });

  it("gives a mine no counter trade — households do not buy ore", async () => {
    const alice = await player("alice");
    await openShop(BUSY, "mine", alice);
    await giveItems(alice, "ore", 500);
    await age(BUSY, 12);
    const report = await runWorldTick();
    const mine = report.results.find((r) => r.plotId === BUSY);
    expect(mine?.unitsSold ?? 0).toBe(0);
  });

  it("advances production, consuming inputs to make outputs", async () => {
    const alice = await player("alice");
    await openShop(BUSY, "greenhouse", alice);
    const trade = TRADES.greenhouse!;
    for (const [item, per] of Object.entries(trade.inputs)) await giveItems(alice, item, per * 60);
    const outputKey = Object.keys(trade.output)[0]!;
    const inputKey = Object.keys(trade.inputs)[0]!;
    const inputsBefore = await items(alice, inputKey);
    await age(BUSY, 6);

    const report = await runWorldTick();

    expect(report.produced).toBeGreaterThan(0);
    expect(await items(alice, inputKey)).toBeLessThan(inputsBefore);
    expect(await items(alice, outputKey)).toBeGreaterThan(0);
  });

  it("produces nothing without the inputs to do it", async () => {
    const alice = await player("alice");
    await openShop(BUSY, "greenhouse", alice);
    // Strip the starter shelves AND the purse, or it simply buys more and carries on.
    await pool!.query("delete from item_balance where owner_type='player' and owner_id=$1", [alice]);
    await pool!.query("update currency_account set balance = 0 where owner_type='player' and owner_id=$1", [alice]);
    await age(BUSY, 12);
    const report = await runWorldTick();
    expect(report.produced).toBe(0);
  });

  it("does almost nothing when run twice in quick succession", async () => {
    const alice = await player("alice");
    await openShop(BUSY, "shop", alice);
    await giveItems(alice, TRADES.shop!.retailItems[0]!, 300);
    await age(BUSY, 10);

    const first = await runWorldTick();
    const second = await runWorldTick();

    expect(first.sold).toBeGreaterThan(0);
    // The clock was reset by the first pass, so the second has no elapsed time to settle.
    expect(second.sold).toBe(0);
    expect(second.skipped).toBeGreaterThan(0);
  });

  it("stops buying when the citizens have spent their money, instead of overdrawing", async () => {
    const alice = await player("alice");
    await openShop(BUSY, "shop", alice);
    await giveItems(alice, TRADES.shop!.retailItems[0]!, 500);
    await pool!.query(
      "update currency_account set balance = 1 where realm_id=$1 and owner_type='player' and owner_id='citizens'", [REALM]);
    await age(BUSY, 24);

    const report = await runWorldTick();
    expect(await balance("player", "citizens")).toBeGreaterThanOrEqual(0);
    expect(report.gross).toBe(0);
  });

  it("makes two shops on one street compete for the same day's appetite", async () => {
    // The point of settling through applySaleWithin: shared demand, not one quota each.
    const alice = await player("alice");
    const bob = await player("bob");
    await openShop(BUSY, "shop", alice);
    await openShop(QUIET, "shop", bob);
    const retail = TRADES.shop!.retailItems[0]!;
    await giveItems(alice, retail, 400);
    await giveItems(bob, retail, 400);
    await age(BUSY, 24);
    await age(QUIET, 24);

    await runWorldTick();
    const day = await pool!.query<{ units: string }>(
      "select units from demand_day where realm_id=$1 and island_id='hearth' and item_key=$2", [REALM, retail]);
    // One shared counter for the district, not two private ones.
    expect(day.rowCount).toBe(1);
    expect(Number(day.rows[0]!.units)).toBeGreaterThan(0);
  });

  it("moves a failing business's clock on rather than letting it bank time", async () => {
    const alice = await player("alice");
    await openShop(BUSY, "shop", alice);
    await age(BUSY, 100);
    await runWorldTick();
    const row = await pool!.query<{ seconds: string }>(
      "select extract(epoch from (now() - last_tick_at))::text as seconds from business where plot_id=$1", [BUSY]);
    expect(Number(row.rows[0]!.seconds)).toBeLessThan(60);
  });
});

suite("a business the authority can keep running", () => {
  beforeEach(async () => {
    await pool!.query("delete from business");
    await pool!.query("update plot set owner_player_id = null, license = null");
    await pool!.query("delete from demand_day");
    await pool!.query("delete from contribution_epoch");
    await pool!.query("delete from command_receipt");
    await pool!.query("delete from item_ledger");
    await pool!.query("delete from currency_ledger");
    await pool!.query("delete from item_balance");
    await pool!.query("delete from currency_account where owner_id <> 'citizens'");
    await seedPlots(REALM);
    await pool!.query(
      `insert into currency_account (realm_id, owner_type, owner_id, currency_code, balance)
       values ($1,'player','citizens','MERCS',5000000)
       on conflict (realm_id, owner_type, owner_id, currency_code) do update set balance = 5000000`, [REALM]);
    for (const item of ["supply", "food", "water", "power", "part", "material", "crate", "waste", "ore", "timber"]) {
      await stockCivicSupply(item, 1_000_000);
    }
  });

  it("gives a new maker an opening float and shelves to start from", async () => {
    const alice = await player("alice");
    await openShop(BUSY, "greenhouse", alice);
    expect(await balance("player", alice)).toBe(FOUNDERS_ADVANCE);
    for (const [item, per] of Object.entries(TRADES.greenhouse!.inputs)) {
      expect(await items(alice, item), `no starter ${item}`).toBeGreaterThanOrEqual(per);
    }
  });

  it("does not hand out a second advance for re-licensing", async () => {
    const alice = await player("alice");
    await openShop(BUSY, "greenhouse", alice);
    await pool!.query(
      "update currency_account set balance = 10 where realm_id=$1 and owner_type='player' and owner_id=$2",
      [REALM, alice]);
    await openShop(BUSY, "shop", alice);
    expect(await balance("player", alice)).toBe(10);
  });

  it("restocks itself from the civic supplier when the shelves run low", async () => {
    const alice = await player("alice");
    await openShop(BUSY, "greenhouse", alice);
    const inputKey = Object.keys(TRADES.greenhouse!.inputs)[0]!;
    await pool!.query(
      "update item_balance set quantity = 0 where realm_id=$1 and owner_id=$2 and item_key=$3",
      [REALM, alice, inputKey]);
    await age(BUSY, 2);

    const report = await runWorldTick();
    // The inputs are bought and then eaten by production in the same pass — that is the
    // loop working, so the evidence is the spend and the cycles, not a full shelf after.
    expect(report.spent).toBeGreaterThan(0);
    expect(report.produced).toBeGreaterThan(0);
    void inputKey;
  });

  it("never spends the whole purse restocking in one pass", async () => {
    const alice = await player("alice");
    await openShop(BUSY, "greenhouse", alice);
    await pool!.query("delete from item_balance where owner_id = $1", [alice]);
    await age(BUSY, 2);
    await runWorldTick();
    expect(await balance("player", alice)).toBeGreaterThan(0);
  });

  it("runs itself for a simulated week without minting a single Merc Dollar", async () => {
    // The real test of a self-sustaining world: buy, make, sell, repeat, and let the
    // ledger prove nothing appeared from nowhere along the way.
    const alice = await player("alice");
    const bob = await player("bob");
    await openShop(BUSY, "greenhouse", alice);
    await openShop(QUIET, "shop", bob);

    const opening = await totalCurrency();
    for (let pass = 0; pass < 14; pass += 1) {
      await pool!.query("update business set last_tick_at = now() - interval '12 hours'");
      await runWorldTick();
      expect(await totalCurrency(), `money supply moved on pass ${pass + 1}`).toBe(opening);
    }

    // And it actually did something, rather than stalling immediately.
    expect(await balance("player", alice)).toBeGreaterThan(0);
  });

  it("reports a maker's holdings from the ledger", async () => {
    const alice = await player("alice");
    await openShop(BUSY, "shop", alice);
    const holdings = await makerHoldings(REALM, alice);
    expect(holdings.wallet).toBe(FOUNDERS_ADVANCE);
    expect(Object.keys(holdings.inventory).length).toBeGreaterThan(0);
    expect(holdings.businesses.map((b) => b.plotId)).toEqual([BUSY]);
  });
});

// The pool belongs to the file, not to any one suite: closing it in a suite's afterAll
// leaves every later suite in the same file without a database.
afterAll(async () => {
  if (!live) return;
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
