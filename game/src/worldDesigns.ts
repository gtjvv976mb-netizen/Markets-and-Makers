import * as THREE from "three";
import type { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkeleton } from "three/addons/utils/SkeletonUtils.js";
import { characterHeightScale, STANDARD_CHARACTER_HEIGHT_M, yawCorrectionFor, type CharacterFrontAxis } from "./characterRig";
import { HIGHLANDS_WORLD_BASE, worldChunkAt } from "./highlandsWorld";

export const WORLD_DESIGNS_BASE = `${HIGHLANDS_WORLD_BASE}/world-designs-v1`;
export const WORLD_DESIGNS_MANIFEST = `${WORLD_DESIGNS_BASE}/manifest.json`;

export type WorldDesignForwardAxis = "x" | "z";
export type WorldDesignPlacementRole = "flat-land" | "road-shoulder" | "path-verge" | "road" | "water" | "avatar";

export interface WorldDesignGrounding {
  /** Final, metre-space offset from the visual bounding-box centre to the real base pivot. */
  baseAnchorXZ: readonly [x: number, z: number];
  /** Curated physical footprint, rather than canopy or decorative overhang bounds. */
  footprintM: readonly [width: number, depth: number];
  /** Metre-space support probes relative to baseAnchorXZ. The centre is sampled separately. */
  supportPoints: ReadonlyArray<readonly [x: number, z: number]>;
  groundClearanceM: number;
  forwardAxis: WorldDesignForwardAxis;
  placementRole: WorldDesignPlacementRole;
  waterlineM?: number;
}

export interface WorldDesignAsset {
  id: string;
  name: string;
  category: "trees" | "shrubs" | "street" | "vehicles" | "boats" | "avatar";
  file: string;
  fit: "height" | "horizontal";
  targetM: number;
  frontAxis?: CharacterFrontAxis;
  yawCorrectionDegrees?: number;
  grounding?: Partial<WorldDesignGrounding>;
}

export interface WorldDesignRoadsidePlacement {
  routeCell: readonly [x: number, y: number];
  routeSurface: "road" | "path";
  side: "N" | "E" | "S" | "W";
  tangent: "EW" | "NS";
  offsetM: number;
}

export interface WorldDesignPlacement {
  id: string;
  assetId: string;
  position: readonly [x: number, z: number];
  yawDegrees: number;
  anchor: "ground" | "water";
  surfaceY?: number;
  roadside?: WorldDesignRoadsidePlacement;
  /** Legacy manifests may still contain this, but runtime water placement uses grounding.waterlineM. */
  sinkM?: number;
}

interface WorldDesignManifest {
  schema: string;
  counts: {
    uniqueAssets: number;
    staticPlacements: number;
    dynamicAvatar: number;
    totalInstances: number;
  };
  assets: WorldDesignAsset[];
  placements: WorldDesignPlacement[];
}

export interface WorldDesignChunk {
  object: THREE.Group;
  cx: number;
  cy: number;
}

export interface WorldDesignLoadResult {
  chunks: WorldDesignChunk[];
  avatar: { group: THREE.Group; animations: THREE.AnimationClip[] } | null;
  staticInstances: number;
  uniqueAssets: number;
}

const yAxis = new THREE.Vector3(0, 1, 0);

const rectangleSupports = (halfX: number, halfZ: number): ReadonlyArray<readonly [number, number]> => [
  [-halfX, -halfZ], [halfX, -halfZ], [halfX, halfZ], [-halfX, halfZ],
];

/**
 * Runtime grounding remains curated here until the generated manifest adopts
 * the same nested `asset.grounding` contract. Manifest values take precedence
 * as soon as they are authored, so this table is a backwards-compatible bridge.
 */
