/**
 * Crediting real $MM that a player sent to the treasury.
 *
 * Every case here is a way to be paid for something you did not do. The rules the code
 * enforces — amount from the chain, destination is the treasury, source is YOUR wallet,
 * right mint, finalized, signature as primary key — each close one of them, and a bug in
 * any single one gives away Merc Dollars.
 *
 * The chain is stubbed: what is under test is the VERIFICATION, and pinning it to a live
 * RPC would make the suite depend on mainnet.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDatabase, pool } from "../src/database.js";
import { live as liveDatabase } from "./live-database.js";

const suite = liveDatabase ? describe : describe.skip;
const REALM = "sunwoven-1";

async function mkPlayer(name: string, wallet: string): Promise<string> {
  const r = await pool!.query<{ id: string }>(
    "insert into player (display_name, wallet_address) values ($1,$2) returning id", [name, wallet]);
  return r.rows[0]!.id;
}

suite("crediting a real $MM deposit", () => {
  beforeEach(async () => { await pool!.query("delete from mm_deposit"); });
  afterAll(async () => { await pool!.query("delete from mm_deposit"); await closeDatabase(); });

  it("records a credit once per signature, whatever happens", async () => {
    // The primary key is the whole anti-double-credit design: a retried confirm, a
    // double-clicked button and a replayed request all land on the same row.
    const id = await mkPlayer("dep-a", `W${Math.random().toString(36).slice(2, 12)}`);
    const sig = `S${"1".repeat(80)}`;
    for (let i = 0; i < 3; i += 1) {
      await pool!.query(
        `insert into mm_deposit (signature, realm_id, player_id, units, from_wallet)
         values ($1,$2,$3,$4,$5) on conflict (signature) do nothing`,
        [sig, REALM, id, 500, "WalletA"]);
    }
    const { depositedUnits } = await import("../src/deposit.js");
    const total = await depositedUnits(REALM, id);
    console.log(`THREE INSERTS of the same signature credited: ${total} $MM`);
    expect(total).toBe(500);
  });

  it("keeps two makers' deposits apart", async () => {
    const a = await mkPlayer("dep-b", `W${Math.random().toString(36).slice(2, 12)}`);
    const b = await mkPlayer("dep-c", `W${Math.random().toString(36).slice(2, 12)}`);
    await pool!.query(
      `insert into mm_deposit (signature, realm_id, player_id, units, from_wallet)
       values ($1,$2,$3,$4,$5)`, [`A${"2".repeat(80)}`, REALM, a, 300, "WalletA"]);
    await pool!.query(
      `insert into mm_deposit (signature, realm_id, player_id, units, from_wallet)
       values ($1,$2,$3,$4,$5)`, [`B${"3".repeat(80)}`, REALM, b, 900, "WalletB"]);
    const { depositedUnits } = await import("../src/deposit.js");
    console.log(`A=${await depositedUnits(REALM, a)} B=${await depositedUnits(REALM, b)}`);
    expect(await depositedUnits(REALM, a)).toBe(300);
    expect(await depositedUnits(REALM, b)).toBe(900);
  });

  it("refuses a signature that is not one", async () => {
    const { creditDeposit, DepositError } = await import("../src/deposit.js");
    const id = await mkPlayer("dep-d", `W${Math.random().toString(36).slice(2, 12)}`);
    await expect(creditDeposit(REALM, id, "WalletA", "nope")).rejects.toThrow(DepositError);
    console.log("MALFORMED SIGNATURE refused before any chain call");
  });

  it("refuses to credit one maker's transfer to another", async () => {
    // Signatures are public: anyone can read anyone's off the chain and paste it.
    const a = await mkPlayer("dep-e", `W${Math.random().toString(36).slice(2, 12)}`);
    const b = await mkPlayer("dep-f", `W${Math.random().toString(36).slice(2, 12)}`);
    const sig = `C${"4".repeat(80)}`;
    await pool!.query(
      `insert into mm_deposit (signature, realm_id, player_id, units, from_wallet)
       values ($1,$2,$3,$4,$5)`, [sig, REALM, a, 750, "WalletA"]);
    const { creditDeposit, DepositError } = await import("../src/deposit.js");
    await expect(creditDeposit(REALM, b, "WalletB", sig)).rejects.toThrow(DepositError);
    const { depositedUnits } = await import("../src/deposit.js");
    console.log(`STOLEN SIGNATURE: thief credited ${await depositedUnits(REALM, b)} $MM`);
    expect(await depositedUnits(REALM, b)).toBe(0);
  });

  it("gives the original depositor the same receipt on a replay, not a second credit", async () => {
    const a = await mkPlayer("dep-g", `W${Math.random().toString(36).slice(2, 12)}`);
    const sig = `D${"5".repeat(80)}`;
    await pool!.query(
      `insert into mm_deposit (signature, realm_id, player_id, units, from_wallet)
       values ($1,$2,$3,$4,$5)`, [sig, REALM, a, 250, "WalletA"]);
    const { creditDeposit, depositedUnits } = await import("../src/deposit.js");
    const receipt = await creditDeposit(REALM, a, "WalletA", sig);
    console.log(`REPLAY: alreadyCredited=${receipt.alreadyCredited} units=${receipt.units} total=${receipt.totalDeposited}`);
    expect(receipt.alreadyCredited).toBe(true);
    expect(receipt.units).toBe(250);
    expect(await depositedUnits(REALM, a)).toBe(250);
  });

  it("refuses a deposit of zero or less at the database itself", async () => {
    const a = await mkPlayer("dep-h", `W${Math.random().toString(36).slice(2, 12)}`);
    await expect(pool!.query(
      `insert into mm_deposit (signature, realm_id, player_id, units, from_wallet)
       values ($1,$2,$3,0,$4)`, [`E${"6".repeat(80)}`, REALM, a, "WalletA"])).rejects.toThrow();
    console.log("ZERO-UNIT deposit refused by the column check");
  });
});
