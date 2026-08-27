import { BREAKDOWN_REPAIR_COST, BREAKDOWN_REPAIR_PARTS, BUSINESS, CHARTER_COST_MM, CIVIC_BUILDINGS, DEED_COST_MM, MAX_UPGRADE_LEVEL, MM_BURN_RATE, SPONSORSHIP_COST_MM, MERC_DOLLARS_PER_USD, BUSINESS_STAGES, DAILY_GOALS, ISLANDS, MM_TOTAL_SUPPLY, PLOTS, RESOURCES, SPECIALIZATIONS, CAREER_LEVELS, COUNTER_SERVICES, CURRENCY_CODE, RIDE_MINIMUM_FARE, MAYOR, MAYOR_SCRIPT, TUTORIAL, UPGRADE_COSTS, UPGRADE_NAMES, type BusinessStage, type LicenseKey, type ResourceKey, type SpecializationKey, type UpgradeKey } from "./data";
import { BUSINESS_TIER, PRODUCTS_BY_ID, TIER_NAMES } from "./products";
import { buyFromCivic, fetchDistrict, isSynced, refreshWorldOwner, registerBusiness, sellToDistrict,
  worldRunsOnServer, fetchCityBooks, fetchMarketBook, fetchHoldings, fetchIdentity, listOnMarket, buyMarketListing,
  cancelMarketListing, type MarketListing } from "./realm";
import { GameStore, isDemo, type ActionResult } from "./state";
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

// A handle for probes only. `import.meta.env.DEV` is substituted with a literal at
// build time, so the whole block is dropped from the shipped bundle.
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__mm = { store, world: () => world, interior: () => interiorWorld };
}
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
/** Counter-trade settled since the last HUD refresh, so the redraw can be batched. */
let citizenTradeSinceRender = 0;
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
  // Footfall is the sale. The HUD is refreshed on a timer rather than per customer:
  // a busy shop settles several visits a second, and re-rendering on each one would
  // spend more time in the DOM than in the game.
  onCitizenVisit: (plotId) => {
    const sale = store.settleCitizenVisit(plotId);
    if (sale) citizenTradeSinceRender += 1;
    return sale !== null;
  },
  onLoadProgress: (progress, label) => {
    loadingBar.style.width = `${Math.round(progress * 100)}%`;
    loadingLabel.textContent = label;
  },
});

/**
 * Tell the authority what stands on this plot.
 *
 * Fire-and-forget: the game is perfectly playable unregistered — it simply runs alone,
 * invisible to other makers and un-ticked by the server. So a failure here is worth a
 * line in the console and nothing more, never an interruption to the player.
 */
function publishBusiness(): void {
  if (!isSynced()) return;
  const plotId = store.state.ownedPlotId;
  const license = store.state.license;
  if (!plotId || !license || !store.state.buildingPlaced) return;
  void registerBusiness({
    plotId, license,
    condition: Math.round(store.state.condition),
    upgrades: { ...store.state.upgrades },
  }).then((outcome) => {
    if (outcome.status === "refused") console.warn(`registry refused ${plotId}: ${outcome.message}`);
  });
}

const interiorWorld = new InteriorWorld(interiorCanvas, {
  onInteract: (key) => {
    const result = store.purchaseUpgrade(key);
    report(result);
    if (result.ok) publishBusiness();
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

/**
 * A wallet address, shortened to something a person can recognise across a street.
 *
 * The full address is meaningless at a glance and far too long for a plaque; the first
 * four characters are what everybody actually uses to tell each other apart.
 */
function makerName(playerId: string): string {
  const clean = playerId.replace(/[^A-Za-z0-9]/g, "");
  if (clean.length <= 8) return clean || "Maker";
  return `${clean.slice(0, 4)}…${clean.slice(-4)}`;
}

function markerModels(): MarkerModel[] {
  const state = store.state;
  const island = ISLANDS.find((entry) => entry.id === state.island) ?? ISLANDS[0]!;
  const models: MarkerModel[] = [];

  // Every real person in the district wears their name. Remote makers were drawn as
  // anonymous figures, indistinguishable from the Mercedonians walking to the shops —
  // so the one genuinely social thing on screen looked like scenery.
  for (const peer of world.peerPositions()) {
    models.push({
      id: `peer-${peer.playerId}`, kind: "maker",
      label: "Maker", title: makerName(peer.playerId), detail: "",
      x: peer.x, y: peer.y, z: peer.z, building: false,
    });
  }

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

/**
 * The models currently on screen, kept between frames.
 *
 * Building signs and player nameplates are HTML projected onto 3D positions, and both
 * jobs used to run on the same 90ms throttle: rebuilding the markup AND moving the
 * markers. Content at 11Hz is fine — a price does not need sixty updates a second — but
 * POSITION at 11Hz is a label sliding along behind the thing it belongs to, which is
 * exactly what it looked like when the avatar walked.
 *
 * Content is still throttled. Position now runs every frame, off this cache.
 */
let markerCache: MarkerModel[] = [];

function refreshMarkerContent(): void {
  const models = markerModels();
  markerCache = models;
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
}

/** Move every marker to where its anchor is now. Cheap, and runs every frame. */
function positionMarkers(): void {
  const models = markerCache;
  if (models.length === 0) return;
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
  // The zones the HUD occupies. Markers must not be placed under any of them.
  //
  // This list still named the elements from before the HUD was laid out on a grid —
  // .topbar is now hidden, and .world-label and .world-actions moved inside zones — so
  // most of it matched nothing and pins were free to pile up under the business panel and
  // the two bars. Naming the ZONES instead means it cannot rot the next time something
  // moves house.
  const reserved = [".hud-top", ".hud-business", ".hud-world", ".hud-guide", ".hud-rail",
                    ".counter-panel", ".selected-card"]
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
  // What a marker SAYS can lag; where it IS cannot. Rebuilding the markup is the
  // expensive half and stays on a throttle; moving them is cheap and happens every frame,
  // so a nameplate stays glued to the maker wearing it.
  const now = performance.now();
  if (now - lastMarkerSync >= 90) {
    lastMarkerSync = now;
    refreshMarkerContent();
  }
  positionMarkers();
});

// Replay the time the player was away, on load and whenever they come back to the tab.
store.catchUp();
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  const shift = store.catchUp();
  if (shift.jobs > 0) toast(`${shift.jobs} job${shift.jobs === 1 ? "" : "s"} ran while you were away.`);
  renderAll();
});
// Who owns the district decides whether this client settles its own footfall. Asked
// once at boot, before any catch-up runs, so a returning player is not paid twice for
// a night the authority already settled.
void refreshWorldOwner().then((owner) => {
  if (owner === "server") console.info("world: the authority is running this district");
  publishBusiness();
});

window.setInterval(() => { if (store.catchUp().jobs > 0) renderAll(); }, 60_000);

// Other makers' shops. Refreshed on a slow timer: a street does not change often, and
// this is a courtesy view rather than anything the player's own game depends on.
let districtShopCount = 0;
async function refreshDistrict(): Promise<void> {
  const listed = await fetchDistrict(store.state.island);
  if (!listed) return;
  districtShopCount = listed.length;
  const others = listed.filter((entry) => !entry.mine);
  // Neighbours are customers, not just scenery. Every business in the district buys the
  // goods above it in the chain, so the count feeds straight into how deep the local
  // market is — which is the whole reason a busy district pays better than an empty one.
  // Without this line the cooperation the economy models could be measured in a test and
  // reached by nobody in the actual game.
  store.setDistrictBusinesses(others.length);
  await world.showNeighbours(others.map((entry) => ({
    plotId: entry.plotId, license: entry.license, owner: entry.owner,
  })));
  renderHeader();
}
void refreshDistrict();
window.setInterval(() => { void refreshDistrict(); }, 45_000);

// The order book moves whenever anyone else trades, so it is refreshed on its own timer
// rather than only when this player does something.
void refreshMakerMarket();
window.setInterval(() => { void refreshMakerMarket(); }, 30_000);

// The city's books. Slow on purpose — the treasury moves every minute, not every frame.
async function refreshCityBooks(): Promise<void> {
  cityBooks = await fetchCityBooks();
  if (infoTab === "city") renderInfo();
}
void refreshCityBooks();
window.setInterval(() => { void refreshCityBooks(); }, 60_000);

// Counter trade lands whenever a Mercedonian reaches the door, which on a busy street
// is several times a second. The takings are already banked by then; this only decides
// how often the number on screen catches up.
window.setInterval(() => {
  if (citizenTradeSinceRender === 0) return;
  citizenTradeSinceRender = 0;
  renderHeader();
}, 1_500);

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
  // Worth surfacing: whether this district is being run by the authority or by this
  // browser alone changes what "away" means, and it is otherwise invisible.
  const shared = worldRunsOnServer() ? "Shared world" : label;
  const neighbours = districtShopCount > 0 ? ` · ${districtShopCount} shops` : "";
  network.textContent = peerCount > 0
    ? `${shared} · ${peerCount} nearby${neighbours}`
    : `${shared}${neighbours}`;
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
 * An orientation lock is only granted from fullscreen, and only by Android — iOS
 * Safari has no equivalent at all. So this goes fullscreen first and then asks, and
 * treats both as best-effort: whatever the platform grants, the game keeps playing in
 * whatever orientation the player is actually holding. Nothing here blocks play,
 * which is the point — the card this replaced covered the whole screen to deliver one
 * sentence the player could already see for themselves.
 */
async function requestLandscape(): Promise<boolean> {
  const root = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> };
  try {
    if (!document.fullscreenElement) {
      if (root.requestFullscreen) await root.requestFullscreen({ navigationUI: "hide" });
      else if (root.webkitRequestFullscreen) await root.webkitRequestFullscreen();
    }
  } catch {
    // Refused. The lock below will almost certainly be refused too; that is fine.
  }
  const orientation = screen.orientation as (ScreenOrientation & { lock?: (to: string) => Promise<void> }) | undefined;
  if (!orientation?.lock) return false;
  try {
    await orientation.lock("landscape");
    return true;
  } catch {
    return false;
  }
}

