import { BREAKDOWN_REPAIR_COST, BREAKDOWN_REPAIR_PARTS, BUSINESS, BUSINESS_STAGES, DAILY_GOALS, EPOCH_MM_BUDGET, ISLANDS, MM_EXCHANGE_BUNDLE, MM_TOTAL_SUPPLY, PLOTS, RESOURCES, SPECIALIZATIONS, SUNMARK_CODE, TUTORIAL, UPGRADE_COSTS, UPGRADE_NAMES, type BusinessStage, type LicenseKey, type ResourceKey, type SpecializationKey, type UpgradeKey } from "./data";
import { GameStore, type ActionResult } from "./state";
import { World3D } from "./world";
import { detectDeployment, fetchDistrictBoard, RealmConnection, type DistrictQuote, type RealmStatus } from "./network";
import { currentPrincipal, fetchStanding, signIn, signOut, walletAvailable, type EpochStanding, type Principal } from "./wallet";

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

// Replay the time the player was away, on load and whenever they come back to the tab.
store.catchUp();
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  const shift = store.catchUp();
  if (shift.jobs > 0) toast(`${shift.jobs} job${shift.jobs === 1 ? "" : "s"} ran while you were away.`);
  renderAll();
});
window.setInterval(() => { if (store.catchUp().jobs > 0) renderAll(); }, 60_000);

let peerCount = 0;
let districtBoard: DistrictQuote[] | null = null;
let principal: Principal | null = null;
let standing: EpochStanding | null = null;

async function refreshWallet(): Promise<void> {
  principal = await currentPrincipal();
  standing = principal ? await fetchStanding() : null;
  renderAll();
}
void refreshWallet();
window.setInterval(() => { if (principal) void refreshWallet(); }, 60_000);
let districtIsland = "";

async function refreshDistrictBoard(): Promise<void> {
  const island = store.state.island;
  const quotes = await fetchDistrictBoard(island);
  if (!quotes) return;
  districtBoard = quotes;
  districtIsland = island;
  renderAll();
}
void refreshDistrictBoard();
window.setInterval(() => { void refreshDistrictBoard(); }, 45_000);

function paintNetwork(label: string, healthy: boolean): void {
  const network = element<HTMLElement>("#networkValue");
  network.textContent = peerCount > 0 ? `${label} · ${peerCount} nearby` : label;
  network.classList.toggle("status-local", healthy);
  network.classList.toggle("status-unavailable", !healthy);
}

const realm = new RealmConnection({
  onStatus: (status: RealmStatus, detail: string) => {
    if (status !== "live") peerCount = 0;
    paintNetwork(detail, status === "live" || status === "disabled");
  },
  position: () => ({ x: store.state.player.x, z: store.state.player.z }),
  onPeers: (peers) => {
    world.setRemotePlayers(peers);
    if (peers.length !== peerCount) {
      peerCount = peers.length;
      paintNetwork("Render authority", true);
    }
  },
}, store.state.island);

void detectDeployment().then((status) => {
  paintNetwork(status.label, status.mode !== "unavailable");
  if (status.mode === "render") realm.connect();
}).catch(() => paintNetwork("Local fallback", true));

// Report our position at the server's tick rate, and obey any correction it sends back.
window.setInterval(() => {
  realm.setIsland(store.state.island);
  realm.sendMove(store.state.player.x, store.state.player.z);
  const correction = realm.takeCorrection();
  if (correction) world.applyCorrection(correction.x, correction.z, store.state);
}, 100);

window.addEventListener("beforeunload", () => realm.dispose());

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

function switchTab(requested: string): void {
  const tab = TAB_FOR.get(requested) ?? requested;
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
  // Treasury, citizens and the $MM vault moved into World > Realm figures: a new player
  // cannot act on them, so they were noise in the permanent header.
  element("#walletValue").textContent = `${formatNumber(state.wallet)} ${SUNMARK_CODE}`;
  element("#careerValue").textContent = `Lv ${store.careerLevel().level} · ${store.careerLevel().name}`;
  const island = ISLANDS.find((entry) => entry.id === state.island) ?? ISLANDS[0];
  element("#districtLabel").textContent = island.district;
  element("#islandLabel").textContent = island.name;
  element("#islandEconomy").textContent = island.economy;
}

const TAB_FOR = new Map<string, string>([
  ["build", "shop"], ["business", "shop"],
  ["market", "trade"], ["contracts", "trade"],
  ["map", "world"], ["guide", "world"],
]);

