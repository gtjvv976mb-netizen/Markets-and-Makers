// Repaints the terrain where the road prune took a road away.
//
// The world mesh bakes the authored roads as MAT_TERRAIN_PATH tiles — tan paving, laid
// cell by cell. scripts/build-roadnet.mjs decides which of those roads the game actually
// draws asphalt along, and it now removes the ones that led nowhere. The paving stayed
// behind: 1,065 tan tiles tracing streets that no longer exist, which is what "roads to
// nowhere" looks like once the asphalt is gone.
//
// Vertex data is not touched. Every tile keeps its position, normal and UV; only the
// triangle's material changes, by moving its indices into a primitive that uses the
// ground material its neighbours use.
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const world = resolve(root, "game/public/assets/world/highlands-rivers-v1");
const gltf = JSON.parse(readFileSync(resolve(world, "world.gltf"), "utf8"));
const buffers = gltf.buffers.map((b) => readFileSync(resolve(world, b.uri)));
const materialNames = gltf.materials.map((m) => m.name);
const materialIndex = new Map(materialNames.map((n, i) => [n, i]));

const COMPONENT = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const COMPONENTS_PER = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

function readAccessor(index) {
  const a = gltf.accessors[index];
  const view = gltf.bufferViews[a.bufferView];
  const Type = COMPONENT[a.componentType];
  const per = COMPONENTS_PER[a.type];
  const source = buffers[view.buffer ?? 0];
  const start = (view.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const stride = view.byteStride ?? per * Type.BYTES_PER_ELEMENT;
  const out = new Type(a.count * per);
  if (stride === per * Type.BYTES_PER_ELEMENT) {
    const bytes = source.subarray(start, start + a.count * stride);
    new Uint8Array(out.buffer).set(bytes);
  } else {
    for (let i = 0; i < a.count; i += 1) {
      const slice = new Type(source.buffer, source.byteOffset + start + i * stride, per);
      out.set(slice, i * per);
    }
  }
  return out;
}

// Every mesh, with the transform the scene graph gives it.
const placed = [];
const walk = (index, t, s) => {
  const n = gltf.nodes[index];
  const tr = n.translation ?? [0, 0, 0];
  const sc = n.scale ?? [1, 1, 1];
  const T = [t[0] + tr[0] * s[0], t[1] + tr[1] * s[1], t[2] + tr[2] * s[2]];
  const S = [s[0] * sc[0], s[1] * sc[1], s[2] * sc[2]];
  if (n.mesh !== undefined) placed.push({ mesh: n.mesh, T, S });
  for (const c of n.children ?? []) walk(c, T, S);
};
for (const r of gltf.scenes[gltf.scene ?? 0].nodes) walk(r, [0, 0, 0], [1, 1, 1]);

const TILE = 2;
const cellOf = (x, z) => `${Math.floor(x / TILE + 0.5)},${Math.floor(-z / TILE + 0.5)}`;

// Which roads the game still draws, and so which paving is now orphaned.
const net = JSON.parse(readFileSync(resolve(root, "game/public/world/roadnet.json"), "utf8"));
const drawn = new Set();
for (const [y, a, b] of net.roadRuns) for (let x = a; x <= b; x += 1) drawn.add(`${x},${y}`);

// Only paving that HAD a road and lost it. Asking instead "is there a road here now"
// repaints every jetty, boardwalk and bridge deck the world owns, because none of them
// were ever road cells — it wiped all 210 timber tiles on the first run.
const grid = JSON.parse(readFileSync(resolve(world, "terrain-grid.json"), "utf8"));
const orphaned = new Set();
for (const row of grid.rows) {
  for (const run of row.runs) {
    // Bridges are excluded on purpose. A bridge deck is a structure, not paving, and
    // repainting the ones whose road was pruned turned 31 cells of decking over the
    // river into cliff — stone slabs hanging in mid-air above the water.
    if (run.surface !== "road") continue;
    for (let x = run.x0; x <= run.x1; x += 1) {
      const k = `${x},${row.y}`;
      if (!drawn.has(k)) orphaned.add(k);
    }
  }
}

// What the ground is made of around here, so the repaint matches its surroundings
// rather than turning a mountain track into lawn.
const GROUND = ["MAT_TERRAIN_GRASS_SAGE", "MAT_TERRAIN_GRASS_DARK", "MAT_TERRAIN_SAND", "MAT_TERRAIN_CLIFF", "MAT_TERRAIN_ROCK", "MAT_MM_GREEN"];
const groundAt = new Map();
for (const { mesh, T, S } of placed) {
  for (const prim of gltf.meshes[mesh].primitives) {
    if (prim.material === undefined) continue;
    const name = materialNames[prim.material];
    if (!GROUND.includes(name)) continue;
    const pos = readAccessor(prim.attributes.POSITION);
    for (let i = 0; i < pos.length; i += 3) {
      const k = cellOf(T[0] + pos[i] * S[0], T[2] + pos[i + 2] * S[2]);
      const tally = groundAt.get(k) ?? new Map();
      tally.set(name, (tally.get(name) ?? 0) + 1);
      groundAt.set(k, tally);
    }
  }
}
const bestAt = new Map();
for (const [k, tally] of groundAt) {
  bestAt.set(k, [...tally].sort((a, b) => b[1] - a[1])[0][0]);
}
/** The ground a repainted tile should become: whatever surrounds it. */
const replacementFor = (cx, cy) => {
  for (let r = 0; r <= 6; r += 1) {
    const tally = new Map();
    for (let dx = -r; dx <= r; dx += 1) {
      for (let dy = -r; dy <= r; dy += 1) {
        const name = bestAt.get(`${cx + dx},${cy + dy}`);
        if (name) tally.set(name, (tally.get(name) ?? 0) + 1);
      }
    }
    if (tally.size) return [...tally].sort((a, b) => b[1] - a[1])[0][0];
  }
  return "MAT_TERRAIN_GRASS_SAGE";
};

// Repaint. Indices move between primitives; vertices never move.
// Only the flat tan paving. Timber is decking and boardwalk — structure that reads as
// built, and better left standing than turned into a patch of the wrong ground.
const REPAINT = ["MAT_TERRAIN_PATH"];
const appended = [];
let appendedBytes = buffers[1].length;
const addIndices = (values) => {
  while (appendedBytes % 4 !== 0) { appended.push(Buffer.from([0])); appendedBytes += 1; }
  const array = new Uint32Array(values);
  const bytes = Buffer.from(array.buffer, array.byteOffset, array.byteLength);
  const viewIndex = gltf.bufferViews.length;
  gltf.bufferViews.push({ buffer: 1, byteOffset: appendedBytes, byteLength: bytes.length, target: 34963 });
  appended.push(bytes);
  appendedBytes += bytes.length;
  const accessorIndex = gltf.accessors.length;
  gltf.accessors.push({ bufferView: viewIndex, componentType: 5125, count: values.length, type: "SCALAR" });
  return accessorIndex;
};

let repainted = 0;
const cellsRepainted = new Set();
for (const { mesh, T, S } of placed) {
  const added = [];
  for (const prim of gltf.meshes[mesh].primitives) {
    if (prim.material === undefined || prim.indices === undefined) continue;
    if (!REPAINT.includes(materialNames[prim.material])) continue;
    const pos = readAccessor(prim.attributes.POSITION);
    const idx = readAccessor(prim.indices);
    const keep = [];
    const moved = new Map();
    for (let t = 0; t < idx.length; t += 3) {
      const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]];
      const x = (pos[a * 3] + pos[b * 3] + pos[c * 3]) / 3;
      const z = (pos[a * 3 + 2] + pos[b * 3 + 2] + pos[c * 3 + 2]) / 3;
      const key = cellOf(T[0] + x * S[0], T[2] + z * S[2]);
      if (!orphaned.has(key)) { keep.push(a, b, c); continue; }
      const [cx, cy] = key.split(",").map(Number);
      const target = replacementFor(cx, cy);
      const list = moved.get(target) ?? [];
      list.push(a, b, c);
      moved.set(target, list);
      cellsRepainted.add(key);
      repainted += 1;
    }
    if (moved.size === 0) continue;
    prim.indices = addIndices(keep);
    for (const [name, values] of moved) {
      added.push({ ...prim, indices: addIndices(values), material: materialIndex.get(name) });
    }
  }
  if (added.length) gltf.meshes[mesh].primitives.push(...added);
}

gltf.meshes.forEach((m) => { m.primitives = m.primitives.filter((p) => p.indices === undefined || gltf.accessors[p.indices].count > 0); });

buffers[1] = Buffer.concat([buffers[1], ...appended]);
gltf.buffers[1].byteLength = buffers[1].length;

writeFileSync(resolve(world, gltf.buffers[1].uri), buffers[1]);
writeFileSync(resolve(world, "world.gltf"), JSON.stringify(gltf));

// Re-lock the package manifest: the validator checks every file's size and hash.
const pkgPath = resolve(world, "browser-package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
for (const entry of pkg.files ?? []) {
  const path = resolve(world, entry.file.replace(/^.*highlands-rivers-v1\//, ""));
  try {
    const bytes = readFileSync(path);
    entry.bytes = bytes.length;
    entry.sha256 = createHash("sha256").update(bytes).digest("hex");
  } catch { /* entry points outside this package */ }
}
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));

console.log(`repainted ${repainted} triangles across ${cellsRepainted.size} cells of orphaned paving`);
console.log(`world-1.bin ${buffers[1].length.toLocaleString()} bytes (grew by ${(buffers[1].length - (gltf.buffers[1].byteLength - appended.reduce((n, b) => n + b.length, 0))).toLocaleString()})`);
