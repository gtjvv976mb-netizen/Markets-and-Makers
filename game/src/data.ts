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

export interface PlotConfig { id: string; name: string; island: string; x: number; z: number; width: number; depth: number; price: number; }
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
    ecosystem: { upstream: "SunGrid and workshops", process: "Purification and distribution", downstream: "Farms, mines, factories and citizens" },
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
    ecosystem: { upstream: "AquaWorks and SunGrid", process: "Controlled growing", downstream: "Shops, restaurants and citizens" },
  },
  mine: {
    name: "Stonewake Mine", sector: "Mineral extraction", stage: "Primary", islandAffinity: "Stonewake", icon: "◆", color: "#8d806d", model: "./assets/structures/b06-maker-workshop.glb",
    copy: "Extracts mineral feedstock for workshops, equipment factories and civic construction.", duration: 20, licenseCost: 25, laborCost: 11,
    inputs: { part: 1, power: 2, water: 1 }, output: { ore: 14 }, wastePerCycle: 1, starter: { part: 1, power: 2, water: 1 },
    ecosystem: { upstream: "Parts, SunGrid and AquaWorks", process: "Low-impact extraction", downstream: "Workshops and factories" },
  },
  timberworks: {
    name: "Timbercoast Works", sector: "Regenerative forestry", stage: "Primary", islandAffinity: "Greenloom", icon: "▤", color: "#9a754d", model: "./assets/structures/b05-canopy-greenhouse.glb",
    copy: "Produces traceable timber for packaging, construction modules and public works.", duration: 18, licenseCost: 22, laborCost: 10,
    inputs: { part: 1, power: 1, water: 1 }, output: { timber: 14 }, wastePerCycle: 1, starter: { part: 1, power: 1, water: 1 },
    ecosystem: { upstream: "Utilities and repair shops", process: "Regrowth and milling", downstream: "Crate mills and builders" },
  },
  cratemill: {
    name: "Freight Crate Mill", sector: "Packaging", stage: "Manufacturing", islandAffinity: "Copper Quay", icon: "▣", color: "#c88a50", model: "./assets/structures/b06-maker-workshop.glb",
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
    name: "Sunwoven Factory", sector: "Capital equipment", stage: "Manufacturing", islandAffinity: "Kilnrise", icon: "F", color: "#cc7652", model: "./assets/structures/b03-sungrid-utility.glb",
    copy: "Produces machinery that expands capacity across construction, utilities and public services.", duration: 24, licenseCost: 45, laborCost: 16,
    inputs: { ore: 3, part: 1, power: 2, water: 1 }, output: { equipment: 3 }, wastePerCycle: 2, starter: { ore: 3, part: 1, power: 2, water: 1 },
    ecosystem: { upstream: "Mining, workshops and utilities", process: "Equipment fabrication", downstream: "Builders and business upgrades" },
  },
  construction: {
    name: "Civic Construction Co.", sector: "Building systems", stage: "Manufacturing", islandAffinity: "Hearthmarket", icon: "▦", color: "#b46f4f", model: "./assets/structures/b06-maker-workshop.glb",
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
    copy: "Packages food, parts and crates into consumer supplies purchased by citizens and services.", duration: 14, licenseCost: 25, laborCost: 10,
    inputs: { food: 2, crate: 1, part: 1, power: 1 }, output: { supply: 10 }, wastePerCycle: 1, starter: { food: 2, crate: 1, part: 1, power: 1 },
    ecosystem: { upstream: "Greenhouses, workshops and logistics", process: "Packing and merchandising", downstream: "Citizens, gyms and cinemas" },
  },
  restaurant: {
    name: "Sunset Market Kitchen", sector: "Hospitality service", stage: "Services", islandAffinity: "Lantern Row", icon: "R", color: "#d47d5b", model: "./assets/structures/b07-starter-shop-cafe.glb",
    copy: "Serves price-sensitive citizen demand and turns local food into district footfall.", duration: 13, licenseCost: 28, laborCost: 12,
    inputs: { food: 2, supply: 1, water: 1, power: 1 }, output: {}, wastePerCycle: 1, servicePayout: 15, baseVisitors: 8, priceElasticity: 1.4, starter: { food: 2, supply: 1, water: 1, power: 1 },
    ecosystem: { upstream: "Greenhouses, shops and utilities", process: "Hospitality and dining", downstream: "Citizens and district demand" },
  },
  gym: {
    name: "Harbor Gym", sector: "Wellness service", stage: "Services", islandAffinity: "Pulsegrove", icon: "H", color: "#4d9487", model: "./assets/structures/b08-harbor-gym.glb",
    copy: "Consumes supplies and utilities to serve citizens; equipment and appeal increase attendance.", duration: 12, licenseCost: 30, laborCost: 11,
    inputs: { supply: 1, water: 1, power: 1 }, output: {}, servicePayout: 14, baseVisitors: 5, priceElasticity: 1.15, starter: { supply: 1, water: 1, power: 1 },
    ecosystem: { upstream: "Retail, water and power", process: "Training and recovery", downstream: "Healthy workers and local demand" },
  },
  cinema: {
    name: "Lantern Cinema", sector: "Entertainment service", stage: "Services", islandAffinity: "Lantern Row", icon: "C", color: "#d39a45", model: "./assets/structures/b02-market-pavilion.glb",
    copy: "Runs screenings and events; ticket price, quality and appeal determine audience demand.", duration: 18, licenseCost: 35, laborCost: 13,
    inputs: { supply: 2, power: 2 }, output: {}, servicePayout: 12, baseVisitors: 9, priceElasticity: 1.35, starter: { supply: 2, power: 2 },
    ecosystem: { upstream: "Retailers and SunGrid", process: "Screenings and concessions", downstream: "Watchers and nightlife" },
  },
  recycler: {
    name: "Tideglass Reclamation Hub", sector: "Resource recovery", stage: "Circular", islandAffinity: "Tideglass", icon: "♻", color: "#718c62", model: "./assets/structures/b04-aquaworks.glb",
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

export const UPGRADE_COSTS: Array<{ sunmarks: number; resources: Partial<Record<ResourceKey, number>> }> = [
  { sunmarks: 0, resources: {} },
  { sunmarks: 70, resources: { crate: 1, part: 1 } },
  { sunmarks: 150, resources: { part: 2, equipment: 1, supply: 1 } },
  { sunmarks: 280, resources: { part: 3, equipment: 2, material: 2 } },
  { sunmarks: 520, resources: { part: 4, equipment: 3, material: 3, supply: 2 } },
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
    tradeoff: "Payroll is 10% higher and returns more income to citizen households.",
  },
};

