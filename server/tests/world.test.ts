import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDatabase, pool } from "../src/database.js";
import { ISLAND_IDS, PLOTS, PLOTS_BY_ID } from "../src/plots.js";
import {
  allBusinesses, districtBusinesses, FOUNDERS_ADVANCE, MAX_UPGRADE_LEVEL, registerBusiness,
  makerHoldings, releaseBusiness, seedPlots, UPGRADE_COST_MERCS, WorldError,
} from "../src/world.js";
import { live as liveDatabase } from "./live-database.js";

// See live-database.ts: these suites EMPTY their tables, so they refuse to run
// against a database that is not obviously disposable.
const live = liveDatabase;
const suite = live ? describe : describe.skip;
const REALM = "sunwoven-1";
const TREASURY_FLOAT = 8_000_000;

async function player(name: string): Promise<string> {
  const r = await pool!.query<{ id: string }>(
    "insert into player (display_name, wallet_address) values ($1, $2) returning id",
    [name, `Wallet${name}${Math.random().toString(36).slice(2, 10)}`],
  );
  return r.rows[0]!.id;
}

async function balance(ownerType: string, ownerId: string): Promise<number> {
  const r = await pool!.query<{ balance: string }>(
    `select balance::text as balance from currency_account
      where realm_id = $1 and owner_type = $2 and owner_id = $3 and currency_code = 'MERCS'`,
    [REALM, ownerType, ownerId],
  );
  return Number(r.rows[0]?.balance ?? 0);
}

async function totalCurrency(): Promise<number> {
  const r = await pool!.query<{ total: string }>(
    "select coalesce(sum(balance),0)::text as total from currency_account where realm_id = $1", [REALM]);
  return Number(r.rows[0]!.total);
}

/**
 * Give a maker spending money the way the realm does: by MOVING it out of the treasury.
 * A fixture that inserted a balance would mint, which is the very thing registerBusiness
 * stopped doing — no test in here should be the one putting money into the world.
 */
async function fundFromTreasury(playerId: string, amount: number): Promise<void> {
  await pool!.query(
    `insert into currency_account (realm_id, owner_type, owner_id, currency_code, balance)
     values ($1,'player',$2,'MERCS',0)
     on conflict (realm_id, owner_type, owner_id, currency_code) do nothing`,
    [REALM, playerId]);
  await pool!.query(
    `update currency_account set balance = balance - $2
      where realm_id = $1 and owner_type = 'government' and owner_id = 'treasury' and currency_code = 'MERCS'`,
    [REALM, amount]);
  await pool!.query(
    `update currency_account set balance = balance + $3
      where realm_id = $1 and owner_type = 'player' and owner_id = $2 and currency_code = 'MERCS'`,
    [REALM, playerId, amount]);
}

/** What the equipment ladder costs to climb from one level to another, per the server's table. */
function ladderCost(from: number, to: number): number {
  let owed = 0;
  for (let level = from + 1; level <= to; level += 1) owed += UPGRADE_COST_MERCS[level] ?? 0;
  return owed;
}

/** The exported layout is generated, so these hold with or without a database. */
describe("the exported world layout", () => {
  it("carries every plot the client knows about", () => {
    expect(PLOTS.length).toBeGreaterThan(200);
    expect(PLOTS_BY_ID.size).toBe(PLOTS.length);
  });

  it("gives each plot a district and a footfall score in range", () => {
    for (const plot of PLOTS) {
      expect(plot.island, `${plot.id} has no district`).toBeTruthy();
      expect(plot.footfall, `${plot.id} scored ${plot.footfall}`).toBeGreaterThan(0);
      expect(plot.footfall).toBeLessThanOrEqual(1);
    }
  });

  it("spreads footfall enough for siting to be a real decision", () => {
    const hearth = PLOTS.filter((plot) => plot.island === "hearth").map((plot) => plot.footfall);
    expect(Math.max(...hearth) / Math.min(...hearth)).toBeGreaterThan(2);
  });

  it("names every district exactly once", () => {
    expect(new Set(ISLAND_IDS).size).toBe(ISLAND_IDS.length);
    expect(ISLAND_IDS.length).toBeGreaterThan(1);
  });
});

