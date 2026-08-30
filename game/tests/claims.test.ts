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
    // The gate must still say plainly where a city lives — the claim just changed, because
    // the authority now keeps one (server/src/save.ts). Both halves have to be there: what
    // signing in gets you, AND what playing without it does not.
    expect(gate, "and says plainly that signing in saves the city").toMatch(/signing in saves your city/i);
    expect(gate, "and that an unsigned city is browser-only").toMatch(/only in this browser/i);
  });

  it("promises a saved city only where one is actually kept", () => {
    // This read "never claims the city is saved to the realm", because localStorage was
    // the only persistence there was. The authority now keeps a copy per wallet, so the
    // claim is true — but ONLY for a signed-in player. A demo writes nothing at all (the
    // demo seal in state.ts commit), and an anonymous session never uploads, so any
    // unconditional promise on those paths would be a lie.
    const demo = html.slice(html.indexOf('id="bootGate"'), html.indexOf('id="rotateGate"'));
    expect(demo).toMatch(/Nothing is saved when you close the tab/i);
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

  it("still warns that an unsigned city can be lost", () => {
    // The authority keeps a signed-in player's city now, so the blanket "stored locally"
    // warning became false. The warning it replaces must not be softened away, though:
    // playing without signing in is still browser-only, and that has to be stated in the
    // same breath as the promise, not buried somewhere kinder.
    expect(gate).toMatch(/only in this browser/i);
    expect(gate).toMatch(/lose it/i);
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
