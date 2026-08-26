import { HIGHLANDS_DISTRICTS, HIGHLANDS_PLOTS } from "./highlandsWorld";

export type ResourceKey = "water" | "power" | "ore" | "timber" | "food" | "crate" | "part" | "equipment" | "material" | "supply" | "waste";
export type LicenseKey = "aquaworks" | "sungrid" | "greenhouse" | "mine" | "timberworks" | "cratemill" | "workshop" | "factory" | "construction" | "freight" | "shop" | "restaurant" | "gym" | "cinema" | "recycler";
export type UpgradeKey = "yield" | "capacity" | "speed" | "appeal";
export type SpecializationKey = "efficient" | "premium" | "community";
export type BusinessStage = "Infrastructure" | "Primary" | "Manufacturing" | "Commerce" | "Services" | "Circular";

export interface ResourceConfig {
  name: string; short: string; icon: string; governmentPrice: number; procurementPrice: number; color: string;
  buyer: "government" | "citizens"; tier: "civic" | "raw" | "intermediate" | "capital" | "consumer" | "recovered";
  volatility: number; indexWeight: number; civicSupply?: boolean;
}

export interface BusinessConfig {
  name: string; sector: string; stage: BusinessStage; islandAffinity: string; icon: string; color: string; model: string; copy: string;
  duration: number; licenseCost: number; laborCost: number;
  inputs: Partial<Record<ResourceKey, number>>; output: Partial<Record<ResourceKey, number>>; wastePerCycle?: number;
  servicePayout?: number; baseVisitors?: number; priceElasticity?: number; starter: Partial<Record<ResourceKey, number>>;
  ecosystem: { upstream: string; process: string; downstream: string };
}

export interface PlotConfig {
  id: string;
  name: string;
  island: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  price: number;
  customerEdge: "N" | "E" | "S" | "W";
}
export interface IslandConfig { id: string; name: string; district: string; x: number; z: number; radius: number; spawnX: number; spawnZ: number; color: string; economy: string; }

export interface SpecializationConfig {
  name: string; icon: string; color: string; summary: string; tradeoff: string;
}

export const RESOURCES: Record<ResourceKey, ResourceConfig> = {
  water: { name: "Water Credit", short: "Water", icon: "≈", governmentPrice: 6, procurementPrice: 3, color: "#43b7c1", buyer: "government", tier: "civic", volatility: .08, indexWeight: 12 },
  power: { name: "Power Credit", short: "Power", icon: "ϟ", governmentPrice: 8, procurementPrice: 4, color: "#efb84d", buyer: "government", tier: "civic", volatility: .1, indexWeight: 14 },
  ore: { name: "Raw Mineral", short: "Mineral", icon: "◆", governmentPrice: 14, procurementPrice: 10, color: "#8a7b68", buyer: "government", tier: "raw", volatility: .16, indexWeight: 8 },
  timber: { name: "Regrown Timber", short: "Timber", icon: "▤", governmentPrice: 13, procurementPrice: 9, color: "#9a754d", buyer: "government", tier: "raw", volatility: .14, indexWeight: 7 },
  food: { name: "Fresh Produce", short: "Food", icon: "♧", governmentPrice: 15, procurementPrice: 12, color: "#79a94d", buyer: "citizens", tier: "consumer", volatility: .18, indexWeight: 14 },
  crate: { name: "Material Crate", short: "Crates", icon: "▣", governmentPrice: 22, procurementPrice: 17, color: "#c98a53", buyer: "government", tier: "intermediate", volatility: .13, indexWeight: 7 },
  part: { name: "Utility Part", short: "Parts", icon: "⚙", governmentPrice: 48, procurementPrice: 40, color: "#617785", buyer: "government", tier: "intermediate", volatility: .14, indexWeight: 10 },
  equipment: { name: "Capital Equipment", short: "Equipment", icon: "⚒", governmentPrice: 86, procurementPrice: 72, color: "#447a82", buyer: "government", tier: "capital", volatility: .12, indexWeight: 8 },
  material: { name: "Building Module", short: "Modules", icon: "▦", governmentPrice: 58, procurementPrice: 48, color: "#c27452", buyer: "government", tier: "capital", volatility: .12, indexWeight: 7 },
  supply: { name: "Retail Supply", short: "Supplies", icon: "◈", governmentPrice: 25, procurementPrice: 20, color: "#a975a7", buyer: "citizens", tier: "consumer", volatility: .2, indexWeight: 11 },
  waste: { name: "Recoverable Scrap", short: "Scrap", icon: "♻", governmentPrice: 12, procurementPrice: 4, color: "#74875d", buyer: "government", tier: "recovered", volatility: .06, indexWeight: 2 },
};