export const WORLD_DESIGN_GROUNDING: Readonly<Record<string, WorldDesignGrounding>> = {
  tr01_sunleaf_tree: {
    baseAnchorXZ: [0.147, 0.014], footprintM: [3.52, 3.33], supportPoints: rectangleSupports(1.28, 1.2),
    groundClearanceM: 0.01, forwardAxis: "z", placementRole: "flat-land",
  },
  tr02_bloomfruit_tree: {
    baseAnchorXZ: [0.017, -0.205], footprintM: [3.45, 3.69], supportPoints: rectangleSupports(1.22, 1.3),
    groundClearanceM: 0.01, forwardAxis: "z", placementRole: "flat-land",
  },
  tr03_tidepalm: {
    baseAnchorXZ: [-0.159, -0.087], footprintM: [2.76, 2.58], supportPoints: rectangleSupports(1.02, 0.94),
    groundClearanceM: 0.01, forwardAxis: "z", placementRole: "flat-land",
  },
  sh01_sunleaf_shrub: {
    baseAnchorXZ: [0.024, -0.033], footprintM: [0.24, 0.5], supportPoints: rectangleSupports(0.08, 0.18),
    groundClearanceM: 0.015, forwardAxis: "z", placementRole: "flat-land",
  },
  sh02_solarbloom_shrub: {
    baseAnchorXZ: [-0.011, 0.016], footprintM: [0.25, 0.53], supportPoints: rectangleSupports(0.09, 0.19),
    groundClearanceM: 0.015, forwardAxis: "z", placementRole: "flat-land",
  },
  sh03_raingarden_reeds: {
    baseAnchorXZ: [0.025, -0.03], footprintM: [0.9, 1.22], supportPoints: rectangleSupports(0.36, 0.49),
    groundClearanceM: 0.012, forwardAxis: "z", placementRole: "flat-land",
  },
  st01_sunrail_lamp: {
    baseAnchorXZ: [0.049, 0.287], footprintM: [0.68, 0.68], supportPoints: rectangleSupports(0.25, 0.25),
    groundClearanceM: 0.015, forwardAxis: "z", placementRole: "road-shoulder",
  },
  st02_gardenline_bench: {
    baseAnchorXZ: [0.016, -0.22], footprintM: [0.98, 2.45], supportPoints: rectangleSupports(0.39, 1.02),
    groundClearanceM: 0.015, forwardAxis: "z", placementRole: "road-shoulder",
  },
  st03_modular_planter: {
    baseAnchorXZ: [0.074, 0.05], footprintM: [2.08, 2.08], supportPoints: rectangleSupports(0.84, 0.84),
    groundClearanceM: 0.015, forwardAxis: "x", placementRole: "road-shoulder",
  },
  st04_wayfinding_kiosk: {
    baseAnchorXZ: [0.063, -0.019], footprintM: [2.16, 1.62], supportPoints: rectangleSupports(0.75, 0.55),
    groundClearanceM: 0.015, forwardAxis: "z", placementRole: "path-verge",
  },
  mv01_sunpod_microcar: {
    baseAnchorXZ: [-0.005, -0.049], footprintM: [2.4, 2.08], supportPoints: rectangleSupports(1.04, 0.82),
    groundClearanceM: 0.012, forwardAxis: "x", placementRole: "road",
  },
  mv02_market_cargo_cart: {
    baseAnchorXZ: [0.17, -0.057], footprintM: [2.54, 1.83], supportPoints: rectangleSupports(1.08, 0.7),
    groundClearanceM: 0.012, forwardAxis: "x", placementRole: "road",
  },
  mv03_civic_shuttle: {
    baseAnchorXZ: [0.215, -0.094], footprintM: [4, 2.58], supportPoints: rectangleSupports(1.72, 1.02),
    groundClearanceM: 0.012, forwardAxis: "x", placementRole: "road",
  },
  bv01_sunwake_ferry: {
    baseAnchorXZ: [-0.087, -0.021], footprintM: [7.75, 2.4], supportPoints: [],
    groundClearanceM: 0, forwardAxis: "x", placementRole: "water", waterlineM: 0.9,
  },
  bv02_makers_workboat: {
    baseAnchorXZ: [0.278, 0.008], footprintM: [6.18, 0.93], supportPoints: [],
    groundClearanceM: 0, forwardAxis: "x", placementRole: "water", waterlineM: 0.72,
  },
  av01_civic_maker: {
    baseAnchorXZ: [0.045, 0.012], footprintM: [0.43, 0.72], supportPoints: rectangleSupports(0.13, 0.23),
    groundClearanceM: 0.01, forwardAxis: "x", placementRole: "avatar",
  },
};

function finitePair(value: unknown): value is readonly [number, number] {
  return Array.isArray(value) && value.length === 2 && value.every(Number.isFinite);
}

