// Extends the street grid across the undeveloped land, and lays plots along it.
//
// The authored world serves its civic core well and leaves most of the island empty:
// 41,034 buildable cells against 42 plots, with 64% of the land more than eight cells
// from any road. This lays a grid over that land and puts leasable frontage on it.
//
// Roads are drawn by the client from roadnet.json rather than baked into the terrain,
// so extending the network needs no terrain rebuild — the asphalt is laid over the
// ground, and walkability still comes from the terrain underneath.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const worldRoot = resolve(root, "game/public/assets/world/highlands-rivers-v1");
const grid = JSON.parse(readFileSync(resolve(worldRoot, "terrain-grid.json"), "utf8"));
const layout = JSON.parse(readFileSync(resolve(worldRoot, "layout.json"), "utf8"));
const TILE = layout.coordinate_contract.tile_size_m;

const surface = new Map();
const level = new Map();
const key = (x, y) => `${x},${y}`;
for (const row of grid.rows) {
  for (const run of row.runs) {
    const land = /^land_l(\d)$/.exec(run.surface);
    for (let x = run.x0; x <= run.x1; x += 1) {
      surface.set(key(x, row.y), run.surface);
      if (land) level.set(key(x, row.y), Number(land[1]));
    }
  }
}

const { min, max } = grid.bounds_cells;
const isLand = (x, y) => level.has(key(x, y));
const isFree = (x, y) => {
  const s = surface.get(key(x, y));
  return s !== undefined && /^land_l\d$/.test(s);
};

// Keep clear of what the world already placed: civic footprints and existing plots.
const reserved = new Set();
const reserve = (cx, cy, w, d, pad) => {
  for (let x = cx - pad; x < cx + w + pad; x += 1) {
    for (let y = cy - pad; y < cy + d + pad; y += 1) reserved.add(key(x, y));
  }
};
for (const building of layout.buildings) {
  const [ax, ay] = building.anchor_cell_sw;
  const size = building.collision?.[0]?.size_m ?? [16, 16, 0];
  reserve(ax, ay, Math.ceil(size[0] / TILE), Math.ceil(size[1] / TILE), 3);
}
for (const plot of [...(layout.plots.existing ?? []), ...(layout.plots.added ?? [])]) {
  const [ax, ay] = plot.anchor_cell_sw;
  const [w, d] = plot.footprint_tiles ?? [6, 6];
  reserve(ax, ay, w, d, 2);
}
for (const [k, s] of surface) if (s === "road" || s === "bridge" || s === "path" || s === "empty_plot") reserved.add(k);

// --- the grid ------------------------------------------------------------
const SPACING = 16;      // centre to centre, so a 14-cell block between carriageways
const MIN_RUN = 8;       // shorter than this is a stub, not a street
const newRoads = [];
const roadCells = new Set();

/** Maximal runs along one grid line where both carriageway rows are free and level. */
function layLine(fixed, horizontal) {
  const from = horizontal ? min[0] : min[1];
  const to = horizontal ? max[0] : max[1];
  let start = null;
  let runLevel = null;
  const flush = (end) => {
    if (start === null || end - start < MIN_RUN) { start = null; runLevel = null; return; }
    newRoads.push({ axis: horizontal ? 0 : 1, centre: fixed + 0.5, from: start, to: end });
    for (let k = start; k <= end; k += 1) {
      roadCells.add(horizontal ? key(k, fixed) : key(fixed, k));
      roadCells.add(horizontal ? key(k, fixed + 1) : key(fixed + 1, k));
    }
    start = null;
    runLevel = null;
  };
  for (let k = from; k <= to; k += 1) {
    const a = horizontal ? [k, fixed] : [fixed, k];
    const b = horizontal ? [k, fixed + 1] : [fixed + 1, k];
    const ok = isFree(...a) && isFree(...b)
      && !reserved.has(key(...a)) && !reserved.has(key(...b))
      && level.get(key(...a)) === level.get(key(...b));
    const thisLevel = ok ? level.get(key(...a)) : null;
    // A street may not climb a terrace mid-run; break and start again above it.
    if (!ok || (runLevel !== null && thisLevel !== runLevel)) { flush(k - 1); }
    if (ok) {
      if (start === null) { start = k; runLevel = thisLevel; }
    }
  }
  flush(to);
}

