/**
 * Somebody watching the treasury.
 *
 * Nothing did. The realm's whole economy is a circuit that runs itself — the cabinet
 * decides, the minds pay wages, the tick trades — and the one number that says whether any
 * of it is working, the treasury balance, was discovered by a human deciding to look at it.
 * A slow drain is exactly the failure that hides: it never errors, never 500s, and the
 * health check stays green all the way down.
 *
 * Two ways out of the black box, both cheap:
 *
 *  - a REPORT the /health endpoint carries, so an ordinary uptime monitor watching that URL
 *    can alarm on the realm's solvency without anything else being built; and
 *  - a LOG LINE at each severity change, so the transition is in the record with the numbers
 *    that caused it rather than being reconstructed afterwards.
 *
 * The runway is measured against real observed drain, not a guess: the balance is sampled
 * each pass and compared against the oldest sample still inside the window.
 */
import { pool } from "./database.js";
import { TREASURY_FLOOR } from "./minds.js";

/** How far back the drain is measured. Long enough that one busy hour is not a trend. */
const WINDOW_MS = 6 * 3_600_000;
/** Below this many days of runway the realm is in trouble and somebody should know. */
export const RUNWAY_CRITICAL_DAYS = 30;
export const RUNWAY_WARNING_DAYS = 120;

export type TreasuryHealth = "ok" | "watch" | "critical" | "unknown";

export interface TreasuryReport {
  status: TreasuryHealth;
  balance: number;
  floor: number;
  /** MERCS per day, positive when the vault is EMPTYING. */
  drainPerDay: number | null;
  runwayDays: number | null;
  sampledOver: string;
}

interface Sample { at: number; balance: number }
const samples: Sample[] = [];
let lastStatus: TreasuryHealth | null = null;

/** Reset, for tests. */
export function forgetTreasurySamples(): void {
  samples.length = 0;
  lastStatus = null;
}

export async function treasuryReport(now = Date.now()): Promise<TreasuryReport> {
  const unknown: TreasuryReport = {
    status: "unknown", balance: 0, floor: TREASURY_FLOOR,
    drainPerDay: null, runwayDays: null, sampledOver: "no samples yet",
  };
  if (!pool) return unknown;

  const row = await pool.query<{ balance: string }>(
    `select balance from currency_account
      where realm_id='sunwoven-1' and owner_type='government' and owner_id='treasury'
        and currency_code='MERCS'`);
  if (!row.rowCount) return unknown;
  const balance = Number(row.rows[0]!.balance);

  samples.push({ at: now, balance });
  while (samples.length > 1 && now - samples[0]!.at > WINDOW_MS) samples.shift();

  const oldest = samples[0]!;
  const elapsed = now - oldest.at;
  // One sample is not a trend, and neither is a few seconds of them.
  if (samples.length < 2 || elapsed < 600_000) {
    return { ...unknown, status: "unknown", balance, sampledOver: `${Math.round(elapsed / 1000)}s` };
  }

  const drainPerDay = ((oldest.balance - balance) / elapsed) * 86_400_000;
  const spendable = Math.max(0, balance - TREASURY_FLOOR);
  // Filling or holding steady is not a runway problem.
  const runwayDays = drainPerDay > 0 ? spendable / drainPerDay : null;

  const status: TreasuryHealth = runwayDays === null ? "ok"
    : runwayDays < RUNWAY_CRITICAL_DAYS ? "critical"
    : runwayDays < RUNWAY_WARNING_DAYS ? "watch"
    : "ok";

  // Log the TRANSITION, not every pass: a line a minute is a line nobody reads.
  if (status !== lastStatus) {
    const detail = `balance ${Math.round(balance)}, floor ${TREASURY_FLOOR}, `
      + `drain ${Math.round(drainPerDay)}/day, runway ${runwayDays === null ? "none" : Math.round(runwayDays) + "d"}`;
    if (status === "critical") console.error(`treasury CRITICAL: ${detail}`);
    else if (status === "watch") console.warn(`treasury watch: ${detail}`);
    else console.log(`treasury recovered: ${detail}`);
    lastStatus = status;
  }

  return {
    status, balance, floor: TREASURY_FLOOR,
    drainPerDay: Math.round(drainPerDay),
    runwayDays: runwayDays === null ? null : Math.round(runwayDays),
    sampledOver: `${Math.round(elapsed / 60_000)}m`,
  };
}
