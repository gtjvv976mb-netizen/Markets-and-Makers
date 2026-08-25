import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { versionedWorldUrl } from "./tileTextures";

// Streets: asphalt, lane markings, kerbs, lamps and moving traffic, all raised from the
// extracted carriageway bands.
//
// The tile texture underneath cannot carry a centre line, because one tile serves roads
// running both ways and their junctions — a dash baked into it would point the wrong way
// half the time. Markings therefore live here, where the road's axis is known.

export interface RoadNet {
  tileSize: number;
  laneWidthCells: number;
  /** [axis (0 = east-west, 1 = north-south), centre cell, from cell, to cell] */
  /** [row, x0, x1] — every carriageway cell, junctions included. */
  roadRuns: Array<[number, number, number]>;
  pathRuns: Array<[number, number, number]>;
  carriageways: Array<[number, number, number, number]>;
  footways: Array<[number, number, number, number]>;
}

const ASPHALT = 0x3f4147;
const MARKING = 0xe8e2cc;
const KERB = 0xc9c2a8;
const FOOTWAY = 0xd8cfb0;
const LAMP_POST = 0x8d9298;
const LAMP_HEAD = 0xffd980;
const SOLAR = 0x2b3f63;

/** Ground height under a point, so streets follow the terrain they are cut into. */
export type SampleGround = (x: number, z: number) => number | null;

interface Segment { x: number; z: number; length: number; horizontal: boolean; y: number }

const CAR_BODY = [0xd9d3c4, 0x9fb4c4, 0xc98c5f, 0x8fa9a2, 0xb46e63, 0xe0c07a] as const;

export interface BuiltStreets {
  group: THREE.Group;
  update: (delta: number) => void;
  carCount: number;
  lampCount: number;
}

