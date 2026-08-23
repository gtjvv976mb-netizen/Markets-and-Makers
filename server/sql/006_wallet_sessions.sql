-- Wallet-bound sessions.
--
-- Until now every economic route trusted the playerId in the request body, which is why
-- the market has shipped disabled. A session is proof that whoever is calling controls
-- the private key for a Solana address; the server derives the player from that, and the
-- client never gets to assert who it is.

create table if not exists auth_challenge (
  nonce text primary key,
  wallet_address text not null,
  issued_at timestamptz not null default now(),
  consumed_at timestamptz
);

create index if not exists auth_challenge_sweep_idx on auth_challenge (issued_at);

create table if not exists auth_session (
  token_hash text primary key,
  player_id uuid not null references player(id) on delete cascade,
  wallet_address text not null,
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);

create index if not exists auth_session_player_idx on auth_session (player_id) where revoked_at is null;

-- One wallet is one player. The column existed from day one and nothing ever wrote to it.
create unique index if not exists player_wallet_unique on player (wallet_address) where wallet_address is not null;