suite("the world registry", () => {
  beforeEach(async () => {
    await pool!.query("delete from business");
    await pool!.query("update plot set owner_player_id = null, license = null");
    // The founder's advance is MOVED out of the government treasury now instead of being
    // minted, and equipment is bought out of a maker's own balance, so this suite needs a
    // solvent realm to register into. Emptying the ledger as well keeps the realm-wide 24h
    // advance cap from carrying between cases.
    await pool!.query("delete from currency_ledger");
    await pool!.query("delete from currency_account");
    await pool!.query(
      `insert into currency_account (realm_id, owner_type, owner_id, currency_code, balance)
       values ($1,'government','treasury','MERCS',$2)
       on conflict (realm_id, owner_type, owner_id, currency_code) do update set balance = excluded.balance`,
      [REALM, TREASURY_FLOAT]);
    await seedPlots(REALM);
  });

  afterAll(async () => {
    // Leave the shared tables as they were found. These tests plant players and point
    // plot.owner_player_id at them; auth.test.ts clears players by wallet address, and
    // the foreign key from plot refuses that while the pointers are still live. Cleaning
    // up here rather than only in beforeEach is what keeps the suites independent.
    await pool!.query("delete from business");
    await pool!.query("update plot set owner_player_id = null, license = null");
    await closeDatabase();
  });

  it("puts the whole layout in the database, and does it idempotently", async () => {
    const first = await pool!.query<{ n: string }>("select count(*)::text as n from plot where realm_id = $1", [REALM]);
    await seedPlots(REALM);
    const second = await pool!.query<{ n: string }>("select count(*)::text as n from plot where realm_id = $1", [REALM]);
    expect(Number(first.rows[0]!.n)).toBe(PLOTS.length);
    expect(second.rows[0]!.n).toBe(first.rows[0]!.n);
  });

  it("records a business where a maker builds one", async () => {
    const alice = await player("alice");
    const saved = await registerBusiness({
      realmId: REALM, playerId: alice, plotId: "GX072", license: "shop",
      condition: 96, upgrades: { yield: 2, capacity: 1, speed: 0, appeal: 3 },
    });
    expect(saved.plotId).toBe("GX072");
    expect(saved.license).toBe("shop");
    expect(saved.condition).toBe(96);
    // CHANGED: equipment is paid for now. A business that did not exist a moment ago opens
    // at level 0 whatever the client asserts, so the appeal:3 above buys nothing — it used
    // to be recorded free, and the tick settles real output against these very numbers.
    // Levels are bought one at a time on a later registration; see the re-license case.
    expect(saved.upgrades).toEqual({ yield: 0, capacity: 0, speed: 0, appeal: 0 });
    expect(saved.footfall).toBeGreaterThan(0);
    expect(saved.mine).toBe(true);
  });

  it("advances the founder out of the treasury rather than minting the money", async () => {
    // CHANGED: the 750 used to be a bare insert into currency_account — no debit, no ledger
    // row. It minted, and identities here are free, so every new wallet inflated the supply.
    // It is a transfer from government/treasury now, which is what these three assert.
    const supplyBefore = await totalCurrency();
    const alice = await player("alice");
    await registerBusiness({ realmId: REALM, playerId: alice, plotId: "GX072", license: "shop",
      condition: 100, upgrades: { yield: 0, capacity: 0, speed: 0, appeal: 0 } });

    expect(await balance("player", alice)).toBe(FOUNDERS_ADVANCE);
    expect(await balance("government", "treasury")).toBe(TREASURY_FLOAT - FOUNDERS_ADVANCE);
    expect(await totalCurrency()).toBe(supplyBefore);

    // And it is in the ledger, so the money can be traced rather than merely appearing.
    const posted = await pool!.query<{ amount: string }>(
      "select amount::text as amount from currency_ledger where realm_id = $1 and reason = 'world.advance'", [REALM]);
    expect(posted.rows.map((row) => Number(row.amount))).toEqual([FOUNDERS_ADVANCE]);
  });

  it("still opens the business when the treasury cannot fund the advance", async () => {
    // The advance is best effort: a thin treasury must not turn into a closed door for new
    // players. They register anyway and simply open at zero.
    await pool!.query(
      `update currency_account set balance = 0
        where realm_id = $1 and owner_type = 'government' and owner_id = 'treasury'`, [REALM]);
    const alice = await player("alice");
    const saved = await registerBusiness({ realmId: REALM, playerId: alice, plotId: "GX072", license: "shop",
      condition: 100, upgrades: { yield: 0, capacity: 0, speed: 0, appeal: 0 } });

    expect(saved.plotId).toBe("GX072");
    expect(saved.mine).toBe(true);
    expect(await balance("player", alice)).toBe(0);
    expect(await balance("government", "treasury")).toBe(0);
  });

  it("refuses a plot another maker already holds", async () => {
    const alice = await player("alice");
    const bob = await player("bob");
    await registerBusiness({ realmId: REALM, playerId: alice, plotId: "GX072", license: "shop",
      condition: 100, upgrades: { yield: 0, capacity: 0, speed: 0, appeal: 0 } });

    await expect(registerBusiness({ realmId: REALM, playerId: bob, plotId: "GX072", license: "gym",
      condition: 100, upgrades: { yield: 0, capacity: 0, speed: 0, appeal: 0 } }))
      .rejects.toThrow(WorldError);

    // Alice still owns it, still a shop.
    const district = await districtBusinesses(REALM, "hearth", alice);
    const held = district.find((entry) => entry.plotId === "GX072");
    expect(held?.license).toBe("shop");
    expect(held?.mine).toBe(true);
  });

  it("lets the owner re-license and upgrade their own plot", async () => {
    const alice = await player("alice");
    await registerBusiness({ realmId: REALM, playerId: alice, plotId: "GX072", license: "shop",
      condition: 100, upgrades: { yield: 0, capacity: 0, speed: 0, appeal: 0 } });
    // CHANGED: upgrades are bought now, one level at a time, out of the maker's own balance
    // and into the treasury. The founder's advance alone does not cover this order, so the
    // fixture tops Alice up first — from the treasury, not out of nowhere.
    await fundFromTreasury(alice, 10_000);
    const purseBefore = await balance("player", alice);
    const treasuryBefore = await balance("government", "treasury");

    const again = await registerBusiness({ realmId: REALM, playerId: alice, plotId: "GX072", license: "restaurant",
      condition: 80, upgrades: { yield: 4, capacity: 2, speed: 1, appeal: 5 } });
    expect(again.license).toBe("restaurant");
    expect(again.upgrades.yield).toBe(4);
    expect(again.upgrades.capacity).toBe(2);
    expect(again.upgrades.speed).toBe(1);
    // appeal:5 is above the client's own cost table, so it is clamped rather than sold.
    expect(again.upgrades.appeal).toBe(MAX_UPGRADE_LEVEL);

    const cost = ladderCost(0, 4) + ladderCost(0, 2) + ladderCost(0, 1) + ladderCost(0, MAX_UPGRADE_LEVEL);
    expect(cost, `the ladder 0→4/2/1/${MAX_UPGRADE_LEVEL} costs ${cost}`).toBe(2330);
    expect(await balance("player", alice)).toBe(purseBefore - cost);
    expect(await balance("government", "treasury")).toBe(treasuryBefore + cost);

    const rows = await pool!.query<{ revision: string }>("select revision::text from business where plot_id = $1", ["GX072"]);
    expect(Number(rows.rows[0]!.revision)).toBeGreaterThan(1);
  });

  it("records no upgrade the owner could not pay for", async () => {
    // The payment and the row are one transaction: if the balance will not cover the
    // equipment, the whole registration rolls back rather than banking free levels.
    const alice = await player("alice");
    await registerBusiness({ realmId: REALM, playerId: alice, plotId: "GX072", license: "shop",
      condition: 100, upgrades: { yield: 0, capacity: 0, speed: 0, appeal: 0 } });
    const purse = await balance("player", alice);
    expect(purse).toBeLessThan(ladderCost(0, MAX_UPGRADE_LEVEL));

    await expect(registerBusiness({ realmId: REALM, playerId: alice, plotId: "GX072", license: "restaurant",
      condition: 80, upgrades: { yield: MAX_UPGRADE_LEVEL, capacity: 0, speed: 0, appeal: 0 } }))
      .rejects.toThrow(/insufficient|Not enough/i);

    const [held] = await districtBusinesses(REALM, "hearth", alice);
    expect(held!.license).toBe("shop");
    expect(held!.upgrades.yield).toBe(0);
    expect(await balance("player", alice)).toBe(purse);
  });

  it("clamps anything a client sends rather than trusting it", async () => {
    const alice = await player("alice");
    const saved = await registerBusiness({
      realmId: REALM, playerId: alice, plotId: "GX072", license: "shop",
      condition: 500,
      upgrades: { yield: 99, capacity: -5, speed: 3, appeal: 2 } as never,
    });
    expect(saved.condition).toBe(100);
    // CHANGED: a first registration cannot assert its way onto equipment at all now — it
    // opens at zero and buys from there. The old expectation (yield clamped to 10, speed
    // taken at 3, free) let the very first call claim roughly eleven times the throughput.
    expect(saved.upgrades).toEqual({ yield: 0, capacity: 0, speed: 0, appeal: 0 });

    // The clamp itself still holds on the paid path: 99 is sold as MAX_UPGRADE_LEVEL, and
    // a negative level is floored at 0 rather than refunding or corrupting the column.
    await fundFromTreasury(alice, 10_000);
    const purseBefore = await balance("player", alice);
    const again = await registerBusiness({
      realmId: REALM, playerId: alice, plotId: "GX072", license: "shop",
      condition: 500,
      upgrades: { yield: 99, capacity: -5, speed: 3, appeal: 2 } as never,
    });
    expect(again.upgrades.yield).toBe(MAX_UPGRADE_LEVEL);
    expect(again.upgrades.capacity).toBe(0);
    expect(again.upgrades.speed).toBe(3);
    expect(again.upgrades.appeal).toBe(2);
    // Charged for exactly the levels it recorded, not for the 99 it asked for.
    const cost = ladderCost(0, MAX_UPGRADE_LEVEL) + ladderCost(0, 3) + ladderCost(0, 2);
    expect(cost, `the clamped ladder costs ${cost}`).toBe(1740);
    expect(await balance("player", alice)).toBe(purseBefore - cost);
  });

  it("refuses a plot that does not exist in this world", async () => {
    const alice = await player("alice");
    await expect(registerBusiness({ realmId: REALM, playerId: alice, plotId: "not-a-plot", license: "shop",
      condition: 100, upgrades: { yield: 0, capacity: 0, speed: 0, appeal: 0 } }))
      .rejects.toThrow(/unknown-plot|No plot named/);
  });

  it("refuses a business with no licence", async () => {
    const alice = await player("alice");
    await expect(registerBusiness({ realmId: REALM, playerId: alice, plotId: "GX072", license: "",
      condition: 100, upgrades: { yield: 0, capacity: 0, speed: 0, appeal: 0 } }))
      .rejects.toThrow(/license-required|needs a licence/);
  });

  it("shows every maker the same district, and tells each which shop is theirs", async () => {
    // The whole point of the registry: before this, no player could see another's shop.
    const alice = await player("alice");
    const bob = await player("bob");
    await registerBusiness({ realmId: REALM, playerId: alice, plotId: "GX072", license: "shop",
      condition: 100, upgrades: { yield: 0, capacity: 0, speed: 0, appeal: 0 } });
    await registerBusiness({ realmId: REALM, playerId: bob, plotId: "GX036", license: "greenhouse",
      condition: 100, upgrades: { yield: 0, capacity: 0, speed: 0, appeal: 0 } });

    const asAlice = await districtBusinesses(REALM, "hearth", alice);
    const asBob = await districtBusinesses(REALM, "hearth", bob);

    expect(asAlice.map((e) => e.plotId).sort()).toEqual(["GX036", "GX072"]);
    expect(asAlice.map((e) => e.plotId).sort()).toEqual(asBob.map((e) => e.plotId).sort());
    expect(asAlice.find((e) => e.plotId === "GX072")!.mine).toBe(true);
    expect(asAlice.find((e) => e.plotId === "GX036")!.mine).toBe(false);
    expect(asBob.find((e) => e.plotId === "GX036")!.mine).toBe(true);
  });

  it("publishes only the ends of an owner's wallet, never the whole address", async () => {
    const alice = await player("alice");
    const full = await pool!.query<{ wallet_address: string }>("select wallet_address from player where id = $1", [alice]);
    const address = full.rows[0]!.wallet_address;
    await registerBusiness({ realmId: REALM, playerId: alice, plotId: "GX072", license: "shop",
      condition: 100, upgrades: { yield: 0, capacity: 0, speed: 0, appeal: 0 } });

    const [listed] = await districtBusinesses(REALM, "hearth");
    expect(listed!.owner).not.toBe(address);
    expect(listed!.owner).toContain("…");
    expect(listed!.owner.length).toBeLessThan(address.length);
  });

  it("keeps districts apart", async () => {
    const alice = await player("alice");
    await registerBusiness({ realmId: REALM, playerId: alice, plotId: "GX072", license: "shop",
      condition: 100, upgrades: { yield: 0, capacity: 0, speed: 0, appeal: 0 } });
    const elsewhere = ISLAND_IDS.find((id) => id !== "hearth")!;
    expect(await districtBusinesses(REALM, elsewhere)).toHaveLength(0);
  });

  it("releases a plot back to the world, and only for its owner", async () => {
    const alice = await player("alice");
    const bob = await player("bob");
    await registerBusiness({ realmId: REALM, playerId: alice, plotId: "GX072", license: "shop",
      condition: 100, upgrades: { yield: 0, capacity: 0, speed: 0, appeal: 0 } });

    expect(await releaseBusiness(bob, "GX072")).toBe(false);
    expect(await districtBusinesses(REALM, "hearth")).toHaveLength(1);

    expect(await releaseBusiness(alice, "GX072")).toBe(true);
    expect(await districtBusinesses(REALM, "hearth")).toHaveLength(0);

    // And it is genuinely free again, not merely hidden.
    await registerBusiness({ realmId: REALM, playerId: bob, plotId: "GX072", license: "gym",
      condition: 100, upgrades: { yield: 0, capacity: 0, speed: 0, appeal: 0 } });
    const [taken] = await districtBusinesses(REALM, "hearth", bob);
    expect(taken!.license).toBe("gym");
    expect(taken!.mine).toBe(true);
  });

  it("hands the tick loop every business in the realm, with its footfall", async () => {
    const alice = await player("alice");
    const bob = await player("bob");
    await registerBusiness({ realmId: REALM, playerId: alice, plotId: "GX072", license: "shop",
      condition: 100, upgrades: { yield: 0, capacity: 0, speed: 0, appeal: 0 } });
    await registerBusiness({ realmId: REALM, playerId: bob, plotId: "GX036", license: "greenhouse",
      condition: 100, upgrades: { yield: 0, capacity: 0, speed: 0, appeal: 0 } });

    const all = await allBusinesses(REALM);
    expect(all).toHaveLength(2);
    for (const entry of all) {
      expect(entry.footfall).toBe(PLOTS_BY_ID.get(entry.plotId)!.footfall);
      expect(entry.owner).toMatch(/^[0-9a-f-]{36}$/i);   // the real id, for crediting
    }
  });

  it("tells an unbuilt maker apart from a broke one", async () => {
    // "No ledger account" and "an account holding nothing" are the same number and
    // completely different facts. The founder's advance moves on the FIRST registration,
    // so a maker who has signed in and not yet built has no account — and reporting that
    // as a balance of 0 made the client show 0 MERCS while the browser's own 750 was what
    // every purchase actually spent.
    const newcomer = await player("never-built");
    const before = await makerHoldings(REALM, newcomer);
    console.log(`UNBUILT hasAccount=${before.hasAccount} wallet=${before.wallet}`);
    expect(before.hasAccount).toBe(false);

    await registerBusiness({ realmId: REALM, playerId: newcomer, plotId: "GX072", license: "shop",
      condition: 100, upgrades: { yield: 0, capacity: 0, speed: 0, appeal: 0 } });
    const after = await makerHoldings(REALM, newcomer);
    console.log(`AFTER BUILDING hasAccount=${after.hasAccount} wallet=${after.wallet}`);
    expect(after.hasAccount).toBe(true);
    expect(after.wallet).toBe(FOUNDERS_ADVANCE);
  });
});
