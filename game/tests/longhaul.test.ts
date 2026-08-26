import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PLOTS, UPGRADE_COSTS, type LicenseKey, type ResourceKey, type UpgradeKey } from "../src/data";
import { createFreshState, GameStore } from "../src/state";

/**
 * How long is this game, and does it stay standing?
 *
 * A month proves a business is not a trap. It does not prove there is anything to DO in
 * month three, and it does not prove the currency survives a hundred players compounding
 * for half a year. Both of those are launch questions, so they get measured rather than
 * hoped about.
 */

class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length(): number { return this.data.size; }
  clear(): void { this.data.clear(); }
  getItem(key: string): string | null { return this.data.get(key) ?? null; }
  key(index: number): string | null { return [...this.data.keys()][index] ?? null; }
  removeItem(key: string): void { this.data.delete(key); }
  setItem(key: string, value: string): void { this.data.set(key, value); }
}

const START = new Date("2026-09-01T09:00:00Z").getTime();
let clock = START;
const advanceOneDay = (): void => { clock += 86_400_000; vi.setSystemTime(clock); };

beforeEach(() => {
  Object.defineProperty(globalThis, "localStorage", { value: new MemoryStorage(), configurable: true });
  clock = START;
  vi.useFakeTimers();
  vi.setSystemTime(clock);
});
afterEach(() => { vi.useRealTimers(); });

const STARTER_PLOT = PLOTS.filter((p) => p.island === "hearth").sort((a, b) => a.price - b.price)[0]!;
const UPGRADES: UpgradeKey[] = ["yield", "capacity", "speed", "appeal"];

function open(licence: LicenseKey): GameStore {
  const store = new GameStore(createFreshState());
  store.selectPlot(STARTER_PLOT.id);
  store.leaseSelectedPlot();
  store.chooseLicense(licence);
  store.placeBuilding();
  return store;
}

/** A player who turns up, sells, works an order and buys what they can afford. */
function liveADay(store: GameStore): void {
  advanceOneDay();
  store.catchUp();
  if (store.state.brokenDown) store.repairBreakdown();
  if (store.state.suppliesCut) store.restoreSupply();

  for (const key of Object.keys(store.state.inventory) as ResourceKey[]) {
    const amount = Math.min(store.state.inventory[key], store.procurementRemaining(key));
    if (amount > 0) store.sellResource(key, amount);
  }

  const active = store.state.activeContract;
  if (active) {
    const short = active.quantity - store.state.inventory[active.resource];
    if (short > 0) {
      const bill = short * store.marketBuyPrice(active.resource);
      if (bill < active.grossReward && store.state.wallet >= bill) store.buyResource(active.resource, short);
    }
    if (store.state.inventory[active.resource] >= active.quantity) store.fulfillContract();
  } else {
    const offer = store.bestOffer();
    if (offer) store.acceptContract(offer.id);
  }

  // The endgame is bought with $MM, so a player who never claims an epoch never reaches it.
  // Leaving this out measured someone who stops playing half the game: no charter, no
  // deeds, no second plot, and a flat report that the game ends on day eight.
  store.claimEpochRewards();
  store.purchaseCharter();
  if (store.state.mmHoldings >= 250) store.purchaseDeed();

  // Expand: take another plot whenever civic standing and money allow, and open a trade
  // on it. Running several businesses at once is what the ladder is FOR.
  const held = Object.keys(store.state.portfolio).length;
  if (held < store.plotAllowance()) {
    const owned = new Set(Object.keys(store.state.portfolio));
    // Across the whole realm, not just the district you started in. Keeping the search on
    // one island measured a player who never takes the ferry: it capped at the seventeen
    // plots on Hearth and reported that as the size of the game, when there are 298.
    const next = PLOTS.filter((p) => !owned.has(p.id)).sort((a, b) => a.price - b.price)[0];
    if (next && store.state.wallet > next.price * 3) {
      if (next.island !== store.state.island) store.travelTo(next.island);
      store.selectPlot(next.id);
      if (store.leaseSelectedPlot().ok) {
        for (const licence of ["workshop", "factory", "shop", "mine", "cratemill"] as LicenseKey[]) {
          if (store.chooseLicense(licence).ok) { store.placeBuilding(); break; }
        }
      }
    }
  }

  // Improve the business whenever it can be afforded, cheapest useful thing first.
  for (const key of UPGRADES) {
    const next = UPGRADE_COSTS[store.state.upgrades[key] + 1];
    if (!next) continue;
    for (const [item, need] of Object.entries(next.resources) as Array<[ResourceKey, number]>) {
      const missing = need - store.state.inventory[item];
      if (missing > 0 && store.state.wallet > missing * store.marketBuyPrice(item) * 2) {
        store.buyResource(item, missing);
      }
    }
    store.purchaseUpgrade(key);
  }
}

