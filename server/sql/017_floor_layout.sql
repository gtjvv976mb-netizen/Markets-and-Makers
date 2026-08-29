-- The equipment floor, as the owner arranged it.
--
-- The authority computed production from upgrade levels alone, so every fitting effect and
-- every layout decision was offline-only in the synced path: a maker could arrange a floor,
-- watch the browser tell them it was worth more, and be paid as though it were bare.
--
-- Stored raw — tiles, facings and fitting positions — never the multipliers. The client
-- proposes a LAYOUT and the authority derives what it is worth with its own copy of the rule
-- (server/src/floor.ts, pinned against the browser's by shared/floor-fixtures.json). Sending
-- the multipliers instead would be handing the client a number that turns into money.
alter table business
  add column if not exists floor jsonb not null default '{}'::jsonb;

comment on column business.floor is
  'Raw equipment layout: {tiles,facings,fittings}. Multipliers are derived server-side, never accepted from a client.';
