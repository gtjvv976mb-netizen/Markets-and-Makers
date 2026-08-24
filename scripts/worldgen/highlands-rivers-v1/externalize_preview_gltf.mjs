#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve } from "node:path";

const GLB_MAGIC = 0x46546c67;
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;
const MAX_BUFFER_BYTES = 18 * 1024 * 1024;
const NV05_RUNTIME_RELOCATION = {
  from: { minX: 82, maxX: 96, minZ: -132, maxZ: -114 },
  deltaZ: -16,
  expectedVertices: 100,
};
const NV05_RESTORED_GRASS_CELLS = [
  [42, 58], [46, 58], [47, 58],
  ...[59, 60, 61, 62, 63].flatMap((y) => [[42, y], [43, y], [46, y], [47, y]]),
  ...[64, 65].flatMap((y) => [42, 43, 44, 45, 46, 47].map((x) => [x, y])),
];

function fail(message) {
  throw new Error(message);
}

function align4(value) {
  return (value + 3) & ~3;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function safeName(value, fallback) {
  const normalized = String(value ?? fallback)
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return normalized || fallback;
}

function mimeExtension(mimeType) {
  switch (mimeType) {
    case "image/jpeg": return ".jpg";
    case "image/png": return ".png";
    case "image/webp": return ".webp";
    case "image/ktx2": return ".ktx2";
    default: fail(`Unsupported embedded image MIME type: ${mimeType}`);
  }
}

function parseGlb(bytes) {
  if (bytes.length < 20) fail("GLB is too small");
  if (bytes.readUInt32LE(0) !== GLB_MAGIC) fail("Input is not a GLB 2.0 file");
  if (bytes.readUInt32LE(4) !== 2) fail("Only GLB 2.0 is supported");
  if (bytes.readUInt32LE(8) !== bytes.length) fail("GLB declared length does not match file size");

  let offset = 12;
  let json = null;
  let binary = null;
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32LE(offset);
    const type = bytes.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + length;
    if (end > bytes.length) fail("GLB chunk exceeds file length");
    if (type === JSON_CHUNK) json = JSON.parse(bytes.subarray(start, end).toString("utf8").replace(/\u0000+$/g, "").trimEnd());
    if (type === BIN_CHUNK) binary = bytes.subarray(start, end);
    offset = end;
  }
  if (!json || !binary) fail("GLB must contain JSON and BIN chunks");
  if ((json.buffers?.length ?? 0) !== 1) fail("Expected exactly one embedded GLB buffer");
  return { json, binary };
}

function relocateUnsafePlot(json, binary) {
  const node = (json.nodes ?? []).find((entry) => entry.name === "MM_HRW_EMPTY_PLOTS_42");
  const mesh = Number.isInteger(node?.mesh) ? json.meshes?.[node.mesh] : null;
  if (!mesh) fail("The combined empty-plot mesh is missing");
  let moved = 0;
  for (const primitive of mesh.primitives ?? []) {
    const accessor = json.accessors?.[primitive.attributes?.POSITION];
    const view = json.bufferViews?.[accessor?.bufferView];
    if (!accessor || !view || accessor.componentType !== 5126 || accessor.type !== "VEC3" || view.buffer !== 0) {
      fail("The combined empty-plot positions are not tightly packed FLOAT VEC3 data");
    }
    const stride = view.byteStride ?? 12;
    const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
    for (let index = 0; index < accessor.count; index += 1) {
      const offset = start + index * stride;
      const x = binary.readFloatLE(offset);
      const z = binary.readFloatLE(offset + 8);
      if (x < NV05_RUNTIME_RELOCATION.from.minX || x > NV05_RUNTIME_RELOCATION.from.maxX ||
          z < NV05_RUNTIME_RELOCATION.from.minZ || z > NV05_RUNTIME_RELOCATION.from.maxZ) continue;
      binary.writeFloatLE(z + NV05_RUNTIME_RELOCATION.deltaZ, offset + 8);
      moved += 1;
    }
  }
  if (moved !== NV05_RUNTIME_RELOCATION.expectedVertices) {
    fail(`Expected to relocate ${NV05_RUNTIME_RELOCATION.expectedVertices} NV05 vertices, moved ${moved}`);
  }
  return moved;
}

