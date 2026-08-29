import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { pool, closeDatabase } from "../src/database.js";
import {
  districtQuota, epochBudget, epochStanding, fundReserve, islandBoard, quote, recordPurchase, recordSale,
} from "../src/economy.js";
import { CHAIN_PREMIUM_MAX, CITIZEN_NAME, CURRENCY_CODE, CURRENCY_NAME, EPOCH_MM_BUDGET, MERC_DOLLARS_PER_MM, MIN_EPOCH_PAYOUT, PRESSURE_MAX, PRESSURE_MIN, REALM_NAME, RESERVE_FUNDING_RATE, RESOURCES, epochIdFor } from "../src/catalogue.js";
import { chainPremium, derivedDemand, unitPriceAt } from "../src/economy.js";
import { live as liveDatabase } from "./live-database.js";

// See live-database.ts: these suites EMPTY their tables, so they refuse to run
// against a database that is not obviously disposable.
const live = liveDatabase;
const suite = live ? describe : describe.skip;
const REALM = "sunwoven-1";

describe("Mercedonia economy canon", () => {
  it("publishes one world, citizen, and Merc Dollar identity", () => {
    expect(REALM_NAME).toBe("Mercedonia");
    expect(CITIZEN_NAME).toBe("Mercedonians");
    expect(CURRENCY_NAME).toBe("Merc Dollars");
    expect(CURRENCY_CODE).toBe("MERCS");
  });
});

async function player(name: string): Promise<string> {
  const r = await pool!.query<{ id: string }>(`insert into player (display_name) values ($1) returning id`, [name]);
  return r.rows[0]!.id;
}

suite("shared district economy", () => {
  beforeEach(async () => {
    await pool!.query("delete from demand_day");
    await pool!.query("delete from market_pressure");
    await pool!.query("delete from contribution_epoch");
    await pool!.query("delete from reserve_funding");
  });
  afterAll(async () => { await closeDatabase(); });

  it("makes one player's selling move the price every other player sees", async () => {
    const before = await quote(REALM, "hearth", "part");
    expect(before.pressure).toBe(1);

    const seller = await player("Seller");
    await recordSale({ realmId: REALM, islandId: "hearth", itemKey: "part", quantity: 40, playerId: seller, contributionWeight: .1 });

    const after = await quote(REALM, "hearth", "part");
    expect(after.pressure).toBeLessThan(before.pressure);
    expect(after.buy).toBeLessThan(before.buy);
  });

  it("shares one daily allowance across the district, not one per player", async () => {
    const a = await player("A");
    const b = await player("B");
    const q = districtQuota("part");

    // A consumes the whole district allowance.
    const first = await recordSale({ realmId: REALM, islandId: "hearth", itemKey: "part", quantity: q, playerId: a, contributionWeight: .1 });
    // B now sells into a district A has already saturated.
    const second = await recordSale({ realmId: REALM, islandId: "hearth", itemKey: "part", quantity: 1, playerId: b, contributionWeight: .1 });

    expect(second.firstUnit).toBeLessThan(first.firstUnit);
    const board = await quote(REALM, "hearth", "part");
    expect(board.soldToday).toBe(q + 1);
  });

  it("keeps islands economically distinct", async () => {
    const a = await player("A");
    await recordSale({ realmId: REALM, islandId: "hearth", itemKey: "part", quantity: 60, playerId: a, contributionWeight: .1 });
    const hearth = await quote(REALM, "hearth", "part");
    const kiln = await quote(REALM, "kiln", "part");
    expect(hearth.soldToday).toBe(60);
    expect(kiln.soldToday).toBe(0);
    expect(kiln.pressure).toBeGreaterThan(hearth.pressure);
  });

  it("pushes the price up when players buy from the civic supplier", async () => {
    const before = await quote(REALM, "hearth", "ore");
    await recordPurchase({ realmId: REALM, islandId: "hearth", itemKey: "ore", quantity: 50 });
    const after = await quote(REALM, "hearth", "ore");
    expect(after.pressure).toBeGreaterThan(before.pressure);
    expect(after.buy).toBeGreaterThan(before.buy);
  });

  it("computes the cohort from real players rather than a constant", async () => {
    const me = await player("Me");
    const rival = await player("Rival");
    await recordSale({ realmId: REALM, islandId: "hearth", itemKey: "food", quantity: 30, playerId: me, contributionWeight: 1 });
    await recordSale({ realmId: REALM, islandId: "lantern", itemKey: "food", quantity: 90, playerId: rival, contributionWeight: 1 });

    const standing = await epochStanding(REALM, me);
    expect(standing.contributors).toBe(2);
    expect(standing.total).toBeCloseTo(standing.mine + standing.cohort, 4);
    expect(standing.share).toBeGreaterThan(0);
    expect(standing.share).toBeLessThan(1);
    // Share is my slice of a real pool, so the rival's work genuinely dilutes me.
    expect(standing.mine).toBeLessThan(standing.cohort);
  });

  it("never rounds a real contributor down to nothing however crowded the realm is", async () => {
    const me = await player("Small");
    await recordSale({ realmId: REALM, islandId: "hearth", itemKey: "water", quantity: 1, playerId: me, contributionWeight: .1 });
    // Flood the epoch with a very large cohort.
    for (let i = 0; i < 5; i += 1) {
      const whale = await player(`Whale${i}`);
      await pool!.query(
        `insert into contribution_epoch (realm_id, epoch_id, player_id, contribution) values ($1,$2,$3,$4)`,
        [REALM, epochIdFor(), whale, 5_000_000]);
    }
    const standing = await epochStanding(REALM, me);
    expect(standing.share).toBeLessThan(0.0001);
    expect(standing.projected).toBe(MIN_EPOCH_PAYOUT);
  });

  it("funds the next epoch's budget from fees instead of only draining the vault", async () => {
    const epoch = epochIdFor();
    const base = await epochBudget(REALM, epoch + 1);
    expect(base).toBe(EPOCH_MM_BUDGET);

    await fundReserve(REALM, 40_000, "market.fee");
    const funded = await epochBudget(REALM, epoch + 1);
    // fundReserve applies RESERVE_FUNDING_RATE on the way IN (0.35 x 40,000 = 14,000 Merc
    // Dollars banked), and epochBudget converts through the peg on the way OUT (/100 = 140
    // $MM). The old expectation applied the rate a second time and skipped the peg — it was
    // never right, and it hid behind the 60k/75k budget discrepancy this suite also carried.
    expect(funded).toBe(EPOCH_MM_BUDGET + Math.floor((40_000 * RESERVE_FUNDING_RATE) / MERC_DOLLARS_PER_MM));
    expect(funded).toBeGreaterThan(base);
  });

  it("quotes every resource for an island", async () => {
    const board = await islandBoard(REALM, "tide");
    expect(board).toHaveLength(Object.keys(RESOURCES).length);
    for (const row of board) {
      expect(row.buy).toBeGreaterThan(0);
      expect(row.sell).toBeGreaterThan(0);
      expect(row.currencyCode).toBe(CURRENCY_CODE);
      // The civic spread must hold on the server exactly as it does on the client.
      expect(row.sell).toBeLessThan(row.buy);
    }
  });
});

