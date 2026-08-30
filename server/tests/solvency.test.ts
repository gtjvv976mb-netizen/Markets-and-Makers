/**
 * The realm may never owe more $MM than the treasury actually holds.
 *
 * Before this, every bound on emission was an in-game one — a constant pool, an emission
 * rate, a ceiling — and none of them had any idea what the treasury WALLET contained. That
 * is harmless while $MM is a score and a default the moment withdrawals open.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDatabase, pool } from "../src/database.js";
import { epochCeiling, forgetSolvencySample, outstandingLiability, solvency } from "../src/solvency.js";
import { epochIdFor } from "../src/catalogue.js";
import { live as liveDatabase } from "./live-database.js";

const suite = liveDatabase ? describe : describe.skip;
const REALM = "sunwoven-1";

async function mkPlayer(name: string): Promise<string> {
  const r = await pool!.query<{ id: string }>(
    "insert into player (display_name, wallet_address) values ($1,$2) returning id",
    [name, `V${name}${Math.random().toString(36).slice(2, 10)}`]);
  return r.rows[0]!.id;
}

async function claim(playerId: string, units: number): Promise<void> {
  await pool!.query(
    `insert into contribution_epoch (realm_id, epoch_id, player_id, contribution, claimed_units)
     values ($1,$2,$3,0,$4)
     on conflict (realm_id, epoch_id, player_id)
     do update set claimed_units = contribution_epoch.claimed_units + excluded.claimed_units`,
    [REALM, epochIdFor(), playerId, units]);
}

suite("the realm cannot promise $MM it does not hold", () => {
  beforeEach(async () => {
    forgetSolvencySample();
    await pool!.query("delete from payout_request");
    await pool!.query("delete from contribution_epoch");
  });
  afterAll(async () => {
    await pool!.query("delete from payout_request");
    await pool!.query("delete from contribution_epoch");
    await closeDatabase();
  });

  it("counts what has been claimed and not yet withdrawn", async () => {
    const a = await mkPlayer("solv-a");
    const b = await mkPlayer("solv-b");
    await claim(a, 400);
    await claim(b, 250);
    const owed = await outstandingLiability(REALM);
    console.log(`OUTSTANDING after 400 + 250 claimed: ${owed}`);
    expect(owed).toBe(650);
  });

  it("stops counting a claim once it has been paid out", async () => {
    const a = await mkPlayer("solv-c");
    await claim(a, 500);
    await pool!.query(
      `insert into payout_request (realm_id, player_id, wallet_address, units, state)
       values ($1,$2,$3,$4,'confirmed')`, [REALM, a, "So11111111111111111111111111111111111111112", 200]);
    const owed = await outstandingLiability(REALM);
    console.log(`OUTSTANDING after 500 claimed, 200 paid: ${owed}`);
    expect(owed).toBe(300);
  });

  it("counts an IN-FLIGHT withdrawal as already gone", async () => {
    // A queued payout is money the treasury has committed. Treating it as still available
    // is how the same tokens get promised twice.
    const a = await mkPlayer("solv-d");
    await claim(a, 500);
    await pool!.query(
      `insert into payout_request (realm_id, player_id, wallet_address, units, state)
       values ($1,$2,$3,$4,'queued')`, [REALM, a, "So11111111111111111111111111111111111111112", 500]);
    console.log(`OUTSTANDING with the whole lot queued: ${await outstandingLiability(REALM)}`);
    expect(await outstandingLiability(REALM)).toBe(0);
  });

  it("reports 'off' and does not cap emission while withdrawals are closed", async () => {
    // The pre-launch economy must be untouched: $MM is an internal score bounded by
    // REWARDS_POOL_MM, and nothing here may narrow it.
    const a = await mkPlayer("solv-e");
    await claim(a, 1_000);
    const report = await solvency(REALM);
    console.log(`PAYOUTS OFF: status=${report.status} outstanding=${report.outstanding} headroom=${report.headroom}`);
    expect(report.status).toBe("off");
    expect(report.outstanding).toBe(1_000);
    expect(await epochCeiling(REALM)).toBe(Number.POSITIVE_INFINITY);
  });

  it("refuses to issue anything when payouts are ON and the balance cannot be read", async () => {
    // Conservative on purpose. An unreadable balance is an unknown liability, and issuing
    // against an unknown is exactly how a default happens. Already-earned claims are
    // untouched — this caps NEW issuance only.
    const { config } = await import("../src/config.js");
    const previous = config.payoutsEnabled;
    (config as { payoutsEnabled: boolean }).payoutsEnabled = true;
    forgetSolvencySample();
    try {
      const ceiling = await epochCeiling(REALM);
      const report = await solvency(REALM);
      console.log(`PAYOUTS ON, no treasury key: status=${report.status} ceiling=${ceiling}`);
      expect(report.status).toBe("unknown");
      expect(ceiling).toBe(0);
    } finally {
      (config as { payoutsEnabled: boolean }).payoutsEnabled = previous;
      forgetSolvencySample();
    }
  });
});