function appendNv05Restoration(json, sourceBinary) {
  const grassMaterial = (json.materials ?? []).findIndex((entry) => entry.name === "MAT_TERRAIN_GRASS_SAGE");
  if (grassMaterial < 0) fail("The canonical grass material is missing");

  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  const inset = 0.975;
  const elevation = 1.008;
  for (const [cellX, cellY] of NV05_RESTORED_GRASS_CELLS) {
    const centerX = cellX * 2;
    const centerZ = -cellY * 2;
    const base = positions.length / 3;
    positions.push(
      centerX - inset, elevation, centerZ - inset,
      centerX + inset, elevation, centerZ - inset,
      centerX + inset, elevation, centerZ + inset,
      centerX - inset, elevation, centerZ + inset,
    );
    normals.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
    uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
    indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }

  const payloads = [
    { bytes: Buffer.from(new Float32Array(positions).buffer), target: 34962 },
    { bytes: Buffer.from(new Float32Array(normals).buffer), target: 34962 },
    { bytes: Buffer.from(new Float32Array(uvs).buffer), target: 34962 },
    { bytes: Buffer.from(new Uint16Array(indices).buffer), target: 34963 },
  ];
  let binary = Buffer.from(sourceBinary);
  const viewIndexes = [];
  for (const payload of payloads) {
    const offset = align4(binary.length);
    if (offset > binary.length) binary = Buffer.concat([binary, Buffer.alloc(offset - binary.length)]);
    viewIndexes.push(json.bufferViews.length);
    json.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: payload.bytes.length, target: payload.target });
    binary = Buffer.concat([binary, payload.bytes]);
  }

  const accessorBase = json.accessors.length;
  const xs = positions.filter((_, index) => index % 3 === 0);
  const ys = positions.filter((_, index) => index % 3 === 1);
  const zs = positions.filter((_, index) => index % 3 === 2);
  json.accessors.push(
    { bufferView: viewIndexes[0], componentType: 5126, count: positions.length / 3, type: "VEC3",
      min: [Math.min(...xs), Math.min(...ys), Math.min(...zs)], max: [Math.max(...xs), Math.max(...ys), Math.max(...zs)] },
    { bufferView: viewIndexes[1], componentType: 5126, count: normals.length / 3, type: "VEC3" },
    { bufferView: viewIndexes[2], componentType: 5126, count: uvs.length / 2, type: "VEC2" },
    { bufferView: viewIndexes[3], componentType: 5123, count: indices.length, type: "SCALAR", min: [0], max: [positions.length / 3 - 1] },
  );
  const meshIndex = json.meshes.length;
  json.meshes.push({
    name: "MM_HRW_NV05_OLD_SITE_RESTORED_GRASS",
    primitives: [{
      attributes: { POSITION: accessorBase, NORMAL: accessorBase + 1, TEXCOORD_0: accessorBase + 2 },
      indices: accessorBase + 3,
      material: grassMaterial,
      mode: 4,
    }],
    extras: { runtime_patch: "NV05_OLD_SITE_RESTORED", cells: NV05_RESTORED_GRASS_CELLS.length },
  });
  const nodeIndex = json.nodes.length;
  json.nodes.push({ name: "MM_HRW_NV05_OLD_SITE_RESTORED_GRASS", mesh: meshIndex,
    extras: { runtime_patch: "NV05_OLD_SITE_RESTORED", cells: NV05_RESTORED_GRASS_CELLS.length } });
  const scene = json.scenes?.[json.scene ?? 0];
  if (!scene) fail("The canonical scene is missing");
  scene.nodes = [...(scene.nodes ?? []), nodeIndex];
  json.buffers[0].byteLength = binary.length;
  return binary;
}

function patchNv05Records(value) {
  if (!value || typeof value !== "object") return;
  if (value.id === "NV05" && value.occupied_bounds_cells) {
    value.anchor_cell_sw = [42, 66];
    value.occupied_bounds_cells = { inclusive: true, min: [42, 66], max: [47, 73] };
    value.utility_connection_cell = [45, 65];
  }
  for (const child of Object.values(value)) patchNv05Records(child);
}

