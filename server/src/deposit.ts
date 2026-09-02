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
import { PublicKey, Transaction } from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction, createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { config } from "./config.js";
import { MERCS_PER_MM_DEPOSIT } from "./catalogue.js";
import { pool } from "./database.js";
import { moveCurrency, MarketError } from "./market.js";
import { connection, parseTreasuryKey, resolveMint, toRawUnits, type MintFacts } from "./treasury.js";

export class DepositError extends Error {
  constructor(public code: string, message: string) { super(message); this.name = "DepositError"; }
}

export interface DepositReceipt {
  signature: string;
  units: number;
  alreadyCredited: boolean;
  totalDeposited: number;
  /** MERCS issued for this deposit on arrival. 0 means it is still held as $MM. */
  mercs: number;
}

/**
 * What a confirmed transfer is worth, from the RAW base units the chain reports.
 *
 * Pure and exported so the arithmetic can be tested without a chain or a database — the
 * bug it replaces (dividing per instruction, so a split transfer credited zero) lived
 * inside a function that needed both, which is why nothing caught it.
 */
export function creditFor(raw: bigint, decimals: number): { units: number; mercs: number } {
  const scale = 10n ** BigInt(decimals);
  return {
    units: Number(raw / scale),
    mercs: Number((raw * BigInt(MERCS_PER_MM_DEPOSIT)) / scale),
  };
}