export const BUSINESS: Record<LicenseKey, BusinessConfig> = {
  aquaworks: {
    name: "Tideglass AquaWorks", sector: "Water utility", stage: "Infrastructure", islandAffinity: "Tideglass", icon: "≈", color: "#4eaeb7", model: "./assets/structures/b04-aquaworks.glb",
    copy: "Purifies and distributes water credits used by homes, farms, mines and service businesses.", duration: 18, licenseCost: 20, laborCost: 8,
    inputs: { power: 1, part: 1 }, output: { water: 36 }, starter: { power: 1, part: 1 },
    ecosystem: { upstream: "SunGrid and workshops", process: "Purification and distribution", downstream: "Farms, mines, factories and Mercedonians" },
  },
  sungrid: {
    name: "Sunwell Microgrid", sector: "Energy utility", stage: "Infrastructure", islandAffinity: "Sunwell", icon: "☀", color: "#dda942", model: "./assets/structures/b03-sungrid-utility.glb",
    copy: "Operates a renewable microgrid that powers every productive and public-facing business.", duration: 20, licenseCost: 25, laborCost: 9,
    inputs: { part: 1, material: 1 }, output: { power: 49 }, starter: { part: 1, material: 1 },
    ecosystem: { upstream: "Workshops and builders", process: "Generation and storage", downstream: "Every island industry" },
  },
  greenhouse: {
    name: "Greenloom Greenhouse", sector: "Food and bio-production", stage: "Primary", islandAffinity: "Greenloom", icon: "♧", color: "#70a958", model: "./assets/structures/b05-canopy-greenhouse.glb",
    copy: "Turns water and power into fresh food for markets, cafés, restaurants and households.", duration: 16, licenseCost: 20, laborCost: 9,
    inputs: { water: 2, power: 1 }, output: { food: 4 }, wastePerCycle: 1, starter: { water: 2, power: 1 },
    ecosystem: { upstream: "AquaWorks and SunGrid", process: "Controlled growing", downstream: "Shops, restaurants and Mercedonians" },
  },
  mine: {
    name: "Stonewake Mine", sector: "Mineral extraction", stage: "Primary", islandAffinity: "Stonewake", icon: "◆", color: "#8d806d", model: "./assets/structures/b09-stonewake-mine.glb",
    copy: "Extracts mineral feedstock for workshops, equipment factories and civic construction.", duration: 20, licenseCost: 25, laborCost: 11,
    inputs: { part: 1, power: 2, water: 1 }, output: { ore: 14 }, wastePerCycle: 1, starter: { part: 1, power: 2, water: 1 },
    ecosystem: { upstream: "Parts, SunGrid and AquaWorks", process: "Low-impact extraction", downstream: "Workshops and factories" },
  },
  timberworks: {
    name: "Timbercoast Works", sector: "Regenerative forestry", stage: "Primary", islandAffinity: "Greenloom", icon: "▤", color: "#9a754d", model: "./assets/structures/b10-timbercoast-works.glb",
    copy: "Produces traceable timber for packaging, construction modules and public works.", duration: 18, licenseCost: 22, laborCost: 10,
    inputs: { part: 1, power: 1, water: 1 }, output: { timber: 14 }, wastePerCycle: 1, starter: { part: 1, power: 1, water: 1 },
    ecosystem: { upstream: "Utilities and repair shops", process: "Regrowth and milling", downstream: "Crate mills and builders" },
  },
  cratemill: {
    name: "Freight Crate Mill", sector: "Packaging", stage: "Manufacturing", islandAffinity: "Copper Quay", icon: "▣", color: "#c88a50", model: "./assets/structures/b11-freight-crate-mill.glb",
    copy: "Converts timber into standardized crates that make the island supply chain move.", duration: 14, licenseCost: 22, laborCost: 8,
    inputs: { timber: 2, power: 1 }, output: { crate: 4 }, wastePerCycle: 1, starter: { timber: 2, power: 1 },
    ecosystem: { upstream: "Timberworks and SunGrid", process: "Reusable packaging", downstream: "Workshops, shops and freight" },
  },
  workshop: {
    name: "Maker Workshop", sector: "Component manufacturing", stage: "Manufacturing", islandAffinity: "Kilnrise", icon: "M", color: "#df8465", model: "./assets/structures/b06-maker-workshop.glb",
    copy: "Turns mineral and packaging inputs into utility parts required by every growing enterprise.", duration: 16, licenseCost: 28, laborCost: 11,
    inputs: { ore: 2, crate: 1, power: 1 }, output: { part: 3 }, wastePerCycle: 1, starter: { ore: 2, crate: 1, power: 1 },
    ecosystem: { upstream: "Mines, crate mills and SunGrid", process: "Precision assembly", downstream: "Utilities, factories and logistics" },
  },
  factory: {
    name: "Mercedonian Factory", sector: "Capital equipment", stage: "Manufacturing", islandAffinity: "Kilnrise", icon: "F", color: "#cc7652", model: "./assets/structures/b12-mercedonian-factory.glb",
    copy: "Produces machinery that expands capacity across construction, utilities and public services.", duration: 24, licenseCost: 45, laborCost: 16,
    inputs: { ore: 3, part: 1, power: 2, water: 1 }, output: { equipment: 3 }, wastePerCycle: 2, starter: { ore: 3, part: 1, power: 2, water: 1 },
    ecosystem: { upstream: "Mining, workshops and utilities", process: "Equipment fabrication", downstream: "Builders and business upgrades" },
  },
  construction: {
    name: "Civic Construction Co.", sector: "Building systems", stage: "Manufacturing", islandAffinity: "Hearthmarket", icon: "▦", color: "#b46f4f", model: "./assets/structures/b13-civic-construction.glb",
    copy: "Combines timber, parts and equipment into modular upgrades for plots and infrastructure.", duration: 26, licenseCost: 45, laborCost: 18,
    inputs: { timber: 2, part: 2, equipment: 1 }, output: { material: 8 }, wastePerCycle: 1, starter: { timber: 2, part: 2, equipment: 1 },
    ecosystem: { upstream: "Timber, workshops and factories", process: "Modular construction", downstream: "Utilities, plots and public works" },
  },
  freight: {
    name: "Copper Quay Freight", sector: "Logistics service", stage: "Commerce", islandAffinity: "Copper Quay", icon: "↔", color: "#b68758", model: "./assets/structures/b01-ferry-terminal.glb",
    copy: "Fulfils delivery contracts and turns physical production into dependable island-wide trade.", duration: 14, licenseCost: 25, laborCost: 10,
    inputs: { crate: 1, part: 1, power: 2 }, output: {}, servicePayout: 29, baseVisitors: 4, priceElasticity: .8, starter: { crate: 1, part: 1, power: 2 },
    ecosystem: { upstream: "Crate mills, workshops and energy", process: "Storage and delivery", downstream: "Every buyer and seller" },
  },
  shop: {
    name: "Supply Shop & Café", sector: "Retail production", stage: "Commerce", islandAffinity: "Lantern Row", icon: "S", color: "#b886c6", model: "./assets/structures/b07-starter-shop-cafe.glb",
    copy: "Packages food, parts and crates into consumer supplies purchased by Mercedonians and services.", duration: 14, licenseCost: 25, laborCost: 10,
    inputs: { food: 2, crate: 1, part: 1, power: 1 }, output: { supply: 10 }, wastePerCycle: 1, starter: { food: 2, crate: 1, part: 1, power: 1 },
    ecosystem: { upstream: "Greenhouses, workshops and logistics", process: "Packing and merchandising", downstream: "Mercedonians, gyms and cinemas" },
  },
  restaurant: {
    name: "Sunset Market Kitchen", sector: "Hospitality service", stage: "Services", islandAffinity: "Lantern Row", icon: "R", color: "#d47d5b", model: "./assets/structures/b14-market-kitchen.glb",
    copy: "Serves price-sensitive Mercedonian demand and turns local food into district footfall.", duration: 13, licenseCost: 28, laborCost: 12,
    inputs: { food: 2, supply: 1, water: 1, power: 1 }, output: {}, wastePerCycle: 1, servicePayout: 15, baseVisitors: 8, priceElasticity: 1.4, starter: { food: 2, supply: 1, water: 1, power: 1 },
    ecosystem: { upstream: "Greenhouses, shops and utilities", process: "Hospitality and dining", downstream: "Mercedonians and district demand" },
  },
  gym: {
    name: "Harbor Gym", sector: "Wellness service", stage: "Services", islandAffinity: "Pulsegrove", icon: "H", color: "#4d9487", model: "./assets/structures/b08-harbor-gym.glb",
    copy: "Consumes supplies and utilities to serve Mercedonians; equipment and appeal increase attendance.", duration: 12, licenseCost: 30, laborCost: 11,
    inputs: { supply: 1, water: 1, power: 1 }, output: {}, servicePayout: 14, baseVisitors: 5, priceElasticity: 1.15, starter: { supply: 1, water: 1, power: 1 },
    ecosystem: { upstream: "Retail, water and power", process: "Training and recovery", downstream: "Healthy workers and local demand" },
  },
  cinema: {
    name: "Lantern Cinema", sector: "Entertainment service", stage: "Services", islandAffinity: "Lantern Row", icon: "C", color: "#d39a45", model: "./assets/structures/b15-lantern-cinema.glb",
    copy: "Runs screenings and events; ticket price, quality and appeal determine audience demand.", duration: 18, licenseCost: 35, laborCost: 13,
    inputs: { supply: 2, power: 2 }, output: {}, servicePayout: 12, baseVisitors: 9, priceElasticity: 1.35, starter: { supply: 2, power: 2 },
    ecosystem: { upstream: "Retailers and SunGrid", process: "Screenings and concessions", downstream: "Watchers and nightlife" },
  },
  recycler: {
    name: "Tideglass Reclamation Hub", sector: "Resource recovery", stage: "Circular", islandAffinity: "Tideglass", icon: "♻", color: "#718c62", model: "./assets/structures/b16-reclamation-hub.glb",
    copy: "Closes the material loop by recovering useful parts and building modules from business scrap.", duration: 20, licenseCost: 35, laborCost: 12,
    inputs: { waste: 3, power: 1 }, output: { material: 1, part: 1 }, starter: { waste: 3, power: 1 },
    ecosystem: { upstream: "Every producing business", process: "Sorting and remanufacture", downstream: "Construction, utilities and repairs" },
  },
};

