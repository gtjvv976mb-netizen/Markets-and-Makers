/**
 * What a business's floor is worth, as multipliers.
 *
 * This file is the ONLY definition of that rule, and it is deliberately pure: no store, no
 * DOM, no clock, no imports beyond the floor geometry. It exists in this shape because the
 * rule has to run in two places — the browser, which shows a maker what their floor is doing
 * right now, and the authority, which decides what they actually earned while they were away.
 *
 * Two copies of a spatial rule drift, and the drift is silent and monetary: it shows up as a
 * player who is told they are producing one number and paid another. `server/src/floor.ts` is
 * a verbatim copy of this file (the codebase duplicates rather than shares across the two
 * packages — see server/src/catalogue.ts), and `shared/floor-fixtures.json` pins ~30 layouts
 * to their expected multipliers and is executed by BOTH test suites. If the two ever disagree,
 * both suites go red on the same fixture rather than the difference being discovered in a
 * player's balance.
 */

import {
  APRON_MIN_CLEARANCE, apronTiles, DEFAULT_EQUIPMENT_TILES, FITTINGS, FLOOR_WALKWAY_COLUMN,
  tileIsBuildable, type Facing, type FittingKey, type UpgradeKey,
} from "./data";

export interface Tile { column: number; row: number }

export interface FloorLayout {
  tiles: Partial<Record<UpgradeKey, Tile>>;
  facings: Partial<Record<UpgradeKey, Facing>>;
  fittings: Partial<Record<FittingKey, Tile | null>>;
  upgrades: Record<UpgradeKey, number>;
}

export interface FloorEffects {
  /** How much of each station's own upgrade bonus its floor delivers, 0.7 to 1. */
  clearance: Record<UpgradeKey, number>;
  /** Fittings that are bought AND standing where they can reach the machine they serve. */
  connected: FittingKey[];
  output: number;
  speed: number;
  price: number;
  storage: number;
  inputThrift: number;
  /** Machines standing shoulder to shoulder, capped. Pure upside. */
  benches: number;
  /** Machines whose working face is on the aisle, capped per side. Pure upside. */
  frontage: number;
}

const STATION_KEYS = Object.keys(DEFAULT_EQUIPMENT_TILES) as UpgradeKey[];
const FITTING_KEYS = Object.keys(FITTINGS) as FittingKey[];

/** Benches and frontage are capped so no arrangement can be farmed by repetition. */
export const MAX_BENCHES = 3;
export const BENCH_OUTPUT_STEP = 1.05;
export const MAX_FRONTAGE_PER_SIDE = 2;
export const FRONTAGE_PRICE_STEP = 0.02;

export function tileOf(layout: FloorLayout, key: UpgradeKey): Tile {
  return layout.tiles[key] ?? DEFAULT_EQUIPMENT_TILES[key]!;
}

/** Machines face the aisle until their owner turns them. */
export function facingOf(layout: FloorLayout, key: UpgradeKey): Facing {
  return layout.facings[key] ?? (tileOf(layout, key).column < FLOOR_WALKWAY_COLUMN ? "E" : "W");
}

export function apronOf(layout: FloorLayout, key: UpgradeKey): Tile[] {
  return apronTiles(tileOf(layout, key), facingOf(layout, key), layout.upgrades[key] ?? 0);
}

/**
 * A fitting reaches its machine by touching it OR by standing on its apron.
 *
 * Touching is the original rule and is kept verbatim so nothing disconnects when this ships.
 * The apron half means reach grows as the machine is levelled — the reward for levelling
 * rather than a new constraint.
 */
export function fittingReaches(layout: FloorLayout, key: FittingKey, tile: Tile): boolean {
  const serves = FITTINGS[key].serves;
  const station = tileOf(layout, serves);
  if (station.column === tile.column && station.row === tile.row) return false;
  const touching = Math.abs(station.column - tile.column) <= 1 && Math.abs(station.row - tile.row) <= 1;
  if (touching) return true;
  return apronOf(layout, serves).some((spot) => spot.column === tile.column && spot.row === tile.row);
}

