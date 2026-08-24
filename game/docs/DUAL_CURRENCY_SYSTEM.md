# Markets & Makers dual-currency system

## Currency names

- **Merc Dollar (`MERCS`)** — everyday in-game money. Prices, wages, taxes, rent, inputs, services, transport and accounting are denominated in Merc Dollars.
- **`$MM`** — scarce reserve and long-term wealth asset. Its fixed total supply is 1,000,000,000. It is never required to operate an ordinary business.

The name Merc Dollar ties everyday money directly to Mercedonia's markets, while `MERCS` gives every displayed price one short, unmistakable code.

## Economic roles

| Function | Merc Dollar | `$MM` |
|---|---:|---:|
| Unit of account | Yes | No |
| Everyday medium of exchange | Yes | No |
| Payroll and Mercedonian spending | Yes | No |
| Taxes, leases and permits | Yes | No |
| Inputs and business upgrades | Yes | No |
| Government procurement | Yes | No |
| Reserve backing | No | Yes |
| Long-term player reserve wealth | No | Yes |
| On-chain settlement | No | Future, asynchronous only |

This follows the conventional separation between a transaction currency and a reserve asset. The Federal Reserve describes money through its unit-of-account, medium-of-exchange and store-of-value functions. The IMF describes reserve assets as liquid assets controlled by monetary authorities to support intervention and confidence. Sources: [Federal Reserve](https://www.federalreserve.gov/boarddocs/speeches/2001/20011205/), [IMF reserve-assets note](https://www.imf.org/external/pubs/ft/bop/2015/pdf/15-14.pdf).

## Opening balance sheet

### `$MM`

- Fixed total supply: **1,000,000,000 `$MM`**.
- Civic Vault opening reserve: **50,000,000 `$MM`**.
- Remaining external/public supply: **950,000,000 `$MM`**.
- The game cannot mint more `$MM`.

### Merc Dollars

- Opening Merc Dollar monetary base: **50,000,000 MERCS**.
- Civic operating treasury: **44,999,250 MERCS**.
- Mercedonian spending pool: **5,000,000 MERCS**.
- New-player wallet: **750 MERCS**.
- Opening reserve coverage: **100% at the prototype reference parity**.

The Merc Dollar supply is a balance-sheet quantity, not an arbitrary score. Ordinary transactions move existing Merc Dollars between players, businesses, Mercedonians and government without changing total circulation.

## The operating loop

```text
Civic infrastructure
  sells utilities and starter inputs for MERCS
             ↓
Player businesses
  buy inputs → pay wages → produce goods/services
             ↓
Mercedonians and civic procurement
  buy output and services with MERCS
             ↓
Player revenue
  pays tax, maintenance, upgrades and suppliers
             ↺
```

### Transfers that do not create money

- Resource purchase: player wallet → civic treasury.
- Payroll: player wallet → Mercedonian spending pool.
- Mercedonian purchase: Mercedonian spending pool → player wallet, less tax.
- Civic procurement: civic treasury → player wallet, less tax.
- Tax, licenses, leases and ferry fees: player wallet → civic treasury.
- Maintenance: player wallet → technician households and civic services.

These flows conserve total Merc Dollars.

## Reserve Desk

The local vertical slice uses a transparent currency-board simulation:

- Reference parity: **1 `$MM` = 1 MERCS**.
- Trade unit: **100 `$MM`**.
- Two-way spread: **2%**.
- Civic Vault hard floor: **25,000,000 `$MM`**.

### Acquiring reserve `$MM`

For a 100 `$MM` order:

1. Player pays 102 MERCS.
2. 100 MERCS are retired from circulation.
3. 2 MERCS move to the stabilization fund inside the civic treasury.
4. 100 `$MM` move from the Civic Vault to the player's reserve holdings.

The monetary base and reserve both contract by 100 units, preserving coverage.

### Returning reserve `$MM`

For a 100 `$MM` return:

1. 100 `$MM` move from the player to the Civic Vault.
2. 98 new MERCS enter the player's wallet.
3. The unissued 2 MERCS equivalent increases the reserve protection margin.

The monetary base expands only after reserve `$MM` returns to the vault.

Currency-board literature describes backing, fixed conversion and restrictions on the issuing authority as the defining commitments, with reserve coverage supporting credibility. Sources: [IMF currency-board definition](https://www.elibrary.imf.org/display/book/9781557756688/ch001.xml), [IMF institutional framework](https://www.elibrary.imf.org/view/journals/001/2004/180/article-A001-en.xml).

## Monetary indicators

The UI publishes:

- Civic Vault `$MM` balance.
- Player `$MM` reserve holdings.
- Merc Dollars in circulation.
- Reserve coverage percentage.
- Consumer confidence.
- Market price index.
- Civic treasury and Mercedonian spending balances.

Formula:

```text
reserve coverage = ($MM in Civic Vault × reference MERCS per $MM)
                   ÷ Merc Dollars in circulation
```

Policy states:

- **Fully covered** — coverage is at least 100%.
- **Reserve surplus** — coverage is at least 110%.
- **Redemption restricted** — coverage is below 100%; additional reserve outflow must pause.

## Inflation and deflation controls

Merc Dollars are not issued because the mayor wants a larger budget. New Merc Dollars enter circulation only when:

1. `$MM` returns to the Civic Vault through the Reserve Desk; or
2. a future audited monetary-policy action receives equivalent additional reserve assets first.

Merc Dollars leave circulation when players acquire reserve `$MM`. Taxes do not burn Merc Dollars; they fund infrastructure, procurement and public services. Resource scarcity changes individual prices inside bounded ranges, while monetary-base changes remain separate and publicly visible.

The BIS emphasizes that stable monetary arrangements depend on a single unit of account, settlement at par and confidence in stable value. It also warns that reserve-backed token promises depend on the issuer's ability to meet redemption. Source: [BIS Annual Economic Report 2025](https://www.bis.org/publ/arpdf/ar2025e3.htm).

## Production deployment boundary

The current Reserve Desk is an **off-chain prototype ledger**. It does not transfer a Pump.fun token and does not promise real redemption, price stability or profit.

Before real `$MM` conversion is enabled, the project requires:

- independent legal analysis in every launch jurisdiction;
- audited custody, treasury and smart-contract controls;
- a verifiable `$MM` reserve wallet and published liabilities;
- an oracle or auction policy that cannot be manipulated by a thin spot market;
- withdrawal queues, identity/risk controls, per-account limits and circuit breakers;
- segregation of the backing reserve from operating funds;
- daily outstanding-supply disclosure and regular reserve attestations;
- explicit player disclosures that `$MM` can lose market value.

The Basel framework for cryptoasset reserve arrangements calls for disclosure of the outstanding amount and reserve composition and discusses bankruptcy-remoteness and currency-mismatch risk. Source: [BIS Basel Framework SCO60](https://www.bis.org/basel_framework/chapter/SCO/60.htm?inforce=20260101&published=20240717&tldate=20290402).

For a real launch, the safest first conversion mechanism is a **scheduled, capped reserve auction** using a manipulation-resistant reference price—not continuous automatic redemption against Pump.fun spot prices.
