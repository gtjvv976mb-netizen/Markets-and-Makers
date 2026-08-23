import pg from "pg";
import { config } from "./config.js";

const { Pool } = pg;
export const pool = config.databaseUrl ? new Pool({ connectionString: config.databaseUrl, max: 10 }) : null;

export async function databaseHealth(): Promise<"ready" | "not-configured" | "unavailable"> {
  if (!pool) return "not-configured";
  try {
    await pool.query("select 1");
    return "ready";
  } catch {
    return "unavailable";
  }
}

export async function recordHeliusEvents(events: unknown[]): Promise<number> {
  if (!pool) return 0;
  let accepted = 0;
  const client = await pool.connect();
  try {
    await client.query("begin");
    for (const event of events) {
      if (!event || typeof event !== "object") continue;
      const signature = "signature" in event && typeof event.signature === "string" ? event.signature : null;
      if (!signature) continue;
      const result = await client.query(
        `insert into helius_event (signature, payload)
         values ($1, $2::jsonb)
         on conflict (signature) do nothing`,
        [signature, JSON.stringify(event)]
      );
      accepted += result.rowCount ?? 0;
    }
    await client.query("commit");
    return accepted;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function closeDatabase(): Promise<void> {
  await pool?.end();
}
