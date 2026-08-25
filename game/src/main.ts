import { BREAKDOWN_REPAIR_COST, BREAKDOWN_REPAIR_PARTS, BUSINESS, CHARTER_COST_MM, CIVIC_BUILDINGS, DEED_COST_MM, MAX_UPGRADE_LEVEL, MM_BURN_RATE, SPONSORSHIP_COST_MM, MERC_DOLLARS_PER_USD, BUSINESS_STAGES, DAILY_GOALS, ISLANDS, MM_TOTAL_SUPPLY, PLOTS, RESOURCES, SPECIALIZATIONS, CURRENCY_CODE, TUTORIAL, UPGRADE_COSTS, UPGRADE_NAMES, type BusinessStage, type LicenseKey, type ResourceKey, type SpecializationKey, type UpgradeKey } from "./data";
import { GameStore, type ActionResult } from "./state";
import { World3D } from "./world";
import { INTERIOR_EQUIPMENT_CATALOG, InteriorWorld, type InteriorMoveDirection, type InteriorPrompt, type InteriorSelection } from "./interiorWorld";
import { plotArrival } from "./highlandsWorld";
import { propertyMarkerModels, type MarkerModel } from "./propertyMarkers";
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
const interiorCanvas = element<HTMLCanvasElement>("#interiorCanvas");
const interiorPromptNode = element<HTMLElement>("#interiorPrompt");
const interiorInteractButton = element<HTMLButtonElement>("#interiorInteract");

let activeTab = "shop";
let interiorOpen = false;
let sheetReturnFocus: HTMLElement | null = null;
let interiorReturnFocus: HTMLElement | null = null;
let interiorEntryTimer = 0;
let interiorSelection: InteriorSelection | null = null;
let interiorPrompt: InteriorPrompt | null = null;
let interiorConsoleSignature = "";
let movedOnce = false;
let activeBusinessStage: "Recommended" | BusinessStage = "Recommended";
let marketFilter: "all" | "needed" | "owned" = "needed";

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

const interiorWorld = new InteriorWorld(interiorCanvas, {
  onInteract: (key) => {
    const result = store.purchaseUpgrade(key);
    report(result);
    interiorWorld.updateUpgradeLevels(store.state.upgrades, store.upgradeCeiling());
    renderInterior();
  },
  onExit: () => closeInterior(),
  onSelectionChange: (selection) => {
    interiorSelection = selection;
    renderInterior();
  },
  onPromptChange: (prompt) => {
    interiorPrompt = prompt;
    renderInteriorPrompt();
  },
});

world.setPositionCheckpoint(() => store.savePosition());

// ---------------------------------------------------------------------------
// The world is the interface. Plots and businesses carry their own labels, and
// the panel only slides in when you ask something a question.
// ---------------------------------------------------------------------------
const sheet = element<HTMLElement>("#sheet");
const markerLayer = element<HTMLElement>("#worldMarkers");

function openSheet(): void {
  if (sheet.dataset.open !== "true" && document.activeElement instanceof HTMLElement) {
    sheetReturnFocus = document.activeElement;
  }
  sheet.removeAttribute("inert");
  sheet.dataset.open = "true";
  sheet.setAttribute("aria-hidden", "false");
}

function closeSheet(restoreFocus = true): void {
  const focusWasInside = sheet.contains(document.activeElement);
  sheet.dataset.open = "false";
  sheet.setAttribute("aria-hidden", "true");
  sheet.setAttribute("inert", "");
  if (!restoreFocus || !focusWasInside) return;
  const target = sheetReturnFocus?.isConnected ? sheetReturnFocus : canvas;
  target.focus({ preventScroll: true });
}
element("#sheetClose").addEventListener("click", () => closeSheet());
document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeSheet(); });

function markerModels(): MarkerModel[] {
  const state = store.state;
  const island = ISLANDS.find((entry) => entry.id === state.island) ?? ISLANDS[0]!;
  const models: MarkerModel[] = [];

  // A named buyer standing in the district. Filling their order is the best-paying
  // action in the game, so it is also the most visible thing in the world.
  const active = state.activeContract;
  if (active) {
    const held = Math.min(state.inventory[active.resource], active.quantity);
    const ready = held >= active.quantity;
    models.push({
      id: "order", kind: ready ? "ready" : "buyer",
      label: ready ? "Deliver now" : "Order accepted",
      title: active.buyerName,
      detail: ready ? `${active.grossReward} ${CURRENCY_CODE} waiting` : `${held}/${active.quantity} ${RESOURCES[active.resource].short}`,
      x: island.x + 15, y: 3.2, z: island.z - 6, building: false,
    });
  } else {
    const offer = store.bestOffer();
    if (offer) {
      models.push({
        id: "order", kind: "buyer", label: "Wants to buy",
        title: `${offer.quantity} ${RESOURCES[offer.resource].short}`,
        detail: `pays ${offer.grossReward} ${CURRENCY_CODE}`,
        x: island.x + 15, y: 3.2, z: island.z - 6, building: false,
      });
    }
  }

  const shock = store.districtEvent(state.island);
  if (shock) {
    const hoursLeft = Math.max(1, Math.round((shock.endsAt - Date.now()) / 3_600_000));
    models.push({
      id: "event", kind: "event", label: `Paying +${Math.round((shock.multiplier - 1) * 100)}%`,
      title: RESOURCES[shock.resource].name,
      detail: `${shock.reason} · ${hoursLeft}h left`,
      x: island.x, y: 3.2, z: island.z + 16, building: false,
    });
  }

  // The stall tells you what this district is paying well for right now.
  const wanted = store.demandHighlights(1)[0];
  if (wanted) {
    models.push({
      id: "market", kind: "market", label: "Best price here",
      title: `${RESOURCES[wanted.key].short} ${wanted.price} ${CURRENCY_CODE}`,
      detail: `wants ${wanted.remaining} more`,
      x: island.x - 15, y: 3.2, z: island.z - 6, building: false,
    });
  }

  return models.concat(propertyMarkerModels(
    state,
    (resource) => store.marketBuyPrice(resource),
    (plotId) => world.buildingBannerY(plotId),
  ));
}

let markerSignature = "";

function escapeMarkup(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
  })[character]!);
}

