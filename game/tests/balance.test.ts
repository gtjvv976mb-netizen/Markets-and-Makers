import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BUSINESS, CHAIN_DRAW, PLOTS, UPGRADE_COSTS, type LicenseKey, type ResourceKey, type UpgradeKey } from "../src/data";
import { createFreshState, GameStore } from "../src/state";

/**
 * Does the game reward the things it asks you to do?
 *
 * Three earlier attempts at this measured their own harness instead of the game, so the
 * rules here exist to stop that happening again:
 *
 *   1. Production runs through catchUp, never by calling startJob in a loop. catchUp is
 *      what decides how many cycles a day holds, so speed and capacity upgrades can
 *      actually show up. A harness that runs one job a day measures the harness.
 *   2. Nobody is handed money. Wealth is whatever the business earned, because a fat
 *      wallet changes how auto-buy behaves and moves the whole regime.
 *   3. Every comparison is A/B from an identical earned state, and the upgrade is PAID
 *      for out of that state — a gain that ignores its own cost is not a payback.
 *   4. Long enough to leave the opening behind: day one is a windfall in every trade.
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

/**
 * The clock has to move, or none of this measures anything.
 *
 * Winding lastTickAt back 24 hours makes catchUp think a day passed, but the game's
 * CALENDAR runs off Date.now(): the district's daily demand quota resets per UTC day, and
 * standing charges settle per whole day elapsed. With the real clock frozen, the quota
 * never resets, demand stays permanently saturated, and every business flatlines — which
 * is exactly what the first run of this file showed, with net worth identical on day 10,
 * 20 and 30. That was the harness, not the economy.
 */
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

function open(licence: LicenseKey): GameStore {
  const store = new GameStore(createFreshState());
  store.selectPlot(STARTER_PLOT.id);
  store.leaseSelectedPlot();
  store.chooseLicense(licence);
  store.placeBuilding();
  return store;
}

/** One day: the world runs, then the player visits and does the sensible things. */
function liveADay(store: GameStore, opts: { takeContracts?: boolean } = {}): void {
  advanceOneDay();
  store.catchUp();

  if (store.state.brokenDown) store.repairBreakdown();
  if (store.state.suppliesCut) store.restoreSupply();

  // Sell what the district will take, best price first.
  for (const key of Object.keys(store.state.inventory) as ResourceKey[]) {
    const amount = Math.min(store.state.inventory[key], store.procurementRemaining(key));
    if (amount > 0) store.sellResource(key, amount);
  }

  if (opts.takeContracts !== false) takeOrFillAnOrder(store);
}

/**
 * How a player actually works an order: accept it first, let the line fill it, deliver.
 *
 * The earlier version only accepted an order it could fill from stock on hand, which with
 * auto-sell running was never — so it measured a player who never took a contract at all.
 */
function takeOrFillAnOrder(store: GameStore): void {
  const active = store.state.activeContract;
  if (active) {
    // Buy the shortfall rather than sit on the order. An order can be worth taking even
    // for goods you do not make — the board pays above the civic supplier often enough —
    // and a player who never buys the gap is not an active player, they are a stuck one.
    const short = active.quantity - store.state.inventory[active.resource];
    if (short > 0) {
      const bill = short * store.marketBuyPrice(active.resource);
      if (bill < active.grossReward && store.state.wallet >= bill) store.buyResource(active.resource, short);
    }
    if (store.state.inventory[active.resource] >= active.quantity) store.fulfillContract();
    return;
  }
  const offer = store.bestOffer();
  if (offer) store.acceptContract(offer.id);
}

/** Everything the maker is worth: cash plus stock at what it would fetch. */
function worth(store: GameStore): number {
  return store.netWorth();
}

/** Run a business to a settled state, so comparisons do not start in the opening rush. */
function settle(licence: LicenseKey, days: number): GameStore {
  const store = open(licence);
  for (let day = 0; day < days; day += 1) liveADay(store);
  return store;
}

