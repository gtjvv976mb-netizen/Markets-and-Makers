// Whether a trade can actually make what it advertises.
//
// Ten of the fifteen list five products whose inputs are OTHER trades' products — a
// cratemill needs a rainwater draw and cut stone, neither of which a cratemill makes. And
// productStock only ever moved when you made, consumed or sold something yourself, so
// there was no way on earth to obtain one. Two thirds of the roster could list five
// products and start none of them: the supply chain was designed and never opened.

import { beforeEach, describe, expect, it } from "vitest";
import { BUSINESS, PLOTS, PRODUCT_DAILY_TRANCHE, TAX_RATE, type LicenseKey } from "../src/data";
import { BUSINESS_TIER, PRODUCTS, productChainDepth, productsOf, PRODUCTS_BY_ID } from "../src/products";
import { createFreshState, GameStore } from "../src/state";

class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length(): number { return this.data.size; }
  clear(): void { this.data.clear(); }
  getItem(key: string): string | null { return this.data.get(key) ?? null; }
  key(index: number): string | null { return [...this.data.keys()][index] ?? null; }
  removeItem(key: string): void { this.data.delete(key); }
  setItem(key: string, value: string): void { this.data.set(key, value); }
}

beforeEach(() => {
  Object.defineProperty(globalThis, "localStorage", { value: new MemoryStorage(), configurable: true });
});

const STARTER = PLOTS.filter((p) => p.island === "hearth").sort((a, b) => a.price - b.price)[0]!;
const licences = Object.keys(BUSINESS) as LicenseKey[];

function maker(licence: LicenseKey, purse = 500_000): GameStore {
  const store = new GameStore(createFreshState());
  store.selectPlot(STARTER.id);
  store.leaseSelectedPlot();
  // The five Enterprise trades are won at tender, not bought over the counter. That gate is
  // real and is not what these tests are about, so grant it and get on with the supply chain.
  if (BUSINESS_TIER[licence] === 3) store.state.license = licence;
  else expect(store.chooseLicense(licence).ok, `licensing ${licence}`).toBe(true);
  store.placeBuilding();
  store.state.wallet = purse;
  return store;
}

describe("every trade can make its first product", () => {
  it("leaves no trade unable to start anything", () => {
    // The headline defect, stated as a property over the whole roster.
    const stuck: string[] = [];
    for (const licence of licences) {
      const store = maker(licence);
      const first = productsOf(licence)[0];
      if (!first) continue;
      for (const [id, qty] of Object.entries(first.inputs ?? {})) store.buyProduct(id, qty);
      if (!store.canMake(first)) stuck.push(`${licence} (${first.name})`);
    }
    expect(stuck, `trades that can still start nothing: ${stuck.join(", ")}`).toHaveLength(0);
  });

  it("can walk every trade's whole ladder, buying what it cannot make", () => {
    for (const licence of licences) {
      const store = maker(licence);
      for (const product of productsOf(licence)) {
        for (const [id, qty] of Object.entries(product.inputs ?? {})) {
          const short = qty - store.stockOf(id);
          if (short > 0) store.buyProduct(id, short);
        }
        expect(store.canMake(product), `${licence}: ${product.name}`).toBe(true);
        expect(store.makeProduct(product.id).ok, `${licence}: making ${product.name}`).toBe(true);
      }
    }
  });
});

describe("the supplier is a fallback, never a shortcut", () => {
  it("always asks more than the product sells for", () => {
    // If buying were cheaper than selling, a player could loop the supplier for money.
    const store = maker("cratemill");
    for (const product of PRODUCTS_BY_ID.values()) {
      expect(store.productBuyPrice(product.id), `${product.name}`).toBeGreaterThan(product.price);
    }
  });

  it("cannot be looped for profit", () => {
    const store = maker("cratemill", 10_000);
    const product = productsOf("cratemill")[0]!;
    const before = store.state.wallet;
    store.buyProduct(product.id, 1);
    store.sellProduct(product.id, 1);
    expect(store.state.wallet, "buying then selling must lose money").toBeLessThan(before);
  });

  it("refuses when the purse cannot cover it", () => {
    const store = maker("cratemill", 1);
    const product = productsOf("cratemill")[0]!;
    const outcome = store.buyProduct(product.id, 1);
    expect(outcome.ok).toBe(false);
    expect(store.state.wallet, "a refusal costs nothing").toBe(1);
  });

  it("moves money to the city rather than destroying it", () => {
    const store = maker("cratemill", 10_000);
    const product = productsOf("cratemill")[0]!;
    const before = store.state.wallet + store.state.governmentTreasury;
    store.buyProduct(product.id, 2);
    expect(store.state.wallet + store.state.governmentTreasury, "supply unchanged").toBe(before);
  });
});