function syncMarkers(): void {
  const models = markerModels();
  const signature = models.map((m) => [
    m.id, m.kind, m.label, m.title, m.detail, m.x, m.y, m.z,
    m.building, m.icon ?? "", m.accent ?? "",
  ].join(":")).join("|");
  if (signature !== markerSignature) {
    markerSignature = signature;
    markerLayer.innerHTML = models.map((model) => {
      const markerId = escapeMarkup(model.id);
      const label = escapeMarkup(model.label);
      const title = escapeMarkup(model.title);
      const detail = escapeMarkup(model.detail);
      const ariaLabel = escapeMarkup(`${model.title}. ${model.label}. ${model.detail}`);
      const buildingClass = model.building ? " building" : "";
      const style = model.accent ? ` style="--sign-accent:${escapeMarkup(model.accent)}"` : "";
      const buildingData = model.building
        ? ` data-building-sign="true" data-building-state="${escapeMarkup(model.kind)}"`
        : "";
      const content = model.building
        ? `<span class="marker-building-icon" aria-hidden="true"><i>${escapeMarkup(model.icon ?? "M")}</i></span>
          <span class="marker-building-copy"><strong>${title}</strong><small class="marker-building-status"><i aria-hidden="true"></i><span class="marker-status-text">${label}</span></small></span>
          <span class="marker-detail">${detail}</span>`
        : `<small>${label}</small><strong>${title}</strong><span class="marker-detail">${detail}</span>`;
      return `
        <div class="marker ${escapeMarkup(model.kind)}${buildingClass}" data-marker="${markerId}"${buildingData}${style}>
          <button class="marker-pin" data-action="marker" data-plot="${markerId}" aria-label="${ariaLabel}">
            ${content}
          </button>
        </div>`;
    }).join("");
  }
  // Every named structure supplies a roof-height anchor. Plot and activity pins stay
  // lower, while building banners float above the actual architecture.
  const projected = world.project(models.map((model) => ({ id: model.id, x: model.x, y: model.y, z: model.z })));
  const width = markerLayer.clientWidth;
  const height = markerLayer.clientHeight;
  const topbarBottom = document.querySelector<HTMLElement>(".topbar")?.getBoundingClientRect().bottom ?? 96;
  const safeTop = Math.ceil(topbarBottom + 12);
  const markerBounds = markerLayer.getBoundingClientRect();
  // The regions a pin must not sit under. The first two are legacy cards, now hidden
  // and skipped automatically; the rest are the controls the minimal layout actually
  // shows — and in landscape they sit in the corners, which is exactly where pins
  // would otherwise pile up.
  const reserved = [".world-label", ".selected-card", ".world-next", ".maker-nav", ".world-actions", ".topbar"]
    .map((selector) => document.querySelector<HTMLElement>(selector))
    .filter((node): node is HTMLElement => Boolean(node && getComputedStyle(node).display !== "none"))
    .map((node) => {
      const rect = node.getBoundingClientRect();
      return {
        left: rect.left - markerBounds.left,
        right: rect.right - markerBounds.left,
        top: rect.top - markerBounds.top,
        bottom: rect.bottom - markerBounds.top,
      };
    });
  // Anything the camera cannot see goes into a rail down the right edge, so the world
  // doubles as the map without the pins piling on top of one another.
  let railIndex = 0;
  const placed: Array<{ node: HTMLElement; x: number; y: number; width: number; height: number }> = [];
  for (const point of projected) {
    const node = markerLayer.querySelector<HTMLElement>(`[data-marker="${point.id}"]`);
    if (!node) continue;
    const model = models.find((entry) => entry.id === point.id);
    if (!model) continue;
    // Only genuinely off-canvas pins go to the rail. Anything the camera can see stays
    // on its plot, nudged down so it clears the floating top bar.
    const offCanvas = !point.onScreen || point.sx < 8 || point.sx > width - 8 || point.sy < 8 || point.sy > height - 8;
    if (offCanvas && (model.building || (width < 600 && model.kind === "vacant"))) {
      // A building sign belongs to its roof, not to the navigation rail. It returns as
      // soon as the camera can see the building again. Phone layouts also hide distant
      // lease pins so the smaller world view remains readable.
      node.style.display = "none";
      continue;
    }
    node.style.display = "block";
    node.classList.toggle("far", offCanvas);
    const nodeWidth = node.offsetWidth;
    const nodeHeight = node.offsetHeight;
    if (offCanvas) {
      const y = safeTop + 72 + railIndex * 84;
      railIndex += 1;
      if (y > height - 12) {
        node.style.display = "none";
        continue;
      }
      placed.push({ node, x: width - 104, y, width: nodeWidth, height: nodeHeight });
    } else {
      const halfWidth = nodeWidth / 2;
      const candidate = {
        node,
        x: Math.min(Math.max(point.sx, halfWidth + 8), Math.max(halfWidth + 8, width - halfWidth - 8)),
        y: Math.max(point.sy, safeTop + nodeHeight),
        width: nodeWidth,
        height: nodeHeight,
      };
      // The district plaque is stable wayfinding. When the camera projects a pin onto
      // it, move the pin beside the plaque instead of making either label unreadable.
      for (const obstacle of reserved) {
        const overlapsX = candidate.x + halfWidth > obstacle.left - 8
          && candidate.x - halfWidth < obstacle.right + 8;
        const overlapsY = candidate.y > obstacle.top - 8
          && candidate.y - candidate.height < obstacle.bottom + 8;
        if (!overlapsX || !overlapsY) continue;
        const beside = obstacle.right + halfWidth + 12;
        if (beside + halfWidth <= width - 8) candidate.x = beside;
        else candidate.y = obstacle.bottom + candidate.height + 12;
      }
      placed.push(candidate);
    }
  }

  // Two pins can project to nearly the same spot. Nudge the later one clear rather than
  // letting them render on top of each other.
  placed.sort((a, b) => a.y - b.y);
  for (let i = 0; i < placed.length; i += 1) {
    const current = placed[i]!;
    for (let j = 0; j < i; j += 1) {
      const other = placed[j]!;
      const horizontalOverlap = Math.abs(current.x - other.x) < (current.width + other.width) / 2 + 12;
      const verticalOverlap = current.y - current.height < other.y + 10
        && current.y > other.y - other.height - 10;
      if (horizontalOverlap && verticalOverlap) {
        current.y = other.y + current.height + 12;
      }
    }
    if (current.y > height - 12) {
      current.node.style.display = "none";
      continue;
    }
    current.node.style.left = `${current.x}px`;
    current.node.style.top = `${current.y}px`;
  }
}

let lastMarkerSync = 0;
world.setFrameCallback(() => {
  const now = performance.now();
  if (now - lastMarkerSync < 90) return;
  lastMarkerSync = now;
  syncMarkers();
});

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

/**
 * Ask the platform for landscape.
 *
 * Only Android honours an orientation lock, and only from fullscreen after a user
 * gesture — iOS Safari has no equivalent, which is why the rotate gate exists as the
 * fallback rather than as a nicety. Both are best-effort and neither blocks play.
 */
function requestLandscape(): void {
  const orientation = screen.orientation as (ScreenOrientation & { lock?: (to: string) => Promise<void> }) | undefined;
  if (!orientation?.lock) return;
  void orientation.lock("landscape").catch(() => {
    // Refused — iOS, a desktop, or not fullscreen. The gate covers it.
  });
}

window.addEventListener("pointerdown", () => {
  if (!window.matchMedia("(pointer: coarse)").matches) return;
  requestLandscape();
}, { once: true });

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

window.addEventListener("beforeunload", () => {
  realm.dispose();
  interiorWorld.dispose();
});

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

const SHEET_TITLE: Record<string, string> = {
  shop: "Your enterprise",
  trade: "Mercedonian exchange",
  world: "Explore Mercedonia",
};

type UiIconName = "enterprise" | "exchange" | "world";

function uiIcon(name: UiIconName): string {
  return `<svg class="mm-icon" aria-hidden="true" focusable="false"><use href="#mm-icon-${name}"></use></svg>`;
}

const SHEET_META: Record<string, { icon: UiIconName; kicker: string }> = {
  shop: { icon: "enterprise", kicker: "Enterprise desk" },
  trade: { icon: "exchange", kicker: "Exchange hall" },
  world: { icon: "world", kicker: "World atlas" },
};

