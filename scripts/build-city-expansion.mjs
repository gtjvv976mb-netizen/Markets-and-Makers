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
// The city plain. 89% of the authored road network sits at level 0 and the terraces
// above it are highlands — the mountain, the overlook, the falls. Streets and lots stay
// off them: a grid climbing a mountainside is not a city, and the world already says so.
const GROUND_LEVEL = 0;
const isPlain = (x, y) => level.get(key(x, y)) === GROUND_LEVEL;
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

// --- the plan ------------------------------------------------------------
// Three attempts taught the shape of this. A grid dropped over the whole map gives
// fragments — 47 overlapping cells, 30 disconnected components, 68% of ends reaching
// nothing. Filtering that afterwards deletes most of it. Growing only from the ends of
// authored roads is connected but tiny, because the open land does not touch them.
//
// The land is in large contiguous pieces: 25,407 free cells on the plain in regions of
// 5,229, 4,439, 4,403 and so on, separated by the existing roads, paths and water. So
// each region gets its own grid, laid inside its own boundary. A region already abuts
// the roads that divide it from its neighbours, so a street laid up to that edge joins
// the city without a connector. Every street must still meet something at one end.

const STREET_SPACING = 14;   // block depth. Swept against 14, 24 and 30: at 20 the
                             // network is 43% smaller than at 14 and yields MORE
                             // frontage, because a deeper block fits more plots along
                             // each side than a tight grid fits between its roads.
const MIN_RUN = 8;
const MIN_REGION = 700;

const authoredRoad = new Set();
for (const [k, surfaceName] of surface) {
  if (surfaceName === "road" || surfaceName === "bridge") authoredRoad.add(k);
}

// Free ground: on the plain, not reserved, not already built on.
const free = new Set();
for (const [k] of level) {
  if (level.get(k) !== GROUND_LEVEL) continue;
  if (reserved.has(k)) continue;
  free.add(k);
}

// Contiguous regions of it. The roads and paths that separate them become the edges a
// new grid meets, which is what connects each neighbourhood to the city.
const regions = [];
const visited = new Set();
for (const start of free) {
  if (visited.has(start)) continue;
  const region = new Set();
  const stack = [start];
  while (stack.length > 0) {
    const cell = stack.pop();
    if (visited.has(cell) || !free.has(cell)) continue;
    visited.add(cell);
    region.add(cell);
    const [x, y] = cell.split(",").map(Number);
    stack.push(key(x + 1, y), key(x - 1, y), key(x, y + 1), key(x, y - 1));
  }
  if (region.size >= MIN_REGION) regions.push(region);
}
regions.sort((a, b) => b.size - a.size);

// Which direction claimed each cell. A crossing shares its cells with the road it
// crosses — that is what a junction is — so only a road running the SAME way may not
// take ground already spoken for. Treating every claimed cell as blocked stopped every
// street at its first crossing, leaving a network with no junctions at all.
const claimedAxis = new Map();
const claimed = { has: (c) => claimedAxis.has(c), add: (c, axis) => claimedAxis.set(c, axis) };
const cellsOf = (street) => {
  const fixed = Math.floor(street.centre);
  const out = [];
  for (let k = street.from; k <= street.to; k += 1) {
    for (const f of [fixed, fixed + 1]) out.push(street.axis === 0 ? key(k, f) : key(f, k));
  }
  return out;
};

