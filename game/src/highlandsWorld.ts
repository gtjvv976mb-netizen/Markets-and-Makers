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

type PlotCells = readonly [id: string, island: string, minX: number, minY: number, maxX: number, maxY: number, price: number];

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

export const HIGHLANDS_PLOTS = PLOT_CELLS.map(([id, island, minX, minY, maxX, maxY, price]) => ({
  id,
  name: `${titleCaseId(id)} Plot`,
  island,
  x: minX + maxX,
  z: -(minY + maxY),
  width: (maxX - minX + 1) * 2,
  depth: (maxY - minY + 1) * 2,
  price,
}));

export function plotArrival(plot: { x: number; z: number; depth: number }): { x: number; z: number } {
  return { x: plot.x + 1, z: plot.z + plot.depth / 2 + 3 };
}

export function worldChunkAt(x: number, z: number): readonly [number, number] | null {
  const cx = Math.floor((x - HIGHLANDS_WORLD_BOUNDS.minX) / HIGHLANDS_WORLD_BOUNDS.chunkSize);
  const cy = Math.floor((-z - (-HIGHLANDS_WORLD_BOUNDS.maxZ)) / HIGHLANDS_WORLD_BOUNDS.chunkSize);
  if (cx < 0 || cy < 0 || cx >= HIGHLANDS_WORLD_BOUNDS.chunksPerAxis || cy >= HIGHLANDS_WORLD_BOUNDS.chunksPerAxis) return null;
  return [cx, cy];
}
