import { BUSINESS, BUSINESS_STAGES, DAILY_GOALS, EPOCH_MM_BUDGET, ISLANDS, MM_EXCHANGE_BUNDLE, MM_TOTAL_SUPPLY, PLOTS, RESOURCES, SPECIALIZATIONS, SUNMARK_CODE, TUTORIAL, UPGRADE_COSTS, UPGRADE_NAMES, type BusinessStage, type LicenseKey, type ResourceKey, type SpecializationKey, type UpgradeKey } from "./data";
import { GameStore, type ActionResult } from "./state";
import { World3D } from "./world";
import { detectDeployment } from "./network";

function element<T extends HTMLElement>(selector: string): T {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`Missing required element: ${selector}`);
  return node;
}

const store = new GameStore();
const loadingScreen = element<HTMLDivElement>("#loadingScreen");
const loadingBar = element<HTMLSpanElement>("#loadingBar");
const loadingLabel = element<HTMLElement>("#loadingLabel");
const interiorModal = element<HTMLElement>("#interiorModal");
const travelOverlay = element<HTMLElement>("#travelOverlay");
const toastStack = element<HTMLElement>("#toastStack");
const canvas = element<HTMLCanvasElement>("#worldCanvas");

void detectDeployment().then((status) => {
  const network = element<HTMLElement>("#networkValue");
  network.textContent = status.label;
  network.classList.toggle("status-local", status.mode !== "unavailable");
  network.classList.toggle("status-unavailable", status.mode === "unavailable");
}).catch(() => {
  const network = element<HTMLElement>("#networkValue");
  network.textContent = "Local fallback";
  network.classList.add("status-local");
});

let activeTab = "guide";
let interiorOpen = false;
let movedOnce = false;
let activeBusinessStage: "Recommended" | BusinessStage = "Recommended";
let marketFilter: "all" | "needed" | "owned" = "all";

const RECOMMENDED_LICENSES: LicenseKey[] = ["greenhouse", "workshop", "shop"];

const world = new World3D(canvas, {
  onPlotSelected: (plotId) => {
    store.selectPlot(plotId);
    switchTab("build");
    toast(`${PLOTS.find((plot) => plot.id === plotId)?.name ?? "Plot"} selected.`);
  },
  onMoved: () => {
    if (movedOnce) return;
    movedOnce = true;
    store.markTutorial("moved");
  },
  onLoadProgress: (progress, label) => {
    loadingBar.style.width = `${Math.round(progress * 100)}%`;
    loadingLabel.textContent = label;
  },
});

world.setPositionCheckpoint(() => store.savePosition());

function formatNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 10_000) return `${(value / 1_000).toFixed(1)}K`;
  return Math.floor(value).toLocaleString();
}

function toast(message: string, warning = false): void {
  const item = document.createElement("div");
  item.className = `toast${warning ? " warning" : ""}`;
  item.textContent = message;
  toastStack.append(item);
  window.setTimeout(() => item.remove(), 3600);
}

function report(result: ActionResult): void {
  toast(result.message, !result.ok);
}

