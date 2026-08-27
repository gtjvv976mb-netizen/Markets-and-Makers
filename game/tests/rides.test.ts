import { beforeEach, describe, expect, it } from "vitest";
import { CIVIC_BUILDINGS, RIDE_MINIMUM_FARE } from "../src/data";
import { createFreshState, GameStore } from "../src/state";

/**
 * Rides, and where the fare goes.
 *
 * Walking is free and must stay free — a walkable city is the premise, and the Mayor says
 * so in her first sentence. The fare is for somebody who has made the same trip fifty
 * times, and it has to be a real sink: every Merc must leave the player and reach the
 * treasury, which funds the civic wage, which becomes somebody's custom.
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
beforeEach(() => Object.defineProperty(globalThis, "localStorage", { value: new MemoryStorage(), configurable: true }));

describe("hailing a ride", () => {
  it("charges by distance and never below the minimum", () => {
    const store = new GameStore(createFreshState());
    const bank = CIVIC_BUILDINGS.find((b) => b.id === "treasury")!;
    store.state.player = { x: bank.x, z: bank.z };
    expect(store.rideFare("treasury"), "standing at the door still costs the minimum").toBe(RIDE_MINIMUM_FARE);

    store.state.player = { x: bank.x + 120, z: bank.z + 120 };
    const far = store.rideFare("treasury");
    store.state.player = { x: bank.x + 20, z: bank.z + 20 };
    const near = store.rideFare("treasury");
    expect(far, "further must cost more").toBeGreaterThan(near);
  });

  it("moves every Merc of the fare into the treasury", () => {
    const store = new GameStore(createFreshState());
    store.state.player = { x: 60, z: 60 };
    const fare = store.rideFare("treasury");
    const wallet = store.state.wallet;
    const treasury = store.state.governmentTreasury;
    const supply = store.totalMoneySupply();

    expect(store.rideTo("treasury").ok).toBe(true);
    expect(store.state.wallet, "the fare leaves the player").toBe(wallet - fare);
    expect(store.state.governmentTreasury, "and arrives in the treasury").toBe(treasury + fare);
    expect(store.totalMoneySupply(), "a fare moves money, it does not destroy it").toBe(supply);
  });

  it("puts you at the kerb of the place you asked for", () => {
    const store = new GameStore(createFreshState());
    store.state.player = { x: 80, z: 80 };
    store.rideTo("treasury");
    const bank = CIVIC_BUILDINGS.find((b) => b.id === "treasury")!;
    const distance = Math.hypot(store.state.player.x - bank.x, store.state.player.z - bank.z);
    expect(distance, "dropped at the door, not inside the building").toBeLessThan(12);
  });

  it("refuses rather than overdrawing, and says walking is free", () => {
    const store = new GameStore(createFreshState());
    store.state.player = { x: 200, z: 200 };
    store.state.wallet = 1;
    const result = store.rideTo("treasury");
    expect(result.ok).toBe(false);
    expect(result.message.toLowerCase()).toContain("walking");
    expect(store.state.wallet, "a refused ride costs nothing").toBe(1);
  });

  it("will not invent a route to somewhere that is not here", () => {
    const store = new GameStore(createFreshState());
    const before = store.state.wallet;
    expect(store.rideTo("not-a-place").ok).toBe(false);
    expect(store.state.wallet).toBe(before);
  });
});

describe("the fare board", () => {
  it("only offers places worth paying to reach", () => {
    // Standing at a door, the fare falls to the minimum — and paying to travel nowhere is
    // how a service loses a player's trust. Those stops are left off the board.
    const store = new GameStore(createFreshState());
    const bank = CIVIC_BUILDINGS.find((b) => b.id === "treasury")!;
    store.state.player = { x: bank.x, z: bank.z };
    expect(store.rideFare("treasury")).toBe(RIDE_MINIMUM_FARE);

    const worthwhile = CIVIC_BUILDINGS
      .filter((site) => site.island === store.state.island)
      .map((site) => ({ id: site.id, fare: store.rideFare(site.id) }))
      .filter((entry) => entry.fare > RIDE_MINIMUM_FARE);
    expect(worthwhile.some((entry) => entry.id === "treasury"),
      "the place you are standing must not be on the board").toBe(false);
    expect(worthwhile.length, "but somewhere else should be").toBeGreaterThan(0);
  });

  it("prices every stop by how far it actually is", () => {
    const store = new GameStore(createFreshState());
    store.state.player = { x: 0, z: 0 };
    const fares = CIVIC_BUILDINGS
      .filter((site) => site.island === store.state.island)
      .map((site) => ({
        id: site.id,
        fare: store.rideFare(site.id),
        metres: Math.hypot(site.x, site.z),
      }));
    // Sorting by fare must give the same order as sorting by distance.
    const byFare = [...fares].sort((a, b) => a.fare - b.fare).map((entry) => entry.id);
    const byDistance = [...fares].sort((a, b) => a.metres - b.metres).map((entry) => entry.id);
    expect(byFare, "the cheapest ride must also be the shortest").toEqual(byDistance);
  });
});
