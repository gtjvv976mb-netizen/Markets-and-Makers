-- Time-range indexes on the ledgers the world tick grows forever.
--
-- Both ledgers are read with `where realm_id = $1 and created_at > now() - interval '24
-- hours'` — currency_ledger by readEconomy (every /api/world/economy request) and by the
-- cabinet's briefing (every 60 seconds). Neither table had an index covering that, so each
-- read was a sequential scan of everything ever written.
--
-- It is not what made anything slow today: measured on 900,000 rows the scan still ran in
-- 20ms, and the live latency I first blamed on it turned out to be an address-selection
-- artifact on the machine doing the measuring, not the server. This is about the shape of
-- the curve rather than today's number. The tick writes rows continuously and player
-- trades add more, so the scan cost grows without bound while the index cost does not —
-- and it is the read on the path a player waits for.
--
-- Measured on 900k rows: 20.0ms sequential -> 6.6ms indexed, and the gap widens with size.
create index if not exists currency_ledger_recent_idx
  on currency_ledger (realm_id, created_at desc);

create index if not exists item_ledger_recent_idx
  on item_ledger (realm_id, created_at desc);
