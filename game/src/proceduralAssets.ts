import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { GLTF, GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { buildPixelAvatar, isPixelAvatarStem } from "./pixelAvatar";

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
const WATER = 0x43aeb8;
const WATER_DEEP = 0x216a72;
const COPPER = 0xb96f3f;
const SLATE = 0x6f716f;
const VIOLET = 0x5f4a67;
const TEAL = 0x2f7775;
const PRODUCE = 0xc95d45;

export interface ProceduralBusinessSpec {
  businessLicense: string;
  assetId: string;
  name: string;
  footprintTiles: readonly [number, number];
  silhouette: string;
  heroProp: string;
  regenerativeSystem: string;
  accent: string;
  maxTriangles: number;
  maxSourceParts: number;
}

/**
 * Runtime art authority for the fifteen player businesses. B02 is a public market
 * pavilion, not a player licence, and deliberately remains outside this catalogue.
 */
export const BUSINESS_PROCEDURAL_SPECS: Readonly<Record<string, ProceduralBusinessSpec>> = {
  "b01-ferry-terminal": { businessLicense: "freight", assetId: "mm_biz_freight_v2", name: "Copper Quay Freight", footprintTiles: [8, 6], silhouette: "long solar quay canopy and electric gantry", heroProp: "copper cargo container", regenerativeSystem: "solar loading canopy and shore-power pedestal", accent: "copper-orange", maxTriangles: 4_000, maxSourceParts: 60 },
  "b03-sungrid-utility": { businessLicense: "sungrid", assetId: "mm_biz_sungrid_v2", name: "Sunwell Microgrid", footprintTiles: [6, 6], silhouette: "fan-shaped photovoltaic roof and slim energy mast", heroProp: "large battery cube", regenerativeSystem: "photovoltaics, battery storage and vertical-axis wind", accent: "cobalt and solar gold", maxTriangles: 3_200, maxSourceParts: 48 },
  "b04-aquaworks": { businessLicense: "aquaworks", assetId: "mm_biz_aquaworks_v2", name: "Tideglass AquaWorks", footprintTiles: [6, 6], silhouette: "low living-filter hall beside stepped tanks", heroProp: "two cyan treatment tanks", regenerativeSystem: "rain capture, planted filtration and visible water runnel", accent: "water cyan", maxTriangles: 3_800, maxSourceParts: 55 },
  "b05-canopy-greenhouse": { businessLicense: "greenhouse", assetId: "mm_biz_greenhouse_v2", name: "Greenloom Greenhouse", footprintTiles: [6, 8], silhouette: "three linked barrel biomes with a raised centre", heroProp: "visible crop beds", regenerativeSystem: "ridge vents, rain tank and irrigation header", accent: "lime and aqua", maxTriangles: 4_500, maxSourceParts: 70 },
  "b06-maker-workshop": { businessLicense: "workshop", assetId: "mm_biz_workshop_v2", name: "Maker Workshop", footprintTiles: [6, 6], silhouette: "asymmetric sawtooth shop and open fabrication bay", heroProp: "large tool wheel", regenerativeSystem: "solar clerestory, rain barrel and reclaimed-material rack", accent: "cobalt and ochre", maxTriangles: 3_500, maxSourceParts: 55 },
  "b07-starter-shop-cafe": { businessLicense: "shop", assetId: "mm_biz_shop_v2", name: "Supply Shop & Café", footprintTiles: [4, 4], silhouette: "compact corner shop beneath a leaf-fan awning", heroProp: "produce counter and cup-return station", regenerativeSystem: "herb roof, rain barrel and reusable-cup loop", accent: "coral and leaf green", maxTriangles: 2_400, maxSourceParts: 38 },
  "b08-harbor-gym": { businessLicense: "gym", assetId: "mm_biz_gym_v2", name: "Harbor Gym", footprintTiles: [6, 6], silhouette: "open-sided lotus rib hall", heroProp: "climbing wall and exercise wheel", regenerativeSystem: "passive ventilation, cooling pond and photovoltaic ridge", accent: "aquamarine and coral", maxTriangles: 3_500, maxSourceParts: 55 },
  "b09-stonewake-mine": { businessLicense: "mine", assetId: "mm_biz_mine_v2", name: "Stonewake Mine", footprintTiles: [6, 6], silhouette: "terraced rock wedge and angular headframe", heroProp: "ore cart entering an arched portal", regenerativeSystem: "electric charging shelter and planted reclamation terraces", accent: "slate and oxidized copper", maxTriangles: 4_000, maxSourceParts: 60 },
  "b10-timbercoast-works": { businessLicense: "timberworks", assetId: "mm_biz_timberworks_v2", name: "Timbercoast Works", footprintTiles: [6, 6], silhouette: "open timber-truss saw shed and dark solar kiln", heroProp: "log deck feeding a saw carriage", regenerativeSystem: "solar kiln and sawdust biomass collector", accent: "timber amber", maxTriangles: 4_000, maxSourceParts: 65 },
  "b11-freight-crate-mill": { businessLicense: "cratemill", assetId: "mm_biz_cratemill_v2", name: "Freight Crate Mill", footprintTiles: [6, 6], silhouette: "stepped crate-like roof", heroProp: "giant half-built reusable crate", regenerativeSystem: "flat-pack reuse loop, scrap collector and rooftop solar", accent: "shipping orange", maxTriangles: 3_600, maxSourceParts: 58 },
  "b12-mercedonian-factory": { businessLicense: "factory", assetId: "mm_biz_factory_v2", name: "Mercedonian Factory", footprintTiles: [8, 8], silhouette: "five-bay sawtooth manufacturing hall", heroProp: "external production gantry and conveyor", regenerativeSystem: "closed-loop water tank, solar strips and planted roof", accent: "solar yellow and dark teal", maxTriangles: 5_000, maxSourceParts: 78 },
  "b13-civic-construction": { businessLicense: "construction", assetId: "mm_biz_construction_v2", name: "Civic Construction Co.", footprintTiles: [8, 6], silhouette: "tall portal crane beside a low site office", heroProp: "room pod and upright wall-panel rack", regenerativeSystem: "solar site office, rain capture and permeable planted edge", accent: "safety saffron", maxTriangles: 4_500, maxSourceParts: 70 },
  "b14-market-kitchen": { businessLicense: "restaurant", assetId: "mm_biz_restaurant_v2", name: "Sunset Market Kitchen", footprintTiles: [6, 6], silhouette: "two inverted-umbrella dining roofs", heroProp: "central solar oven and produce counter", regenerativeSystem: "herb beds, compost drum and rain canopies", accent: "tomato and warm ochre", maxTriangles: 3_300, maxSourceParts: 52 },
  "b15-lantern-cinema": { businessLicense: "cinema", assetId: "mm_biz_cinema_v2", name: "Lantern Cinema", footprintTiles: [8, 6], silhouette: "dark theater box with a glowing lantern crown", heroProp: "giant projector aperture", regenerativeSystem: "solar-petal marquee and planted roof", accent: "violet and lantern gold", maxTriangles: 4_000, maxSourceParts: 60 },
  "b16-reclamation-hub": { businessLicense: "recycler", assetId: "mm_biz_recycler_v2", name: "Tideglass Reclamation Hub", footprintTiles: [6, 6], silhouette: "exterior-braced hall and hopper tower", heroProp: "conveyor feeding three sorting bays", regenerativeSystem: "rooftop solar, compact wind rotor and bioswale", accent: "recycle green and cyan", maxTriangles: 4_200, maxSourceParts: 66 },
};

/** Accumulates parts and bakes them into a single vertex-coloured geometry. */
class Mesher {
  private readonly parts: THREE.BufferGeometry[] = [];
  private readonly colour = new THREE.Color();
  private readonly matrix = new THREE.Matrix4();
  private readonly euler = new THREE.Euler();
  private readonly quaternion = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3();
  private readonly position = new THREE.Vector3();

  private colourGeometry(part: THREE.BufferGeometry, colour: number): void {
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

  private push(geometry: THREE.BufferGeometry, colour: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): void {
    const part = geometry.clone();
    this.position.set(x, y, z);
    this.quaternion.setFromEuler(this.euler.set(rx, ry, rz));
    this.scale.set(1, 1, 1);
    part.applyMatrix4(this.matrix.compose(this.position, this.quaternion, this.scale));
    this.colourGeometry(part, colour);
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

  cone(radius: number, h: number, colour: number, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, segments = 10): this {
    this.push(new THREE.ConeGeometry(radius, h, segments), colour, x, y + h / 2, z, rx, ry, rz);
    return this;
  }

  /** A low-poly ring or partial ring. Torus geometry faces +Z by default. */
  torus(radius: number, tube: number, colour: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, arc = Math.PI * 2): this {
    this.push(new THREE.TorusGeometry(radius, tube, 6, 12, arc), colour, x, y, z, rx, ry, rz);
    return this;
  }

  /** A square-section beam joining two arbitrary points, used for trusses and braces. */
  beam(width: number, colour: number, from: readonly [number, number, number], to: readonly [number, number, number]): this {
    const start = new THREE.Vector3(...from);
    const end = new THREE.Vector3(...to);
    const direction = end.clone().sub(start);
    const length = direction.length();
    if (length <= 0) return this;
    const part = new THREE.BoxGeometry(width, length, width);
    const midpoint = start.add(end).multiplyScalar(0.5);
    const orientation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
    part.applyMatrix4(new THREE.Matrix4().compose(midpoint, orientation, new THREE.Vector3(1, 1, 1)));
    this.colourGeometry(part, colour);
    return this;
  }

  /** A cylindrical member joining two points, without the rotated-cylinder grounding trap. */
  cylinderBetween(radius: number, colour: number, from: readonly [number, number, number], to: readonly [number, number, number], segments = 10): this {
    const start = new THREE.Vector3(...from);
    const end = new THREE.Vector3(...to);
    const direction = end.clone().sub(start);
    const length = direction.length();
    if (length <= 0) return this;
    const part = new THREE.CylinderGeometry(radius, radius, length, segments);
    const midpoint = start.add(end).multiplyScalar(0.5);
    const orientation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
    part.applyMatrix4(new THREE.Matrix4().compose(midpoint, orientation, new THREE.Vector3(1, 1, 1)));
    this.colourGeometry(part, colour);
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
  solar(w: number, d: number, y: number, count = 3, x = 0, z = 0): this {
    const step = d / count;
    for (let i = 0; i < count; i += 1) {
      const panelZ = z - d / 2 + step * (i + 0.5);
      this.box(w, 0.08, step * 0.62, SOLAR, x, y + 0.3, panelZ, -0.34);
      this.box(0.1, 0.3, 0.1, METAL, x, y, panelZ);
    }
    return this;
  }

  /** Planted roof: the other signature. */
  garden(w: number, d: number, y: number, x = 0, z = 0): this {
    this.box(w, 0.18, d, LEAF, x, y, z);
    this.box(w * 0.5, 0.26, d * 0.4, LEAF_LIGHT, x + w * 0.16, y + 0.18, z + d * 0.1);
    return this;
  }

  /** Planter boxes along a face — the ground-level solarpunk tell. */
  planters(count: number, spread: number, x: number, y: number, along: "x" | "z" = "z"): this {
    for (let i = 0; i < count; i += 1) {
      const t = count === 1 ? 0 : -spread / 2 + (spread / (count - 1)) * i;
      const px = along === "z" ? x : t;
      const pz = along === "z" ? t : x;
      this.box(0.85, 0.42, 0.85, TIMBER, px, y, pz);
      this.box(0.7, 0.12, 0.7, SOIL, px, y + 0.42, pz);
      this.ball(0.36, i % 2 === 0 ? LEAF : LEAF_LIGHT, px, y + 0.68, pz, 0.85);
    }
    return this;
  }

  /** Greenery climbing a wall, in stepped tufts rather than a flat panel. */
  vines(x: number, y: number, z: number, height: number, facing: "x" | "z" = "x"): this {
    const steps = Math.max(2, Math.round(height / 0.8));
    for (let i = 0; i < steps; i += 1) {
      const t = y + (height / steps) * i;
      const jitter = ((i * 37) % 5) * 0.12 - 0.24;
      const vx = facing === "x" ? x : x + jitter;
      const vz = facing === "x" ? z + jitter : z;
      this.ball(0.3 - i * 0.02, i % 2 === 0 ? LEAF : LEAF_LIGHT, vx, t, vz, 0.7);
    }
    return this;
  }

  /** A timber pergola: slats on posts, shade without a wall. */
  pergola(width: number, depth: number, y: number, height: number, x = 0, z = 0): this {
    for (const px of [x - width / 2 + 0.2, x + width / 2 - 0.2]) {
      for (const pz of [z - depth / 2 + 0.2, z + depth / 2 - 0.2]) this.cyl(0.11, height, TIMBER, px, y, pz);
    }
    const slats = Math.max(3, Math.round(depth / 0.6));
    for (let i = 0; i < slats; i += 1) {
      const pz = z - depth / 2 + (depth / (slats - 1)) * i;
      this.box(width, 0.09, 0.16, TIMBER, x, y + height, pz);
    }
    return this;
  }

  /** A rainwater tank, the other half of the regenerative pair with the planting. */
  waterTank(radius: number, height: number, x: number, y: number, z: number): this {
    this.cyl(radius, height, GLASS, x, y, z, 0, 0, 0, 10);
    this.cyl(radius * 1.08, 0.16, METAL, x, y + height, z, 0, 0, 0, 10);
    this.cyl(radius * 1.08, 0.14, METAL, x, y, z, 0, 0, 0, 10);
    return this;
  }

  /** Glazing bands on the long faces. */
  glazing(w: number, d: number, y: number, h = 0.9): this {
    this.box(w * 0.94, h, 0.08, GLASS, 0, y, d / 2);
    this.box(w * 0.94, h, 0.08, GLASS, 0, y, -d / 2);
    return this;
  }

  build(name: string, metadata?: ProceduralBusinessSpec & { modelStem: string }): THREE.Group {
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
    if (metadata) {
      const triangles = (merged.index?.count ?? merged.attributes.position!.count) / 3;
      group.userData = {
        schema: "markets-and-makers.procedural-business.v1",
        ...metadata,
        footprintTiles: [...metadata.footprintTiles],
        tileSizeM: TILE,
        upAxis: "+Y",
        customerFront: "+Z",
        mobileProfile: "lite",
        sourceParts: this.parts.length,
        triangles,
      };
    }
    return group;
  }
}

const businessBuild = (m: Mesher, modelStem: string, nodeName: string): THREE.Group => {
  const spec = BUSINESS_PROCEDURAL_SPECS[modelStem];
  if (!spec) throw new Error(`${modelStem}: missing procedural business specification`);
  return m.build(nodeName, { ...spec, modelStem });
};

// ---------------------------------------------------------------- structures
// Footprints are whole tiles: 8x5 tiles = 16x10 m, and so on.

const ferryTerminal = (): THREE.Group => {
  const m = new Mesher();
  m.box(tiles(8), 0.38, tiles(6), CREAM);
  // Compact dispatch office leaves most of the footprint as a legible loading lane.
  m.box(5.4, 3.15, 6.6, PLASTER, -4.7, 0.38, -1.6);
  m.box(5.8, 0.28, 7.0, ROOF, -4.7, 3.53, -1.6);
  m.box(4.5, 1.1, 0.12, GLASS, -4.7, 1.42, 1.72);
  m.box(1.25, 2.25, 0.14, TEAL, -3.2, 0.38, 1.73);
  m.garden(4.3, 5.2, 3.81, -4.7, -1.6);
  // Broad photovoltaic quay canopy, picked out by three copper ribs.
  m.vault(3.0, 8.4, SOLAR, 2.3, 3.55, -0.7);
  for (const z of [-4.1, -0.7, 2.7]) m.torus(3.0, 0.13, COPPER, 2.3, 0.55, z, 0, 0, 0, Math.PI);
  // Electric gantry and its deliberately oversized copper cargo container.
  for (const x of [0.1, 5.4]) m.beam(0.3, TEAL, [x, 0.38, 3.7], [x, 5.75, 3.7]);
  m.beam(0.34, ACCENT, [0.1, 5.75, 3.7], [5.4, 5.75, 3.7]);
  m.box(4.3, 2.45, 2.45, COPPER, 2.75, 0.38, 2.15);
  for (let i = -2; i <= 2; i += 1) m.box(0.1, 2.25, 2.5, TIMBER, 2.75 + i * 0.82, 0.48, 2.15);
  // Shore-power pedestal and coiled charging cable.
  m.box(0.75, 1.25, 0.75, TEAL, 6.65, 0.38, 3.85);
  m.box(0.55, 0.5, 0.08, ACCENT, 6.65, 0.82, 4.23);
  m.torus(0.48, 0.08, ROOF, 6.65, 2.15, 4.24);
  m.planters(2, 3.0, -7.25, 0.38);
  return businessBuild(m, "b01-ferry-terminal", "B01_FERRY_TERMINAL");
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
  m.box(tiles(6), 0.38, tiles(6), CREAM);
  m.box(5.2, 2.7, 4.6, PLASTER, -2.7, 0.38, -2.2);
  m.box(5.5, 0.24, 4.9, ROOF, -2.7, 3.08, -2.2);
  m.box(3.9, 0.85, 0.1, GLASS, -2.7, 1.25, 0.12);
  // A five-panel solar fan replaces the generic rectangular roof bank.
  for (let i = -2; i <= 2; i += 1) {
    const angle = i * 0.24;
    m.box(1.15, 0.1, 5.0, SOLAR, -1.2 + Math.sin(angle) * 1.4, 3.18, -0.5 + Math.cos(angle) * 0.35, -0.34, angle);
    m.beam(0.1, METAL, [-1.2 + Math.sin(angle) * 1.4, 3.08, -0.7], [-1.2 + Math.sin(angle) * 1.4, 3.75, -1.25]);
  }
  // Battery cube and high-contrast power-bus fins read even as a tiny thumbnail.
  m.box(2.55, 2.55, 2.4, TEAL, 3.5, 0.38, 2.6);
  for (const x of [2.55, 3.15, 3.75, 4.35]) m.box(0.16, 1.75, 2.48, ACCENT, x, 0.78, 2.6);
  m.box(2.2, 0.15, 2.05, LEAF, 3.5, 2.93, 2.6);
  // Compact vertical-axis wind turbine: mast plus two bowed rotor blades.
  m.cyl(0.12, 6.2, METAL, 4.25, 0.38, -3.4, 0, 0, 0, 8);
  m.beam(0.12, ACCENT, [4.25, 5.9, -3.4], [3.55, 4.7, -3.4]);
  m.beam(0.12, ACCENT, [3.55, 4.7, -3.4], [4.25, 3.45, -3.4]);
  m.beam(0.12, ACCENT, [4.25, 5.9, -3.4], [4.95, 4.7, -3.4]);
  m.beam(0.12, ACCENT, [4.95, 4.7, -3.4], [4.25, 3.45, -3.4]);
  m.planters(2, 3.0, -5.3, 0.38);
  return businessBuild(m, "b03-sungrid-utility", "B03_SUNGRID_UTILITY");
};

const aquaworks = (): THREE.Group => {
  const m = new Mesher();
  m.box(tiles(6), 0.38, tiles(6), CREAM);
  // The low living-machine hall has a planted filter spine rather than a token roof lawn.
  m.box(5.4, 2.65, 5.0, PLASTER, -2.9, 0.38, -1.6);
  m.box(5.8, 0.26, 5.4, ROOF, -2.9, 3.03, -1.6);
  m.box(4.4, 0.75, 0.1, GLASS, -2.9, 1.32, 0.92);
  m.box(4.7, 0.34, 1.2, LEAF, -2.9, 3.29, -1.6);
  m.box(4.1, 0.2, 0.72, REED, -2.9, 3.63, -1.6);
  // Two differently sized treatment cells make the water utility unmistakable.
  m.cyl(1.85, 3.15, WATER, 2.85, 0.38, -1.8, 0, 0, 0, 12);
  m.cyl(1.98, 0.24, METAL, 2.85, 3.53, -1.8, 0, 0, 0, 12);
  m.cyl(1.42, 2.35, WATER_DEEP, 3.55, 0.38, 2.65, 0, 0, 0, 10);
  m.cyl(1.54, 0.22, ACCENT, 3.55, 2.73, 2.65, 0, 0, 0, 10);
  m.cylinderBetween(0.14, METAL, [2.85, 3.0, -1.8], [3.55, 2.25, 2.65], 8);
  // Three planted filtration beds spill into a visible blue runnel at the customer edge.
  for (const x of [-3.9, -2.1, -0.3]) {
    m.box(1.35, 0.42, 1.65, TIMBER, x, 0.38, 3.8);
    m.box(1.12, 0.14, 1.4, REED, x, 0.8, 3.8);
  }
  m.box(0.52, 0.14, 3.2, WATER, 0.75, 0.38, 4.15);
  m.box(1.0, 0.12, 0.9, WATER_DEEP, 0.75, 0.52, 5.2);
  return businessBuild(m, "b04-aquaworks", "B04_AQUAWORKS");
};

const canopyGreenhouse = (): THREE.Group => {
  const m = new Mesher();
  m.box(tiles(6), 0.34, tiles(8), CREAM);
  m.box(11.2, 0.3, 15.2, SOIL, 0, 0.34, 0);
  const domes = [
    { x: -3.35, radius: 1.55, y: 2.2 },
    { x: 0, radius: 2.0, y: 2.62 },
    { x: 3.35, radius: 1.55, y: 2.2 },
  ] as const;
  for (const dome of domes) {
    m.vault(dome.radius, 13.2, GLASS, dome.x, dome.y);
    for (const z of [-5.4, 0, 5.4]) m.torus(dome.radius, 0.1, TIMBER, dome.x, 0.65, z, 0, 0, 0, Math.PI);
    m.box(0.14, 1.65, 12.8, TIMBER, dome.x - dome.radius, 0.64, 0);
    m.box(0.14, 1.65, 12.8, TIMBER, dome.x + dome.radius, 0.64, 0);
    m.box(dome.radius * 1.35, 0.28, 9.4, LEAF_LIGHT, dome.x, 0.64, 0);
  }
  // Ridge vents and irrigation header are readable technical details, not ornament.
  m.box(0.72, 0.24, 7.0, TEAL, 0, 4.45, -0.3, 0, 0, 0.16);
  m.box(0.5, 0.18, 5.0, TEAL, -3.35, 3.75, 0, 0, 0, 0.14);
  m.box(0.5, 0.18, 5.0, TEAL, 3.35, 3.75, 0, 0, 0, 0.14);
  m.cylinderBetween(0.12, WATER_DEEP, [-4.8, 1.0, 6.0], [4.8, 1.0, 6.0], 8);
  m.waterTank(0.65, 2.05, 5.0, 0.64, -5.8);
  m.box(1.45, 2.1, 1.25, PLASTER, -4.8, 0.64, 6.2);
  return businessBuild(m, "b05-canopy-greenhouse", "B05_CANOPY_GREENHOUSE");
};

const makerWorkshop = (): THREE.Group => {
  const m = new Mesher();
  m.box(tiles(6), 0.38, tiles(6), CREAM);
  m.box(8.2, 3.45, 7.0, TERRACOTTA, -0.8, 0.38, -1.0);
  // Open fabrication bay on +Z with a bright worktable visible inside.
  m.box(5.4, 2.65, 0.16, ROOF, -0.5, 0.68, 2.55);
  m.box(4.3, 0.85, 1.35, ACCENT, -0.5, 0.38, 3.0);
  m.box(1.5, 1.65, 1.2, TEAL, -2.4, 1.23, 2.95);
  // Two asymmetric sawteeth form a clear maker/fabrication roofline.
  for (const x of [-2.2, 1.25]) {
    m.box(3.1, 0.18, 7.6, SOLAR, x - 0.55, 3.83, -1.0, 0, 0, 0.34);
    m.box(1.2, 1.25, 7.4, GLASS, x + 1.15, 3.83, -1.0, 0, 0, -0.2);
  }
  // Tool wheel over the entry: a ring and six coarse spokes.
  m.torus(1.15, 0.16, METAL, 3.9, 3.0, 2.62);
  for (let i = 0; i < 6; i += 1) {
    const a = (i / 6) * Math.PI * 2;
    m.beam(0.11, ACCENT, [3.9, 3.0, 2.64], [3.9 + Math.cos(a), 3.0 + Math.sin(a), 2.64]);
  }
  m.box(1.45, 2.7, 1.25, TIMBER, 4.7, 0.38, -2.0);
  for (const y of [0.7, 1.45, 2.2]) m.box(1.55, 0.11, 1.35, ACCENT, 4.7, y, -2.0);
  m.waterTank(0.55, 1.65, 4.8, 0.38, 3.9);
  m.planters(2, 2.6, -5.25, 0.38);
  return businessBuild(m, "b06-maker-workshop", "B06_MAKER_WORKSHOP");
};

const starterShopCafe = (): THREE.Group => {
  const m = new Mesher();
  m.box(tiles(4), 0.34, tiles(4), CREAM);
  m.box(5.5, 3.05, 4.8, PLASTER, -0.65, 0.34, -1.1);
  m.box(5.85, 0.24, 5.15, ROOF, -0.65, 3.39, -1.1);
  m.garden(4.5, 3.8, 3.63, -0.65, -1.1);
  // Corner glazing and produce crates say retail before the banner is visible.
  m.box(4.1, 1.35, 0.1, GLASS, -0.65, 1.0, 1.32);
  m.box(0.1, 1.35, 3.0, GLASS, 2.12, 1.0, -0.55);
  for (const x of [-2.1, -0.55, 1.0]) {
    m.box(1.25, 0.68, 0.9, TIMBER, x, 0.34, 2.3);
    m.ball(0.26, x < 0 ? LEAF_LIGHT : PRODUCE, x, 1.18, 2.3, 0.75);
  }
  // Five leaf-fan PV slats make a custom striped awning.
  for (let i = -2; i <= 2; i += 1) m.box(1.08, 0.11, 2.35, i % 2 === 0 ? SOLAR : ACCENT, i * 0.82, 2.85, 2.62, 0.25, i * 0.05);
  // Reusable-cup return: oversized cup body and geometric handle.
  m.cyl(0.48, 0.86, CREAM, 2.85, 0.34, 2.55, 0, 0, 0, 8);
  m.torus(0.38, 0.09, COPPER, 3.2, 0.94, 2.56, 0, Math.PI / 2);
  m.waterTank(0.42, 1.3, -3.15, 0.34, -2.75);
  return businessBuild(m, "b07-starter-shop-cafe", "B07_STARTER_SHOP_CAFE");
};

const harborGym = (): THREE.Group => {
  const m = new Mesher();
  m.box(tiles(6), 0.34, tiles(6), CREAM);
  // Four bamboo ribs and an open cyan shell create a naturally ventilated lotus hall.
  m.vault(4.05, 7.8, GLASS, 0, 4.35, -0.7);
  for (const z of [-4.0, -1.8, 0.4, 2.6]) m.torus(4.05, 0.17, TIMBER, 0, 0.52, z, 0, 0, 0, Math.PI);
  m.box(0.2, 3.5, 7.8, TIMBER, -4.05, 0.34, -0.7);
  m.box(0.2, 3.5, 7.8, TIMBER, 4.05, 0.34, -0.7);
  // The climbing wall faces customers, with coarse holds that remain readable.
  m.box(3.25, 4.25, 0.32, TERRACOTTA, -2.15, 0.34, -4.05, -0.08);
  for (const [x, y] of [[-3.0, 1.35], [-1.8, 2.1], [-2.65, 2.95], [-1.25, 3.55]] as const) m.ball(0.2, ACCENT, x, y, -3.86);
  // Large exercise wheel at the open front and simple spokes.
  m.torus(1.35, 0.17, TEAL, 2.45, 1.9, 3.35);
  for (let i = 0; i < 6; i += 1) {
    const a = (i / 6) * Math.PI * 2;
    m.beam(0.1, METAL, [2.45, 1.9, 3.37], [2.45 + Math.cos(a) * 1.15, 1.9 + Math.sin(a) * 1.15, 3.37]);
  }
  m.box(1.55, 0.18, 6.4, WATER, -4.95, 0.34, 0.6);
  m.box(1.25, 0.16, 5.8, REED, -4.95, 0.52, 0.6);
  m.box(1.1, 0.1, 6.4, SOLAR, 0, 5.15, -0.7, -0.18);
  return businessBuild(m, "b08-harbor-gym", "B08_HARBOR_GYM");
};

// Eight trades shared a building with another because the catalogue only had eight
// archetypes for fifteen licences — four different trades all raised a maker workshop.
// These give the remaining trades their own silhouette, so a built-up district reads as
// an economy rather than a row of clones.

const stonewakeMine = (): THREE.Group => {
  const m = new Mesher();
  m.box(tiles(6), 0.38, tiles(6), CREAM);
  // Terraced rock wedge; the portal faces +Z and is readable without a sign.
  m.box(6.6, 2.2, 5.4, SLATE, -2.4, 0.38, -1.2);
  m.box(5.2, 1.55, 4.4, 0x82796d, -2.75, 2.58, -1.55);
  m.box(3.8, 1.15, 3.2, 0x6f685f, -3.0, 4.13, -1.8);
  m.box(2.3, 2.2, 0.18, ROOF, -2.4, 0.38, 1.52);
  m.torus(1.32, 0.22, COPPER, -2.4, 0.68, 1.64, 0, 0, 0, Math.PI);
  for (const x of [-3.72, -1.08]) m.box(0.34, 2.2, 0.42, COPPER, x, 0.38, 1.62);
  // Planted reclamation ledges turn the mine's sustainability into structure.
  m.box(2.2, 0.24, 1.0, LEAF, -4.4, 2.58, 0.4);
  m.box(2.0, 0.22, 0.9, LEAF_LIGHT, -4.1, 4.13, -0.2);
  // Angular electric headframe and winding wheel.
  m.beam(0.2, METAL, [1.0, 0.38, -2.8], [2.1, 5.8, -2.8]);
  m.beam(0.2, METAL, [4.5, 0.38, -2.8], [3.4, 5.8, -2.8]);
  m.beam(0.22, METAL, [2.1, 5.8, -2.8], [3.4, 5.8, -2.8]);
  m.torus(0.95, 0.14, ACCENT, 2.75, 5.0, -2.64);
  for (let i = 0; i < 4; i += 1) {
    const a = (i / 4) * Math.PI * 2;
    m.beam(0.09, TIMBER, [2.75, 5.0, -2.62], [2.75 + Math.cos(a) * 0.78, 5.0 + Math.sin(a) * 0.78, -2.62]);
  }
  // Short rail run and a single oversized ore cart.
  for (const x of [-2.95, -1.85]) m.beam(0.11, METAL, [x, 0.54, 1.5], [x, 0.54, 5.35]);
  m.box(1.9, 0.9, 1.45, COPPER, -2.4, 0.56, 3.8, 0.18);
  for (const x of [-3.05, -1.75]) m.cylinderBetween(0.25, ROOF, [x, 0.63, 3.3], [x, 0.63, 4.3], 8);
  // Solar charging shelter for the electric equipment.
  for (const x of [3.5, 5.0]) m.cyl(0.1, 2.2, METAL, x, 0.38, 3.7, 0, 0, 0, 8);
  m.box(2.1, 0.1, 2.3, SOLAR, 4.25, 2.58, 3.7, -0.28);
  m.box(0.7, 1.1, 0.7, TEAL, 4.55, 0.38, 3.7);
  return businessBuild(m, "b09-stonewake-mine", "B09_STONEWAKE_MINE");
};

const timbercoastWorks = (): THREE.Group => {
  const m = new Mesher();
  m.box(tiles(6), 0.38, tiles(6), CREAM);
  // Open timber-truss saw shed.
  for (const x of [-4.4, 0, 4.4]) for (const z of [-2.9, 2.9]) m.cyl(0.18, 3.35, TIMBER, x, 0.38, z, 0, 0, 0, 8);
  for (const z of [-2.9, 0, 2.9]) {
    m.beam(0.18, TIMBER, [-4.4, 3.73, z], [0, 5.05, z]);
    m.beam(0.18, TIMBER, [0, 5.05, z], [4.4, 3.73, z]);
  }
  m.gable(9.6, 6.5, 1.4, ROOF, 3.73);
  m.box(2.2, 2.5, 5.4, PLASTER, -4.75, 0.38, 0);
  m.box(0.1, 1.0, 4.4, GLASS, -3.63, 1.25, 0);
  // Log deck feeds the saw carriage; true point-to-point cylinders stay grounded.
  for (let i = 0; i < 4; i += 1) m.cylinderBetween(0.38, i % 2 === 0 ? TIMBER : COPPER, [2.1 + i * 0.72, 0.86 + (i % 2) * 0.62, -4.6], [2.1 + i * 0.72, 0.86 + (i % 2) * 0.62, -1.0], 8);
  for (const x of [-1.6, 1.6]) m.beam(0.12, METAL, [x, 0.62, 0.2], [x, 0.62, 4.9]);
  m.box(4.2, 0.24, 1.25, ACCENT, 0, 0.64, 2.4);
  m.cylinderBetween(1.0, METAL, [0, 1.95, 2.23], [0, 1.95, 2.55], 12);
  m.cyl(0.18, 1.05, ROOF, 0, 1.95, 2.56, Math.PI / 2, 0, 0, 8);
  // Dark solar kiln and sawdust biomass silo close the material loop.
  m.vault(1.4, 3.8, SOLAR, 4.1, 2.0, 1.3);
  m.torus(1.4, 0.12, COPPER, 4.1, 0.62, 3.18, 0, 0, 0, Math.PI);
  m.cyl(0.7, 2.0, TEAL, -4.7, 2.88, -3.9, 0, 0, 0, 8);
  m.cone(0.8, 0.8, ACCENT, -4.7, 4.88, -3.9, 0, 0, 0, 8);
  return businessBuild(m, "b10-timbercoast-works", "B10_TIMBERCOAST_WORKS");
};

const freightCrateMill = (): THREE.Group => {
  const m = new Mesher();
  m.box(tiles(6), 0.38, tiles(6), CREAM);
  // Three stepped volumes make the roof itself resemble stacked reusable crates.
  m.box(5.0, 2.7, 5.4, PLASTER, -3.0, 0.38, -1.8);
  m.box(4.0, 3.45, 4.8, TERRACOTTA, 1.45, 0.38, -1.9);
  m.box(2.35, 4.15, 3.5, TIMBER, 4.1, 0.38, -2.0);
  m.box(5.35, 0.22, 5.7, ROOF, -3.0, 3.08, -1.8);
  m.box(4.35, 0.22, 5.15, ROOF, 1.45, 3.83, -1.9);
  m.solar(3.2, 3.7, 4.05, 2, 1.45, -1.9);
  // Oversized half-built crate: open frame, not another coloured cube.
  for (const x of [1.55, 4.95]) for (const z of [2.15, 4.85]) m.beam(0.19, COPPER, [x, 0.38, z], [x, 3.45, z]);
  for (const y of [0.55, 3.35]) {
    m.beam(0.18, TIMBER, [1.55, y, 2.15], [4.95, y, 2.15]);
    m.beam(0.18, TIMBER, [1.55, y, 4.85], [4.95, y, 4.85]);
    m.beam(0.18, TIMBER, [1.55, y, 2.15], [1.55, y, 4.85]);
    m.beam(0.18, TIMBER, [4.95, y, 2.15], [4.95, y, 4.85]);
  }
  // Flat-pack rack and sawdust collector complete the closed-loop process.
  for (let i = 0; i < 4; i += 1) m.box(0.22, 2.3, 2.3, i % 2 === 0 ? TIMBER : COPPER, -4.6 + i * 0.55, 0.38, 3.65, 0, 0, -0.08);
  m.cyl(0.72, 1.5, TEAL, -1.4, 0.38, 3.65, 0, 0, 0, 8);
  m.cone(0.78, 0.85, ACCENT, -1.4, 1.88, 3.65, 0, 0, 0, 8);
  return businessBuild(m, "b11-freight-crate-mill", "B11_FREIGHT_CRATE_MILL");
};

const mercedonianFactory = (): THREE.Group => {
  const m = new Mesher();
  m.box(tiles(8), 0.38, tiles(8), CREAM);
  m.box(12.4, 3.9, 10.4, PLASTER, -0.7, 0.38, -1.7);
  m.box(12.8, 0.24, 10.8, TEAL, -0.7, 4.28, -1.7);
  // Five alternating north-light teeth are the factory's dominant skyline.
  for (let i = -2; i <= 2; i += 1) {
    const x = -0.7 + i * 2.25;
    m.box(2.15, 0.18, 9.7, SOLAR, x - 0.42, 4.35, -1.7, 0, 0, 0.36);
    m.box(0.22, 1.35, 9.5, GLASS, x + 0.85, 4.28, -1.7, 0, 0, -0.08);
  }
  // External linear production gantry and conveyor give the trade an obvious process.
  for (const x of [-5.4, -1.8, 1.8, 5.4]) m.beam(0.19, COPPER, [x, 0.38, 5.1], [x, 3.35, 5.1]);
  m.beam(0.28, ACCENT, [-5.6, 3.35, 5.1], [5.6, 3.35, 5.1]);
  m.box(11.2, 0.35, 1.35, ROOF, 0, 0.55, 5.1);
  for (const x of [-3.8, 0, 3.8]) m.box(2.1, 1.35, 1.7, x === 0 ? ACCENT : TEAL, x, 0.9, 5.1);
  // Closed-loop tank, return pipe and roof planting strips.
  m.waterTank(1.0, 2.7, 6.35, 0.38, -4.9);
  m.cylinderBetween(0.14, WATER_DEEP, [6.35, 2.4, -4.9], [5.4, 2.4, 4.8], 8);
  for (const x of [-3.2, 3.2]) m.box(1.15, 0.22, 7.8, LEAF, x, 5.15, -1.7);
  m.planters(3, 5.5, -7.25, 0.38);
  return businessBuild(m, "b12-mercedonian-factory", "B12_MERCEDONIAN_FACTORY");
};

const civicConstruction = (): THREE.Group => {
  const m = new Mesher();
  m.box(tiles(8), 0.38, tiles(6), CREAM);
  // Low site office with its own solar and rain systems.
  m.box(4.8, 2.65, 5.0, PLASTER, -5.0, 0.38, -2.3);
  m.box(5.15, 0.24, 5.3, ROOF, -5.0, 3.03, -2.3);
  m.box(3.8, 0.9, 0.1, GLASS, -5.0, 1.25, 0.22);
  m.solar(3.8, 3.8, 3.27, 2, -5.0, -2.3);
  m.waterTank(0.52, 1.55, -7.0, 0.38, 2.0);
  // Tall portal crane is broad, not a generic tower crane.
  for (const x of [0.6, 6.6]) {
    m.beam(0.38, ACCENT, [x, 0.38, -3.8], [x, 7.45, -3.8]);
    m.beam(0.38, ACCENT, [x, 0.38, 2.1], [x, 7.45, 2.1]);
    m.beam(0.22, COPPER, [x, 0.7, -3.8], [x, 7.2, 2.1]);
  }
  m.beam(0.42, ACCENT, [0.6, 7.45, -3.8], [6.6, 7.45, -3.8]);
  m.beam(0.42, ACCENT, [0.6, 7.45, 2.1], [6.6, 7.45, 2.1]);
  m.beam(0.3, METAL, [3.6, 7.45, -3.8], [3.6, 7.45, 2.1]);
  m.cylinderBetween(0.08, ROOF, [3.6, 7.35, 1.2], [3.6, 4.6, 1.2], 8);
  // Room-sized prefab pod and vertical wall-panel rack.
  m.box(4.2, 2.55, 3.4, TERRACOTTA, 3.6, 0.38, 3.65);
  m.box(1.8, 1.25, 0.12, GLASS, 3.6, 1.0, 5.37);
  for (let i = 0; i < 4; i += 1) m.box(0.28, 2.85, 2.7, i % 2 === 0 ? TIMBER : METAL, -1.65 + i * 0.62, 0.38, 3.75, 0, 0, -0.09);
  m.box(3.3, 0.17, 9.6, REED, -6.15, 0.38, 0.4);
  return businessBuild(m, "b13-civic-construction", "B13_CIVIC_CONSTRUCTION");
};

const marketKitchen = (): THREE.Group => {
  const m = new Mesher();
  m.box(tiles(6), 0.34, tiles(6), CREAM);
  // Twin inverted umbrellas harvest rain and create an open communal cookhouse.
  for (const x of [-2.65, 2.65]) {
    m.cyl(0.16, 3.25, TIMBER, x, 0.34, -0.6, 0, 0, 0, 8);
    m.cone(2.75, 0.72, x < 0 ? PLASTER : ACCENT, x, 3.15, -0.6, Math.PI, 0, 0, 12);
    m.cylinderBetween(0.1, WATER_DEEP, [x, 3.15, -0.6], [x, 0.55, -0.6], 8);
  }
  // Central solar oven and chimney establish this as a kitchen, not a pavilion.
  m.box(2.8, 1.25, 2.35, TERRACOTTA, 0, 0.34, -2.3);
  m.vault(0.95, 2.0, ROOF, 0, 1.55, -2.3);
  m.box(1.25, 0.16, 1.15, SOLAR, 0, 2.15, -1.7, -0.38);
  m.cyl(0.3, 2.15, COPPER, 0, 1.59, -3.0, 0, 0, 0, 8);
  // Produce counter and one long common table face the customer edge.
  m.box(7.7, 1.05, 1.35, TIMBER, 0, 0.34, 3.75);
  for (const x of [-2.5, -0.85, 0.85, 2.5]) m.ball(0.3, x < 0 ? LEAF_LIGHT : PRODUCE, x, 1.55, 3.75, 0.7);
  m.box(6.0, 0.22, 1.5, PLASTER, 0, 0.95, 1.35);
  for (const x of [-2.4, 2.4]) m.box(0.22, 0.62, 1.2, METAL, x, 0.34, 1.35);
  // Herb beds and compost/biogas drum complete the circular kitchen system.
  for (const x of [-3.8, -1.9, 1.9, 3.8]) m.box(1.45, 0.42, 1.1, x < 0 ? LEAF : LEAF_LIGHT, x, 0.34, 5.0);
  m.cylinderBetween(0.62, TEAL, [4.65, 1.0, -3.8], [4.65, 1.0, -1.9], 10);
  return businessBuild(m, "b14-market-kitchen", "B14_MARKET_KITCHEN");
};

const lanternCinema = (): THREE.Group => {
  const m = new Mesher();
  m.box(tiles(8), 0.36, tiles(6), CREAM);
  m.box(10.4, 5.15, 8.1, VIOLET, -1.0, 0.36, -1.1);
  m.box(10.8, 0.3, 8.5, ROOF, -1.0, 5.51, -1.1);
  // Pale screen facade and giant projector aperture read as cinema from +Z.
  m.box(7.3, 3.55, 0.18, PLASTER, -1.0, 1.05, 3.0);
  m.torus(1.48, 0.24, ACCENT, -1.0, 3.0, 3.14);
  m.cylinderBetween(1.06, WATER_DEEP, [-1.0, 3.0, 3.08], [-1.0, 3.0, 3.3], 12);
  m.cylinderBetween(0.42, GLASS, [-1.0, 3.0, 3.31], [-1.0, 3.0, 3.48], 10);
  // Lantern crown turns the box into a night-time district landmark.
  m.cyl(1.85, 0.75, TERRACOTTA, -1.0, 5.81, -1.1, 0, 0, 0, 10);
  m.ball(1.55, ACCENT, -1.0, 7.25, -1.1, 1.12);
  m.cone(1.45, 0.85, COPPER, -1.0, 8.65, -1.1, 0, 0, 0, 8);
  // Solar-petal marquee, entrance fins, and shallow theater steps.
  for (let i = -2; i <= 2; i += 1) m.box(1.6, 0.12, 2.7, i % 2 === 0 ? SOLAR : ACCENT, -1.0 + i * 1.35, 1.92, 4.2, 0.32, i * 0.07);
  for (const x of [-5.25, 3.25]) m.box(0.28, 3.2, 1.7, COPPER, x, 0.36, 3.45, 0, 0, x < 0 ? -0.1 : 0.1);
  for (let i = 0; i < 3; i += 1) m.box(6.5 - i * 0.8, 0.18, 0.75, i % 2 === 0 ? TERRACOTTA : CREAM, -1.0, 0.36 + i * 0.18, 4.4 + i * 0.55);
  m.box(1.2, 0.22, 5.8, LEAF, -4.55, 5.81, -1.1);
  m.box(1.2, 0.22, 5.8, LEAF_LIGHT, 2.55, 5.81, -1.1);
  return businessBuild(m, "b15-lantern-cinema", "B15_LANTERN_CINEMA");
};

const reclamationHub = (): THREE.Group => {
  const m = new Mesher();
  m.box(tiles(6), 0.38, tiles(6), CREAM);
  m.box(5.4, 3.45, 6.0, PLASTER, -2.8, 0.38, -1.45);
  m.box(5.8, 0.26, 6.4, ROOF, -2.8, 3.83, -1.45);
  m.solar(4.6, 4.8, 4.09, 3, -2.8, -1.45);
  m.box(4.3, 1.05, 0.12, GLASS, -2.8, 1.05, 1.58);
  // Exterior X-bracing makes the reclamation hall structurally distinct.
  m.beam(0.16, TEAL, [-5.35, 0.5, 1.72], [-0.25, 3.65, 1.72]);
  m.beam(0.16, TEAL, [-0.25, 0.5, 1.72], [-5.35, 3.65, 1.72]);
  // Hopper tower and sloped conveyor feed the sorting bays.
  for (const x of [1.6, 4.7]) for (const z of [-3.6, -0.5]) m.beam(0.18, METAL, [x, 0.38, z], [x, 4.45, z]);
  m.cyl(1.45, 1.35, METAL, 3.15, 4.45, -2.05, 0, 0, 0, 8);
  m.cone(1.45, 1.25, COPPER, 3.15, 3.2, -2.05, Math.PI, 0, 0, 8);
  m.beam(0.62, ROOF, [3.15, 3.4, -0.7], [2.6, 1.65, 2.55]);
  m.beam(0.12, ACCENT, [2.55, 3.55, -0.65], [2.0, 1.8, 2.6]);
  const bays = [LEAF, WATER, METAL];
  bays.forEach((colour, i) => {
    const x = 0.4 + i * 2.25;
    m.box(1.85, 1.2, 2.1, colour, x, 0.38, 3.8);
    m.box(2.0, 0.14, 2.25, ROOF, x, 1.58, 3.8);
  });
  // Compact wind rotor and a blue-green bioswale finish the circular system.
  m.cyl(0.1, 4.4, METAL, 5.0, 0.38, -4.6, 0, 0, 0, 8);
  m.torus(0.72, 0.1, ACCENT, 5.0, 4.35, -4.48);
  for (let i = 0; i < 3; i += 1) {
    const a = (i / 3) * Math.PI * 2;
    m.beam(0.1, TEAL, [5.0, 4.35, -4.46], [5.0 + Math.cos(a) * 0.62, 4.35 + Math.sin(a) * 0.62, -4.46]);
  }
  m.box(1.1, 0.16, 6.7, WATER, -5.25, 0.38, 1.8);
  m.box(0.82, 0.18, 5.9, REED, -5.25, 0.54, 1.8);
  return businessBuild(m, "b16-reclamation-hub", "B16_RECLAMATION_HUB");
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
  "b09-stonewake-mine": stonewakeMine,
  "b10-timbercoast-works": timbercoastWorks,
  "b11-freight-crate-mill": freightCrateMill,
  "b12-mercedonian-factory": mercedonianFactory,
  "b13-civic-construction": civicConstruction,
  "b14-market-kitchen": marketKitchen,
  "b15-lantern-cinema": lanternCinema,
  "b16-reclamation-hub": reclamationHub,
};

// ---------------------------------------------------------------- civic landmarks
// The nine government buildings are baked into world.gltf as ~32k triangles each —
// 293k in total for buildings a player only ever sees from across a plaza. These are
// generated stand-ins in the same low-poly language as the authored turntables: a tiled
// deck, chunky massing, timber and cream, a teal cupola where a landmark wants one.
// Each is authored to the footprint and height the layout reserves for its site.

/** A tiled civic deck with a kerb, the base every landmark in the reference sits on. */
const civicDeck = (m: Mesher, w: number, d: number): void => {
  m.box(w, 0.35, d, CREAM);
  m.box(w - 0.7, 0.12, d - 0.7, PLASTER, 0, 0.35, 0);
  m.box(w, 0.14, 0.5, TERRACOTTA, 0, 0.35, d / 2 - 0.25);
  m.box(w, 0.14, 0.5, TERRACOTTA, 0, 0.35, -d / 2 + 0.25);
};

/** A row of columns along the front, the civic tell in every reference sheet. */
const colonnade = (m: Mesher, count: number, spread: number, x: number, height: number): void => {
  for (let i = 0; i < count; i += 1) {
    const z = -spread / 2 + (spread / (count - 1)) * i;
    m.cyl(0.32, height, PLASTER, x, 0.47, z);
    m.box(0.86, 0.18, 0.86, CREAM, x, 0.47 + height, z);
  }
};

const cityHall = (): THREE.Group => {
  const m = new Mesher();
  civicDeck(m, 15, 15);
  m.box(11, 1.1, 11, PLASTER, 0, 0.47, 0);
  m.box(9.5, 4.2, 9, CREAM, 0, 1.57, 0);
  m.glazing(9.5, 9, 3.6, 1.6);
  colonnade(m, 6, 9.4, 5.1, 5.3);
  m.box(11.6, 0.5, 11, ROOF, 0, 5.77, 0);
  // Pediment and clock tower with the teal cupola the landmarks carry.
  m.gable(6.4, 2.2, 1.1, TERRACOTTA, 6.27);
  m.box(4.2, 2.6, 4.2, CREAM, 0, 6.27, 0);
  m.box(4.8, 0.35, 4.8, ROOF, 0, 8.87, 0);
  m.cyl(1.9, 0.9, PLASTER, 0, 9.22, 0, 0, 0, 0, 8);
  m.ball(1.75, GLASS, 0, 10.5, 0, 0.72);
  m.cyl(0.12, 1.1, ACCENT, 0, 11.1, 0);
  for (const z of [-3.4, 3.4]) m.box(1.2, 0.9, 1.2, ACCENT, 4.4, 1.57, z);
  m.planters(4, 8.4, 6.4, 0.47);
  m.solar(6.6, 4.6, 5.77, 3);
  m.vines(-4.8, 2.0, 4.5, 3.2, "z");
  m.vines(-4.8, 2.0, -4.5, 3.2, "z");
  m.waterTank(0.85, 2.4, -5.2, 0.47, 0);
  return m.build("CV01_CITY_HALL");
};

const treasury = (): THREE.Group => {
  const m = new Mesher();
  civicDeck(m, 11.3, 11.3);
  m.box(9.4, 0.9, 9.4, PLASTER, 0, 0.47, 0);
  m.box(8, 4.4, 8, CREAM, 0, 1.37, 0);
  // Pilasters rather than open columns: a vault reads as closed.
  for (let i = -2; i <= 2; i += 1) {
    m.box(0.5, 4.4, 0.5, PLASTER, 4.05, 1.37, i * 1.8);
    m.box(0.5, 4.4, 0.5, PLASTER, -4.05, 1.37, i * 1.8);
  }
  m.box(8.8, 0.45, 8.8, ROOF, 0, 5.77, 0);
  m.box(4.4, 1.5, 4.4, CREAM, 0, 6.22, 0);
  m.cyl(2.1, 0.4, PLASTER, 0, 7.72, 0, 0, 0, 0, 8);
  m.ball(1.9, ACCENT, 0, 8.3, 0, 0.6);
  m.box(2.6, 3.1, 0.3, SOLAR, 0, 1.37, 4.05);
  m.garden(6.4, 6.4, 6.22);
  m.planters(3, 6.0, 5.2, 0.47);
  m.waterTank(0.7, 2.0, -5.0, 0.47, 3.4);
  return m.build("CV02_TREASURY");
};

const landRegistry = (): THREE.Group => {
  const m = new Mesher();
  civicDeck(m, 11.3, 7.5);
  m.box(9.2, 3.4, 5.8, PLASTER, 0, 0.47, 0);
  m.glazing(9.2, 5.8, 2.2, 1.3);
  m.box(9.8, 0.4, 6.4, ROOF, 0, 3.87, 0);
  m.garden(7.6, 4.6, 4.27);
  m.box(2.4, 2.6, 0.28, TIMBER, -2.6, 0.47, 2.9);
  m.box(3.2, 0.16, 1.4, ACCENT, -2.6, 3.2, 3.5, 0.2);
  m.pergola(4.6, 2.2, 0.47, 2.6, 2.4, 2.4);
  m.planters(3, 4.4, 4.4, 0.47);
  m.solar(6.4, 3.6, 4.27, 3);
  return m.build("CV03_LAND_REGISTRY");
};

const transitHall = (): THREE.Group => {
  const m = new Mesher();
  civicDeck(m, 15, 11.3);
  m.box(7.4, 4.6, 8.6, CREAM, -3.4, 0.47, 0);
  m.glazing(7.4, 8.6, 2.6, 1.8);
  m.box(8, 0.42, 9.2, ROOF, -3.4, 5.07, 0);
  // A platform canopy on slim posts, the transit signature.
  for (const z of [-3.4, 0, 3.4]) m.cyl(0.22, 3.9, METAL, 4.2, 0.47, z);
  m.vault(2.6, 9.4, GLASS, 4.2, 4.5);
  m.box(6.6, 0.14, 9.4, PLASTER, 4.2, 0.47, 0);
  m.box(2.2, 2.4, 2.2, TERRACOTTA, -6.2, 5.07, 0);
  m.ball(0.75, ACCENT, -6.2, 8.0, 0);
  m.garden(6.2, 7.0, 5.49);
  m.planters(4, 8.0, 7.6, 0.47);
  m.vines(-7.2, 1.6, 0, 3.0, "x");
  return m.build("CV04_TRANSIT_HALL");
};

const communityClinic = (): THREE.Group => {
  const m = new Mesher();
  civicDeck(m, 11.3, 11.3);
  m.box(8.6, 3.6, 8.6, PLASTER, 0, 0.47, 0);
  m.glazing(8.6, 8.6, 2.3, 1.4);
  m.box(9.2, 0.42, 9.2, ROOF, 0, 4.07, 0);
  m.garden(7.4, 7.4, 4.49);
  // A green cross, readable from the plaza without a texture.
  m.box(0.34, 2.0, 0.7, LEAF, 4.35, 1.5, 0);
  m.box(0.34, 0.7, 2.0, LEAF, 4.35, 2.15, 0);
  m.box(3.2, 0.16, 1.6, ACCENT, 0, 3.5, 4.6, 0.22);
  m.pergola(5.0, 2.0, 0.47, 2.4, 0, 5.2);
  m.planters(4, 7.4, -4.9, 0.47);
  m.waterTank(0.75, 2.2, 4.8, 0.47, -3.6);
  return m.build("CV05_COMMUNITY_CLINIC");
};

const rescueStation = (): THREE.Group => {
  const m = new Mesher();
  civicDeck(m, 15, 11.3);
  m.box(10.4, 4.2, 8.6, TERRACOTTA, -1.6, 0.47, 0);
  // Appliance bays, the shape that says rescue station at a glance.
  for (const z of [-2.6, 0.2, 3.0]) m.box(0.3, 3.1, 2.3, CREAM, 3.65, 0.47, z);
  m.box(11, 0.45, 9.2, ROOF, -1.6, 4.67, 0);
  m.solar(8.4, 7.4, 5.12, 4);
  m.box(3.2, 7.4, 3.2, PLASTER, 5.4, 0.47, -3.2);
  m.box(3.8, 0.4, 3.8, ROOF, 5.4, 7.87, -3.2);
  m.ball(0.6, ACCENT, 5.4, 8.7, -3.2);
  m.planters(3, 5.6, 2.6, 0.47);
  m.vines(-7.0, 1.6, 0, 3.4, "x");
  m.waterTank(0.8, 2.4, -6.6, 0.47, 3.4);
  return m.build("CV06_RESCUE_STATION");
};

const worksDepot = (): THREE.Group => {
  const m = new Mesher();
  civicDeck(m, 15, 11.3);
  m.box(8.4, 3.8, 8.4, PLASTER, -3, 0.47, 0);
  m.gable(9, 9, 1.5, ROOF, 4.27);
  // An open yard with stacked stock, the depot tell.
  for (const [x, z, h] of [[4.2, -2.6, 1.2], [5.6, 0.6, 0.8], [3.4, 2.8, 1.6]] as const) {
    m.box(1.8, h, 1.8, TIMBER, x, 0.47, z);
    m.box(1.9, 0.16, 1.9, TERRACOTTA, x, 0.47 + h, z);
  }
  m.cyl(0.8, 5.4, METAL, -6.2, 0.47, -3.2);
  m.cyl(0.9, 0.35, ACCENT, -6.2, 5.87, -3.2);
  m.pergola(4.4, 3.2, 0.47, 2.4, 4.4, 0);
  m.planters(3, 5.0, -6.4, 0.47);
  m.solar(6.6, 6.6, 4.27, 4);
  return m.build("CV07_WORKS_DEPOT");
};

const makerAcademy = (): THREE.Group => {
  const m = new Mesher();
  civicDeck(m, 15, 15);
  m.box(12, 5.2, 10.6, CREAM, 0, 0.47, 0);
  // Tall bays: a library reads through its windows.
  for (let i = -2; i <= 2; i += 1) {
    m.box(0.3, 3.6, 1.7, GLASS, 6.05, 1.3, i * 2.0);
    m.box(0.3, 3.6, 1.7, GLASS, -6.05, 1.3, i * 2.0);
  }
  m.box(12.6, 0.48, 11.2, ROOF, 0, 5.67, 0);
  m.garden(9.6, 8.4, 6.15);
  m.box(3.4, 3.2, 3.4, TERRACOTTA, -4.2, 5.67, 0);
  m.gable(3.9, 3.9, 1.2, ROOF, 8.87);
  m.box(2.8, 2.6, 0.3, TIMBER, 0, 0.47, 5.3);
  m.pergola(6.0, 2.4, 0.47, 2.7, 0, 6.4);
  m.planters(4, 9.0, 6.8, 0.47);
  m.solar(7.2, 5.2, 6.15, 3);
  m.vines(6.4, 1.6, -4.4, 3.6, "x");
  return m.build("CV08_MAKER_ACADEMY");
};

const gardenHomes = (): THREE.Group => {
  const m = new Mesher();
  civicDeck(m, 11.3, 15);
  // Three terraced blocks, stepped, each with a planted roof.
  const heights = [4.4, 5.6, 4.0];
  heights.forEach((h, i) => {
    const z = -4.6 + i * 4.6;
    m.box(8.4, h, 4.0, i === 1 ? PLASTER : CREAM, 0, 0.47, z);
    m.box(9.0, 0.4, 4.4, ROOF, 0, 0.47 + h, z);
    m.box(7.4, 0.18, 3.4, LEAF, 0, 0.87 + h, z);
    m.box(8.2, 0.9, 0.12, GLASS, 0, 1.6, z + 2.0);
    m.box(3.0, 0.12, 1.2, ACCENT, 2.4, 0.47 + h * 0.62, z + 2.1, 0.2);
  });
  m.cyl(0.24, 3.0, TIMBER, -4.6, 0.47, 0);
  m.ball(1.15, LEAF, -4.6, 4.1, 0, 0.9);
  m.planters(5, 12.0, 4.8, 0.47);
  m.vines(4.4, 1.4, -4.6, 3.4, "x");
  m.vines(4.4, 1.4, 4.6, 3.4, "x");
  m.waterTank(0.7, 2.0, -4.6, 0.47, -5.4);
  return m.build("CV09_GARDEN_HOMES");
};

/** Keyed by the node names world.gltf uses for its baked landmarks. */
const CIVIC: Record<string, () => THREE.Group> = {
  MM_CIVIC_CV01_CITY_HALL: cityHall,
  MM_CIVIC_CV02_TREASURY: treasury,
  MM_CIVIC_CV03_LAND_REGISTRY: landRegistry,
  MM_CIVIC_CV04_TRANSIT_HALL: transitHall,
  MM_CIVIC_CV05_COMMUNITY_CLINIC: communityClinic,
  MM_CIVIC_CV06_RESCUE_STATION: rescueStation,
  MM_CIVIC_CV07_PUBLIC_WORKS: worksDepot,
  MM_CIVIC_CV08_MAKER_ACADEMY: makerAcademy,
  MM_CIVIC_CV09_GARDEN_HOMES: gardenHomes,
};

/** A generated landmark for a baked civic node name, or null if it is not one. */
export function civicStructureFor(nodeName: string): THREE.Group | null {
  const build = CIVIC[nodeName];
  return build ? build() : null;
}

export const CIVIC_NODE_NAMES = Object.keys(CIVIC);

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
const stemOf = (url: string): string => (url.split("/").pop() ?? "").split("?")[0]!.replace(/\.glb$/i, "");

export function proceduralSceneFor(url: string): THREE.Group | null {
  const stem = stemOf(url);
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
    const stem = stemOf(url);
    // Citizens are skinned pixel figures with their own Idle and Walk clips; scenery
    // and buildings are static merged meshes. Anything else is a real download.
    if (isPixelAvatarStem(stem)) {
      const { scene, animations } = buildPixelAvatar(stem);
      return asGLTF(scene, animations);
    }
    const scene = proceduralSceneFor(url);
    if (!scene) return original(url, onProgress);
    return asGLTF(scene, []);
  };
  return loader;
}

function asGLTF(scene: THREE.Group, animations: THREE.AnimationClip[]): GLTF {
  return {
    scene,
    scenes: [scene],
    animations,
    cameras: [],
    asset: { generator: "markets-and-makers procedural" },
    userData: {},
  } as unknown as GLTF;
}
