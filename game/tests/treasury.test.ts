import { describe, expect, it } from "vitest";
import main from "../src/main.ts?raw";
import dataSource from "../src/data.ts?raw";
import state from "../src/state.ts?raw";
import styles from "../src/style.css?inline";
import { GameStore } from "../src/state";
import { BANK_SPREAD, MERC_DOLLARS_PER_USD, MM_REFERENCE_PRICE_USD } from "../src/data";

describe("bringing $MM into the city", () => {
  it("does NOT convert a deposit, because the MERCS would be unspendable", () => {
    // This asserts the absence of something I shipped and had to take back out.
    //
    // exchangeMMForMercDollars credits store.state.wallet. A signed-in player with a
    // business spends from serverWallet — purse() is `serverWallet ?? state.wallet` —
    // and server/src/deposit.ts records mm_deposit without ever touching
    // currency_account. So converting inside the deposit press turned a real, irreversible
    // transfer into MERCS the authority did not recognise: invisible in the HUD, unspendable,
    // and recoverable only at roughly 11% of the deposit.
    //
    // Auto-converting is still the right shape. It needs the AUTHORITY to issue the MERCS in
    // the same transaction that records the deposit. Delete this test when it does — not before.
    const buy = main.slice(main.indexOf('action === "buy-mm"'));
    const body = buy.slice(0, buy.indexOf('else if (action ==='));
    expect(body).toContain("store.setDepositedMM(outcome.value.totalDeposited)");
    // Comments stripped: the explanation above names the very call it forbids.
    const code = body.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code).not.toContain("exchangeMMForMercDollars(");
  });

  it("leaves deposited $MM able to buy the things priced in $MM", () => {
    // Deeds, charters and sponsorships are paid straight out of mmHoldings, so a deposit
    // that converted itself pinned that balance at zero and a player who sent exactly the
    // price of a deed could no longer buy the deed they sent the money for.
    const stateSource = state;
    for (const sink of ["SPONSORSHIP_COST_MM", "CHARTER_COST_MM", "DEED_COST_MM"]) {
      expect(stateSource, `${sink} should still be paid from mmHoldings`).toContain(sink);
    }
    expect(stateSource).toContain("this.state.mmHoldings <");
    // and the deposit path must not be what empties it
    const buy = main.slice(main.indexOf('action === "buy-mm"'));
    const code = buy.slice(0, buy.indexOf('else if (action ===')).replace(/\/\/[^\n]*/g, "");
    expect(code).not.toContain("exchangeMMForMercDollars(");
  });

  it("offers what the player holds, not a fixed hundred", () => {
    expect(main).toContain("exchangeMMForMercDollars(convertibleMM())");
    expect(main).not.toContain("exchangeMMForMercDollars(100)");
    expect(main).not.toContain("Bring in 100 $MM");
  });

  it("never offers to convert more than the bank may issue", () => {
    // convertibleMM() is min(held, headroom / rate). Without the second term the button
    // offers a conversion the bank refuses, which is the old 100 problem in reverse.
    const fn = main.slice(main.indexOf("function convertibleMM"));
    expect(fn.slice(0, 400)).toContain("Math.min(held, Math.floor(store.issuanceHeadroom() / perUnit))");
  });

  it("keeps the city's books out of the way of the decision", () => {
    const desk = main.slice(main.indexOf('<section class="bank-desk">'));
    const block = desk.slice(0, desk.indexOf("</section>"));
    // the action comes before the ledger, and the ledger is collapsed
    expect(block.indexOf('data-action="bank-in"')).toBeLessThan(block.indexOf("treasury-books"));
    expect(block).toContain('<details class="treasury-books">');
    for (const macro of ["Money supply", "Issued this epoch", "City wage bill"]) {
      expect(block.indexOf(macro), `${macro} should sit inside the disclosure`)
        .toBeGreaterThan(block.indexOf("treasury-books"));
    }
    expect(styles).toContain(".treasury-books");
  });

  it("does not name an amount the button will not honour", () => {
    // The quick-bar chip said "Convert 100 $MM" while the action converted everything a
    // player held — measured at 40,000 $MM moved by a button promising 100.
    const treasury = dataSource.slice(dataSource.indexOf("treasury: ["), dataSource.indexOf("]", dataSource.indexOf("treasury: [")));
    expect(treasury).toContain('action: "bank-in"');
    expect(treasury).not.toMatch(/label: "Convert \d/);
  });

  it("states the real amount in the Bank drawer too", () => {
    // There are TWO treasury desks: the Exchange panel and the Bank drawer behind the
    // quick-bar chip. The drawer kept its own "Convert 100 $MM" / "Return 1,000 MERCS"
    // labels for actions that move everything, and it was the one still live after the
    // first fix. Both buttons must name what they will actually move.
    const drawer = main.slice(main.indexOf("function bankDeskMarkup"));
    const body = drawer.slice(0, drawer.indexOf("\nfunction "));
    expect(body).toContain("Convert ${formatNumber(offer)} $MM");
    expect(body).toContain("Return ${formatNumber(redeem)} ${CURRENCY_CODE}");
    expect(body).not.toContain("store.state.mmHoldings < 100");
    expect(body).not.toContain("purse() < 1_000");
  });

  it("ships no button that names a fixed amount of money", () => {
    // Checked against the whole rendered source, comments stripped, because the first
    // pass fixed two of the three places and the third stayed live.
    const withoutComments = main.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
    const offenders = withoutComments.match(/(Convert|Return|Bring in) [0-9,]+ ?(\$MM|\$\{CURRENCY_CODE\}|MERCS)/g);
    expect(offenders ?? []).toEqual([]);
  });

  it("quotes the rate it actually pays", () => {
    const store = new GameStore();
    const perUnit = store.mercDollarsForMM(1);
    // 1 $MM × $0.01 × 10,000 MERCS/$ × (1 − 2% spread) = 98
    expect(perUnit).toBe(Math.floor(MM_REFERENCE_PRICE_USD * MERC_DOLLARS_PER_USD * (1 - BANK_SPREAD)));
    expect(perUnit).toBe(98);
    expect(store.mercDollarsForMM(100)).toBe(9_800);
  });
});