export const CAREER_LEVELS = [
  { level: 1, name: "New Maker", xp: 0 },
  { level: 2, name: "Licensed Operator", xp: 80 },
  { level: 3, name: "Local Proprietor", xp: 220 },
  { level: 4, name: "District Supplier", xp: 450 },
  { level: 5, name: "Regional Founder", xp: 800 },
  { level: 6, name: "Sunwoven Industrialist", xp: 1_300 },
] as const;

export const DAILY_GOALS = { jobs: 2, contracts: 1, trades: 2, reward: 80, xp: 30 } as const;
export const PROCUREMENT_BASE_QUOTA = 12;
/** Plots a player may hold at once, raised by civic standing. */
export const BASE_PLOT_ALLOWANCE = 1;
export const PLOTS_PER_CAREER_LEVEL = 0.5;

export const ISLANDS: IslandConfig[] = [
  { id: "hearth", name: "Hearthmarket", district: "Civic heart", x: 0, z: 0, radius: 63, spawnX: 0, spawnZ: 34, color: "#8fc66b", economy: "Markets, construction, starter plots and final demand" },
  { id: "kite", name: "Kitecrest", district: "Innovation frontier", x: 0, z: -174, radius: 27, spawnX: 0, spawnZ: -160, color: "#8fae8c", economy: "Blueprints, automation and R&D" },
  { id: "sun", name: "Sunwell", district: "Energy frontier", x: 142, z: -124, radius: 28, spawnX: 130, spawnZ: -116, color: "#d6ad51", economy: "Power, batteries and solar services" },
  { id: "kiln", name: "Kilnrise", district: "Industrial belt", x: 188, z: -12, radius: 27, spawnX: 176, spawnZ: -12, color: "#c27657", economy: "Parts, equipment and construction modules" },
  { id: "copper", name: "Copper Quay", district: "Freight district", x: 142, z: 120, radius: 25, spawnX: 130, spawnZ: 112, color: "#b68c5d", economy: "Packaging, storage and delivery" },
  { id: "tide", name: "Tideglass", district: "Water works", x: 0, z: 174, radius: 26, spawnX: 0, spawnZ: 158, color: "#65b9b1", economy: "Water, sanitation and material recovery" },
  { id: "lantern", name: "Lantern Row", district: "Consumer district", x: -142, z: 120, radius: 27, spawnX: -130, spawnZ: 112, color: "#df9267", economy: "Shops, dining, cinema and hospitality" },
  { id: "green", name: "Greenloom", district: "Bio-production belt", x: -188, z: -4, radius: 29, spawnX: -174, spawnZ: -4, color: "#78a85d", economy: "Food, timber and greenhouse production" },
  { id: "pulse", name: "Pulsegrove", district: "Wellness district", x: -140, z: -126, radius: 27, spawnX: -128, spawnZ: -118, color: "#67a98c", economy: "Gyms, clinics and recreation" },
];