export function buildStreets(net: RoadNet, sampleGround: SampleGround, options: { shadows: boolean }): BuiltStreets {
  const group = new THREE.Group();
  group.name = "MM_STREETS";
  const tile = net.tileSize;
  const laneWidth = net.laneWidthCells * tile;

  // Roads are cut into terraces, so a long run can change level. Sampling every few
  // cells keeps the surface on the ground without paying for per-cell geometry.
  const STEP_CELLS = 4;

  /** Slabs covering a set of cell runs, split so each piece can sit at its own height. */
  const surfaceFrom = (cellRuns: Array<[number, number, number]>, inset: number): Segment[] => {
    const pieces: Segment[] = [];
    for (const [row, x0, x1] of cellRuns) {
      for (let start = x0; start <= x1; start += STEP_CELLS) {
        const end = Math.min(start + STEP_CELLS - 1, x1);
        const width = (end - start + 1) * tile;
        const x = ((start + end) / 2) * tile;
        const z = -row * tile;
        const ground = sampleGround(x, z);
        if (ground === null) continue;
        pieces.push({ x, z, length: width - inset, horizontal: true, y: ground });
      }
    }
    return pieces;
  };

  // Every cell, so a junction is never a hole and a stub is never missing.
  const segments = surfaceFrom(net.roadRuns, 0);

  const box = new THREE.BoxGeometry(1, 1, 1);
  const matrix = new THREE.Matrix4();
  const material = (color: number, roughness = 0.95) =>
    new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 });

  // --- carriageway surface ---------------------------------------------------
  const asphalt = new THREE.InstancedMesh(box, material(ASPHALT, 0.98), segments.length);
  asphalt.name = "MM_STREET_ASPHALT";
  asphalt.receiveShadow = options.shadows;
  asphalt.castShadow = false;
  segments.forEach((s, i) => {
    matrix.makeScale(s.length, 0.09, tile);
    matrix.setPosition(s.x, s.y + 0.045, s.z);
    asphalt.setMatrixAt(i, matrix);
  });
  asphalt.instanceMatrix.needsUpdate = true;
  group.add(asphalt);

  // --- kerbs -----------------------------------------------------------------
  // A kerb is the edge of a carriageway, so it cannot exist where the neighbouring
  // cell is itself carriageway — that is a junction, and a kerb laid across one chops
  // the intersection into pieces. Emitted per cell so the gap is exact.
  const roadCells = new Set<string>();
  for (const [row, x0, x1] of net.roadRuns) {
    for (let x = x0; x <= x1; x += 1) roadCells.add(`${x},${row}`);
  }
  const kerbPieces: Array<{ x: number; z: number; horizontal: boolean; y: number }> = [];
  for (const [axis, centre, from, to] of net.carriageways) {
    const horizontal = axis === 0;
    for (let step = from; step <= to; step += 1) {
      for (const side of [-1, 1]) {
        // The cell the kerb would sit in, just outside the two-cell carriageway.
        const edgeCell = centre + side * 1.5;
        const cellX = horizontal ? step : Math.round(edgeCell);
        const cellY = horizontal ? Math.round(edgeCell) : step;
        if (roadCells.has(`${cellX},${cellY}`)) continue;
        const x = horizontal ? step * tile : (centre + side * (net.laneWidthCells / 2 + 0.09)) * tile;
        const z = horizontal ? -(centre + side * (net.laneWidthCells / 2 + 0.09)) * tile : -step * tile;
        const ground = sampleGround(x, z);
        if (ground === null) continue;
        kerbPieces.push({ x, z, horizontal, y: ground });
      }
    }
  }
  const kerbs = new THREE.InstancedMesh(box, material(KERB, 0.9), kerbPieces.length);
  kerbs.name = "MM_STREET_KERBS";
  kerbs.receiveShadow = options.shadows;
  kerbPieces.forEach((piece, i) => {
    matrix.makeScale(piece.horizontal ? tile : 0.36, 0.18, piece.horizontal ? 0.36 : tile);
    matrix.setPosition(piece.x, piece.y + 0.09, piece.z);
    kerbs.setMatrixAt(i, matrix);
  });
  kerbs.instanceMatrix.needsUpdate = true;
  group.add(kerbs);

  // --- broken centre line ----------------------------------------------------
  // Dashes are laid along the road's own axis, two metres on and two off.
  const dashes: Array<{ x: number; z: number; horizontal: boolean; y: number }> = [];
  const DASH = 2.0;
  const GAP = 2.0;
  for (const [axis, centre, from, to] of net.carriageways) {
    const horizontal = axis === 0;
    const startM = from * tile;
    const endM = to * tile;
    for (let at = startM + GAP; at + DASH < endM; at += DASH + GAP) {
      const along = at + DASH / 2;
      const x = horizontal ? along : centre * tile;
      const z = horizontal ? -centre * tile : -along;
      const ground = sampleGround(x, z);
      if (ground === null) continue;
      dashes.push({ x, z, horizontal, y: ground });
    }
  }
  const markings = new THREE.InstancedMesh(box, material(MARKING, 0.7), dashes.length);
  markings.name = "MM_STREET_MARKINGS";
  dashes.forEach((d, i) => {
    matrix.makeScale(d.horizontal ? DASH : 0.22, 0.02, d.horizontal ? 0.22 : DASH);
    matrix.setPosition(d.x, d.y + 0.1, d.z);
    markings.setMatrixAt(i, matrix);
  });
  markings.instanceMatrix.needsUpdate = true;
  group.add(markings);

  // --- footways --------------------------------------------------------------
  const footSegments = surfaceFrom(net.pathRuns, 0.25);

  const footway = new THREE.InstancedMesh(box, material(FOOTWAY, 0.94), footSegments.length);
  footway.name = "MM_STREET_FOOTWAYS";
  footway.receiveShadow = options.shadows;
  footSegments.forEach((s, i) => {
    matrix.makeScale(s.length, 0.07, tile * 0.9);
    matrix.setPosition(s.x, s.y + 0.035, s.z);
    footway.setMatrixAt(i, matrix);
  });
  footway.instanceMatrix.needsUpdate = true;
  group.add(footway);

  // --- lamps -----------------------------------------------------------------
  // Standing on the kerb, alternating sides, at an even spacing so a street reads as
  // laid out rather than scattered.
  const SPACING = 18;
  const lamps: Array<{ x: number; z: number; y: number }> = [];
  for (const [axis, centre, from, to] of net.carriageways) {
    const horizontal = axis === 0;
    const startM = from * tile;
    const endM = to * tile;
    let side = 1;
    for (let at = startM + SPACING / 2; at < endM; at += SPACING) {
      const offset = (laneWidth / 2 + 0.55) * side;
      const x = horizontal ? at : centre * tile + offset;
      const z = horizontal ? -centre * tile + offset : -at;
      const ground = sampleGround(x, z);
      side *= -1;
      if (ground === null) continue;
      lamps.push({ x, z, y: ground });
    }
  }
  if (lamps.length > 0) group.add(buildLamps(lamps, options.shadows));

  // --- traffic ---------------------------------------------------------------
  const traffic = buildTraffic(net, sampleGround, options.shadows);
  group.add(traffic.group);

  return { group, update: traffic.update, carCount: traffic.count, lampCount: lamps.length };
}

