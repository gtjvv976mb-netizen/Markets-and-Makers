import * as THREE from "three";

// Clean terrain tiles, generated in the browser.
//
// The authored terrain ships mirror-tiled painted swatches — 512px of hand-painted
// grass and stone with heavy blotching. Repeated across a 512 m map they read as
// random patches rather than as ground, because the eye picks up the blotches and the
// mirror seam long before it reads the surface.
//
// These replace them with a flat palette base plus one small motif laid on a fixed
// lattice, so every tile matches its neighbours and the pattern is symmetric under the
// quarter-turns the world is built on. Nothing is downloaded.

const SIZE = 128;

/** How each terrain surface is dressed once its palette colour is laid down. */
type Motif = "blades" | "speckle" | "flagstone" | "planks" | "road" | "plaza" | "plain";

const MOTIF: Readonly<Record<string, Motif>> = {
  MAT_TERRAIN_GRASS_SAGE: "blades",
  MAT_TERRAIN_GRASS_DRY: "blades",
  MAT_TERRAIN_SAND: "speckle",
  MAT_TERRAIN_LIMESTONE: "flagstone",
  MAT_TERRAIN_PATH: "road",
  MAT_TERRAIN_GRAVEL: "speckle",
  MAT_TERRAIN_ROCK: "flagstone",
  MAT_TERRAIN_CLIFF: "flagstone",
  MAT_TERRAIN_TIMBER: "planks",
  MAT_TERRAIN_TIMBER_DARK: "planks",
  MAT_TERRAIN_TERRACOTTA: "flagstone",
  MAT_MM_STONE: "road",
  MAT_MM_CREAM: "plaza",
};

const shade = (context: CanvasRenderingContext2D, base: THREE.Color, amount: number, alpha = 1): void => {
  const tinted = base.clone();
  tinted.offsetHSL(0, 0, amount);
  context.fillStyle = `rgba(${Math.round(tinted.r * 255)},${Math.round(tinted.g * 255)},${Math.round(tinted.b * 255)},${alpha})`;
};

/**
 * Four-fold symmetric blades: the same eight strokes drawn in each quadrant, so the
 * tile reads the same at 0, 90, 180 and 270 degrees and never shows a seam.
 */
const drawBlades = (context: CanvasRenderingContext2D, base: THREE.Color): void => {
  const half = SIZE / 2;
  for (let quadrant = 0; quadrant < 4; quadrant += 1) {
    context.save();
    context.translate(half, half);
    context.rotate((quadrant * Math.PI) / 2);
    context.translate(-half, -half);
    for (let i = 0; i < 8; i += 1) {
      const x = 14 + (i % 4) * 15;
      const y = 16 + Math.floor(i / 4) * 17;
      shade(context, base, i % 2 === 0 ? 0.05 : -0.045, 0.85);
      context.fillRect(x, y, 2, 7);
      context.fillRect(x + 4, y + 3, 2, 5);
    }
    context.restore();
  }
};

const drawSpeckle = (context: CanvasRenderingContext2D, base: THREE.Color): void => {
  const step = SIZE / 8;
  for (let row = 0; row < 8; row += 1) {
    for (let column = 0; column < 8; column += 1) {
      // A fixed checker of two tones: regular, and still lively at a distance.
      shade(context, base, (row + column) % 2 === 0 ? 0.035 : -0.03, 0.6);
      context.fillRect(column * step + step * 0.32, row * step + step * 0.32, step * 0.36, step * 0.36);
    }
  }
};

const drawFlagstone = (context: CanvasRenderingContext2D, base: THREE.Color): void => {
  const step = SIZE / 4;
  shade(context, base, -0.09, 0.9);
  context.lineWidth = 2;
  context.strokeStyle = context.fillStyle;
  for (let i = 1; i < 4; i += 1) {
    context.beginPath();
    context.moveTo(i * step, 0);
    context.lineTo(i * step, SIZE);
    context.moveTo(0, i * step);
    context.lineTo(SIZE, i * step);
    context.stroke();
  }
  shade(context, base, 0.04, 0.5);
  for (let row = 0; row < 4; row += 1) {
    for (let column = 0; column < 4; column += 1) {
      if ((row + column) % 2 !== 0) continue;
      context.fillRect(column * step + 3, row * step + 3, step - 6, step - 6);
    }
  }
};

/**
 * A paved road: courses of setts laid in a running bond, each row offset half a block
 * from the one above. The offset is what stops it reading as a net — a square grid at
 * road width is a mesh, while staggered joints read as paving from any direction, which
 * matters because the same tile serves roads running both ways and their junctions.
 */
