-- The city, kept by the authority instead of by one browser.
--
-- A player's whole city lived in localStorage and nowhere else. The boot screen said so
-- out loud — "clearing your site data, switching browsers, or using a different device
-- will lose your city" — which is the single largest thing standing between this game and
-- a player who comes back. Worse, the key was not scoped to a wallet, so two wallets used
-- in one browser shared one city and signing out left the previous player's save sitting
-- there for the next one.
--
-- WHAT THIS IS NOT: it is not where money lives. The purse, the inventory that backs a
-- market listing, the business registry and everything the tick settles are the
-- authority's own rows and stay that way — a client that edits its save can change what
-- its city LOOKS like, never what it is owed. Do not move a balance into this column.
create table if not exists player_save (
  realm_id text not null,
  player_id uuid not null references player(id),
  -- Monotonic per player. The client counts its own writes and sends the count; the
  -- authority keeps the highest it has seen, so a stale tab cannot overwrite a newer
  -- session by being the last one to close.
  revision bigint not null default 0,
  payload jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (realm_id, player_id)
);

create index if not exists player_save_updated_idx on player_save (realm_id, updated_at desc);
