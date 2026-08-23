# Markets & Makers — real-economy model for the playable prototype

This note documents the economic references and the deliberately simplified formulas introduced in v0.3. As of v0.5, every operational value described below is denominated in **Sunmarks (`SM`)**; `$MM` is handled only by the reserve system in `DUAL_CURRENCY_SYSTEM.md`. This is a game-design model, not a forecast of a real token, investment return, or sustainable cash yield.

## Research translated into mechanics

### 1. Supply-and-use network, not isolated recipes

The U.S. Bureau of Economic Analysis describes input-output accounts as tables showing production relationships among industries and commodities. Supply tables show what industries produce; use tables show who consumes it, including other industries and final users; requirements tables capture direct and indirect inputs.

- BEA Input-Output Accounts: (awdelasticity-of-supply
- Elasticity and pricing: https://openstax.org/books/principles-economics-2e/pages/5-3-elasticity-and-pricing

Game translation:

```text
buy price  = civic base price × scarcity pressure
sell price = procurement base × scarcity pressure × appeal × stabilizer (when eligible)
demand     = base visitors × appeal × quality × confidence × (1 / markup)^elasticity
```

Civic purchases move pressure upward; sales move it downward. Pressure is capped at 0.72–1.55 and gradually returns toward 1.00, preventing an early local prototype from spiraling permanently. Civic fallback remains more expensive than player production so a quiet server cannot deadlock.

### 3. A price index is a basket, not one item

The U.S. Bureau of Labor Statistics says CPI measures the average price change over time in a representative basket of goods and services, using weighted price changes. Different indexes serve different purposes.

- BLS CPI concepts: https://www.bls.gov/opub/hom/cpi/concepts.htm
- BLS CPI overview: https://www.bls.gov/cpi/overview.htm

Game translation: the Market Price Index is a weighted average of the eleven resource pressure ratios with an opening value of 100. Water, power, food and supplies carry greater weight than scrap. It is a diagnostic HUD signal, not a direct copy of U.S. CPI methodology.

### 4. Payroll, value added and depreciation matter

BEA notes that an industry's production function includes the commodities it consumes plus value added by labor and capital. Revenue alone is therefore not profit.

Game translation: every operating cycle pays payroll from the owner wallet into the citizen pool before production begins. Equipment condition falls after use. The business panel estimates inputs, payroll, gross revenue, 5% transaction tax and profit. Maintenance pays both technicians and a civic service fee.

### 5. Automatic stabilizers should withdraw themselves

The IMF describes automatic stabilizers as revenues and expenditures that adjust automatically with the economic cycle—for example, tax receipts fall and some spending rises when output falls.

- IMF fiscal policy overview: https://www.imf.org/en/publications/fandd/issues/series/back-to-basics/fiscal-policy
- IMF staff note on automatic fiscal stabilizers: https://www.imf.org/external/pubs/ft/spn/2009/spn0923.pdf

Game translation: when consumer confidence is below 100, eligible civic procurement receives a small automatic price-floor multiplier. The multiplier shrinks to zero as confidence recovers. It is capped and draws only from the existing government treasury.

### 6. Circularity requires markets for recovered inputs

The OECD frames resource efficiency across extraction, transport, manufacturing, consumption and recovery, and highlights public procurement, taxes, subsidies and price signals as policy tools.

- OECD resource efficiency and circular economy: https://www.oecd.org/en/topics/policy-issues/resource-efficiency-and-circular-economy.html

Game translation: most material producers create recoverable scrap. Tideglass Reclamation consumes scrap and power to output parts and construction modules, giving waste a productive buyer and reducing dependence on new extraction.

## Playability safeguards

- Each license receives exactly one in-kind starter cycle; it cannot be claimed twice.
- Civic fallback can sell every input, so a low-population realm cannot be permanently blocked.
- Prices are bounded, deterministic and mean-reverting.
- Government and citizen purchases fail rather than minting money when their pool is exhausted.
- Wallet + treasury + citizen pool begins at 50,000,000 Sunmarks and is conserved by ordinary transactions. Reserve Desk conversions deliberately contract or expand that base against returning `$MM` collateral.
- Input, payroll, expected revenue, tax and expected profit are shown before a job starts.
- No wallet connection, real-token transfer, cash-out, yield promise or Pump.fun dependency exists in this build.

## What still needs server-side evidence before a live economy

The local model is useful for balancing but is client-authoritative. A production alpha needs an authoritative transaction ledger, idempotent commands, player-to-player orders, inventory escrow, market-depth limits, procurement quotas, fraud telemetry, anti-bot controls, per-realm economic dashboards, stress simulations and independent legal/security review. Real `$MM` settlement must remain asynchronous and outside moment-to-moment gameplay authority.
