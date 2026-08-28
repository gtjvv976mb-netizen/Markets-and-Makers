// Offline earnings must be settled once, by whoever actually ran the absence.
//
// settleOfflineFootfall has always skipped on a server world — the authority ticks whether
// or not the browser is open, so catching up locally on top of it pays twice for one
// night. The rest of the shift never got that guard: production, wages and broker sales
// still ran, crediting the local purse for work the ledger had already done.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { PLOTS, type LicenseKey } from "../src/data";
import { createFreshState, GameStore } from "../src/state";

vi.mock("../src/realm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/realm")>();
  return { ...actual, worldRunsOnServer: () => serverWorld };
});
let serverWorld = false;

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
  serverWorld = false;
});

const STARTER = PLOTS.filter((p) => p.island === "hearth").sort((a, b) => a.price - b.price)[0]!;

function trading(licence: LicenseKey = "cratemill"): GameStore {
  const store = new GameStore(createFreshState());
  store.selectPlot(STARTER.id);
  store.leaseSelectedPlot();
  store.chooseLicense(licence);
  store.placeBuilding();
  return store;
}

/** Run an absence of `hours` and report what the local purse gained. */
function absence(store: GameStore, hours: number): number {
  const before = store.state.wallet;
  store.state.lastTickAt = Date.now() - hours * 3_600_000;
  store.catchUp(Date.now());
  return store.state.wallet - before;
}

describe("a client world still settles its own absence", () => {
  it("credits the purse for an offline shift", () => {
    serverWorld = false;
    const store = trading();
    expect(absence(store, 8), "an idle client world must still catch up").not.toBe(0);
  });
});

describe("a server world does not settle it again", () => {
  it("leaves the purse alone — the authority already ran that night", () => {
    serverWorld = true;
    const store = trading();
    expect(absence(store, 8), "the ledger already paid for this absence").toBe(0);
  });

  it("still advances the clock, so the absence is not re-read later", () => {
    // Skipping WITHOUT moving lastTickAt would just defer the double-count to the next
    // catch-up, which is the same bug an hour later.
    serverWorld = true;
    const store = trading();
    store.state.lastTickAt = Date.now() - 8 * 3_600_000;
    store.catchUp(Date.now());
    const stale = Date.now() - store.state.lastTickAt;
    expect(stale, "the clock must have caught up").toBeLessThan(60_000);
  });

  it("reports an empty shift rather than a fictional one", () => {
    serverWorld = true;
    const store = trading();
    store.state.lastTickAt = Date.now() - 8 * 3_600_000;
    const report = store.catchUp(Date.now());
    expect(report.revenue).toBe(0);
    expect(report.produced).toBe(0);
    expect(report.wages).toBe(0);
  });
});
