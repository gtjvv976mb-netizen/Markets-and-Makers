// The epoch distribution: what the player is SHOWN must be what the player is PAID.
//
// The panel read the authority's projection while the claim button read a local estimate,
// and the two are not close. The local share divides by COHORT_CONTRIBUTION_BASE — a fixed
// 45,000 standing in for "everyone else" — while the authority divides by what the realm's
// makers actually contributed this epoch. In a young realm that gap runs to more than 20x,
// always against the player: a maker holding 500 of a real 2,000 total is owed a quarter
// of the budget and the button offered 1.1% of it.
//
// These tests pin the rule that fixes it: a figure from the authority wins, the local one
// is only a fallback, and the reserve cap is stated rather than applied in silence.

import { beforeEach, describe, expect, it } from "vitest";
import { PLOTS, MIN_MM_RESERVE, type LicenseKey } from "../src/data";
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

const STARTER_PLOT = PLOTS.filter((p) => p.island === "hearth").sort((a, b) => a.price - b.price)[0]!;

function earning(contribution = 500, licence: LicenseKey = "greenhouse"): GameStore {
  const store = new GameStore(createFreshState());
  store.selectPlot(STARTER_PLOT.id);
  store.leaseSelectedPlot();
  store.chooseLicense(licence);
  store.state.epoch.contribution = contribution;
  store.state.epoch.claimed = false;
  return store;
}

describe("the authority's figure wins", () => {
  it("pays what the server said, not the local estimate", () => {
    const store = earning(500);
    const local = store.projectedEpochMM();
    const authoritative = 15_000;
    expect(local, "the local estimate is much smaller").toBeLessThan(authoritative);

    const before = store.state.mmHoldings;
    const result = store.claimEpochRewards(Date.now(), authoritative);
    expect(result.ok).toBe(true);
    expect(store.state.mmHoldings - before, `paid against a local estimate of ${local}`).toBe(authoritative);
  });

  it("falls back to the local estimate when the authority is unreachable", () => {
    const store = earning(500);
    const local = store.projectedEpochMM();
    const before = store.state.mmHoldings;
    store.claimEpochRewards(Date.now());
    expect(store.state.mmHoldings - before).toBe(local);
  });

  it("ignores a nonsense figure rather than paying it", () => {
    for (const junk of [0, -50, Number.NaN, Number.POSITIVE_INFINITY]) {
      const store = earning(500);
      const local = store.projectedEpochMM();
      const before = store.state.mmHoldings;
      store.claimEpochRewards(Date.now(), junk);
      expect(store.state.mmHoldings - before, `figure ${junk}`).toBe(local);
    }
  });

  it("records the payment in lifetime earnings too", () => {
    const store = earning(500);
    const before = store.state.lifetimeMMEarned;
    store.claimEpochRewards(Date.now(), 15_000);
    expect(store.state.lifetimeMMEarned - before).toBe(15_000);
  });
});

describe("the reserve still binds, and says so", () => {
  it("caps a payout the reserve cannot cover", () => {
    const store = earning(500);
    store.state.mmReserve = MIN_MM_RESERVE + 400;   // only 400 of room
    const before = store.state.mmHoldings;
    const result = store.claimEpochRewards(Date.now(), 15_000);
    expect(result.ok).toBe(true);
    expect(store.state.mmHoldings - before, "paid only what the reserve held").toBe(400);
  });

  it("never pays the reserve below its floor", () => {
    for (const room of [0, 1, 250, 9_999]) {
      const store = earning(500);
      store.state.mmReserve = MIN_MM_RESERVE + room;
      store.claimEpochRewards(Date.now(), 1_000_000);
      expect(store.state.mmReserve, `with ${room} of room`).toBeGreaterThanOrEqual(MIN_MM_RESERVE);
    }
  });

  it("does not mark the epoch claimed when there was nothing to pay", () => {
    const store = earning(500);
    store.state.mmReserve = MIN_MM_RESERVE;      // no room at all
    const result = store.claimEpochRewards(Date.now(), 15_000);
    expect(result.ok, "a claim that paid nothing must not burn the epoch").toBe(false);
    expect(store.state.epoch.claimed).toBe(false);
  });
});

