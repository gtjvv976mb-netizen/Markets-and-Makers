import { describe, expect, it } from "vitest";
import {
  MM_TOKEN_DECIMALS, MM_TOKEN_MINT, MM_TOKEN_NETWORK, MM_TOKEN_PROGRAM, MM_TOTAL_SUPPLY,
} from "../src/data";

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const LEGACY_TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

describe("the live $MM token", () => {
  it("is a well-formed Solana address", () => {
    expect(MM_TOKEN_MINT).toMatch(BASE58);
    expect(MM_TOKEN_PROGRAM).toMatch(BASE58);
  });

  it("is the mint that was verified on mainnet", () => {
    // Pinned deliberately: a typo here would point the game at someone else's token.
    expect(MM_TOKEN_MINT).toBe("3mEpcPcmKmHbRUUEhZfutTUsQNaJv3ibao6cyZPDpump");
    expect(MM_TOKEN_NETWORK).toBe("mainnet");
  });

  it("belongs to Token-2022, not the legacy token program", () => {
    // Deriving an associated token account with the legacy program gives a different
    // address, so a transfer built that way would go nowhere.
    expect(MM_TOKEN_PROGRAM).toBe(TOKEN_2022);
    expect(MM_TOKEN_PROGRAM).not.toBe(LEGACY_TOKEN);
  });

  it("agrees with the supply the economy is designed around", () => {
    // Chain reports 1_000_000_000_000_000 raw at 6 decimals.
    const rawOnChain = 1_000_000_000_000_000;
    expect(MM_TOKEN_DECIMALS).toBe(6);
    expect(rawOnChain / 10 ** MM_TOKEN_DECIMALS).toBe(MM_TOTAL_SUPPLY);
  });
});