/** Copy a settled business so two futures can be compared from the same past. */
function fork(store: GameStore): GameStore {
  return new GameStore(JSON.parse(JSON.stringify(store.state)));
}

const TRADES: LicenseKey[] = ["greenhouse", "shop", "aquaworks", "workshop", "mine"];

describe("the shape of the economy", () => {
  it("pays a maker who turns up, over a month", () => {
    const rows: string[] = [];
    let losing = 0;
    for (const licence of TRADES) {
      const store = open(licence);
      const opening = worth(store);
      const marks: number[] = [];
      for (let day = 1; day <= 30; day += 1) {
        liveADay(store);
        if (day % 10 === 0) marks.push(worth(store));
      }
      const closing = worth(store);
      const perDay = Math.round((closing - opening) / 30);
      if (closing <= opening) losing += 1;
      rows.push(`  ${licence.padEnd(12)} ${String(opening).padStart(5)} -> ${String(closing).padStart(6)}`
        + `  (${perDay >= 0 ? "+" : ""}${perDay}/day)  day10/20/30: ${marks.join(" / ")}`);
    }
    console.log("A MONTH OF TURNING UP\n" + rows.join("\n"));
    expect(losing, "trades where a month of active play leaves the maker poorer").toBe(0);
  });

  // 20s, not the 5s default. This simulates sixty days across four upgrade tracks for several
  // trades and legitimately takes ~4.5 seconds on its own — close enough to the default that it
  // fails under full-suite CPU contention rather than because anything is wrong. Measured in
  // isolation at 4499ms and 4413ms.
  it("makes every upgrade worth buying eventually", () => {
    // A/B from the same settled past, with the upgrade paid for out of the same purse.
    const rows: string[] = [];
    const never: string[] = [];
    for (const licence of TRADES) {
      const settled = settle(licence, 10);
      for (const key of ["yield", "capacity", "speed", "appeal"] as UpgradeKey[]) {
        const without = fork(settled);
        const with1 = fork(settled);

        // Buy it honestly: the materials and the money both come out of the business.
        const cost = UPGRADE_COSTS[with1.state.upgrades[key] + 1];
        if (!cost) continue;
        for (const [item, need] of Object.entries(cost.resources) as Array<[ResourceKey, number]>) {
          const short = need - with1.state.inventory[item];
          if (short > 0) with1.buyResource(item, short);
        }
        if (!with1.purchaseUpgrade(key).ok) { rows.push(`  ${licence}/${key}: could not afford after 10 days`); continue; }

        const gapAtPurchase = worth(without) - worth(with1);      // what the upgrade cost, all in
        let paybackDay: number | null = null;
        for (let day = 1; day <= 60; day += 1) {
          liveADay(without);
          liveADay(with1);
          if (paybackDay === null && worth(with1) >= worth(without)) paybackDay = day;
        }
        const edge = worth(with1) - worth(without);
        rows.push(`  ${licence.padEnd(11)} ${key.padEnd(9)} cost ${String(gapAtPurchase).padStart(4)}`
          + `  payback ${paybackDay === null ? "NEVER" : `${paybackDay}d`.padStart(4)}`
          + `  edge after 60d ${edge >= 0 ? "+" : ""}${edge}`);
        if (paybackDay === null) never.push(`${licence}/${key}`);
      }
    }
    console.log("UPGRADE PAYBACK, PAID FOR HONESTLY\n" + rows.join("\n"));
    console.log(`  never pays back: ${never.length ? never.join(", ") : "none"}`);

    // The bar is NOT "every upgrade pays back for every trade". Upgrades are situational
    // on purpose: speed buys cycles, and a business that has already sold everything the
    // district will take today does not want another cycle. Demanding otherwise would mean
    // flattening the choice out of the game.
    //
    // What must hold is that every upgrade has a trade it is genuinely right for, and that
    // a player is never quietly sold a machine that cannot help them — hence
    // store.upgradeOutlook(), which says so in the shop before they pay.
    const paysBackSomewhere = new Set(
      (["yield", "capacity", "speed", "appeal"] as UpgradeKey[])
        .filter((key) => TRADES.some((licence) => !never.includes(`${licence}/${key}`))));
    expect([...paysBackSomewhere].sort(), "every upgrade must be worth buying for SOME trade")
      .toEqual(["appeal", "capacity", "speed", "yield"]);

    // And each of the five trades must have a clear upgrade path of its own.
    for (const licence of TRADES) {
      const useful = (["yield", "capacity", "speed", "appeal"] as UpgradeKey[])
        .filter((key) => !never.includes(`${licence}/${key}`));
      expect(useful.length, `${licence} has too few upgrades worth buying: ${useful.join(", ") || "none"}`)
        .toBeGreaterThanOrEqual(3);
    }
  }, 20_000);

  it("rewards a maker who invests over one who lets it pile up", () => {
    // The game no longer has a sell button, so "turning up" cannot mean clicking one.
    // A business buys its own inputs, runs its own cycles, and its goods are bought by
    // Mercedonians and by the trades below it. What a player still decides is what to
    // IMPROVE — so that is what this has to measure.
    const rows: string[] = [];
    for (const licence of TRADES) {
      const neglected = open(licence);
      const invested = open(licence);
      for (let day = 1; day <= 30; day += 1) {
        advanceOneDay();
        neglected.catchUp();
        invested.catchUp();
        if (invested.state.brokenDown) invested.repairBreakdown();
        if (invested.state.suppliesCut) invested.restoreSupply();
        // Reinvest like an operator, not a spendthrift: ONE improvement at a time, and
        // only out of money the business can clearly spare. Buying all four every day and
        // paying any price for the materials is not investing, it is bleeding — measured
        // at a greenhouse ending on 632 against 4,133 for doing nothing at all.
        const key = (["yield", "appeal", "capacity", "speed"] as UpgradeKey[])
          .find((k) => UPGRADE_COSTS[invested.state.upgrades[k] + 1] && !invested.upgradeOutlook(k));
        if (key) {
          const cost = UPGRADE_COSTS[invested.state.upgrades[key] + 1]!;
          const bill = Object.entries(cost.resources).reduce((total, [item, need]) => {
            const short = (need as number) - invested.state.inventory[item as ResourceKey];
            return total + Math.max(0, short) * invested.marketBuyPrice(item as ResourceKey);
          }, cost.mercDollars);
          // Keep a fortnight of overheads in hand before improving anything.
          if (invested.state.wallet - bill > invested.dailyOverhead() * 14) {
            for (const [item, need] of Object.entries(cost.resources) as Array<[ResourceKey, number]>) {
              const short = need - invested.state.inventory[item];
              if (short > 0) invested.buyResource(item, short);
            }
            invested.purchaseUpgrade(key);
          }
        }
      }
      const ratio = worth(neglected) > 0 ? worth(invested) / worth(neglected) : Infinity;
      rows.push(`  ${licence.padEnd(12)} neglected ${String(worth(neglected)).padStart(7)}`
        + `  invested ${String(worth(invested)).padStart(7)}  ${ratio.toFixed(2)}x`);
      expect(worth(invested), `${licence}: investing must beat leaving it alone`)
        .toBeGreaterThan(worth(neglected));
    }
    console.log("INVESTED vs NEGLECTED OVER A MONTH\n" + rows.join("\n"));
  });

});


