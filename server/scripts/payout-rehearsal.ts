// The devnet rehearsal: the REAL payout path, end to end, with nothing real at stake.
//
//   throwaway treasury key -> devnet SOL airdrop -> a fresh Token-2022 mint (the same
//   program mainnet $MM uses) -> supply minted to the treasury -> a player row in a
//   scratch database -> requestPayout() -> runPayoutWorker() against real devnet RPC ->
//   the recipient's on-chain balance, read back and compared to the coin.
//
// Everything here is disposable by construction: the keys are generated (or read from
// REHEARSAL_TREASURY, base58, to reuse across runs — devnet airdrops are rate-limited),
// the mint is created fresh, and the database is a local scratch one. Nothing touches
// mainnet, the live database, or any real secret. Run it with:
//
//   createdb mm_rehearsal 2>/dev/null; \
//   DATABASE_URL=postgres://localhost:5432/mm_rehearsal MM_PAYOUTS=1 SOLANA_NETWORK=devnet \
//   MM_PAYOUT_MIN=1 npx tsx scripts/payout-rehearsal.ts
//
// The exit code is the verdict: 0 only when the balance landed exactly.

import { randomUUID } from "node:crypto";
import { Connection, Keypair, LAMPORTS_PER_SOL, sendAndConfirmTransaction, SystemProgram, Transaction } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction,
  createInitializeMintInstruction, createMintToInstruction,
  getAssociatedTokenAddressSync, getMintLen,
} from "@solana/spl-token";
import bs58 from "bs58";

const url = process.env.DATABASE_URL ?? "";
if (!url.includes("localhost") && !url.includes("127.0.0.1")) {
  console.error("refusing: DATABASE_URL must be a local scratch database");
  process.exit(2);
}
if (process.env.SOLANA_NETWORK !== "devnet") {
  console.error("refusing: SOLANA_NETWORK must be devnet");
  process.exit(2);
}
// REHEARSAL_RPC lets the same rehearsal run against a local test validator — the same
// Agave binary and the same Token-2022 program as devnet, minus the public faucet's rate
// limit. Mainnet URLs are refused outright.
const RPC = process.env.REHEARSAL_RPC ?? "https://api.devnet.solana.com";
if (RPC.includes("mainnet")) { console.error("refusing: mainnet RPC"); process.exit(2); }

// Env is settled; only now may modules that read config at import time load.
const { pool } = await import("../src/database.js");
const { requestPayout, runPayoutWorker, withdrawableOf } = await import("../src/payout.js");
const { signatureStatus } = await import("../src/treasury.js");
const { epochIdFor } = await import("../src/catalogue.js");

const REALM = "sunwoven-1";
const AMOUNT = 137;              // an amount nobody would mistake for a leftover
const DECIMALS = 6;

const step = (label: string, value: unknown = ""): void => console.log(`  ${label} ${value}`);
const connection = new Connection(RPC, "confirmed");
console.log(`rpc: ${RPC}`);

// --- 1. keys ---------------------------------------------------------------
const treasury = process.env.REHEARSAL_TREASURY
  ? Keypair.fromSecretKey(bs58.decode(process.env.REHEARSAL_TREASURY))
  : Keypair.generate();
const recipient = Keypair.generate();
console.log("1. keys (throwaway)");
step("treasury ", treasury.publicKey.toBase58());
step("recipient", recipient.publicKey.toBase58());
if (!process.env.REHEARSAL_TREASURY) {
  step("reuse with", `REHEARSAL_TREASURY=${bs58.encode(treasury.secretKey)}`);
}

// --- 2. SOL ---------------------------------------------------------------
console.log("2. devnet SOL");
let lamports = await connection.getBalance(treasury.publicKey);
if (lamports < 0.05 * LAMPORTS_PER_SOL) {
  try {
    const sig = await connection.requestAirdrop(treasury.publicKey, LAMPORTS_PER_SOL);
    await connection.confirmTransaction(sig, "confirmed");
  } catch (error) {
    console.error(`  airdrop refused (${(error as Error).message}).`);
    console.error("  Devnet airdrops are rate-limited; fund the treasury above yourself");
    console.error("  (faucet.solana.com) and re-run with REHEARSAL_TREASURY set.");
    process.exit(3);
  }
  lamports = await connection.getBalance(treasury.publicKey);
}
step("balance  ", `${lamports / LAMPORTS_PER_SOL} SOL`);

