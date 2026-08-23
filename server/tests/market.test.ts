import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { pool, closeDatabase } from "../src/database.js";
import { buyListing, cancelListing, listItem, readBook, MarketError } from "../src/market.js";

const live = Boolean(process.env.DATABASE_URL);
const suite = live ? describe : describe.skip;
const REALM = "sunwoven-1";
const ISLAND = "hearth";

async function makePlayer(name: string, coins: number): Promise<string> {
  const created = await pool!.query<{ id: string }>(
    `insert into player (display_name) values ($1) returning id`, [name]);
  const id = created.rows[0]!.id;
  await pool!.query(
    `insert into currency_account (realm_id, owner_type, owner_id, balance, currency_code)
     values ($1,'player',$2,$3,'SUNMARK')
     on conflict (realm_id, owner_type, owner_id, currency_code) do update set balance = excluded.balance`,
    [REALM, id, coins]);
  return id;
}
async function giveItems(playerId: string, itemKey: string, quantity: number): Promise<void> {
  await pool!.query(
    `insert into item_balance (realm_id, owner_type, owner_id, item_key, quantity) values ($1,'player',$2,$3,$4)
     on conflict (realm_id, owner_type, owner_id, item_key) do update set quantity = excluded.quantity`,
    [REALM, playerId, itemKey, quantity]);
}
async function items(ownerType: string, ownerId: string, itemKey: string): Promise<number> {
  const r = await pool!.query<{ quantity: string }>(
    `select quantity from item_balance where realm_id=$1 and owner_type=$2 and owner_id=$3 and item_key=$4`,
    [REALM, ownerType, ownerId, itemKey]);
  return Number(r.rows[0]?.quantity ?? 0);
}
async function coins(playerId: string): Promise<number> {
  const r = await pool!.query<{ balance: string }>(
    `select balance from currency_account
      where realm_id=$1 and owner_type='player' and owner_id=$2 and currency_code='SUNMARK'`,
    [REALM, playerId]);
  return Number(r.rows[0]?.balance ?? 0);
}