describe("a nonsense quantity cannot corrupt the books", () => {
  // Every comparison against NaN is false, so `wallet < cost` WAVES NaN THROUGH and the
  // subtraction turns the purse into NaN — an unrecoverable save. sellProduct guards its
  // stock the same way and had the same hole.
  const nonsense = [Number.NaN, Number.POSITIVE_INFINITY, -1, 0, "3" as unknown as number];

  it("never leaves the purse un-numeric", () => {
    for (const quantity of nonsense) {
      const store = maker("cratemill", 10_000);
      const product = productsOf("cratemill")[0]!;
      store.buyProduct(product.id, quantity);
      expect(Number.isFinite(store.state.wallet), `buy ${String(quantity)}`).toBe(true);
      expect(store.state.wallet, `buy ${String(quantity)}`).toBeLessThanOrEqual(10_000);
      expect(Number.isFinite(store.stockOf(product.id)), `stock after ${String(quantity)}`).toBe(true);
    }
  });

  it("never leaves stock un-numeric when selling", () => {
    for (const quantity of nonsense) {
      const store = maker("cratemill", 10_000);
      const product = productsOf("cratemill")[0]!;
      store.buyProduct(product.id, 2);
      store.sellProduct(product.id, quantity);
      expect(Number.isFinite(store.stockOf(product.id)), `sell ${String(quantity)}`).toBe(true);
      expect(store.stockOf(product.id), `sell ${String(quantity)}`).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(store.state.wallet), `wallet after selling ${String(quantity)}`).toBe(true);
    }
  });
});

describe("buying a product's missing components", () => {
  it("closes every gap in one press", () => {
    const store = maker("cratemill", 50_000);
    const product = productsOf("cratemill")[0]!;
    expect(store.canMake(product), "precondition: cannot make it yet").toBe(false);
    expect(store.buyMissingInputs(product.id).ok).toBe(true);
    expect(store.missingInputs(product), "no gap left").toHaveLength(0);
    expect(store.canMake(product)).toBe(true);
  });

  it("charges exactly what it quoted", () => {
    const store = maker("cratemill", 50_000);
    const product = productsOf("cratemill")[0]!;
    const quote = store.missingInputCost(product);
    expect(quote, "the quote must not be free").toBeGreaterThan(0);
    const before = store.state.wallet;
    store.buyMissingInputs(product.id);
    expect(before - store.state.wallet).toBe(quote);
  });

  it("takes nothing when the purse is short", () => {
    const store = maker("cratemill", 50_000);
    const product = productsOf("cratemill")[0]!;
    store.state.wallet = store.missingInputCost(product) - 1;
    const held = store.state.wallet;
    expect(store.buyMissingInputs(product.id).ok, "must refuse").toBe(false);
    expect(store.state.wallet, "a refusal is all-or-nothing").toBe(held);
    expect(store.canMake(product)).toBe(false);
  });

  it("refuses when there is nothing to buy", () => {
    const store = maker("aquaworks", 50_000);
    const raw = productsOf("aquaworks")[0]!;   // raw production, no inputs at all
    expect(store.buyMissingInputs(raw.id).ok).toBe(false);
    expect(store.state.wallet, "and costs nothing").toBe(50_000);
  });
});