// --- 3. a fresh Token-2022 mint -------------------------------------------
console.log("3. Token-2022 mint (the program mainnet $MM uses)");
const mintPair = Keypair.generate();
const mintLen = getMintLen([]);
const rent = await connection.getMinimumBalanceForRentExemption(mintLen);
const treasuryAta = getAssociatedTokenAddressSync(mintPair.publicKey, treasury.publicKey, false, TOKEN_2022_PROGRAM_ID);
await sendAndConfirmTransaction(connection, new Transaction().add(
  SystemProgram.createAccount({
    fromPubkey: treasury.publicKey, newAccountPubkey: mintPair.publicKey,
    lamports: rent, space: mintLen, programId: TOKEN_2022_PROGRAM_ID,
  }),
  createInitializeMintInstruction(mintPair.publicKey, DECIMALS, treasury.publicKey, null, TOKEN_2022_PROGRAM_ID),
  createAssociatedTokenAccountIdempotentInstruction(
    treasury.publicKey, treasuryAta, treasury.publicKey, mintPair.publicKey, TOKEN_2022_PROGRAM_ID),
  createMintToInstruction(mintPair.publicKey, treasuryAta, treasury.publicKey,
    BigInt(10_000) * 10n ** BigInt(DECIMALS), [], TOKEN_2022_PROGRAM_ID),
), [treasury, mintPair]);
step("mint     ", mintPair.publicKey.toBase58());
step("supply   ", "10,000 to the treasury");

// --- 4. a player who has earned -------------------------------------------
console.log("4. scratch database");
await pool!.query(`insert into realm (id, name) values ($1,$1) on conflict do nothing`, [REALM]);
const player = await pool!.query<{ id: string }>(
  `insert into player (display_name, wallet_address) values ('Rehearsal', $1) returning id`,
  [recipient.publicKey.toBase58()]);
const playerId = player.rows[0]!.id;
await pool!.query(
  `insert into contribution_epoch (realm_id, epoch_id, player_id, contribution, claimed_units, claimed_at)
   values ($1,$2,$3,1,$4,now())`, [REALM, epochIdFor(), playerId, 1_000]);
step("earned   ", `1,000 $MM (withdrawable ${await withdrawableOf(pool!, REALM, playerId)})`);

// --- 5. the request, through the real path --------------------------------
console.log("5. requestPayout()");
const receipt = await requestPayout(REALM, playerId, recipient.publicKey.toBase58(), AMOUNT, randomUUID());
step("queued   ", `${receipt.units} $MM, withdrawable now ${receipt.withdrawableAfter}`);

// --- 6. the worker, against real devnet RPC -------------------------------
console.log("6. runPayoutWorker() against devnet");
const deps = {
  mint: { address: mintPair.publicKey, programId: TOKEN_2022_PROGRAM_ID, decimals: DECIMALS },
  treasurySecret: bs58.encode(treasury.secretKey),
  submitRaw: async (raw: Buffer) => { await connection.sendRawTransaction(raw, { skipPreflight: false }); },
  status: (signature: string) => signatureStatus(connection, signature),
  blockhash: () => connection.getLatestBlockhash("confirmed"),
  blockHeight: () => connection.getBlockHeight("finalized"),
  // Must come from THIS connection too. Left to its default it reads the config-derived
  // cluster, where the rehearsal treasury holds nothing — the worker then correctly
  // refuses to sign against an empty treasury and the rehearsal stalls at 'queued'.
  lamports: () => connection.getBalance(treasury.publicKey, "confirmed"),
};
let state = "queued";
for (let pass = 1; pass <= 20 && state !== "confirmed" && state !== "failed"; pass += 1) {
  const report = await runPayoutWorker(deps);
  const row = await pool!.query<{ state: string; signature: string | null }>(
    `select state, signature from payout_request where player_id=$1`, [playerId]);
  state = row.rows[0]!.state;
  step(`pass ${pass}  `, `${state}${row.rows[0]!.signature ? ` (${row.rows[0]!.signature.slice(0, 16)}…)` : ""}`
    + ` [${report.submitted.length}s/${report.confirmed.length}c]`);
  if (state !== "confirmed" && state !== "failed") await new Promise((r) => setTimeout(r, 3_000));
}
if (state !== "confirmed") { console.error(`VERDICT: payout ended '${state}', not confirmed`); process.exit(1); }

// --- 7. the balance, read from the chain ----------------------------------
console.log("7. the recipient's on-chain balance");
const recipientAta = getAssociatedTokenAddressSync(mintPair.publicKey, recipient.publicKey, false, TOKEN_2022_PROGRAM_ID);
const balance = await connection.getTokenAccountBalance(recipientAta, "confirmed");
step("expected ", AMOUNT);
step("actual   ", balance.value.uiAmountString);
const exact = balance.value.amount === (BigInt(AMOUNT) * 10n ** BigInt(DECIMALS)).toString();
console.log(exact ? `VERDICT: ${AMOUNT} $MM landed exactly. The payout path works on devnet.`
                  : "VERDICT: BALANCE MISMATCH");
await pool!.end();
process.exit(exact ? 0 : 1);
