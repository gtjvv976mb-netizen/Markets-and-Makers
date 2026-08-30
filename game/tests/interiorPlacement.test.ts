/**
 * Can a new maker actually put a machine on their floor?
 *
 * They could not. A business opens with all four stations at level 0; interiorWorld hides a
 * level-0 station (`root.visible = level > 0`) and resolveSelection skips one, so the only
 * route to purchaseUpgrade — stand next to it and press E — was unreachable. The Build tray
 * said "Not installed · drag to place", placing wrote a tile for a machine that does not
 * exist, and nothing appeared. No error, no toast, no clue.
 *
 * These tests are written against the STORE, because that is where the rules live and where
 * they can be checked without a WebGL context.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { BUSINESS, FITTINGS, FLOOR_WALKWAY_COLUMN, PLOTS, UPGRADE_COSTS, type ResourceKey } from "../src/data";
import { GameStore } from "../src/state";

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
  Object.defineProperty(globalThis, "window", {
    value: { setTimeout: () => 0, clearTimeout: () => undefined, addEventListener: () => undefined },
    configurable: true,
  });
});

const PLOT = PLOTS.filter((p) => p.island === "hearth").sort((a, b) => a.price - b.price)[0]!;

/** A maker with a built greenhouse, money, and the materials the first upgrade wants. */
function openBusiness(): GameStore {
  const store = new GameStore();
  store.state.island = PLOT.island;
  store.state.wallet = 20_000;
  store.state.selectedPlotId = PLOT.id;
  store.leaseSelectedPlot();
  store.chooseLicense("greenhouse");
  store.placeBuilding();
  for (const [key, count] of Object.entries(UPGRADE_COSTS[1]!.resources)) {
    store.state.inventory[key as ResourceKey] += (count as number) * 4;
  }
  return store;
}

/** A buildable tile that is not the walkway and holds nothing. */
function freeTile(store: GameStore, wanted = 0): { column: number; row: number } {
  let seen = 0;
  for (let row = 0; row < 8; row += 1) {
    for (let column = 0; column < 8; column += 1) {
      if (column === FLOOR_WALKWAY_COLUMN) continue;
      if (store.equipmentAt(column, row) !== null) continue;
      if (store.fittingAt(column, row) !== null) continue;
      if (seen++ === wanted) return { column, row };
    }
  }
  throw new Error("no free tile");
}