export function floorEffects(layout: FloorLayout): FloorEffects {
  // --- every tile any machine wants, so overlap can be counted once ------------------------
  const aprons = new Map<UpgradeKey, Tile[]>();
  const claims = new Map<string, number>();
  for (const key of STATION_KEYS) {
    const apron = apronOf(layout, key);
    aprons.set(key, apron);
    for (const tile of apron) {
      // Only the serviced bay is contestable. The aisle and the shop floor beyond it hold no
      // machines, so an apron reaching onto them is breathing room rather than a squeeze.
      if (!tileIsBuildable(tile.column, tile.row)) continue;
      const id = `${tile.column}:${tile.row}`;
      claims.set(id, (claims.get(id) ?? 0) + 1);
    }
  }

  const stationAt = new Map<string, UpgradeKey>();
  for (const key of STATION_KEYS) {
    const tile = tileOf(layout, key);
    stationAt.set(`${tile.column}:${tile.row}`, key);
  }
  const fittingServes = new Map<string, UpgradeKey>();
  const connected: FittingKey[] = [];
  for (const key of FITTING_KEYS) {
    const tile = layout.fittings[key];
    if (!tile) continue;
    fittingServes.set(`${tile.column}:${tile.row}`, FITTINGS[key].serves);
    if (fittingReaches(layout, key, tile)) connected.push(key);
  }

  // --- clearance ---------------------------------------------------------------------------
  const clearance = {} as Record<UpgradeKey, number>;
  for (const key of STATION_KEYS) {
    const apron = aprons.get(key)!;
    // A machine with nothing bought has no apron, so a new maker is charged nothing at all.
    if (!apron.length) { clearance[key] = 1; continue; }
    // Shoved face-first into a wall: too little floor in front is itself the fault, and
    // without this such a machine scored a free 1.00 for having no apron left to clutter.
    if (apron.length < 3) { clearance[key] = APRON_MIN_CLEARANCE; continue; }
    let clutter = 0;
    for (const tile of apron) {
      const id = `${tile.column}:${tile.row}`;
      const station = stationAt.get(id);
      if (station !== undefined && station !== key) { clutter += 1; continue; }
      const serves = fittingServes.get(id);
      // A fitting serving THIS machine belongs on its apron and costs nothing, so a correct
      // arrangement can never punish itself.
      if (serves !== undefined && serves !== key) { clutter += 1; continue; }
      if ((claims.get(id) ?? 0) > 1) clutter += 1;
    }
    clearance[key] = Math.max(
      APRON_MIN_CLEARANCE,
      1 - (1 - APRON_MIN_CLEARANCE) * (clutter / apron.length),
    );
  }

  // --- benches: machines standing shoulder to shoulder --------------------------------------
  // Orthogonally adjacent, and neither one facing the other. Back-to-back and side-by-side
  // are benches; face-to-face is not, which keeps the rules consistent — a valid bench can
  // never be the thing that creates clutter.
  let benches = 0;
  for (let i = 0; i < STATION_KEYS.length; i += 1) {
    for (let j = i + 1; j < STATION_KEYS.length; j += 1) {
      const a = STATION_KEYS[i]!, b = STATION_KEYS[j]!;
      const ta = tileOf(layout, a), tb = tileOf(layout, b);
      const orthogonal = Math.abs(ta.column - tb.column) + Math.abs(ta.row - tb.row) === 1;
      if (!orthogonal) continue;
      const facesEachOther =
        apronOf(layout, a).some((t) => t.column === tb.column && t.row === tb.row)
        || apronOf(layout, b).some((t) => t.column === ta.column && t.row === ta.row);
      if (!facesEachOther) benches += 1;
    }
  }
  benches = Math.min(MAX_BENCHES, benches);

  // --- frontage: working faces on the aisle --------------------------------------------------
  // Capped per side, so a third machine on one bank is worth nothing and full frontage needs
  // both halves of the room worked. That is what stops "line them all up on one column".
  let left = 0, right = 0;
  for (const key of STATION_KEYS) {
    const tile = tileOf(layout, key);
    const step = { N: { column: 0, row: -1 }, E: { column: 1, row: 0 },
                   S: { column: 0, row: 1 }, W: { column: -1, row: 0 } }[facingOf(layout, key)];
    if (tile.column + step.column !== FLOOR_WALKWAY_COLUMN) continue;
    if (tile.column < FLOOR_WALKWAY_COLUMN) left += 1; else right += 1;
  }
  const frontage = Math.min(MAX_FRONTAGE_PER_SIDE, left) + Math.min(MAX_FRONTAGE_PER_SIDE, right);

  // --- fitting effects ----------------------------------------------------------------------
  const total = { output: 1, speed: 1, inputThrift: 1, storage: 1, price: 1 };
  for (const key of connected) {
    const effect = FITTINGS[key].effect as Partial<typeof total>;
    for (const field of Object.keys(total) as Array<keyof typeof total>) {
      if (effect[field] !== undefined) total[field] *= effect[field]!;
    }
  }

  return {
    clearance,
    connected,
    output: total.output * Math.pow(BENCH_OUTPUT_STEP, benches),
    speed: total.speed,
    // Nothing is paid in SPEED beyond the fittings that already did: jobDuration floors at
    // .52 and a level-4 station reaches exactly .52 unaided, so a bench or frontage bonus
    // spent there would be worth zero to precisely the players who earned it.
    price: total.price * (1 + FRONTAGE_PRICE_STEP * frontage),
    storage: total.storage,
    inputThrift: total.inputThrift,
    benches,
    frontage,
  };
}