suite("player-to-player order book", () => {
  let seller = "", buyer = "", rival = "";

  beforeEach(async () => {
    await pool!.query("delete from market_listing");
    await pool!.query("delete from item_ledger");
    await pool!.query("delete from item_balance");
    await pool!.query("delete from currency_ledger");
    seller = await makePlayer("Seller", 0);
    buyer = await makePlayer("Buyer", 10_000);
    rival = await makePlayer("Rival", 10_000);
  });
  afterAll(async () => { await closeDatabase(); });

  it("escrows the goods on listing: they leave the seller and are held against the listing", async () => {
    await giveItems(seller, "part", 10);
    const { listingId } = await listItem({
      idempotencyKey: randomUUID(), realmId: REALM, islandId: ISLAND,
      sellerPlayerId: seller, itemKey: "part", quantity: 4, unitPrice: 50,
    });
    expect(await items("player", seller, "part")).toBe(6);
    expect(await items("escrow", listingId, "part")).toBe(4);
  });

  it("refuses to list goods the seller does not hold", async () => {
    await giveItems(seller, "part", 2);
    await expect(listItem({
      idempotencyKey: randomUUID(), realmId: REALM, islandId: ISLAND,
      sellerPlayerId: seller, itemKey: "part", quantity: 5, unitPrice: 50,
    })).rejects.toThrow(MarketError);
    expect(await items("player", seller, "part")).toBe(2);
  });

  it("returns escrowed goods on cancel, and only to the seller", async () => {
    await giveItems(seller, "part", 4);
    const { listingId } = await listItem({
      idempotencyKey: randomUUID(), realmId: REALM, islandId: ISLAND,
      sellerPlayerId: seller, itemKey: "part", quantity: 4, unitPrice: 50,
    });
    await expect(cancelListing({ idempotencyKey: randomUUID(), listingId, sellerPlayerId: rival }))
      .rejects.toThrow(MarketError);
    expect(await items("escrow", listingId, "part")).toBe(4);

    await cancelListing({ idempotencyKey: randomUUID(), listingId, sellerPlayerId: seller });
    expect(await items("player", seller, "part")).toBe(4);
    expect(await items("escrow", listingId, "part")).toBe(0);
  });

  it("settles goods and money atomically on purchase", async () => {
    await giveItems(seller, "part", 4);
    const { listingId } = await listItem({
      idempotencyKey: randomUUID(), realmId: REALM, islandId: ISLAND,
      sellerPlayerId: seller, itemKey: "part", quantity: 4, unitPrice: 50,
    });
    const result = await buyListing({ idempotencyKey: randomUUID(), listingId, buyerPlayerId: buyer });
    expect(result.paid).toBe(200);
    expect(result.fee).toBe(4);
    expect(await items("player", buyer, "part")).toBe(4);
    expect(await items("escrow", listingId, "part")).toBe(0);
    expect(await coins(buyer)).toBe(10_000 - 200);
    expect(await coins(seller)).toBe(196);
  });

  it("rolls back completely when the buyer cannot pay", async () => {
    await giveItems(seller, "part", 4);
    const { listingId } = await listItem({
      idempotencyKey: randomUUID(), realmId: REALM, islandId: ISLAND,
      sellerPlayerId: seller, itemKey: "part", quantity: 4, unitPrice: 9_000,
    });
    await expect(buyListing({ idempotencyKey: randomUUID(), listingId, buyerPlayerId: buyer }))
      .rejects.toThrow(MarketError);
    expect(await items("player", buyer, "part")).toBe(0);
    expect(await items("escrow", listingId, "part")).toBe(4);
    expect(await coins(buyer)).toBe(10_000);
    expect(await coins(seller)).toBe(0);
  });

  it("cannot be sold twice, even by two buyers racing the same row", async () => {
    await giveItems(seller, "part", 4);
    const { listingId } = await listItem({
      idempotencyKey: randomUUID(), realmId: REALM, islandId: ISLAND,
      sellerPlayerId: seller, itemKey: "part", quantity: 4, unitPrice: 50,
    });
    const results = await Promise.allSettled([
      buyListing({ idempotencyKey: randomUUID(), listingId, buyerPlayerId: buyer }),
      buyListing({ idempotencyKey: randomUUID(), listingId, buyerPlayerId: rival }),
    ]);
    const won = results.filter((r) => r.status === "fulfilled");
    expect(won).toHaveLength(1);
    // Exactly four parts exist afterwards, held by exactly one buyer.
    const total = (await items("player", buyer, "part")) + (await items("player", rival, "part"));
    expect(total).toBe(4);
    expect(await items("escrow", listingId, "part")).toBe(0);
  });

  it("is idempotent: replaying a purchase command moves nothing further", async () => {
    await giveItems(seller, "part", 4);
    const { listingId } = await listItem({
      idempotencyKey: randomUUID(), realmId: REALM, islandId: ISLAND,
      sellerPlayerId: seller, itemKey: "part", quantity: 4, unitPrice: 50,
    });
    const key = randomUUID();
    const first = await buyListing({ idempotencyKey: key, listingId, buyerPlayerId: buyer });
    const replay = await buyListing({ idempotencyKey: key, listingId, buyerPlayerId: buyer });
    expect(replay).toEqual(first);
    expect(await items("player", buyer, "part")).toBe(4);
    expect(await coins(buyer)).toBe(10_000 - 200);
  });

  it("refuses self-trade and keeps the listing open", async () => {
    await giveItems(seller, "part", 4);
    const { listingId } = await listItem({
      idempotencyKey: randomUUID(), realmId: REALM, islandId: ISLAND,
      sellerPlayerId: seller, itemKey: "part", quantity: 4, unitPrice: 50,
    });
    await expect(buyListing({ idempotencyKey: randomUUID(), listingId, buyerPlayerId: seller }))
      .rejects.toThrow(MarketError);
    expect(await readBook(REALM, ISLAND, "part")).toHaveLength(1);
  });

  it("orders the book cheapest first and hides settled rows", async () => {
    await giveItems(seller, "part", 9);
    for (const price of [90, 30, 60]) {
      await listItem({ idempotencyKey: randomUUID(), realmId: REALM, islandId: ISLAND,
        sellerPlayerId: seller, itemKey: "part", quantity: 3, unitPrice: price });
    }
    const book = await readBook(REALM, ISLAND, "part");
    expect(book.map((row) => row.unitPrice)).toEqual([30, 60, 90]);

    await buyListing({ idempotencyKey: randomUUID(), listingId: book[0]!.id, buyerPlayerId: buyer });
    expect((await readBook(REALM, ISLAND, "part")).map((r) => r.unitPrice)).toEqual([60, 90]);
  });

  it("keeps the item ledger balanced across every owner", async () => {
    await giveItems(seller, "part", 6);
    const { listingId } = await listItem({
      idempotencyKey: randomUUID(), realmId: REALM, islandId: ISLAND,
      sellerPlayerId: seller, itemKey: "part", quantity: 6, unitPrice: 20,
    });
    await buyListing({ idempotencyKey: randomUUID(), listingId, buyerPlayerId: buyer });
    const held = await pool!.query<{ total: string }>(
      `select coalesce(sum(quantity),0) as total from item_balance where realm_id=$1 and item_key='part'`, [REALM]);
    expect(Number(held.rows[0]!.total)).toBe(6);
    const negative = await pool!.query(`select 1 from item_balance where quantity < 0`);
    expect(negative.rowCount).toBe(0);
  });
});