/** Every whole $MM this player has brought in and not yet spent in game. */
export async function depositedUnits(realmId: string, playerId: string): Promise<number> {
  if (!pool) return 0;
  // Deposits converted on arrival are MERCS now, and counting them here as well would
  // hand the player the same tokens twice.
  const row = await pool.query<{ n: string }>(
    "select coalesce(sum(units),0)::text as n from mm_deposit where realm_id=$1 and player_id=$2 and mercs = 0",
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
 * Build the transfer the PLAYER will sign — unsigned, and never signable by us.
 *
 * The authority assembles it so the client needs no knowledge of mints, decimals or
 * associated token accounts, and so the destination cannot be tampered with in the browser:
 * it is derived here from the treasury's own public key. What comes back is bytes the
 * player's wallet shows them and they approve or reject. This process holds no key that
 * could sign it — feePayer and the transfer authority are both the player.
 *
 * The amount is still re-read from the chain when the signature comes back. This function
 * is a convenience, not a source of truth: a player who edits it, signs something else, or
 * sends by hand ends up in exactly the same verification.
 */
export async function prepareDeposit(
  walletAddress: string, units: number,
): Promise<{ transaction: string; units: number; treasury: string; lastValidBlockHeight: number }> {
  if (!config.tokenMint) throw new DepositError("chain-not-configured", "No token mint is configured.");
  const treasury = treasuryAddress();
  if (!treasury) throw new DepositError("chain-not-configured", "The treasury wallet is not configured.");
  if (!Number.isSafeInteger(units) || units <= 0) {
    throw new DepositError("bad-amount", "Choose a whole number of $MM to bring in.");
  }

  const conn = connection();
  if (!mintFacts) mintFacts = await resolveMint(conn, config.tokenMint);
  const mint = mintFacts;

  let payer: PublicKey;
  try { payer = new PublicKey(walletAddress); }
  catch { throw new DepositError("bad-address", "The session's wallet address does not parse."); }
  const treasuryKey = new PublicKey(treasury);

  const from = getAssociatedTokenAddressSync(mint.address, payer, false, mint.programId);
  const to = getAssociatedTokenAddressSync(mint.address, treasuryKey, false, mint.programId);

  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  const tx = new Transaction({ feePayer: payer, blockhash, lastValidBlockHeight });
  tx.add(
    // Idempotent, and paid for by the player: if the treasury has somehow never held this
    // mint, the account is created rather than the transfer failing in their wallet.
    createAssociatedTokenAccountIdempotentInstruction(payer, to, treasuryKey, mint.address, mint.programId),
    // transferChecked: the mint and decimals ride in the instruction and the program
    // verifies them on-chain, so a decimals mistake fails loudly instead of moving a
    // millionth or a million times the intended amount.
    createTransferCheckedInstruction(
      from, mint.address, to, payer, toRawUnits(units, mint.decimals), mint.decimals, [], mint.programId),
  );

  return {
    // Unsigned: requireAllSignatures false, because the only signature this needs is the
    // player's and it does not exist yet.
    transaction: tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"),
    units, treasury, lastValidBlockHeight,
  };
}

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
  const seen = await pool.query<{ units: string; player_id: string; mercs: string }>(
    "select units::text, player_id, mercs::text from mm_deposit where signature=$1", [signature]);
  if (seen.rowCount) {
    if (seen.rows[0]!.player_id !== playerId) {
      throw new DepositError("not-yours", "That transfer has already been credited to another maker.");
    }
    return {
      signature, units: Number(seen.rows[0]!.units), alreadyCredited: true,
      mercs: Number(seen.rows[0]!.mercs),
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
  // Raw base units, summed as BigInt and divided ONCE at the end.
  //
  // This used to divide per instruction — `credited += Number(BigInt(amount) / 10n ** decimals)`
  // — which threw away the fraction on every leg. A 1.2 $MM transfer that a wallet routed as
  // two 0.6 legs credited 0 + 0 and was then refused with "that transaction does not contain
  // a $MM transfer", while the tokens were already in the treasury. The refusal read as
  // "we never got it", which invites the player to send a second one.
  let raw = 0n;
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
    raw += BigInt(amount);
  }

  if (raw === 0n) {
    throw new DepositError("no-transfer",
      "That transaction does not contain a $MM transfer from your wallet to the city treasury.");
  }

  const scale = 10n ** BigInt(mint.decimals);
  // Whole $MM for the ledger row, but MERCS are issued from the RAW amount, so the
  // fraction of a token that used to vanish is paid for: 100.7 $MM is 9,868 MERCS, not
  // 9,800.
  const { units: credited, mercs: owed } = creditFor(raw, mint.decimals);

  if (owed <= 0) {
    // Real tokens arrived, so say that rather than "we could not find your transfer".
    throw new DepositError("below-minimum",
      `That transfer was ${(Number(raw) / Number(scale)).toFixed(6)} $MM, which is below the smallest amount the city can credit. It is in the treasury; contact support to have it returned.`);
  }

  // Record the deposit and issue the MERCS for it in ONE transaction, so the player never
  // ends up with tokens in the treasury and nothing in their purse.
  //
  // The signature carries the idempotency: `on conflict (signature) do nothing` means a
  // replayed confirm inserts no row, and the credit only runs when a row was genuinely
  // written. currency_ledger's unique (command_id, debit, credit) is the second guard.
  const client = await pool.connect();
  let issued = 0;
  try {
    await client.query("begin");
    const inserted = await client.query(
      `insert into mm_deposit (signature, realm_id, player_id, units, from_wallet)
       values ($1,$2,$3,$4,$5) on conflict (signature) do nothing`,
      [signature, realmId, playerId, credited, walletAddress]);

    if (inserted.rowCount) {
      try {
        await moveCurrency(client, realmId, `deposit:${signature}`, owed,
          { type: "government", id: "treasury" }, { type: "player", id: playerId }, "chain.deposit");
        await client.query("update mm_deposit set mercs = $1 where signature = $2", [owed, signature]);
        issued = owed;
      } catch (error) {
        // A treasury too thin to issue must not lose the deposit. The row stays, mercs
        // stays 0, and the units remain the player's $MM to convert when the bank can.
        if (!(error instanceof MarketError)) throw error;
      }
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }

  return {
    signature, units: credited, alreadyCredited: false, mercs: issued,
    totalDeposited: await depositedUnits(realmId, playerId),
  };
}
