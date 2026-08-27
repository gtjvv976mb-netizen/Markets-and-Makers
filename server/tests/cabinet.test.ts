// What a language model with the government's chequebook can and cannot do.
//
// Every test here is an attack on the same question: given a directive written by
// something that can be wrong, confused, or actively hostile, can the treasury be drained,
// the floor crossed, or Mercedonians left unpaid? The answers must be no, no, and no —
// and they must hold for values no honest cabinet would ever return.
//
// settlePayroll and sanitise are exported and called BY the government mind, not
// reimplemented here. A test that models the rule instead of running it will happily agree
// with its own copy while the real one drifts.

import { describe, expect, it } from "vitest";
import { settlePayroll } from "../src/minds.js";
import { NEUTRAL, sanitise, WAGE_FACTOR, WORKS_FACTOR } from "../src/cabinet.js";

const KNOWN = ["water", "power", "ore", "timber"];

describe("the neutral directive is the old formula", () => {
  // The whole safety case rests on this: a realm with no cabinet, no API key, or a failed
  // call must behave EXACTLY as it did before this feature existed. If NEUTRAL is not the
  // identity, then shipping the cabinet silently changed every realm that never asked for
  // one.
  it("pays precisely what the pre-cabinet rule paid", () => {
    for (const [bill, spendable, cap] of [[1000, 50_000, 0.05], [9000, 12_000, 0.05], [500, 0, 0.05]]) {
      const before = Math.max(0, Math.min(bill!, Math.floor(spendable! * cap!)));
      const after = settlePayroll(bill!, spendable!, cap!, NEUTRAL.wageFactor).paid;
      expect(after, `bill ${bill}, spendable ${spendable}`).toBe(before);
    }
  });

  it("has a wage factor of exactly 1", () => {
    expect(NEUTRAL.wageFactor).toBe(1);
    expect(NEUTRAL.worksFactor).toBe(1);
  });
});

describe("the payroll cap binds whatever the cabinet asks for", () => {
  it("cannot be breached by the largest factor the bounds allow", () => {
    const spendable = 100_000, cap = 0.05;
    const ceiling = Math.floor(spendable * cap);           // 5,000
    const paid = settlePayroll(80_000, spendable, cap, WAGE_FACTOR.max).paid;
    expect(paid, `paid ${paid} against ceiling ${ceiling}`).toBe(ceiling);
  });

  it("cannot be breached by a factor that should never have reached the row", () => {
    // A directive written before the bounds tightened, or a row edited by hand. The cap is
    // applied AFTER the factor precisely so that neither can matter.
    const spendable = 100_000, cap = 0.05;
    const ceiling = Math.floor(spendable * cap);
    for (const hostile of [10, 1_000, 1e9, Number.MAX_SAFE_INTEGER]) {
      const paid = settlePayroll(80_000, spendable, cap, hostile).paid;
      expect(paid, `factor ${hostile} paid ${paid}`).toBe(ceiling);
    }
  });

  it("survives values that are not numbers at all", () => {
    for (const junk of [Number.NaN, Number.POSITIVE_INFINITY, -5]) {
      const { paid } = settlePayroll(1000, 100_000, 0.05, junk);
      expect(Number.isFinite(paid), `factor ${junk} paid ${paid}`).toBe(true);
      expect(paid).toBeGreaterThanOrEqual(0);
      expect(paid).toBeLessThanOrEqual(5000);
    }
  });
});

describe("the treasury floor cannot be crossed", () => {
  it("pays nothing when the treasury is at or below its floor", () => {
    // spendable is treasury-less-floor, so at the floor it is 0 and stays 0. No directive
    // has a factor that multiplies zero into something.
    for (const factor of [WAGE_FACTOR.min, 1, WAGE_FACTOR.max, 1e9]) {
      expect(settlePayroll(50_000, 0, 0.05, factor).paid, `factor ${factor}`).toBe(0);
    }
  });

  it("never pays more than the spendable surplus across a wide sweep", () => {
    // The property, stated directly and checked over the whole plausible space rather than
    // at three hand-picked points.
    let worst = 0;
    for (let treasury = 50_000; treasury <= 400_000; treasury += 7_500) {
      for (const factor of [0, 0.6, 1, 1.25, 50]) {
        for (const bill of [0, 500, 5_000, 250_000]) {
          const spendable = Math.max(0, treasury - 50_000);
          const { paid } = settlePayroll(bill, spendable, 0.05, factor);
          expect(paid).toBeLessThanOrEqual(spendable);
          worst = Math.max(worst, paid - Math.floor(spendable * 0.05));
        }
      }
    }
    expect(worst, "most any directive ever exceeded the cap by").toBe(0);
  });
});