describe("a new maker can install a machine by placing it", () => {
  it("opens with every machine uninstalled — the state that made the floor a dead end", () => {
    const store = openBusiness();
    const levels = Object.values(store.state.upgrades);
    console.log(`FRESH BUSINESS upgrade levels: ${JSON.stringify(store.state.upgrades)}`);
    expect(levels.every((level) => level === 0)).toBe(true);
  });

  it("BUYS the machine when it is placed, and the fitters make it appear", () => {
    const store = openBusiness();
    const tile = freeTile(store);
    const before = store.state.wallet;
    const result = store.installEquipmentAt("yield", tile.column, tile.row);
    const job = store.installation();
    console.log(`INSTALL ok=${result.ok} · wallet ${before} -> ${store.state.wallet}`
      + ` (cost ${UPGRADE_COSTS[1]!.mercDollars}) · fitters queued for ${job?.key} lvl ${job?.level}`
      + ` in ${job?.secondsLeft}s`);
    expect(result.ok).toBe(true);
    expect(store.state.wallet).toBe(before - UPGRADE_COSTS[1]!.mercDollars);
    expect(store.equipmentAt(tile.column, tile.row)).toBe("yield");
    // Machines do not appear the instant they are bought — a crew has to fit them. What
    // matters is that the purchase HAPPENED, which is what no path could reach before.
    expect(job?.key).toBe("yield");
    expect(job?.level).toBe(1);

    // And when the crew finishes, the level rises — which is what applyLevels reads to
    // make the station visible in the room.
    store.catchUp(Date.now() + (job!.secondsLeft + 5) * 1000);
    console.log(`AFTER FITTING level=${store.state.upgrades.yield} (this is what makes it visible)`);
    expect(store.state.upgrades.yield).toBe(1);
  });

  it("CHARGES NOTHING when the tile is refused", () => {
    // The room commits a placement wherever the ghost was released without asking whether
    // it is legal, so buying before checking would take payment for a machine with nowhere
    // to go. This is the ordering the whole change turns on.
    const store = openBusiness();
    const before = store.state.wallet;
    const result = store.installEquipmentAt("yield", FLOOR_WALKWAY_COLUMN, 2);
    console.log(`WALKWAY ok=${result.ok} wallet ${before} -> ${store.state.wallet} · "${result.message}"`);
    expect(result.ok).toBe(false);
    expect(store.state.wallet).toBe(before);
    expect(store.state.upgrades.yield).toBe(0);
  });

  it("charges nothing when another machine already stands there", () => {
    const store = openBusiness();
    const tile = freeTile(store);
    store.installEquipmentAt("yield", tile.column, tile.row);
    const before = store.state.wallet;
    const result = store.installEquipmentAt("speed", tile.column, tile.row);
    console.log(`OCCUPIED ok=${result.ok} wallet unchanged=${store.state.wallet === before} · "${result.message}"`);
    expect(result.ok).toBe(false);
    expect(store.state.wallet).toBe(before);
    expect(store.state.upgrades.speed).toBe(0);
  });

  it("charges nothing, and says the whole bill, when the maker cannot afford it", () => {
    const store = openBusiness();
    store.state.wallet = 1;
    const tile = freeTile(store);
    const result = store.installEquipmentAt("yield", tile.column, tile.row);
    console.log(`BROKE ok=${result.ok} · "${result.message}"`);
    expect(result.ok).toBe(false);
    expect(store.state.wallet).toBe(1);
    expect(result.message).toMatch(/more MERCS|need/i);
  });

  it("moves a machine that is still with the fitters, instead of selling it twice", () => {
    // Dragging a machine whose crew had not finished tried to BUY it again and was refused
    // with "the fitters are still installing your X" — a refusal about the wrong thing.
    const store = openBusiness();
    const first = freeTile(store);
    store.installEquipmentAt("yield", first.column, first.row);
    const after = store.state.wallet;
    const second = freeTile(store, 3);
    const moved = store.installEquipmentAt("yield", second.column, second.row);
    console.log(`MOVE WHILE FITTING ok=${moved.ok} · wallet unchanged=${store.state.wallet === after}`
      + ` · now at ${JSON.stringify(store.equipmentTile("yield"))}`);
    expect(moved.ok).toBe(true);
    expect(store.state.wallet).toBe(after);
    expect(store.equipmentAt(second.column, second.row)).toBe("yield");
  });

  it("moves an installed machine without charging again", () => {
    const store = openBusiness();
    const first = freeTile(store);
    store.installEquipmentAt("yield", first.column, first.row);
    store.catchUp(Date.now() + 3_600_000);
    expect(store.state.upgrades.yield).toBe(1);
    const after = store.state.wallet;
    const second = freeTile(store, 3);
    const moved = store.installEquipmentAt("yield", second.column, second.row);
    console.log(`MOVE ok=${moved.ok} level still ${store.state.upgrades.yield} · wallet unchanged=${store.state.wallet === after}`);
    expect(moved.ok).toBe(true);
    expect(store.state.upgrades.yield).toBe(1);
    expect(store.state.wallet).toBe(after);
    expect(store.equipmentAt(second.column, second.row)).toBe("yield");
  });
});

describe("a machine may not be parked on a fitting", () => {
  it("refuses the tile a fitting stands on", () => {
    // canPlaceEquipment held this rule and had ZERO callers, while placeEquipment — the one
    // players use — checked only the walkway and other machines. The authority's
    // sanitiseFloor seats stations first and bins any fitting whose tile is taken, so the
    // browser would have gone on crediting a fitting the server had dropped.
    const store = openBusiness();
    const tile = freeTile(store);
    const fitting = Object.keys(FITTINGS)[0]! as keyof typeof FITTINGS;
    const installed = store.installFitting(fitting, tile.column, tile.row);
    expect(installed.ok).toBe(true);

    const result = store.installEquipmentAt("yield", tile.column, tile.row);
    console.log(`ON A FITTING ok=${result.ok} · "${result.message}"`);
    expect(result.ok).toBe(false);
    expect(store.fittingAt(tile.column, tile.row)).toBe(fitting);
    expect(store.canPlaceEquipment("yield", tile.column, tile.row)).toBe(false);
  });
});

