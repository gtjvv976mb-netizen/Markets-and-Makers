/**
 * Prove the realm reset works on a world that has an OWNER — the case that broke live.
 *
 * This is a SCRIPT, not a vitest file, and that is deliberate. resetRealm empties `player`
 * and every table referencing it; pointing that at the database the other twenty-five
 * suites share made failures wander across unrelated files. It also does not belong in a
 * suite that is already order-flaky: measured on this machine, the server suite alone
 * scored 309, 309, then 19-failed across three identical runs. A destructive integration
 * check gets its own database and its own command.
 *
 *   npm run verify:reset
 *
 * Exit code is the verdict. It checks BOTH directions: the fixed ordering must succeed,
 * and the original ordering must still fail with plot_owner_player_id_fkey — because a
 * check that cannot fail proves nothing.
 *
 * Why it exists at all: the first version deleted players and only then cleared
 * plot.owner_player_id. It passed every local run and died on the live realm, because the
 * local fixture had ZERO owned plots and production had one.
 */
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";
import { resetRealm } from "./reset-realm.js";

const SOURCE = process.env.DATABASE_URL ?? "";
if (!SOURCE) { console.error("DATABASE_URL is required (any local database; a scratch one is made beside it)."); process.exit(2); }
const SCRATCH = process.env.MM_VERIFY_DB ?? "mm_reset_verify";
const REALM = "sunwoven-1";
const PLOT = "GX072";

let failures = 0;
function check(name: string, ok: boolean, detail: string): void {
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${name} — ${detail}`);
  if (!ok) failures += 1;
}

const admin = new pg.Pool({ connectionString: SOURCE, max: 1 });
let db: pg.Pool | null = null;
try {
  const exists = await admin.query("select 1 from pg_database where datname=$1", [SCRATCH]);
  if (!exists.rowCount) await admin.query(`create database ${SCRATCH}`);
  const url = new URL(SOURCE);
  url.pathname = `/${SCRATCH}`;
  db = new pg.Pool({ connectionString: url.toString(), max: 1 });

  // The production schema, so this exercises the real plot_owner_player_id_fkey.
  const dir = resolve(process.cwd(), "sql");
  for (const file of (await readdir(dir)).filter((n) => /^\d+_.*\.sql$/.test(n)).sort()) {
    await db.query(await readFile(resolve(dir, file), "utf8"));
  }

  /** A realm with a player who owns a plot — the state a real reset is performed in. */
  async function seedPlayedWorld(): Promise<void> {
    await resetRealm(db!, REALM, 5_000_000, 1_000_000);
    const owner = await db!.query<{ id: string }>(
      "insert into player (display_name, wallet_address) values ($1,$2) returning id",
      ["verify-owner", `V${Math.random().toString(36).slice(2, 12)}`]);
    const id = owner.rows[0]!.id;
    await db!.query(
      `insert into plot (id, realm_id, island_id) values ($1,$2,'hearth') on conflict (id) do nothing`,
      [PLOT, REALM]);
    await db!.query("update plot set owner_player_id=$2, license='shop' where id=$1", [PLOT, id]);
    await db!.query(
      `insert into business (plot_id, owner_player_id, license, condition) values ($1,$2,'shop',100)
       on conflict (plot_id) do update set owner_player_id=excluded.owner_player_id`, [PLOT, id]);
    await db!.query(
      `insert into item_balance (realm_id, owner_type, owner_id, item_key, quantity)
       values ($1,'government','supply','water',5000)
       on conflict (realm_id, owner_type, owner_id, item_key) do update set quantity=5000`, [REALM]);
  }

  const one = async <T>(sql: string, params: unknown[] = []): Promise<T> =>
    (await db!.query(sql, params)).rows[0] as T;

  console.log(`verifying the realm reset against ${SCRATCH}\n`);

  // --- the fixed ordering ------------------------------------------------------------
  await seedPlayedWorld();
  const owned = await one<{ n: string }>(
    "select count(*)::text as n from plot where realm_id=$1 and owner_player_id is not null", [REALM]);
  check("the fixture has an owned plot", Number(owned.n) > 0,
    `${owned.n} owned — this is the condition the old test lacked`);

  await resetRealm(db, REALM, 8_000_000, 2_000_000);
  const after = await one<{ players: string; businesses: string; owned: string; plots: string }>(`
    select (select count(*) from player)::text as players,
           (select count(*) from business)::text as businesses,
           (select count(*) from plot where owner_player_id is not null)::text as owned,
           (select count(*) from plot)::text as plots`);
  check("clears players, businesses and ownership",
    after.players === "0" && after.businesses === "0" && after.owned === "0",
    `players ${after.players}, businesses ${after.businesses}, owned plots ${after.owned}`);
  check("keeps the world's geometry", Number(after.plots) > 0,
    `${after.plots} plot rows survive; only ownership is cleared`);

  const money = await one<{ treasury: string; citizens: string }>(`
    select (select coalesce(balance,0) from currency_account
             where realm_id=$1 and owner_type='government' and owner_id='treasury')::text as treasury,
           (select coalesce(balance,0) from currency_account
             where realm_id=$1 and owner_type='player' and owner_id='citizens')::text as citizens`, [REALM]);
  check("restores the opening balances",
    money.treasury === "8000000" && money.citizens === "2000000",
    `treasury ${money.treasury}, citizens ${money.citizens}`);

  const owed = await one<{ n: string }>(
    "select coalesce(sum(claimed_units),0)::text as n from contribution_epoch");
  check("leaves nothing owed in $MM", owed.n === "0",
    `${owed.n} claimed — this is what makes it safe to open withdrawals`);

  const supply = await one<{ q: string | null }>(
    `select quantity::text as q from item_balance
      where realm_id=$1 and owner_type='government' and owner_id='supply' and item_key='water'`, [REALM]);
  check("keeps the civic supplier stocked", supply?.q === "5000",
    `water ${supply?.q ?? "GONE"} — at zero every restock after the reset fails`);

  // --- and the check must be able to FAIL --------------------------------------------
  // The original ordering, inline: delete the players first, then clear ownership. If this
  // does NOT raise plot_owner_player_id_fkey, the schema no longer guards what this script
  // claims to prove and every "ok" above is worthless.
  await seedPlayedWorld();
  let reproduced = "";
  const client = await db.connect();
  try {
    await client.query("begin");
    await client.query("delete from business");
    await client.query("delete from player");
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    reproduced = (error as { constraint?: string }).constraint ?? (error as Error).message;
  } finally { client.release(); }
  check("the original ordering still fails, so this script can fail",
    reproduced === "plot_owner_player_id_fkey",
    reproduced ? `raised ${reproduced}` : "IT DID NOT RAISE — the guard is gone");

  console.log(failures === 0 ? "\nreset verified." : `\n${failures} check(s) failed.`);
} finally {
  await db?.end();
  await admin.end();
}
process.exit(failures === 0 ? 0 : 1);
