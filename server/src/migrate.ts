/**
 * Apply the schema, once each.
 *
 * This used to run every file in sql/ on every single deploy. It survived because the DDL
 * is written idempotently — `create table if not exists`, `add column if not exists` — but
 * it was never safe, for two reasons:
 *
 *  1. A DATA statement is not idempotent the way DDL is. 020 sets every business's
 *     standing-charge meter to now() so the change bills nobody for the past; re-running
 *     it on each deploy would waive a day of everybody's charges every time the server
 *     shipped. The bug was invisible while every migration happened to be pure DDL, and
 *     it arrived the moment one was not.
 *  2. Every `alter table ... add column if not exists` takes an ACCESS EXCLUSIVE lock even
 *     when it changes nothing — nineteen of them against a live ledger, while the previous
 *     instance is still serving requests.
 *
 * So: a ledger. Each file is recorded when it succeeds and skipped forever after. The
 * ledger is created first and in its own statement, because it is the one thing that
 * cannot be recorded in itself.
 *
 * Existing databases have every migration applied and no ledger row for any of them. That
 * is fine: the first run after this change replays them, which the DDL absorbs, and
 * records them so it never happens again.
 */
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";
import { config } from "./config.js";

if (!config.databaseUrl) throw new Error("DATABASE_URL is required to run migrations.");
const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 1 });
try {
  await pool.query(`
    create table if not exists schema_migration (
      filename text primary key,
      applied_at timestamptz not null default now()
    )`);

  // One advisory lock for the whole run, so two instances deploying at once do not race
  // each other through the same file. The second waits, then finds everything recorded.
  await pool.query("select pg_advisory_lock(hashtext('markets-and-makers-migrate'))");

  try {
    const directory = resolve(process.cwd(), "sql");
    const migrations = (await readdir(directory)).filter((name) => /^\d+_.*\.sql$/.test(name)).sort();
    const done = await pool.query<{ filename: string }>("select filename from schema_migration");
    const applied = new Set(done.rows.map((row) => row.filename));

    let ran = 0;
    for (const migration of migrations) {
      if (applied.has(migration)) continue;
      const sql = await readFile(resolve(directory, migration), "utf8");
      // The file and its ledger row commit together: a migration that half-applied and
      // then recorded itself would be skipped forever in a state nobody could reproduce.
      await pool.query("begin");
      try {
        await pool.query(sql);
        await pool.query("insert into schema_migration (filename) values ($1)", [migration]);
        await pool.query("commit");
      } catch (error) {
        await pool.query("rollback");
        throw error;
      }
      console.log(`Applied ${migration}`);
      ran += 1;
    }
    console.log(ran === 0
      ? `Markets & Makers database is up to date (${migrations.length} migrations, none pending).`
      : `Markets & Makers database migrations complete (${ran} applied).`);
  } finally {
    await pool.query("select pg_advisory_unlock(hashtext('markets-and-makers-migrate'))");
  }
} finally {
  await pool.end();
}
