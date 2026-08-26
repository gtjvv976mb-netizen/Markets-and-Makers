-- Economic policy: the dials the government is allowed to turn.
--
-- These were constants in minds.ts. They move here so an advisor can propose changes to
-- them and so every change has a row explaining itself. The constants remain in the code
-- as defaults and — importantly — as the CLAMPS. A value in this table that falls outside
-- the range the code allows is ignored, not obeyed: the bounds must not be editable by
-- the thing being bounded.

create table if not exists policy (
  realm_id text not null references realm(id),
  key text not null,
  value numeric(20,6) not null,
  updated_at timestamptz not null default now(),
  primary key (realm_id, key)
);

-- Every proposal, applied or not, with the reasoning and what it replaced. An advisor
-- that cannot be audited is an advisor that cannot be trusted with a dial.
create table if not exists policy_proposal (
  id uuid primary key default gen_random_uuid(),
  realm_id text not null references realm(id),
  proposed_at timestamptz not null default now(),
  key text not null,
  previous_value numeric(20,6) not null,
  proposed_value numeric(20,6) not null,
  applied_value numeric(20,6),
  status text not null check (status in ('applied','clamped','rejected','unknown-key')),
  rationale text not null,
  model text not null,
  snapshot jsonb not null
);

create index if not exists policy_proposal_recent_idx on policy_proposal (realm_id, proposed_at desc);

insert into realm_clock (realm_id, mind) values ('sunwoven-1', 'advisor')
on conflict do nothing;