describe("the shop is reachable from the interface", () => {
  it("renders the button inside the product card, not merely somewhere in the file", async () => {
    // The first version of this test grepped the whole of main.ts for three substrings. It
    // would have stayed green with the button in dead code, permanently disabled, or in a
    // function nothing calls. Anchor it to the renderer instead, and prove the slice is real
    // before trusting anything found in it — an inverted slice yields "" and matches nothing.
    const main = (await import("../src/main.ts?raw")).default as string;
    const from = main.indexOf("function productionMarkup(");
    const to = main.indexOf("function renderBusiness(");
    expect(from, "productionMarkup not found").toBeGreaterThan(-1);
    expect(to, "renderBusiness not found").toBeGreaterThan(from);
    const renderer = main.slice(from, to);
    expect(renderer.length, "the slice must not be empty").toBeGreaterThan(400);

    expect(renderer).toContain('data-action="buy-inputs"');
    expect(renderer, "the card must show what a press costs").toContain("missingInputCost(product)");
    // NOT toContain("product.labour") — the untouched Make button already contains that string,
    // so the assertion passed no matter what the buy gate did. Anchor to the gate itself.
    const gate = renderer.slice(renderer.indexOf('data-action="buy-inputs"') - 400,
                                renderer.indexOf('data-action="buy-inputs"'));
    expect(gate.length, "gate slice must be real").toBeGreaterThan(100);
    expect(gate, "the buy gate must price components PLUS labour").toContain("+ product.labour");
    expect(renderer, "a lone control must not sit in a two-column grid")
      .toContain('class="product-actions single"');

    const dispatcher = main.slice(main.indexOf('action === "make-product"'));
    expect(dispatcher.length, "dispatcher slice must be real").toBeGreaterThan(100);
    expect(dispatcher).toContain('action === "buy-inputs"');
    expect(dispatcher).toContain("store.buyMissingInputs(");
  });

  it("keeps the single-column rule in the stylesheet the markup asks for", async () => {
    const css = (await import("../src/style.css?raw")).default as string;
    expect(css.length, "the stylesheet must actually load").toBeGreaterThan(1000);
    expect(css).toContain(".product-actions.single");
  });
});

describe("a component needed more than once", () => {
  // Every earlier quote test used cratemill-slat-crate, whose inputs are both quantity 1, so
  // dropping the `* gap.short` multiplier left all of them green while the quote under-charged
  // and the all-or-nothing promise broke.
  const multi = PRODUCTS.find((p) => Object.values(p.inputs).some((q) => q > 1));

  it("exists to be tested", () => {
    expect(multi, "no product needs a component twice; this suite is not covering the case").toBeTruthy();
  });

  it("quotes and charges the full quantity", () => {
    const store = maker(multi!.business, 1_000_000);
    const quote = store.missingInputCost(multi!);
    const byHand = store.missingInputs(multi!)
      .reduce((total, gap) => total + store.productBuyPrice(gap.product.id) * gap.short, 0);
    expect(quote, "quote must count every unit of every gap").toBe(byHand);
    const before = store.state.wallet;
    expect(store.buyMissingInputs(multi!.id).ok).toBe(true);
    expect(before - store.state.wallet, "charged exactly the quote").toBe(quote);
    expect(store.missingInputs(multi!), "and closed every gap").toHaveLength(0);
  });

  it("is all-or-nothing when the purse falls one short", () => {
    const store = maker(multi!.business, 1_000_000);
    store.state.wallet = store.missingInputCost(multi!) - 1;
    const held = store.state.wallet;
    expect(store.buyMissingInputs(multi!.id).ok).toBe(false);
    expect(store.state.wallet, "no partial fill").toBe(held);
    expect(store.missingInputs(multi!).length, "nothing was delivered").toBeGreaterThan(0);
  });
});

