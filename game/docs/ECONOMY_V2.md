# Markets & Makers — Economy v2 (play-to-earn redesign)

Status: proposal. Supersedes the economic sections of `REAL_ECONOMY_MODEL.md` and
`markets-and-makers-business-ecosystems-v0.1.md`. Architecture boundary in
`PRODUCTION_ARCHITECTURE.md` still holds and is tightened here.

Every number below marked **measured** was computed from the shipped `game/src/data.ts`
and `game/src/state.ts`, not estimated.

---

## Part 1 — What the current economy actually does

### D1. The economy is a fixed 50,000,000 pool draining one way, and it has a bottom

Total money is conserved on every code path: `wallet + governmentTreasury + citizenPool`
starts at 50,000,000 and nothing anywhere mints. Player profit is therefore, by identity,
a one-way transfer out of the government treasury (45,000,000) and the citizen pool
(5,000,000). When they empty, `sellResource` returns *"procurement is temporarily
exhausted"* and the game stops.

**Measured time to empty both pools:**

| Concurrent players | modest (2 $MM/s) | typical maxed (20 $MM/s) | maxed recycler (51 $MM/s) |
|---|---|---|---|
| 1 | 289 days | 29 days | 11.3 days |
| 100 | 69 h | 6.9 h | **2.7 h** |
| 1,000 | 6.9 h | 0.7 h | **16 min** |
| 10,000 | 0.7 h | 4 min | **2 min** |

This is the single fatal property for a token launch. A P2E economy whose reward pool is
consumed faster than a launch-day player session cannot be patched with balance tuning.

### D2. There is no player market

There is no listing, order, bid, escrow or transfer path anywhere in the codebase. Every
transaction is player ↔ civic NPC. The game is called *Markets & Makers* and currently has
makers only. All fifteen industries are decorative: you may own exactly one, permanently
(`chooseLicense` rejects a second, `leaseSelectedPlot` rejects a second plot), and you can
never buy from or sell to another player.

### D3. Ten of the fifteen licenses bankrupt a new player

**Measured profit per job at level 0, inputs at civic prices** (the only prices that exist):

| Loss-making | | | Profitable | |
|---|---:|---|---|---:|
| Civic Construction | −85 | | Reclamation Hub | **+95** |
| Sunwell Microgrid | −77 | | Greenloom Greenhouse | +44 |
| Tideglass AquaWorks | −41 | | Freight Crate Mill | +27 |
| Stonewake Mine | −29 | | Sunwoven Factory | +17 |
| Copper Quay Freight | −27 | | Maker Workshop | +11 |
| Timbercoast Works | −25 | | | |
| Supply Shop & Café | −19 | | | |
| Lantern Cinema | −10 | | | |
| Harbor Gym | −7 | | | |
| Sunset Market Kitchen | −5 | | | |

The foundation doc's rule — *"player trade must be more profitable than buying from the
municipality"* — is right. But with no player market, civic is the only counterparty, so
two thirds of the license screen are traps that drain a 750 $MM starting wallet with no
route back. The license is then locked forever.

### D4. The Capacity upgrade is free throughput

`state.ts` computes `completeAt = now + config.duration * speed * 1000`. **`cycles` never
enters the duration.** Measured on the Factory:

| Capacity | cycles | duration | profit/job | throughput |
|---|---|---|---|---|
| L0 | 1 | 24.0 s | 17 | 0.71 $MM/s |
| L3 | 4 | **24.0 s** | 66 | **2.75 $MM/s (4.00×)** |

`markets-and-makers-business-ecosystems-v0.1.md` specifies "Capacity adds 45% of base
duration for each additional batch." That rule was never implemented.

### D5. The Reclamation Hub is a money printer, and its input is free

3 Scrap (15) + 1 Power (8) + labor (12) = **35 in**; 2 Building Modules (96) + 1 Utility
Part (40) = **136 out**. **+95 per 20 s job at level zero**, 4.75 $MM/s before any upgrade,
51 $MM/s fully upgraded — 10× the next best business. Scrap is simultaneously produced free
as a by-product by ten of the fifteen businesses *and* purchasable from civic at 5.

### D6. The service price slider has one correct answer, permanently

