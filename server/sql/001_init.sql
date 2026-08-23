create extension if not exists pgcrypto;

create table if not exists realm (
  id text primary key,
  name text not null,
  created_at timestamptz not null default now()
);

insert into realm (id, name) values ('sunwoven-1', 'The Sunwoven Reach') on conflict do nothing;

create table if not exists player (
  id uuid primary key default gen_random_uuid(),
  wallet_address text unique,
  display_name text not null default 'Maker',
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table if not exists character_state (
  player_id uuid primary key references player(id) on delete cascade,
  realm_id text not null references realm(id),
  island_id text not null default 'hearth',
  x double precision not null default 0,
  z double precision not null default 34,
  session_epoch bigint not null default 0,
  revision bigint not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists currency_account (
  id uuid primary key default gen_random_uuid(),
  realm_id text not null references realm(id),
  owner_type text not null check (owner_type in ('player','government','citizens','escrow')),
  owner_id text not null,
  balance numeric(30,0) not null default 0 check (balance >= 0),
  unique (realm_id, owner_type, owner_id)
);

create table if not exists currency_ledger (
  id uuid primary key default gen_random_uuid(),
  realm_id text not null references realm(id),
  command_id uuid not null,
  debit_account uuid not null references currency_account(id),
  credit_account uuid not null references currency_account(id),
  amount numeric(30,0) not null check (amount > 0),
  reason text not null,
  created_at timestamptz not null default now(),
  unique (command_id, debit_account, credit_account)
);

create table if not exists item_balance (
  realm_id text not null references realm(id),
  owner_type text not null check (owner_type in ('player','business','government','escrow')),
  owner_id text not null,
  item_key text not null,
  quantity bigint not null default 0 check (quantity >= 0),
  primary key (realm_id, owner_type, owner_id, item_key)
);

create table if not exists item_ledger (
  id uuid primary key default gen_random_uuid(),
  command_id uuid not null,
  realm_id text not null references realm(id),
  item_key text not null,
  quantity bigint not null check (quantity > 0),
  from_owner_type text not null,
  from_owner_id text not null,
  to_owner_type text not null,
  to_owner_id text not null,
  reason text not null,
  created_at timestamptz not null default now()
);

create table if not exists plot (
  id text primary key,
  realm_id text not null references realm(id),
  island_id text not null,
  owner_player_id uuid references player(id),
  lease_until timestamptz,
  license text,
  layout_revision bigint not null default 0,
  layout jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists business (
  id uuid primary key default gen_random_uuid(),
  plot_id text not null unique references plot(id),
  owner_player_id uuid not null references player(id),
  license text not null,
  condition smallint not null default 100 check (condition between 0 and 100),
  upgrades jsonb not null default '{"yield":0,"capacity":0,"speed":0,"appeal":0}'::jsonb,
  revision bigint not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists production_job (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references business(id),
  recipe_key text not null,
  cycles smallint not null check (cycles between 1 and 4),
  status text not null check (status in ('running','ready','collected','cancelled')),
  started_at timestamptz not null,
  complete_at timestamptz not null,
  collected_at timestamptz
);

create index if not exists production_job_due_idx on production_job (complete_at) where status = 'running';

create table if not exists command_receipt (
  idempotency_key uuid primary key,
  player_id uuid references player(id),
  command_type text not null,
  response jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists helius_event (
  signature text primary key,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  reviewed_at timestamptz
);
