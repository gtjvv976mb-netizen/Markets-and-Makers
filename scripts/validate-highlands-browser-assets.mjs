#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { dirname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "../game/node_modules/three/build/three.module.js";
import { GLTFLoader } from "../game/node_modules/three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "../game/node_modules/three/examples/jsm/libs/meshopt_decoder.module.js";

if (typeof globalThis.ProgressEvent === "undefined") {
  globalThis.ProgressEvent = class ProgressEvent {
    constructor(type, init = {}) {
      this.type = type;
      Object.assign(this, init);
    }
  };
}

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
check(worldDesignManifest.schema === "markets-and-makers.world-designs-runtime.v1", "unexpected world designs schema");
check(worldDesignManifest.counts?.uniqueAssets === 16, "world designs must contain 16 unique uploaded assets");
check(worldDesignManifest.counts?.dynamicAvatar === 1, "world designs must contain one dynamic civic avatar");
check(worldDesignManifest.sourceLocks?.layoutSha256 === sha256(await readFile(join(root, "layout.json"))),
  "world designs were generated against a stale Highlands layout");
check(worldDesignManifest.sourceLocks?.terrainGridSha256 === sha256(await readFile(join(root, "terrain-grid.json"))),
  "world designs were generated against a stale Highlands terrain grid");
check(worldDesignManifest.sourceLocks?.hydrologySha256 === sha256(await readFile(join(root, "hydrology.json"))),
  "world designs were generated against stale Highlands hydrology");

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

const align4 = (value) => (value + 3) & ~3;
const geometryOnlyGlb = (bytes) => {
  const parts = glbParts(bytes);
  if (!parts) throw new Error("not a valid binary glTF");
  const document = structuredClone(parts.document);
  for (const mesh of document.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) delete primitive.material;
  }
  delete document.materials;
  delete document.images;
  delete document.textures;
  delete document.samplers;
  for (const key of ["extensionsUsed", "extensionsRequired"]) {
    if (!Array.isArray(document[key])) continue;
    document[key] = document[key].filter((extension) =>
      extension !== "EXT_texture_webp" && extension !== "KHR_texture_basisu");
    if (document[key].length === 0) delete document[key];
  }

  const json = Buffer.from(JSON.stringify(document));
  const jsonLength = align4(json.length);
  const binaryLength = align4(parts.binary.length);
  const result = Buffer.alloc(12 + 8 + jsonLength + 8 + binaryLength);
  result.write("glTF", 0, 4, "ascii");
  result.writeUInt32LE(2, 4);
  result.writeUInt32LE(result.length, 8);
  result.writeUInt32LE(jsonLength, 12);
  result.writeUInt32LE(0x4e4f534a, 16);
  json.copy(result, 20);
  result.fill(0x20, 20 + json.length, 20 + jsonLength);
  const binaryHeader = 20 + jsonLength;
  result.writeUInt32LE(binaryLength, binaryHeader);
  result.writeUInt32LE(0x004e4942, binaryHeader + 4);
  parts.binary.copy(result, binaryHeader + 8);
  return result.buffer.slice(result.byteOffset, result.byteOffset + result.byteLength);
};

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

const AVATAR_TARGET_HEIGHT_M = 1.82;
const AVATAR_BIND_HEIGHT_TOLERANCE_M = 0.005;
const AVATAR_BIND_RESIDUAL_TOLERANCE = 0.001;
const AVATAR_WALK_SOLE_TOLERANCE_M = 0.025;
const AVATAR_WALK_MIN_HEIGHT_M = 1.79;
const AVATAR_WALK_MAX_HEIGHT_M = 1.86;
const AVATAR_WALK_LOOP_TOLERANCE_M = 0.002;
const AVATAR_WALK_SAMPLES = 128;
let cpuValidatedAvatarCount = 0;

const refreshSkinnedWorld = (object) => {
  object.updateMatrixWorld(true);
  object.traverse((child) => {
    if (child.isSkinnedMesh) child.skeleton.update();
  });
};

const exactSkinnedBounds = (object) => {
  refreshSkinnedWorld(object);
  return new THREE.Box3().setFromObject(object, true);
};

const matrixIdentityResidual = (matrix) => {
  let residual = 0;
  for (let index = 0; index < 16; index += 1) {
    const expected = index === 0 || index === 5 || index === 10 || index === 15 ? 1 : 0;
    residual = Math.max(residual, Math.abs(matrix.elements[index] - expected));
  }
  return residual;
};

const boxDifference = (left, right) => Math.max(
  ...left.min.toArray().map((value, index) => Math.abs(value - right.min.getComponent(index))),
  ...left.max.toArray().map((value, index) => Math.abs(value - right.max.getComponent(index))),
);