/** One instruction at a time: what to do, where, and a button that takes you there. */
const STEP_ACTION: Record<string, { tab: string; label: string; hint: string }> = {
  moved:      { tab: "shop",  label: "Show me",      hint: "Click the ground to walk there." },
  leased:     { tab: "shop",  label: "Pick a plot",  hint: "Choose a glowing plot, then sign the lease." },
  licensed:   { tab: "shop",  label: "Choose a trade", hint: "Pick what your business will make." },
  built:      { tab: "shop",  label: "Build it",     hint: "Put your building on the plot." },
  produced:   { tab: "shop",  label: "Start a job",  hint: "Buy what the recipe needs, then run it." },
  upgraded:   { tab: "shop",  label: "Upgrade",      hint: "Install one improvement in your building." },
  sold:       { tab: "trade", label: "Sell",         hint: "Sell what you made, or serve customers." },
  contracted: { tab: "trade", label: "Take an order", hint: "Fill a buyer's order — it pays the most." },
  traveled:   { tab: "world", label: "Take a ferry", hint: "Visit another island." },
};

function renderTutorial(): void {
  // Self-heal: if a later step is finished, an earlier one cannot still be pending. A
  // player who leased and built from the panel never "explored", and the guide would
  // otherwise sit on step 1 while they ran a business.
  const order = TUTORIAL.map(([entry]) => entry);
  const lastDone = order.reduce((highest, entry, index) => store.state.tutorial[entry] ? index : highest, -1);
  for (let i = 0; i < lastDone; i += 1) {
    const entry = order[i]!;
    if (!store.state.tutorial[entry]) store.markTutorial(entry);
  }

  const done = Object.values(store.state.tutorial).filter(Boolean).length;
  const next = store.nextTutorial();
  const key = next?.[0];
  const step = key ? STEP_ACTION[key] : undefined;

  // Number the step being shown, not the completion count — they disagree whenever a
  // player finishes something out of order.
  const stepIndex = next ? TUTORIAL.findIndex(([entry]) => entry === next[0]) : TUTORIAL.length - 1;
  element("#nextLabel").textContent = next ? `Step ${stepIndex + 1} of ${TUTORIAL.length}` : "All set";
  element("#nextTitle").textContent = next?.[1] ?? "You know the ropes";
  element("#nextHint").textContent = step?.hint ?? "Grow your business however you like.";
  element<HTMLSpanElement>("#nextMeter").style.width = `${Math.round((done / TUTORIAL.length) * 100)}%`;

  const go = element<HTMLButtonElement>("#nextGo");
  go.textContent = step?.label ?? "Explore";
  go.dataset.action = key === "moved" ? "walk-plaza" : "tab";
  go.dataset.target = step?.tab ?? "world";
  element("#nextStep").classList.toggle("complete", !next);

  // Tabs appear as they become useful, so nothing is on screen before it means anything.
  const unlocked = { shop: true, trade: store.state.buildingPlaced, world: Boolean(store.state.tutorial.sold) };
  for (const [tab, open] of Object.entries(unlocked)) {
    const button = document.querySelector<HTMLButtonElement>(`[data-tab="${tab}"]`);
    if (button) button.hidden = !open;
  }

  element("#guidePanel").innerHTML = `
    <div class="section-title">Your progress</div>
    <article class="career-card">
      <div class="career-heading"><i>${store.careerLevel().level}</i><div><small>Level</small><strong>${store.careerLevel().name}</strong><span>${store.nextCareerLevel() ? `${store.nextCareerLevel()!.xp - store.state.experience} XP to ${store.nextCareerLevel()!.name}` : "Top rank"}</span></div><b>${store.careerProgress()}%</b></div>
      <div class="meter"><span style="width:${store.careerProgress()}%"></span></div>
      <div class="career-stats"><span>Worth <strong>${formatNumber(store.netWorth())} ${SUNMARK_CODE}</strong></span><span>Orders <strong>${store.state.contractsCompleted}</strong></span><span>Plots <strong>${store.ownedPlotIds().length}/${store.plotAllowance()}</strong></span></div>
    </article>

    <div class="section-title">Today</div>
    <article class="daily-card ${store.dailyComplete() ? "complete" : ""}">
      <div class="daily-goals"><span class="${store.state.daily.jobs >= DAILY_GOALS.jobs ? "done" : ""}">Jobs <b>${Math.min(store.state.daily.jobs, DAILY_GOALS.jobs)}/${DAILY_GOALS.jobs}</b></span><span class="${store.state.daily.contracts >= DAILY_GOALS.contracts ? "done" : ""}">Orders <b>${Math.min(store.state.daily.contracts, DAILY_GOALS.contracts)}/${DAILY_GOALS.contracts}</b></span><span class="${store.state.daily.trades >= DAILY_GOALS.trades ? "done" : ""}">Trades <b>${Math.min(store.state.daily.trades, DAILY_GOALS.trades)}/${DAILY_GOALS.trades}</b></span></div>
      <div class="daily-reward"><div><small>Daily bonus</small><strong>${DAILY_GOALS.reward} ${SUNMARK_CODE}</strong></div><button data-action="claim-daily" ${!store.dailyComplete() || store.state.daily.claimed ? "disabled" : ""}>${store.state.daily.claimed ? "Claimed" : "Claim"}</button></div>
    </article>

    <details class="journey-details"><summary>All steps <span>${done}/${TUTORIAL.length}</span></summary><div class="card-list">
      ${TUTORIAL.map(([entry, title], index) => `<article class="game-card ${store.state.tutorial[entry] ? "done" : ""}"><div class="card-head"><i class="card-icon" style="--card-color:${store.state.tutorial[entry] ? "#62a876" : "#79918c"}">${store.state.tutorial[entry] ? "✓" : index + 1}</i><div class="card-copy"><strong>${title}</strong></div></div></article>`).join("")}
    </div></details>

    <details class="journey-details"><summary>Realm figures</summary>
      <div class="stat-grid"><div class="stat"><small>Civic treasury</small><strong>${formatNumber(store.state.governmentTreasury)}</strong></div><div class="stat"><small>Citizens</small><strong>${formatNumber(store.citizenCount())}</strong></div><div class="stat"><small>$MM vault</small><strong>${formatNumber(store.state.mmReserve)}</strong></div><div class="stat"><small>Reputation</small><strong>${store.state.reputation}</strong></div></div>
    </details>

    <div class="section-title">Recent</div>
    <div class="activity-feed">
      ${store.state.feed.slice(0, 4).map((entry) => `<div class="feed-item ${entry.tone}">${entry.text}</div>`).join("")}
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
  // Show one decision at a time: pick the land, then pick the trade. The licence chooser
  // used to render before leasing, when none of it could be acted on.
  const choosing = Boolean(state.ownedPlotId) && !state.license;
  const settled = Boolean(state.license);
  if (state.buildingPlaced) { element("#buildPanel").innerHTML = ""; return; }
  let intro = "Pick a glowing plot in the world, then lease it.";
  if (choosing) intro = `${owned?.name ?? "Your plot"} is yours. Now choose what it makes.`;
  if (settled) intro = `${owned?.name ?? "Your plot"} · ${BUSINESS[state.license!].name}`;
  element("#buildPanel").innerHTML = `
    <h2>Your plot</h2>
    <p class="lead">${intro}</p>
    ${!state.ownedPlotId ? `<article class="game-card selected">
      <div class="card-head"><i class="card-icon" style="--card-color:#d5a43d">⌂</i><div class="card-copy"><strong>${selectedPlot?.name ?? "Select a plot"}</strong><small>${selectedPlot ? `${selectedPlot.width} × ${selectedPlot.depth} m · ${selectedPlot.price} ${SUNMARK_CODE}` : "Click a plot in the 3D world"}</small></div></div>
      <button data-action="lease" ${selectedPlot ? "" : "disabled"}>Lease selected plot</button>
    </article>` : ""}
    ${!state.ownedPlotId ? `<p class="hint-line">Once it is yours, you choose what it makes.</p>` : ""}
    ${choosing ? `<div class="section-title">What will it make?</div>
    <div class="supply-chain-strip" aria-label="Supply chain"><span>Utilities</span><b>→</b><span>Inputs</span><b>→</b><span>Industry</span><b>→</b><span>Commerce</span><b>→</b><span>Citizens</span><b>↺</b><span>Recovery</span></div>
    <div class="filter-strip" aria-label="Business categories">${filters.map((filter) => `<button class="${activeBusinessStage === filter ? "active" : ""}" data-action="business-filter" data-filter="${filter}">${filter}</button>`).join("")}</div>
    <div class="business-grid">${visibleLicenses.map((key) => {
      const config = BUSINESS[key];
      const selected = state.license === key;
      return `<article class="game-card business-card ${selected ? "selected" : ""}" style="--card-color:${config.color}">
        <div class="card-head"><i class="card-icon">${config.icon}</i><div class="card-copy"><strong>${config.name}</strong><small>${config.stage} · ${config.islandAffinity}</small></div></div>
        ${recommendation[key] ? `<div class="recommendation">★ ${recommendation[key]}</div>` : ""}
        <div class="business-costs"><span>${config.licenseCost} ${SUNMARK_CODE} to start</span><span>${config.laborCost} ${SUNMARK_CODE} wages</span></div>
        <div class="flow-row"><div><small>Uses</small>${resourceCosts(config.inputs) || "<span>Demand</span>"}</div><b>→</b><div><small>Makes</small>${resourceCosts(config.output) || "<span>Service</span>"}</div></div>
        <details class="ecosystem-details"><summary>Who buys this</summary><div class="ecosystem"><div><small>Upstream</small><span>${config.ecosystem.upstream}</span></div><div><small>Process</small><span>${config.ecosystem.process}</span></div><div><small>Downstream</small><span>${config.ecosystem.downstream}</span></div></div></details>
        <button data-action="license" data-license="${key}" aria-label="Choose ${config.name}" ${!state.ownedPlotId || Boolean(state.license) || state.buildingPlaced ? "disabled" : ""}>${selected ? "Chosen" : `Choose this`}</button>
      </article>`;
    }).join("")}</div>` : ""}
    ${state.license && !state.buildingPlaced ? `<article class="game-card selected"><button data-action="build">Build ${BUSINESS[state.license].name}</button></article>` : ""}
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

const HALT_COPY: Record<string, string> = {
  demand: "the district stopped paying enough to cover the next job",
  storage: "the warehouse filled up",
  funds: "there were not enough Sunmarks for inputs or payroll",
  inputs: "inputs ran out and standing orders are paused",
  breakdown: "the equipment broke down",
  running: "a job is still on the floor",
  idle: "production is paused",
};

function shiftReportMarkup(): string {
  const shift = store.state.lastShift;
  if (!shift || shift.jobs <= 0) return "";
  return `<article class="shift-card">
    <div class="shift-head"><small>While you were away</small><strong>${shift.hours.toFixed(1)} hours of trading</strong></div>
    <div class="shift-grid">
      <div><small>Jobs</small><strong>${shift.jobs}</strong></div>
      <div><small>Made</small><strong>${formatNumber(shift.produced)}</strong></div>
      <div><small>Sold</small><strong>${formatNumber(shift.sold)}</strong></div>
      <div class="${shift.revenue - shift.spent - shift.wages >= 0 ? "positive" : "negative"}"><small>Net</small><strong>${formatNumber(shift.revenue - shift.spent - shift.wages)} ${SUNMARK_CODE}</strong></div>
    </div>
    <small class="shift-halt">Stopped because ${HALT_COPY[shift.halted] ?? shift.halted}.</small>
  </article>`;
}

function renderBusiness(): void {
  const state = store.state;
  if (!state.buildingPlaced || !state.license) {
    element("#businessPanel").innerHTML = "";
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
    <h2>${config.name}</h2>
    ${portfolioMarkup()}
    ${state.brokenDown ? `<article class="crisis-card"><i>!</i><div><strong>The line is down</strong><p>Equipment failed and production has stopped. An emergency crew needs ${BREAKDOWN_REPAIR_COST} ${SUNMARK_CODE} and ${BREAKDOWN_REPAIR_PARTS} Utility Parts.</p></div><button data-action="repair">Send repair crew</button></article>` : ""}
    ${shiftReportMarkup()}
    <div class="section-title">Runs by itself</div>
    <article class="game-card operations-card">
      <p>Runs by itself while you are away. Stops when it needs you.</p>
      <div class="storage-meter" role="img" aria-label="Warehouse ${Math.round(store.storedUnits())} of ${store.storageCapacity()} units">
        <div class="storage-fill" style="width:${Math.min(100, (store.storedUnits() / store.storageCapacity()) * 100).toFixed(1)}%"></div>
      </div>
      <small class="storage-label">Warehouse ${formatNumber(store.storedUnits())} / ${formatNumber(store.storageCapacity())} units${store.storageFull() ? " · full, production halted" : ""}</small>
      <div class="ops-toggles">
        ${([["autoProduce","Continuous production","Keep running jobs unattended"],["autoBuy","Standing input orders","Buy missing inputs at a 6% premium"],["autoSell","Broker sales","Sell output while away; the broker keeps 12%"]] as const).map(([key, name, hint]) => `<button class="ops-toggle ${state.operations[key] ? "on" : "off"}" data-action="operation" data-operation="${key}" aria-pressed="${state.operations[key]}"><span class="ops-dot"></span><span><strong>${name}</strong><small>${hint}</small></span></button>`).join("")}
      </div>
      <small class="ops-note">Selling by hand pays more. Orders pay most.</small>
    </article>
    <div class="stat-grid">
      <div class="stat"><small>Condition</small><strong>${Math.round(state.condition)}%</strong></div>
      <div class="stat"><small>Jobs completed</small><strong>${state.jobsCompleted}</strong></div>
      <div class="stat"><small>Lifetime revenue</small><strong>${formatNumber(state.lifetimeRevenue)} ${SUNMARK_CODE}</strong></div>
      <div class="stat"><small>Visitors served</small><strong>${formatNumber(state.visitorsServed)}</strong></div>
    </div>
    <div class="section-title">Next operating job · ${cycles} cycle${cycles === 1 ? "" : "s"}</div>
    <article class="game-card operation-card"><div class="readiness ${missingInputs.length ? "blocked" : "ready"}"><i>${missingInputs.length ? "!" : "✓"}</i><div><strong>${missingInputs.length ? "Inputs missing" : "Ready to operate"}</strong><small>${missingInputs.length ? "Buy the exact shortfall below." : `Payroll of ${economics.laborCost} ${SUNMARK_CODE} will return to AI-citizen households.`}</small></div></div><small>Inputs</small><div class="cost-row">${inputMarkup || "<span>No input</span>"}</div>${missingInputs.length ? `<div class="quick-buy"><small>Quick buy</small>${missingInputs.map(({ key, amount }) => `<button data-action="quick-buy" data-resource="${key}" data-quantity="${amount}">${RESOURCES[key].icon} Buy ${amount} ${RESOURCES[key].short} · ${store.marketBuyPrice(key) * amount} ${SUNMARK_CODE}</button>`).join("")}</div>` : ""}<small>Output / settlement</small><div class="cost-row">${outputMarkup || "<span>Service income</span>"}</div>${jobMarkup()}</article>
    <div class="section-title">Per job</div>
    <div class="stat-grid economics-grid"><div class="stat"><small>Input cost</small><strong>${economics.inputCost}</strong></div><div class="stat"><small>Payroll</small><strong>${economics.laborCost}</strong></div><div class="stat"><small>Gross revenue</small><strong>${economics.expectedRevenue}</strong></div><div class="stat ${economics.expectedProfit >= 0 ? "positive" : "negative"}"><small>Profit after 5% tax</small><strong>${economics.expectedProfit}</strong></div></div>
    ${config.servicePayout ? `<div class="section-title">Your price</div><article class="game-card"><p>Charge more per visit, or attract more visitors.</p><div class="price-choices">${[.85, 1, 1.15, 1.3].map((index) => `<button class="${Math.abs(state.servicePriceIndex - index) < .01 ? "active" : "secondary"}" data-action="service-price" data-price="${index}">${Math.round(index * 100)}%</button>`).join("")}</div></article>` : ""}
    <div class="section-title">Specialisation</div>
    ${state.specialization ? `<article class="specialization-selected" style="--special-color:${SPECIALIZATIONS[state.specialization].color}"><i>${SPECIALIZATIONS[state.specialization].icon}</i><div><small>Permanent company model</small><strong>${SPECIALIZATIONS[state.specialization].name}</strong><p>${SPECIALIZATIONS[state.specialization].summary}</p></div></article>` : `<div class="specialization-grid">${(Object.keys(SPECIALIZATIONS) as SpecializationKey[]).map((key) => { const option = SPECIALIZATIONS[key]; return `<article style="--special-color:${option.color}"><i>${option.icon}</i><strong>${option.name}</strong><p>${option.summary}</p><small>${option.tradeoff}</small><button data-action="specialize" data-specialization="${key}" ${store.careerLevel().level < 2 ? "disabled" : ""}>${store.careerLevel().level < 2 ? `Unlocks at ${store.nextCareerLevel()?.name ?? "level 2"}` : "Choose permanently"}</button></article>`; }).join("")}</div>`}
    <div class="section-title">Building</div>
    <article class="game-card two-up"><button data-action="interior">Open upgrades</button><button class="secondary" data-action="maintain">Repair &middot; 20 ${SUNMARK_CODE}</button></article>
  `;
}