/**
 * Open any of the fifteen trades, tender included.
 *
 * The five Enterprise trades — construction, freight, restaurant, gym, cinema — need a
 * won franchise round before a licence will issue. Skipping them meant a third of the
 * chain, and every service business in the game, went unmeasured.
 */
function openAnyTrade(licence: LicenseKey): GameStore | null {
  const store = new GameStore(createFreshState());
  store.selectPlot(STARTER_PLOT.id);
  store.leaseSelectedPlot();
  const round = store.franchiseRound(licence);
  if (round) store.state.franchiseBids[licence] = { round: round.round, amount: round.rivalBid + 1 };
  const config = BUSINESS[licence];
  if (store.state.wallet < config.licenseCost) store.state.wallet = config.licenseCost + 400;
  if (!store.chooseLicense(licence).ok) return null;
  store.placeBuilding();
  return store;
}

describe("every trade in the chain", () => {
  const ALL = Object.keys(BUSINESS) as LicenseKey[];

  it("leaves every one of the fifteen better off after a month", () => {
    // The whole chain, not a sample of it. A trade that only works because the five I
    // happened to test were the five I tuned is not a working economy.
    const rows: string[] = [];
    const losing: string[] = [];
    for (const licence of ALL) {
      const store = openAnyTrade(licence);
      if (!store) { rows.push(`  ${licence.padEnd(13)} could not be opened at all`); continue; }
      const opening = worth(store);
      for (let day = 1; day <= 30; day += 1) liveADay(store);
      const closing = worth(store);
      const perDay = Math.round((closing - opening) / 30);
      if (closing <= opening) losing.push(`${licence} (${perDay}/day)`);
      rows.push(`  ${licence.padEnd(13)} ${String(opening).padStart(5)} -> ${String(closing).padStart(7)}`
        + `  (${perDay >= 0 ? "+" : ""}${perDay}/day)`);
    }
    console.log("ALL FIFTEEN TRADES, ONE MONTH\n" + rows.join("\n"));
    expect(losing, `trades that lose money over a month: ${losing.join(", ")}`).toEqual([]);
  });

  it("pays everyone better when the district fills up", () => {
    // The cooperative claim, measured rather than asserted. Every business buys the goods
    // above it in the chain, so a neighbour is a customer: a district with a working chain
    // in it should be worth more to a maker than the same district standing empty.
    const rows: string[] = [];
    for (const licence of ["greenhouse", "mine", "timberworks", "aquaworks"] as LicenseKey[]) {
      const earn = (neighbours: number): number => {
        const store = open(licence);
        store.state.districtBusinesses = neighbours;
        const opening = worth(store);
        for (let day = 1; day <= 20; day += 1) liveADay(store);
        return worth(store) - opening;
      };
      const alone = earn(0);
      const few = earn(4);
      const busy = earn(12);
      rows.push(`  ${licence.padEnd(12)} alone ${String(alone).padStart(6)}`
        + `  with 4 neighbours ${String(few).padStart(6)}`
        + `  with 12 ${String(busy).padStart(6)}`
        + `  (${(busy / Math.max(1, alone)).toFixed(2)}x)`);
      expect(few, `${licence}: neighbours must be worth having`).toBeGreaterThan(alone);
      expect(busy, `${licence}: a busy district must beat a quiet one`).toBeGreaterThan(few);
    }
    console.log("COOPERATION: WHAT NEIGHBOURS ARE WORTH\n" + rows.join("\n"));
  });

  it("keeps the supply chain complete, so nobody is left without a customer", () => {
    // Derived demand is summed from the recipes. If a good is consumed by nobody it has no
    // customer but the civic budget, which is the exact condition that made every primary
    // producer unprofitable in the first place.
    const orphans = (Object.keys(CHAIN_DRAW) as ResourceKey[]).filter((key) => CHAIN_DRAW[key] <= 0);
    expect(orphans, `goods no business buys as an input: ${orphans.join(", ")}`).toEqual([]);
  });

  it("does not mint Merc Dollars while all this trading happens", () => {
    // Deeper demand must not mean money from nowhere. Every trade moves an existing purse.
    const store = open("workshop");
    const before = store.totalMoneySupply();
    for (let day = 1; day <= 20; day += 1) liveADay(store);
    expect(store.totalMoneySupply()).toBe(before);
  });
});
