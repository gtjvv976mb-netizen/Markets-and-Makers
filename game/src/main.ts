import { FITTINGS, type FittingKey, MERC_DOLLARS_PER_USD, BREAKDOWN_REPAIR_COST, BREAKDOWN_REPAIR_PARTS, BUSINESS, CHARTER_COST_MM, CIVIC_BUILDINGS, DEED_COST_MM, MAX_UPGRADE_LEVEL, MM_BURN_RATE, SPONSORSHIP_COST_MM, BUSINESS_STAGES, DAILY_GOALS, ISLANDS, MM_TOTAL_SUPPLY, PLOTS, RESOURCES, SPECIALIZATIONS, CAREER_LEVELS, COUNTER_SERVICES, CURRENCY_CODE, MAYOR, MAYOR_SCRIPT, TUTORIAL, UPGRADE_COSTS, UPGRADE_NAMES, type BusinessStage, type LicenseKey, type ResourceKey, type SpecializationKey, type UpgradeKey , ERRAND_VERB} from "./data";
import { BUSINESS_TIER, PRODUCTS_BY_ID, TIER_NAMES } from "./products";
import { buyFromCivic, fetchDistrict, isSynced, refreshWorldOwner, registerBusiness, sellToDistrict,
  worldRunsOnServer, fetchCityBooks, fetchChainMM, fetchDepositDesk, claimDeposit, fetchDispatches, fetchMarketBook, fetchHoldings, fetchIdentity, listOnMarket, buyMarketListing,
  cancelMarketListing, type CityDispatch, type MarketListing } from "./realm";
import { GameStore, isDemo, type ActionResult } from "./state";
import { World3D } from "./world";
import { INTERIOR_EQUIPMENT_CATALOG, INTERIOR_ROOMS, InteriorWorld, type InteriorPrompt, type InteriorSelection } from "./interiorWorld";
import { plotArrival } from "./highlandsWorld";
import { propertyMarkerModels, type MarkerModel } from "./propertyMarkers";
import { BusinessTurntable } from "./businessTurntable";
import { detectDeployment, fetchDistrictBoard, RealmConnection, type DistrictQuote, type RealmStatus } from "./network";
import { availableWallets, chooseWallet, currentPrincipal, fetchStanding, purchaseMM, signIn, signOut, walletAvailable, type EpochStanding, type Principal, claimEpochOnServer, fetchWithdrawals, requestWithdrawal} from "./wallet";
import { flushCloudSave, markHydrated, pullCloudSave, pushCloudSave, resetCloudSave } from "./cloudSave";

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
const businessTurntable = new BusinessTurntable(element<HTMLCanvasElement>("#businessTurntable"));

let activeTab = "business";
let interiorOpen = false;
let sheetReturnFocus: HTMLElement | null = null;
let interiorReturnFocus: HTMLElement | null = null;
let interiorEntryTimer = 0;
/**
 * Ticks while the room is open and a crew is fitting something.
 *
 * Two things depend on it: the countdown in the header, and — the one that matters — the
 * machine APPEARING when the crew finishes. settleInstallation runs inside catchUp, and
 * catchUp is on a 60-second timer, so without this a maker could stand in front of a
 * finished machine for the best part of a minute watching an empty tile.
 */
let interiorFittingTimer = 0;
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
    // The payroll the authority bills, and the wages it pays into the citizens' purse.
    staff: store.state.staff,
    // Send the LAYOUT, never what it is worth. Until this went in, every fitting a maker had
    // bought and every layout decision they had made counted for nothing the moment they
    // closed the tab: the tick priced production from upgrade levels alone.
    floor: {
      tiles: store.state.equipmentTiles,
      facings: store.state.equipmentFacing ?? {},
      fittings: store.state.fittings ?? {},
    },
  }).then((outcome) => {
    if (outcome.status !== "refused") return;
    // A refusal used to go to console.warn and nowhere else, so a player whose shop the
    // shared world would not accept carried on playing a city that existed only in their
    // own tab. Say it out loud, and re-read the registry so the map stops offering the
    // corner that was just refused.
    console.warn(`registry refused ${plotId}: ${outcome.message}`);
    toast(outcome.code === "plot-taken"
      ? "Another Mercedonian holds that corner — the city will not register your shop there."
      : `Mercedonia would not register your shop: ${outcome.message}`);
    void refreshDistrict();
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
const utilityDrawer = element<HTMLElement>("#hudUtilityDrawer");
const businessDrawer = element<HTMLElement>("#hudBusinessDrawer");
const businessDrawerToggle = element<HTMLButtonElement>("#businessDrawerToggle");
let utilityMode: "news" | "bank" = "news";
let utilityReturnFocus: HTMLElement | null = null;
let businessReturnFocus: HTMLElement | null = null;

function isCompactHud(): boolean {
  return window.matchMedia("(max-width: 860px), (max-height: 560px)").matches;
}

function setHudDrawerOpen(drawer: HTMLElement, open: boolean): void {
  drawer.dataset.open = String(open);
  drawer.setAttribute("aria-hidden", String(!open));
  if (open) drawer.removeAttribute("inert");
  else drawer.setAttribute("inert", "");
  document.body.classList.toggle("hud-drawer-open",
    utilityDrawer.dataset.open === "true" || businessDrawer.dataset.open === "true");
}

function closeUtilityDrawer(restoreFocus = true): void {
  const focusWasInside = utilityDrawer.contains(document.activeElement);
  setHudDrawerOpen(utilityDrawer, false);
  document.querySelectorAll<HTMLButtonElement>("[data-action='utility-open']").forEach((button) => {
    button.setAttribute("aria-expanded", "false");
    button.classList.remove("active");
  });
  if (restoreFocus && focusWasInside) (utilityReturnFocus?.isConnected ? utilityReturnFocus : canvas).focus({ preventScroll: true });
}


function closeBusinessDrawer(restoreFocus = true): void {
  const focusWasInside = businessDrawer.contains(document.activeElement);
  setHudDrawerOpen(businessDrawer, false);
  businessDrawerToggle.setAttribute("aria-expanded", "false");
  businessDrawerToggle.classList.remove("active");
  businessTurntable?.setVisible(false);
  if (restoreFocus && focusWasInside) (businessReturnFocus?.isConnected ? businessReturnFocus : businessDrawerToggle).focus({ preventScroll: true });
}

function openBusinessDrawer(): void {
  businessReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : businessDrawerToggle;
  closeSheet(false);
  if (isCompactHud()) closeUtilityDrawer(false);
  setHudDrawerOpen(businessDrawer, true);
  businessDrawerToggle.setAttribute("aria-expanded", "true");
  businessDrawerToggle.classList.add("active");
  businessTurntable?.setVisible(true);
}

function openSheet(): void {
  const activeBeforeClose = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const returnTarget = activeBeforeClose && utilityDrawer.contains(activeBeforeClose)
    ? utilityReturnFocus
    : activeBeforeClose && businessDrawer.contains(activeBeforeClose)
      ? businessReturnFocus
      : activeBeforeClose;
  if (sheet.dataset.open !== "true") sheetReturnFocus = returnTarget ?? canvas;
  closeUtilityDrawer(false);
  closeBusinessDrawer(false);
  sheet.removeAttribute("inert");
  sheet.dataset.open = "true";
  sheet.setAttribute("aria-hidden", "false");
  document.querySelector<HTMLButtonElement>("[data-action='info-open']")
    ?.setAttribute("aria-expanded", String(activeTab === "info"));
}

function closeSheet(restoreFocus = true): void {
  const focusWasInside = sheet.contains(document.activeElement);
  sheet.dataset.open = "false";
  sheet.setAttribute("aria-hidden", "true");
  sheet.setAttribute("inert", "");
  document.querySelector<HTMLButtonElement>("[data-action='info-open']")?.setAttribute("aria-expanded", "false");
  if (!restoreFocus || !focusWasInside) return;
  const target = sheetReturnFocus?.isConnected ? sheetReturnFocus : canvas;
  target.focus({ preventScroll: true });
}
element("#sheetClose").addEventListener("click", () => closeSheet());
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (businessDrawer.dataset.open === "true") closeBusinessDrawer();
  else if (utilityDrawer.dataset.open === "true") closeUtilityDrawer();
  else closeSheet();
});

/**
 * A wallet address, shortened to something a person can recognise across a street.
 *
 * The full address is meaningless at a glance and far too long for a plaque; the first
 * four characters are what everybody actually uses to tell each other apart.
 */
function makerName(playerId: string): string {
  const clean = playerId.replace(/[^A-Za-z0-9]/g, "");
  if (clean.length <= 8) return clean || "Mercedonian";
  return `${clean.slice(0, 4)}…${clean.slice(-4)}`;
}

/** Corners the registry says another maker holds. Refreshed with the district. */
let plotsHeldByOthers: ReadonlySet<string> = new Set();

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
      label: "Mercedonian", title: makerName(peer.playerId), detail: "",
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

  return nearestFew(models.concat(propertyMarkerModels(
    { ...state, heldByOthers: plotsHeldByOthers },
    (resource) => store.marketBuyPrice(resource),
    (plotId) => world.buildingBannerY(plotId),
  )));
}

/**
 * A label on every building is a city you cannot see through. Measured on the live build
 * at the opening plaza: 28 floating pins, most of them other people's shopfronts quoting
 * prices for goods the player does not have yet.
 *
 * What survives is what is the player's own or is asking for them — their plots, a
 * finished job, a breakdown — plus the handful of everything else that is actually near.
 * The rest are still there in the world; they simply stop shouting from across the map.
 */
const MARKER_ALWAYS = new Set(["owned", "ready", "alert"]);
const MARKERS_NEARBY = 5;

