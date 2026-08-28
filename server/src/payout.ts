// The payout ledger and its worker: how claimed $MM becomes a queued liability, a signed
// transaction, and finally a confirmed transfer — without ever being able to pay twice.
//
// THE STATE MACHINE
//
//   queued ----> submitted ----> confirmed        (the good path)
//     |             |
//     +-> failed    +-> failed                    (refused before signing / definitively
//                                                  dead on-chain)
//     +-> queued (again)                          (blockhash expired, provably unlanded)
//
// The invariant that matters: A SIGNED TRANSACTION IS NEVER BUILT TWICE FOR ONE REQUEST
// while the first could still land. The signature is written to the row in the same
// transaction that moves it to 'submitted' — before the send — so a crash between write
// and send leaves a row whose signature the worker can simply ask the chain about. The
// answer decides: confirmed -> confirmed; failed -> failed; not found AND the blockhash
// expired -> provably dead, safe to requeue; not found but still valid -> wait.
//
// Submission failures are treated as UNKNOWN, not as failure. An RPC timeout routinely
// happens after the transaction reached the leader. The one unrecoverable sin here is
// interpreting "I did not hear back" as "it did not happen" and signing again.
//
// WITHDRAWABLE
//
// withdrawable = sum(claimed_units) - sum(units of payouts in queued/submitted/confirmed)
//
// Derived on demand from the two tables that already exist, under the same per-player
// advisory lock the request path takes. There is no cached balance to drift.

import type { PoolClient } from "pg";
import { pool } from "./database.js";
import { command } from "./market.js";
import { config } from "./config.js";
import {
  buildTransfer, connection, parseTreasuryKey, resolveMint, signatureStatus,
  toRawUnits, treasuryLamports, type MintFacts,
} from "./treasury.js";
import { PublicKey } from "@solana/web3.js";

const REALM = "sunwoven-1";

/**
 * The floor under the treasury's SOL, in lamports (0.01 SOL).
 *
 * A signature costs 5,000 lamports and a first-time recipient ATA costs ~2,040,000 in
 * rent, both paid by the treasury. Below this the worker stops signing instead of failing
 * every payout five times and retiring legitimate liabilities.
 */
const MIN_TREASURY_LAMPORTS = 10_000_000;

export class PayoutError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

function db(): NonNullable<typeof pool> {
  if (!pool) throw new PayoutError("no-database", "No database configured.");
  return pool;
}

/** Earned minus already spoken for. The only definition of withdrawable anywhere. */
export async function withdrawableOf(
  on: { query: NonNullable<typeof pool>["query"] }, realmId: string, playerId: string,
): Promise<number> {
  const rows = await on.query<{ earned: string; held: string }>(
    `select
       (select coalesce(sum(claimed_units),0) from contribution_epoch
         where realm_id=$1 and player_id=$2) as earned,
       (select coalesce(sum(units),0) from payout_request
         where realm_id=$1 and player_id=$2 and state in ('queued','submitted','confirmed')) as held`,
    [realmId, playerId]);
  return Number(rows.rows[0]!.earned) - Number(rows.rows[0]!.held);
}

async function paidToday(client: PoolClient, realmId: string): Promise<number> {
  const row = await client.query<{ total: string }>(
    `select coalesce(sum(units),0) as total from payout_request
      where realm_id=$1 and state in ('queued','submitted','confirmed')
        and created_at > now() - interval '24 hours'`, [realmId]);
  return Number(row.rows[0]!.total);
}

export interface PayoutReceipt {
  id: string; units: number; state: string;
  withdrawableAfter: number;
}

/**
 * Queue a withdrawal. The destination is the SESSION's wallet — the address the player
 * proved with a signature at sign-in — taken from the authenticated principal, never from
 * the request body. The amount is whole $MM.
 */
