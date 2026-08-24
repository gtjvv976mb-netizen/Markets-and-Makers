#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { dirname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { MeshoptDecoder } from "../game/node_modules/three/examples/jsm/libs/meshopt_decoder.module.js";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = join(repository, "game/public/assets/world/highlands-rivers-v1");
const maximumCloudflareAsset = 25 * 1024 * 1024;

const problems = [];
const check = (condition, message) => { if (!condition) problems.push(message); };
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const inside = (base, relativePath) => {
  const candidate = resolve(base, normalize(relativePath));
  return candidate === base || candidate.startsWith(`${base}${sep}`) ? candidate : null;
};

const packageManifest = JSON.parse(await readFile(join(root, "browser-package.json"), "utf8"));
check(packageManifest.schema === "markets-and-makers.highlands-rivers-world.browser-package.v1", "unexpected browser package schema");
check(packageManifest.source?.sha256 === "a351cc398ac3b6987ab5177e60bba3b42d623843046a0a003d0b8ea77c14a05e", "source Highlands preview hash drifted");
check(packageManifest.counts?.nodes === 327, "expected 327 world nodes including the restored NV05 terrain patch");
check(packageManifest.counts?.meshes === 276, "expected 276 world meshes including the restored NV05 terrain patch");
check(packageManifest.counts?.materials === 31, "expected 31 authored materials");
check(packageManifest.counts?.images === 40, "expected 40 shared textures");
check(packageManifest.counts?.buffers === 2, "expected two browser-safe geometry buffers");
check(packageManifest.runtimePatches?.[0]?.id === "NV05" && packageManifest.runtimePatches[0]?.vertices === 100,
  "safe NV05 plot relocation is not declared");
check(packageManifest.runtimePatches?.[0]?.restored_grass_cells === 35,
  "the old NV05 site must restore all 35 non-road terrain cells");
check(packageManifest.runtimePatches?.[0]?.applied_during_externalization === true,
  "the canonical NV05 relocation was not applied during browser packaging");

const browserWorldManifest = JSON.parse(await readFile(join(root, "..", "manifest.json"), "utf8"));
check(browserWorldManifest.active_world?.id === "highlands-rivers-v1", "browser world manifest does not activate Highlands & Rivers");
check(browserWorldManifest.active_world?.entrypoint === "highlands-rivers-v1/world.gltf", "browser world entrypoint drifted");
check(browserWorldManifest.active_world?.source_sha256 === packageManifest.source?.sha256, "browser world source lock drifted");
check(browserWorldManifest.rollback_world?.entrypoint === "sunwoven-reach-v1.glb", "legacy rollback world is not declared");

for (const entry of packageManifest.files ?? []) {
  const path = inside(root, entry.file);
  check(Boolean(path), `unsafe browser-package path ${entry.file}`);
  if (!path) continue;
  try {
    const bytes = await readFile(path);
    check(bytes.length === entry.bytes, `${entry.file} byte size drifted`);
    check(sha256(bytes) === entry.sha256, `${entry.file} hash drifted`);
    check(bytes.length < maximumCloudflareAsset, `${entry.file} exceeds Cloudflare's per-file asset ceiling`);
  } catch {
    problems.push(`${entry.file} is missing`);
  }
}

const gltf = JSON.parse(await readFile(join(root, packageManifest.entrypoint), "utf8"));
check(gltf.asset?.extras?.sourceSha256 === packageManifest.source.sha256, "gltf source lock does not match browser package");
check((gltf.nodes?.length ?? 0) === packageManifest.counts.nodes, "gltf node count does not match browser package");
check((gltf.materials?.length ?? 0) === packageManifest.counts.materials, "gltf material count does not match browser package");
check((gltf.nodes ?? []).some((node) => node.name === "MM_HRW_NV05_OLD_SITE_RESTORED_GRASS" &&
  node.extras?.cells === 35), "the restored NV05 grass mesh is missing");
