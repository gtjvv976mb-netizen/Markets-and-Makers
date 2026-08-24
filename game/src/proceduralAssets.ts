import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { GLTF, GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

// Procedural stand-ins for the building and decoration GLBs.
//
// The authored terrain is untouched — this replaces only the props standing on it. Each
// asset is merged into ONE vertex-coloured mesh, which is what the world-designs
// pipeline requires in order to instance it, and costs no download at all.
//
// Everything is authored on the world's own 2 m tile grid: footprints are whole tiles
// and every part sits on a half-tile step, so a building lines up with the tiles under
// it instead of floating at an arbitrary offset.

const TILE = 2;
const tiles = (count: number): number => count * TILE;

// Solarpunk palette, from the authored art direction.
const CREAM = 0xd9cfae;
const PLASTER = 0xe6dcc0;
const TERRACOTTA = 0xa9705c;
const ROOF = 0x3a3733;
const TIMBER = 0x9a7350;
const SOLAR = 0x2b3f63;
const GLASS = 0x8fc9cf;
const LEAF = 0x5f9445;
const LEAF_LIGHT = 0x7fae52;
const BLOOM = 0xd7758f;
const REED = 0x8fa855;
const METAL = 0xb9c0c4;
const ACCENT = 0xe0b040;
const HULL = 0xc8d2d6;
const SOIL = 0x6f5a3c;

/** Accumulates parts and bakes them into a single vertex-coloured geometry. */
class Mesher {
  private readonly parts: THREE.BufferGeometry[] = [];
  private readonly colour = new THREE.Color();
  private readonly matrix = new THREE.Matrix4();
  private readonly euler = new THREE.Euler();
  private readonly quaternion = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3();
  private readonly position = new THREE.Vector3();

  private push(geometry: THREE.BufferGeometry, colour: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): void {
    const part = geometry.clone();
    this.position.set(x, y, z);
    this.quaternion.setFromEuler(this.euler.set(rx, ry, rz));
    this.scale.set(1, 1, 1);
    part.applyMatrix4(this.matrix.compose(this.position, this.quaternion, this.scale));
    const count = part.attributes.position!.count;
    const colours = new Float32Array(count * 3);
    this.colour.setHex(colour, THREE.SRGBColorSpace);
    for (let i = 0; i < count; i += 1) {
      colours[i * 3] = this.colour.r;
      colours[i * 3 + 1] = this.colour.g;
      colours[i * 3 + 2] = this.colour.b;
    }
    part.setAttribute("color", new THREE.BufferAttribute(colours, 3));
    part.deleteAttribute("uv");
    this.parts.push(part);
  }

  /** A box whose footprint is given in metres; y is the underside. */
  box(w: number, h: number, d: number, colour: number, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0): this {
    this.push(new THREE.BoxGeometry(w, h, d), colour, x, y + h / 2, z, rx, ry, rz);
    return this;
  }

  cyl(radius: number, h: number, colour: number, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, segments = 10): this {
    this.push(new THREE.CylinderGeometry(radius, radius, h, segments), colour, x, y + h / 2, z, rx, ry, rz);
    return this;
  }

  cone(radius: number, h: number, colour: number, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0): this {
    this.push(new THREE.ConeGeometry(radius, h, 10), colour, x, y + h / 2, z, rx, ry, rz);
    return this;
  }

  /** A sphere centred on y, for foliage. */
  ball(radius: number, colour: number, x = 0, y = 0, z = 0, squash = 1): this {
    const geometry = new THREE.SphereGeometry(radius, 10, 7);
    geometry.scale(1, squash, 1);
    this.push(geometry, colour, x, y, z);
    return this;
  }

  /** A half-cylinder arching along z — the greenhouse vault. */
  vault(radius: number, length: number, colour: number, x: number, y: number, z = 0): this {
    const geometry = new THREE.CylinderGeometry(radius, radius, length, 12, 1, true, 0, Math.PI);
    this.push(geometry, colour, x, y, z, 0, Math.PI / 2, Math.PI / 2);
    return this;
  }

  /** A pitched roof as two leaning slabs. */
  gable(w: number, d: number, rise: number, colour: number, y: number): this {
    const slope = Math.atan2(rise, w / 2);
    const length = Math.hypot(w / 2, rise);
    this.box(length, 0.2, d, colour, -w / 4, y + rise / 2, 0, 0, 0, slope);
    this.box(length, 0.2, d, colour, w / 4, y + rise / 2, 0, 0, 0, -slope);
    return this;
  }

  /** Tilted solar banks — the roofline signature of this city. */
  solar(w: number, d: number, y: number, count = 3): this {
    const step = d / count;
    for (let i = 0; i < count; i += 1) {
      const z = -d / 2 + step * (i + 0.5);
      this.box(w, 0.08, step * 0.62, SOLAR, 0, y + 0.3, z, -0.34);
      this.box(0.1, 0.3, 0.1, METAL, 0, y, z);
    }
    return this;
  }

  /** Planted roof: the other signature. */
  garden(w: number, d: number, y: number): this {
    this.box(w, 0.18, d, LEAF, 0, y, 0);
    this.box(w * 0.5, 0.26, d * 0.4, LEAF_LIGHT, w * 0.16, y + 0.18, d * 0.1);
    return this;
  }

  /** Glazing bands on the long faces. */
  glazing(w: number, d: number, y: number, h = 0.9): this {
    this.box(w * 0.94, h, 0.08, GLASS, 0, y, d / 2);
    this.box(w * 0.94, h, 0.08, GLASS, 0, y, -d / 2);
    return this;
  }

  build(name: string): THREE.Group {
    const merged = mergeGeometries(this.parts, false);
    if (!merged) throw new Error(`${name}: geometry merge failed`);
    merged.computeVertexNormals();
    merged.computeBoundingBox();
    merged.computeBoundingSphere();
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.87, metalness: 0 });
    material.name = `MAT_PROC_${name}`;
    const mesh = new THREE.Mesh(merged, material);
    mesh.name = `MESH_${name}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const group = new THREE.Group();
    group.name = `MM_PROC_${name}`;
    group.add(mesh);
    return group;
  }
}

// ---------------------------------------------------------------- structures
// Footprints are whole tiles: 8x5 tiles = 16x10 m, and so on.

const ferryTerminal = (): THREE.Group => {
  const m = new Mesher();
  m.box(tiles(8), 0.5, tiles(5), CREAM);
  m.box(tiles(5.5), 3.5, tiles(3.5), PLASTER, -1, 0.5, 0);
  m.glazing(tiles(5.5), tiles(3.5), 2.1);
  m.box(tiles(6), 0.4, tiles(4), ROOF, -1, 4, 0);
  m.garden(tiles(4.5), tiles(3), 4.4);
  m.box(tiles(2.5), 2.5, tiles(2.5), TERRACOTTA, 5, 0.5, 0);
  m.box(tiles(3), 0.35, tiles(3), ROOF, 5, 3, 0);
  for (let i = -1; i <= 1; i += 1) m.cyl(0.22, 3.2, TIMBER, 7, -2.7, i * 2);
  m.box(tiles(3), 0.3, tiles(1.5), TIMBER, 7, 0.4, 0);
  return m.build("B01_FERRY_TERMINAL");
};

const marketPavilion = (): THREE.Group => {
  const m = new Mesher();
  m.box(tiles(7), 0.4, tiles(5), CREAM);
  for (const x of [-6, -2, 2, 6]) for (const z of [-4, 4]) m.cyl(0.26, 3.8, TIMBER, x, 0.4, z);
  m.gable(tiles(7.5), tiles(5.5), 1.8, TERRACOTTA, 4.2);
  m.solar(tiles(4.5), tiles(3), 5.6, 3);
  m.box(tiles(2), 1.1, tiles(1), ACCENT, -4, 0.4, 0);
  m.box(tiles(2), 1.1, tiles(1), LEAF, 3.5, 0.4, 1);
  return m.build("B02_MARKET_PAVILION");
};

const sungridUtility = (): THREE.Group => {
  const m = new Mesher();
  m.box(tiles(6), 0.45, tiles(4.5), CREAM);
  m.box(tiles(4), 4.4, tiles(3), PLASTER, -1, 0.45, 0);
  m.glazing(tiles(4), tiles(3), 2.4, 0.7);
  m.box(tiles(4.5), 0.4, tiles(3.5), ROOF, -1, 4.85, 0);
  m.solar(tiles(3.5), tiles(3), 5.25, 4);
  m.cyl(1.5, 5.6, METAL, 4.5, 0.45, -1.5);
  m.cyl(1.62, 0.4, ACCENT, 4.5, 6.05, -1.5);
  m.box(tiles(1.5), 1.6, tiles(1.5), SOLAR, 4, 0.45, 2.5);
  return m.build("B03_SUNGRID_UTILITY");
};

const aquaworks = (): THREE.Group => {
  const m = new Mesher();
  m.box(tiles(6), 0.45, tiles(5), CREAM);
  m.box(tiles(3.5), 3.4, tiles(3), PLASTER, -2, 0.45, 0);
  m.glazing(tiles(3.5), tiles(3), 1.9, 0.7);
  m.box(tiles(4), 0.4, tiles(3.5), ROOF, -2, 3.85, 0);
  m.garden(tiles(3), tiles(2.5), 4.25);
  m.cyl(2.2, 3.6, GLASS, 4, 0.45, -1.5, 0, 0, 0, 14);
  m.cyl(2.34, 0.3, METAL, 4, 4.05, -1.5, 0, 0, 0, 14);
  m.cyl(1.5, 2.4, GLASS, 4, 0.45, 3, 0, 0, 0, 12);
  m.cyl(1.62, 0.26, METAL, 4, 2.85, 3, 0, 0, 0, 12);
  return m.build("B04_AQUAWORKS");
};

const canopyGreenhouse = (): THREE.Group => {
  const m = new Mesher();
  m.box(tiles(6.5), 0.4, tiles(4.5), CREAM);
  m.box(tiles(6), 0.5, tiles(4), SOIL, 0, 0.4, 0);
  // Three barrel vaults, one every one-and-three-quarter tiles.
  for (let i = -1; i <= 1; i += 1) {
    const x = i * tiles(1.75);
    m.vault(1.5, tiles(3.8), GLASS, x, 2.4);
    m.box(0.16, 2, tiles(3.8), TIMBER, x - 1.5, 0.9, 0);
    m.box(0.16, 2, tiles(3.8), TIMBER, x + 1.5, 0.9, 0);
  }
  m.box(tiles(1.5), 2.2, tiles(1), PLASTER, -5, 0.4, 2.5);
  m.box(tiles(1.75), 0.3, tiles(1.25), ROOF, -5, 2.6, 2.5);
  for (const z of [-2, 0, 2]) m.box(tiles(4.5), 0.3, 0.9, LEAF, 1, 0.9, z);
  return m.build("B05_CANOPY_GREENHOUSE");
};

const makerWorkshop = (): THREE.Group => {
  const m = new Mesher();
  m.box(tiles(6), 0.45, tiles(4.5), CREAM);
  m.box(tiles(4.75), 3.9, tiles(3.5), TERRACOTTA, 0, 0.45, 0);
  m.glazing(tiles(4.75), tiles(3.5), 2.3, 0.8);
  m.gable(tiles(5.25), tiles(4), 1.5, ROOF, 4.35);
  for (let i = -1; i <= 1; i += 1) m.box(tiles(1), 0.9, tiles(3), GLASS, i * tiles(1.5), 4.35, 0);
  m.box(tiles(1.25), 2.4, 0.25, TIMBER, -2.5, 0.45, 3.5);
  m.cyl(0.9, 4.6, METAL, 5, 0.45, -2.5);
  return m.build("B06_MAKER_WORKSHOP");
};

const starterShopCafe = (): THREE.Group => {
  const m = new Mesher();
  m.box(tiles(5.5), 0.4, tiles(4), CREAM);
  m.box(tiles(4), 3.4, tiles(3), PLASTER, 0, 0.4, 0);
  m.box(tiles(4.25), 0.36, tiles(3.25), ROOF, 0, 3.8, 0);
  m.garden(tiles(3.5), tiles(2.5), 4.16);
  m.box(tiles(3.75), 1.5, 0.12, GLASS, 0, 1.1, 3);
  m.box(tiles(0.75), 2.2, 0.12, TIMBER, 3, 0.4, 3);
  m.box(tiles(4.25), 0.14, tiles(1.25), ACCENT, 0, 2.9, 4, 0.22);
  for (const x of [-2, 1]) { m.cyl(0.6, 0.1, PLASTER, x, 0.75, 4.5); m.cyl(0.12, 0.75, METAL, x, 0.4, 4.5); }
  return m.build("B07_STARTER_SHOP_CAFE");
};

const harborGym = (): THREE.Group => {
  const m = new Mesher();
  m.box(tiles(6.5), 0.45, tiles(5), CREAM);
  m.box(tiles(5), 4.6, tiles(3.75), PLASTER, 0, 0.45, 0);
  m.glazing(tiles(5), tiles(3.75), 2.8, 1.5);
  m.box(tiles(5.25), 0.42, tiles(4), ROOF, 0, 5.05, 0);
  m.solar(tiles(4.25), tiles(3.5), 5.47, 4);
  m.box(tiles(1.75), 2.6, 0.3, TERRACOTTA, -3, 0.45, 4);
  return m.build("B08_HARBOR_GYM");
};

const STRUCTURES: Record<string, () => THREE.Group> = {
  "b01-ferry-terminal": ferryTerminal,
  "b02-market-pavilion": marketPavilion,
  "b03-sungrid-utility": sungridUtility,
  "b04-aquaworks": aquaworks,
  "b05-canopy-greenhouse": canopyGreenhouse,
  "b06-maker-workshop": makerWorkshop,
  "b07-starter-shop-cafe": starterShopCafe,
  "b08-harbor-gym": harborGym,
};

// ---------------------------------------------------------------- decorations
// Each is normalised to its authored targetM by the world-designs loader, so these
// only need honest proportions and a footprint that matches the authored grounding.

const broadleafTree = (): THREE.Group => new Mesher()
  .cyl(0.26, 3.1, TIMBER)
  .ball(1.75, LEAF, 0, 4.3, 0, 0.92)
  .ball(1.15, LEAF_LIGHT, 0.85, 3.7, 0.5)
  .ball(1.0, LEAF, -0.8, 3.9, -0.45)
  .build("TR01_SUNLEAF_TREE");

const bloomfruitTree = (): THREE.Group => new Mesher()
  .cyl(0.24, 2.7, TIMBER)
  .ball(1.6, LEAF_LIGHT, 0, 3.8, 0, 0.9)
  .ball(0.95, LEAF, -0.85, 3.35, 0.5)
  .ball(0.5, BLOOM, 0.8, 4.1, 0.4)
  .ball(0.42, BLOOM, -0.5, 4.35, -0.6)
  .build("TR02_BLOOMFRUIT_TREE");

const tidepalm = (): THREE.Group => {
  const m = new Mesher();
  m.cyl(0.2, 5.4, TIMBER, 0, 0, 0, 0, 0, 0.09);
  for (let i = 0; i < 6; i += 1) {
    const angle = (i / 6) * Math.PI * 2;
    m.box(2.7, 0.1, 0.62, LEAF, Math.cos(angle) * 1.25, 5.2, Math.sin(angle) * 1.25, 0, -angle, -0.34);
  }
  m.ball(0.3, TIMBER, 0, 5.35, 0);
  return m.build("TR03_TIDEPALM");
};

const roundShrub = (): THREE.Group => new Mesher()
  .ball(0.52, LEAF, 0, 0.46, 0, 0.9)
  .ball(0.33, LEAF_LIGHT, 0.3, 0.34, 0.16)
  .build("SH01_SUNLEAF_SHRUB");

const floweringShrub = (): THREE.Group => new Mesher()
  .ball(0.46, LEAF_LIGHT, 0, 0.42, 0, 0.92)
  .ball(0.18, BLOOM, 0.24, 0.62, 0.1)
  .ball(0.15, BLOOM, -0.2, 0.55, -0.18)
  .build("SH02_SOLARBLOOM_SHRUB");

const reedCluster = (): THREE.Group => {
  const m = new Mesher();
  m.ball(0.34, REED, 0, 0.18, 0, 0.55);
  for (let i = 0; i < 7; i += 1) {
    const angle = (i / 7) * Math.PI * 2;
    m.box(0.07, 1.25, 0.07, REED, Math.cos(angle) * 0.24, 0.1, Math.sin(angle) * 0.24, Math.sin(angle) * 0.2, 0, Math.cos(angle) * 0.2);
  }
  return m.build("SH03_RAINGARDEN_REEDS");
};

const solarLamp = (): THREE.Group => new Mesher()
  .cyl(0.17, 0.24, METAL)
  .cyl(0.09, 4.2, METAL, 0, 0.24, 0)
  .box(0.9, 0.08, 0.5, SOLAR, 0.3, 4.36, 0)
  .ball(0.16, ACCENT, 0.3, 4.26, 0)
  .build("ST01_SUNRAIL_LAMP");

const civicBench = (): THREE.Group => {
  const m = new Mesher();
  m.box(0.62, 0.1, 2.3, TIMBER, 0, 0.44, 0);
  m.box(0.14, 0.5, 2.3, TIMBER, -0.26, 0.54, 0);
  for (const z of [-0.85, 0.85]) m.box(0.5, 0.44, 0.12, METAL, 0, 0, z);
  return m.build("ST02_GARDENLINE_BENCH");
};

const streetPlanter = (): THREE.Group => new Mesher()
  .box(tiles(1), 0.52, tiles(1), PLASTER)
  .box(tiles(0.88), 0.12, tiles(0.88), SOIL, 0, 0.52, 0)
  .ball(0.5, LEAF, 0, 0.9, 0, 0.9)
  .ball(0.33, LEAF_LIGHT, 0.42, 0.78, 0.3)
  .build("ST03_MODULAR_PLANTER");

const wayfindingKiosk = (): THREE.Group => new Mesher()
  .box(1.1, 0.16, 0.9, PLASTER)
  .box(0.85, 2.1, 0.28, PLASTER, 0, 0.16, 0)
  .box(0.72, 1.1, 0.06, GLASS, 0, 0.8, 0.16)
  .box(1.0, 0.1, 0.5, SOLAR, 0, 2.26, 0)
  .build("ST04_WAYFINDING_KIOSK");

const microcar = (): THREE.Group => {
  const m = new Mesher();
  m.box(1.5, 0.62, 2.7, HULL, 0, 0.26, 0);
  m.box(1.32, 0.56, 1.5, GLASS, 0, 0.88, -0.1);
  m.box(1.4, 0.06, 1.2, SOLAR, 0, 1.44, -0.1);
  for (const x of [-0.7, 0.7]) for (const z of [-0.95, 0.95]) m.cyl(0.3, 0.2, ROOF, x, 0.12, z, 0, 0, Math.PI / 2);
  return m.build("MV01_SUNPOD_MICROCAR");
};

const cargoCart = (): THREE.Group => {
  const m = new Mesher();
  m.box(1.4, 0.28, 2.9, TIMBER, 0, 0.42, 0);
  m.box(1.4, 0.62, 0.16, TIMBER, 0, 0.7, -1.37);
  m.box(0.16, 0.62, 2.9, TIMBER, -0.62, 0.7, 0);
  m.box(0.16, 0.62, 2.9, TIMBER, 0.62, 0.7, 0);
  for (const x of [-0.72, 0.72]) m.cyl(0.42, 0.14, ROOF, x, 0.21, 0.7, 0, 0, Math.PI / 2);
  return m.build("MV02_MARKET_CARGO_CART");
};

const civicShuttle = (): THREE.Group => {
  const m = new Mesher();
  m.box(2.1, 1.35, 5.0, HULL, 0, 0.34, 0);
  m.box(1.96, 0.62, 3.6, GLASS, 0, 1.1, -0.2);
  m.box(2.0, 0.08, 3.4, SOLAR, 0, 1.72, 0);
  m.box(2.12, 0.2, 0.3, ACCENT, 0, 0.5, 2.5);
  for (const x of [-1.0, 1.0]) for (const z of [-1.6, 1.6]) m.cyl(0.38, 0.2, ROOF, x, 0.18, z, 0, 0, Math.PI / 2);
  return m.build("MV03_CIVIC_SHUTTLE");
};

const passengerFerry = (): THREE.Group => new Mesher()
  .box(3.4, 1.0, 8.8, HULL)
  .box(3.0, 0.9, 5.6, PLASTER, 0, 1.0, -0.6)
  .box(2.8, 0.5, 4.4, GLASS, 0, 1.9, -0.6)
  .box(2.9, 0.1, 4.6, SOLAR, 0, 2.4, -0.6)
  .cone(1.5, 1.6, HULL, 0, 0, 4.4, Math.PI / 2)
  .cyl(0.12, 2.4, METAL, 0, 2.5, -2.4)
  .box(2.6, 0.16, 0.3, ACCENT, 0, 0.94, 3.0)
  .build("BV01_SUNWAKE_FERRY");

const workboat = (): THREE.Group => new Mesher()
  .box(2.8, 0.9, 7.2, TERRACOTTA)
  .box(2.2, 1.5, 2.2, PLASTER, 0, 0.9, -1.9)
  .box(2.0, 0.5, 1.9, GLASS, 0, 2.0, -1.9)
  .cone(1.2, 1.3, TERRACOTTA, 0, 0, 3.6, Math.PI / 2)
  .box(2.3, 0.14, 2.8, TIMBER, 0, 0.9, 1.6)
  .cyl(0.11, 2.2, METAL, 0.7, 2.4, -1.9)
  .build("BV02_MAKERS_WORKBOAT");

const DECORATIONS: Record<string, () => THREE.Group> = {
  "tr01-sunleaf-tree": broadleafTree,
  "tr02-bloomfruit-tree": bloomfruitTree,
  "tr03-tidepalm": tidepalm,
  "sh01-sunleaf-shrub": roundShrub,
  "sh02-solarbloom-shrub": floweringShrub,
  "sh03-raingarden-reeds": reedCluster,
  "st01-sunrail-lamp": solarLamp,
  "st02-gardenline-bench": civicBench,
  "st03-modular-planter": streetPlanter,
  "st04-wayfinding-kiosk": wayfindingKiosk,
  "mv01-sunpod-microcar": microcar,
  "mv02-market-cargo-cart": cargoCart,
  "mv03-civic-shuttle": civicShuttle,
  "bv01-sunwake-ferry": passengerFerry,
  "bv02-makers-workboat": workboat,
};

/**
 * A procedural scene for a model URL, or null when the asset should still come from a
 * GLB. Rigged avatars are excluded on purpose — they carry animation clips.
 */
export function proceduralSceneFor(url: string): THREE.Group | null {
  const stem = (url.split("/").pop() ?? "").replace(/\.glb$/i, "");
  const build = STRUCTURES[stem] ?? DECORATIONS[stem];
  return build ? build() : null;
}

export const PROCEDURAL_ASSET_IDS = [...Object.keys(STRUCTURES), ...Object.keys(DECORATIONS)];

/**
 * A GLTFLoader that answers building and decoration URLs from the procedural catalogue
 * and forwards everything else — terrain, rigged avatars — to the real loader.
 */
export function installProceduralLoader(loader: GLTFLoader): GLTFLoader {
  const original = loader.loadAsync.bind(loader);
  loader.loadAsync = async (url: string, onProgress?: (event: ProgressEvent) => void): Promise<GLTF> => {
    const scene = proceduralSceneFor(url);
    if (!scene) return original(url, onProgress);
    return {
      scene,
      scenes: [scene],
      animations: [],
      cameras: [],
      asset: { generator: "markets-and-makers procedural" },
      userData: {},
    } as unknown as GLTF;
  };
  return loader;
}
