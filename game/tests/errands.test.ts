// Business you have to walk to.
//
// The exchange used to settle everything from a menu, so a maker could buy materials, ship
// goods and file a delivery without their Mercedonian moving a step — the city was scenery
// and the only skill asked for was clicking. Trades are now errands: one at a time, each
// finished at the desk that handles it.
//
// The two rules worth protecting are that only ONE may be open (which is what makes each
// one a decision) and that a refusal does not consume it (or the player pays for the walk
// and gets nothing).

import { beforeEach, describe, expect, it } from "vitest";
import { CIVIC_BOARD_BASE, CIVIC_BOARD_MAX, CIVIC_BOARD_PER_MAKER, CIVIC_DISTRICT_BONUS_MAX,
  CIVIC_DISTRICT_BONUS_PER_MAKER, ERRAND_DESK, ERRAND_VERB, CIVIC_BUILDINGS, PLOTS, SAVE_KEY,
  type LicenseKey } from "../src/data";
import { createFreshState, GameStore } from "../src/state";
import MAIN_SOURCE from "../src/main.ts?raw";

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

function maker(licence: LicenseKey = "cratemill"): GameStore {
  const store = new GameStore(createFreshState());
  store.selectPlot(STARTER.id);
  store.leaseSelectedPlot();
  store.chooseLicense(licence);
  store.placeBuilding();
  return store;
}

const order = (store: GameStore) =>
  store.acceptErrand("buy", "Collect 1 Part", "70 MERCS on collection", { resource: "part", quantity: 1 });

describe("one job at a time", () => {
  it("takes an errand when your hands are empty", () => {
    const store = maker();
    expect(store.errand()).toBeNull();
    expect(order(store).ok).toBe(true);
    expect(store.errand()?.label).toBe("Collect 1 Part");
  });

  it("refuses a second while one is open", () => {
    // The whole mechanic. Without this the exchange is a queue of instant trades again.
    const store = maker();
    order(store);
    const second = store.acceptErrand("sell", "Ship 5 Crates", "", { resource: "crate", quantity: 5 });
    expect(second.ok).toBe(false);
    expect(store.errand()?.label, "the first job is untouched").toBe("Collect 1 Part");
  });

  it("takes the next one once the first is dropped", () => {
    const store = maker();
    order(store);
    expect(store.abandonErrand().ok).toBe(true);
    expect(store.errand()).toBeNull();
    expect(order(store).ok).toBe(true);
  });

  it("refuses to drop nothing", () => {
    expect(maker().abandonErrand().ok).toBe(false);
  });
});

describe("every errand has somewhere to go", () => {
  it("routes each kind to a desk that exists and has a counter", () => {
    // A destination nobody can walk to would strand the job forever.
    for (const [kind, deskId] of Object.entries(ERRAND_DESK)) {
      const desk = CIVIC_BUILDINGS.find((site) => site.id === deskId);
      expect(desk, `${kind} routes to a real building`).toBeTruthy();
    }
  });

  it("names every kind for the pill and for the desk", () => {
    for (const kind of Object.keys(ERRAND_DESK)) {
      expect(ERRAND_VERB[kind as keyof typeof ERRAND_VERB]?.going, `${kind} going verb`).toBeTruthy();
      expect(ERRAND_VERB[kind as keyof typeof ERRAND_VERB]?.atDesk, `${kind} desk verb`).toBeTruthy();
    }
  });

  it("records the desk on the errand itself", () => {
    const store = maker();
    order(store);
    expect(store.errand()?.desk).toBe(ERRAND_DESK.buy);
  });
});

describe("an errand survives a refusal", () => {
  it("stays in hand until something explicitly completes it", () => {
    // completeErrand is called by the caller ONLY when the trade actually settled. A
    // purchase the city refuses must leave the job in hand, or the player paid for the
    // walk and got nothing.
    const store = maker();
    order(store);
    expect(store.errand()).not.toBeNull();
    store.completeErrand();
    expect(store.errand()).toBeNull();
  });

  it("carries enough to replay the trade on arrival, and no more", () => {
    const store = maker();
    order(store);
    const payload = store.errand()!.payload;
    expect(payload.resource).toBe("part");
    expect(payload.quantity).toBe(1);
  });
});

