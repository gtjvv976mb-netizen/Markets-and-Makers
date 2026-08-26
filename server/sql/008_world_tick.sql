-- The world tick: production and counter trade, run by the authority rather than by
-- whichever browser happens to be open.
--
-- last_tick_at is what makes the loop safe to run on any schedule and safe to restart.
-- Elapsed time is measured from it, so a tick that runs twice in a second settles almost
-- nothing the second time rather than paying twice, and a server that was down for an
-- hour catches the hour up on its next pass instead of losing it.

alter table business
  add column if not exists last_tick_at timestamptz not null default now();

-- A business that has never ticked should not be handed the whole history of the realm
-- on its first pass, so new rows start from now.
create index if not exists business_last_tick_idx on business (last_tick_at);

-- Citizens need somewhere for their money to come from, and it must be finite: an
-- account that can go negative is an account that mints. The column's own
-- `balance >= 0` check is the backstop — the database refuses an overdraft even if
-- every layer above it has a bug.
--
-- owner_type 'player' with owner_id 'citizens' is not a typo: it is the account
-- settlement.ts already pays household sales out of, and using a second one would
-- split the district's money across two pots that neither side knows about.
-- The unique index is (realm_id, owner_type, owner_id, currency_code) — currency_code
-- arrived in a later migration than the table — so the conflict target must name it.
insert into currency_account (realm_id, owner_type, owner_id, currency_code, balance)
values ('sunwoven-1', 'player', 'citizens', 'MERCS', 2000000)
on conflict (realm_id, owner_type, owner_id, currency_code) do nothing;