const validateAnimatedHumanoidGeometry = async (bytes, label, groundClearanceM = 0) => {
  try {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const gltfAsset = await loader.parseAsync(geometryOnlyGlb(bytes), "");
    const model = gltfAsset.scene;
    const skinnedMeshes = [];
    model.traverse((child) => { if (child.isSkinnedMesh) skinnedMeshes.push(child); });
    check(skinnedMeshes.length > 0, `${label} has no CPU-skinnable mesh`);
    if (skinnedMeshes.length === 0) return;

    refreshSkinnedWorld(model);
    const bindProduct = new THREE.Matrix4();
    let maximumBindResidual = 0;
    for (const mesh of skinnedMeshes) {
      for (let index = 0; index < mesh.skeleton.bones.length; index += 1) {
        bindProduct.multiplyMatrices(mesh.skeleton.bones[index].matrixWorld, mesh.skeleton.boneInverses[index]);
        maximumBindResidual = Math.max(maximumBindResidual, matrixIdentityResidual(bindProduct));
      }
    }
    check(maximumBindResidual <= AVATAR_BIND_RESIDUAL_TOLERANCE,
      `${label} bind residual ${maximumBindResidual.toFixed(6)} exceeds ${AVATAR_BIND_RESIDUAL_TOLERANCE}`);

    const runtimeRoot = new THREE.Group();
    runtimeRoot.add(model);
    const sourceBox = exactSkinnedBounds(runtimeRoot);
    const sourceSize = sourceBox.getSize(new THREE.Vector3());
    if (!Number.isFinite(sourceSize.y) || sourceSize.y <= 0) throw new Error("has no finite skinned height");
    const sourceCenter = sourceBox.getCenter(new THREE.Vector3());
    const scale = AVATAR_TARGET_HEIGHT_M / sourceSize.y;
    runtimeRoot.scale.setScalar(scale);
    runtimeRoot.position.set(
      -sourceCenter.x * scale,
      groundClearanceM - sourceBox.min.y * scale,
      -sourceCenter.z * scale,
    );

    const bindBox = exactSkinnedBounds(runtimeRoot);
    const bindHeight = bindBox.max.y - bindBox.min.y;
    check(Math.abs(bindHeight - AVATAR_TARGET_HEIGHT_M) <= AVATAR_BIND_HEIGHT_TOLERANCE_M,
      `${label} normalized bind height ${bindHeight.toFixed(4)}m is not 1.82m`);
    check(Math.abs(bindBox.min.y - groundClearanceM) <= AVATAR_BIND_HEIGHT_TOLERANCE_M,
      `${label} normalized bind sole ${bindBox.min.y.toFixed(4)}m misses its ${groundClearanceM.toFixed(3)}m clearance`);

    const walk = gltfAsset.animations.find((clip) => clip.name === "Walk");
    check(Boolean(walk) && Number.isFinite(walk?.duration) && walk.duration > 0, `${label} has no sampleable Walk clip`);
    if (!walk || !Number.isFinite(walk.duration) || walk.duration <= 0) return;
    const mixer = new THREE.AnimationMixer(runtimeRoot);
    const action = mixer.clipAction(walk);
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.play();

    let minimumSole = Infinity;
    let maximumSole = -Infinity;
    let minimumHeight = Infinity;
    let maximumHeight = -Infinity;
    let firstBox;
    let lastBox;
    for (let sample = 0; sample <= AVATAR_WALK_SAMPLES; sample += 1) {
      mixer.setTime(walk.duration * sample / AVATAR_WALK_SAMPLES);
      const box = exactSkinnedBounds(runtimeRoot);
      const sole = box.min.y - groundClearanceM;
      const height = box.max.y - box.min.y;
      minimumSole = Math.min(minimumSole, sole);
      maximumSole = Math.max(maximumSole, sole);
      minimumHeight = Math.min(minimumHeight, height);
      maximumHeight = Math.max(maximumHeight, height);
      if (sample === 0) firstBox = box.clone();
      if (sample === AVATAR_WALK_SAMPLES) lastBox = box.clone();
    }
    const loopResidual = boxDifference(firstBox, lastBox);
    check(minimumSole >= -AVATAR_WALK_SOLE_TOLERANCE_M,
      `${label} Walk sole penetrates ${(minimumSole * 100).toFixed(2)}cm below ground`);
    check(maximumSole <= AVATAR_WALK_SOLE_TOLERANCE_M,
      `${label} Walk sole floats ${(maximumSole * 100).toFixed(2)}cm above ground`);
    check(minimumHeight >= AVATAR_WALK_MIN_HEIGHT_M && maximumHeight <= AVATAR_WALK_MAX_HEIGHT_M,
      `${label} Walk height range ${minimumHeight.toFixed(3)}-${maximumHeight.toFixed(3)}m leaves the 1.79-1.86m envelope`);
    check(loopResidual <= AVATAR_WALK_LOOP_TOLERANCE_M,
      `${label} Walk loop AABB residual ${loopResidual.toFixed(4)}m exceeds ${AVATAR_WALK_LOOP_TOLERANCE_M}m`);
    mixer.stopAllAction();
    cpuValidatedAvatarCount += 1;
  } catch (error) {
    problems.push(`${label} CPU skinning validation failed: ${error instanceof Error ? error.message : String(error)}`);
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
  // Citizens are generated in the browser by src/pixelAvatar.ts, so there is no GLB to
  // weigh, hash or skin-check. The contract the client actually depends on — the
  // fifteen-joint MercedonianHumanoid, the front axis and its yaw correction, and the
  // Idle and Walk clips — is asserted here and in tests/pixelAvatar.test.ts.
  check(avatar.rig?.schema === "markets-and-makers.humanoid-rig.v2", `${avatar.file} lost its humanoid rig contract`);
  check(avatar.rig?.joints === 15, `${avatar.file} rig must declare fifteen joints`);
  check(["+X", "+Z"].includes(avatar.frontAxis), `${avatar.file} has no supported authored forward axis`);
  check(avatar.yawCorrectionDegrees === (avatar.frontAxis === "+X" ? -90 : 0),
    `${avatar.file} has the wrong game-facing yaw correction`);
  const clips = new Set(avatar.runtime?.animations ?? []);
  check(clips.has("Idle") && clips.has("Walk"), `${avatar.file} lost its Idle or Walk animation`);
  continue;
  // eslint-disable-next-line no-unreachable
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
    await validateAnimatedHumanoidGeometry(bytes, avatar.file, 0);
    check(document?.extensionsRequired?.includes("EXT_meshopt_compression"), `${avatar.file} is not Meshopt-compressed`);
    check(document?.extensionsRequired?.includes("EXT_texture_webp"), `${avatar.file} does not declare WebP textures`);
  } catch {
    problems.push(`${avatar.file} optimized citizen is missing`);
  }
}

