# Markets & Makers — play-and-earn economy

This document is the operating contract for the **v1.0 vertical slice**. The design borrows recognizable relationships from a real economy—firms, households, government, labor, production inputs, final demand, taxes, reserves, scarcity, and business cycles—but compresses them into decisions a player can understand in one session.

It is a **game-first play-and-earn system**, not a promise that play produces cash profit. The current release contains no wallet connection, token transfer, redemption, or withdrawal.

## The simplified circular economy

```text
Government infrastructure ── sells basic inputs ──▶ Player businesses
          ▲                                           │
          │ taxes, licenses, fares                     │ products, services, wages
          │                                           ▼
Government procurement ◀── industrial goods ── Businesses ──▶ AI households
          │                                                   │
          └──────── bounded demand support ◀──── wages ───────┘

Scrap and waste ──▶ reclamation ──▶ crates, parts, equipment and new production
```

This is an input-output network rather than a set of isolated crafting recipes. That framing follows the purpose of the U.S. Bureau of Economic Analysis [Input-Output Accounts](https://www.bea.gov/data/industries/input-output-accounts-data), whose supply, use, and requirements tables describe how industries and commodities depend on one another.

## The two currencies

### Merc Dollar (`MERCS`) — operating money

Merc Dollars are the unit of account for prices, wages, leases, inputs, sales, transport, upgrades, maintenance, and taxes. Every ordinary payment moves existing Merc Dollars between a player, Mercedonian households, or the civic treasury.

### `$MM` — reserve wealth

`$MM` has a fixed design supply of one billion. It is never required to start, operate, upgrade, or compete. In the current game, `$MM` is an internal reserve-accounting asset. A transparent Reserve Desk can exchange fixed prototype bundles while enforcing a vault floor and spread, but no blockchain transfer occurs.

This separation prevents volatile reserve-asset speculation from becoming the price system for bread-and-butter gameplay. It also avoids a pay-to-win loop: business performance comes from specialization, procurement, timing, pricing, upgrades, and supply-chain planning.

## Where value comes from

Players earn Merc Dollars by creating useful output, not by receiving emissions for logging in.

1. **Industrial sales:** sell resources needed by another sector or bounded civic procurement.
2. **Household demand:** restaurants, gyms, cinemas, retail, hotels, and freight receive payments from the Mercedonian spending pool.
3. **Trade contracts:** complete a specific household or public order for a time-limited demand premium.
4. **Daily enterprise dividend:** complete production, a contract, and trade activity. Its reward is transferred from the government budget and can be claimed once per civic day.
5. **Long-term enterprise growth:** upgrades improve yield, capacity, speed, or appeal; career levels and one permanent specialization support different strategies.

Contracts are intentionally legible goals. The design uses the same basic role as faction contracts in [Prosperous Universe](https://handbook.apex.prosperousuniverse.com/wiki/faction-contracts/index.html): directing player effort toward useful economic activity while preserving player choice.

## Sources and sinks

| Money movement | Payer | Receiver | Economic purpose |
|---|---|---|---|
| Basic inputs | Player | Government | Infrastructure revenue and resource floor |
| Payroll | Player | Households | Funds future customer demand |
| Product/service sale | Households or government | Player + tax account | Rewards useful output |
| License, lease, fare | Player | Government | Access and public-service sink |
| Upgrade | Player + resources | Government/system inventory | Growth sink and material demand |
| Maintenance | Player | Government + households | Durability sink and technician wages |
| Tax | Player sale | Government | Recirculates successful-business income |
| Daily dividend | Government | Player | Bounded counter-cyclical support |

The daily dividend and procurement premiums act like small automatic stabilizers: support rises in weaker conditions but remains constrained by an existing treasury. This mirrors the counter-cyclical role described in the IMF overview of [fiscal policy and automatic stabilizers](https://www.imf.org/external/pubs/ft/fandd/basics/36-fiscal-policy.htm), without simulating a full national budget.

## Anti-inflation and anti-exploit rules

- No ordinary command mints Merc Dollars. Tests assert that purchases, wages, taxes, sales, contracts, ferry travel, and daily rewards conserve the opening supply.
- Government purchasing has a per-resource daily quota. Contracts create targeted extra demand, but their payment still comes from the named buyer pool.
- AI households can spend only accumulated liquidity. Player payroll replenishes that pool, so employment and consumption reinforce one another.
- Civic fallback inputs are always available at a deliberately inferior price, preventing deadlocks while making player suppliers more competitive.
- Market pressure is bounded and mean-reverting. Scarcity changes prices without allowing a single transaction to permanently destroy affordability.
- One active contract per player prevents stacking the same demand opportunity.
- Contract settlement, daily claims, reserve exchanges, market orders, and production collection require idempotency keys on the authoritative server.
- Starter inputs are granted only when a license is first chosen; rebuilding or reconnecting cannot duplicate them.
- Land begins as a renewable lease. Permanent scarce land and tokenized plots are excluded.

Research on blockchain-game participation identifies inflation, high entry barriers, and pay-to-win dynamics as recurring sustainability risks. See the review of play-to-earn risks in [Frontiers in Blockchain / PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC9872537/) and Oxford research on [sustainable token economies](https://ora.ox.ac.uk/objects/uuid%3A0614c79b-b619-4893-8946-03e01c4e8eba). Markets & Makers therefore treats earning as a consequence of useful play, not an advertised investment return.

## Career and specialization

Career XP unlocks status and options, not purchased statistical power.

- **Lean Operations:** 10% faster jobs; best for turnover and responsive supply.
- **Quality House:** 10% more goods and stronger quality pricing; best for premium production.
- **Community Enterprise:** higher payroll, visitor demand, reputation, and XP; best for services and civic growth.

The choice is permanent in the vertical slice so companies develop recognizable identities. Production careers progress through New Maker, Licensed Operator, Local Proprietor, District Supplier, Regional Founder, and Mercedonian Industrialist.

## Business-cycle feedback

The game surfaces a market price index, consumer confidence, household liquidity, treasury capacity, and an economic phase. It does not hide these behind an opaque reward formula.

Production telemetry should follow the precedent of EVE Online's public [Monthly Economic Reports](https://www.eveonline.com/news/t/monthly-economic-reports): monitor production, destruction/sinks, currency flows, market prices, and concentration. At minimum, the live dashboard must track:

- Merc Dollar supply by player, government, household, and escrow accounts;
- wages, taxes, fees, procurement, household spending, and Reserve Desk spread;
- production and consumption by resource and business;
- price indices, transaction volume, inventory velocity, and failed purchase rates;
- wealth concentration, business profitability, new-player solvency, bot-like repetition, and contract completion;
- `$MM` reserve coverage, internal exchange volume, and any queued withdrawal liability.

## Live-operation guardrails

Before transferable `$MM` or cash-out exists:

1. Run a closed economy for at least one full season with no external value.
2. Load-test and exploit-test every ledger command; restore the database from backup.
3. Publish treasury, reserve, issuance, withdrawal, fee, and emergency-pause policies.
4. Obtain jurisdiction-specific legal, tax, consumer-protection, custody, AML, and gambling review.
5. Audit contracts and custody; cap withdrawals; delay suspicious settlements; never expose server keys to the browser.
6. Make loss risk, liquidity risk, price volatility, fees, and non-guaranteed earnings explicit.
7. Keep a fully enjoyable non-cash-out game path and prohibit purchases from determining economic dominance.

The founder/mayor may propose fiscal settings, but production policy must be rate-limited, auditable, and preferably require multisignature approval. The mayor cannot directly edit balances or fill personal orders.

## v1.0 acceptance rules

- A new player can accept and complete a contract, lease a plot, build, produce, collect, specialize, and understand the next action.
- Every resource has a producer plus a business use or final buyer.
- Every reward identifies its payer; no UI says that profit is guaranteed.
- A player can progress without owning `$MM`.
- Browser refresh restores versioned state; malformed state is bounded and reconstructed safely.
- The production server schema provides ledgers, idempotency receipts, contracts, daily progress, procurement ceilings, snapshots, plots, jobs, and reserve accounts.
