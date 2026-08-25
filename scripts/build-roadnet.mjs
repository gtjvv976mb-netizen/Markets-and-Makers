// Extracts the drivable road network and the footpaths from the authored tile grid.
//
// The terrain marks every cell as road, bridge or path, but a cell alone cannot say
// which way a road runs — carriageways are two cells wide, so every cell has neighbours
// on both axes and looks like a junction. Orientation only exists at the level of a
// band, so bands are what this extracts: a run of two parallel cell rows. That gives a
// centreline to paint the lane divider along, an edge to stand lamps on, and a path for
// traffic to follow.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const grid = JSON.parse(readFileSync(resolve(root, "game/public/assets/world/highlands-rivers-v1/terrain-grid.json"), "utf8"));
const layout = JSON.parse(readFileSync(resolve(root, "game/public/assets/world/highlands-rivers-v1/layout.json"), "utf8"));
const TILE = layout.coordinate_contract.tile_size_m;

const road = new Set();
const walk = new Set();
const key = (x, y) => `${x},${y}`;
for (const row of grid.rows) {
  for (const run of row.runs) {
    const target = run.surface === "road" || run.surface === "bridge" ? road
      : run.surface === "path" ? walk : null;
    if (!target) continue;
    for (let x = run.x0; x <= run.x1; x += 1) target.add(key(x, row.y));
  }
}

/** Maximal runs of two parallel cell rows — one carriageway. */
function bands(cells, horizontal, minimumLength) {
  const found = [];
  const claimed = new Set();
  const sorted = [...cells].map((k) => k.split(",").map(Number)).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const at = (along, across) => (horizontal ? key(along, across) : key(across, along));

  for (const [x, y] of sorted) {
    const fixed = horizontal ? y : x;
    const start = horizontal ? x : y;
    if (claimed.has(`${fixed}:${start}`)) continue;
    if (!cells.has(at(start, fixed + 1))) continue;

    // How wide is this road here? A carriageway is two cells, but the world also has
    // four- and eight-cell expanses — boulevards and forecourts. Taking two rows at a
    // time split those into parallel bands sitting flush against each other, which is
    // what put two centre lines down one road and made them look doubled.
    let width = 1;
    while (cells.has(at(start, fixed + width))) width += 1;

    let end = start;
    for (;;) {
      const next = end + 1;
      let ok = true;
      for (let w = 0; w < width; w += 1) if (!cells.has(at(next, fixed + w))) { ok = false; break; }
      if (!ok) break;
      end = next;
    }

    for (let k = start; k <= end; k += 1) {
      for (let w = 0; w < width; w += 1) claimed.add(`${fixed + w}:${k}`);
    }
    // Only a true carriageway gets a centre line down it. Anything wider is a
    // boulevard or a forecourt: it keeps its asphalt, drawn from the cell runs, but a
    // dashed line through the middle of a plaza would be nonsense.
    if (end - start >= minimumLength && width <= 3) {
      found.push({ fixed, start, end, width });
    }
  }
  return found;
}

/** Single-cell runs, for footpaths. */
function lines(cells, horizontal, minimumLength) {
  const found = [];
  const claimed = new Set();
  const sorted = [...cells].map((k) => k.split(",").map(Number)).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  for (const [x, y] of sorted) {
    const fixed = horizontal ? y : x;
    const start = horizontal ? x : y;
    if (claimed.has(`${fixed}:${start}`)) continue;
    let end = start;
    for (;;) {
      const next = end + 1;
      if (!cells.has(horizontal ? key(next, y) : key(x, next))) break;
      end = next;
    }
    for (let k = start; k <= end; k += 1) claimed.add(`${fixed}:${k}`);
    if (end - start >= minimumLength) found.push({ fixed, start, end });
  }
  return found;
}

