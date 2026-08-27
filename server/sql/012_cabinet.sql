-- The cabinet: the government's daily operational decision, made by a language model.
--
-- The advisor (011) turns strategic dials once a week. This is the other half: what the
-- government actually DOES today, within those dials. Where the advisor sets the wage
-- rate, the cabinet decides whether this is a day to pay it in full.
--
-- The row stores a DIRECTIVE, never money. Every coin is still moved by runGovernmentMind
-- under the treasury floor and the payroll cap, both of which live in code. A directive is
-- an instruction the code may refuse; the factors below are clamped on the way in AND on
-- the way out, because a row written before a clamp changed must not escape the new one.
--
-- A realm with no directive — no API key, a failed call, a model that returned nonsense —
-- runs the original formula untouched. That is the neutral directive: every factor 1.0.

create table if not exists cabinet_directive (
  id uuid primary key default gen_random_uuid(),
  realm_id text not null references realm(id),
  decided_at timestamptz not null default now(),
  -- The posture, for players to read. Advisory only: the factors below do the work.
  stance text not null check (stance in ('expand','steady','restrain')),
  -- Scales the day's wage bill. Still capped by payroll_share_cap and the treasury floor.
  wage_factor numeric(6,4) not null,
  -- Scales how fast the civic works close their stock gap. 0 halts them for the day.
  works_factor numeric(6,4) not null,
  -- Ordering of state industries when the budget cannot fund them all. Names only.
  priority jsonb not null default '[]'::jsonb,
  -- Why. Audited, and shown on the Treasury desk beside what it actually cost.
  reason text not null,
  -- One line, published to players as the day's word from the Exchequer.
  address text not null,
  model text not null,
  snapshot jsonb not null
);

create index if not exists cabinet_directive_recent_idx
  on cabinet_directive (realm_id, decided_at desc);

insert into realm_clock (realm_id, mind) values ('sunwoven-1', 'cabinet')
on conflict do nothing;