export function worldDesignGrounding(asset: WorldDesignAsset): WorldDesignGrounding {
  const fallback = WORLD_DESIGN_GROUNDING[asset.id];
  if (!fallback) throw new Error(`${asset.id} has no curated grounding metadata`);
  const authored = asset.grounding;
  const resolved: WorldDesignGrounding = {
    baseAnchorXZ: finitePair(authored?.baseAnchorXZ) ? authored.baseAnchorXZ : fallback.baseAnchorXZ,
    footprintM: finitePair(authored?.footprintM) ? authored.footprintM : fallback.footprintM,
    supportPoints: Array.isArray(authored?.supportPoints) && authored.supportPoints.every(finitePair)
      ? authored.supportPoints
      : fallback.supportPoints,
    groundClearanceM: Number.isFinite(authored?.groundClearanceM) ? authored!.groundClearanceM! : fallback.groundClearanceM,
    forwardAxis: authored?.forwardAxis === "x" || authored?.forwardAxis === "z" ? authored.forwardAxis : fallback.forwardAxis,
    placementRole: authored?.placementRole ?? fallback.placementRole,
    waterlineM: Number.isFinite(authored?.waterlineM) ? authored!.waterlineM : fallback.waterlineM,
  };
  if (resolved.footprintM.some((dimension) => dimension <= 0) || resolved.groundClearanceM < 0) {
    throw new Error(`${asset.id} has invalid grounding dimensions or clearance`);
  }
  if (asset.category === "boats" && !Number.isFinite(resolved.waterlineM)) {
    throw new Error(`${asset.id} requires an authored waterlineM`);
  }
  return resolved;
}

// The world is drawn on a 2 m grid whose cell centres land on even world coordinates,
// and its coordinate contract allows only quarter-turn rotations. The authored scenery
// drifts up to 0.25 m off those centres and uses 15-degree yaw steps, which is what
// makes a street of props read as scattered rather than laid out. Snap what we draw.
const TILE_SIZE_M = 2;

export function snapToTileCentre(metres: number): number {
  return Math.round(metres / TILE_SIZE_M) * TILE_SIZE_M;
}

/**
 * Built things line up with the tiles; planting keeps its authored spin, because a
 * hedgerow rotated onto four headings reads as a grid, not as a garden.
 */
export function tileYaw(category: string, yawDegrees: number): number {
  if (category === "trees" || category === "shrubs") return yawDegrees;
  return Math.round(yawDegrees / 90) * 90;
}

function prepareGeometry(source: THREE.Object3D, asset: WorldDesignAsset, grounding: WorldDesignGrounding): { geometry: THREE.BufferGeometry; material: THREE.Material | THREE.Material[] } {
  source.updateWorldMatrix(true, true);
  const meshes: THREE.Mesh[] = [];
  source.traverse((object) => {
    if (object instanceof THREE.Mesh) meshes.push(object);
  });
  if (meshes.length !== 1) throw new Error(`${asset.id} must contain one optimized mesh; found ${meshes.length}`);
  const mesh = meshes[0];
  const geometry = mesh.geometry.clone();
  geometry.applyMatrix4(mesh.matrixWorld);
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox;
  if (!bounds) throw new Error(`${asset.id} has no geometry bounds`);
  const size = bounds.getSize(new THREE.Vector3());
  const dimension = asset.fit === "height" ? size.y : Math.max(size.x, size.z);
  const scale = asset.targetM / Math.max(dimension, 0.001);
  const center = bounds.getCenter(new THREE.Vector3());
  geometry.translate(-center.x, -bounds.min.y, -center.z);
  geometry.scale(scale, scale, scale);
  geometry.translate(-grounding.baseAnchorXZ[0], 0, -grounding.baseAnchorXZ[1]);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const material = Array.isArray(mesh.material)
    ? mesh.material.map((entry) => entry.clone())
    : mesh.material.clone();
  return { geometry, material };
}

function prepareAvatar(
  source: THREE.Object3D,
  animations: THREE.AnimationClip[],
  asset: WorldDesignAsset,
  grounding: WorldDesignGrounding,
  dynamicShadows: boolean,
): { group: THREE.Group; animations: THREE.AnimationClip[] } {
  const avatar = cloneSkeleton(source) as THREE.Group;
  const bounds = new THREE.Box3().setFromObject(avatar, true);
  const size = bounds.getSize(new THREE.Vector3());
  const scale = characterHeightScale(size.y);
  avatar.scale.setScalar(scale);
  avatar.position.set(
    -(bounds.min.x + bounds.max.x) * 0.5 * scale - grounding.baseAnchorXZ[0],
    -bounds.min.y * scale + grounding.groundClearanceM,
    -(bounds.min.z + bounds.max.z) * 0.5 * scale - grounding.baseAnchorXZ[1],
  );
  avatar.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.castShadow = dynamicShadows;
    object.receiveShadow = dynamicShadows;
    object.frustumCulled = true;
  });
  const wrapper = new THREE.Group();
  wrapper.name = "MM_CIVIC_MAKER_PLAYER_MODEL";
  wrapper.userData.characterHeightM = STANDARD_CHARACTER_HEIGHT_M;
  const facing = new THREE.Group();
  const inferredFrontAxis: CharacterFrontAxis = grounding.forwardAxis === "x" ? "+X" : "+Z";
  facing.rotation.y = Number.isFinite(asset.yawCorrectionDegrees)
    ? THREE.MathUtils.degToRad(asset.yawCorrectionDegrees ?? 0)
    : yawCorrectionFor(asset.frontAxis ?? inferredFrontAxis);
  facing.add(avatar);
  wrapper.add(facing);
  return { group: wrapper, animations };
}

