import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDatabase, pool } from "../src/database.js";
import { ISLAND_IDS, PLOTS, PLOTS_BY_ID } from "../src/plots.js";
import {
  allBusinesses, districtBusinesses, registerBusiness, releaseBusiness, seedPlots, WorldError,
} from "../src/world.js";
import { live as liveDatabase } from "./live-database.js";

// See live-database.ts: these suites EMPTY their tables, so they refuse to run
// against a database that is not obviously disposable.
const live = liveDatabase;
const suite = live ? describe : describe.skip;
const REALM = "sunwoven-1";

async function player(name: string): Promise<string> {
  const r = await pool!.query<{ id: string }>(
    "insert into player (display_name, wallet_address) values ($1, $2) returning id",
    [name, `Wallet${name}${Math.random().toString(36).slice(2, 10)}`],
  );
  return r.rows[0]!.id;
}

/** The exported layout is generated, so these hold with or without a database. */
describe("the exported world layout", () => {
  it("carries every plot the client knows about", () => {
    expect(PLOTS.length).toBeGreaterThan(200);
    expect(PLOTS_BY_ID.size).toBe(PLOTS.length);
  });

  it("gives each plot a district and a footfall score in range", () => {
    for (const plot of PLOTS) {
      expect(plot.island, `${plot.id} has no district`).toBeTruthy();
      expect(plot.footfall, `${plot.id} scored ${plot.footfall}`).toBeGreaterThan(0);
      expect(plot.footfall).toBeLessThanOrEqual(1);
    }
  });

  it("spreads footfall enough for siting to be a real decision", () => {
    const hearth = PLOTS.filter((plot) => plot.island === "hearth").map((plot) => plot.footfall);
    expect(Math.max(...hearth) / Math.min(...hearth)).toBeGreaterThan(2);
  });

  it("names every district exactly once", () => {
    expect(new Set(ISLAND_IDS).size).toBe(ISLAND_IDS.length);
    expect(ISLAND_IDS.length).toBeGreaterThan(1);
  });
});

