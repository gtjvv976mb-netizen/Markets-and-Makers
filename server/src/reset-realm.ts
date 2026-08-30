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
 * IT MUST RUN INSIDE RENDER. The database's ipAllowList is empty, which in Render means
 * it accepts connections only from the private network — a laptop gets EADDRNOTAVAIL
 * against 216.24.57.x and should, because the alternative is opening a production database
 * to the internet to run a one-off script.
 *
 * On Render's shell the service's own DATABASE_URL is already in the environment, so no
 * connection string is ever copied anywhere. Two forms, matching migrate's convention:
 *
 *   # in Render's shell (devDependencies may be pruned, so use the compiled one)
 *   npm run reset:realm:deploy
 *   MM_RESET_CONFIRM=sunwoven-1 npm run reset:realm:deploy
 *
 *   # locally, against a local database
 *   npm run reset:realm
 *   MM_RESET_CONFIRM=sunwoven-1 npm run reset:realm
 *
 * What it does NOT touch: the plot table's rows (the world's geometry — only ownership is
 * cleared), the civic supplier's stock (world state that refills itself, and starting it
 * at zero would fail every restock), the schema_migration ledger, and the realm row.
 */
import { pathToFileURL } from "node:url";
import pg from "pg";

/**
 * Everything below the resetRealm export is the COMMAND LINE, and it must not run on
 * import: a test that pulls in resetRealm would otherwise print a dry run and call
 * process.exit, taking the test runner with it. Hence the entry-point guard at the bottom.
 */

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

/**
 * The reset itself, in one transaction.
 *
 * Extracted from the CLI so a test can drive it against a realm that has an OWNED PLOT.
 * The first version deleted players and only then cleared plot.owner_player_id, which is a
 * foreign key — it passed here and failed on the live realm, because the fixture had no
 * owned plot and production had one. A reset that has never been run against an owner has
 * not been tested.
 */
export async function resetRealm(
  db: pg.Pool, realm: string, openingTreasury: number, openingCitizens: number,
): Promise<void> {
  const client = await db.connect();
  try {
    await client.query("begin");
    // OWNERSHIP FIRST. `plot` carries owner_player_id -> player(id), and it is the one
    // reference to player that this script clears with an UPDATE rather than a DELETE, so
    // it is the one that has to happen before the players go. Everything in WIPE is deleted
    // outright and can follow in any order among itself.
    await client.query("update plot set owner_player_id = null, license = null where realm_id=$1", [realm]);
    for (const table of WIPE) await client.query(`delete from ${table}`);
    await client.query("delete from player");
    // Balances: drop every account, then re-seed the two the world opens with. Deleting
    // rather than zeroing means a stray account from a past experiment cannot survive.
    await client.query("delete from currency_account where realm_id=$1", [realm]);
    await client.query("delete from item_balance where realm_id=$1 and owner_type='player'", [realm]);
    for (const [type, id, balance] of [
      ["government", "treasury", openingTreasury],
      ["player", "citizens", openingCitizens],
    ] as const) {
      await client.query(
        `insert into currency_account (realm_id, owner_type, owner_id, currency_code, balance)
         values ($1,$2,$3,'MERCS',$4)`, [realm, type, id, balance]);
    }
    // The clock, so the first tick does not settle a year of accrued time.
    await client.query("delete from realm_clock where realm_id=$1", [realm]);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL ?? "";
  if (!url) { console.error("DATABASE_URL is required."); process.exit(2); }
  const REALM = process.env.MM_RESET_REALM ?? "sunwoven-1";
  const confirm = process.env.MM_RESET_CONFIRM ?? "";
  const live = confirm === REALM;
  const OPENING_TREASURY = Number(process.env.MM_RESET_TREASURY ?? 8_000_000);
  const OPENING_CITIZENS = Number(process.env.MM_RESET_CITIZENS ?? 2_000_000);

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
      console.log(`To do it: MM_RESET_CONFIRM=${REALM} ${process.env.RENDER ? "npm run reset:realm:deploy" : "npm run reset:realm"}`);
      process.exit(0);
    }

    console.log("\nMM_RESET_CONFIRM matches. Resetting.");
    await resetRealm(pool, REALM, OPENING_TREASURY, OPENING_CITIZENS);

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

}

// Only when run directly, never on import.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
