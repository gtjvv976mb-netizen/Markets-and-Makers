-- Standing charges, staff, and the service counter — the legs of the circuit the
-- authority never had.
--
-- The realm's design is a loop: the treasury pays wages and public works, that money
-- becomes the citizens' purse, the citizens spend it in players' shops, and the players
-- pay it back as rent, utilities and payroll. Only the first half was ever built here.
-- The browser had the return leg (state.ts settleStandingCharges) but it settled into
-- `state.governmentTreasury`, a NUMBER IN THE BROWSER — so on a server world the real
-- treasury paid out 18,000 MERCS a day and took nothing back, and the measured drain was
-- the whole design running at half a circuit.
--
-- These columns are what the authority needs to run the other half itself.

-- Mercedonians on this business's payroll. The browser keeps one global `staff` because
-- it models a single shop; the authority is per-plot, so it is stored per business and
-- the client sends it with the rest of the build.
alter table business
  add column if not exists staff int not null default 1 check (staff >= 0 and staff <= 64);

-- When the meter was last read. Charges accrue in whole days from here, and — exactly as
-- in the browser — this jumps to now() on every settle, so the capped remainder is waived
-- rather than being re-billed for ever as an instalment plan.
alter table business
  add column if not exists charges_settled_at timestamptz not null default now();

-- An unpaid bill cuts the supply. It never becomes a debt: a business that cannot pay
-- stops working until its owner settles, which is a setback with a door out of it rather
-- than a spiral that ends at a balance no repair can reach.
alter table business
  add column if not exists supplies_cut boolean not null default false;

-- The service counter's audience for the current UTC day. Service revenue decays past the
-- day's audience the same way goods prices do; without a per-day counter a thirteen-second
-- cycle would run all night and print money.
alter table business
  add column if not exists service_day date;
alter table business
  add column if not exists service_visits int not null default 0 check (service_visits >= 0);

-- Businesses that predate this migration have never been billed. Starting their meter at
-- now() rather than at their creation means the change bills nobody for the past.
--
-- This is a DATA statement, not DDL, so it is not self-idempotent the way the columns above
-- are: running it again would waive another day of everybody's charges. It is safe only
-- because migrate.ts records each file and never replays it. Do not add a data statement to
-- a migration without checking that is still true.
update business set charges_settled_at = now() where charges_settled_at < now() - interval '1 day';
