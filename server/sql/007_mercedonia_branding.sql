update realm set name = 'Mercedonia' where id = 'sunwoven-1';

alter table currency_account alter column currency_code set default 'MERCS';

-- Merge any historical operating-currency account into an already-created MERCS
-- account for the same owner before changing the remaining codes. This keeps every
-- balance and ledger reference intact if branding and application deploys overlapped.
create temporary table if not exists mercedonia_currency_merge (
  old_id uuid primary key,
  new_id uuid not null
) on commit drop;
truncate mercedonia_currency_merge;
insert into mercedonia_currency_merge (old_id, new_id)
select historical.id, canonical.id
from currency_account historical
join currency_account canonical
  on canonical.realm_id = historical.realm_id
 and canonical.owner_type = historical.owner_type
 and canonical.owner_id = historical.owner_id
 and canonical.currency_code = 'MERCS'
where historical.currency_code = 'SUNMARK';

alter table currency_ledger drop constraint if exists currency_ledger_command_id_debit_account_credit_account_key;

update currency_account canonical
set balance = canonical.balance + historical.balance
from mercedonia_currency_merge mapping
join currency_account historical on historical.id = mapping.old_id
where canonical.id = mapping.new_id;

update currency_ledger ledger
set debit_account = mapping.new_id
from mercedonia_currency_merge mapping
where ledger.debit_account = mapping.old_id;

update currency_ledger ledger
set credit_account = mapping.new_id
from mercedonia_currency_merge mapping
where ledger.credit_account = mapping.old_id;

delete from currency_account historical
using mercedonia_currency_merge mapping
where historical.id = mapping.old_id;

update currency_account set currency_code = 'MERCS' where currency_code = 'SUNMARK';

delete from currency_ledger duplicate
using currency_ledger retained
where duplicate.id > retained.id
  and duplicate.command_id = retained.command_id
  and duplicate.debit_account = retained.debit_account
  and duplicate.credit_account = retained.credit_account;

alter table currency_ledger add constraint currency_ledger_command_id_debit_account_credit_account_key
  unique (command_id, debit_account, credit_account);

alter table currency_ledger alter column currency_code set default 'MERCS';
update currency_ledger set currency_code = 'MERCS' where currency_code = 'SUNMARK';

alter table monetary_policy drop constraint if exists monetary_policy_transaction_currency_check;
alter table monetary_policy alter column transaction_currency set default 'MERCS';
update monetary_policy set transaction_currency = 'MERCS' where transaction_currency = 'SUNMARK';
alter table monetary_policy add constraint monetary_policy_transaction_currency_check
  check (transaction_currency = 'MERCS');

alter table reserve_exchange drop constraint if exists reserve_exchange_direction_check;
update reserve_exchange
set direction = case direction
  when 'SUNMARK_TO_MM' then 'MERCS_TO_MM'
  when 'MM_TO_SUNMARK' then 'MM_TO_MERCS'
  else direction
end;
alter table reserve_exchange add constraint reserve_exchange_direction_check
  check (direction in ('MERCS_TO_MM','MM_TO_MERCS'));

-- Rename historical schema vocabulary without losing data. The guards make this safe
-- because the deployment runner intentionally reapplies every migration.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = current_schema() and table_name = 'monetary_policy'
      and column_name = 'reference_sunmarks_per_mm'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = current_schema() and table_name = 'monetary_policy'
      and column_name = 'reference_mercs_per_mm'
  ) then
    alter table monetary_policy rename column reference_sunmarks_per_mm to reference_mercs_per_mm;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = current_schema() and table_name = 'reserve_exchange'
      and column_name = 'sunmark_principal'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = current_schema() and table_name = 'reserve_exchange'
      and column_name = 'merc_principal'
  ) then
    alter table reserve_exchange rename column sunmark_principal to merc_principal;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = current_schema() and table_name = 'reserve_exchange'
      and column_name = 'sunmark_fee'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = current_schema() and table_name = 'reserve_exchange'
      and column_name = 'merc_fee'
  ) then
    alter table reserve_exchange rename column sunmark_fee to merc_fee;
  end if;
end $$;