for (const buffer of gltf.buffers ?? []) {
  const path = inside(root, buffer.uri);
  check(Boolean(path), `unsafe buffer URI ${buffer.uri}`);
  if (path) check((await stat(path)).size === buffer.byteLength, `${buffer.uri} declared byteLength drifted`);
}
for (const image of gltf.images ?? []) {
  const path = inside(root, image.uri);
  check(Boolean(path), `unsafe image URI ${image.uri}`);
  if (path) await stat(path).catch(() => problems.push(`${image.uri} is missing`));
}

const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
const layout = JSON.parse(await readFile(join(root, "layout.json"), "utf8"));
const terrainGrid = JSON.parse(await readFile(join(root, "terrain-grid.json"), "utf8"));
check(manifest.counts?.chunks === 256, "runtime manifest must declare 256 chunks");
check(manifest.counts?.government_buildings === 9, "runtime manifest must declare 9 civic buildings");
check(manifest.counts?.total_empty_plots === 42, "runtime manifest must declare 42 empty plots");
check((layout.plots?.existing?.length ?? 0) + (layout.plots?.added?.length ?? 0) === 42, "layout must contain exactly 42 empty plots");
check(layout.world?.dimensions_m?.[0] === 512 && layout.world?.dimensions_m?.[1] === 512, "world must remain 512 by 512 metres");
const nv05 = [...(layout.plots?.existing ?? []), ...(layout.plots?.added ?? [])].find((plot) => plot.id === "NV05");
check(JSON.stringify(nv05?.occupied_bounds_cells?.min) === "[42,66]" &&
  JSON.stringify(nv05?.occupied_bounds_cells?.max) === "[47,73]", "NV05 must use the verified road-free plot bounds");

const terrainAt = (x, y) => {
  const row = (terrainGrid.rows ?? []).find((entry) => entry.y === y);
  return row?.runs?.find((run) => run.x0 <= x && x <= run.x1)?.surface;
};
for (let y = 58; y <= 65; y += 1) {
  for (let x = 42; x <= 47; x += 1) {
    check(terrainAt(x, y) !== "empty_plot", `old NV05 cell ${x},${y} remains classified as a plot`);
  }
}
for (let y = 66; y <= 73; y += 1) {
  for (let x = 42; x <= 47; x += 1) {
    check(terrainAt(x, y) === "empty_plot", `relocated NV05 cell ${x},${y} is not classified as a plot`);
  }
}
check(terrainGrid.runtime_patches?.[0]?.id === "NV05" && terrainGrid.runtime_patches[0]?.restored_grass_cells === 35,
  "terrain-grid NV05 browser patch metadata is missing");

const worldDesignRoot = join(root, "world-designs-v1");
const worldDesignManifest = JSON.parse(await readFile(join(worldDesignRoot, "manifest.json"), "utf8"));
const expectedStaticWorldDesigns = 910;
check(worldDesignManifest.schema === "markets-and-makers.world-designs-runtime.v1", "unexpected world designs schema");
check(worldDesignManifest.counts?.uniqueAssets === 16, "world designs must contain 16 unique uploaded assets");
check(worldDesignManifest.counts?.staticPlacements === expectedStaticWorldDesigns,
  `world designs must contain ${expectedStaticWorldDesigns} static placements`);
check(worldDesignManifest.counts?.dynamicAvatar === 1 &&
  worldDesignManifest.counts?.totalInstances === expectedStaticWorldDesigns + 1,
  `world designs must contain ${expectedStaticWorldDesigns} scenery instances plus the civic avatar`);

const glbParts = (bytes) => {
  if (bytes.toString("utf8", 0, 4) !== "glTF") return null;
  const jsonLength = bytes.readUInt32LE(12);
  if (bytes.readUInt32LE(16) !== 0x4e4f534a) return null;
  const binaryHeader = 20 + jsonLength;
  if (bytes.readUInt32LE(binaryHeader + 4) !== 0x004e4942) return null;
  const binaryLength = bytes.readUInt32LE(binaryHeader);
  return {
    document: JSON.parse(bytes.toString("utf8", 20, 20 + jsonLength)),
    binary: bytes.subarray(binaryHeader + 8, binaryHeader + 8 + binaryLength),
  };
};
const glbJson = (bytes) => glbParts(bytes)?.document ?? null;
const glbTriangles = (document) => (document?.meshes ?? []).reduce((total, mesh) => total +
  (mesh.primitives ?? []).reduce((meshTotal, primitive) => {
    if ((primitive.mode ?? 4) !== 4) return meshTotal;
    const accessorIndex = primitive.indices ?? primitive.attributes?.POSITION;
    return meshTotal + Math.floor((document.accessors?.[accessorIndex]?.count ?? 0) / 3);
  }, 0), 0);

