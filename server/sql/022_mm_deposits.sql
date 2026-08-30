-- $MM brought IN from a player's own wallet.
--
-- The game's rule has been "$MM is earned, never bought": it could be claimed from the
-- epoch and withdrawn to a wallet, and there was no way back in. The owner asked for the
-- return leg — real pump.fun $MM sent to the treasury, credited in game — so this is where
-- those deposits are recorded.
--
-- The SIGNATURE is the primary key and that is the whole anti-double-credit design. A
-- Solana transaction signature is unique and final; crediting keyed on it means a replayed
-- confirm, a double-clicked button or a retried request all resolve to the same row and
-- the same single credit. There is no amount in the request a client could inflate: the
-- amount is read from the chain.
create table if not exists mm_deposit (
  signature text primary key,
  realm_id text not null,
  player_id uuid not null references player(id),
  -- Whole $MM, as read from the confirmed transfer instruction.
  units bigint not null check (units > 0),
  -- The wallet the tokens actually came from, so a deposit can be traced back.
  from_wallet text not null,
  credited_at timestamptz not null default now()
);

create index if not exists mm_deposit_player_idx on mm_deposit (realm_id, player_id);