suite("the world registry", () => {
  beforeEach(async () => {
    await pool!.query("delete from business");
    await pool!.query("update plot set owner_player_id = null, license = null");
    await seedPlots(REALM);
  });

  afterAll(async () => {
    // Leave the shared tables as they were found. These tests plant players and point
    // plot.owner_player_id at them; auth.test.ts clears players by wallet address, and
    // the foreign key from plot refuses that while the pointers are still live. Cleaning
    // up here rather than only in beforeEach is what keeps the suites independent.
    await pool!.query("delete from business");
    await pool!.query("update plot set owner_player_id = null, license = null");
    await closeDatabase();
  });

  it("puts the whole layout in the database, and does it idempotently", async () => {
    const first = await pool!.query<{ n: string }>("select count(*)::text as n from plot where realm_id = $1", [REALM]);
    await seedPlots(REALM);
    const second = await pool!.query<{ n: string }>("select count(*)::text as n from plot where realm_id = $1", [REALM]);
    expect(Number(first.rows[0]!.n)).toBe(PLOTS.length);
    expect(second.rows[0]!.n).toBe(first.rows[0]!.n);
  });

  it("records a business where a maker builds one", async () => {
    const alice = await player("alice");
    const saved = await registerBusiness({
      realmId: REALM, playerId: alice, plotId: "GX072", license: "shop",
      condition: 96, upgrades: { yield: 2, capacity: 1, speed: 0, appeal: 3 },
    });
    expect(saved.plotId).toBe("GX072");
    expect(saved.license).toBe("shop");
    expect(saved.condition).toBe(96);
    expect(saved.upgrades.appeal).toBe(3);
    expect(saved.footfall).toBeGreaterThan(0);
    expect(saved.mine).toBe(true);
  });

  it("refuses a plot another maker already holds", async () => {
    const alice = await player("alice");
    const bob = await player("bob");
    await registerBusiness({ realmId: REALM, playerId: alice, plotId: "GX072", license: "shop",
      condition: 100, upgrades: { yield: 0, capacity: 0, speed: 0, appeal: 0 } });

    await expect(registerBusiness({ realmId: REALM, playerId: bob, plotId: "GX072", license: "gym",
      condition: 100, upgrades: { yield: 0, capacity: 0, speed: 0, appeal: 0 } }))
      .rejects.toThrow(WorldError);

    // Alice still owns it, still a shop.
    const district = await districtBusinesses(REALM, "hearth", alice);
    const held = district.find((entry) => entry.plotId === "GX072");
    expect(held?.license).toBe("shop");
    expect(held?.mine).toBe(true);
  });

  it("lets the owner re-license and upgrade their own plot", async () => {
    const alice = await player("alice");
    await registerBusiness({ realmId: REALM, playerId: alice, plotId: "GX072", license: "shop",
      condition: 100, upgrades: { yield: 0, capacity: 0, speed: 0, appeal: 0 } });
    const again = await registerBusiness({ realmId: REALM, playerId: alice, plotId: "GX072", license: "restaurant",
      condition: 80, upgrades: { yield: 4, capacity: 2, speed: 1, appeal: 5 } });
    expect(again.license).toBe("restaurant");
    expect(again.upgrades.yield).toBe(4);

    const rows = await pool!.query<{ revision: string }>("select revision::text from business where plot_id = $1", ["GX072"]);
    expect(Number(rows.rows[0]!.revision)).toBeGreaterThan(1);
  });

  it("clamps anything a client sends rather than trusting it", async () => {
    const alice = await player("alice");
    const saved = await registerBusiness({
      realmId: REALM, playerId: alice, plotId: "GX072", license: "shop",
      condition: 500,
      upgrades: { yield: 99, capacity: -5, speed: 3, appeal: 2 } as never,
    });
    expect(saved.condition).toBe(100);
    expect(saved.upgrades.yield).toBe(10);
    expect(saved.upgrades.capacity).toBe(0);
    expect(saved.upgrades.speed).toBe(3);
  });

  it("refuses a plot that does not exist in this world", async () => {
    const alice = await player("alice");
    await expect(registerBusiness({ realmId: REALM, playerId: alice, plotId: "not-a-plot", license: "shop",
      condition: 100, upgrades: { yield: 0, capacity: 0, speed: 0, appeal: 0 } }))
      .rejects.toThrow(/unknown-plot|No plot named/);
  });

  it("refuses a business with no licence", async () => {
    const alice = await player("alice");
    await expect(registerBusiness({ realmId: REALM, playerId: alice, plotId: "GX072", license: "",
      condition: 100, upgrades: { yield: 0, capacity: 0, speed: 0, appeal: 0 } }))
      .rejects.toThrow(/license-required|needs a licence/);
  });

  it("shows every maker the same district, and tells each which shop is theirs", async () => {
    // The whole point of the registry: before this, no player could see another's shop.
    const alice = await player("alice");
    const bob = await player("bob");
    await registerBusiness({ realmId: REALM, playerId: alice, plotId: "GX072", license: "shop",
      condition: 100, upgrades: { yield: 0, capacity: 0, speed: 0, appeal: 0 } });
    await registerBusiness({ realmId: REALM, playerId: bob, plotId: "GX036", license: "greenhouse",
      condition: 100, upgrades: { yield: 0, capacity: 0, speed: 0, appeal: 0 } });

    const asAlice = await districtBusinesses(REALM, "hearth", alice);
    const asBob = await districtBusinesses(REALM, "hearth", bob);

    expect(asAlice.map((e) => e.plotId).sort()).toEqual(["GX036", "GX072"]);
    expect(asAlice.map((e) => e.plotId).sort()).toEqual(asBob.map((e) => e.plotId).sort());
    expect(asAlice.find((e) => e.plotId === "GX072")!.mine).toBe(true);
    expect(asAlice.find((e) => e.plotId === "GX036")!.mine).toBe(false);
    expect(asBob.find((e) => e.plotId === "GX036")!.mine).toBe(true);
  });

  it("publishes only the ends of an owner's wallet, never the whole address", async () => {
    const alice = await player("alice");
    const full = await pool!.query<{ wallet_address: string }>("select wallet_address from player where id = $1", [alice]);
    const address = full.rows[0]!.wallet_address;
    await registerBusiness({ realmId: REALM, playerId: alice, plotId: "GX072", license: "shop",
      condition: 100, upgrades: { yield: 0, capacity: 0, speed: 0, appeal: 0 } });

    const [listed] = await districtBusinesses(REALM, "hearth");
    expect(listed!.owner).not.toBe(address);
    expect(listed!.owner).toContain("…");
    expect(listed!.owner.length).toBeLessThan(address.length);
  });

  it("keeps districts apart", async () => {
    const alice = await player("alice");
    await registerBusiness({ realmId: REALM, playerId: alice, plotId: "GX072", license: "shop",
      condition: 100, upgrades: { yield: 0, capacity: 0, speed: 0, appeal: 0 } });
    const elsewhere = ISLAND_IDS.find((id) => id !== "hearth")!;
    expect(await districtBusinesses(REALM, elsewhere)).toHaveLength(0);
  });

  it("releases a plot back to the world, and only for its owner", async () => {
    const alice = await player("alice");
    const bob = await player("bob");
    await registerBusiness({ realmId: REALM, playerId: alice, plotId: "GX072", license: "shop",
      condition: 100, upgrades: { yield: 0, capacity: 0, speed: 0, appeal: 0 } });

    expect(await releaseBusiness(bob, "GX072")).toBe(false);
    expect(await districtBusinesses(REALM, "hearth")).toHaveLength(1);

    expect(await releaseBusiness(alice, "GX072")).toBe(true);
    expect(await districtBusinesses(REALM, "hearth")).toHaveLength(0);

    // And it is genuinely free again, not merely hidden.
    await registerBusiness({ realmId: REALM, playerId: bob, plotId: "GX072", license: "gym",
      condition: 100, upgrades: { yield: 0, capacity: 0, speed: 0, appeal: 0 } });
    const [taken] = await districtBusinesses(REALM, "hearth", bob);
    expect(taken!.license).toBe("gym");
    expect(taken!.mine).toBe(true);
  });

  it("hands the tick loop every business in the realm, with its footfall", async () => {
    const alice = await player("alice");
    const bob = await player("bob");
    await registerBusiness({ realmId: REALM, playerId: alice, plotId: "GX072", license: "shop",
      condition: 100, upgrades: { yield: 0, capacity: 0, speed: 0, appeal: 0 } });
    await registerBusiness({ realmId: REALM, playerId: bob, plotId: "GX036", license: "greenhouse",
      condition: 100, upgrades: { yield: 0, capacity: 0, speed: 0, appeal: 0 } });

    const all = await allBusinesses(REALM);
    expect(all).toHaveLength(2);
    for (const entry of all) {
      expect(entry.footfall).toBe(PLOTS_BY_ID.get(entry.plotId)!.footfall);
      expect(entry.owner).toMatch(/^[0-9a-f-]{36}$/i);   // the real id, for crediting
    }
  });
});
