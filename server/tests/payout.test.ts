// The payout state machine against a real database, with the chain mocked.
//
// The chain mock is not a convenience — it is the point. Every dangerous moment in a
// payout is a particular ANSWER from the chain (or a refusal to answer), and a mock can
// serve exactly the answer under test: the timeout that arrives after the transaction
// landed, the signature the chain claims never to have seen, the blockhash that expired.
// The devnet rehearsal exercises the same worker against real RPC; these tests exercise
// the decisions.

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { Keypair } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import bs58 from "bs58";
import { pool, closeDatabase } from "../src/database.js";
import { requestPayout, runPayoutWorker, withdrawableOf, PayoutError } from "../src/payout.js";
import { config } from "../src/config.js";
import { epochIdFor } from "../src/catalogue.js";
import type { MintFacts } from "../src/treasury.js";
import { live as liveDatabase } from "./live-database.js";

const suite = liveDatabase ? describe : describe.skip;
const REALM = "sunwoven-1";

const TREASURY = Keypair.generate();
const MINT: MintFacts = { address: Keypair.generate().publicKey, programId: TOKEN_2022_PROGRAM_ID, decimals: 6 };
const SECRET = bs58.encode(TREASURY.secretKey);

/** A wallet-holding player who has earned `claimed` $MM. */
async function maker(claimed: number): Promise<{ id: string; wallet: string }> {
  const wallet = Keypair.generate().publicKey.toBase58();
  const created = await pool!.query<{ id: string }>(
    `insert into player (display_name, wallet_address) values ('Maker', $1) returning id`, [wallet]);
  const id = created.rows[0]!.id;
  await pool!.query(
    `insert into contribution_epoch (realm_id, epoch_id, player_id, contribution, claimed_units, claimed_at)
     values ($1,$2,$3,1,$4,now())`, [REALM, epochIdFor(), id, claimed]);
  return { id, wallet };
}

// One close for the whole file: the two suites share the pool, and the first suite's
// afterAll closing it left the second suite testing a closed pool, not the worker.
afterAll(async () => {
  (config as { payoutsEnabled: boolean }).payoutsEnabled = false;
  // payout_request.player_id is ON DELETE RESTRICT — deliberately, so a payout outlives
  // the account until an operator settles it. That means rows left here would block every
  // later suite's `delete from player`, so this file clears its own.
  for (const table of ["payout_request", "command_receipt", "contribution_epoch"]) {
    await pool!.query(`delete from ${table}`);
  }
  await pool!.query(`delete from player`);
  await closeDatabase();
});

const stateOf = async (id: string): Promise<{ state: string; signature: string | null; attempts: number }> => {
  const row = await pool!.query<{ state: string; signature: string | null; attempts: number }>(
    `select state, signature, attempts from payout_request where player_id=$1 order by created_at desc limit 1`, [id]);
  return row.rows[0]!;
};

/** A chain that answers exactly as told. */
function chain(overrides?: Partial<Parameters<typeof runPayoutWorker>[0]>): NonNullable<Parameters<typeof runPayoutWorker>[0]> {
  return {
    submitRaw: async () => {},
    status: async () => "confirmed" as const,
    blockhash: async () => ({ blockhash: bs58.encode(Buffer.alloc(32, 3)), lastValidBlockHeight: 500 }),
    blockHeight: async () => 100,
    lamports: async () => 1_000_000_000,      // a well-funded treasury unless a test says otherwise
    mint: MINT,
    treasurySecret: SECRET,
    ...overrides,
  };
}

