// Solid world: what the avatar cannot walk through, and how to walk around it.
//
// Terrain already blocks the avatar — sampleWalkHeight refuses water and cliffs. But a
// building sits ON walkable ground, so the height sample under it succeeds and the
// avatar strolls straight through the wall. Structures therefore need a footprint of
// their own, kept here rather than as scene-graph queries: a raycast per frame per
// obstacle is a cost the phone tier cannot pay, and the footprints never move.
//
// Everything is an axis-aligned box. Buildings are authored square to the grid, the
// streets run north-south and east-west, and traffic drives along them, so a rotated
// box would buy nothing. The avatar is treated as a square of side 2r, which makes the
// overlap test one subtraction per axis and — importantly — makes sliding fall out for
// free: push out along the SHALLOWER axis and a walk into a wall becomes a walk along
// it, with no corner to catch on.

/** A solid footprint in world metres, centred on (x, z). */
export interface Blocker {
  x: number;
  z: number;
  halfX: number;
  halfZ: number;
}

/** How far the avatar's body reaches from its centre. */
export const PLAYER_RADIUS = 0.42;

/** Grid pitch for the static broad-phase, in metres. */
const CELL = 8;

/** Cells searched around a query point; a footprint wider than this must fan out. */
const cellKey = (cx: number, cz: number): number => cx * 100_000 + cz;

export interface Push {
  x: number;
  z: number;
  moved: boolean;
}

export class ObstacleField {
  private readonly cells = new Map<number, Blocker[]>();
  private readonly statics: Blocker[] = [];
  /** Movers (traffic) are re-read every query — they are few, so they skip the grid. */
  private movers: () => Blocker[] = () => [];

  add(blocker: Blocker): void {
    this.statics.push(blocker);
    const minX = Math.floor((blocker.x - blocker.halfX) / CELL);
    const maxX = Math.floor((blocker.x + blocker.halfX) / CELL);
    const minZ = Math.floor((blocker.z - blocker.halfZ) / CELL);
    const maxZ = Math.floor((blocker.z + blocker.halfZ) / CELL);
    for (let cx = minX; cx <= maxX; cx += 1) {
      for (let cz = minZ; cz <= maxZ; cz += 1) {
        const key = cellKey(cx, cz);
        const bucket = this.cells.get(key);
        if (bucket) bucket.push(blocker);
        else this.cells.set(key, [blocker]);
      }
    }
  }

  addBox(x: number, z: number, width: number, depth: number, margin = 0): void {
    this.add({ x, z, halfX: width / 2 + margin, halfZ: depth / 2 + margin });
  }

  setMovers(source: () => Blocker[]): void {
    this.movers = source;
  }

  clear(): void {
    this.cells.clear();
    this.statics.length = 0;
    this.movers = () => [];
  }

  get size(): number {
    return this.statics.length;
  }

  /** Static footprints whose cell the point falls in, plus every mover. */
  private near(x: number, z: number, radius: number): Blocker[] {
    const found: Blocker[] = [];
    const minX = Math.floor((x - radius) / CELL);
    const maxX = Math.floor((x + radius) / CELL);
    const minZ = Math.floor((z - radius) / CELL);
    const maxZ = Math.floor((z + radius) / CELL);
    for (let cx = minX; cx <= maxX; cx += 1) {
      for (let cz = minZ; cz <= maxZ; cz += 1) {
        const bucket = this.cells.get(cellKey(cx, cz));
        if (!bucket) continue;
        for (const blocker of bucket) if (!found.includes(blocker)) found.push(blocker);
      }
    }
    return found;
  }