export async function requestPayout(
  realmId: string, playerId: string, walletAddress: string, units: number, idempotencyKey: string,
): Promise<PayoutReceipt> {
  if (!config.payoutsEnabled) throw new PayoutError("payouts-disabled", "Withdrawals are not open yet.");
  if (!Number.isInteger(units) || units <= 0) throw new PayoutError("bad-amount", "Whole $MM only.");
  if (units < config.payoutMin) {
    throw new PayoutError("below-minimum", `Withdrawals start at ${config.payoutMin} $MM.`);
  }
  // The address goes through PublicKey once, here, so a malformed one is refused at the
  // door rather than discovered by the worker with a liability already on the books.
  try { void new PublicKey(walletAddress); } catch {
    throw new PayoutError("bad-address", "The session's wallet address does not parse.");
  }

  return command(idempotencyKey, "payout.request", playerId, async (client) => {
    // TWO locks, in a fixed order to make deadlock impossible: the realm lock guards the
    // realm-wide daily cap (a per-player lock never serialises two DIFFERENT players, so
    // N simultaneous requests each read the same pre-cap total and all pass), and the
    // per-player lock guards this player's withdrawable balance.
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [`${realmId}:payout:realm`]);
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [`${realmId}:payout:${playerId}`]);

    const open = await client.query(
      `select 1 from payout_request
        where realm_id=$1 and player_id=$2 and state in ('queued','submitted')`,
      [realmId, playerId]);
    if (open.rowCount) throw new PayoutError("payout-open", "A withdrawal is already in flight.");

    const withdrawable = await withdrawableOf(client, realmId, playerId);
    if (units > withdrawable) {
      throw new PayoutError("insufficient", `Withdrawable is ${withdrawable} $MM.`);
    }

    const today = await paidToday(client, realmId);
    if (today + units > config.payoutDailyCap) {
      throw new PayoutError("daily-cap", "The realm's daily withdrawal cap is reached. Try tomorrow.");
    }

    const inserted = await client.query<{ id: string }>(
      `insert into payout_request (realm_id, player_id, wallet_address, units)
       values ($1,$2,$3,$4) returning id`,
      [realmId, playerId, walletAddress, units]);

    return {
      id: inserted.rows[0]!.id, units, state: "queued",
      withdrawableAfter: withdrawable - units,
    };
  });
}

export interface PayoutRow {
  id: string; units: number; state: string; signature: string | null;
  error: string | null; createdAt: string; confirmedAt: string | null;
}

export async function payoutsOf(realmId: string, playerId: string, limit = 20): Promise<PayoutRow[]> {
  const rows = await db().query<{
    id: string; units: string; state: string; signature: string | null;
    error: string | null; created_at: Date; confirmed_at: Date | null;
  }>(
    `select id, units, state, signature, error, created_at, confirmed_at
       from payout_request where realm_id=$1 and player_id=$2
      order by created_at desc limit $3`, [realmId, playerId, Math.min(100, Math.max(1, limit))]);
  return rows.rows.map((row) => ({
    id: row.id, units: Number(row.units), state: row.state, signature: row.signature,
    error: row.error, createdAt: row.created_at.toISOString(),
    confirmedAt: row.confirmed_at ? row.confirmed_at.toISOString() : null,
  }));
}

// ---------------------------------------------------------------------------
// The worker
// ---------------------------------------------------------------------------

let mintFacts: MintFacts | null = null;

export interface WorkerReport {
  submitted: string[]; confirmed: string[]; requeued: string[]; failed: string[];
  /** The treasury is too low on SOL to pay fees. Signing stopped rather than burning
   *  attempts against an empty account. */
  starved?: boolean;
}

/**
 * One pass of the payout worker. Called on an interval; safe to call concurrently with
 * itself because every row is taken FOR UPDATE SKIP LOCKED.
 *
 * Order matters: settle the in-flight 'submitted' rows FIRST, then sign new work. A
 * worker that signed first could exhaust its pass before ever checking a transaction
 * whose fate decides whether the player may withdraw again.
 */
