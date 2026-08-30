/**
 * Wipe every trace of play from a realm and put it back to its opening day.
 *
 * This exists for one specific moment: the switch from a test economy to a live one. The
 * game's $MM has been a free-floating internal number, and the instant withdrawals open it
 * becomes a CLAIM ON A REAL TOKEN — `withdrawableOf` pays out
 * `sum(contribution_epoch.claimed_units)` minus what is already in flight. Every $MM
 * claimed while nobody was watching would become a real liability against the treasury
 * wallet. Starting the live economy from zero is the only way the books mean anything.
 *
 * IT IS BUILT TO BE HARD TO RUN BY ACCIDENT. With no MM_RESET_CONFIRM it is a DRY RUN: it
 * counts what it would destroy, prints it, and exits without touching a row. To actually
 * delete, MM_RESET_CONFIRM must equal the realm id — a value you have to look up and type,
 * so a stray shell-history arrow-up cannot empty a live realm.
 *
 *   # look first
 *   DATABASE_URL=... npx tsx scripts/reset-realm.ts
 *   # then, deliberately
 *   DATABASE_URL=... MM_RESET_CONFIRM=sunwoven-1 npx tsx scripts/reset-realm.ts
 *
 * What it does NOT touch: the plot table's rows (the world's geometry — only ownership is
 * cleared), the civic supplier's stock (world state that refills itself, and starting it
 * at zero would fail every restock), the schema_migration ledger, and the realm row.
 */
import pg from "pg";

const url = process.env.DATABASE_URL ?? "";
if (!url) { console.error("DATABASE_URL is required."); process.exit(2); }
const REALM = process.env.MM_RESET_REALM ?? "sunwoven-1";
const confirm = process.env.MM_RESET_CONFIRM ?? "";
const live = confirm === REALM;

const OPENING_TREASURY = Number(process.env.MM_RESET_TREASURY ?? 8_000_000);
const OPENING_CITIZENS = Number(process.env.MM_RESET_CITIZENS ?? 2_000_000);

/**
 * Everything that records a person having played, in dependency order.
 *
 * Ledgers before the accounts they reference, receipts before the players they name —
 * the same order tick.test.ts's teardown uses, for the same foreign keys.
 */
const WIPE = [
  // what the money did
  "currency_ledger", "item_ledger",
  // what a player is owed or has taken — THE LIABILITY
  "payout_request", "contribution_epoch",
  "reserve_exchange", "reserve_funding", "reserve_account",
  // what a player built, holds, or offered
  "market_listing", "trade_contract", "production_job",
  "daily_enterprise_progress", "character_state", "player_save", "business",
  // idempotency and sessions
  "command_receipt", "auth_session", "auth_challenge",
  // the day's economy, so prices and quotas open fresh
  "demand_day", "procurement_day", "procurement_quota", "market_pressure",
  "economy_snapshot", "bulletin", "cabinet_directive", "policy_proposal",
  "helius_event",
] as const;

const pool = new pg.Pool({ connectionString: url, max: 1 });
try {
  const counts: Array<{ table: string; rows: number }> = [];
  for (const table of WIPE) {
    const r = await pool.query<{ n: string }>(`select count(*)::text as n from ${table}`);
    counts.push({ table, rows: Number(r.rows[0]!.n) });
  }
  const players = await pool.query<{ n: string }>("select count(*)::text as n from player");
  const owned = await pool.query<{ n: string }>(
    "select count(*)::text as n from plot where realm_id=$1 and owner_player_id is not null", [REALM]);
  // The one number that becomes real money the moment payouts open.
  const owed = await pool.query<{ n: string }>(
    `select coalesce(sum(claimed_units),0)::text as n from contribution_epoch where realm_id=$1`, [REALM]);

  console.log(`realm            ${REALM}`);
  console.log(`players          ${players.rows[0]!.n}`);
  console.log(`plots owned      ${owned.rows[0]!.n}`);
  console.log(`$MM CLAIMED      ${owed.rows[0]!.n}   <- would be a real liability once payouts open`);
  console.log("rows to delete:");
  for (const { table, rows } of counts.filter((c) => c.rows > 0)) {
    console.log(`  ${table.padEnd(26)} ${rows}`);
  }
  const total = counts.reduce((sum, c) => sum + c.rows, 0);
  console.log(`  ${"TOTAL".padEnd(26)} ${total}`);

  if (!live) {
    console.log("\nDRY RUN — nothing was deleted.");
    console.log(`To do it: MM_RESET_CONFIRM=${REALM} npx tsx scripts/reset-realm.ts`);
    process.exit(0);
  }

  console.log("\nMM_RESET_CONFIRM matches. Resetting.");
  const client = await pool.connect();
  try {
    await client.query("begin");
    for (const table of WIPE) await client.query(`delete from ${table}`);
    // Players last: everything above references them.
    await client.query("delete from player");
    // The world keeps its geometry; only who holds what is cleared.
    await client.query("update plot set owner_player_id = null, license = null where realm_id=$1", [REALM]);
    // Balances: drop every account, then re-seed the two the world opens with. Deleting
    // rather than zeroing means a stray account from a past experiment cannot survive.
    await client.query("delete from currency_account where realm_id=$1", [REALM]);
    await client.query("delete from item_balance where realm_id=$1 and owner_type='player'", [REALM]);
    for (const [type, id, balance] of [
      ["government", "treasury", OPENING_TREASURY],
      ["player", "citizens", OPENING_CITIZENS],
    ] as const) {
      await client.query(
        `insert into currency_account (realm_id, owner_type, owner_id, currency_code, balance)
         values ($1,$2,$3,'MERCS',$4)`, [REALM, type, id, balance]);
    }
    // The clock, so the first tick does not settle a year of accrued time.
    await client.query("delete from realm_clock where realm_id=$1", [REALM]);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }

  const after = await pool.query<{ owner: string; balance: string }>(
    `select owner_id as owner, balance::text from currency_account where realm_id=$1 order by owner_id`, [REALM]);
  console.log("\nreset complete. opening balances:");
  for (const row of after.rows) console.log(`  ${row.owner.padEnd(12)} ${row.balance} MERCS`);
  const left = await pool.query<{ n: string }>(
    `select coalesce(sum(claimed_units),0)::text as n from contribution_epoch where realm_id=$1`, [REALM]);
  console.log(`  $MM claimed  ${left.rows[0]!.n}`);
} finally {
  await pool.end();
}
