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
import { settlePayroll, wageBillFor } from "../src/minds.js";
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

describe("the wage clock carries what the floor cannot pay", () => {
  // The bug the cabinet found by citing it. At a 60s tick the bill floors to zero and the
  // clock advanced anyway, so the wage was destroyed rather than owed. Measured live: 77
  // Mercs paid across 24 hours against an intended 1,134.
  const POP = 126, WAGE = 9, TICK_HOURS = 60 / 3600, DAY = 1440;

  it("still floors a single tick's bill to nothing", () => {
    expect(wageBillFor(POP, WAGE, TICK_HOURS).bill).toBe(0);
  });

  it("owes the fraction rather than forgiving it", () => {
    const { bill, carry } = wageBillFor(POP, WAGE, TICK_HOURS);
    expect(bill).toBe(0);
    expect(carry).toBeCloseTo(0.7875, 4);
  });

  it("paid nothing across a whole day when the fraction was discarded", () => {
    // The old rule, run forward: no carry, so every tick starts from zero and stays there.
    let paid = 0;
    for (let tick = 0; tick < DAY; tick += 1) paid += wageBillFor(POP, WAGE, TICK_HOURS).bill;
    expect(paid, "a full day of ticks under the old rule").toBe(0);
  });

  it("pays the intended daily wage to the Merc once the carry rides along", () => {
    let carry = 0, paid = 0;
    for (let tick = 0; tick < DAY; tick += 1) {
      const settled = wageBillFor(POP, WAGE, TICK_HOURS, carry);
      paid += settled.bill;
      carry = settled.carry;
    }
    // paid + still-owed == intended, exactly. Asserting `paid === intended` on a day
    // boundary would be asserting that the last fraction happens to land inside the
    // window, which is a fact about where I stopped counting, not about the payroll.
    const intended = POP * WAGE;
    expect(paid + carry, `paid ${paid} plus ${carry.toFixed(4)} owed`).toBeCloseTo(intended, 6);
    expect(paid, "and essentially all of it has actually been paid").toBeGreaterThanOrEqual(intended - 1);
  });

  it("settles the same wage whatever the tick length", () => {
    // The property that makes the tick interval a scheduling choice again, not an
    // economic one. Any cadence must deliver the same day's wage.
    const totals = [15, 60, 300, 900].map((secs) => {
      const ticks = Math.round(86_400 / secs);
      let carry = 0, paid = 0;
      for (let tick = 0; tick < ticks; tick += 1) {
        const settled = wageBillFor(POP, WAGE, secs / 3600, carry);
        paid += settled.bill;
        carry = settled.carry;
      }
      return { secs, paid, carry };
    });
    for (const { secs, paid, carry } of totals) {
      expect(paid + carry, `at a ${secs}s tick`).toBeCloseTo(POP * WAGE, 6);
      expect(paid, `at a ${secs}s tick`).toBeGreaterThanOrEqual(POP * WAGE - 1);
    }
  });

  it("never runs the carry away when the treasury cannot pay", () => {
    // Austerity must not become a debt that pays out later in a lump. The carry tracks the
    // BILL; what the cap refused is refused, not deferred.
    let carry = 0;
    for (let tick = 0; tick < DAY; tick += 1) carry = wageBillFor(POP, WAGE, TICK_HOURS, carry).carry;
    expect(carry, "the carry after a full day").toBeLessThan(1);
  });
});
