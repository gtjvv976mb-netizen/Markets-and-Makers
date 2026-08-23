-- Shared price and demand state.
--
-- Until now marketPressure, the daily demand budget and the procurement ledger lived in
-- each player's own browser save, so two players in the same district did not affect each
-- other's prices at all. That is a single-player simulation wearing an MMO coat. These
-- tables make the district the unit of economic truth instead of the player.

create table if not exists market_pressure (
  realm_id text not null references realm(id),
  island_id text not null,
  item_key text not null,
  pressure numeric(6,4) not null default 1 check (pressure >= 0.5 and pressure <= 2.0),
  updated_at timestamptz not null default now(),
  primary key (realm_id, island_id, item_key)
);

-- How much of a good a district has already absorbed today, across every player in it.
create table if not exists demand_day (
  realm_id text not null references realm(id),
  island_id text not null,
  item_key text not null,
  day date not null,
  units bigint not null default 0 check (units >= 0),
  primary key (realm_id, island_id, item_key, day)
);

create index if not exists demand_day_recent_idx on demand_day (day desc);

-- Contribution is per player per epoch; the cohort is the sum of everyone else's.
create table if not exists contribution_epoch (
  realm_id text not null references realm(id),
  epoch_id bigint not null,
  player_id uuid not null references player(id) on delete cascade,
  contribution numeric(24,4) not null default 0 check (contribution >= 0),
  claimed_units bigint not null default 0 check (claimed_units >= 0),
  claimed_at timestamptz,
  primary key (realm_id, epoch_id, player_id)
);

create index if not exists contribution_epoch_totals_idx on contribution_epoch (realm_id, epoch_id);

-- Emission needs a source, not just a balance. Every fee and tax routes a share here.
create table if not exists reserve_funding (
  id uuid primary key default gen_random_uuid(),
  realm_id text not null references realm(id),
  epoch_id bigint not null,
  amount numeric(20,0) not null check (amount > 0),
  source text not null,
  created_at timestamptz not null default now()
);

create index if not exists reserve_funding_epoch_idx on reserve_funding (realm_id, epoch_id);