export const BUSINESS_STAGES: BusinessStage[] = ["Infrastructure", "Primary", "Manufacturing", "Commerce", "Services", "Circular"];

export const UPGRADE_NAMES: Record<UpgradeKey, { name: string; icon: string; effect: string }> = {
  yield: { name: "Production Quality", icon: "⚒", effect: "+12% output quality or service throughput per level" },
  capacity: { name: "Operating Capacity", icon: "▦", effect: "+1 complete recipe cycle per job per level" },
  speed: { name: "Automation & Flow", icon: "ϟ", effect: "12% shorter jobs per level" },
  appeal: { name: "Customer Appeal", icon: "✦", effect: "+15% demand and improved procurement terms per level" },
};

export const UPGRADE_COSTS: Array<{ mercDollars: number; resources: Partial<Record<ResourceKey, number>> }> = [
  { mercDollars: 0, resources: {} },
  { mercDollars: 70, resources: { crate: 1, part: 1 } },
  { mercDollars: 150, resources: { part: 2, equipment: 1, supply: 1 } },
  { mercDollars: 280, resources: { part: 3, equipment: 2, material: 2 } },
  { mercDollars: 520, resources: { part: 4, equipment: 3, material: 3, supply: 2 } },
];

export const SPECIALIZATIONS: Record<SpecializationKey, SpecializationConfig> = {
  efficient: {
    name: "Lean Operations", icon: "ϟ", color: "#3d8f87",
    summary: "Jobs finish 10% faster through better scheduling and energy management.",
    tradeoff: "Improves turnover rather than output quality.",
  },
  premium: {
    name: "Quality House", icon: "✦", color: "#b9823d",
    summary: "Produces 10% more goods and improves service demand through trusted quality.",
    tradeoff: "Receives no speed or reputation bonus.",
  },
  community: {
    name: "Community Enterprise", icon: "◎", color: "#6b8f55",
    summary: "Employs more residents, attracts 15% more visitors and earns reputation faster.",
    tradeoff: "Payroll is 10% higher and returns more income to Mercedonian households.",
  },
};