describe("the chain, priced", () => {
  it("never lets a good be bought at the counter and sold back for more", () => {
    // The arbitrage guard. The chain premium lifts what the district pays a maker, and it
    // has to stop below the civic supplier's asking price or buying from the counter and
    // selling it straight back is free money. Checked across the whole pressure range,
    // because the two prices scale together and only their ROUNDING can cross.
    // Swept across neighbours too: the chain premium GROWS with how busy a district is, so
    // a crowded street is exactly where the sell price would climb over the counter price
    // if the ceiling were not holding it.
    for (const key of Object.keys(RESOURCES)) {
      for (const pressure of [PRESSURE_MIN, 0.85, 1, 1.2, PRESSURE_MAX]) {
        for (const neighbours of [0, 1, 5, 20, 100, 400]) {
          const buy = Math.max(1, Math.round(RESOURCES[key]!.governmentPrice * pressure));
          const sell = unitPriceAt(key, pressure, 0, neighbours);
          expect(sell, `${key} at pressure ${pressure} with ${neighbours} neighbours sells for ${sell} but costs ${buy}`)
            .toBeLessThan(buy);
        }
      }
    }
  });

  it("gives every good in the chain a business customer", () => {
    // Derived demand is summed from the generated recipes. A good nobody consumes has only
    // the civic budget for a buyer, which is the exact condition that made every primary
    // producer unprofitable.
    const orphans = Object.keys(RESOURCES).filter((key) => derivedDemand(key) <= 0);
    expect(orphans, `goods no trade buys as an input: ${orphans.join(", ")}`).toEqual([]);
  });

  it("counts the chain's appetite as part of the district's allowance", () => {
    for (const key of Object.keys(RESOURCES)) {
      expect(districtQuota(key), `${key} quota must cover its chain draw`)
        .toBeGreaterThanOrEqual(Math.round(derivedDemand(key)));
      expect(chainPremium(key)).toBeGreaterThan(1);
      expect(chainPremium(key)).toBeLessThanOrEqual(1 + CHAIN_PREMIUM_MAX);
    }
  });

  it("makes a district worth more to everyone as it fills up", () => {
    // The cooperative claim on the authoritative side. More makers on the street means a
    // deeper market for the goods they buy from each other, which means a better price and
    // a smaller dent from each sale. Monotonic, or a neighbour is a rival instead.
    for (const key of Object.keys(RESOURCES)) {
      let previousQuota = districtQuota(key, 0);
      let previousPremium = chainPremium(key, 0);
      for (const neighbours of [1, 3, 10, 40]) {
        const quota = districtQuota(key, neighbours);
        const premium = chainPremium(key, neighbours);
        expect(quota, `${key}: ${neighbours} neighbours must deepen the market`).toBeGreaterThan(previousQuota);
        expect(premium, `${key}: ${neighbours} neighbours must not pay worse`).toBeGreaterThanOrEqual(previousPremium);
        previousQuota = quota;
        previousPremium = premium;
      }
    }
  });
});