const candidates = [];
for (const region of regions) {
  const xs = [...region].map((c) => Number(c.split(",")[0]));
  const ys = [...region].map((c) => Number(c.split(",")[1]));
  const bounds = { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
  // Offset each region's grid by its own origin, so neighbourhoods do not all share
  // one continent-wide alignment — the city reads as districts, not as graph paper.
  const phase = (Math.abs(bounds.x0 * 7 + bounds.y0 * 13)) % STREET_SPACING;

  // A new street may not run flush against an existing one. Forbidding only the road
  // cells themselves let a street hug an authored carriageway, and the two then read as
  // one doubled road with two centre lines down it — three of those, one running
  // alongside for 74 metres. Two cells of verge either side keeps them separate roads.
  const VERGE = 2;
  const layable = (axis, fixed, k) => {
    const a = axis === 0 ? key(k, fixed) : key(fixed, k);
    const b = axis === 0 ? key(k, fixed + 1) : key(fixed + 1, k);
    if (!region.has(a) || !region.has(b)) return false;
    if (claimedAxis.get(a) === axis || claimedAxis.get(b) === axis) return false;
    for (let offset = 1; offset <= VERGE; offset += 1) {
      for (const across of [fixed - offset, fixed + 1 + offset]) {
        const neighbour = axis === 0 ? key(k, across) : key(across, k);
        if (!authoredRoad.has(neighbour) && !claimed.has(neighbour)) continue;
        // A road beside us is only a problem if it runs the same way. A crossing road
        // also occupies these cells, and rejecting those stopped streets from ever
        // meeting — which left the network with no junctions at all.
        const ahead = axis === 0 ? key(k + 1, across) : key(across, k + 1);
        const behind = axis === 0 ? key(k - 1, across) : key(across, k - 1);
        const runsParallel = (authoredRoad.has(ahead) || claimed.has(ahead))
          && (authoredRoad.has(behind) || claimed.has(behind));
        if (runsParallel) return false;
      }
    }
    return true;
  };

  for (const axis of [0, 1]) {
    const lo = axis === 0 ? bounds.y0 : bounds.x0;
    const hi = axis === 0 ? bounds.y1 : bounds.x1;
    for (let fixed = lo + phase; fixed <= hi; fixed += STREET_SPACING) {
      const from = axis === 0 ? bounds.x0 : bounds.y0;
      const to = axis === 0 ? bounds.x1 : bounds.y1;
      let start = null;
      const flush = (end) => {
        if (start !== null && end - start >= MIN_RUN) {
          const street = { axis, centre: fixed + 0.5, from: start, to: end };
          candidates.push(street);
          for (const c of cellsOf(street)) claimed.add(c, axis);
        }
        start = null;
      };
      for (let k = from; k <= to; k += 1) {
        if (!layable(axis, fixed, k)) { flush(k - 1); continue; }
        if (start === null) start = k;
      }
      flush(to);
    }
  }
}

// --- keep only what joins something --------------------------------------
const candidateCells = new Map();
candidates.forEach((street, index) => {
  for (const c of cellsOf(street)) candidateCells.set(c, index);
});
const meetsSomething = (street, index) => {
  const fixed = Math.floor(street.centre);
  for (let k = street.from; k <= street.to; k += 1) {
    const probes = street.axis === 0
      ? [key(k, fixed - 1), key(k, fixed + 2)]
      : [key(fixed - 1, k), key(fixed + 2, k)];
    for (const probe of probes) {
      if (authoredRoad.has(probe)) return true;
      const owner = candidateCells.get(probe);
      if (owner !== undefined && owner !== index) return true;
    }
  }
  // The ends too: a street running up to a road joins it end-on.
  for (const end of [street.from - 1, street.to + 1]) {
    const probes = street.axis === 0
      ? [key(end, fixed), key(end, fixed + 1)]
      : [key(fixed, end), key(fixed + 1, end)];
    if (probes.some((c) => authoredRoad.has(c) || candidateCells.has(c))) return true;
  }
  return false;
};

const joined = candidates.filter((street, index) => meetsSomething(street, index));

// A street that survived the join test can still be alone with one partner in a corner
// of the map. Flood the kept set and drop anything in a component of one or two.
const keptCells = new Map();
joined.forEach((street, index) => { for (const c of cellsOf(street)) keptCells.set(c, index); });
const links = new Map();
joined.forEach((_, index) => links.set(index, new Set()));
joined.forEach((street, index) => {
  for (const c of cellsOf(street)) {
    const [x, y] = c.split(",").map(Number);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const other = keptCells.get(key(x + dx, y + dy));
      if (other !== undefined && other !== index) { links.get(index).add(other); links.get(other).add(index); }
      if (authoredRoad.has(key(x + dx, y + dy))) links.get(index).add(-1);
    }
  }
});
const componentOf = new Map();
let componentId = 0;
for (const index of links.keys()) {
  if (componentOf.has(index)) continue;
  const stack = [index];
  const members = [];
  while (stack.length > 0) {
    const node = stack.pop();
    if (componentOf.has(node)) continue;
    componentOf.set(node, componentId);
    members.push(node);
    for (const next of links.get(node) ?? []) if (next !== -1 && !componentOf.has(next)) stack.push(next);
  }
  const touchesCity = members.some((m) => links.get(m)?.has(-1));
  if (members.length <= 2 && !touchesCity) for (const m of members) componentOf.set(m, -1);
  componentId += 1;
}
let newRoads = joined.filter((_, index) => componentOf.get(index) !== -1);
const roadCells = new Set();
for (const street of newRoads) for (const c of cellsOf(street)) roadCells.add(c);

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
  for (let x = cx; x < cx + PLOT; x += 1) {
    for (let y = cy; y < cy + PLOT; y += 1) {
      const k = key(x, y);
      if (!isFree(x, y) || !isPlain(x, y)) return false;
      if (reserved.has(k) || roadCells.has(k) || taken.has(k)) return false;
    }
  }
  return true;
};

