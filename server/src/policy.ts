// The dials, and the bounds they cannot leave.
//
// Nothing in this file involves a language model. It is the deterministic layer between
// an advisor's suggestion and the economy's behaviour, and it exists so that the worst a
// bad suggestion can do is nudge a number a little way inside a range a human chose.
//
// The clamps live in code, not in the database. That is deliberate: a bound stored beside
// the value it bounds is a bound that whatever writes the value can widen. These ranges
// can only change by someone editing this file and deploying it.

import { pool } from "./database.js";

export interface Dial {
  key: string;
  /** What it does, in the words the advisor will read. */
  meaning: string;
  fallback: number;
  min: number;
  max: number;
  /** The most it may move in one proposal, as a share of the current value. */
  maxStep: number;
}

/**
 * Every dial the government may turn.
 *
 * Chosen because each one is a genuine economic lever with a defensible range, and
 * because none of them can empty an account on its own: the payroll cap and the treasury
 * floor in minds.ts still gate every payment regardless of what these say.
 */
export const DIALS: Record<string, Dial> = {
  civicDailyWage: {
    key: "civicDailyWage",
    meaning: "Merc Dollars paid to each household per day for civic work. The source of all household demand.",
    fallback: 9, min: 3, max: 30, maxStep: 0.25,
  },
  payrollShareCap: {
    key: "payrollShareCap",
    meaning: "Ceiling on one payroll run, as a share of spendable treasury. Guards against paying out the reserve in a single pass.",
    fallback: 0.05, min: 0.01, max: 0.15, maxStep: 0.3,
  },
  spendRate: {
    key: "spendRate",
    meaning: "Share of their purse households are willing to spend. Lower means a bigger buffer and softer demand.",
    fallback: 0.82, min: 0.4, max: 0.95, maxStep: 0.15,
  },
  waterTarget: {
    key: "waterTarget",
    meaning: "Units of water the civic supplier aims to keep in stock for makers to buy.",
    fallback: 40_000, min: 5_000, max: 200_000, maxStep: 0.5,
  },
  powerTarget: {
    key: "powerTarget",
    meaning: "Units of power the civic supplier aims to keep in stock.",
    fallback: 40_000, min: 5_000, max: 200_000, maxStep: 0.5,
  },
};

export type PolicyValues = Record<string, number>;

/** Clamp to the dial's range. Unknown keys are refused rather than passed through. */
export function clampDial(key: string, value: number): number | null {
  const dial = DIALS[key];
  if (!dial || !Number.isFinite(value)) return null;
  return Math.min(dial.max, Math.max(dial.min, value));
}

/** The furthest a single proposal may move a dial from where it stands. */
export function stepLimit(key: string, current: number): { low: number; high: number } | null {
  const dial = DIALS[key];
  if (!dial) return null;
  const span = Math.abs(current) * dial.maxStep;
  return {
    low: Math.max(dial.min, current - span),
    high: Math.min(dial.max, current + span),
  };
}

/**
 * The dials as they currently stand.
 *
 * A stored value outside the code's range is ignored in favour of the clamp, not obeyed —
 * so a bad row, a bad migration or a bad actor cannot push the economy somewhere the code
 * does not allow.
 */
export async function readPolicy(realmId: string): Promise<PolicyValues> {
  const values: PolicyValues = {};
  for (const dial of Object.values(DIALS)) values[dial.key] = dial.fallback;
  if (!pool) return values;

  const rows = await pool.query<{ key: string; value: string }>(
    "select key, value from policy where realm_id = $1", [realmId]);
  for (const row of rows.rows) {
    const clamped = clampDial(row.key, Number(row.value));
    if (clamped !== null) values[row.key] = clamped;
  }
  return values;
}

export async function writePolicy(realmId: string, key: string, value: number): Promise<number | null> {
  const clamped = clampDial(key, value);
  if (clamped === null || !pool) return null;
  await pool.query(
    `insert into policy (realm_id, key, value, updated_at) values ($1,$2,$3, now())
     on conflict (realm_id, key) do update set value = excluded.value, updated_at = now()`,
    [realmId, key, clamped]);
  return clamped;
}

/** Put every dial back to the value shipped in the code. The kill switch. */
export async function resetPolicy(realmId: string): Promise<void> {
  if (!pool) return;
  await pool.query("delete from policy where realm_id = $1", [realmId]);
}