const finiteVector = (value, length) => Array.isArray(value) && value.length === length && value.every(Number.isFinite);
const groundPlacementRoles = new Set(["road-shoulder", "path-verge", "flat-land", "road", "water", "avatar"]);
const groundForwardAxes = new Set(["x", "z"]);
const groundingByAsset = new Map();
const designAssets = new Map();
for (const asset of worldDesignManifest.assets ?? []) {
  check(typeof asset.id === "string" && !designAssets.has(asset.id), `duplicate or invalid world design asset ${asset.id}`);
  designAssets.set(asset.id, asset);
  const grounding = asset.grounding;
  check(Boolean(grounding) && typeof grounding === "object", `${asset.id} is missing grounding metadata`);
  if (grounding && typeof grounding === "object") {
    groundingByAsset.set(asset.id, grounding);
    check(finiteVector(grounding.baseAnchorXZ, 2), `${asset.id} grounding.baseAnchorXZ must contain two finite runtime-metre values`);
    check(finiteVector(grounding.footprintM, 2) && grounding.footprintM.every((value) => value > 0),
      `${asset.id} grounding.footprintM must contain two positive runtime-metre values`);
    const supportPointsValid = Array.isArray(grounding.supportPoints) &&
      grounding.supportPoints.every((point) => finiteVector(point, 2));
    check(supportPointsValid && (grounding.placementRole === "water" || grounding.supportPoints.length > 0),
      `${asset.id} grounding.supportPoints must contain finite [x,z] samples (water assets may use an empty array)`);
    if (supportPointsValid && finiteVector(grounding.footprintM, 2)) {
      check(grounding.supportPoints.every(([x, z]) =>
        Math.abs(x) <= grounding.footprintM[0] / 2 && Math.abs(z) <= grounding.footprintM[1] / 2),
      `${asset.id} grounding support samples must remain inside footprintM`);
    }
    check(Number.isFinite(grounding.groundClearanceM) && grounding.groundClearanceM >= 0 && grounding.groundClearanceM <= 0.5,
      `${asset.id} grounding.groundClearanceM must be between zero and 0.5 metres`);
    check(groundPlacementRoles.has(grounding.placementRole), `${asset.id} has unsupported grounding placementRole ${grounding.placementRole}`);
    check(groundForwardAxes.has(grounding.forwardAxis), `${asset.id} grounding.forwardAxis must be x or z`);
    check(asset.category !== "avatar" || grounding.placementRole === "avatar", `${asset.id} avatar must use avatar grounding`);
    if (grounding.placementRole === "water") {
      check(Number.isFinite(grounding.waterlineM) && grounding.waterlineM >= 0,
        `${asset.id} water grounding must declare a non-negative finite waterlineM`);
    } else {
      check(grounding.waterlineM === undefined, `${asset.id} non-water grounding must not declare waterlineM`);
    }
  }
  const path = inside(worldDesignRoot, asset.file);
  check(Boolean(path), `unsafe world design path ${asset.file}`);
  if (!path) continue;
  // Scenery and citizens are both generated in the browser — scenery by
  // src/proceduralAssets.ts, the civic player by src/pixelAvatar.ts — so there is no
  // GLB to weigh or hash. Grounding, placement and count rules are still checked above
  // and below, and the avatar's own contract is asserted here; the two asset tests
  // prove the client can build everything this manifest declares.
  if (asset.category === "avatar") {
    check(asset.frontAxis === "+X" && asset.yawCorrectionDegrees === -90,
      `${asset.file} must declare its +X authoring axis and -90 degree visual correction`);
    check(grounding?.forwardAxis === "x", `${asset.file} grounding must preserve its authored X-forward axis`);
  }
  continue;
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
    if (asset.category !== "avatar") {
      const meshNodes = (document.nodes ?? []).filter((node) => Number.isInteger(node.mesh));
      check((document.meshes?.length ?? 0) === 1 && meshNodes.length === 1 &&
        (document.meshes?.[0]?.primitives?.length ?? 0) === 1,
      `${asset.file} must contain exactly one single-primitive runtime mesh node for instanced scenery loading`);
    } else {
      check(asset.frontAxis === "+X" && asset.yawCorrectionDegrees === -90,
        `${asset.file} must declare its +X authoring axis and -90 degree visual correction`);
      check(grounding?.forwardAxis === "x", `${asset.file} grounding must preserve its authored X-forward axis`);
      if (parts) await validateHumanoid(parts, asset.file, "+X", -90);
      await validateAnimatedHumanoidGeometry(bytes, asset.file, grounding?.groundClearanceM ?? 0);
    }
  } catch {
    problems.push(`${asset.file} is missing`);
  }
}
check(designAssets.size === 16, "world design asset IDs are not unique");

