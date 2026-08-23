# MMO economy UI reference — v0.4

This pass borrows interaction principles from established economy-heavy MMOs without copying their skins, wording, icons, or layouts. Markets & Makers remains a warm, readable solarpunk game rather than a spreadsheet simulator.

## Reference patterns used

### EVE Online — hierarchy and configurable density

Official EVE UI notes emphasize consistent typography and color, clearer hierarchy, consolidated secondary actions, compact views, and keeping important information readable inside complex windows.

- [EVE UI Tips & Tricks](https://support.eveonline.com/hc/en-us/articles/7264100568220-User-Interface-Tips-and-Tricks)
- [Photon UI: Iterating and Improving](https://www.eveonline.com/news/view/photon-ui-iterating-and-improving)
- [EVE Evolved: Neocom upgrades and more](https://www.eveonline.com/news/view/eve-evolved-neocom-upgrades-and-more)

Applied here:

- Five permanent top-level destinations with both symbols and labels.
- One visual hierarchy across missions, business operations, market quotes, and map travel.
- Secondary supply-chain explanations collapse into details instead of competing with the primary action.
- Economic indicators remain visible, but the player sees only the goods or business category they currently need.

### Albion Online — local economies and readable market decisions

Albion's official marketplace and world guides describe category filters, search/filterable local markets, visible item information, local-city specialization, partial order fulfillment, and warnings when a quote is far from a local average.

- [Albion Online's Marketplace](https://albiononline.com/news/albion-onlines-marketplace)
- [The World of Albion](https://albiononline.com/news/guide-world-albion)
- [The Black Market](https://albiononline.com/news/video-black-market-feature)

Applied here:

- Business licenses are browsed by their place in the supply chain.
- Each good shows its buyer class, local buy/sell quote, owned quantity, and scarcity signal.
- Island identity remains attached to each license and to ferry travel.
- Government fallback demand is visually distinct from AI-citizen final demand.

### RuneScape Grand Exchange — approachable trading

The Grand Exchange organizes trades around a small number of obvious actions, guide prices, offer status, history, and quick quantity controls.

- [RuneScape Wiki: Grand Exchange](https://runescape.wiki/w/Grand_Exchange)
- [Old School RuneScape Grand Exchange design post](https://oldschool.runescape.wiki/w/Update%3ADev_Blog%3A_The_Grand_Exchange)

Applied here:

- Buy and Sell are direct, stable actions on every resource row.
- “Needed now” and “My stock” filters replace a long undifferentiated commodity list.
- Business operations offer exact shortfall purchases rather than making the player calculate quantities manually.

### Prosperous Universe — production readiness and queues

The official handbook shows production lines with required inputs, order size, queue status, time remaining, fees, condition, and workforce efficiency. It also keeps production, inventory, contracts, fleets, and map navigation as complementary destinations.

- [Production guide](https://handbook.apex.prosperousuniverse.com/tutorials/legacy-tutorials/production/)
- [Interface guide](https://handbook.apex.prosperousuniverse.com/tutorials/current-tutorials/07-interface-guide/index.html)
- [Efficiency factors](https://handbook.apex.prosperousuniverse.com/wiki/efficiency-factors/)

Applied here:

- Operations begin with a green “ready” or amber “inputs missing” state.
- Input requirements, output, payroll, progress, and expected unit economics share one operations card.
- The production progress bar names the current state and makes collection the next primary action.
- Condition and upgrades remain part of production performance instead of becoming disconnected minigames.

## Markets & Makers-specific rules

1. One primary action per panel viewport.
2. New players see three recommended starter businesses; the full fifteen remain one category click away.
3. The guide shows one active objective, two upcoming objectives, and a collapsed complete roadmap.
4. MMO depth is progressively disclosed: first action, then economics, then ecosystem detail.
5. Touch targets are at least 40 px in management panels and 52 px in mobile navigation.
6. The 3D world remains the dominant surface. Management panels do not replace spatial play.
7. Solarpunk color, landscape, buildings, and civic language remain original to this game.