/**
 * The career ladder.
 *
 * The last six rungs were added because the first six were measured, and they were over
 * far too quickly: a single-plot maker reached the old ceiling on day 21 and a player
 * running several reached it on day 8. After that the visible progression bar simply
 * stopped, which reads as "I have finished this" even though the game had months of
 * expansion left in it.
 *
 * The thresholds are not invented. A committed single-plot maker earns almost exactly 62
 * XP a day once running, and these are set against that measured curve: level 7 lands
 * around day 30, level 9 around day 60, and the last rung around day 180. Somebody
 * operating a portfolio climbs it several times faster, which is the point — they are
 * playing several times as much game.
 */
export const CAREER_LEVELS = [
  { level: 1, name: "New Maker", xp: 0 },
  { level: 2, name: "Licensed Operator", xp: 80 },
  { level: 3, name: "Local Proprietor", xp: 220 },
  { level: 4, name: "District Supplier", xp: 450 },
  { level: 5, name: "Regional Founder", xp: 800 },
  { level: 6, name: "Mercedonian Industrialist", xp: 1_300 },
  { level: 7, name: "Trade Principal", xp: 1_900 },
  { level: 8, name: "Civic Benefactor", xp: 2_800 },
  { level: 9, name: "Guildmaster", xp: 3_800 },
  { level: 10, name: "Steward of the Commons", xp: 5_600 },
  { level: 11, name: "Realm Architect", xp: 7_500 },
  { level: 12, name: "Name in the Charter", xp: 11_000 },
] as const;

export const DAILY_GOALS = { jobs: 2, contracts: 1, trades: 2, reward: 80, xp: 30 } as const;
export const PROCUREMENT_BASE_QUOTA = 12;
/** Plots a player may hold at once, raised by civic standing. */
export const BASE_PLOT_ALLOWANCE = 1;
export const PLOTS_PER_CAREER_LEVEL = 0.5;

export const ISLANDS: IslandConfig[] = HIGHLANDS_DISTRICTS.map((district) => ({ ...district }));

export const PLOTS: PlotConfig[] = HIGHLANDS_PLOTS.map((plot) => ({ ...plot }));

/**
 * How busy a plot's corner is, from 0 to 1, derived from the district's own geography.
 *
 * Pure and deterministic: no world, no camera, no avatar. That is what lets the same
 * number decide who citizens walk to on screen AND settle trade while the player is
 * away and nothing is being rendered at all.
 */
export function plotFootfall(plotId: string): number {
  const plot = PLOTS.find((entry) => entry.id === plotId);
  if (!plot) return 0;
  const landmarks = CIVIC_BUILDINGS.filter((entry) => entry.island === plot.island);
  if (landmarks.length === 0) return FOOTFALL_FLOOR;

  // The nearest landmark carries most of it: a shop beside the City Hall sees the queue.
  const nearest = Math.min(...landmarks.map((entry) => Math.hypot(plot.x - entry.x, plot.z - entry.z)));
  const proximity = Math.max(0, 1 - nearest / FOOTFALL_LANDMARK_REACH);

  // Plus a smaller term for sitting among several of them rather than out on a limb.
  const cluster = landmarks.reduce((total, entry) => {
    const distance = Math.hypot(plot.x - entry.x, plot.z - entry.z);
    return total + Math.max(0, 1 - distance / (FOOTFALL_LANDMARK_REACH * 2));
  }, 0) / landmarks.length;

  return Math.min(1, FOOTFALL_FLOOR + proximity * 0.62 + cluster * 0.38);
}

/**
 * The Mayor.
 *
 * First steps are a conversation with somebody who lives here, not a checklist. A new
 * maker needs two things from every step — what to do, and why this city works that way —
 * and the second is what turns a business sim from a sequence of buttons into a place with
 * rules you can reason about.
 */
export const MAYOR = {
  name: "Perenna Vale",
  title: "Mayor of Mercedonia",
  /** Said once, before the first step, when somebody has never played. */
  welcome: "Welcome to Mercedonia. I'm Perenna Vale — I run the place, which mostly means I keep the lights on and the wages paid.",
  /** Said when every step is done. */
  farewell: "You know the ropes now. The city's yours to argue with.",
} as const;

/**
 * What the Mayor says at each step, and the reason underneath it.
 *
 * `says` is the instruction in her voice. `because` is the economics — always true, and
 * always checkable in the game. Nothing here is flavour that the simulation does not
 * actually do.
 */
