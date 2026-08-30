// The chain boundary: the only file that holds a signing key in memory.
//
// Everything above this file thinks in whole $MM and database rows. Everything below it
// is Solana: raw units, blockhashes, signatures. The rules at this boundary:
//
// - The treasury secret is read from the environment, parsed, and held as a Keypair. It
//   is never logged, never serialised, never included in an error, and never leaves this
//   process. There is no code path that writes it anywhere.
// - Amounts cross as BIGINT raw units. `1.5 $MM` does not exist here; a float never
//   touches a token amount. The conversion multiplies by 10^decimals in bigint space.
// - The token program is RESOLVED from the mint, not assumed. $MM on mainnet is
//   Token-2022 despite its pump-suffixed address — a transfer built against the classic
//   program would fail on-chain, and an ATA derived with the wrong program id points at
//   an address that simply is not the player's account. A devnet rehearsal mint may be
//   either. Reading the mint's owner once handles both and removes the trap.
// - `submit` and `confirm` are separate calls with separate failure semantics. A timeout
//   from submit does NOT mean the transaction did not land; the caller re-checks by
//   signature before ever building a second transaction.

import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction, getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import bs58 from "bs58";
import { config, heliusRpcUrl } from "./config.js";

/** Raw units for a whole-token amount, in bigint space end to end. */
export function toRawUnits(wholeTokens: number, decimals: number): bigint {
  // isSafeInteger, not isInteger: above 2^53 the NUMBER is already rounded before this
  // function sees it, and BigInt() would faithfully preserve the wrong value. Refusing is
  // the only honest option — silently paying a neighbouring amount is the failure mode.
  if (!Number.isSafeInteger(wholeTokens) || wholeTokens <= 0) {
    throw new Error(`payout amounts are whole tokens in the safe range; got ${wholeTokens}`);
  }
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 12) {
    throw new Error(`implausible decimals: ${decimals}`);
  }
  return BigInt(wholeTokens) * 10n ** BigInt(decimals);
}

/**
 * Parse a secret key from the environment: base58 (what Phantom exports) or a JSON byte
 * array (what solana-keygen writes). Deliberately returns only the Keypair — the raw
 * material is not kept, and nothing here stringifies it back.
 */
export function parseTreasuryKey(secret: string): Keypair {
  const trimmed = secret.trim();
  if (!trimmed) throw new Error("PAYOUT_TREASURY_SECRET is not set");
  // Every failure below is rewritten. JSON.parse and bs58.decode both quote the offending
  // input in their messages, and this input is a private key: one malformed paste would
  // have printed key bytes into the worker's error log every 30 seconds.
  try {
    if (trimmed.startsWith("[")) {
      return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(trimmed) as number[]));
    }
    return Keypair.fromSecretKey(bs58.decode(trimmed));
  } catch {
    throw new Error("PAYOUT_TREASURY_SECRET could not be parsed (expected base58 or a JSON byte array)");
  }
}

export interface MintFacts {
  address: PublicKey;
  programId: PublicKey;
  decimals: number;
}

/**
 * What the mint actually is, read from the chain: which token program owns it and how
 * many decimals it carries. Cached after the first read — a mint's program and decimals
 * are immutable.
 */
export async function resolveMint(connection: Connection, mint: string): Promise<MintFacts> {
  const address = new PublicKey(mint);
  const info = await connection.getParsedAccountInfo(address, "confirmed");
  const value = info.value;
  if (!value) throw new Error(`mint ${mint} does not exist on this cluster`);
  const owner = value.owner;
  if (!owner.equals(TOKEN_2022_PROGRAM_ID) && !owner.equals(TOKEN_PROGRAM_ID)) {
    throw new Error(`mint ${mint} is owned by ${owner.toBase58()}, which is not a token program`);
  }
  const parsed = value.data as { parsed?: { info?: { decimals?: number } } };
  const decimals = parsed.parsed?.info?.decimals;
  if (typeof decimals !== "number") throw new Error(`mint ${mint} did not report decimals`);
  return { address, programId: owner, decimals };
}

export interface PreparedTransfer {
  /** Base58 transaction signature — known BEFORE submission, which is what makes the
   *  submitted state recoverable: the worker can ask the chain about a transaction whose
   *  send appeared to fail. */
  signature: string;
  raw: Buffer;
  lastValidBlockHeight: number;
}

/**
 * Build and sign a transfer of `units` raw tokens to `recipient`, creating their
 * associated token account if it does not exist. Signing happens here; submission is the
 * caller's separate step.
 */