for (let y = min[1]; y <= max[1]; y += SPACING) layLine(y, true);
for (let x = min[0]; x <= max[0]; x += SPACING) layLine(x, false);

// --- plots along the new frontage ---------------------------------------
const PLOT = 6;
const taken = new Set();
const newPlots = [];
const districts = layout.world ? null : null;

const adjacentToRoad = (cx, cy) => {
  for (let x = cx - 1; x < cx + PLOT + 1; x += 1) {
    for (let y = cy - 1; y < cy + PLOT + 1; y += 1) {
      if (roadCells.has(key(x, y)) || surface.get(key(x, y)) === "road") return true;
    }
  }
  return false;
};

const flatAndFree = (cx, cy) => {
  const base = level.get(key(cx, cy));
  if (base === undefined) return false;
  for (let x = cx; x < cx + PLOT; x += 1) {
    for (let y = cy; y < cy + PLOT; y += 1) {
      const k = key(x, y);
      if (!isFree(x, y) || reserved.has(k) || roadCells.has(k) || taken.has(k)) return false;
      if (level.get(k) !== base) return false;
    }
  }
  return true;
};

for (let y = min[1]; y + PLOT <= max[1]; y += 2) {
  for (let x = min[0]; x + PLOT <= max[0]; x += 2) {
    if (!flatAndFree(x, y) || !adjacentToRoad(x, y)) continue;
    for (let px = x - 1; px < x + PLOT + 1; px += 1) {
      for (let py = y - 1; py < y + PLOT + 1; py += 1) taken.add(key(px, py));
    }
    newPlots.push({ x, y, level: level.get(key(x, y)) });
  }
}

// --- district and price --------------------------------------------------
const DISTRICTS = [
  ["hearth", 0, -16], ["kite", -32, -176], ["sun", 120, -64], ["kiln", 90, -124],
  ["copper", 96, -176], ["tide", 70, 4], ["lantern", -74, -30], ["green", -120, -64], ["pulse", -32, -124],
];
const nearestDistrict = (cx, cy) => {
  // Districts are in world units; a cell is (x*TILE, -y*TILE).
  const wx = cx * TILE;
  const wz = -cy * TILE;
  let best = DISTRICTS[0];
  let bestDistance = Infinity;
  for (const entry of DISTRICTS) {
    const d = (wx - entry[1]) ** 2 + (wz - entry[2]) ** 2;
    if (d < bestDistance) { bestDistance = d; best = entry; }
  }
  return best[0];
};

const plotRecords = newPlots.map((plot, index) => {
  const district = nearestDistrict(plot.x + PLOT / 2, plot.y + PLOT / 2);
  // Higher ground costs more, as it does everywhere.
  const price = 120 + plot.level * 24;
  return [`GX${String(index + 1).padStart(3, "0")}`, district, plot.x, plot.y, plot.x + PLOT - 1, plot.y + PLOT - 1, price];
});

writeFileSync(resolve(root, "game/src/generatedPlots.ts"),
`// Generated by scripts/build-city-expansion.mjs — do not edit by hand.
//
// Plots laid along the extended street grid. The authored world left most of the island
// without frontage; these fill it, each one flat, clear of the civic reservations and
// existing plots, and adjacent to a carriageway.
import type { PlotCells } from "./highlandsWorld";

export const GENERATED_PLOT_CELLS: readonly PlotCells[] = ${JSON.stringify(plotRecords, null, 0).replace(/\],\[/g, "],\n  [").replace(/^\[/, "[\n  ").replace(/\]$/, ",\n]")} as const;
`);

writeFileSync(resolve(root, "scripts/.city-expansion-roads.json"), JSON.stringify(newRoads));
console.log(`new carriageways ${newRoads.length}, covering ${[...roadCells].length} cells`);
console.log(`new plots ${plotRecords.length} (was 42), districts used ${new Set(plotRecords.map((p) => p[1])).size}`);