export const PLOTS: PlotConfig[] = [
  { id: "garden-row", name: "Garden Row Plot", island: "hearth", x: -47, z: 27, width: 16, depth: 14, price: 120 },
  { id: "seabreeze", name: "Seabreeze Plot", island: "hearth", x: 47, z: 27, width: 16, depth: 14, price: 120 },
  { id: "north-canopy", name: "North Canopy Plot", island: "hearth", x: 0, z: -46, width: 16, depth: 14, price: 120 },
  { id: "kitecrest-loft", name: "Kitecrest Loft Plot", island: "kite", x: 8, z: -162, width: 16, depth: 14, price: 260 },
  { id: "updraft-yard", name: "Updraft Yard Plot", island: "kite", x: -13, z: -180, width: 16, depth: 14, price: 260 },
  { id: "solar-terrace", name: "Solar Terrace Plot", island: "sun", x: 150, z: -112, width: 16, depth: 14, price: 210 },
  { id: "batteryside", name: "Batteryside Plot", island: "sun", x: 129, z: -130, width: 16, depth: 14, price: 210 },
  { id: "forge-lane", name: "Forge Lane Plot", island: "kiln", x: 196, z: 0, width: 16, depth: 14, price: 220 },
  { id: "cinderworks", name: "Cinderworks Plot", island: "kiln", x: 175, z: -18, width: 16, depth: 14, price: 220 },
  { id: "quayside-depot", name: "Quayside Depot Plot", island: "copper", x: 149, z: 131, width: 16, depth: 14, price: 190 },
  { id: "dockhand-row", name: "Dockhand Row Plot", island: "copper", x: 130, z: 115, width: 16, depth: 14, price: 190 },
  { id: "tidepool-works", name: "Tidepool Works Plot", island: "tide", x: 8, z: 185, width: 16, depth: 14, price: 180 },
  { id: "glassmere", name: "Glassmere Plot", island: "tide", x: -12, z: 168, width: 16, depth: 14, price: 180 },
  { id: "lantern-walk", name: "Lantern Walk Plot", island: "lantern", x: -134, z: 132, width: 16, depth: 14, price: 230 },
  { id: "nightmarket-row", name: "Nightmarket Row Plot", island: "lantern", x: -155, z: 114, width: 16, depth: 14, price: 230 },
  { id: "greenloom-field", name: "Greenloom Field Plot", island: "green", x: -179, z: 8, width: 16, depth: 14, price: 170 },
  { id: "orchard-bend", name: "Orchard Bend Plot", island: "green", x: -202, z: -10, width: 16, depth: 14, price: 170 },
  { id: "pulsegrove-court", name: "Pulsegrove Court Plot", island: "pulse", x: -132, z: -114, width: 16, depth: 14, price: 200 },
  { id: "springline", name: "Springline Plot", island: "pulse", x: -153, z: -132, width: 16, depth: 14, price: 200 },
];