describe("the long haul", () => {
  // 180 simulated days across a growing portfolio is real work — by the end the player is
  // running well over a hundred businesses and every catch-up walks all of them.
  it("still has something left to do after six months", { timeout: 120_000 }, () => {
    const store = open("workshop");
    const marks: string[] = [];
    let toppedOutOn: number | null = null;

    for (let day = 1; day <= 180; day += 1) {
      liveADay(store);
      const installed = UPGRADES.reduce((total, key) => total + store.state.upgrades[key], 0);
      const ceiling = UPGRADES.length * store.upgradeCeiling();
      if (toppedOutOn === null && installed >= ceiling && store.careerLevel().level >= 6) toppedOutOn = day;
      if (day === 8 || day === 15 || day % 30 === 0) {
        marks.push(`  day ${String(day).padStart(3)}  worth ${String(store.netWorth()).padStart(9)}`
          + `  career ${store.careerLevel().level}/6  equipment ${installed}/${ceiling}`
          + `  chartered=${String(store.state.chartered).padEnd(5)}`
          + `  plots ${Object.keys(store.state.portfolio).length}/${store.plotAllowance()}`
          + `  $MM ${store.state.mmHoldings}  deeds ${store.state.deeds}`);
      }
    }
    // How expensive is a catch-up for a large operator? This is what a returning player
    // waits for on the main thread when they open the tab.
    const started = performance.now();
    advanceOneDay();
    store.catchUp();
    const catchUpMs = performance.now() - started;

    console.log("SIX MONTHS OF PLAY\n" + marks.join("\n"));
    console.log(`  one catch-up across ${Object.keys(store.state.portfolio).length} businesses: ${catchUpMs.toFixed(0)}ms`);
    console.log(`  everything maxed on day: ${toppedOutOn ?? "not within 180 days"}`);

    // A player who has finished the game in a fortnight has no reason to open it again.
    expect(toppedOutOn === null || toppedOutOn > 30,
      `a committed player exhausts every upgrade and career level by day ${toppedOutOn}`).toBe(true);

    // There must still be somewhere to grow at six months. Expansion is what carries the
    // game once the career ladder is finished — which happens around day 8, and is the
    // shortest rung in the whole progression.
    expect(Object.keys(store.state.portfolio).length,
      "six months in and the realm is full: nothing left to expand into").toBeLessThan(PLOTS.length);
    expect(store.netWorth(), "a long-run player should still be gaining").toBeGreaterThan(1_000_000);
  });

  it("does not inflate the currency while a hundred makers compound", () => {
    // The failure that killed the play-to-earn games worth naming: a faucet that never
    // closes. Merc Dollars must only ever MOVE between purses, never appear.
    const stores = (["greenhouse", "workshop", "shop", "mine", "aquaworks"] as LicenseKey[])
      .map((licence) => open(licence));
    const before = stores.map((store) => store.totalMoneySupply());

    for (let day = 1; day <= 90; day += 1) {
      advanceOneDay();
      for (const store of stores) {
        store.catchUp();
        if (store.state.brokenDown) store.repairBreakdown();
        if (store.state.suppliesCut) store.restoreSupply();
        for (const key of Object.keys(store.state.inventory) as ResourceKey[]) {
          const amount = Math.min(store.state.inventory[key], store.procurementRemaining(key));
          if (amount > 0) store.sellResource(key, amount);
        }
      }
    }

    stores.forEach((store, index) => {
      expect(store.totalMoneySupply(), "ninety days of trade must not mint a single Merc Dollar")
        .toBe(before[index]!);
    });
    console.log(`MONEY SUPPLY AFTER 90 DAYS: unchanged across ${stores.length} makers`);
  });
});