  /** True when a body of `radius` centred here overlaps anything solid. */
  blocked(x: number, z: number, radius = PLAYER_RADIUS, includeMovers = true): boolean {
    for (const blocker of this.near(x, z, radius)) {
      if (Math.abs(x - blocker.x) < blocker.halfX + radius && Math.abs(z - blocker.z) < blocker.halfZ + radius) {
        return true;
      }
    }
    if (!includeMovers) return false;
    for (const blocker of this.movers()) {
      if (Math.abs(x - blocker.x) < blocker.halfX + radius && Math.abs(z - blocker.z) < blocker.halfZ + radius) {
        return true;
      }
    }
    return false;
  }

  /**
   * Shove a body out of anything it is inside.
   *
   * Only ever needed when the world moves onto the avatar rather than the other way
   * round — a car driving over them, or a building raised on the plot they are standing
   * on. Resolving along the shallower axis takes the shortest way out.
   */
  push(x: number, z: number, radius = PLAYER_RADIUS): Push {
    let cx = x;
    let cz = z;
    let moved = false;
    // Two passes: leaving one footprint can enter its neighbour's, and a third pass has
    // never changed the answer in the fixtures.
    for (let pass = 0; pass < 2; pass += 1) {
      const candidates = [...this.near(cx, cz, radius), ...this.movers()];
      let deepest: Blocker | null = null;
      let deepestOverlap = 0;
      for (const blocker of candidates) {
        const overlapX = blocker.halfX + radius - Math.abs(cx - blocker.x);
        const overlapZ = blocker.halfZ + radius - Math.abs(cz - blocker.z);
        if (overlapX <= 0 || overlapZ <= 0) continue;
        const shallow = Math.min(overlapX, overlapZ);
        if (shallow > deepestOverlap) {
          deepestOverlap = shallow;
          deepest = blocker;
        }
      }
      if (!deepest) break;
      const overlapX = deepest.halfX + radius - Math.abs(cx - deepest.x);
      const overlapZ = deepest.halfZ + radius - Math.abs(cz - deepest.z);
      if (overlapX < overlapZ) cx += (cx >= deepest.x ? 1 : -1) * (overlapX + 0.001);
      else cz += (cz >= deepest.z ? 1 : -1) * (overlapZ + 0.001);
      moved = true;
    }
    return { x: cx, z: cz, moved };
  }
}

// --- routing -----------------------------------------------------------------
//
// Click-to-walk used to give up the moment the straight line met a wall, which is what
// "the avatar gets stuck" looked like from the outside: you clicked past a building and
// nothing happened. A* over a metre grid routes around instead.
//
// The grid carries FOOTPRINTS ONLY, not terrain. Sampling ground height costs a raycast
// per cell, and a search box is a few thousand cells; that is a frame's budget spent on
// a single click. Terrain still blocks the walk itself — tryMoveTo owns that — so a leg
// that A* thinks is clear but the ground refuses simply stalls, and the follower
// re-plans. Routes are therefore honest about buildings and optimistic about cliffs.

const STEP = 1;
/** Room to search beyond the straight line, so a route can go the long way round. */
const MARGIN = 26;
/** A search this big means the goal is walled off; stop rather than sweep the island. */
const MAX_NODES = 12_000;

export interface RouteOptions {
  radius?: number;
  /** Traffic is excluded from routing: a route planned around a car is stale at once. */
  includeMovers?: boolean;
  /**
   * Ground the mover can actually stand on. The obstacle field only knows about SOLIDS;
   * the mover also refuses terrain whose height sample is null, so a planner that cannot
   * ask the same question plans lines the avatar can only slide along.
   */
  isWalkable?: (x: number, z: number) => boolean;
}

/**
 * A walkable route from start to goal, as waypoints, or null when none was found.
 * The first waypoint is the first turn, not the start.
 */
