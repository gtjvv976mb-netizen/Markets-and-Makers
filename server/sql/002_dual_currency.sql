alter table currency_account add column if not exists currency_code text not null default 'MERCS';

alter table currency_account drop constraint if exists currency_account_realm_id_owner_type_owner_id_key;
create unique index if not exists currency_account_owner_currency_idx
  on currency_account (realm_id, owner_type, owner_id, currency_code);

alter table currency_ledger add column if not exists currency_code text not null default 'MERCS';

create table if not exists monetary_policy (
  realm_id text primary key references realm(id),
  transaction_currency text not null default 'MERCS' check (transaction_currency = 'MERCS'),
  reserve_asset text not null default 'MM' check (reserve_asset = 'MM'),
  mm_total_supply numeric(30,0) not null default 1000000000 check (mm_total_supply = 1000000000),
  reference_sunmarks_per_mm numeric(30,8) not null default 1 check (reference_sunmarks_per_mm > 0),
  exchange_fee_bps integer not null default 200 check (exchange_fee_bps between 0 and 1000),
  minimum_mm_reserve numeric(30,0) not null default 25000000 check (minimum_mm_reserve >= 0),
  updated_at timestamptz not null default now()
);

insert into monetary_policy (realm_id) values ('sunwoven-1') on conflict do nothing;

create table if not exists reserve_account (
  id uuid primary key default gen_random_uuid(),
  realm_id text not null references realm(id),
  owner_type text not null check (owner_type in ('government','player','escrow')),
  owner_id text not null,
  asset_code text not null default 'MM' check (asset_code = 'MM'),
  balance numeric(30,0) not null default 0 check (balance >= 0),
  unique (realm_id, owner_type, owner_id, asset_code)
);

insert into reserve_account (realm_id, owner_type, owner_id, balance)
values ('sunwoven-1', 'government', 'civic-vault', 50000000)
on conflict do nothing;

create table if not exists reserve_exchange (
  id uuid primary key default gen_random_uuid(),
  realm_id text not null references realm(id),
  command_id uuid not null unique,
  player_id uuid not null references player(id),
  direction text not null check (direction in ('MERCS_TO_MM','MM_TO_MERCS')),
  mm_amount numeric(30,0) not null check (mm_amount > 0),
  sunmark_principal numeric(30,0) not null check (sunmark_principal > 0),
  sunmark_fee numeric(30,0) not null check (sunmark_fee >= 0),
  reference_rate numeric(30,8) not null check (reference_rate > 0),
  chain_status text not null default 'INTERNAL_ONLY' check (chain_status in ('INTERNAL_ONLY','QUEUED','SETTLED','REJECTED')),
  created_at timestamptz not null default now(),
  settled_at timestamptz
);

create index if not exists reserve_exchange_player_created_idx on reserve_exchange (player_id, created_at desc);