/**
 * The button, and the reason it needs to answer even when it fails.
 *
 * iPhone Safari has no orientation lock at all — `screen.orientation.lock` is simply not
 * there — and no fullscreen outside a video element, so on the most common phone in the
 * world this control could do literally nothing and said nothing about it. Tapping a
 * button and having the screen not react reads as a broken game, not as an unsupported
 * platform, and it was reported as exactly that.
 *
 * It now either rotates the screen or tells the player to rotate the phone. One of those
 * always happens.
 */
element<HTMLButtonElement>("#rotateGate").addEventListener("click", () => {
  void requestLandscape().then((locked) => {
    if (locked) return;
    toast("This browser will not turn the screen for you — turn your phone sideways instead.");
  });
});

// And one silent attempt on the first touch, for the platforms that allow it without
// fullscreen, so most players never need the button at all.
window.addEventListener("pointerdown", () => {
  if (!window.matchMedia("(pointer: coarse)").matches) return;
  const orientation = screen.orientation as (ScreenOrientation & { lock?: (to: string) => Promise<void> }) | undefined;
  void orientation?.lock?.("landscape").catch(() => {});
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
  info: "Everything at a glance",
};

type UiIconName = "enterprise" | "exchange" | "world" | "rank";

function uiIcon(name: UiIconName): string {
  return `<svg class="mm-icon" aria-hidden="true" focusable="false"><use href="#mm-icon-${name}"></use></svg>`;
}

const SHEET_META: Record<string, { icon: UiIconName; kicker: string }> = {
  shop: { icon: "enterprise", kicker: "Enterprise desk" },
  trade: { icon: "exchange", kicker: "Exchange hall" },
  world: { icon: "world", kicker: "World atlas" },
  info: { icon: "rank", kicker: "Information desk" },
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
  produced:   { tab: "shop",  label: "See the floor", hint: "Watch a cycle run. You do not start it." },
  upgraded:   { tab: "shop",  label: "Upgrade",      hint: "Install one improvement in your building." },
  sold:       { tab: "trade", label: "See who buys", hint: "Mercedonians buy what you make." },
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
  element<HTMLSpanElement>("#nextMeter").style.width = `${Math.round((done / TUTORIAL.length) * 100)}%`;

  const go = element<HTMLButtonElement>("#nextGo");
  go.textContent = step?.label ?? "Explore";
  go.dataset.action = key === "moved" ? "walk-plaza" : "tab";
  go.dataset.target = step?.tab ?? "world";
  element("#nextStep").classList.toggle("complete", !next);

  // The Mayor's half: what she says, and the reason underneath it. On the very first step
  // she introduces herself, because a stranger giving instructions is just a tooltip.
  const script = key ? MAYOR_SCRIPT[key] : undefined;
  const opening = key === "moved" && !store.state.tutorial.moved ? `${MAYOR.welcome} ` : "";
  element("#nextHint").textContent = script ? `${opening}${script.says}` : (next ? step?.hint ?? "" : MAYOR.farewell);
  element("#nextBecause").textContent = script?.because ?? "";
  element("#nextBecause").hidden = !script;
  element("#nextLabel").textContent = next
    ? `${MAYOR.name} · Step ${stepIndex + 1} of ${TUTORIAL.length}`
    : `${MAYOR.name} · ${MAYOR.title}`;

  // Hidden by choice, or automatically once there is nothing left to be told.
  const hidden = store.state.mayorHidden || !next;
  element("#nextStep").hidden = hidden;
  element<HTMLButtonElement>("#mayorRecall").hidden = !hidden || !next;

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
  // Nothing to press. The line runs itself — see the note on Operations in state.ts.
  if (!state.job || !state.license) {
    return `<div class="operation-idle"><strong>The line is between cycles</strong>
      <small>Your workers start the next one on their own. Nothing here needs pressing.</small></div>`;
  }
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

/** Your trade, what it makes, what it costs to run, and what is left over. */
function productionMarkup(): string {
  const licence = store.state.license;
  if (!licence) return "";
  const tier = BUSINESS_TIER[licence];
  const profit = store.todayProfit();
  return `
    <div class="ledger">
      <div><small>Today's takings</small><strong>${formatNumber(store.state.todayRevenue)}</strong></div>
      <div><small>Today's costs</small><strong>${formatNumber(store.state.todayExpenses)}</strong></div>
      <div class="${profit >= 0 ? "positive" : "negative"}"><small>Profit</small><strong>${profit >= 0 ? "+" : ""}${formatNumber(profit)}</strong></div>
      <div><small>Standing charges</small><strong>${store.dailyOverhead()}/day</strong></div>
    </div>
    <div class="section-title">What you make <span class="tier-chip tier-${tier}">${TIER_NAMES[tier]}</span></div>
    <div class="product-list">
      ${store.productsMade().map((product) => {
        const stock = store.stockOf(product.id);
        const missing = store.missingInputs(product);
        const needs = Object.entries(product.inputs);
        return `<article class="product ${store.canMake(product) ? "ready" : ""}">
          <div class="product-head">
            <div><strong>${product.name}</strong><small>${"\u25CF".repeat(product.complexity)} · sells for ${product.price} ${CURRENCY_CODE}</small></div>
            <span class="product-stock">${stock}</span>
          </div>
          ${needs.length
            ? `<div class="product-needs">${needs.map(([id, qty]) => {
                const input = PRODUCTS_BY_ID.get(id)!;
                const held = store.stockOf(id);
                return `<span class="${held >= qty ? "have" : "short"}">${held}/${qty} ${input.name}</span>`;
              }).join("")}</div>`
            : `<div class="product-needs"><span class="have">Raw production</span></div>`}
          <div class="product-actions">
            <button data-action="make-product" data-product="${product.id}" ${store.canMake(product) ? "" : "disabled"}>Make · ${product.labour} ${CURRENCY_CODE}</button>
            <button class="secondary" data-action="sell-product" data-product="${product.id}" ${stock > 0 ? "" : "disabled"}>Sell · ${product.price}</button>
          </div>
          ${missing.length ? `<small class="product-hint">Buy ${missing.map((m) => `${m.short} ${m.product.name}`).join(", ")} from ${[...new Set(missing.map((m) => BUSINESS[m.product.business].name))].join(" or ")}.</small>` : ""}
        </article>`;
      }).join("")}
    </div>`;
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
    ${productionMarkup()}

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
        return `<div class="market-row" style="--resource-color:${resource.color}"><i>${resource.icon}</i><div class="market-name"><strong>${resource.name}</strong><small>${resource.tier} · ${resource.buyer === "citizens" ? "Households" : "Civic"} ${store.procurementRemaining(key)}/${store.dailyQuota(key)} at full price</small></div><div class="market-quote"><strong>${store.marketBuyPrice(key)} ${CURRENCY_CODE} <small>buy</small></strong><span>${store.marketSellPrice(key)} ${CURRENCY_CODE} sell · hold ${store.state.inventory[key]}</span><em class="${trend}">${pressure > 0 ? "+" : ""}${pressure}% ${trend}</em></div><div class="market-actions"><button data-action="buy" data-resource="${key}">Buy 1</button><span class="market-auto" title="Mercedonians and the trades below you buy this as they need it">bought by demand</span></div></div>`;
      }).join("")}
      ${visibleKeys.length ? "" : `<div class="empty-state"><i>⇄</i><strong>No goods in this view</strong><p>${marketFilter === "needed" ? "Choose a business license to reveal its required inputs." : "Produce or buy something to build your stock."}</p><button data-action="market-filter" data-filter="all">Show all goods</button></div>`}
    </div>
    <div class="section-title">Ledger health</div>
    <div class="stat-grid"><div class="stat"><small>Civic treasury</small><strong>${formatNumber(store.state.governmentTreasury)} ${CURRENCY_CODE}</strong></div><div class="stat"><small>Mercedonian spending pool</small><strong>${formatNumber(store.state.citizenPool)} ${CURRENCY_CODE}</strong></div><div class="stat"><small>Payroll returned to Mercedonians</small><strong>${formatNumber(store.state.laborPaid)} ${CURRENCY_CODE}</strong></div><div class="stat"><small>Your tax paid</small><strong>${formatNumber(store.state.taxPaid)} ${CURRENCY_CODE}</strong></div><div class="stat"><small>$MM accounted in game</small><strong>${formatNumber(store.totalMMInGameVaults())}</strong></div><div class="stat"><small>Total $MM supply</small><strong>${formatNumber(MM_TOTAL_SUPPLY)}</strong></div></div>
    <p class="model-note">Merc Dollar prices are bounded and mean-reverting. $MM is never required for leases, payroll, inputs, services or taxes. This remains a gameplay simulation—not a promise of token value, yield or profit.</p>
  `;
}


// --- The maker market ----------------------------------------------------------------
//
// Selling to the district is a published price you take or leave. This is the other half
// of a market: makers setting their own prices and buying from each other. The authority
// has escrowed order books since the world went server-side; nothing had ever called them.
//
// Prices are chosen RELATIVE to the district rate rather than typed into a blank box. Two
// taps, no validation to fail, and it anchors a new maker to a sensible number instead of
// asking them to guess what water is worth.

interface ListingDraft { item: ResourceKey | null; quantity: number; markup: number }

let makerListings: MarketListing[] = [];
let makerHoldings: Record<string, number> = {};
let myPlayerId: string | null = null;
let marketBusy = false;
const listingDraft: ListingDraft = { item: null, quantity: 10, markup: 0 };

const MARKUP_STEPS: Array<{ markup: number; label: string }> = [
  { markup: -0.15, label: "Undercut" },
  { markup: 0, label: "Match" },
  { markup: 0.2, label: "Premium" },
];

/** The district's proper name, not the id the URL uses. */
function districtName(): string {
  return (ISLANDS.find((entry) => entry.id === store.state.island) ?? ISLANDS[0]!).name;
}

/** The district's published price, which every listing price is quoted against. */
function referencePrice(key: ResourceKey): number {
  return Math.max(1, store.marketSellPrice(key));
}

function draftUnitPrice(): number {
  if (!listingDraft.item) return 0;
  return Math.max(1, Math.round(referencePrice(listingDraft.item) * (1 + listingDraft.markup)));
}

async function refreshMakerMarket(): Promise<void> {
  const [book, holdings] = await Promise.all([
    fetchMarketBook(store.state.island),
    fetchHoldings(),
  ]);
  if (book) makerListings = book;
  if (holdings) makerHoldings = holdings.inventory;
  if (myPlayerId === null) myPlayerId = (await fetchIdentity())?.playerId ?? null;
  renderMakerMarket();
}

function renderMakerMarket(): void {
  const node = document.querySelector<HTMLElement>("#makerMarketPanel");
  if (!node) return;

  if (!isSynced()) {
    node.innerHTML = `<h2>Maker market</h2>
      <div class="empty-state"><i>⇄</i><strong>Sign in to trade with other makers</strong>
      <p>Link a Solana wallet to buy and sell with everyone else in ${escapeMarkup(districtName())}. The district counter works either way.</p></div>`;
    return;
  }

  // Only offer what the AUTHORITY says you hold: a listing escrows from the server's
  // ledger, so offering what only the browser believes in is refused at the door.
  const sellable = (Object.keys(RESOURCES) as ResourceKey[])
    .filter((key) => (makerHoldings[key] ?? 0) > 0);
  if (listingDraft.item && !sellable.includes(listingDraft.item)) listingDraft.item = null;
  if (!listingDraft.item) listingDraft.item = sellable[0] ?? null;

  const held = listingDraft.item ? makerHoldings[listingDraft.item] ?? 0 : 0;
  const quantity = Math.max(1, Math.min(listingDraft.quantity, held));
  const unitPrice = draftUnitPrice();

  const mine = makerListings.filter((entry) => entry.sellerPlayerId === myPlayerId);
  const theirs = makerListings.filter((entry) => entry.sellerPlayerId !== myPlayerId);

  const row = (entry: MarketListing, ours: boolean): string => {
    const spec = RESOURCES[entry.itemKey as ResourceKey];
    if (!spec) return "";
    const reference = referencePrice(entry.itemKey as ResourceKey);
    const delta = Math.round(((entry.unitPrice - reference) / reference) * 100);
    return `<li class="maker-listing${ours ? " mine" : ""}">
      <i aria-hidden="true">${spec.icon}</i>
      <span><strong>${entry.quantity} ${escapeMarkup(spec.short)}</strong>
        <small>${entry.unitPrice} ${CURRENCY_CODE} each · ${delta === 0 ? "at the district rate" : `${delta > 0 ? "+" : ""}${delta}% vs district`}</small></span>
      <span class="maker-listing-total">${formatNumber(entry.total)} ${CURRENCY_CODE}</span>
      ${ours
        ? `<button class="secondary" data-action="market-cancel" data-listing="${entry.id}" ${marketBusy ? "disabled" : ""}>Withdraw</button>`
        : `<button data-action="market-buy" data-listing="${entry.id}" ${marketBusy || store.state.wallet < entry.total ? "disabled" : ""}>${store.state.wallet < entry.total ? "Too dear" : "Buy"}</button>`}
    </li>`;
  };

  node.innerHTML = `
    <h2>Maker market</h2>
    <p class="model-note">Goods other makers are selling in ${escapeMarkup(districtName())}. Each district keeps its own book. A listing holds the goods in escrow until somebody buys them or you withdraw it. The city takes 2% of a sale.</p>

    <div class="section-title">On offer${theirs.length ? ` · ${theirs.length}` : ""}</div>
    ${theirs.length
      ? `<ul class="maker-listings">${theirs.map((entry) => row(entry, false)).join("")}</ul>`
      : `<div class="empty-state"><i>◎</i><strong>Nobody is selling here yet</strong><p>Be the first — list something below and set your own price.</p></div>`}

    ${mine.length ? `<div class="section-title">Your listings · ${mine.length}</div>
      <ul class="maker-listings">${mine.map((entry) => row(entry, true)).join("")}</ul>` : ""}

    <div class="section-title">Sell to makers</div>
    ${sellable.length ? `
      <div class="maker-sell">
        <div class="maker-chips" role="group" aria-label="Goods you hold">
          ${sellable.map((key) => `<button class="${listingDraft.item === key ? "active" : ""}" data-action="market-pick" data-resource="${key}">
            <i aria-hidden="true">${RESOURCES[key].icon}</i>${escapeMarkup(RESOURCES[key].short)} <small>${makerHoldings[key]}</small></button>`).join("")}
        </div>
        <div class="maker-chips" role="group" aria-label="How many">
          ${[10, 50, held].filter((n, i, all) => n > 0 && all.indexOf(n) === i).map((n) => `<button class="${quantity === Math.min(n, held) ? "active" : ""}" data-action="market-qty" data-quantity="${n}">${n === held ? `All ${held}` : n}</button>`).join("")}
        </div>
        <div class="maker-chips" role="group" aria-label="Your price">
          ${MARKUP_STEPS.map((step) => `<button class="${listingDraft.markup === step.markup ? "active" : ""}" data-action="market-markup" data-markup="${step.markup}">
            ${step.label} <small>${listingDraft.item ? Math.max(1, Math.round(referencePrice(listingDraft.item) * (1 + step.markup))) : 0} ${CURRENCY_CODE}</small></button>`).join("")}
        </div>
        <button class="interior-buy" data-action="market-list" ${marketBusy || !listingDraft.item || held <= 0 ? "disabled" : ""}>
          ${listingDraft.item
            ? `List ${quantity} ${escapeMarkup(RESOURCES[listingDraft.item].short)} · ${formatNumber(quantity * unitPrice)} ${CURRENCY_CODE} if it all sells`
            : "Nothing to list"}
        </button>
      </div>`
      : `<div class="empty-state"><i>▤</i><strong>Nothing in the warehouse</strong><p>The authority holds no goods for you yet. Produce something, and it can be listed here.</p></div>`}
  `;
}


/**
 * Every maker-market action goes the same way: ask the authority, and only mirror what it
 * confirms. A refusal is shown as-is — it is the shared market talking, and inventing a
 * local fallback would let a browser believe it sold something the ledger never moved.
 */
async function withMarket(work: () => Promise<boolean>): Promise<void> {
  if (marketBusy) return;
  marketBusy = true;
  renderMakerMarket();
  try {
    if (await work()) await refreshMakerMarket();
  } finally {
    marketBusy = false;
    renderAll();
    void refreshMakerMarket();
  }
}

async function placeMakerListing(): Promise<void> {
  const item = listingDraft.item;
  if (!item) return;
  const held = makerHoldings[item] ?? 0;
  const quantity = Math.max(1, Math.min(listingDraft.quantity, held));
  const unitPrice = draftUnitPrice();
  if (quantity <= 0 || unitPrice <= 0) return;

  await withMarket(async () => {
    const outcome = await listOnMarket(store.state.island, item, quantity, unitPrice);
    if (outcome.status === "ok") { report(store.applyMarketListing(item, quantity, unitPrice)); return true; }
    if (outcome.status === "refused") toast(outcome.message);
    else toast("The market is unreachable right now.");
    return false;
  });
}

async function takeMakerListing(listingId: string): Promise<void> {
  const listing = makerListings.find((entry) => entry.id === listingId);
  if (!listing) return;
  await withMarket(async () => {
    const outcome = await buyMarketListing(listingId);
    if (outcome.status === "ok") {
      report(store.applyMarketPurchase(listing.itemKey as ResourceKey, outcome.value.quantity, outcome.value.paid));
      return true;
    }
    if (outcome.status === "refused") toast(outcome.message);
    else toast("The market is unreachable right now.");
    return false;
  });
}

async function withdrawMakerListing(listingId: string): Promise<void> {
  const listing = makerListings.find((entry) => entry.id === listingId);
  if (!listing) return;
  await withMarket(async () => {
    const outcome = await cancelMarketListing(listingId);
    if (outcome.status === "ok") {
      report(store.applyMarketCancel(listing.itemKey as ResourceKey, outcome.value.returned));
      return true;
    }
    if (outcome.status === "refused") toast(outcome.message);
    else toast("The market is unreachable right now.");
    return false;
  });
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
    ${(() => { const outlook = store.upgradeOutlook(selectedKey);
      return outlook ? `<p class="equipment-outlook">${escapeMarkup(outlook)}</p>` : ""; })()}
    <div class="equipment-meter" aria-label="${level} of ${ceiling} equipment levels installed">${Array.from({ length: MAX_UPGRADE_LEVEL }, (_, index) => `<i class="${index < level ? "on" : index >= ceiling ? "locked" : ""}"></i>`).join("")}</div>
    ${atMaximum
      ? `<div class="equipment-cost"><small>${needsCharter ? "Next step" : "Installation complete"}</small><strong>${needsCharter ? `Earn a master charter to unlock level ${MAX_UPGRADE_LEVEL}.` : "This machine is fully developed."}</strong></div>`
      : `<div class="equipment-cost"><small>${level === 0 ? "Purchase cost" : `Level ${nextLevel} installation cost`}</small><div class="cost-row"><span>${cost.mercDollars} ${CURRENCY_CODE}</span>${resourceCosts(cost.resources)}</div></div>`}
    <button class="interior-buy" data-action="interior-interact" ${atMaximum || !nearby ? "disabled" : ""}>${buttonLabel}</button>
    ${selector}
  </div>`;
  consoleNode.scrollTop = 0;
}