export function route(
  field: ObstacleField,
  startX: number,
  startZ: number,
  goalX: number,
  goalZ: number,
  options: RouteOptions = {},
): Array<{ x: number; z: number }> | null {
  const radius = options.radius ?? PLAYER_RADIUS;
  const movers = options.includeMovers ?? false;
  // The mover refuses ground the height sampler rejects, so the planner must refuse it too.
  // Without this the router drew a straight "clear" line across a null-terrain patch and the
  // avatar spent minutes sliding along its edge at 5% speed. Measured on the live line:
  // blocked=false, y=NULL, at the exact stall point.
  const walkable = options.isWalkable ?? ((): boolean => true);
  const free = (x: number, z: number): boolean => !field.blocked(x, z, radius, movers) && walkable(x, z);

  // Nothing in the way: the straight line is the route, and no search is run at all.
  if (clearLine(field, startX, startZ, goalX, goalZ, radius, movers, walkable)) return [{ x: goalX, z: goalZ }];

  const minX = Math.min(startX, goalX) - MARGIN;
  const maxX = Math.max(startX, goalX) + MARGIN;
  const minZ = Math.min(startZ, goalZ) - MARGIN;
  const maxZ = Math.max(startZ, goalZ) + MARGIN;
  const columns = Math.ceil((maxX - minX) / STEP) + 1;
  const rows = Math.ceil((maxZ - minZ) / STEP) + 1;
  const index = (col: number, row: number): number => row * columns + col;
  const toCol = (x: number): number => Math.round((x - minX) / STEP);
  const toRow = (z: number): number => Math.round((z - minZ) / STEP);
  const atX = (col: number): number => minX + col * STEP;
  const atZ = (row: number): number => minZ + row * STEP;

  const startCol = toCol(startX);
  const startRow = toRow(startZ);
  let goalCol = toCol(goalX);
  let goalRow = toRow(goalZ);

  // A click that lands ON a building should walk to its door, not fail. Take the
  // nearest free cell to where they clicked.
  if (!free(atX(goalCol), atZ(goalRow))) {
    const nearest = nearestFree(free, atX, atZ, goalCol, goalRow, columns, rows, startX, startZ);
    if (!nearest) return null;
    goalCol = nearest.col;
    goalRow = nearest.row;
  }

  const total = columns * rows;
  const cost = new Float32Array(total).fill(Infinity);
  const cameFrom = new Int32Array(total).fill(-1);
  const closed = new Uint8Array(total);
  const heuristic = (col: number, row: number): number => Math.hypot(col - goalCol, row - goalRow);

  const open: Array<{ node: number; score: number }> = [];
  const startNode = index(startCol, startRow);
  cost[startNode] = 0;
  open.push({ node: startNode, score: heuristic(startCol, startRow) });

  const NEIGHBOURS: ReadonlyArray<readonly [number, number]> = [
    [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
  ];

  let expanded = 0;
  let goalNode = -1;
  while (open.length > 0) {
    // A binary heap is the textbook answer; a linear scan over a few thousand entries
    // measures under a millisecond and runs once per click.
    let best = 0;
    for (let i = 1; i < open.length; i += 1) if (open[i]!.score < open[best]!.score) best = i;
    const current = open.splice(best, 1)[0]!.node;
    if (closed[current]) continue;
    closed[current] = 1;
    if (current === index(goalCol, goalRow)) {
      goalNode = current;
      break;
    }
    expanded += 1;
    if (expanded > MAX_NODES) break;

    const col = current % columns;
    const row = Math.floor(current / columns);
    for (const [dc, dr] of NEIGHBOURS) {
      const nextCol = col + dc;
      const nextRow = row + dr;
      if (nextCol < 0 || nextRow < 0 || nextCol >= columns || nextRow >= rows) continue;
      const node = index(nextCol, nextRow);
      if (closed[node]) continue;
      if (!free(atX(nextCol), atZ(nextRow))) continue;
      // A diagonal that clips a corner would be walked as a wall-scrape; require both
      // orthogonal neighbours to be free so the route stays walkable as flown.
      if (dc !== 0 && dr !== 0) {
        if (!free(atX(col + dc), atZ(row)) || !free(atX(col), atZ(row + dr))) continue;
      }
      const step = cost[current]! + (dc !== 0 && dr !== 0 ? Math.SQRT2 : 1);
      if (step >= cost[node]!) continue;
      cost[node] = step;
      cameFrom[node] = current;
      open.push({ node, score: step + heuristic(nextCol, nextRow) });
    }
  }

  if (goalNode < 0) return null;

  const cells: Array<{ x: number; z: number }> = [];
  for (let node = goalNode; node !== -1 && node !== startNode; node = cameFrom[node]!) {
    cells.push({ x: atX(node % columns), z: atZ(Math.floor(node / columns)) });
  }
  cells.reverse();
  // The true goal, not the cell centre it snapped to — unless the click was inside a
  // building, in which case the snapped cell IS the destination.
  if (free(goalX, goalZ)) cells.push({ x: goalX, z: goalZ });
  return smooth(field, startX, startZ, cells, radius, movers, walkable);
}

/** Drop waypoints that a straight line already covers, so the walk reads naturally. */
function smooth(
  field: ObstacleField,
  startX: number,
  startZ: number,
  cells: Array<{ x: number; z: number }>,
  radius: number,
  movers: boolean,
  walkable: (x: number, z: number) => boolean = () => true,
): Array<{ x: number; z: number }> {
  const kept: Array<{ x: number; z: number }> = [];
  let fromX = startX;
  let fromZ = startZ;
  let i = 0;
  while (i < cells.length) {
    let furthest = i;
    for (let j = cells.length - 1; j > i; j -= 1) {
      // Same standard as the search itself, or smoothing quietly re-crosses the exact
      // terrain A* just detoured around.
      if (clearLine(field, fromX, fromZ, cells[j]!.x, cells[j]!.z, radius, movers, walkable)) {
        furthest = j;
        break;
      }
    }
    const point = cells[furthest]!;
    kept.push(point);
    fromX = point.x;
    fromZ = point.z;
    i = furthest + 1;
  }
  return kept;
}

/** Walk the segment at half the body radius and report whether it stays clear. */
function clearLine(
  field: ObstacleField,
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
  radius: number,
  movers: boolean,
  walkable: (x: number, z: number) => boolean = () => true,
): boolean {
  const span = Math.hypot(toX - fromX, toZ - fromZ);
  const steps = Math.max(1, Math.ceil(span / (radius > 0 ? radius : 0.5)));
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const x = fromX + (toX - fromX) * t;
    const z = fromZ + (toZ - fromZ) * t;
    if (field.blocked(x, z, radius, movers) || !walkable(x, z)) return false;
  }
  return true;
}