describe("a claim cannot be taken twice", () => {
  it("refuses the second attempt whatever figure it carries", () => {
    const store = earning(500);
    expect(store.claimEpochRewards(Date.now(), 15_000).ok).toBe(true);
    const held = store.state.mmHoldings;
    expect(store.claimEpochRewards(Date.now(), 15_000).ok).toBe(false);
    expect(store.state.mmHoldings, "no second payment").toBe(held);
  });

  it("refuses a maker who contributed nothing AND has no authority backing", () => {
    // This test used to pass an authoritative figure of 15,000 and still expect refusal —
    // it encoded the blocker. When the server supplies a figure it has already checked the
    // contribution against its own ledger and committed the claim; refusing then burns the
    // epoch and pays nothing. Unvouched is the case that must still be refused.
    const store = earning(0);
    expect(store.claimEpochRewards(Date.now()).ok).toBe(false);
    expect(store.state.epoch.claimed, "and a refused claim must not burn the epoch").toBe(false);
  });
});

describe("the authority's lifetime total wins", () => {
  it("takes the server's lifetime rather than adding to a local one", () => {
    // A browser that was cleared, or the same wallet played on a second device, has a
    // local lifetime that never saw those epochs. The authority has seen all of them.
    const store = earning(500);
    store.state.lifetimeMMEarned = 0;          // this device has no memory of past epochs
    store.claimEpochRewards(Date.now(), 1_000, 48_000);
    expect(store.state.lifetimeMMEarned, "the authority's total, not 0 + 1,000").toBe(48_000);
  });

  it("falls back to adding locally when no lifetime is supplied", () => {
    const store = earning(500);
    store.state.lifetimeMMEarned = 300;
    store.claimEpochRewards(Date.now(), 1_000);
    expect(store.state.lifetimeMMEarned).toBe(1_300);
  });

  it("ignores a negative lifetime rather than erasing the player's record", () => {
    const store = earning(500);
    store.state.lifetimeMMEarned = 5_000;
    store.claimEpochRewards(Date.now(), 1_000, -1);
    expect(store.state.lifetimeMMEarned).toBe(6_000);
  });
});

describe("the shared-world loop actually earns the weekly reward", () => {
  // The blocker the audit found: applyServerSale was the only revenue path in state.ts
  // that never recorded contribution, so a maker trading in the shared district reached
  // the claim with a local tally of zero — and the client refused a reward the SERVER had
  // already committed and marked claimed. The player got a red error and nothing else.
  it("counts a district sale toward the epoch", () => {
    const store = earning(0);
    expect(store.state.epoch.contribution).toBe(0);
    for (let i = 0; i < 5; i += 1) store.applyServerSale("part", 1, 90, 100);
    expect(store.state.epoch.contribution, "server sales must contribute").toBeGreaterThan(0);
  });

  it("pays a maker whose contribution the AUTHORITY vouched for", () => {
    // Even with a local tally of zero — a cleared browser, a second device, or a client
    // that simply did not see the sale — the server's word settles it.
    const store = earning(0);
    store.state.epoch.contribution = 0;
    const before = store.state.mmHoldings;
    const result = store.claimEpochRewards(Date.now(), 15_000, 15_000);
    expect(result.ok, "the authority already committed this claim").toBe(true);
    expect(store.state.mmHoldings - before).toBe(15_000);
  });

  it("still refuses a claim nobody vouched for", () => {
    // The guard must not become a hole: with no authoritative figure, a maker who has
    // contributed nothing is still refused.
    const store = earning(0);
    store.state.epoch.contribution = 0;
    expect(store.claimEpochRewards(Date.now()).ok).toBe(false);
  });
});