/**
 * Civic paving: four large slabs to a tile with a soft joint between them. A plaza is
 * the one surface a player stands still on and looks at, and flat colour reads as a
 * blank white sheet at this scale — but the fine grid used on grass would turn a wide
 * forecourt back into a net, so the slabs are deliberately large.
 */
const drawPlaza = (context: CanvasRenderingContext2D, base: THREE.Color): void => {
  const half = SIZE / 2;
  for (let row = 0; row < 2; row += 1) {
    for (let column = 0; column < 2; column += 1) {
      shade(context, base, (row + column) % 2 === 0 ? 0.012 : -0.012);
      context.fillRect(column * half + 1.5, row * half + 1.5, half - 3, half - 3);
    }
  }
  // A joint, not a keyline: soft enough that a forecourt reads as paved, not ruled.
  shade(context, base, -0.05, 0.75);
  context.fillRect(half - 1, 0, 2, SIZE);
  context.fillRect(0, half - 1, SIZE, 2);
  shade(context, base, -0.02, 0.35);
  for (let i = 0; i < 10; i += 1) context.fillRect(((i * 53) % 16) * 8 + 4, ((i * 29) % 16) * 8 + 4, 3, 3);
};

const drawRoad = (context: CanvasRenderingContext2D, base: THREE.Color): void => {
  const rows = 4;
  const blockH = SIZE / rows;
  const blockW = SIZE / 2;
  // Mortar first, as a full-bleed darker ground the setts sit proud of.
  shade(context, base, -0.055);
  context.fillRect(0, 0, SIZE, SIZE);
  for (let row = 0; row < rows; row += 1) {
    const offset = (row % 2) * (blockW / 2);
    // Three draws per row so the half-block offset wraps cleanly at the seam.
    for (let i = -1; i < 3; i += 1) {
      const x = offset + i * blockW;
      shade(context, base, row % 2 === 0 ? 0.018 : 0.004);
      context.fillRect(x + 1.5, row * blockH + 1.5, blockW - 3, blockH - 3);
    }
  }
  // A little aggregate, on a fixed lattice so it stays symmetric under quarter turns.
  shade(context, base, -0.03, 0.5);
  for (let i = 0; i < 16; i += 1) {
    const x = ((i * 37) % 16) * 8 + 3;
    const y = ((i * 53) % 16) * 8 + 3;
    context.fillRect(x, y, 2, 2);
  }
};

const drawPlanks = (context: CanvasRenderingContext2D, base: THREE.Color): void => {
  const step = SIZE / 6;
  shade(context, base, -0.08, 0.85);
  for (let i = 1; i < 6; i += 1) context.fillRect(0, i * step - 1, SIZE, 2);
  shade(context, base, 0.03, 0.4);
  for (let i = 0; i < 6; i += 2) context.fillRect(0, i * step + 2, SIZE, step - 4);
};

const cache = new Map<string, THREE.CanvasTexture>();

/**
 * A tile for any surface, in the world's own idiom: a flat palette base, one motif on a
 * fixed lattice, and a darker keyline on all four edges.
 *
 * The interiors were built with plain coloured materials while the city outside is drawn
 * from these tiles, so stepping through a door changed visual language entirely. Same
 * generator, same motifs, same borders — the room now looks like it belongs to the city
 * it stands in.
 */