describe("the market's 'Needed now' shows what the game just told you to buy", () => {
  /**
   * The interior refuses an unaffordable machine with "This upgrade needs 1 Material Crate
   * and 1 Utility Part. Buy what you are short of on the Market tab." The Market tab opens
   * on "Needed now" — which listed the licence's production inputs and nothing else, so
   * neither a crate nor a part was in it. Both were on sale the whole time, one filter click
   * away under "All goods". A filter that hides what the game just named is worse than none.
   */
  it("lists the licence's production inputs", () => {
    const store = openBusiness();
    const list = store.shoppingList();
    console.log(`SHOPPING LIST (fresh greenhouse): ${JSON.stringify(list)}`);
    for (const input of Object.keys(BUSINESS.greenhouse.inputs)) {
      expect(list).toContain(input);
    }
  });

  it("ALSO lists what the next upgrade is short of", () => {
    const store = openBusiness();
    // openBusiness stocks the upgrade materials; an empty larder is the case that matters.
    for (const key of Object.keys(UPGRADE_COSTS[1]!.resources)) {
      store.state.inventory[key as ResourceKey] = 0;
    }
    const list = store.shoppingList();
    console.log(`WITH NOTHING IN THE LARDER: ${JSON.stringify(list)}`);
    for (const needed of Object.keys(UPGRADE_COSTS[1]!.resources)) {
      expect(list, `the market must offer ${needed}`).toContain(needed);
    }
  });

  it("stops listing an upgrade material once the maker holds enough", () => {
    const store = openBusiness();
    const stocked = store.shoppingList();
    const [material] = Object.keys(UPGRADE_COSTS[1]!.resources) as ResourceKey[];
    console.log(`ALREADY STOCKED: ${material} in list? ${stocked.includes(material!)}`);
    // openBusiness stocks 4x what the first level needs, so it must not be asked for.
    expect(stocked).not.toContain(material);
  });

  it("asks for repair parts while the line is down", () => {
    const store = openBusiness();
    store.state.inventory.part = 0;
    store.state.brokenDown = true;
    console.log(`BROKEN DOWN: ${JSON.stringify(store.shoppingList())}`);
    expect(store.shoppingList()).toContain("part");
  });

  it("names something a maker can actually buy from the civic supplier", () => {
    // The whole fix rests on these being purchasable. Only `waste` is excluded
    // (civicSupply: false); everything else the supplier sells.
    const store = openBusiness();
    for (const key of Object.keys(UPGRADE_COSTS[1]!.resources) as ResourceKey[]) {
      store.state.inventory[key] = 0;
    }
    store.state.wallet = 5_000;
    const bought = (Object.keys(UPGRADE_COSTS[1]!.resources) as ResourceKey[])
      .map((key) => ({ key, ok: store.buyResource(key, 1).ok }));
    console.log(`CIVIC SUPPLIER: ${JSON.stringify(bought)}`);
    expect(bought.every((entry) => entry.ok)).toBe(true);
  });
});

describe("the exchange says what to do, not just what is true", () => {
  /**
   * The Exchange opened on a central bank — money supply, room to issue, treasury depth,
   * contribution share — with the four rows a player can press sitting eighth, past ~2,500
   * characters of monetary policy. Every number was correct and none answered "what do I
   * do here". These check the answer is specific, priced, and achievable.
   */
  it("tells an unbuilt maker to get a business first, and nothing else", () => {
    const store = new GameStore();
    const advice = store.marketAdvice();
    console.log(`NO BUSINESS: ${JSON.stringify(advice.map(a => a.text))}`);
    expect(advice).toHaveLength(1);
    expect(advice[0]!.kind).toBe("idle");
    expect(advice[0]!.text).toMatch(/lease a plot/i);
  });

  it("names the CHEAPEST next machine's shopping, not the dearest", () => {
    // Built on the dearest upgrade this told a brand-new greenhouse to buy 3 Parts,
    // 2 Equipment and 2 Modules — 432 MERCS for a level it was nowhere near — while the
    // level-1 crate and part in front of it went unmentioned.
    const store = openBusiness();
    for (const key of Object.keys(UPGRADE_COSTS[1]!.resources)) store.state.inventory[key as ResourceKey] = 0;
    // One machine pushed far ahead, so "dearest" and "cheapest" genuinely disagree.
    store.state.upgrades.appeal = 3;
    const buys = store.marketAdvice().filter((a) => a.kind === "buy");
    console.log(`SHOPPING: ${JSON.stringify(buys.map(b => b.text))}`);
    const named = buys.map((b) => b.resource);
    for (const key of Object.keys(UPGRADE_COSTS[1]!.resources)) expect(named).toContain(key);
    // Nothing from the level-4 bill should appear while a level-1 is still open.
    expect(named).not.toContain("equipment");
  });

  it("puts a price and a quantity on every action", () => {
    const store = openBusiness();
    for (const key of Object.keys(UPGRADE_COSTS[1]!.resources)) store.state.inventory[key as ResourceKey] = 0;
    for (const entry of store.marketAdvice()) {
      if (entry.kind === "idle") continue;
      console.log(`ACTIONABLE: "${entry.text}"`);
      expect(entry.text, "every line names a number").toMatch(/\d/);
      expect(entry.detail.length).toBeGreaterThan(20);
    }
  });

  it("offers to sell finished goods that are sitting on the shelf", () => {
    const store = openBusiness();
    store.state.inventory.food = 40;
    const sell = store.marketAdvice().find((a) => a.kind === "sell");
    console.log(`SELL LINE: ${sell?.text}`);
    expect(sell).toBeTruthy();
    expect(sell!.resource).toBe("food");
    expect(sell!.quantity).toBe(40);
  });

  it("does not push an order the maker cannot begin to fill", () => {
    // "Take this 516 MERCS order" while the shelf holds 0 of 46 is a number, not an
    // instruction, and it pushed everything actionable off the card.
    const store = openBusiness();
    for (const key of Object.keys(store.state.inventory) as ResourceKey[]) store.state.inventory[key] = 0;
    const orders = store.marketAdvice().filter((a) => a.kind === "order");
    console.log(`EMPTY SHELVES, order lines: ${orders.length}`);
    expect(orders).toHaveLength(0);
  });

  it("says plainly when there is nothing to do", () => {
    const store = openBusiness();
    for (const key of Object.keys(store.state.inventory) as ResourceKey[]) store.state.inventory[key] = 0;
    // Every machine maxed, so no shopping is outstanding either.
    for (const key of Object.keys(store.state.upgrades) as Array<keyof typeof store.state.upgrades>) {
      store.state.upgrades[key] = store.upgradeCeiling();
    }
    const advice = store.marketAdvice();
    console.log(`NOTHING TO DO: ${JSON.stringify(advice.map(a => a.text))}`);
    expect(advice).toHaveLength(1);
    expect(advice[0]!.kind).toBe("idle");
  });
});

