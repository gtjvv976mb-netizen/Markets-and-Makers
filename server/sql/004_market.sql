-- Player-to-player order book with real escrow.
--
-- The rule that matters: a listing HOLDS its goods. Listing moves quantity out of the
-- seller's balance into an escrow owner keyed by the listing id; cancelling returns it;
-- a purchase transfers it permanently. A listing that merely *references* seller
-- inventory is how sold rows get resurrected and how ghost quantities appear.

create table if not exists market_listing (
  id uuid primary key default gen_random_uuid(),
  realm_id text not null references realm(id),
  island_id text not null,
  seller_player_id uuid not null references player(id),
  item_key text not null,
  quantity bigint not null check (quantity > 0),
  unit_price numeric(20,0) not null check (unit_price > 0),
  status text not null default 'open' check (status in ('open','filled','cancelled')),
  buyer_player_id uuid references player(id),
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  -- A settled listing must record who settled it, and an open one must not.
  constraint market_listing_settlement check (
    (status = 'open'   and settled_at is null and buyer_player_id is null) or
    (status = 'filled' and settled_at is not null and buyer_player_id is not null) or
    (status = 'cancelled' and settled_at is not null and buyer_player_id is null)
  )
);

create index if not exists market_listing_book_idx
  on market_listing (realm_id, island_id, item_key, unit_price, created_at)
  where status = 'open';

create index if not exists market_listing_seller_idx
  on market_listing (seller_player_id) where status = 'open';

-- Escrow is a first-class item owner, so goods in flight are always somewhere.
alter table item_balance drop constraint if exists item_balance_owner_type_check;
alter table item_balance add constraint item_balance_owner_type_check
  check (owner_type in ('player','business','government','escrow'));
