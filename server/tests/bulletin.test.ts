import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDatabase, pool } from "../src/database.js";
import { dispatchAvailable, readEconomy, recentDispatches, writeDispatch } from "../src/bulletin.js";
import { runGovernmentMind } from "../src/minds.js";
import { registerBusiness, seedPlots } from "../src/world.js";
import { live as liveDatabase } from "./live-database.js";

// See live-database.ts: these suites EMPTY their tables, so they refuse to run
// against a database that is not obviously disposable.
const live = liveDatabase;
const suite = live ? describe : describe.skip;
const REALM = "sunwoven-1";

async function player(name: string): Promise<string> {
  const r = await pool!.query<{ id: string }>(
    "insert into player (display_name, wallet_address) values ($1,$2) returning id",
    [name, `W${name}${Math.random().toString(36).slice(2, 10)}`]);
  return r.rows[0]!.id;
}

async function totalCurrency(): Promise<number> {
  const r = await pool!.query<{ total: string }>(
    "select coalesce(sum(balance),0)::text as total from currency_account where realm_id=$1", [REALM]);
  return Number(r.rows[0]!.total);
}

suite("the Mercedonia Dispatch", () => {
  beforeEach(async () => {
    await pool!.query("delete from bulletin");
    await pool!.query("delete from business");
    await pool!.query("update plot set owner_player_id = null, license = null");
    await pool!.query("delete from demand_day");
    await pool!.query("delete from currency_ledger");
    await pool!.query("delete from currency_account");
    await seedPlots(REALM);
    await pool!.query(
      `insert into currency_account (realm_id, owner_type, owner_id, currency_code, balance)
       values ($1,'government','treasury','MERCS',8000000), ($1,'player','citizens','MERCS',2000000)
       on conflict (realm_id, owner_type, owner_id, currency_code) do update set balance = excluded.balance`,
      [REALM]);
  });

  afterAll(async () => {
    await pool!.query("delete from bulletin");
    await pool!.query("delete from business");
    await pool!.query("update plot set owner_player_id = null, license = null");
    await closeDatabase();
  });

  describe("what it is told", () => {
    it("reads the district's real figures from the ledger", async () => {
      const alice = await player("alice");
      await registerBusiness({ realmId: REALM, playerId: alice, plotId: "GX072", license: "shop",
        condition: 100, upgrades: { yield: 0, capacity: 0, speed: 0, appeal: 0 } });

      const snapshot = await readEconomy();
      expect(snapshot.businesses).toBe(1);
      expect(snapshot.districts).toContain("hearth");
      expect(snapshot.treasury).toBe(8_000_000);
      expect(snapshot.citizensPurse).toBe(2_000_000);
    });

    it("reports an empty district as empty rather than guessing", async () => {
      const snapshot = await readEconomy();
      expect(snapshot.businesses).toBe(0);
      expect(snapshot.soldToday).toBe(0);
      expect(snapshot.busiestTrade).toBeNull();
    });

    it("sees the wages the government actually paid", async () => {
      await pool!.query("update realm_clock set last_run_at = now() - interval '24 hours'");
      const paid = await runGovernmentMind();
      const snapshot = await readEconomy();
      expect(paid.wagesPaid).toBeGreaterThan(0);
      expect(snapshot.wagesPaidToday).toBeGreaterThanOrEqual(paid.wagesPaid);
    });
  });

  describe("what it can do", () => {
    it("moves no money, whatever it writes", async () => {
      // The boundary that makes this safe to run at all: the writer reads the ledger and
      // writes prose. It cannot settle, credit, or spend.
      const before = await totalCurrency();
      await readEconomy();
      await recentDispatches();
      expect(await totalCurrency()).toBe(before);
    });

    it("declines quietly when there is no API key, rather than failing the tick", async () => {
      // The district must not depend on the newspaper. No key, no bulletin, no drama.
      const key = process.env.ANTHROPIC_API_KEY;
      const auth = process.env.ANTHROPIC_AUTH_TOKEN;
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.ANTHROPIC_AUTH_TOKEN;
      try {
        expect(dispatchAvailable()).toBe(false);
        await expect(writeDispatch(true)).resolves.toBeNull();
      } finally {
        if (key) process.env.ANTHROPIC_API_KEY = key;
        if (auth) process.env.ANTHROPIC_AUTH_TOKEN = auth;
      }
    });

    it("publishes nothing until something has been written", async () => {
      expect(await recentDispatches()).toEqual([]);
    });
  });

  describe("what it keeps", () => {
    it("stores the figures it was given beside the words it wrote", async () => {
      // A fair summary and a confident invention look identical on the page. Keeping the
      // input is the only thing that lets anyone tell them apart afterwards.
      await pool!.query(
        `insert into bulletin (realm_id, headline, body, mood, snapshot, model)
         values ($1,'Quiet week on the Greenloom','Two shops traded steadily.','steady',
                 $2::jsonb,'claude-opus-5')`,
        [REALM, JSON.stringify({ businesses: 2, treasury: 8_000_000 })]);

      const [published] = await recentDispatches();
      expect(published!.headline).toBe("Quiet week on the Greenloom");
      expect(published!.snapshot.businesses).toBe(2);
      expect(published!.snapshot.treasury).toBe(8_000_000);
    });

    it("returns the newest dispatch first", async () => {
      for (const [n, ago] of [["older", "2 days"], ["newer", "1 hour"]] as const) {
        await pool!.query(
          `insert into bulletin (realm_id, headline, body, mood, snapshot, model, published_at)
           values ($1,$2,'body','steady','{}'::jsonb,'claude-opus-5', now() - $3::interval)`,
          [REALM, n, ago]);
      }
      const listed = await recentDispatches();
      expect(listed[0]!.headline).toBe("newer");
    });
  });
});