// A band's centreline sits on the shared edge of its two rows, half a cell in.
const carriageways = [
  ...bands(road, true, 3).map((b) => ({ axis: "ew", centre: b.fixed + 0.5, from: b.start, to: b.end })),
  ...bands(road, false, 3).map((b) => ({ axis: "ns", centre: b.fixed + 0.5, from: b.start, to: b.end })),
];
const footways = [
  ...lines(walk, true, 2).map((b) => ({ axis: "ew", centre: b.fixed, from: b.start, to: b.end })),
  ...lines(walk, false, 2).map((b) => ({ axis: "ns", centre: b.fixed, from: b.start, to: b.end })),
];

// Bands describe direction, but they cannot describe a junction — a crossing belongs to
// two bands at once and to neither's centreline. Surfacing from bands alone therefore
// left 207 road cells and 52 path cells undrawn: exactly the junctions, the short
// connecting stubs, and the odd-shaped corners. So the surface is rasterised from every
// cell instead, and bands are kept only for what genuinely needs an axis — the centre
// line, the lamp spacing and the traffic. Lane markings stopping at a junction is also
// what real road marking does.
function runs(cells) {
  const byRow = new Map();
  for (const k of cells) {
    const [x, y] = k.split(",").map(Number);
    const row = byRow.get(y) ?? [];
    row.push(x);
    byRow.set(y, row);
  }
  const out = [];
  for (const [y, xs] of [...byRow].sort((a, b) => a[0] - b[0])) {
    xs.sort((a, b) => a - b);
    let start = xs[0];
    let previous = xs[0];
    for (let i = 1; i <= xs.length; i += 1) {
      const x = xs[i];
      if (x === previous + 1) { previous = x; continue; }
      out.push([y, start, previous]);
      start = x;
      previous = x;
    }
  }
  return out;
}

// The expansion grid is laid over land the authored world left without frontage. It is
// drawn from here rather than baked into the terrain, so the asphalt covers the ground
// while walkability still comes from the terrain underneath.
let expansion = [];
try {
  expansion = JSON.parse(readFileSync(resolve(root, "scripts/.city-expansion-roads.json"), "utf8"));
} catch {
  // Not generated yet; the authored network stands on its own.
}
for (const street of expansion) {
  const horizontal = street.axis === 0;
  const fixed = Math.floor(street.centre);
  for (let k = street.from; k <= street.to; k += 1) {
    road.add(horizontal ? key(k, fixed) : key(fixed, k));
    road.add(horizontal ? key(k, fixed + 1) : key(fixed + 1, k));
  }
}

// --- plan the network as a whole -----------------------------------------
// A road that stops in a field reads as broken whether the world authored it or this
// script laid it, so the prune covers both. Two rules govern it. A carriageway must
// end where another road continues or turns away, and removing one must never split
// the city in two. The second rule is what makes the first safe: pruning on dead ends
// alone took out the link roads between districts and left five separate networks that
// each looked correct in isolation.
const allBands = [
  ...carriageways.map((c) => ({ axis: c.axis === "ew" ? 0 : 1, centre: c.centre, from: c.from, to: c.to })),
  ...expansion.map((c) => ({ axis: c.axis, centre: c.centre, from: c.from, to: c.to })),
];

const bandCells = (band) => {
  const fixed = Math.floor(band.centre);
  const out = [];
  for (let k = band.from; k <= band.to; k += 1) {
    for (const f of [fixed, fixed + 1]) out.push(band.axis === 0 ? key(k, f) : key(f, k));
  }
  return out;
};

// Wide authored ground — the plaza, forecourts, the blobs where several streets meet.
// A carriageway arriving at one has arrived somewhere, so this counts as road surface
// and is never treated as a stub.
const wide = new Set();
for (const c of road) {
  const [x, y] = c.split(",").map(Number);
  let solid = true;
  for (let dx = -1; dx <= 1 && solid; dx += 1) {
    for (let dy = -1; dy <= 1; dy += 1) if (!road.has(key(x + dx, y + dy))) { solid = false; break; }
  }
  if (!solid) continue;
  for (let dx = -1; dx <= 1; dx += 1) for (let dy = -1; dy <= 1; dy += 1) wide.add(key(x + dx, y + dy));
}