suite("the payout ledger", () => {
  beforeEach(async () => {
    (config as { payoutsEnabled: boolean }).payoutsEnabled = true;
    for (const table of ["market_listing", "auth_session", "payout_request", "contribution_epoch",
                         "reserve_funding", "command_receipt", "business"]) {
      await pool!.query(`delete from ${table}`);
    }
    await pool!.query(`delete from player`);
  });

  it("computes withdrawable as earned minus spoken-for", async () => {
    const m = await maker(5_000);
    expect(await withdrawableOf(pool!, REALM, m.id)).toBe(5_000);
    await requestPayout(REALM, m.id, m.wallet, 1_200, randomUUID());
    expect(await withdrawableOf(pool!, REALM, m.id), "a queued payout is already a liability").toBe(3_800);
  });

  it("refuses more than is withdrawable", async () => {
    const m = await maker(500);
    await expect(requestPayout(REALM, m.id, m.wallet, 501, randomUUID()))
      .rejects.toThrow(PayoutError);
  });

  it("refuses below the minimum and refuses fractions", async () => {
    const m = await maker(5_000);
    await expect(requestPayout(REALM, m.id, m.wallet, config.payoutMin - 1, randomUUID())).rejects.toThrow(/start at/);
    await expect(requestPayout(REALM, m.id, m.wallet, 100.5, randomUUID())).rejects.toThrow(/Whole/);
  });

  it("allows only one open payout per player", async () => {
    const m = await maker(5_000);
    await requestPayout(REALM, m.id, m.wallet, 1_000, randomUUID());
    await expect(requestPayout(REALM, m.id, m.wallet, 1_000, randomUUID()))
      .rejects.toThrow(/already in flight/);
  });

  it("actually takes the per-player lock before reading the balance", async () => {
    // My first race test fired two Promise.allSettled requests and asserted one lost. It
    // kept passing with the advisory lock removed AND the unique index dropped — the
    // event loop happened to serialise two short transactions, so the test was passing on
    // scheduling luck, not on any guarantee. This version is deterministic: hold the very
    // lock the code computes from another connection, and prove the request path BLOCKS
    // on it. Sabotage the lock acquisition and the request sails through while it is held.
    const m = await maker(1_000);
    const holder = await pool!.connect();
    try {
      await holder.query("begin");
      await holder.query("select pg_advisory_xact_lock(hashtext($1))", [`${REALM}:payout:${m.id}`]);

      let settled = false;
      const attempt = requestPayout(REALM, m.id, m.wallet, 800, randomUUID())
        .finally(() => { settled = true; });
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(settled, "the request must be waiting on the lock, not past it").toBe(false);

      await holder.query("rollback");   // release; the request proceeds
      await attempt;
      expect(await withdrawableOf(pool!, REALM, m.id)).toBe(200);
    } finally {
      holder.release();
    }
  });

  it("is backstopped by the unique index even if the lock were bypassed", async () => {
    // Defence in depth, proven separately: two open rows for one player must be
    // impossible AT THE SCHEMA, so a future refactor that loses the lock still cannot
    // double-hold. Raw inserts bypass every application guard on purpose.
    const m = await maker(5_000);
    await pool!.query(
      `insert into payout_request (realm_id, player_id, wallet_address, units) values ($1,$2,$3,500)`,
      [REALM, m.id, m.wallet]);
    await expect(pool!.query(
      `insert into payout_request (realm_id, player_id, wallet_address, units) values ($1,$2,$3,500)`,
      [REALM, m.id, m.wallet],
    )).rejects.toThrow(/payout_request_one_open_idx|duplicate key/);
  });

  it("replays the same receipt for a repeated idempotency key", async () => {
    const m = await maker(5_000);
    const key = randomUUID();
    const first = await requestPayout(REALM, m.id, m.wallet, 1_000, key);
    const again = await requestPayout(REALM, m.id, m.wallet, 1_000, key);
    expect(again).toEqual(first);
    const rows = await pool!.query(`select count(*)::int as n from payout_request where player_id=$1`, [m.id]);
    expect(rows.rows[0]!.n, "one row, not two").toBe(1);
  });

  it("enforces the realm's daily cap", async () => {
    const m1 = await maker(config.payoutDailyCap);
    await requestPayout(REALM, m1.id, m1.wallet, config.payoutDailyCap, randomUUID());
    const m2 = await maker(5_000);
    await expect(requestPayout(REALM, m2.id, m2.wallet, config.payoutMin, randomUUID()))
      .rejects.toThrow(/daily/);
  });

  it("refuses everything while payouts are disabled", async () => {
    (config as { payoutsEnabled: boolean }).payoutsEnabled = false;
    const m = await maker(5_000);
    await expect(requestPayout(REALM, m.id, m.wallet, 1_000, randomUUID()))
      .rejects.toThrow(/not open/);
  });
});