export function worldDesignSupportSamples(
  x: number,
  z: number,
  yawDegrees: number,
  grounding: WorldDesignGrounding,
): ReadonlyArray<readonly [x: number, z: number]> {
  const radians = THREE.MathUtils.degToRad(yawDegrees);
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const samples: Array<readonly [number, number]> = [[x, z]];
  for (const [localX, localZ] of grounding.supportPoints) {
    samples.push([
      x + cosine * localX + sine * localZ,
      z - sine * localX + cosine * localZ,
    ]);
  }
  return samples;
}

const SURFACE_VERIFICATION_TOLERANCE_M = 0.12;

export function worldDesignPlacementY(
  placement: WorldDesignPlacement,
  grounding: WorldDesignGrounding,
  sampleGround: (x: number, z: number) => number | null,
): number {
  if (placement.anchor === "water") {
    if (!Number.isFinite(placement.surfaceY)) throw new Error(`${placement.id} requires manifest-authored surfaceY`);
    if (!Number.isFinite(grounding.waterlineM)) throw new Error(`${placement.id} requires asset grounding.waterlineM`);
    return placement.surfaceY! - grounding.waterlineM!;
  }

  const authoredY = Number.isFinite(placement.surfaceY) ? placement.surfaceY! : null;
  const sampledSupports = worldDesignSupportSamples(
    placement.position[0],
    placement.position[1],
    placement.yawDegrees,
    grounding,
  ).map(([sampleX, sampleZ]) => sampleGround(sampleX, sampleZ));
  if (sampledSupports.some((height) => !Number.isFinite(height)) && authoredY === null) {
    throw new Error(`${placement.id} has a missing support probe and no manifest-authored surfaceY`);
  }
  const supportHeights = sampledSupports.map((height) => Number.isFinite(height) ? height! : authoredY!);
  if (!supportHeights.length) throw new Error(`${placement.id} has no ground support probes`);
  if (authoredY !== null && supportHeights.some((height) => Math.abs(height - authoredY) > SURFACE_VERIFICATION_TOLERANCE_M)) {
    throw new Error(`${placement.id} support footprint disagrees with authored surfaceY ${authoredY.toFixed(3)}m`);
  }
  const minimumY = Math.min(...supportHeights);
  const maximumY = Math.max(...supportHeights);
  if (maximumY - minimumY > SURFACE_VERIFICATION_TOLERANCE_M) {
    throw new Error(`${placement.id} support footprint crosses a terrain step`);
  }
  return maximumY + grounding.groundClearanceM;
}

