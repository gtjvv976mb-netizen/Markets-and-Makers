// The Mercedonia Dispatch — the government's voice.
//
// This is the one place in the server where a language model is allowed to speak, and it
// is deliberately the one place where it cannot do any harm: it reads numbers this server
// already measured and writes a paragraph about them. It settles nothing, moves nothing,
// and decides nothing. If it is switched off, or the API is unreachable, or the key is
// missing, the district carries on exactly as before and the only thing missing is the
// morning paper.
//
// That boundary is the whole design. The deterministic minds in minds.ts run the economy
// because a loop that moves real money has to be replayable and provable. This runs once
// a day, costs a few dollars a month, and does the thing the sim cannot: tells you what
// just happened in a sentence you actually want to read.
//
// Everything it is told is stored with what it wrote. A summary and an invention look
// identical on the page; the only way to tell them apart later is to have kept the
// evidence the writer was working from.

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { pool } from "./database.js";
import { CURRENCY_CODE, REALM_NAME, CITIZEN_NAME } from "./catalogue.js";

const REALM = "sunwoven-1";
const MODEL = "claude-opus-5";

/** How long a district must go unreported before the next dispatch is written. */
const DISPATCH_INTERVAL_HOURS = 20;

const DispatchSchema = z.object({
  headline: z.string(),
  body: z.string(),
  mood: z.enum(["thriving", "steady", "strained", "austere"]),
});

export interface EconomySnapshot {
  businesses: number;
  districts: string[];
  treasury: number;
  citizensPurse: number;
  makersHolding: number;
  /** Payroll and works together: the whole civic injection into household purses. */
  wagesPaidToday: number;
  /** The wage proper. Split out because the two are not interchangeable — a payroll of
   *  77 beside works of 28,000 reads as a healthy day only while they are added up. */
  payrollToday: number;
  worksSpendToday: number;
  worksOutput: Record<string, number>;
  soldToday: number;
  grossToday: number;
  busiestTrade: string | null;
  quietestShelf: string | null;
}

export interface Dispatch {
  headline: string;
  body: string;
  mood: string;
  publishedAt: string;
  snapshot: EconomySnapshot;
}

/** Numbers only, measured from the ledger. Nothing here is a judgement. */
export async function readEconomy(): Promise<EconomySnapshot> {
  const empty: EconomySnapshot = {
    businesses: 0, districts: [], treasury: 0, citizensPurse: 0, makersHolding: 0,
    wagesPaidToday: 0, payrollToday: 0, worksSpendToday: 0,
    worksOutput: {}, soldToday: 0, grossToday: 0,
    busiestTrade: null, quietestShelf: null,
  };
  if (!pool) return empty;

  const [counts, money, wages, trade, shelves] = await Promise.all([
    pool.query<{ n: string; districts: string[] }>(
      `select count(*)::text as n, coalesce(array_agg(distinct p.island_id), '{}') as districts
         from business b join plot p on p.id = b.plot_id where p.realm_id = $1`, [REALM]),
    pool.query<{ owner_type: string; owner_id: string; balance: string }>(
      `select owner_type, owner_id, balance from currency_account where realm_id = $1`, [REALM]),
    pool.query<{ reason: string; total: string }>(
      `select reason, coalesce(sum(amount),0)::text as total from currency_ledger
        where realm_id = $1 and created_at > now() - interval '24 hours'
        group by reason`, [REALM]),
    pool.query<{ item_key: string; units: string }>(
      `select item_key, coalesce(sum(units),0)::text as units from demand_day
        where realm_id = $1 and day = current_date
        group by item_key order by 2 desc`, [REALM]),
    pool.query<{ item_key: string; quantity: string }>(
      `select item_key, quantity from item_balance
        where realm_id=$1 and owner_type='government' and owner_id='supply'
        order by quantity asc limit 1`, [REALM]),
  ]);

  const snapshot: EconomySnapshot = { ...empty };
  snapshot.businesses = Number(counts.rows[0]?.n ?? 0);
  snapshot.districts = counts.rows[0]?.districts ?? [];

  for (const row of money.rows) {
    const balance = Number(row.balance);
    if (row.owner_type === "government" && row.owner_id === "treasury") snapshot.treasury = balance;
    else if (row.owner_id === "citizens") snapshot.citizensPurse = balance;
    else if (row.owner_type === "player") snapshot.makersHolding += balance;
  }

  for (const row of wages.rows) {
    if (row.reason === "government.payroll") {
      snapshot.payrollToday += Number(row.total);
      snapshot.wagesPaidToday += Number(row.total);
    }
    if (row.reason === "government.works") {
      snapshot.worksSpendToday += Number(row.total);
      snapshot.wagesPaidToday += Number(row.total);
    }
    if (row.reason === "tick.counter") snapshot.grossToday += Number(row.total);
  }

  let busiest = 0;
  for (const row of trade.rows) {
    const units = Number(row.units);
    snapshot.soldToday += units;
    if (units > busiest) { busiest = units; snapshot.busiestTrade = row.item_key; }
  }
  snapshot.quietestShelf = shelves.rows[0]?.item_key ?? null;
  return snapshot;
}

