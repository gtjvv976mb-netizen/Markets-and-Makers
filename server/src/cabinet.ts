// The cabinet: the government of Mercedonia, deciding by judgement rather than by formula.
//
// The advisor in advisor.ts turns five strategic dials once a week. This is the other
// half of the government, and it runs daily: given the dials as they stand, what should
// the state actually DO today? Pay the wage bill in full, or hold some back to rebuild a
// thin treasury? Run the civic works flat out, or let stock draw down and pay people
// instead? Which works first when there is not enough for all four?
//
// Those are judgement calls. They were arithmetic before this file existed, and the
// arithmetic was defensible — but a government that cannot read a bad week and respond to
// it is a payroll script, not a government.
//
// WHAT THE MODEL CAN AND CANNOT DO
//
// It writes a DIRECTIVE. It never moves a coin. Every transfer in Mercedonia is still made
// by runGovernmentMind inside a transaction, under two limits written in code and not in
// any prompt:
//
//   * TREASURY_FLOOR  — the treasury may never be spent below it.
//   * PAYROLL_SHARE_CAP — one day's wages may never exceed this share of what is above it.
//
// The cabinet's factors are applied INSIDE those limits. wageFactor can hold wages back,
// or raise them toward the cap; it cannot breach the cap, and no value it returns can
// overdraw the floor. The worst a compromised or confused model can do is pay Mercedonians
// too little for a day, which the next day's directive can undo. It cannot drain the
// treasury, mint, or pay itself, because it is never handed the means to.
//
// FAILURE IS NEUTRAL, NOT FATAL
//
// No API key, a timeout, malformed output, a stance nobody recognises: all of these return
// NEUTRAL, whose factors are exactly 1.0 and whose ordering is the declared one. Running
// under NEUTRAL reproduces the original formula to the coin. A realm that has never had a
// model attached has a government that behaves precisely as it did before — which is what
// makes this safe to ship, and what the fallback test pins.

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { PoolClient } from "pg";
import { pool } from "./database.js";
import { CURRENCY_CODE, REALM_NAME } from "./catalogue.js";

const REALM = "sunwoven-1";
const MODEL = "claude-opus-5";

/** One directive per day. A government that changes its mind hourly has no policy. */
export const CABINET_INTERVAL_HOURS = 24;

/**
 * The bounds on judgement.
 *
 * wageFactor floors at 0.60 rather than 0: a government that can decide to pay nothing at
 * all is one bad directive away from a silent shutdown of every household's income, and
 * the whole demand side of the economy runs on those wages. It ceilings at 1.25 because
 * above the cap the number stops meaning anything — the cap binds first.
 *
 * worksFactor may reach 0. Halting the works for a day is a real and recoverable choice:
 * stock draws down, makers notice, the next directive restarts them.
 */
export const WAGE_FACTOR = { min: 0.6, max: 1.25 } as const;
export const WORKS_FACTOR = { min: 0, max: 1.5 } as const;

export interface Directive {
  stance: "expand" | "steady" | "restrain";
  wageFactor: number;
  worksFactor: number;
  priority: string[];
  reason: string;
  address: string;
  decidedAt: string | null;
}

/**
 * The directive of a realm with no cabinet: do exactly what the formula always did.
 *
 * Every factor is 1.0 and the ordering is empty, which minds.ts reads as "the declared
 * order". This is the fallback for every failure path, and it is also the honest default
 * for a realm nobody has attached a model to.
 */
export const NEUTRAL: Directive = {
  stance: "steady", wageFactor: 1, worksFactor: 1, priority: [],
  reason: "No cabinet directive; the standing formula applies.",
  address: "The Exchequer keeps to the standing rate.",
  decidedAt: null,
};

const DirectiveSchema = z.object({
  stance: z.enum(["expand", "steady", "restrain"]),
  wageFactor: z.number(),
  worksFactor: z.number(),
  priority: z.array(z.string()),
  reason: z.string(),
  address: z.string(),
});