export function buildTransfer(input: {
  treasury: Keypair; mint: MintFacts; recipient: PublicKey;
  units: bigint; recentBlockhash: string; lastValidBlockHeight: number;
}): PreparedTransfer {
  const { treasury, mint, recipient, units } = input;
  const from = getAssociatedTokenAddressSync(mint.address, treasury.publicKey, false, mint.programId);
  const to = getAssociatedTokenAddressSync(mint.address, recipient, false, mint.programId);

  const tx = new Transaction({
    feePayer: treasury.publicKey,
    blockhash: input.recentBlockhash,
    lastValidBlockHeight: input.lastValidBlockHeight,
  });
  tx.add(
    // Idempotent: a no-op when the account exists, so every payout can carry it.
    createAssociatedTokenAccountIdempotentInstruction(
      treasury.publicKey, to, recipient, mint.address, mint.programId),
    // transferChecked: the mint and decimals ride in the instruction and the program
    // verifies them, so a wrong-decimals bug fails loudly on-chain instead of moving a
    // millionth of what was meant.
    createTransferCheckedInstruction(
      from, mint.address, to, treasury.publicKey, units, mint.decimals, [], mint.programId),
  );
  tx.sign(treasury);
  const signature = bs58.encode(tx.signature!);
  return { signature, raw: tx.serialize(), lastValidBlockHeight: input.lastValidBlockHeight };
}

export type ChainStatus = "confirmed" | "pending" | "not-found" | "failed";

/**
 * What the chain says about a signature. "not-found" is only meaningful once the
 * transaction's blockhash has expired — before that it may simply not have propagated.
 */
export async function signatureStatus(connection: Connection, signature: string): Promise<ChainStatus> {
  const statuses = await connection.getSignatureStatuses([signature], { searchTransactionHistory: true });
  const status = statuses.value[0];
  if (!status) return "not-found";
  const level = status.confirmationStatus;
  const settled = level === "confirmed" || level === "finalized";
  // Order matters: only a SETTLED error is a real failure. Reading status.err first would
  // fail a transaction whose only sighting was in a slot the cluster later abandoned,
  // releasing the hold while the signed transfer was still live and rebroadcasting.
  if (!settled) return "pending";
  return status.err ? "failed" : "confirmed";
}

/**
 * Strip credentials out of anything on its way to a log.
 *
 * The Helius URL carries `?api-key=…`, and web3.js quotes the endpoint in its network
 * errors — so an RPC failure would have printed the key on every worker tick.
 */
export function redact(text: string): string {
  return text.replace(/api-key=[^&\s"']+/gi, "api-key=REDACTED");
}

/** The treasury's SOL, in lamports. It pays every fee and funds each first-time ATA. */
export async function treasuryLamports(connection: Connection, owner: PublicKey): Promise<number> {
  return connection.getBalance(owner, "confirmed");
}

let cachedConnection: Connection | null = null;
/**
 * The treasury's own $MM, in WHOLE tokens, as the chain reports it.
 *
 * Read from the associated token account the payout worker actually spends from — the same
 * derivation buildTransfer uses — so this is the balance that will really be there when a
 * transfer is signed, not an approximation of it. Returns 0 when the account does not exist
 * yet, which is the honest answer: an unfunded treasury holds nothing.
 */
export async function treasuryTokenUnits(
  connection: Connection, mint: MintFacts, owner: PublicKey,
): Promise<number> {
  const ata = getAssociatedTokenAddressSync(mint.address, owner, false, mint.programId);
  try {
    const balance = await connection.getTokenAccountBalance(ata, "confirmed");
    // uiAmount is a float and this is money; take the raw string and divide in integers.
    const raw = BigInt(balance.value.amount);
    return Number(raw / 10n ** BigInt(mint.decimals));
  } catch {
    // No account, or the RPC could not say. Both mean "do not assume there is money here".
    return 0;
  }
}

export function connection(): Connection {
  if (!cachedConnection) {
    // The Helius key routes through config like every other credential; with none set,
    // fall back to the public RPC, which is fine for devnet rehearsal.
    const url = config.heliusApiKey ? heliusRpcUrl()
      : config.solanaNetwork === "mainnet"
        ? "https://api.mainnet-beta.solana.com" : "https://api.devnet.solana.com";
    cachedConnection = new Connection(url, "confirmed");
  }
  return cachedConnection;
}