export const MAYOR_SCRIPT: Record<string, { says: string; because: string }> = {
  moved: {
    says: "Walk with me a moment. Click anywhere on the ground and your maker will head there.",
    because: "Everything here is within walking distance on purpose. A city works when people can reach each other.",
  },
  leased: {
    says: "Pick a corner and the registry will draw up a lease. The glowing plots are the ones going spare.",
    because: "Where you build decides who walks past your door, and passing trade is most of what you earn early on.",
  },
  licensed: {
    says: "Now — what will you make? Fifteen trades, and every one of them buys from another.",
    because: "There is no wrong first choice. Water and power sell to nearly everyone; a shop earns more but needs suppliers.",
  },
  built: {
    says: "Put the building up. The city will send an inspector, by which I mean it will send nobody.",
    because: "Nothing is produced until there is somewhere to produce it.",
  },
  produced: {
    says: "Buy what the recipe wants, pay your worker, and run a cycle.",
    because: "Wages are not a fee the city invented. Every Merc you pay walks back out into somebody's till — often enough, your own.",
  },
  upgraded: {
    says: "Put something better in the building. Yield for more per cycle, appeal for a bigger share of the district's custom.",
    because: "The shop will say plainly when a machine cannot help you yet. Believe it, and buy the other one.",
  },
  sold: {
    says: "Sell. The civic counter takes anything at a published price, and other makers will sometimes pay more.",
    because: "Prices follow what the district actually wants. Flood it and the price sags — that is the market answering, not a penalty.",
  },
  contracted: {
    says: "Take an order from the board. A named buyer pays better than the counter, every time.",
    because: "It counts for far more toward your weekly share too. It is the most valuable hour you can spend here.",
  },
  traveled: {
    says: "Go and see another district. There are nine of them, and 298 corners between them.",
    because: "A district with a working chain in it pays everyone in it more — you included. Neighbours are customers.",
  },
};

export const TUTORIAL = [
  ["moved", "Explore Hearthmarket", "Move with WASD, arrows, or click the world."],
  ["leased", "Lease a plot", "Select a glowing plot and sign a starter lease."],
  ["licensed", "Choose a business", "Pick one of fifteen connected roles across six economic stages."],
  ["built", "Build the business", "Place the existing 3D structure on your plot."],
  ["produced", "Run production", "Buy required inputs, pay labor and complete one job."],
  ["upgraded", "Improve the interior", "Install a yield, capacity, speed or appeal upgrade."],
  ["sold", "Earn Merc Dollars", "Sell an output or serve price-sensitive Mercedonian demand."],
  ["contracted", "Fulfill a trade contract", "Complete a public, commercial or household order from the Contracts Board."],
  ["traveled", "Use Transit Hall", "Fast-travel to another economic district in the connected world."],
] as const;

// --- Operating capacity now costs time: each extra batch adds 45% of the base duration.
export const CAPACITY_DURATION_STEP = 0.45;

// --- Civic and household demand soften instead of stopping dead. Each further tranche the
//     size of the daily quota clears at a lower price, never below the floor. A business can
//     therefore always run; it just earns less once it saturates local demand.
export const DEMAND_TRANCHE_DECAY = 0.72;
export const DEMAND_PRICE_FLOOR = 0.34;
// A district absorbs a VALUE of each good per day, not a unit count: 400 Merc Dollars of
// water is a lot of water and very little capital equipment. Unit quotas are derived.
export const CIVIC_DEMAND_BUDGET = 1_350;
export const CITIZEN_DEMAND_BUDGET = 1_750;
/** A district only has so many gym visits, dinners and screenings in a day. */
export const SERVICE_AUDIENCE_BUDGET = 260;

/**
 * A district spends more on the things that took more to make. Without this the flat
 * value budget hands every good the same daily revenue ceiling, and whoever has the
 * cheapest inputs wins by default.
 */
export const DEMAND_TIER_WEIGHT: Record<ResourceConfig["tier"], number> = {
  civic: 1, raw: 1.15, intermediate: 1.7, capital: 2.6, consumer: 1.05, recovered: .6,
};

/**
 * Derived demand: what the district's own businesses buy as INPUTS.
 *
 * Households and the civic buyer are not the only customers. A shop burns two food a
 * cycle, a cratemill two timber, a workshop two ore — every trade in the chain is a
 * standing customer for the trade above it. Until this existed the market could not see
 * any of that: a greenhouse's only buyer was a civic budget that saturated in a morning,
 * and the supply chain lived in the recipes without ever reaching the price of anything.
 *
 * Summed from BUSINESS itself rather than typed out, so it cannot drift from the recipes.
 */
export const CHAIN_DRAW: Record<ResourceKey, number> = (() => {
  const keys = Object.keys(RESOURCES) as ResourceKey[];
  const draw = {} as Record<ResourceKey, number>;
  for (const key of keys) draw[key] = 0;
  for (const config of Object.values(BUSINESS)) {
    for (const key of keys) draw[key] += config.inputs[key] ?? 0;
  }
  return draw;
})();

/**
 * Cycles a day the district's trades are assumed to run when nobody is watching them.
 * Deliberately modest: this is the floor of demand a lone maker can count on, not a
 * bustling city. Real neighbours are counted on top, which is what makes arriving in a
 * district with a working chain worth more than arriving in an empty one.
 */
export const CHAIN_CYCLES_PER_DAY = 26;

