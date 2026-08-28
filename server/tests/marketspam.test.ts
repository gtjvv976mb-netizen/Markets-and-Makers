// Order spam on the exchange.
//
// Reported from play: "players can spam create the orders". The client has a `marketBusy`
// flag, but that is a button state — it is bypassed by calling the API directly, and it
// never bounded how many listings one player may hold open at once. Listing is free and
// escrow only requires owning the goods, so a maker holding 500 units could open 500
// one-unit rows, or churn list/cancel forever at no cost.

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { pool, closeDatabase } from "../src/database.js";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { listItem, cancelListing, MarketError, MAX_OPEN_LISTINGS, MIN_LISTING_VALUE } from "../src/market.js";
import { live as liveDatabase } from "./live-database.js";

const suite = liveDatabase ? describe : describe.skip;
const REALM = "sunwoven-1";
const ISLAND = "hearth";

async function stocked(units: number): Promise<string> {
  const created = await pool!.query<{ id: string }>(
    `insert into player (display_name) values ('Spammer') returning id`);
  const id = created.rows[0]!.id;
  await pool!.query(
    `insert into item_balance (realm_id, owner_type, owner_id, item_key, quantity)
     values ($1,'player',$2,'part',$3)
     on conflict (realm_id,owner_type,owner_id,item_key) do update set quantity = excluded.quantity`,
    [REALM, id, units]);
  return id;
}

const openCount = async (id: string): Promise<number> => Number((await pool!.query<{ n: string }>(
  `select count(*)::text as n from market_listing where seller_player_id=$1 and status='open'`, [id])).rows[0]!.n);

const list = (seller: string, quantity = 1, unitPrice = 30) => listItem({
  idempotencyKey: randomUUID(), realmId: REALM, islandId: ISLAND,
  sellerPlayerId: seller, itemKey: "part", quantity, unitPrice,
});

suite("the exchange refuses order spam", () => {
  beforeEach(async () => {
    for (const table of ["market_listing", "item_ledger", "item_balance", "command_receipt", "payout_request"]) {
      await pool!.query(`delete from ${table}`);
    }
    await pool!.query(`delete from player`);
  });
  afterAll(async () => {
    for (const table of ["market_listing", "item_ledger", "item_balance", "command_receipt"]) {
      await pool!.query(`delete from ${table}`);
    }
    await pool!.query(`delete from player`);
    await closeDatabase();
  });

  it("caps how many listings one maker may hold open", async () => {
    // The spam itself: one unit at a time, as fast as the API allows. The unit price is
    // above MIN_LISTING_VALUE on purpose — with dust listings the floor would refuse them
    // first and this test would pass without the cap existing at all.
    const seller = await stocked(500);
    let refused = 0;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try { await list(seller); } catch (error) {
        expect(error).toBeInstanceOf(MarketError);
        refused += 1;
      }
    }
    const open = await openCount(seller);
    expect(open, `a maker held ${open} listings open`).toBeLessThanOrEqual(25);
    expect(refused, "and the surplus attempts were refused, not silently dropped").toBeGreaterThan(0);
  });

  it("refuses dust listings that exist only to fill the book", async () => {
    // A one-unit, one-Merc row costs the spammer nothing and costs every reader a line.
    const seller = await stocked(500);
    await expect(list(seller, 1, 1)).rejects.toThrow(MarketError);
  });

  it("still allows a normal maker to trade freely", async () => {
    // The cap must not be a tax on ordinary play: a handful of real listings must pass.
    const seller = await stocked(500);
    for (let i = 0; i < 8; i += 1) await list(seller, 10, 25);
    expect(await openCount(seller)).toBe(8);
  });

  it("frees a slot when a listing is cancelled", async () => {
    const seller = await stocked(500);
    const first = await list(seller, 10, 25);
    const before = await openCount(seller);
    await cancelListing({ idempotencyKey: randomUUID(), listingId: first.listingId, sellerPlayerId: seller });
    expect(await openCount(seller), "cancelling returns the slot").toBe(before - 1);
    await expect(list(seller, 10, 25)).resolves.toBeTruthy();
  });

  it("cannot be raced past the cap by simultaneous requests", async () => {
    const seller = await stocked(500);
    await Promise.allSettled(Array.from({ length: 40 }, () => list(seller, 1, 25)));
    const open = await openCount(seller);
    expect(open, `${open} listings open after 40 simultaneous attempts`).toBeLessThanOrEqual(25);
  });
});

// The client mirrors both limits so the panel can say "18 of 20" and refuse a dust
// listing before a player fills in a form. A limit written in two files is a limit that
// drifts, and the drift shows up as the panel promising something the server rejects —
// which is how a player learns a rule by losing to it.
describe("the client's copy of the limits", () => {
  const clientMain = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../../game/src/main.ts"), "utf8");
  const constant = (source: string, name: string): number => {
    const found = source.match(new RegExp(`${name}\\s*=\\s*(\\d[\\d_]*)`));
    if (!found) throw new Error(`${name} not found`);
    return Number(found[1]!.replace(/_/g, ""));
  };

  it("agrees with the authority on the open-listing cap", () => {
    expect(constant(clientMain, "MAX_OPEN_LISTINGS")).toBe(MAX_OPEN_LISTINGS);
  });

  it("agrees with the authority on the minimum listing value", () => {
    expect(constant(clientMain, "MIN_LISTING_VALUE")).toBe(MIN_LISTING_VALUE);
  });
});