// --- The always-on business strip ----------------------------------------------------
//
// A business sim that hides whether the machines are running is asking the player to go
// and look. This is the state of the line — running, idle, out of stock, broken — on
// screen at all times, with the reason attached. "Halted" is useless; "nobody is buying
// timber today" is something a player can act on.

const HALT_REASON: Record<string, { tone: string; label: string; why: string }> = {
  running:    { tone: "good",  label: "Running",        why: "A job is on the floor." },
  demand:     { tone: "warn",  label: "Waiting on demand", why: "The district has bought all it wants today. It refreshes at midnight UTC." },
  storage:    { tone: "warn",  label: "Warehouse full",  why: "Sell something, or fit more storage." },
  funds:      { tone: "bad",   label: "Out of money",    why: "Not enough in the till to pay for inputs or wages." },
  inputs:     { tone: "warn",  label: "Out of inputs",   why: "Turn auto-buy on, or buy the recipe's inputs yourself." },
  breakdown:  { tone: "bad",   label: "Broken down",     why: "Repair it before anything else can run." },
  idle:       { tone: "warn",  label: "Between cycles",  why: "Your workers are starting the next one. Nothing here needs pressing." },
};


// --- The info desk -------------------------------------------------------------------
//
// Four views of the same world: what you are worth, what your line is doing, what the
// district wants, and where the money actually went. Everything here already existed
// somewhere; it was scattered across panels a beginner had no reason to open.