export async function runPayoutWorker(deps?: {
  submitRaw?: (raw: Buffer) => Promise<void>;
  status?: (signature: string) => Promise<"confirmed" | "pending" | "not-found" | "failed">;
  blockhash?: () => Promise<{ blockhash: string; lastValidBlockHeight: number }>;
  blockHeight?: () => Promise<number>;
  lamports?: () => Promise<number>;
  mint?: MintFacts;
  treasurySecret?: string;
}): Promise<WorkerReport> {
  const report: WorkerReport = { submitted: [], confirmed: [], requeued: [], failed: [] };
  if (!config.payoutsEnabled || !pool) return report;

  const conn = connection();
  const submitRaw = deps?.submitRaw
    ?? (async (raw: Buffer) => { await conn.sendRawTransaction(raw, { skipPreflight: false }); });
  const status = deps?.status ?? ((signature: string) => signatureStatus(conn, signature));
  const blockhash = deps?.blockhash ?? (() => conn.getLatestBlockhash("confirmed"));
  // finalized: see the expiry note in the settle pass.
  const blockHeight = deps?.blockHeight ?? (() => conn.getBlockHeight("finalized"));

  const secret = deps?.treasurySecret ?? config.payoutTreasurySecret;
  const treasury = parseTreasuryKey(secret);
  const lamports = deps?.lamports ?? (() => treasuryLamports(conn, treasury.publicKey));
  if (!mintFacts && !deps?.mint) mintFacts = await resolveMint(conn, config.tokenMint);
  const mint = deps?.mint ?? mintFacts!;

  const client = await pool.connect();
  try {
    // --- 1. settle what is in flight ---------------------------------------
    await client.query("begin");
    const inFlight = await client.query<{
      id: string; signature: string | null; last_valid_block_height: string | null; prior_signatures: string[];
    }>(
      `select id, signature, last_valid_block_height, prior_signatures from payout_request
        where realm_id=$1 and state='submitted' order by created_at
        limit 50 for update skip locked`, [REALM]);
    // FINALIZED, not confirmed. The height and the per-signature status are separate RPC
    // calls that a load-balanced endpoint can serve from different nodes; a node ahead on
    // 'confirmed' plus a node lagging on status reads as "expired and never seen" for a
    // transfer that in fact landed. A finalized height past the expiry is rooted and
    // cannot be reorganised, which makes the deduction actually safe.
    const height = inFlight.rows.some((row) => row.signature) ? await blockHeight() : 0;

    for (const row of inFlight.rows) {
      if (!row.signature) {
        // A submitted row with no signature cannot exist by construction; if it somehow
        // does, it is unrecoverable by signature and must be inspected by a person.
        await client.query(
          `update payout_request set state='failed', error='submitted without signature' where id=$1`, [row.id]);
        report.failed.push(row.id);
        continue;
      }
      // Every signature this row has ever carried, newest first. A requeued attempt whose
      // transaction lands late is found here rather than silently paying twice.
      const candidates = [row.signature, ...(row.prior_signatures ?? [])];
      let verdict = await status(row.signature);
      if (verdict !== "confirmed") {
        for (const prior of row.prior_signatures ?? []) {
          if (await status(prior) === "confirmed") { verdict = "confirmed"; break; }
        }
      }
      void candidates;
      if (verdict === "confirmed") {
        await client.query(
          `update payout_request set state='confirmed', confirmed_at=now() where id=$1`, [row.id]);
        report.confirmed.push(row.id);
      } else if (verdict === "failed") {
        // Definitive on-chain failure: the transaction executed and errored, so it can
        // never also have moved the tokens. Releasing the hold is safe.
        await client.query(
          `update payout_request set state='failed', error='transaction failed on-chain' where id=$1`, [row.id]);
        report.failed.push(row.id);
      } else if (verdict === "not-found") {
        // Provably dead only once the chain's height has passed the blockhash's validity:
        // a transaction the chain has never seen cannot land after that. Before then,
        // "not found" may mean "not yet propagated", and touching the row would open the
        // door to a second signing of a transfer that still might land.
        const expiry = row.last_valid_block_height ? Number(row.last_valid_block_height) : null;
        if (expiry !== null && height > expiry) {
          // attempts counts SIGNINGS, and the signing pass below increments it. Counting
          // the requeue too made every expiry cost two of the five lives.
          //
          // The signature is ARCHIVED, never discarded. Nulling it was the second
          // double-pay path the review found: a transfer that landed despite reading as
          // not-found became a payment with no record on the row — invisible to the
          // settle pass, and to any audit afterwards. array_append reads the OLD row, so
          // it captures the signature this same statement is clearing.
          await client.query(
            `update payout_request set state='queued',
                    prior_signatures = array_append(prior_signatures, signature),
                    signature=null, last_valid_block_height=null,
                    error='expired unlanded; requeued'
              where id=$1 and state='submitted'`, [row.id]);
          report.requeued.push(row.id);
        }
      }
      // "pending": the chain has it but below confirmed; leave it.
    }
    await client.query("commit");

    // --- 2. sign and submit new work ---------------------------------------
    //
    // ONE ROW PER TRANSACTION. The previous shape selected a batch of ten FOR UPDATE SKIP
    // LOCKED and then committed after each row — and a commit releases every row lock the
    // transaction held. Rows 2..10 became unlocked while still 'queued', a second worker
    // (guaranteed during a rolling deploy: the `paying` guard is per-process) could claim
    // and sign one, and this loop would then reach the same row in its now-stale array and
    // overwrite that signature with its own. Two validly signed transfers, both live, one
    // row recording only the second. That is a double payment which no later audit could
    // even see, because the first signature had been overwritten.
    //
    // Selecting one row at a time and holding the lock across the whole claim removes the
    // stale array entirely. The `and state='queued'` predicate is the belt to that braces:
    // if anything did change the row underneath us, the UPDATE matches nothing, rowCount
    // is 0, and we sign nothing.
    for (let taken = 0; taken < 10; taken += 1) {
      await client.query("begin");
      const queued = await client.query<{ id: string; wallet_address: string; units: string; attempts: number }>(
        `select id, wallet_address, units, attempts from payout_request
          where realm_id=$1 and state='queued' order by created_at
          limit 1 for update skip locked`, [REALM]);
      const row = queued.rows[0];
      if (!row) { await client.query("commit"); break; }

      if (row.attempts >= 5) {
        await client.query(
          `update payout_request set state='failed', error='gave up after 5 attempts'
            where id=$1 and state='queued'`, [row.id]);
        await client.query("commit");
        report.failed.push(row.id);
        continue;
      }

      // The treasury pays every fee and funds each first-time recipient ATA. Signing with
      // an empty treasury burns an attempt per pass and would retire a legitimate payout
      // after five, so this stops BEFORE spending one.
      if (await lamports() < MIN_TREASURY_LAMPORTS) {
        await client.query("commit");
        report.starved = true;
        break;
      }

      const recent = await blockhash();
      const prepared = buildTransfer({
        treasury, mint,
        recipient: new PublicKey(row.wallet_address),
        units: toRawUnits(Number(row.units), mint.decimals),
        recentBlockhash: recent.blockhash,
        lastValidBlockHeight: recent.lastValidBlockHeight,
      });

      // The point of no return, in the right order: the signature is durable BEFORE the
      // bytes leave. A crash on the next line leaves a row the settle pass can resolve.
      const promoted = await client.query(
        `update payout_request set state='submitted', signature=$2, submitted_at=now(),
                last_valid_block_height=$3, attempts=attempts+1
          where id=$1 and state='queued'`,
        [row.id, prepared.signature, prepared.lastValidBlockHeight]);
      if (!promoted.rowCount) { await client.query("rollback"); continue; }
      await client.query("commit");

      try {
        await submitRaw(prepared.raw);
        report.submitted.push(row.id);
      } catch {
        // UNKNOWN, not failure: the transaction may be on its way to a leader regardless.
        // The row stays 'submitted' and the next settle pass asks the chain by signature.
        report.submitted.push(row.id);
      }
    }
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  return report;
}
