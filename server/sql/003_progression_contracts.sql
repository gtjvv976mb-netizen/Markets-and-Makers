alter table player add column if not exists experience bigint not null default 0 check (experience >= 0);
alter table player add column if not exists reputation bigint not null default 0 check (reputation >= 0);
alter table player add column if not exists contracts_completed bigint not null default 0 check (contracts_completed >= 0);

alter table business add column if not exists lifetime_revenue numeric(30,0) not null default 0 check (lifetime_revenue >= 0);
alter table business add column if not exists jobs_completed bigint not null default 0 check (jobs_completed >= 0);
alter table business add column if not exists visitors_served bigint not null default 0 check (visitors_served >= 0);
alter table business add column if not exists service_price_index numeric(8,4) not null default 1
  check (service_price_index between 0.5 and 2.0);
alter table business add column if not exists specialization text
  check (specialization in ('efficient','premium','community'));

create table if not exists trade_contract (
  id uuid primary key default gen_random_uuid(),
  realm_id text not null references realm(id),
  player_id uuid not null references player(id),
  buyer_type text not null check (buyer_type in ('government','citizens')),
  buyer_account_id uuid not null references currency_account(id),
  resource_key text not null,
  quantity bigint not null check (quantity > 0),
  unit_price numeric(30,0) not null check (unit_price > 0),
  gross_reward numeric(30,0) generated always as (quantity * unit_price) stored,
  reputation_reward integer not null default 1 check (reputation_reward between 0 and 100),
  experience_reward integer not null default 1 check (experience_reward between 0 and 10000),
  status text not null default 'accepted' check (status in ('accepted','fulfilled','released','expired')),
  accepted_at timestamptz not null default now(),
  expires_at timestamptz not null,
  settled_at timestamptz,
  command_id uuid unique,
  check (expires_at > accepted_at)
);

create unique index if not exists trade_contract_one_active_player_idx
  on trade_contract (realm_id, player_id)
  where status = 'accepted';
create index if not exists trade_contract_due_idx on trade_contract (expires_at) where status = 'accepted';

create table if not exists daily_enterprise_progress (
  realm_id text not null references realm(id),
  player_id uuid not null references player(id),
  civic_day date not null,
  production_jobs integer not null default 0 check (production_jobs >= 0),
  contracts_fulfilled integer not null default 0 check (contracts_fulfilled >= 0),
  trade_units integer not null default 0 check (trade_units >= 0),
  claimed_at timestamptz,
  claim_command_id uuid unique,
  primary key (realm_id, player_id, civic_day)
);

create table if not exists procurement_quota (
  realm_id text not null references realm(id),
  civic_day date not null,
  resource_key text not null,
  base_quantity bigint not null check (base_quantity >= 0),
  used_quantity bigint not null default 0 check (used_quantity >= 0 and used_quantity <= base_quantity),
  updated_at timestamptz not null default now(),
  primary key (realm_id, civic_day, resource_key)
);

create table if not exists economy_snapshot (
  realm_id text not null references realm(id),
  sampled_at timestamptz not null,
  money_supply numeric(30,0) not null check (money_supply >= 0),
  government_balance numeric(30,0) not null check (government_balance >= 0),
  citizen_balance numeric(30,0) not null check (citizen_balance >= 0),
  market_price_index numeric(12,4) not null check (market_price_index > 0),
  consumer_confidence numeric(12,4) not null check (consumer_confidence >= 0),
  wages_paid numeric(30,0) not null default 0 check (wages_paid >= 0),
  taxes_collected numeric(30,0) not null default 0 check (taxes_collected >= 0),
  government_procurement numeric(30,0) not null default 0 check (government_procurement >= 0),
  household_spending numeric(30,0) not null default 0 check (household_spending >= 0),
  primary key (realm_id, sampled_at)
);

create index if not exists economy_snapshot_recent_idx on economy_snapshot (realm_id, sampled_at desc);

comment on table trade_contract is 'Purposeful demand orders. Settlement must debit the named buyer account and credit the player/tax accounts in one transaction.';
comment on table daily_enterprise_progress is 'Verified activity only; the daily dividend is a government-budget transfer, never currency issuance.';
comment on table procurement_quota is 'Per-resource public demand ceiling that limits treasury drain and discourages repetitive extraction farming.';
comment on table economy_snapshot is 'Realm telemetry for faucet/sink, price, wage, tax, procurement, and household-demand monitoring.';