/** How many of each trade the district runs before any real player turns up. */
export const DISTRICT_BASE_TRADES = 1;

/** What one more real business in the district adds, as a share of a base trade. */
export const DISTRICT_NEIGHBOUR_WEIGHT = 0.5;

/**
 * How hard one trade moves a price, as a share of the good's volatility.
 *
 * Price impact used to be an absolute sqrt(amount) step, which was tuned for selling a
 * few units by hand and was ruinous under auto-production: eight food moved food the full
 * 28% to the clamp, so an ordinary day floored the price of the maker's own goods and the
 * profitability gate then correctly refused to produce anything ever again. Impact is now
 * measured against the depth of the market, which is also what makes cooperation pay —
 * every business that consumes a good deepens its market and lifts the price everyone gets.
 */
export const DEPTH_PRICE_IMPACT = 1.2;

/**
 * The most a hungry chain will pay over the reference price.
 *
 * A district whose businesses want a good pays more for it than one where only the civic
 * buyer does. This is the collaboration dividend, and it is the whole reason to WANT
 * neighbours rather than merely tolerate them: without it, extra demand only helps a maker
 * who is short of customers, and a maker who is short of hours — which is most of them —
 * felt nothing at all when the district filled up. Measured at 0.4% before this existed.
 */
export const CHAIN_PREMIUM_MAX = 0.35;

/** Most of a day's price shock has washed out by the next morning. */
export const MARKET_REVERSION_CAP = 0.6;

// --- Play-to-earn: $MM is EARNED from a budgeted per-epoch pool, never purchased.
//     Your payout is your share of the epoch budget, so a bigger grind dilutes rather
//     than extracts. See game/docs/ECONOMY_V2.md.
export const EPOCH_LENGTH_DAYS = 7;
/**
 * Emission is a SHARE of the remaining pool, not a fixed number.
 *
 * A fixed 60,000/week empties a 25,000,000 pool in eight years and then stops dead, and
 * per-player pay collapses as the realm grows — success punishing the people who built
 * it. A percentage draw decays geometrically and never reaches zero: at 0.3% a week the
 * pool still holds 5,200,000 $MM after ten years, while fee recycling grows with the
 * population and takes over as the dominant source.
 */
export const EPOCH_EMISSION_RATE = 0.003;
export const EPOCH_MM_FLOOR = 8_000;
/** Kept as the display reference for the first epoch. */
export const EPOCH_MM_BUDGET = 60_000;

/**
 * $MM must have somewhere to GO. Emission with no sink is pure sell pressure, which is
 * the single line every play-to-earn post-mortem ends on. A premium deed is bought with
 * $MM and a large share of it is destroyed, so growth is deflationary rather than merely
 * neutral.
 */
export const DEED_COST_MM = 250;

/**
 * The recurring sink matters most. A one-off purchase burns once; sponsorship is bought
 * again every week, which is what the model asked for — a premium spend priced near a
 * player's own weekly emission, so the flow balances instead of only accumulating.
 */
export const SPONSORSHIP_COST_MM = 80;
export const SPONSORSHIP_APPEAL = 0.6;

/** A permanent ceiling-raiser: the only way past level 3 on any equipment track. */
export const CHARTER_COST_MM = 600;
export const MAX_UPGRADE_LEVEL = 4;
export const MM_BURN_RATE = 0.4;
export const COHORT_CONTRIBUTION_BASE = 45_000;
/**
 * What each kind of sale is worth toward the $MM pool.
 *
 * `idle` is trade the business did while the player was away: real customers, real
 * goods off the shelf, so it earns real tokens — this is an idle game as well as an
 * active one, and a shop that ran all night did work the district needed. It sits
 * below `household` rather than level with it so that turning up and serving the
 * counter yourself is still the better day, and well below `contract`, which remains
 * the thing worth logging in for. What it is NOT is yield on holding: an idle player
 * earns because their business traded, and a plot with nothing built on it earns
 * nothing at all.
 */
export const CONTRIBUTION_WEIGHT = { contract: 1, household: 0.3, idle: 0.18, civic: 0.1, auto: 0.05 } as const;

// --- Footfall. A corner's busyness comes from the district's geography, not from where
//     the player happens to be standing, so siting a shop well is a decision that pays.
/** Even the quietest corner sees some passing trade. */
export const FOOTFALL_FLOOR = 0.08;
/** How far a civic landmark's queue spills onto neighbouring plots, in metres. */
export const FOOTFALL_LANDMARK_REACH = 55;
/** Customers an hour at a corner scoring 1.0, before appeal upgrades. */
export const OFFLINE_VISITS_PER_HOUR = 4;
/** Ceiling on a single catch-up, so a fortnight away cannot empty the citizens' pool. */
export const OFFLINE_VISIT_CAP = 90;


// ---------------------------------------------------------------------------
// Passive operations. The business runs on a clock; the player spends attention
// on decisions (contracts, upgrades, crises), not on execution.
//
// The design target is a once-a-day rhythm: roughly 24 hours of buffer before a
// warehouse fills or a breakdown halts the line. Nothing is lost by missing a
// day — you only give up throughput.
// ---------------------------------------------------------------------------

/** Absence longer than this stops accruing. Caps the faucet a long holiday would open. */
export const OFFLINE_MAX_HOURS = 26;

/**
 * Recipe durations are authored in prototype seconds. Real play runs on a clock:
 * a ~20 s recipe becomes ~80 minutes, so a day's demand takes a day to satisfy.
 * New operators get an accelerated opening so the first session is not a wait.
 */