for (let y = min[1]; y + PLOT <= max[1]; y += 1) {
  for (let x = min[0]; x + PLOT <= max[0]; x += 1) {
    if (!flatAndFree(x, y) || !adjacentToRoad(x, y)) continue;
    // Neighbouring plots share a boundary, as they do on a real street; only the road
    // side needs clearance and the grid already provides it.
    for (let px = x; px < x + PLOT; px += 1) {
      for (let py = y; py < y + PLOT; py += 1) taken.add(key(px, py));
    }
    newPlots.push({ x, y });
  }
}

// --- prune: no road that serves nothing, no tail that reaches nothing -----
// A grid laid before the plots exist cannot know which of its streets earn their
// place. With the plots down, two things become answerable: a street either carries
// frontage or carries traffic between two other streets, and anything past its last
// junction or last plot is a tail hanging into a field. Both passes repeat, because
// dropping a street turns its neighbour's junction into a dead end.
/**
 * Where a street is actually crossed.
 *
 * The first version asked whether the cell beside the carriageway belonged to any road,
 * which is true along the entire length of a street running parallel to one — so every
 * street looked fully junctioned and the prune removed a single road out of seventy-six.
 * A junction is a road running ACROSS this one: perpendicular, and spanning it.
 */
const junctionsOn = (street, others) => {
  const fixed = Math.floor(street.centre);
  const found = [];
  const crosses = (otherFixed, otherFrom, otherTo) =>
    otherFixed >= street.from - 1 && otherFixed <= street.to + 1
    && otherFrom <= fixed + 1 && otherTo >= fixed;

  for (const other of others) {
    if (other === street || other.axis === street.axis) continue;
    const otherFixed = Math.floor(other.centre);
    if (crosses(otherFixed, other.from, other.to)) found.push(otherFixed);
  }
  // Meeting the authored network counts, and it happens at the ENDS. A run stops when
  // it reaches an authored road, because those cells are not free ground — so the two
  // meet as a T, never as a crossing. Requiring road on both sides could therefore
  // never be true, which hid every junction with the existing city and left the 2-core
  // deleting streets that were properly connected to it.
  for (const [end, step] of [[street.from, -1], [street.to, 1]]) {
    for (let reach = 1; reach <= 3; reach += 1) {
      const at = end + step * reach;
      const probes = street.axis === 0
        ? [key(at, fixed), key(at, fixed + 1)]
        : [key(fixed, at), key(fixed + 1, at)];
      if (probes.some((c) => authoredRoad.has(c))) { found.push(end); break; }
    }
  }
  // And along its length, where an authored road crosses it.
  for (let k = street.from; k <= street.to; k += 1) {
    const sides = street.axis === 0
      ? [key(k, fixed - 1), key(k, fixed + 2), key(k, fixed - 2), key(k, fixed + 3)]
      : [key(fixed - 1, k), key(fixed + 2, k), key(fixed - 2, k), key(fixed + 3, k)];
    if (sides.filter((c) => authoredRoad.has(c)).length >= 2) found.push(k);
  }
  return [...new Set(found)].sort((a, b) => a - b);
};

const frontageOn = (street) => {
  const fixed = Math.floor(street.centre);
  const found = [];
  for (const plot of newPlots) {
    for (let k = street.from; k <= street.to; k += 1) {
      const touches = street.axis === 0
        ? (k >= plot.x - 1 && k <= plot.x + PLOT && (fixed + 2 === plot.y || fixed - 1 === plot.y + PLOT - 1))
        : (k >= plot.y - 1 && k <= plot.y + PLOT && (fixed + 2 === plot.x || fixed - 1 === plot.x + PLOT - 1));
      if (touches) { found.push(k); break; }
    }
  }
  return found;
};

