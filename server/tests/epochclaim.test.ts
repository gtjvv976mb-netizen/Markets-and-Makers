// Paying a maker their epoch share, from the authority rather than from their browser.
//
// This is the first place the server creates $MM for a player, so the tests are about the
// ways it could pay twice or pay too much. Every one of them runs against a real database:
// the guarantees here are row locks, an advisory lock and a transaction, and none of those
// can be checked by reasoning about the code.

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { pool, closeDatabase } from "../src/database.js";
import { claimEpoch, epochStanding } from "../src/economy.js";
import { epochIdFor, REWARDS_POOL_MM, MIN_EPOCH_PAYOUT } from "../src/catalogue.js";
import { live as liveDatabase } from "./live-database.js";

const suite = liveDatabase ? describe : describe.skip;
const REALM = "sunwoven-1";
const EPOCH = epochIdFor();

async function maker(contribution: number): Promise<string> {
  const created = await pool!.query<{ id: string }>(
    `insert into player (display_name) values ('Maker') returning id`);
  const id = created.rows[0]!.id;
  await pool!.query(
    `insert into contribution_epoch (realm_id, epoch_id, player_id, contribution)
     values ($1,$2,$3,$4)`, [REALM, EPOCH, id, contribution]);
  return id;
}

const claimedUnits = async (id: string): Promise<number> => Number((await pool!.query<{ n: string }>(
  `select coalesce(sum(claimed_units),0) as n from contribution_epoch where realm_id=$1 and player_id=$2`,
  [REALM, id])).rows[0]!.n);

