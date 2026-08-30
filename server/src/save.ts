/**
 * The player's city, stored by the authority rather than by one browser.
 *
 * This is a PROGRESS store, deliberately opaque: the authority does not read the payload,
 * validate its shape, or derive anything from it. That is the whole reason it is safe to
 * accept a blob the client authored — nothing here becomes money. The purse, the item
 * balances a market listing escrows against, the business registry and everything the
 * world tick settles are the authority's own rows, and a player who edits their save can
 * change what their city looks like on their screen and nothing else.
 *
 * If you are ever tempted to read a balance out of this column: don't. Put it in the
 * ledger, where the database's own `balance >= 0` check can hold it.
 */
import { pool } from "./database.js";

/**
 * The largest save the authority will keep, in bytes of JSON.
 *
 * A real city measures in tens of kilobytes; the cap is generous enough that no honest
 * player meets it and small enough that a thousand of them is megabytes, not gigabytes.
 * Refused loudly rather than truncated, because a silently trimmed save is a corrupted one.
 */
export const MAX_SAVE_BYTES = 256 * 1024;

export class SaveError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "SaveError";
  }
}

export interface StoredSave {
  revision: number;
  payload: unknown;
  updatedAt: string;
}

export async function readSave(realmId: string, playerId: string): Promise<StoredSave | null> {
  if (!pool) return null;
  const row = await pool.query<{ revision: string; payload: unknown; updated_at: Date }>(
    "select revision, payload, updated_at from player_save where realm_id=$1 and player_id=$2",
    [realmId, playerId]);
  const found = row.rows[0];
  if (!found) return null;
  return {
    revision: Number(found.revision),
    payload: found.payload,
    updatedAt: found.updated_at.toISOString(),
  };
}

/**
 * Keep this save if it is newer than the one already stored.
 *
 * Highest revision wins, and an equal revision is kept rather than replaced. Two tabs open
 * on one account is the ordinary case, not an attack: the stale one must not be able to
 * undo the live one simply by being the last to write. The client counts its own writes,
 * so "newer" means more edits, not a clock — two devices with disagreeing clocks would
 * otherwise hand the win to whichever was set fastest.
 */
export async function writeSave(
  realmId: string, playerId: string, revision: number, payload: unknown,
): Promise<{ stored: boolean; revision: number }> {
  if (!pool) throw new SaveError("database-unavailable", "The realm database is not configured.");
  if (payload === null || typeof payload !== "object") {
    throw new SaveError("bad-payload", "A save must be an object.");
  }
  const encoded = JSON.stringify(payload);
  if (encoded.length > MAX_SAVE_BYTES) {
    throw new SaveError("save-too-large",
      `A save may be at most ${Math.floor(MAX_SAVE_BYTES / 1024)}KB; this one is ${Math.floor(encoded.length / 1024)}KB.`);
  }
  const wanted = Math.max(0, Math.floor(Number(revision) || 0));

  const result = await pool.query<{ revision: string }>(
    `insert into player_save (realm_id, player_id, revision, payload, updated_at)
     values ($1,$2,$3,$4::jsonb, now())
     on conflict (realm_id, player_id) do update
       set revision = excluded.revision,
           payload = excluded.payload,
           updated_at = now()
     where player_save.revision <= excluded.revision
     returning revision`,
    [realmId, playerId, wanted, encoded]);

  if (result.rowCount) return { stored: true, revision: Number(result.rows[0]!.revision) };

  // Refused: what is stored is newer. Report the winning revision so the client can tell
  // the difference between "saved" and "you are behind" rather than guessing.
  const current = await readSave(realmId, playerId);
  return { stored: false, revision: current?.revision ?? wanted };
}

/** Forget a player's city entirely. Used by the account's own delete path. */
export async function dropSave(realmId: string, playerId: string): Promise<boolean> {
  if (!pool) return false;
  const result = await pool.query(
    "delete from player_save where realm_id=$1 and player_id=$2", [realmId, playerId]);
  return (result.rowCount ?? 0) > 0;
}
