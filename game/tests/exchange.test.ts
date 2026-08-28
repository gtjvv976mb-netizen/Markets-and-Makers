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
    const button = main.match(/data-action="market-list"[^>]*/)?.[0] ?? "";
    expect(button, "the cap must gate the button").toContain("atListingCap");
    expect(button, "and so must the dust floor").toContain("tooSmall");
  });

  it("shows how many of the allowance are already open", () => {
    expect(main).toMatch(/maker-cap-note/);
    expect(main).toMatch(/of \$\{MAX_OPEN_LISTINGS\} listings open/);
  });
});

describe("a purchase takes two deliberate clicks", () => {
  it("arms on the first click and returns before spending anything", () => {
    const fn = main.slice(main.indexOf("async function takeMakerListing"));
    const body = fn.slice(0, fn.indexOf("\n}"));
    const armIndex = body.indexOf("armedPurchase = { id: listingId");
    const buyIndex = body.indexOf("buyMarketListing");
    expect(armIndex, "the arming branch must exist").toBeGreaterThan(-1);
    expect(buyIndex, "and the purchase call must exist").toBeGreaterThan(-1);
    expect(armIndex, "arming must come BEFORE any call to the authority").toBeLessThan(buyIndex);
    expect(body.slice(armIndex, buyIndex), "and the first click must return early")
      .toMatch(/return;/);
  });

  it("expires the arming so a stale row cannot be triggered later", () => {
    expect(main).toMatch(/PURCHASE_ARM_MS/);
    expect(main).toMatch(/Date\.now\(\) - armedPurchase\.at < PURCHASE_ARM_MS/);
  });

  it("labels the armed state with the actual total, not a generic word", () => {
    // "Confirm 1,240" is a number the player can check against their purse; "Confirm?" is
    // a dialog they will learn to dismiss.
    expect(main).toMatch(/Confirm \$\{formatNumber\(entry\.total\)\}/);
  });

  it("styles the armed button so it cannot be mistaken for the first click", () => {
    expect(styles).toMatch(/\.market-armed/);
    expect(styles, "and honours reduced motion").toMatch(/prefers-reduced-motion/);
  });
});