/** One merged lamp, instanced along the kerb. */
function buildLamps(at: Array<{ x: number; z: number; y: number }>, shadows: boolean): THREE.InstancedMesh {
  const parts: THREE.BufferGeometry[] = [];
  const colours: number[] = [];
  const push = (geometry: THREE.BufferGeometry, colour: number) => { parts.push(geometry); colours.push(colour); };

  const base = new THREE.CylinderGeometry(0.22, 0.26, 0.3, 8); base.translate(0, 0.15, 0);
  push(base, LAMP_POST);
  const column = new THREE.CylinderGeometry(0.09, 0.11, 4.2, 8); column.translate(0, 2.4, 0);
  push(column, LAMP_POST);
  const arm = new THREE.BoxGeometry(0.7, 0.1, 0.1); arm.translate(0.3, 4.5, 0);
  push(arm, LAMP_POST);
  const head = new THREE.BoxGeometry(0.62, 0.16, 0.34); head.translate(0.55, 4.4, 0);
  push(head, LAMP_HEAD);
  const panel = new THREE.BoxGeometry(0.66, 0.05, 0.4); panel.translate(0.1, 4.66, 0);
  push(panel, SOLAR);

  const coloured = parts.map((geometry, i) => {
    const count = geometry.attributes.position!.count;
    const array = new Float32Array(count * 3);
    const colour = new THREE.Color().setHex(colours[i]!, THREE.SRGBColorSpace);
    for (let v = 0; v < count; v += 1) { array[v * 3] = colour.r; array[v * 3 + 1] = colour.g; array[v * 3 + 2] = colour.b; }
    geometry.setAttribute("color", new THREE.BufferAttribute(array, 3));
    geometry.deleteAttribute("uv");
    return geometry;
  });
  const merged = mergeGeometries(coloured, false)!;
  const mesh = new THREE.InstancedMesh(merged, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 }), at.length);
  mesh.name = "MM_STREET_LAMPS";
  mesh.castShadow = shadows;
  const matrix = new THREE.Matrix4();
  at.forEach((p, i) => {
    matrix.makeRotationY(((i % 4) * Math.PI) / 2);
    matrix.setPosition(p.x, p.y, p.z);
    mesh.setMatrixAt(i, matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

interface Car { mesh: THREE.Object3D; road: number; along: number; direction: 1 | -1; speed: number; lane: 1 | -1 }

/** Where two carriageways cross, expressed in each one's own along-metres. */
interface Crossing { at: number; road: number; otherAt: number }

/**
 * Traffic that drives the network.
 *
 * Cars used to turn round at the end of a run, because a band is a straight line and
 * nothing connected one to another — so a car could never leave the road it started on.
 * Carriageways are axis-aligned, so a junction is simply an east-west band and a
 * north-south band whose spans contain each other's centre; that gives a graph to drive
 * rather than a set of corridors. A car reaching a junction may take it, and only
 * reverses when it runs out of road, which now happens at a genuine dead end.
 */
function buildTraffic(net: RoadNet, sampleGround: SampleGround, shadows: boolean): { group: THREE.Group; update: (delta: number) => void; count: number } {
  const group = new THREE.Group();
  group.name = "MM_STREET_TRAFFIC";
  const tile = net.tileSize;
  const usable = net.carriageways.filter(([, , from, to]) => to - from >= 6);

  const crossings: Crossing[][] = usable.map(() => []);
  usable.forEach(([axisA, centreA, fromA, toA], a) => {
    if (axisA !== 0) return;
    usable.forEach(([axisB, centreB, fromB, toB], b) => {
      if (axisB !== 1) return;
      const meets = centreB >= fromA && centreB <= toA && centreA >= fromB && centreA <= toB;
      if (!meets) return;
      // The east-west band meets it at the other's x; the north-south band at its y.
      crossings[a]!.push({ at: centreB * tile, road: b, otherAt: centreA * tile });
      crossings[b]!.push({ at: centreA * tile, road: a, otherAt: centreB * tile });
    });
  });
  for (const list of crossings) list.sort((x, y) => x.at - y.at);

  // Seven of the carriageways have no crossing at all, so a car placed there could only
  // ever reverse. Start everyone on a road that connects to something.
  const driveable = usable.map((_, index) => index).filter((index) => (crossings[index]?.length ?? 0) > 0);
  const spawnable = driveable.length > 0 ? driveable : usable.map((_, index) => index);

  const cars: Car[] = [];
  const count = Math.min(30, spawnable.length);
  for (let i = 0; i < count; i += 1) {
    const mesh = buildCar(CAR_BODY[i % CAR_BODY.length]!);
    mesh.castShadow = shadows;
    group.add(mesh);
    const roadIndex = spawnable[Math.floor((i / count) * spawnable.length)]!;
    const [, , from, to] = usable[roadIndex]!;
    cars.push({
      mesh,
      road: roadIndex,
      along: from * tile + ((i * 17) % Math.max(1, (to - from) * tile)),
      direction: i % 2 === 0 ? 1 : -1,
      speed: 4.4 + (i % 5) * 0.8,
      lane: i % 2 === 0 ? 1 : -1,
    });
  }

  // Often enough that the city feels driven, rarely enough that a car still follows a
  // road for a while rather than jittering at every crossing.
  const TURN_CHANCE = 0.4;

  const update = (delta: number): void => {
    for (const car of cars) {
      const previous = car.along;
      car.along += car.speed * delta * car.direction;

      for (const crossing of crossings[car.road] ?? []) {
        const passed = car.direction === 1
          ? previous < crossing.at && car.along >= crossing.at
          : previous > crossing.at && car.along <= crossing.at;
        if (!passed || Math.random() > TURN_CHANCE) continue;
        const [, , from, to] = usable[crossing.road]!;
        const startM = from * tile;
        const endM = to * tile;
        // Head whichever way has more road left, so a turn does not immediately
        // dead-end into a reverse.
        car.direction = (crossing.otherAt - startM > endM - crossing.otherAt ? -1 : 1) as 1 | -1;
        car.road = crossing.road;
        car.along = crossing.otherAt;
        break;
      }

      const [axis, centre, from, to] = usable[car.road]!;
      const horizontal = axis === 0;
      const startM = from * tile;
      const endM = to * tile;
      if (car.along > endM || car.along < startM) {
        // A genuine dead end: no crossing took us off, so turn round.
        car.direction = (car.direction === 1 ? -1 : 1) as 1 | -1;
        car.lane = -car.lane as 1 | -1;
        car.along = Math.min(Math.max(car.along, startM), endM);
      }
      const offset = 1.05 * car.lane;
      const x = horizontal ? car.along : centre * tile + offset;
      const z = horizontal ? -centre * tile + offset : -car.along;
      const ground = sampleGround(x, z);
      car.mesh.position.set(x, (ground ?? car.mesh.position.y) + 0.14, z);
      car.mesh.rotation.y = horizontal
        ? (car.direction === 1 ? Math.PI / 2 : -Math.PI / 2)
        : (car.direction === 1 ? Math.PI : 0);
    }
  };

  return { group, update, count: cars.length };
}

/** A small solar runabout, in the same blocky language as everything else. */
function buildCar(bodyColour: number): THREE.Group {
  const car = new THREE.Group();
  const add = (geometry: THREE.BufferGeometry, colour: number, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: colour, roughness: 0.65 }));
    mesh.position.set(x, y, z);
    car.add(mesh);
  };
  add(new THREE.BoxGeometry(1.5, 0.6, 2.9), bodyColour, 0, 0.42, 0);
  add(new THREE.BoxGeometry(1.32, 0.55, 1.5), 0x8fc9cf, 0, 0.95, -0.15);
  add(new THREE.BoxGeometry(1.36, 0.06, 1.2), SOLAR, 0, 1.25, -0.15);
  for (const wx of [-0.72, 0.72]) for (const wz of [-0.95, 0.95]) {
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.2, 8), new THREE.MeshStandardMaterial({ color: 0x2a2320, roughness: 0.9 }));
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(wx, 0.3, wz);
    car.add(wheel);
  }
  return car;
}

export async function loadRoadNet(url = "./world/roadnet.json"): Promise<RoadNet> {
  const response = await fetch(versionedWorldUrl(url));
  if (!response.ok) throw new Error(`roadnet ${response.status}`);
  return (await response.json()) as RoadNet;
}