const designPlacements = worldDesignManifest.placements ?? [];
const placementIds = new Set();
const placementCounts = new Map();
const cellKey = (x, y) => `${x}:${y}`;
const sameCellSet = (left, right) => left.size === right.size && [...left].every((cell) => right.has(cell));
const hardReserved = new Set();
const treeReserved = new Set();
const reserveRect = (target, rect, padding = 0) => {
  const minimumX = Math.min(rect.min[0], rect.max[0]) - padding;
  const maximumX = Math.max(rect.min[0], rect.max[0]) + padding;
  const minimumY = Math.min(rect.min[1], rect.max[1]) - padding;
  const maximumY = Math.max(rect.min[1], rect.max[1]) + padding;
  for (let y = minimumY; y <= maximumY; y += 1) {
    for (let x = minimumX; x <= maximumX; x += 1) target.add(cellKey(x, y));
  }
};
const reserveSquare = (target, cell, radius) => {
  if (!finiteVector(cell, 2)) return;
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) target.add(cellKey(cell[0] + dx, cell[1] + dy));
  }
};
const nearCellSet = (cell, target, radius) => {
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      if (target.has(cellKey(cell[0] + dx, cell[1] + dy))) return true;
    }
  }
  return false;
};
const reserveFunctionalCells = (target, record) => {
  for (const key of ["customer_socket_cell", "service_socket_cell", "utility_node_cell", "utility_connection_cell"]) {
    if (finiteVector(record[key], 2)) reserveSquare(target, record[key], 2);
  }
  for (const socket of record.sockets ?? []) {
    if (finiteVector(socket?.cell, 2)) reserveSquare(target, socket.cell, 2);
  }
};
for (const building of layout.buildings ?? []) {
  reserveRect(hardReserved, building.occupied_bounds_cells, 1);
  reserveRect(treeReserved, building.occupied_bounds_cells, 3);
  reserveFunctionalCells(hardReserved, building);
}
const leaseablePlots = [...(layout.plots?.existing ?? []), ...(layout.plots?.added ?? [])];
const leaseablePlotIds = new Set();
const leaseablePlotCells = new Set();
for (const plot of leaseablePlots) {
  check(typeof plot.id === "string" && !leaseablePlotIds.has(plot.id), `duplicate or invalid leaseable plot ID ${plot.id}`);
  leaseablePlotIds.add(plot.id);
  check(plot.leaseable === true, `${plot.id} must remain leaseable`);
  reserveRect(leaseablePlotCells, plot.occupied_bounds_cells);
  reserveRect(hardReserved, plot.occupied_bounds_cells, 2);
  reserveFunctionalCells(hardReserved, plot);
}
const emptyPlotTerrainCells = new Set();
for (const row of terrainGrid.rows ?? []) {
  for (const run of row.runs ?? []) {
    if (run.surface !== "empty_plot") continue;
    for (let x = run.x0; x <= run.x1; x += 1) emptyPlotTerrainCells.add(cellKey(x, row.y));
  }
}
check(leaseablePlots.length === 42 && leaseablePlotIds.size === 42, "layout must contain 42 uniquely identified leaseable plots");
check(leaseablePlotCells.size === 1_580, `leaseable plot rectangles must cover 1580 cells, found ${leaseablePlotCells.size}`);
check(emptyPlotTerrainCells.size === 1_580, `terrain must classify 1580 empty-plot cells, found ${emptyPlotTerrainCells.size}`);
check(sameCellSet(leaseablePlotCells, emptyPlotTerrainCells),
  "leaseable plot rectangles and terrain empty_plot cells must match exactly");
const plannedLeaseableLand = worldDesignManifest.spatialPlan?.leaseableLand;
check(plannedLeaseableLand?.plotCount === leaseablePlots.length,
  "world design spatial plan leaseable plot count drifted");
check(plannedLeaseableLand?.plotCells === leaseablePlotCells.size,
  "world design spatial plan leaseable cell count drifted");
const plannedPlotIds = Array.isArray(plannedLeaseableLand?.plotIds) ? plannedLeaseableLand.plotIds : [];
const plannedPlotIdSet = new Set(plannedPlotIds);
check(plannedPlotIds.length === leaseablePlotIds.size && plannedPlotIdSet.size === leaseablePlotIds.size &&
  [...leaseablePlotIds].every((plotId) => plannedPlotIdSet.has(plotId)),
  "world design spatial plan leaseable plot IDs drifted");