Revenue scales as `P^(1−elasticity)` because visitors fall by `P^-e` while price rises by
`P`. **Measured:**

| Business | elasticity | correct price | forever |
|---|---|---|---|
| Copper Quay Freight | 0.80 | **130%** | inelastic — max always wins |
| Harbor Gym | 1.15 | 85% | min always wins |
| Lantern Cinema | 1.35 | 85% | min always wins |
| Sunset Market Kitchen | 1.40 | 85% | min always wins |

It is a lookup, not a decision.

### D7. Consumer demand returns 14–24% of what it consumes

The citizen pool's only inflows are payroll and 12 $MM per maintenance. **Measured net drain
per service job:** Freight +62, Restaurant +68, Cinema +59, Gym +34. Payroll returns
14%–24% of service revenue. Consumer demand is a 5,000,000 bucket, not a renewing resource.

### D8. All economic state is client-authored

Everything lives in `localStorage` under `SAVE_KEY`. The Render server implements
`validateMove` and presence — movement authority only. There is not one economic command on
the server. In a token game the save file *is* the money.

### D9. Two smaller structural gaps

- Reputation is monotonic with no decay; `activity` saturates at 14 after ~12 jobs, so
  `economicPhase()` freezes on "Balanced expansion" permanently.
- Nine islands exist; three plots exist, all on Hearthmarket. There is nothing to do on the
  other eight.

### One thing that is right and should be kept

The civic buy/sell spread is sound. I swept the full pressure clamp (0.72–1.55) against every
reachable Appeal level and every reachable consumer-confidence value and found **no profitable
civic round-trip on any of the eleven resources** — best case is break-even on Food and Scrap.
The automatic stabilizer is correctly bounded (reachable ceiling ×1.04 for an established
player, not the ×1.125 the formula suggests in isolation). Keep this structure.

---

## Part 2 — The redesign

### The organising principle

Chikoria's economy was measured at **+1,578 net currency per player-week**, and adding a
sink removed only **9.4%** of it. The faucet was the entire story. The lesson transfers
exactly:

> **Do not price the payout. Budget it.**

Everything below follows from that.

### 2.1 Three layers, and only one of them is money

**Layer 1 — Coin.** Soft, off-chain, minted and burned freely, never withdrawable, never
convertible at a fixed rate. Wages, inputs, rent, maintenance, licenses, market fees. NPC
demand *mints* Coin and sinks *destroy* it. This deletes D1 outright: consumer demand stops
being a finite bucket. The design target is Coin **velocity**, not Coin conservation.

**Layer 2 — Contribution.** A non-transferable, per-epoch score that resets weekly. It is
the only bridge from gameplay to value.

**Layer 3 — $MM.** Token-2022 on Solana, fixed supply, **mint authority revoked at launch**.
No gameplay action mints a single token, ever. $MM leaves the Rewards Reserve only through
scheduled emission.

### 2.2 The mechanism that makes this survivable

```
payout(player, epoch) = WEEKLY_BUDGET × contribution(player) / Σ contribution(all players)
```

`WEEKLY_BUDGET` is a constant set by schedule, not by gameplay. The consequences are the
whole point:

- **The faucet cannot be exploited, only diluted.** A bot farm that earns 100× contribution
  does not extract 100× $MM — it takes a larger slice of a fixed pie and shrinks everyone's
  slice, including its own per-bot ROI, which falls as bot count rises. This is precisely the
  property Chikoria's uncapped task board lacked.
- **You never have to price anything in $MM.** No "how much is a Utility Part worth in
  token" question exists. The market answers it every epoch.
- **Runway is a calendar, publishable on day one:** `weeks = reserve / weekly_budget`.
- **Emission can taper** (halving schedule) without touching a single gameplay number.

### 2.3 What earns Contribution

Contribution is earned only by actions that **cost the player something and benefit another
player**:

| Source | Weight basis |
|---|---|
| Filling another player's buy order | order value, **capped per counterparty per epoch** |
| Supplying an input actually consumed by another player's job | input value |
| Fulfilling a civic **quota** contract | quota value |
| District/community project delivery | delivered value |
| Approved creator blueprint sold to another player | sale value |

