// The exchange's two reported defects, pinned so they cannot come back.
//
//   1. "players can spam create the orders" — listing was free and uncapped.
//   2. "any player can click and fulfill the orders instantly" — one click settled a
//      purchase outright, so a mis-click on a flooded book spent real Mercs with no undo.
//
// The authority enforces the cap; these tests guard the CLIENT half — that it states the
// rule before enforcing it, that a purchase takes two deliberate clicks, and above all
// that the numbers it shows still match the server's. A limit duplicated in two files is
// a limit that will drift.

import { describe, expect, it } from "vitest";
import main from "../src/main.ts?raw";
// ?raw, not ?inline: ?inline resolves to an empty string here, and an empty haystack
// makes every "the style exists" assertion pass for the wrong reason.
import styles from "../src/style.css?raw";


describe("spam is refused before the form is filled", () => {
  it("disables the List button at the cap and when the listing is dust", () => {
    const button = main.match(/data-action="errand-market-list"[^>]*/)?.[0] ?? "";
    expect(button, "the cap must gate the button").toContain("atListingCap");
    expect(button, "and so must the dust floor").toContain("tooSmall");
  });

  it("shows how many of the allowance are already open", () => {
    expect(main).toMatch(/maker-cap-note/);
    expect(main).toMatch(/of \$\{MAX_OPEN_LISTINGS\} listings open/);
  });
});

describe("a purchase cannot be made by one careless click", () => {
  // This used to be click-arming: the first click armed the row, the second spent. Buying
  // is now an errand — you order the listing and carry it to the Tidegate Transit Hall —
  // so the journey is the confirmation, and a considerably higher bar than a second click.
  // The protection did not go away; it moved into the world.

  it("orders rather than buying on the spot", () => {
    expect(main).toMatch(/data-action="errand-market-buy"/);
    expect(main, "no direct buy button remains on a listing").not.toMatch(/data-action="market-buy"/);
  });

  it("closes the market to a maker who already has a job in hand", () => {
    const button = main.match(/data-action="errand-market-buy"[^>]*/)?.[0] ?? "";
    expect(button).toMatch(/store\.errand\(\)/);
  });

  it("no longer carries the click-arming it replaced", () => {
    // Leaving both would mean two confirmations for one purchase, one of which the player
    // has already answered by walking across the district.
    expect(main).not.toMatch(/purchaseArmed/);
    expect(main).not.toMatch(/PURCHASE_ARM_MS/);
  });
});
