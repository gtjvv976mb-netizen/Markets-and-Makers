import { GENERATED_PLOT_CELLS } from "./generatedPlots";
export const HIGHLANDS_WORLD_BASE = "./assets/world/highlands-rivers-v1";
export const HIGHLANDS_WORLD_ENTRY = `${HIGHLANDS_WORLD_BASE}/world.gltf`;

export const HIGHLANDS_WORLD_BOUNDS = {
  minX: -257,
  maxX: 255,
  minZ: -351,
  maxZ: 161,
  chunkSize: 32,
  chunksPerAxis: 16,
} as const;

export const HIGHLANDS_DISTRICTS = [
  { id: "hearth", name: "Hearthmarket Civic Center", district: "Government and central market", x: 0, z: -16, radius: 72, spawnX: 0, spawnZ: -16, color: "#8fc66b", economy: "City Hall, public services, civic market and starter plots" },
  { id: "kite", name: "Kitecrest Foothills", district: "Innovation highlands", x: -32, z: -176, radius: 54, spawnX: -32, spawnZ: -160, color: "#8fae8c", economy: "Blueprints, automation, R&D and mountain enterprises" },
  { id: "sun", name: "Sunwell East Fields", district: "Renewable energy belt", x: 120, z: -64, radius: 54, spawnX: 120, spawnZ: -52, color: "#d6ad51", economy: "Power, batteries, solar services and production plots" },
  { id: "kiln", name: "Kilnrise North Valley", district: "Industrial valley", x: 90, z: -124, radius: 52, spawnX: 90, spawnZ: -112, color: "#c27657", economy: "Parts, equipment and construction modules" },
  { id: "copper", name: "Copperglass Terraces", district: "Freight and mining terraces", x: 96, z: -176, radius: 56, spawnX: 96, spawnZ: -160, color: "#b68c5d", economy: "Minerals, packaging, storage and upland delivery" },
  { id: "tide", name: "Tideglass Water Quarter", district: "Civic water district", x: 70, z: 4, radius: 42, spawnX: 70, spawnZ: 4, color: "#65b9b1", economy: "Water, sanitation, harbor access and material recovery" },
  { id: "lantern", name: "Lantern Civic Row", district: "Consumer quarter", x: -74, z: -30, radius: 42, spawnX: -74, spawnZ: -30, color: "#df9267", economy: "Shops, dining, cinema and hospitality" },
  { id: "green", name: "Greenloom West Fields", district: "Regenerative production belt", x: -120, z: -64, radius: 58, spawnX: -118, spawnZ: -64, color: "#78a85d", economy: "Food, timber, farms and greenhouse production" },
  { id: "pulse", name: "Pulsegrove Valley", district: "Wellness and residential valley", x: -32, z: -124, radius: 52, spawnX: -32, spawnZ: -112, color: "#67a98c", economy: "Gyms, clinics, housing and recreation" },
] as const;

export type PlotCells = readonly [id: string, island: string, minX: number, minY: number, maxX: number, maxY: number, price: number];
export type PlotCustomerEdge = "N" | "E" | "S" | "W";

const PLOT_CELLS: readonly PlotCells[] = [
  ["garden-row", "hearth", -42, 28, -37, 33, 120],
  ["seabreeze", "hearth", -24, 28, -19, 35, 120],
  ["north-canopy", "hearth", -14, 28, -9, 33, 120],
  ["N04", "hearth", 2, 28, 7, 33, 120],
  ["N05", "hearth", 12, 28, 17, 35, 140],
  ["N06", "hearth", 34, 28, 39, 33, 120],
  ["lantern-walk", "lantern", -38, 10, -35, 13, 180],
  ["nightmarket-row", "lantern", -38, 16, -35, 19, 180],
  ["greenloom-field", "green", -40, -20, -35, -13, 190],
  ["orchard-bend", "green", -40, -28, -35, -23, 170],
  ["tidepool-works", "tide", 33, 0, 36, 3, 180],
  ["glassmere", "tide", 33, -6, 36, -3, 180],
  ["solar-terrace", "sun", 33, -20, 38, -13, 220],
  ["batteryside", "sun", 33, -28, 38, -23, 210],
  ["pulsegrove-court", "pulse", -27, -37, -24, -34, 200],
  ["springline", "pulse", -18, -37, -15, -34, 200],
  ["quayside-depot", "copper", -9, -37, -6, -34, 210],
  ["dockhand-row", "copper", 4, -37, 7, -34, 210],
  ["WF01", "green", -70, 34, -65, 39, 170],
  ["WF02", "green", -62, 34, -57, 39, 170],
  ["WF03", "green", -54, 34, -49, 39, 170],
  ["WF04", "green", -70, 23, -65, 29, 190],
  ["WF05", "green", -62, 23, -57, 29, 190],
  ["WF06", "green", -54, 23, -49, 29, 190],
  ["EF01", "sun", 50, 34, 55, 39, 210],
  ["EF02", "sun", 58, 34, 63, 39, 210],
  ["EF03", "sun", 68, 34, 73, 39, 210],
  ["EF04", "sun", 50, 23, 55, 29, 230],
  ["EF05", "sun", 58, 23, 63, 29, 230],
  ["EF06", "sun", 68, 23, 73, 29, 230],
  ["NV01", "pulse", -26, 58, -21, 65, 220],
  ["NV02", "pulse", -18, 58, -13, 65, 220],
  ["NV03", "pulse", -10, 58, -5, 65, 220],
  ["forge-lane", "kiln", 34, 58, 39, 65, 240],
  ["cinderworks", "kiln", 42, 66, 47, 73, 240],
  ["NV06", "kiln", 50, 58, 55, 65, 240],
  ["kitecrest-loft", "kite", -26, 82, -21, 89, 260],
  ["updraft-yard", "kite", -18, 82, -13, 89, 260],
  ["FH03", "kite", -10, 82, -5, 89, 260],
  ["FH04", "copper", 40, 82, 45, 89, 260],
  ["FH05", "copper", 48, 82, 53, 89, 260],
  ["FH06", "copper", 56, 82, 61, 89, 260],
] as const;

