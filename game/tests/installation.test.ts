import { beforeEach, describe, expect, it } from "vitest";
import { INSTALL_BASE_SECONDS, RESOURCES, UPGRADE_NAMES, type ResourceKey, type UpgradeKey } from "../src/data";
import { createFreshState, GameStore, loadState } from "../src/state";

/**
 * Equipment takes time to fit.
 *
 * Bought is not installed: the crew arrives, the floor comes up, and the line runs without
 * it until they are done. It is the only decision in the game a player cannot take back,
 * so it costs time as well as money — and the time has to be honest in both directions.
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

function readyWorkshop(): GameStore {
  const state = createFreshState();
  state.wallet = 90_000;
  state.ownedPlotId = "garden-row"; state.license = "workshop"; state.buildingPlaced = true;
  const store = new GameStore(state);
  for (const key of Object.keys(RESOURCES) as ResourceKey[]) store.state.inventory[key] = 80;
  return store;
}

describe("fitting equipment", () => {
  it("charges immediately and delivers later", () => {
    const store = readyWorkshop();
    const wallet = store.state.wallet;

    expect(store.purchaseUpgrade("yield").ok).toBe(true);
    expect(store.state.wallet, "the contractor is paid up front").toBeLessThan(wallet);
    expect(store.state.upgrades.yield, "but the machine is not running yet").toBe(0);
    expect(store.installation()?.key).toBe("yield");
  });

  it("takes longer for a bigger machine", () => {
    const store = readyWorkshop();
    expect(store.installSeconds(1)).toBe(INSTALL_BASE_SECONDS);
    expect(store.installSeconds(4)).toBeGreaterThan(store.installSeconds(1));
  });

  it("runs one job at a time", () => {
    const store = readyWorkshop();
    expect(store.purchaseUpgrade("yield").ok).toBe(true);
    const second = store.purchaseUpgrade("speed");
    expect(second.ok, "a second crew cannot start while the first is on the floor").toBe(false);
    expect(second.message.toLowerCase()).toContain("one job at a time");
  });

  it("refunds nothing and loses nothing when the crew finishes while you are away", () => {
    const store = readyWorkshop();
    store.purchaseUpgrade("yield");
    store.state.installation!.completeAt = Date.now() - 1;
    store.catchUp();
    expect(store.state.upgrades.yield, "the level counts once fitted").toBe(1);
    expect(store.installation(), "and the crew has gone").toBeNull();
  });

  it("writes the finished machine to the save, not just to memory", () => {
    // The bug this exists for: settling applied the level in memory and never persisted
    // it, so a player paid for a machine, watched it appear, closed the tab, and found it
    // gone with the money spent.
    const store = readyWorkshop();
    store.purchaseUpgrade("yield");
    store.state.installation!.completeAt = Date.now() - 1;
    store.catchUp();
    expect(loadState().upgrades.yield, "a fitted machine must survive a reload").toBe(1);
  });

  it("keeps the half-finished job across a reload rather than pocketing the money", () => {
    const store = readyWorkshop();
    store.purchaseUpgrade("yield");
    const due = store.state.installation!.completeAt;
    const restored = loadState();
    expect(restored.installation?.key).toBe("yield");
    expect(restored.installation?.completeAt).toBe(due);
  });

  it("names the machine rather than the code word", () => {
    const store = readyWorkshop();
    const result = store.purchaseUpgrade("appeal");
    expect(result.ok).toBe(true);
    // "Appeal improved" tells a player nothing; the shop calls it something.
    expect(store.state.feed[0]?.text).toContain(UPGRADE_NAMES.appeal.name);
  });
});
