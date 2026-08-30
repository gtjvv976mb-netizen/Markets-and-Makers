/**
 * Can the realm actually pay what it has promised?
 *
 * The moment withdrawals open, in-game $MM stops being a score and becomes a claim on a
 * real token: `withdrawableOf` pays `sum(contribution_epoch.claimed_units)` minus what is
 * already in flight, and the payout worker signs a Token-2022 transfer out of the treasury
 * wallet. Nothing connected those two facts. The emission budget is bounded by
 * REWARDS_POOL_MM — a constant, 25,000,000 — with no idea what the wallet holds, so the
 * game could cheerfully promise more $MM than exists in the account it pays from.
 *
 * This is the missing link, and it enforces ONE property:
 *
 *     the realm may never owe more $MM than the treasury actually holds.
 *
 * Emission is capped by headroom (held minus outstanding), so a thinly-funded treasury
 * quietly issues less rather than writing cheques it cannot honour. Under-issuing is a
 * disappointment; over-issuing is a default, and only one of those is recoverable.
 *
 * The chain read is SAMPLED, not made in the hot path: a claim must not depend on an RPC
 * round trip, and ten concurrent claims must not make ten of them.
 */
import { PublicKey } from "@solana/web3.js";
import { config } from "./config.js";
import { pool } from "./database.js";
import {
  connection, parseTreasuryKey, resolveMint, treasuryTokenUnits, type MintFacts,
} from "./treasury.js";

/** How long a sampled on-chain balance is trusted before it is read again. */
const BALANCE_TTL_MS = 60_000;

export interface SolvencyReport {
  /** Whole $MM the treasury wallet holds on-chain, or null when it cannot be read. */
  held: number | null;
  /** Whole $MM players have claimed and not yet withdrawn. What the realm owes. */
  outstanding: number;
  /** held - outstanding. Null when the balance is unknown. */
  headroom: number | null;
  status: "ok" | "thin" | "insolvent" | "unknown" | "off";
}

let cached: { at: number; held: number | null } = { at: 0, held: null };
let mintFacts: MintFacts | null = null;

/** Reset the sampler. Tests only. */
export function forgetSolvencySample(): void {
  cached = { at: 0, held: null };
  mintFacts = null;
}

/** What the realm owes: claimed, less anything already queued, sent or confirmed. */
export async function outstandingLiability(realmId: string): Promise<number> {
  if (!pool) return 0;
  const row = await pool.query<{ claimed: string; paid: string }>(
    `select
       (select coalesce(sum(claimed_units),0) from contribution_epoch where realm_id=$1) as claimed,
       (select coalesce(sum(units),0) from payout_request
         where realm_id=$1 and state in ('queued','submitted','confirmed')) as paid`,
    [realmId]);
  const claimed = Number(row.rows[0]?.claimed ?? 0);
  const paid = Number(row.rows[0]?.paid ?? 0);
  return Math.max(0, claimed - paid);
}

/**
 * The treasury's on-chain $MM, sampled.
 *
 * Null means "could not be read" and is never treated as zero by callers that gate
 * emission — an RPC hiccup must not silently halt the economy, and it must not silently
 * license unlimited issuance either. Callers decide which way to fail; see epochCeiling.
 */
async function heldOnChain(now: number): Promise<number | null> {
  if (!config.tokenMint || !config.payoutTreasurySecret) return null;
  if (now - cached.at < BALANCE_TTL_MS) return cached.held;
  try {
    const conn = connection();
    if (!mintFacts) mintFacts = await resolveMint(conn, config.tokenMint);
    const owner = parseTreasuryKey(config.payoutTreasurySecret).publicKey;
    const held = await treasuryTokenUnits(conn, mintFacts, owner);
    cached = { at: now, held };
    return held;
  } catch {
    cached = { at: now, held: null };
    return null;
  }
}

export async function solvency(realmId: string, now = Date.now()): Promise<SolvencyReport> {
  const outstanding = await outstandingLiability(realmId);
  if (!config.payoutsEnabled) return { held: null, outstanding, headroom: null, status: "off" };
  const held = await heldOnChain(now);
  if (held === null) return { held: null, outstanding, headroom: null, status: "unknown" };
  const headroom = held - outstanding;
  const status = headroom < 0 ? "insolvent" : headroom < outstanding * 0.2 ? "thin" : "ok";
  return { held, outstanding, headroom, status };
}

/**
 * The most $MM this epoch may issue without the realm owing more than it holds.
 *
 * Returns Infinity when payouts are OFF — $MM is then an internal score backed by nothing
 * and bounded by REWARDS_POOL_MM, which is the pre-launch behaviour and stays untouched.
 *
 * When payouts are ON and the balance CANNOT be read, this returns 0. That is deliberate
 * and it is the conservative direction: an unreadable balance means an unknown liability,
 * and issuing against an unknown is how a default happens. Claims already earned are
 * unaffected — this caps NEW issuance, never what a player is already owed.
 */
export async function epochCeiling(realmId: string, now = Date.now()): Promise<number> {
  if (!config.payoutsEnabled) return Number.POSITIVE_INFINITY;
  const report = await solvency(realmId, now);
  if (report.headroom === null) return 0;
  return Math.max(0, report.headroom);
}