/** Hours since the last dispatch, or Infinity if there has never been one. */
async function hoursSinceLast(): Promise<number> {
  if (!pool) return 0;
  const row = await pool.query<{ hours: string | null }>(
    `select extract(epoch from (now() - max(published_at)))::float8 / 3600 as hours
       from bulletin where realm_id = $1`, [REALM]);
  const hours = row.rows[0]?.hours;
  return hours === null || hours === undefined ? Number.POSITIVE_INFINITY : Number(hours);
}

export function dispatchAvailable(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

const SYSTEM = `You write the Mercedonia Dispatch, the daily civic bulletin of ${REALM_NAME},
a solarpunk city whose citizens are called ${CITIZEN_NAME} and whose currency is ${CURRENCY_CODE}.

You are given the day's measured figures from the city ledger. Report them.

Rules, in order of importance:
- Never state a number that is not in the figures you were given, and never round one into
  something more dramatic than it is.
- Never invent an event, a person, a shortage, a festival or a decision. If the figures are
  dull, the bulletin is dull. A quiet day reported honestly is worth more than an exciting
  day invented.
- If a figure is zero or absent, that is itself the news — an empty treasury or a street
  with no shops is worth saying plainly.
- Write as a city clerk would: plain, specific, faintly warm. No marketing language, no
  exclamation marks, no addressing the reader as "citizens!".
- Two or three sentences. The headline is at most eight words and is not a pun.`;

/**
 * Write the day's dispatch.
 *
 * Returns null rather than throwing when it cannot or should not run — no key, no
 * database, or the last one was recent enough. The caller treats a missing bulletin as
 * unremarkable, because it is.
 */
export async function writeDispatch(force = false): Promise<Dispatch | null> {
  if (!pool || !dispatchAvailable()) return null;
  if (!force && (await hoursSinceLast()) < DISPATCH_INTERVAL_HOURS) return null;

  const snapshot = await readEconomy();
  const client = new Anthropic();

  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 1024,
    system: SYSTEM,
    messages: [{
      role: "user",
      content: `Today's figures from the ledger:\n\n${JSON.stringify(snapshot, null, 2)}`,
    }],
    output_config: { format: zodOutputFormat(DispatchSchema) },
  });

  const written = response.parsed_output;
  if (!written) return null;

  await pool.query(
    `insert into bulletin (realm_id, headline, body, mood, snapshot, model, input_tokens, output_tokens)
     values ($1,$2,$3,$4,$5::jsonb,$6,$7,$8)`,
    [REALM, written.headline, written.body, written.mood, JSON.stringify(snapshot), MODEL,
     response.usage.input_tokens, response.usage.output_tokens]);
  await pool.query(
    "update realm_clock set last_run_at = now() where realm_id = $1 and mind = 'dispatch'", [REALM]);

  return { ...written, publishedAt: new Date().toISOString(), snapshot };
}

/** The dispatches as published, newest first. Reading them needs no key and no model. */
export async function recentDispatches(limit = 7): Promise<Dispatch[]> {
  if (!pool) return [];
  const rows = await pool.query<{
    headline: string; body: string; mood: string; published_at: Date; snapshot: EconomySnapshot;
  }>(
    `select headline, body, mood, published_at, snapshot from bulletin
      where realm_id = $1 order by published_at desc limit $2`,
    [REALM, Math.min(30, Math.max(1, limit))]);
  return rows.rows.map((row) => ({
    headline: row.headline, body: row.body, mood: row.mood,
    publishedAt: row.published_at.toISOString(), snapshot: row.snapshot,
  }));
}
