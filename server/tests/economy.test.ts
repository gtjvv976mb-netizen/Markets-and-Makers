import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { pool, closeDatabase } from "../src/database.js";
import {
  districtQuota, epochBudget, epochStanding, fundReserve, islandBoard, quote, recordPurchase, recordSale,
} from "../src/economy.js";
import { CHAIN_PREMIUM_MAX, CITIZEN_NAME, CURRENCY_CODE, CURRENCY_NAME, EPOCH_MM_BUDGET, MIN_EPOCH_PAYOUT, PRESSURE_MAX, PRESSURE_MIN, REALM_NAME, RESERVE_FUNDING_RATE, RESOURCES, epochIdFor } from "../src/catalogue.js";
import { chainPremium, derivedDemand, unitPriceAt } from "../src/economy.js";

const live = Boolean(process.env.DATABASE_URL);
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
    expect(funded).toBe(EPOCH_MM_BUDGET + Math.floor(40_000 * RESERVE_FUNDING_RATE));
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
    for (const key of Object.keys(RESOURCES)) {
      for (const pressure of [PRESSURE_MIN, 0.85, 1, 1.2, PRESSURE_MAX]) {
        const buy = Math.max(1, Math.round(RESOURCES[key]!.governmentPrice * pressure));
        const sell = unitPriceAt(key, pressure, 0);
        expect(sell, `${key} at pressure ${pressure} sells for ${sell} but costs ${buy}`).toBeLessThan(buy);
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
});
