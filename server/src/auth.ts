import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { pool } from "./database.js";

export class AuthError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

function db(): NonNullable<typeof pool> {
  if (!pool) throw new AuthError("no-database", "Authentication requires a database.");
  return pool;
}

const CHALLENGE_TTL_MS = 5 * 60_000;
const SESSION_TTL_MS = 30 * 24 * 3_600_000;
const BASE58_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** Tokens are stored only as a hash, so a database leak cannot be replayed as a login. */
const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex");

export function isWalletAddress(value: string): boolean {
  if (!BASE58_ADDRESS.test(value)) return false;
  try { return bs58.decode(value).length === 32; } catch { return false; }
}

/**
 * The exact bytes the wallet is asked to sign. Readable on purpose: a player should be
 * able to see what they are approving, and it must state that it moves nothing.
 */
export function challengeMessage(walletAddress: string, nonce: string, issuedAt: string): string {
  return [
    "Markets & Makers",
    "Sign in to The Sunwoven Reach.",
    "",
    `Wallet: ${walletAddress}`,
    `Nonce: ${nonce}`,
    `Issued: ${issuedAt}`,
    "",
    "This signature proves you control this wallet.",
    "It authorises no transfer and costs no fee.",
  ].join("\n");
}

export async function createChallenge(walletAddress: string): Promise<{ nonce: string; message: string; expiresAt: string }> {
  if (!isWalletAddress(walletAddress)) throw new AuthError("invalid-wallet", "That is not a Solana address.");
  const nonce = randomBytes(24).toString("base64url");
  const issued = new Date();
  await db().query(
    `insert into auth_challenge (nonce, wallet_address, issued_at) values ($1,$2,$3)`,
    [nonce, walletAddress, issued]);
  return {
    nonce,
    message: challengeMessage(walletAddress, nonce, issued.toISOString()),
    expiresAt: new Date(issued.getTime() + CHALLENGE_TTL_MS).toISOString(),
  };
}

export interface Session { token: string; playerId: string; walletAddress: string; expiresAt: string }

/**
 * Verify the signature, burn the nonce, and bind a session to the wallet. The nonce is
 * consumed inside the same transaction that issues the session, so a captured signature
 * cannot be replayed into a second login.
 */
export async function verifyChallenge(input: {
  walletAddress: string; nonce: string; signature: string; displayName?: string;
}): Promise<Session> {
  if (!isWalletAddress(input.walletAddress)) throw new AuthError("invalid-wallet", "That is not a Solana address.");

  const client = await db().connect();
  try {
    await client.query("begin");
    const found = await client.query<{ wallet_address: string; issued_at: Date; consumed_at: Date | null }>(
      `select wallet_address, issued_at, consumed_at from auth_challenge where nonce = $1 for update`,
      [input.nonce]);
    const challenge = found.rows[0];
    if (!challenge) throw new AuthError("unknown-nonce", "That sign-in request is not recognised.");
    if (challenge.consumed_at) throw new AuthError("nonce-used", "That sign-in request was already used.");
    if (Date.now() - challenge.issued_at.getTime() > CHALLENGE_TTL_MS) throw new AuthError("nonce-expired", "That sign-in request has expired.");

    // The nonce is bound to the wallet it was issued for.
    const expected = Buffer.from(challenge.wallet_address);
    const supplied = Buffer.from(input.walletAddress);
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
      throw new AuthError("wallet-mismatch", "This sign-in request belongs to a different wallet.");
    }

    const message = Buffer.from(challengeMessage(challenge.wallet_address, input.nonce, challenge.issued_at.toISOString()));
    let signatureBytes: Uint8Array;
    try { signatureBytes = bs58.decode(input.signature); } catch { throw new AuthError("bad-signature", "Signature is not valid base58."); }
    if (signatureBytes.length !== 64) throw new AuthError("bad-signature", "Signature has the wrong length.");

    const publicKey = bs58.decode(challenge.wallet_address);
    if (!nacl.sign.detached.verify(message, signatureBytes, publicKey)) {
      throw new AuthError("bad-signature", "That signature does not match this wallet.");
    }

    await client.query(`update auth_challenge set consumed_at = now() where nonce = $1`, [input.nonce]);

    // One wallet is one player.
    const existing = await client.query<{ id: string }>(
      `select id from player where wallet_address = $1`, [challenge.wallet_address]);
    let playerId = existing.rows[0]?.id;
    if (!playerId) {
      const created = await client.query<{ id: string }>(
        `insert into player (wallet_address, display_name) values ($1,$2) returning id`,
        [challenge.wallet_address, input.displayName?.slice(0, 40) || "Maker"]);
      playerId = created.rows[0]!.id;
    }
    await client.query(`update player set last_seen_at = now() where id = $1`, [playerId]);

    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await client.query(
      `insert into auth_session (token_hash, player_id, wallet_address, expires_at) values ($1,$2,$3,$4)`,
      [hashToken(token), playerId, challenge.wallet_address, expiresAt]);

    await client.query("commit");
    return { token, playerId, walletAddress: challenge.wallet_address, expiresAt: expiresAt.toISOString() };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export interface Principal { playerId: string; walletAddress: string }

/** Resolve a bearer token to the player it belongs to. Returns null rather than throwing. */
export async function authenticate(token: string | undefined): Promise<Principal | null> {
  if (!token) return null;
  const row = await db().query<{ player_id: string; wallet_address: string }>(
    `select player_id, wallet_address from auth_session
      where token_hash = $1 and revoked_at is null and expires_at > now()`,
    [hashToken(token)]);
  const session = row.rows[0];
  return session ? { playerId: session.player_id, walletAddress: session.wallet_address } : null;
}

export function bearerFrom(header: string | string[] | undefined): string | undefined {
  const value = Array.isArray(header) ? header[0] : header;
  if (!value || !value.startsWith("Bearer ")) return undefined;
  return value.slice(7).trim() || undefined;
}

export async function revokeSession(token: string): Promise<void> {
  await db().query(`update auth_session set revoked_at = now() where token_hash = $1 and revoked_at is null`, [hashToken(token)]);
}
