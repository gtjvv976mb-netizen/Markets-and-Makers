-- On-chain payouts: the road from claimed_units to a wallet.
--
-- A payout is a LIABILITY from the moment it is requested, not from the moment it lands.
-- Withdrawable is therefore derived from two truths that already exist —
--
--     sum(contribution_epoch.claimed_units)          what the player has earned
--   - sum(payout_request.units where state          what is already spoken for
--         in ('queued','submitted','confirmed'))
--
-- — and there is deliberately NO third balance column to reconcile against. A 'failed'
-- payout releases its hold by leaving that set; nothing is ever subtracted back.
--
-- States move one way: queued -> submitted -> confirmed | failed, and queued -> failed.
-- 'submitted' is the dangerous one. It means a signed transaction left this machine, and
-- until the chain answers definitively the worker may neither resubmit (double-pay) nor
-- fail it (the transfer may have landed). The worker re-checks by signature, never by
-- resending.

create table if not exists payout_request (
  id uuid primary key default gen_random_uuid(),
  realm_id text not null references realm(id),
  player_id uuid not null references player(id) on delete cascade,
  -- The session's signature-proven wallet, copied at request time. Never client-supplied.
  wallet_address text not null,
  -- Whole $MM, converted to raw units only at the chain boundary.
  units bigint not null check (units > 0),
  state text not null default 'queued' check (state in ('queued','submitted','confirmed','failed')),
  -- The transaction signature once one has been sent. UNIQUE: one signature, one payout.
  signature text unique,
  -- The blockhash's expiry, written beside the signature. A signature the chain has never
  -- seen is only PROVABLY dead once the chain's height passes this; before that,
  -- "not found" may just mean "not yet".
  last_valid_block_height bigint,
  error text,
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  confirmed_at timestamptz
);

-- One in-flight payout per player. Not a business nicety: withdrawable is checked at
-- request time, and two open requests racing the same balance is the double-spend.
create unique index if not exists payout_request_one_open_idx
  on payout_request (realm_id, player_id) where state in ('queued','submitted');

create index if not exists payout_request_worker_idx
  on payout_request (realm_id, state, created_at) where state in ('queued','submitted');

create index if not exists payout_request_player_idx
  on payout_request (realm_id, player_id, created_at desc);