suite("the epoch claim", () => {
  beforeEach(async () => {
    for (const table of ["market_listing", "auth_session", "payout_request", "contribution_epoch",
                         "reserve_funding", "command_receipt", "currency_ledger", "business"]) {
      await pool!.query(`delete from ${table}`);
    }
    await pool!.query(`delete from player`);
  });
  afterAll(async () => { await closeDatabase(); });

  it("pays a maker their share and records it", async () => {
    const id = await maker(1_000);
    const result = await claimEpoch(REALM, id, randomUUID());
    expect(result.reason).toBe("paid");
    expect(result.paid, `paid ${result.paid}`).toBeGreaterThan(0);
    expect(await claimedUnits(id), "written to the ledger").toBe(result.paid);
    expect(result.lifetime).toBe(result.paid);
  });

  it("refuses a maker who contributed nothing", async () => {
    const id = await maker(0);
    const result = await claimEpoch(REALM, id, randomUUID());
    expect(result.reason).toBe("no-contribution");
    expect(result.paid).toBe(0);
    expect(await claimedUnits(id)).toBe(0);
  });

  it("returns the SAME payment for a repeated idempotency key, and moves nothing", async () => {
    const id = await maker(1_000);
    const key = randomUUID();
    const first = await claimEpoch(REALM, id, key);
    const again = await claimEpoch(REALM, id, key);
    expect(again).toEqual(first);
    expect(await claimedUnits(id), "paid exactly once").toBe(first.paid);
  });

  it("refuses a SECOND claim under a fresh key", async () => {
    // The attack the receipt alone does not stop: a new key each time.
    const id = await maker(1_000);
    const first = await claimEpoch(REALM, id, randomUUID());
    const second = await claimEpoch(REALM, id, randomUUID());
    expect(first.reason).toBe("paid");
    expect(second.reason).toBe("already-claimed");
    expect(second.paid).toBe(0);
    expect(await claimedUnits(id), "still only one payment").toBe(first.paid);
  });

  it("pays once when the same maker claims twice at the same instant", async () => {
    // Two tabs, two keys, no waiting. The row lock decides the order; the loser must see
    // the winner's claimed_at rather than reading a stale row and paying again.
    const id = await maker(1_000);
    const [a, b] = await Promise.all([
      claimEpoch(REALM, id, randomUUID()),
      claimEpoch(REALM, id, randomUUID()),
    ]);
    const paid = [a, b].filter((r) => r.reason === "paid");
    expect(paid, "exactly one of the two may pay").toHaveLength(1);
    expect(await claimedUnits(id)).toBe(paid[0]!.paid);
  });

  it("never lets a whole cohort draw more than the epoch budget", async () => {
    // The reason the advisory lock exists. Ten makers claim simultaneously; without a
    // realm-wide lock each reads a budget the others are about to spend.
    const makers = await Promise.all(Array.from({ length: 10 }, () => maker(1_000)));
    const standing = await epochStanding(REALM, makers[0]!);
    const budget = standing.budget;

    const results = await Promise.all(makers.map((id) => claimEpoch(REALM, id, randomUUID())));
    const total = results.reduce((sum, r) => sum + r.paid, 0);

    expect(total, `ten makers drew ${total} against a budget of ${budget}`).toBeLessThanOrEqual(budget);
    expect(total, "and the epoch actually paid out").toBeGreaterThan(0);
  });

  it("cannot be raced past the last of the pool", async () => {
    // The test that actually proves the advisory lock earns its keep.
    //
    // An equal-share cohort sums to the budget whether or not the claims are serialised,
    // so a race there shows nothing — my first attempt at this passed with the lock
    // deliberately removed. Here the pool has room for ONE payment and five makers reach
    // for it at once. Unserialised, each reads the same remaining room and each pays it.
    // The drain goes in a PREVIOUS epoch. Putting it in this one exhausts this epoch's
    // budget as well, every racer is refused, and the assertion passes on a total of zero
    // while testing nothing — which is what my first version of this test did.
    const drained = await pool!.query<{ id: string }>(
      `insert into player (display_name) values ('Spent') returning id`);
    await pool!.query(
      `insert into contribution_epoch (realm_id, epoch_id, player_id, contribution, claimed_units, claimed_at)
       values ($1,$2,$3,1,$4,now())`,
      [REALM, EPOCH - 1, drained.rows[0]!.id, REWARDS_POOL_MM - 100]);

    const racers = await Promise.all(Array.from({ length: 5 }, () => maker(1_000)));
    const results = await Promise.all(racers.map((id) => claimEpoch(REALM, id, randomUUID())));
    const total = results.reduce((sum, r) => sum + r.paid, 0);

    expect(total, `five racers drew ${total} from a pool with 100 left`).toBeLessThanOrEqual(100);
    // And it must not be vacuous: somebody has to actually get paid, or this proves nothing.
    expect(total, "the last of the pool must reach someone").toBeGreaterThan(0);
  });

  it("stops at the lifetime pool, not just the epoch budget", async () => {
    const id = await maker(1_000);
    // Everything the pool ever held has already been drawn by somebody.
    const other = await maker(1);
    await pool!.query(
      `update contribution_epoch set claimed_units=$3, claimed_at=now()
        where realm_id=$1 and player_id=$2`, [REALM, other, REWARDS_POOL_MM]);

    const result = await claimEpoch(REALM, id, randomUUID());
    expect(result.paid).toBe(0);
    expect(result.reason).toBe("pool-exhausted");
  });

  it("reports the claim in the standing the client reads", async () => {
    const id = await maker(1_000);
    const before = await epochStanding(REALM, id);
    expect(before.claimed).toBe(0);

    const result = await claimEpoch(REALM, id, randomUUID());
    const after = await epochStanding(REALM, id);
    expect(after.claimed, "the panel must show the claim is spent").toBe(result.paid);
    expect(after.lifetime).toBe(result.paid);
  });

  it("pays a small maker the floor rather than nothing", async () => {
    await maker(1_000_000);              // somebody enormous
    const tiny = await maker(1);         // and somebody who barely showed up
    const result = await claimEpoch(REALM, tiny, randomUUID());
    expect(result.paid, "a rounding-down to zero would pay nothing").toBeGreaterThanOrEqual(
      Math.min(MIN_EPOCH_PAYOUT, result.owed));
  });
});
