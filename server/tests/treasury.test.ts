// The chain boundary, tested without a chain.
//
// Everything here is pure: amounts, key parsing, transaction building. The properties are
// the ones that lose money when wrong — float contamination in amounts, an ATA derived
// with the wrong token program, a signature that differs from what was signed.

import { describe, expect, it } from "vitest";
import { Keypair, PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import bs58 from "bs58";
import { buildTransfer, parseTreasuryKey, redact, signatureStatus, toRawUnits, type MintFacts } from "../src/treasury.js";

describe("amounts cross the boundary as bigints", () => {
  it("converts whole tokens exactly at 6 decimals", () => {
    expect(toRawUnits(1, 6)).toBe(1_000_000n);
    expect(toRawUnits(1_200, 6)).toBe(1_200_000_000n);
    expect(toRawUnits(25_000_000, 6)).toBe(25_000_000_000_000n);
  });

  it("REFUSES amounts above 2^53 rather than silently rounding them", () => {
    // Above 2^53 the number literal itself is already rounded before toRawUnits sees it
    // (9_007_199_254_740_993 arrives as ...992), so exactness is unachievable there. The
    // first version of this test demanded it and failed — correctly. What the boundary
    // CAN promise is refusal: no amount in the unsafe range is ever converted.
    expect(() => toRawUnits(9_007_199_254_740_993, 0)).toThrow(/safe range/);
    expect(toRawUnits(Number.MAX_SAFE_INTEGER, 0), "the last safe value still converts")
      .toBe(BigInt(Number.MAX_SAFE_INTEGER));
  });

  it("refuses fractions, zero, negatives and NaN", () => {
    for (const bad of [0.5, 1.000001, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => toRawUnits(bad, 6), `amount ${bad}`).toThrow();
    }
  });

  it("refuses implausible decimals", () => {
    expect(() => toRawUnits(1, -1)).toThrow();
    expect(() => toRawUnits(1, 13)).toThrow();
  });
});

describe("the treasury key parses from either export format", () => {
  it("round-trips base58 (what Phantom exports)", () => {
    const pair = Keypair.generate();
    const parsed = parseTreasuryKey(bs58.encode(pair.secretKey));
    expect(parsed.publicKey.toBase58()).toBe(pair.publicKey.toBase58());
  });

  it("round-trips a JSON byte array (what solana-keygen writes)", () => {
    const pair = Keypair.generate();
    const parsed = parseTreasuryKey(JSON.stringify(Array.from(pair.secretKey)));
    expect(parsed.publicKey.toBase58()).toBe(pair.publicKey.toBase58());
  });

  it("refuses an empty or whitespace secret", () => {
    expect(() => parseTreasuryKey("")).toThrow();
    expect(() => parseTreasuryKey("   ")).toThrow();
  });
});

describe("buildTransfer", () => {
  const treasury = Keypair.generate();
  const recipient = Keypair.generate().publicKey;
  const mint = (programId: PublicKey): MintFacts => ({
    address: Keypair.generate().publicKey, programId, decimals: 6,
  });
  const blockhash = { recentBlockhash: bs58.encode(Buffer.alloc(32, 7)), lastValidBlockHeight: 1000 };

  it("reports the signature of the bytes it serialised", () => {
    const prepared = buildTransfer({ treasury, mint: mint(TOKEN_2022_PROGRAM_ID), recipient, units: 5n, ...blockhash });
    // The first 64 bytes of a serialised single-signer transaction ARE the signature
    // (after the compact-u16 count). If these ever disagree, the worker would ask the
    // chain about a transaction other than the one it sent.
    const raw = prepared.raw;
    expect(bs58.encode(raw.subarray(1, 65))).toBe(prepared.signature);
  });

  it("derives the destination with the MINT'S token program, not a fixed one", () => {
    // The trap this repo's own token sets: $MM is Token-2022 behind a pump-style address.
    // An ATA derived with the classic program id is a DIFFERENT address — a transfer
    // there would create an account the player's wallet never shows.
    const m = mint(TOKEN_2022_PROGRAM_ID);
    const right = getAssociatedTokenAddressSync(m.address, recipient, false, TOKEN_2022_PROGRAM_ID);
    const wrong = getAssociatedTokenAddressSync(m.address, recipient, false, TOKEN_PROGRAM_ID);
    expect(right.toBase58()).not.toBe(wrong.toBase58());

    const prepared = buildTransfer({ treasury, mint: m, recipient, units: 5n, ...blockhash });
    const keys = prepared.raw.toString("hex");
    expect(keys.includes(right.toBuffer().toString("hex")), "the Token-2022 ATA must be in the message").toBe(true);
    expect(keys.includes(wrong.toBuffer().toString("hex")), "the classic ATA must not").toBe(false);
  });

  it("carries the expiry it was given", () => {
    const prepared = buildTransfer({ treasury, mint: mint(TOKEN_2022_PROGRAM_ID), recipient, units: 5n,
      recentBlockhash: blockhash.recentBlockhash, lastValidBlockHeight: 424242 });
    expect(prepared.lastValidBlockHeight).toBe(424242);
  });
});

describe("signature status", () => {
  // A fake Connection: only getSignatureStatuses is ever called.
  const conn = (value: unknown) => ({ getSignatureStatuses: async () => ({ value: [value] }) }) as never;

  it("reports an unseen signature as not-found", async () => {
    expect(await signatureStatus(conn(null), "sig")).toBe("not-found");
  });

  it("does NOT fail a transaction whose only sighting was at 'processed'", async () => {
    // The fork case. A processed-level slot can be abandoned while the transaction stays
    // valid to its lastValidBlockHeight and keeps being rebroadcast. Reading status.err
    // first would release the hold and let a second transfer be signed for a payout that
    // may still land.
    expect(await signatureStatus(conn({ err: { InstructionError: [0, "X"] }, confirmationStatus: "processed" }), "sig"))
      .toBe("pending");
  });

  it("fails only once the error is settled", async () => {
    for (const level of ["confirmed", "finalized"]) {
      expect(await signatureStatus(conn({ err: { InstructionError: [0, "X"] }, confirmationStatus: level }), "sig"))
        .toBe("failed");
    }
  });

  it("confirms a clean transaction at confirmed or finalized", async () => {
    for (const level of ["confirmed", "finalized"]) {
      expect(await signatureStatus(conn({ err: null, confirmationStatus: level }), "sig")).toBe("confirmed");
    }
  });
});

describe("credentials never reach a log", () => {
  it("redacts the Helius api-key from an RPC error", () => {
    const leaked = 'failed to fetch https://mainnet.helius-rpc.com/?api-key=abc123-secret-key: 429';
    expect(redact(leaked)).not.toContain("abc123-secret-key");
    expect(redact(leaked)).toContain("api-key=REDACTED");
  });

  it("never echoes the treasury secret in a parse error", () => {
    // JSON.parse and bs58.decode both quote the offending input, and that input is a
    // private key: one malformed paste would print key bytes every worker tick.
    const secretish = "[12,34,56,NOTANUMBER";
    try { parseTreasuryKey(secretish); expect.unreachable("should have thrown"); }
    catch (error) {
      const message = (error as Error).message;
      expect(message).not.toContain("NOTANUMBER");
      expect(message).not.toContain("12,34,56");
      expect(message).toContain("could not be parsed");
    }
  });
});
