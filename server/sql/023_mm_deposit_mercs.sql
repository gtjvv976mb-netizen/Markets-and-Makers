-- Deposits that were converted to MERCS on arrival.
--
-- The owner asked for one press: send $MM, receive spending money. The first attempt did
-- the conversion in the browser, which destroyed it — a signed-in player spends from the
-- authority's currency_account, and a client-side credit lands in a local balance the
-- authority never sees. So the conversion moves here, into the same transaction that
-- records the deposit.
--
-- `mercs` is what was issued for this signature. Zero means the units are still $MM: the
-- credit could not be made (a thin treasury) or this row predates the column. Reading
-- "how much $MM does this player still hold" therefore means summing units WHERE mercs = 0,
-- which is what keeps the two balances from double-counting the same tokens.
alter table mm_deposit add column if not exists mercs bigint not null default 0;

comment on column mm_deposit.mercs is
  'MERCS issued for this deposit on arrival. 0 = still held as $MM.';
