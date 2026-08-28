-- Hardening found by an adversarial review of 014, before a coin ever moved.

-- 1. A payout's signatures are its audit trail. Requeuing used to null the signature,
--    which destroys the only record of a transaction that may STILL LAND — and a landed
--    transfer nobody can name is a payment nobody can reconcile. Every signature this row
--    has ever carried is kept, and the worker re-checks all of them before signing again.
alter table payout_request add column if not exists prior_signatures text[] not null default '{}';

-- 2. player_id was ON DELETE CASCADE. Deleting a player with an in-flight payout erased
--    the row holding its signature while the transfer was still live on-chain. A payout
--    must outlive the account: RESTRICT forces the operator to settle it first.
alter table payout_request drop constraint if exists payout_request_player_id_fkey;
alter table payout_request
  add constraint payout_request_player_id_fkey
  foreign key (player_id) references player(id) on delete restrict;

-- 3. Idempotency receipts were looked up by key alone, so a key colliding across players
--    (or across command types) replayed the WRONG response. The key stays the primary
--    key; the lookup is now additionally scoped, which this index serves.
create index if not exists command_receipt_scope_idx
  on command_receipt (idempotency_key, player_id, command_type);