describe("bringing real $MM in, then converting it", () => {
  /**
   * "$MM is earned, never bought" was wired in as a one-way door: you could claim $MM from
   * the epoch and withdraw it to a wallet, and there was no way back. A player holding real
   * pump.fun $MM had nothing the bank would convert, and the button sat dead at 0.
   *
   * Deposits are the AUTHORITY's record — it reads them off the chain and keys them on the
   * transaction signature — so the store adopts its total rather than adding to a local one.
   */
  it("credits a deposit and makes it convertible", () => {
    const store = openBusiness();
    expect(store.state.mmHoldings).toBe(0);
    store.setDepositedMM(500);
    console.log(`AFTER DEPOSIT mmHoldings=${store.state.mmHoldings} fromChain=${store.state.mmFromChain}`);
    expect(store.state.mmHoldings).toBe(500);

    const before = store.state.wallet;
    const result = store.exchangeMMForMercDollars(100);
    console.log(`CONVERT ok=${result.ok} · 100 $MM -> ${store.state.wallet - before} MERCS · $MM left ${store.state.mmHoldings}`);
    expect(result.ok).toBe(true);
    expect(store.state.mmHoldings).toBe(400);
    expect(store.state.wallet).toBeGreaterThan(before);
  });

  it("does NOT compound when the same total is adopted twice", () => {
    // A replayed credit, a second browser, or a refresh must not turn one deposit into two.
    const store = openBusiness();
    store.setDepositedMM(500);
    store.setDepositedMM(500);
    store.setDepositedMM(500);
    console.log(`THREE ADOPTIONS of the same total: mmHoldings=${store.state.mmHoldings}`);
    expect(store.state.mmHoldings).toBe(500);
  });

  it("keeps what has already been converted converted", () => {
    // The authority's total is a LIFETIME figure. Adopting it again must not refund $MM the
    // player has already turned into Merc Dollars.
    const store = openBusiness();
    store.setDepositedMM(500);
    store.exchangeMMForMercDollars(300);
    expect(store.state.mmHoldings).toBe(200);
    store.setDepositedMM(500);
    console.log(`RE-ADOPTED after spending 300: mmHoldings=${store.state.mmHoldings} (must stay 200)`);
    expect(store.state.mmHoldings).toBe(200);
  });

  it("adds only the new part of a second deposit", () => {
    const store = openBusiness();
    store.setDepositedMM(500);
    store.exchangeMMForMercDollars(300);
    store.setDepositedMM(800);
    console.log(`SECOND DEPOSIT 500->800 after spending 300: mmHoldings=${store.state.mmHoldings} (expect 500)`);
    expect(store.state.mmHoldings).toBe(500);
  });
});