let infoTab: "you" | "business" | "chain" | "district" | "city" | "ledger" = "you";

/** The city's books, refreshed on a slow timer. Public data; no session needed. */
let cityBooks: Awaited<ReturnType<typeof fetchCityBooks>> = { books: null, policy: null };

/** "3m 20s" — the same shape the store uses when it tells you how long the fitters need. */
function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return rest > 0 ? `${minutes}m ${rest}s` : `${minutes}m`;
}

function statTile(label: string, value: string, note = ""): string {
  return `<div class="info-stat"><small>${escapeMarkup(label)}</small><strong>${escapeMarkup(value)}</strong>${note ? `<span>${escapeMarkup(note)}</span>` : ""}</div>`;
}


/**
 * The supply chain, drawn.
 *
 * Anno 1800 is built around showing players what feeds what, and it is the single thing a
 * fifteen-trade economy most needs explaining. Markets & Makers had the chain in its
 * recipes and nowhere a player could see it: you could not find out who buys timber
 * without opening all fifteen licences and reading them.
 *
 * Rendered from BUSINESS itself, so it can never drift from the recipes it describes.
 */
function renderChain(): string {
  const licences = Object.keys(BUSINESS) as LicenseKey[];
  const mine = store.state.license;

  // Who makes it, and who consumes it — read straight off the recipes.
  const makers = new Map<ResourceKey, LicenseKey[]>();
  const buyers = new Map<ResourceKey, LicenseKey[]>();
  for (const key of licences) {
    for (const [resource, amount] of Object.entries(BUSINESS[key].output) as Array<[ResourceKey, number]>) {
      if (amount > 0) makers.set(resource, [...(makers.get(resource) ?? []), key]);
    }
    for (const [resource, amount] of Object.entries(BUSINESS[key].inputs) as Array<[ResourceKey, number]>) {
      if (amount > 0) buyers.set(resource, [...(buyers.get(resource) ?? []), key]);
    }
  }

  const stages = BUSINESS_STAGES.filter((stage) => licences.some((k) => BUSINESS[k].stage === stage));
  const chip = (key: LicenseKey): string => {
    const config = BUSINESS[key];
    const owned = key === mine;
    const takes = (Object.keys(config.inputs) as ResourceKey[]).filter((r) => (config.inputs[r] ?? 0) > 0);
    const gives = (Object.keys(config.output) as ResourceKey[]).filter((r) => (config.output[r] ?? 0) > 0);
    return `<div class="chain-node${owned ? " mine" : ""}" title="${escapeMarkup(config.name)}">
      <strong>${escapeMarkup(config.name)}</strong>
      <div class="chain-io">
        <span class="chain-in">${takes.length ? takes.map((r) => `<i title="${escapeMarkup(RESOURCES[r].name)}">${RESOURCES[r].icon}</i>`).join("") : "<em>labour only</em>"}</span>
        <b aria-hidden="true">\u2192</b>
        <span class="chain-out">${config.servicePayout ? "<em>service</em>" : gives.map((r) => `<i title="${escapeMarkup(RESOURCES[r].name)}">${RESOURCES[r].icon}</i>`).join("")}</span>
      </div>
      ${owned ? "<u>yours</u>" : ""}
    </div>`;
  };

  const goodRow = (resource: ResourceKey): string => {
    const from = makers.get(resource) ?? [];
    const to = buyers.get(resource) ?? [];
    return `<div class="chain-good">
      <span class="chain-good-name"><i>${RESOURCES[resource].icon}</i>${escapeMarkup(RESOURCES[resource].short)}</span>
      <span class="chain-good-side"><small>made by</small>${from.map((k) => escapeMarkup(BUSINESS[k].name)).join(", ") || "\u2014"}</span>
      <span class="chain-good-side"><small>bought by</small>${to.map((k) => escapeMarkup(BUSINESS[k].name)).join(", ") || "households only"}</span>
    </div>`;
  };

  return `
    <p class="model-note">Every trade here buys from another. This is the whole chain, read straight from the recipes — find what your goods feed, or what you would need to make something yourself.</p>
    ${stages.map((stage) => `
      <div class="section-title">${escapeMarkup(stage)}</div>
      <div class="chain-row">${licences.filter((k) => BUSINESS[k].stage === stage).map(chip).join("")}</div>`).join("")}
    <div class="section-title">Who wants what</div>
    <div class="chain-goods">${(Object.keys(RESOURCES) as ResourceKey[]).map(goodRow).join("")}</div>`;
}


/**
 * THE TREASURY — the city's books, and the government's reasoning.
 *
 * This is the engine of the entire economy: the treasury pays wages every minute, those
 * wages become household purses, and those purses are every shop's customers. It was a
 * number in three stat grids, so a player could not tell whether the thing their income
 * ultimately depends on was healthy, what it was spending, or what the AI running it had
 * decided to do lately.
 *
 * Everything here is measured off the live authority, including the runway — how long the
 * treasury lasts at today's wage bill — which is the one figure that says whether any of
 * this is sustainable.
 */
function renderCity(): string {
  const { books, policy } = cityBooks;
  if (!books) {
    return `<div class="empty-state"><i>\u25C8</i><strong>The city's books are not open from here</strong>
      <p>${isDemo() ? "A demo runs its own private city. Sign in to see the real one." : "The authority could not be reached. The books are public — try again in a moment."}</p></div>`;
  }

  const supply = books.treasury + books.citizensPurse + books.makersHolding;
  // At today's wage bill, how long does the treasury last? The number that matters.
  const runwayDays = books.wagesPaidToday > 0 ? Math.floor(books.treasury / books.wagesPaidToday) : Infinity;
  const runway = !Number.isFinite(runwayDays) ? "no wages drawn yet"
    : runwayDays > 3650 ? "over ten years" : `${formatNumber(runwayDays)} days at today's rate`;
  const measured = new Date(books.measuredAt);

  return `
    <p class="model-note">Mercedonia's accounts, read from the authority ${measured.toLocaleTimeString()}. The treasury pays every household a civic wage each day; that money becomes the custom in your shop. Nothing here is minted — it only moves.</p>

    <div class="section-title">Where the city's money is</div>
    <div class="info-grid">
      ${statTile("Civic treasury", `${formatNumber(books.treasury)} ${CURRENCY_CODE}`, `Runway: ${runway}`)}
      ${statTile("Household purses", `${formatNumber(books.citizensPurse)} ${CURRENCY_CODE}`, "What your customers can afford")}
      ${statTile("Makers hold", `${formatNumber(books.makersHolding)} ${CURRENCY_CODE}`, `Across ${formatNumber(books.businesses)} ${books.businesses === 1 ? "business" : "businesses"}`)}
      ${statTile("Total in circulation", `${formatNumber(supply)} ${CURRENCY_CODE}`, "Moved, never created")}
    </div>

    <div class="section-title">Today</div>
    <div class="info-grid">
      ${statTile("Wages paid", `${formatNumber(books.wagesPaidToday)} ${CURRENCY_CODE}`, "Straight into household purses")}
      ${statTile("Districts trading", formatNumber(books.districts.length))}
      ${statTile("Busiest trade", books.busiestTrade ? String(books.busiestTrade) : "Nothing sold yet")}
      ${statTile("Quietest shelf", books.quietestShelf ? String(books.quietestShelf) : "—", "Nobody has touched it")}
    </div>

    ${policy ? `
      <div class="section-title">What the government is set to</div>
      <p class="model-note">Five dials, and an advisor that may propose new values for them once a week. It moves no money and it cannot widen its own limits — every proposal passes a clamp and a step limit written in code before it reaches the economy${policy.advisorAvailable ? "" : ", and no advisor is configured on this realm"}.</p>
      <div class="info-table">
        <div class="info-row head"><span>Dial</span><span>Set to</span><span>Allowed</span><span></span></div>
        ${policy.dials.map((dial) => `<div class="info-row" title="${escapeMarkup(dial.meaning)}">
          <span>${escapeMarkup(dial.key.replace(/([A-Z])/g, " $1").toLowerCase())}</span>
          <span>${policy.current[dial.key] ?? "—"}</span>
          <span>${dial.range[0]}–${dial.range[1]}</span><span></span></div>`).join("")}
      </div>

      <div class="section-title">The advisor's record</div>
      ${policy.proposals.length === 0
        ? `<div class="empty-state"><i>\u2696</i><strong>Nothing proposed yet</strong>
            <p>It declines until the realm has ${policy.requiredHistoryDays} days of recorded history. Asked sooner, it would answer fluently and from nothing.</p></div>`
        : `<ul class="advisor-log">${policy.proposals.slice(0, 6).map((entry) => `<li class="advisor-${escapeMarkup(entry.status)}">
            <strong>${escapeMarkup(entry.key)} ${entry.previous} \u2192 ${entry.applied ?? entry.proposed}</strong>
            <em>${escapeMarkup(entry.status)}</em>
            <small>${escapeMarkup(entry.rationale)}</small></li>`).join("")}</ul>`}
    ` : ""}`;
}