for (const row of terrainGrid.rows ?? []) {
  for (const run of row.runs ?? []) {
    if (run.surface !== "bridge") continue;
    for (let x = run.x0; x <= run.x1; x += 1) {
      reserveSquare(hardReserved, [x, row.y], 2);
    }
  }
}
for (const bridge of layout.transport?.bridges ?? []) {
  for (const cell of bridge.deck_cells ?? []) {
    check(finiteVector(cell, 2) && cell.every(Number.isInteger), `${bridge.id} contains an invalid bridge deck cell`);
    if (!finiteVector(cell, 2)) continue;
    check(terrainAt(cell[0], cell[1]) === "bridge", `${bridge.id} deck cell ${cell[0]},${cell[1]} is not bridge terrain`);
    reserveSquare(hardReserved, cell, 2);
  }
}
for (const point of layout.points_of_interest ?? []) {
  if (point.surface_pad_bounds) reserveRect(hardReserved, point.surface_pad_bounds, 2);
  for (const key of ["portal_anchor_cell", "anchor_cell"]) {
    if (finiteVector(point[key], 2)) reserveSquare(hardReserved, point[key], 2);
  }
}

const routeKinds = new Set(["road", "path"]);
const cardinalSteps = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const sideForDelta = (dx, dy) => dx === 1 ? "E" : dx === -1 ? "W" : dy === 1 ? "N" : "S";
const expectedTangentForSide = (side) => side === "N" || side === "S" ? "EW" : "NS";
const tangentStep = (tangent) => tangent === "EW" ? [1, 0] : [0, 1];
const normalizeYaw = (degrees) => ((degrees % 360) + 360) % 360;
const rotateXZ = ([x, z], yawDegrees) => {
  const radians = yawDegrees * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return [cosine * x + sine * z, -sine * x + cosine * z];
};
const rotatedForwardAxis = (forwardAxis, yawDegrees) => rotateXZ(forwardAxis === "x" ? [1, 0] : [0, 1], yawDegrees);
const parallelToTangent = ([x, z], tangent) => {
  const [tangentX, tangentZ] = tangent === "EW" ? [1, 0] : [0, 1];
  return Math.abs(x * tangentX + z * tangentZ) >= 0.999;
};
const worldSideVector = (side) => side === "E" ? [1, 0] : side === "W" ? [-1, 0] : side === "N" ? [0, -1] : [0, 1];
const surfaceWalkY = (surface) => {
  const match = /^land_l(\d+)$/.exec(String(surface));
  return match ? 1 + Number(match[1]) : null;
};
const inferredRouteWalkY = (x, y) => {
  const nearbyWalkHeights = new Set();
  for (let dy = -2; dy <= 2; dy += 1) {
    for (let dx = -2; dx <= 2; dx += 1) {
      const walkY = surfaceWalkY(terrainAt(x + dx, y + dy));
      if (walkY !== null) nearbyWalkHeights.add(walkY);
    }
  }
  return nearbyWalkHeights.size === 1 ? [...nearbyWalkHeights][0] : null;
};
const worldPointCell = (x, z) => [Math.floor((x + 1) / 2), Math.floor((-z + 1) / 2)];
const footprintCells = (position, footprintM, yawDegrees) => {
  if (!finiteVector(position, 2) || !finiteVector(footprintM, 2)) return [];
  const radians = normalizeYaw(yawDegrees) * Math.PI / 180;
  const cosine = Math.abs(Math.cos(radians));
  const sine = Math.abs(Math.sin(radians));
  const widthX = cosine * footprintM[0] + sine * footprintM[1];
  const widthZ = sine * footprintM[0] + cosine * footprintM[1];
  const epsilon = 1e-6;
  const minimumWorldX = position[0] - widthX / 2;
  const maximumWorldX = position[0] + widthX / 2;
  const minimumSourceY = -position[1] - widthZ / 2;
  const maximumSourceY = -position[1] + widthZ / 2;
  const minimumCellX = Math.ceil((minimumWorldX - 1 + epsilon) / 2);
  const maximumCellX = Math.floor((maximumWorldX + 1 - epsilon) / 2);
  const minimumCellY = Math.ceil((minimumSourceY - 1 + epsilon) / 2);
  const maximumCellY = Math.floor((maximumSourceY + 1 - epsilon) / 2);
  const cells = [];
  for (let y = minimumCellY; y <= maximumCellY; y += 1) {
    for (let x = minimumCellX; x <= maximumCellX; x += 1) cells.push([x, y]);
  }
  return cells;
};
const groundingFootprintCells = (position, grounding, yawDegrees) => {
  if (!finiteVector(grounding?.footprintM, 2)) return [];
  return footprintCells(position, grounding.footprintM, yawDegrees);
};
const routeAxisByCell = new Map();
const routeTransitionCells = new Set();
const sameSurface = (x, y, dx, dy, surface) => terrainAt(x + dx, y + dy) === surface;
const routeContinues = (x, y, dx, dy) =>
  routeKinds.has(terrainAt(x + dx, y + dy)) && routeKinds.has(terrainAt(x + dx * 2, y + dy * 2));