/**
 * Spiral out from a blocked goal cell for the nearest free one.
 *
 * Of the free cells in the first ring that has any, take the one closest to the walker.
 * Taking the first found instead walks you round to whichever corner the iteration
 * happened to reach first — a click on the near wall of City Hall sent the avatar the
 * long way to its far corner.
 */
function nearestFree(
  free: (x: number, z: number) => boolean,
  atX: (col: number) => number,
  atZ: (row: number) => number,
  goalCol: number,
  goalRow: number,
  columns: number,
  rows: number,
  fromX: number,
  fromZ: number,
): { col: number; row: number } | null {
  for (let ring = 1; ring <= 24; ring += 1) {
    let best: { col: number; row: number } | null = null;
    let bestDistance = Infinity;
    for (let dc = -ring; dc <= ring; dc += 1) {
      for (let dr = -ring; dr <= ring; dr += 1) {
        if (Math.max(Math.abs(dc), Math.abs(dr)) !== ring) continue;
        const col = goalCol + dc;
        const row = goalRow + dr;
        if (col < 0 || row < 0 || col >= columns || row >= rows) continue;
        if (!free(atX(col), atZ(row))) continue;
        const distance = Math.hypot(atX(col) - fromX, atZ(row) - fromZ);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = { col, row };
        }
      }
    }
    if (best) return best;
  }
  return null;
}
