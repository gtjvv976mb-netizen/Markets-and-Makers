// The two minds that run Mercedonia when nobody is playing it.
//
// These are simulation agents, not language models. A loop that moves real money every
// minute, for ever, has to be deterministic, cheap and auditable: you must be able to
// read why the treasury paid what it paid, replay it, and prove it did not invent a Merc
// Dollar. An LLM in this position would be none of those things. What makes an economy
// feel alive is that its parts respond to each other — wages fall when the treasury is
// thin, the state mines harder when the supplier runs dry, households stop spending when
// their pockets are empty — and that is what these two do.
//
// Together they close the circuit that was previously open at both ends:
//
//   treasury --wages--> Mercedonians --purchases--> businesses --tax--> treasury
//                                                   |
//                                                   +--restock--> treasury
//
// Before this, the citizens' account was only ever debited. It began with a float and
// drained; the district would have quietly stopped buying once it hit zero, with no
// error and no explanation. The government mind is what refills it, and it can only
// refill it from tax it has actually collected.

import type { PoolClient } from "pg";
import { pool } from "./database.js";
import { moveCurrency } from "./market.js";
import { RESOURCES } from "./catalogue.js";

const REALM = "sunwoven-1";

/** What one Mercedonian is paid for a day's work in a civic industry. */
export const CIVIC_DAILY_WAGE = 9;
/** Households the district supports before any business is built. */
export const BASE_POPULATION = 120;
/** Each built business supports this many more households. */
export const POPULATION_PER_BUSINESS = 6;
/** The treasury will not spend below this on wages; it has bills of its own. */
export const TREASURY_FLOOR = 50_000;
/** Never commit more than this share of the treasury to a single payroll run. */
export const PAYROLL_SHARE_CAP = 0.05;
/** What the Mercedonians will actually spend, as a share of what they are paid. */
export const SPEND_RATE = 0.82;

/**
 * What the state makes itself, and how much of it to keep on the shelf.
 *
 * These are the government industries from the world's own design: water, power and
 * minerals are public utilities, so the civic supplier does not conjure them out of
 * nothing — it runs works that cost the treasury to operate. That cost is the reason
 * the state cannot simply print supply for ever.
 */
export const STATE_INDUSTRIES: Record<string, { target: number; costPerUnit: number }> = {
  water: { target: 40_000, costPerUnit: 1 },
  power: { target: 40_000, costPerUnit: 1 },
  ore: { target: 20_000, costPerUnit: 2 },
  timber: { target: 20_000, costPerUnit: 2 },
};

export interface GovernmentReport {
  elapsedHours: number;
  population: number;
  wageBill: number;
  wagesPaid: number;
  austerity: boolean;
  produced: Record<string, number>;
  productionCost: number;
  treasury: number;
}

export interface CitizenReport {
  elapsedHours: number;
  purse: number;
  spendingPower: number;
  appetite: Record<string, number>;
}

/** Hours since a mind last ran, and a claim on running it now. */
async function claim(client: PoolClient, mind: string): Promise<number> {
  const row = await client.query<{ hours: string }>(
    `select extract(epoch from (now() - last_run_at))::float8 / 3600 as hours
       from realm_clock where realm_id = $1 and mind = $2 for update`,
    [REALM, mind]);
  if (!row.rowCount) return 0;
  return Math.min(26, Math.max(0, Number(row.rows[0]!.hours)));
}

async function bank(client: PoolClient, mind: string): Promise<void> {
  await client.query(
    "update realm_clock set last_run_at = now() where realm_id = $1 and mind = $2", [REALM, mind]);
}

async function balanceOf(client: PoolClient, ownerType: string, ownerId: string): Promise<number> {
  const row = await client.query<{ balance: string }>(
    `select balance from currency_account
      where realm_id=$1 and owner_type=$2 and owner_id=$3 and currency_code='MERCS' for update`,
    [REALM, ownerType, ownerId]);
  return Number(row.rows[0]?.balance ?? 0);
}