describe("no money loop survives, at any depth", () => {
  // The markup ALONE could never do this. A flat multiple taxes the bottom rung of a chain
  // while the maker keeps every rung's margin above it, so a two-licence chain paid +212 a
  // sale and a three-licence chain +772, forever, at a markup already so high (1.6) that all
  // fifty products with inputs were a guaranteed loss on a single licence. The fix is that
  // the district stops paying for the ten-thousandth identical crate.

  it("refuses to pay for another unit once demand is saturated — for every product", () => {
    // Data-independent: it must hold for products nobody has written yet.
    const store = maker("aquaworks", 1_000_000);
    const profitable: string[] = [];
    for (const product of PRODUCTS) {
      const floorPrice = store.productSellPrice(product.id, 10_000);
      const net = floorPrice - Math.floor(floorPrice * TAX_RATE) - product.labour;
      if (net > 0) profitable.push(`${product.id} floor ${floorPrice} vs labour ${product.labour} = +${net}`);
    }
    expect(profitable, `still profitable at saturation: ${profitable.join(", ")}`).toHaveLength(0);
  });

  it("pays full price early, so an honest day's trade is unharmed", () => {
    const store = maker("aquaworks", 1_000_000);
    const product = productsOf("aquaworks")[0]!;
    expect(store.productSellPrice(product.id, 0), "the first unit is worth full price").toBe(product.price);
    expect(store.productSellPrice(product.id, PRODUCT_DAILY_TRANCHE - 1)).toBe(product.price);
    expect(store.productSellPrice(product.id, PRODUCT_DAILY_TRANCHE),
      "the next tranche must fetch less").toBeLessThan(product.price);
  });

  it("never lets the supplier be round-tripped", () => {
    const store = maker("cratemill", 1_000_000);
    for (const product of PRODUCTS) {
      expect(store.productBuyPrice(product.id), `${product.id}`)
        .toBeGreaterThan(store.productSellPrice(product.id, 0));
    }
  });

  it("makes running any single product into the ground a loss", () => {
    // 200 presses of one product, the crudest possible farm.
    for (const licence of licences) {
      const product = productsOf(licence)[0];
      if (!product) continue;
      const store = maker(licence, 5_000_000);
      const before = store.state.wallet;
      let sold = 0;
      for (let i = 0; i < 200; i += 1) {
        store.buyMissingInputs(product.id);
        if (!store.makeProduct(product.id).ok) break;
        if (!store.sellProduct(product.id, 1).ok) break;
        sold += 1;
      }
      const delta = store.state.wallet - before;
      expect(sold, `${licence} never sold anything; the test proves nothing`).toBeGreaterThan(0);
      expect(delta, `${licence} farmed ${sold} units for ${delta}`).toBeLessThanOrEqual(0);
    }
  });

  it("makes the multi-licence chain that beat the markup a loss too", () => {
    // The exact shape the review used to break the 1.6 markup: buy raw components under one
    // licence, climb a rung under another, sell the finished good.
    const store = new GameStore(createFreshState());
    store.state.wallet = 2_000_000;
    store.state.experience = 400;
    store.state.island = STARTER.island;
    const hearth = PLOTS.filter((p) => p.island === "hearth").sort((a, b) => a.price - b.price);
    const plots: string[] = [];
    for (const [index, licence] of (["factory", "construction"] as LicenseKey[]).entries()) {
      store.selectPlot(hearth[index]!.id);
      expect(store.leaseSelectedPlot().ok, `leasing plot ${index}`).toBe(true);
      if (!store.chooseLicense(licence).ok) {
        const round = store.franchiseRound(licence)!;
        expect(store.placeFranchiseBid(licence, round.minimum).ok, `bidding for ${licence}`).toBe(true);
        expect(store.chooseLicense(licence).ok, `licensing ${licence}`).toBe(true);
      }
      store.placeBuilding();
      plots.push(store.state.ownedPlotId!);
    }
    const before = store.state.wallet;
    let sold = 0;
    for (let round = 0; round < 50; round += 1) {
      store.switchBusiness(plots[0]!);
      for (let i = 0; i < 2; i += 1) { store.buyMissingInputs("factory-turbine-core"); store.makeProduct("factory-turbine-core"); }
      store.switchBusiness(plots[1]!);
      store.buyMissingInputs("construction-roof-canopy");
      if (!store.makeProduct("construction-roof-canopy").ok) break;
      if (!store.sellProduct("construction-roof-canopy", 1).ok) break;
      sold += 1;
    }
    const delta = store.state.wallet - before;
    expect(sold, "the chain never completed; the test proves nothing").toBeGreaterThan(0);
    expect(delta, `two-licence chain sold ${sold} canopies for ${delta}`).toBeLessThanOrEqual(0);
  });

  it("still cannot reach real $MM, and that gap is deliberate", () => {
    // An earlier version of this test asserted the opposite, because I had wired the product
    // chain into epoch contribution client-side. That was removed: see the long note in
    // sellProduct. The chain SHOULD pay $MM one day, but only through server-side settlement.
    // Recorded as a known gap rather than left silent, so nobody reads the absence as an
    // oversight and quietly re-adds the client-side credit.
    const store = maker("aquaworks", 1_000_000);
    const product = productsOf("aquaworks")[0]!;
    store.makeProduct(product.id);
    const before = store.state.epoch.contribution;
    expect(store.sellProduct(product.id, 1).ok).toBe(true);
    expect(store.state.epoch.contribution, "product sales must not credit contribution locally")
      .toBe(before);
  });
});