function renderInfo(): void {
  const node = document.querySelector<HTMLElement>("#infoPanel");
  if (!node) return;
  document.querySelectorAll<HTMLButtonElement>("[data-action='info-tab']")
    .forEach((b) => b.classList.toggle("active", b.dataset.info === infoTab));

  const level = store.careerLevel();
  const next = store.nextCareerLevel();
  const licence = store.state.license;

  if (infoTab === "you") {
    node.innerHTML = `
      <div class="section-title">Standing</div>
      <div class="info-grid">
        ${statTile("Maker rank", `${level.name}`, `Level ${level.level} of ${CAREER_LEVELS.length}`)}
        ${statTile("Experience", `${formatNumber(store.state.experience)} XP`, next ? `${formatNumber(next.xp - store.state.experience)} to ${next.name}` : "Top of the ladder")}
        ${statTile("Reputation", formatNumber(store.state.reputation), "Earned by selling and delivering")}
        ${statTile("Orders filled", formatNumber(store.state.contractsCompleted), "Named buyers served")}
      </div>
      <div class="section-title">Purse</div>
      <div class="info-grid">
        ${statTile("Merc Dollars", `${formatNumber(store.state.wallet)} ${CURRENCY_CODE}`, "Spendable now")}
        ${statTile("Net worth", `${formatNumber(store.netWorth())} ${CURRENCY_CODE}`, "Cash plus stock at market")}
        ${statTile("$MM held", formatNumber(store.state.mmHoldings), `${formatNumber(store.state.lifetimeMMEarned)} earned in total`)}
        ${statTile("This epoch", formatNumber(Math.round(store.state.epoch.contribution)), `${(store.epochShare() * 100).toFixed(2)}% share · ${formatNumber(store.projectedEpochMM())} $MM projected`)}
      </div>
      <div class="section-title">Holdings</div>
      <div class="info-grid">
        ${statTile("Plots", `${store.ownedPlotIds().length} of ${store.plotAllowance()}`, "Standing and deeds set the ceiling")}
        ${statTile("Civic deeds", formatNumber(store.state.deeds), "Each one raises the ceiling by one")}
        ${statTile("Charter", store.state.chartered ? "Granted" : "Not yet", store.state.chartered ? "Equipment may reach the top level" : `${CHARTER_COST_MM} $MM at the bank`)}
        ${statTile("Specialisation", store.state.specialization ? SPECIALIZATIONS[store.state.specialization].name : "None chosen", "Shapes quality, cost and appeal")}
      </div>`;
    return;
  }

  if (infoTab === "business") {
    if (!licence) {
      node.innerHTML = `<div class="empty-state"><i>\u2699</i><strong>No business yet</strong><p>Lease a plot and choose a trade, and everything about it will show up here.</p></div>`;
      return;
    }
    const config = BUSINESS[licence];
    const economics = store.unitEconomics();
    const cycles = store.inputMultiplier();
    const inputs = (Object.keys(config.inputs) as ResourceKey[]).filter((k) => (config.inputs[k] ?? 0) > 0);
    const outputs = (Object.keys(config.output) as ResourceKey[]).filter((k) => (config.output[k] ?? 0) > 0);
    node.innerHTML = `
      <div class="section-title">${escapeMarkup(config.name)}</div>
      <p class="model-note">${escapeMarkup(config.copy ?? "")}</p>
      <div class="section-title">One cycle</div>
      <div class="recipe-flow">
        <div class="recipe-side"><small>Takes</small>${inputs.length ? inputs.map((k) => `<span><i>${RESOURCES[k].icon}</i>${(config.inputs[k] ?? 0) * cycles} ${escapeMarkup(RESOURCES[k].short)}<b class="${store.state.inventory[k] >= (config.inputs[k] ?? 0) * cycles ? "ok" : "short"}">have ${store.state.inventory[k]}</b></span>`).join("") : "<span>Nothing but labour</span>"}</div>
        <div class="recipe-arrow" aria-hidden="true">\u2192</div>
        <div class="recipe-side"><small>Makes</small>${config.servicePayout ? `<span>Serves ${store.serviceVisitors(config, cycles)} customers</span>` : outputs.map((k) => `<span><i>${RESOURCES[k].icon}</i>${(config.output[k] ?? 0) * cycles} ${escapeMarkup(RESOURCES[k].short)}</span>`).join("")}</div>
      </div>
      ${economics ? `<div class="info-grid">
        ${statTile("Revenue a cycle", `${formatNumber(Math.round(economics.expectedRevenue))} ${CURRENCY_CODE}`, "At today's prices")}
        ${statTile("Costs a cycle", `${formatNumber(economics.inputCost + economics.laborCost)} ${CURRENCY_CODE}`, `${formatNumber(economics.inputCost)} inputs · ${formatNumber(economics.laborCost)} wages`)}
        ${statTile("Profit a cycle", `${economics.expectedProfit >= 0 ? "+" : ""}${formatNumber(Math.round(economics.expectedProfit))} ${CURRENCY_CODE}`, `after ${formatNumber(economics.expectedTax)} tax`)}
        ${statTile("Takes", `${store.jobDuration(licence, cycles)}s`, `${cycles} batch${cycles === 1 ? "" : "es"} at once`)}
      </div>` : ""}
      <div class="section-title">Equipment</div>
      <div class="info-grid">
        ${(Object.keys(UPGRADE_NAMES) as UpgradeKey[]).map((k) => statTile(UPGRADE_NAMES[k].name, `Level ${store.state.upgrades[k]}`, store.upgradeOutlook(k) ? "Will not help yet" : UPGRADE_NAMES[k].effect)).join("")}
      </div>`;
    return;
  }

  if (infoTab === "chain") { node.innerHTML = renderChain(); return; }
  if (infoTab === "city") { node.innerHTML = renderCity(); return; }

  if (infoTab === "district") {
    const keys = Object.keys(RESOURCES) as ResourceKey[];
    node.innerHTML = `
      <div class="section-title">What ${escapeMarkup(districtName())} wants today</div>
      <p class="model-note">The counter buys at these prices until the day's appetite runs out. A busier district has a deeper appetite — and pays a little more for what its own businesses need.</p>
      <div class="info-table">
        <div class="info-row head"><span>Good</span><span>Buy</span><span>Sell</span><span>Left today</span></div>
        ${keys.map((k) => {
          const left = store.procurementRemaining(k);
          const quota = Math.max(1, store.dailyQuota(k));
          return `<div class="info-row"><span><i>${RESOURCES[k].icon}</i>${escapeMarkup(RESOURCES[k].short)}</span>
            <span>${store.marketBuyPrice(k)}</span>
            <span>${store.marketSellPrice(k)}</span>
            <span class="${left === 0 ? "spent" : ""}">${left}<i class="biz-bar"><b style="width:${Math.round((left / quota) * 100)}%"></b></i></span></div>`;
        }).join("")}
      </div>
      <div class="section-title">The street</div>
      <div class="info-grid">
        ${statTile("Other makers here", formatNumber(store.state.districtBusinesses), "Every one of them is a customer for something")}
        ${statTile("Mercedonians", formatNumber(store.mercedonianPopulation?.() ?? store.dailyAudience()), "They walk in and buy what is on the shelf")}
        ${statTile("Confidence", `${store.consumerConfidenceIndex()}`, `Cycle: ${store.economicPhase()}`)}
        ${statTile("Price index", `${store.marketPriceIndex()}`, store.economyTrend())}
      </div>`;
    return;
  }

  node.innerHTML = `
    <div class="section-title">Since midnight</div>
    <div class="info-grid">
      ${statTile("Takings", `${formatNumber(store.state.todayRevenue)} ${CURRENCY_CODE}`)}
      ${statTile("Outgoings", `${formatNumber(store.state.todayExpenses)} ${CURRENCY_CODE}`)}
      ${statTile("Profit today", `${store.todayProfit() >= 0 ? "+" : ""}${formatNumber(store.todayProfit())} ${CURRENCY_CODE}`)}
      ${statTile("Jobs run", formatNumber(store.state.daily.jobs), `${formatNumber(store.state.daily.trades)} trades`)}
    </div>
    <div class="section-title">All time</div>
    <div class="info-grid">
      ${statTile("Lifetime revenue", `${formatNumber(store.state.lifetimeRevenue)} ${CURRENCY_CODE}`)}
      ${statTile("Wages paid", `${formatNumber(store.state.laborPaid)} ${CURRENCY_CODE}`, "Which became somebody's custom")}
      ${statTile("Tax paid", `${formatNumber(store.state.taxPaid)} ${CURRENCY_CODE}`, "Funds the civic wage")}
      ${statTile("Jobs completed", formatNumber(store.state.jobsCompleted))}
    </div>
    <div class="section-title">Where the city's money sits</div>
    <div class="info-grid">
      ${statTile("Civic treasury", `${formatNumber(store.state.governmentTreasury)} ${CURRENCY_CODE}`)}
      ${statTile("Household purses", `${formatNumber(store.state.citizenPool)} ${CURRENCY_CODE}`, "What your customers can afford")}
      ${statTile("Your purse", `${formatNumber(store.state.wallet)} ${CURRENCY_CODE}`)}
      ${statTile("Money supply", `${formatNumber(store.totalMoneySupply())} ${CURRENCY_CODE}`, "Never created, only moved")}
    </div>`;
}