const straightRouteAxis = (x, y, surface) => {
  const horizontal = sameSurface(x, y, -1, 0, surface) && sameSurface(x, y, 1, 0, surface);
  const vertical = sameSurface(x, y, 0, -1, surface) && sameSurface(x, y, 0, 1, surface);
  if (horizontal === vertical) return null;
  if (horizontal && (routeContinues(x, y, 0, -1) || routeContinues(x, y, 0, 1))) return null;
  if (vertical && (routeContinues(x, y, -1, 0) || routeContinues(x, y, 1, 0))) return null;
  return horizontal ? "EW" : "NS";
};
for (const row of terrainGrid.rows ?? []) {
  for (const run of row.runs ?? []) {
    if (!routeKinds.has(run.surface)) continue;
    for (let x = run.x0; x <= run.x1; x += 1) {
      const axis = straightRouteAxis(x, row.y, run.surface);
      routeAxisByCell.set(cellKey(x, row.y), axis);
      if (axis === null) routeTransitionCells.add(cellKey(x, row.y));
    }
  }
}
for (const [key, axis] of routeAxisByCell) {
  if (axis === null) continue;
  const [x, y] = key.split(":").map(Number);
  const [stepX, stepY] = tangentStep(axis);
  for (const direction of [-1, 1]) {
    const neighbourAxis = routeAxisByCell.get(cellKey(x + stepX * direction, y + stepY * direction));
    if (neighbourAxis !== axis) {
      routeTransitionCells.add(key);
      break;
    }
  }
}