export function cabinetAvailable(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

const clamp = (value: number, low: number, high: number): number =>
  Number.isFinite(value) ? Math.min(high, Math.max(low, value)) : 1;

/**
 * Force a directive inside the bounds, wherever it came from.
 *
 * Applied when the model answers AND again when the row is read back. The second pass is
 * the one that matters: a directive written last week under looser bounds must not still
 * be obeyed under tighter ones. Clamping only on the way in would make every historical
 * row a permanent exemption from the current rules.
 */
export function sanitise(raw: Partial<Directive>, known: string[]): Directive {
  const stance = raw.stance === "expand" || raw.stance === "restrain" ? raw.stance : "steady";
  const priority = Array.isArray(raw.priority)
    ? raw.priority.filter((key) => known.includes(key)).slice(0, known.length)
    : [];
  return {
    stance,
    wageFactor: clamp(Number(raw.wageFactor ?? 1), WAGE_FACTOR.min, WAGE_FACTOR.max),
    worksFactor: clamp(Number(raw.worksFactor ?? 1), WORKS_FACTOR.min, WORKS_FACTOR.max),
    priority: [...new Set(priority)],
    reason: String(raw.reason ?? NEUTRAL.reason).slice(0, 600),
    address: String(raw.address ?? NEUTRAL.address).slice(0, 240),
    decidedAt: raw.decidedAt ?? null,
  };
}

/**
 * The standing directive, or NEUTRAL.
 *
 * Takes an optional client so runGovernmentMind can read it inside the transaction that
 * spends against it, rather than racing a directive written between the read and the pay.
 */
export async function readDirective(client?: PoolClient, known: string[] = []): Promise<Directive> {
  const runner = client ?? pool;
  if (!runner) return NEUTRAL;
  const row = await runner.query<{
    stance: string; wage_factor: string; works_factor: string;
    priority: string[]; reason: string; address: string; decided_at: Date;
  }>(
    `select stance, wage_factor, works_factor, priority, reason, address, decided_at
       from cabinet_directive
      where realm_id = $1 and decided_at > now() - ($2 || ' hours')::interval
      order by decided_at desc limit 1`,
    [REALM, String(CABINET_INTERVAL_HOURS * 2)]);

  const found = row.rows[0];
  if (!found) return NEUTRAL;
  return sanitise({
    stance: found.stance as Directive["stance"],
    wageFactor: Number(found.wage_factor),
    worksFactor: Number(found.works_factor),
    priority: found.priority ?? [],
    reason: found.reason,
    address: found.address,
    decidedAt: found.decided_at.toISOString(),
  }, known);
}

async function hoursSinceLast(): Promise<number> {
  if (!pool) return Number.POSITIVE_INFINITY;
  const row = await pool.query<{ hours: string | null }>(
    `select extract(epoch from (now() - max(decided_at)))::float8 / 3600 as hours
       from cabinet_directive where realm_id = $1`, [REALM]);
  const hours = row.rows[0]?.hours;
  return hours === null || hours === undefined ? Number.POSITIVE_INFINITY : Number(hours);
}

export async function recentDirectives(limit = 14): Promise<Directive[]> {
  if (!pool) return [];
  const rows = await pool.query<{
    stance: string; wage_factor: string; works_factor: string;
    priority: string[]; reason: string; address: string; decided_at: Date;
  }>(
    `select stance, wage_factor, works_factor, priority, reason, address, decided_at
       from cabinet_directive where realm_id = $1
      order by decided_at desc limit $2`, [REALM, Math.min(60, Math.max(1, limit))]);
  return rows.rows.map((row) => sanitise({
    stance: row.stance as Directive["stance"],
    wageFactor: Number(row.wage_factor),
    worksFactor: Number(row.works_factor),
    priority: row.priority ?? [],
    reason: row.reason, address: row.address,
    decidedAt: row.decided_at.toISOString(),
  }, row.priority ?? []));
}

export interface CabinetBriefing {
  treasury: number;
  treasuryFloor: number;
  spendable: number;
  population: number;
  dailyWageBill: number;
  maximumPayableToday: number;
  citizensPurse: number;
  wagesPaidYesterday: number;
  soldYesterday: number;
  stock: { item: string; have: number; target: number; costPerUnit: number }[];
  recentTreasury: number[];
}

const SYSTEM = `You are the cabinet of ${REALM_NAME}, deciding what the state does today.
The currency is ${CURRENCY_CODE}.

You are not an adviser writing a recommendation. You are the government, and this directive
is executed. You decide three things and nothing else:

1. wageFactor — what share of today's wage bill to actually pay, between ${WAGE_FACTOR.min}
   and ${WAGE_FACTOR.max}. 1.0 pays the standing rate. You cannot exceed the payroll cap no
   matter what you return; you are choosing how far below it to sit.
2. worksFactor — how hard the civic works run today, between ${WORKS_FACTOR.min} and
   ${WORKS_FACTOR.max}. 1.0 is the standing rate. 0 halts them for the day.
3. priority — the order to fund the works in when the budget cannot cover them all.

You cannot move money, set the wage rate itself, or change any limit. The treasury floor
and the payroll cap are enforced in code and are not yours to argue with.

What you are governing toward, in order:
1. Mercedonians must be paid. Wages are the entire demand side of this economy: cut them
   and shops sell less, which taxes less, which funds fewer wages. Restraint is a tool for
   a genuinely thin treasury, not a habit.
2. The treasury must not trend toward its floor. Watch the direction across the days you
   are shown, not the size of today's number.
3. The works should keep makers supplied. A works that stays empty is makers who cannot
   produce, which shows up as falling sales two days later.

How to decide:
- Steady is the common and usually correct answer. Return 1.0 and 1.0 and say why the
  figures did not call for anything else.
- Restrain when the treasury is falling across several days, not because one day looked
  thin. Say which days.
- Expand when the treasury is comfortably above its floor and purses are falling — the
  money is more use in Mercedonian hands than sitting in the vault.
- Halting the works (0) is a real option on a thin day, but check the stock: halting a
  works already near empty pushes the cost onto makers tomorrow.

reason: two or three sentences, citing the actual movement you are responding to. Numbers,
not principles. "Treasury fell from 61k to 52k across four days while sales held" is a
reason; "prudent fiscal management" is not.

address: ONE sentence, published to players as the day's word from the Exchequer. Plain,
civic, and honest about the trade-off — Mercedonians can see the treasury themselves.`;

/**
 * Ask the model for a directive. No database, no storage, no side effect of any kind.
 *
 * Split out from convene so it can be run against a briefing and inspected without a
 * write. Probes must never touch live state, and the only way to honour that AND still
 * verify the prompt is to make the deliberation callable on its own. Returns null on any
 * failure, and every caller falls back rather than stopping.
 */
export async function deliberate(briefing: CabinetBriefing, known: string[]): Promise<Directive | null> {
  try {
    const client = new Anthropic();
    const response = await client.messages.parse({
      model: MODEL,
      max_tokens: 2048,
      system: SYSTEM,
      messages: [{
        role: "user",
        content: `Today's books:\n${JSON.stringify(briefing, null, 2)}\n\n`
          + `Works you may order, by name: ${known.join(", ")}`,
      }],
      output_config: { format: zodOutputFormat(DirectiveSchema) },
    });
    return response.parsed_output ? sanitise(response.parsed_output, known) : null;
  } catch (error) {
    // A cabinet that cannot be reached is not a crisis: yesterday's directive stands, and
    // if there is none, the formula does. Logged, not thrown.
    console.warn(`cabinet: ${(error as Error).message}`);
    return null;
  }
}

export type CabinetOutcome =
  | { status: "unavailable"; reason: string; directive: Directive }
  | { status: "too-soon"; hoursUntilNext: number; directive: Directive }
  | { status: "decided"; directive: Directive };

/**
 * Convene the cabinet.
 *
 * Never throws for the ordinary reasons. Every failure path returns a usable directive —
 * the standing one if there is a fresh one, NEUTRAL otherwise — so a caller can always
 * proceed to pay wages. A government that stops paying because a model timed out is worse
 * than a government with no model.
 */
export async function convene(briefing: CabinetBriefing, known: string[], force = false): Promise<CabinetOutcome> {
  if (!pool) return { status: "unavailable", reason: "no database", directive: NEUTRAL };
  if (!cabinetAvailable()) {
    return { status: "unavailable", reason: "no API key", directive: await readDirective(undefined, known) };
  }

  const since = await hoursSinceLast();
  if (!force && since < CABINET_INTERVAL_HOURS) {
    return {
      status: "too-soon",
      hoursUntilNext: Math.ceil(CABINET_INTERVAL_HOURS - since),
      directive: await readDirective(undefined, known),
    };
  }

  const directive = await deliberate(briefing, known);
  if (!directive) {
    return { status: "unavailable", reason: "no usable directive", directive: await readDirective(undefined, known) };
  }
  await pool.query(
    `insert into cabinet_directive
       (realm_id, stance, wage_factor, works_factor, priority, reason, address, model, snapshot)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [REALM, directive.stance, directive.wageFactor, directive.worksFactor,
     JSON.stringify(directive.priority), directive.reason, directive.address, MODEL,
     JSON.stringify(briefing)]);

  return { status: "decided", directive: { ...directive, decidedAt: new Date().toISOString() } };
}