// --- Alerts --------------------------------------------------------------------------
//
// Anno 1800's UI team put it plainly: keep the persistent HUD dark so it does not tire the
// eye, and save bright colour for notifications, so that when something IS bright it means
// something. Cities: Skylines does the same job by putting an icon on the broken building.
//
// Markets & Makers had neither. A line could break down, run dry, or fill its warehouse
// and the only sign was a word in the corner — a player watching their city would simply
// not notice they had stopped earning. These are the things worth interrupting someone
// for, each with the button that fixes it.

interface Alert { tone: "urgent" | "warn" | "good"; text: string; action?: { label: string; act: string; target?: string } }

function currentAlerts(): Alert[] {
  const alerts: Alert[] = [];
  if (!store.state.license || !store.state.buildingPlaced) return alerts;

  if (store.state.brokenDown) {
    alerts.push({ tone: "urgent", text: "Your line has broken down and is earning nothing.",
      action: { label: "Repair it", act: "repair" } });
  }
  if (store.state.suppliesCut) {
    alerts.push({ tone: "urgent", text: "The city cut your utilities over unpaid charges.",
      action: { label: "Settle up", act: "restore-supply" } });
  }
  if (store.storageFull()) {
    alerts.push({ tone: "warn", text: "The warehouse is full, so nothing more can be made.",
      action: { label: "Go and sell", act: "tab", target: "trade" } });
  }

  // An order you can already deliver is money sitting on the shelf.
  const contract = store.state.activeContract;
  if (contract && store.state.inventory[contract.resource] >= contract.quantity) {
    alerts.push({ tone: "good", text: `${contract.buyerName} is waiting — you have the goods.`,
      action: { label: "Deliver it", act: "tab", target: "trade" } });
  }

  // The weekly share does not claim itself, and it expires with the epoch.
  if (!store.state.epoch.claimed && store.projectedEpochMM() > 0) {
    alerts.push({ tone: "good", text: `This week's share is ready: ${formatNumber(store.projectedEpochMM())} $MM.`,
      action: { label: "Claim it", act: "tab", target: "trade" } });
  }

  // Quiet unless it is actually stopping you: a halt on demand is normal by evening.
  if (!store.state.brokenDown && store.state.lastShift?.halted === "funds") {
    alerts.push({ tone: "urgent", text: "Not enough money to buy inputs or pay wages.",
      action: { label: "Sell something", act: "tab", target: "trade" } });
  }
  return alerts;
}

function renderAlerts(): void {
  const node = document.querySelector<HTMLElement>("#alertStack");
  if (!node) return;
  const alerts = currentAlerts();
  node.hidden = alerts.length === 0;
  node.innerHTML = alerts.map((alert) => `
    <div class="alert alert-${alert.tone}">
      <span>${escapeMarkup(alert.text)}</span>
      ${alert.action ? `<button data-action="${escapeMarkup(alert.action.act)}"${alert.action.target ? ` data-target="${escapeMarkup(alert.action.target)}"` : ""}>${escapeMarkup(alert.action.label)}</button>` : ""}
    </div>`).join("");
}


/**
 * Sign-in, in the top bar.
 *
 * A wallet-gated game has exactly one thing a new player must do first, and it was hidden
 * at the bottom of the Exchange panel underneath five other sections. This is the same
 * action in the place every application on the web puts it.
 *
 * The no-wallet case says what to do rather than greying out: on a phone the provider is
 * only injected inside the wallet's own browser, so "No wallet detected" is a dead end for
 * a player who has Phantom installed and simply opened the site in Safari.
 */
function renderWalletSlot(): void {
  const node = document.querySelector<HTMLElement>("#walletSlot");
  if (!node) return;

  if (isDemo()) {
    node.innerHTML = `<button class="wallet-pill demo" data-action="gate-connect"
      title="You are in a demo. Nothing is saved and the shared market is closed.">
      <span><small>Demo — nothing saved</small><strong>Sign in for real</strong></span></button>`;
    return;
  }
  if (principal) {
    const short = `${principal.walletAddress.slice(0, 4)}…${principal.walletAddress.slice(-4)}`;
    node.innerHTML = `<button class="wallet-pill linked" data-action="wallet-disconnect" title="Signed in as ${escapeMarkup(principal.walletAddress)} — click to sign out">
      <span class="wallet-dot" aria-hidden="true"></span><span><small>Signed in</small><strong>${escapeMarkup(short)}</strong></span></button>`;
    return;
  }
  if (!walletAvailable()) {
    node.innerHTML = `<a class="wallet-pill needs" href="https://phantom.app/download" target="_blank" rel="noreferrer noopener"
      title="No Solana wallet was found in this browser">
      <span><small>To play</small><strong>Get a wallet</strong></span></a>`;
    return;
  }
  node.innerHTML = `<button class="wallet-pill" data-action="wallet-connect">
    <span><small>Play for real</small><strong>Connect wallet</strong></span></button>`;
}


// --- The boot gate -------------------------------------------------------------------
//
// Nobody reaches the world without saying how they are playing. The alternative — dropping
// straight into a local save — reads as "already signed in", which is exactly the
// confusion this replaces: a player builds a city for an hour and only then discovers
// none of it was on the realm.
//
// The demo is sealed rather than merely unsaved (see isDemo): it writes nothing, so it
// cannot overwrite a profile already in this browser, and it reaches no server, so it
// cannot touch the shared economy. It is also never promoted in place — signing in from a
// demo reloads, so the real flow starts from a clean state rather than inheriting one.

let gateSettled = false;