function switchTab(requested: string): void {
  const tab = TAB_FOR.get(requested) ?? requested;
  activeTab = tab;
  const title = document.querySelector("#sheetTitle");
  if (title) title.textContent = SHEET_TITLE[tab] ?? "Your business";
  const meta = SHEET_META[tab] ?? SHEET_META.shop;
  element("#sheetEmblem").innerHTML = uiIcon(meta.icon);
  element("#sheetKicker").textContent = meta.kicker;
  openSheet();
  document.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((button) => {
    const active = button.dataset.tab === tab;
    button.classList.toggle("active", active);
    if (button.getAttribute("role") === "tab") {
      button.setAttribute("aria-selected", String(active));
      button.tabIndex = active ? 0 : -1;
    } else {
      button.setAttribute("aria-pressed", String(active));
      if (active) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    }
  });
  document.querySelectorAll<HTMLElement>("[data-panel]").forEach((panel) => {
    const active = panel.dataset.panel === tab;
    panel.classList.toggle("active", active);
    panel.hidden = !active;
  });
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
  element("#walletValue").textContent = `${formatNumber(state.wallet)} ${CURRENCY_CODE}`;
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
  traveled:   { tab: "world", label: "Use Transit Hall", hint: "Fast-travel to another district." },
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

  element("#guidePanel").innerHTML = `
    <div class="section-title">Your progress</div>
    <article class="career-card">
      <div class="career-heading"><i>${store.careerLevel().level}</i><div><small>Level</small><strong>${store.careerLevel().name}</strong><span>${store.nextCareerLevel() ? `${store.nextCareerLevel()!.xp - store.state.experience} XP to ${store.nextCareerLevel()!.name}` : "Top rank"}</span></div><b>${store.careerProgress()}%</b></div>
      <div class="meter"><span style="width:${store.careerProgress()}%"></span></div>
      <div class="career-stats"><span>Worth <strong>${formatNumber(store.netWorth())} ${CURRENCY_CODE}</strong></span><span>Orders <strong>${store.state.contractsCompleted}</strong></span><span>Plots <strong>${store.ownedPlotIds().length}/${store.plotAllowance()}</strong></span></div>
    </article>

    <div class="section-title">Today</div>
    <article class="daily-card ${store.dailyComplete() ? "complete" : ""}">
      <div class="daily-goals"><span class="${store.state.daily.jobs >= DAILY_GOALS.jobs ? "done" : ""}">Jobs <b>${Math.min(store.state.daily.jobs, DAILY_GOALS.jobs)}/${DAILY_GOALS.jobs}</b></span><span class="${store.state.daily.contracts >= DAILY_GOALS.contracts ? "done" : ""}">Orders <b>${Math.min(store.state.daily.contracts, DAILY_GOALS.contracts)}/${DAILY_GOALS.contracts}</b></span><span class="${store.state.daily.trades >= DAILY_GOALS.trades ? "done" : ""}">Trades <b>${Math.min(store.state.daily.trades, DAILY_GOALS.trades)}/${DAILY_GOALS.trades}</b></span></div>
      <div class="daily-reward"><div><small>Daily bonus</small><strong>${DAILY_GOALS.reward} ${CURRENCY_CODE}</strong></div><button data-action="claim-daily" ${!store.dailyComplete() || store.state.daily.claimed ? "disabled" : ""}>${store.state.daily.claimed ? "Claimed" : "Claim"}</button></div>
    </article>

    <details class="journey-details"><summary>All steps <span>${done}/${TUTORIAL.length}</span></summary><div class="card-list">
      ${TUTORIAL.map(([entry, title], index) => `<article class="game-card ${store.state.tutorial[entry] ? "done" : ""}"><div class="card-head"><i class="card-icon" style="--card-color:${store.state.tutorial[entry] ? "#62a876" : "#79918c"}">${store.state.tutorial[entry] ? "✓" : index + 1}</i><div class="card-copy"><strong>${title}</strong></div></div></article>`).join("")}
    </div></details>

    <details class="journey-details"><summary>Mercedonia figures</summary>
      <div class="stat-grid"><div class="stat"><small>Civic treasury</small><strong>${formatNumber(store.state.governmentTreasury)} ${CURRENCY_CODE}</strong></div><div class="stat"><small>Mercedonians</small><strong>${formatNumber(store.citizenCount())}</strong></div><div class="stat"><small>$MM vault</small><strong>${formatNumber(store.state.mmReserve)}</strong></div><div class="stat"><small>Reputation</small><strong>${store.state.reputation}</strong></div></div>
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
  if (plot) status = plot.id === state.ownedPlotId ? "Your active lease" : `Available · ${plot.price} ${CURRENCY_CODE}`;
  element("#selectedPlotStatus").textContent = status;
  const lease = element<HTMLButtonElement>("#leaseAction");
  const build = element<HTMLButtonElement>("#buildAction");
  const enter = element<HTMLButtonElement>("#enterAction");
  lease.disabled = !plot || Boolean(state.ownedPlotId);
  build.disabled = !state.ownedPlotId || !state.license || state.buildingPlaced;
  enter.disabled = !state.buildingPlaced;
  // The world tray is a next-action rail, not a wall of disabled choices.
  // Keep the current step visible and reveal the next one as the business grows.
  lease.hidden = Boolean(state.ownedPlotId);
  build.hidden = !state.ownedPlotId || state.buildingPlaced;
  enter.hidden = !state.buildingPlaced;
  for (const action of [lease, build, enter]) action.classList.toggle("primary", !action.hidden);
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
    shop: "Simple Mercedonian-facing trading business",
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
      <div class="card-head"><i class="card-icon" style="--card-color:#d5a43d">⌂</i><div class="card-copy"><strong>${selectedPlot?.name ?? "Select a plot"}</strong><small>${selectedPlot ? `${selectedPlot.width} × ${selectedPlot.depth} m · ${selectedPlot.price} ${CURRENCY_CODE}` : "Click a plot in the 3D world"}</small></div></div>
      <button data-action="lease" ${selectedPlot ? "" : "disabled"}>Lease selected plot</button>
    </article>` : ""}
    ${!state.ownedPlotId ? `<p class="hint-line">Once it is yours, you choose what it makes.</p>` : ""}
    ${choosing ? `<div class="section-title">What will it make?</div>
    <div class="supply-chain-strip" aria-label="Supply chain"><span>Utilities</span><b>→</b><span>Inputs</span><b>→</b><span>Industry</span><b>→</b><span>Commerce</span><b>→</b><span>Mercedonians</span><b>↺</b><span>Recovery</span></div>
    <div class="filter-strip" aria-label="Business categories">${filters.map((filter) => `<button class="${activeBusinessStage === filter ? "active" : ""}" data-action="business-filter" data-filter="${filter}">${filter}</button>`).join("")}</div>
    <div class="business-grid">${visibleLicenses.map((key) => {
      const config = BUSINESS[key];
      const selected = state.license === key;
      return `<article class="game-card business-card ${selected ? "selected" : ""}" style="--card-color:${config.color}">
        <div class="card-head"><i class="card-icon">${config.icon}</i><div class="card-copy"><strong>${config.name}</strong><small>${config.stage} · ${config.islandAffinity}</small></div></div>
        ${recommendation[key] ? `<div class="recommendation">★ ${recommendation[key]}</div>` : ""}
        <div class="business-costs"><span>${config.licenseCost} ${CURRENCY_CODE} to start</span><span>${config.laborCost} ${CURRENCY_CODE} wages</span></div>
        <div class="flow-row"><div><small>Uses</small>${resourceCosts(config.inputs) || "<span>Demand</span>"}</div><b>→</b><div><small>Makes</small>${resourceCosts(config.output) || "<span>Service</span>"}</div></div>
        <details class="ecosystem-details"><summary>Who buys this</summary><div class="ecosystem"><div><small>Upstream</small><span>${config.ecosystem.upstream}</span></div><div><small>Process</small><span>${config.ecosystem.process}</span></div><div><small>Downstream</small><span>${config.ecosystem.downstream}</span></div></div></details>
        <button data-action="license" data-license="${key}" aria-label="Choose ${config.name}" ${!state.ownedPlotId || Boolean(state.license) || state.buildingPlaced ? "disabled" : ""}>${selected ? "Chosen" : `Choose this`}</button>
      </article>`;
    }).join("")}</div>` : ""}
    ${state.license && !state.buildingPlaced ? `<article class="game-card selected"><button data-action="build">Build ${BUSINESS[state.license].name}</button></article>` : ""}
  `;
}