// Trim to the 2-core: every street must run from one junction to another, with nothing
// dangling off either end. This is the graph version of "no broken roads" — repeatedly
// shorten each street to its outermost crossings and drop any street left with fewer
// than two, because removing one street turns its neighbour's junction into a dead end
// and the process has to settle.
{
  const sample = newRoads.slice(0, 3).map((st) => `${st.axis === 0 ? "EW" : "NS"}@${st.centre} ${st.from}..${st.to} junctions=${junctionsOn(st, newRoads).length}`);
}
// The 2-core: drop any street with fewer than two junctions, and repeat, because
// removing one turns its neighbour's junction into a dead end. Only dropping here —
// trimming inside the loop shrinks a street until it loses the very junctions that
// justified it, and the whole network spirals to nothing in a dozen passes.
for (let pass = 0; pass < 20; pass += 1) {
  const before = newRoads.length;
  newRoads = newRoads.filter((street) => junctionsOn(street, newRoads).length >= 2);
  if (newRoads.length === before) break;
}

// Now trim once, to the outermost crossing at each end. What is left runs junction to
// junction with nothing dangling.
newRoads = newRoads
  .map((street) => {
    const meets = junctionsOn(street, newRoads);
    if (meets.length < 2) return null;
    return { ...street, from: Math.max(street.from, meets[0]), to: Math.min(street.to, meets[meets.length - 1]) };
  })
  .filter((street) => street !== null && street.to - street.from >= 4);

// Finally, keep only what the city can actually reach. Anything else is a road nobody
// can drive to, however well formed it looks on its own.
const reachable = new Set();
const cellOwner = new Map();
newRoads.forEach((street, index) => { for (const c of cellsOf(street)) cellOwner.set(c, index); });
const frontier = [];
newRoads.forEach((street, index) => {
  for (const c of cellsOf(street)) {
    const [x, y] = c.split(",").map(Number);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (authoredRoad.has(key(x + dx, y + dy))) { reachable.add(index); frontier.push(index); return; }
    }
  }
});
while (frontier.length > 0) {
  const index = frontier.pop();
  for (const c of cellsOf(newRoads[index])) {
    const [x, y] = c.split(",").map(Number);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const other = cellOwner.get(key(x + dx, y + dy));
      if (other === undefined || reachable.has(other)) continue;
      reachable.add(other);
      frontier.push(other);
    }
  }
}
newRoads = newRoads.filter((_, index) => reachable.has(index));

// The plot pass ran against the pre-prune roads, so rebuild the cell set from what
// actually survived — and drop any plot whose street did not. A lot with no frontage
// is a lot nobody can reach, which is worse than one that was never offered.
roadCells.clear();
for (const street of newRoads) for (const c of cellsOf(street)) roadCells.add(c);

const withFrontage = newPlots.filter((plot) => {
  for (let x = plot.x - 1; x <= plot.x + PLOT; x += 1) {
    for (let y = plot.y - 1; y <= plot.y + PLOT; y += 1) {
      if (roadCells.has(key(x, y)) || authoredRoad.has(key(x, y))) return true;
    }
  }
  return false;
});
const strandedPlots = newPlots.length - withFrontage.length;
newPlots.length = 0;
newPlots.push(...withFrontage);

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
  // All frontage is on the plain, so height cannot set the price. Distance from the
  // civic centre can: the closer to City Hall, the dearer the ground.
  const centreDistance = Math.hypot((plot.x + PLOT / 2) * TILE - 0, -(plot.y + PLOT / 2) * TILE - -16);
  const price = Math.round(260 - Math.min(150, centreDistance * 0.6));
  return [`GX${String(index + 1).padStart(3, "0")}`, district, plot.x, plot.y, plot.x + PLOT - 1, plot.y + PLOT - 1, price];
});

// Check the output rather than trust the loop that made it. Note the floor: a street
// centre sits on a half cell, and truncating toward zero reads the wrong row for every
// negative coordinate — which is exactly how a first pass at this check reported
// nineteen phantom failures.
const offPlain = [];
for (const street of newRoads) {
  const fixed = Math.floor(street.centre);
  for (let k = street.from; k <= street.to; k += 1) {
    for (const f of [fixed, fixed + 1]) {
      const cell = street.axis === 0 ? [k, f] : [f, k];
      if (!isPlain(...cell)) offPlain.push(`street ${cell}`);
    }
  }
}
for (const plot of newPlots) {
  for (let x = plot.x; x < plot.x + PLOT; x += 1) {
    for (let y = plot.y; y < plot.y + PLOT; y += 1) {
      if (!isPlain(x, y)) offPlain.push(`plot ${x},${y}`);
    }
  }
}
if (offPlain.length > 0) {
  throw new Error(`${offPlain.length} cells are off the plain, first: ${offPlain.slice(0, 3).join(", ")}`);
}

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
console.log(`every street and plot cell verified on the plain (level ${GROUND_LEVEL})`);
console.log(`dropped ${strandedPlots} plots left without frontage by the prune`);
