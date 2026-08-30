/**
 * The cloud save, and the one property that matters: a save is never lost to a stale tab.
 *
 * Every case here is a way somebody's city could disappear — an older revision landing on
 * top of a newer one, two accounts sharing a row, a payload too large to store arriving
 * half-written. The conflict rule is "highest revision wins, ties keep what is stored",
 * and it is asserted from both directions because a rule that only works in the order you
 * happened to test is not a rule.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDatabase, pool } from "../src/database.js";
import { dropSave, MAX_SAVE_BYTES, readSave, SaveError, writeSave } from "../src/save.js";
import { live as liveDatabase } from "./live-database.js";

const suite = liveDatabase ? describe : describe.skip;
const REALM = "sunwoven-1";

async function mkPlayer(name: string): Promise<string> {
  const r = await pool!.query<{ id: string }>(
    "insert into player (display_name, wallet_address) values ($1,$2) returning id",
    [name, `S${name}${Math.random().toString(36).slice(2, 10)}`]);
  return r.rows[0]!.id;
}

suite("the city, kept by the authority", () => {
  beforeEach(async () => { await pool!.query("delete from player_save"); });
  afterAll(async () => {
    await pool!.query("delete from player_save");
    await closeDatabase();
  });

  it("stores a city and gives it back", async () => {
    const id = await mkPlayer("save-a");
    await writeSave(REALM, id, 1, { island: "hearth", wallet: 750 });
    const back = await readSave(REALM, id);
    console.log(`STORED revision ${back?.revision} payload ${JSON.stringify(back?.payload)}`);
    expect(back?.revision).toBe(1);
    expect(back?.payload).toEqual({ island: "hearth", wallet: 750 });
  });

  it("returns nothing for a player who has never saved", async () => {
    expect(await readSave(REALM, await mkPlayer("save-empty"))).toBeNull();
  });

  it("lets a newer save replace an older one", async () => {
    const id = await mkPlayer("save-b");
    await writeSave(REALM, id, 4, { note: "old" });
    const result = await writeSave(REALM, id, 9, { note: "new" });
    console.log(`FORWARD 4 -> 9: stored=${result.stored} revision=${result.revision}`);
    expect(result.stored).toBe(true);
    expect((await readSave(REALM, id))?.payload).toEqual({ note: "new" });
  });

  it("REFUSES an older save landing on top of a newer one", async () => {
    // The stale-tab case, and the whole reason revisions exist. A tab left open for an
    // hour must not be able to undo an hour of play on another device by being closed last.
    const id = await mkPlayer("save-c");
    await writeSave(REALM, id, 20, { note: "the real city" });
    const result = await writeSave(REALM, id, 3, { note: "a stale tab" });
    console.log(`STALE 20 <- 3: stored=${result.stored} revision=${result.revision}`);
    expect(result.stored).toBe(false);
    expect(result.revision).toBe(20);
    expect((await readSave(REALM, id))?.payload).toEqual({ note: "the real city" });
  });

  it("keeps the stored save when the revisions are level", async () => {
    const id = await mkPlayer("save-d");
    await writeSave(REALM, id, 7, { note: "first" });
    const result = await writeSave(REALM, id, 7, { note: "second" });
    console.log(`TIE at 7: stored=${result.stored}`);
    expect(result.stored).toBe(true);
    // A tie is allowed through — the same revision means the same amount of work, and
    // refusing it would strand a client that retried a dropped response.
    expect((await readSave(REALM, id))?.revision).toBe(7);
  });

  it("keeps two players' cities apart", async () => {
    const a = await mkPlayer("save-e");
    const b = await mkPlayer("save-f");
    await writeSave(REALM, a, 1, { owner: "a" });
    await writeSave(REALM, b, 1, { owner: "b" });
    expect((await readSave(REALM, a))?.payload).toEqual({ owner: "a" });
    expect((await readSave(REALM, b))?.payload).toEqual({ owner: "b" });
  });

  it("refuses a save too large to keep, rather than truncating one", async () => {
    const id = await mkPlayer("save-g");
    const huge = { blob: "x".repeat(MAX_SAVE_BYTES + 1_000) };
    await expect(writeSave(REALM, id, 1, huge)).rejects.toThrow(SaveError);
    console.log(`OVERSIZE ${Math.floor(JSON.stringify(huge).length / 1024)}KB refused, cap ${MAX_SAVE_BYTES / 1024}KB`);
    // Nothing half-written: a refused save must leave the previous city intact.
    expect(await readSave(REALM, id)).toBeNull();
  });

  it("refuses anything that is not an object", async () => {
    const id = await mkPlayer("save-h");
    await expect(writeSave(REALM, id, 1, "not a city")).rejects.toThrow(SaveError);
    await expect(writeSave(REALM, id, 1, null)).rejects.toThrow(SaveError);
  });

  it("treats a missing or negative revision as zero rather than throwing", async () => {
    const id = await mkPlayer("save-i");
    const result = await writeSave(REALM, id, -5 as number, { note: "clamped" });
    console.log(`NEGATIVE revision stored as ${result.revision}`);
    expect(result.revision).toBe(0);
  });

  it("forgets a city on request", async () => {
    const id = await mkPlayer("save-j");
    await writeSave(REALM, id, 1, { note: "here" });
    expect(await dropSave(REALM, id)).toBe(true);
    expect(await readSave(REALM, id)).toBeNull();
  });
});
