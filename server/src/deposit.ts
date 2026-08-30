/**
 * Bringing real $MM into the game.
 *
 * The player sends pump.fun $MM to the treasury wallet from their own wallet, and hands the
 * transaction signature to the authority. The authority reads the CHAIN — never the request
 * — and credits what actually arrived.
 *
 * Every rule here exists because the alternative is giving away game currency:
 *
 *  - the AMOUNT comes from the confirmed transfer, not the request body;
 *  - the DESTINATION must be the treasury's own associated token account, or a player could
 *    credit themselves for paying a friend;
 *  - the SOURCE must belong to the session's signed-in wallet, or one player could claim
 *    another's transfer — and on a public chain, anyone can read anyone's signature;
 *  - the MINT must be the realm's $MM, or any worthless token would buy Merc Dollars;
 *  - the transaction must be FINALIZED, because a confirmed-but-unrooted transfer can still
 *    be reorganised away;
 *  - and the signature is the primary key, so a replay credits once.
 */
import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { config } from "./config.js";
import { pool } from "./database.js";
import { connection, parseTreasuryKey, resolveMint, type MintFacts } from "./treasury.js";

export class DepositError extends Error {
  constructor(public code: string, message: string) { super(message); this.name = "DepositError"; }
}

export interface DepositReceipt {
  signature: string;
  units: number;
  alreadyCredited: boolean;
  totalDeposited: number;
}

/** Every whole $MM this player has brought in and not yet spent in game. */
export async function depositedUnits(realmId: string, playerId: string): Promise<number> {
  if (!pool) return 0;
  const row = await pool.query<{ n: string }>(
    "select coalesce(sum(units),0)::text as n from mm_deposit where realm_id=$1 and player_id=$2",
    [realmId, playerId]);
  return Number(row.rows[0]!.n);
}

/** The address a player sends $MM to. A public key; the secret never leaves the process. */
export function treasuryAddress(): string | null {
  if (!config.payoutTreasurySecret) return null;
  try { return parseTreasuryKey(config.payoutTreasurySecret).publicKey.toBase58(); }
  catch { return null; }
}

let mintFacts: MintFacts | null = null;

/**
 * Verify a transfer on-chain and credit it, once.
 *
 * `walletAddress` is the SESSION's wallet — the address the player proved with a signature
 * at sign-in — never anything they sent in the body.
 */
export async function creditDeposit(
  realmId: string, playerId: string, walletAddress: string, signature: string,
): Promise<DepositReceipt> {
  if (!pool) throw new DepositError("no-database", "The realm database is not configured.");
  if (!/^[1-9A-HJ-NP-Za-km-z]{64,96}$/.test(signature)) {
    throw new DepositError("bad-signature", "That does not look like a Solana transaction signature.");
  }

  // ALREADY CREDITED? Answered first, before the chain and before any configuration check.
  //
  // A player retrying a slow request must get the same receipt, and that has to hold even
  // when the RPC is unreachable or the treasury key has been rotated out — the credit is
  // already a fact in the ledger, and re-deriving it from the chain to hand it back would
  // make a settled deposit look unsettled the moment the chain was unavailable.
  const seen = await pool.query<{ units: string; player_id: string }>(
    "select units::text, player_id from mm_deposit where signature=$1", [signature]);
  if (seen.rowCount) {
    if (seen.rows[0]!.player_id !== playerId) {
      throw new DepositError("not-yours", "That transfer has already been credited to another maker.");
    }
    return {
      signature, units: Number(seen.rows[0]!.units), alreadyCredited: true,
      totalDeposited: await depositedUnits(realmId, playerId),
    };
  }

  // Only a NEW deposit needs the chain.
  if (!config.tokenMint) throw new DepositError("chain-not-configured", "No token mint is configured.");
  const treasury = treasuryAddress();
  if (!treasury) throw new DepositError("chain-not-configured", "The treasury wallet is not configured.");

  const conn = connection();
  if (!mintFacts) mintFacts = await resolveMint(conn, config.tokenMint);
  const mint = mintFacts;

  // FINALIZED. A "confirmed" transfer can still be reorganised away, and crediting one that
  // later vanishes is giving away Merc Dollars for tokens that never arrived.
  const tx = await conn.getParsedTransaction(signature, {
    commitment: "finalized", maxSupportedTransactionVersion: 0,
  });
  if (!tx) throw new DepositError("not-final", "That transaction is not finalized yet. Try again in a moment.");
  if (tx.meta?.err) throw new DepositError("tx-failed", "That transaction failed on-chain.");

  const treasuryAta = getAssociatedTokenAddressSync(
    mint.address, new PublicKey(treasury), false, mint.programId).toBase58();
  const senderAta = getAssociatedTokenAddressSync(
    mint.address, new PublicKey(walletAddress), false, mint.programId).toBase58();

  // Read the transfer out of the parsed instructions, including inner ones — a wallet may
  // route a transfer through a program rather than emitting it top level.
  const parsed = [
    ...tx.transaction.message.instructions,
    ...(tx.meta?.innerInstructions ?? []).flatMap((entry) => entry.instructions),
  ];
  let credited = 0;
  for (const instruction of parsed) {
    const info = (instruction as { parsed?: { type?: string; info?: Record<string, unknown> } }).parsed;
    if (!info?.info) continue;
    if (info.type !== "transfer" && info.type !== "transferChecked") continue;
    const detail = info.info;
    if (String(detail.destination ?? "") !== treasuryAta) continue;
    // The source must be THIS session's wallet, by its account or its owner. Anyone can
    // read anyone's signature off the chain; without this, a player could paste somebody
    // else's transfer and be paid for it.
    const source = String(detail.source ?? "");
    const authority = String(detail.authority ?? detail.multisigAuthority ?? "");
    if (source !== senderAta && authority !== walletAddress) continue;
    // transferChecked carries the mint; a bare transfer does not, so the destination ATA
    // being the treasury's for THIS mint is what pins it.
    const mintOnInstruction = detail.mint === undefined ? null : String(detail.mint);
    if (mintOnInstruction !== null && mintOnInstruction !== mint.address.toBase58()) continue;

    const amount = (detail.tokenAmount as { amount?: string } | undefined)?.amount
      ?? (detail.amount === undefined ? null : String(detail.amount));
    if (!amount) continue;
    // Raw units to whole tokens, in integers — this is money.
    credited += Number(BigInt(amount) / 10n ** BigInt(mint.decimals));
  }

  if (credited <= 0) {
    throw new DepositError("no-transfer",
      "That transaction does not contain a $MM transfer from your wallet to the city treasury.");
  }

  await pool.query(
    `insert into mm_deposit (signature, realm_id, player_id, units, from_wallet)
     values ($1,$2,$3,$4,$5) on conflict (signature) do nothing`,
    [signature, realmId, playerId, credited, walletAddress]);

  return {
    signature, units: credited, alreadyCredited: false,
    totalDeposited: await depositedUnits(realmId, playerId),
  };
}