function switchTab(tab: string): void {
  activeTab = tab;
  document.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((button) => {
    const active = button.dataset.tab === tab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  document.querySelectorAll<HTMLElement>("[data-panel]").forEach((panel) => panel.classList.toggle("active", panel.dataset.panel === tab));
  element<HTMLElement>(".panel-scroll").scrollTo({ top: 0, behavior: "smooth" });
}

function resourceCosts(costs: Partial<Record<ResourceKey, number>>): string {
  return (Object.keys(RESOURCES) as ResourceKey[])
    .filter((key) => (costs[key] ?? 0) > 0)
    .map((key) => `<span>${RESOURCES[key].icon} ${costs[key]} ${RESOURCES[key].short}</span>`)
    .join("");
}

function renderHeader(): void {
  const state = store.state;
  element("#walletValue").textContent = `${formatNumber(state.wallet)} ${SUNMARK_CODE}`;
  element("#treasuryValue").textContent = `${formatNumber(state.governmentTreasury)} ${SUNMARK_CODE}`;
  element("#citizenValue").textContent = formatNumber(store.citizenCount());
  element("#reserveValue").textContent = `${formatNumber(state.mmReserve)} $MM`;
  element("#careerValue").textContent = `${store.careerLevel().name} · Lv ${store.careerLevel().level}`;
  const island = ISLANDS.find((entry) => entry.id === state.island) ?? ISLANDS[0];
  element("#districtLabel").textContent = island.district;
  element("#islandLabel").textContent = island.name;
  element("#islandEconomy").textContent = island.economy;
}

function renderTutorial(): void {
  const complete = Object.values(store.state.tutorial).filter(Boolean).length;
  const next = store.nextTutorial();
  const nextIndex = next ? TUTORIAL.findIndex(([key]) => key === next[0]) : TUTORIAL.length;
  element("#tutorialProgress").textContent = `${complete} / ${TUTORIAL.length}`;
  element<HTMLSpanElement>("#tutorialMeter").style.width = `${Math.round((complete / TUTORIAL.length) * 100)}%`;
  element("#tutorialTitle").textContent = next?.[1] ?? "Vertical slice complete";
  element("#tutorialCopy").textContent = next?.[2] ?? "Keep building, trading and exploring the archipelago.";
  const nextKey = next?.[0];
  const objective = nextKey === "moved"
    ? { action: "walk-plaza", target: "", label: "Walk to the plaza", icon: "◎" }
    : nextKey === "leased" || nextKey === "licensed" || nextKey === "built"
      ? { action: "tab", target: "build", label: "Open the build desk", icon: "⌂" }
      : nextKey === "produced" || nextKey === "upgraded"
        ? { action: "tab", target: "business", label: nextKey === "upgraded" ? "Open upgrade console" : "Run your business", icon: "▥" }
        : nextKey === "sold"
          ? { action: "tab", target: "market", label: "Visit the Civic Exchange", icon: "⇄" }
          : nextKey === "contracted"
            ? { action: "tab", target: "contracts", label: "Open the Contracts Board", icon: "✓" }
            : nextKey === "traveled"
              ? { action: "tab", target: "map", label: "Open the ferry map", icon: "◇" }
              : { action: "tab", target: "contracts", label: "Check today's orders", icon: "↗" };
  const objectiveAction = element<HTMLButtonElement>("#objectiveAction");
  objectiveAction.dataset.action = objective.action;
  objectiveAction.dataset.target = objective.target;
  objectiveAction.textContent = "Go";
  const visibleSteps = TUTORIAL.slice(Math.max(0, nextIndex), Math.min(TUTORIAL.length, nextIndex + 3));
  element("#guidePanel").innerHTML = `
    <div class="panel-kicker">Founder journey · ${complete} of ${TUTORIAL.length}</div><h2>Your next best action</h2>
    <p class="lead">The guide keeps the economy readable by showing one meaningful decision at a time.</p>
    <article class="mission-hero">
      <i>${objective.icon}</i><div><small>${next ? `Step ${nextIndex + 1}` : "Journey complete"}</small><strong>${next?.[1] ?? "Build your own strategy"}</strong><p>${next?.[2] ?? "Specialize, trade, upgrade and expand across the Reach."}</p></div>
      <button class="mission-button" data-action="${objective.action}" data-target="${objective.target}">${objective.label}<span>→</span></button>
    </article>
    ${visibleSteps.length > 1 ? `<div class="section-title">Coming next</div><div class="roadmap-preview">
      ${visibleSteps.slice(1).map(([key, title], offset) => `<div><span>${nextIndex + offset + 2}</span><p><strong>${title}</strong><small>${store.state.tutorial[key] ? "Completed" : "Unlocks after the current objective"}</small></p></div>`).join("")}
    </div>` : ""}
    <details class="journey-details"><summary>View the complete founder roadmap <span>${complete}/${TUTORIAL.length}</span></summary><div class="card-list">
      ${TUTORIAL.map(([key, title, copy], index) => `<article class="game-card ${store.state.tutorial[key] ? "done" : index === nextIndex ? "current" : ""}"><div class="card-head"><i class="card-icon" style="--card-color:${store.state.tutorial[key] ? "#62a876" : index === nextIndex ? "#d5a43d" : "#79918c"}">${store.state.tutorial[key] ? "✓" : index + 1}</i><div class="card-copy"><strong>${title}</strong><small>${copy}</small></div></div></article>`).join("")}
    </div></details>
    <div class="section-title">Company progression</div>
    <article class="career-card">
      <div class="career-heading"><i>${store.careerLevel().level}</i><div><small>Career level</small><strong>${store.careerLevel().name}</strong><span>${store.state.experience} XP${store.nextCareerLevel() ? ` · ${store.nextCareerLevel()!.xp - store.state.experience} to ${store.nextCareerLevel()!.name}` : " · Maximum rank"}</span></div><b>${store.careerProgress()}%</b></div>
      <div class="meter"><span style="width:${store.careerProgress()}%"></span></div>
      <div class="career-stats"><span>Net worth <strong>${formatNumber(store.netWorth())} ${SUNMARK_CODE}</strong></span><span>Contracts <strong>${store.state.contractsCompleted}</strong></span><span>Reputation <strong>${store.state.reputation}</strong></span></div>
    </article>
    <div class="section-title">Today's enterprise goals</div>
    <article class="daily-card ${store.dailyComplete() ? "complete" : ""}">
      <div class="daily-goals"><span class="${store.state.daily.jobs >= DAILY_GOALS.jobs ? "done" : ""}">Production <b>${Math.min(store.state.daily.jobs, DAILY_GOALS.jobs)}/${DAILY_GOALS.jobs}</b></span><span class="${store.state.daily.contracts >= DAILY_GOALS.contracts ? "done" : ""}">Contracts <b>${Math.min(store.state.daily.contracts, DAILY_GOALS.contracts)}/${DAILY_GOALS.contracts}</b></span><span class="${store.state.daily.trades >= DAILY_GOALS.trades ? "done" : ""}">Trades <b>${Math.min(store.state.daily.trades, DAILY_GOALS.trades)}/${DAILY_GOALS.trades}</b></span></div>
      <div class="daily-reward"><div><small>Civic development dividend</small><strong>${DAILY_GOALS.reward} ${SUNMARK_CODE} · ${DAILY_GOALS.xp} XP</strong></div><button data-action="claim-daily" ${!store.dailyComplete() || store.state.daily.claimed ? "disabled" : ""}>${store.state.daily.claimed ? "Claimed" : "Claim reward"}</button></div>
    </article>
    <div class="section-title">Economic activity</div>
    <div class="activity-feed">
      ${store.state.feed.slice(0, 5).map((entry) => `<div class="feed-item ${entry.tone}">${entry.text}</div>`).join("")}
    </div>
  `;
}

function renderSelectedPlot(): void {
  const state = store.state;
  const plot = PLOTS.find((entry) => entry.id === state.selectedPlotId) ?? null;
  element("#selectedPlotName").textContent = plot?.name ?? "No plot selected";
  let status = "Click a glowing plot";
  if (plot) status = plot.id === state.ownedPlotId ? "Your active lease" : `Available · ${plot.price} ${SUNMARK_CODE}`;
  element("#selectedPlotStatus").textContent = status;
  const lease = element<HTMLButtonElement>("#leaseAction");
  const build = element<HTMLButtonElement>("#buildAction");
  const enter = element<HTMLButtonElement>("#enterAction");
  lease.disabled = !plot || Boolean(state.ownedPlotId);
  build.disabled = !state.ownedPlotId || !state.license || state.buildingPlaced;
  enter.disabled = !state.buildingPlaced;
  world.setSelectedPlot(state.selectedPlotId, state.ownedPlotId);
}

function renderBuild(): void {
  const state = store.state;
  const selectedPlot = PLOTS.find((entry) => entry.id === state.selectedPlotId);
  const owned = PLOTS.find((entry) => entry.id === state.ownedPlotId);
  const filters: Array<"Recommended" | BusinessStage> = ["Recommended", ...BUSINESS_STAGES];
  const visibleLicenses = activeBusinessStage === "Recommended"
    ? RECOMMENDED_LICENSES
    : (Object.keys(BUSINESS) as LicenseKey[]).filter((key) => BUSINESS[key].stage === activeBusinessStage);
  const recommendation: Partial<Record<LicenseKey, string>> = {
    greenhouse: "Gentle renewable production loop",
    workshop: "Essential supplier with broad demand",
    shop: "Simple citizen-facing trading business",
  };
  let intro = "Select a glowing 16 × 14 m starter plot in Hearthmarket.";
  if (owned) intro = `${owned.name} is leased. Choose the role this plot will serve in the regional economy.`;
  element("#buildPanel").innerHTML = `
    <div class="panel-kicker">Enterprise builder</div><h2>Plot &amp; business</h2>
    <p class="lead">${intro}</p>
    ${!state.ownedPlotId ? `<article class="game-card selected">
      <div class="card-head"><i class="card-icon" style="--card-color:#d5a43d">⌂</i><div class="card-copy"><strong>${selectedPlot?.name ?? "Select a plot"}</strong><small>${selectedPlot ? `${selectedPlot.width} × ${selectedPlot.depth} m · ${selectedPlot.price} ${SUNMARK_CODE}` : "Click a plot in the 3D world"}</small></div></div>
      <button data-action="lease" ${selectedPlot ? "" : "disabled"}>Lease selected plot</button>
    </article>` : ""}
    <div class="section-title">Choose a place in the economy</div>
    <div class="supply-chain-strip" aria-label="Economic supply chain"><span>Utilities</span><b>→</b><span>Inputs</span><b>→</b><span>Industry</span><b>→</b><span>Commerce</span><b>→</b><span>Citizens</span><b>↺</b><span>Recovery</span></div>
    <div class="filter-strip" aria-label="Business categories">${filters.map((filter) => `<button class="${activeBusinessStage === filter ? "active" : ""}" data-action="business-filter" data-filter="${filter}">${filter}</button>`).join("")}</div>
    <div class="selection-summary"><strong>${activeBusinessStage}</strong><span>${visibleLicenses.length} ${visibleLicenses.length === 1 ? "license" : "licenses"}</span></div>
    <div class="business-grid">${visibleLicenses.map((key) => {
      const config = BUSINESS[key];
      const selected = state.license === key;
      return `<article class="game-card business-card ${selected ? "selected" : ""}" style="--card-color:${config.color}">
        <div class="card-head"><i class="card-icon">${config.icon}</i><div class="card-copy"><strong>${config.name}</strong><small>${config.stage} · ${config.islandAffinity}</small></div></div>
        ${recommendation[key] ? `<div class="recommendation">★ ${recommendation[key]}</div>` : ""}
        <p>${config.copy}</p>
        <div class="business-costs"><span>${config.licenseCost} ${SUNMARK_CODE} license</span><span>${config.laborCost} ${SUNMARK_CODE} payroll</span><span>${config.duration}s cycle</span></div>
        <div class="flow-row"><div><small>Uses</small>${resourceCosts(config.inputs) || "<span>Demand</span>"}</div><b>→</b><div><small>Makes</small>${resourceCosts(config.output) || "<span>Service</span>"}</div></div>
        <details class="ecosystem-details"><summary>View supply-chain role</summary><div class="ecosystem"><div><small>Upstream</small><span>${config.ecosystem.upstream}</span></div><div><small>Process</small><span>${config.ecosystem.process}</span></div><div><small>Downstream</small><span>${config.ecosystem.downstream}</span></div></div></details>
        <button data-action="license" data-license="${key}" aria-label="Choose ${config.name}" ${!state.ownedPlotId || Boolean(state.license) || state.buildingPlaced ? "disabled" : ""}>${selected ? "Selected · license locked" : state.license ? "Another license selected" : `Choose ${config.name}`}</button>
      </article>`;
    }).join("")}</div>
    ${state.license && !state.buildingPlaced ? `<div class="section-title">Publish the structure</div><article class="game-card selected"><p>The corresponding official B01–B08 3D model will be fitted to your leased plot.</p><button data-action="build">Build ${BUSINESS[state.license].name}</button></article>` : ""}
  `;
}

function jobMarkup(): string {
  const state = store.state;
  if (!state.job || !state.license) return `<button class="operation-cta" data-action="start-job">Start production job</button>`;
  const remaining = Math.max(0, state.job.completeAt - Date.now());
  const total = Math.max(1, state.job.completeAt - state.job.startedAt);
  const progress = Math.min(100, Math.round((1 - remaining / total) * 100));
  return `<div class="job-status"><div><strong>${remaining > 0 ? "Production underway" : "Output ready"}</strong><span>${progress}%</span></div><div class="meter"><span style="width:${progress}%"></span></div><p>${remaining > 0 ? `${Math.ceil(remaining / 1000)} seconds remaining` : "Collect the finished output and choose its next market."}</p><button class="operation-cta" data-action="collect-job" ${remaining > 0 ? "disabled" : ""}>${remaining > 0 ? "Working…" : "Collect output"}</button></div>`;
}

function renderBusiness(): void {
  const state = store.state;
  if (!state.buildingPlaced || !state.license) {
    element("#businessPanel").innerHTML = `<h2>Business operations</h2><p class="lead">Lease a plot, choose a license and construct a building to unlock production.</p><button class="primary-button" data-action="tab" data-target="build">Open build panel</button>`;
    return;
  }
  const config = BUSINESS[state.license];
  const cycles = 1 + state.upgrades.capacity;
  const requiredInputs = Object.entries(config.inputs) as Array<[ResourceKey, number]>;
  const missingInputs = requiredInputs.map(([key, amount]) => ({ key, amount: Math.max(0, amount * cycles - state.inventory[key]) })).filter(({ amount }) => amount > 0);
  const inputMarkup = resourceCosts(Object.fromEntries(Object.entries(config.inputs).map(([key, value]) => [key, (value ?? 0) * cycles])));
  const economics = store.unitEconomics()!;
  const qualityBonus = state.specialization === "premium" ? .1 : 0;
  const outputMarkup = config.servicePayout
    ? `<span>${economics.visitors} expected visits · ${economics.expectedRevenue} ${SUNMARK_CODE} gross</span>`
    : `${resourceCosts(Object.fromEntries(Object.entries(config.output).map(([key, value]) => [key, Math.max((value ?? 0) * cycles, Math.round((value ?? 0) * cycles * (1 + state.upgrades.yield * .12 + qualityBonus)))])))}${config.wastePerCycle ? `<span>♻ ${config.wastePerCycle * cycles} Scrap</span>` : ""}`;
  element("#businessPanel").innerHTML = `
    <div class="panel-kicker">Operations center</div><h2>${config.name}</h2><p class="lead">${config.copy}</p>
    <div class="stat-grid">
      <div class="stat"><small>Condition</small><strong>${Math.round(state.condition)}%</strong></div>
      <div class="stat"><small>Jobs completed</small><strong>${state.jobsCompleted}</strong></div>
      <div class="stat"><small>Lifetime revenue</small><strong>${formatNumber(state.lifetimeRevenue)} ${SUNMARK_CODE}</strong></div>
      <div class="stat"><small>Visitors served</small><strong>${formatNumber(state.visitorsServed)}</strong></div>
    </div>
    <div class="section-title">Next operating job · ${cycles} cycle${cycles === 1 ? "" : "s"}</div>
    <article class="game-card operation-card"><div class="readiness ${missingInputs.length ? "blocked" : "ready"}"><i>${missingInputs.length ? "!" : "✓"}</i><div><strong>${missingInputs.length ? "Inputs missing" : "Ready to operate"}</strong><small>${missingInputs.length ? "Buy the exact shortfall below." : `Payroll of ${economics.laborCost} ${SUNMARK_CODE} will return to AI-citizen households.`}</small></div></div><small>Inputs</small><div class="cost-row">${inputMarkup || "<span>No input</span>"}</div>${missingInputs.length ? `<div class="quick-buy"><small>Quick buy</small>${missingInputs.map(({ key, amount }) => `<button data-action="quick-buy" data-resource="${key}" data-quantity="${amount}">${RESOURCES[key].icon} Buy ${amount} ${RESOURCES[key].short} · ${store.marketBuyPrice(key) * amount} ${SUNMARK_CODE}</button>`).join("")}</div>` : ""}<small>Output / settlement</small><div class="cost-row">${outputMarkup || "<span>Service income</span>"}</div>${jobMarkup()}</article>
    <div class="section-title">Expected unit economics</div>
    <div class="stat-grid economics-grid"><div class="stat"><small>Input cost</small><strong>${economics.inputCost}</strong></div><div class="stat"><small>Payroll</small><strong>${economics.laborCost}</strong></div><div class="stat"><small>Gross revenue</small><strong>${economics.expectedRevenue}</strong></div><div class="stat ${economics.expectedProfit >= 0 ? "positive" : "negative"}"><small>Profit after 5% tax</small><strong>${economics.expectedProfit}</strong></div></div>
    ${config.servicePayout ? `<div class="section-title">Citizen-facing price</div><article class="game-card"><p>Higher prices earn more per visit but reduce attendance according to this service's demand elasticity (${config.priceElasticity?.toFixed(2)}).</p><div class="price-choices">${[.85, 1, 1.15, 1.3].map((index) => `<button class="${Math.abs(state.servicePriceIndex - index) < .01 ? "active" : "secondary"}" data-action="service-price" data-price="${index}">${Math.round(index * 100)}%</button>`).join("")}</div></article>` : ""}
    <div class="section-title">Operating specialization</div>
    ${state.specialization ? `<article class="specialization-selected" style="--special-color:${SPECIALIZATIONS[state.specialization].color}"><i>${SPECIALIZATIONS[state.specialization].icon}</i><div><small>Permanent company model</small><strong>${SPECIALIZATIONS[state.specialization].name}</strong><p>${SPECIALIZATIONS[state.specialization].summary}</p></div></article>` : `<div class="specialization-grid">${(Object.keys(SPECIALIZATIONS) as SpecializationKey[]).map((key) => { const option = SPECIALIZATIONS[key]; return `<article style="--special-color:${option.color}"><i>${option.icon}</i><strong>${option.name}</strong><p>${option.summary}</p><small>${option.tradeoff}</small><button data-action="specialize" data-specialization="${key}" ${store.careerLevel().level < 2 ? "disabled" : ""}>${store.careerLevel().level < 2 ? `Unlocks at ${store.nextCareerLevel()?.name ?? "level 2"}` : "Choose permanently"}</button></article>`; }).join("")}</div>`}
    <div class="section-title">Building access</div>
    <article class="game-card"><p>Walk near your 3D building to enter and improve its equipment, capacity, speed or customer appeal.</p><button data-action="interior">Enter business interior</button></article>
    <article class="game-card"><p>Equipment condition falls as production runs. Maintenance costs 20 ${SUNMARK_CODE} and one Utility Part.</p><button class="secondary" data-action="maintain">Run maintenance</button></article>
  `;
}

function renderMarket(): void {
  const confidence = store.consumerConfidenceIndex();
  const priceIndex = store.marketPriceIndex();
  const allKeys = Object.keys(RESOURCES) as ResourceKey[];
  const neededKeys = store.state.license ? Object.keys(BUSINESS[store.state.license].inputs) as ResourceKey[] : [];
  const visibleKeys = marketFilter === "needed"
    ? allKeys.filter((key) => neededKeys.includes(key))
    : marketFilter === "owned"
      ? allKeys.filter((key) => store.state.inventory[key] > 0)
      : allKeys;
  element("#marketPanel").innerHTML = `
    <div class="panel-kicker">Regional marketplace</div><h2>Civic Exchange</h2>
    <p class="lead">All daily prices, wages and taxes use <strong>Sunmarks (${SUNMARK_CODE})</strong>. $MM is the scarce reserve asset held for long-term wealth and currency backing.</p>
    <div class="economic-dashboard"><div><small>Market price index</small><strong>${priceIndex}</strong><span>${priceIndex > 100 ? "+" : ""}${priceIndex - 100}% vs opening basket</span></div><div><small>Consumer confidence</small><strong>${confidence}</strong><span>Wages, visits and liquidity</span></div><div><small>Business cycle</small><strong>${store.economicPhase()}</strong><span>Activity trend ${store.economyTrend()}</span></div><div><small>Monetary policy</small><strong>${store.monetaryPolicyPhase()}</strong><span>${store.reserveBackingRatio().toFixed(2)}% $MM reserve coverage</span></div></div>
    <section class="reserve-desk">
      <div class="reserve-heading"><div><small>Contribution Board</small><strong>Epoch Distribution</strong></div><span>${formatNumber(EPOCH_MM_BUDGET)} $MM budget</span></div>
      <p>$MM is <strong>earned, never bought</strong>. Each epoch pays out one fixed budget, divided by contribution share &mdash; so working harder raises <em>your slice</em>, never the amount released.</p>
      <div class="epoch-meter" role="img" aria-label="Your share of this epoch's contribution pool: ${(store.epochShare() * 100).toFixed(2)} percent">
        <div class="epoch-fill" style="width:${Math.min(100, store.epochShare() * 100).toFixed(2)}%"></div>
      </div>
      <div class="reserve-balance">
        <div><small>Your contribution</small><strong>${formatNumber(Math.round(store.state.epoch.contribution))}</strong></div>
        <div><small>Your share</small><strong>${(store.epochShare() * 100).toFixed(2)}%</strong></div>
        <div><small>Projected payout</small><strong>${formatNumber(store.projectedEpochMM())} $MM</strong></div>
        <div><small>Held / lifetime earned</small><strong>${formatNumber(store.state.mmHoldings)} / ${formatNumber(store.state.lifetimeMMEarned)}</strong></div>
      </div>
      <p class="epoch-note">Fulfilling a named buyer's order is worth <strong>10&times;</strong> what dumping the same value on the civic supplier is. Everyone else in the realm is contributing too &mdash; their effort dilutes your share, and yours dilutes theirs.</p>
      <div class="reserve-actions">
        <button data-action="claim-epoch" ${store.state.epoch.claimed || store.projectedEpochMM() <= 0 ? "disabled" : ""}>${store.state.epoch.claimed ? "Epoch already claimed" : `Claim ${formatNumber(store.projectedEpochMM())} $MM`}</button>
        <button class="secondary" data-action="sell-mm" ${store.state.mmHoldings < MM_EXCHANGE_BUNDLE ? "disabled" : ""}>Spend ${MM_EXCHANGE_BUNDLE} $MM <small>${store.reserveSellPayout()} ${SUNMARK_CODE}</small></button>
      </div>
      <small class="reserve-boundary">Prototype accounting only: no on-chain transfer, no redemption, and no promise of price or profit.</small>
    </section>
    <div class="filter-strip market-filter" aria-label="Market inventory filter"><button class="${marketFilter === "all" ? "active" : ""}" data-action="market-filter" data-filter="all">All goods</button><button class="${marketFilter === "needed" ? "active" : ""}" data-action="market-filter" data-filter="needed">Needed now${neededKeys.length ? ` · ${neededKeys.length}` : ""}</button><button class="${marketFilter === "owned" ? "active" : ""}" data-action="market-filter" data-filter="owned">My stock</button></div>
    <div class="market-legend"><span>Item &amp; economic role</span><span>Local quote · ${SUNMARK_CODE}</span><span>Trade</span></div>
    <div class="card-list market-list">
      ${visibleKeys.map((key) => {
        const resource = RESOURCES[key];
        const pressure = Math.round((store.state.marketPressure[key] - 1) * 100);
        const trend = pressure > 4 ? "scarce" : pressure < -4 ? "surplus" : "stable";
        return `<div class="market-row" style="--resource-color:${resource.color}"><i>${resource.icon}</i><div class="market-name"><strong>${resource.name}</strong><small>${resource.tier} · ${resource.buyer === "citizens" ? "Households" : "Civic"} ${store.procurementRemaining(key)}/${store.dailyQuota(key)} at full price</small></div><div class="market-quote"><strong>${store.marketBuyPrice(key)} <small>buy</small></strong><span>${store.marketSellPrice(key)} sell · hold ${store.state.inventory[key]}</span><em class="${trend}">${pressure > 0 ? "+" : ""}${pressure}% ${trend}</em></div><div class="market-actions"><button data-action="buy" data-resource="${key}">Buy 1</button><button class="sell" data-action="sell" data-resource="${key}">Sell 1</button></div></div>`;
      }).join("")}
      ${visibleKeys.length ? "" : `<div class="empty-state"><i>⇄</i><strong>No goods in this view</strong><p>${marketFilter === "needed" ? "Choose a business license to reveal its required inputs." : "Produce or buy something to build your stock."}</p><button data-action="market-filter" data-filter="all">Show all goods</button></div>`}
    </div>
    <div class="section-title">Ledger health</div>
    <div class="stat-grid"><div class="stat"><small>Civic treasury</small><strong>${formatNumber(store.state.governmentTreasury)} ${SUNMARK_CODE}</strong></div><div class="stat"><small>Citizen spending pool</small><strong>${formatNumber(store.state.citizenPool)} ${SUNMARK_CODE}</strong></div><div class="stat"><small>Payroll returned to citizens</small><strong>${formatNumber(store.state.laborPaid)} ${SUNMARK_CODE}</strong></div><div class="stat"><small>Your tax paid</small><strong>${formatNumber(store.state.taxPaid)} ${SUNMARK_CODE}</strong></div><div class="stat"><small>$MM accounted in game</small><strong>${formatNumber(store.totalMMInGameVaults())}</strong></div><div class="stat"><small>Total $MM supply</small><strong>${formatNumber(MM_TOTAL_SUPPLY)}</strong></div></div>
    <p class="model-note">Sunmark prices are bounded and mean-reverting. $MM is never required for leases, payroll, inputs, services or taxes. This remains a gameplay simulation—not a promise of token value, yield or profit.</p>
  `;
}

function renderContracts(): void {
  const active = store.state.activeContract;
  const offers = store.contractOffers();
  const activeResource = active ? RESOURCES[active.resource] : null;
  const shortfall = active ? Math.max(0, active.quantity - store.state.inventory[active.resource]) : 0;
  element("#contractsPanel").innerHTML = `
    <div class="panel-kicker">Trade Guild order book</div><h2>Contracts Board</h2>
    <p class="lead">Orders turn market demand into clear objectives. Payment always comes from an existing household or public budget—contract rewards never mint Sunmarks.</p>
    <div class="economic-dashboard"><div><small>Economic cycle</small><strong>${store.economicPhase()}</strong><span>Trend ${store.economyTrend()}</span></div><div><small>Company rank</small><strong>Level ${store.careerLevel().level}</strong><span>${store.careerLevel().name}</span></div><div><small>Track record</small><strong>${store.state.contractsCompleted}</strong><span>Completed orders</span></div></div>
    ${active && activeResource ? `<div class="section-title">Active commitment</div><article class="active-contract" style="--contract-color:${activeResource.color}">
      <div class="contract-head"><i>${activeResource.icon}</i><div><small>${active.buyer === "citizens" ? "Household demand" : "Institutional procurement"}</small><strong>${active.buyerName}</strong><span>${active.quantity} ${activeResource.short} · ${active.grossReward} ${SUNMARK_CODE} gross</span></div><b>+${active.bonusPercent}%</b></div>
      <div class="contract-progress"><div><span>Inventory ready</span><strong>${Math.min(store.state.inventory[active.resource], active.quantity)} / ${active.quantity}</strong></div><div class="meter"><span style="width:${Math.min(100, (store.state.inventory[active.resource] / active.quantity) * 100)}%"></span></div></div>
      ${shortfall ? `<button class="contract-supply" data-action="quick-buy" data-resource="${active.resource}" data-quantity="${shortfall}">Buy ${shortfall} missing ${activeResource.short} · ${shortfall * store.marketBuyPrice(active.resource)} ${SUNMARK_CODE}</button>` : ""}
      <div class="contract-actions"><button data-action="fulfill-contract" ${shortfall ? "disabled" : ""}>Deliver order · earn ${active.grossReward - Math.floor(active.grossReward * .05)} ${SUNMARK_CODE}</button><button class="secondary" data-action="release-contract">Release · −1 reputation</button></div>
    </article>` : ""}
    <div class="section-title">Verified offers</div>
    <div class="contract-list">${offers.map((offer) => { const resource = RESOURCES[offer.resource]; const held = store.state.inventory[offer.resource]; return `<article class="contract-card" style="--contract-color:${resource.color}">
      <div class="contract-head"><i>${resource.icon}</i><div><small>${offer.buyer === "citizens" ? "Household demand" : "Institutional procurement"}</small><strong>${offer.buyerName}</strong><span>${offer.quantity} ${resource.short} · hold ${held}</span></div><b>+${offer.bonusPercent}%</b></div>
      <div class="contract-value"><span>Gross payment <strong>${offer.grossReward} ${SUNMARK_CODE}</strong></span><span>Reputation <strong>+${offer.reputationReward}</strong></span><span>Career XP <strong>+${offer.xpReward}</strong></span></div>
      <button data-action="accept-contract" data-contract="${offer.id}" ${active ? "disabled" : ""}>${active ? "One active order allowed" : "Accept contract"}</button>
    </article>`; }).join("")}</div>
    <button class="refresh-board" data-action="refresh-contracts">Refresh verified offers · 5 ${SUNMARK_CODE}</button>
    <p class="model-note">Contract bonuses reward planning and reliability. Public orders are bounded by the civic treasury; household orders are bounded by earned wages and citizen liquidity.</p>
  `;
}

function renderMap(): void {
  const mapNodes = ISLANDS.map((island) => {
    const x = 50 + island.x / 4.55;
    const y = 50 + island.z / 4.35;
    const current = store.state.island === island.id;
    return `<button class="map-node ${current ? "current" : ""}" style="--map-x:${x}%;--map-y:${y}%;--island-color:${island.color}" data-action="travel" data-island="${island.id}" ${current ? "disabled" : ""} aria-label="Travel to ${island.name}"><i></i><span>${island.name}</span></button>`;
  }).join("");
  element("#mapPanel").innerHTML = `
    <div class="panel-kicker">Nine connected economies</div><h2>The Sunwoven Reach</h2><p class="lead">Ferries link the civic heart to eight specialist districts. Your business keeps producing while you explore.</p>
    <div class="archipelago-map"><div class="trade-ring ring-one"></div><div class="trade-ring ring-two"></div>${mapNodes}<div class="map-compass">N</div></div>
    <div class="card-list">${ISLANDS.map((island) => `<div class="island-row" style="--island-color:${island.color}"><i class="island-dot"></i><div><strong>${island.name}</strong><small>${island.district} · ${island.economy}</small></div><button data-action="travel" data-island="${island.id}" ${store.state.island === island.id ? "disabled" : ""}>${store.state.island === island.id ? "Here" : store.state.tutorial.traveled ? `10 ${SUNMARK_CODE}` : "Free"}</button></div>`).join("")}</div>
  `;
}

function renderResources(): void {
  element("#resourceDock").innerHTML = (Object.keys(RESOURCES) as ResourceKey[]).map((key) => {
    const resource = RESOURCES[key];
    return `<div class="resource-chip" style="--resource-color:${resource.color}"><i>${resource.icon}</i><div><small>${resource.short}</small><strong>${store.state.inventory[key]}</strong></div><span>${store.marketBuyPrice(key)} ${SUNMARK_CODE}</span></div>`;
  }).join("");
}

function renderInterior(): void {
  if (!interiorOpen || !store.state.license) return;
  const config = BUSINESS[store.state.license];
  element("#interiorTitle").textContent = config.name;
  element("#interiorStage").innerHTML = `<div class="interior-room"><h3>${config.name}</h3><p>${config.copy} Installed modules visibly represent the systems that improve yield, capacity, turnaround and citizen demand.</p><div class="machine-grid">${(Object.keys(UPGRADE_NAMES) as UpgradeKey[]).map((key) => `<div class="machine" style="--machine-color:${config.color}"><i>${UPGRADE_NAMES[key].icon}</i><strong>${UPGRADE_NAMES[key].name}</strong><small>${UPGRADE_NAMES[key].effect}<br>Installed level: ${store.state.upgrades[key]} / 3</small></div>`).join("")}</div></div>`;
  element("#interiorConsole").innerHTML = `<h2>Equipment upgrades</h2><p class="lead">Improvements consume Sunmarks and player-economy resources.</p><div class="upgrade-list">${(Object.keys(UPGRADE_NAMES) as UpgradeKey[]).map((key) => {
    const level = store.state.upgrades[key];
    const next = Math.min(3, level + 1);
    const cost = UPGRADE_COSTS[next];
    return `<article class="game-card"><div class="card-head"><i class="card-icon" style="--card-color:${config.color}">${UPGRADE_NAMES[key].icon}</i><div class="card-copy"><strong>${UPGRADE_NAMES[key].name} · Lv ${level}</strong><small>${UPGRADE_NAMES[key].effect}</small></div></div><div class="cost-row"><span>${cost.sunmarks} ${SUNMARK_CODE}</span>${resourceCosts(cost.resources)}</div><button data-action="upgrade" data-upgrade="${key}" ${level >= 3 ? "disabled" : ""}>${level >= 3 ? "Maximum level" : `Install level ${next}`}</button></article>`;
  }).join("")}</div>`;
}

function renderAll(): void {
  renderHeader();
  renderTutorial();
  renderSelectedPlot();
  renderBuild();
  renderBusiness();
  renderMarket();
  renderContracts();
  renderMap();
  renderResources();
  renderInterior();
  void world.syncBuilding(store.state);
}

function openInterior(): void {
  if (!store.state.buildingPlaced || !store.state.license) {
    toast("Build your business first.", true);
    return;
  }
  if (!world.isNearOwnedBusiness(store.state)) {
    toast("Walk closer to your business entrance.", true);
    return;
  }
  interiorOpen = true;
  interiorModal.classList.add("show");
  interiorModal.setAttribute("aria-hidden", "false");
  renderInterior();
}

function closeInterior(): void {
  interiorOpen = false;
  interiorModal.classList.remove("show");
  interiorModal.setAttribute("aria-hidden", "true");
}

function travelTo(islandId: string): void {
  const destination = ISLANDS.find((island) => island.id === islandId);
  if (!destination) return;
  const result = store.travelTo(islandId);
  if (!result.ok) {
    report(result);
    return;
  }
  travelOverlay.classList.add("show");
  travelOverlay.setAttribute("aria-hidden", "false");
  element("#travelDestination").textContent = destination.name;
  const bar = element<HTMLSpanElement>("#travelBar");
  bar.style.width = "0";
  requestAnimationFrame(() => { bar.style.width = "100%"; });
  window.setTimeout(() => {
    world.teleportToState(store.state);
    travelOverlay.classList.remove("show");
    travelOverlay.setAttribute("aria-hidden", "true");
    switchTab("map");
    toast(result.message);
  }, 1250);
}

document.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((button) => button.addEventListener("click", () => switchTab(button.dataset.tab ?? "guide")));
element("#leaseAction").dataset.action = "lease";
element("#buildAction").dataset.action = "build";
element("#enterAction").dataset.action = "interior";
element("#closeInterior").addEventListener("click", closeInterior);
window.addEventListener("keydown", (event) => {
  if (event.code === "Escape" && interiorOpen) closeInterior();
  if (event.altKey && ["Digit1", "Digit2", "Digit3", "Digit4", "Digit5", "Digit6"].includes(event.code)) {
    event.preventDefault();
    switchTab(["guide", "build", "business", "market", "contracts", "map"][Number(event.code.at(-1)) - 1]);
  }
});

document.body.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-action]");
  if (!button || button.disabled) return;
  const action = button.dataset.action;
  if (action === "lease") report(store.leaseSelectedPlot());
  else if (action === "license") report(store.chooseLicense(button.dataset.license as LicenseKey));
  else if (action === "build") {
    const result = store.placeBuilding();
    report(result);
    if (result.ok && store.state.ownedPlotId) {
      const plot = PLOTS.find((entry) => entry.id === store.state.ownedPlotId);
      if (plot) {
        store.updatePlayer(plot.island, plot.x, plot.z + plot.depth / 2 + 3);
        store.savePosition();
        world.teleportToState(store.state);
      }
    }
  }
  else if (action === "start-job") report(store.startJob());
  else if (action === "collect-job") report(store.collectJob());
  else if (action === "maintain") report(store.maintainBusiness());
  else if (action === "quick-buy") report(store.buyResource(button.dataset.resource as ResourceKey, Number(button.dataset.quantity ?? 1)));
  else if (action === "buy") report(store.buyResource(button.dataset.resource as ResourceKey));
  else if (action === "sell") report(store.sellResource(button.dataset.resource as ResourceKey));
  else if (action === "claim-epoch") report(store.claimEpochRewards());
  else if (action === "sell-mm") report(store.sellMMToReserve());
  else if (action === "accept-contract") report(store.acceptContract(button.dataset.contract ?? ""));
  else if (action === "fulfill-contract") report(store.fulfillContract());
  else if (action === "release-contract") report(store.releaseContract());
  else if (action === "refresh-contracts") report(store.refreshContracts());
  else if (action === "claim-daily") report(store.claimDailyReward());
  else if (action === "service-price") report(store.setServicePrice(Number(button.dataset.price)));
  else if (action === "upgrade") report(store.purchaseUpgrade(button.dataset.upgrade as UpgradeKey));
  else if (action === "specialize") report(store.chooseSpecialization(button.dataset.specialization as SpecializationKey));
  else if (action === "travel") travelTo(button.dataset.island ?? "");
  else if (action === "interior") openInterior();
  else if (action === "tab") switchTab(button.dataset.target ?? "guide");
  else if (action === "walk-plaza") world.walkTo(0, 0);
  else if (action === "business-filter") {
    activeBusinessStage = button.dataset.filter as "Recommended" | BusinessStage;
    renderBuild();
  }
  else if (action === "market-filter") {
    marketFilter = button.dataset.filter as typeof marketFilter;
    renderMarket();
  }
});

element("#resetButton").addEventListener("click", () => {
  if (!window.confirm("Reset the current local world and begin again?")) return;
  store.reset();
  window.location.reload();
});

store.subscribe(renderAll);
renderAll();

try {
  await world.load();
  world.teleportToState(store.state);
  await world.syncBuilding(store.state);
  world.start(store.state);
  window.setTimeout(() => loadingScreen.classList.add("hidden"), 260);
} catch (error) {
  loadingLabel.textContent = "The 3D world could not be loaded. Check the local server and asset paths.";
  console.error(error);
}

window.setInterval(() => {
  if (store.state.job || interiorOpen || activeTab === "business") {
    renderBusiness();
    renderInterior();
  }
}, 500);