/** Humans do not count in seconds past about a minute. */
function formatWait(ms: number): string {
  const seconds = Math.ceil(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

function jobMarkup(): string {
  const state = store.state;
  if (!state.job || !state.license) return `<button class="operation-cta" data-action="start-job">Start production job</button>`;
  const remaining = Math.max(0, state.job.completeAt - Date.now());
  const total = Math.max(1, state.job.completeAt - state.job.startedAt);
  const progress = Math.min(100, Math.round((1 - remaining / total) * 100));
  return `<div class="job-status"><div><strong>${remaining > 0 ? "Working" : "Ready to collect"}</strong><span>${progress}%</span></div><div class="meter"><span style="width:${progress}%"></span></div><p>${remaining > 0 ? `${formatWait(remaining)} left` : "Your goods are ready."}</p><button class="operation-cta" data-action="collect-job" ${remaining > 0 ? "disabled" : ""}>${remaining > 0 ? `Working · ${formatWait(remaining)}` : "Collect your goods"}</button></div>`;
}

const HALT_COPY: Record<string, string> = {
  demand: "the district stopped paying enough to cover the next job",
  storage: "the warehouse filled up",
  funds: "there were not enough Merc Dollars for inputs or payroll",
  inputs: "inputs ran out and standing orders are paused",
  breakdown: "the equipment broke down",
  running: "a job is still on the floor",
  idle: "production is paused",
};

function shiftReportMarkup(): string {
  const shift = store.state.lastShift;
  if (!shift || shift.jobs <= 0) return "";
  const plural = (value: number, unit: string) => `${value} ${unit}${value === 1 ? "" : "s"}`;
  const span = shift.hours >= 1 ? plural(Math.round(shift.hours), "hour") : plural(Math.max(1, Math.round(shift.hours * 60)), "minute");
  return `<article class="shift-card">
    <div class="shift-head"><small>Your business worked</small><strong>${span} of trading</strong></div>
    <div class="shift-grid">
      <div><small>Jobs</small><strong>${shift.jobs}</strong></div>
      <div><small>Made</small><strong>${formatNumber(shift.produced)}</strong></div>
      <div><small>Sold</small><strong>${formatNumber(shift.sold)}</strong></div>
      <div class="${shift.revenue - shift.spent - shift.wages >= 0 ? "positive" : "negative"}"><small>Net</small><strong>${formatNumber(shift.revenue - shift.spent - shift.wages)} ${CURRENCY_CODE}</strong></div>
    </div>
    <small class="shift-halt">Stopped because ${HALT_COPY[shift.halted] ?? shift.halted}.</small>
  </article>`;
}

function renderBusiness(): void {
  const state = store.state;
  if (!state.buildingPlaced || !state.license) { element("#businessPanel").innerHTML = ""; return; }

  const config = BUSINESS[state.license];
  const cycles = 1 + state.upgrades.capacity;
  const economics = store.unitEconomics()!;
  const missing = (Object.entries(config.inputs) as Array<[ResourceKey, number]>)
    .map(([key, amount]) => ({ key, amount: Math.max(0, amount * cycles - state.inventory[key]) }))
    .filter(({ amount }) => amount > 0);
  const shortfall = missing.reduce((total, { key, amount }) => total + store.marketBuyPrice(key) * amount, 0);
  const customerActivity = state.citizenActivity.filter((entry) => entry.plotId === state.ownedPlotId);
  const customerVisits = customerActivity.filter((entry) => entry.kind === "service").reduce((total, entry) => total + entry.visitors, 0);
  const retailUnits = customerActivity.filter((entry) => entry.kind === "retail").reduce((total, entry) => total + entry.visitors, 0);
  const customerSpend = customerActivity.reduce((total, entry) => total + entry.gross, 0);
  const latestCustomerActivity = customerActivity.at(-1) ?? null;

  // Everything except the thing you act on right now is folded away.
  element("#businessPanel").innerHTML = `
    <h2>${config.name}</h2>
    ${portfolioMarkup()}
    <section class="game-card citizen-flow-card" aria-label="Live customer economy">
      <div class="citizen-flow-heading"><span aria-hidden="true">◎</span><div><small>Live customer economy</small><strong>${latestCustomerActivity ? `${latestCustomerActivity.kind === "service" ? `${latestCustomerActivity.visitors} customer visits` : `${latestCustomerActivity.visitors} units bought`} recorded` : "Mercedonians are choosing destinations"}</strong></div></div>
      <div class="citizen-flow-stats"><span><small>Recent visits</small><b>${formatNumber(customerVisits)}</b></span><span><small>Goods bought</small><b>${formatNumber(retailUnits)}</b></span><span><small>Recent spend</small><b>${formatNumber(customerSpend)} ${CURRENCY_CODE}</b></span><span><small>City spending</small><b>${formatNumber(state.householdSpend)} ${CURRENCY_CODE}</b></span></div>
      <small class="ops-note">The recent figures use the city's last 48 purchase records. Settled purchases dispatch representative cohorts along walkable streets to the correct operating business; ordinary browsing never displays a payment badge.</small>
    </section>
    ${state.suppliesCut ? `<article class="crisis-card"><i>!</i><div><strong>Water and power cut off</strong><p>The city stopped supply over unpaid standing charges.</p></div><button data-action="restore-supply">Settle ${store.dailyOverhead()} ${CURRENCY_CODE}</button></article>` : ""}
    ${state.brokenDown ? `<article class="crisis-card"><i>!</i><div><strong>The line is down</strong><p>Repair needs ${BREAKDOWN_REPAIR_COST} ${CURRENCY_CODE} and ${BREAKDOWN_REPAIR_PARTS} Utility Parts.</p></div><button data-action="repair">Send repair crew</button></article>` : ""}
    ${shiftReportMarkup()}

    <article class="job-card">
      <div class="job-flow">
        <div><small>Uses</small>${resourceCosts(Object.fromEntries(Object.entries(config.inputs).map(([key, value]) => [key, (value ?? 0) * cycles]))) || "<span>Nothing</span>"}</div>
        <b>→</b>
        <div><small>Makes</small>${config.servicePayout ? `<span>${economics.visitors} visits</span>` : resourceCosts(Object.fromEntries(Object.entries(config.output).map(([key, value]) => [key, Math.max((value ?? 0) * cycles, Math.round((value ?? 0) * cycles * (1 + state.upgrades.yield * .12)))]))) }</div>
      </div>
      ${(() => {
        const sold = (Object.keys(config.output) as ResourceKey[])[0];
        if (!sold) return "";
        const share = store.marketShare(sold);
        return `<div class="share-row" title="Your share of local demand"><div class="share-bar"><span style="width:${(share * 100).toFixed(0)}%"></span></div><small>You win <b>${Math.round(share * 100)}%</b> of local ${RESOURCES[sold].short} custom — better equipment wins more</small></div>`;
      })()}
      <div class="job-money"><span>Costs <b>${economics.inputCost + economics.laborCost} ${CURRENCY_CODE}</b></span><span class="${economics.expectedProfit >= 0 ? "good" : "bad"}">Earns <b>${economics.expectedProfit >= 0 ? "+" : ""}${economics.expectedProfit} ${CURRENCY_CODE}</b></span></div>
      ${missing.length ? `<div class="quick-buy"><small>You need</small>${missing.map(({ key, amount }) => `<button data-action="quick-buy" data-resource="${key}" data-quantity="${amount}">Buy ${amount} ${RESOURCES[key].short} · ${store.marketBuyPrice(key) * amount} ${CURRENCY_CODE}</button>`).join("")}${missing.length > 1 ? `<small class="quick-total">${shortfall} ${CURRENCY_CODE} in total</small>` : ""}</div>` : ""}
      ${jobMarkup()}
    </article>

    <details class="fold"><summary>Runs by itself<span>${state.operations.autoProduce ? "On" : "Paused"}</span></summary>
      <div class="storage-meter"><div class="storage-fill" style="width:${Math.min(100, (store.storedUnits() / store.storageCapacity()) * 100).toFixed(1)}%"></div></div>
      <small class="storage-label">Warehouse ${formatNumber(store.storedUnits())} / ${formatNumber(store.storageCapacity())}${store.storageFull() ? " · full" : ""}</small>
      <div class="ops-toggles">
        ${([["autoProduce","Keep working","Run jobs while you are away"],["autoBuy","Restock","Buy what it needs, 3% extra"],["autoSell","Auto-sell","A broker sells for you, keeps 7%"]] as const).map(([key, name, hint]) => `<button class="ops-toggle ${state.operations[key] ? "on" : "off"}" data-action="operation" data-operation="${key}" aria-pressed="${state.operations[key]}"><span class="ops-dot"></span><span><strong>${name}</strong><small>${hint}</small></span></button>`).join("")}
      </div>
    </details>

    <details class="fold"><summary>Payroll &amp; bills<span>${store.dailyOverhead()} ${CURRENCY_CODE}/day</span></summary>
      <div class="stat-grid"><div class="stat"><small>Mercedonians employed</small><strong>${state.staff}</strong></div><div class="stat ${state.staff < store.staffRequired() ? "negative" : ""}"><small>Needed per job</small><strong>${store.staffRequired()}</strong></div><div class="stat"><small>Wages</small><strong>${store.dailyPayroll()} ${CURRENCY_CODE}/day</strong></div><div class="stat"><small>Water &amp; power</small><strong>${store.dailyUtilityBill()} ${CURRENCY_CODE}/day</strong></div></div>
      <div class="game-card two-up"><button data-action="hire">Hire a Mercedonian</button><button class="secondary" data-action="release" ${state.staff <= 0 ? "disabled" : ""}>Let one go</button></div>
      <small class="ops-note">Their wages are their spending money — the Mercedonians you employ are the customers who shop with you.</small>
    </details>

    <details class="fold"><summary>Improve<span>Lv ${Object.values(state.upgrades).reduce((a, b) => a + b, 0)}</span></summary>
      <div class="game-card two-up"><button data-action="interior">Upgrades</button><button class="secondary" data-action="maintain">Repair · 20 ${CURRENCY_CODE}</button></div>
      ${config.servicePayout ? `<div class="price-choices">${[.85, 1, 1.15, 1.3].map((index) => `<button class="${Math.abs(state.servicePriceIndex - index) < .01 ? "active" : "secondary"}" data-action="service-price" data-price="${index}">${Math.round(index * 100)}%</button>`).join("")}</div>` : ""}
      ${state.specialization
        ? `<article class="specialization-selected" style="--special-color:${SPECIALIZATIONS[state.specialization].color}"><i>${SPECIALIZATIONS[state.specialization].icon}</i><div><strong>${SPECIALIZATIONS[state.specialization].name}</strong><p>${SPECIALIZATIONS[state.specialization].summary}</p></div></article>`
        : store.careerLevel().level < 2
          ? `<small class="hint-line">A permanent company style unlocks at level 2.</small>`
          : `<div class="specialization-grid">${(Object.keys(SPECIALIZATIONS) as SpecializationKey[]).map((key) => { const option = SPECIALIZATIONS[key]; return `<article style="--special-color:${option.color}"><i>${option.icon}</i><strong>${option.name}</strong><p>${option.summary}</p><button data-action="specialize" data-specialization="${key}">Choose</button></article>`; }).join("")}</div>`}
    </details>

    <details class="fold"><summary>Numbers<span>${state.jobsCompleted} jobs</span></summary>
      <div class="stat-grid"><div class="stat"><small>Condition</small><strong>${Math.round(state.condition)}%</strong></div><div class="stat"><small>Jobs</small><strong>${state.jobsCompleted}</strong></div><div class="stat"><small>Earned</small><strong>${formatNumber(state.lifetimeRevenue)} ${CURRENCY_CODE}</strong></div><div class="stat"><small>Visitors</small><strong>${formatNumber(state.visitorsServed)}</strong></div></div>
      <div class="stat-grid economics-grid"><div class="stat"><small>Inputs</small><strong>${economics.inputCost} ${CURRENCY_CODE}</strong></div><div class="stat"><small>Wages</small><strong>${economics.laborCost} ${CURRENCY_CODE}</strong></div><div class="stat"><small>Revenue</small><strong>${economics.expectedRevenue} ${CURRENCY_CODE}</strong></div><div class="stat ${economics.expectedProfit >= 0 ? "positive" : "negative"}"><small>Profit</small><strong>${economics.expectedProfit} ${CURRENCY_CODE}</strong></div></div>
    </details>
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
    <p>Shared with everyone in this district. Every sale here moves them.</p>
    <div class="district-rows">
      ${busiest.map((row) => {
        const used = Math.min(100, (row.soldToday / Math.max(1, row.districtQuota)) * 100);
        const resource = RESOURCES[row.itemKey as ResourceKey];
        return `<div class="district-row"><i style="--resource-color:${resource?.color ?? "#888"}">${resource?.icon ?? "•"}</i>
          <div class="district-name"><strong>${resource?.short ?? row.itemKey}</strong><small>${row.soldToday} of ${row.districtQuota} absorbed today</small></div>
          <div class="district-bar"><span style="width:${used.toFixed(1)}%"></span></div>
          <div class="district-quote"><strong>${row.nextUnit} ${CURRENCY_CODE}</strong><small>next unit</small></div></div>`;
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
      <div class="economic-dashboard"><div><small>Price index</small><strong>${priceIndex}</strong><span>${priceIndex > 100 ? "+" : ""}${priceIndex - 100}% vs opening</span></div><div><small>Confidence</small><strong>${confidence}</strong><span>How freely Mercedonians spend</span></div><div><small>Cycle</small><strong>${store.economicPhase()}</strong><span>${store.economyTrend()}</span></div><div><small>$MM cover</small><strong>${store.reserveBackingRatio().toFixed(1)}%</strong><span>${store.monetaryPolicyPhase()}</span></div></div>
    </details>
    <section class="bank-desk">
      <div class="reserve-heading"><div><small>Government Bank</small><strong>Treasury &amp; exchange</strong></div><span>${Number.isFinite(store.collateralRatio()) ? Math.round(store.collateralRatio() * 100) : 100}% covered</span></div>
      <p>One dollar of $MM buys ${formatNumber(MERC_DOLLARS_PER_USD)} ${CURRENCY_CODE}. The $MM stays in the treasury, deepening the city's liquidity and paying Mercedonians. The bank only issues while it holds several times what it owes, which is what keeps the rate safe in a downturn.</p>
      <div class="reserve-balance">
        <div><small>Treasury</small><strong>${formatNumber(store.state.bankTreasuryMM)} $MM</strong></div>
        <div><small>Money supply</small><strong>${formatNumber(store.mercDollarSupply())} ${CURRENCY_CODE}</strong></div>
        <div><small>Room to issue</small><strong>${formatNumber(store.issuanceHeadroom())} ${CURRENCY_CODE}</strong></div>
        <div><small>Issued this epoch</small><strong>${formatNumber(store.state.epochIssued)} ${CURRENCY_CODE}</strong></div>
        <div><small>Rate</small><strong>$1 = ${formatNumber(MERC_DOLLARS_PER_USD)} ${CURRENCY_CODE}</strong></div>
        <div><small>Economy worth</small><strong>$${formatNumber(Math.round(store.economyValueUsd()))}</strong></div>
        <div><small>Your capital here</small><strong>${formatNumber(store.withdrawableCapitalMM())} $MM</strong></div>
      </div>
      <div class="reserve-actions">
        <button data-action="bank-in" ${store.state.mmHoldings < 1 ? "disabled" : ""}>Bring in 100 $MM <small>get ${formatNumber(store.mercDollarsForMM(100))} ${CURRENCY_CODE}</small></button>
        <button class="secondary" data-action="bank-out" ${store.state.wallet < 1000 || store.withdrawableCapitalMM() <= 0 ? "disabled" : ""}>Withdraw capital <small>${store.withdrawableCapitalMM() > 0 ? `${formatNumber(store.withdrawableCapitalMM())} $MM available` : "nothing on deposit"}</small></button>
      </div>
      <div class="city-strip">
        <div><small>Mercedonians</small><strong>${formatNumber(store.mercedonianPopulation())}</strong></div>
        <div><small>Civic wage</small><strong>${store.civicDailyWage()} ${CURRENCY_CODE}/day</strong></div>
        <div><small>City wage bill</small><strong>${formatNumber(store.civicWageBill())} ${CURRENCY_CODE}/day</strong></div>
        <div><small>They will spend</small><strong>${formatNumber(store.citizenSpendingPower())} ${CURRENCY_CODE}</strong></div>
        <div><small>Paid to date</small><strong>${formatNumber(Math.round(store.state.civicWagesPaid))} ${CURRENCY_CODE}</strong></div>
        <div><small>Citizen purses</small><strong>${formatNumber(Math.round(store.state.citizenPool))} ${CURRENCY_CODE}</strong></div>
      </div>
      <small class="city-note">Mercedonia pays Mercedonians every day from what it collects, and issues against these reserves when collections fall short — so wages, and therefore your customers, stay funded as the world grows. Roughly nine in ten Merc Dollars of wages end up in player tills.</small>
      <small class="reserve-boundary">The bank returns <strong>capital</strong> — what you brought in, whenever you want it back. <strong>Profit</strong> is paid out in the weekly distribution instead, which rewards serving real buyers rather than grinding. Mercedonians are paid from this treasury, so a deeper treasury means richer customers. The bank issues only against reserves, and only a slice of its limit each week — no in-game activity can create ${CURRENCY_CODE} out of nothing.</small>
    </section>

    <section class="reserve-desk">
      <div class="reserve-heading"><div><small>Contribution Board</small><strong>Epoch Distribution</strong></div><span>${formatNumber(store.epochBudget())} $MM this week</span></div>
      <p>$MM is <strong>earned, never bought</strong>. Each week the rewards pool pays out a share of itself, split by how much you contributed — so it shrinks slowly instead of running out.</p>
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
      <div class="section-title">Spend it</div>
      <div class="sink-list">
        <button class="sink" data-action="buy-sponsor" ${store.state.mmHoldings < SPONSORSHIP_COST_MM || store.sponsorshipActive() ? "disabled" : ""}>
          <div><strong>${store.sponsorshipActive() ? "Sponsored this week" : "Sponsor your district"}</strong><small>A week of promotion — wins you more local custom</small></div>
          <b>${SPONSORSHIP_COST_MM} $MM</b>
        </button>
        <button class="sink" data-action="buy-deed" ${store.state.mmHoldings < DEED_COST_MM ? "disabled" : ""}>
          <div><strong>Civic deed</strong><small>A permanent extra plot${store.state.deeds ? ` · you hold ${store.state.deeds}` : ""}</small></div>
          <b>${DEED_COST_MM} $MM</b>
        </button>
        <button class="sink" data-action="buy-charter" ${store.state.mmHoldings < CHARTER_COST_MM || store.state.chartered ? "disabled" : ""}>
          <div><strong>${store.state.chartered ? "Master charter held" : "Master charter"}</strong><small>Raises every equipment ceiling to level ${MAX_UPGRADE_LEVEL}</small></div>
          <b>${CHARTER_COST_MM} $MM</b>
        </button>
      </div>
      <small class="epoch-note">${Math.round(MM_BURN_RATE * 100)}% of everything spent here is destroyed for good; the rest returns to next week's pool. ${store.state.mmBurned ? `You have burned ${formatNumber(store.state.mmBurned)} $MM.` : ""}</small>
      <div class="reserve-actions">
        <button class="secondary" hidden data-action="buy-deed" ${store.state.mmHoldings < DEED_COST_MM ? "disabled" : ""}>Buy a civic deed <small>${DEED_COST_MM} $MM · +1 plot</small></button>
        <button data-action="claim-epoch" ${store.state.epoch.claimed || store.projectedEpochMM() <= 0 ? "disabled" : ""}>${store.state.epoch.claimed ? "Epoch already claimed" : `Claim ${formatNumber(store.projectedEpochMM())} $MM`}</button>
      </div>
      <small class="reserve-boundary">Prototype accounting only: no on-chain transfer, no redemption, and no promise of price or profit.</small>
    </section>
    ${districtBoardMarkup()}
    <div class="filter-strip market-filter" aria-label="Market inventory filter"><button class="${marketFilter === "all" ? "active" : ""}" data-action="market-filter" data-filter="all">All goods</button><button class="${marketFilter === "needed" ? "active" : ""}" data-action="market-filter" data-filter="needed">Needed now${neededKeys.length ? ` · ${neededKeys.length}` : ""}</button><button class="${marketFilter === "owned" ? "active" : ""}" data-action="market-filter" data-filter="owned">My stock</button></div>
    <div class="market-legend"><span>Item &amp; economic role</span><span>Local quote · ${CURRENCY_CODE}</span><span>Trade</span></div>
    <div class="card-list market-list">
      ${visibleKeys.map((key) => {
        const resource = RESOURCES[key];
        const pressure = Math.round((store.state.marketPressure[key] - 1) * 100);
        const trend = pressure > 4 ? "scarce" : pressure < -4 ? "surplus" : "stable";
        return `<div class="market-row" style="--resource-color:${resource.color}"><i>${resource.icon}</i><div class="market-name"><strong>${resource.name}</strong><small>${resource.tier} · ${resource.buyer === "citizens" ? "Households" : "Civic"} ${store.procurementRemaining(key)}/${store.dailyQuota(key)} at full price</small></div><div class="market-quote"><strong>${store.marketBuyPrice(key)} ${CURRENCY_CODE} <small>buy</small></strong><span>${store.marketSellPrice(key)} ${CURRENCY_CODE} sell · hold ${store.state.inventory[key]}</span><em class="${trend}">${pressure > 0 ? "+" : ""}${pressure}% ${trend}</em></div><div class="market-actions"><button data-action="buy" data-resource="${key}">Buy 1</button><button class="sell" data-action="sell" data-resource="${key}">Sell 1</button></div></div>`;
      }).join("")}
      ${visibleKeys.length ? "" : `<div class="empty-state"><i>⇄</i><strong>No goods in this view</strong><p>${marketFilter === "needed" ? "Choose a business license to reveal its required inputs." : "Produce or buy something to build your stock."}</p><button data-action="market-filter" data-filter="all">Show all goods</button></div>`}
    </div>
    <div class="section-title">Ledger health</div>
    <div class="stat-grid"><div class="stat"><small>Civic treasury</small><strong>${formatNumber(store.state.governmentTreasury)} ${CURRENCY_CODE}</strong></div><div class="stat"><small>Mercedonian spending pool</small><strong>${formatNumber(store.state.citizenPool)} ${CURRENCY_CODE}</strong></div><div class="stat"><small>Payroll returned to Mercedonians</small><strong>${formatNumber(store.state.laborPaid)} ${CURRENCY_CODE}</strong></div><div class="stat"><small>Your tax paid</small><strong>${formatNumber(store.state.taxPaid)} ${CURRENCY_CODE}</strong></div><div class="stat"><small>$MM accounted in game</small><strong>${formatNumber(store.totalMMInGameVaults())}</strong></div><div class="stat"><small>Total $MM supply</small><strong>${formatNumber(MM_TOTAL_SUPPLY)}</strong></div></div>
    <p class="model-note">Merc Dollar prices are bounded and mean-reverting. $MM is never required for leases, payroll, inputs, services or taxes. This remains a gameplay simulation—not a promise of token value, yield or profit.</p>
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
      <div class="contract-head"><i>${activeResource.icon}</i><div><small>${active.buyer === "citizens" ? "Household demand" : "Institutional procurement"}</small><strong>${active.buyerName}</strong><span>${active.quantity} ${activeResource.short} · ${active.grossReward} ${CURRENCY_CODE} gross</span></div><b>+${active.bonusPercent}%</b></div>
      <div class="contract-progress"><div><span>Inventory ready</span><strong>${Math.min(store.state.inventory[active.resource], active.quantity)} / ${active.quantity}</strong></div><div class="meter"><span style="width:${Math.min(100, (store.state.inventory[active.resource] / active.quantity) * 100)}%"></span></div></div>
      ${shortfall ? `<button class="contract-supply" data-action="quick-buy" data-resource="${active.resource}" data-quantity="${shortfall}">Buy ${shortfall} missing ${activeResource.short} · ${shortfall * store.marketBuyPrice(active.resource)} ${CURRENCY_CODE}</button>` : ""}
      <div class="contract-actions"><button data-action="fulfill-contract" ${shortfall ? "disabled" : ""}>Deliver order · earn ${active.grossReward - Math.floor(active.grossReward * .05)} ${CURRENCY_CODE}</button><button class="secondary" data-action="release-contract">Release · −1 reputation</button></div>
    </article>` : ""}
    <div class="section-title">Verified offers</div>
    <div class="contract-list">${offers.map((offer) => { const resource = RESOURCES[offer.resource]; const held = store.state.inventory[offer.resource]; return `<article class="contract-card" style="--contract-color:${resource.color}">
      <div class="contract-head"><i>${resource.icon}</i><div><small>${offer.buyer === "citizens" ? "Household demand" : "Institutional procurement"}</small><strong>${offer.buyerName}</strong><span>${offer.quantity} ${resource.short} · hold ${held}</span></div><b>+${offer.bonusPercent}%</b></div>
      <div class="contract-value"><span>Gross payment <strong>${offer.grossReward} ${CURRENCY_CODE}</strong></span><span>Reputation <strong>+${offer.reputationReward}</strong></span><span>Career XP <strong>+${offer.xpReward}</strong></span></div>
      <button data-action="accept-contract" data-contract="${offer.id}" ${active ? "disabled" : ""}>${active ? "One active order allowed" : "Accept contract"}</button>
    </article>`; }).join("")}</div>
    <button class="refresh-board" data-action="refresh-contracts">Refresh verified offers · 5 ${CURRENCY_CODE}</button>
    <p class="model-note">Contract bonuses reward planning and reliability. Public orders are bounded by the civic treasury; household orders are bounded by earned wages and Mercedonian liquidity.</p>
  `;
}

function renderMap(): void {
  const mapNodes = ISLANDS.map((island) => {
    const x = 50 + island.x / 4.55;
    const y = 50 + island.z / 4.35;
    const current = store.state.island === island.id;
    return `<button class="map-node ${current ? "current" : ""}" style="--map-x:${x}%;--map-y:${y}%;--island-color:${island.color}" data-action="travel" data-island="${island.id}" ${current ? "disabled" : ""} aria-label="Fast-travel to ${island.name}"><i></i><span>${island.name}</span></button>`;
  }).join("");
  element("#mapPanel").innerHTML = `
    <h2>Districts</h2><p class="lead">Prices differ by district across one connected world. Get there before the demand does.</p>
    ${(() => {
      const forecast = store.trendForecast().slice(0, 4);
      if (!forecast.length) return "";
      return `<div class="section-title">Coming up</div>
      <div class="forecast-list">${forecast.map((entry) => {
        const island = ISLANDS.find((row) => row.id === entry.islandId);
        const days = (entry.startsAt - Date.now()) / 86_400_000;
        const rounded = Math.max(1, Math.round(days));
        const when = rounded === 1 ? "tomorrow" : `in ${rounded} days`;
        return `<button class="forecast-row" style="--island-color:${island?.color ?? "#888"}" data-action="travel" data-island="${entry.islandId}" ${store.state.island === entry.islandId ? "disabled" : ""}>
          <i></i><div><strong>${island?.name ?? entry.islandId} will want ${RESOURCES[entry.resource].short}</strong><small>${when} · ${entry.reason}</small></div><b>+${Math.round((entry.multiplier - 1) * 100)}%</b>
        </button>`;
      }).join("")}</div>
      <small class="hint-line">Stock up or build before it starts — that is where the money is.</small>`;
    })()}
    <div class="archipelago-map"><div class="trade-ring ring-one"></div><div class="trade-ring ring-two"></div>${mapNodes}<div class="map-compass">N</div></div>
    <div class="card-list">${[...ISLANDS].sort((a, b) => Number(Boolean(store.districtEvent(b.id))) - Number(Boolean(store.districtEvent(a.id)))).map((island) => {
      const event = store.districtEvent(island.id);
      const here = store.state.island === island.id;
      return `<div class="island-row ${event ? "has-event" : ""}" style="--island-color:${island.color}"><i class="island-dot"></i><div><strong>${island.name}</strong>${event
        ? `<small class="island-event">Paying <b>+${Math.round((event.multiplier - 1) * 100)}%</b> for ${RESOURCES[event.resource].short} — ${event.reason}</small>`
        : `<small>${island.district}</small>`}</div><button data-action="travel" data-island="${island.id}" ${here ? "disabled" : ""}>${here ? "Here" : store.state.tutorial.traveled ? `10 ${CURRENCY_CODE}` : "Free"}</button></div>`;
    }).join("")}</div>
  `;
}

function renderResources(): void {
  // Only what you are actually holding, plus what the current recipe still needs.
  const licence = store.state.license;
  const needed = licence ? (Object.keys(BUSINESS[licence].inputs) as ResourceKey[]) : [];
  const shown = (Object.keys(RESOURCES) as ResourceKey[])
    .filter((key) => store.state.inventory[key] > 0 || needed.includes(key));
  element("#resourceDock").innerHTML = shown.map((key) => {
    const resource = RESOURCES[key];
    const held = store.state.inventory[key];
    return `<div class="resource-chip ${held === 0 ? "empty" : ""}" style="--resource-color:${resource.color}"><i>${resource.icon}</i><div><small>${resource.short}</small><strong>${held}</strong></div><span>${store.marketBuyPrice(key)} ${CURRENCY_CODE}</span></div>`;
  }).join("");
}

function renderInteriorPrompt(): void {
  const icon = interiorPromptNode.querySelector<HTMLElement>("i");
  const hint = interiorPromptNode.querySelector<HTMLElement>("small");
  const title = interiorPromptNode.querySelector<HTMLElement>("strong");
  if (!icon || !hint || !title) return;

  if (!interiorPrompt) {
    icon.textContent = "⌁";
    hint.textContent = "Explore the room";
    title.textContent = "Move close to an equipment station";
    interiorInteractButton.textContent = "Walk closer";
    interiorInteractButton.disabled = true;
    return;
  }

  const selection = interiorPrompt.selection;
  icon.textContent = selection.kind === "upgrade" ? UPGRADE_NAMES[selection.key].icon : "↗";
  hint.textContent = interiorPrompt.inputHint;
  title.textContent = `${interiorPrompt.title} · ${interiorPrompt.detail}`;
  interiorInteractButton.textContent = interiorPrompt.actionLabel;
  interiorInteractButton.disabled = !interiorPrompt.available;
}

function equipmentSelectorMarkup(license: LicenseKey, selectedKey: UpgradeKey | null): string {
  return `<div class="equipment-selector" aria-label="Choose an equipment station">${(Object.keys(UPGRADE_NAMES) as UpgradeKey[]).map((key) => {
    const design = INTERIOR_EQUIPMENT_CATALOG[license][key];
    const level = store.state.upgrades[key];
    const status = level === 0 ? "Not installed" : `Level ${level}`;
    return `<button class="${selectedKey === key ? "active" : ""}" style="--station-color:${design.secondary};--equipment-color:${design.secondary}" data-action="interior-focus" data-upgrade="${key}" aria-label="Walk to ${escapeMarkup(design.name)}, ${status}"><i>${UPGRADE_NAMES[key].icon}</i><span><strong>${escapeMarkup(design.name)}</strong><small>${status}</small></span></button>`;
  }).join("")}</div>`;
}

function renderInterior(): void {
  if (!interiorOpen || !store.state.license) return;
  const license = store.state.license;
  const config = BUSINESS[license];
  const ceiling = store.upgradeCeiling();
  const installed = (Object.keys(UPGRADE_NAMES) as UpgradeKey[]).reduce((total, key) => total + store.state.upgrades[key], 0);
  element("#interiorTitle").textContent = config.name;
  element("#interiorLevel").textContent = `Installed modules · ${installed}/${ceiling * 4}`;
  renderInteriorPrompt();

  const selectedKey = interiorSelection?.kind === "upgrade" ? interiorSelection.key : null;
  const signature = [
    license,
    interiorSelection?.kind ?? "none",
    selectedKey ?? "none",
    interiorSelection?.nearby ?? false,
    ceiling,
    store.state.wallet,
    ...Object.values(store.state.upgrades),
    ...Object.values(store.state.inventory),
  ].join(":");
  if (signature === interiorConsoleSignature) return;
  interiorConsoleSignature = signature;

  const selector = equipmentSelectorMarkup(license, selectedKey);
  const consoleNode = element("#interiorConsole");
  if (!selectedKey) {
    const atExit = interiorSelection?.kind === "exit";
    consoleNode.innerHTML = `<div id="interiorEquipmentPanel" class="interior-console-empty"><i>${atExit ? "↗" : config.icon}</i><strong>${atExit ? "Ready to leave?" : "Choose what to buy first"}</strong><p>${atExit ? "Use the exit below or choose another equipment station to keep improving this business." : `Every ${escapeMarkup(config.name)} machine is purpose-built. Select one and your Maker will walk to it before purchasing.`}</p>${atExit ? `<button class="interior-buy" data-action="interior-exit">Return to Mercedonia</button>` : ""}${selector}</div>`;
    consoleNode.scrollTop = 0;
    return;
  }

  const design = INTERIOR_EQUIPMENT_CATALOG[license][selectedKey];
  const upgrade = UPGRADE_NAMES[selectedKey];
  const level = store.state.upgrades[selectedKey];
  const nextLevel = Math.min(MAX_UPGRADE_LEVEL, level + 1);
  const atMaximum = level >= ceiling;
  const needsCharter = atMaximum && !store.state.chartered && ceiling < MAX_UPGRADE_LEVEL;
  const nearby = interiorSelection?.kind === "upgrade" && interiorSelection.key === selectedKey && interiorSelection.nearby;
  const cost = UPGRADE_COSTS[nextLevel];
  const buttonLabel = atMaximum
    ? needsCharter ? `Master charter required for level ${MAX_UPGRADE_LEVEL}` : "Maximum level installed"
    : !nearby ? `Walk to ${escapeMarkup(design.name)} to buy`
      : level === 0 ? `Buy ${escapeMarkup(design.name)}` : `Install level ${nextLevel}`;

  consoleNode.innerHTML = `<div id="interiorEquipmentPanel" style="--equipment-color:${design.secondary}">
    <small class="equipment-kicker">${escapeMarkup(config.name)} · ${escapeMarkup(upgrade.name)}</small>
    <div class="equipment-title"><i>${upgrade.icon}</i><div><h3>${escapeMarkup(design.name)}</h3><small>${level === 0 ? "Blueprint ready · not installed" : `Physical equipment · level ${level} of ${ceiling}`}</small></div></div>
    <p class="equipment-copy">${escapeMarkup(design.description)}</p>
    <div class="equipment-benefit"><small>Business improvement</small><strong>${escapeMarkup(upgrade.effect)}</strong></div>
    <div class="equipment-meter" aria-label="${level} of ${ceiling} equipment levels installed">${Array.from({ length: MAX_UPGRADE_LEVEL }, (_, index) => `<i class="${index < level ? "on" : index >= ceiling ? "locked" : ""}"></i>`).join("")}</div>
    ${atMaximum
      ? `<div class="equipment-cost"><small>${needsCharter ? "Next step" : "Installation complete"}</small><strong>${needsCharter ? `Earn a master charter to unlock level ${MAX_UPGRADE_LEVEL}.` : "This machine is fully developed."}</strong></div>`
      : `<div class="equipment-cost"><small>${level === 0 ? "Purchase cost" : `Level ${nextLevel} installation cost`}</small><div class="cost-row"><span>${cost.mercDollars} ${CURRENCY_CODE}</span>${resourceCosts(cost.resources)}</div></div>`}
    <button class="interior-buy" data-action="interior-interact" ${atMaximum || !nearby ? "disabled" : ""}>${buttonLabel}</button>
    ${selector}
  </div>`;
  consoleNode.scrollTop = 0;
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
  void world.syncBuildings(store.state);
}

function openInterior(): void {
  if (!store.state.buildingPlaced || !store.state.license) {
    toast("Build your business first.", true);
    return;
  }
  if (!world.isNearOwnedBusiness(store.state)) {
    const plot = PLOTS.find((entry) => entry.id === store.state.ownedPlotId);
    if (!plot) {
      toast("Your business entrance could not be located.", true);
      return;
    }
    const arrival = plotArrival(plot);
    world.walkTo(arrival.x, arrival.z);
    window.clearInterval(interiorEntryTimer);
    const approachStarted = performance.now();
    interiorEntryTimer = window.setInterval(() => {
      if (world.isNearOwnedBusiness(store.state)) {
        window.clearInterval(interiorEntryTimer);
        interiorEntryTimer = 0;
        openInterior();
      } else if (performance.now() - approachStarted > 30_000) {
        window.clearInterval(interiorEntryTimer);
        interiorEntryTimer = 0;
        toast("The route is blocked. Walk closer and try the entrance again.", true);
      }
    }, 120);
    toast(`Walking to ${BUSINESS[store.state.license].name}…`);
    return;
  }
  window.clearInterval(interiorEntryTimer);
  interiorEntryTimer = 0;
  const license = store.state.license;
  interiorOpen = true;
  interiorSelection = null;
  interiorPrompt = null;
  interiorConsoleSignature = "";
  closeSheet();
  interiorReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : element("#enterAction");
  world.setInputEnabled(false);
  element<HTMLElement>(".app-shell").setAttribute("inert", "");
  interiorModal.removeAttribute("inert");
  interiorModal.classList.add("show");
  interiorModal.setAttribute("aria-hidden", "false");
  renderInterior();
  requestAnimationFrame(() => {
    if (!interiorOpen || store.state.license !== license) return;
    interiorWorld.enter({
      business: BUSINESS[license],
      license,
      upgrades: store.state.upgrades,
      upgradeCeiling: store.upgradeCeiling(),
    });
    interiorCanvas.focus({ preventScroll: true });
  });
}

function closeInterior(): void {
  window.clearInterval(interiorEntryTimer);
  interiorEntryTimer = 0;
  interiorWorld.exit();
  for (const direction of ["forward", "backward", "left", "right"] as const) {
    interiorWorld.setMoveInput(direction, false);
  }
  interiorOpen = false;
  interiorSelection = null;
  interiorPrompt = null;
  interiorConsoleSignature = "";
  world.setInputEnabled(true);
  interiorModal.classList.remove("show");
  interiorModal.setAttribute("aria-hidden", "true");
  interiorModal.setAttribute("inert", "");
  element<HTMLElement>(".app-shell").removeAttribute("inert");
  const target = interiorReturnFocus?.isConnected ? interiorReturnFocus : element<HTMLElement>("#enterAction");
  target.focus({ preventScroll: true });
  interiorReturnFocus = null;
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
element<HTMLElement>(".sheet-route").addEventListener("keydown", (event) => {
  if (!(event instanceof KeyboardEvent) || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  const tabs = [...document.querySelectorAll<HTMLButtonElement>(".sheet-route [role='tab']")];
  const current = tabs.indexOf(document.activeElement as HTMLButtonElement);
  const next = event.key === "Home"
    ? 0
    : event.key === "End"
      ? tabs.length - 1
      : (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
  event.preventDefault();
  tabs[next]?.focus();
  tabs[next]?.click();
});
element("#leaseAction").dataset.action = "lease";
element("#buildAction").dataset.action = "build";
element("#enterAction").dataset.action = "interior";
element("#closeInterior").addEventListener("click", closeInterior);
document.querySelectorAll<HTMLButtonElement>("[data-interior-move]").forEach((button) => {
  const direction = button.dataset.interiorMove as InteriorMoveDirection;
  const start = (event: PointerEvent): void => {
    event.preventDefault();
    button.setPointerCapture?.(event.pointerId);
    interiorWorld.setMoveInput(direction, true);
  };
  const stop = (event: PointerEvent): void => {
    event.preventDefault();
    interiorWorld.setMoveInput(direction, false);
  };
  button.addEventListener("pointerdown", start);
  button.addEventListener("pointerup", stop);
  button.addEventListener("pointercancel", stop);
  button.addEventListener("lostpointercapture", stop);
});
new ResizeObserver(() => {
  if (interiorOpen) interiorWorld.resize();
}).observe(element("#interiorStage"));

function trapFocusWithin(container: HTMLElement, event: KeyboardEvent): void {
  const focusable = [...container.querySelectorAll<HTMLElement>(
    'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )].filter((node) => node.getClientRects().length > 0);
  if (!focusable.length) return;
  const first = focusable[0]!;
  const last = focusable.at(-1)!;
  if (!container.contains(document.activeElement)) {
    event.preventDefault();
    first.focus();
  } else if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

window.addEventListener("keydown", (event) => {
  if (event.key === "Tab" && interiorOpen) trapFocusWithin(interiorModal, event);
  else if (event.key === "Tab" && sheet.dataset.open === "true") trapFocusWithin(sheet, event);
  if (event.code === "Escape" && interiorOpen) closeInterior();
  if (event.altKey && ["Digit1", "Digit2", "Digit3"].includes(event.code)) {
    event.preventDefault();
    switchTab(["shop", "trade", "world"][Number(event.code.at(-1)) - 1]);
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
        const arrival = plotArrival(plot);
        store.updatePlayer(plot.island, arrival.x, arrival.z);
        store.markTutorial("moved");
        store.savePosition();
        world.teleportToState(store.state);
        realm.reseedPosition();
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
  else if (action === "buy-deed") report(store.purchaseDeed());
  else if (action === "buy-sponsor") report(store.purchaseSponsorship());
  else if (action === "buy-charter") report(store.purchaseCharter());
  else if (action === "bank-in") report(store.exchangeMMForMercDollars(100));
  else if (action === "bank-out") report(store.exchangeMercDollarsForMM(1000));
  else if (action === "repair") report(store.repairBreakdown());
  else if (action === "restore-supply") report(store.restoreSupply());
  else if (action === "hire") report(store.hireStaff());
  else if (action === "release") report(store.releaseStaff());
  else if (action === "switch-business") report(store.switchBusiness(button.dataset.plot ?? ""));
  else if (action === "marker" && button.dataset.plot === "order") {
    const active = store.state.activeContract;
    if (active && store.state.inventory[active.resource] >= active.quantity) report(store.fulfillContract());
    else if (!active) { const offer = store.bestOffer(); if (offer) report(store.acceptContract(offer.id)); switchTab("trade"); }
    else switchTab("trade");
  }
  else if (action === "marker" && button.dataset.plot === "market") switchTab("trade");
  else if (action === "marker" && (button.dataset.plot ?? "").startsWith("civic-")) {
    const civic = CIVIC_BUILDINGS.find((entry) => `civic-${entry.id}` === button.dataset.plot);
    switchTab(civic?.opens ?? "trade");
  }
  else if (action === "marker" && button.dataset.plot === "event") switchTab("world");
  else if (action === "marker") {
    const plotId = button.dataset.plot ?? "";
    if (store.state.portfolio[plotId]) { if (plotId !== store.state.ownedPlotId) store.switchBusiness(plotId); }
    else store.selectPlot(plotId);
    switchTab(store.state.portfolio[plotId]?.buildingPlaced ? "shop" : "shop");
    openSheet();
  }
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
  else if (action === "accept-contract") report(store.acceptContract(button.dataset.contract ?? ""));
  else if (action === "fulfill-contract") report(store.fulfillContract());
  else if (action === "release-contract") report(store.releaseContract());
  else if (action === "refresh-contracts") report(store.refreshContracts());
  else if (action === "claim-daily") report(store.claimDailyReward());
  else if (action === "service-price") report(store.setServicePrice(Number(button.dataset.price)));
  else if (action === "interior-focus") {
    interiorWorld.focusTarget(button.dataset.upgrade as UpgradeKey);
    interiorCanvas.focus({ preventScroll: true });
  }
  else if (action === "interior-interact") {
    interiorWorld.interact();
    if (interiorOpen) interiorCanvas.focus({ preventScroll: true });
  }
  else if (action === "interior-exit") closeInterior();
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
  realm.reseedPosition();
  await world.syncBuildings(store.state);
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
