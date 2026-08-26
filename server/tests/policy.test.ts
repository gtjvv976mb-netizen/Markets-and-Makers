import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDatabase, pool } from "../src/database.js";
import { DIALS, clampDial, readPolicy, resetPolicy, stepLimit, writePolicy } from "../src/policy.js";
import { REQUIRED_HISTORY, advisorAvailable, consultAdvisor, readHistory, recentProposals } from "../src/advisor.js";
import { runCitizenMind, runGovernmentMind } from "../src/minds.js";

const live = Boolean(process.env.DATABASE_URL);
const suite = live ? describe : describe.skip;
const REALM = "sunwoven-1";

async function balance(ownerType: string, ownerId: string): Promise<number> {
  const r = await pool!.query<{ balance: string }>(
    "select balance from currency_account where realm_id=$1 and owner_type=$2 and owner_id=$3",
    [REALM, ownerType, ownerId]);
  return Number(r.rows[0]?.balance ?? 0);
}

/** Plant N days of recorded history, which is what the advisor reasons from. */
async function plantHistory(days: number): Promise<void> {
  for (let i = days; i > 0; i -= 1) {
    await pool!.query(
      `insert into bulletin (realm_id, headline, body, mood, snapshot, model, published_at)
       values ($1,'day','body','steady',$2::jsonb,'claude-opus-5', now() - ($3 || ' days')::interval)`,
      [REALM, JSON.stringify({
        treasury: 8_000_000 - i * 1_000, citizensPurse: 50_000 + i * 100,
        makersHolding: 2_000, businesses: 3, soldToday: 40, wagesPaidToday: 1_000,
      }), String(i)]);
  }
}