/** A stable uuid for this mind's ledger moves, so a repeated run cannot pay twice. */
function keyFor(...parts: string[]): string {
  // Same shape as the tick's: hash a sentence into a v5-looking uuid.
  const hex = [...parts.join(":")].reduce((h, c) => {
    const x = (h * 33) ^ c.charCodeAt(0);
    return x >>> 0;
  }, 5381).toString(16).padStart(8, "0").repeat(4).slice(0, 32);
  const version = `5${hex.slice(13, 16)}`;
  const variant = ((parseInt(hex.slice(16, 17), 16) & 0x3) | 0x8).toString(16) + hex.slice(17, 20);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${version}-${variant}-${hex.slice(20, 32)}`;
}

/**
 * The government's mind.
 *
 * Two jobs, in the order that matters. It pays the Mercedonians who work its industries,
 * because without wages there is no demand and every shop in the realm eventually stares
 * at an empty street. Then it runs those industries: topping the civic supplier back up
 * toward its targets, and paying for the privilege.
 *
 * Both are throttled by what the treasury actually holds. Austerity is a real state here,
 * not an error: a thin treasury pays a smaller wage, households spend less, businesses
 * sell less, tax falls further. That feedback is the point — an economy that cannot have
 * a bad week is not an economy.
 */
export async function runGovernmentMind(now = Date.now()): Promise<GovernmentReport> {
  const empty: GovernmentReport = {
    elapsedHours: 0, population: 0, wageBill: 0, wagesPaid: 0,
    austerity: false, produced: {}, productionCost: 0, treasury: 0,
  };
  if (!pool) return empty;

  const client = await pool.connect();
  try {
    await client.query("begin");
    const hours = await claim(client, "government");
    if (hours <= 0.01) { await client.query("rollback"); return empty; }

    const counted = await client.query<{ n: string }>(
      "select count(*)::text as n from business b join plot p on p.id=b.plot_id where p.realm_id=$1", [REALM]);
    const population = BASE_POPULATION + Number(counted.rows[0]!.n) * POPULATION_PER_BUSINESS;

    const treasuryBefore = await balanceOf(client, "government", "treasury");
    const spendable = Math.max(0, treasuryBefore - TREASURY_FLOOR);

    // --- payroll ------------------------------------------------------------
    const wageBill = Math.floor(population * CIVIC_DAILY_WAGE * (hours / 24));
    const wagesPaid = Math.max(0, Math.min(wageBill, Math.floor(spendable * PAYROLL_SHARE_CAP)));
    if (wagesPaid > 0) {
      await moveCurrency(client, REALM, keyFor("payroll", String(Math.floor(now / 1000))), wagesPaid,
        { type: "government", id: "treasury" }, { type: "player", id: "citizens" }, "government.payroll");
    }

    // --- state industries ---------------------------------------------------
    const produced: Record<string, number> = {};
    let productionCost = 0;
    let budget = Math.max(0, spendable - wagesPaid);

    for (const [itemKey, plan] of Object.entries(STATE_INDUSTRIES)) {
      if (!RESOURCES[itemKey] || budget <= 0) continue;
      const stocked = await client.query<{ quantity: string }>(
        `select quantity from item_balance
          where realm_id=$1 and owner_type='government' and owner_id='supply' and item_key=$2 for update`,
        [REALM, itemKey]);
      const have = Number(stocked.rows[0]?.quantity ?? 0);
      if (have >= plan.target) continue;

      // A works produces at a rate, not instantly: a day's run closes a quarter of the gap.
      const wanted = Math.floor((plan.target - have) * Math.min(1, hours / 24) * 0.25);
      const affordable = Math.floor(budget / plan.costPerUnit);
      const made = Math.max(0, Math.min(wanted, affordable));
      if (made <= 0) continue;

      const cost = made * plan.costPerUnit;
      // The works are paid for out of the treasury and into the citizens' pockets: this
      // is a wage bill too, which is why the state cannot mine for free.
      await moveCurrency(client, REALM, keyFor("works", itemKey, String(Math.floor(now / 1000))), cost,
        { type: "government", id: "treasury" }, { type: "player", id: "citizens" }, "government.works");
      await client.query(
        `insert into item_balance (realm_id, owner_type, owner_id, item_key, quantity)
         values ($1,'government','supply',$2,$3)
         on conflict (realm_id, owner_type, owner_id, item_key)
         do update set quantity = item_balance.quantity + excluded.quantity`,
        [REALM, itemKey, made]);
      produced[itemKey] = made;
      productionCost += cost;
      budget -= cost;
    }

    await bank(client, "government");
    await client.query("commit");
    return {
      elapsedHours: hours, population, wageBill, wagesPaid,
      austerity: wagesPaid < wageBill,
      produced, productionCost,
      treasury: treasuryBefore - wagesPaid - productionCost,
    };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * The Mercedonians' mind.
 *
 * It does not move money — the businesses' own tick takes it out of this purse when a
 * customer walks in. What it decides is how much of that purse is available to be spent
 * at all, and on what.
 *
 * Households do not spend every Merc Dollar they earn, and a district that did would have
 * no buffer at all: one bad week and trade stops dead. Holding some back is what lets
 * demand degrade gracefully instead of collapsing.
 */
export async function runCitizenMind(now = Date.now()): Promise<CitizenReport> {
  const empty: CitizenReport = { elapsedHours: 0, purse: 0, spendingPower: 0, appetite: {} };
  if (!pool) return empty;

  const client = await pool.connect();
  try {
    await client.query("begin");
    const hours = await claim(client, "citizens");
    if (hours <= 0.01) { await client.query("rollback"); return empty; }

    const purse = await balanceOf(client, "player", "citizens");
    const spendingPower = Math.floor(purse * SPEND_RATE);

    // What the district feels like buying. Weighted by what households actually consume:
    // finished goods and services, not ore. This is read by the pricing quota, so a
    // district's appetite is visible to every maker rather than hidden per browser.
    const appetite: Record<string, number> = {};
    const consumer = Object.entries(RESOURCES).filter(([, spec]) => spec.buyer === "citizens");
    const share = consumer.length > 0 ? spendingPower / consumer.length : 0;
    for (const [itemKey, spec] of consumer) {
      const unit = Math.max(1, spec.governmentPrice);
      appetite[itemKey] = Math.max(0, Math.floor(share / unit));
    }

    await bank(client, "citizens");
    await client.query("commit");
    return { elapsedHours: hours, purse, spendingPower, appetite };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

/** Both minds, in the order the money moves. */
export async function runMinds(now = Date.now()): Promise<{ government: GovernmentReport; citizens: CitizenReport }> {
  const government = await runGovernmentMind(now);
  const citizens = await runCitizenMind(now);
  return { government, citizens };
}
