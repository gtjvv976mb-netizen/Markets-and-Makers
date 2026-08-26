// The policy advisor: a language model with its hands on five dials and nothing else.
//
// This is the second and last place a model is allowed to influence Mercedonia, and the
// influence is deliberately narrow. It cannot move money, settle a trade, or write to any
// ledger. It reads the realm's economic history and proposes new values for the dials in
// policy.ts. Everything it proposes passes through a clamp and a step limit written in
// code before it reaches the economy, and every proposal — applied, clamped or refused —
// leaves a row explaining itself.
//
// It also refuses to speak too early. An advisor pointed at a realm with three days of
// history and no trade will produce fluent, confident, entirely baseless advice, because
// that is what a language model does when asked to reason about nothing. REQUIRED_HISTORY
// is the guard: below it, the advisor declines and says so, which is the honest answer to
// "what should we change?" when the answer is "you do not know yet".

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { pool } from "./database.js";
import { CURRENCY_CODE, REALM_NAME } from "./catalogue.js";
import { DIALS, clampDial, readPolicy, stepLimit, writePolicy } from "./policy.js";

const REALM = "sunwoven-1";
const MODEL = "claude-opus-5";

/** Distinct days of recorded economic history before the advisor will offer an opinion. */
export const REQUIRED_HISTORY = 5;
/** How long between consultations. Policy that changes hourly is not policy. */
const ADVISOR_INTERVAL_HOURS = 24 * 7;
/** No more than this many dials in one sitting; sweeping changes cannot be attributed. */
const MAX_CHANGES = 2;

const ProposalSchema = z.object({
  assessment: z.string(),
  changes: z.array(z.object({
    key: z.string(),
    value: z.number(),
    reason: z.string(),
  })),
});

export interface HistoryDay {
  day: string;
  treasury: number;
  citizensPurse: number;
  makersHolding: number;
  businesses: number;
  soldToday: number;
  wagesPaidToday: number;
}

export type AdvisorOutcome =
  | { status: "unavailable"; reason: string }
  | { status: "too-early"; daysOfHistory: number; required: number }
  | { status: "too-soon"; hoursUntilNext: number }
  | { status: "advised"; assessment: string; applied: AppliedChange[] };

export interface AppliedChange {
  key: string;
  previous: number;
  proposed: number;
  applied: number | null;
  status: "applied" | "clamped" | "rejected" | "unknown-key";
  reason: string;
}

/**
 * The realm's economic history, one row per day.
 *
 * Read from the Dispatch's stored snapshots, which is exactly what they were kept for:
 * a measured record of what the district looked like on a given day, written down at the
 * time and never edited.
 */
export async function readHistory(days = 30): Promise<HistoryDay[]> {
  if (!pool) return [];
  const rows = await pool.query<{
    day: string; snapshot: Record<string, number>;
  }>(
    `select distinct on (published_at::date)
            published_at::date::text as day, snapshot
       from bulletin where realm_id = $1
      order by published_at::date desc, published_at desc
      limit $2`,
    [REALM, Math.min(90, Math.max(1, days))]);

  return rows.rows.map((row) => ({
    day: row.day,
    treasury: Number(row.snapshot.treasury ?? 0),
    citizensPurse: Number(row.snapshot.citizensPurse ?? 0),
    makersHolding: Number(row.snapshot.makersHolding ?? 0),
    businesses: Number(row.snapshot.businesses ?? 0),
    soldToday: Number(row.snapshot.soldToday ?? 0),
    wagesPaidToday: Number(row.snapshot.wagesPaidToday ?? 0),
  })).reverse();
}

async function hoursSinceLast(): Promise<number> {
  if (!pool) return Number.POSITIVE_INFINITY;
  const row = await pool.query<{ hours: string | null }>(
    `select extract(epoch from (now() - max(proposed_at)))::float8 / 3600 as hours
       from policy_proposal where realm_id = $1`, [REALM]);
  const hours = row.rows[0]?.hours;
  return hours === null || hours === undefined ? Number.POSITIVE_INFINITY : Number(hours);
}

