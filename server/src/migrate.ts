import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";
import { config } from "./config.js";

if (!config.databaseUrl) throw new Error("DATABASE_URL is required to run migrations.");
const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 1 });
try {
  const directory = resolve(process.cwd(), "sql");
  const migrations = (await readdir(directory)).filter((name) => /^\d+_.*\.sql$/.test(name)).sort();
  for (const migration of migrations) {
    const sql = await readFile(resolve(directory, migration), "utf8");
    await pool.query(sql);
    console.log(`Applied ${migration}`);
  }
  console.log("Markets & Makers database migrations complete.");
} finally {
  await pool.end();
}
