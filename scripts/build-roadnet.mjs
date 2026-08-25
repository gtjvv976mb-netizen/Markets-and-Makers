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
  for (const [x, y] of sorted) {
    const fixed = horizontal ? y : x;
    const start = horizontal ? x : y;
    if (claimed.has(`${fixed}:${start}`)) continue;
    const partner = horizontal ? key(x, y + 1) : key(x + 1, y);
    if (!cells.has(partner)) continue;
    let end = start;
    for (;;) {
      const next = end + 1;
      const a = horizontal ? key(next, y) : key(x, next);
      const b = horizontal ? key(next, y + 1) : key(x + 1, next);
      if (!cells.has(a) || !cells.has(b)) break;
      end = next;
    }
    for (let k = start; k <= end; k += 1) claimed.add(`${fixed}:${k}`);
    if (end - start >= minimumLength) found.push({ fixed, start, end });
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

const out = {
  tileSize: TILE,
  laneWidthCells: 2,
  /** [row, x0, x1] — every carriageway cell, so junctions and stubs are never missing. */
  roadRuns: runs(road),
  pathRuns: runs(walk),
  carriageways: [
    ...carriageways.map((c) => [c.axis === "ew" ? 0 : 1, c.centre, c.from, c.to]),
    ...expansion.map((c) => [c.axis, c.centre, c.from, c.to]),
  ],
  footways: footways.map((c) => [c.axis === "ew" ? 0 : 1, c.centre, c.from, c.to]),
};

const dest = resolve(root, "game/public/world/roadnet.json");
mkdirSync(dirname(dest), { recursive: true });
writeFileSync(dest, JSON.stringify(out));
const cells = carriageways.reduce((a, c) => a + (c.to - c.from), 0);
console.log(`road cells ${road.size} in ${out.roadRuns.length} runs (${expansion.length} expansion streets), path cells ${walk.size} in ${out.pathRuns.length} runs`);
console.log(`carriageways ${carriageways.length} (${cells} cells of centreline), footways ${footways.length}`);
console.log(`wrote ${dest} (${(JSON.stringify(out).length / 1024).toFixed(1)} KB)`);
