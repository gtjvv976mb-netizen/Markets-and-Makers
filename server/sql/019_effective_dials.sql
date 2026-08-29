-- The cabinet's dials, as actually applied after velocity smoothing.
--
-- The LLM cabinet's wageFactor/worksFactor are level-clamped but were applied raw, so two
-- sittings could whipsaw the citizens' purse 1.25 -> 0.6 -> 1.25. The government tick now
-- smooths 80/20 toward each new directive and persists the effective values here.
alter table realm_clock add column if not exists wage_effective double precision;
alter table realm_clock add column if not exists works_effective double precision;