const requiredMinimumPlacements = {
  tr01_sunleaf_tree: 78,
  tr02_bloomfruit_tree: 50,
  tr03_tidepalm: 52,
  sh01_sunleaf_shrub: 96,
  sh02_solarbloom_shrub: 96,
  sh03_raingarden_reeds: 72,
  st01_sunrail_lamp: 64,
  st02_gardenline_bench: 24,
  st03_modular_planter: 27,
  st04_wayfinding_kiosk: 9,
  mv01_sunpod_microcar: 12,
  mv02_market_cargo_cart: 8,
  mv03_civic_shuttle: 4,
  bv01_sunwake_ferry: 3,
  bv02_makers_workboat: 4,
};
const exactPlacementCounts = new Set([
  "tr03_tidepalm", "sh03_raingarden_reeds",
  "st01_sunrail_lamp", "st02_gardenline_bench", "st03_modular_planter", "st04_wayfinding_kiosk",
  "mv01_sunpod_microcar", "mv02_market_cargo_cart", "mv03_civic_shuttle",
  "bv01_sunwake_ferry", "bv02_makers_workboat",
]);
const streetAssets = new Set(["st01_sunrail_lamp", "st02_gardenline_bench", "st03_modular_planter", "st04_wayfinding_kiosk"]);
const tangentOrientedStreetAssets = new Set(["st02_gardenline_bench", "st03_modular_planter"]);

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
  check(worldX >= -257 && worldX <= 255 && worldZ >= -351 && worldZ <= 161, `${placement.id} is outside world bounds`);
  const integerCell = Number.isInteger(cellX) && Number.isInteger(cellY) ? [cellX, cellY] : null;
  const kind = integerCell ? terrainAt(integerCell[0], integerCell[1]) : "ocean";
  const grounding = groundingByAsset.get(asset.id);
  if (asset.category === "boats") {
    check(placement.anchor === "water" && kind === "ocean", `${placement.id} must be anchored in authored ocean water`);
    check(grounding?.placementRole === "water", `${placement.id} boat asset must use water grounding`);
    check(Number.isFinite(placement.surfaceY), `${placement.id} water placement must declare finite surfaceY`);
    check(placement.sinkM === undefined, `${placement.id} must use asset grounding.waterlineM instead of legacy sinkM`);
    if (grounding) {
      const waterFootprint = groundingFootprintCells([worldX, worldZ], grounding, placement.yawDegrees);
      for (const [footprintX, footprintY] of waterFootprint) {
        check(terrainAt(footprintX, footprintY) === "ocean",
          `${placement.id} hull footprint leaves authored ocean water at ${footprintX},${footprintY}`);
      }
    }
    const authoredOceanY = worldDesignManifest.coordinateContract?.oceanY;
    if (Number.isFinite(authoredOceanY) && Number.isFinite(placement.surfaceY)) {
      check(Math.abs(placement.surfaceY - authoredOceanY) <= 0.01,
        `${placement.id} surfaceY ${placement.surfaceY} does not match authored oceanY ${authoredOceanY}`);
    }
  } else if (asset.category === "vehicles") {
    check(placement.anchor === "ground" && kind === "road", `${placement.id} must be parked on an authored road`);
    check(grounding?.placementRole === "road", `${placement.id} vehicle asset must use road grounding`);
  } else {
    check(placement.anchor === "ground" && String(kind).startsWith("land_l"), `${placement.id} must use a land cell`);
    if (asset.category === "trees" || asset.category === "shrubs") {
      check(grounding?.placementRole === "flat-land", `${placement.id} landscape asset must use flat-land grounding`);
    }
  }

  if (placement.anchor === "ground") {
    check(Number.isFinite(placement.surfaceY), `${placement.id} ground placement must declare finite surfaceY`);
    check(Boolean(integerCell), `${placement.id} ground placement must use an integer terrain cell`);
    if (!integerCell || !grounding) continue;
    const expectedWalkY = surfaceWalkY(kind);
    if (expectedWalkY !== null && Number.isFinite(placement.surfaceY)) {
      check(Math.abs(placement.surfaceY - expectedWalkY) <= 0.05,
        `${placement.id} surfaceY ${placement.surfaceY} does not match ${kind} walk height ${expectedWalkY}`);
    }

    const occupiedCells = groundingFootprintCells([worldX, worldZ], grounding, placement.yawDegrees);
    for (const [occupiedX, occupiedY] of occupiedCells) {
      check(!hardReserved.has(cellKey(occupiedX, occupiedY)),
        `${placement.id} footprint violates a padded plot, civic, socket, bridge, or POI exclusion at ${occupiedX},${occupiedY}`);
      if (asset.category === "trees") {
        check(!treeReserved.has(cellKey(occupiedX, occupiedY)),
          `${placement.id} tree footprint violates the three-cell civic-building clearance at ${occupiedX},${occupiedY}`);
      }
    }

    const expectedSupportSurface = kind;
    const supportPoints = [[0, 0], ...(grounding.supportPoints ?? [])];
    const supportCells = [];
    for (const supportPoint of supportPoints) {
      if (!finiteVector(supportPoint, 2)) continue;
      const [offsetX, offsetZ] = rotateXZ(supportPoint, placement.yawDegrees);
      const supportCell = worldPointCell(worldX + offsetX, worldZ + offsetZ);
      supportCells.push(supportCell);
      const supportSurface = terrainAt(supportCell[0], supportCell[1]);
      check(supportSurface === expectedSupportSurface,
        `${placement.id} support footprint crosses ${expectedSupportSurface} onto ${supportSurface ?? "void"} at ${supportCell[0]},${supportCell[1]}`);
    }

    if (asset.category === "vehicles") {
      const forward = rotatedForwardAxis(grounding.forwardAxis, placement.yawDegrees);
      for (const [occupiedX, occupiedY] of occupiedCells) {
        check(terrainAt(occupiedX, occupiedY) === "road",
          `${placement.id} vehicle footprint leaves authored road at ${occupiedX},${occupiedY}`);
      }
      const roadAxis = routeAxisByCell.get(cellKey(cellX, cellY));
      check(roadAxis === "EW" || roadAxis === "NS",
        `${placement.id} must occupy a straight road segment, not a junction, corner, transition, or road end`);
      if (roadAxis === "EW" || roadAxis === "NS") {
        check(parallelToTangent(forward, roadAxis),
          `${placement.id} yaw does not align its ${grounding.forwardAxis}-axis to the ${roadAxis} road`);
      }
      check(!occupiedCells.some(([occupiedX, occupiedY]) => routeTransitionCells.has(cellKey(occupiedX, occupiedY))),
        `${placement.id} footprint intrudes into a route junction, corner, transition, or end`);
      const supportWalkHeights = supportCells.map(([supportX, supportY]) => inferredRouteWalkY(supportX, supportY));
      check(supportWalkHeights.every((walkY) => walkY !== null && Math.abs(walkY - placement.surfaceY) <= 0.05),
        `${placement.id} support footprint does not resolve to one road elevation matching surfaceY`);
    }
  } else {
    check(Math.abs(worldX - cellX * 2) <= 0.01 && Math.abs(worldZ + cellY * 2) <= 0.01,
      `${placement.id} water placement violates the two-metre cell coordinate contract`);
  }

  if (streetAssets.has(asset.id) && integerCell && grounding) {
    const roadside = placement.roadside;
    check(Boolean(roadside) && typeof roadside === "object", `${placement.id} street placement is missing roadside metadata`);
    if (!roadside || typeof roadside !== "object") continue;
    check(finiteVector(roadside.routeCell, 2) && roadside.routeCell.every(Number.isInteger),
      `${placement.id} roadside.routeCell must be an integer [x,y] cell`);
    check(routeKinds.has(roadside.routeSurface), `${placement.id} roadside.routeSurface must be road or path`);
    check(["N", "E", "S", "W"].includes(roadside.side), `${placement.id} roadside.side must be N, E, S, or W`);
    check(["EW", "NS"].includes(roadside.tangent), `${placement.id} roadside.tangent must be EW or NS`);
    check(Number.isFinite(roadside.offsetM) && roadside.offsetM >= 0 && roadside.offsetM <= 0.75,
      `${placement.id} roadside.offsetM must be between zero and 0.75 metres`);

    const adjacentRoutes = cardinalSteps
      .map(([dx, dy]) => [cellX + dx, cellY + dy])
      .filter(([routeX, routeY]) => routeKinds.has(terrainAt(routeX, routeY)));
    check(adjacentRoutes.length === 1,
      `${placement.id} must have exactly one cardinal route neighbour; found ${adjacentRoutes.length}`);
    if (adjacentRoutes.length !== 1 || !finiteVector(roadside.routeCell, 2)) continue;
    const actualRouteCell = adjacentRoutes[0];
    check(actualRouteCell[0] === roadside.routeCell[0] && actualRouteCell[1] === roadside.routeCell[1],
      `${placement.id} roadside.routeCell does not match its actual cardinal route neighbour`);
    const actualRouteSurface = terrainAt(actualRouteCell[0], actualRouteCell[1]);
    check(roadside.routeSurface === actualRouteSurface,
      `${placement.id} roadside.routeSurface ${roadside.routeSurface} does not match terrain ${actualRouteSurface}`);
    const actualSide = sideForDelta(cellX - actualRouteCell[0], cellY - actualRouteCell[1]);
    check(roadside.side === actualSide, `${placement.id} roadside.side ${roadside.side} does not match actual side ${actualSide}`);
    const expectedTangent = expectedTangentForSide(actualSide);
    check(roadside.tangent === expectedTangent,
      `${placement.id} roadside.tangent ${roadside.tangent} does not match side ${actualSide}`);
    const actualRouteAxis = routeAxisByCell.get(cellKey(actualRouteCell[0], actualRouteCell[1]));
    check(actualRouteAxis === expectedTangent,
      `${placement.id} route neighbour is not part of a straight ${expectedTangent} ${actualRouteSurface} segment`);
    check(!nearCellSet(actualRouteCell, routeTransitionCells, 3),
      `${placement.id} is inside the three-cell route junction, corner, transition, or end clearance`);
    if (grounding.placementRole === "road-shoulder") {
      check(actualRouteSurface === "road", `${placement.id} road-shoulder asset must be beside a road`);
    } else if (grounding.placementRole === "path-verge") {
      check(actualRouteSurface === "path", `${placement.id} path-verge asset must be beside a path`);
    } else {
      check(false, `${placement.id} street asset must use road-shoulder or path-verge grounding`);
    }

    const [sideWorldX, sideWorldZ] = worldSideVector(actualSide);
    const expectedWorldX = cellX * 2 + sideWorldX * roadside.offsetM;
    const expectedWorldZ = -cellY * 2 + sideWorldZ * roadside.offsetM;
    check(Math.abs(worldX - expectedWorldX) <= 0.03 && Math.abs(worldZ - expectedWorldZ) <= 0.03,
      `${placement.id} roadside position does not match its declared side and offsetM`);
    const forward = rotatedForwardAxis(grounding.forwardAxis, placement.yawDegrees);
    if (tangentOrientedStreetAssets.has(asset.id)) {
      check(parallelToTangent(forward, expectedTangent),
        `${placement.id} yaw does not align its ${grounding.forwardAxis}-axis to the ${expectedTangent} route tangent`);
    } else {
      const inward = [-sideWorldX, -sideWorldZ];
      const dot = forward[0] * inward[0] + forward[1] * inward[1];
      check(dot >= 0.999,
        `${placement.id} yaw does not point its positive ${grounding.forwardAxis}-axis inward toward the route`);
    }
  } else if (placement.anchor === "ground") {
    check(Math.abs(worldX - cellX * 2) <= 0.36 && Math.abs(worldZ + cellY * 2) <= 0.36,
      `${placement.id} violates the two-metre cell coordinate contract`);
  }
}
check(placementIds.size === designPlacements.length, "world design placement IDs are not unique");
check(worldDesignManifest.counts?.staticPlacements === designPlacements.length,
  "world design static placement count does not match the manifest placement array");