// The surface the game draws is every road cell, not just the ones a band claims: the
// authored grid also has junction blobs and odd corners that no two-wide run covers, and
// those are exactly what joins one district to the next. Measuring connectivity on the
// band cells alone reported 32 real streets as stranded and pruned the city to nothing.
// So a cell that no band ever covered is permanent, and a cell that is carriageway
// surface lives only while some carriageway still runs over it.
const bandSurface = new Set();
for (const b of allBands) for (const c of bandCells(b)) bandSurface.add(c);

const cellsOf = (list) => {
  const covered = new Set();
  for (const b of list) for (const c of bandCells(b)) covered.add(c);
  const set = new Set();
  for (const c of road) if (!bandSurface.has(c) || wide.has(c) || covered.has(c)) set.add(c);
  return set;
};

/** The largest connected body of a cell set. The seed is never guessed: flooding from
 *  "the first band" landed on a stray blob and mis-stranded a third of the network. */
const mainBody = (cells) => {
  const unvisited = new Set(cells);
  let best = new Set();
  while (unvisited.size) {
    const seed = unvisited.values().next().value;
    const seen = new Set([seed]);
    const stack = [seed];
    unvisited.delete(seed);
    while (stack.length) {
      const [x, y] = stack.pop().split(",").map(Number);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const k = key(x + dx, y + dy);
        if (cells.has(k) && !seen.has(k)) { seen.add(k); unvisited.delete(k); stack.push(k); }
      }
    }
    if (seen.size > best.size) best = seen;
  }
  return best;
};

/** Flood from one seed and report whether every required cell was reached. */
const allReachable = (cells, seed, required) => {
  const seen = new Set([seed]);
  const stack = [seed];
  while (stack.length) {
    const [x, y] = stack.pop().split(",").map(Number);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const k = key(x + dx, y + dy);
      if (cells.has(k) && !seen.has(k)) { seen.add(k); stack.push(k); }
    }
  }
  for (const r of required) if (!seen.has(r)) return false;
  return true;
};

const connected = (list) => {
  if (list.length === 0) return true;
  const cells = cellsOf(list);
  const required = [];
  for (const b of list) for (const c of bandCells(b)) required.push(c);
  return allReachable(cells, required[0], required);
};

/** Does each end meet road that carries on or turns away? The verifier asks this
 *  same question of the finished file, so the builder and the check share one ruler. */
const openEnds = (band, cells) => {
  const fixed = Math.floor(band.centre);
  const res = [];
  for (const [end, step] of [[band.from, -1], [band.to, 1]]) {
    const beyond = end + step;
    const ahead = band.axis === 0
      ? [key(beyond, fixed), key(beyond, fixed + 1)]
      : [key(fixed, beyond), key(fixed + 1, beyond)];
    const across = band.axis === 0
      ? [key(end, fixed - 1), key(end, fixed + 2)]
      : [key(fixed - 1, end), key(fixed + 2, end)];
    res.push(ahead.some((c) => cells.has(c)) || across.some((c) => cells.has(c)));
  }
  return res;
};

// Start from the main body: a handful of stray cells sit off on their own in the
// authored grid, and they are not worth protecting during the prune.
let surviving = allBands.slice();
{
  const body = mainBody(cellsOf(surviving));
  surviving = surviving.filter((b) => bandCells(b).some((c) => body.has(c)));
}
const before = surviving.length;
const originalLength = surviving.reduce((n, b) => n + (b.to - b.from), 0);

/** Where along a band another road meets it, in band coordinates. */
const crossings = (band, cells) => {
  const fixed = Math.floor(band.centre);
  const found = [];
  for (let k = band.from; k <= band.to; k += 1) {
    const across = band.axis === 0
      ? [key(k, fixed - 1), key(k, fixed + 2)]
      : [key(fixed - 1, k), key(fixed + 2, k)];
    if (across.some((c) => cells.has(c))) found.push(k);
  }
  return found;
};

