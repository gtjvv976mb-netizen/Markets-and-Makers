import * as THREE from "three";
import type { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { HIGHLANDS_WORLD_BASE, worldChunkAt } from "./highlandsWorld";

export const WORLD_DESIGNS_BASE = `${HIGHLANDS_WORLD_BASE}/world-designs-v1`;
export const WORLD_DESIGNS_MANIFEST = `${WORLD_DESIGNS_BASE}/manifest.json`;

interface WorldDesignAsset {
  id: string;
  name: string;
  category: "trees" | "shrubs" | "street" | "vehicles" | "boats" | "avatar";
  file: string;
  fit: "height" | "horizontal";
  targetM: number;
}

interface WorldDesignPlacement {
  id: string;
  assetId: string;
  position: readonly [x: number, z: number];
  yawDegrees: number;
  anchor: "ground" | "water";
  surfaceY?: number;
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
  avatar: THREE.Group | null;
  staticInstances: number;
  uniqueAssets: number;
}

const yAxis = new THREE.Vector3(0, 1, 0);

function prepareGeometry(source: THREE.Object3D, asset: WorldDesignAsset): { geometry: THREE.BufferGeometry; material: THREE.Material | THREE.Material[] } {
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
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const material = Array.isArray(mesh.material)
    ? mesh.material.map((entry) => entry.clone())
    : mesh.material.clone();
  return { geometry, material };
}

function prepareAvatar(source: THREE.Object3D, asset: WorldDesignAsset, dynamicShadows: boolean): THREE.Group {
  const avatar = source.clone(true);
  const bounds = new THREE.Box3().setFromObject(avatar);
  const size = bounds.getSize(new THREE.Vector3());
  const scale = asset.targetM / Math.max(size.y, 0.001);
  avatar.scale.setScalar(scale);
  avatar.position.set(
    -(bounds.min.x + bounds.max.x) * 0.5 * scale,
    -bounds.min.y * scale,
    -(bounds.min.z + bounds.max.z) * 0.5 * scale,
  );
  avatar.rotation.y = Math.PI;
  avatar.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.castShadow = dynamicShadows;
    object.receiveShadow = dynamicShadows;
    object.frustumCulled = true;
  });
  const wrapper = new THREE.Group();
  wrapper.name = "MM_CIVIC_MAKER_PLAYER_MODEL";
  wrapper.add(avatar);
  return wrapper;
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
  for (const placement of manifest.placements) {
    const collection = placementsByAsset.get(placement.assetId) ?? [];
    collection.push(placement);
    placementsByAsset.set(placement.assetId, collection);
  }

  let avatar: THREE.Group | null = null;
  let completed = 0;
  await Promise.all(manifest.assets.map(async (asset) => {
    try {
      const gltf = await loader.loadAsync(`${WORLD_DESIGNS_BASE}/${asset.file}`);
      if (asset.category === "avatar") {
        avatar = prepareAvatar(gltf.scene, asset, dynamicShadows);
        return;
      }

      const prepared = prepareGeometry(gltf.scene, asset);
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
          root = { object, cx: group.chunk[0], cy: group.chunk[1] };
          chunkGroups.set(key, root);
        }
        const instances = new THREE.InstancedMesh(prepared.geometry, prepared.material, group.placements.length);
        instances.name = `MM_WORLD_DESIGNS_${asset.id.toUpperCase()}_${key.replace(":", "_")}`;
        instances.castShadow = dynamicShadows && (asset.category === "trees" || asset.category === "vehicles");
        instances.receiveShadow = dynamicShadows && asset.category !== "boats";
        instances.frustumCulled = true;
        instances.userData.assetId = asset.id;
        instances.userData.category = asset.category;
        group.placements.forEach((placement, index) => {
          const x = placement.position[0];
          const z = placement.position[1];
          const groundY = placement.anchor === "water"
            ? (placement.surfaceY ?? -0.18) - (placement.sinkM ?? 0)
            : (sampleGround(x, z) ?? 1.02);
          position.set(x, groundY, z);
          rotation.setFromAxisAngle(yAxis, THREE.MathUtils.degToRad(placement.yawDegrees));
          matrix.compose(position, rotation, unitScale);
          instances.setMatrixAt(index, matrix);
        });
        instances.instanceMatrix.needsUpdate = true;
        instances.computeBoundingBox();
        instances.computeBoundingSphere();
        root.object.add(instances);
      }
    }
    catch (error) {
      console.warn(`World design asset unavailable: ${asset.id}`, error);
    }
    finally {
      completed += 1;
      onProgress?.(completed, manifest.assets.length, asset.name);
    }
  }));

  return {
    chunks: [...chunkGroups.values()],
    avatar,
    staticInstances: manifest.counts.staticPlacements,
    uniqueAssets: manifest.counts.uniqueAssets,
  };
}