Explicitly **not** contribution: selling to NPCs, running jobs alone, owning land, holding
$MM. Passive holding must never earn — that is the line between a game and a security, and
the foundation doc already draws it. Keep it.

Anti-sybil, ported from Chikoria's clamps and wallet ceiling:
- per-counterparty-pair contribution cap per epoch (kills wash trading between two accounts)
- new accounts' contribution escrowed N days before it counts
- per-wallet hard ceiling per epoch
- contribution earned from a trade is voided if the trade is reversed or refunded

### 2.4 Fixing the goods economy

**F1 — Replace the finite civic pool with a price band plus quotas.**
Civic sells at `ceiling ≈ 1.45 × reference` and buys at `floor ≈ 0.55 × reference`. The band
is deliberately wide so that player prices live inside it. Critically, **civic buy orders are
quota-limited per epoch** ("the government will take 4,000 Utility Parts this week"). This
is the highest-value single change: it converts an infinite NPC sink into a rate-limited one,
so dumping on the NPC can never remain the optimal loop.

**F2 — Build the player market.** Regional order books, one per island — not global. The
foundation doc's "instant global trading is not available" is correct and load-bearing.
Freight players physically move goods between island books and the inter-island **spread is
their wage**, which finally makes Logistics an industry instead of a payout constant.

Escrow semantics, exactly as Chikoria learned them the hard way:
- `list` → quantity **leaves** inventory into an `escrow` owner row
- `cancel` → returns from escrow
- `buy` → permanent transfer, one atomic transaction
- a settled listing is retired by id and can never settle again

Chikoria shipped a Trading Post that resurrected sold listings because listings referenced
inventory instead of holding it. Do not repeat it: escrow on list, retire on sale.

**F3 — Make "civic loses, players win" a tested invariant.**
For every business, assert in CI:

```
profit(inputs at civic ceiling)  <  0  <  profit(inputs at player median)
```

Five businesses currently violate this in the profitable direction (Greenhouse, Crate Mill,
Workshop, Factory, Reclamation) — they are self-sufficient and never need another player.
Concretely for the worst offender: **Reclamation becomes 3 Scrap + 1 Power → 1 Module +
1 Part** (down from 2+1), and **Scrap is removed from the civic sell list entirely**. Scrap
is a by-product; you buy it from other players or you make it. That converts the game's best
money printer into its best reason to trade.

**F4 — Capacity must cost time.** Implement the documented rule:

```
duration = base × speedFactor × (1 + 0.45 × (cycles − 1))
```

Measured effect: Capacity L3 drops from **4.00× throughput to 1.70×** (4 cycles ÷ 2.35
duration factor). It stays worth buying; it stops being free.

**F5 — More than one business, with real limits.** One license per plot; plots per player
capped (start at 3) and raised by civic standing. One permanent license means a player
cannot respond to the market at all, which is the game's stated core skill.

**F6 — Replace the price slider with an actual decision.** Move demand from a per-business
constant to a **per-island, per-good curve** that shifts with district population, events,
and how much other players have already sold there today. Then the right price depends on
what everyone else did, and D6's lookup table stops existing.

**F7 — Sinks that scale with wealth, not with actions.** Chikoria measured a flat sink
removing 9.4% of the faucet. Use recurring, progressive sinks instead:
- plot lease **renewal**, priced off plot value and live district demand
- depreciation with a falling ceiling: maintenance restores condition toward a cap that
  itself decays (100 → 97 → 94 …), so capital must eventually be replaced, not just repaired
- license renewals
- market fees on **both** sides of the book
- top-decile progressive rates on civic quota fills

### 2.5 $MM on Solana