export const PRODUCTION_TIME_SCALE = 240;
export const OPENING_JOBS = 6;
export const OPENING_TIME_SCALE = 0.12;
/** A first job must finish while the player is still watching, or they never see the loop close. */
export const OPENING_MAX_SECONDS = 40;

/** Warehouse units before production halts. This is the reason to come back. */
export const STORAGE_BASE_CAPACITY = 240;
export const STORAGE_PER_CAPACITY_LEVEL = 90;

/** The broker who sells for you while you are away keeps a cut, so trading by hand pays more. */
export const AUTO_SELL_BROKER_FEE = 0.07;
/** Buying inputs unattended pays a convenience premium over the civic counter price. */
export const AUTO_BUY_PREMIUM = 0.03;

/** Routine upkeep runs itself; it is the crisis that needs a person. */
export const AUTO_MAINTAIN_AT = 46;
export const AUTO_MAINTAIN_COST = 20;

/**
 * The broker refuses to dump. Below this fraction of a good's base price the
 * warehouse fills instead — which is the signal to come back and make a decision.
 */
export const BROKER_PRICE_FLOOR = 0.58;

/** Equipment failure: a crisis that needs a person, not a timer. */
export const BREAKDOWN_CONDITION = 18;
export const BREAKDOWN_REPAIR_COST = 60;
export const BREAKDOWN_REPAIR_PARTS = 2;

// ---------------------------------------------------------------------------
// District demand shocks.
//
// A shock raises the local price of ONE good on ONE island for a couple of days.
// It scales what the city pays AND what it charges, so a same-island round trip
// stays unprofitable exactly as before; the only way to profit is to bring the
// good in from somewhere else. That is spatial arbitrage — a merchant's job —
// and it is bounded by the daily allowance, the ferry fare and the clock.
// ---------------------------------------------------------------------------
// How far ahead a shock is knowable. Positioning takes time — building, stocking and
// upgrading all have lead times — so the forecast is what makes strategy possible.
export const TREND_HORIZON_PERIODS = 3;

// Every district already has suppliers in it. Your share of its demand is set by how
// attractive your business is against theirs, which is what upgrades actually buy.
export const RIVAL_BASE_STRENGTH = 2.6;
export const RIVAL_GROWTH_PER_LEVEL = 0.35;

/**
 * The career level past which rivals stop getting stronger.
 *
 * Competition growing with a maker's standing is the intended texture, but it is priced
 * per level and it outruns the demand it comes with: measured over thirty days, one
 * greenhouse earned 7,020 at level 1 and 5,247 at level 6, with market share pinned to its
 * floor from level 9. Left uncapped, the six rungs added above level 6 would have been six
 * more levels of getting poorer — a progression bar that punishes progress.
 *
 * Capping here keeps levels 1-6 behaving exactly as they always did, and makes the new
 * upper half of the ladder about standing and how many plots you may hold, not margin.
 */
export const RIVAL_GROWTH_CEILING_LEVEL = 6;
export const APPEAL_SHARE_WEIGHT = 0.42;
export const QUALITY_SHARE_WEIGHT = 0.26;
export const REPUTATION_SHARE_WEIGHT = 0.004;
export const MIN_MARKET_SHARE = 0.18;
export const MAX_MARKET_SHARE = 0.86;

export const EVENT_ISLANDS = 3;
export const EVENT_DAYS = 2;
export const EVENT_MIN_BONUS = 0.22;
export const EVENT_MAX_BONUS = 0.48;

export const EVENT_REASONS = [
  "a festival", "a building push", "a supply failure upriver",
  "a new workshop opening", "a visiting fleet", "storm repairs",
] as const;

export const TAX_RATE = 0.05;
// ---------------------------------------------------------------------------
// The Government Bank.
//
// A Merc Dollar is a claim on a FIXED fraction of a $MM held in the treasury,
// so the bank is fully reserved and can always redeem. The token's market cap
// therefore decides what a Merc Dollar is WORTH in real money, not how many you get
// — which keeps in-game prices stable while a rally still enriches everyone.
//
// A floating rate would do the opposite: players convert in at a high price and,
// when the token falls, redemption demands more $MM than the bank ever held.
// ---------------------------------------------------------------------------
/**
 * The peg: one USDT of $MM buys 10,000 Merc Dollars.
 *
 * A dollar peg backed by a volatile token is only safe while it is
 * over-collateralised, so issuance is capped against the treasury's value. The seed
 * reserve is unencumbered collateral — nobody holds a claim against it — which is what
 * lets the peg survive a crash. At 4x, a 75% drawdown still leaves every Merc Dollar covered.
 */
export const MERC_DOLLARS_PER_USD = 10_000;
export const TARGET_COLLATERAL = 4;
/** Share of the ceiling that may be issued in any one epoch, so supply cannot jump. */
export const EPOCH_ISSUANCE_CAP = 0.08;
export const BANK_TREASURY_MM = 50_000_000;
/** The bank keeps a spread on conversion; it funds civic wages. */
export const BANK_SPREAD = 0.02;
/** Reference token price used until a live feed is wired in. */
export const MM_REFERENCE_PRICE_USD = 0.01;
export const MM_CIRCULATING_SUPPLY = 1_000_000_000;

