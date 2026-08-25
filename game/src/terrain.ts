import * as THREE from "three";

// The Highlands & Rivers world as tiles. The authored grid describes every cell as a
// run of one surface at one elevation, so the whole terrain raises into a handful of
// instanced meshes — one per surface, one instance per run — instead of a baked mesh.

export interface WorldBuilding {
  id: string | null;
  name: string | null;
  kind: string | null;
  cell: [number, number];
  center: [number, number, number];
  size: [number, number, number] | null;
}

export interface WorldPlot {
  id: string;
  cell: [number, number];
  footprint: [number, number];
  district: string | null;
  edge: string | null;
}

export interface WorldPoi {
  id: string;
  name: string;
  kind: string;
  cell: [number, number] | null;
  level: number | null;
}

export interface WorldTiles {
  id: string;
  bounds: { min: [number, number]; max: [number, number] };
  tileSize: number;
  elevationStep: number;
  baseWalkZ: number;
  oceanZ: number;
  waterInset: number;
  canalWaterZ: number;
  surfaces: string[];
  runs: number[];
  buildings: WorldBuilding[];
  plots: WorldPlot[];
  poi: WorldPoi[];
}

// Solarpunk palette: land climbs from river green to dry upland, water stays teal.
const SURFACE_COLOR: Record<string, number> = {
  ocean: 0x1d7f93,
  natural_water: 0x2f9fb0,
  civic_canal: 0x3fb2c0,
  land_l0: 0x86b45c,
  land_l1: 0x8fba61,
  land_l2: 0x98c066,
  land_l3: 0xa3c66d,
  land_l4: 0xadcb75,
  land_l5: 0xb7d07f,
  land_l6: 0xc0d389,
  land_l7: 0xc9d795,
  road: 0xcfc4a4,
  path: 0xd8cfb0,
  bridge: 0xa9825c,
  empty_plot: 0xbfae7e,
};

const WATER = new Set(["ocean", "natural_water", "civic_canal"]);

export function isWaterSurface(surface: string): boolean {
  return WATER.has(surface);
}

/** Walkable height of a tile, in world units, from the authored coordinate contract. */
export function surfaceHeight(world: WorldTiles, surface: string, level: number): number {
  if (surface === "ocean") return world.oceanZ;
  // Rivers and canals sit a fixed inset below the walk surface of their own level.
  if (surface === "natural_water") return world.baseWalkZ + level * world.elevationStep - world.waterInset;
  if (surface === "civic_canal") return world.canalWaterZ + level * world.elevationStep;
  return world.baseWalkZ + level * world.elevationStep;
}

export interface BuiltTerrain {
  group: THREE.Group;
  /** Walk height at a world position, so the player and citizens stand on the ground. */
  heightAt: (x: number, z: number) => number;
  /** True when the position is water or off the map — nobody should walk there. */
  blocked: (x: number, z: number) => boolean;
  tileSize: number;
}

export function buildTerrain(world: WorldTiles): BuiltTerrain {
  const group = new THREE.Group();
  const size = world.tileSize;
  const { min, max } = world.bounds;
  const width = max[0] - min[0] + 1;
  const depth = max[1] - min[1] + 1;

  // A lookup the player and the citizens can query per frame without touching the mesh.
  const heightGrid = new Float32Array(width * depth);
  const blockGrid = new Uint8Array(width * depth);
  blockGrid.fill(1);

  const runCount = world.runs.length / 5;
  const bySurface = new Map<number, number>();
  for (let i = 0; i < runCount; i += 1) bySurface.set(world.runs[i * 5 + 3]!, (bySurface.get(world.runs[i * 5 + 3]!) ?? 0) + 1);

  const box = new THREE.BoxGeometry(1, 1, 1);
  const cursors = new Map<number, number>();
  const meshes = new Map<number, THREE.InstancedMesh>();
  for (const [surfaceIdx, count] of bySurface) {
    const name = world.surfaces[surfaceIdx]!;
    const water = WATER.has(name);
    const material = new THREE.MeshLambertMaterial({
      color: SURFACE_COLOR[name] ?? 0x9ab86a,
      transparent: water,
      opacity: water ? 0.86 : 1,
    });
    const mesh = new THREE.InstancedMesh(box, material, count);
    mesh.castShadow = false;
    mesh.receiveShadow = !water;
    mesh.frustumCulled = false;
    meshes.set(surfaceIdx, mesh);
    cursors.set(surfaceIdx, 0);
    group.add(mesh);
  }

  // Every column runs down to one floor so cliff faces read as solid rock, not paper.
  const floor = world.oceanZ - 6;
  const matrix = new THREE.Matrix4();
  for (let i = 0; i < runCount; i += 1) {
    const y = world.runs[i * 5]!;
    const x0 = world.runs[i * 5 + 1]!;
    const x1 = world.runs[i * 5 + 2]!;
    const surfaceIdx = world.runs[i * 5 + 3]!;
    const level = world.runs[i * 5 + 4]!;
    const name = world.surfaces[surfaceIdx]!;
    const top = surfaceHeight(world, name, level);
    const span = x1 - x0 + 1;

    const mesh = meshes.get(surfaceIdx)!;
    const cursor = cursors.get(surfaceIdx)!;
    cursors.set(surfaceIdx, cursor + 1);
    matrix.makeScale(span * size, top - floor, size);
    matrix.setPosition(((x0 + x1) / 2) * size, (top + floor) / 2, -y * size);
    mesh.setMatrixAt(cursor, matrix);

    const water = WATER.has(name);
    for (let x = x0; x <= x1; x += 1) {
      const cell = (y - min[1]) * width + (x - min[0]);
      heightGrid[cell] = water ? surfaceHeight(world, name, level) : top;
      blockGrid[cell] = water ? 1 : 0;
    }
  }
  for (const mesh of meshes.values()) mesh.instanceMatrix.needsUpdate = true;

  const cellOf = (x: number, z: number): number => {
    const cx = Math.round(x / size);
    const cy = Math.round(-z / size);
    if (cx < min[0] || cx > max[0] || cy < min[1] || cy > max[1]) return -1;
    return (cy - min[1]) * width + (cx - min[0]);
  };

  return {
    group,
    tileSize: size,
    heightAt: (x, z) => {
      const cell = cellOf(x, z);
      return cell < 0 ? world.baseWalkZ : heightGrid[cell]!;
    },
    blocked: (x, z) => {
      const cell = cellOf(x, z);
      return cell < 0 || blockGrid[cell] === 1;
    },
  };
}

/** World-space position of a cell anchor, so buildings land where the layout says. */
export function cellToWorld(world: WorldTiles, cell: [number, number], footprint: [number, number] = [1, 1]): THREE.Vector3 {
  const size = world.tileSize;
  const cx = cell[0] + footprint[0] / 2 - 0.5;
  const cy = cell[1] + footprint[1] / 2 - 0.5;
  return new THREE.Vector3(cx * size, 0, -cy * size);
}

export async function loadWorldTiles(url = "/world/highlands-rivers.json"): Promise<WorldTiles> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`world tiles ${response.status}`);
  return (await response.json()) as WorldTiles;
}