export async function loadWorldDesigns(
  loader: GLTFLoader,
  sampleGround: (x: number, z: number) => number | null,
  dynamicShadows: boolean,
  onProgress?: (completed: number, total: number, label: string) => void,
): Promise<WorldDesignLoadResult> {
  const response = await fetch(WORLD_DESIGNS_MANIFEST);
  if (!response.ok) throw new Error(`Unable to load world designs manifest (${response.status})`);
  const manifest = await response.json() as WorldDesignManifest;
  if (manifest.schema !== "markets-and-makers.world-designs-runtime.v1") {
    throw new Error(`Unsupported world designs schema: ${manifest.schema}`);
  }
  if (manifest.assets.length !== manifest.counts.uniqueAssets || manifest.placements.length !== manifest.counts.staticPlacements) {
    throw new Error("World designs manifest count contract failed");
  }

  const chunkGroups = new Map<string, WorldDesignChunk>();
  const placementsByAsset = new Map<string, WorldDesignPlacement[]>();
  const knownAssets = new Set(manifest.assets.map((asset) => asset.id));
  for (const placement of manifest.placements) {
    if (!knownAssets.has(placement.assetId)) throw new Error(`${placement.id} references unknown asset ${placement.assetId}`);
    const collection = placementsByAsset.get(placement.assetId) ?? [];
    collection.push(placement);
    placementsByAsset.set(placement.assetId, collection);
  }

  let avatar: { group: THREE.Group; animations: THREE.AnimationClip[] } | null = null;
  let completed = 0;
  let loadedUniqueAssets = 0;
  let loadedStaticInstances = 0;
  await Promise.all(manifest.assets.map(async (asset) => {
    try {
      const gltf = await loader.loadAsync(`${WORLD_DESIGNS_BASE}/${asset.file}`);
      const grounding = worldDesignGrounding(asset);
      if (asset.category === "avatar") {
        avatar = prepareAvatar(gltf.scene, gltf.animations, asset, grounding, dynamicShadows);
        loadedUniqueAssets += 1;
        return;
      }

      const prepared = prepareGeometry(gltf.scene, asset, grounding);
      const groups = new Map<string, { chunk: readonly [number, number]; placements: WorldDesignPlacement[] }>();
      for (const placement of placementsByAsset.get(asset.id) ?? []) {
        const chunk = worldChunkAt(placement.position[0], placement.position[1]);
        if (!chunk) throw new Error(`${placement.id} falls outside the authored world`);
        const key = `${chunk[0]}:${chunk[1]}`;
        const group = groups.get(key) ?? { chunk, placements: [] };
        group.placements.push(placement);
        groups.set(key, group);
      }

      const matrix = new THREE.Matrix4();
      const position = new THREE.Vector3();
      const rotation = new THREE.Quaternion();
      const unitScale = new THREE.Vector3(1, 1, 1);
      for (const [key, group] of groups) {
        let root = chunkGroups.get(key);
        if (!root) {
          const object = new THREE.Group();
          object.name = `MM_WORLD_DESIGNS_CHUNK_${group.chunk[0]}_${group.chunk[1]}`;
          // Large canopies and vehicles can cross a 32m chunk edge. Retaining
          // one extra design-only halo prevents boundary pop-in without
          // widening expensive terrain streaming.
          object.userData.visibilityPaddingChunks = 1;
          root = { object, cx: group.chunk[0], cy: group.chunk[1] };
          chunkGroups.set(key, root);
        }
        const instances = new THREE.InstancedMesh(prepared.geometry, prepared.material, group.placements.length);
        instances.name = `MM_WORLD_DESIGNS_${asset.id.toUpperCase()}_${key.replace(":", "_")}`;
        const isWater = grounding.placementRole === "water" || asset.category === "boats";
        instances.castShadow = dynamicShadows && !isWater;
        instances.receiveShadow = dynamicShadows && !isWater;
        instances.frustumCulled = true;
        instances.userData.assetId = asset.id;
        instances.userData.category = asset.category;
        instances.userData.grounding = grounding;
        group.placements.forEach((placement, index) => {
          // Ground probing stays on the authored point so the surface checks above keep
          // validating the tile the prop was authored against; only what we draw is
          // snapped onto the grid.
          const groundY = worldDesignPlacementY(placement, grounding, sampleGround);
          const x = snapToTileCentre(placement.position[0]);
          const z = snapToTileCentre(placement.position[1]);
          position.set(x, groundY, z);
          rotation.setFromAxisAngle(yAxis, THREE.MathUtils.degToRad(tileYaw(asset.category, placement.yawDegrees)));
          matrix.compose(position, rotation, unitScale);
          instances.setMatrixAt(index, matrix);
        });
        instances.instanceMatrix.needsUpdate = true;
        instances.computeBoundingBox();
        instances.computeBoundingSphere();
        root.object.add(instances);
        loadedStaticInstances += group.placements.length;
      }
      loadedUniqueAssets += 1;
    }
    finally {
      completed += 1;
      onProgress?.(completed, manifest.assets.length, asset.name);
    }
  }));

  if (loadedUniqueAssets !== manifest.counts.uniqueAssets || loadedStaticInstances !== manifest.counts.staticPlacements) {
    throw new Error(
      `World designs loaded ${loadedUniqueAssets}/${manifest.counts.uniqueAssets} assets and ` +
      `${loadedStaticInstances}/${manifest.counts.staticPlacements} static placements`,
    );
  }

  return {
    chunks: [...chunkGroups.values()],
    avatar,
    staticInstances: loadedStaticInstances,
    uniqueAssets: loadedUniqueAssets,
  };
}