// --- Mercedonians: the citizens who work for the city and shop with players --
/** Every business a city supports draws this many residents to it. */
export const MERCEDONIANS_PER_BUSINESS = 18;
export const MERCEDONIANS_BASE = 120;
/** Share of a citizen's wage that comes back as spending in player shops. */
export const MERCEDONIAN_SPEND_RATE = 0.72;
/** Civic wages scale with what the bank holds and what the token is worth. */
export const CIVIC_WAGE_BASE = 9;

// ---------------------------------------------------------------------------
// The city's own industries. These exist before any player does: they are what
// makes it possible to build anything at all, and the Mercedonians work for them.
// ---------------------------------------------------------------------------
export interface CivicBuilding {
  id: string; name: string; role: string; island: string;
  x: number; z: number; bannerY: number; icon: string; color: string;
  supplies: ResourceKey[]; opens: "trade" | "world";
}

export const CIVIC_BUILDINGS: CivicBuilding[] = [
  { id: "cityhall", name: "Sunspire City Hall", role: "Government, licences and civic records", island: "hearth",
    x: -1, z: -25, bannerY: 13.4, icon: "\u2302", color: "#c9a24a", supplies: [], opens: "world" },
  { id: "treasury", name: "Sunvault Treasury", role: "$MM reserve and Merc Dollar banking", island: "hearth",
    x: -19, z: -23, bannerY: 10.26, icon: "\u25C8", color: "#5b7fb0", supplies: [], opens: "trade" },
  { id: "registry", name: "Plot & Enterprise Registry", role: "Plots, titles and business registration", island: "hearth",
    x: 17, z: -21, bannerY: 7.53, icon: "\u25A3", color: "#c78858", supplies: [], opens: "world" },
  { id: "transit", name: "Tidegate Transit Hall", role: "Connected-world transit and freight routes", island: "hearth",
    x: 45, z: 47, bannerY: 12.1, icon: "\u2194", color: "#4eaeb7", supplies: [], opens: "world" },
  { id: "clinic", name: "Sunleaf Community Clinic", role: "Public health and community wellbeing", island: "hearth",
    x: 43, z: -25, bannerY: 9.07, icon: "+", color: "#69a976", supplies: [], opens: "world" },
  { id: "rescue", name: "Tidewatch Rescue Station", role: "Fire, rescue and emergency response", island: "hearth",
    x: 45, z: 7, bannerY: 12.4, icon: "!", color: "#df8465", supplies: [], opens: "world" },
  { id: "works", name: "Civic Works Depot", role: "Government utilities, materials and maintenance", island: "hearth",
    x: -73, z: 7, bannerY: 9.48, icon: "\u2699", color: "#8d806d", supplies: ["water", "power", "ore", "timber"], opens: "trade" },
  { id: "academy", name: "Maker Academy & Library", role: "Education, research and public knowledge", island: "hearth",
    x: -47, z: -27, bannerY: 11.24, icon: "A", color: "#70a958", supplies: [], opens: "world" },
  { id: "homes", name: "Garden Commons Residences", role: "Civic housing and neighborhood services", island: "hearth",
    x: 73, z: -27, bannerY: 11.57, icon: "\u2302", color: "#67a98c", supplies: [], opens: "world" },
];

// --- Standing charges: a business owes the city whether it trades or not -----
export const WATER_STANDING_CHARGE = 6;
export const POWER_STANDING_CHARGE = 8;
export const UTILITY_PER_CAPACITY = 7;

// --- Staff: you employ Mercedonians, and their wages are their spending money -
export const STAFF_DAILY_WAGE = 14;
export const STAFF_APPEAL = 0.08;

export const CURRENCY_NAME = "Merc Dollars";
/**
 * Tier 3 trades are not simply bought. The city puts each Enterprise licence out to
 * tender and operators bid against one another for the right to run it, so the most
 * valuable rungs of the ladder are contested rather than first-come.
 */
export const FRANCHISE_ROUND_DAYS = 2;
export const FRANCHISE_BASE_BID = 900;
export const FRANCHISE_RIVAL_STEP = 0.22;

export const CURRENCY_CODE = "MERCS";
export const INITIAL_MERC_DOLLAR_SUPPLY = 50_000_000;
export const INITIAL_CITIZEN_POOL = 5_000_000;
export const MM_TOTAL_SUPPLY = 1_000_000_000;

// --- the live $MM token -----------------------------------------------------
// Verified against Solana mainnet on 2026-08-25: the mint is owned by the
// Token-2022 program, NOT the legacy SPL Token program, and both its mint and
// freeze authorities are already renounced — no more $MM can ever be created and
// no holder can be frozen. On-chain supply is exactly MM_TOTAL_SUPPLY.
// Anything that later derives an associated token account or builds a transfer
// must use MM_TOKEN_PROGRAM; deriving with the legacy program yields the wrong
// address and the transfer silently goes nowhere.
export const MM_TOKEN_MINT = "3mEpcPcmKmHbRUUEhZfutTUsQNaJv3ibao6cyZPDpump";
export const MM_TOKEN_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
export const MM_TOKEN_DECIMALS = 6;
export const MM_TOKEN_NETWORK = "mainnet";
export const INITIAL_MM_RESERVE = 50_000_000;
export const MM_REFERENCE_RATE = 1;
export const MM_EXCHANGE_BUNDLE = 100;
export const MM_EXCHANGE_FEE_RATE = 0.02;
export const MIN_MM_RESERVE = 25_000_000;
export const SAVE_KEY = "markets-makers-3d-browser-v8";