describe("austerity and restraint are different facts", () => {
  it("calls it austerity only when the state could not pay", () => {
    const thin = settlePayroll(9_000, 20_000, 0.05, 1);   // ceiling 1,000 < bill
    expect(thin.austerity).toBe(true);
    expect(thin.restraint).toBe(false);
  });

  it("calls it restraint when the state chose not to", () => {
    const chosen = settlePayroll(1_000, 500_000, 0.05, 0.6);  // ceiling 22,500 >> bill
    expect(chosen.paid).toBe(600);
    expect(chosen.restraint, "a cabinet underpaying a healthy treasury").toBe(true);
    expect(chosen.austerity, "must not be hidden as austerity").toBe(false);
  });

  it("reports neither when the bill is paid in full", () => {
    const fine = settlePayroll(1_000, 500_000, 0.05, 1);
    expect(fine.paid).toBe(1_000);
    expect(fine.austerity).toBe(false);
    expect(fine.restraint).toBe(false);
  });
});

describe("sanitise is the gate on everything a model returns", () => {
  it("clamps factors into their bounds", () => {
    const wild = sanitise({ wageFactor: 99, worksFactor: -40, stance: "expand", reason: "x", address: "y" }, KNOWN);
    expect(wild.wageFactor).toBe(WAGE_FACTOR.max);
    expect(wild.worksFactor).toBe(WORKS_FACTOR.min);
  });

  it("drops works nobody has ever heard of", () => {
    const forged = sanitise({ priority: ["water", "treasury", "../../etc/passwd", "power"] }, KNOWN);
    expect(forged.priority).toEqual(["water", "power"]);
  });

  it("de-duplicates a priority list that names one works four times", () => {
    expect(sanitise({ priority: ["ore", "ore", "ore", "ore"] }, KNOWN).priority).toEqual(["ore"]);
  });

  it("falls back to steady for a stance it does not recognise", () => {
    expect(sanitise({ stance: "seize" as never }, KNOWN).stance).toBe("steady");
  });

  it("survives an entirely empty object", () => {
    const empty = sanitise({}, KNOWN);
    expect(empty.wageFactor).toBe(1);
    expect(empty.worksFactor).toBe(1);
    expect(empty.stance).toBe("steady");
    expect(empty.priority).toEqual([]);
  });

  it("truncates a model trying to write an essay into the ledger", () => {
    const flood = sanitise({ reason: "a".repeat(50_000), address: "b".repeat(50_000) }, KNOWN);
    expect(flood.reason.length).toBeLessThanOrEqual(600);
    expect(flood.address.length).toBeLessThanOrEqual(240);
  });

  it("re-clamps on the way out, not only on the way in", () => {
    // The row-written-under-looser-bounds case. sanitise is applied when reading a stored
    // directive as well as when writing one, so an old row cannot be a standing exemption.
    const stored = { stance: "expand" as const, wageFactor: 5, worksFactor: 9, priority: KNOWN, reason: "r", address: "a" };
    expect(sanitise(stored, KNOWN).wageFactor).toBe(WAGE_FACTOR.max);
  });
});

describe("the cabinet cannot starve Mercedonia", () => {
  it("has a wage floor above zero", () => {
    // The lower bound is not decoration. Wages are the entire demand side: a directive of
    // 0 would stop every household's income, and shops would report it as a demand
    // collapse two days later with nothing in the logs to explain it.
    expect(WAGE_FACTOR.min).toBeGreaterThan(0);
    const worst = settlePayroll(10_000, 1_000_000, 0.05, WAGE_FACTOR.min).paid;
    expect(worst, "the least a cabinet can pay on a healthy treasury").toBe(6_000);
  });
});