const accessorComponents = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const componentBytes = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const readComponent = (view, offset, type) => {
  if (type === 5120) return view.getInt8(offset);
  if (type === 5121) return view.getUint8(offset);
  if (type === 5122) return view.getInt16(offset, true);
  if (type === 5123) return view.getUint16(offset, true);
  if (type === 5125) return view.getUint32(offset, true);
  if (type === 5126) return view.getFloat32(offset, true);
  throw new Error(`unsupported accessor component type ${type}`);
};
const normalizeComponent = (value, type) => {
  if (type === 5120) return Math.max(-1, value / 127);
  if (type === 5121) return value / 255;
  if (type === 5122) return Math.max(-1, value / 32767);
  if (type === 5123) return value / 65535;
  return value;
};
const readAccessor = async (parts, accessorIndex) => {
  const accessor = parts.document.accessors?.[accessorIndex];
  if (!accessor || !Number.isInteger(accessor.bufferView)) throw new Error(`accessor ${accessorIndex} has no buffer view`);
  const bufferView = parts.document.bufferViews?.[accessor.bufferView];
  if (!bufferView) throw new Error(`accessor ${accessorIndex} references a missing buffer view`);
  const extension = bufferView.extensions?.EXT_meshopt_compression;
  let bytes = parts.binary;
  let baseOffset = (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  let stride = bufferView.byteStride;
  if (extension) {
    await MeshoptDecoder.ready;
    const decoded = new Uint8Array(extension.count * extension.byteStride);
    MeshoptDecoder.decodeGltfBuffer(
      decoded,
      extension.count,
      extension.byteStride,
      parts.binary.subarray(extension.byteOffset, extension.byteOffset + extension.byteLength),
      extension.mode,
      extension.filter,
    );
    bytes = decoded;
    baseOffset = accessor.byteOffset ?? 0;
    stride = extension.byteStride;
  }
  const size = accessorComponents[accessor.type];
  const width = componentBytes[accessor.componentType];
  if (!size || !width) throw new Error(`accessor ${accessorIndex} has an unsupported type`);
  stride ??= size * width;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const values = new Float64Array(accessor.count * size);
  for (let element = 0; element < accessor.count; element += 1) {
    for (let component = 0; component < size; component += 1) {
      const raw = readComponent(view, baseOffset + element * stride + component * width, accessor.componentType);
      values[element * size + component] = accessor.normalized ? normalizeComponent(raw, accessor.componentType) : raw;
    }
  }
  return { values, count: accessor.count, size };
};

const HUMANOID_JOINTS = [
  "Hips", "Spine", "Chest", "Neck", "Head",
  "LeftUpperArm", "LeftLowerArm", "RightUpperArm", "RightLowerArm",
  "LeftUpperLeg", "LeftLowerLeg", "LeftFoot", "RightUpperLeg", "RightLowerLeg", "RightFoot",
];

const validateHumanoid = async (parts, label, expectedAxis, expectedYaw) => {
  const document = parts.document;
  const rig = document.asset?.extras?.marketsAndMakersRig;
  check(rig?.schema === "markets-and-makers.humanoid-rig.v2", `${label} is missing v2 humanoid rig metadata`);
  check(rig?.frontAxis === expectedAxis && rig?.yawCorrectionDegrees === expectedYaw,
    `${label} rig axis/yaw metadata does not match its authored model`);
  check(rig?.rootMotion === "in-place-xz", `${label} must use in-place X/Z root motion`);
  const skin = document.skins?.[0];
  check((document.skins?.length ?? 0) === 1 && skin?.joints?.length === HUMANOID_JOINTS.length,
    `${label} must contain one ${HUMANOID_JOINTS.length}-joint skin`);
  if (!skin || skin.joints?.length !== HUMANOID_JOINTS.length) return;
  const jointNames = skin.joints.map((nodeIndex) => document.nodes?.[nodeIndex]?.name);
  check(HUMANOID_JOINTS.every((name) => jointNames.includes(name)), `${label} humanoid hierarchy is incomplete`);
  const inverseBind = document.accessors?.[skin.inverseBindMatrices];
  check(inverseBind?.count === HUMANOID_JOINTS.length && inverseBind?.type === "MAT4",
    `${label} inverse bind matrix count is invalid`);
  const meshNode = (document.nodes ?? []).find((node) => node.skin === 0 && Number.isInteger(node.mesh));
  const primitive = document.meshes?.[meshNode?.mesh]?.primitives?.[0];
  const positionIndex = primitive?.attributes?.POSITION;
  const jointsIndex = primitive?.attributes?.JOINTS_0;
  const weightsIndex = primitive?.attributes?.WEIGHTS_0;
  check([positionIndex, jointsIndex, weightsIndex].every(Number.isInteger), `${label} is missing skinned vertex attributes`);
  if (![positionIndex, jointsIndex, weightsIndex].every(Number.isInteger)) return;
  const [positions, jointValues, weightValues] = await Promise.all([
    readAccessor(parts, positionIndex),
    readAccessor(parts, jointsIndex),
    readAccessor(parts, weightsIndex),
  ]);
  check(positions.count === jointValues.count && positions.count === weightValues.count,
    `${label} skin attribute counts do not match POSITION`);
  check(jointValues.size === 4 && weightValues.size === 4, `${label} skin attributes must be VEC4`);
  const influenced = Array(skin.joints.length).fill(0);
  for (let vertex = 0; vertex < weightValues.count; vertex += 1) {
    let sum = 0;
    for (let component = 0; component < 4; component += 1) {
      const offset = vertex * 4 + component;
      const joint = jointValues.values[offset];
      const weight = weightValues.values[offset];
      sum += weight;
      if (weight > 0.001 && Number.isInteger(joint) && joint >= 0 && joint < influenced.length) influenced[joint] += 1;
    }
    check(Math.abs(sum - 1) <= 0.02, `${label} contains a vertex whose skin weights do not sum to one`);
  }

  const animations = new Map((document.animations ?? []).map((animation) => [animation.name, animation]));
  check(animations.has("Idle") && animations.has("Walk"), `${label} must contain Idle and Walk clips`);
  const animatedJoints = new Set();
  for (const [name, animation] of animations) {
    if (name !== "Idle" && name !== "Walk") continue;
    for (const channel of animation.channels ?? []) {
      const sampler = animation.samplers?.[channel.sampler];
      const nodeIndex = channel.target?.node;
      const path = channel.target?.path;
      if (!sampler || !Number.isInteger(nodeIndex)) continue;
      const [input, output] = await Promise.all([
        readAccessor(parts, sampler.input),
        readAccessor(parts, sampler.output),
      ]);
      check(input.count === output.count, `${label} ${name} channel input/output counts differ`);
      for (let index = 1; index < input.values.length; index += 1) {
        check(input.values[index] > input.values[index - 1], `${label} ${name} keyframe times must increase`);
      }
      if (path === "rotation") {
        const joint = skin.joints.indexOf(nodeIndex);
        if (joint >= 0) animatedJoints.add(joint);
        for (let key = 0; key < output.count; key += 1) {
          const offset = key * 4;
          const length = Math.hypot(...output.values.slice(offset, offset + 4));
          check(Math.abs(length - 1) <= 0.01, `${label} ${name} contains a non-normalized quaternion`);
        }
      }
      if (path === "translation" && document.nodes?.[nodeIndex]?.name === "Hips") {
        for (let key = 0; key < output.count; key += 1) {
          const offset = key * 3;
          check(Math.abs(output.values[offset]) <= 0.002 && Math.abs(output.values[offset + 2]) <= 0.002,
            `${label} ${name} contains unwanted horizontal root motion`);
        }
      }
      if (output.count > 1) {
        const first = output.values.slice(0, output.size);
        const last = output.values.slice((output.count - 1) * output.size, output.count * output.size);
        const direct = Math.hypot(...first.map((value, index) => value - last[index]));
        const mirrored = path === "rotation" ? Math.hypot(...first.map((value, index) => value + last[index])) : Infinity;
        check(Math.min(direct, mirrored) <= 0.02, `${label} ${name} channel does not form a clean loop`);
      }
    }
  }
  for (const joint of animatedJoints) {
    check(influenced[joint] > 0, `${label} animates ${jointNames[joint]} without any influenced vertices`);
  }
};

const citizenRoot = join(repository, "game/public/assets/avatars/mercedonians/runtime");
const citizenManifest = JSON.parse(await readFile(join(citizenRoot, "manifest.json"), "utf8"));
check(citizenManifest.schema === "markets-and-makers.mercedonians-runtime.v2", "unexpected citizen runtime schema");
check(citizenManifest.avatars?.length === 9, "citizen runtime must contain nine optimized Mercedonians");
for (const avatar of citizenManifest.avatars ?? []) {
  const path = inside(citizenRoot, avatar.file);
  check(Boolean(path), `unsafe citizen path ${avatar.file}`);
  if (!path) continue;
  try {
    const bytes = await readFile(path);
    const parts = glbParts(bytes);
    const document = parts?.document;
    check(Boolean(document), `${avatar.file} is not a valid binary glTF`);
    check(bytes.length === avatar.runtime?.bytes, `${avatar.file} citizen byte size drifted`);
    check(sha256(bytes) === avatar.runtime?.sha256, `${avatar.file} citizen hash drifted`);
    check(glbTriangles(document) === avatar.runtime?.triangles, `${avatar.file} citizen triangle count drifted`);
    check(bytes.length <= 200 * 1024, `${avatar.file} exceeds the 200 KiB citizen budget`);
    check((avatar.runtime?.triangles ?? Infinity) >= 8_000 && (avatar.runtime?.triangles ?? Infinity) <= 15_000,
      `${avatar.file} must remain between 8k and 15k triangles`);
    const animationNames = new Set((document?.animations ?? []).map((animation) => animation.name));
    check(animationNames.has("Idle") && animationNames.has("Walk"), `${avatar.file} lost its Idle or Walk animation`);
    check(["+X", "+Z"].includes(avatar.frontAxis), `${avatar.file} has no supported authored forward axis`);
    check(avatar.yawCorrectionDegrees === (avatar.frontAxis === "+X" ? -90 : 0),
      `${avatar.file} has the wrong game-facing yaw correction`);
    if (parts) await validateHumanoid(parts, avatar.file, avatar.frontAxis, avatar.yawCorrectionDegrees);
    check(document?.extensionsRequired?.includes("EXT_meshopt_compression"), `${avatar.file} is not Meshopt-compressed`);
    check(document?.extensionsRequired?.includes("EXT_texture_webp"), `${avatar.file} does not declare WebP textures`);
  } catch {
    problems.push(`${avatar.file} optimized citizen is missing`);
  }
}

const designAssets = new Map();
for (const asset of worldDesignManifest.assets ?? []) {
  check(typeof asset.id === "string" && !designAssets.has(asset.id), `duplicate or invalid world design asset ${asset.id}`);
  designAssets.set(asset.id, asset);
  const path = inside(worldDesignRoot, asset.file);
  check(Boolean(path), `unsafe world design path ${asset.file}`);
  if (!path) continue;
  try {
    const bytes = await readFile(path);
    const parts = glbParts(bytes);
    const document = parts?.document;
    check(Boolean(document), `${asset.file} is not a valid binary glTF`);
    check(bytes.length === asset.runtime?.bytes, `${asset.file} byte size drifted`);
    check(sha256(bytes) === asset.runtime?.sha256, `${asset.file} hash drifted`);
    check(glbTriangles(document) === asset.runtime?.triangles, `${asset.file} triangle count drifted`);
    check(bytes.length < 2 * 1024 * 1024, `${asset.file} exceeds the two MiB scenery budget`);
    check((asset.runtime?.triangles ?? Infinity) <= 30_000, `${asset.file} exceeds the 30k unique triangle budget`);
    check(document.extensionsRequired?.includes("EXT_meshopt_compression"), `${asset.file} is not Meshopt-compressed`);
    check(document.extensionsRequired?.includes("EXT_texture_webp"), `${asset.file} does not declare its WebP textures`);
    if (asset.category === "avatar") {
      check(asset.frontAxis === "+X" && asset.yawCorrectionDegrees === -90,
        `${asset.file} must declare its +X authoring axis and -90 degree visual correction`);
      if (parts) await validateHumanoid(parts, asset.file, "+X", -90);
    }
  } catch {
    problems.push(`${asset.file} is missing`);
  }
}
check(designAssets.size === 16, "world design asset IDs are not unique");

const designPlacements = worldDesignManifest.placements ?? [];
const placementIds = new Set();
const placementCounts = new Map();
const exactReserved = new Set();
const reserveRect = (rect) => {
  for (let y = rect.min[1]; y <= rect.max[1]; y += 1) {
    for (let x = rect.min[0]; x <= rect.max[0]; x += 1) exactReserved.add(`${x}:${y}`);
  }
};
for (const building of layout.buildings ?? []) reserveRect(building.occupied_bounds_cells);
for (const plot of [...(layout.plots?.existing ?? []), ...(layout.plots?.added ?? [])]) reserveRect(plot.occupied_bounds_cells);

for (const placement of designPlacements) {
  check(typeof placement.id === "string" && !placementIds.has(placement.id), `duplicate or invalid placement ${placement.id}`);
  placementIds.add(placement.id);
  const asset = designAssets.get(placement.assetId);
  check(Boolean(asset), `${placement.id} references unknown asset ${placement.assetId}`);
  placementCounts.set(placement.assetId, (placementCounts.get(placement.assetId) ?? 0) + 1);
  const [cellX, cellY] = placement.cell ?? [];
  const [worldX, worldZ] = placement.position ?? [];
  check([cellX, cellY, worldX, worldZ, placement.yawDegrees].every(Number.isFinite), `${placement.id} has invalid coordinates`);
  if (![cellX, cellY, worldX, worldZ].every(Number.isFinite) || !asset) continue;
  check(Math.abs(worldX - cellX * 2) <= 0.36 && Math.abs(worldZ + cellY * 2) <= 0.36,
    `${placement.id} violates the two-metre cell coordinate contract`);
  check(worldX >= -257 && worldX <= 255 && worldZ >= -351 && worldZ <= 161, `${placement.id} is outside world bounds`);
  const integerCell = Number.isInteger(cellX) && Number.isInteger(cellY) ? [cellX, cellY] : null;
  const kind = integerCell ? terrainAt(integerCell[0], integerCell[1]) : "ocean";
  if (asset.category === "boats") {
    check(placement.anchor === "water" && kind === "ocean", `${placement.id} must be anchored in authored ocean water`);
  } else if (asset.category === "vehicles") {
    check(placement.anchor === "ground" && kind === "road", `${placement.id} must be parked on an authored road`);
  } else {
    check(placement.anchor === "ground" && String(kind).startsWith("land_l"), `${placement.id} must use a land cell`);
    if (integerCell) check(!exactReserved.has(`${integerCell[0]}:${integerCell[1]}`), `${placement.id} overlaps a plot or civic footprint`);
  }
}
check(placementIds.size === expectedStaticWorldDesigns, "world design placement IDs are not unique");
for (const [assetId, expected] of Object.entries(worldDesignManifest.counts?.byAsset ?? {})) {
  check(placementCounts.get(assetId) === expected, `${assetId} placement count drifted`);
}

if (problems.length) {
  console.error(`Highlands browser validation failed (${problems.length}):`);
  for (const problem of problems) console.error(`- ${problem}`);
  process.exit(1);
}
console.log(`Highlands browser validation passed: ${packageManifest.files.length} terrain files, 256 chunks, 9 civic buildings, 42 empty plots, 16 optimized world-design assets, 9 optimized citizens, and ${expectedStaticWorldDesigns + 1} streamed world-design instances.`);