export function surfaceTile(
  motif: Motif,
  colour: THREE.Color,
  options: { keyline?: boolean; border?: number } = {},
): THREE.CanvasTexture {
  const border = options.border ?? -0.22;
  const key = `surface:${motif}:${colour.getHexString()}:${border}:${options.keyline !== false}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const context = canvas.getContext("2d")!;
  shade(context, colour, 0);
  context.fillRect(0, 0, SIZE, SIZE);
  if (motif === "blades") drawBlades(context, colour);
  else if (motif === "speckle") drawSpeckle(context, colour);
  else if (motif === "flagstone") drawFlagstone(context, colour);
  else if (motif === "planks") drawPlanks(context, colour);
  else if (motif === "road") drawRoad(context, colour);
  else if (motif === "plaza") drawPlaza(context, colour);

  // The dark keyline is the whole point indoors. Outside it is subtle, because a keyline
  // repeated across 512 metres becomes a net; a room is a dozen tiles across, so the
  // border can be what it looks like in the world's own art — a drawn edge, not a hint.
  if (options.keyline !== false) {
    shade(context, colour, border, 0.9);
    context.fillRect(0, 0, SIZE, 3);
    context.fillRect(0, SIZE - 3, SIZE, 3);
    context.fillRect(0, 0, 3, SIZE);
    context.fillRect(SIZE - 3, 0, 3, SIZE);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.name = `TEX_SURFACE_${motif}`;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  cache.set(key, texture);
  return texture;
}

/**
 * A clean tile texture for a named terrain material, or null when that material is not
 * one this module dresses (water, glass and building materials keep their own art).
 */
export function terrainTileTexture(materialName: string, colour: THREE.Color): THREE.CanvasTexture | null {
  const motif = MOTIF[materialName];
  if (!motif) return null;
  const cached = cache.get(materialName);
  if (cached) return cached;

  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const context = canvas.getContext("2d");
  if (!context) return null;

  shade(context, colour, 0);
  context.fillRect(0, 0, SIZE, SIZE);
  if (motif === "blades") drawBlades(context, colour);
  else if (motif === "speckle") drawSpeckle(context, colour);
  else if (motif === "flagstone") drawFlagstone(context, colour);
  else if (motif === "planks") drawPlanks(context, colour);
  else if (motif === "road") drawRoad(context, colour);
  else if (motif === "plaza") drawPlaza(context, colour);

  // A keyline on every edge is what makes natural ground read as tiled — but across a
  // wide paved surface those same lines become a net, which is the whole point of the
  // running bond. Roads carry their joints in the motif instead.
  if (motif !== "road" && motif !== "plaza") {
    shade(context, colour, -0.07, 0.55);
    context.fillRect(0, 0, SIZE, 1);
    context.fillRect(0, SIZE - 1, SIZE, 1);
    context.fillRect(0, 0, 1, SIZE);
    context.fillRect(SIZE - 1, 0, 1, SIZE);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.name = `TEX_TILE_${materialName}`;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  cache.set(materialName, texture);
  return texture;
}

/** Test seam for the motif lattice: the tile must be square and power-of-two. */
export const TILE_TEXTURE_SIZE = SIZE;
export const DRESSED_TERRAIN_MATERIALS = Object.keys(MOTIF);


// ---------------------------------------------------------------- skipped downloads

/**
 * Painted swatches that only ever dressed surfaces this module now generates. Verified
 * against world.gltf: no other material references them, so the bytes are pure waste
 * once the generated tile replaces the map. 02-01_lush_grass.png is deliberately absent
 * — it is shared with a material we do not dress.
 */
const REPLACED_SWATCHES = new Set([
  "03-03_layered_earth.png",
  "04-06_flagstone.png",
  "05-07_sand.png",
  "06-05_limestone_blocks.png",
  "36-10_honey_timber.png",
  "37-11_dark_timber.png",
  "38-16_mossed_curb.png",
  "39-09_terracotta.png",
]);

// A served, properly encoded 2x2 transparent PNG.
//
// This was a hand-rolled minimal PNG inline as a data: URI, and GLTFLoader rejected it
// with "Couldn't load texture". The bytes were malformed: `new Image()` decoded them
// happily, but GLTFLoader loads through `createImageBitmap`, which is strict and threw
// InvalidStateError. Checking the image with the lenient decoder is what hid it.
// public/world/blank.png is emitted by zlib with real CRCs, and costs 68 bytes once.
const BLANK_PNG = "/world/blank.png";

// The world cache key is generated from the world files themselves by
// scripts/stamp-world-version.mjs, so it cannot drift from what is on disk.
export { WORLD_ASSET_VERSION } from "./worldVersion";
import { WORLD_ASSET_VERSION } from "./worldVersion";


const VERSIONED = /\/(assets\/world|world)\//;

/**
 * Redirects the swatches we replace to a blank pixel, and stamps the world version onto
 * every world asset. The generated tile is applied in styleMaterial regardless, so
 * nothing on screen changes — only the download.
 */
export function skipReplacedSwatches(manager: THREE.LoadingManager): THREE.LoadingManager {
  manager.setURLModifier((url) => {
    const file = url.split("?")[0]!.split("/").pop() ?? "";
    // The blank placeholder is returned unstamped on purpose: it is 68 bytes of
    // constant, so a long-lived cache entry for it is exactly what we want.
    if (REPLACED_SWATCHES.has(file)) return BLANK_PNG;
    return versionedWorldUrl(url);
  });
  return manager;
}

/** Adds the world version to a world asset URL, leaving everything else alone. */
export function versionedWorldUrl(url: string): string {
  if (!VERSIONED.test(url) || url.startsWith("data:")) return url;
  return url.includes("?") ? `${url}&v=${WORLD_ASSET_VERSION}` : `${url}?v=${WORLD_ASSET_VERSION}`;
}

export const REPLACED_SWATCH_FILES = [...REPLACED_SWATCHES];