// A street whose far end runs out into a field is not a street to delete — it is a
// street that is too long. Cutting it back to its last junction keeps the frontage and
// removes the stub, where deleting the whole band threw away 45% of the network and
// stranded 111 lots that had perfectly good road outside them.
const settle = () => {
  for (let pass = 0; pass < 40; pass += 1) {
    let changed = 0;
    for (const band of [...surviving]) {
      const cells = cellsOf(surviving);
      const ends = openEnds(band, cells);
      if (ends.every(Boolean)) continue;
      const met = crossings(band, cells);
      const from = ends[0] ? band.from : met[0];
      const to = ends[1] ? band.to : met[met.length - 1];
      const worthKeeping = met.length > 0 && to - from >= 4;
      const rest = surviving.filter((b) => b !== band);
      if (worthKeeping) {
        const was = [band.from, band.to];
        band.from = from;
        band.to = to;
        if (connected(surviving) && (band.from !== was[0] || band.to !== was[1])) { changed += 1; continue; }
        [band.from, band.to] = was;
      }
      if (!connected(rest)) continue;          // the only link between two districts
      surviving = rest;
      changed += 1;
    }
    if (changed === 0) break;
  }
};
settle();

// Two streets a couple of gardens apart serve the same frontage twice. At a 2 m tile a
// gap of six cells leaves 8 m between kerbs — near enough that the pair reads as one
// wide road badly drawn. Drop the shorter of each such pair, connectivity permitting.
const SIDE_BY_SIDE = 6;
for (let pass = 0; pass < 12; pass += 1) {
  let cut = 0;
  outer: for (const a of surviving) {
    for (const b of surviving) {
      if (a === b || a.axis !== b.axis) continue;
      if (Math.abs(a.centre - b.centre) > SIDE_BY_SIDE) continue;
      if (Math.min(a.to, b.to) - Math.max(a.from, b.from) < 4) continue;
      const drop = (a.to - a.from) <= (b.to - b.from) ? a : b;
      const rest = surviving.filter((s) => s !== drop);
      if (!connected(rest)) continue;
      surviving = rest;
      cut += 1;
      break outer;
    }
  }
  if (cut === 0) break;
}
settle();

// A lane the world drew by hand is not two cells wide, so no band claims it and the
// carriageway prune cannot see it: two winding country lanes ran off into open grass
// and survived every check, because every check was asking about bands. Erode the
// surface as well. A road cell with one neighbour is the tip of a tail, and removing
// tips can never separate anything — a cell with a single link is nothing's bridge.
const erodeTails = () => {
  let gone = 0;
  for (;;) {
    const tips = [];
    for (const c of road) {
      const [x, y] = c.split(",").map(Number);
      let links = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (road.has(key(x + dx, y + dy))) links += 1;
      if (links <= 1) tips.push(c);
    }
    if (tips.length === 0) return gone;
    for (const c of tips) road.delete(c);
    gone += tips.length;
  }
};

// Where the roads exist to take you: every lot, every civic footprint, every marked
// point of interest. A carriageway earns its place by connecting these; a lane that
// reaches none of them and that nothing routes through is scenery pretending to be a
// road, and two of them wandered off into open grass for want of this test.
const destinations = new Set();
const addRect = (x0, y0, x1, y1) => {
  for (let x = x0 - 1; x <= x1 + 1; x += 1) for (let y = y0 - 1; y <= y1 + 1; y += 1) destinations.add(key(x, y));
};
for (const file of ["game/src/highlandsWorld.ts", "game/src/generatedPlots.ts"]) {
  const text = readFileSync(resolve(root, file), "utf8");
  for (const m of text.matchAll(/\["\w+","[^"]*",(-?\d+),(-?\d+),(-?\d+),(-?\d+)/g)) {
    addRect(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]));
  }
}
for (const b of layout.buildings ?? []) {
  const bounds = b.occupied_bounds_cells;
  if (bounds) addRect(bounds.min[0], bounds.min[1], bounds.max[0], bounds.max[1]);
}
for (const poi of layout.points_of_interest ?? []) {
  const cell = poi.portal_anchor_cell;
  if (cell) addRect(cell[0], cell[1], cell[0], cell[1]);
}

