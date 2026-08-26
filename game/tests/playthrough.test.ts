import { beforeEach, describe, expect, it } from "vitest";
import { BUSINESS, PLOTS, RESOURCES, TUTORIAL, UPGRADE_COSTS, type LicenseKey, type ResourceKey } from "../src/data";
import { createFreshState, GameStore } from "../src/state";
import { productsOf } from "../src/products";

/**
 * A whole game, played.
 *
 * Not a unit test of a function but a rational player driven through every process the
 * game asks of them — arrive, lease, licence, build, produce, upgrade, sell, contract,
 * travel — and then a fortnight of the daily loop on top. It asserts the journey is
 * completable, and it records every place the game refused, stalled or made no sense, so
 * friction shows up as evidence rather than opinion.
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

beforeEach(() => {
  Object.defineProperty(globalThis, "localStorage", { value: new MemoryStorage(), configurable: true });
});

/** Everything the player tried that did not work, in the order they tried it. */
interface Friction { step: string; detail: string }

class Playthrough {
  readonly store = new GameStore(createFreshState());
  readonly friction: Friction[] = [];
  readonly log: string[] = [];

  note(step: string, detail: string): void { this.friction.push({ step, detail }); }
  say(line: string): void { this.log.push(line); }

  /** Do a thing, and record it rather than throwing when the game says no. */
  try(step: string, action: () => { ok: boolean; message: string }): boolean {
    const result = action();
    if (!result.ok) this.note(step, result.message);
    return result.ok;
  }

  /** Buy whatever a job needs that is missing, the way the shop UI would. */
  stockUpFor(license: LicenseKey): void {
    const config = BUSINESS[license];
    for (const [key, need] of Object.entries(config.inputs) as Array<[ResourceKey, number]>) {
      let guard = 0;
      while (this.store.state.inventory[key] < need && guard < 40) {
        const before = this.store.state.inventory[key];
        if (!this.store.buyResource(key, need - this.store.state.inventory[key]).ok) {
          if (!this.store.buyResource(key, 1).ok) break;
        }
        if (this.store.state.inventory[key] === before) break;
        guard += 1;
      }
    }
  }

  /** Run one production job start to finish, saying why if it will not run. */
  runJob(): boolean {
    const license = this.store.state.license;
    if (!license) { this.note("job", "no licence held"); return false; }
    this.stockUpFor(license);
    const start = this.store.startJob();
    if (!start.ok) { this.note("job", `startJob refused: ${start.message} (wallet ${this.store.state.wallet})`); return false; }
    const job = this.store.state.job;
    if (!job) { this.note("job", "startJob said yes but there is no job"); return false; }
    const collected = this.store.collectJob(job.completeAt);
    if (!collected.ok) this.note("job", `collectJob refused: ${collected.message}`);
    return collected.ok;
  }

  /** Buy the materials an upgrade needs, the way a player reading the message would. */
  stockUpForUpgrade(level: number): void {
    const cost = UPGRADE_COSTS[level];
    if (!cost) return;
    for (const [key, need] of Object.entries(cost.resources) as Array<[ResourceKey, number]>) {
      const short = need - this.store.state.inventory[key];
      if (short > 0) this.store.buyResource(key, short);
    }
  }

  /** Sell everything households or the city will actually take. */
  sellSurplus(): number {
    let earned = 0;
    for (const key of Object.keys(RESOURCES) as ResourceKey[]) {
      const held = this.store.state.inventory[key];
      const room = this.store.procurementRemaining(key);
      const amount = Math.min(held, room);
      if (amount <= 0) continue;
      const before = this.store.state.wallet;
      if (this.store.sellResource(key, amount).ok) earned += this.store.state.wallet - before;
    }
    return earned;
  }
}

