# Markets & Makers — playable browser vertical slice

This is the **v1.0 playable vertical slice** of **Markets & Makers**. It uses the original Sunwoven Reach V1 archipelago and the original B01–B08 Blender structures instead of the later tile experiments.

## Official visual standard

The approved production art direction is defined by [`../ART-DIRECTION.md`](../ART-DIRECTION.md) and the tracked reference library in [`../art/official-v1`](../art/official-v1). These references are now the authority for every building, terrain tile, interior, prop, vehicle, avatar, UI illustration, and marketing image.

The current world and B01–B08 GLBs remain **temporary technical placeholders**. They prove streaming, scale, interaction, and placement, but they are not the final visual standard. Fifteen unique production business GLBs will replace the reused archetypes after they are modeled and validated against `art/official-v1/manifest.json`.

## Founder release (v1.0)

- Added a Trade Guild contracts board with household and civic orders, explicit buyers, demand premiums, reputation and career XP.
- Added six career levels and three permanent company specializations: Lean Operations, Quality House and Community Enterprise.
- Added daily enterprise goals for production, contracts and trade; the dividend is transferred from the civic treasury and never mints money.
- Added daily government procurement quotas, targeted contract demand, business-cycle phases, economic history and stronger anti-inflation tests.
- Expanded the MMO-style navigation to six destinations and improved desktop/mobile onboarding around one recommended action.
- Added a durable PostgreSQL migration for progression, contract settlement, verified daily progress, procurement ceilings and realm economic snapshots.
- Documented the complete play-and-earn loop, safeguards, telemetry and real-token boundary in `docs/PLAY_AND_EARN_ECONOMY.md`.

## Dual-currency pass (v0.5)

- Introduced **Sunmark (`SM`)** as the stable, everyday unit for prices, wages, taxes, leases, utilities, transport, services and upgrades.
- Repositioned `$MM` as a scarce reserve/wealth asset with a fixed 1 billion total supply, never required for ordinary play.
- Added a transparent Civic Reserve Desk with a prototype reference parity, two-way 2% spread, fixed trade bundles and a 25 million `$MM` vault floor.
- Buying reserve `$MM` retires the matching Sunmark principal; returning `$MM` issues fewer Sunmarks, so the spread builds a protection margin.
- Added live reserve coverage, player reserve holdings, Civic Vault, monetary-policy state and Sunmarks-in-circulation indicators.
- Added a second database migration for currency-specific ledgers, monetary policy, reserve accounts and idempotent reserve-exchange records.
- Documented the full balance sheet, issuance rules and real-token safety boundary in `docs/DUAL_CURRENCY_SYSTEM.md`.

## MMO interface and world-life pass (v0.4)

- Rebuilt the founder guide around one clear next action, two upcoming steps, and a collapsible complete roadmap.
- Added icon-and-label navigation, keyboard shortcuts (`Alt+1` through `Alt+6`), larger touch targets, and a responsive management layout.
- Opens business selection on three recommended starter roles, with the full fifteen licenses available through six economic-stage filters.
- Reworked license cards into concise input → output summaries with optional supply-chain details.
- Added production readiness, exact missing-input calculations, one-click shortfall purchasing, clearer job state, and a stronger collect/start action hierarchy.
- Reorganized the Civic Exchange around `All goods`, `Needed now`, and `My stock` views with compact local quotes and scarcity signals.
- Added lightweight instanced trees, shrubs, civic lamps, and Sunwell solar hardware plus a more characterful player avatar and luminous water treatment.
- Derived the interaction patterns from official EVE Online, Albion Online, RuneScape Grand Exchange, and Prosperous Universe material; see `docs/MMO_UI_REFERENCE.md`.

## Connected economy pass (v0.3)

- Expanded from six to **fifteen playable businesses** across infrastructure, primary production, manufacturing, commerce, citizen services and circular recovery.
- Expanded to eleven tradable resources, including food, timber, equipment, construction modules and recoverable scrap.
- Gave every business a documented production function, island affinity, license fee, payroll, starter cycle, upstream suppliers and downstream buyers.
- Added scarcity-responsive buy/sell prices with bounded volatility and gradual mean reversion.
- Added a market-basket price index, consumer-confidence index, economic phase indicator and automatic procurement support during weak demand.
- Added price-elastic demand to freight, restaurants, gyms and cinemas: owners can raise prices, but higher markups reduce attendance.
- Separated gross revenue from inputs, payroll, tax and expected profit in the business panel.
- Added wages to the citizen spending pool and made maintenance partly technician income, keeping ordinary Sunmark transfers conserved.
- Added recoverable production scrap and a reclamation business that closes part of the material loop.

## Solarpunk presentation pass (v0.2)

