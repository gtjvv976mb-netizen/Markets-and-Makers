/**
 * Does the watchman actually see a drain?
 *
 * A monitor that reports "ok" while the vault empties is worse than none, so each case
 * drives the treasury along a known path and checks the verdict against an answer worked
 * out in advance.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDatabase, pool } from "../src/database.js";
import { forgetTreasurySamples, RUNWAY_CRITICAL_DAYS, treasuryReport } from "../src/watch.js";
import { TREASURY_FLOOR } from "../src/minds.js";
import { live as liveDatabase } from "./live-database.js";

const suite = liveDatabase ? describe : describe.skip;
const REALM = "sunwoven-1";
const HOUR = 3_600_000;

async function setTreasury(balance: number): Promise<void> {
  await pool!.query(
    `insert into currency_account (realm_id, owner_type, owner_id, currency_code, balance)
     values ($1,'government','treasury','MERCS',$2)
     on conflict (realm_id, owner_type, owner_id, currency_code) do update set balance = $2`,
    [REALM, balance]);
}

suite("somebody is watching the treasury", () => {
  beforeEach(() => { forgetTreasurySamples(); });
  afterAll(async () => { await setTreasury(8_000_000); await closeDatabase(); });

  it("says nothing useful until it has watched for long enough", async () => {
    await setTreasury(1_000_000);
    const first = await treasuryReport(0);
    console.log(`FIRST SAMPLE status=${first.status} over=${first.sampledOver}`);
    expect(first.status).toBe("unknown");
    // A minute apart is still not a trend.
    expect((await treasuryReport(60_000)).status).toBe("unknown");
  });

  it("calls a steady treasury healthy", async () => {
    await setTreasury(1_000_000);
    await treasuryReport(0);
    const report = await treasuryReport(6 * HOUR);
    console.log(`STEADY status=${report.status} drain=${report.drainPerDay}/day runway=${report.runwayDays}`);
    expect(report.status).toBe("ok");
    expect(report.runwayDays).toBeNull();
  });

  it("calls a treasury that is FILLING healthy, not draining", async () => {
    await setTreasury(1_000_000);
    await treasuryReport(0);
    await setTreasury(1_200_000);
    const report = await treasuryReport(6 * HOUR);
    console.log(`FILLING drain=${report.drainPerDay}/day status=${report.status}`);
    expect(report.drainPerDay).toBeLessThan(0);
    expect(report.status).toBe("ok");
  });

  it("measures a real drain and turns the runway into days", async () => {
    // 100,000 lost over six hours is 400,000 a day. Against 950,000 spendable that is
    // 2.4 days of runway — worked out here, not read off the code.
    await setTreasury(1_000_000);
    await treasuryReport(0);
    await setTreasury(900_000);
    const report = await treasuryReport(6 * HOUR);
    const expectedSpendable = 900_000 - TREASURY_FLOOR;
    console.log(`DRAIN ${report.drainPerDay}/day (expected 400000) · runway ${report.runwayDays}d`
      + ` (expected ${Math.round(expectedSpendable / 400_000)}d) · status ${report.status}`);
    expect(report.drainPerDay).toBe(400_000);
    expect(report.runwayDays).toBe(Math.round(expectedSpendable / 400_000));
    expect(report.status).toBe("critical");
  });

  it("distinguishes a slow drain worth watching from one worth shouting about", async () => {
    // 1,000 a day against ~950,000 spendable is 950 days: comfortable.
    await setTreasury(1_000_000);
    await treasuryReport(0);
    await setTreasury(1_000_000 - 250);
    const calm = await treasuryReport(6 * HOUR);
    console.log(`SLOW drain=${calm.drainPerDay}/day runway=${calm.runwayDays}d status=${calm.status}`);
    expect(calm.status).toBe("ok");
    expect(calm.runwayDays).toBeGreaterThan(RUNWAY_CRITICAL_DAYS);
  });

  it("counts the runway against the FLOOR, not against zero", async () => {
    // The floor is money the realm may not spend, so a treasury sitting on it has no
    // runway at all however slowly it is falling. Reporting otherwise promises money
    // that cannot legally be paid out.
    await setTreasury(TREASURY_FLOOR);
    await treasuryReport(0);
    await setTreasury(TREASURY_FLOOR - 1);
    const report = await treasuryReport(6 * HOUR);
    console.log(`AT FLOOR balance=${report.balance} floor=${report.floor} runway=${report.runwayDays}d`);
    expect(report.runwayDays).toBe(0);
    expect(report.status).toBe("critical");
  });
});