suite("the payout worker", () => {
  beforeEach(async () => {
    (config as { payoutsEnabled: boolean }).payoutsEnabled = true;
    for (const table of ["market_listing", "auth_session", "payout_request", "contribution_epoch",
                         "reserve_funding", "command_receipt", "business"]) {
      await pool!.query(`delete from ${table}`);
    }
    await pool!.query(`delete from player`);
  });

  it("signs, submits, and later confirms", async () => {
    const m = await maker(5_000);
    await requestPayout(REALM, m.id, m.wallet, 1_000, randomUUID());

    await runPayoutWorker(chain({ status: async () => "pending" as const }));
    const submitted = await stateOf(m.id);
    expect(submitted.state).toBe("submitted");
    expect(submitted.signature, "the signature is on the row").toBeTruthy();

    await runPayoutWorker(chain({ status: async () => "confirmed" as const }));
    expect((await stateOf(m.id)).state).toBe("confirmed");
  });

  it("writes the signature BEFORE the bytes leave", async () => {
    // The crash-recovery property. If the process dies between signing and sending, the
    // row must already carry the signature so the next pass can ask the chain about it.
    const m = await maker(5_000);
    await requestPayout(REALM, m.id, m.wallet, 1_000, randomUUID());

    let signatureAtSendTime: string | null = "unread";
    await runPayoutWorker(chain({
      submitRaw: async () => {
        signatureAtSendTime = (await stateOf(m.id)).signature;
        throw new Error("simulated crash during send");
      },
    }));
    expect(signatureAtSendTime, "durable before the send").toBeTruthy();
    expect((await stateOf(m.id)).state, "and the row stays submitted, not failed").toBe("submitted");
  });

  it("treats a send timeout as UNKNOWN and does not sign twice", async () => {
    // The classic double-pay: the RPC times out, the transaction lands anyway.
    const m = await maker(5_000);
    await requestPayout(REALM, m.id, m.wallet, 1_000, randomUUID());

    const signedPayloads: string[] = [];
    const failing = chain({
      submitRaw: async (raw: Buffer) => { signedPayloads.push(raw.toString("hex")); throw new Error("timeout"); },
    });
    await runPayoutWorker(failing);
    const afterTimeout = await stateOf(m.id);
    expect(afterTimeout.state).toBe("submitted");

    // Next pass: the chain reveals the transaction DID land. No new signing.
    await runPayoutWorker(chain({
      submitRaw: async (raw: Buffer) => { signedPayloads.push(raw.toString("hex")); },
      status: async () => "confirmed" as const,
    }));
    expect((await stateOf(m.id)).state).toBe("confirmed");
    expect(signedPayloads, "exactly one transaction was ever signed").toHaveLength(1);
  });

  it("retries only when the blockhash is provably expired", async () => {
    // Writing this test taught me what the worker actually does: settle runs before
    // sign, so a payout requeued as provably dead is re-signed IN THE SAME PASS. The
    // observable outcome of expiry is therefore not 'queued' — it is a fresh submission
    // with a DIFFERENT signature and one more attempt. Asserting the intermediate state
    // was asserting an implementation detail that never survives the pass.
    let round = 0;
    const freshBlockhash = async () => ({
      blockhash: bs58.encode(Buffer.alloc(32, 40 + (round += 1))), lastValidBlockHeight: 500 + round,
    });

    const m = await maker(5_000);
    await requestPayout(REALM, m.id, m.wallet, 1_000, randomUUID());
    await runPayoutWorker(chain({ blockhash: freshBlockhash, status: async () => "pending" as const }));
    const first = await stateOf(m.id);

    // not-found but the chain height is BELOW the expiry: not provably dead — hands off.
    await runPayoutWorker(chain({ blockhash: freshBlockhash, status: async () => "not-found" as const, blockHeight: async () => 1 }));
    const held = await stateOf(m.id);
    expect(held.state).toBe("submitted");
    expect(held.signature, "the original signature is untouched").toBe(first.signature);
    expect(held.attempts, "and nothing was re-signed").toBe(first.attempts);

    // not-found AND the height has passed it: provably dead, so requeue and re-sign.
    await runPayoutWorker(chain({ blockhash: freshBlockhash, status: async () => "not-found" as const, blockHeight: async () => 10_000 }));
    const retried = await stateOf(m.id);
    expect(retried.state).toBe("submitted");
    expect(retried.signature, "a new transaction, not the dead one").not.toBe(first.signature);
    expect(retried.attempts).toBe(first.attempts + 1);
  });

  it("releases the hold when a transaction definitively fails on-chain", async () => {
    const m = await maker(5_000);
    await requestPayout(REALM, m.id, m.wallet, 1_000, randomUUID());
    await runPayoutWorker(chain({ status: async () => "pending" as const }));
    await runPayoutWorker(chain({ status: async () => "failed" as const }));
    expect((await stateOf(m.id)).state).toBe("failed");
    expect(await withdrawableOf(pool!, REALM, m.id), "a failed payout returns the balance").toBe(5_000);
  });

  it("gives up after five attempts instead of burning fees forever", async () => {
    const m = await maker(5_000);
    await requestPayout(REALM, m.id, m.wallet, 1_000, randomUUID());
    for (let round = 0; round < 6; round += 1) {
      await runPayoutWorker(chain({ status: async () => "not-found" as const, blockHeight: async () => 10_000 }));
    }
    const final = await stateOf(m.id);
    expect(final.state).toBe("failed");
    expect(await withdrawableOf(pool!, REALM, m.id), "and the hold is released").toBe(5_000);
  });

  it("stops signing when the treasury cannot pay fees, WITHOUT burning attempts", async () => {
    // Signing against an empty treasury fails on-chain and costs an attempt each pass, so
    // five passes would retire a perfectly valid liability for an operational problem.
    const m = await maker(5_000);
    await requestPayout(REALM, m.id, m.wallet, 1_000, randomUUID());
    const report = await runPayoutWorker(chain({ lamports: async () => 1_000 }));
    expect(report.starved).toBe(true);
    const row = await stateOf(m.id);
    expect(row.state, "still queued, waiting for SOL").toBe("queued");
    expect(row.attempts, "and no attempt was spent").toBe(0);
  });

  it("finds a transfer that landed under a SUPERSEDED signature", async () => {
    // The second double-pay path the review found. A row requeued as 'expired unlanded'
    // used to have its signature nulled; if that transaction then landed, the tokens were
    // gone with nothing on the row naming them. The signature is archived instead, and
    // every archived one is re-checked before the row can be paid again.
    const m = await maker(5_000);
    await requestPayout(REALM, m.id, m.wallet, 1_000, randomUUID());
    await runPayoutWorker(chain({ status: async () => "pending" as const }));
    const first = (await stateOf(m.id)).signature!;

    // Expire it: not-found, and the finalized height is past the blockhash.
    await runPayoutWorker(chain({
      status: async () => "not-found" as const, blockHeight: async () => 10_000,
      submitRaw: async () => { throw new Error("hold here"); },
    }));
    const archived = await pool!.query<{ prior_signatures: string[] }>(
      `select prior_signatures from payout_request where player_id=$1`, [m.id]);
    expect(archived.rows[0]!.prior_signatures, "the dead signature is kept").toContain(first);

    // Now the ORIGINAL transaction turns out to have landed after all.
    await runPayoutWorker(chain({ status: async (sig: string) => sig === first ? "confirmed" as const : "not-found" as const }));
    expect((await stateOf(m.id)).state, "settled on the superseded signature").toBe("confirmed");
  });

  it("never signs one payout twice, even with two workers running at once", async () => {
    // THE critical finding. A rolling deploy runs two instances; the `paying` guard in
    // index.ts is a per-process local, so both timers fire together. The old shape
    // selected a batch of ten FOR UPDATE SKIP LOCKED and committed after each row, which
    // released the locks on the rest of the batch while they were still 'queued' — then
    // kept iterating its now-stale array and overwrote whatever the other worker had
    // signed. Two live transfers, one row naming only the last: a double payment no audit
    // could see.
    const makers = await Promise.all(Array.from({ length: 6 }, () => maker(5_000)));
    for (const m of makers) await requestPayout(REALM, m.id, m.wallet, 200, randomUUID());

    // Every signature either worker ever hands to the chain, with a delay inside the send
    // to widen the interleaving window.
    const sent: string[] = [];
    const slowSend = async (raw: Buffer) => {
      await new Promise((resolve) => setTimeout(resolve, 15));
      sent.push(bs58.encode(raw.subarray(1, 65)));
    };
    let nonce = 0;
    const racing = () => chain({
      submitRaw: slowSend,
      status: async () => "pending" as const,
      blockhash: async () => ({ blockhash: bs58.encode(Buffer.alloc(32, (nonce += 1) % 251 + 1)), lastValidBlockHeight: 5_000 }),
    });

    await Promise.all([runPayoutWorker(racing()), runPayoutWorker(racing())]);

    const rows = await pool!.query<{ id: string; signature: string | null }>(
      `select id, signature from payout_request where realm_id=$1`, [REALM]);
    const onRow = rows.rows.map((r) => r.signature).filter(Boolean) as string[];

    // Every signature that reached the chain must be the one its row records. A signature
    // sent but not stored is a transfer nobody can reconcile.
    for (const signature of sent) {
      expect(onRow, `signature ${signature.slice(0, 12)}… was sent but is not on any row`).toContain(signature);
    }
    expect(new Set(sent).size, "no signature sent twice").toBe(sent.length);
    expect(sent.length, "one signed transfer per payout, not more").toBeLessThanOrEqual(makers.length);
  });

  it("does nothing at all while payouts are disabled", async () => {
    const m = await maker(5_000);
    await requestPayout(REALM, m.id, m.wallet, 1_000, randomUUID());
    (config as { payoutsEnabled: boolean }).payoutsEnabled = false;
    const report = await runPayoutWorker(chain());
    expect(report).toEqual({ submitted: [], confirmed: [], requeued: [], failed: [] });
    expect((await stateOf(m.id)).state).toBe("queued");
  });
});
