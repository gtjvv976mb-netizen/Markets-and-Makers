-- The procurement stabilizer: government purchases run on a daily budget.
--
-- Payroll has always been formula-bound (PAYROLL_SHARE_CAP of spendable, above a floor);
-- procurement was the one treasury outflow with no formula at all — every government-buyer
-- sale paid from the treasury unconditionally, so the drain rate was set by player activity
-- alone. An eight-week, thirty-player circulation simulation measured it linear: ~2k a day,
-- indifferent to the treasury's health. This table carries the day's spend so the sale path
-- can hold the line inside its own transaction.
create table if not exists procurement_day (
  realm_id text not null,
  day text not null,
  spent bigint not null default 0,
  primary key (realm_id, day)
);