const titleCaseId = (id: string): string => id
  .replace(/([a-z])([A-Z])/g, "$1 $2")
  .replace(/[-_]/g, " ")
  .replace(/\b\w/g, (letter) => letter.toUpperCase());

const CUSTOMER_EDGE_BY_PLOT: Readonly<Record<string, PlotCustomerEdge>> = {
  "lantern-walk": "E",
  "nightmarket-row": "E",
  "greenloom-field": "E",
  "orchard-bend": "E",
  "tidepool-works": "W",
  glassmere: "W",
  "solar-terrace": "W",
  batteryside: "W",
  "pulsegrove-court": "N",
  springline: "N",
  "quayside-depot": "N",
  "dockhand-row": "N",
  WF04: "N",
  WF05: "N",
  WF06: "N",
  EF04: "N",
  EF05: "N",
  EF06: "N",
};

/**
 * The authored plots plus the expansion.
 *
 * The world shipped 42 plots against 41,034 buildable cells, with most of the island
 * more than eight cells from a road. scripts/build-city-expansion.mjs lays a street grid
 * over that land and puts frontage on it; every generated plot is flat, clear of the
 * civic reservations and the authored plots, and adjacent to a carriageway.
 */
const ALL_PLOT_CELLS: readonly PlotCells[] = [...PLOT_CELLS, ...GENERATED_PLOT_CELLS];

export const HIGHLANDS_PLOTS = ALL_PLOT_CELLS.map(([id, island, minX, minY, maxX, maxY, price]) => ({
  id,
  name: `${titleCaseId(id)} Plot`,
  island,
  x: minX + maxX,
  z: -(minY + maxY),
  width: (maxX - minX + 1) * 2,
  depth: (maxY - minY + 1) * 2,
  price,
  customerEdge: CUSTOMER_EDGE_BY_PLOT[id] ?? "S",
}));

export function plotArrival(plot: {
  x: number;
  z: number;
  width: number;
  depth: number;
  customerEdge: PlotCustomerEdge;
}): { x: number; z: number } {
  if (plot.customerEdge === "N") return { x: plot.x + 1, z: plot.z - plot.depth / 2 - 3 };
  if (plot.customerEdge === "E") return { x: plot.x + plot.width / 2 + 3, z: plot.z + 1 };
  if (plot.customerEdge === "W") return { x: plot.x - plot.width / 2 - 3, z: plot.z + 1 };
  return { x: plot.x + 1, z: plot.z + plot.depth / 2 + 3 };
}

export function worldChunkAt(x: number, z: number): readonly [number, number] | null {
  const cx = Math.floor((x - HIGHLANDS_WORLD_BOUNDS.minX) / HIGHLANDS_WORLD_BOUNDS.chunkSize);
  const cy = Math.floor((-z - (-HIGHLANDS_WORLD_BOUNDS.maxZ)) / HIGHLANDS_WORLD_BOUNDS.chunkSize);
  if (cx < 0 || cy < 0 || cx >= HIGHLANDS_WORLD_BOUNDS.chunksPerAxis || cy >= HIGHLANDS_WORLD_BOUNDS.chunksPerAxis) return null;
  return [cx, cy];
}

/**
 * The nine government sites, in world units.
 *
 * The landmark geometry used to be baked into world.gltf and these were read off those
 * nodes. scripts/strip-civic-geometry.mjs removed it — the client generates the
 * buildings now — so the sites have to be declared, exactly as HIGHLANDS_PLOTS is.
 * Taken from layout.json: x is center_m[0] and z is -center_m[1], since the authored
 * world is +Y north and the scene is -Z north.
 */
export const CIVIC_SITES = [
  { node: "MM_CIVIC_CV01_CITY_HALL", x: -1, z: -25, width: 15.04, depth: 15.04 },
  { node: "MM_CIVIC_CV02_TREASURY", x: -19, z: -23, width: 11.28, depth: 11.28 },
  { node: "MM_CIVIC_CV03_LAND_REGISTRY", x: 17, z: -21, width: 11.28, depth: 7.52 },
  { node: "MM_CIVIC_CV04_TRANSIT_HALL", x: 45, z: 47, width: 15.04, depth: 11.28 },
  { node: "MM_CIVIC_CV05_COMMUNITY_CLINIC", x: 43, z: -25, width: 11.28, depth: 11.28 },
  { node: "MM_CIVIC_CV06_RESCUE_STATION", x: 45, z: 7, width: 15.04, depth: 11.28 },
  { node: "MM_CIVIC_CV07_PUBLIC_WORKS", x: -73, z: 7, width: 15.04, depth: 11.28 },
  { node: "MM_CIVIC_CV08_MAKER_ACADEMY", x: -47, z: -27, width: 15.04, depth: 15.04 },
  { node: "MM_CIVIC_CV09_GARDEN_HOMES", x: 73, z: -27, width: 11.28, depth: 15.04 },
] as const;