function walletMarkup(): string {
  if (principal && standing) {
    return `<div class="wallet-linked">
      <div class="wallet-head"><span class="wallet-dot"></span><div><strong>Linked wallet</strong><small>${principal.walletAddress.slice(0, 4)}…${principal.walletAddress.slice(-4)}</small></div>
      <button class="wallet-out" data-action="wallet-disconnect">Unlink</button></div>
      <div class="wallet-grid">
        <div><small>Realm contributors</small><strong>${standing.contributors}</strong></div>
        <div><small>Everyone else</small><strong>${formatNumber(Math.round(standing.cohort))}</strong></div>
        <div><small>Epoch budget</small><strong>${formatNumber(standing.budget)} $MM</strong></div>
      </div>
      <small class="wallet-note">Live realm figures.</small>
    </div>`;
  }
  if (principal) {
    return `<div class="wallet-linked"><div class="wallet-head"><span class="wallet-dot"></span><div><strong>Linked wallet</strong><small>${principal.walletAddress.slice(0, 4)}…${principal.walletAddress.slice(-4)}</small></div><button class="wallet-out" data-action="wallet-disconnect">Unlink</button></div></div>`;
  }
  return `<div class="wallet-connect">
    <p>Link a wallet to earn against the live realm. Signing moves nothing and costs nothing.</p>
    <button data-action="wallet-connect" ${walletAvailable() ? "" : "disabled"}>${walletAvailable() ? "Link Solana wallet" : "No wallet detected"}</button>
  </div>`;
}