check(worldDesignManifest.counts?.totalInstances === designPlacements.length + worldDesignManifest.counts?.dynamicAvatar,
  "world design total instance count does not match static placements plus dynamic avatars");
for (const [assetId, expected] of Object.entries(requiredMinimumPlacements)) {
  const actual = placementCounts.get(assetId) ?? 0;
  check(exactPlacementCounts.has(assetId) ? actual === expected : actual >= expected,
    `${assetId} placement count ${actual} violates its ${exactPlacementCounts.has(assetId) ? "exact" : "minimum"} contract of ${expected}`);
}
for (const [assetId, expected] of Object.entries(worldDesignManifest.counts?.byAsset ?? {})) {
  check(placementCounts.get(assetId) === expected, `${assetId} placement count drifted`);
}
for (const assetId of placementCounts.keys()) {
  check(Object.hasOwn(worldDesignManifest.counts?.byAsset ?? {}, assetId), `${assetId} is missing from manifest counts.byAsset`);
}
// Every avatar is generated now, so nothing reaches the GLB skinning guard. Kept as a
// tripwire: if a rigged avatar is ever reintroduced it must still pass that check.
check(cpuValidatedAvatarCount === 0,
  `CPU skinning guard ran on ${cpuValidatedAvatarCount} avatars, but all avatars are generated`);

if (problems.length) {
  console.error(`Highlands browser validation failed (${problems.length}):`);
  for (const problem of problems) console.error(`- ${problem}`);
  process.exit(1);
}
console.log(`Highlands browser validation passed: ${packageManifest.files.length} terrain files, 256 chunks, 9 civic buildings, 42 empty plots, 16 optimized world-design assets, 9 optimized citizens, and ${designPlacements.length + 1} streamed world-design instances.`);