describe("no product action may mint epoch contribution", () => {
  // THE TEST I DID NOT WRITE, and the reason a critical exploit sat under a green suite.
  //
  // I added addContribution() to sellProduct on the strength of a comment I wrote and never
  // measured: "contribution is a share of a fixed budget, so a new source dilutes rather than
  // inflates". epochShare() is mine/(mine + COHORT_CONTRIBUTION_BASE) against a HARDCODED
  // 45,000, so it inflates. One week of the loop took 85% of the epoch $MM budget.
  //
  // Every test in this file measured PROFIT. The exploit ran on CONTRIBUTION, and was
  // anti-correlated with profit — the wash deliberately lost Merc Dollars to mint $MM — so no
  // profitability assertion could ever have failed. A green suite is evidence about the axis
  // you instrumented and nothing else. Contribution is now an axis this file watches.

  it("earns no contribution from making, buying or selling a product", () => {
    for (const licence of licences) {
      const store = maker(licence, 1_000_000);
      const before = store.state.epoch.contribution;
      for (const product of productsOf(licence)) {
        store.buyMissingInputs(product.id);
        store.makeProduct(product.id);
        store.sellProduct(product.id, 1);
      }
      expect(store.state.epoch.contribution,
        `${licence} minted contribution from the product chain`).toBe(before);
    }
  });

  it("cannot mint contribution by trading at a deliberate loss", () => {
    // The exact shape of the exploit: burn Merc Dollars through the supplier and see whether
    // anything convertible to real $MM comes back. Nothing may.
    const store = maker("construction", 1_000_000);
    const before = { wallet: store.state.wallet, contribution: store.state.epoch.contribution };
    for (let i = 0; i < 40; i += 1) {
      const product = productsOf("construction")[4] ?? productsOf("construction")[0]!;
      store.buyMissingInputs(product.id);
      store.makeProduct(product.id);
      store.sellProduct(product.id, 1);
    }
    expect(store.state.wallet, "precondition: this loop must actually lose money")
      .toBeLessThan(before.wallet);
    expect(store.state.epoch.contribution, "a loss-making wash minted contribution")
      .toBe(before.contribution);
    expect(store.projectedEpochMM(), "and it must project no $MM").toBe(0);
  });

  it("refuses to trade products without a business at all", () => {
    // No plot, no licence, no building — the two clicks the wash needed.
    const store = new GameStore(createFreshState());
    store.state.wallet = 1_000_000;
    const product = PRODUCTS[0]!;
    expect(store.buyProduct(product.id, 1).ok, "buying needs a business").toBe(false);
    expect(store.sellProduct(product.id, 1).ok, "selling needs a business").toBe(false);
    expect(store.state.wallet, "and a refusal costs nothing").toBe(1_000_000);
    expect(store.state.epoch.contribution).toBe(0);
  });
});

describe("the supplier is a fallback, not a shortcut", () => {
  // A flat premium could not hold this. Measured with CIVIC_PRODUCT_MARKUP applied flat:
  // buying every component in and selling the finished goods paid 15,477 a day to a tier-3
  // trade against 363 to a tier-1 doing identical work — 42.6x for the same five presses,
  // because a flat multiple taxes the bottom rung only while the buyer keeps every rung's
  // margin above it. Compounding the premium by chain depth took that spread to 10.7x.

  it("charges more for a component the deeper it sits in the ladder", () => {
    const store = maker("cratemill", 1_000_000);
    const byDepth = new Map<number, number[]>();
    for (const product of PRODUCTS) {
      const ratio = store.productBuyPrice(product.id) / product.price;
      const depth = productChainDepth(product.id);
      byDepth.set(depth, [...(byDepth.get(depth) ?? []), ratio]);
    }
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const depths = [...byDepth.keys()].sort();
    expect(depths.length, "the ladder must actually have depth").toBeGreaterThan(1);
    for (let i = 1; i < depths.length; i += 1) {
      const shallow = mean(byDepth.get(depths[i - 1]!)!);
      const deep = mean(byDepth.get(depths[i]!)!);
      expect(deep, `depth ${depths[i]} (${deep.toFixed(2)}x) must cost more than depth ${depths[i - 1]} (${shallow.toFixed(2)}x)`)
        .toBeGreaterThan(shallow);
    }
  });

  it("never charges less than the district pays, at any depth", () => {
    const store = maker("cratemill", 1_000_000);
    for (const product of PRODUCTS) {
      expect(store.productBuyPrice(product.id), product.id)
        .toBeGreaterThan(store.productSellPrice(product.id, 0));
    }
  });

  it("still lets every trade start, which was the whole point", () => {
    // The compounding must not price a stuck maker out of the fix that unstuck them.
    const stuck: string[] = [];
    for (const licence of licences) {
      const store = maker(licence, 1_000_000);
      const first = productsOf(licence)[0];
      if (!first) continue;
      if (!store.buyMissingInputs(first.id).ok && store.missingInputs(first).length) {
        stuck.push(`${licence} cannot afford to start (${store.missingInputCost(first)})`);
        continue;
      }
      if (!store.canMake(first)) stuck.push(`${licence} still cannot make ${first.name}`);
    }
    expect(stuck, stuck.join(", ")).toHaveLength(0);
  });
});
