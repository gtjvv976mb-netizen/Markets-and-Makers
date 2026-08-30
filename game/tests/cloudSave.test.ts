/**
 * Where a browser keeps a city, and who is allowed to overwrite whose.
 *
 * The failure these guard against is not a crash, it is a player losing their game: a save
 * key that ignored the wallet meant two accounts on one machine shared one city and signing
 * out left the previous player's save for whoever opened the tab next. Every case here is
 * that mistake in a different disguise.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SAVE_KEY } from "../src/data";

const TOKEN_KEY = "markets-makers-session";
const WALLET_KEY = "markets-makers-wallet";

class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length(): number { return this.data.size; }
  clear(): void { this.data.clear(); }
  getItem(key: string): string | null { return this.data.get(key) ?? null; }
  key(index: number): string | null { return [...this.data.keys()][index] ?? null; }
  removeItem(key: string): void { this.data.delete(key); }
  setItem(key: string, value: string): void { this.data.set(key, value); }
}

// window.setTimeout is what cloudSave debounces on, and these tests never let a push fly.
function installEnvironment(): void {
  Object.defineProperty(globalThis, "localStorage", { value: new MemoryStorage(), configurable: true });
  Object.defineProperty(globalThis, "window", {
    value: { setTimeout: () => 0, clearTimeout: () => undefined, addEventListener: () => undefined },
    configurable: true,
  });
}

async function fresh() {
  vi.resetModules();
  return await import("../src/state");
}

describe("the save key follows the wallet", () => {
  beforeEach(() => { installEnvironment(); });
  afterEach(() => { vi.resetModules(); });

  it("uses the unscoped key when nobody is signed in", async () => {
    const { saveKeyFor } = await fresh();
    expect(saveKeyFor(null)).toBe(SAVE_KEY);
  });

  it("gives each wallet its own city", async () => {
    const { saveKeyFor } = await fresh();
    const a = saveKeyFor("WalletAAA");
    const b = saveKeyFor("WalletBBB");
    console.log(`KEYS a=${a} b=${b}`);
    expect(a).not.toBe(b);
    expect(a).toContain(SAVE_KEY);
  });

  it("does not hand a signed-in player the previous player's city", async () => {
    // The exact bug: one key, two accounts. Player A's city must not be readable under
    // player B's key.
    const { saveKeyFor } = await fresh();
    localStorage.setItem(saveKeyFor("WalletAAA"), JSON.stringify({ wallet: 999_999 }));
    expect(localStorage.getItem(saveKeyFor("WalletBBB"))).toBeNull();
  });

  it("adopts a city built before signing in, and leaves it where it was", async () => {
    // Playing anonymously and then linking a wallet must keep the city, and must not
    // delete the anonymous save — an anonymous session afterwards still has its own game.
    localStorage.setItem(SAVE_KEY, JSON.stringify({ island: "hearth", saveRevision: 3 }));
    localStorage.setItem(TOKEN_KEY, "t");
    localStorage.setItem(WALLET_KEY, "WalletAAA");
    const { loadState } = await fresh();
    const state = loadState();
    console.log(`ADOPTED island=${state.island} revision=${state.saveRevision}`);
    expect(state.saveRevision).toBe(3);
    expect(localStorage.getItem(SAVE_KEY)).not.toBeNull();
  });

  it("prefers a signed-in player's own city over the anonymous one", async () => {
    localStorage.setItem(SAVE_KEY, JSON.stringify({ saveRevision: 3 }));
    localStorage.setItem(TOKEN_KEY, "t");
    localStorage.setItem(WALLET_KEY, "WalletAAA");
    const { saveKeyFor } = await fresh();
    localStorage.setItem(saveKeyFor("WalletAAA"), JSON.stringify({ saveRevision: 42 }));
    const { loadState } = await fresh();
    console.log(`OWN CITY revision=${loadState().saveRevision}`);
    expect(loadState().saveRevision).toBe(42);
  });

  it("falls back to the anonymous key when the session is gone", async () => {
    // A token that has expired must not leave the game writing to a wallet-scoped key it
    // can no longer prove it owns.
    localStorage.setItem(WALLET_KEY, "WalletAAA");
    const { saveKeyFor } = await fresh();
    const { linkedWallet } = await import("../src/wallet");
    expect(linkedWallet()).toBeNull();
    expect(saveKeyFor()).toBe(SAVE_KEY);
  });
});

describe("a restored city goes through the same door as a loaded one", () => {
  beforeEach(() => { installEnvironment(); });
  afterEach(() => { vi.resetModules(); });

  it("clamps a restored payload rather than trusting it", async () => {
    // The server stores the blob without reading it, so a restore is the LEAST trustworthy
    // input the game has, and it must go through the same clamps a localStorage save does.
    //
    // What is asserted is what the loader ACTUALLY guarantees. An unknown island falls back
    // and a negative count is floored — but note that `wallet` is NOT bounded: it loads
    // through finite() with the default MAX_SAFE_INTEGER ceiling. That is pre-existing and
    // it is not a way to get money, because on a synced world the purse and every real
    // charge come from the authority's ledger, not from this field. Asserting only
    // Number.isFinite here would be a test that passes whatever the loader does, which is
    // worse than no test.
    const { GameStore } = await fresh();
    const store = new GameStore();
    store.replaceState({ wallet: 10 ** 12, island: "not-a-real-island", staff: -5 });
    console.log(`RESTORED wallet=${store.state.wallet} island=${store.state.island} staff=${store.state.staff}`);
    expect(store.state.island).toBe("hearth");
    expect(store.state.staff).toBe(0);
  });

  it("ignores a payload that is not a city at all", async () => {
    const { GameStore } = await fresh();
    const store = new GameStore();
    const before = store.state.island;
    store.replaceState(null);
    store.replaceState("nonsense");
    expect(store.state.island).toBe(before);
  });

  it("counts a revision on every write, so the newer save can be identified", async () => {
    const { GameStore } = await fresh();
    const store = new GameStore();
    const start = store.state.saveRevision;
    store.hireStaff(1);
    store.hireStaff(1);
    console.log(`REVISION ${start} -> ${store.state.saveRevision}`);
    expect(store.state.saveRevision).toBeGreaterThan(start);
  });
});