export const TUTORIAL = [
  ["moved", "Explore Hearthmarket", "Move with WASD, arrows, or click the world."],
  ["leased", "Lease a plot", "Select a glowing plot and sign a starter lease."],
  ["licensed", "Choose a business", "Pick one of fifteen connected roles across six economic stages."],
  ["built", "Build the business", "Place the existing 3D structure on your plot."],
  ["produced", "Run production", "Buy required inputs, pay labor and complete one job."],
  ["upgraded", "Improve the interior", "Install a yield, capacity, speed or appeal upgrade."],
  ["sold", "Earn Sunmarks", "Sell an output or serve price-sensitive citizen demand."],
  ["contracted", "Fulfill a trade contract", "Complete a public, commercial or household order from the Contracts Board."],
  ["traveled", "Use the ferry map", "Visit another specialist island in the shared world."],
] as const;

// --- Operating capacity now costs time: each extra batch adds 45% of the base duration.
export const CAPACITY_DURATION_STEP = 0.45;

// --- Civic and household demand soften instead of stopping dead. Each further tranche the
//     size of the daily quota clears at a lower price, never below the floor. A business can
//     therefore always run; it just earns less once it saturates local demand.
export const DEMAND_TRANCHE_DECAY = 0.72;
export const DEMAND_PRICE_FLOOR = 0.34;
// A district absorbs a VALUE of each good per day, not a unit count: 400 Sunmarks of
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
export const CONTRIBUTION_WEIGHT = { contract: 1, household: 0.3, civic: 0.1, auto: 0.05 } as const;

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
// A Maker Dollar is a claim on a FIXED fraction of a $MM held in the treasury,
// so the bank is fully reserved and can always redeem. The token's market cap
// therefore decides what a Mollar is WORTH in real money, not how many you get
// — which keeps in-game prices stable while a rally still enriches everyone.
//
// A floating rate would do the opposite: players convert in at a high price and,
// when the token falls, redemption demands more $MM than the bank ever held.
// ---------------------------------------------------------------------------
/**
 * The peg: one USDT of $MM buys 10,000 Maker Dollars.
 *
 * A dollar peg backed by a volatile token is only safe while it is
 * over-collateralised, so issuance is capped against the treasury's value. The seed
 * reserve is unencumbered collateral — nobody holds a claim against it — which is what
 * lets the peg survive a crash. At 4x, a 75% drawdown still leaves every Mollar covered.
 */
export const MOLLAR_PER_USD = 10_000;
export const TARGET_COLLATERAL = 4;
/** Share of the ceiling that may be issued in any one epoch, so supply cannot jump. */
export const EPOCH_ISSUANCE_CAP = 0.08;
export const BANK_TREASURY_MM = 50_000_000;
/** The bank keeps a spread on conversion; it funds civic wages. */
export const BANK_SPREAD = 0.02;
/** Reference token price used until a live feed is wired in. */
export const MM_REFERENCE_PRICE_USD = 0.01;
export const MM_CIRCULATING_SUPPLY = 1_000_000_000;

// --- Markians: the citizens who work for the city and shop with players ------
/** Every business a city supports draws this many residents to it. */
export const MARKIANS_PER_BUSINESS = 18;
export const MARKIANS_BASE = 120;
/** Share of a citizen's wage that comes back as spending in player shops. */
export const MARKIAN_SPEND_RATE = 0.72;
/** Civic wages scale with what the bank holds and what the token is worth. */
export const CIVIC_WAGE_BASE = 9;

export const MOLLAR_NAME = "Maker Dollar";
export const MOLLAR_CODE = "MD";
export const INITIAL_MOLLAR_SUPPLY = 50_000_000;
export const INITIAL_CITIZEN_POOL = 5_000_000;
export const MM_TOTAL_SUPPLY = 1_000_000_000;
export const INITIAL_MM_RESERVE = 50_000_000;
export const MM_REFERENCE_RATE = 1;
export const MM_EXCHANGE_BUNDLE = 100;
export const MM_EXCHANGE_FEE_RATE = 0.02;
export const MIN_MM_RESERVE = 25_000_000;
export const SAVE_KEY = "markets-makers-3d-browser-v8";