- Rebalanced the original GLB materials into a saturated grass, turquoise water, warm stone, terracotta and renewable-tech palette.
- Switched to a neutral, sRGB-correct display pipeline and added one bounded desktop sunlight shadow pass with cheaper contact shadows on citizens and the player.
- Added animated plot borders, lease labels, click-to-walk feedback and subtle avatar/world motion without adding texture downloads.
- Reworked the founder journey so the next useful action is obvious and reduced the visual weight of the management UI.
- Added an interactive archipelago route map that communicates the nine connected island economies.
- Preserved the lite-client boundary: no new image assets, no post-processing stack and only a small CSS/JavaScript increase.

## Play locally

Requirements: Node.js 20 or newer.

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:4173/`. The compiled release is produced with:

```bash
npm test
npm run build
npm run preview
```

The game must be opened through the local server; opening `dist/index.html` directly with `file://` will prevent browser asset loading.

## What is playable

- Explore all nine islands of the original Sunwoven Reach in an isometric Three.js world.
- Move with WASD/arrow keys or click-to-move, rotate with Q/E, and zoom with the mouse wheel.
- Lease one of three Hearthmarket plots and select one of fifteen connected business ecosystems.
- Construct a working placeholder building on the selected plot; fifteen unique approved production designs are locked in `art/official-v1` for progressive GLB replacement.
- Run timestamp-based production or price-sensitive AI-citizen service jobs.
- Buy basic inputs from government infrastructure, sell productive resources to government procurement, and sell services/supplies into AI-citizen demand.
- Pay licenses, payroll, maintenance and a 5% transaction tax in Sunmarks while reserve conversion separately contracts or expands the monetary base.
- Move optional long-term wealth between Sunmarks and internal `$MM` reserve holdings at the Civic Reserve Desk.
- Track live scarcity prices, consumer confidence, the market price index and expected unit economics.
- Enter the business interface and improve yield, capacity, speed, or customer appeal.
- Maintain equipment condition, build reputation, attract more citizens, and travel by ferry between islands.
- Continue after refresh using a versioned local save.
- Accept targeted household or public contracts, complete daily enterprise goals, gain career levels, and choose a permanent operating specialization.

## Important economic boundary

This build uses **prototype Sunmarks and internal `$MM` reserve holdings only**. It has no wallet connection, Pump.fun integration, token transfer, cash-out, automatic redemption, or promise of returns. The 50 million Sunmark opening base is split between government infrastructure/procurement, AI-citizen spending and the player. The 50 million `$MM` Civic Vault is separately accounted as reserve backing.

Before any real-token test, the simulation needs an independent legal review, audited smart-contract/custody design, anti-bot and anti-money-laundering controls where applicable, treasury spending limits, withdrawal queues, emergency pause controls, and clear player risk disclosures. A live token must never be the authority for moment-to-moment gameplay.

## Asset provenance

- World: `public/assets/world/sunwoven-reach-v1.glb`
- Temporary runtime structures: `public/assets/structures/b01-…b08-….glb`
- Official visual authority: `../art/official-v1/manifest.json`
- Official art and GLB contract: `../ART-DIRECTION.md`
- Source packages remain in the workspace `outputs/markets-and-makers-complete-blender-world-v1` and `outputs/markets-and-makers-blender-structures-v1`.

## Project map

- `src/data.ts` — business, resource, plot, island, upgrade, and tutorial catalogs
- `src/state.ts` — deterministic economy commands, ledger conservation, persistence, jobs, taxes, travel
- `src/world.ts` — GLB streaming, camera, player movement, plots, citizens, and building placement
- `src/main.ts` — interface and game flow
- `tests/state.test.ts` — economy and exploit regression tests
- `docs/PRODUCTION_ARCHITECTURE.md` — path from this local slice to the authoritative browser MMO
- `docs/REAL_ECONOMY_MODEL.md` — sources, formulas, safeguards and production-network design used by v0.3
- `docs/MMO_UI_REFERENCE.md` — MMO economy-interface references and the specific interaction patterns translated into v0.4
- `docs/DUAL_CURRENCY_SYSTEM.md` — Sunmark balance sheet, `$MM` reserve rules, monetary controls and deployment boundary used by v0.5
- `docs/PLAY_AND_EARN_ECONOMY.md` — circular-economy loop, progression, contracts, sources/sinks, telemetry and live-value guardrails used by v1.0

## Render, Helius, and Cloudflare

The repository root now includes `render.yaml`, an authoritative Node/WebSocket scaffold in `../server`, and `DEPLOYMENT.md`. Cloudflare deployment is configured by `wrangler.jsonc`; run `npm run deploy:cloudflare` only after setting `VITE_GAME_SERVER_URL` and reviewing the destination account/project. Helius credentials belong in Render environment variables and are never part of the Vite build.

## Browser targets

The layout supports desktop and mobile breakpoints. The current source assets are intentionally simple and texture-free; the complete runtime bundle is under 10 MB, while the initial world geometry is about 3.4 MB.