describe("the dials themselves", () => {
  it("keeps every default inside its own range", () => {
    // A shipped default outside its clamp would be silently overridden on first read.
    for (const dial of Object.values(DIALS)) {
      expect(dial.fallback, `${dial.key} default`).toBeGreaterThanOrEqual(dial.min);
      expect(dial.fallback, `${dial.key} default`).toBeLessThanOrEqual(dial.max);
      expect(dial.min).toBeLessThan(dial.max);
      expect(dial.maxStep).toBeGreaterThan(0);
    }
  });

  it("clamps anything outside the range, in both directions", () => {
    expect(clampDial("civicDailyWage", 10_000)).toBe(DIALS.civicDailyWage!.max);
    expect(clampDial("civicDailyWage", -50)).toBe(DIALS.civicDailyWage!.min);
    expect(clampDial("civicDailyWage", 12)).toBe(12);
  });

  it("refuses a key it does not know, rather than inventing a dial", () => {
    expect(clampDial("taxRate", 0.5)).toBeNull();
    expect(clampDial("", 1)).toBeNull();
    expect(stepLimit("nonsense", 1)).toBeNull();
  });

  it("refuses values that are not numbers", () => {
    expect(clampDial("civicDailyWage", Number.NaN)).toBeNull();
    expect(clampDial("civicDailyWage", Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("limits how far one proposal may move a dial", () => {
    const step = stepLimit("civicDailyWage", 10)!;
    expect(step.high).toBeLessThanOrEqual(10 * (1 + DIALS.civicDailyWage!.maxStep));
    expect(step.low).toBeGreaterThanOrEqual(DIALS.civicDailyWage!.min);
  });

  it("never lets a step limit escape the absolute range", () => {
    const step = stepLimit("civicDailyWage", DIALS.civicDailyWage!.max)!;
    expect(step.high).toBe(DIALS.civicDailyWage!.max);
  });
});

suite("policy in the database", () => {
  beforeEach(async () => {
    await pool!.query("delete from policy_proposal");
    await pool!.query("delete from policy");
    await pool!.query("delete from bulletin");
    // The ledger references the accounts, so it goes first.
    await pool!.query("delete from currency_ledger");
    await pool!.query("delete from currency_account");
    await pool!.query(
      `insert into currency_account (realm_id, owner_type, owner_id, currency_code, balance)
       values ($1,'government','treasury','MERCS',8000000), ($1,'player','citizens','MERCS',100000)`,
      [REALM]);
    await pool!.query(
      `insert into realm_clock (realm_id, mind) values ($1,'government'),($1,'citizens'),($1,'advisor')
       on conflict (realm_id, mind) do update set last_run_at = now()`, [REALM]);
  });

  afterAll(async () => {
    await pool!.query("delete from policy_proposal");
    await pool!.query("delete from policy");
    await pool!.query("delete from bulletin");
  });

  it("falls back to the shipped defaults when nothing is set", async () => {
    const values = await readPolicy(REALM);
    expect(values.civicDailyWage).toBe(DIALS.civicDailyWage!.fallback);
    expect(values.spendRate).toBe(DIALS.spendRate!.fallback);
  });

  it("ignores a stored value outside the code's range rather than obeying it", async () => {
    // The bound must not be editable by whatever writes the value. A bad row, a bad
    // migration or a bad actor cannot push the economy outside what the code allows.
    await pool!.query(
      `insert into policy (realm_id, key, value) values ($1,'civicDailyWage',999999)
       on conflict (realm_id, key) do update set value = excluded.value`, [REALM]);
    const values = await readPolicy(REALM);
    expect(values.civicDailyWage).toBe(DIALS.civicDailyWage!.max);
  });

  it("clamps on the way in as well", async () => {
    expect(await writePolicy(REALM, "civicDailyWage", 10_000)).toBe(DIALS.civicDailyWage!.max);
    expect(await writePolicy(REALM, "notADial", 5)).toBeNull();
  });

  it("puts every dial back when reset", async () => {
    await writePolicy(REALM, "civicDailyWage", 20);
    expect((await readPolicy(REALM)).civicDailyWage).toBe(20);
    await resetPolicy(REALM);
    expect((await readPolicy(REALM)).civicDailyWage).toBe(DIALS.civicDailyWage!.fallback);
  });

  it("actually changes what the government pays", async () => {
    // A dial nobody reads is decoration. This is the proof the wire is connected.
    await pool!.query("update realm_clock set last_run_at = now() - interval '24 hours'");
    await writePolicy(REALM, "civicDailyWage", DIALS.civicDailyWage!.min);
    const lean = await runGovernmentMind();

    await pool!.query("update realm_clock set last_run_at = now() - interval '24 hours'");
    await writePolicy(REALM, "civicDailyWage", DIALS.civicDailyWage!.max);
    const generous = await runGovernmentMind();

    expect(generous.wageBill).toBeGreaterThan(lean.wageBill);
  });

  it("actually changes what households will spend", async () => {
    await pool!.query("update realm_clock set last_run_at = now() - interval '24 hours'");
    await writePolicy(REALM, "spendRate", DIALS.spendRate!.min);
    const thrifty = await runCitizenMind();

    await pool!.query("update realm_clock set last_run_at = now() - interval '24 hours'");
    await writePolicy(REALM, "spendRate", DIALS.spendRate!.max);
    const free = await runCitizenMind();

    expect(free.spendingPower).toBeGreaterThan(thrifty.spendingPower);
  });
});

suite("the advisor", () => {
  beforeEach(async () => {
    await pool!.query("delete from policy_proposal");
    await pool!.query("delete from policy");
    await pool!.query("delete from bulletin");
  });

  afterAll(async () => {
    await pool!.query("delete from policy_proposal");
    await pool!.query("delete from policy");
    await pool!.query("delete from bulletin");
  });

  it("refuses to advise a realm it has barely seen", async () => {
    // The guard that matters most. Asked about a world with two days of history, a model
    // will still answer — fluently, confidently, and from nothing.
    await plantHistory(2);
    const outcome = await consultAdvisor(true);
    expect(outcome.status).toBe("too-early");
    if (outcome.status === "too-early") {
      expect(outcome.daysOfHistory).toBeLessThan(REQUIRED_HISTORY);
      expect(outcome.required).toBe(REQUIRED_HISTORY);
    }
  });

  it("refuses an empty realm outright", async () => {
    const outcome = await consultAdvisor(true);
    expect(outcome.status).toBe("too-early");
  });

  it("changes nothing at all when it refuses", async () => {
    await plantHistory(2);
    const before = await readPolicy(REALM);
    await consultAdvisor(true);
    expect(await readPolicy(REALM)).toEqual(before);
    expect(await recentProposals()).toEqual([]);
  });

  it("declines without a key rather than failing the loop", async () => {
    await plantHistory(REQUIRED_HISTORY + 3);
    const key = process.env.ANTHROPIC_API_KEY;
    const auth = process.env.ANTHROPIC_AUTH_TOKEN;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    try {
      expect(advisorAvailable()).toBe(false);
      const outcome = await consultAdvisor(true);
      expect(outcome.status).toBe("unavailable");
    } finally {
      if (key) process.env.ANTHROPIC_API_KEY = key;
      if (auth) process.env.ANTHROPIC_AUTH_TOKEN = auth;
    }
  });

  it("reads history oldest first, one row per day", async () => {
    await plantHistory(6);
    const history = await readHistory();
    expect(history.length).toBe(6);
    expect(new Date(history[0]!.day).getTime())
      .toBeLessThan(new Date(history[history.length - 1]!.day).getTime());
    expect(history[0]!.treasury).toBeGreaterThan(0);
  });

  it("moves no money, whatever it decides", async () => {
    await plantHistory(REQUIRED_HISTORY + 2);
    const treasury = await balance("government", "treasury");
    const citizens = await balance("player", "citizens");
    await consultAdvisor(true);
    expect(await balance("government", "treasury")).toBe(treasury);
    expect(await balance("player", "citizens")).toBe(citizens);
  });
});

// The pool belongs to the file, not to a suite: closing it inside one leaves every later
// suite in the same file without a database. Learned the hard way in tick.test.ts.
afterAll(async () => {
  if (!live) return;
  await pool!.query("delete from policy_proposal");
  await pool!.query("delete from policy");
  await pool!.query("delete from bulletin");
  await closeDatabase();
});
