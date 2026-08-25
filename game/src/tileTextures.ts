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
type Motif = "blades" | "speckle" | "flagstone" | "planks" | "plain";

const MOTIF: Readonly<Record<string, Motif>> = {
  MAT_TERRAIN_GRASS_SAGE: "blades",
  MAT_TERRAIN_GRASS_DRY: "blades",
  MAT_TERRAIN_SAND: "speckle",
  MAT_TERRAIN_LIMESTONE: "flagstone",
  MAT_TERRAIN_PATH: "speckle",
  MAT_TERRAIN_GRAVEL: "speckle",
  MAT_TERRAIN_ROCK: "flagstone",
  MAT_TERRAIN_CLIFF: "flagstone",
  MAT_TERRAIN_TIMBER: "planks",
  MAT_TERRAIN_TIMBER_DARK: "planks",
  MAT_TERRAIN_TERRACOTTA: "flagstone",
  MAT_MM_STONE: "flagstone",
  MAT_MM_CREAM: "plain",
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

const drawPlanks = (context: CanvasRenderingContext2D, base: THREE.Color): void => {
  const step = SIZE / 6;
  shade(context, base, -0.08, 0.85);
  for (let i = 1; i < 6; i += 1) context.fillRect(0, i * step - 1, SIZE, 2);
  shade(context, base, 0.03, 0.4);
  for (let i = 0; i < 6; i += 2) context.fillRect(0, i * step + 2, SIZE, step - 4);
};

const cache = new Map<string, THREE.CanvasTexture>();

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

  // A consistent keyline on every tile is what makes a tiled world read as tiled.
  shade(context, colour, -0.07, 0.55);
  context.fillRect(0, 0, SIZE, 1);
  context.fillRect(0, SIZE - 1, SIZE, 1);
  context.fillRect(0, 0, 1, SIZE);
  context.fillRect(SIZE - 1, 0, 1, SIZE);

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

// A 1x1 transparent PNG, so the glTF parser still gets a valid image to bind.
const BLANK_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

/**
 * Redirects the swatches we replace to a blank pixel. The generated tile is applied in
 * styleMaterial regardless, so nothing on screen changes — only the download.
 */
export function skipReplacedSwatches(manager: THREE.LoadingManager): THREE.LoadingManager {
  manager.setURLModifier((url) => {
    const file = url.split("?")[0]!.split("/").pop() ?? "";
    return REPLACED_SWATCHES.has(file) ? BLANK_PNG : url;
  });
  return manager;
}

export const REPLACED_SWATCH_FILES = [...REPLACED_SWATCHES];
