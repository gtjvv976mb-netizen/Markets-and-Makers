import { describe, expect, it } from "vitest";
import { creditFor } from "../src/deposit.js";

const DECIMALS = 6;
const raw = (tokens: number) => BigInt(Math.round(tokens * 10 ** DECIMALS));

describe("what a confirmed $MM transfer is worth", () => {
  it("pays the advertised rate on a whole amount", () => {
    expect(creditFor(raw(100), DECIMALS)).toEqual({ units: 100, mercs: 9_800 });
  });

  it("pays for the fraction of a token, instead of dropping it", () => {
    // The old code truncated to whole $MM before pricing, so 0.7 of a token vanished
    // into the treasury on every deposit that was not a round number.
    expect(creditFor(raw(100.7), DECIMALS)).toEqual({ units: 100, mercs: 9_868 });
  });

  it("credits a transfer a wallet split across several instructions", () => {
    // 1.2 $MM routed as two 0.6 legs. The old code divided PER LEG — 0 + 0 — and then
    // refused the whole deposit as "no $MM transfer found", with the tokens already sent.
    const split = raw(0.6) + raw(0.6);
    expect(creditFor(split, DECIMALS).mercs).toBe(117);
    expect(creditFor(split, DECIMALS).units).toBe(1);
  });

  it("never credits more than the tokens that arrived", () => {
    // The whole point of the rail: MERCS out must track $MM in, at 98 and no more.
    for (const tokens of [0.01, 1, 7.5, 999.999, 12_345.678]) {
      const { mercs } = creditFor(raw(tokens), DECIMALS);
      expect(mercs).toBeLessThanOrEqual(Math.floor(tokens * 98));
      expect(mercs).toBeGreaterThanOrEqual(Math.floor(tokens * 98) - 1);
    }
  });

  it("reports zero for dust, so the caller can say so honestly", () => {
    // Below ~0.0103 $MM there is not one whole MERC in it. The caller refuses with a
    // message naming what arrived, rather than "we could not find your transfer".
    expect(creditFor(raw(0.005), DECIMALS).mercs).toBe(0);
    expect(creditFor(0n, DECIMALS)).toEqual({ units: 0, mercs: 0 });
  });
});
