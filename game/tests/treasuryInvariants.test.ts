import { beforeEach, describe, expect, it } from "vitest";
import { GameStore } from "../src/state";

/** The store persists on every commit; the suite's usual in-memory stand-in. */
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

/** The exact expression main.ts uses, so the property is tested and not a paraphrase. */
function convertibleMM(store: GameStore): number {
  const held = store.state.mmHoldings;
  const perUnit = store.mercDollarsForMM(1);
  if (held <= 0 || perUnit <= 0) return 0;
  return Math.max(0, Math.min(held, Math.floor(store.issuanceHeadroom() / perUnit)));
}

describe("the bank cannot be talked into issuing money it does not have", () => {
  it("never offers a conversion the cap would refuse", () => {
    // The headroom is rarely a multiple of the 98-per-unit rate, and the floor division
    // is the only thing standing between "offered" and "refused". Walk the awkward cases.
    const store = new GameStore();
    for (const held of [0, 1, 97, 98, 99, 1_000, 10_000, 1_000_000]) {
      store.state.mmHoldings = held;
      const offer = convertibleMM(store);
      expect(offer).toBeLessThanOrEqual(held);
      expect(store.mercDollarsForMM(offer)).toBeLessThanOrEqual(store.issuanceHeadroom());
      // and what it offers is genuinely accepted, not merely small enough
      if (offer > 0) {
        const probe = new GameStore();
        probe.state.mmHoldings = held;
        expect(probe.exchangeMMForMercDollars(convertibleMM(probe)).ok).toBe(true);
      }
    }
  });

  it("offers nothing rather than something refused when the cap is exhausted", () => {
    const store = new GameStore();
    store.state.mmHoldings = 10_000;
    store.state.epochIssued = Number.MAX_SAFE_INTEGER;   // no room at all
    expect(store.issuanceHeadroom()).toBe(0);
    expect(convertibleMM(store)).toBe(0);
    expect(store.exchangeMMForMercDollars(1).ok).toBe(false);
  });

  it("keeps the player's $MM when the bank refuses it", () => {
    // The deposit is real and irreversible. A refusal must never consume it.
    const store = new GameStore();
    store.state.mmHoldings = 500;
    store.state.epochIssued = Number.MAX_SAFE_INTEGER;
    const before = { held: store.state.mmHoldings, wallet: store.state.wallet, deposited: store.state.mmDeposited };
    expect(store.exchangeMMForMercDollars(500).ok).toBe(false);
    expect(store.state.mmHoldings).toBe(before.held);
    expect(store.state.wallet).toBe(before.wallet);
    expect(store.state.mmDeposited).toBe(before.deposited);
  });

  it("credits a replayed deposit exactly once", () => {
    // The authority may answer the same signature twice; the handler converts only what
    // setDepositedMM reports as new, so a replay must convert nothing.
    const store = new GameStore();
    const first = store.setDepositedMM(300);
    const replay = store.setDepositedMM(300);
    const lower = store.setDepositedMM(120);
    expect(first).toBe(300);
    expect(replay).toBe(0);
    expect(lower).toBe(0);
    expect(store.state.mmHoldings).toBe(300);
  });

  it("issues the same money whether a deposit is taken in one piece or many", () => {
    // Splitting must not beat the rounding. floor(n * 98) is exact, so it cannot.
    // Each store gets its own storage: a GameStore LOADS the save on construction, so two
    // built over one localStorage means the second inherits the first's wallet, which is
    // what made this look like a doubling bug rather than a broken fixture.
    const run = (each: number, times: number) => {
      Object.defineProperty(globalThis, "localStorage", { value: new MemoryStorage(), configurable: true });
      const store = new GameStore();
      store.state.mmHoldings = each * times;
      for (let i = 0; i < times; i += 1) store.exchangeMMForMercDollars(each);
      return { wallet: store.state.wallet, issued: store.state.epochIssued };
    };
    expect(run(100, 10)).toEqual(run(1_000, 1));
    expect(run(1, 1_000)).toEqual(run(1_000, 1));
  });

  it("does not pay a profit on a round trip", () => {
    // $MM -> MERCS -> $MM must lose the spread twice, never gain.
    const store = new GameStore();
    store.state.mmHoldings = 10_000;
    const started = store.state.mmHoldings;
    store.exchangeMMForMercDollars(10_000);
    const issued = store.state.wallet;
    store.exchangeMercDollarsForMM(issued);
    expect(store.state.mmHoldings).toBeLessThan(started);
  });
});
