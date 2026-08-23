# Production architecture boundary

The current build proves the game loop locally. It is deliberately not presented as an MMO server or real-token economy.

## Current vertical slice

```text
Browser
├── Three.js world and official GLB assets
├── local authoritative game store
├── timestamp production jobs
└── versioned localStorage save
```

This is sufficient for design testing, creator updates, economy tuning, and validating the first 8–12 minute session.

## Required authoritative MMO shape

```text
Browser client
├── HTTPS/CDN: immutable island and published-plot snapshots
├── HTTPS API: account, catalog, business history
└── secure WebSocket: input intent and nearby dynamic state
          │
     Island zone process
     {realm, island, population layer}
          │
     Modular game backend
     plots / inventory / production / market / tax
          │
     PostgreSQL source of truth
```

One persistent realm should share a single economy and plot namespace, but each island should run as a disposable authoritative zone. Ferry travel is the natural handoff/loading boundary. Busy islands may add population layers; every layer must reference the same plots and business state so land and goods are never duplicated.

## Authority rules

- Clients send intent only: walk, lease, place, buy, start, collect, sell, upgrade, travel.
- The server owns currency, inventory, plot rights, job timestamps, prices, taxes, settlement, and player position limits.
- Every economic command needs an idempotency key and one atomic database transaction.
- Currency uses a double-entry ledger; inventory uses an append-only item ledger plus verified balances.
- Production resolves from server timestamps and scheduled jobs, not per-frame machine simulation.
- Static player-built plots are published as content-hashed snapshots over a CDN; realtime state contains only nearby movement and dynamic overlays.
- Redis may cache routing/presence, but can never be the source of truth for money, land, inventory, or jobs.

## Economy command boundary

The v1.0 contract, progression, and procurement rules are represented by `server/sql/003_progression_contracts.sql`. A production command handler must perform each of the following in one PostgreSQL transaction:

1. lock the relevant player, buyer currency account, inventory balance, contract/job, and quota row;
2. reject a reused idempotency key by returning the stored `command_receipt`;
3. verify ownership, expiry, quantity, treasury/household funds, and the server clock;
4. append balanced currency and item ledger entries and update cached balances;
5. update career, daily activity, contract/job state, quota usage, and the outbox/audit event;
6. commit before broadcasting the resulting state revision.

The browser implementation mirrors these rules behind a local `GameStore` so the gameplay can be tested now, but it is not a security boundary. No real-value settlement may use local storage, client timestamps, or client-calculated prices.

## Suggested implementation stages

1. **Network proof:** one island, 16–32 concurrent users, WebSocket movement, authoritative checkout, reconnect and restart tests.
2. **Persistent vertical slice:** PostgreSQL, plot revisions/edit locks, audit logs, offline job completion, 50-bot soak test.
3. **Archipelago alpha:** one room/process per island, safe ferry handoff, shared market, 250-bot realm test.
4. **Closed beta:** population layers at roughly 100 soft/150 hard players per island layer, friends/company affinity, restore drills.
5. **Launch:** add realms instead of one giant server; measure and extract services only after profiling proves a bottleneck.

## Token boundary

If `$MM` later becomes transferable, chain settlement should be asynchronous and limited to explicitly eligible balances after anti-fraud review. Gameplay jobs, utilities, prices, land leases, consumables, and server clocks should remain off-chain. Treasury and citizen spending require daily/weekly caps, transparent reports, circuit breakers, and a reserve policy that remains solvent under worst-case player behavior.

See `PLAY_AND_EARN_ECONOMY.md` for the player-facing value loop, anti-inflation rules, telemetry, and launch guardrails.