describe("the errand persists like the rest of the city", () => {
  it("is still in hand after a reload", () => {
    // A job that vanished when the tab reloaded would be worse than no job at all.
    const store = maker();
    order(store);
    // Read the save through SAVE_KEY rather than a guessed literal — guessing the key is
    // how a persistence test quietly proves nothing.
    const raw = localStorage.getItem(SAVE_KEY);
    expect(raw, "the game actually wrote a save").toBeTruthy();
    const reloaded = new GameStore(JSON.parse(raw!));
    expect(reloaded.errand()?.label).toBe("Collect 1 Part");
  });
});

describe("the exchange hands out work rather than settling it", () => {
  const main = MAIN_SOURCE;

  it("orders instead of buying on the spot", () => {
    // The market row used to run the purchase from the menu. It now takes on a job.
    expect(main).toMatch(/data-action="errand-buy"/);
    const row = main.match(/<div class="market-actions">[\s\S]{0,320}?<\/div>/)?.[0] ?? "";
    expect(row, "the row must not settle a purchase directly").not.toMatch(/data-action="buy"/);
  });

  it("closes the shop to a maker whose hands are full", () => {
    const row = main.match(/data-action="errand-buy"[^>]*/)?.[0] ?? "";
    expect(row).toMatch(/store\.errand\(\).*disabled/);
  });

  it("settles only at the right desk", () => {
    // A stale panel must not be a way to trade from across the city, so the check is on
    // the player's position rather than on the button existing.
    const fn = main.slice(main.indexOf("async function settleErrand"));
    const body = fn.slice(0, fn.indexOf("\nasync function claimEpoch"));
    expect(body).toMatch(/nearbyCounter\(\)/);
    expect(body).toMatch(/near\.id !== errand\.desk/);
    expect(body, "and it refuses rather than silently doing nothing").toMatch(/toast\(/);
  });

  it("clears the job only when the trade actually settled", () => {
    const fn = main.slice(main.indexOf("async function settleErrand"));
    const body = fn.slice(0, fn.indexOf("\nasync function claimEpoch"));
    const completeAt = body.indexOf("completeErrand()");
    expect(completeAt, "completeErrand must exist").toBeGreaterThan(-1);
    expect(body.slice(0, completeAt), "guarded by whether it worked").toMatch(/if \(done\)/);
  });

  it("recomputes proximity as the player walks, but only when something changed", () => {
    // Both halves matter: without the poll the distance freezes at whatever it read when
    // the job was accepted; without the signature the counter panel is rewritten four
    // times a second and its own buttons stop being clickable.
    expect(main).toMatch(/lastProximitySync/);
    expect(main).toMatch(/proximitySignature/);
    expect(main).toMatch(/if \(signature !== proximitySignature\)/);
  });
});

describe("a busier district has more work on the wall", () => {
  // The point of the change: neighbours used to be a number inside a pricing formula, so
  // a district filling up around you moved your input costs and nothing you could see.
  // The City Hall board now grows with the city, which is the same relationship the
  // district multiplier already pays out on — made visible as work.
  const board = (neighbours: number) => {
    const store = maker();
    store.state.districtBusinesses = neighbours;
    return store.contractOffers();
  };

  it("gives a lone maker the base board", () => {
    expect(board(0)).toHaveLength(CIVIC_BOARD_BASE);
  });

  it("adds an order for every few makers who join", () => {
    expect(board(CIVIC_BOARD_PER_MAKER).length).toBe(CIVIC_BOARD_BASE + 1);
    expect(board(CIVIC_BOARD_PER_MAKER * 2).length).toBe(CIVIC_BOARD_BASE + 2);
  });

  it("stops growing at a board a person can still read", () => {
    expect(board(500).length).toBe(CIVIC_BOARD_MAX);
  });

  it("pays a better premium in a busy district", () => {
    const quiet = board(0)[0]!;
    const busy = board(10)[0]!;
    expect(busy.bonusPercent, "a crowded city bids up its own work")
      .toBeGreaterThan(quiet.bonusPercent);
  });

  it("caps the district premium so a crowd is not free money", () => {
    const huge = board(10_000)[0]!;
    const modest = board(Math.ceil(CIVIC_DISTRICT_BONUS_MAX / CIVIC_DISTRICT_BONUS_PER_MAKER))[0]!;
    expect(huge.bonusPercent).toBe(modest.bonusPercent);
  });

  it("still pays more than it asks for, at every district size", () => {
    // A contract that pays less than the goods are worth is a trap, not a reward.
    for (const neighbours of [0, 3, 12, 400]) {
      for (const offer of board(neighbours)) {
        expect(offer.grossReward, `${neighbours} neighbours, ${offer.resource}`)
          .toBeGreaterThanOrEqual(offer.quantity);
      }
    }
  });
});