function patchTerrainGrid(grid) {
  const counts = {};
  for (const row of grid.rows ?? []) {
    const cells = new Map();
    for (const run of row.runs ?? []) {
      for (let x = run.x0; x <= run.x1; x += 1) cells.set(x, run.surface);
    }
    if (row.y >= 58 && row.y <= 65) {
      for (let x = 42; x <= 47; x += 1) {
        if (cells.get(x) === "empty_plot") cells.set(x, "land_l0");
      }
    }
    if (row.y >= 66 && row.y <= 73) {
      for (let x = 42; x <= 47; x += 1) {
        if (cells.get(x) !== "land_l0") fail(`NV05 safe cell ${x},${row.y} is not canonical land_l0`);
        cells.set(x, "empty_plot");
      }
    }
    const runs = [];
    for (const [x, surface] of [...cells.entries()].sort((a, b) => a[0] - b[0])) {
      const last = runs.at(-1);
      if (last && last.surface === surface && last.x1 + 1 === x) last.x1 = x;
      else runs.push({ x0: x, x1: x, surface });
      counts[surface] = (counts[surface] ?? 0) + 1;
    }
    row.runs = runs;
  }
  grid.surface_counts = Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
  grid.runtime_patches = [{
    id: "NV05",
    reason: "road-free relocation",
    old_bounds_cells: { min: [42, 58], max: [47, 65] },
    new_bounds_cells: { min: [42, 66], max: [47, 73] },
    restored_grass_cells: NV05_RESTORED_GRASS_CELLS.length,
  }];
}