export function advisorAvailable(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

const SYSTEM = `You advise the treasury of ${REALM_NAME} on economic policy. The currency is ${CURRENCY_CODE}.

You are shown the realm's recorded history, one row per day, and the current value of every
dial you may turn. You propose new values. You do not execute anything: each proposal is
clamped to a range and a maximum step written in code, and may be rejected outright.

What you are trying to achieve, in order:
1. Households must be able to afford what makers produce. If purses are falling while
   goods go unsold, demand is starved and wages are the lever.
2. The treasury must not trend to zero. It funds every wage; a treasury in decline is a
   countdown, however healthy the week looks.
3. Makers should be able to buy inputs. If the civic supplier keeps running dry, its
   targets are too low.

Rules:
- Propose at most ${MAX_CHANGES} changes. Fewer is better. Zero is a valid and often
  correct answer — say so plainly when the figures do not justify a change.
- Every change needs a reason that cites a movement in the history you were shown, not a
  general principle. "Treasury fell 12% across five days while sales held" is a reason.
  "Stimulating growth" is not.
- Never propose a key that is not in the dial list.
- Change one thing at a time when you can. Two dials moved at once cannot be told apart
  next week.
- The assessment is three sentences at most: what the figures show, and what you did or
  did not do about it.`;

/**
 * Consult the advisor.
 *
 * Never throws for the ordinary reasons — no key, not enough history, too soon since the
 * last consultation. Those are outcomes, and the caller reports them rather than treating
 * them as failures.
 */
export async function consultAdvisor(force = false): Promise<AdvisorOutcome> {
  if (!pool) return { status: "unavailable", reason: "no database" };

  // History is checked before credentials on purpose. "This realm has not run long enough
  // to have an opinion about" is true whether or not there is an API key, and putting the
  // key first would make the guard unreachable — and untestable — without one.
  const history = await readHistory();
  if (history.length < REQUIRED_HISTORY) {
    // The guard that matters. Asked to reason about a realm it has barely seen, a model
    // will still answer — fluently, confidently, and from nothing.
    return { status: "too-early", daysOfHistory: history.length, required: REQUIRED_HISTORY };
  }

  if (!advisorAvailable()) return { status: "unavailable", reason: "no API key" };

  const since = await hoursSinceLast();
  if (!force && since < ADVISOR_INTERVAL_HOURS) {
    return { status: "too-soon", hoursUntilNext: Math.ceil(ADVISOR_INTERVAL_HOURS - since) };
  }

  const current = await readPolicy(REALM);
  const dials = Object.values(DIALS).map((dial) => {
    const now = current[dial.key] ?? dial.fallback;
    const step = stepLimit(dial.key, now)!;
    return {
      key: dial.key, meaning: dial.meaning, current: now,
      allowedRange: [dial.min, dial.max],
      allowedThisWeek: [Number(step.low.toFixed(4)), Number(step.high.toFixed(4))],
    };
  });

  const client = new Anthropic();
  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 2048,
    system: SYSTEM,
    messages: [{
      role: "user",
      content: `Recorded history, oldest first:\n${JSON.stringify(history, null, 2)}\n\n`
        + `Dials you may turn:\n${JSON.stringify(dials, null, 2)}`,
    }],
    output_config: { format: zodOutputFormat(ProposalSchema) },
  });

  const advice = response.parsed_output;
  if (!advice) return { status: "unavailable", reason: "no usable proposal" };

  const snapshot = JSON.stringify({ history: history.slice(-7), dials });
  const applied: AppliedChange[] = [];

  for (const change of advice.changes.slice(0, MAX_CHANGES)) {
    const dial = DIALS[change.key];
    const previous = current[change.key] ?? dial?.fallback ?? 0;

    if (!dial) {
      applied.push({ key: change.key, previous, proposed: change.value, applied: null,
        status: "unknown-key", reason: change.reason });
      continue;
    }

    // Two gates, in order: how far it may move this week, then the absolute range.
    const step = stepLimit(change.key, previous)!;
    const stepped = Math.min(step.high, Math.max(step.low, change.value));
    const settled = clampDial(change.key, stepped);
    const status = settled === null ? "rejected"
      : Math.abs(settled - change.value) > 1e-9 ? "clamped" : "applied";

    if (settled !== null) await writePolicy(REALM, change.key, settled);
    applied.push({ key: change.key, previous, proposed: change.value, applied: settled, status, reason: change.reason });
  }

  for (const record of applied) {
    await pool.query(
      `insert into policy_proposal
         (realm_id, key, previous_value, proposed_value, applied_value, status, rationale, model, snapshot)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
      [REALM, record.key, record.previous, record.proposed, record.applied,
       record.status, record.reason, MODEL, snapshot]);
  }

  await pool.query(
    "update realm_clock set last_run_at = now() where realm_id = $1 and mind = 'advisor'", [REALM]);

  return { status: "advised", assessment: advice.assessment, applied };
}

/** The paper trail, newest first. */
export async function recentProposals(limit = 20): Promise<Array<{
  proposedAt: string; key: string; previous: number; proposed: number;
  applied: number | null; status: string; rationale: string;
}>> {
  if (!pool) return [];
  const rows = await pool.query<{
    proposed_at: Date; key: string; previous_value: string; proposed_value: string;
    applied_value: string | null; status: string; rationale: string;
  }>(
    `select proposed_at, key, previous_value, proposed_value, applied_value, status, rationale
       from policy_proposal where realm_id = $1 order by proposed_at desc limit $2`,
    [REALM, Math.min(100, Math.max(1, limit))]);
  return rows.rows.map((row) => ({
    proposedAt: row.proposed_at.toISOString(),
    key: row.key,
    previous: Number(row.previous_value),
    proposed: Number(row.proposed_value),
    applied: row.applied_value === null ? null : Number(row.applied_value),
    status: row.status,
    rationale: row.rationale,
  }));
}