function portfolioMarkup(): string {
  const owned = store.ownedPlotIds();
  if (owned.length <= 1) return "";
  return `<div class="portfolio-strip" role="tablist" aria-label="Your businesses">
    ${owned.map((plotId) => {
      const plot = PLOTS.find((entry) => entry.id === plotId)!;
      const record = store.state.portfolio[plotId]!;
      const config = record.license ? BUSINESS[record.license] : null;
      const active = plotId === store.state.ownedPlotId;
      const island = ISLANDS.find((entry) => entry.id === plot.island);
      return `<button class="portfolio-chip ${active ? "active" : ""}" role="tab" aria-selected="${active}" data-action="switch-business" data-plot="${plotId}" style="--chip-color:${config?.color ?? "#8aa08f"}">
        <i>${config?.icon ?? "+"}</i>
        <span><strong>${config?.name ?? "Vacant plot"}</strong><small>${island?.name ?? plot.island}${record.brokenDown ? " · broken down" : record.buildingPlaced ? "" : " · unbuilt"}</small></span>
      </button>`;
    }).join("")}
  </div>`;
}

function districtBoardMarkup(): string {
  if (!districtBoard || districtIsland !== store.state.island) return "";
  const island = ISLANDS.find((entry) => entry.id === districtIsland);
  const busiest = [...districtBoard].sort((a, b) => b.soldToday - a.soldToday).slice(0, 6);
  const anyTrade = busiest.some((row) => row.soldToday > 0);
  return `<section class="district-board">
    <div class="district-head"><div><small>Live district board</small><strong>${island?.name ?? districtIsland}</strong></div><span>shared by everyone here</span></div>
    <p>Shared with everyone on this island. Every sale here moves them.</p>
    <div class="district-rows">
      ${busiest.map((row) => {
        const used = Math.min(100, (row.soldToday / Math.max(1, row.districtQuota)) * 100);
        const resource = RESOURCES[row.itemKey as ResourceKey];
        return `<div class="district-row"><i style="--resource-color:${resource?.color ?? "#888"}">${resource?.icon ?? "•"}</i>
          <div class="district-name"><strong>${resource?.short ?? row.itemKey}</strong><small>${row.soldToday} of ${row.districtQuota} absorbed today</small></div>
          <div class="district-bar"><span style="width:${used.toFixed(1)}%"></span></div>
          <div class="district-quote"><strong>${row.nextUnit}</strong><small>next unit</small></div></div>`;
      }).join("")}
    </div>
    ${anyTrade ? "" : `<small class="district-note">Nobody has traded here yet today. Prices are at their resting level.</small>`}
  </section>`;
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
    <h2>Buy &amp; sell</h2>
    <details class="journey-details"><summary>Market conditions</summary>
      <div class="economic-dashboard"><div><small>Price index</small><strong>${priceIndex}</strong><span>${priceIndex > 100 ? "+" : ""}${priceIndex - 100}% vs opening</span></div><div><small>Confidence</small><strong>${confidence}</strong><span>How freely citizens spend</span></div><div><small>Cycle</small><strong>${store.economicPhase()}</strong><span>${store.economyTrend()}</span></div><div><small>$MM cover</small><strong>${store.reserveBackingRatio().toFixed(1)}%</strong><span>${store.monetaryPolicyPhase()}</span></div></div>
    </details>
    <section class="reserve-desk">
      <div class="reserve-heading"><div><small>Contribution Board</small><strong>Epoch Distribution</strong></div><span>${formatNumber(EPOCH_MM_BUDGET)} $MM budget</span></div>
      <p>$MM is <strong>earned, never bought</strong>. Each week one fixed pot is shared out by how much you contributed.</p>
      <div class="epoch-meter" role="img" aria-label="Your share of this epoch's contribution pool: ${(store.epochShare() * 100).toFixed(2)} percent">
        <div class="epoch-fill" style="width:${Math.min(100, store.epochShare() * 100).toFixed(2)}%"></div>
      </div>
      <div class="reserve-balance">
        <div><small>Your contribution</small><strong>${formatNumber(Math.round(standing ? standing.mine : store.state.epoch.contribution))}</strong></div>
        <div><small>Your share</small><strong>${((standing ? standing.share : store.epochShare()) * 100).toFixed(2)}%</strong></div>
        <div><small>Projected payout</small><strong>${formatNumber(standing ? standing.projected : store.projectedEpochMM())} $MM</strong></div>
        <div><small>Held / lifetime earned</small><strong>${formatNumber(store.state.mmHoldings)} / ${formatNumber(store.state.lifetimeMMEarned)}</strong></div>
      </div>
      ${walletMarkup()}
      <p class="epoch-note">Orders are worth <strong>10&times;</strong> what dumping stock on the city is.</p>
      <div class="reserve-actions">
        <button data-action="claim-epoch" ${store.state.epoch.claimed || store.projectedEpochMM() <= 0 ? "disabled" : ""}>${store.state.epoch.claimed ? "Epoch already claimed" : `Claim ${formatNumber(store.projectedEpochMM())} $MM`}</button>
        <button class="secondary" data-action="sell-mm" ${store.state.mmHoldings < MM_EXCHANGE_BUNDLE ? "disabled" : ""}>Spend ${MM_EXCHANGE_BUNDLE} $MM <small>${store.reserveSellPayout()} ${SUNMARK_CODE}</small></button>
      </div>
      <small class="reserve-boundary">Prototype accounting only: no on-chain transfer, no redemption, and no promise of price or profit.</small>
    </section>
    ${districtBoardMarkup()}
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
    <h2>Orders</h2>
    <p class="lead">Filling a buyer's order pays more than selling loose stock.</p>
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
    <h2>Islands</h2><p class="lead">Your business keeps running while you travel.</p>
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
  element("#interiorConsole").innerHTML = `<h2>Upgrades</h2><div class="upgrade-list">${(Object.keys(UPGRADE_NAMES) as UpgradeKey[]).map((key) => {
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
        store.markTutorial("moved");
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
  else if (action === "repair") report(store.repairBreakdown());
  else if (action === "switch-business") report(store.switchBusiness(button.dataset.plot ?? ""));
  else if (action === "wallet-connect") {
    signIn().then((who) => { principal = who; toast(`Wallet linked: ${who.walletAddress.slice(0, 4)}…${who.walletAddress.slice(-4)}`); return refreshWallet(); })
      .catch((error: Error) => toast(error.message));
  }
  else if (action === "wallet-disconnect") {
    void signOut().then(() => { principal = null; standing = null; toast("Wallet unlinked."); renderAll(); });
  }
  else if (action === "operation") {
    const key = button.dataset.operation as "autoProduce" | "autoBuy" | "autoSell";
    report(store.setOperation(key, !store.state.operations[key]));
  }
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