/** Road that no carriageway claims, grouped into the shapes it actually forms. */
const looseClusters = () => {
  const claimed = new Set();
  for (const b of surviving) for (const c of bandCells(b)) claimed.add(c);
  const loose = new Set([...road].filter((c) => !claimed.has(c)));
  const seen = new Set();
  const clusters = [];
  for (const c of loose) {
    if (seen.has(c)) continue;
    const stack = [c];
    const group = [];
    seen.add(c);
    while (stack.length) {
      const [x, y] = stack.pop().split(",").map(Number);
      group.push(key(x, y));
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const k = key(x + dx, y + dy);
        if (loose.has(k) && !seen.has(k)) { seen.add(k); stack.push(k); }
      }
    }
    clusters.push(group);
  }
  return clusters;
};

const REACH = 3;
const dropPointlessLanes = () => {
  let gone = 0;
  for (const group of looseClusters()) {
    const serves = group.some((c) => {
      const [x, y] = c.split(",").map(Number);
      for (let dx = -REACH; dx <= REACH; dx += 1) {
        for (let dy = -REACH; dy <= REACH; dy += 1) if (destinations.has(key(x + dx, y + dy))) return true;
      }
      return false;
    });
    if (serves) continue;
    const without = new Set(road);
    for (const c of group) without.delete(c);
    if (without.size === 0) continue;
    if (mainBody(without).size !== without.size) continue;   // something routes through it
    for (const c of group) road.delete(c);
    gone += group.length;
  }
  return gone;
};

const keepMainBody = () => {
  const body = mainBody(cellsOf(surviving));
  road.clear();
  for (const c of body) road.add(c);
};

// Eroding a lane can leave the street that met it hanging, and trimming that street can
// expose another lane, so the two settle together rather than one after the other.
const startingCells = road.size;
let eroded = 0;
for (let round = 0; round < 6; round += 1) {
  keepMainBody();
  const gone = erodeTails() + dropPointlessLanes();
  eroded += gone;
  const cutBefore = surviving.length;
  settle();
  if (gone === 0 && surviving.length === cutBefore) break;
}
keepMainBody();
eroded += erodeTails() + dropPointlessLanes();
keepMainBody();

console.log(`carriageways ${allBands.length} -> ${surviving.length}; centreline ${originalLength} -> ${surviving.reduce((n, b) => n + (b.to - b.from), 0)} cells`);
console.log(`road cells ${startingCells} -> ${road.size} (${eroded} removed as tails and lanes that led nowhere)`);

const out = {
  tileSize: TILE,
  laneWidthCells: 2,
  /** [row, x0, x1] — every carriageway cell, so junctions and stubs are never missing. */
  roadRuns: runs(road),
  pathRuns: runs(walk),
  carriageways: surviving.map((c) => [c.axis, c.centre, c.from, c.to]),
  footways: footways.map((c) => [c.axis === "ew" ? 0 : 1, c.centre, c.from, c.to]),
};

const dest = resolve(root, "game/public/world/roadnet.json");
mkdirSync(dirname(dest), { recursive: true });
writeFileSync(dest, JSON.stringify(out));
const cells = carriageways.reduce((a, c) => a + (c.to - c.from), 0);
console.log(`road cells ${road.size} in ${out.roadRuns.length} runs, path cells ${walk.size} in ${out.pathRuns.length} runs`);
console.log(`carriageways ${carriageways.length} (${cells} cells of centreline), footways ${footways.length}`);
console.log(`wrote ${dest} (${(JSON.stringify(out).length / 1024).toFixed(1)} KB)`);
