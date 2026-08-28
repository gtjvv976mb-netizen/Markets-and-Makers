// What the game may and may not tell a player.
//
// $MM cannot leave Mercedonia today: the chain is read-only and payouts ship disabled.
// The launch audit found the first screen promising weekly earnings of that token, the
// Exchange showing dollar valuations computed from a hardcoded constant, and the bank
// described as returning deposited capital on demand. These tests pin the corrected copy,
// because marketing language is exactly the kind of thing that grows back.

import { describe, expect, it } from "vitest";
import html from "../index.html?raw";
import main from "../src/main.ts?raw";

/** Only the strings a player actually reads — not identifiers, comments, or CSS. */
const visible = `${html}\n${main}`;

describe("no promise of money out", () => {
  it("does not offer to earn $MM on the first screen", () => {
    const gate = html.slice(html.indexOf('id="bootGate"'), html.indexOf('id="rotateGate"'));
    expect(gate).not.toMatch(/Earn a share of the weekly/i);
    expect(gate, "and says plainly where progress lives").toMatch(/stored in this browser/i);
  });

  it("never claims the city is saved to the realm", () => {
    // localStorage is the only persistence: state.ts writes SAVE_KEY and nothing else.
    expect(visible).not.toMatch(/saved to the realm/i);
  });

  it("carries no redemption or deposit-return language", () => {
    for (const phrase of [
      /returns\s+<strong>capital<\/strong>/i,
      /whenever you want it back/i,
      /bank returns deposited capital/i,
      /guaranteed redemption/i,
    ]) {
      expect(visible, `forbidden phrase: ${phrase}`).not.toMatch(phrase);
    }
  });

  it("shows no dollar valuation of the game economy", () => {
    // Every USD figure derived from MM_REFERENCE_PRICE_USD, a constant. A number with a $
    // in front of it reads as a real valuation whatever surrounds it.
    expect(main).not.toMatch(/\$\$\{formatNumber\(Math\.round\(store\.economyValueUsd\(\)\)\)\}/);
    expect(main).not.toMatch(/Economy worth/i);
  });
});

describe("the disclosures a player must be able to find before signing in", () => {
  const gate = html.slice(html.indexOf('id="bootGate"'), html.indexOf('id="rotateGate"'));

  it("states that it is a game and the token does not leave", () => {
    expect(gate).toMatch(/cannot be withdrawn, sold, or exchanged/i);
  });

  it("states that it is not an investment", () => {
    expect(gate).toMatch(/not an investment/i);
    expect(gate).toMatch(/no promise of profit/i);
  });

  it("warns that progress is local and can be lost", () => {
    expect(gate).toMatch(/stored locally/i);
    expect(gate).toMatch(/lose your city/i);
  });

  it("carries an age statement", () => {
    expect(gate).toMatch(/18 or older/i);
  });

  it("tells the player nobody will ask for their seed phrase", () => {
    // The single most useful line on the screen for a wallet-gated game.
    expect(gate).toMatch(/seed phrase/i);
    expect(gate).toMatch(/never ask you for one/i);
  });

  it("says it is a prototype that may reset", () => {
    expect(gate).toMatch(/prototype/i);
    expect(gate).toMatch(/may be reset/i);
  });
});
