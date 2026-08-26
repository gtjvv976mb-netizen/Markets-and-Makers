-- The two minds that keep the district alive: the government's, and the Mercedonians'.
--
-- Both need a clock of their own. The business tick is per-business and per-plot; these
-- run once for the whole realm, so they cannot borrow business.last_tick_at.

create table if not exists realm_clock (
  realm_id text not null references realm(id),
  mind text not null,
  last_run_at timestamptz not null default now(),
  primary key (realm_id, mind)
);

insert into realm_clock (realm_id, mind) values
  ('sunwoven-1', 'government'),
  ('sunwoven-1', 'citizens')
on conflict do nothing;

-- The treasury is where tax lands and where wages are paid from. It opens with a float
-- so the first week of wages does not depend on tax that has not been collected yet;
-- after that the circuit is meant to sustain itself: businesses pay tax and buy from the
-- civic supplier, the treasury pays Mercedonians, and the Mercedonians buy from
-- businesses. Nothing in either mind creates a Merc Dollar — every move is between two
-- accounts that already exist, and the balance check on the column is the backstop.
insert into currency_account (realm_id, owner_type, owner_id, currency_code, balance)
values ('sunwoven-1', 'government', 'treasury', 'MERCS', 8000000)
on conflict (realm_id, owner_type, owner_id, currency_code) do nothing;
