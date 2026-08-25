import { describe, expect, it } from "vitest";
import { parseTokenBalance } from "../src/chain.js";

const account = (amount: string, decimals: number) => ({
  account: { data: { parsed: { info: { tokenAmount: { amount, decimals } } } } },
});

describe("reading an on-chain $MM balance", () => {
  it("sums every token account the wallet holds", () => {
    const balance = parseTokenBalance({ result: { value: [account("1500000", 6), account("2500000", 6)] } });
    expect(balance.rawAmount).toBe("4000000");
    expect(balance.decimals).toBe(6);
    expect(balance.uiAmount).toBe(4);
  });

  it("reports a genuinely empty wallet as zero", () => {
    expect(parseTokenBalance({ result: { value: [] } })).toEqual({ rawAmount: "0", decimals: 0, uiAmount: 0 });
  });

  // The failure this guards: JSON-RPC returns errors with HTTP 200, so an ignored
  // `error` member turns every outage into "you hold nothing" — which a player cannot
  // tell apart from an empty wallet, and which a token gate would act on.
  it("refuses to turn an RPC error into a zero balance", () => {
    expect(() => parseTokenBalance({ error: { code: -32602, message: "Invalid param: could not find mint" } }))
      .toThrow(/could not find mint/);
  });

  it("names the wrong-network case, the likeliest misconfiguration", () => {
    // Exactly what devnet answers when asked about the live mainnet mint.
    expect(() => parseTokenBalance({ jsonrpc: "2.0", id: 1, error: { code: -32602, message: "Invalid param: could not find mint" } }))
      .toThrow(/rpc--32602/);
  });

  it("rejects a malformed reply rather than guessing", () => {
    expect(() => parseTokenBalance({})).toThrow(/malformed/);
    expect(() => parseTokenBalance(null)).toThrow(/malformed/);
    expect(() => parseTokenBalance({ result: {} })).toThrow(/malformed/);
  });

  it("handles amounts beyond a safe integer without losing precision", () => {
    // The whole 1,000,000,000 supply at 6 decimals exceeds Number.MAX_SAFE_INTEGER.
    const whole = parseTokenBalance({ result: { value: [account("1000000000000000", 6)] } });
    expect(whole.rawAmount).toBe("1000000000000000");
    expect(whole.uiAmount).toBe(1_000_000_000);
  });
});
