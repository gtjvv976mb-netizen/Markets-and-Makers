import { afterAll, beforeEach, describe, expect, it } from "vitest";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { pool, closeDatabase } from "../src/database.js";
import { authenticate, bearerFrom, challengeMessage, createChallenge, isWalletAddress, revokeSession, verifyChallenge, AuthError } from "../src/auth.js";
import { live as liveDatabase } from "./live-database.js";

// See live-database.ts: these suites EMPTY their tables, so they refuse to run
// against a database that is not obviously disposable.
const live = liveDatabase;
const suite = live ? describe : describe.skip;

function wallet() {
  const pair = nacl.sign.keyPair();
  return {
    address: bs58.encode(pair.publicKey),
    sign: (message: string) => bs58.encode(nacl.sign.detached(Buffer.from(message), pair.secretKey)),
  };
}

describe("wallet address validation", () => {
  it("accepts a real ed25519 public key and rejects noise", () => {
    expect(isWalletAddress(bs58.encode(nacl.sign.keyPair().publicKey))).toBe(true);
    expect(isWalletAddress("not-an-address")).toBe(false);
    expect(isWalletAddress("")).toBe(false);
    // Right alphabet, wrong length — must not pass.
    expect(isWalletAddress(bs58.encode(Buffer.alloc(16, 7)))).toBe(false);
  });

  it("reads bearer tokens and ignores anything else", () => {
    expect(bearerFrom("Bearer abc123")).toBe("abc123");
    expect(bearerFrom("Basic abc123")).toBeUndefined();
    expect(bearerFrom(undefined)).toBeUndefined();
    expect(bearerFrom("Bearer ")).toBeUndefined();
  });
});

suite("wallet sign-in", () => {
  beforeEach(async () => {
    await pool!.query("delete from auth_session");
    await pool!.query("delete from auth_challenge");
    await pool!.query("delete from player where wallet_address is not null");
  });
  afterAll(async () => { await closeDatabase(); });

  it("signs a wallet in and binds it to a player", async () => {
    const w = wallet();
    const challenge = await createChallenge(w.address);
    expect(challenge.message).toContain(w.address);
    expect(challenge.message).toContain("authorises no transfer");

    const session = await verifyChallenge({ walletAddress: w.address, nonce: challenge.nonce, signature: w.sign(challenge.message) });
    expect(session.playerId).toMatch(/^[0-9a-f-]{36}$/);
    expect(session.walletAddress).toBe(w.address);

    const stored = await pool!.query(`select wallet_address from player where id = $1`, [session.playerId]);
    expect(stored.rows[0].wallet_address).toBe(w.address);
  });

  it("returns the same player when the same wallet signs in again", async () => {
    const w = wallet();
    const first = await createChallenge(w.address);
    const a = await verifyChallenge({ walletAddress: w.address, nonce: first.nonce, signature: w.sign(first.message) });
    const second = await createChallenge(w.address);
    const b = await verifyChallenge({ walletAddress: w.address, nonce: second.nonce, signature: w.sign(second.message) });
    expect(b.playerId).toBe(a.playerId);
    expect(b.token).not.toBe(a.token);
  });

  it("refuses to replay a nonce", async () => {
    const w = wallet();
    const challenge = await createChallenge(w.address);
    const signature = w.sign(challenge.message);
    await verifyChallenge({ walletAddress: w.address, nonce: challenge.nonce, signature });
    await expect(verifyChallenge({ walletAddress: w.address, nonce: challenge.nonce, signature }))
      .rejects.toThrow(AuthError);
  });

  it("refuses a signature from a different keypair", async () => {
    const victim = wallet();
    const attacker = wallet();
    const challenge = await createChallenge(victim.address);
    // The attacker signs the victim's exact message with their own key.
    await expect(verifyChallenge({ walletAddress: victim.address, nonce: challenge.nonce, signature: attacker.sign(challenge.message) }))
      .rejects.toThrow(AuthError);
  });

  it("refuses a signature over different text", async () => {
    const w = wallet();
    const challenge = await createChallenge(w.address);
    await expect(verifyChallenge({ walletAddress: w.address, nonce: challenge.nonce, signature: w.sign("Approve transfer of everything") }))
      .rejects.toThrow(AuthError);
  });

  it("refuses to let one wallet claim another's challenge", async () => {
    const issued = wallet();
    const other = wallet();
    const challenge = await createChallenge(issued.address);
    await expect(verifyChallenge({ walletAddress: other.address, nonce: challenge.nonce, signature: other.sign(challenge.message) }))
      .rejects.toThrow(AuthError);
  });

  it("refuses an expired challenge", async () => {
    const w = wallet();
    const challenge = await createChallenge(w.address);
    await pool!.query(`update auth_challenge set issued_at = now() - interval '10 minutes' where nonce = $1`, [challenge.nonce]);
    const stale = challengeMessage(w.address, challenge.nonce,
      (await pool!.query(`select issued_at from auth_challenge where nonce = $1`, [challenge.nonce])).rows[0].issued_at.toISOString());
    await expect(verifyChallenge({ walletAddress: w.address, nonce: challenge.nonce, signature: w.sign(stale) }))
      .rejects.toThrow(AuthError);
  });

  it("resolves, then stops resolving, a session token", async () => {
    const w = wallet();
    const challenge = await createChallenge(w.address);
    const session = await verifyChallenge({ walletAddress: w.address, nonce: challenge.nonce, signature: w.sign(challenge.message) });

    expect(await authenticate(session.token)).toEqual({ playerId: session.playerId, walletAddress: w.address });
    expect(await authenticate("clearly-not-a-token")).toBeNull();
    expect(await authenticate(undefined)).toBeNull();

    await revokeSession(session.token);
    expect(await authenticate(session.token)).toBeNull();
  });

  it("never stores the session token in plaintext", async () => {
    const w = wallet();
    const challenge = await createChallenge(w.address);
    const session = await verifyChallenge({ walletAddress: w.address, nonce: challenge.nonce, signature: w.sign(challenge.message) });
    const rows = await pool!.query<{ token_hash: string }>(`select token_hash from auth_session`);
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]!.token_hash).not.toBe(session.token);
    expect(rows.rows[0]!.token_hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
