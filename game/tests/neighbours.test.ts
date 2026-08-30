/**
 * You cannot buy a corner somebody else is standing on.
 *
 * The bug being guarded: leaseSelectedPlot consulted only the LOCAL portfolio, so two
 * players in two browsers could each pay for the same plot. The second was charged, took
 * it into their portfolio, built on it — and the authority refused the registration into
 * console.warn, where no player has ever looked. They paid for a shop the shared world
 * does not have.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { PLOTS } from "../src/data";
import { GameStore } from "../src/state";
import { propertyMarkerModels } from "../src/propertyMarkers";

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

const HEARTH = PLOTS.filter((p) => p.island === "hearth").sort((a, b) => a.price - b.price);
const TARGET = HEARTH[0]!;

function readyStore(): GameStore {
  const store = new GameStore();
  store.state.island = TARGET.island;
  store.state.wallet = 10_000;
  store.state.selectedPlotId = TARGET.id;
  return store;
}

describe("leasing asks the registry first", () => {
  it("leases a free corner", () => {
    const store = readyStore();
    const before = store.state.wallet;
    const result = store.leaseSelectedPlot();
    console.log(`FREE PLOT ok=${result.ok} wallet ${before} -> ${store.state.wallet}`);
    expect(result.ok).toBe(true);
    expect(store.state.portfolio[TARGET.id]).toBeTruthy();
  });

  it("REFUSES a corner another maker holds, and charges nothing for it", () => {
    const store = readyStore();
    store.setPlotsHeldByOthers([TARGET.id]);
    const before = store.state.wallet;
    const result = store.leaseSelectedPlot();
    console.log(`TAKEN PLOT ok=${result.ok} wallet ${before} -> ${store.state.wallet} · "${result.message}"`);
    expect(result.ok).toBe(false);
    // The whole point: no money moved.
    expect(store.state.wallet).toBe(before);
    expect(store.state.portfolio[TARGET.id]).toBeUndefined();
  });

  it("frees the corner again when the registry says it was released", () => {
    const store = readyStore();
    store.setPlotsHeldByOthers([TARGET.id]);
    expect(store.leaseSelectedPlot().ok).toBe(false);
    store.setPlotsHeldByOthers([]);
    expect(store.leaseSelectedPlot().ok).toBe(true);
  });
});

describe("a neighbour's shop does not advertise itself for sale", () => {
  const markers = (held: string[]) => propertyMarkerModels(
    { island: TARGET.island, portfolio: {}, heldByOthers: new Set(held) },
    () => 10,
    () => null,
  );

  it("shows a free plot as for lease, with its price", () => {
    const marker = markers([]).find((m) => m.id === TARGET.id)!;
    console.log(`VACANT kind=${marker.kind} label="${marker.label}" detail="${marker.detail}"`);
    expect(marker.kind).toBe("vacant");
    expect(marker.label).toBe("For lease");
  });

  it("shows another maker's plot as theirs, and quotes no price", () => {
    const marker = markers([TARGET.id]).find((m) => m.id === TARGET.id)!;
    console.log(`NEIGHBOUR kind=${marker.kind} label="${marker.label}" detail="${marker.detail}"`);
    expect(marker.kind).toBe("neighbour");
    expect(marker.label).not.toBe("For lease");
    // A price on the banner is the invitation that made this wrong; there must not be one.
    expect(marker.detail).not.toContain(String(TARGET.price));
  });
});