function nearestFew(models: MarkerModel[]): MarkerModel[] {
  const mine = models.filter((m) => MARKER_ALWAYS.has(m.kind));
  const rest = models.filter((m) => !MARKER_ALWAYS.has(m.kind));
  if (rest.length <= MARKERS_NEARBY) return models;
  const { x, z } = store.state.player;
  const near = rest
    .map((m) => ({ m, d: Math.hypot(m.x - x, m.z - z) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, MARKERS_NEARBY)
    .map((entry) => entry.m);
  // Keep the authored order so pins do not jump about as the player walks.
  const keep = new Set([...mine, ...near]);
  return models.filter((m) => keep.has(m));
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
  const reserved = [".hud-top", ".wallet-slot", ".hud-utility-rail", ".business-edge-tab",
                    ".hud-drawer[data-open='true']", ".hud-context-actions",
                    // The prompts belong here too. They were left out, so a "Press E"
                    // sitting at the top of the screen landed straight on the building
                    // signs — Sunspire City Hall printed twice, once as its own marker and
                    // once under the prompt naming it.
                    ".counter-prompt", ".counter-panel", ".taxi-prompt", "#taxiPanel",
                    ".selected-card"]
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
let lastProximitySync = 0;
let proximitySignature = "";
world.setFrameCallback(() => {
  // Anything that depends on WHERE THE PLAYER IS has to be recomputed as they walk. Both
  // of these were only redrawn when something else happened to trigger a render, so the
  // counter prompt appeared late and the errand's distance sat frozen at whatever it read
  // when the job was accepted — a countdown that does not count down.
  //
  // Four times a second is plenty for a walking pace and costs a handful of distance
  // calculations; doing it every frame would rebuild the same markup sixty times a second
  // for a number that changes at walking speed.
  const proximityNow = performance.now();
  if (proximityNow - lastProximitySync >= 250) {
    lastProximitySync = proximityNow;
    const near = nearbyCounter();
    const errand = store.errand();
    const desk = errand ? CIVIC_BUILDINGS.find((site) => site.id === errand.desk) : null;
    // Distance to the nearest whole metre: the pill counts down, so it must be part of
    // the signature, but rounding stops a sub-pixel drift from redrawing every pass.
    const range = desk && desk.island === store.state.island
      ? Math.round(Math.hypot(store.state.player.x - desk.x, store.state.player.z - desk.z)) : -1;
    const signature = `${near?.id ?? ""}:${counterOpenFor ?? ""}:${errand?.label ?? ""}:${range}:${nearbyTaxi()?.id ?? ""}`;
    if (signature !== proximitySignature) {
      proximitySignature = signature;
      renderCounterPrompt();
      renderErrandPill();
      renderTaxi();
    }
  }
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
//
// And SHOW it. The catch-up used to run silently on load — the single most common way a
// player returns — so a night of jobs, sales and wages happened with no acknowledgement at
// all, and only a tab-switch return earned a one-line toast. The away report is the payoff
// moment of an idle game: it is the proof that the world kept working, and every reference
// game leads with it. One card, the city's own colours, numbers a player can read in five
// seconds, dismissed with a click anywhere.
function showAwayReport(shift: ReturnType<typeof store.catchUp>): void {
  const meaningful = shift.hours >= 0.25 && (shift.jobs > 0 || shift.revenue > 0 || shift.wages > 0);
  if (!meaningful) return;
  // Not over the wallet gate. The boot catch-up runs before the player has signed in, and
  // the card was landing on top of the connect screen; the payoff belongs to the moment
  // they are back IN the city, so it waits for the gate to clear.
  const gate = document.querySelector<HTMLElement>("#bootGate, .boot-gate, .wallet-gate");
  if (gate && gate.offsetParent !== null) {
    const wait = window.setInterval(() => {
      if (!gate.offsetParent) { window.clearInterval(wait); showAwayReport(shift); }
    }, 400);
    window.setTimeout(() => window.clearInterval(wait), 120_000);
    return;
  }
  const halted = shift.halted === "demand" ? "The district's shelves filled — visit the floor to restart the line."
    : shift.halted === "funds" ? "The line stopped when supplies could not be paid for."
    : shift.halted === "breakdown" ? "The line broke down and is waiting on a repair."
    : null;
  const spanHours = Math.round(shift.hours * 10) / 10;
  const span = spanHours >= 24 ? `${Math.round(spanHours / 2.4) / 10} days` : `${spanHours} hours`;
  const net = shift.revenue - shift.wages - shift.spent;
  const card = document.createElement("div");
  card.className = "away-report";
  card.setAttribute("role", "status");
  card.innerHTML = `
    <small>While you were away · ${escapeMarkup(span)} worked</small>
    <div class="away-rows">
      <span><b>${shift.jobs}</b> job${shift.jobs === 1 ? "" : "s"} run</span>
      <span><b>${shift.produced}</b> made</span>
      <span><b>${shift.sold}</b> sold</span>
    </div>
    <div class="away-net ${net >= 0 ? "up" : "down"}">
      <span>${net >= 0 ? "+" : ""}${formatNumber(net)} ${CURRENCY_CODE}</span>
      <small>${formatNumber(shift.revenue)} earned · ${formatNumber(shift.wages + shift.spent)} wages &amp; costs</small>
    </div>
    ${halted ? `<p class="away-halt">${escapeMarkup(halted)}</p>` : ""}
    <em>Click anywhere to continue</em>`;
  document.body.appendChild(card);
  const dismiss = (): void => { card.remove(); document.removeEventListener("pointerdown", dismiss, true); };
  document.addEventListener("pointerdown", dismiss, true);
  window.setTimeout(dismiss, 20_000);
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  showAwayReport(store.catchUp());
  renderAll();
});
// Who owns the district decides whether this client settles its own footfall, so the
// boot catch-up WAITS for the answer.
//
// It did not. `showAwayReport(store.catchUp())` sat above this call, and the comment here
// said it ran "before any catch-up runs" — which was the intention and not the code.
// refreshWorldOwner is asynchronous and worldOwner starts null, so worldRunsOnServer()
// was false for the whole of boot: every returning player was credited a night of
// production, wages and broker sales that the authority's tick had already settled, and
// the away report they were shown counted it twice. The one line of comment claiming
// otherwise is why it survived. Now the catch-up happens inside the .then.
void refreshWorldOwner().then((owner) => {
  if (owner === "server") console.info("world: the authority is running this district");
  showAwayReport(store.catchUp());
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
  // What the registry says is taken, so the lease button can refuse before it charges
  // rather than after the authority does.
  plotsHeldByOthers = new Set(others.map((entry) => entry.plotId));
  store.setPlotsHeldByOthers(others.map((entry) => entry.plotId));
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

async function refreshDispatch(): Promise<void> {
  dispatches = await fetchDispatches(7);
  dispatchLoaded = true;
}
void refreshDispatch();
window.setInterval(() => { void refreshDispatch(); }, 60_000);

// Counter trade lands whenever a Mercedonian reaches the door, which on a busy street
// is several times a second. The takings are already banked by then; this only decides
// how often the number on screen catches up.
window.setInterval(() => {
  if (citizenTradeSinceRender === 0) return;
  citizenTradeSinceRender = 0;
  renderHeader();
  renderVitals();
  renderBusinessPanel();
  renderAlerts();
}, 1_500);

let peerCount = 0;
let realmLive = false;
let districtBoard: DistrictQuote[] | null = null;
let principal: Principal | null = null;
let standing: EpochStanding | null = null;
let withdrawalDesk: Awaited<ReturnType<typeof fetchWithdrawals>> = null;
/** Real $MM in the signed-in wallet, or null when it cannot be read. */
let chainMM: number | null = null;
/** Where to send $MM to bring it in, and what has been credited. */
let depositDesk: Awaited<ReturnType<typeof fetchDepositDesk>> = null;
/** How much the buy button will bring in. */
let depositAmount = 100;
let convertAmount = 0;   // 0 means 'all of it', which is what the button offers by default

/**
 * The most $MM the bank can take right now: everything held, less whatever the epoch's
 * issuance cap will not cover. The old button offered exactly 100 whether you held 40 or
 * 40,000, so it was either refused or made you press it four hundred times.
 */
/**
 * The MERCS to spend to take back every $MM of capital in ONE press.
 *
 * The button used to redeem a flat 1,000 MERCS at a time, and mmForMercDollars floors:
 * 1,000 MERCS is worth 9.8 $MM and returned 9. That 0.8 lost per press is an 8% tax on
 * top of the 2% spread, and recovering 5,000 $MM took 490 presses and cost 590 $MM.
 * Asking the store for the answer rather than restating its arithmetic keeps one source
 * of the rate.
 */
function redeemableMercs(): number {
  const capital = store.withdrawableCapitalMM();
  const held = purse();
  if (capital <= 0 || held <= 0) return 0;
  if (store.mmForMercDollars(held) <= capital) return held;
  let low = 1;
  let high = held;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (store.mmForMercDollars(mid) >= capital) high = mid; else low = mid + 1;
  }
  return low;
}

/** What the player typed, clamped to what the bank can actually take. 0 means "all". */
function convertAsked(): number {
  const most = convertibleMM();
  if (convertAmount <= 0) return most;
  return Math.max(0, Math.min(convertAmount, most));
}

function convertibleMM(): number {
  const held = store.state.mmHoldings;
  const perUnit = store.mercDollarsForMM(1);
  if (held <= 0 || perUnit <= 0) return 0;
  return Math.max(0, Math.min(held, Math.floor(store.issuanceHeadroom() / perUnit)));
}

/**
 * Bring this player's city back from the authority, if the authority has a better one.
 *
 * The rule is the only one that matters here: A RESTORE MUST NEVER SILENTLY DISCARD A
 * BIGGER LOCAL CITY. Revisions are counted writes, so "bigger" means "has done more work",
 * and a tie is resolved in favour of what is already on screen. When the local save is
 * ahead — the ordinary case for the device you actually play on — nothing is restored and
 * the local city is pushed up instead.
 *
 * Runs once per sign-in. Everything about it is best-effort: no session, no network or a
 * server error and the game carries on out of localStorage exactly as it did before.
 */
let cloudRestoreDone = false;
async function restoreCityFromCloud(): Promise<void> {
  if (cloudRestoreDone || !principal || isDemo()) return;
  cloudRestoreDone = true;
  const stored = await pullCloudSave();
  const localRevision = store.state.saveRevision ?? 0;

  if (stored && stored.revision > localRevision) {
    // The authority is ahead: this is a new browser, a cleared cache, or another device.
    store.replaceState(stored.payload);
    markHydrated();
    renderAll();
    toast(localRevision > 0
      ? "Restored your city from Mercedonia — this browser was behind."
      : "Welcome back. Your city has been restored.");
    return;
  }

  // Local is ahead, level, or the authority has nothing: keep what is here and publish it.
  markHydrated();
  await pushCloudSave(store.state);
}

async function refreshWallet(): Promise<void> {
  principal = await currentPrincipal();
  standing = principal ? await fetchStanding() : null;
  withdrawalDesk = principal ? await fetchWithdrawals() : null;
  // What the wallet really holds. Best-effort and non-blocking: the HUD omits the figure
  // rather than waiting on an RPC or showing a wrong zero.
  chainMM = principal ? await fetchChainMM(principal.walletAddress) : null;
  depositDesk = principal ? await fetchDepositDesk() : null;
  if (principal) void restoreCityFromCloud();
  renderAll();
}
void refreshWallet();
// A tab being closed is the moment a save is most likely to be lost, and the debounce
// means the last few edits may not have gone out yet.
window.addEventListener("pagehide", () => { void flushCloudSave(); });
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
    realmLive = status === "live";
    if (status !== "live") peerCount = 0;
    paintNetwork(detail, status === "live" || status === "disabled");
    renderOnlinePill();
  },
  position: () => ({ x: store.state.player.x, z: store.state.player.z }),
  onPeers: (peers) => {
    world.setRemotePlayers(peers);
    if (peers.length !== peerCount) {
      peerCount = peers.length;
      paintNetwork("Render authority", true);
      renderOnlinePill();
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
  businessTurntable.destroy();
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
  business: "Your business",
  products: "What you make",
  market: "The district market",
  orders: "Orders",
  traders: "Traders' market",
  bank: "Government Bank",
  rewards: "Weekly $MM share",
  city: "The city",
  map: "Mercedonia",
  info: "Information",
};

/**
 * Every `#mm-icon-*` symbol index.html actually defines.
 *
 * This listed four of the seventeen, so anything reaching for a real icon outside that
 * handful failed to typecheck and got cast around instead. The list is the sprite sheet.
 */
type UiIconName =
  | "bank" | "build" | "business" | "close" | "compass" | "enter" | "enterprise"
  | "exchange" | "info" | "network" | "news" | "profile" | "property" | "rank"
  | "reset" | "wallet" | "world";

function uiIcon(name: UiIconName): string {
  return `<svg class="mm-icon" aria-hidden="true" focusable="false"><use href="#mm-icon-${name}"></use></svg>`;
}

const SHEET_META: Record<string, { icon: UiIconName; kicker: string }> = {
  business: { icon: "business", kicker: "Enterprise desk" },
  products: { icon: "build", kicker: "Production" },
  market: { icon: "world", kicker: "Buy & sell" },
  orders: { icon: "rank", kicker: "Contracts" },
  traders: { icon: "network", kicker: "Player market" },
  bank: { icon: "bank", kicker: "$MM and Merc Dollars" },
  rewards: { icon: "exchange", kicker: "Contribution board" },
  city: { icon: "news", kicker: "Treasury, government, press" },
  map: { icon: "compass", kicker: "World atlas" },
  info: { icon: "info", kicker: "How it works" },
};

/**
 * Go straight to a thing, not to the tab that contains it.
 *
 * Everything a maker needs lives inside two tabs, stacked: the Exchange holds the City
 * Hall's orders, the makers' marketplace AND the bank desk one after another, so
 * converting $MM meant opening a tab and scrolling past two other panels to find it. A tab
 * is a filing cabinet; this opens the drawer AND points at the folder.
 */
// One panel per tab, so the tab IS the panel.
const PANEL_TAB: Record<string, string> = {
  businessPanel: "business", buildPanel: "products", marketPanel: "market",
  contractsPanel: "orders", makerMarketPanel: "traders", bankPanel: "bank",
  rewardsPanel: "rewards", cityPanel: "city", mapPanel: "map", guidePanel: "map", infoPanel: "info",
};

function gotoPanel(panelId: string): void {
  const tab = PANEL_TAB[panelId];
  if (tab) switchTab(tab);
}

function switchTab(requested: string): void {
  const tab = TAB_FOR.get(requested) ?? requested;
  activeTab = tab;
  const title = document.querySelector("#sheetTitle");
  if (title) title.textContent = SHEET_TITLE[tab] ?? "Your business";
  const meta = SHEET_META[tab] ?? SHEET_META.business;
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
  element("#walletValue").textContent = `${formatNumber(purse())} ${CURRENCY_CODE}`;
  element("#careerValue").textContent = `Lv ${store.careerLevel().level} · ${store.careerLevel().name}`;
  const island = ISLANDS.find((entry) => entry.id === state.island) ?? ISLANDS[0];
  element("#districtLabel").textContent = island.district;
  element("#islandLabel").textContent = island.name;
  element("#islandEconomy").textContent = island.economy;
}

// Every panel is its own tab now; this only keeps old callers' names working.
const TAB_FOR = new Map<string, string>([
  ["shop", "business"], ["build", "products"], ["trade", "market"],
  ["contracts", "orders"], ["world", "map"], ["guide", "map"],
]);

/** One instruction at a time: what to do, where, and a button that takes you there. */
/**
 * The nine steps, and — for each — the only parts of the interface that step needs.
 *
 * `show` is the declutter. Everything named in the guided rules is hidden while the
 * Mayor is still walking a player through, and a step reveals exactly its own tokens.
 * Until now a first-time player met three desks and six panels on the same screen as
 * "click the ground to walk", before owning anything at all.
 */
const STEP_ACTION: Record<string, { tab: string; label: string; hint: string; show: string[] }> = {
  moved:      { tab: "products",  label: "Show me",      hint: "Click the ground to walk there.", show: [] },
  leased:     { tab: "products",  label: "Pick a plot",  hint: "Choose a glowing plot, then sign the lease.", show: ["build"] },
  licensed:   { tab: "products",  label: "Choose a trade", hint: "Pick what your business will make.", show: ["build"] },
  built:      { tab: "products",  label: "Build it",     hint: "Put your building on the plot.", show: ["build"] },
  produced:   { tab: "business",  label: "See the floor", hint: "Watch a cycle run. You do not start it.", show: ["ops", "quick"] },
  upgraded:   { tab: "business",  label: "Upgrade",      hint: "Install one improvement in your building.", show: ["ops", "quick"] },
  sold:       { tab: "market", label: "See who buys", hint: "Mercedonians buy what you make.", show: ["ops", "quick", "market", "nav"] },
  contracted: { tab: "orders", label: "Take an order", hint: "Fill a buyer's order — it pays the most.", show: ["ops", "quick", "market", "contracts", "nav"] },
  traveled:   { tab: "map", label: "Use Transit Hall", hint: "Fast-travel to another district.", show: ["ops", "quick", "market", "contracts", "map", "nav"] },
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

  // One switch, not two: the Mayor's own Hide button already means "stop guiding me",
  // so it turns the decluttering off as well and the full interface is simply there.
  const guided = Boolean(next) && !store.state.mayorHidden;
  const shell = element<HTMLElement>(".app-shell");
  shell.dataset.guided = String(guided);
  shell.dataset.step = key ?? "complete";
  shell.dataset.show = guided ? (step?.show ?? []).join(" ") : "";

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
            <button class="secondary" data-action="errand-sell-product" data-product="${product.id}" ${stock > 0 && !store.errand() ? "" : "disabled"}>${store.errand() ? "Hands full" : `Ship · ${product.price}`}</button>
          </div>
          ${missing.length ? (() => {
            // Quote the whole job, not just the components: a player who spent their last MM
            // on parts they then cannot afford the labour for is stranded holding inputs.
            const parts = store.missingInputCost(product);
            const job = parts + product.labour;
            const makers = [...new Set(missing.map((m) => BUSINESS[m.product.business].name))].join(" or ");
            return `<div class="product-actions single"><button class="secondary" data-action="buy-inputs" data-product="${product.id}" ${store.state.wallet >= job ? "" : "disabled"}>Buy components \u00B7 ${parts} ${CURRENCY_CODE}</button></div>
          <small class="product-hint">Needs ${missing.map((m) => `${m.short} ${m.product.name}`).join(", ")}, made by ${makers}. With labour that is ${job} ${CURRENCY_CODE} all in.</small>`;
          })() : ""}
        </article>`;
      }).join("")}
    </div>`;
}

function renderBusiness(): void {
  const state = store.state;
  // Business is its own tab now. Before there is a business it used to render nothing — a
  // blank screen that was invisible while it shared a tab with Products. Say what comes next.
  if (!state.buildingPlaced || !state.license) {
    const step = !state.ownedPlotId
      ? { title: "No business yet", body: "Lease a plot first. Glowing plots in the world are open; click one to see its terms.", cta: "Find a plot" }
      : !state.license
        ? { title: "Your plot is waiting", body: "Choose the trade your business will run. Each trade buys different inputs and sells to different Mercedonians.", cta: "Choose a trade" }
        : { title: "Licensed, not built", body: "Put the building on your plot. Production starts on its own once it stands.", cta: "Build it" };
    element("#businessPanel").innerHTML = `
      <div class="hud-drawer-empty">
        ${uiIcon("business")}
        <strong>${step.title}</strong>
        <p>${step.body}</p>
        <p>This tab will show your rate, costs, stock, customers and takings once the business runs.</p>
        <button data-action="tab" data-target="products">${step.cta}</button>
      </div>`;
    return;
  }

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
    <h2 class="panel-heading">${config.name}</h2>
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
      <div class="game-card two-up"><button data-action="interior">Go inside · fit equipment</button><button class="secondary" data-action="maintain">Repair · 20 ${CURRENCY_CODE}</button></div>
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
  if (isDemo()) {
    return `<div class="wallet-connect"><p>This is a sealed demo. Nothing is saved or sent to the shared economy.</p><button data-action="gate-connect">Leave demo and sign in</button></div>`;
  }
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

/**
 * The market itself: the filter, the legend and the tradeable rows.
 *
 * Lifted out of the panel body so it can be rendered FIRST. It used to sit eighth, under
 * the bank desk, the withdrawal desk, the contribution board and the $MM sinks — the only
 * part of the exchange a player can press, behind everything they cannot.
 */
/**
 * What the treasury REALLY holds, read from the chain by the authority.
 *
 * This panel used to print BANK_TREASURY_MM — 50,000,000 — as the treasury behind $MM, and
 * a collateral ratio of "10000% covered", both invented in the browser. Harmless while $MM
 * was a score; the moment withdrawals opened on mainnet it was telling players that the
 * backing behind a real token was fifty times the wallet's actual balance.
 *
 * Only the authority can read the wallet, so when it has not answered this says so rather
 * than substituting a number. A dash is honest; 50,000,000 was not.
 */
/**
 * Bringing real $MM into the game.
 *
 * The player sends $MM to the treasury from their own wallet and hands back the signature;
 * the authority reads the amount off the chain. Deliberately NOT an in-app signing flow:
 * that needs a Solana library in the bundle and a transaction this code builds on the
 * player's behalf, and for a first version of a real-money rail, "you send it yourself and
 * we verify it" is the one where a bug cannot move somebody's tokens.
 */
function depositMarkup(): string {
  if (!depositDesk?.open || !depositDesk.treasury) return "";
  const held = chainMM;
  const canAfford = held === null || held >= depositAmount;
  return `<section class="mm-deposit">
    <div class="drawer-section-label">Bring $MM in</div>
    <p>Your wallet sends $MM to the city treasury and the city credits it — one approval, in
      the page. ${held !== null
        ? `You hold ${formatNumber(held)} $MM.`
        : "Your wallet balance is not readable right now, but a purchase will still work."}</p>
    <div class="amount-field">
      <label for="depositUnits">Amount</label>
      <input id="depositUnits" type="number" inputmode="numeric" min="1" step="1"
        ${held !== null ? `max="${Math.floor(held)}"` : ""} value="${depositAmount}"
        data-action="deposit-amount" aria-describedby="depositWorth" />
      <span class="amount-unit">$MM</span>
      ${held !== null ? `<button class="amount-max" data-action="deposit-max">Max</button>` : ""}
    </div>
    <p class="amount-worth" id="depositWorth">= ${formatNumber(store.mercDollarsForMM(depositAmount))} ${CURRENCY_CODE}, credited on arrival</p>
    <button class="deposit-buy" data-action="buy-mm" ${canAfford && depositAmount >= 1 ? "" : "disabled"}>
      <span>Send ${formatNumber(depositAmount)} $MM</span>
      <small>${depositAmount < 1
        ? "Enter an amount"
        : canAfford
          ? `Receive ${formatNumber(store.mercDollarsForMM(depositAmount))} ${CURRENCY_CODE}`
          : `You hold ${formatNumber(held ?? 0)} $MM`}</small>
    </button>
    <details class="deposit-manual">
      <summary>Sent it yourself?</summary>
      <p>Send to <code>${escapeMarkup(depositDesk.treasury)}</code> and paste the signature —
        the city credits whatever actually arrived.</p>
      <div class="deposit-claim">
        <input id="depositSignature" type="text" autocomplete="off" spellcheck="false"
          placeholder="Transaction signature" aria-label="Transaction signature" />
        <button data-action="claim-deposit">Credit it</button>
      </div>
    </details>
    ${depositDesk.deposited > 0
      ? `<small class="deposit-total">${formatNumber(depositDesk.deposited)} $MM brought in so far.</small>`
      : ""}
  </section>`;
}

function mmBackingMarkup(): string {
  const mm = cityBooks?.books?.mm ?? null;
  if (!mm || mm.status === "off") {
    return `<div class="mm-backing off"><div><small>$MM backing</small><strong>Withdrawals closed</strong></div>
      <span>$MM is earned in play and stays in the game for now.</span></div>`;
  }
  if (mm.held === null) {
    return `<div class="mm-backing unknown"><div><small>$MM backing</small><strong>Not readable</strong></div>
      <span>The authority could not read the treasury wallet just now.</span></div>`;
  }
  const owed = mm.outstanding;
  const cover = owed > 0 ? Math.round((mm.held / owed) * 100) : null;
  return `<div class="mm-backing ${mm.status}">
    <div><small>Treasury holds</small><strong>${formatNumber(mm.held)} $MM</strong></div>
    <div><small>Owed to makers</small><strong>${formatNumber(owed)} $MM</strong></div>
    <div><small>Headroom</small><strong>${formatNumber(mm.headroom ?? 0)} $MM</strong></div>
    <span>${owed === 0
      ? "Every $MM earned so far has been withdrawn or none is owed yet. Real balance, read from Solana."
      : `${cover}% of what makers are owed is held on Solana right now.`}</span>
  </div>`;
}

function marketListMarkup(neededKeys: ResourceKey[], visibleKeys: ResourceKey[]): string {
  return `
    <div class="filter-strip market-filter" aria-label="Market inventory filter"><button class="${marketFilter === "all" ? "active" : ""}" data-action="market-filter" data-filter="all">All goods</button><button class="${marketFilter === "needed" ? "active" : ""}" data-action="market-filter" data-filter="needed">Needed now${neededKeys.length ? ` · ${neededKeys.length}` : ""}</button><button class="${marketFilter === "owned" ? "active" : ""}" data-action="market-filter" data-filter="owned">My stock</button></div>
    <div class="market-legend"><span>Item &amp; economic role</span><span>Local quote · ${CURRENCY_CODE}</span><span>Trade</span></div>
    <div class="card-list market-list">
      ${visibleKeys.map((key) => {
        const resource = RESOURCES[key];
        const pressure = Math.round((store.state.marketPressure[key] - 1) * 100);
        const trend = pressure > 4 ? "scarce" : pressure < -4 ? "surplus" : "stable";
        return `<div class="market-row" style="--resource-color:${resource.color}"><i>${resource.icon}</i><div class="market-name"><strong>${resource.name}</strong><small>${resource.tier} · ${resource.buyer === "citizens" ? "Households" : "Civic"} ${store.procurementRemaining(key)}/${store.dailyQuota(key)} at full price</small></div><div class="market-quote"><strong>${store.marketBuyPrice(key)} ${CURRENCY_CODE} <small>buy</small></strong><span>${store.marketSellPrice(key)} ${CURRENCY_CODE} sell · hold ${store.state.inventory[key]}</span><em class="${trend}">${pressure > 0 ? "+" : ""}${pressure}% ${trend}</em></div><div class="market-actions"><button data-action="errand-buy" data-resource="${key}" ${store.errand() ? "disabled" : ""}>${store.errand() ? "Hands full" : "Order 1"}</button><span class="market-auto" title="Mercedonians and the trades below you buy this as they need it">bought by demand</span></div></div>`;
      }).join("")}
      ${visibleKeys.length ? "" : `<div class="empty-state"><i>⇄</i><strong>No goods in this view</strong><p>${marketFilter === "needed" ? "Choose a business license to reveal its required inputs." : "Produce or buy something to build your stock."}</p><button data-action="market-filter" data-filter="all">Show all goods</button></div>`}
    </div>
  `;
}

function renderMarket(): void {
  const confidence = store.consumerConfidenceIndex();
  const priceIndex = store.marketPriceIndex();
  const allKeys = Object.keys(RESOURCES) as ResourceKey[];
  // Everything the game has told this maker to get, not only what a cycle burns. See
  // store.shoppingList: the interior says "buy what you are short of on the Market tab",
  // and this default view used to open without the crate and part it had just named.
  const neededKeys = store.shoppingList();
  const visibleKeys = marketFilter === "needed"
    ? allKeys.filter((key) => neededKeys.includes(key))
    : marketFilter === "owned"
      ? allKeys.filter((key) => store.state.inventory[key] > 0)
      : allKeys;
  // WHAT TO DO, BEFORE WHAT TO KNOW.
  //
  // The exchange opened on a central bank — money supply, room to issue, treasury depth,
  // civic wage bill, contribution share — and the four rows a player can actually press
  // were the eighth section down, past roughly 2,500 characters of monetary policy. Every
  // number was true and none of them answered "what do I do here". Each line below is a
  // real action at today's price with its own button; store.marketAdvice picks them.
  const advice = store.marketAdvice();
  const adviceMarkup = `
    <section class="market-advice">
      <div class="section-title">What to do here</div>
      ${advice.map((entry) => {
        const action = entry.kind === "sell" && entry.resource
          ? `<button data-action="sell-stock" data-resource="${entry.resource}" data-quantity="${entry.quantity ?? 1}">Sell</button>`
          : entry.kind === "buy" && entry.resource
            ? `<button data-action="quick-buy" data-resource="${entry.resource}" data-quantity="${entry.quantity ?? 1}">Buy</button>`
            : entry.kind === "order"
              ? `<button data-action="tab" data-target="orders">Orders</button>`
              : "";
        return `<article class="advice-row advice-${entry.kind}">
          <div><strong>${escapeMarkup(entry.text)}</strong><small>${escapeMarkup(entry.detail)}</small></div>
          ${action}
        </article>`;
      }).join("")}
    </section>`;

  element("#marketPanel").innerHTML = `
    <h2>Buy &amp; sell</h2>
    ${adviceMarkup}
    ${marketListMarkup(neededKeys, visibleKeys)}
    <details class="journey-details"><summary>Market conditions</summary>
      <div class="economic-dashboard"><div><small>Price index</small><strong>${priceIndex}</strong><span>${priceIndex > 100 ? "+" : ""}${priceIndex - 100}% vs opening</span></div><div><small>Confidence</small><strong>${confidence}</strong><span>How freely Mercedonians spend</span></div><div><small>Cycle</small><strong>${store.economicPhase()}</strong><span>${store.economyTrend()}</span></div><div><small>$MM backing</small><strong>${cityBooks?.books?.mm?.held != null ? `${formatNumber(cityBooks.books.mm.held)} $MM` : "—"}</strong><span>${cityBooks?.books?.mm ? "held by the treasury on Solana" : "asking the authority"}</span></div></div>
    </details>
  `;
}

/**
 * ONE bank. There were two: this panel's inline desk and the drawer's bankDeskMarkup, each
 * with its own copy of the same rules, and each needing the same fixes twice. The drawer's
 * is the complete one — it carries the purchase — so it is the one that survives.
 */
function renderBank(): void {
  const node = document.querySelector<HTMLElement>("#bankPanel");
  if (!node) return;
  node.innerHTML = `
    <h2>Government Bank</h2>
    <p class="lead">Earned $MM converts to Merc Dollars here, and Merc Dollars convert back. Real $MM in
      your wallet can be brought in, and earned $MM can be withdrawn to it.</p>
    <section class="bank-desk">
      ${bankDeskMarkup()}
      <details class="treasury-books">
        <summary>The city's books</summary>
        <p>One dollar of $MM buys ${formatNumber(MERC_DOLLARS_PER_USD)} ${CURRENCY_CODE}, less the bank's spread. The bank issues Merc Dollars against the $MM it holds and stops when the city's headroom runs out.</p>
        ${mmBackingMarkup()}
        <div class="reserve-balance">
          <div><small>Money supply</small><strong>${formatNumber(store.mercDollarSupply())} ${CURRENCY_CODE}</strong></div>
          <div><small>Room to issue</small><strong>${formatNumber(store.issuanceHeadroom())} ${CURRENCY_CODE}</strong></div>
          <div><small>Issued this epoch</small><strong>${formatNumber(store.state.epochIssued)} ${CURRENCY_CODE}</strong></div>
          <div><small>Your capital here</small><strong>${formatNumber(store.withdrawableCapitalMM())} $MM</strong></div>
        </div>
        <div class="city-strip">
          <div><small>Mercedonians</small><strong>${formatNumber(store.mercedonianPopulation())}</strong></div>
          <div><small>Civic wage</small><strong>${store.civicDailyWage()} ${CURRENCY_CODE}/day</strong></div>
          <div><small>City wage bill</small><strong>${formatNumber(store.civicWageBill())} ${CURRENCY_CODE}/day</strong></div>
          <div><small>They will spend</small><strong>${formatNumber(store.citizenSpendingPower())} ${CURRENCY_CODE}</strong></div>
          <div><small>Paid to date</small><strong>${formatNumber(Math.round(store.state.civicWagesPaid))} ${CURRENCY_CODE}</strong></div>
          <div><small>Citizen purses</small><strong>${formatNumber(Math.round(store.state.citizenPool))} ${CURRENCY_CODE}</strong></div>
        </div>
        <small class="city-note">Mercedonia pays every household a civic wage each day, and that money becomes the custom in your shop.</small>
        <small class="reserve-boundary">This bank is a mechanic inside the game. Moving $MM here converts it to ${CURRENCY_CODE} for use in the city.</small>
      </details>
    </section>
    ${withdrawalDesk ? `
    <section class="bank-desk withdraw-desk">
      <div class="reserve-heading"><div><small>On-chain</small><strong>Withdraw to your wallet</strong></div>
        <span>${withdrawalDesk.enabled ? escapeMarkup(withdrawalDesk.network) : "not open yet"}</span></div>
      ${withdrawalDesk.enabled ? `
        <p>Your earned $MM can leave the game: the treasury signs a real transfer to the wallet you signed in with. Withdrawals start at ${formatNumber(withdrawalDesk.minimum)} $MM and land within a minute.</p>
        <div class="reserve-balance">
          <div><small>Withdrawable</small><strong>${formatNumber(withdrawalDesk.withdrawable)} $MM</strong></div>
          <div><small>Destination</small><strong>your signed-in wallet</strong></div>
        </div>
        <div class="reserve-actions">
          <button data-action="withdraw-chain" ${withdrawalDesk.withdrawable < withdrawalDesk.minimum ? "disabled" : ""}>
            Withdraw ${formatNumber(withdrawalDesk.withdrawable)} $MM <small>on-chain, to your wallet</small></button>
        </div>`
      : `<p>Withdrawals are closed. Your contribution is recorded by the city — ${formatNumber(withdrawalDesk.withdrawable)} $MM to your name — but $MM cannot currently leave Mercedonia, and whether it ever does is undecided. Treat everything here as part of the game.</p>`}
      ${withdrawalDesk.payouts.length ? `<ul class="advisor-log">${withdrawalDesk.payouts.slice(0, 4).map((row) => `<li class="payout-${escapeMarkup(row.state)}">
        <strong>${formatNumber(row.units)} $MM</strong><em>${escapeMarkup(row.state)}</em>
        ${row.signature ? `<small>tx ${escapeMarkup(row.signature.slice(0, 20))}…</small>` : row.error ? `<small>${escapeMarkup(row.error)}</small>` : ""}</li>`).join("")}</ul>` : ""}
    </section>` : ""}

  `;
}

function renderRewards(): void {
  const node = document.querySelector<HTMLElement>("#rewardsPanel");
  if (!node) return;
  node.innerHTML = `
    <h2>Your weekly share</h2>
    <section class="reserve-desk">
      <div class="reserve-heading"><div><small>Contribution Board</small><strong>Epoch Distribution</strong></div><span>${formatNumber(store.epochBudget())} $MM this week</span></div>
      <p>$MM is <strong>earned, never bought</strong>. Each week the rewards pool pays out a share of itself, split by how much you contributed — so it shrinks slowly instead of running out.</p>
      <div class="epoch-meter" role="img" aria-label="Your share of this epoch's contribution pool: ${(store.epochShare() * 100).toFixed(2)} percent">
        <div class="epoch-fill" style="width:${Math.min(100, store.epochShare() * 100).toFixed(2)}%"></div>
      </div>
      <div class="reserve-balance">
        <div><small>Your contribution</small><strong>${formatNumber(Math.round(standing ? standing.mine : store.state.epoch.contribution))}</strong></div>
        <div><small>Your share</small><strong>${((standing ? standing.share : store.epochShare()) * 100).toFixed(2)}%</strong></div>
        <div><small>Projected payout</small><strong>${formatNumber(epochProjection().units)} $MM</strong>${epochProjection().authoritative ? "" : "<em class=\"estimate-tag\">estimate</em>"}</div>
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
        <button data-action="claim-epoch" ${store.state.epoch.claimed || epochProjection().units <= 0 ? "disabled" : ""} title="${epochProjection().authoritative ? "Confirmed by the authority" : "Local estimate — the authority could not be reached"}">${store.state.epoch.claimed ? "Epoch already claimed" : `Claim ${formatNumber(epochProjection().units)} $MM${epochProjection().authoritative ? "" : " (estimate)"}`}</button>
      </div>
      <small class="reserve-boundary">Prototype accounting only: no on-chain transfer, no redemption, and no promise of price or profit.</small>
    </section>
  `;
}

/** The city: who is buying, what the treasury holds, and what the press says. */
function renderCityPanel(): void {
  const node = document.querySelector<HTMLElement>("#cityPanel");
  if (!node) return;
  node.innerHTML = `
    <h2>Mercedonia today</h2>
    ${districtBoardMarkup()}
    <details class="treasury-books ledger-health">
      <summary>Ledger health</summary>
    <div class="stat-grid"><div class="stat"><small>Civic treasury</small><strong>${formatNumber(store.state.governmentTreasury)} ${CURRENCY_CODE}</strong></div><div class="stat"><small>Mercedonian spending pool</small><strong>${formatNumber(store.state.citizenPool)} ${CURRENCY_CODE}</strong></div><div class="stat"><small>Payroll returned to Mercedonians</small><strong>${formatNumber(store.state.laborPaid)} ${CURRENCY_CODE}</strong></div><div class="stat"><small>Your tax paid</small><strong>${formatNumber(store.state.taxPaid)} ${CURRENCY_CODE}</strong></div><div class="stat"><small>$MM held by the treasury</small><strong>${
      cityBooks?.books?.mm?.held != null ? formatNumber(cityBooks.books.mm.held) : "—"
    }</strong></div><div class="stat"><small>$MM owed to makers</small><strong>${
      cityBooks?.books?.mm ? formatNumber(cityBooks.books.mm.outstanding) : "—"
    }</strong></div><div class="stat"><small>Total $MM supply</small><strong>${formatNumber(MM_TOTAL_SUPPLY)}</strong></div></div>
    <p class="model-note">Merc Dollar prices are bounded and mean-reverting. $MM is never required for leases, payroll, inputs, services or taxes. This remains a gameplay simulation—not a promise of token value, yield or profit.</p>
    </details>

    <div class="section-title">Dispatch</div>
    ${newsDeskMarkup()}
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
/**
 * The authority's balance for this player, or null when nobody is signed in.
 *
 * On a server world this is the ONLY balance that means anything: it is what
 * `economy.buy`, `market.list` and `market.buy` actually debit, and it is the balance
 * that refuses with "Not enough MERCS to settle". The local `state.wallet` is the offline
 * simulation's own bookkeeping, and on a server world the two drift apart in both
 * directions at once — the tick spends from the server purse without telling the client,
 * while local production credits the client purse for work the authority already did.
 *
 * Showing one number and spending another is how a player watches a purchase fail with
 * thousands on screen.
 */
let serverWallet: number | null = null;

/** The purse to display and to gate every affordability check on. */
function purse(): number {
  return serverWallet ?? store.state.wallet;
}
let myPlayerId: string | null = null;
let marketBusy = false;
const listingDraft: ListingDraft = { item: null, quantity: 10, markup: 0 };
/**
 * The authority's limits on a maker's own listings, mirrored for the UI only.
 *
 * The server is the authority on both — these exist so the panel can say "18 of 20" and
 * refuse a dust listing before the player fills in a form, rather than letting them press
 * List and read a toast about a rule nobody told them.
 */
const MAX_OPEN_LISTINGS = 20;
const MIN_LISTING_VALUE = 25;

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
  if (holdings) {
    makerHoldings = holdings.inventory;
    // Only take the authority's figure once the authority HAS one. A maker who has signed
    // in but not yet built has no ledger account, and reading its absence as a balance of
    // zero showed them 0 MERCS on screen while the browser's own 750 was what every
    // purchase spent — two purses, one of them invisible, and the visible one wrong.
    serverWallet = holdings.hasAccount ? holdings.wallet : null;
  }
  if (myPlayerId === null) myPlayerId = (await fetchIdentity())?.playerId ?? null;
  renderMakerMarket();
}

function renderMakerMarket(): void {
  const node = document.querySelector<HTMLElement>("#makerMarketPanel");
  if (!node) return;

  if (!isSynced()) {
    node.innerHTML = `<h2>Mercedonian market</h2>
      <div class="empty-state"><i>⇄</i><strong>Sign in to trade with other Mercedonians</strong>
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
  const atListingCap = mine.length >= MAX_OPEN_LISTINGS;
  const tooSmall = quantity * unitPrice < MIN_LISTING_VALUE;

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
        : `<button data-action="errand-market-buy" data-listing="${entry.id}" ${marketBusy || purse() < entry.total || store.errand() ? "disabled" : ""}>${
            store.errand() ? "Hands full"
            : purse() < entry.total ? "Too dear"
            : "Order"}</button>`}
    </li>`;
  };

  node.innerHTML = `
    <h2>Mercedonian market</h2>
    <p class="model-note">Goods other Mercedonians are selling in ${escapeMarkup(districtName())}. Each district keeps its own book. A listing holds the goods in escrow until somebody buys them or you withdraw it. The city takes 2% of a sale.</p>

    <div class="section-title">On offer${theirs.length ? ` · ${theirs.length}` : ""}</div>
    ${theirs.length
      ? `<ul class="maker-listings">${theirs.map((entry) => row(entry, false)).join("")}</ul>`
      : `<div class="empty-state"><i>◎</i><strong>Nobody is selling here yet</strong><p>Be the first — list something below and set your own price.</p></div>`}

    ${mine.length ? `<div class="section-title">Your listings · ${mine.length}</div>
      <ul class="maker-listings">${mine.map((entry) => row(entry, true)).join("")}</ul>` : ""}

    <div class="section-title">Sell to Mercedonians</div>
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
        <button class="interior-buy" data-action="errand-market-list" ${marketBusy || !listingDraft.item || held <= 0 || atListingCap || tooSmall || store.errand() ? "disabled" : ""}>
          ${!listingDraft.item ? "Nothing to list"
            : store.errand() ? "Hands full"
            : atListingCap ? `All ${MAX_OPEN_LISTINGS} of your listings are open`
            : tooSmall ? `Worth ${formatNumber(quantity * unitPrice)} — the book takes ${MIN_LISTING_VALUE} and up`
            : `List ${quantity} ${escapeMarkup(RESOURCES[listingDraft.item].short)} · ${formatNumber(quantity * unitPrice)} ${CURRENCY_CODE} if it all sells`}
        </button>
        <small class="maker-cap-note">${mine.length} of ${MAX_OPEN_LISTINGS} listings open${atListingCap ? " — withdraw one to list again" : ""}</small>
      </div>`
      : `<div class="empty-state"><i>▤</i><strong>Nothing in the warehouse</strong><p>The authority holds no goods for you yet. Produce something, and it can be listed here.</p></div>`}
  `;
}


/**
 * Every maker-market action goes the same way: ask the authority, and only mirror what it
 * confirms. A refusal is shown as-is — it is the shared market talking, and inventing a
 * local fallback would let a browser believe it sold something the ledger never moved.
 */
async function withMarket(work: () => Promise<boolean>): Promise<boolean> {
  if (marketBusy) return false;
  marketBusy = true;
  renderMakerMarket();
  let settled = false;
  try {
    settled = await work();
    if (settled) await refreshMakerMarket();
  } finally {
    marketBusy = false;
    renderAll();
    void refreshMakerMarket();
  }
  // Whether the authority actually settled it — an errand must not clear on a refusal.
  return settled;
}

async function placeMakerListing(): Promise<boolean> {
  const item = listingDraft.item;
  if (!item) return false;
  const held = makerHoldings[item] ?? 0;
  const quantity = Math.max(1, Math.min(listingDraft.quantity, held));
  const unitPrice = draftUnitPrice();
  if (quantity <= 0 || unitPrice <= 0) return false;

  return withMarket(async () => {
    const outcome = await listOnMarket(store.state.island, item, quantity, unitPrice);
    if (outcome.status === "ok") { report(store.applyMarketListing(item, quantity, unitPrice)); return true; }
    if (outcome.status === "refused") toast(outcome.message);
    else toast("The market is unreachable right now.");
    return false;
  });
}

async function takeMakerListing(listingId: string): Promise<boolean> {
  const listing = makerListings.find((entry) => entry.id === listingId);
  if (!listing) return false;

  // No click-arming any more: this is only ever reached from settleErrand, which means the
  // player already ordered the listing and then walked it to the transit hall. The journey
  // is the confirmation, and a far more deliberate one than a second click.
  return withMarket(async () => {
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

async function withdrawMakerListing(listingId: string): Promise<boolean> {
  const listing = makerListings.find((entry) => entry.id === listingId);
  if (!listing) return false;
  // Withdrawing is not an errand: taking your own goods back off the shelf costs nothing
  // and stranding them behind a walk would only punish a change of mind.
  return withMarket(async () => {
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
      <div class="contract-actions"><button data-action="errand-contract" ${shortfall ? "disabled" : ""}>Deliver order · earn ${active.grossReward - Math.floor(active.grossReward * .05)} ${CURRENCY_CODE}</button><button class="secondary" data-action="release-contract">Release · −1 reputation</button></div>
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

/**
 * The interior's logo set: drawn marks, not typography.
 *
 * Every icon in the room's HUD was a Unicode glyph — ⚒ ▦ ϟ ✦ — which renders at the mercy
 * of the platform font: a different weight on every OS, emoji-substituted on some, and never
 * sitting on the same optical grid twice. These are 24x24 stroke drawings in currentColor,
 * so they inherit the gold/teal language of whatever chip they sit in and match each other.
 */
const LOGO: Record<string, string> = {
  yield: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v7"/><path d="M8 6l4 4 4-4"/><rect x="5" y="13" width="14" height="8" rx="1.5"/><path d="M9 17h6"/></svg>`,
  capacity: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/><rect x="8.5" y="4" width="7" height="7" rx="1"/></svg>`,
  speed: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 3L5 14h6l-1 7 8-11h-6z"/></svg>`,
  appeal: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1"/></svg>`,
  hopper: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16l-6 8v6l-4 2v-8z"/></svg>`,
  kiln: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3c3 4 6 6 6 10a6 6 0 0 1-12 0c0-4 3-6 6-10z"/><path d="M12 13c1.2 1.4 2 2.2 2 3.6a2 2 0 0 1-4 0c0-1.4.8-2.2 2-3.6z"/></svg>`,
  governor: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15a8 8 0 0 1 16 0"/><path d="M12 15l4-5"/><path d="M3 19h18"/></svg>`,
  sorter: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v6"/><path d="M12 9l-6 6v4"/><path d="M12 9l6 6v4"/><path d="M4 21h4M16 21h4"/></svg>`,
  rack: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4v16M20 4v16"/><path d="M4 9h16M4 15h16"/><path d="M8 6.5h4M12 12h4"/></svg>`,
  counter: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10h18v3H3z"/><path d="M5 13v7h14v-7"/><path d="M12 10V6"/><circle cx="12" cy="4.5" r="1.6"/></svg>`,
  build: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 5l5 5-9 9H5v-5z"/><path d="M12 7l5 5"/></svg>`,
  turn: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 8a8 8 0 1 0 2 6"/><path d="M20 3v5h-5"/></svg>`,
  exit: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4H5v16h4"/><path d="M13 8l4 4-4 4M17 12H8"/></svg>`,
};
const logo = (name: string): string => `<i class="hud-logo" aria-hidden="true">${LOGO[name] ?? ""}</i>`;

function renderInteriorPrompt(): void {
  const icon = interiorPromptNode.querySelector<HTMLElement>("i");
  const hint = interiorPromptNode.querySelector<HTMLElement>("small");
  const title = interiorPromptNode.querySelector<HTMLElement>("strong");
  if (!icon || !hint || !title) return;

  if (!interiorPrompt) {
    icon.innerHTML = logo("build");
    hint.textContent = "Explore the room";
    title.textContent = "Move close to an equipment station";
    interiorInteractButton.textContent = "Walk closer";
    interiorInteractButton.disabled = true;
    return;
  }

  const selection = interiorPrompt.selection;
  icon.innerHTML = selection.kind === "upgrade" ? logo(selection.key) : logo("exit");
  hint.textContent = interiorPrompt.inputHint;
  title.textContent = `${interiorPrompt.title} · ${interiorPrompt.detail}`;
  interiorInteractButton.textContent = interiorPrompt.actionLabel;
  interiorInteractButton.disabled = !interiorPrompt.available;
}

function renderInterior(): void {
  if (!interiorOpen || !store.state.license) return;
  const license = store.state.license;
  const config = BUSINESS[license];
  const room = INTERIOR_ROOMS[license];
  const ceiling = store.upgradeCeiling();
  const installed = (Object.keys(UPGRADE_NAMES) as UpgradeKey[]).reduce((total, key) => total + store.state.upgrades[key], 0);
  const roomAccent = `#${room.accent.toString(16).padStart(6, "0")}`;
  interiorModal.dataset.license = license;
  interiorModal.dataset.architecture = room.architecture;
  interiorModal.style.setProperty("--interior-accent", roomAccent);
  element("#interiorEyebrow").textContent = `${config.sector} · Mercedonian enterprise`;
  element("#interiorTitle").textContent = config.name;
  element("#interiorRoomLabel").textContent = room.displayName;
  element("#interiorObjectiveTitle").textContent = "Explore the production floor";
  element("#interiorObjectiveCopy").textContent = room.description;
  element("#interiorSystem").textContent = room.regenerativeSystem;
  // What the fitters are doing, IN THE ROOM.
  //
  // A machine is bought and then FITTED — the crew takes a minute or so and only then does
  // it appear. store.installation() was rendered in the world's business drawer and nowhere
  // else, so a maker who bought a machine by placing it stood on an unchanged floor with no
  // sign anything had happened. That reads exactly like the placement failing, which is what
  // it was reported as.
  const fitting = store.installation();
  element("#interiorLevel").textContent = fitting
    ? `Fitting ${UPGRADE_NAMES[fitting.key].name} · ${fitting.progress}% · ${formatDuration(fitting.secondsLeft)} left`
    : `Installed modules · ${installed}/${ceiling * 4}`;
  element("#interiorLevel").classList.toggle("fitting", !!fitting);
  renderInteriorPrompt();

  const selectedKey = interiorSelection?.kind === "upgrade" ? interiorSelection.key : null;
  const signature = [
    license,
    interiorSelection?.kind ?? "none",
    selectedKey ?? "none",
    interiorSelection?.nearby ?? false,
    ceiling,
    purse(),   // the displayed balance: the console must redraw when it changes
    ...Object.values(store.state.upgrades),
    ...Object.values(store.state.inventory),
    // Placement has to be in the signature. Buying or moving a fitting changed none of the
    // terms above, so the panel kept showing "not beside its machine" after the player had
    // just moved it beside its machine — until some unrelated change forced a repaint.
    ...(Object.keys(FITTINGS) as FittingKey[]).map((key) => {
      const tile = store.state.fittings[key];
      return tile ? `${key}@${tile.column},${tile.row}` : `${key}-`;
    }),
    ...(Object.keys(UPGRADE_NAMES) as UpgradeKey[]).map((key) => {
      const tile = store.state.equipmentTiles[key];
      return tile ? `${key}@${tile.column},${tile.row}` : `${key}-`;
    }),
  ].join(":");
  if (signature === interiorConsoleSignature) return;
  interiorConsoleSignature = signature;

  const consoleNode = element("#interiorConsole");
  if (!selectedKey) {
    // THE BUILD TRAY. Everything that can stand on the floor, and nothing else: press a
    // machine to start placing it (or move it, if it already stands), press a fitting to buy
    // it into your hand. The tray closes itself the moment something is in hand — the thing
    // being placed is the point, and the whole floor is legal ground.
    consoleNode.innerHTML = `<div id="interiorEquipmentPanel" class="interior-tray">
      <div class="interior-floor-head"><small>${escapeMarkup(room.displayName)}</small><strong>Build</strong></div>
      <div class="interior-tray-section">Machines</div>
      <div class="interior-floor-list">
        ${(Object.keys(UPGRADE_NAMES) as UpgradeKey[]).map((key) => {
          const machine = INTERIOR_EQUIPMENT_CATALOG[license][key];
          const owned = store.state.upgrades[key];
          return `<div class="interior-tray-row">
            <button class="interior-floor-row" data-action="interior-move" data-upgrade="${key}"
              aria-label="${owned === 0 ? "Place" : "Move"} ${escapeMarkup(machine.name)}">
              ${logo(key)}
              <span class="ifr-name">${escapeMarkup(machine.name)}</span>
              <span class="ifr-pips" aria-label="Level ${owned} of ${ceiling}">${
                Array.from({ length: ceiling }, (_, i) => `<b class="${i < owned ? "on" : ""}"></b>`).join("")
              }</span>
              <span class="ifr-meta">${owned === 0 ? `${formatNumber(UPGRADE_COSTS[1]!.mercDollars)} ${CURRENCY_CODE}${
                Object.entries(UPGRADE_COSTS[1]!.resources).map(([r, n]) =>
                  ` + ${n} ${n === 1 ? RESOURCES[r as ResourceKey].name : RESOURCES[r as ResourceKey].short}`).join("")
              } \u00b7 buy & place` : "Drag to move"}</span>
            </button>
            <button class="interior-move" data-action="interior-turn" data-upgrade="${key}"
              title="Turn ${escapeMarkup(machine.name)} (R)" aria-label="Turn ${escapeMarkup(machine.name)}">${logo("turn")}</button>
          </div>`;
        }).join("")}
      </div>
      <div class="interior-tray-section">Fittings</div>
      <div class="interior-floor-list">
        ${(Object.keys(FITTINGS) as FittingKey[]).map((key) => {
          const spec = FITTINGS[key];
          const owned = !!store.state.fittings?.[key];
          const live = store.activeFittings().includes(key);
          const afford = purse() >= spec.cost;
          return `<button class="interior-floor-row" data-action="fitting-place" data-fitting="${key}"
            ${!owned && !afford ? "disabled" : ""}
            title="${escapeMarkup(spec.detail)} \u2014 serves the ${escapeMarkup(UPGRADE_NAMES[spec.serves].name)}">
            ${logo(key)}
            <span class="ifr-name">${escapeMarkup(spec.name)}</span>
            <span class="ifr-meta">${owned
              ? (live ? "Working \u00b7 drag to move" : "Not beside its machine \u00b7 drag to move")
              : `${formatNumber(spec.cost)} ${CURRENCY_CODE} \u00b7 buy & place`}</span>
          </button>`;
        }).join("")}
      </div>
    </div>`;
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
    <div class="equipment-title">${logo(selectedKey)}<div><h3>${escapeMarkup(design.name)}</h3><small>${level === 0 ? "Blueprint ready · not installed" : `Physical equipment · level ${level} of ${ceiling}`}</small></div></div>
    <p class="equipment-copy">${escapeMarkup(design.description)}</p>
    <div class="interior-system-note"><small>${escapeMarkup(room.displayName)}</small><strong>${escapeMarkup(room.regenerativeSystem)}</strong></div>
    <div class="equipment-benefit"><small>Business improvement</small><strong>${escapeMarkup(upgrade.effect)}</strong></div>
    ${(() => { const outlook = store.upgradeOutlook(selectedKey);
      return outlook ? `<p class="equipment-outlook">${escapeMarkup(outlook)}</p>` : ""; })()}
    <div class="equipment-meter" aria-label="${level} of ${ceiling} equipment levels installed">${Array.from({ length: MAX_UPGRADE_LEVEL }, (_, index) => `<i class="${index < level ? "on" : index >= ceiling ? "locked" : ""}"></i>`).join("")}</div>
    ${atMaximum
      ? `<div class="equipment-cost"><small>${needsCharter ? "Next step" : "Installation complete"}</small><strong>${needsCharter ? `Earn a master charter to unlock level ${MAX_UPGRADE_LEVEL}.` : "This machine is fully developed."}</strong></div>`
      : `<div class="equipment-cost"><small>${level === 0 ? "Purchase cost" : `Level ${nextLevel} installation cost`}</small><div class="cost-row"><span>${cost.mercDollars} ${CURRENCY_CODE}</span>${resourceCosts(cost.resources)}</div></div>`}
    <button class="interior-buy" data-action="interior-interact" ${atMaximum || !nearby ? "disabled" : ""}>${buttonLabel}</button>
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
let cityBooks: Awaited<ReturnType<typeof fetchCityBooks>> = { books: null, policy: null, cabinet: null };
let dispatches: CityDispatch[] | null = null;
let dispatchLoaded = false;

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
  const { books, policy, cabinet } = cityBooks;
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
      ${statTile("Businesses hold", `${formatNumber(books.makersHolding)} ${CURRENCY_CODE}`, `Across ${formatNumber(books.businesses)} ${books.businesses === 1 ? "business" : "businesses"}`)}
      ${statTile("Total in circulation", `${formatNumber(supply)} ${CURRENCY_CODE}`, "Moved, never created")}
    </div>

    <div class="section-title">Today</div>
    <div class="info-grid">
      ${statTile("Civic wage", `${formatNumber(books.payrollToday ?? 0)} ${CURRENCY_CODE}`, "Paid to every household")}
      ${statTile("Civic works", `${formatNumber(books.worksSpendToday ?? 0)} ${CURRENCY_CODE}`, "Wages for making water, power, ore and timber")}
      ${statTile("Districts trading", formatNumber(books.districts.length))}
      ${statTile("Busiest trade", books.busiestTrade ? String(books.busiestTrade) : "Nothing sold yet")}
      ${statTile("Quietest shelf", books.quietestShelf ? String(books.quietestShelf) : "—", "Nobody has touched it")}
    </div>

    ${cabinet ? `
      <div class="section-title">Today's word from the Exchequer</div>
      <div class="cabinet-card cabinet-${escapeMarkup(cabinet.standing.stance)}">
        <div class="cabinet-head">
          <strong>${cabinet.standing.stance === "expand" ? "Expanding"
            : cabinet.standing.stance === "restrain" ? "Restraining" : "Holding steady"}</strong>
          <span>${cabinet.standing.decidedAt
            ? `decided ${new Date(cabinet.standing.decidedAt).toLocaleString()}`
            : "no cabinet has sat — the standing formula applies"}</span>
        </div>
        <p class="cabinet-address">${escapeMarkup(cabinet.standing.address)}</p>
        <div class="info-grid">
          ${statTile("Wages today", `${Math.round(cabinet.standing.wageFactor * 100)}%`, "of the standing bill")}
          ${statTile("Civic works", `${Math.round(cabinet.standing.worksFactor * 100)}%`, cabinet.standing.worksFactor === 0 ? "halted for the day" : "of the standing rate")}
        </div>
        <small class="cabinet-reason">${escapeMarkup(cabinet.standing.reason)}</small>
      </div>
      <p class="model-note">The government decides each day what share of the wage bill to pay and how hard the civic works run. It cannot move a coin itself: the treasury floor and the payroll cap are enforced in code, and a directive can only choose where to sit beneath them${cabinet.cabinetAvailable ? "" : ". No cabinet is configured on this realm, so the standing formula runs untouched"}.</p>
      ${cabinet.directives.length > 1 ? `
        <div class="section-title">The cabinet's record</div>
        <ul class="advisor-log">${cabinet.directives.slice(0, 6).map((entry) => `<li class="advisor-${escapeMarkup(entry.stance)}">
          <strong>${escapeMarkup(entry.stance)} — wages ${Math.round(entry.wageFactor * 100)}%, works ${Math.round(entry.worksFactor * 100)}%</strong>
          <em>${entry.decidedAt ? new Date(entry.decidedAt).toLocaleDateString() : ""}</em>
          <small>${escapeMarkup(entry.reason)}</small></li>`).join("")}</ul>` : ""}
    ` : ""}

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

/**
 * What this epoch owes, and whether the authority said so.
 *
 * The panel read the server's projection while the button, the alert and the quick-bar
 * chip each read the local one, so a maker could be shown 15,000 $MM and offered 659.
 * Everything that names a figure now goes through here.
 */
/**
 * Claim the epoch, through the authority when it can be reached.
 *
 * The server decides the amount and records it; the client only mirrors what came back.
 * If the authority is unreachable the local estimate still pays, because refusing to pay
 * a maker because a fetch failed is worse than paying an approximate figure — but the
 * button already said "estimate" in that state, so nobody was promised otherwise.
 */
async function withdrawToWallet(): Promise<void> {
  const desk = withdrawalDesk;
  if (!desk || !desk.enabled || desk.withdrawable < desk.minimum) return;
  const result = await requestWithdrawal(desk.withdrawable, crypto.randomUUID());
  report({ ok: result.ok, message: result.message });
  withdrawalDesk = await fetchWithdrawals();
  renderAll();
}

/**
 * Carry out the job in hand, at the desk it belongs to.
 *
 * Refuses anywhere else. The whole point of an errand is that it is finished in a place,
 * so this checks proximity rather than trusting the button — the counter panel only draws
 * the button when you are there, but a stale panel must not be a way to settle from across
 * the city.
 *
 * The errand is cleared ONLY on success. A purchase the city refuses (no stock, no money)
 * leaves the job in hand rather than swallowing it, which would cost the player the walk
 * and give them nothing.
 */
async function settleErrand(): Promise<void> {
  const errand = store.errand();
  if (!errand) return;
  const near = nearbyCounter();
  if (!near || near.id !== errand.desk) {
    toast("You are not at the right desk for that.");
    return;
  }

  let done = false;
  if (errand.kind === "buy") {
    const key = errand.payload.resource as ResourceKey;
    const quantity = errand.payload.quantity ?? 1;
    const handled = await tradeThroughRealm("buy", key, quantity);
    if (handled) done = true;
    else {
      const outcome = store.buyResource(key, quantity);
      report(outcome);
      done = outcome.ok;
    }
  } else if (errand.kind === "sell") {
    const key = errand.payload.resource as ResourceKey;
    const quantity = errand.payload.quantity ?? 1;
    const handled = await tradeThroughRealm("sell", key, quantity);
    if (handled) done = true;
    else {
      const outcome = store.sellResource(key, quantity);
      report(outcome);
      done = outcome.ok;
    }
  } else if (errand.kind === "market-buy") {
    done = await takeMakerListing(errand.payload.listingId ?? "");
  } else if (errand.kind === "market-list") {
    done = await placeMakerListing();
  } else if (errand.kind === "product") {
    const outcome = store.sellProduct(errand.payload.product ?? "");
    report(outcome);
    done = outcome.ok;
  } else if (errand.kind === "contract") {
    const outcome = store.fulfillContract();
    report(outcome);
    done = outcome.ok;
  }

  if (done) {
    store.completeErrand();
    toast(`Done: ${errand.label}.`);
  }
  renderAll();
}

async function claimEpoch(): Promise<void> {
  if (isSynced()) {
    const settled = await claimEpochOnServer(crypto.randomUUID());
    if (settled) {
      if (settled.reason === "paid" && settled.paid > 0) {
        report(store.claimEpochRewards(Date.now(), settled.paid, settled.lifetime));
      } else {
        const why = settled.reason === "already-claimed" ? "This epoch's distribution is already claimed."
          : settled.reason === "no-contribution" ? "Fulfil an order or supply the district to earn a share."
          : settled.reason === "pool-exhausted" ? "The rewards pool is fully drawn."
          : "This epoch's budget is fully drawn.";
        report({ ok: false, message: why });
      }
      standing = await fetchStanding();
      renderAll();
      return;
    }
  }
  report(store.claimEpochRewards(Date.now(), epochProjection().units));
}

function epochProjection(): { units: number; authoritative: boolean } {
  if (standing && standing.projected > 0) return { units: standing.projected, authoritative: true };
  return { units: store.projectedEpochMM(), authoritative: false };
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
        ${statTile("Mercedonian standing", `${level.name}`, `Level ${level.level} of ${CAREER_LEVELS.length}`)}
        ${statTile("Experience", `${formatNumber(store.state.experience)} XP`, next ? `${formatNumber(next.xp - store.state.experience)} to ${next.name}` : "Top of the ladder")}
        ${statTile("Reputation", formatNumber(store.state.reputation), "Earned by selling and delivering")}
        ${statTile("Orders filled", formatNumber(store.state.contractsCompleted), "Named buyers served")}
      </div>
      <div class="section-title">Purse</div>
      <div class="info-grid">
        ${statTile("Merc Dollars", `${formatNumber(purse())} ${CURRENCY_CODE}`, "Spendable now")}
        ${statTile("Net worth", `${formatNumber(store.netWorth())} ${CURRENCY_CODE}`, "Cash plus stock at market")}
        ${statTile("$MM held", formatNumber(store.state.mmHoldings), `${formatNumber(store.state.lifetimeMMEarned)} earned in total`)}
        ${statTile("This epoch", formatNumber(Math.round(store.state.epoch.contribution)), `${((standing ? standing.share : store.epochShare()) * 100).toFixed(2)}% share · ${formatNumber(epochProjection().units)} $MM projected`)}
      </div>
      <div class="section-title">Holdings</div>
      <div class="info-grid">
        ${statTile("Plots", `${store.ownedPlotIds().length} of ${store.plotAllowance()}`, "Standing and deeds set the ceiling")}
        ${statTile("Civic deeds", formatNumber(store.state.deeds), "Each one raises the ceiling by one")}
        ${statTile("Charter", store.state.chartered ? "Granted" : "Not yet", store.state.chartered ? "Equipment may reach the top level" : `${CHARTER_COST_MM} $MM at the bank`)}
        ${statTile("Specialisation", store.state.specialization ? SPECIALIZATIONS[store.state.specialization].name : "None chosen", "Shapes quality, cost and appeal")}
      </div>
      <div class="section-title">Account</div>
      ${walletMarkup()}`;
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
        ${statTile("Other Mercedonians here", formatNumber(store.state.districtBusinesses), "Every one of them is a customer for something")}
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
      ${statTile("Your purse", `${formatNumber(purse())} ${CURRENCY_CODE}`)}
      ${statTile("Money supply", `${formatNumber(store.totalMoneySupply())} ${CURRENCY_CODE}`, "Never created, only moved")}
    </div>`;
}


// --- Edge desks ----------------------------------------------------------------------
// News and banking are frequent checks, not full-screen destinations. They share one
// compact left drawer and remain closed until asked for, leaving the city unobstructed.

function dispatchTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Published recently";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}

function newsDeskMarkup(): string {
  if (!dispatchLoaded) {
    return `<div class="hud-drawer-empty"><i class="news-pulse" aria-hidden="true"></i><strong>Opening today's paper</strong><p>Asking the civic press room for the latest dispatch.</p></div>`;
  }
  if (dispatches === null) {
    return `<div class="hud-drawer-empty"><svg class="mm-icon" aria-hidden="true"><use href="#mm-icon-news" /></svg><strong>The press room is out of reach</strong><p>The shared city may be offline. Your business keeps running locally.</p><button data-action="dispatch-refresh">Try again</button></div>`;
  }
  if (dispatches.length === 0) {
    return `<div class="hud-drawer-empty"><svg class="mm-icon" aria-hidden="true"><use href="#mm-icon-news" /></svg><strong>No edition has been filed yet</strong><p>The Dispatch publishes only when the city ledger has a measured day to report.</p><button data-action="dispatch-refresh">Check again</button></div>`;
  }
  const [lead, ...older] = dispatches;
  const snapshot = lead!.snapshot;
  return `
    <article class="dispatch-lead mood-${escapeMarkup(lead!.mood)}">
      <div class="dispatch-dateline"><span>Mercedonia Dispatch</span><time datetime="${escapeMarkup(lead!.publishedAt)}">${escapeMarkup(dispatchTime(lead!.publishedAt))}</time></div>
      <h2>${escapeMarkup(lead!.headline)}</h2>
      <p>${escapeMarkup(lead!.body)}</p>
      <div class="dispatch-figures" aria-label="Measured city figures behind this edition">
        <span><small>Businesses</small><strong>${formatNumber(snapshot.businesses)}</strong></span>
        <span><small>Sold today</small><strong>${formatNumber(snapshot.soldToday)}</strong></span>
        <span><small>Trade value</small><strong>${formatNumber(snapshot.grossToday)} ${CURRENCY_CODE}</strong></span>
      </div>
      <small class="dispatch-source">AI-written from measured city ledger figures. It reports; it cannot move money or govern.</small>
    </article>
    ${older.length ? `<div class="drawer-section-label">Earlier editions</div><div class="dispatch-archive">${older.map((entry) => `
      <details class="dispatch-brief mood-${escapeMarkup(entry.mood)}"><summary><span><small>${escapeMarkup(dispatchTime(entry.publishedAt))}</small><strong>${escapeMarkup(entry.headline)}</strong></span><b>+</b></summary><p>${escapeMarkup(entry.body)}</p></details>`).join("")}</div>` : ""}`;
}

function bankDeskMarkup(): string {
  // The Bank drawer is a second treasury desk, and it had the same two lies as the first:
  // a button reading "Convert 100 $MM" for an action that converts everything held, and a
  // "Return 1,000 MERCS" that floored 0.8 $MM away on every press.
  const capital = store.withdrawableCapitalMM();
  const offer = convertibleMM();
  const converted = store.mercDollarsForMM(convertAsked());
  const redeem = redeemableMercs();
  const returned = store.mmForMercDollars(redeem);
  return `
    <section class="hud-bank-card">
      <div class="bank-balance-pair">
        <span><small>MERCS</small><strong>${formatNumber(purse())}</strong><em>what you trade with, in game</em></span>
        <span><small>$MM earned</small><strong>${formatNumber(store.state.mmHoldings)}</strong><em>${
          chainMM === null ? "convert here, or withdraw to your wallet"
            : `${formatNumber(chainMM)} $MM already in your wallet`}</em></span>
      </div>
      ${depositMarkup()}
      <div class="drawer-section-label">Treasury exchange</div>
      <div class="bank-rate-card">
        <span><small>Bring to the treasury</small><strong>${formatNumber(offer)} $MM</strong></span><b aria-hidden="true">→</b><span><small>Receive</small><strong>${formatNumber(converted)} ${CURRENCY_CODE}</strong></span>
      </div>
      ${convertibleMM() >= 1 ? `<div class="amount-field">
        <label for="convertUnitsDrawer">Convert</label>
        <input id="convertUnitsDrawer" type="number" inputmode="numeric" min="1" step="1" max="${convertibleMM()}"
          value="${convertAsked()}" data-action="convert-amount" />
        <span class="amount-unit">$MM</span>
        <button class="amount-max" data-action="convert-max">All</button>
      </div>
      <p class="amount-worth" data-convert-worth>= ${formatNumber(store.mercDollarsForMM(convertAsked()))} ${CURRENCY_CODE}</p>` : ""}
      <div class="hud-bank-actions">
        <button data-action="bank-in" ${offer < 1 ? "disabled" : ""}><span>${offer >= 1 ? `Convert ${formatNumber(convertAsked())} $MM` : "Convert your $MM"}</span><small>${
          offer >= 1
            ? `Receive ${formatNumber(converted)} ${CURRENCY_CODE}`
            // SAY WHY. This showed a price while sitting dead, so a player with nothing to
            // convert was given a rate and no reason they could not take it.
            : store.state.mmHoldings >= 1
              ? "Treasury limit reached — no room to issue until it grows"
              : "You hold none yet. $MM is earned: claim your weekly share."}</small></button>
        <button class="secondary" data-action="bank-out" ${redeem <= 0 || returned <= 0 ? "disabled" : ""}><span>${redeem > 0 ? `Return ${formatNumber(redeem)} ${CURRENCY_CODE}` : `Return ${CURRENCY_CODE}`}</span><small>${
          redeem > 0
            ? `Take back ${formatNumber(returned)} $MM`
            : capital > 0 ? `${formatNumber(capital)} $MM on deposit, not enough ${CURRENCY_CODE} to redeem` : "No deposited capital"}</small></button>
      </div>
      <div class="bank-mini-ledger">
        <span><small>Your capital on deposit</small><strong>${formatNumber(capital)} $MM</strong></span>
        <span><small>Issuance room</small><strong>${formatNumber(store.issuanceHeadroom())} ${CURRENCY_CODE}</strong></span>
        <span><small>1,000 ${CURRENCY_CODE} returns</small><strong>${formatNumber(returned)} $MM</strong></span>
      </div>
      <p class="bank-boundary">MERCS stay in the game. $MM you have earned can be withdrawn to
        your Solana wallet from the Exchange, and is earned in play — never bought. Nothing here is
        a deposit, a claim, or a promise of profit or price.</p>
      <button class="drawer-link-button" data-action="tab" data-target="bank">Open the Bank <span aria-hidden="true">→</span></button>
    </section>`;
}

function renderUtilityDrawer(): void {
  const news = utilityMode === "news";
  element("#utilityDrawerEmblem").innerHTML = `<svg class="mm-icon" aria-hidden="true"><use href="#mm-icon-${news ? "news" : "bank"}" /></svg>`;
  element("#utilityDrawerKicker").textContent = news ? "AI civic newsroom" : "Government Bank";
  element("#utilityDrawerTitle").textContent = news ? "City Dispatch" : "Treasury exchange";
  element("#hudUtilityContent").innerHTML = news ? newsDeskMarkup() : bankDeskMarkup();
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
  if (!store.state.epoch.claimed && epochProjection().units > 0) {
    alerts.push({ tone: "good", text: `This week's share is ready: ${formatNumber(epochProjection().units)} $MM.`,
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
  const count = element<HTMLElement>("#businessAlertCount");
  count.hidden = alerts.length === 0;
  count.textContent = String(alerts.length);
  businessDrawerToggle.classList.toggle("has-alert", alerts.some((alert) => alert.tone === "urgent" || alert.tone === "warn"));
  businessDrawerToggle.setAttribute("aria-label", alerts.length
    ? `Open business desk. ${alerts.length} ${alerts.length === 1 ? "alert" : "alerts"}.`
    : "Open business desk");
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
  const level = store.careerLevel();

  if (isDemo()) {
    node.innerHTML = `<button class="player-profile-card demo" data-action="profile-open"
      title="Open your demo profile. Nothing here is saved.">
      <span class="profile-avatar"><img src="/assets/brand/mm-maker-crest.svg" alt="" /></span>
      <span class="profile-copy"><small>Lv ${level.level} · ${escapeMarkup(level.name)}</small><strong>Demo Mercedonian</strong></span>
      <i class="profile-status" aria-label="Demo session"></i></button>`;
    return;
  }
  if (principal) {
    const short = `${principal.walletAddress.slice(0, 4)}…${principal.walletAddress.slice(-4)}`;
    node.innerHTML = `<button class="player-profile-card linked" data-action="profile-open" title="Open profile for ${escapeMarkup(principal.walletAddress)}">
      <span class="profile-avatar"><img src="/assets/brand/mm-maker-crest.svg" alt="" /></span>
      <span class="profile-copy"><small>Lv ${level.level} · ${escapeMarkup(level.name)}</small><strong>${escapeMarkup(short)}</strong></span>
      <i class="profile-status" aria-label="Signed in"></i></button>`;
    return;
  }
  if (!walletAvailable()) {
    node.innerHTML = `<a class="player-profile-card needs" href="https://phantom.app/download" target="_blank" rel="noreferrer noopener"
      title="No Solana wallet was found in this browser">
      <span class="profile-avatar"><svg class="mm-icon" aria-hidden="true"><use href="#mm-icon-profile" /></svg></span>
      <span class="profile-copy"><small>Guest profile</small><strong>Get a wallet</strong></span></a>`;
    return;
  }
  node.innerHTML = `<button class="player-profile-card" data-action="wallet-connect" aria-label="Connect wallet and open player profile">
    <span class="profile-avatar"><svg class="mm-icon" aria-hidden="true"><use href="#mm-icon-profile" /></svg></span>
    <span class="profile-copy"><small>Guest profile</small><strong>Connect wallet</strong></span></button>`;
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

/**
 * Watch for a wallet that has not finished injecting itself yet.
 *
 * Phantom and every other extension set window.solana ASYNCHRONOUSLY, after the page has
 * started running. renderBootGate ran exactly once, read walletAvailable() at that instant and
 * never looked again — so a player who HAS a wallet could be shown "Get a Solana wallet", an
 * <a target="_blank"> to a download page. With a popup blocker in the way, clicking it does
 * visibly nothing, which is precisely the "I press connect and nothing shows up" report.
 *
 * Polls briefly and also listens for the Wallet Standard announcement, then redraws the gate.
 */
let walletWatch = 0;
function watchForWallet(): void {
  if (walletWatch) return;
  const stop = (): void => { window.clearInterval(walletWatch); walletWatch = 0; };
  const check = (): void => {
    if (!walletAvailable()) return;
    stop();
    // Only redraw while the gate is still the thing on screen.
    if (!element("#bootGate").hidden) renderBootGate();
  };
  window.addEventListener("wallet-standard:register-wallet", check, { once: false });
  walletWatch = window.setInterval(check, 250);
  // Extensions that are going to inject have done so well inside this.
  window.setTimeout(stop, 8000);
  check();
}

function renderBootGate(): void {
  const choices = document.querySelector<HTMLElement>("#bootChoices");
  if (!choices) return;
  const canConnect = walletAvailable();
  if (!canConnect) watchForWallet();
  // Name the wallets that actually answered. A single "Connect Solana wallet" button hands
  // the sign-in to whichever extension won the race for window.solana, which is not a
  // choice — a player with two wallets installed could never reach the second one.
  const wallets = availableWallets();
  choices.innerHTML = `
    ${wallets.length > 1
      ? `<div class="boot-wallets">${wallets.map((wallet) => `
          <button class="boot-wallet" data-action="gate-connect" data-wallet="${escapeMarkup(wallet.id)}">
            ${wallet.icon ? `<img src="${escapeMarkup(wallet.icon)}" alt="" />` : `<i aria-hidden="true">${escapeMarkup(wallet.name.slice(0, 1))}</i>`}
            <span>${escapeMarkup(wallet.name)}</span>
          </button>`).join("")}</div>`
      : canConnect
        ? `<button class="boot-primary" data-action="gate-connect" data-wallet="${escapeMarkup(wallets[0]!.id)}">Connect ${escapeMarkup(wallets[0]!.name)}</button>`
        : `<a class="boot-primary" href="https://phantom.app/download" target="_blank" rel="noreferrer noopener">Get a Solana wallet</a>
           <small class="boot-hint">Already have one? It may still be waking up — this becomes a
             <b>Connect</b> button the moment any wallet answers. On a phone, open this page inside
             your wallet's own browser to sign in.</small>`}
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
  node.hidden = false;
  if (isDemo()) {
    node.className = "online-pill offline";
    node.innerHTML = `<i aria-hidden="true"></i><span><b>1</b><small>Mercedonian · private demo</small></span>`;
    return;
  }
  if (!realmLive) {
    node.className = "online-pill offline";
    node.innerHTML = `<i aria-hidden="true"></i><span><b>1</b><small>Mercedonian · local world</small></span>`;
    return;
  }
  const total = peerCount + 1;
  node.className = `online-pill${peerCount > 0 ? " busy" : ""}`;
  node.innerHTML = `<i aria-hidden="true"></i><span><b>${total}</b><small>${total === 1 ? "Mercedonian" : "Mercedonians"} nearby</small></span>`;
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
    chips.push(`<button data-action="tab" data-target="market" title="The district is still buying">
      <i aria-hidden="true">⇄</i><span><small>Sell stock</small><strong>${sellable.length} good${sellable.length === 1 ? "" : "s"} wanted</strong></span></button>`);
  }

  // The weekly share, which expires with the epoch.
  if (!state.epoch.claimed && epochProjection().units > 0) {
    chips.push(`<button class="quick-good" data-action="claim-epoch" title="Your share of this week's $MM">
      <i aria-hidden="true">★</i><span><small>Claim share</small><strong>${formatNumber(epochProjection().units)} $MM</strong></span></button>`);
  }

  node.hidden = chips.length === 0;
  node.innerHTML = chips.join("");
}


/**
 * TOP — presence, the balances, and a way into everything.
 *
 * The balances are BUTTONS now. Both were inert readouts, while the bank that converts one
 * into the other sat third in a stacked tab behind the orders board and the makers'
 * market: the number was on screen and the thing you do with it was four interactions away.
 *
 * The $MM pill also shows what the WALLET holds, which the game could not see at all —
 * /api/chain/balance was built on the authority and called by no client code. Two figures,
 * labelled, because they are genuinely different things: `earned` is the in-game balance
 * the bank converts and the epoch pays; `wallet` is real Token-2022 $MM on mainnet. $MM is
 * earned, never bought, so the wallet figure is where withdrawals LAND, not a purse the
 * game can spend from.
 */
function renderVitals(): void {
  const node = document.querySelector<HTMLElement>("#hudVitals");
  if (!node) return;
  const wallet = chainMM === null ? "" : `<em>${formatNumber(chainMM)} in wallet</em>`;
  node.innerHTML = `
    <button data-action="goto" data-panel="marketPanel"
      title="Merc Dollars — what you trade with. Opens the market.">
      <img src="/assets/brand/merc-dollars.png" alt="" decoding="async" />
      <span><small>Merc Dollars</small><strong>${formatNumber(purse())}</strong></span>
    </button>
    <button data-action="utility-open" data-utility="bank"
      title="$MM you have earned. Opens the Government Bank.">
      <svg class="mm-icon" aria-hidden="true"><use href="#mm-icon-exchange" /></svg>
      <span><small>$MM</small><strong>${formatNumber(store.state.mmHoldings)}</strong>${wallet}</span>
    </button>`;
}

/**
 * The six things a maker actually needs, one press each.
 *
 * Every one of these existed and every one was two or three interactions deep: open the
 * sheet, pick the right tab of four, then scroll past whatever else that tab stacks above
 * it. Naming them on screen is the difference between a game with these features and a
 * game where a player can find them.
 */
/**
 * Every destination, in the order the loop actually needs them.
 *
 * This replaces two navigations that had grown separately and fought: a left rail holding
 * News, Bank and Info, and a full-width bar across the top holding six more. They
 * duplicated Bank, and the bar was laid over the balances — measured at 0,0 by 1280x34
 * with the money at 634,8, underneath it.
 *
 * Order is the player's day: what you run, what it makes, where you sell it, who is buying,
 * then money, then the world, then reading matter. `drawer` opens a side desk, `panel`
 * jumps into the sheet.
 */
type DockEntry = { tab: string; icon: UiIconName; label: string; hint: string } | { split: true };

/**
 * The dock is the ONLY navigation. Ten destinations, one purpose each, in the order a day
 * runs: your shop, what it makes, where it sells, who is buying, then money, then the city.
 * The sheet used to have its own four-tab row as well — two navigations for one set of
 * places, and the second one wrapped its fourth tab onto a row of its own.
 */
const HUD_DOCK: readonly DockEntry[] = [
  { tab: "business", icon: "business", label: "Business", hint: "Your enterprise: status, rate, costs, takings" },
  { tab: "products", icon: "build",    label: "Products", hint: "What you make, and building it" },
  { split: true },
  { tab: "market",   icon: "world",    label: "Market",   hint: "Buy and sell with the district" },
  { tab: "orders",   icon: "rank",     label: "Orders",   hint: "City Hall and household orders — they pay most" },
  { tab: "traders",  icon: "network",  label: "Traders",  hint: "Buy and sell with other Mercedonians" },
  { split: true },
  { tab: "bank",     icon: "bank",     label: "Bank",     hint: "$MM to Merc Dollars and back; bring $MM in, take it out" },
  { tab: "rewards",  icon: "exchange", label: "Rewards",  hint: "Your share of this week's $MM" },
  { split: true },
  { tab: "city",     icon: "news",     label: "City",     hint: "The treasury, the government, the press" },
  { tab: "map",      icon: "compass",  label: "Map",      hint: "Districts and travel" },
  { tab: "info",     icon: "info",     label: "Info",     hint: "How Mercedonia works" },
];

type DockStop = Exclude<DockEntry, { split: true }>;
function dockStops(): DockStop[] { return HUD_DOCK.filter((e): e is DockStop => !("split" in e)); }
function dockShortcut(index: number): string { return `⌥${(index + 1) % 10}`; }

function renderQuickAccess(): void {
  const node = document.querySelector<HTMLElement>("#quickAccess");
  if (!node) return;
  const active = store.state.activeContract;
  const ready = active && store.state.inventory[active.resource] >= active.quantity ? 1 : 0;
  const open = sheet.dataset.open === "true" ? activeTab : null;
  let stop = 0;
  node.innerHTML = HUD_DOCK.map((entry) => {
    if ("split" in entry) return `<span class="dock-split" aria-hidden="true"></span>`;
    const badge = entry.tab === "orders" && ready ? `<b title="An order is ready to deliver">1</b>` : "";
    const isOpen = open === entry.tab;
    const key = dockShortcut(stop++);
    return `<button role="tab" data-action="tab" data-target="${entry.tab}" data-tab="${entry.tab}"
      class="${isOpen ? "active" : ""}" aria-selected="${isOpen}" aria-controls="sheet"
      title="${escapeMarkup(entry.hint)} (${key})">
      ${uiIcon(entry.icon)}<span>${escapeMarkup(entry.label)}</span>${badge}
    </button>`;
  }).join("");
}

/**
 * Your business, on screen, always.
 *
 * This game is about running one. Its state was behind a toggle, so the answer to "is it
 * working?" cost a click and a read. Status, progress, what is on the shelf and what it
 * took today — and the one thing stopping it, when something is.
 */
function renderBusinessCard(): void {
  const node = document.querySelector<HTMLElement>("#businessCard");
  if (!node) return;
  const licence = store.state.license;
  if (!licence || !store.state.buildingPlaced) {
    node.hidden = true;
    return;
  }
  node.hidden = false;
  // The card IS the way in. The floating edge tab that used to be the only way in still
  // exists for phones, where the card is too wide to keep on screen.
  node.setAttribute("data-action", "business-drawer-toggle");
  node.setAttribute("role", "button");
  node.setAttribute("tabindex", "0");
  const config = BUSINESS[licence];
  const fitting = store.installation();
  const job = store.state.job;
  const broken = store.state.brokenDown;
  const cut = store.state.suppliesCut;

  const state = broken ? "broken" : cut || !job ? "idle" : "working";
  node.className = `hud-business-card ${state}`;
  node.style.setProperty("--bc-accent", config.color);

  const status = broken ? "Broken down"
    : cut ? "Supply cut"
    : fitting ? `Fitting ${UPGRADE_NAMES[fitting.key].name}`
    : job ? "Producing" : "Idle";
  const progress = fitting ? fitting.progress
    : job ? Math.min(100, Math.round(((Date.now() - job.startedAt) / Math.max(1, job.completeAt - job.startedAt)) * 100))
    : 0;

  const need = broken ? "Repair it to start the line again"
    : cut ? "Settle the standing charges to reconnect"
    : !job && !fitting ? "Nothing running — open it and start a cycle"
    : "";

  node.innerHTML = `
    <div class="bc-head">
      <i aria-hidden="true">${config.icon}</i>
      <div><small>${escapeMarkup(status)}</small><strong>${escapeMarkup(config.name)}</strong></div>
    </div>
    <div class="bc-meter"><span style="width:${progress}%"></span></div>
    <div class="bc-rows">
      <div><small>On the shelf</small><strong>${formatNumber(store.storedUnits())}</strong></div>
      <div><small>Took today</small><strong>${formatNumber(store.state.todayRevenue)}</strong></div>
      <div><small>Condition</small><strong>${Math.round(store.state.condition)}%</strong></div>
      <div><small>Costs/day</small><strong>${formatNumber(store.dailyOverhead())}</strong></div>
    </div>
    ${need ? `<b class="bc-need">${escapeMarkup(need)}</b>` : ""}
    <span class="bc-open">Open the desk</span>`;
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
  if (!licence || !store.state.buildingPlaced) {
    businessTurntable.setBusiness(null);
    businessDrawerToggle.style.removeProperty("--business-accent");
    element("#businessTabIcon").innerHTML = `<svg class="mm-icon" aria-hidden="true"><use href="#mm-icon-business" /></svg>`;
    element("#businessTabState").textContent = "Enterprise";
    element("#businessTabName").textContent = "Set up a business";
    element("#businessDrawerMeta").textContent = "Your enterprise";
    element("#businessDrawerName").textContent = "Business desk";
    node.className = "bp bp-empty";
    node.innerHTML = `<div class="hud-drawer-empty"><svg class="mm-icon" aria-hidden="true"><use href="#mm-icon-business" /></svg><strong>No business yet</strong><p>Lease a plot, choose a trade, and your live production desk will appear here.</p><button data-action="tab" data-target="business">Open Enterprise</button></div>`;
    return;
  }

  const config = BUSINESS[licence];
  const economics = store.unitEconomics();
  const cycles = store.inputMultiplier();
  const seconds = store.jobDuration(licence, cycles);
  const perHour = seconds > 0 ? (3600 / seconds) : 0;
  const outputs = (Object.keys(config.output) as ResourceKey[]).filter((k) => (config.output[k] ?? 0) > 0);
  const yieldMultiplier = 1 + store.state.upgrades.yield * .12 + (store.state.specialization === "premium" ? .1 : 0);
  const outputRates = outputs.map((key) => ({
    key,
    rate: Math.round(perHour * (config.output[key] ?? 0) * cycles * yieldMultiplier),
  }));
  const serviceRate = Math.round(perHour * (economics?.visitors ?? cycles));
  const products = store.productsMade();
  const upgrades = (Object.keys(UPGRADE_NAMES) as UpgradeKey[]);
  const profit = economics ? Math.round(economics.expectedProfit) : 0;

  const builtBusinesses = store.ownedPlotIds().filter((plotId) => store.state.portfolio[plotId]?.buildingPlaced).length;
  const lastHalt = builtBusinesses <= 1 ? store.state.lastShift?.halted : null;
  const key = store.state.brokenDown
    ? "breakdown"
    : store.state.job
      ? "running"
      : store.state.suppliesCut
        ? "funds"
        : store.storageFull()
          ? "storage"
          : (lastHalt ?? "idle");
  const status = HALT_REASON[key] ?? HALT_REASON.idle!;
  const stock = store.storedUnits();
  const condition = Math.round(store.state.condition);
  const fitting = store.installation();

  businessTurntable.setBusiness(licence);
  businessTurntable.setVisible(businessDrawer.dataset.open === "true");
  businessDrawerToggle.style.setProperty("--business-accent", config.color);
  element("#businessTabIcon").textContent = config.icon;
  element("#businessTabState").textContent = status.label;
  element("#businessTabName").textContent = config.name;
  element("#businessDrawerMeta").textContent = `${config.sector} · ${status.label}`;
  element("#businessDrawerName").textContent = config.name;

  node.className = `bp tone-${status.tone}`;
  node.innerHTML = `
    <div class="business-state-line">
      <span class="business-status"><i aria-hidden="true"></i><strong>${escapeMarkup(status.label)}</strong></span>
      <span><small>Condition</small><strong>${condition}%</strong></span>
      <span title="Resources are shared across your company"><small>Shared stock</small><strong>${stock} units</strong></span>
    </div>
    <p class="business-status-note">${escapeMarkup(status.why)}</p>

    <section class="business-dossier-section">
      <div class="business-section-heading"><span><small>Operations</small><strong>Production</strong></span><b>${seconds}s cycle</b></div>
      <div class="production-rate-list">
        ${config.servicePayout
          ? `<span><i aria-hidden="true">◎</i><em>Customer visits</em><strong>${formatNumber(serviceRate)}<small>/hr estimated</small></strong></span>`
          : outputRates.map(({ key: output, rate }) => `<span><i aria-hidden="true">${RESOURCES[output].icon}</i><em>${escapeMarkup(RESOURCES[output].name)}</em><strong>${formatNumber(rate)}<small>/hr estimated</small></strong></span>`).join("")}
      </div>
    </section>

    <section class="business-dossier-section">
      <div class="business-section-heading"><span><small>Supply</small><strong>Product inventory</strong></span><b>${products.reduce((total, product) => total + store.stockOf(product.id), 0)} finished</b></div>
      ${outputs.length ? `<div class="output-stock-list">${outputs.map((output) => `<span><i>${RESOURCES[output].icon}</i><em>${escapeMarkup(RESOURCES[output].short)}</em><strong>${store.state.inventory[output]}</strong></span>`).join("")}</div>` : ""}
      <div class="finished-product-list">
        ${products.map((product) => `<span><em>${escapeMarkup(product.name)}</em><strong>${store.stockOf(product.id)}</strong><small>${formatNumber(product.price)} ${CURRENCY_CODE}</small></span>`).join("")}
      </div>
    </section>

    <section class="business-dossier-section">
      <div class="business-section-heading"><span><small>Finance</small><strong>Costs &amp; margin</strong></span><b>${CURRENCY_CODE}</b></div>
      <div class="business-finance-grid">
        <span><small>Inputs / cycle</small><strong>${formatNumber(economics?.inputCost ?? 0)}</strong></span>
        <span><small>Labour / cycle</small><strong>${formatNumber(economics?.laborCost ?? 0)}</strong></span>
        <span><small>Utilities / day</small><strong>${formatNumber(store.dailyUtilityBill())}</strong></span>
        <span><small>Company payroll / day</small><strong>${formatNumber(store.dailyPayroll())}</strong></span>
        <span><small>Expected revenue</small><strong>${formatNumber(Math.round(economics?.expectedRevenue ?? 0))}</strong></span>
        <span class="${profit >= 0 ? "up" : "down"}"><small>Estimated cycle margin</small><strong>${profit >= 0 ? "+" : ""}${formatNumber(profit)}</strong></span>
        <span class="business-net-today ${store.todayProfit() >= 0 ? "up" : "down"}"><small>Recorded company net today</small><strong>${store.todayProfit() >= 0 ? "+" : ""}${formatNumber(store.todayProfit())} ${CURRENCY_CODE}</strong></span>
      </div>
    </section>

    <section class="business-dossier-section">
      <div class="business-section-heading"><span><small>Workshop</small><strong>Upgrades</strong></span><b>${Object.values(store.state.upgrades).reduce((sum, level) => sum + level, 0)} installed</b></div>
      ${fitting ? `<div class="business-fitting"><span><small>Installing now</small><strong>${escapeMarkup(UPGRADE_NAMES[fitting.key].name)} · level ${fitting.level}</strong></span><b>${formatDuration(fitting.secondsLeft)}</b><i><u style="width:${fitting.progress}%"></u></i></div>` : ""}
      <div class="business-upgrade-list">
      ${upgrades.map((key) => {
        const level = store.state.upgrades[key];
        const ceiling = store.upgradeCeiling();
        const beingFitted = fitting?.key === key;
        return `<button class="${beingFitted ? "fitting" : ""}" data-action="tab" data-target="business" title="Open ${escapeMarkup(UPGRADE_NAMES[key].name)} in Enterprise">
          <i aria-hidden="true">${UPGRADE_NAMES[key].icon}</i><span><strong>${escapeMarkup(UPGRADE_NAMES[key].name)}</strong><small>Level ${level} of ${ceiling}</small></span>
          <em>${Array.from({ length: ceiling }, (_, i) => `<u class="${i < level ? "on" : ""}"></u>`).join("")}</em><b>›</b>
        </button>`;
      }).join("")}
      </div>
    </section>

    <div class="business-drawer-actions"><button data-action="tab" data-target="business">Open Enterprise</button><button class="secondary" data-action="interior">Enter equipment floor</button></div>`;
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
      ? `<button class="ws-item ws-order" data-action="tab" data-target="orders"><small>Government order</small><strong>${offer.quantity} ${escapeMarkup(RESOURCES[offer.resource].short)}</strong><b>${formatNumber(offer.grossReward)} ${CURRENCY_CODE}</b></button>`
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

/**
 * The job in hand, and how far away the desk is.
 *
 * A player who accepts an errand and then forgets where it goes has been given a chore
 * rather than a task, so the pill names the desk and counts down the distance to it. It
 * turns green on arrival, which is also the moment the counter offers the button.
 */
function renderErrandPill(): void {
  const pill = document.querySelector<HTMLElement>("#errandPill");
  if (!pill) return;
  const errand = store.errand();
  pill.hidden = !errand;
  if (!errand) return;

  const desk = CIVIC_BUILDINGS.find((site) => site.id === errand.desk);
  const here = desk && desk.island === store.state.island;
  const metres = here && desk
    ? Math.round(Math.hypot(store.state.player.x - desk.x, store.state.player.z - desk.z))
    : null;
  const arrived = metres !== null && metres <= COUNTER_RANGE;

  pill.classList.toggle("arrived", arrived);
  pill.innerHTML = `
    <i aria-hidden="true">${escapeMarkup(desk?.icon ?? "\u25C8")}</i>
    <span><small>${escapeMarkup(ERRAND_VERB[errand.kind].going)}</small>
      <strong>${escapeMarkup(errand.label)}</strong>
      <em>${arrived ? `At the ${escapeMarkup(desk!.name)} — press E`
        : here && metres !== null ? `${escapeMarkup(desk!.name)} · ${metres}m`
        : `${escapeMarkup(desk?.name ?? "another district")} · another district`}</em></span>
    <button data-action="errand-drop" aria-label="Drop this errand">\u2715</button>`;
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
  const errand = store.errand();
  // The job in hand comes first, and only at the desk that handles it. Everywhere else
  // the counter looks exactly as it did.
  const errandBlock = errand && errand.desk === counterOpenFor
    ? `<div class="counter-errand">
        <small>${escapeMarkup(ERRAND_VERB[errand.kind].going)}</small>
        <strong>${escapeMarkup(errand.label)}</strong>
        <span>${escapeMarkup(errand.detail)}</span>
        <button data-action="errand-settle">${escapeMarkup(ERRAND_VERB[errand.kind].atDesk)}</button>
      </div>`
    : "";
  panel.innerHTML = `
    <div class="counter-head" style="--counter-color:${escapeMarkup(near.color)}">
      <i aria-hidden="true">${escapeMarkup(near.icon)}</i>
      <span><strong>${escapeMarkup(near.name)}</strong><small>${escapeMarkup(near.role)}</small></span>
      <button class="counter-close" data-action="counter-close" aria-label="Leave the counter">✕</button>
    </div>
    ${errandBlock}
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
    renderErrandPill();
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

/** Somewhere a cab will take you, and what it costs from where you stand. */
interface Stop { id: string; name: string; role: string; x: number; z: number; fare: number; group: "yours" | "civic" | "plot" }

let taxiFilter = "";

/**
 * Everywhere on this island, not nine addresses.
 *
 * The old list was CIVIC_BUILDINGS minus anything closer than the minimum fare, so a
 * player standing in the middle of their own city was told "everything is within a short
 * walk" and given nothing to ride to. A cab that only serves the far edge of the map is
 * not a taxi. Every plot is an address now, and a short hop simply costs the minimum.
 */
function taxiDestinations(): Stop[] {
  const island = store.state.island;
  const { x, z } = store.state.player;
  const owned = new Set(store.ownedPlotIds());

  const civic: Stop[] = CIVIC_BUILDINGS
    .filter((site) => site.island === island)
    .map((site) => ({ id: `civic:${site.id}`, name: site.name, role: site.role,
      x: site.x, z: site.z, fare: store.rideFareToPoint(site.x, site.z), group: "civic" as const }));

  const plots: Stop[] = PLOTS
    .filter((plot) => plot.island === island)
    .map((plot) => ({
      id: `plot:${plot.id}`, name: plot.name,
      role: owned.has(plot.id) ? "Your plot" : `Plot · ${plot.width} × ${plot.depth} m`,
      x: plot.x, z: plot.z, fare: store.rideFareToPoint(plot.x, plot.z),
      group: owned.has(plot.id) ? "yours" as const : "plot" as const,
    }));

  const all = [...civic, ...plots];
  const needle = taxiFilter.trim().toLowerCase();
  const matching = needle
    ? all.filter((stop) => stop.name.toLowerCase().includes(needle) || stop.role.toLowerCase().includes(needle))
    : all;
  // Nearest first: the fare board should open on the places you might actually be going.
  return matching.sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z));
}

/** The fare board's list, rebuilt on its own so typing never loses the caret. */
function taxiStopsMarkup(): string {
  const stops = taxiDestinations();
  if (stops.length === 0) {
    return `<div class="empty-state"><i>▸</i><strong>Nothing by that name</strong><p>Try part of a plot or building name.</p></div>`;
  }
  const groups: Array<[Stop["group"], string]> = [["yours", "Your places"], ["civic", "Civic"], ["plot", "Plots"]];
  // A whole island of addresses is a scroll, not a decision. Show the nearest of each.
  const LIMIT = taxiFilter.trim() ? 24 : 8;
  return groups.map(([group, heading]) => {
    const inGroup = stops.filter((stop) => stop.group === group).slice(0, LIMIT);
    if (inGroup.length === 0) return "";
    return `<div class="taxi-group">${escapeMarkup(heading)}</div>
      <ul class="counter-services">${inGroup.map((stop) => `<li><button data-action="taxi-go"
        data-x="${stop.x}" data-z="${stop.z}" data-label="${escapeMarkup(stop.name)}"
        ${purse() < stop.fare ? "disabled" : ""}>
        <strong>${escapeMarkup(stop.name)}</strong>
        <small>${escapeMarkup(stop.role)}</small>
        <b class="taxi-fare">${stop.fare} ${CURRENCY_CODE}</b></button></li>`).join("")}</ul>`;
  }).join("");
}

function renderTaxi(): void {
  const prompt = document.querySelector<HTMLElement>("#taxiPrompt");
  const panel = document.querySelector<HTMLElement>("#taxiPanel");
  if (!prompt || !panel) return;
  const near = nearbyTaxi();

  // Standing next to a cab is one way in, not the only way. Chasing a moving car around
  // the block to reach a menu is not a control scheme.
  prompt.hidden = hailedTaxi !== null;
  if (hailedTaxi === null) {
    prompt.innerHTML = near
      ? `<kbd>E</kbd><span><strong>Hail this cab</strong><small>Fares are paid to the city</small></span>`
      : `<button class="taxi-call" data-action="taxi-call"><i aria-hidden="true">▸</i><span><strong>Call a cab</strong><small>Ride anywhere on the island</small></span></button>`;
  }

  panel.hidden = hailedTaxi === null;
  if (hailedTaxi === null) return;
  panel.innerHTML = `
    <div class="counter-head" style="--counter-color:#4eaeb7">
      <i aria-hidden="true">▸</i>
      <span><strong>Where to?</strong><small>Walking is free. This is not.</small></span>
      <button class="counter-close" data-action="taxi-close" aria-label="Wave the cab on">✕</button>
    </div>
    <div class="amount-field taxi-search">
      <input id="taxiSearch" type="search" placeholder="Search plots and buildings" value="${escapeMarkup(taxiFilter)}"
        data-action="taxi-filter" autocomplete="off" />
    </div>
    <div id="taxiStops">${taxiStopsMarkup()}</div>`;
}

function renderAll(): void {
  renderHeader();
  renderWalletSlot();
  renderVitals();
  renderQuickAccess();
  renderBusinessCard();
  renderBusinessPanel();
  renderWorldStrip();
  renderCounterPrompt();
  renderErrandPill();
  renderTaxi();
  renderOnlinePill();
  renderTutorial();
  renderSelectedPlot();
  renderBuild();
  renderBusiness();
  renderMarket();
  renderBank();
  renderRewards();
  renderCityPanel();
  renderMakerMarket();
  renderContracts();
  renderMap();
  renderAlerts();
  renderInfo();
  if (utilityDrawer.dataset.open === "true") renderUtilityDrawer();
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
  window.clearInterval(interiorFittingTimer);
  interiorFittingTimer = window.setInterval(() => {
    if (!interiorOpen) return;
    const before = store.installation()?.key ?? null;
    store.catchUp();
    const after = store.installation()?.key ?? null;
    // The crew finished: the level has risen, so the room has to be told or the machine
    // stays invisible until something else happens to re-render it.
    if (before && !after) {
      interiorWorld.updateUpgradeLevels(store.state.upgrades, store.upgradeCeiling());
    }
    if (before || after) renderInterior();
  }, 1_000);
  interiorSelection = null;
  interiorPrompt = null;
  interiorConsoleSignature = "";
  const entryFocus = document.activeElement instanceof HTMLElement ? document.activeElement : element<HTMLElement>("#enterAction");
  interiorReturnFocus = businessDrawer.contains(entryFocus) ? businessDrawerToggle
    : utilityDrawer.contains(entryFocus) ? (utilityReturnFocus ?? canvas) : entryFocus;
  closeSheet();
  closeUtilityDrawer(false);
  closeBusinessDrawer(false);
  world.setInputEnabled(false);
  element<HTMLElement>(".app-shell").setAttribute("inert", "");
  interiorModal.removeAttribute("inert");
  interiorModal.classList.add("show");
  interiorModal.setAttribute("aria-hidden", "false");
  renderInterior();
  // Enter SYNCHRONOUSLY. This was deferred one animation frame "for layout", but setActive
  // already re-runs resize on a settle timer, and a rAF in a possibly-backgrounded tab can
  // fire late or interleave with other input — leaving a visible room whose world was never
  // activated: every control dead, nothing to say why. Measured exactly that state live:
  // modal open, enter() never run, beginPlacement returning without a word.
  {
    interiorWorld.enter({
      business: BUSINESS[license],
      license,
      upgrades: store.state.upgrades,
      upgradeCeiling: store.upgradeCeiling(),
      tiles: store.state.equipmentTiles,
      // Without this the room had no idea which fittings existed, so it could not draw one.
      fittings: store.state.fittings,
      facings: store.state.equipmentFacing,
      // The store owns the rules — the walkway, what already stands on a tile. The room
      // only asks; a refusal leaves the machine where it was.
      // The room asks; the store decides. Stations move, fittings are bought the first
      // time and moved thereafter — all three rules (walkway, occupancy, affordability)
      // live in the store with their tests rather than being restated here.
      onPlace: (key, column, row, kind) => {
        // A MACHINE THAT IS NOT INSTALLED YET IS BOUGHT BY PLACING IT.
        //
        // Without this the room was a dead end for every new business. All four stations
        // start at level 0; applyLevels hides a level-0 station, and resolveSelection skips
        // one — with a comment saying it "can be selected to BUY, but only from the tray."
        // The tray never had a buy: its machine rows do `interior-move` and `interior-turn`
        // and nothing else, and purchaseUpgrade's ONLY call site is onInteract, which needs
        // a machine you can see and stand next to. So a new maker opened their floor, was
        // told to "drag to place", dragged, released — and nothing appeared, because they
        // had placed a machine that does not exist yet and could not be made to exist.
        //
        // Buying on placement is the same gesture the fittings in this very tray already
        // use ("240 MERCS · buy & place"), and it is what the tray copy now promises.
        // purchaseUpgrade names everything missing in one message, so a maker who cannot
        // afford it is told the whole bill rather than being ignored.
        const outcome = kind === "fitting"
          ? (store.state.fittings?.[key as FittingKey]
            ? store.moveFitting(key as FittingKey, column, row)
            : store.installFitting(key as FittingKey, column, row))
          // installEquipmentAt buys a level-0 machine and places it in one move, checking
          // the tile BEFORE the money — see its note. It falls through to a plain move for
          // a machine that is already installed.
          : store.installEquipmentAt(key as UpgradeKey, column, row);
        if (!outcome.ok) toast(outcome.message);
        // A machine bought by being placed has to become VISIBLE, which is applyLevels'
        // job and nothing else calls it here.
        if (outcome.ok && kind === "station") {
          interiorWorld.updateUpgradeLevels(store.state.upgrades, store.upgradeCeiling());
        }
        // Tell the authority. publishBusiness fired on boot, on build and on an upgrade, and
        // on nothing else — so moving a machine, turning it, or dropping a fitting never
        // reached the server, and it priced the whole session against the layout the player
        // had when they arrived. The one mechanic they touch was the one it never heard.
        if (outcome.ok) publishBusiness();
        return outcome.ok;
      },
    });
    interiorCanvas.focus({ preventScroll: true });
  }
}

function closeInterior(): void {
  window.clearInterval(interiorEntryTimer);
  interiorEntryTimer = 0;
  window.clearInterval(interiorFittingTimer);
  interiorFittingTimer = 0;
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
// The dock is the tab bar. Arrow keys walk it; Home/End jump; Enter/Space is the button's own.
element<HTMLElement>("#quickAccess").addEventListener("keydown", (event) => {
  const tabs = [...document.querySelectorAll<HTMLButtonElement>("#quickAccess [role='tab']")];
  const index = tabs.indexOf(document.activeElement as HTMLButtonElement);
  if (index < 0) return;
  let next = index;
  if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % tabs.length;
  else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index - 1 + tabs.length) % tabs.length;
  else if (event.key === "Home") next = 0;
  else if (event.key === "End") next = tabs.length - 1;
  else return;
  event.preventDefault();
  tabs[next]?.focus();
  tabs[next]?.click();
});
element("#leaseAction").dataset.action = "lease";
element("#buildAction").dataset.action = "build";
element("#enterAction").dataset.action = "interior";
element("#closeInterior").addEventListener("click", closeInterior);
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
  // R turns the selected machine. The floor in front of a machine is the floor that counts,
  // so being able to turn one is half of what makes a layout a decision.
  if (event.code === "KeyR" && interiorOpen && !event.metaKey && !event.ctrlKey && !event.altKey) {
    const key = interiorSelection?.kind === "upgrade" ? interiorSelection.key : null;
    if (key) {
      event.preventDefault();
      report(store.rotateEquipment(key));
      interiorWorld.setFacings(store.state.equipmentFacing);
      publishBusiness();
      renderInterior();
    }
  }
  if (event.altKey && /^Digit\d$/.test(event.code)) {
    // ⌥1 … ⌥9 and ⌥0 walk the ten dock stops in dock order.
    event.preventDefault();
    const digit = Number(event.code.at(-1));
    switchTab(dockStops()[(digit === 0 ? 10 : digit) - 1]?.tab ?? "business");
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
  else if (action === "sell-stock") {
    // The exchange's "what to do" card offers to sell the whole shelf at once, so it goes
    // through the same shared-world settlement a single sale does rather than the local
    // simulation — otherwise the one-click version would quietly be the offline one.
    const key = button.dataset.resource as ResourceKey;
    const quantity = Math.max(1, Number(button.dataset.quantity ?? 1));
    void tradeThroughRealm("sell", key, quantity)
      .then((handled) => { if (!handled) report(store.sellResource(key, quantity)); });
  }
  else if (action === "errand-buy") {
    const key = button.dataset.resource as ResourceKey;
    const spec = RESOURCES[key];
    report(store.acceptErrand("buy", `Collect 1 ${spec.short}`,
      `${store.marketBuyPrice(key)} ${CURRENCY_CODE} on collection at the Civic Works Depot`,
      { resource: key, quantity: 1 }));
  }
  else if (action === "errand-contract") {
    const contract = store.state.activeContract;
    if (!contract) report({ ok: false, message: "You have no order in hand." });
    else report(store.acceptErrand("contract", `Deliver ${contract.quantity} ${RESOURCES[contract.resource as ResourceKey].short}`,
      `${formatNumber(contract.grossReward)} ${CURRENCY_CODE} filed at Sunspire City Hall`, {}));
  }
  else if (action === "errand-market-buy") {
    const listing = makerListings.find((entry) => entry.id === button.dataset.listing);
    if (listing) {
      const spec = RESOURCES[listing.itemKey as ResourceKey];
      report(store.acceptErrand("market-buy", `Collect ${listing.quantity} ${spec.short}`,
        `${formatNumber(listing.total)} ${CURRENCY_CODE} on collection at the Tidegate Transit Hall`,
        { listingId: listing.id }));
    }
  }
  else if (action === "errand-market-list") {
    const item = listingDraft.item;
    if (item) {
      report(store.acceptErrand("market-list", `Consign ${listingDraft.quantity} ${RESOURCES[item].short}`,
        `Onto the shared market, from the Tidegate Transit Hall`, { resource: item }));
    }
  }
  else if (action === "errand-sell-product") {
    const id = button.dataset.product ?? "";
    const made = store.productsMade().find((entry) => entry.id === id);
    report(store.acceptErrand("product", `Ship ${made ? made.name : "goods"}`,
      `${made ? formatNumber(made.price) : ""} ${CURRENCY_CODE} on loading at the Tidegate Transit Hall`,
      { product: id }));
  }
  else if (action === "interior-build") {
    // The panel is a TRAY now, not furniture. Closed, the room runs edge to edge; the Build
    // button opens it, and from it a player presses-and-drags a machine or a fitting straight
    // onto any tile of the floor. It closes itself when a drag begins, because the thing in
    // hand is the point and the tray is done.
    const grid = element("#interiorGrid");
    const open = grid.classList.toggle("tray-open");
    button.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) renderInterior();
    if (interiorOpen) interiorWorld.resize();
  }
  else if (action === "interior-move") {
    const key = button.dataset.upgrade as UpgradeKey;
    element("#interiorGrid").classList.remove("tray-open");
    if (interiorOpen) interiorWorld.resize();
    interiorWorld.beginPlacement(key, "station");
    toast(`Drag ${UPGRADE_NAMES[key].name} onto a tile, then release.`);
  }
  else if (action === "fitting-place") {
    const key = button.dataset.fitting as FittingKey;
    const spec = FITTINGS[key];
    element("#interiorGrid").classList.remove("tray-open");
    if (interiorOpen) interiorWorld.resize();
    interiorWorld.beginPlacement(key, "fitting");
    toast(`Drop the ${spec.name} beside your ${UPGRADE_NAMES[spec.serves].name} — anywhere else and it does nothing.`);
  }
  else if (action === "errand-drop") report(store.abandonErrand());
  else if (action === "errand-settle") void settleErrand();
  else if (action === "buy") {
    const key = button.dataset.resource as ResourceKey;
    void tradeThroughRealm("buy", key, 1).then((handled) => { if (!handled) report(store.buyResource(key)); });
  }
  else if (action === "sell") {
    const key = button.dataset.resource as ResourceKey;
    void tradeThroughRealm("sell", key, 1).then((handled) => { if (!handled) report(store.sellResource(key)); });
  }
  else if (action === "make-product") report(store.makeProduct(button.dataset.product ?? ""));
  else if (action === "buy-inputs") report(store.buyMissingInputs(button.dataset.product ?? ""));
  else if (action === "interior-turn") {
    report(store.rotateEquipment(button.dataset.upgrade as UpgradeKey));
    interiorWorld.setFacings(store.state.equipmentFacing);
    publishBusiness();
    renderInterior();
  }
  else if (action === "sell-product") report(store.sellProduct(button.dataset.product ?? ""));
  else if (action === "claim-epoch") void claimEpoch();
  else if (action === "withdraw-chain") void withdrawToWallet();
  else if (action === "buy-deed") report(store.purchaseDeed());
  else if (action === "buy-sponsor") report(store.purchaseSponsorship());
  else if (action === "buy-charter") report(store.purchaseCharter());
  else if (action === "deposit-max") {
    depositAmount = Math.max(1, Math.floor(chainMM ?? depositAmount));
    renderUtilityDrawer();
  }
  else if (action === "convert-max") { convertAmount = 0; renderAll(); }
  else if (action === "buy-mm") {
    // Two steps on purpose. The transfer is REAL the moment the chain accepts it, so the
    // signature is captured before anything else can fail — a credit that does not land
    // here is still claimable, and the manual box below exists for exactly that.
    const label = button.textContent;
    button.disabled = true;
    button.textContent = "Approve it in your wallet\u2026";
    void purchaseMM(depositAmount)
      .then(async ({ signature }) => {
        toast("Sent. Waiting for Solana to finalise it\u2026");
        // Finalisation takes a few seconds; the authority refuses anything unrooted, so
        // retry rather than making the player press again.
        for (let attempt = 0; attempt < 12; attempt += 1) {
          const outcome = await claimDeposit(signature);
          if (outcome.status === "ok") {
            // Deposit AND convert, in the one press. Leaving the player holding $MM they
            // then had to bring to a second desk was the whole complaint: nobody sends
            // real money to a treasury in order to own a receipt.
            // A deposit lands as $MM, and converting is a separate, deliberate press.
            //
            // It converted automatically here for one build, which was wrong in a way that
            // cost real money: exchangeMMForMercDollars credits state.wallet, but a signed-in
            // player with a business spends from serverWallet — purse() is
            // `serverWallet ?? state.wallet` — and the authority never learns about a local
            // credit (server/src/deposit.ts writes mm_deposit and never touches
            // currency_account). So a real transfer became MERCS the player could not see or
            // spend, and the only way back cost ~11% of the deposit.
            //
            // Converting on deposit is still the right shape; it needs the AUTHORITY to issue
            // the MERCS in the same transaction that records the deposit. Until it does, the
            // $MM stays $MM: visible, spendable on deeds and charters, and withdrawable.
            // The AUTHORITY converts now, inside the transaction that records the deposit
            // (server/src/deposit.ts). It reports what it issued; the client only tells the
            // player. Units it could not convert stay $MM and come back in totalDeposited.
            const issued = outcome.value.mercs ?? 0;
            store.setDepositedMM(outcome.value.totalDeposited);
            depositDesk = await fetchDepositDesk();
            chainMM = principal ? await fetchChainMM(principal.walletAddress) : chainMM;
            // The MERCS landed in the authority's ledger, so re-read the purse or the HUD
            // shows the old number until the 30s refresh.
            await refreshMakerMarket();
            toast(issued > 0
              ? `${formatNumber(outcome.value.units)} $MM in — ${formatNumber(issued)} ${CURRENCY_CODE} added.`
              : `${formatNumber(outcome.value.units)} $MM is in the city, held as $MM. Convert it when the bank has room.`);
            renderAll();
            return;
          }
          if (outcome.status === "refused" && outcome.code !== "not-final") { toast(outcome.message); return; }
          await new Promise((resolve) => window.setTimeout(resolve, 2_500));
        }
        toast("It is on-chain but still finalising. Open this panel again shortly and it will credit.");
      })
      .catch((error: Error) => toast(error.message))
      .finally(() => { button.disabled = false; if (label) button.textContent = label; });
  }
  else if (action === "copy-treasury") {
    void navigator.clipboard?.writeText(button.dataset.address ?? "")
      .then(() => toast("Treasury address copied."))
      .catch(() => toast("Could not copy — select the address and copy it by hand."));
  }
  else if (action === "claim-deposit") {
    const field = document.querySelector<HTMLInputElement>("#depositSignature");
    const signature = (field?.value ?? "").trim();
    if (!signature) { toast("Paste the transaction signature first."); return; }
    button.disabled = true;
    void claimDeposit(signature).then(async (outcome) => {
      if (outcome.status === "ok") {
        const { units, alreadyCredited, totalDeposited } = outcome.value;
        toast(alreadyCredited
          ? `That transfer was already credited — ${formatNumber(units)} $MM.`
          : `Credited ${formatNumber(units)} $MM. You have brought in ${formatNumber(totalDeposited)}.`);
        if (field) field.value = "";
        // The in-game balance the bank converts. Deposits are the authority's record, so
        // take its figure rather than adding to a local one.
        store.setDepositedMM(totalDeposited);
        depositDesk = await fetchDepositDesk();
        renderAll();
      } else if (outcome.status === "refused") toast(outcome.message);
      else toast("Mercedonia could not be reached. Your transfer is safe — try again.");
    }).finally(() => { button.disabled = false; });
  }
  else if (action === "bank-in") { report(store.exchangeMMForMercDollars(convertAsked())); convertAmount = 0; }
  else if (action === "bank-out") report(store.exchangeMercDollarsForMM(redeemableMercs()));
  // Bank and News are panels now, not a side drawer: one place to look for each thing.
  else if (action === "utility-open") switchTab(button.dataset.utility === "bank" ? "bank" : "city");
  else if (action === "utility-close") closeUtilityDrawer();
  else if (action === "business-drawer-toggle") {
    if (businessDrawer.dataset.open === "true") closeBusinessDrawer(); else openBusinessDrawer();
  }
  else if (action === "business-drawer-close") closeBusinessDrawer();
  else if (action === "info-open") { infoTab = "you"; switchTab("info"); renderInfo(); }
  else if (action === "profile-open") { infoTab = "you"; switchTab("info"); renderInfo(); }
  else if (action === "dispatch-refresh") { dispatchLoaded = false; renderUtilityDrawer(); void refreshDispatch(); }
  else if (action === "repair") report(store.repairBreakdown());
  else if (action === "restore-supply") report(store.restoreSupply());
  else if (action === "hire") report(store.hireStaff());
  else if (action === "release") report(store.releaseStaff());
  else if (action === "switch-business") report(store.switchBusiness(button.dataset.plot ?? ""));
  else if (action === "marker" && button.dataset.plot === "order") {
    const active = store.state.activeContract;
    if (active && store.state.inventory[active.resource] >= active.quantity) report(store.fulfillContract());
    else if (!active) { const offer = store.bestOffer(); if (offer) report(store.acceptContract(offer.id)); switchTab("trade"); }
    else switchTab("orders");
  }
  else if (action === "taxi-close") { hailedTaxi = null; renderTaxi(); }
  else if (action === "taxi-call") { hailedTaxi = -1; taxiFilter = ""; renderTaxi(); }
  else if (action === "taxi-go") {
    const result = store.rideToPoint(Number(button.dataset.x ?? 0), Number(button.dataset.z ?? 0), button.dataset.label ?? "your stop");
    report(result);
    if (result.ok) { hailedTaxi = null; taxiFilter = ""; world.teleportToState(store.state); renderAll(); }
  }
  else if (action === "counter-close") { counterOpenFor = null; renderCounterPrompt(); renderErrandPill(); }
  else if (action === "ride") report(store.rideTo(button.dataset.to ?? "treasury"));
  else if (action === "info-tab") { infoTab = (button.dataset.info as typeof infoTab) ?? "you"; renderInfo(); }
  else if (action === "mayor-toggle") { store.setMayorHidden(!store.state.mayorHidden); renderAll(); }
  else if (action === "market-pick") { listingDraft.item = button.dataset.resource as ResourceKey; renderMakerMarket(); }
  else if (action === "market-qty") { listingDraft.quantity = Number(button.dataset.quantity ?? 10); renderMakerMarket(); }
  else if (action === "market-markup") { listingDraft.markup = Number(button.dataset.markup ?? 0); renderMakerMarket(); }
  else if (action === "market-list") void placeMakerListing();
  else if (action === "market-buy") void takeMakerListing(button.dataset.listing ?? "");
  else if (action === "market-cancel") void withdrawMakerListing(button.dataset.listing ?? "");
  else if (action === "marker" && button.dataset.plot === "market") switchTab("orders");
  else if (action === "marker" && (button.dataset.plot ?? "").startsWith("civic-")) {
    const civic = CIVIC_BUILDINGS.find((entry) => `civic-${entry.id}` === button.dataset.plot);
    switchTab(civic?.opens ?? "trade");
  }
  else if (action === "marker" && button.dataset.plot === "event") switchTab("map");
  else if (action === "marker") {
    const plotId = button.dataset.plot ?? "";
    if (store.state.portfolio[plotId]) { if (plotId !== store.state.ownedPlotId) store.switchBusiness(plotId); }
    else store.selectPlot(plotId);
    switchTab("business");
    openSheet();
  }
  else if (action === "gate-demo") { serverWallet = null; store.startDemoSession(); closeBootGate(); toast("Demo: nothing here is saved, and the shared market is closed."); }
  else if (action === "gate-connect") {
    // Remember the pick BEFORE signIn(), which resolves the provider from it.
    if (button.dataset.wallet) chooseWallet(button.dataset.wallet);
    // A demo is never promoted in place. Signing in from one would carry the demo's city
    // into the real account — a player would "keep" a city that was never theirs, and the
    // sealed session would quietly become an unsealed one. Reload instead, so the real
    // flow starts from a clean state and whatever profile this browser already holds.
    if (isDemo()) { window.location.reload(); return; }
    // Say something immediately. The authority sleeps when idle and its first response can
    // take fifteen seconds or more; with no pending state and no timeout, a player who has
    // signed in their wallet just watches a dead button and reasonably concludes it is broken.
    const label = button.textContent;
    button.disabled = true;
    button.textContent = "Waking Mercedonia\u2026";
    signIn().then((who) => { principal = who; closeBootGate(); toast(`Signed in as ${who.walletAddress.slice(0, 4)}…${who.walletAddress.slice(-4)}`); return refreshWallet(); })
      .catch((error: Error) => toast(error.message))
      .finally(() => { button.disabled = false; if (label) button.textContent = label; });
  }
  else if (action === "wallet-connect") {
    const linkLabel = button.textContent;
    button.disabled = true;
    button.textContent = "Waking Mercedonia\u2026";
    signIn().then((who) => { principal = who; toast(`Wallet linked: ${who.walletAddress.slice(0, 4)}…${who.walletAddress.slice(-4)}`); return refreshWallet(); })
      .catch((error: Error) => toast(error.message))
      .finally(() => { button.disabled = false; if (linkLabel) button.textContent = linkLabel; });
  }
  else if (action === "wallet-disconnect") {
    void flushCloudSave().then(() => signOut()).then(() => {
      principal = null; standing = null; serverWallet = null; withdrawalDesk = null; makerHoldings = {};
      // Forget the queue AND the fact a restore happened, so signing in as somebody else
      // cannot push this player's city up under the next player's name.
      resetCloudSave();
      cloudRestoreDone = false;
      toast("Wallet unlinked."); renderAll();
    });
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
  else if (action === "goto") gotoPanel(button.dataset.panel ?? "");
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

// Typing an amount must NOT re-render: this app rebuilds its markup on every state
// change, which would replace the input under the caret on each keystroke. So the value
// is captured and only the two labels that depend on it are rewritten in place.
document.body.addEventListener("input", (event) => {
  const field = (event.target as HTMLElement | null)?.closest<HTMLInputElement>("input[data-action]");
  if (!field) return;
  const typed = Math.max(0, Math.floor(Number(field.value) || 0));

  if (field.dataset.action === "deposit-amount") {
    const held = chainMM === null ? typed : Math.floor(chainMM);
    depositAmount = Math.min(typed, held);
    const worth = document.querySelector("#depositWorth");
    if (worth) worth.textContent = `= ${formatNumber(store.mercDollarsForMM(depositAmount))} ${CURRENCY_CODE}, credited on arrival`;
    const buy = document.querySelector<HTMLButtonElement>('[data-action="buy-mm"]');
    if (buy) {
      buy.disabled = depositAmount < 1 || depositAmount > held;
      const label = buy.querySelector("span");
      const note = buy.querySelector("small");
      if (label) label.textContent = `Send ${formatNumber(depositAmount)} $MM`;
      if (note) {
        note.textContent = depositAmount < 1 ? "Enter an amount"
          : depositAmount > held ? `You hold ${formatNumber(held)} $MM`
            : `Receive ${formatNumber(store.mercDollarsForMM(depositAmount))} ${CURRENCY_CODE}`;
      }
    }
    return;
  }

  if (field.dataset.action === "taxi-filter") {
    taxiFilter = field.value;
    const list = document.querySelector("#taxiStops");
    if (list) list.innerHTML = taxiStopsMarkup();
    return;
  }

  if (field.dataset.action === "convert-amount") {
    convertAmount = Math.min(typed, convertibleMM());
    const asked = convertAsked();
    for (const worth of document.querySelectorAll("[data-convert-worth]")) {
      worth.textContent = `= ${formatNumber(store.mercDollarsForMM(asked))} ${CURRENCY_CODE}`;
    }
    for (const label of document.querySelectorAll('[data-action="bank-in"] span')) {
      label.textContent = asked >= 1 ? `Convert ${formatNumber(asked)} $MM` : "Convert your $MM";
    }
  }
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
