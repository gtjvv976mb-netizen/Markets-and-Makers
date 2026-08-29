import { pool } from "./database.js";
import { command, moveCurrency, takeItems, MarketError } from "./market.js";
import { applyPurchaseWithin, applySaleWithin, fundReserve, EconomyError } from "./economy.js";
import { RESOURCES } from "./catalogue.js";

const TAX_RATE = 0.05;
const REALM = "sunwoven-1";

/** Weight of a sale toward the player's $MM contribution share. */
const CONTRIBUTION_WEIGHT = { citizens: 0.3, government: 0.1 } as const;

export interface SaleResult {
  itemKey: string; quantity: number; gross: number; tax: number; net: number;
  firstUnit: number; lastUnit: number; contribution: number;
}

/**
 * Server-authoritative sale. The client no longer decides what its goods are worth: the
 * district sets the price, the ledger moves the money, and the tax funds the next epoch.
 */
export async function sellToDistrict(input: {
  idempotencyKey: string; playerId: string; islandId: string; itemKey: string; quantity: number;
  /** Settlement time; defaults to now. Simulations pass simulated clocks; production never does. */
  at?: number;
}): Promise<SaleResult> {
  const spec = RESOURCES[input.itemKey];
  if (!spec) throw new EconomyError("unknown-item", `No such resource: ${input.itemKey}`);
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) throw new MarketError("bad-quantity", "Quantity must be a positive whole number.");

  // Pricing, demand, contribution, goods and money all settle in ONE transaction, so a
  // replayed command cannot move the district price a second time.
  const settled = await command(input.idempotencyKey, "economy.sell", input.playerId, async (client) => {
    const priced = await applySaleWithin(client, {
      realmId: REALM, islandId: input.islandId, itemKey: input.itemKey,
      quantity: input.quantity, playerId: input.playerId,
      contributionWeight: CONTRIBUTION_WEIGHT[spec.buyer],
      at: input.at,
    });
    const tax = Math.floor(priced.gross * TAX_RATE);
    const net = priced.gross - tax;
    await takeItems(client, REALM, input.idempotencyKey, input.itemKey, input.quantity,
      { type: "player", id: input.playerId }, { type: "government", id: "consumed" }, "economy.sell");
    await moveCurrency(client, REALM, input.idempotencyKey, net,
      { type: spec.buyer === "citizens" ? "player" : "government", id: spec.buyer === "citizens" ? "citizens" : "treasury" },
      { type: "player", id: input.playerId }, "economy.sell");
    return {
      itemKey: input.itemKey, quantity: input.quantity, gross: priced.gross, tax, net,
      firstUnit: priced.firstUnit, lastUnit: priced.lastUnit, contribution: priced.contribution,
    } satisfies SaleResult;
  });

  // fundReserve applies the share itself; passing a pre-scaled figure applied it twice.
  await fundReserve(REALM, settled.tax, "economy.tax");
  return settled;
}

export interface PurchaseResult { itemKey: string; quantity: number; cost: number; unitPrice: number }

/** Buying from the civic supplier. Expensive on purpose: it is the option of last resort. */
export async function buyFromCivic(input: {
  idempotencyKey: string; playerId: string; islandId: string; itemKey: string; quantity: number;
}): Promise<PurchaseResult> {
  const spec = RESOURCES[input.itemKey];
  if (!spec) throw new EconomyError("unknown-item", `No such resource: ${input.itemKey}`);
  if (spec.civicSupply === false) throw new EconomyError("not-supplied", `${input.itemKey} is recovered from production, not sold by the civic supplier.`);
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) throw new MarketError("bad-quantity", "Quantity must be a positive whole number.");

  const purchase = await command(input.idempotencyKey, "economy.buy", input.playerId, async (client) => {
    const priced = await applyPurchaseWithin(client, {
      realmId: REALM, islandId: input.islandId, itemKey: input.itemKey, quantity: input.quantity,
    });
    await moveCurrency(client, REALM, input.idempotencyKey, priced.cost,
      { type: "player", id: input.playerId }, { type: "government", id: "treasury" }, "economy.buy");

    await takeItems(client, REALM, input.idempotencyKey, input.itemKey, input.quantity,
      { type: "government", id: "supply" }, { type: "player", id: input.playerId }, "economy.buy");
    return { itemKey: input.itemKey, quantity: input.quantity, cost: priced.cost, unitPrice: Math.round(priced.cost / input.quantity) };
  });
  // Every player->treasury flow recycles into emission, not only the sales tax. Before
  // this, "35% of fees" was really 35% of the 5% tax — about 1.75% of citizen gross — and
  // supplier purchases, licences and upgrades funded nothing. Safe against wash-pumping:
  // paying the treasury raises nobody's contribution, so inflating the budget this way is
  // a 65%-loss donation diluted across every contributor.
  await fundReserve(REALM, purchase.cost, "economy.buy");
  return purchase;
}

/** The civic supplier is not infinite bookkeeping: it needs stock to hand over. */
export async function stockCivicSupply(itemKey: string, quantity: number): Promise<void> {
  await pool!.query(
    `insert into item_balance (realm_id, owner_type, owner_id, item_key, quantity)
     values ($1,'government','supply',$2,$3)
     on conflict (realm_id, owner_type, owner_id, item_key)
     do update set quantity = item_balance.quantity + excluded.quantity`,
    [REALM, itemKey, quantity]);
}