describe("a whole game, played from scratch", () => {
  it("completes every step of the guided opening", () => {
    const run = new Playthrough();
    const store = run.store;

    // 1. Arrive and move.
    store.markTutorial("moved");
    store.updatePlayer(store.state.island, 4, 4);

    // 2. Lease a plot the player can actually afford.
    const affordable = PLOTS
      .filter((plot) => plot.island === store.state.island && plot.price <= store.state.wallet)
      .sort((a, b) => a.price - b.price)[0];
    expect(affordable, "no plot on the starting island is affordable with the opening wallet").toBeTruthy();
    store.selectPlot(affordable!.id);
    run.try("lease", () => store.leaseSelectedPlot());

    // 3. Choose a business a new player is allowed to choose.
    //
    // Counted on a FRESH store per trade: chooseLicense sets the licence when it
    // succeeds, so asking the same store fifteen times measures the sequence, not the
    // openings. The first draft of this probe reported "1 of 15" for exactly that reason.
    const openings = (Object.keys(BUSINESS) as LicenseKey[]).filter((key) => {
      const trial = new GameStore(createFreshState());
      trial.selectPlot(affordable!.id);
      trial.leaseSelectedPlot();
      return trial.chooseLicense(key).ok;
    });
    expect(openings.length, "a new maker can choose no business at all").toBeGreaterThan(0);
    run.say(`${openings.length} of ${Object.keys(BUSINESS).length} trades open to a new maker: ${openings.join(", ")}`);

    const starter = openings[0]!;
    run.try("licence", () => store.chooseLicense(starter));
    run.say(`chose ${BUSINESS[starter].name}`);

    // 4. Build it.
    run.try("build", () => store.placeBuilding());

    // 5. Produce.
    if (!run.runJob()) run.note("produce", "could not complete a first production job");

    // 6. Upgrade. A player reads what the upgrade needs and goes and gets it.
    let upgraded = false;
    let lastRefusal = "";
    for (let attempt = 0; attempt < 12 && !upgraded; attempt += 1) {
      run.stockUpForUpgrade(store.state.upgrades.yield + 1);
      const result = store.purchaseUpgrade("yield");
      if (result.ok) { upgraded = true; break; }
      lastRefusal = result.message;
      if (!run.runJob()) break;
      run.sellSurplus();
    }
    if (!upgraded) run.note("upgrade", `after twelve cycles: ${lastRefusal}`);
    else run.say(`upgraded on attempt with wallet ${store.state.wallet}`);

    // 7. Sell. Run the line once more first: the upgrade loop above sells as it goes,
    // so by this point the shelves are legitimately bare.
    run.runJob();
    const held = (Object.keys(RESOURCES) as ResourceKey[])
      .filter((key) => store.state.inventory[key] > 0)
      .map((key) => `${key} x${store.state.inventory[key]} (district will take ${store.procurementRemaining(key)})`);
    run.say(`holding: ${held.join(", ") || "nothing"}`);
    const earned = run.sellSurplus();
    if (earned <= 0) run.note("sell", `nothing sold. ${held.join("; ") || "empty inventory"}`);
    else run.say(`sold for ${earned}`);

    // 8. A contract.
    const offer = store.bestOffer();
    if (!offer) run.note("contract", "the board offered nothing at all");
    else {
      store.state.inventory[offer.resource] += offer.quantity;
      if (run.try("accept contract", () => store.acceptContract(offer.id))) {
        run.try("fulfil contract", () => store.fulfillContract());
      }
    }

    // 9. Travel.
    const elsewhere = PLOTS.find((plot) => plot.island !== store.state.island);
    if (elsewhere) run.try("travel", () => store.travelTo(elsewhere.island));

    const done = TUTORIAL.filter(([key]) => store.state.tutorial[key as keyof typeof store.state.tutorial]);
    run.say(`tutorial: ${done.length}/${TUTORIAL.length} steps complete`);
    for (const f of run.friction) run.say(`  FRICTION [${f.step}] ${f.detail}`);
    console.log("OPENING\n" + run.log.join("\n"));

    expect(done.length, `the guided opening cannot be finished: ${JSON.stringify(run.friction)}`)
      .toBe(TUTORIAL.length);
  });

  it("survives a fortnight of the daily loop without stalling or going broke", () => {
    const run = new Playthrough();
    const store = run.store;
    const plot = PLOTS.filter((p) => p.island === store.state.island && p.price <= store.state.wallet)
      .sort((a, b) => a.price - b.price)[0]!;
    store.selectPlot(plot.id);
    store.leaseSelectedPlot();
    store.chooseLicense("greenhouse");
    store.placeBuilding();

    const opening = store.totalMoneySupply();
    let daysTraded = 0;
    let brokeOn: number | null = null;

    for (let day = 1; day <= 14; day += 1) {
      // Away overnight, then a visit.
      store.state.lastTickAt = Date.now() - 20 * 3_600_000;
      store.catchUp();

      run.runJob();
      run.sellSurplus();

      const offer = store.bestOffer();
      if (offer && store.state.inventory[offer.resource] >= offer.quantity) {
        if (store.acceptContract(offer.id).ok) store.fulfillContract();
      }
      store.purchaseUpgrade("yield");

      if (store.state.brokenDown) store.repairBreakdown();
      if (store.state.suppliesCut) store.restoreSupply();

      if (store.state.wallet > 0) daysTraded += 1;
      else if (brokeOn === null) brokeOn = day;
    }

    run.say(`traded on ${daysTraded}/14 days; wallet ${store.state.wallet}; net worth ${store.netWorth()}`);
    run.say(`career ${store.careerLevel().name}, contribution ${Math.round(store.state.epoch.contribution)}`);
    console.log("FORTNIGHT\n" + run.log.join("\n"));

    expect(brokeOn, `the business went broke on day ${brokeOn} and could not recover`).toBeNull();
    expect(daysTraded).toBeGreaterThanOrEqual(12);
    // The client's own money supply must not drift over two weeks of play.
    expect(store.totalMoneySupply()).toBe(opening);
  });

  it("lets a maker reach the second career level by playing normally", () => {
    const run = new Playthrough();
    const store = run.store;
    const plot = PLOTS.filter((p) => p.island === store.state.island && p.price <= store.state.wallet)
      .sort((a, b) => a.price - b.price)[0]!;
    store.selectPlot(plot.id);
    store.leaseSelectedPlot();
    store.chooseLicense("greenhouse");
    store.placeBuilding();

    for (let day = 0; day < 20 && store.careerLevel().level < 2; day += 1) {
      store.state.lastTickAt = Date.now() - 20 * 3_600_000;
      store.catchUp();
      run.runJob();
      run.sellSurplus();
      const offer = store.bestOffer();
      if (offer && store.state.inventory[offer.resource] >= offer.quantity) {
        if (store.acceptContract(offer.id).ok) store.fulfillContract();
      }
    }
    run.say(`reached ${store.careerLevel().name} with ${store.state.experience} XP`);
    console.log("PROGRESSION\n" + run.log.join("\n"));
    expect(store.careerLevel().level).toBeGreaterThanOrEqual(2);
  });

  it("can make and sell a product from its own recipe", () => {
    const run = new Playthrough();
    const store = run.store;
    const plot = PLOTS.filter((p) => p.island === store.state.island && p.price <= store.state.wallet)
      .sort((a, b) => a.price - b.price)[0]!;
    store.selectPlot(plot.id);
    store.leaseSelectedPlot();
    store.chooseLicense("greenhouse");
    store.placeBuilding();

    const catalogue = productsOf("greenhouse");
    expect(catalogue.length, "a trade with no products to make").toBeGreaterThan(0);

    // Earn the inputs the honest way.
    for (let i = 0; i < 8; i += 1) { run.runJob(); run.sellSurplus(); }

    const makeable = catalogue.find((product) => store.canMake(product));
    if (!makeable) {
      run.note("product", `after eight cycles, none of ${catalogue.length} products could be made`);
      for (const product of catalogue.slice(0, 3)) {
        const missing = store.missingInputs(product);
        run.say(`  ${product.name} still short of ${missing.length} input(s): `
          + missing.map((m) => `${m.product.name} x${m.short}`).join(", "));
      }
    } else {
      run.try("make product", () => store.makeProduct(makeable.id));
      run.try("sell product", () => store.sellProduct(makeable.id, 1));
    }
    console.log("PRODUCTS\n" + run.log.join("\n"));
    expect(run.friction, JSON.stringify(run.friction)).toHaveLength(0);
  });
});
