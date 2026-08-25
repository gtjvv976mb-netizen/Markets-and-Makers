// Turns the authored Highlands & Rivers layout into a compact tile file the browser
// can raise into geometry itself. The shipped world.gltf carries the same tiles baked
// into 26 MB of vertex buffers; the grid that describes them is a few hundred KB, so
// we ship the description and build the mesh at runtime.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const src = resolve(root, "world-source");
const grid = JSON.parse(readFileSync(resolve(src, "terrain-grid.json"), "utf8"));
const layout = JSON.parse(readFileSync(resolve(src, "layout.json"), "utf8"));

const contract = layout.coordinate_contract;
const { min, max } = grid.bounds_cells;
const W = max[0] - min[0] + 1;
const H = max[1] - min[1] + 1;
const idx = (x, y) => (y - min[1]) * W + (x - min[0]);

// Surfaces get stable indices; land_lN also carries its elevation in the name.
const surfaces = [...new Set(grid.rows.flatMap((r) => r.runs.map((run) => run.surface)))].sort();
const surfaceId = new Map(surfaces.map((s, i) => [s, i]));

const surfaceGrid = new Int16Array(W * H).fill(-1);
const levelGrid = new Int16Array(W * H).fill(-1);
for (const row of grid.rows) {
  for (const run of row.runs) {
    const id = surfaceId.get(run.surface);
    const land = /^land_l(\d)$/.exec(run.surface);
    for (let x = run.x0; x <= run.x1; x += 1) {
      const i = idx(x, row.y);
      surfaceGrid[i] = id;
      levelGrid[i] = land ? Number(land[1]) : run.surface === "ocean" ? 0 : -1;
    }
  }
}

// Roads, plots, water and bridges are cut into the terrain rather than given a level of
// their own, so each takes the level of the nearest tile that has one. A BFS over the
// whole grid settles every unknown in one pass.
const queue = [];
for (let i = 0; i < levelGrid.length; i += 1) if (levelGrid[i] >= 0) queue.push(i);
for (let head = 0; head < queue.length; head += 1) {
  const i = queue[head];
  const x = i % W;
  const y = (i / W) | 0;
  const level = levelGrid[i];
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
    const n = ny * W + nx;
    if (surfaceGrid[n] < 0 || levelGrid[n] >= 0) continue;
    levelGrid[n] = level;
    queue.push(n);
  }
}

// Re-run-length the grid on (surface, level) so the client reads whole spans, not tiles.
const runs = [];
for (let y = min[1]; y <= max[1]; y += 1) {
  let x = min[0];
  while (x <= max[0]) {
    const i = idx(x, y);
    const s = surfaceGrid[i];
    if (s < 0) { x += 1; continue; }
    const l = levelGrid[i];
    let end = x;
    while (end + 1 <= max[0]) {
      const j = idx(end + 1, y);
      if (surfaceGrid[j] !== s || levelGrid[j] !== l) break;
      end += 1;
    }
    runs.push(y, x, end, s, l);
    x = end + 1;
  }
}

const out = {
  id: layout.world.id,
  name: grid.schema,
  bounds: grid.bounds_cells,
  tileSize: contract.tile_size_m,
  elevationStep: contract.elevation_step_m,
  baseWalkZ: contract.base_walk_z_m,
  oceanZ: contract.ocean_z_m,
  waterInset: contract.water_inset_below_walk_m,
  canalWaterZ: contract.civic_canal_water_z_m,
  surfaces,
  // Flat quintuples [y, x0, x1, surface, level] — far smaller than one object per run.
  runs,
  buildings: layout.buildings.map((b) => ({
    id: b.id ?? null,
    name: b.name ?? null,
    kind: b.kind ?? b.building_type ?? null,
    cell: b.anchor_cell_sw,
    center: b.center_m,
    size: b.collision?.[0]?.size_m ?? null,
  })),
  plots: [...(layout.plots.existing ?? []), ...(layout.plots.added ?? [])].map((p) => ({
    id: p.id,
    cell: p.anchor_cell_sw,
    footprint: p.footprint_tiles,
    district: p.district ?? null,
    edge: p.customer_edge ?? null,
  })),
  poi: layout.points_of_interest.map((p) => ({ id: p.id, name: p.name, kind: p.kind, cell: p.anchor_cell ?? null, level: p.level ?? null })),
};

const dest = resolve(root, "game/public/world/highlands-rivers.json");
mkdirSync(dirname(dest), { recursive: true });
writeFileSync(dest, JSON.stringify(out));

const counts = {};
for (let i = 3; i < runs.length; i += 5) counts[surfaces[runs[i]]] = (counts[surfaces[runs[i]]] ?? 0) + 1;
console.log(`surfaces: ${surfaces.length} -> ${surfaces.join(", ")}`);
console.log(`runs: ${runs.length / 5} (was ${grid.rows.reduce((a, r) => a + r.runs.length, 0)} before levels)`);
console.log(`buildings: ${out.buildings.length}  plots: ${out.plots.length}  poi: ${out.poi.length}`);
let unresolved = 0;
for (let i = 0; i < levelGrid.length; i += 1) if (surfaceGrid[i] >= 0 && levelGrid[i] < 0) unresolved += 1;
console.log(`tiles without a level after BFS: ${unresolved}`);
console.log(`wrote ${dest} (${(JSON.stringify(out).length / 1024).toFixed(0)} KB)`);
