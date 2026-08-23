import type { PoolClient } from "pg";
import { pool } from "./database.js";

export interface Owner { type: "player" | "business" | "government" | "escrow"; id: string }
export interface ListingRow {
  id: string; islandId: string; sellerPlayerId: string; itemKey: string;
  quantity: number; unitPrice: number; total: number; createdAt: string;
}

export class MarketError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

function db(): NonNullable<typeof pool> {
  if (!pool) throw new MarketError("no-database", "The market requires a database connection.");
  return pool;
}

/**
 * One economic command: a single transaction, replay-safe. A repeated idempotency key
 * returns the first response verbatim and performs no further movement.
 */
async function command<T>(
  key: string, type: string, playerId: string | null,
  run: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await db().connect();
  try {
    const seen = await client.query<{ response: T }>(
      "select response from command_receipt where idempotency_key = $1", [key]);
    const receipt = seen.rows[0];
    if (receipt) return receipt.response;

    await client.query("begin");
    try {
      const result = await run(client);
      await client.query(
        `insert into command_receipt (idempotency_key, player_id, command_type, response)
         values ($1, $2, $3, $4::jsonb) on conflict (idempotency_key) do nothing`,
        [key, playerId, type, JSON.stringify(result)]);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  } finally {
    client.release();
  }
}

async function takeItems(
  client: PoolClient, realmId: string, commandId: string, itemKey: string,
  quantity: number, from: Owner, to: Owner, reason: string,
): Promise<void> {
  const debited = await client.query(
    `update item_balance set quantity = quantity - $1
       where realm_id = $2 and owner_type = $3 and owner_id = $4 and item_key = $5 and quantity >= $1`,
    [quantity, realmId, from.type, from.id, itemKey]);
  if (!debited.rowCount) throw new MarketError("insufficient-items", `Not enough ${itemKey} to move.`);

  await client.query(
    `insert into item_balance (realm_id, owner_type, owner_id, item_key, quantity)
     values ($1,$2,$3,$4,$5)
     on conflict (realm_id, owner_type, owner_id, item_key)
     do update set quantity = item_balance.quantity + excluded.quantity`,
    [realmId, to.type, to.id, itemKey, quantity]);

  await client.query(
    `insert into item_ledger (command_id, realm_id, item_key, quantity,
        from_owner_type, from_owner_id, to_owner_type, to_owner_id, reason)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [commandId, realmId, itemKey, quantity, from.type, from.id, to.type, to.id, reason]);
}

/** The market settles in Sunmarks only; $MM is an earned reserve asset, not a trading currency. */
const TRADE_CURRENCY = "SUNMARK";

async function accountId(client: PoolClient, realmId: string, owner: Owner): Promise<string> {
  const existing = await client.query<{ id: string }>(
    `select id from currency_account
      where realm_id = $1 and owner_type = $2 and owner_id = $3 and currency_code = $4`,
    [realmId, owner.type, owner.id, TRADE_CURRENCY]);
  const found = existing.rows[0];
  if (found) return found.id;
  const created = await client.query<{ id: string }>(
    `insert into currency_account (realm_id, owner_type, owner_id, balance, currency_code)
     values ($1,$2,$3,0,$4) returning id`, [realmId, owner.type, owner.id, TRADE_CURRENCY]);
  const row = created.rows[0];
  if (!row) throw new MarketError("account-failed", "Could not open a currency account.");
  return row.id;
}

async function moveCurrency(
  client: PoolClient, realmId: string, commandId: string, amount: number,
  from: Owner, to: Owner, reason: string,
): Promise<void> {
  if (amount <= 0) return;
  const debit = await accountId(client, realmId, from);
  const credit = await accountId(client, realmId, to);
  const taken = await client.query(
    `update currency_account set balance = balance - $1 where id = $2 and balance >= $1`,
    [amount, debit]);
  if (!taken.rowCount) throw new MarketError("insufficient-funds", "Not enough Sunmarks to settle.");
  await client.query(`update currency_account set balance = balance + $1 where id = $2`, [amount, credit]);
  await client.query(
    `insert into currency_ledger (realm_id, command_id, debit_account, credit_account, amount, reason, currency_code)
     values ($1,$2,$3,$4,$5,$6,$7)
     on conflict (command_id, debit_account, credit_account) do nothing`,
    [realmId, commandId, debit, credit, amount, reason, TRADE_CURRENCY]);
}

/** Listing REMOVES the goods from the seller and holds them against the listing id. */
export async function listItem(input: {
  idempotencyKey: string; realmId: string; islandId: string; sellerPlayerId: string;
  itemKey: string; quantity: number; unitPrice: number;
}): Promise<{ listingId: string; escrowed: number }> {
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) throw new MarketError("bad-quantity", "Quantity must be a positive whole number.");
  if (!Number.isInteger(input.unitPrice) || input.unitPrice <= 0) throw new MarketError("bad-price", "Unit price must be a positive whole number.");

  return command(input.idempotencyKey, "market.list", input.sellerPlayerId, async (client) => {
    const created = await client.query<{ id: string }>(
      `insert into market_listing (realm_id, island_id, seller_player_id, item_key, quantity, unit_price, status)
       values ($1,$2,$3,$4,$5,$6,'open') returning id`,
      [input.realmId, input.islandId, input.sellerPlayerId, input.itemKey, input.quantity, input.unitPrice]);
    const listingRow = created.rows[0];
    if (!listingRow) throw new MarketError("listing-failed", "Could not open the listing.");
    const listingId = listingRow.id;
    await takeItems(client, input.realmId, listingId, input.itemKey, input.quantity,
      { type: "player", id: input.sellerPlayerId }, { type: "escrow", id: listingId }, "market.list");
    return { listingId, escrowed: input.quantity };
  });
}

/** Cancelling returns the escrowed goods to the seller. Only the seller may cancel. */
export async function cancelListing(input: {
  idempotencyKey: string; listingId: string; sellerPlayerId: string;
}): Promise<{ listingId: string; returned: number }> {
  return command(input.idempotencyKey, "market.cancel", input.sellerPlayerId, async (client) => {
    const locked = await client.query<{ realm_id: string; item_key: string; quantity: string; seller_player_id: string }>(
      `select realm_id, item_key, quantity, seller_player_id from market_listing
        where id = $1 and status = 'open' for update`, [input.listingId]);
    const row = locked.rows[0];
    if (!row) throw new MarketError("listing-unavailable", "That listing is no longer open.");
    if (row.seller_player_id !== input.sellerPlayerId) throw new MarketError("not-seller", "Only the seller can cancel a listing.");

    const quantity = Number(row.quantity);
    await takeItems(client, row.realm_id, input.listingId, row.item_key, quantity,
      { type: "escrow", id: input.listingId }, { type: "player", id: row.seller_player_id }, "market.cancel");
    await client.query(
      `update market_listing set status = 'cancelled', settled_at = now() where id = $1`, [input.listingId]);
    return { listingId: input.listingId, returned: quantity };
  });
}

/**
 * Buying settles goods and money in one transaction. `for update` plus the `status='open'`
 * predicate means two concurrent buyers cannot both fill the same row, and a filled row can
 * never settle again.
 */
export async function buyListing(input: {
  idempotencyKey: string; listingId: string; buyerPlayerId: string; feeRate?: number;
}): Promise<{ listingId: string; itemKey: string; quantity: number; paid: number; fee: number }> {
  return command(input.idempotencyKey, "market.buy", input.buyerPlayerId, async (client) => {
    const locked = await client.query<{
      realm_id: string; item_key: string; quantity: string; unit_price: string; seller_player_id: string;
    }>(`select realm_id, item_key, quantity, unit_price, seller_player_id
          from market_listing where id = $1 and status = 'open' for update`, [input.listingId]);
    const row = locked.rows[0];
    if (!row) throw new MarketError("listing-unavailable", "That listing has already been settled.");
    if (row.seller_player_id === input.buyerPlayerId) throw new MarketError("self-trade", "You cannot buy your own listing.");

    const quantity = Number(row.quantity);
    const total = quantity * Number(row.unit_price);
    const fee = Math.floor(total * (input.feeRate ?? 0.02));

    await moveCurrency(client, row.realm_id, input.listingId, total - fee,
      { type: "player", id: input.buyerPlayerId }, { type: "player", id: row.seller_player_id }, "market.buy");
    if (fee > 0) {
      await moveCurrency(client, row.realm_id, input.listingId, fee,
        { type: "player", id: input.buyerPlayerId }, { type: "government", id: "treasury" }, "market.fee");
    }
    await takeItems(client, row.realm_id, input.listingId, row.item_key, quantity,
      { type: "escrow", id: input.listingId }, { type: "player", id: input.buyerPlayerId }, "market.buy");
    await client.query(
      `update market_listing set status = 'filled', settled_at = now(), buyer_player_id = $2 where id = $1`,
      [input.listingId, input.buyerPlayerId]);

    return { listingId: input.listingId, itemKey: row.item_key, quantity, paid: total, fee };
  });
}

/** Cheapest first — an island order book for one good, or for everything on that island. */
export async function readBook(realmId: string, islandId: string, itemKey?: string, limit = 50): Promise<ListingRow[]> {
  const result = await db().query<{
    id: string; island_id: string; seller_player_id: string; item_key: string;
    quantity: string; unit_price: string; created_at: string;
  }>(
    `select id, island_id, seller_player_id, item_key, quantity, unit_price, created_at
       from market_listing
      where realm_id = $1 and island_id = $2 and status = 'open'
        and ($3::text is null or item_key = $3)
      order by unit_price asc, created_at asc
      limit $4`,
    [realmId, islandId, itemKey ?? null, Math.min(200, Math.max(1, limit))]);
  return result.rows.map((row) => ({
    id: row.id, islandId: row.island_id, sellerPlayerId: row.seller_player_id, itemKey: row.item_key,
    quantity: Number(row.quantity), unitPrice: Number(row.unit_price),
    total: Number(row.quantity) * Number(row.unit_price), createdAt: row.created_at,
  }));
}