async function main() {
  const [sourceArg, outputArg, metadataArg] = process.argv.slice(2);
  if (!sourceArg || !outputArg) {
    fail("Usage: node externalize_preview_gltf.mjs <source.glb> <output-directory> [source-package-directory]");
  }

  const source = resolve(sourceArg);
  const output = resolve(outputArg);
  const glbBytes = await readFile(source);
  const sourceSha256 = sha256(glbBytes);
  const parsed = parseGlb(glbBytes);
  const json = parsed.json;
  let binary = Buffer.from(parsed.binary);
  const relocatedPlotVertices = relocateUnsafePlot(json, binary);
  binary = appendNv05Restoration(json, binary);
  const originalViews = json.bufferViews ?? [];
  const embeddedImageViews = new Set(
    (json.images ?? []).map((image) => image.bufferView).filter((value) => Number.isInteger(value)),
  );

  await rm(output, { recursive: true, force: true });
  await mkdir(join(output, "buffers"), { recursive: true });
  await mkdir(join(output, "textures"), { recursive: true });

  const files = [];
  const recordFile = async (absolutePath, bytes) => {
    await writeFile(absolutePath, bytes);
    files.push({
      file: relative(output, absolutePath).replaceAll("\\", "/"),
      bytes: bytes.length,
      sha256: sha256(bytes),
    });
  };

  if (metadataArg) {
    const metadataRoot = resolve(metadataArg);
    for (const filename of ["manifest.json", "layout.json", "hydrology.json", "terrain-grid.json"]) {
      const sourceBytes = await readFile(join(metadataRoot, filename));
      if (filename === "hydrology.json") {
        await recordFile(join(output, filename), sourceBytes);
        continue;
      }
      const document = JSON.parse(sourceBytes.toString("utf8"));
      if (filename === "manifest.json" || filename === "layout.json") patchNv05Records(document);
      if (filename === "terrain-grid.json") patchTerrainGrid(document);
      const indent = filename === "terrain-grid.json" ? undefined : 2;
      const bytes = Buffer.from(`${JSON.stringify(document, null, indent)}\n`, "utf8");
      await recordFile(join(output, filename), bytes);
    }
  }

  for (const [index, image] of (json.images ?? []).entries()) {
    if (!Number.isInteger(image.bufferView)) continue;
    const view = originalViews[image.bufferView];
    if (!view || view.buffer !== 0) fail(`Image ${index} references an invalid bufferView`);
    const start = view.byteOffset ?? 0;
    const end = start + view.byteLength;
    if (end > binary.length) fail(`Image ${index} exceeds the GLB binary chunk`);
    const extension = mimeExtension(image.mimeType);
    const filename = `${String(index).padStart(2, "0")}-${safeName(image.name, `texture-${index}`)}${extension}`;
    const data = Buffer.from(binary.subarray(start, end));
    await recordFile(join(output, "textures", filename), data);
    image.uri = `textures/${filename}`;
    delete image.bufferView;
    delete image.mimeType;
  }

  const oldToNewView = new Map();
  const retainedViews = [];
  for (const [oldIndex, view] of originalViews.entries()) {
    if (embeddedImageViews.has(oldIndex)) continue;
    oldToNewView.set(oldIndex, retainedViews.length);
    retainedViews.push({ ...view });
  }

  const remapView = (oldIndex, context) => {
    if (!Number.isInteger(oldIndex)) return oldIndex;
    const next = oldToNewView.get(oldIndex);
    if (!Number.isInteger(next)) fail(`${context} points to an extracted image bufferView`);
    return next;
  };
  for (const [index, accessor] of (json.accessors ?? []).entries()) {
    if (Number.isInteger(accessor.bufferView)) accessor.bufferView = remapView(accessor.bufferView, `accessor ${index}`);
    if (accessor.sparse) {
      accessor.sparse.indices.bufferView = remapView(accessor.sparse.indices.bufferView, `accessor ${index} sparse indices`);
      accessor.sparse.values.bufferView = remapView(accessor.sparse.values.bufferView, `accessor ${index} sparse values`);
    }
  }

  const bufferParts = [];
  let current = { chunks: [], length: 0 };
  for (let newIndex = 0; newIndex < retainedViews.length; newIndex += 1) {
    const view = retainedViews[newIndex];
    if (view.buffer !== 0) fail(`bufferView ${newIndex} does not reference the embedded GLB buffer`);
    const oldIndex = [...oldToNewView.entries()].find(([, mapped]) => mapped === newIndex)?.[0];
    const sourceView = originalViews[oldIndex];
    const sourceStart = sourceView.byteOffset ?? 0;
    const sourceEnd = sourceStart + sourceView.byteLength;
    if (sourceEnd > binary.length) fail(`bufferView ${oldIndex} exceeds the GLB binary chunk`);
    const paddedStart = align4(current.length);
    if (current.chunks.length > 0 && paddedStart + sourceView.byteLength > MAX_BUFFER_BYTES) {
      bufferParts.push(current);
      current = { chunks: [], length: 0 };
    }
    const targetOffset = align4(current.length);
    current.chunks.push({ targetOffset, data: Buffer.from(binary.subarray(sourceStart, sourceEnd)) });
    current.length = targetOffset + sourceView.byteLength;
    view.buffer = bufferParts.length;
    view.byteOffset = targetOffset;
  }
  if (current.chunks.length > 0) bufferParts.push(current);

  json.bufferViews = retainedViews;
  json.buffers = [];
  for (const [index, part] of bufferParts.entries()) {
    const bytes = Buffer.alloc(align4(part.length));
    for (const chunk of part.chunks) chunk.data.copy(bytes, chunk.targetOffset);
    const filename = `world-${index}.bin`;
    await recordFile(join(output, "buffers", filename), bytes);
    json.buffers.push({ uri: `buffers/${filename}`, byteLength: bytes.length });
  }

  json.asset = {
    ...json.asset,
    extras: {
      ...(json.asset?.extras ?? {}),
      browserPackage: "markets-and-makers.highlands-rivers-world.browser.v1",
      sourceGlb: basename(source),
      sourceSha256,
    },
  };
  const gltfBytes = Buffer.from(`${JSON.stringify(json)}\n`, "utf8");
  await recordFile(join(output, "world.gltf"), gltfBytes);

  const packageManifest = {
    schema: "markets-and-makers.highlands-rivers-world.browser-package.v1",
    version: 1,
    source: { file: basename(source), bytes: glbBytes.length, sha256: sourceSha256 },
    runtimePatches: [{
      id: "NV05",
      reason: "avoid road overlap",
      delta_m: [0, -16],
      vertices: relocatedPlotVertices,
      applied_during_externalization: true,
      restored_grass_cells: NV05_RESTORED_GRASS_CELLS.length,
    }],
    entrypoint: "world.gltf",
    limits: { maximum_buffer_bytes: MAX_BUFFER_BYTES },
    counts: {
      nodes: json.nodes?.length ?? 0,
      meshes: json.meshes?.length ?? 0,
      materials: json.materials?.length ?? 0,
      images: json.images?.length ?? 0,
      buffers: json.buffers.length,
      bufferViews: json.bufferViews.length,
    },
    files: [...files].sort((a, b) => a.file.localeCompare(b.file)),
  };
  const manifestBytes = Buffer.from(`${JSON.stringify(packageManifest, null, 2)}\n`, "utf8");
  await recordFile(join(output, "browser-package.json"), manifestBytes);
  console.log(JSON.stringify({ output, ...packageManifest.counts, bytes: files.reduce((sum, file) => sum + file.bytes, 0) }, null, 2));
}

await main();