function renderBootGate(): void {
  const choices = document.querySelector<HTMLElement>("#bootChoices");
  if (!choices) return;
  const canConnect = walletAvailable();
  choices.innerHTML = `
    ${canConnect
      ? `<button class="boot-primary" data-action="gate-connect">Connect Solana wallet</button>`
      : `<a class="boot-primary" href="https://phantom.app/download" target="_blank" rel="noreferrer noopener">Get a Solana wallet</a>
         <small class="boot-hint">On a phone, open this page inside your wallet's own browser to sign in.</small>`}
    <button class="boot-secondary" data-action="gate-demo">Play the demo</button>`;
}

function openBootGate(): void {
  const gate = element("#bootGate");
  renderBootGate();
  gate.hidden = false;
  world.setInputEnabled(false);           // the world is behind the gate; do not drive it
}

function closeBootGate(): void {
  if (gateSettled) return;
  gateSettled = true;
  element("#bootGate").hidden = true;
  world.setInputEnabled(true);
  renderAll();
}


/**
 * How many real people are in the realm right now.
 *
 * A number that changes because somebody else walked in is the cheapest proof an MMO can
 * offer that it is one. It was previously buried inside a status sentence nobody reads.
 */
function renderOnlinePill(): void {
  const node = document.querySelector<HTMLElement>("#onlinePill");
  if (!node) return;
  if (isDemo()) {
    node.hidden = false;
    node.className = "online-pill offline";
    node.innerHTML = `<i aria-hidden="true"></i><span>Demo — not connected</span>`;
    return;
  }
  const nearby = world.peerCount;
  const total = Math.max(nearby, districtShopCount);
  if (!isSynced() && nearby === 0) { node.hidden = true; return; }
  node.hidden = false;
  node.className = `online-pill${nearby > 0 ? " busy" : ""}`;
  node.innerHTML = `<i aria-hidden="true"></i><span><b>${total || 1}</b> ${total === 1 ? "maker" : "makers"} here</span>`;
}


/**
 * The things a player does over and over, on screen at all times.
 *
 * Every one of these was already in the game and every one was buried: converting $MM sat
 * at the bottom of the Exchange panel behind five sections, selling stock needed the trade
 * screen, and getting to the bank meant walking the same route for the fiftieth time. An
 * action a player repeats every session should cost one tap, not a hunt.
 *
 * Only what is actually available shows. A row of greyed-out buttons teaches nothing.
 */
function renderQuickBar(): void {
  const node = document.querySelector<HTMLElement>("#quickBar");
  if (!node) return;
  const chips: string[] = [];
  const state = store.state;

  // Convert $MM into spendable money — the most repeated errand in the game.
  if (state.mmHoldings >= 100) {
    chips.push(`<button data-action="bank-in" title="Bring 100 $MM to the treasury">
      <i aria-hidden="true">$</i><span><small>Convert</small><strong>100 $MM → ${formatNumber(store.mercDollarsForMM(100))}</strong></span></button>`);
  }

  // No ride button here any more. A cab is something you walk up to and hail — putting it
  // on a toolbar moved the player across the map without their ever being anywhere.

  // Sell what is on the shelf, if the district still wants any of it.
  const sellable = (Object.keys(RESOURCES) as ResourceKey[])
    .filter((key) => state.inventory[key] > 0 && store.procurementRemaining(key) > 0);
  if (sellable.length > 0) {
    chips.push(`<button data-action="tab" data-target="trade" title="The district is still buying">
      <i aria-hidden="true">⇄</i><span><small>Sell stock</small><strong>${sellable.length} good${sellable.length === 1 ? "" : "s"} wanted</strong></span></button>`);
  }

  // The weekly share, which expires with the epoch.
  if (!state.epoch.claimed && store.projectedEpochMM() > 0) {
    chips.push(`<button class="quick-good" data-action="claim-epoch" title="Your share of this week's $MM">
      <i aria-hidden="true">★</i><span><small>Claim share</small><strong>${formatNumber(store.projectedEpochMM())} $MM</strong></span></button>`);
  }

  node.hidden = chips.length === 0;
  node.innerHTML = chips.join("");
}


/**
 * TOP — who you are and what you hold.
 *
 * Online, balance, level, worth: the four numbers a player checks without thinking, on one
 * line across the top where every management game puts them.
 */
function renderVitals(): void {
  const node = document.querySelector<HTMLElement>("#hudVitals");
  if (!node) return;
  const level = store.careerLevel();
  const next = store.nextCareerLevel();
  const progress = store.careerProgress();
  node.innerHTML = `
    <div class="vital"><small>Balance</small><strong>${formatNumber(store.state.wallet)}</strong><b>${CURRENCY_CODE}</b></div>
    <div class="vital"><small>Worth</small><strong>${formatNumber(store.netWorth())}</strong></div>
    <div class="vital vital-level" title="${next ? `${formatNumber(next.xp - store.state.experience)} XP to ${next.name}` : "Top of the ladder"}">
      <small>Level ${level.level}</small><strong>${escapeMarkup(level.name)}</strong>
      <i class="vital-bar"><b style="width:${progress}%"></b></i></div>
    <div class="vital"><small>$MM</small><strong>${formatNumber(store.state.mmHoldings)}</strong></div>`;
}

/**
 * RIGHT — your business, permanently on screen.
 *
 * Everything a maker needs to run the place without opening anything: what it is, what it
 * is doing, the rate it produces at, what it costs, what it earns, and what is installed.
 * This was spread across a panel, a strip and two tabs.
 */
function renderBusinessPanel(): void {
  const node = document.querySelector<HTMLElement>("#hudBusiness");
  if (!node) return;
  const licence = store.state.license;
  if (!licence || !store.state.buildingPlaced) { node.hidden = true; return; }
  node.hidden = false;

  const config = BUSINESS[licence];
  const economics = store.unitEconomics();
  const cycles = store.inputMultiplier();
  const seconds = store.jobDuration(licence, cycles);
  const perHour = seconds > 0 ? (3600 / seconds) : 0;
  const outputs = (Object.keys(config.output) as ResourceKey[]).filter((k) => (config.output[k] ?? 0) > 0);
  const madePerHour = outputs.length > 0
    ? Math.round(perHour * (config.output[outputs[0]!] ?? 0) * cycles)
    : Math.round(perHour * cycles);
  const rateUnit = outputs.length > 0 ? RESOURCES[outputs[0]!].short : "visits";
  const upgrades = (Object.keys(UPGRADE_NAMES) as UpgradeKey[]);
  const profit = economics ? Math.round(economics.expectedProfit) : 0;
  const daily = store.dailyOverhead();

  // The state of the line, folded in. It used to be a second card stacked under this one,
  // repeating the name, the stock and today's takings — two layers saying the same thing.
  const shift = store.state.lastShift;
  const key = store.state.brokenDown ? "breakdown" : (store.state.job ? "running" : (shift?.halted ?? "idle"));
  const status = HALT_REASON[key] ?? HALT_REASON.idle!;
  const stock = store.storedUnits();
  const capacity = store.storageCapacity();
  const condition = Math.round(store.state.condition);

  node.className = `bp tone-${status.tone}`;
  node.innerHTML = `
    <div class="bp-head">
      <span class="bp-model" style="--bp-color:${escapeMarkup(config.color)}" aria-hidden="true"><i>${escapeMarkup(config.icon)}</i></span>
      <span class="bp-name"><strong>${escapeMarkup(config.name)}</strong><small>${escapeMarkup(config.sector)}</small></span>
      <b class="bp-state">${escapeMarkup(status.label)}</b>
    </div>
    <p class="bp-why">${escapeMarkup(status.why)}</p>
    <div class="bp-bars">
      <span><small>Stock</small><strong>${stock}/${capacity}</strong>
        <i class="bp-bar ${stock / Math.max(1, capacity) > 0.9 ? "full" : ""}"><b style="width:${Math.min(100, Math.round((stock / Math.max(1, capacity)) * 100))}%"></b></i></span>
      <span><small>Condition</small><strong>${condition}%</strong>
        <i class="bp-bar ${condition < 35 ? "full" : ""}"><b style="width:${condition}%"></b></i></span>
    </div>
    <div class="bp-rate">
      <span><small>Making</small><strong>${madePerHour}</strong><b>${escapeMarkup(rateUnit)}/hr</b></span>
      <span><small>Cycle</small><strong>${seconds}s</strong><b>${cycles} batch${cycles === 1 ? "" : "es"}</b></span>
    </div>
    <div class="bp-books">
      <span class="${profit >= 0 ? "up" : "down"}"><small>Profit / cycle</small><strong>${profit >= 0 ? "+" : ""}${formatNumber(profit)}</strong></span>
      <span><small>Costs / cycle</small><strong>${economics ? formatNumber(economics.inputCost + economics.laborCost) : 0}</strong></span>
      <span><small>Overheads / day</small><strong>${formatNumber(daily)}</strong></span>
      <span class="${store.todayProfit() >= 0 ? "up" : "down"}"><small>Today</small><strong>${store.todayProfit() >= 0 ? "+" : ""}${formatNumber(store.todayProfit())}</strong></span>
    </div>
    ${(() => {
      const fitting = store.installation();
      if (!fitting) return "";
      return `<div class="bp-fitting" title="One crew, one job">
        <span><small>Fitting</small><strong>${escapeMarkup(UPGRADE_NAMES[fitting.key].name)} · level ${fitting.level}</strong></span>
        <b>${formatDuration(fitting.secondsLeft)}</b>
        <i class="bp-bar"><b style="width:${fitting.progress}%"></b></i>
      </div>`;
    })()}
    <div class="bp-upgrades">
      ${upgrades.map((key) => {
        const level = store.state.upgrades[key];
        const ceiling = store.upgradeCeiling();
        const beingFitted = store.installation()?.key === key;
        return `<button class="${beingFitted ? "fitting" : ""}" data-action="tab" data-target="shop" title="${escapeMarkup(UPGRADE_NAMES[key].name)}: level ${level} of ${ceiling}${beingFitted ? " — being fitted now" : ""}">
          <i aria-hidden="true">${UPGRADE_NAMES[key].icon}</i>
          <em>${Array.from({ length: ceiling }, (_, i) => `<u class="${i < level ? "on" : ""}"></u>`).join("")}</em>
        </button>`;
      }).join("")}
    </div>`;
}

/**
 * BOTTOM — the world you are trading in.
 *
 * The cycle, what the district is short of, and the public orders on the board. A maker
 * decides what to make next from these three things and all three were behind a tab.
 */
function renderWorldStrip(): void {
  const node = document.querySelector<HTMLElement>("#hudWorld");
  if (!node) return;
  const wanted = store.demandHighlights(2);
  const offer = store.bestOffer();
  node.innerHTML = `
    <div class="ws-item"><small>Economy</small><strong>${escapeMarkup(store.economicPhase())}</strong><b>${escapeMarkup(store.economyTrend())}</b></div>
    <div class="ws-item"><small>Confidence</small><strong>${store.consumerConfidenceIndex()}</strong><b>prices ${store.marketPriceIndex()}</b></div>
    ${wanted.map((entry) => `<div class="ws-item ws-wanted"><small>Wants ${escapeMarkup(RESOURCES[entry.key].short)}</small><strong>${entry.price} ${CURRENCY_CODE}</strong><b>${entry.remaining} more</b></div>`).join("")}
    ${offer
      ? `<button class="ws-item ws-order" data-action="tab" data-target="trade"><small>Government order</small><strong>${offer.quantity} ${escapeMarkup(RESOURCES[offer.resource].short)}</strong><b>${formatNumber(offer.grossReward)} ${CURRENCY_CODE}</b></button>`
      : `<div class="ws-item"><small>Orders</small><strong>None worth taking</strong><b>check back later</b></div>`}`;
}


// --- The counter ---------------------------------------------------------------------
//
// Walk up to a building, press E, and it tells you what it does for you. The buildings
// were scenery with a name over the door: the Treasury was a shape you walked past while
// the actual banking sat five sections down a panel. A counter is the oldest and clearest
// interface a city has — you go to the place, and the place serves you.
//
// Everything offered here already existed. This only puts each action behind its own door.

const COUNTER_RANGE = 14;
let counterOpenFor: string | null = null;

/** The nearest building close enough to talk to, if any. */
function nearbyCounter(): { id: string; name: string; role: string; icon: string; color: string } | null {
  const state = store.state;
  let best: { id: string; name: string; role: string; icon: string; color: string; distance: number } | null = null;
  for (const site of CIVIC_BUILDINGS) {
    if (site.island !== state.island) continue;
    if (!COUNTER_SERVICES[site.id]) continue;
    const distance = Math.hypot(state.player.x - site.x, state.player.z - site.z);
    if (distance > COUNTER_RANGE) continue;
    if (!best || distance < best.distance) {
      best = { id: site.id, name: site.name, role: site.role, icon: site.icon, color: site.color, distance };
    }
  }
  return best;
}

function renderCounterPrompt(): void {
  const prompt = document.querySelector<HTMLElement>("#counterPrompt");
  const panel = document.querySelector<HTMLElement>("#counterPanel");
  if (!prompt || !panel) return;
  const near = nearbyCounter();

  // Walking away closes the counter. Standing at a desk you have left is nonsense.
  if (counterOpenFor && (!near || near.id !== counterOpenFor)) counterOpenFor = null;

  prompt.hidden = !near || counterOpenFor !== null;
  if (near && !counterOpenFor) {
    prompt.innerHTML = `<kbd>E</kbd><span><strong>${escapeMarkup(near.name)}</strong><small>${escapeMarkup(near.role)}</small></span>`;
  }

  panel.hidden = counterOpenFor === null;
  if (!counterOpenFor || !near) return;
  const services = COUNTER_SERVICES[counterOpenFor] ?? [];
  panel.innerHTML = `
    <div class="counter-head" style="--counter-color:${escapeMarkup(near.color)}">
      <i aria-hidden="true">${escapeMarkup(near.icon)}</i>
      <span><strong>${escapeMarkup(near.name)}</strong><small>${escapeMarkup(near.role)}</small></span>
      <button class="counter-close" data-action="counter-close" aria-label="Leave the counter">✕</button>
    </div>
    <ul class="counter-services">
      ${services.map((service) => `<li><button data-action="${escapeMarkup(service.action)}"${service.target ? ` data-target="${escapeMarkup(service.target)}"` : ""}>
        <strong>${escapeMarkup(service.label)}</strong><small>${escapeMarkup(service.detail)}</small></button></li>`).join("")}
    </ul>`;
}

/** E opens the counter you are standing at, and closes it again. */
window.addEventListener("keydown", (event) => {
  if (event.code !== "KeyE" || event.metaKey || event.ctrlKey || event.altKey) return;
  const target = event.target as HTMLElement | null;
  if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return;
  const near = nearbyCounter();
  if (near || counterOpenFor !== null) {
    event.preventDefault();
    counterOpenFor = counterOpenFor ? null : near?.id ?? null;
    renderCounterPrompt();
    return;
  }
  // No counter here — is there a cab?
  const cab = nearbyTaxi();
  if (!cab && hailedTaxi === null) return;
  event.preventDefault();
  hailedTaxi = hailedTaxi === null ? cab?.id ?? null : null;
  renderTaxi();
});


// --- Hailing a cab ---------------------------------------------------------------------
//
// The traffic was scenery that also blocked the pavement. These are the city's taxis now:
// walk up to one, press E, pick where you are going, pay the fare. A button reading "ride
// to bank" moved a player across the map without their ever being anywhere — this makes
// the fare something you go and do, and it puts the cars in the world to work.
//
// The fare still goes to the treasury, which is what makes it a sink rather than a
// convenience: the money leaves circulation and funds the civic wage.

const TAXI_RANGE = 6;
let hailedTaxi: number | null = null;

/** The nearest cab close enough to flag down. */
function nearbyTaxi(): { id: number; distance: number } | null {
  const { x, z } = store.state.player;
  let best: { id: number; distance: number } | null = null;
  for (const car of world.taxiPositions()) {
    const distance = Math.hypot(car.x - x, car.z - z);
    if (distance > TAXI_RANGE) continue;
    if (!best || distance < best.distance) best = { id: car.id, distance };
  }
  return best;
}

/** Everywhere a cab will take you from here, and what it costs. */
function taxiDestinations(): Array<{ id: string; name: string; role: string; fare: number }> {
  return CIVIC_BUILDINGS
    .filter((site) => site.island === store.state.island)
    .map((site) => ({ id: site.id, name: site.name, role: site.role, fare: store.rideFare(site.id) }))
    .filter((entry) => entry.fare > RIDE_MINIMUM_FARE)   // already there: walk
    .sort((a, b) => a.fare - b.fare);
}

function renderTaxi(): void {
  const prompt = document.querySelector<HTMLElement>("#taxiPrompt");
  const panel = document.querySelector<HTMLElement>("#taxiPanel");
  if (!prompt || !panel) return;
  const near = nearbyTaxi();

  // Cabs drive off. If yours has, the fare board goes with it.
  if (hailedTaxi !== null && (!near || near.id !== hailedTaxi)) hailedTaxi = null;

  prompt.hidden = !near || hailedTaxi !== null;
  if (near && hailedTaxi === null) {
    prompt.innerHTML = `<kbd>E</kbd><span><strong>Hail this cab</strong><small>Fares are paid to the city</small></span>`;
  }

  panel.hidden = hailedTaxi === null;
  if (hailedTaxi === null) return;
  const stops = taxiDestinations();
  panel.innerHTML = `
    <div class="counter-head" style="--counter-color:#4eaeb7">
      <i aria-hidden="true">▸</i>
      <span><strong>Where to?</strong><small>Walking is free. This is not.</small></span>
      <button class="counter-close" data-action="taxi-close" aria-label="Wave the cab on">✕</button>
    </div>
    ${stops.length === 0
      ? `<div class="empty-state"><i>▸</i><strong>Everything is within a short walk</strong><p>No fare worth paying from here.</p></div>`
      : `<ul class="counter-services">${stops.map((stop) => `<li><button data-action="taxi-go" data-to="${escapeMarkup(stop.id)}"
          ${store.state.wallet < stop.fare ? "disabled" : ""}>
          <strong>${escapeMarkup(stop.name)}</strong>
          <small>${escapeMarkup(stop.role)}</small>
          <b class="taxi-fare">${stop.fare} ${CURRENCY_CODE}</b></button></li>`).join("")}</ul>`}`;
}

function renderAll(): void {
  renderHeader();
  renderWalletSlot();
  renderVitals();
  renderBusinessPanel();
  renderWorldStrip();
  renderCounterPrompt();
  renderTaxi();
  renderOnlinePill();
  renderTutorial();
  renderSelectedPlot();
  renderBuild();
  renderBusiness();
  renderMarket();
  renderMakerMarket();
  renderContracts();
  renderMap();
  renderAlerts();
  renderInfo();
  renderQuickBar();
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

/**
 * Trade in the shared world when signed in, and locally when not. The server decides the
 * price; a refusal is surfaced as-is rather than quietly falling back, because a refusal
 * IS the shared market talking.
 */
async function tradeThroughRealm(kind: "buy" | "sell", key: ResourceKey, quantity: number): Promise<boolean> {
  if (!isSynced()) return false;
  const island = store.state.island;
  const outcome = kind === "sell"
    ? await sellToDistrict(island, key, quantity)
    : await buyFromCivic(island, key, quantity);

  if (outcome.status === "ok") {
    const value = outcome.value as unknown as Record<string, number>;
    report(kind === "sell"
      ? store.applyServerSale(key, quantity, value.net ?? 0, value.gross ?? 0)
      : store.applyServerPurchase(key, quantity, value.cost ?? 0));
    renderAll();
    return true;
  }
  if (outcome.status === "refused") { toast(outcome.message); return true; }
  return false;    // offline: fall through to the local simulation
}

document.body.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-action]");
  if (!button || button.disabled) return;
  const action = button.dataset.action;
  if (action === "lease") report(store.leaseSelectedPlot());
  else if (action === "license") report(store.chooseLicense(button.dataset.license as LicenseKey));
  else if (action === "build") {
    const result = store.placeBuilding();
    report(result);
    if (result.ok) publishBusiness();
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
  else if (action === "buy") {
    const key = button.dataset.resource as ResourceKey;
    void tradeThroughRealm("buy", key, 1).then((handled) => { if (!handled) report(store.buyResource(key)); });
  }
  else if (action === "sell") {
    const key = button.dataset.resource as ResourceKey;
    void tradeThroughRealm("sell", key, 1).then((handled) => { if (!handled) report(store.sellResource(key)); });
  }
  else if (action === "make-product") report(store.makeProduct(button.dataset.product ?? ""));
  else if (action === "sell-product") report(store.sellProduct(button.dataset.product ?? ""));
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
  else if (action === "taxi-close") { hailedTaxi = null; renderTaxi(); }
  else if (action === "taxi-go") {
    const result = store.rideTo(button.dataset.to ?? "treasury");
    report(result);
    if (result.ok) { hailedTaxi = null; world.teleportToState(store.state); renderAll(); }
  }
  else if (action === "counter-close") { counterOpenFor = null; renderCounterPrompt(); }
  else if (action === "ride") report(store.rideTo(button.dataset.to ?? "treasury"));
  else if (action === "info-tab") { infoTab = (button.dataset.info as typeof infoTab) ?? "you"; renderInfo(); }
  else if (action === "mayor-toggle") { store.setMayorHidden(!store.state.mayorHidden); renderAll(); }
  else if (action === "market-pick") { listingDraft.item = button.dataset.resource as ResourceKey; renderMakerMarket(); }
  else if (action === "market-qty") { listingDraft.quantity = Number(button.dataset.quantity ?? 10); renderMakerMarket(); }
  else if (action === "market-markup") { listingDraft.markup = Number(button.dataset.markup ?? 0); renderMakerMarket(); }
  else if (action === "market-list") void placeMakerListing();
  else if (action === "market-buy") void takeMakerListing(button.dataset.listing ?? "");
  else if (action === "market-cancel") void withdrawMakerListing(button.dataset.listing ?? "");
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
  else if (action === "gate-demo") { store.startDemoSession(); closeBootGate(); toast("Demo: nothing here is saved, and the shared market is closed."); }
  else if (action === "gate-connect") {
    // A demo is never promoted in place. Signing in from one would carry the demo's city
    // into the real account — a player would "keep" a city that was never theirs, and the
    // sealed session would quietly become an unsealed one. Reload instead, so the real
    // flow starts from a clean state and whatever profile this browser already holds.
    if (isDemo()) { window.location.reload(); return; }
    signIn().then((who) => { principal = who; closeBootGate(); toast(`Signed in as ${who.walletAddress.slice(0, 4)}…${who.walletAddress.slice(-4)}`); return refreshWallet(); })
      .catch((error: Error) => toast(error.message));
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
  // A returning player with a live session is not asked again.
  if (principal) closeBootGate(); else window.setTimeout(openBootGate, 300);
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