| | |
|---|---|
| Standard | **Token-2022** (Chikoria's $CHIKI is Token-2022; assuming legacy SPL breaks wallets and tooling) |
| Supply | fixed; **mint authority revoked at launch**, verifiable on-chain |
| Rewards Reserve | 40% |
| Liquidity | 15% |
| Team | 15%, 4-year vest, 1-year cliff, on-chain schedule |
| Treasury / ops | 15% |
| Community & creators | 10% |
| Marketing | 5% |
| Emission | weekly budget = 0.35% of reserve, halving every 26 weeks |

(Allocation is a starting point, not a recommendation — set it with the legal review your
runbook already requires.)

**Custody and payout, from Chikoria's leaked-key postmortem:**
- Reserve in a Squads multisig. The server **never** holds a key that can move it.
- Hot wallet funded with at most one epoch's budget.
- Payouts are **claims the player signs for**, not pushes from a server-held key.
- Withdrawal queue, cooldown, per-wallet daily cap, and a circuit breaker that pauses claims
  without pausing the game.
- Never ship a private key or seed phrase into a repo, a client, a response body, or chat.

**Never sell land, businesses, or licenses as yield-bearing assets.** The foundation doc
already prohibits it. That prohibition is doing more legal work than any other line in the
project — keep it verbatim.

### 2.6 Server authority — the precondition, not a later phase

Every one of these becomes an idempotent server command carrying an idempotency key, each
resolving in exactly one database transaction:

`lease · license · build · buy · sell · list · cancel · fill · start_job · collect_job ·
upgrade · maintain · travel · claim`

The existing schema is already ~80% of the way there: `currency_account`, `currency_ledger`
with `unique(command_id, debit_account, credit_account)`, `item_balance` + `item_ledger`,
and `command_receipt` are the right shapes. Missing:

- `market_listing` (with `escrow` as a first-class `item_balance` owner)
- `civic_quota` (per epoch, per resource, per island)
- `contribution_epoch` and `contribution_event`
- `payout_claim` (idempotent, non-destructive credited flag — a re-sent ack must never
  double-credit and must never destroy the record)

**Invariants asserted in CI, every build:**
1. `Σ currency_account.balance == Σ ledger credits − Σ ledger debits`
2. no `item_balance.quantity < 0`, ever, on any path
3. per-item ledger balances to zero across all owners
4. no listing settles twice
5. $MM emitted in an epoch is **exactly** ≤ `WEEKLY_BUDGET`

**And a fuzzer before any token exists.** N bot players, randomised command order, replayed
and duplicated commands, two buyers racing the same listing, disconnects mid-transaction —
then assert all five invariants. Chikoria's `market_sim` caught a double-sale resurrection
bug exactly this way, and its economy sim caught balance faults that reading the code did
not. Claims about economic behaviour need a simulation, not an argument.

### 2.7 Sequencing

| Phase | Contains | Gate to pass before advancing |
|---|---|---|
| 0 | Server-authoritative economy, no token, closed test | 5 invariants hold under 500-bot fuzz |
| 1 | Player market + contribution scoring, still no token | 4 weeks of real data; publish measured net Coin per player-week |
| 2 | Devnet $MM, full claim path, zero real value | Claim path idempotent under replay; reserve reconciles |
| 3 | Mainnet, budgeted emission, public reserve | Legal + independent security review per runbook §18 |

Two deployment rules carried over from Chikoria, both learned from live incidents:
- **Ship the client before flipping any server auth flag.** The reverse order locks out
  every player on the old build.
- **Fresh accounts start at zero**, with a load-time scrub that guarantees it. Any starter
  grant is a server-issued, once-only, idempotent event — never a client default.

---

## Part 3 — Changes ranked by value

| # | Change | Fixes | Effort |
|---|---|---|---|
| 1 | Move all economic state to the server, idempotent + double-entry | D8 | high |
| 2 | Coin/Contribution/$MM split with budgeted pro-rata emission | D1 | high |
| 3 | Player order books with escrow-on-list | D2 | high |
| 4 | Civic price band + per-epoch quotas replacing the finite pool | D1, D7 | medium |
| 5 | Rebalance so civic-priced inputs lose and player-priced inputs win | D3 | medium |
| 6 | Capacity duration rule `1 + 0.45×(cycles−1)` | D4 | trivial |
| 7 | Reclamation recipe 2+1 → 1+1; remove Scrap from civic sell | D5 | trivial |
| 8 | Per-island demand curves replacing fixed elasticity | D6 | medium |
| 9 | Multiple plots/licenses per player, capped | D3, D9 | medium |
| 10 | Progressive recurring sinks; decaying condition ceiling | D1 | medium |
| 11 | Plots on all nine islands | D9 | low |

Items 6 and 7 are one-line changes that remove the two largest balance distortions
in the shipped build and are worth doing this week regardless of everything else.
