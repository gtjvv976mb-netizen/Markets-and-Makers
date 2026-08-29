import * as THREE from "three";
import { dampWrappedYaw, headingYaw, planarSpeed, walkAnimationRate } from "./characterRig";
import {
  BUSINESS, DEFAULT_EQUIPMENT_TILES, FITTINGS, FLOOR_COLUMNS, FLOOR_ROWS, FLOOR_TILE,
  FLOOR_WALKWAY_COLUMN, MAX_UPGRADE_LEVEL, servicedTiles, tileIsBuildable, tileToWorld, worldToTile,
} from "./data";
import type { BusinessConfig, FittingKey, LicenseKey, UpgradeKey } from "./data";
import { createPlayerMercedonian } from "./mercedonianAvatar";
import { surfaceTile } from "./tileTextures";

export interface InteriorEnterOptions {
  business: BusinessConfig;
  /** Where this owner has put each machine. Authored defaults if they never moved one. */
  tiles?: Record<string, { column: number; row: number }>;
  /** Which fittings have been bought, and the tile each one stands on. */
  fittings?: Partial<Record<FittingKey, { column: number; row: number } | null>>;
  /** Called when a placement drag ends on a tile. The store decides whether it sticks. */
  onPlace?: (key: string, column: number, row: number, kind: "station" | "fitting") => boolean;
  /** Recommended when several custom configs share a display name. Inferred otherwise. */
  license?: LicenseKey;
  upgrades: Record<UpgradeKey, number>;
  /** Highest equipment level the current deed or charter allows. */
  upgradeCeiling: number;
}

export type InteriorSelection =
  | {
      kind: "upgrade";
      key: UpgradeKey;
      label: string;
      level: number;
      ceiling: number;
      distance: number;
      nearby: boolean;
    }
  | {
      kind: "exit";
      label: string;
      distance: number;
      nearby: boolean;
    };

export interface InteriorPrompt {
  selection: InteriorSelection;
  title: string;
  detail: string;
  actionLabel: string;
  available: boolean;
  inputHint: string;
}

export interface InteriorWorldCallbacks {
  /** The host performs the economic transaction, then calls updateUpgradeLevels. */
  onInteract?: (key: UpgradeKey) => void;
  onExit?: () => void;
  onSelectionChange?: (selection: InteriorSelection | null) => void;
  onPromptChange?: (prompt: InteriorPrompt | null) => void;
  onMoved?: (position: { x: number; z: number }) => void;
}

export type InteriorMoveDirection = "forward" | "backward" | "left" | "right";

interface StationDefinition {
  key: UpgradeKey;
  label: string;
  shortLabel: string;
  icon: string;
  detail: string;
  position: readonly [number, number];
}

interface InteriorStation {
  definition: StationDefinition;
  design: InteriorEquipmentDesign;
  root: THREE.Group;
  approach: THREE.Vector3;
  halo: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  label: THREE.Sprite;
  lamps: THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>[];
  highlightMaterials: THREE.MeshStandardMaterial[];
  blueprint: THREE.Group;
  modules: THREE.Group[];
}

export type InteriorEquipmentMotif =
  | "hydraulic" | "solar" | "botanical" | "geologic" | "forestry"
  | "packaging" | "maker" | "industrial" | "construction" | "logistics"
  | "retail" | "culinary" | "fitness" | "cinematic" | "circular";

export interface InteriorEquipmentDesign {
  /** A business-specific machine name shown both in-world and in companion UI. */
  name: string;
  description: string;
  /** Unique stable identifier for the procedural form. */
  form: string;
  motif: InteriorEquipmentMotif;
  primary: string;
  secondary: string;
}

const equipmentSet = (
  license: LicenseKey,
  motif: InteriorEquipmentMotif,
  names: Record<UpgradeKey, string>,
  secondary: Record<UpgradeKey, string>,
): Record<UpgradeKey, InteriorEquipmentDesign> => {
  const business = BUSINESS[license];
  const descriptions: Record<UpgradeKey, string> = {
    yield: `Raises the quality and productive yield of ${business.name}.`,
    capacity: `Adds working and storage capacity tailored to ${business.sector.toLowerCase()}.`,
    speed: `Shortens each operating cycle through a custom ${business.sector.toLowerCase()} workflow.`,
    appeal: `Makes ${business.name} more useful and inviting to Mercedonians and buyers.`,
  };
  return Object.fromEntries((Object.keys(names) as UpgradeKey[]).map((key) => [key, {
    name: names[key],
    description: descriptions[key],
    form: `${license}-${key}-${motif}`,
    motif,
    primary: business.color,
    secondary: secondary[key],
  }])) as Record<UpgradeKey, InteriorEquipmentDesign>;
};

/** Pure catalog used by the renderer and suitable for UI cards or validation tests. */
export const INTERIOR_EQUIPMENT_CATALOG: Record<LicenseKey, Record<UpgradeKey, InteriorEquipmentDesign>> = {
  aquaworks: equipmentSet("aquaworks", "hydraulic", {
    yield: "Purity Helix", capacity: "Reservoir Loom", speed: "Currentline Manifold", appeal: "Tideglass Welcome Cascade",
  }, { yield: "#69d8d1", capacity: "#4c9ec2", speed: "#e7bd55", appeal: "#82c87a" }),
  sungrid: equipmentSet("sungrid", "solar", {
    yield: "Photon Tuner", capacity: "HelioCell Bank", speed: "Sunstep Relay", appeal: "Radiance Beacon",
  }, { yield: "#ffd65b", capacity: "#ef9f45", speed: "#66c7c8", appeal: "#fff0a0" }),
  greenhouse: equipmentSet("greenhouse", "botanical", {
    yield: "Cultivar Prism", capacity: "Canopy Stack", speed: "Pollinator Rail", appeal: "Bloomfront Pavilion",
  }, { yield: "#a8cf65", capacity: "#4da67d", speed: "#e7bb4b", appeal: "#e98c87" }),
  mine: equipmentSet("mine", "geologic", {
    yield: "VeinScope Separator", capacity: "Strata Hopper", speed: "GeoPulse Drill", appeal: "Crystal Gallery",
  }, { yield: "#d3a96c", capacity: "#708a91", speed: "#d96c4d", appeal: "#85b8bb" }),
  timberworks: equipmentSet("timberworks", "forestry", {
    yield: "GrainSense Planer", capacity: "Regrowth Rack", speed: "Canopy Sawline", appeal: "Timber Storywall",
  }, { yield: "#d9a45f", capacity: "#6ea15b", speed: "#5b9290", appeal: "#e6c981" }),
  cratemill: equipmentSet("cratemill", "packaging", {
    yield: "FitMark Jig", capacity: "Nesting Crate Tower", speed: "Packflow Roller", appeal: "TradeMark Display",
  }, { yield: "#efb76d", capacity: "#a8754e", speed: "#5eb5b2", appeal: "#e48a68" }),
  workshop: equipmentSet("workshop", "maker", {
    yield: "MercSpec Calibrator", capacity: "Modular Parts Vault", speed: "Gearpath Bench", appeal: "Artisan Showcase",
  }, { yield: "#f19b78", capacity: "#e2bd5f", speed: "#55b6ba", appeal: "#a9cf72" }),
  factory: equipmentSet("factory", "industrial", {
    yield: "Precision Forge", capacity: "Fabrication Cell Array", speed: "Assembly Synchroline", appeal: "Mercedonian Demo Rig",
  }, { yield: "#e78358", capacity: "#728d93", speed: "#e8bd4c", appeal: "#5fb8aa" }),
  construction: equipmentSet("construction", "construction", {
    yield: "Module Survey Table", capacity: "Civic Panel Gantry", speed: "QuickSet Crane", appeal: "Buildfolio Wall",
  }, { yield: "#db8a65", capacity: "#d3b45b", speed: "#5aa8ae", appeal: "#7fac68" }),
  freight: equipmentSet("freight", "logistics", {
    yield: "CargoProof Scanner", capacity: "QuayStack Depot", speed: "RoutePulse Sorter", appeal: "Arrival Board",
  }, { yield: "#d5a467", capacity: "#8a725d", speed: "#56b5be", appeal: "#e3c45a" }),
  shop: equipmentSet("shop", "retail", {
    yield: "Freshness Bench", capacity: "Marketstock Shelves", speed: "QuickServe Counter", appeal: "Lantern Window",
  }, { yield: "#d49bd9", capacity: "#e4b85d", speed: "#68b9a6", appeal: "#f08b76" }),
  restaurant: equipmentSet("restaurant", "culinary", {
    yield: "Flavor Garden Range", capacity: "Hearthline Pantry", speed: "Service Choreographer", appeal: "Sunset Dining Atelier",
  }, { yield: "#e79068", capacity: "#d5ae5b", speed: "#58b5a9", appeal: "#f2bd78" }),
  gym: equipmentSet("gym", "fitness", {
    yield: "FormSense Trainer", capacity: "Circuit Equipment Wall", speed: "Kinetic Recovery Loop", appeal: "Harbor Wellness Grove",
  }, { yield: "#61b4a5", capacity: "#e4b454", speed: "#5ba2c2", appeal: "#8dc975" }),
  cinema: equipmentSet("cinema", "cinematic", {
    yield: "Image & Sound Master", capacity: "Dual Auditorium Rack", speed: "ReelFlow Projector", appeal: "Lantern Marquee Studio",
  }, { yield: "#e2ae52", capacity: "#a979af", speed: "#57a9bd", appeal: "#ed8066" }),
  recycler: equipmentSet("recycler", "circular", {
    yield: "Material Purity Sorter", capacity: "Circular Feedstock Bank", speed: "Loopline Separator", appeal: "Reclaimed Design Gallery",
  }, { yield: "#83ad68", capacity: "#b6965f", speed: "#56ada6", appeal: "#d09a72" }),
};


// ---------------------------------------------------------------- the rooms
//
// Every business used to stand in the same room. Same cream floor, same stone sills,
// same timber rafters, same four glass bays — only the accent colour and one machine
// module told a mine from a cinema. This is the part that makes each trade somewhere,
// not just something: its own palette, and its own floor kit standing around the walls.

export type PropKind =
  | "tanks" | "solar" | "beds" | "orecart" | "logs" | "crates" | "toolwall"
  | "conveyor" | "scaffold" | "pallets" | "shelves" | "diner" | "weights"
  | "seats" | "bins";

/**
 * A silhouette-level architectural identity, not merely a colour theme. Each business
 * owns exactly one of these so that its room can be recognised before a label is read.
 */
export type InteriorArchitecture =
  | "living-water-gallery"
  | "heliostat-atrium"
  | "canopy-biome"
  | "reclaimed-strata-vault"
  | "regrowth-timber-hall"
  | "circular-packhouse"
  | "sawtooth-atelier"
  | "clean-forge-hall"
  | "civic-prefab-studio"
  | "solar-quay-depot"
  | "lantern-market-pavilion"
  | "edible-garden-kitchen"
  | "kinetic-wellness-grove"
  | "lantern-theatre"
  | "materials-loop-lab";

export type InteriorFloorPattern =
  | "water-runnel" | "solar-circuit" | "growing-rows" | "strata-bands" | "timber-grain"
  | "folding-grid" | "maker-sparks" | "assembly-line" | "survey-grid" | "quay-route"
  | "market-petals" | "hearth-ring" | "kinetic-orbit" | "projector-beam" | "circular-loop";

export interface RoomDesign {
  /** Player-facing identity and production story for the companion interface. */
  displayName: string;
  description: string;
  regenerativeSystem: string;
  architecture: InteriorArchitecture;
  floorPattern: InteriorFloorPattern;
  accent: number;
  /** Floor, the walkway strip over it, the low walls, and the roof timbers. */
  floor: number;
  path: number;
  wall: number;
  trim: number;
  /** Glazing tint and the sky behind it — a mine reads cold, a kitchen warm. */
  glass: number;
  sky: number;
  /**
   * How the room is lit.
   *
   * All fifteen interiors shared one hard-coded rig — the same hemisphere, the same warm
   * key, the same cyan window fill — so a mine and a restaurant were the same room in
   * different paint. Colour alone cannot carry a mood; light does most of that work, and
   * it is the cheapest thing in the scene to change.
   *
   * `key` is the sun through the glazing, `bounce` what comes back off the floor, `fill`
   * the cool light from the windows, and `level` the overall exposure — a mine is dim, a
   * greenhouse is flooded.
   */
  light: { key: number; keyStrength: number; bounce: number; fill: number; fillStrength: number; level: number };
}

export const INTERIOR_ROOMS: Record<LicenseKey, RoomDesign> = {
  aquaworks: { displayName: "Living Filtration Gallery", description: "A bright tidal hall where reed beds, pressure loops and clear-water tanks make every litre visible.", regenerativeSystem: "Closed-loop water recovery · living reed filtration", architecture: "living-water-gallery", floorPattern: "water-runnel", accent: 0x45c9cf, floor: 0xbfd3d6, path: 0xa9c4c9, wall: 0x7f9aa1, trim: 0x5d7f88, glass: 0x9cdfe0, sky: 0x123e42,
    light: { key: 0xd6f4ff, keyStrength: 2.4, bounce: 0x2c5a63, fill: 0x8fe6ea, fillStrength: 1.05, level: 1.7 } },
  sungrid: { displayName: "Heliostat Control Atrium", description: "A sun-washed energy hall that turns daylight, storage and distribution into one readable circuit.", regenerativeSystem: "Solar microgrid · second-life battery bank", architecture: "heliostat-atrium", floorPattern: "solar-circuit", accent: 0xf2c94c, floor: 0xd9cfa6, path: 0xcabf90, wall: 0x9a9673, trim: 0x8a6f3c, glass: 0xd8e9a8, sky: 0x2c4a3a,
    light: { key: 0xfff0c2, keyStrength: 3.4, bounce: 0x6a6a3c, fill: 0xffe9a8, fillStrength: 1.15, level: 2.0 } },
  greenhouse: { displayName: "Canopy Biome House", description: "A humid barrel-biome of hydroponic rows, rain capture and pollinator rails under a living glass canopy.", regenerativeSystem: "Rain capture · nutrient recirculation · pollinator habitat", architecture: "canopy-biome", floorPattern: "growing-rows", accent: 0x82bd55, floor: 0xc6bd8c, path: 0xb3ac7c, wall: 0x7f9668, trim: 0x6f5a34, glass: 0xb9e7b0, sky: 0x1d4630,
    light: { key: 0xf4ffd9, keyStrength: 3.2, bounce: 0x3f6a3a, fill: 0xc8f0a8, fillStrength: 1.2, level: 2.1 } },
  mine: { displayName: "Reclaimed Strata Vault", description: "A rock-cut assay chamber where clean electric tools work beside mist collectors and active habitat restoration.", regenerativeSystem: "Dust capture · water mist recovery · moss reclamation", architecture: "reclaimed-strata-vault", floorPattern: "strata-bands", accent: 0xd58d4f, floor: 0x9b9188, path: 0x8b8078, wall: 0x6f6862, trim: 0x4f4a45, glass: 0x9fb2b8, sky: 0x241f1c,
    light: { key: 0xffd9a0, keyStrength: 1.5, bounce: 0x241d18, fill: 0x6d8b96, fillStrength: 0.45, level: 0.95 } },
  timberworks: { displayName: "Regrowth Timber Hall", description: "An open glulam shed joining a solar kiln, provenance wall and seedling nursery to every cut board.", regenerativeSystem: "Solar kiln · seedling replacement ledger · sawdust recovery", architecture: "regrowth-timber-hall", floorPattern: "timber-grain", accent: 0xc8914a, floor: 0xc7a273, path: 0xb69065, wall: 0x8d6c46, trim: 0x6c4f2f, glass: 0xcfe0a8, sky: 0x2a3a24,
    light: { key: 0xffe6b8, keyStrength: 2.7, bounce: 0x5a4028, fill: 0xd2e6a4, fillStrength: 0.8, level: 1.6 } },
  cratemill: { displayName: "Circular Packhouse", description: "A flat-pack line where reusable frames, nesting crates and return bins keep materials moving in a loop.", regenerativeSystem: "Reusable packaging pool · offcut return loop", architecture: "circular-packhouse", floorPattern: "folding-grid", accent: 0xe39a52, floor: 0xcbb187, path: 0xbaa077, wall: 0x8f7550, trim: 0x6f5537, glass: 0xd8dfae, sky: 0x2f3b2a,
    light: { key: 0xffe3ae, keyStrength: 2.6, bounce: 0x5c452a, fill: 0xd8dfae, fillStrength: 0.75, level: 1.55 } },
  workshop: { displayName: "Component Atelier", description: "A sawtooth-lit Mercedonian atelier with an overhead tool rail, repair benches and a reclaimed-parts library.", regenerativeSystem: "Repair-first fabrication · reclaimed component library", architecture: "sawtooth-atelier", floorPattern: "maker-sparks", accent: 0xe98262, floor: 0xc4b596, path: 0xb2a385, wall: 0x84836c, trim: 0x6d5738, glass: 0xc9e3d0, sky: 0x243d3a,
    light: { key: 0xffe1b0, keyStrength: 2.6, bounce: 0x4a4636, fill: 0x9fd8c6, fillStrength: 0.8, level: 1.6 } },
  factory: { displayName: "Clean Forge Hall", description: "A five-bay fabrication floor with compact robotics, daylight clerestories and visible closed-loop cooling.", regenerativeSystem: "Heat recovery · closed-loop coolant · rooftop solar", architecture: "clean-forge-hall", floorPattern: "assembly-line", accent: 0xe7ad45, floor: 0xa9a9a2, path: 0x999992, wall: 0x767a7c, trim: 0x565b5e, glass: 0xa9cfd6, sky: 0x1e2e33,
    light: { key: 0xe8f0ff, keyStrength: 2.5, bounce: 0x33393c, fill: 0x9ec6d6, fillStrength: 0.9, level: 1.45 } },
  construction: { displayName: "Civic Prefab Studio", description: "A design room and assembly bay where district models become low-waste modular building panels.", regenerativeSystem: "Design-for-disassembly · permeable planted work yard", architecture: "civic-prefab-studio", floorPattern: "survey-grid", accent: 0xe5a949, floor: 0xb8ada0, path: 0xa79c90, wall: 0x827a70, trim: 0x64594d, glass: 0xc4d8c0, sky: 0x2b3630,
    light: { key: 0xffeccb, keyStrength: 2.8, bounce: 0x4c463c, fill: 0xb8ccb4, fillStrength: 0.7, level: 1.6 } },
  freight: { displayName: "Solar Quay Depot", description: "A harbour dispatch deck with route intelligence, shore power and compact electric cargo handling.", regenerativeSystem: "Solar shore power · reusable cargo pooling", architecture: "solar-quay-depot", floorPattern: "quay-route", accent: 0x4ab6bd, floor: 0xb0a894, path: 0x9f9784, wall: 0x7c7566, trim: 0x5c5648, glass: 0xb6d2d6, sky: 0x223034,
    light: { key: 0xffeed2, keyStrength: 2.4, bounce: 0x3e3a30, fill: 0xa8c6cc, fillStrength: 0.8, level: 1.45 } },
  shop: { displayName: "Lantern Market Pavilion", description: "A compact produce market and café beneath a leaf-fan canopy, built around refill and return stations.", regenerativeSystem: "Reusable cup loop · local produce cooling · herb wall", architecture: "lantern-market-pavilion", floorPattern: "market-petals", accent: 0xeb7f68, floor: 0xdcc9a8, path: 0xcbb897, wall: 0x9a8367, trim: 0x7a5f42, glass: 0xf0d5b8, sky: 0x3a3026,
    light: { key: 0xfff0d0, keyStrength: 2.9, bounce: 0x6b543a, fill: 0xffdcb4, fillStrength: 1.0, level: 1.85 } },
  restaurant: { displayName: "Edible Garden Kitchen", description: "An open conservatory kitchen where the solar hearth, herb beds and dining garden share one warm room.", regenerativeSystem: "Solar cooking · food-waste compost · rain-chain irrigation", architecture: "edible-garden-kitchen", floorPattern: "hearth-ring", accent: 0xf09a63, floor: 0xd8b58c, path: 0xc7a37b, wall: 0x96694a, trim: 0x74492f, glass: 0xf5cf9a, sky: 0x3d2a1e,
    light: { key: 0xffd9a2, keyStrength: 3.0, bounce: 0x6a3f26, fill: 0xffc98a, fillStrength: 1.05, level: 1.8 } },
  gym: { displayName: "Kinetic Wellness Grove", description: "An airy lotus-rib hall where movement powers the recovery garden and cooling channel.", regenerativeSystem: "Human-powered generation · passive cooling · refill bar", architecture: "kinetic-wellness-grove", floorPattern: "kinetic-orbit", accent: 0x56bba4, floor: 0xa8bfae, path: 0x97ae9d, wall: 0x6f8b7c, trim: 0x50695c, glass: 0xb9e2d4, sky: 0x1c3a33,
    light: { key: 0xeaffef, keyStrength: 2.7, bounce: 0x2f5147, fill: 0xa8e6d2, fillStrength: 1.0, level: 1.75 } },
  cinema: { displayName: "Lantern Theatre", description: "A timber-acoustic screening room and planted foyer crowned by a luminous Mercedonian lantern marquee.", regenerativeSystem: "Low-energy projection · reclaimed acoustic timber", architecture: "lantern-theatre", floorPattern: "projector-beam", accent: 0xe6ad4d, floor: 0x6d6070, path: 0x5f5363, wall: 0x4b4152, trim: 0x352d3b, glass: 0x9a86b4, sky: 0x1a1522,
    light: { key: 0xb49ad8, keyStrength: 1.2, bounce: 0x1a1522, fill: 0x8a72b4, fillStrength: 0.55, level: 0.8 } },
  recycler: { displayName: "Materials Loop Laboratory", description: "A clean recovery lab where sorting bays, sample galleries and feedstock banks close the city material loop.", regenerativeSystem: "Optical sorting · remanufacturing feedstock loop", architecture: "materials-loop-lab", floorPattern: "circular-loop", accent: 0x77b95a, floor: 0xa9b394, path: 0x98a284, wall: 0x74805f, trim: 0x555f43, glass: 0xc0dba8, sky: 0x252f22,
    light: { key: 0xf2ffd6, keyStrength: 2.5, bounce: 0x424a34, fill: 0xbcd8a4, fillStrength: 0.85, level: 1.55 } },
};

type TargetId = UpgradeKey | "exit";

// A bigger floor. The room was 16x12 with four fixed ports and a floor kit filling the
// space between them; now that equipment goes where its owner puts it, the useful thing is
// open ground to put it on. 22x16 is enough that a full grid of machines and fittings
// still leaves room to walk between them.
export const ROOM_HALF_WIDTH = 11;
export const ROOM_HALF_DEPTH = 8;
const PLAYER_RADIUS = 0.38;
const WALK_SPEED = 4.25;

/** Match the open world's +Z-forward actor convention. */
export function interiorAvatarYaw(directionX: number, directionZ: number): number {
  return headingYaw(directionX, directionZ);
}

/** Damp a yaw over the shortest arc, including across the -PI/PI seam. */
export function dampInteriorAvatarYaw(current: number, target: number, delta: number): number {
  return dampWrappedYaw(current, target, delta, 12);
}
const STATION_RANGE = 2.05;
const EXIT_RANGE = 1.65;

export const STATIONS: readonly StationDefinition[] = [
  {
    key: "yield",
    label: "Production Quality",
    shortLabel: "Quality Lab",
    icon: "⚒",
    detail: "Tune growing, fabrication and service systems for better output.",
    position: [-5.3, -3.35],
  },
  {
    key: "capacity",
    label: "Operating Capacity",
    shortLabel: "Capacity Bay",
    icon: "▦",
    detail: "Expand storage and parallel work cells to complete more each cycle.",
    position: [5.3, -3.35],
  },
  {
    key: "speed",
    label: "Automation & Flow",
    shortLabel: "Flow Console",
    icon: "ϟ",
    detail: "Coordinate tools, routes and renewable power for shorter jobs.",
    position: [-5.3, 1.05],
  },
  {
    key: "appeal",
    label: "Customer Appeal",
    shortLabel: "Welcome Studio",
    icon: "✦",
    detail: "Improve presentation and comfort to strengthen Mercedonian demand.",
    position: [5.3, 1.05],
  },
] as const;

const MOVEMENT_KEYS = new Set(["w", "a", "s", "d", "arrowup", "arrowleft", "arrowdown", "arrowright"]);

const clampLevel = (value: number, ceiling: number): number =>
  Math.min(ceiling, Math.max(0, Number.isFinite(value) ? Math.floor(value) : 0));

const disposeObject = (root: THREE.Object3D): void => {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) && !(object instanceof THREE.Sprite) && !(object instanceof THREE.LineSegments)) return;
    if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) object.geometry.dispose();
    const material = object.material;
    const materials = Array.isArray(material) ? material : [material];
    for (const entry of materials) entry.dispose();
  });
};

/**
 * A small, self-contained Three.js room used while a player manages a business.
 * It owns its renderer and input listeners, but never mutates game economy state.
 */
export class InteriorWorld {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-9, 9, 7, -7, 0.1, 80);

  private readonly canvas: HTMLCanvasElement;
  private readonly callbacks: InteriorWorldCallbacks;
  private readonly clock = new THREE.Clock(false);
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly keys = new Set<string>();
  private readonly stations = new Map<UpgradeKey, InteriorStation>();
  private readonly interactiveObjects: THREE.Object3D[] = [];
  private readonly textures = new Set<THREE.Texture>();
  private readonly player = new THREE.Group();
  private playerFallback: THREE.Group | null = null;
  private readonly cameraLookAt = new THREE.Vector3(0, 0.85, -0.5);

  /**
   * Where the camera sits, in polar terms around the room's centre.
   *
   * The interior was one fixed isometric angle, which meant half of every machine faced
   * away from the player permanently — you could buy a piece of equipment and never see
   * the side the detail was on. Orbit makes the room a place you can look around rather
   * than a diorama photographed once.
   *
   * Pitch is clamped well clear of both poles: overhead loses the silhouette that tells
   * one machine from another, and ground level puts the floor across the whole frame.
   */
  private cameraYaw = Math.atan2(10.5, 15.5);
  private cameraPitch = 0.72;
  private cameraZoom = 1;
  private static readonly PITCH_MIN = 0.28;
  private static readonly PITCH_MAX = 1.24;
  private static readonly ZOOM_MIN = 0.62;
  private static readonly ZOOM_MAX = 1.9;
  /** A drag past this many pixels is a look, not a click. */
  private static readonly DRAG_SLOP = 6;
  private dragging: { id: number; x: number; y: number; moved: boolean } | null = null;

  /**
   * The machine currently being carried, if any.
   *
   * Placement takes over the pointer entirely: while something is in hand a drag moves the
   * ghost rather than the camera, because a player aiming a machine at a tile and having
   * the room swing away instead would be fighting the controls at the exact moment
   * precision matters.
   */
  private carrying: { kind: "station" | "fitting"; key: string } | null = null;
  private ghost: THREE.Group | null = null;
  private ghostTile: { column: number; row: number } | null = null;
  private gridHelper: THREE.Group | null = null;
  private tiles: Record<string, { column: number; row: number }> = {};
  private fittingTiles: Partial<Record<FittingKey, { column: number; row: number } | null>> = {};
  private readonly fittingRoots = new Map<FittingKey, THREE.Group>();
  private onPlace: ((key: string, column: number, row: number, kind: "station" | "fitting") => boolean) | null = null;
  private pinchDistance = 0;
  private readonly activePointers = new Map<number, { x: number; y: number }>();
  private readonly obstacles: Array<{ x: number; z: number; radius: number }> = [];
  private readonly ambientObjects: Array<{
    object: THREE.Object3D;
    motion: "spin-x" | "spin-y" | "spin-z" | "pulse" | "float";
    speed: number;
    originY: number;
  }> = [];
  /** Flat colours shared across the floor kit, so a room is a handful of materials. */
  private readonly propMaterials = new Map<string, THREE.MeshStandardMaterial>();

  private content = new THREE.Group();
  private floor: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial> | null = null;
  private exitApproach = new THREE.Vector3(0, 0, -4.25);
  private exitHalo: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial> | null = null;
  private business: BusinessConfig | null = null;
  private license: LicenseKey = "workshop";
  private upgrades: Record<UpgradeKey, number> = { yield: 0, capacity: 0, speed: 0, appeal: 0 };
  private upgradeCeiling = 3;
  private active = false;
  private disposed = false;
  private animationFrame = 0;
  private moveTarget: THREE.Vector3 | null = null;
  private chosenTarget: TargetId | null = null;
  private hoverTarget: TargetId | null = null;
  private selectionSignature = "";
  private promptSignature = "";
  private elapsed = 0;
  private lastMoveReport = new THREE.Vector3(Number.NaN, 0, Number.NaN);
  private playerMixer: THREE.AnimationMixer | null = null;
  private playerIdleAction: THREE.AnimationAction | null = null;
  private playerWalkAction: THREE.AnimationAction | null = null;
  private playerWalking = false;

  private readonly previousCanvasState: {
    tabIndex: string | null;
    role: string | null;
    ariaLabel: string | null;
    touchAction: string;
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.active || this.isTextInput(event.target)) return;
    const key = event.key.toLowerCase();
    if (MOVEMENT_KEYS.has(key)) {
      event.preventDefault();
      this.keys.add(key);
      this.moveTarget = null;
      return;
    }
    if (key === "e" && !event.repeat) {
      event.preventDefault();
      this.interact();
    } else if (key === "escape" && !event.repeat) {
      event.preventDefault();
      this.requestExit();
    }
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.key.toLowerCase());
  };

  private readonly onBlur = (): void => {
    this.keys.clear();
  };

  // ---------------------------------------------------------------------
  // Laying out the floor
  // ---------------------------------------------------------------------

  /** Pick a machine up. Shows the grid and a ghost that follows the cursor. */
  beginPlacement(key: string, kind: "station" | "fitting" = "station"): void {
    if (!this.active) return;
    this.carrying = { kind, key };
    this.ghostTile = this.tiles[key] ?? DEFAULT_EQUIPMENT_TILES[key] ?? { column: 1, row: 1 };
    this.showGrid(true);
    this.buildGhost(kind);
    this.updateGhost();
    this.canvas.style.cursor = "grabbing";
  }

  /** Put it down, wherever the ghost is. The store has the final say. */
  endPlacement(commit: boolean): void {
    const held = this.carrying;
    const tile = this.ghostTile;
    this.carrying = null;
    this.showGrid(false);
    this.clearGhost();
    this.canvas.style.cursor = "grab";
    if (!commit || !held || !tile) return;
    // The store owns the rules — the walkway, what is already on a tile. A refusal here
    // simply leaves the machine where it was.
    if (this.onPlace?.(held.key, tile.column, tile.row, held.kind)) {
      if (held.kind === "station") {
        this.tiles = { ...this.tiles, [held.key]: tile };
        this.layoutStations();
      } else {
        this.fittingTiles = { ...this.fittingTiles, [held.key as FittingKey]: tile };
        this.layoutFittings();
      }
      this.rebuildObstacles();
    }
  }

  get isPlacing(): boolean { return this.carrying !== null; }

  /**
   * Build the six fittings, once, and park them where their owner left them.
   *
   * These were bought and paid for (240-360 $MM each) and then never drawn. `buildInterior`
   * raised four stations and stopped; `endPlacement` only re-laid the floor when the thing in
   * hand was a station. So a maker dragged a green box onto a tile, released it, the store
   * took the money — and the room stayed empty, for good. The comment above the stations even
   * promised "whatever fittings they have bought and placed beside them" while nothing in this
   * file could draw one.
   *
   * Each is its own shape rather than a generic crate: the whole point of the adjacency rule is
   * that you can look at the floor and see which machine a thing is feeding.
   */
  private createFittings(timber: THREE.Material): void {
    this.fittingRoots.clear();
    const design = INTERIOR_ROOMS[this.license];
    const accent = new THREE.MeshStandardMaterial({ color: design.accent, roughness: 0.42, metalness: 0.22 });
    const dark = new THREE.MeshStandardMaterial({ color: design.trim, roughness: 0.66, metalness: 0.18 });
    const glass = new THREE.MeshStandardMaterial({
      color: design.glass, roughness: 0.16, metalness: 0.05, transparent: true, opacity: 0.62,
    });

    const add = (root: THREE.Group, geo: THREE.BufferGeometry, mat: THREE.Material,
                 pos: [number, number, number], rot?: [number, number, number]): THREE.Mesh => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(...pos);
      if (rot) mesh.rotation.set(...rot);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      root.add(mesh);
      return mesh;
    };

    for (const key of Object.keys(FITTINGS) as FittingKey[]) {
      const root = new THREE.Group();
      root.name = `fitting-${key}`;
      switch (key) {
        case "hopper": {   // a funnel on legs, mouth up: it feeds the line
          add(root, new THREE.CylinderGeometry(0.34, 0.1, 0.46, 10, 1, true), accent, [0, 0.62, 0]);
          add(root, new THREE.CylinderGeometry(0.11, 0.11, 0.3, 8), dark, [0, 0.24, 0]);
          for (const [x, z] of [[-0.22, -0.22], [0.22, -0.22], [-0.22, 0.22], [0.22, 0.22]]) {
            add(root, new THREE.CylinderGeometry(0.032, 0.032, 0.4, 6), dark, [x, 0.2, z]);
          }
          break;
        }
        case "kiln": {     // a squat drum with a glowing door
          add(root, new THREE.CylinderGeometry(0.36, 0.38, 0.62, 12), dark, [0, 0.31, 0]);
          add(root, new THREE.CircleGeometry(0.2, 12), accent, [0, 0.34, 0.385], [0, 0, 0]);
          add(root, new THREE.CylinderGeometry(0.06, 0.06, 0.5, 6), dark, [0.2, 0.87, -0.16]);
          break;
        }
        case "governor": { // a spinning regulator on a post
          add(root, new THREE.CylinderGeometry(0.09, 0.12, 0.66, 8), dark, [0, 0.33, 0]);
          add(root, new THREE.SphereGeometry(0.13, 10, 8), accent, [0, 0.74, 0]);
          for (const sign of [-1, 1]) {
            add(root, new THREE.SphereGeometry(0.075, 8, 6), accent, [0.22 * sign, 0.62, 0]);
            add(root, new THREE.CylinderGeometry(0.022, 0.022, 0.3, 5), dark,
                [0.11 * sign, 0.68, 0], [0, 0, sign * 0.72]);
          }
          break;
        }
        case "sorter": {   // an inclined belt over a pair of bins
          add(root, new THREE.BoxGeometry(0.78, 0.07, 0.3), dark, [0, 0.56, 0], [0, 0, 0.22]);
          for (const sign of [-1, 1]) add(root, new THREE.BoxGeometry(0.28, 0.26, 0.28), accent, [0.24 * sign, 0.13, 0]);
          add(root, new THREE.CylinderGeometry(0.05, 0.05, 0.34, 8), dark, [-0.36, 0.36, 0], [Math.PI / 2, 0, 0]);
          break;
        }
        case "rack": {     // open shelving, the thing that holds finished goods
          for (const y of [0.2, 0.46, 0.72]) add(root, new THREE.BoxGeometry(0.74, 0.045, 0.36), timber, [0, y, 0]);
          for (const [x, z] of [[-0.34, -0.16], [0.34, -0.16], [-0.34, 0.16], [0.34, 0.16]]) {
            add(root, new THREE.BoxGeometry(0.05, 0.78, 0.05), dark, [x, 0.39, z]);
          }
          add(root, new THREE.BoxGeometry(0.2, 0.16, 0.22), accent, [-0.16, 0.55, 0]);
          break;
        }
        case "counter": {  // a serving counter with a glass front: this one faces customers
          add(root, new THREE.BoxGeometry(0.86, 0.5, 0.42), timber, [0, 0.25, 0]);
          add(root, new THREE.BoxGeometry(0.88, 0.06, 0.46), accent, [0, 0.53, 0]);
          add(root, new THREE.BoxGeometry(0.8, 0.26, 0.03), glass, [0, 0.7, 0.2]);
          for (const sign of [-1, 1]) add(root, new THREE.CylinderGeometry(0.02, 0.02, 0.24, 5), dark, [0.38 * sign, 0.68, 0.2]);
          break;
        }
      }
      root.visible = false;
      this.content.add(root);
      this.fittingRoots.set(key, root);
    }
    this.layoutFittings();
  }

  /** Show the fittings that have been bought, on the tiles they were put on. */
  private layoutFittings(): void {
    for (const [key, root] of this.fittingRoots) {
      const tile = this.fittingTiles[key] ?? null;
      if (!tile) { root.visible = false; continue; }
      const world = tileToWorld(tile.column, tile.row);
      root.position.set(world.x, 0, world.z);
      // Turned to face the walkway, so a row of fittings reads as a line of work rather than
      // six objects that happen to share a floor.
      root.rotation.y = world.x > 0 ? -Math.PI / 2 : Math.PI / 2;
      root.visible = true;
    }
  }

  /**
   * Rebuild the walk-blockers from where things ACTUALLY stand.
   *
   * `createStation` pushed a collider at the authored constant and `layoutStations` then moved
   * the machine without touching it, so every collider sat 2-3 units from its own machine:
   * four invisible pillars mid-floor, and four machines you could walk straight through.
   */
  private rebuildObstacles(): void {
    this.obstacles.length = 0;
    for (const key of this.stations.keys()) {
      const tile = this.tiles[key] ?? DEFAULT_EQUIPMENT_TILES[key as UpgradeKey];
      if (!tile) continue;
      const world = tileToWorld(tile.column, tile.row);
      this.obstacles.push({ x: world.x, z: world.z, radius: 0.92 });
    }
    for (const tile of Object.values(this.fittingTiles)) {
      if (!tile) continue;
      const world = tileToWorld(tile.column, tile.row);
      this.obstacles.push({ x: world.x, z: world.z, radius: 0.55 });
    }
  }

  /** Move every station to the tile its owner put it on. */
  private layoutStations(): void {
    for (const [key, station] of this.stations) {
      const tile = this.tiles[key] ?? DEFAULT_EQUIPMENT_TILES[key];
      if (!tile) continue;
      const world = tileToWorld(tile.column, tile.row);
      station.root.position.set(world.x, 0, world.z);
      // The approach is where a Mercedonian stands to use it: one tile toward the centre
      // walkway, so it is always reachable no matter where the machine was put.
      const toCentre = new THREE.Vector3(-world.x, 0, -world.z).normalize();
      station.approach.set(world.x, 0, world.z).addScaledVector(toCentre, 1.55);
    }
  }

  /** The tile grid, drawn only while something is in hand. */
  private showGrid(visible: boolean): void {
    if (visible && !this.gridHelper) {
      const group = new THREE.Group();
      const line = new THREE.MeshBasicMaterial({ color: 0x8ecb69, transparent: true, opacity: 0.24, depthWrite: false });
      const blocked = new THREE.MeshBasicMaterial({ color: 0xb0503a, transparent: true, opacity: 0.16, depthWrite: false });
      for (let row = 0; row < FLOOR_ROWS; row += 1) {
        for (let column = 0; column < FLOOR_COLUMNS; column += 1) {
          const world = tileToWorld(column, row);
          const pad = new THREE.Mesh(
            new THREE.PlaneGeometry(FLOOR_TILE * 0.9, FLOOR_TILE * 0.9),
            tileIsBuildable(column, row) ? line : blocked,
          );
          pad.rotation.x = -Math.PI / 2;
          pad.position.set(world.x, 0.03, world.z);
          group.add(pad);
        }
      }
      this.gridHelper = group;
      this.content.add(group);
    }
    if (this.gridHelper) this.gridHelper.visible = visible;
  }

  /** A translucent stand-in for the machine being carried. */
  private buildGhost(kind: "station" | "fitting"): void {
    this.clearGhost();
    const group = new THREE.Group();
    const size = kind === "fitting" ? 0.8 : 1.15;
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(size, kind === "fitting" ? 0.9 : 1.5, size),
      new THREE.MeshBasicMaterial({ color: 0x8ecb69, transparent: true, opacity: 0.42, depthWrite: false }),
    );
    body.position.y = kind === "fitting" ? 0.45 : 0.75;
    group.add(body);
    this.ghost = group;
    this.content.add(group);
  }

  private clearGhost(): void {
    if (!this.ghost) return;
    this.content.remove(this.ghost);
    this.ghost.traverse((node) => {
      if (node instanceof THREE.Mesh) node.geometry.dispose();
    });
    this.ghost = null;
  }

  /** Snap the ghost to its tile and colour it by whether the drop would be allowed. */
  private updateGhost(): void {
    if (!this.ghost || !this.ghostTile || !this.carrying) return;
    const { column, row } = this.ghostTile;
    const world = tileToWorld(column, row);
    this.ghost.position.set(world.x, 0, world.z);
    const held = this.carrying;
    // Fittings count as occupancy too. This only consulted `this.tiles` — stations — so the
    // ghost glowed green over a tile that already held a fitting and the store then refused
    // the drop, which reads to a player as the game randomly rejecting a legal move.
    const stationClash = Object.entries(this.tiles)
      .some(([key, tile]) => !(held.kind === "station" && key === held.key)
        && tile.column === column && tile.row === row);
    const fittingClash = Object.entries(this.fittingTiles)
      .some(([key, tile]) => !!tile && !(held.kind === "fitting" && key === held.key)
        && tile.column === column && tile.row === row);
    const occupied = stationClash || fittingClash;
    const allowed = tileIsBuildable(column, row) && !occupied;
    this.ghost.traverse((node) => {
      if (node instanceof THREE.Mesh && node.material instanceof THREE.MeshBasicMaterial) {
        node.material.color.set(allowed ? 0x8ecb69 : 0xb0503a);
      }
    });
  }

  /** Aim the ghost at whatever tile the pointer is over. */
  private aimGhost(): void {
    if (!this.floor || !this.carrying) return;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObject(this.floor, false)[0];
    if (!hit) return;
    this.ghostTile = worldToTile(hit.point.x, hit.point.z);
    this.updateGhost();
  }

  /** Place the camera from yaw, pitch and zoom, keeping the room's centre framed. */
  private applyCameraOrbit(): void {
    const radius = 21.5;
    const horizontal = Math.cos(this.cameraPitch) * radius;
    this.camera.position.set(
      this.cameraLookAt.x + Math.sin(this.cameraYaw) * horizontal,
      this.cameraLookAt.y + Math.sin(this.cameraPitch) * radius,
      this.cameraLookAt.z + Math.cos(this.cameraYaw) * horizontal,
    );
    this.camera.lookAt(this.cameraLookAt);
  }

  /** Re-frame for the current canvas size and zoom. Does not touch the renderer. */
  private applyCameraProjection(width: number, height: number): void {
    const ratio = width / height;
    let viewHeight = 13.4 * this.cameraZoom;
    let viewWidth = viewHeight * ratio;
    const minWidth = 18.2 * this.cameraZoom;
    if (viewWidth < minWidth) {
      viewWidth = minWidth;
      viewHeight = viewWidth / ratio;
    }
    this.camera.left = -viewWidth / 2;
    this.camera.right = viewWidth / 2;
    this.camera.top = viewHeight / 2;
    this.camera.bottom = -viewHeight / 2;
    this.camera.updateProjectionMatrix();
  }

  /** Orbit by a drag, in pixels. */
  private orbitBy(dx: number, dy: number): void {
    this.cameraYaw -= dx * 0.006;
    this.cameraPitch = Math.min(InteriorWorld.PITCH_MAX,
      Math.max(InteriorWorld.PITCH_MIN, this.cameraPitch + dy * 0.005));
    this.applyCameraOrbit();
  }

  /** Zoom by a factor. Orthographic, so this scales the view box rather than moving in. */
  private zoomBy(factor: number): void {
    this.cameraZoom = Math.min(InteriorWorld.ZOOM_MAX,
      Math.max(InteriorWorld.ZOOM_MIN, this.cameraZoom * factor));
    this.applyCameraProjection(this.canvas.clientWidth || 1, this.canvas.clientHeight || 1);
  }

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (!this.active) return;

    if (this.activePointers.has(event.pointerId)) {
      this.activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }

    if (this.carrying) {
      this.setPointer(event);
      this.aimGhost();
      return;
    }

    // Pinch beats everything else while two fingers are down.
    if (this.activePointers.size === 2) {
      const [a, b] = [...this.activePointers.values()];
      const spread = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      if (this.pinchDistance > 0 && spread > 0) this.zoomBy(this.pinchDistance / spread);
      this.pinchDistance = spread;
      return;
    }

    const drag = this.dragging;
    if (drag && drag.id === event.pointerId) {
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < InteriorWorld.DRAG_SLOP) return;
      drag.moved = true;
      drag.x = event.clientX;
      drag.y = event.clientY;
      this.orbitBy(dx, dy);
      this.canvas.style.cursor = "grabbing";
      return;
    }

    this.setPointer(event);
    const target = this.pickTarget();
    this.hoverTarget = target;
    this.canvas.style.cursor = target ? "pointer" : "crosshair";
    this.refreshSelection();
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    this.activePointers.delete(event.pointerId);
    if (this.carrying) {
      this.canvas.releasePointerCapture?.(event.pointerId);
      this.endPlacement(true);
      return;
    }
    if (this.activePointers.size < 2) this.pinchDistance = 0;
    this.canvas.releasePointerCapture?.(event.pointerId);

    const drag = this.dragging;
    this.dragging = null;
    if (!this.active || !drag || drag.id !== event.pointerId) return;
    this.canvas.style.cursor = "grab";
    // A press that never travelled is a click: walk there, or select what was under it.
    if (!drag.moved) this.commitClick(event);
  };

  private readonly onWheel = (event: WheelEvent): void => {
    if (!this.active) return;
    event.preventDefault();
    this.zoomBy(event.deltaY > 0 ? 1.1 : 1 / 1.1);
  };

  private readonly onPointerLeave = (): void => {
    this.hoverTarget = null;
    this.canvas.style.cursor = "default";
    this.refreshSelection();
  };

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (!this.active || event.button > 0) return;
    event.preventDefault();
    this.canvas.focus({ preventScroll: true });
    this.canvas.setPointerCapture?.(event.pointerId);
    this.activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    // Carrying a machine takes the pointer over completely: a player aiming at a tile who
    // instead swung the camera would be fighting the controls at the one moment precision
    // matters. Press to aim, release to drop.
    if (this.carrying) {
      this.setPointer(event);
      this.aimGhost();
      return;
    }

    // Two fingers is a pinch, never a walk.
    if (this.activePointers.size === 2) {
      const [a, b] = [...this.activePointers.values()];
      this.pinchDistance = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      this.dragging = null;
      return;
    }

    // One pointer is AMBIGUOUS until it moves: a press that stays put is a click on the
    // floor or a station, and a press that travels is a look around the room. Deciding at
    // pointerup rather than pointerdown is what lets both live on the same button.
    this.dragging = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
  };

  /** The click half of a press, run only once we know it was not a drag. */
  private commitClick(event: PointerEvent): void {
    this.setPointer(event);
    const target = this.pickTarget();
    if (target) {
      this.chosenTarget = target;
      this.moveTarget = target === "exit"
        ? this.exitApproach.clone()
        : this.stations.get(target)?.approach.clone() ?? null;
      this.refreshSelection();
      return;
    }
    if (!this.floor) return;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const floorHit = this.raycaster.intersectObject(this.floor, false)[0];
    if (!floorHit) return;
    const point = floorHit.point;
    point.x = THREE.MathUtils.clamp(point.x, -ROOM_HALF_WIDTH + 0.65, ROOM_HALF_WIDTH - 0.65);
    point.z = THREE.MathUtils.clamp(point.z, -ROOM_HALF_DEPTH + 0.75, ROOM_HALF_DEPTH - 0.65);
    point.y = 0;
    this.moveTarget = point;
    this.chosenTarget = null;
    this.refreshSelection();
  };

  constructor(canvas: HTMLCanvasElement, callbacks: InteriorWorldCallbacks = {}) {
    this.canvas = canvas;
    this.callbacks = callbacks;
    this.previousCanvasState = {
      tabIndex: canvas.getAttribute("tabindex"),
      role: canvas.getAttribute("role"),
      ariaLabel: canvas.getAttribute("aria-label"),
      touchAction: canvas.style.touchAction,
    };

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: "low-power",
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.AgXToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    const coarsePointer = typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
    this.renderer.shadowMap.enabled = (navigator.hardwareConcurrency ?? 4) >= 6 && !coarsePointer;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setClearColor(0x123e42, 1);

    canvas.tabIndex = canvas.tabIndex < 0 ? 0 : canvas.tabIndex;
    canvas.setAttribute("role", "application");
    canvas.setAttribute(
      "aria-label",
      "Business interior. Move with W A S D or arrow keys, click the floor to walk, drag to look around, "
      + "scroll or pinch to zoom, press E near equipment to interact, and Escape to leave.",
    );
    canvas.style.touchAction = "none";

    this.scene.background = new THREE.Color(0x123e42);
    this.scene.fog = new THREE.Fog(0xcde9d6, 18, 36);
    this.applyCameraOrbit();

    this.setupLighting();
    this.setupPlayer();
    this.scene.add(this.content);
    this.setupInput();
    this.resize();
  }

  get isActive(): boolean {
    return this.active;
  }

  enter(options: InteriorEnterOptions): void {
    if (this.disposed) return;
    // Every room opens from the same angle. Inheriting the last room's rotation would mean
    // walking into a greenhouse already facing its back wall.
    this.cameraYaw = Math.atan2(10.5, 15.5);
    this.cameraPitch = 0.72;
    this.cameraZoom = 1;
    this.dragging = null;
    this.activePointers.clear();
    this.pinchDistance = 0;
    this.carrying = null;
    this.clearGhost();
    this.showGrid(false);
    this.tiles = { ...DEFAULT_EQUIPMENT_TILES, ...(options.tiles ?? {}) };
    this.fittingTiles = { ...(options.fittings ?? {}) };
    this.onPlace = options.onPlace ?? null;
    this.applyCameraOrbit();
    this.business = options.business;
    this.license = options.license ?? (Object.keys(BUSINESS) as LicenseKey[]).find((key) =>
      BUSINESS[key] === options.business || BUSINESS[key].name === options.business.name,
    ) ?? "workshop";
    this.upgradeCeiling = THREE.MathUtils.clamp(Math.floor(options.upgradeCeiling), 1, MAX_UPGRADE_LEVEL);
    this.upgrades = this.normaliseLevels(options.upgrades);
    this.player.position.set(0, 0, 3.85);
    // The shared Mercedonian is local +Z-forward, so PI faces into the room (-Z).
    this.player.rotation.y = Math.PI;
    this.lastMoveReport.copy(this.player.position);
    this.moveTarget = null;
    this.chosenTarget = null;
    this.hoverTarget = null;
    this.buildInterior();
    this.setActive(true);
    this.canvas.focus({ preventScroll: true });
  }

  /** Pause or resume this room without disposing its GPU resources. */
  setActive(active: boolean): void {
    if (this.disposed || this.active === active) return;
    this.active = active;
    this.keys.clear();
    this.moveTarget = null;
    if (active) {
      this.resize();
      // ...and again once layout has settled, on a TIMER rather than a frame.
      //
      // resize() reads the canvas's laid-out size, and the panel animates in, so the call
      // above can land while the canvas is still zero-width and pin the drawing buffer at
      // 1x1. The self-heal in animate() cannot rescue that if requestAnimationFrame is
      // throttled — which is exactly what a browser does to a hidden or backgrounded tab,
      // and a player who opens a business and switches tabs while it loads would come back
      // to a one-pixel room that never repairs itself. setTimeout keeps running when rAF
      // does not, so this is the path that always fires.
      window.setTimeout(() => { if (this.active && !this.disposed) this.resize(); }, 60);
      window.setTimeout(() => { if (this.active && !this.disposed) this.resize(); }, 320);
      this.clock.start();
      // Whatever the room author laid out, the OWNER's arrangement wins.
      this.layoutStations();
      this.refreshSelection(true);
      this.animationFrame = requestAnimationFrame(this.animate);
    } else {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = 0;
      this.clock.stop();
      this.canvas.style.cursor = "default";
      this.emitClearedSelection();
    }
  }

  /** Leave silently; door/Escape actions additionally invoke onExit. */
  exit(): void {
    this.setActive(false);
    this.chosenTarget = null;
    this.hoverTarget = null;
  }

  updateUpgradeLevels(levels: Record<UpgradeKey, number>, ceiling = this.upgradeCeiling): void {
    const nextCeiling = THREE.MathUtils.clamp(Math.floor(ceiling), 1, MAX_UPGRADE_LEVEL);
    const ceilingChanged = nextCeiling !== this.upgradeCeiling;
    this.upgradeCeiling = nextCeiling;
    this.upgrades = this.normaliseLevels(levels);
    if (ceilingChanged && this.business) this.buildInterior();
    else for (const station of this.stations.values()) this.updateStationVisual(station);
    this.refreshSelection(true);
  }

  /** Lets an accessible companion control choose the same targets as the 3D scene. */
  focusTarget(target: TargetId): void {
    if (!this.active) return;
    this.chosenTarget = target;
    this.moveTarget = target === "exit"
      ? this.exitApproach.clone()
      : this.stations.get(target)?.approach.clone() ?? null;
    this.refreshSelection(true);
  }

  /** Direct movement hook for an on-screen d-pad; release every pressed direction on pointer-up. */
  setMoveInput(direction: InteriorMoveDirection, pressed: boolean): void {
    const key: Record<InteriorMoveDirection, string> = {
      forward: "w",
      backward: "s",
      left: "a",
      right: "d",
    };
    if (pressed && this.active) {
      this.keys.add(key[direction]);
      this.moveTarget = null;
    } else {
      this.keys.delete(key[direction]);
    }
  }

  /** Performs the currently available E-key action. */
  interact(): void {
    if (!this.active) return;
    const selection = this.resolveSelection();
    if (!selection || !selection.nearby) return;
    if (selection.kind === "exit") {
      this.requestExit();
      return;
    }
    if (selection.level >= selection.ceiling) return;
    this.callbacks.onInteract?.(selection.key);
  }

  resize(width?: number, height?: number, pixelRatio?: number): void {
    if (this.disposed) return;
    const nextWidth = Math.max(1, Math.floor(width ?? this.canvas.clientWidth ?? this.canvas.width));
    const nextHeight = Math.max(1, Math.floor(height ?? this.canvas.clientHeight ?? this.canvas.height));
    this.applyCameraProjection(nextWidth, nextHeight);
    const compactViewport = nextWidth < 900 || nextHeight < 620
      || (typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches);
    this.renderer.setPixelRatio(pixelRatio ?? Math.min(window.devicePixelRatio || 1, compactViewport ? 1.2 : 1.6));
    this.renderer.setSize(nextWidth, nextHeight, false);
  }

  dispose(): void {
    if (this.disposed) return;
    this.setActive(false);
    this.disposed = true;
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerleave", this.onPointerLeave);
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointerup", this.onPointerUp);
    this.canvas.removeEventListener("pointercancel", this.onPointerUp);
    this.canvas.removeEventListener("wheel", this.onWheel);
    disposeObject(this.content);
    disposeObject(this.player);
    for (const texture of this.textures) texture.dispose();
    this.textures.clear();
    this.renderer.dispose();
    this.restoreCanvasState();
  }

  private readonly animate = (): void => {
    if (!this.active || this.disposed) return;
    // Self-heal the drawing buffer.
    //
    // resize() reads the canvas's laid-out size, and the interior panel animates in — so
    // the first call can land while the canvas is still zero-width and pin the buffer at
    // 1x1 forever. The ResizeObserver does not save it either: it is gated on the panel
    // being open, so an early fire is a no-op and the stage never changes size again.
    // Checking here costs two property reads a frame and cannot be raced.
    const wantWidth = this.canvas.clientWidth;
    const wantHeight = this.canvas.clientHeight;
    if (wantWidth > 1 && wantHeight > 1
      && (this.canvas.width !== Math.floor(wantWidth * this.renderer.getPixelRatio())
        || this.canvas.height !== Math.floor(wantHeight * this.renderer.getPixelRatio()))) {
      this.resize(wantWidth, wantHeight);
    }
    const delta = Math.min(0.05, this.clock.getDelta());
    this.elapsed += delta;
    this.updateMovement(delta);
    this.animateRoom();
    this.refreshSelection();
    this.renderer.resetState();
    this.renderer.render(this.scene, this.camera);
    this.animationFrame = requestAnimationFrame(this.animate);
  };

  private setupInput(): void {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
    this.canvas.addEventListener("pointermove", this.onPointerMove);
    this.canvas.addEventListener("pointerleave", this.onPointerLeave);
    this.canvas.addEventListener("pointerdown", this.onPointerDown);
    this.canvas.addEventListener("pointerup", this.onPointerUp);
    this.canvas.addEventListener("pointercancel", this.onPointerUp);
    this.canvas.addEventListener("wheel", this.onWheel, { passive: false });
  }

  /**
   * The rig, built once. Its COLOURS are set per trade in applyLighting.
   *
   * This ran in the constructor with a "workshop" fallback and never again, so every
   * interior in the game was lit as a workshop no matter which trade's room had been
   * built around it — the mine had the mine's floor, props and palette under a workshop's
   * warm key light. buildInterior already rebuilds the room per trade; the lights simply
   * were not part of it.
   */
  private hemisphere: THREE.HemisphereLight | null = null;
  private keyLight: THREE.DirectionalLight | null = null;
  private fillLight: THREE.DirectionalLight | null = null;

  private setupLighting(): void {
    const mood = INTERIOR_ROOMS[this.license].light;
    this.hemisphere = new THREE.HemisphereLight(mood.key, mood.bounce, mood.level);
    this.scene.add(this.hemisphere);
    const sun = new THREE.DirectionalLight(mood.key, mood.keyStrength);
    this.keyLight = sun;
    sun.position.set(-8, 15, 10);
    sun.castShadow = this.renderer.shadowMap.enabled;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -11;
    sun.shadow.camera.right = 11;
    sun.shadow.camera.top = 10;
    sun.shadow.camera.bottom = -10;
    sun.shadow.camera.near = 3;
    sun.shadow.camera.far = 35;
    sun.shadow.bias = -0.0004;
    this.scene.add(sun);
    const windowFill = new THREE.DirectionalLight(mood.fill, mood.fillStrength);
    this.fillLight = windowFill;
    windowFill.position.set(12, 7, -8);
    this.scene.add(windowFill);
  }

  /** Re-tint the rig for whichever trade's room is being built. */
  private applyLighting(): void {
    const mood = INTERIOR_ROOMS[this.license].light;
    this.hemisphere?.color.setHex(mood.key);
    if (this.hemisphere) { this.hemisphere.groundColor.setHex(mood.bounce); this.hemisphere.intensity = mood.level; }
    if (this.keyLight) { this.keyLight.color.setHex(mood.key); this.keyLight.intensity = mood.keyStrength; }
    if (this.fillLight) { this.fillLight.color.setHex(mood.fill); this.fillLight.intensity = mood.fillStrength; }
  }

  private setupPlayer(): void {
    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.48, 20),
      new THREE.MeshBasicMaterial({ color: 0x123f3d, transparent: true, opacity: 0.24, depthWrite: false }),
    );
    shadow.name = "interior-player-shadow";
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.025;
    this.player.add(shadow);

    let candidate: THREE.Group | null = null;
    try {
      const mercedonian = createPlayerMercedonian(this.renderer.shadowMap.enabled);
      candidate = mercedonian.group;
      if (!this.setupPlayerAnimations(mercedonian.group, mercedonian.animations)) {
        throw new Error("The shared Mercedonian has no Idle or Walk clip");
      }
      this.player.add(mercedonian.group);
    } catch (error) {
      if (candidate) disposeObject(candidate);
      // Built lazily: successful players carry no hidden second body or wasted meshes.
      this.playerFallback = this.createPlayerFallback();
      this.playerFallback.name = "interior-mercedonian-fallback";
      this.player.add(this.playerFallback);
      console.warn("The Mercedonian avatar could not be created; using the interior fallback.", error);
    }

    this.player.position.set(0, 0, 3.85);
    this.scene.add(this.player);
  }

  /** Emergency-only figure for browsers that cannot construct the rigged avatar. */
  private createPlayerFallback(): THREE.Group {
    const fallback = new THREE.Group();
    const legs = new THREE.Group();
    legs.name = "interior-player-legs";
    const legMaterial = new THREE.MeshStandardMaterial({ color: 0x244f58, roughness: 0.76 });
    for (const side of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.42, 3, 7), legMaterial);
      leg.position.set(side * 0.17, 0.45, 0);
      leg.name = side < 0 ? "left-leg" : "right-leg";
      leg.castShadow = this.renderer.shadowMap.enabled;
      legs.add(leg);
    }
    fallback.add(legs);

    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.34, 0.72, 5, 10),
      new THREE.MeshStandardMaterial({ color: 0xe6795f, roughness: 0.7 }),
    );
    body.position.y = 1.06;
    body.castShadow = this.renderer.shadowMap.enabled;
    fallback.add(body);

    const vest = new THREE.Mesh(
      new THREE.CylinderGeometry(0.37, 0.34, 0.44, 10),
      new THREE.MeshStandardMaterial({ color: 0x1e7b78, roughness: 0.65 }),
    );
    vest.position.y = 1.13;
    fallback.add(vest);

    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.27, 12, 8),
      new THREE.MeshStandardMaterial({ color: 0xc98c68, roughness: 0.8 }),
    );
    head.position.y = 1.86;
    head.castShadow = this.renderer.shadowMap.enabled;
    fallback.add(head);

    const backpack = new THREE.Mesh(
      new THREE.BoxGeometry(0.44, 0.55, 0.18),
      new THREE.MeshStandardMaterial({ color: 0xe1ad3e, roughness: 0.7 }),
    );
    // Match the canonical actor convention: backpack behind, visible front on +Z.
    backpack.position.set(0, 1.13, -0.34);
    fallback.add(backpack);
    return fallback;
  }

  private setupPlayerAnimations(model: THREE.Group, animations: THREE.AnimationClip[]): boolean {
    const idleClip = THREE.AnimationClip.findByName(animations, "Idle");
    const walkClip = THREE.AnimationClip.findByName(animations, "Walk");
    if (!idleClip || !walkClip) return false;
    this.playerMixer = new THREE.AnimationMixer(model);
    this.playerIdleAction = this.playerMixer.clipAction(idleClip);
    this.playerWalkAction = this.playerMixer.clipAction(walkClip);
    this.playerIdleAction.reset().setEffectiveWeight(1).play();
    this.playerWalkAction.setEffectiveWeight(0).play();
    this.playerWalking = false;
    return true;
  }

  private updatePlayerAnimations(delta: number, movementSpeed: number): void {
    if (!this.playerMixer || !this.playerIdleAction || !this.playerWalkAction) return;
    const walking = movementSpeed > 0.05;
    this.playerWalkAction.timeScale = walkAnimationRate(movementSpeed);
    if (walking !== this.playerWalking) {
      const incoming = walking ? this.playerWalkAction : this.playerIdleAction;
      const outgoing = walking ? this.playerIdleAction : this.playerWalkAction;
      incoming.reset().setEffectiveTimeScale(walking ? this.playerWalkAction.timeScale : 1).setEffectiveWeight(1).play();
      incoming.crossFadeFrom(outgoing, 0.18, true);
      this.playerWalking = walking;
    }
    this.playerMixer.update(delta);
  }

  private buildInterior(): void {
    this.applyLighting();
    if (!this.business) return;
    this.scene.remove(this.content);
    disposeObject(this.content);
    for (const texture of this.textures) texture.dispose();
    this.textures.clear();
    this.content = new THREE.Group();
    this.content.name = "interactive-business-interior";
    this.scene.add(this.content);
    this.stations.clear();
    // The grid and the fitting roots live on `content`, which was just disposed and replaced.
    // Keeping the stale handles meant showGrid() saw a non-null gridHelper, skipped rebuilding
    // it, and toggled `visible` on a group no longer in the scene — so from the second visit
    // to any interior onward, the placement grid never appeared again.
    this.gridHelper = null;
    this.fittingRoots.clear();
    this.interactiveObjects.length = 0;
    this.obstacles.length = 0;
    this.ambientObjects.length = 0;
    for (const material of this.propMaterials.values()) material.dispose();
    this.propMaterials.clear();
    this.floor = null;
    this.exitHalo = null;

    const accent = new THREE.Color(this.business.color);
    // The room itself, not just the machine in it, belongs to the trade: a mine is
    // cold grey rock under a dark sky, a kitchen is warm timber under a low sun.
    const design = INTERIOR_ROOMS[this.license];
    this.scene.background = new THREE.Color(design.sky);
    this.scene.fog = new THREE.Fog(new THREE.Color(design.sky).lerp(new THREE.Color(design.floor), 0.42), 18, 36);
    // Surfaces are drawn from the same generator the city outside uses: a flat palette
    // base, one motif on a fixed lattice, and a darker keyline on all four edges. The
    // interiors were plain coloured materials while the world outside is tiled, so
    // stepping through a door changed visual language entirely.
    //
    // The keyline is stronger indoors than out on purpose. Outside, a border repeated
    // across 512 metres becomes a net; a room is a dozen tiles across, so the edge can be
    // what it is in the world's own art — drawn, not hinted at.
    const tiled = (colour: number, motif: Parameters<typeof surfaceTile>[0], repeat: number) => {
      const texture = surfaceTile(motif, new THREE.Color(colour)).clone();
      texture.needsUpdate = true;
      texture.repeat.set(repeat, repeat);
      return texture;
    };

    const cream = new THREE.MeshStandardMaterial({ color: 0xe9d9b4, roughness: 0.9 });
    const stone = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 0.88, map: tiled(design.wall, "flagstone", 5),
    });
    const timber = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 0.82, map: tiled(design.trim, "planks", 4),
    });
    const teal = new THREE.MeshStandardMaterial({ color: 0x1c6667, roughness: 0.72 });
    const accentMaterial = new THREE.MeshStandardMaterial({
      color: design.accent,
      roughness: 0.52,
      metalness: 0.12,
      emissive: new THREE.Color(design.accent).multiplyScalar(0.12),
      emissiveIntensity: 0.4,
    });
    // The floor carries the room's own motif — a workshop is planked, a mine is
    // flagstone, a greenhouse is worked ground — at a repeat that lands one tile per
    // metre, matching the scale the city outside is drawn at.
    const floorMotif: Parameters<typeof surfaceTile>[0] =
      design.architecture === "canopy-biome" || design.architecture === "living-water-gallery" ? "speckle"
      : design.architecture === "regrowth-timber-hall" || design.architecture === "sawtooth-atelier" ? "planks"
      : "flagstone";
    const floorMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 0.94,
      map: tiled(design.floor, floorMotif, Math.round(ROOM_HALF_WIDTH)),
    });
    const glass = new THREE.MeshPhysicalMaterial({
      color: design.glass,
      transmission: 0.35,
      transparent: true,
      opacity: 0.56,
      roughness: 0.18,
      metalness: 0.05,
    });

    this.floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_HALF_WIDTH * 2, ROOM_HALF_DEPTH * 2), floorMaterial);
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.receiveShadow = true;
    this.content.add(this.floor);

    // No GridHelper any more: it was a wireframe standing in for tiled ground, and laid
    // over a surface that now draws its own borders it read as a second, misaligned grid.

    this.createRoomShell(design, stone, timber, teal, glass, accentMaterial);
    this.createFloorStory(design);
    this.createServiceBay(design);
    this.dressShopFloor(design);

    this.createBusinessSign(accent);
    this.createExitDoor(accent, timber, teal);
    for (const definition of STATIONS) this.createStation(definition, cream, timber);
    this.createFittings(timber);
    this.rebuildObstacles();

    // NOTHING ELSE STANDS ON THE FLOOR.
    //
    // The room used to open with a trade centrepiece, a floor kit and a pair of planters
    // already placed, on top of four equipment ports. Between them a maker walked into a
    // room that was finished before they touched it, and every tile the grid offered was
    // occupied by scenery they never chose and could not move.
    //
    // What is left is the room and nothing else: walls, glazing, the roof, the door, the
    // sign over it, and the floor. Everything a player sees standing on that floor is
    // something they put there — the four stations at their chosen tiles, and whatever
    // fittings they have bought and placed beside them.
    //
    // createSignatureSystem, dressRoom and createPlant are still here and still work; they
    // are simply not called. That is deliberate rather than a deletion: they carry fifteen
    // trades' worth of authored dressing, and a room that later wants a wall-mounted
    // centrepiece rather than a floor-standing one should start from that, not from
    // nothing.

    this.updateUpgradeLevels(this.upgrades, this.upgradeCeiling);
  }

  /**
   * Build the recognisable envelope of one trade. The playable footprint stays stable,
   * but the skyline, glazing rhythm and structural language change for every license.
   * All tall pieces hug the perimeter so the tested station approaches remain open.
   */
  private createRoomShell(
    design: RoomDesign,
    stone: THREE.MeshStandardMaterial,
    timber: THREE.MeshStandardMaterial,
    teal: THREE.MeshStandardMaterial,
    glass: THREE.MeshPhysicalMaterial,
    accent: THREE.MeshStandardMaterial,
  ): void {
    const box = (
      size: readonly [number, number, number],
      at: readonly [number, number, number],
      material: THREE.Material,
      rotationZ = 0,
    ): THREE.Mesh => {
      const mesh = this.addBox(this.content, size, at, material);
      mesh.rotation.z = rotationZ;
      return mesh;
    };
    const windowBay = (x: number, width: number, height = 3.0, y = 2.12): void => {
      box([width, height, 0.13], [x, y, -5.92], glass);
      box([0.13, height + 0.2, 0.27], [x - width / 2, y, -5.84], teal);
      box([0.13, height + 0.2, 0.27], [x + width / 2, y, -5.84], teal);
      box([width + 0.12, 0.12, 0.27], [x, y + height / 2, -5.84], teal);
    };
    const roundWindow = (x: number, y: number, radius: number): void => {
      const pane = new THREE.Mesh(new THREE.CircleGeometry(radius * 0.83, 18), glass);
      pane.position.set(x, y, -5.91);
      this.content.add(pane);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.11, 7, 20), accent);
      rim.position.set(x, y, -5.79);
      this.content.add(rim);
    };
    const arch = (x: number, y: number, radius: number, material: THREE.Material, scaleX = 1): THREE.Mesh => {
      const mesh = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.095, 6, 20, Math.PI), material);
      mesh.position.set(x, y, -5.76);
      mesh.scale.x = scaleX;
      mesh.castShadow = this.renderer.shadowMap.enabled;
      this.content.add(mesh);
      return mesh;
    };
    /**
     * Nothing. Kept as a no-op so the fifteen architecture cases below still read as a
     * set rather than fourteen calls and one gap.
     *
     * It used to hang a post and an eleven-metre rail down each side at head height. On
     * the old narrow floor they framed the room; on the widened one they ran straight
     * through ground a maker is meant to build on, and they were the main thing making an
     * interior feel like scaffolding rather than a workshop.
     */
    const sideRails = (_material: THREE.Material, _height = 4.55): void => {};

    // Low, non-negotiable plinths tell the collision boundary without enclosing the
    // camera. Everything above them is business-specific.
    box([ROOM_HALF_WIDTH * 2 + 0.5, 0.44, 0.5], [0, 0.2, -(ROOM_HALF_DEPTH + 0.05)], stone);
    box([0.5, 0.44, ROOM_HALF_DEPTH * 2 + 0.4], [-(ROOM_HALF_WIDTH + 0.05), 0.2, 0], stone);
    box([0.5, 0.44, ROOM_HALF_DEPTH * 2 + 0.4], [ROOM_HALF_WIDTH + 0.05, 0.2, 0], stone);

    switch (design.architecture) {
      case "living-water-gallery": {
        sideRails(accent, 4.35);
        for (const x of [-5.7, -3.45, 3.45, 5.7]) roundWindow(x, 2.35, 0.92);
        arch(0, 2.2, 2.15, accent, 1.1);
        for (const x of [-7.25, 7.25]) {
          box([0.22, 3.8, 0.22], [x, 2.0, -5.65], accent);
          const cap = new THREE.Mesh(new THREE.SphereGeometry(0.25, 8, 6), accent);
          cap.position.set(x, 4.0, -5.65);
          this.content.add(cap);
        }
        break;
      }
      case "heliostat-atrium": {
        sideRails(teal, 4.75);
        for (const x of [-6.4, -4.2, 4.2, 6.4]) windowBay(x, 1.65, 2.85, 2.05);
        for (const [x, tilt] of [[-5.3, -0.2], [-3.3, 0.18], [3.3, -0.18], [5.3, 0.2]] as Array<[number, number]>) {
          const fin = box([1.75, 0.13, 1.15], [x, 4.74, -5.1], teal);
          fin.rotation.x = 0.16;
          fin.rotation.z = tilt;
          box([0.1, 1.25, 0.1], [x, 4.16, -5.45], accent);
        }
        box([15.2, 0.18, 0.3], [0, 4.64, -5.75], accent);
        break;
      }
      case "canopy-biome": {
        sideRails(timber, 4.7);
        for (const x of [-6.15, -3.75, 3.75, 6.15]) windowBay(x, 2.05, 3.4, 2.25);
        for (const x of [-5.9, -3.65, 3.65, 5.9]) arch(x, 2.35, 1.15, accent, 0.92);
        // Canopy ribs, ABOVE the room rather than through it.
        //
        // These were quarter-torus arcs of radius 2.45 centred at x +-7.35 and y 2.25 — well
        // inside the 11-unit half-width and low enough that each one swept down across the
        // floor the player builds on. Rendered in the dark timber material against a pale
        // floor they read as black scribbles lying over the tiles, not as a roof. Moved out
        // to the wall line and lifted so they arc overhead, which is what a barrel-biome rib
        // actually does, and given the lighter trim so they sit back rather than dominate.
        for (const x of [-10.15, 10.15]) {
          for (const z of [-4.6, -1.5, 1.6, 4.7]) {
            const rib = new THREE.Mesh(new THREE.TorusGeometry(2.1, 0.055, 5, 14, Math.PI * 0.42), accent);
            rib.position.set(x, 3.6, z);
            rib.rotation.y = x < 0 ? Math.PI / 2 : -Math.PI / 2;
            rib.rotation.z = x < 0 ? -0.18 : 0.18;
            this.content.add(rib);
          }
        }
        break;
      }
      case "reclaimed-strata-vault": {
        sideRails(timber, 4.0);
        box([15.5, 2.7, 0.38], [0, 1.55, -5.88], stone);
        for (const [x, y, scale] of [[-6.8, 3.0, 1.25], [-5.4, 3.35, 0.9], [5.4, 3.35, 0.9], [6.8, 3.0, 1.25]] as Array<[number, number, number]>) {
          const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(scale, 0), stone);
          rock.position.set(x, y, -5.72);
          rock.scale.y = 0.72;
          this.content.add(rock);
        }
        for (const x of [-4.55, 4.55]) windowBay(x, 1.35, 1.25, 2.3);
        box([3.5, 0.25, 0.3], [-2.1, 4.1, -5.62], timber, -0.5);
        box([3.5, 0.25, 0.3], [2.1, 4.1, -5.62], timber, 0.5);
        break;
      }
      case "regrowth-timber-hall": {
        sideRails(timber, 4.7);
        for (const x of [-5.8, -3.55, 3.55, 5.8]) windowBay(x, 1.75, 3.0, 2.05);
        for (const x of [-6.1, -3.8, 3.8, 6.1]) {
          box([2.7, 0.2, 0.28], [x - 0.72, 4.0, -5.68], timber, 0.72);
          box([2.7, 0.2, 0.28], [x + 0.72, 4.0, -5.68], timber, -0.72);
        }
        for (const x of [-7.2, 7.2]) box([0.22, 0.24, 11.6], [x, 4.55, 0], timber);
        break;
      }
      case "circular-packhouse": {
        sideRails(timber, 4.35);
        for (const x of [-6.3, -4.4, 4.4, 6.3]) for (const y of [1.3, 3.15]) {
          box([1.45, 1.38, 0.13], [x, y, -5.92], glass);
          box([1.6, 0.1, 0.27], [x, y - 0.75, -5.83], accent);
        }
        for (const x of [-7.1, -5.3, -3.5, 3.5, 5.3, 7.1]) box([0.1, 4.45, 0.25], [x, 2.25, -5.82], timber);
        box([15.0, 0.15, 0.27], [0, 4.45, -5.82], accent);
        break;
      }
      case "sawtooth-atelier": {
        sideRails(teal, 4.6);
        for (const x of [-6.3, -4.25, 4.25, 6.3]) windowBay(x, 1.6, 2.75, 2.0);
        const teeth = [-7.3, -4.4, -1.5, 1.5, 4.4, 7.3];
        for (let i = 0; i < teeth.length - 1; i += 1) {
          const x = (teeth[i]! + teeth[i + 1]!) / 2;
          box([3.15, 0.16, 0.28], [x, i % 2 === 0 ? 4.2 : 4.55, -5.7], i % 2 === 0 ? timber : accent, i % 2 === 0 ? 0.25 : -0.25);
        }
        for (const x of [-7.2, 7.2]) box([0.16, 0.18, 11.8], [x, 4.45, 0], teal);
        break;
      }
      case "clean-forge-hall": {
        sideRails(teal, 4.9);
        for (const x of [-6.7, -5.0, -3.3, 3.3, 5.0, 6.7]) windowBay(x, 1.05, 1.7, 2.95);
        for (const x of [-7.4, -5.8, -4.2, 4.2, 5.8, 7.4]) box([0.16, 4.55, 0.3], [x, 2.3, -5.75], teal);
        box([15.2, 0.26, 0.35], [0, 4.72, -5.68], accent);
        for (const x of [-6, -2, 2, 6]) box([2.8, 0.1, 0.8], [x, 4.83, -5.1], glass);
        break;
      }
      case "civic-prefab-studio": {
        sideRails(accent, 4.55);
        for (const x of [-6.4, -4.25, 4.25, 6.4]) windowBay(x, 1.7, 2.55, 2.15);
        for (const x of [-7.1, -5.1, -3.1, 3.1, 5.1, 7.1]) box([0.14, 4.4, 0.28], [x, 2.25, -5.73], timber);
        box([15.0, 0.22, 0.34], [0, 4.45, -5.7], accent);
        for (const x of [-7.0, 7.0]) {
          box([0.16, 0.18, 11.4], [x, 4.4, 0], accent);
          box([0.14, 0.14, 11.4], [x, 2.2, 0], timber);
        }
        break;
      }
      case "solar-quay-depot": {
        sideRails(teal, 4.25);
        windowBay(-5.25, 4.25, 2.85, 2.0);
        windowBay(5.25, 4.25, 2.85, 2.0);
        for (const x of [-6.8, -4.7, 4.7, 6.8]) arch(x, 3.05, 1.1, accent, 1.15);
        for (const x of [-6.2, -3.6, 3.6, 6.2]) {
          const canopy = box([2.3, 0.12, 1.15], [x, 4.45, -5.05], teal);
          canopy.rotation.x = 0.16;
        }
        break;
      }
      case "lantern-market-pavilion": {
        sideRails(timber, 4.15);
        windowBay(-5.25, 4.25, 3.0, 2.05);
        windowBay(5.25, 4.25, 3.0, 2.05);
        for (const x of [-6.65, -5.75, -4.85, -3.95, 3.95, 4.85, 5.75, 6.65]) {
          const awning = box([0.82, 0.12, 1.18], [x, 3.98, -5.15], Math.round(x * 10) % 2 === 0 ? stone : accent);
          awning.rotation.x = 0.24;
        }
        arch(0, 2.25, 2.25, timber, 1.05);
        break;
      }
      case "edible-garden-kitchen": {
        sideRails(timber, 4.55);
        for (const x of [-5.15, 5.15]) {
          windowBay(x, 4.1, 3.25, 2.2);
          arch(x, 2.2, 2.15, accent, 0.95);
        }
        for (const x of [-7.1, 7.1]) box([0.2, 0.18, 11.6], [x, 4.45, 0], timber);
        box([15.0, 0.16, 0.3], [0, 4.52, -5.7], accent);
        break;
      }
      case "kinetic-wellness-grove": {
        sideRails(teal, 4.65);
        for (const x of [-5.35, 5.35]) windowBay(x, 4.0, 3.45, 2.25);
        for (const x of [-6.4, -4.8, 4.8, 6.4]) {
          const rib = arch(x, 2.25, 1.45, accent, 0.7);
          rib.rotation.z = x < 0 ? -0.22 : 0.22;
        }
        for (const x of [-7.15, 7.15]) box([0.15, 0.16, 11.5], [x, 4.5, 0], teal);
        break;
      }
      case "lantern-theatre": {
        sideRails(timber, 4.5);
        box([15.6, 3.95, 0.36], [0, 2.2, -5.9], stone);
        for (const x of [-6.5, -4.8, 4.8, 6.5]) roundWindow(x, 3.0, 0.5);
        for (const x of [-7.2, -5.8, -4.4, 4.4, 5.8, 7.2]) box([0.18, 3.85, 0.34], [x, 2.15, -5.65], timber, x < 0 ? -0.08 : 0.08);
        box([15.1, 0.2, 0.4], [0, 4.35, -5.62], accent);
        break;
      }
      case "materials-loop-lab": {
        sideRails(teal, 4.45);
        for (const x of [-6.0, -3.85, 3.85, 6.0]) roundWindow(x, 2.45, 0.88);
        for (const x of [-6.0, -3.85, 3.85, 6.0]) {
          box([1.55, 0.13, 0.3], [x, 3.7, -5.72], accent, x < 0 ? -0.14 : 0.14);
          box([1.55, 0.13, 0.3], [x, 1.2, -5.72], timber, x < 0 ? 0.14 : -0.14);
        }
        arch(0, 2.25, 2.2, accent, 1.08);
        for (const x of [-7.1, 7.1]) box([0.16, 0.18, 11.5], [x, 4.35, 0], accent);
        break;
      }
    }
  }

  /** A thin, non-colliding production diagram embedded in the floor. */
  /**
   * Paint the serviced bay, and dress the floor outside it.
   *
   * Both halves of this are required by the bay, not decoration. The bay cut the buildable
   * floor from 84 tiles to 28, and a rule the player cannot see is a tax they resent rather
   * than a puzzle they solve — so the buildable region is drawn as worked surface with a
   * keyline before anyone has to ask where machines go. And the 56 tiles now outside it would
   * otherwise be bare, which would leave the room reading emptier than the diorama it
   * replaced. The outer floor becomes the shop: the trade's own dressing lives there, where a
   * machine can never be dropped on top of it.
   */
  private createServiceBay(design: RoomDesign): void {
    const tiles = servicedTiles();
    if (!tiles.length) return;
    const columns = [...new Set(tiles.map((tile) => tile.column))].sort((a, b) => a - b);
    const left = columns.filter((column) => column < FLOOR_WALKWAY_COLUMN);
    const right = columns.filter((column) => column > FLOOR_WALKWAY_COLUMN);
    const rows = [...new Set(tiles.map((tile) => tile.row))];
    const depth = (Math.max(...rows) - Math.min(...rows) + 1) * FLOOR_TILE;
    const midRow = (Math.max(...rows) + Math.min(...rows)) / 2;

    // Worked surface, deliberately darker than the floor it sits on. At the trade's own path
    // colour and half opacity this was invisible against the floor — which fails its only job,
    // because a buildable region the player cannot see is a rule they discover by being
    // refused. Darkened and given a bright keyline so the bay reads at a glance.
    const worked = new THREE.Color(design.wall).lerp(new THREE.Color(0x000000), 0.28);
    const surface = new THREE.MeshStandardMaterial({
      color: worked, roughness: 0.94, metalness: 0.06,
      transparent: true, opacity: 0.9, depthWrite: false,
    });
    const keyline = new THREE.MeshBasicMaterial({
      color: design.accent, transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide,
    });

    for (const bank of [left, right]) {
      if (!bank.length) continue;
      const width = bank.length * FLOOR_TILE;
      const centre = tileToWorld((bank[0]! + bank[bank.length - 1]!) / 2, midRow);
      const pad = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), surface);
      pad.rotation.x = -Math.PI / 2;
      pad.position.set(centre.x, 0.024, centre.z);
      pad.receiveShadow = true;
      this.content.add(pad);

      // A keyline round the bank, the way the world's own tiles are edged.
      for (const [w, d, ox, oz] of [[width, 0.1, 0, -depth / 2], [width, 0.1, 0, depth / 2],
                                    [0.1, depth, -width / 2, 0], [0.1, depth, width / 2, 0]] as Array<[number, number, number, number]>) {
        const edge = new THREE.Mesh(new THREE.PlaneGeometry(w, d), keyline);
        edge.rotation.x = -Math.PI / 2;
        edge.position.set(centre.x + ox, 0.032, centre.z + oz);
        this.content.add(edge);
      }
    }
  }

  /**
   * The shop: what stands on the floor the player cannot build on.
   *
   * Deliberately sparse and pushed to the outer columns. The room was emptied on purpose once
   * before — it used to open with a centrepiece and a floor kit already occupying the tiles a
   * maker wanted — so this only ever dresses tiles that are NOT buildable, and never the bay.
   */
  private dressShopFloor(design: RoomDesign): void {
    const timber = new THREE.MeshStandardMaterial({ color: design.trim, roughness: 0.72, metalness: 0.08 });
    const leaf = new THREE.MeshStandardMaterial({ color: design.accent, roughness: 0.58, metalness: 0.05 });
    const crate = new THREE.MeshStandardMaterial({ color: design.wall, roughness: 0.78, metalness: 0.06 });

    const at = (column: number, row: number): { x: number; z: number } => tileToWorld(column, row);
    const outerLeft = 1, outerRight = FLOOR_COLUMNS - 2;

    // Planters down both outer edges: greenery is the house language, and it reads at any
    // orbit angle without competing with the machines in the middle.
    for (const column of [outerLeft, outerRight]) {
      for (const row of [0, 3, 6]) {
        const spot = at(column, row);
        const tub = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.29, 0.34, 8), timber);
        tub.position.set(spot.x, 0.17, spot.z);
        tub.castShadow = true;
        this.content.add(tub);
        for (let i = 0; i < 5; i += 1) {
          const angle = (i / 5) * Math.PI * 2;
          const frond = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.62, 5), leaf);
          frond.position.set(spot.x + Math.cos(angle) * 0.13, 0.6, spot.z + Math.sin(angle) * 0.13);
          frond.rotation.z = Math.cos(angle) * 0.42;
          frond.rotation.x = Math.sin(angle) * 0.42;
          this.content.add(frond);
        }
      }
    }

    // A low stack of the trade's own goods against each far corner.
    for (const [column, row] of [[outerLeft, 1], [outerRight, 5]] as Array<[number, number]>) {
      const spot = at(column, row);
      for (let i = 0; i < 3; i += 1) {
        const box = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.3, 0.42), crate);
        box.position.set(spot.x + (i % 2) * 0.08, 0.15 + i * 0.31, spot.z - i * 0.05);
        box.rotation.y = i * 0.16;
        box.castShadow = true;
        this.content.add(box);
      }
    }

    // A bench facing the aisle, so the shop half has somewhere to stand and look.
    for (const column of [outerLeft + 1, outerRight - 1]) {
      const spot = at(column, 3);
      const seat = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.08, 1.15), timber);
      seat.position.set(spot.x, 0.42, spot.z);
      seat.castShadow = true;
      this.content.add(seat);
      for (const dz of [-0.42, 0.42]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.42, 0.09), timber);
        leg.position.set(spot.x, 0.21, spot.z + dz);
        this.content.add(leg);
      }
    }
  }

  private createFloorStory(design: RoomDesign): void {
    const path = new THREE.Mesh(
      new THREE.PlaneGeometry(2.35, 10.5),
      new THREE.MeshStandardMaterial({
        color: 0xffffff, roughness: 0.92,
        map: (() => {
          const t = surfaceTile("road", new THREE.Color(design.path)).clone();
          t.needsUpdate = true;
          t.repeat.set(2, 8);
          return t;
        })(),
      }),
    );
    path.rotation.x = -Math.PI / 2;
    path.position.set(0, 0.018, 0.35);
    path.receiveShadow = true;
    this.content.add(path);

    const lineMaterial = new THREE.MeshBasicMaterial({
      color: design.accent,
      transparent: true,
      opacity: design.floorPattern === "projector-beam" ? 0.28 : 0.5,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const line = (width: number, depth: number, x: number, z: number, rotation = 0): THREE.Mesh => {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), lineMaterial);
      mesh.rotation.x = -Math.PI / 2;
      mesh.rotation.z = rotation;
      mesh.position.set(x, 0.035, z);
      this.content.add(mesh);
      return mesh;
    };
    const ring = (radius: number, x: number, z: number, scaleX = 1): THREE.Mesh => {
      const mesh = new THREE.Mesh(new THREE.RingGeometry(radius - 0.08, radius, 30), lineMaterial);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(x, 0.038, z);
      mesh.scale.x = scaleX;
      this.content.add(mesh);
      return mesh;
    };

    switch (design.floorPattern) {
      case "water-runnel":
        line(0.52, 9.6, 0, 0.2);
        for (const z of [-3.7, -1.2, 1.3, 3.8]) line(1.2, 0.08, 0, z);
        break;
      case "solar-circuit":
        line(0.12, 9.4, 0, 0.2);
        for (const [x, z] of [[-3.9, -1.3], [3.9, -1.3], [-3.9, 2.6], [3.9, 2.6]] as Array<[number, number]>) {
          line(Math.abs(x), 0.1, x / 2, z);
          ring(0.32, x, z);
        }
        break;
      case "growing-rows":
        for (const x of [-3.7, -2.75, 2.75, 3.7]) line(0.12, 8.6, x, 0.2);
        break;
      case "strata-bands":
        for (const z of [-4.0, -1.9, 0.2, 2.3, 4.4]) line(14.0, 0.12, 0, z, -0.08);
        break;
      case "timber-grain":
        for (const x of [-6.0, -3.0, 0, 3.0, 6.0]) line(0.08, 10.5, x, 0.2);
        break;
      case "folding-grid":
        for (const x of [-4.8, -2.4, 2.4, 4.8]) line(0.08, 9.6, x, 0.1);
        for (const z of [-3.8, 0, 3.8]) line(13.5, 0.08, 0, z);
        break;
      case "maker-sparks":
        for (const [x, z] of [[-3, -1], [3, -1], [-2.6, 2.8], [2.6, 2.8]] as Array<[number, number]>) line(0.54, 0.54, x, z, Math.PI / 4);
        line(0.1, 9.4, 0, 0.2);
        break;
      case "assembly-line":
        line(0.12, 9.5, -0.7, 0.2);
        line(0.12, 9.5, 0.7, 0.2);
        for (const z of [-3.5, -1.5, 0.5, 2.5, 4.5]) line(1.35, 0.08, 0, z);
        break;
      case "survey-grid":
        for (const x of [-4, 0, 4]) line(0.07, 10.0, x, 0.2);
        for (const z of [-3.5, 0.5, 4.5]) line(13.0, 0.07, 0, z);
        break;
      case "quay-route":
        line(0.12, 5.0, 0, -2.2);
        line(4.0, 0.12, -2.0, 0.3);
        line(4.0, 0.12, 2.0, 2.7);
        for (const [x, z] of [[-4, 0.3], [4, 2.7]] as Array<[number, number]>) ring(0.3, x, z);
        break;
      case "market-petals":
        for (const [x, z] of [[-0.55, -1.3], [0.55, -1.3], [-0.55, -0.25], [0.55, -0.25]] as Array<[number, number]>) ring(0.62, x, z, 0.65);
        line(0.1, 7.5, 0, 1.1);
        break;
      case "hearth-ring":
        ring(1.15, 0, 0.35);
        ring(1.45, 0, 0.35);
        line(0.1, 7.0, 0, 1.8);
        break;
      case "kinetic-orbit":
        ring(1.1, 0, 0.3, 1.6);
        ring(1.6, 0, 0.3, 1.55);
        for (const x of [-4.0, 4.0]) ring(0.5, x, 2.9);
        break;
      case "projector-beam":
        line(5.5, 8.5, 0, 0.1);
        line(0.12, 9.2, 0, 0.1);
        break;
      case "circular-loop":
        ring(2.0, 0, 0.2, 1.7);
        line(0.1, 5.4, 0, -2.4);
        for (const x of [-4.0, 4.0]) ring(0.42, x, 2.9);
        break;
    }
  }


  private createBusinessSign(accent: THREE.Color): void {
    if (!this.business) return;
    const signTexture = this.createSignTexture(
      this.business.name,
      `${this.business.icon}  ${this.business.sector.toUpperCase()}`,
      `#${accent.getHexString()}`,
      1024,
      256,
    );
    const sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: signTexture, transparent: true, depthWrite: false, depthTest: false }));
    sign.renderOrder = 10;
    sign.scale.set(6.9, 1.72, 1);
    sign.position.set(0, 3.72, -5.55);
    this.content.add(sign);
  }

  private createExitDoor(accent: THREE.Color, timber: THREE.Material, teal: THREE.Material): void {
    const root = new THREE.Group();
    root.position.set(0, 0, -5.73);
    root.name = "interior-exit-door";
    this.content.add(root);

    this.addBox(root, [2.15, 3.35, 0.34], [0, 1.72, 0], timber);
    this.addBox(root, [1.58, 2.86, 0.42], [0, 1.47, 0.1], new THREE.MeshStandardMaterial({
      color: 0x174e54,
      roughness: 0.72,
      emissive: accent.clone().multiplyScalar(0.12),
      emissiveIntensity: 0.6,
    }));
    this.addBox(root, [0.16, 2.48, 0.47], [-0.62, 1.48, 0.32], teal);
    const handle = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0xe3b449, metalness: 0.7, roughness: 0.3 }),
    );
    handle.position.set(0.55, 1.45, 0.38);
    root.add(handle);

    const texture = this.createSignTexture("RETURN OUTSIDE", "E  EXIT BUSINESS", `#${accent.getHexString()}`, 640, 180);
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, depthTest: false }));
    label.renderOrder = 10;
    label.scale.set(1.8, 0.5, 1);
    label.position.set(0, 3.55, 0.2);
    root.add(label);

    this.exitHalo = new THREE.Mesh(
      new THREE.RingGeometry(0.78, 1.05, 28),
      new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false }),
    );
    this.exitHalo.rotation.x = -Math.PI / 2;
    this.exitHalo.position.set(0, 0.035, 1.05);
    root.add(this.exitHalo);

    const hitbox = new THREE.Mesh(
      new THREE.BoxGeometry(2.4, 3.8, 1.2),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.001, depthWrite: false }),
    );
    hitbox.position.set(0, 1.8, 0.45);
    hitbox.userData.interiorTarget = "exit" satisfies TargetId;
    root.add(hitbox);
    this.interactiveObjects.push(hitbox);
  }

  private createStation(
    definition: StationDefinition,
    cream: THREE.MeshStandardMaterial,
    timber: THREE.MeshStandardMaterial,
  ): void {
    const [x, z] = definition.position;
    const root = new THREE.Group();
    root.position.set(x, 0, z);
    root.name = `interior-station-${definition.key}`;
    this.content.add(root);

    const design = INTERIOR_EQUIPMENT_CATALOG[this.license][definition.key];
    const primary = new THREE.Color(design.primary);
    const secondary = new THREE.Color(design.secondary);
    const accent = primary.clone().lerp(secondary, 0.56);
    const activeMaterial = new THREE.MeshStandardMaterial({
      color: accent,
      roughness: 0.48,
      metalness: 0.22,
      emissive: accent.clone().multiplyScalar(0.2),
      emissiveIntensity: 0.4,
    });
    const secondaryMaterial = new THREE.MeshStandardMaterial({
      color: secondary,
      roughness: 0.52,
      metalness: 0.14,
      emissive: secondary.clone().multiplyScalar(0.16),
      emissiveIntensity: 0.3,
    });
    const darkMaterial = new THREE.MeshStandardMaterial({ color: 0x28575a, roughness: 0.7, metalness: 0.15 });
    const highlightMaterials = [activeMaterial, secondaryMaterial];

    // No plinth. Each station used to stand on a two-part cylinder with a glowing ring
    // round it — a docking port, which made sense when equipment lived in four fixed
    // slots and nowhere else. Now that a machine goes wherever its owner drags it, a port
    // drawn under it is a hole in the floor that follows it about. The machines sit on the
    // tiles like everything else in the world does.

    const machineRoot = new THREE.Group();
    machineRoot.name = `${design.form}-installed`;
    root.add(machineRoot);
    const modules = this.createEquipmentModules(
      machineRoot,
      definition.key,
      design,
      activeMaterial,
      secondaryMaterial,
      darkMaterial,
      cream,
      timber,
    );
    const blueprint = this.createBlueprint(definition.key, design, accent);
    root.add(blueprint);

    // The halo is kept but only as SELECTION feedback — it is hidden until a station is
    // hovered or chosen, rather than burning a permanent ring into the floor.
    const halo = new THREE.Mesh(
      new THREE.RingGeometry(1.05, 1.22, 28),
      new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false }),
    );
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = 0.025;
    halo.visible = false;
    root.add(halo);

    const lamps: InteriorStation["lamps"] = [];
    for (let index = 0; index < MAX_UPGRADE_LEVEL; index += 1) {
      const lampMaterial = new THREE.MeshStandardMaterial({
        color: 0x49605c,
        emissive: accent,
        emissiveIntensity: 0.05,
        roughness: 0.38,
      });
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.105, 10, 7), lampMaterial);
      lamp.position.set((index - 1.5) * 0.28, 0.58, 1.03);
      root.add(lamp);
      lamps.push(lamp);
    }

    const labelTexture = this.createStationTexture(definition, design, this.upgrades[definition.key], accent);
    // Was 3.25 units — 2.03 tiles — with depthTest off, so labels overlapped each other and
    // painted straight through the machines in front of them. Sized to sit inside one tile.
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture, transparent: true, depthWrite: false }));
    label.renderOrder = 10;
    label.scale.set(1.95, 0.55, 1);
    label.position.set(0, 3.05, 0);
    root.add(label);

    const hitbox = new THREE.Mesh(
      new THREE.BoxGeometry(2.75, 3.2, 2.5),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.001, depthWrite: false }),
    );
    hitbox.position.y = 1.55;
    hitbox.userData.interiorTarget = definition.key;
    root.add(hitbox);
    this.interactiveObjects.push(hitbox);

    const toCentre = new THREE.Vector3(-x, 0, -z).normalize();
    const approach = new THREE.Vector3(x, 0, z).addScaledVector(toCentre, 1.55);
    const station: InteriorStation = {
      definition, design, root, approach, halo, label, lamps, highlightMaterials, blueprint, modules,
    };
    this.stations.set(definition.key, station);
    this.obstacles.push({ x, z, radius: 1.15 });
  }

  private createEquipmentModules(
    root: THREE.Group,
    key: UpgradeKey,
    design: InteriorEquipmentDesign,
    primary: THREE.MeshStandardMaterial,
    secondary: THREE.MeshStandardMaterial,
    dark: THREE.MeshStandardMaterial,
    cream: THREE.MeshStandardMaterial,
    timber: THREE.MeshStandardMaterial,
  ): THREE.Group[] {
    const modules = Array.from({ length: MAX_UPGRADE_LEVEL }, (_, index) => {
      const module = new THREE.Group();
      module.name = `${design.form}-level-${index + 1}`;
      root.add(module);
      return module;
    });

    this.createBaseMachine(design.motif, key, modules[0], primary, secondary, dark, cream, timber);
    this.createMotifModule(design.motif, modules[1], primary, secondary, dark, timber);
    this.createAdvancedModule(design.motif, key, modules[2], primary, secondary, dark, cream, timber);
    this.createMasterModule(design, modules[3], primary, secondary, dark, timber);
    return modules;
  }

  private createBlueprint(key: UpgradeKey, design: InteriorEquipmentDesign, color: THREE.Color): THREE.Group {
    const root = new THREE.Group();
    root.name = `${design.form}-purchase-blueprint`;
    // A ghost you can actually see.
    //
    // This was a wireframe at 0.38 opacity, which was legible while every station stood on
    // a solid plinth — the plinth was what said "something belongs here" and the wireframe
    // only said what. With the ports gone, an unbought station became a faint scribble
    // under a full-size label: four names floating over an empty floor. Caught by looking
    // at the room, which no amount of counting geometry would have told me.
    //
    // Solid at low opacity now, with a darker keyline over it, matching how the world
    // outside draws a surface: a flat fill and a drawn border.
    const material = new THREE.MeshStandardMaterial({
      color,
      transparent: true,
      opacity: 0.3,
      roughness: 0.85,
      depthWrite: false,
    });
    const keyline = new THREE.MeshBasicMaterial({
      color: new THREE.Color(color).multiplyScalar(0.45),
      wireframe: true,
      transparent: true,
      opacity: 0.75,
      depthWrite: false,
    });
    const geometry = key === "capacity"
      ? new THREE.BoxGeometry(1.55, 1.45, 1.05, 2, 2, 2)
      : key === "speed"
        ? new THREE.TorusGeometry(0.72, 0.18, 7, 18)
        : key === "appeal"
          ? new THREE.OctahedronGeometry(0.92, 1)
          : new THREE.CylinderGeometry(0.64, 0.76, 1.55, 12, 2);
    const ghost = new THREE.Mesh(geometry, material);
    ghost.position.y = 1.38;
    if (key === "speed") ghost.rotation.x = Math.PI / 2;
    root.add(ghost);
    // The keyline over the fill, exactly as the world's own tiles are drawn.
    const edges = new THREE.Mesh(geometry, keyline);
    edges.position.copy(ghost.position);
    edges.rotation.copy(ghost.rotation);
    edges.scale.setScalar(1.008);
    root.add(edges);

    // And a footprint on the tile it stands on, so an unbought station reads as a claimed
    // square of floor rather than something hovering over it. Same language as outside: a
    // flat panel with a darker border drawn round it.
    const footprint = new THREE.Mesh(
      new THREE.PlaneGeometry(1.34, 1.34),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.14, depthWrite: false }),
    );
    footprint.rotation.x = -Math.PI / 2;
    footprint.position.y = 0.02;
    root.add(footprint);
    const footEdge = new THREE.Mesh(
      new THREE.RingGeometry(0.92, 0.98, 4, 1, Math.PI / 4),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(color).multiplyScalar(0.5),
        transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false,
      }),
    );
    footEdge.rotation.x = -Math.PI / 2;
    footEdge.position.y = 0.025;
    root.add(footEdge);
    const scan = new THREE.Mesh(
      new THREE.RingGeometry(0.66, 0.76, 24),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.48, side: THREE.DoubleSide, depthWrite: false }),
    );
    scan.name = "blueprint-scan";
    scan.rotation.x = -Math.PI / 2;
    scan.position.y = 0.5;
    root.add(scan);
    return root;
  }

  private createMotifModule(
    motif: InteriorEquipmentMotif,
    root: THREE.Group,
    primary: THREE.MeshStandardMaterial,
    secondary: THREE.MeshStandardMaterial,
    dark: THREE.MeshStandardMaterial,
    timber: THREE.MeshStandardMaterial,
  ): void {
    if (motif === "hydraulic") {
      const reservoir = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.44, 1.55, 14), secondary);
      reservoir.position.set(0.7, 1.3, 0.12);
      root.add(reservoir);
      const pipe = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.08, 8, 18, Math.PI * 1.45), primary);
      pipe.rotation.y = Math.PI / 2;
      pipe.position.set(-0.1, 1.55, 0.15);
      root.add(pipe);
    } else if (motif === "solar") {
      for (const side of [-1, 1]) {
        const panel = this.addBox(root, [0.72, 0.08, 0.9], [side * 0.46, 2.14, 0], dark);
        panel.rotation.z = side * 0.2;
        panel.rotation.x = 0.18;
      }
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.3, 1.25, 12), secondary);
      hub.position.set(0, 1.42, 0);
      root.add(hub);
    } else if (motif === "botanical") {
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.13, 1.45, 9), dark);
      stem.position.y = 1.55;
      root.add(stem);
      for (const side of [-1, 1]) {
        const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.36, 10, 7), side < 0 ? primary : secondary);
        leaf.scale.set(0.5, 1.25, 0.32);
        leaf.rotation.z = side * 0.72;
        leaf.position.set(side * 0.35, 1.7 + side * 0.15, 0);
        root.add(leaf);
      }
    } else if (motif === "geologic") {
      // Level 2 drops the crushing head onto the level 1 stone bed: two timber posts,
      // a strapped hood and a canted jaw plate. The crystals stay, but they move to
      // the front lip where they read as what the machine has just broken out.
      for (const x of [-0.62, 0.62]) this.addBox(root, [0.12, 0.94, 0.12], [x, 1.72, -0.06], timber);
      const hood = this.addBox(root, [1.24, 0.32, 0.78], [0, 2.12, -0.06], dark);
      hood.rotation.z = 0.04;
      this.addBox(root, [1.3, 0.08, 0.84], [0, 2.26, -0.06], secondary);
      const jaw = this.addBox(root, [1.0, 0.42, 0.66], [0, 1.76, -0.04], dark);
      jaw.rotation.z = 0.14;
      const ram = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 0.42, 8), secondary);
      ram.position.set(0, 1.5, -0.04);
      root.add(ram);
      for (const [x, height] of [[-0.5, 0.44], [0, 0.62], [0.5, 0.34]] as Array<[number, number]>) {
        const crystal = new THREE.Mesh(new THREE.ConeGeometry(0.17, height, 5), x === 0 ? secondary : primary);
        crystal.position.set(x, 0.5 + height / 2, 0.66);
        root.add(crystal);
      }
    } else if (motif === "forestry") {
      // Level 2 turns the trestle into a sawline: a stacked feed rack behind, and a
      // toothed blade on a cantilevered arbor that drops through the level 1 log.
      for (const [y, z] of [[0.78, -0.68], [1.3, -0.68]] as Array<[number, number]>) {
        const log = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.24, 1.5, 10), timber);
        log.rotation.z = Math.PI / 2;
        log.position.set(0, y, z);
        root.add(log);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.03, 5, 12), dark);
        ring.rotation.y = Math.PI / 2;
        ring.position.set(0.5, y, z);
        root.add(ring);
      }
      for (const x of [-0.82, 0.82]) this.addBox(root, [0.1, 1.0, 0.1], [x, 1.02, -0.68], timber);
      this.addBox(root, [0.13, 1.5, 0.13], [0.12, 1.35, -0.66], timber);
      this.addBox(root, [0.11, 0.11, 0.6], [0.12, 1.94, -0.36], timber);

      const arbor = new THREE.Group();
      arbor.name = "equipment-rotor";
      arbor.position.set(0.12, 1.94, -0.02);
      root.add(arbor);
      const blade = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.06, 18), secondary);
      blade.rotation.x = Math.PI / 2;
      arbor.add(blade);
      const hubPlate = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.1, 10), dark);
      hubPlate.rotation.x = Math.PI / 2;
      arbor.add(hubPlate);
      for (let index = 0; index < 8; index += 1) {
        const angle = index * Math.PI / 4;
        const tooth = this.addBox(arbor, [0.11, 0.07, 0.05], [Math.cos(angle) * 0.55, Math.sin(angle) * 0.55, 0], dark);
        tooth.rotation.z = angle;
      }
      const guard = new THREE.Mesh(new THREE.TorusGeometry(0.63, 0.05, 5, 14, Math.PI), timber);
      guard.position.set(0.12, 1.94, -0.02);
      root.add(guard);
      for (const [x, size] of [[-0.72, 0.13], [-0.5, 0.09], [-0.86, 0.08]] as Array<[number, number]>) {
        const chip = this.addBox(root, [size, size * 0.4, size * 0.8], [x, 0.56, 0.6], timber);
        chip.rotation.y = x;
      }
    } else if (motif === "circular") {
      // Level 2 closes the loop: a belt that actually runs, carrying sorted lumps up
      // out of the level 1 bins and tipping them back through a hopper.
      for (const x of [-0.86, 0.86]) this.addBox(root, [0.1, 1.36, 0.1], [x, 1.78, -0.12], timber);
      this.addBox(root, [1.9, 0.09, 0.12], [0, 2.5, -0.12], timber);

      const belt = new THREE.Group();
      belt.name = "equipment-rotor";
      belt.position.set(0, 1.74, -0.12);
      root.add(belt);
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.58, 0.05, 6, 22), dark);
      belt.add(band);
      for (let index = 0; index < 6; index += 1) {
        const angle = index / 6 * Math.PI * 2;
        const cleat = this.addBox(belt, [0.14, 0.05, 0.16], [Math.cos(angle) * 0.58, Math.sin(angle) * 0.58, 0], timber);
        cleat.rotation.z = angle;
        const load = new THREE.Mesh(new THREE.DodecahedronGeometry(0.075, 0), index % 2 === 0 ? primary : secondary);
        load.position.set(Math.cos(angle) * 0.68, Math.sin(angle) * 0.68, 0);
        belt.add(load);
      }
      for (const x of [-0.58, 0.58]) {
        const pulley = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.14, 10), secondary);
        pulley.rotation.x = Math.PI / 2;
        pulley.position.set(x, 1.74, -0.12);
        root.add(pulley);
      }
      const chute = this.addBox(root, [0.46, 0.05, 0.6], [0, 2.34, -0.5], timber);
      chute.rotation.x = 0.5;
      for (const side of [-1, 1]) {
        const rail = this.addBox(root, [0.05, 0.14, 0.6], [side * 0.23, 2.38, -0.5], timber);
        rail.rotation.x = 0.5;
      }
      const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.18, 5), dark);
      cord.position.set(0, 2.41, -0.5);
      root.add(cord);
    } else if (motif === "packaging") {
      // Level 2 puts the folding table under a press: two posts carry a head beam, a
      // hand lever drops a die platen onto the blanks the bench was creasing by rule,
      // and a strap spool turns on the left post. The crates behind are the first the
      // bench has actually finished — they nest, which is the whole point of the trade.
      for (const x of [-0.72, 0.72]) this.addBox(root, [0.1, 0.86, 0.1], [x, 1.5, -0.34], timber);
      this.addBox(root, [1.7, 0.12, 0.16], [0, 1.98, -0.34], timber);
      for (const x of [-0.3, 0.3]) {
        const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.66, 8), secondary);
        rod.position.set(x, 1.6, -0.2);
        root.add(rod);
      }
      const platen = this.addBox(root, [0.88, 0.14, 0.5], [0, 1.36, -0.2], dark);
      platen.rotation.z = 0.015;
      this.addBox(root, [0.92, 0.05, 0.54], [0, 1.26, -0.2], secondary);
      const lever = this.addBox(root, [0.76, 0.08, 0.09], [0.46, 1.9, -0.2], timber);
      lever.rotation.z = -0.2;
      const counterweight = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), dark);
      counterweight.position.set(0.84, 1.82, -0.2);
      root.add(counterweight);

      const spool = new THREE.Group();
      spool.name = "equipment-rotor";
      spool.position.set(-0.78, 1.72, 0.1);
      root.add(spool);
      const spoolRim = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.05, 6, 14), secondary);
      spool.add(spoolRim);
      for (let index = 0; index < 3; index += 1) {
        const spoke = this.addBox(spool, [0.34, 0.04, 0.03], [0, 0, 0], timber);
        spoke.rotation.z = index * Math.PI / 3;
      }
      const strapTail = this.addBox(root, [0.03, 0.36, 0.05], [-0.8, 1.5, 0.1], primary);
      strapTail.rotation.z = 0.12;

      for (let index = 0; index < 3; index += 1) {
        const size = 0.52 - index * 0.06;
        const crate = this.addBox(root, [size, size * 0.6, size * 0.86], [0.92, 0.7 + index * 0.3, -0.66], timber);
        crate.rotation.y = 0.26 - index * 0.18;
        this.addBox(crate, [size * 1.06, 0.05, size * 0.9], [0, size * 0.08, 0], secondary);
        this.addBox(crate, [size * 0.82, 0.02, size * 0.7], [0, size * 0.29, 0], dark);
      }
    } else if (motif === "maker") {
      // Level 2 puts the bench on power: two posts carry an overhead line shaft with
      // a pair of gears, a leather belt drops to a lathe headstock, and a blank spins
      // between centres on the level 1 benchtop. The gears are the same two the bench
      // had before — they have simply found a shaft to live on.
      for (const x of [-0.76, 0.76]) this.addBox(root, [0.1, 0.92, 0.1], [x, 1.5, -0.24], timber);
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.66, 8), secondary);
      shaft.rotation.z = Math.PI / 2;
      shaft.position.set(0, 1.94, -0.24);
      root.add(shaft);
      for (const [x, size] of [[-0.44, 0.3], [0.42, 0.21]] as Array<[number, number]>) {
        const gear = new THREE.Group();
        gear.name = "equipment-rotor";
        gear.position.set(x, 1.94, -0.24);
        root.add(gear);
        const rim = new THREE.Mesh(new THREE.TorusGeometry(size, 0.055, 6, 14), x < 0 ? primary : secondary);
        gear.add(rim);
        for (let index = 0; index < 8; index += 1) {
          const angle = index * Math.PI / 4;
          const tooth = this.addBox(gear, [0.07, 0.05, 0.07], [Math.cos(angle) * size, Math.sin(angle) * size, 0], dark);
          tooth.rotation.z = angle;
        }
      }
      for (const side of [-1, 1]) {
        const belt = this.addBox(root, [0.03, 0.82, 0.035], [-0.44 + side * 0.29, 1.55, -0.24], dark);
        belt.rotation.z = side * 0.2;
      }

      const head = this.addBox(root, [0.34, 0.34, 0.4], [-0.66, 1.2, 0.06], dark);
      head.rotation.y = 0.05;
      const spindle = new THREE.Group();
      spindle.name = "equipment-rotor";
      spindle.position.set(-0.44, 1.22, 0.06);
      root.add(spindle);
      const pulley = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.07, 12), secondary);
      pulley.rotation.x = Math.PI / 2;
      spindle.add(pulley);
      const driveDog = this.addBox(spindle, [0.3, 0.035, 0.035], [0, 0, 0.05], dark);
      driveDog.rotation.z = 0.6;
      const blank = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.86, 10), timber);
      blank.rotation.z = Math.PI / 2;
      blank.position.set(0.06, 1.22, 0.06);
      root.add(blank);
      const collar = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.025, 5, 12), secondary);
      collar.rotation.y = Math.PI / 2;
      collar.position.set(0.3, 1.22, 0.06);
      root.add(collar);
      const tail = this.addBox(root, [0.24, 0.26, 0.3], [0.64, 1.18, 0.06], dark);
      tail.rotation.y = -0.05;
      const rest = this.addBox(root, [0.5, 0.05, 0.09], [0.05, 1.06, 0.28], secondary);
      rest.rotation.z = 0.03;
      for (const x of [-0.14, 0.24]) {
        const curl = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.018, 4, 9, Math.PI * 1.4), timber);
        curl.rotation.x = 1.2;
        curl.position.set(x, 1.02, 0.42);
        root.add(curl);
      }
    } else if (motif === "industrial") {
      // Level 2 gives the forge a chimney and a trip hammer: brick courses climb off
      // the level 1 hearth into a copper cowl, and a cam wheel on a timber frame lifts
      // a hammer head over the anvil that was being swung by hand a level ago.
      const brick = new THREE.MeshStandardMaterial({ color: 0x9c6d55, roughness: 0.95, metalness: 0.02 });
      this.addBox(root, [0.7, 1.02, 0.66], [-0.44, 2.0, -0.02], brick);
      this.addBox(root, [0.78, 0.09, 0.74], [-0.44, 1.58, -0.02], secondary);
      this.addBox(root, [0.76, 0.08, 0.72], [-0.44, 2.5, -0.02], secondary);
      const cowl = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.26, 8, 1, true), secondary);
      cowl.position.set(-0.44, 2.66, -0.02);
      root.add(cowl);
      const draught = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.055, 6, 12, Math.PI / 2), secondary);
      draught.rotation.y = Math.PI / 2;
      draught.rotation.z = Math.PI;
      draught.position.set(-0.44, 1.5, 0.44);
      root.add(draught);

      for (const x of [0.18, 0.98]) this.addBox(root, [0.1, 0.96, 0.1], [x, 1.62, 0.14], timber);
      this.addBox(root, [0.98, 0.11, 0.14], [0.58, 2.14, 0.14], timber);
      const cam = new THREE.Group();
      cam.name = "equipment-rotor";
      cam.position.set(0.18, 1.86, 0.3);
      root.add(cam);
      const camRim = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.045, 6, 14), secondary);
      cam.add(camRim);
      for (let index = 0; index < 3; index += 1) {
        const spoke = this.addBox(cam, [0.42, 0.045, 0.04], [0, 0, 0], timber);
        spoke.rotation.z = index * Math.PI / 3;
      }
      const lobe = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), dark);
      lobe.position.set(0.2, 0, 0);
      cam.add(lobe);
      const arm = this.addBox(root, [0.72, 0.09, 0.11], [0.42, 1.66, 0.14], timber);
      arm.rotation.z = -0.12;
      const helve = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.24, 6), dark);
      helve.position.set(0.68, 1.5, 0.14);
      root.add(helve);
      const headBlock = this.addBox(root, [0.22, 0.26, 0.24], [0.68, 1.34, 0.14], dark);
      headBlock.rotation.z = 0.06;
      this.addBox(root, [0.26, 0.06, 0.28], [0.68, 1.2, 0.14], secondary);
      for (const [x, y] of [[0.5, 1.16], [0.86, 1.1]] as Array<[number, number]>) {
        const spark = new THREE.Mesh(new THREE.SphereGeometry(0.045, 6, 5), primary);
        spark.position.set(x, y, 0.32);
        root.add(spark);
      }
    } else if (motif === "construction") {
      // Level 2 raises a braced gantry over the trestle: diagonal knee braces, a
      // running trolley on the beam, a block and tackle, and the first wall panel
      // hanging in the air — the site can lift now, not only draw.
      for (const x of [-0.82, 0.82]) {
        this.addBox(root, [0.15, 1.8, 0.15], [x, 1.44, -0.2], secondary);
        const brace = this.addBox(root, [0.1, 0.62, 0.1], [x - Math.sign(x) * 0.19, 2.02, -0.2], timber);
        brace.rotation.z = Math.sign(x) * 0.72;
        this.addBox(root, [0.36, 0.1, 0.36], [x, 0.58, -0.2], timber);
      }
      this.addBox(root, [1.94, 0.16, 0.2], [0, 2.36, -0.2], primary);
      this.addBox(root, [1.94, 0.07, 0.1], [0, 2.24, -0.2], timber);
      for (const x of [-0.5, 0.5]) this.addBox(root, [0.07, 0.24, 0.07], [x, 2.16, -0.2], timber);

      const trolley = this.addBox(root, [0.3, 0.14, 0.26], [0.3, 2.16, -0.2], dark);
      trolley.rotation.y = 0.02;
      const sheave = new THREE.Group();
      sheave.name = "equipment-rotor";
      sheave.position.set(0.3, 1.92, -0.2);
      root.add(sheave);
      const sheaveRim = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.03, 5, 12), secondary);
      sheave.add(sheaveRim);
      const sheaveHub = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.09, 8), dark);
      sheaveHub.rotation.x = Math.PI / 2;
      sheave.add(sheaveHub);
      for (const dx of [-0.09, 0.09]) {
        const line = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.26, 5), dark);
        line.position.set(0.3 + dx, 2.05, -0.2);
        root.add(line);
      }
      const fall = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.3, 5), dark);
      fall.position.set(0.3, 1.68, -0.2);
      root.add(fall);
      const hook = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.035, 6, 12, Math.PI * 1.5), dark);
      hook.position.set(0.3, 1.46, -0.2);
      root.add(hook);
      const panel = this.addBox(root, [0.66, 0.5, 0.09], [0.3, 1.14, -0.2], timber);
      panel.rotation.z = 0.05;
      for (const y of [1.0, 1.28]) this.addBox(root, [0.66, 0.05, 0.11], [0.3, y, -0.2], secondary);
      const ladder = new THREE.Group();
      ladder.position.set(-0.82, 1.4, 0.06);
      ladder.rotation.x = -0.16;
      root.add(ladder);
      for (const dx of [-0.13, 0.13]) this.addBox(ladder, [0.06, 1.5, 0.06], [dx, 0, 0], timber);
      for (let index = 0; index < 5; index += 1) {
        this.addBox(ladder, [0.28, 0.05, 0.05], [0, -0.6 + index * 0.3, 0], timber);
      }
    } else if (motif === "logistics") {
      // Level 2 gives the cart somewhere to work: a braced two-beam pallet rack behind
      // it, a loaded pallet on the lower beam, cargo tubes stacked on the upper one and
      // a brass hanging scale on the end frame. The cart is now serving a depot.
      for (const x of [-0.86, 0.86]) {
        this.addBox(root, [0.12, 1.5, 0.12], [x, 1.32, -0.66], timber);
        this.addBox(root, [0.18, 0.08, 0.18], [x, 0.61, -0.66], secondary);
        const brace = this.addBox(root, [0.08, 0.52, 0.08], [x - Math.sign(x) * 0.16, 1.02, -0.66], timber);
        brace.rotation.z = Math.sign(x) * 0.62;
      }
      for (const y of [1.16, 1.82]) this.addBox(root, [1.86, 0.1, 0.16], [0, y, -0.66], primary);
      this.addBox(root, [1.06, 0.05, 0.5], [0, 1.24, -0.66], timber);
      for (const x of [-0.4, 0, 0.4]) this.addBox(root, [0.12, 0.07, 0.5], [x, 1.18, -0.66], timber);
      const racked = this.addBox(root, [0.48, 0.4, 0.42], [-0.3, 1.47, -0.66], timber);
      racked.rotation.y = 0.14;
      this.addBox(racked, [0.5, 0.06, 0.44], [0, 0.04, 0], secondary);
      for (const [x, z] of [[0.26, -0.76], [0.36, -0.56]] as Array<[number, number]>) {
        const sack = new THREE.Mesh(new THREE.SphereGeometry(0.19, 10, 8), timber);
        sack.scale.set(0.95, 0.85, 0.85);
        sack.position.set(x, 1.42, z);
        root.add(sack);
      }
      for (const [z, y] of [[-0.8, 1.99], [-0.56, 1.99], [-0.68, 2.19]] as Array<[number, number]>) {
        const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.115, 0.68, 10), y > 2.1 ? secondary : timber);
        tube.rotation.z = Math.PI / 2;
        tube.position.set(-0.36, y, z);
        root.add(tube);
      }
      this.addBox(root, [0.36, 0.06, 0.06], [0.68, 2.0, -0.5], secondary);
      const scaleCord = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.28, 5), dark);
      scaleCord.position.set(0.52, 1.84, -0.5);
      root.add(scaleCord);
      const pan = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.15, 0.04, 12), secondary);
      pan.position.set(0.52, 1.68, -0.5);
      root.add(pan);
      const weighed = new THREE.Mesh(new THREE.SphereGeometry(0.1, 9, 7), primary);
      weighed.scale.y = 0.7;
      weighed.position.set(0.52, 1.75, -0.5);
      root.add(weighed);
    } else if (motif === "retail") {
      // Level 2 raises a stock wall behind the trestle: three shelves carrying woven
      // baskets, brass-lidded jars and bolts of cloth, herbs drying underneath, and a
      // brass balance on the counter. The stall can hold stock now instead of selling
      // whatever fits on the table.
      for (const x of [-0.8, 0.8]) this.addBox(root, [0.1, 1.34, 0.1], [x, 1.62, -0.5], timber);
      for (const y of [1.16, 1.6, 2.04]) this.addBox(root, [1.74, 0.07, 0.44], [0, y, -0.5], timber);
      this.addBox(root, [1.74, 0.04, 0.06], [0, 2.24, -0.5], secondary);
      for (const x of [-0.46, 0.04]) {
        const basket = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.15, 0.26, 11, 1, true), timber);
        basket.position.set(x, 1.32, -0.5);
        root.add(basket);
        for (const y of [1.21, 1.43]) {
          const weave = new THREE.Mesh(new THREE.TorusGeometry(0.176, 0.018, 5, 12), secondary);
          weave.rotation.x = Math.PI / 2;
          weave.position.set(x, y, -0.5);
          root.add(weave);
        }
        const heap = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 7), x < 0 ? primary : secondary);
        heap.scale.y = 0.5;
        heap.position.set(x, 1.44, -0.5);
        root.add(heap);
      }
      for (let index = 0; index < 3; index += 1) {
        const x = -0.48 + index * 0.34;
        const jar = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.09, 0.24, 10), index % 2 === 0 ? primary : timber);
        jar.position.set(x, 1.76, -0.5);
        root.add(jar);
        const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.105, 0.05, 10), secondary);
        cap.position.set(x, 1.9, -0.5);
        root.add(cap);
      }
      for (const [x, material] of [[-0.34, secondary], [0.16, timber]] as Array<[number, THREE.MeshStandardMaterial]>) {
        const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.5, 10), material);
        bolt.rotation.z = Math.PI / 2;
        bolt.position.set(x, 2.19, -0.5);
        root.add(bolt);
      }
      const leaf = this.leafMaterial();
      for (const x of [0.46, 0.66]) {
        const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.14, 5), dark);
        cord.position.set(x, 1.5, -0.42);
        root.add(cord);
        const bundle = new THREE.Mesh(new THREE.SphereGeometry(0.12, 9, 7), leaf);
        bundle.scale.set(0.6, 1.1, 0.6);
        bundle.position.set(x, 1.34, -0.42);
        root.add(bundle);
      }
      const scalePost = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.44, 8), secondary);
      scalePost.position.set(0.62, 1.3, -0.24);
      root.add(scalePost);
      const beam = this.addBox(root, [0.52, 0.035, 0.035], [0.62, 1.53, -0.24], secondary);
      beam.rotation.z = 0.07;
      for (const dx of [-0.24, 0.24]) {
        const hanger = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.13, 5), dark);
        hanger.position.set(0.62 + dx, 1.47 + dx * 0.07, -0.24);
        root.add(hanger);
        const dish = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.09, 0.03, 12), secondary);
        dish.position.set(0.62 + dx, 1.4 + dx * 0.07, -0.24);
        root.add(dish);
      }
      const weighing = new THREE.Mesh(new THREE.SphereGeometry(0.07, 9, 7), primary);
      weighing.position.set(0.38, 1.44, -0.24);
      root.add(weighing);
    } else if (motif === "culinary") {
      // Level 2 slots a cast range into the deliberately empty middle of the level 1
      // prep counter, then hangs a flue and a copper pot rail over it. One fire and a
      // chopping board becomes a kitchen: an oven you can see burning, a second hob
      // with a pan on it, and three pots within the cook's reach.
      this.addBox(root, [0.94, 0.76, 0.8], [0.04, 0.52, -0.06], dark);
      this.addBox(root, [0.72, 0.52, 0.05], [0.04, 0.5, 0.36], timber);
      this.addBox(root, [0.44, 0.18, 0.04], [0.04, 0.58, 0.4], primary);
      const ovenBar = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.64, 8), secondary);
      ovenBar.rotation.z = Math.PI / 2;
      ovenBar.position.set(0.04, 0.3, 0.41);
      root.add(ovenBar);
      for (const x of [0.06, 0.44]) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.03, 6, 16), secondary);
        ring.rotation.x = Math.PI / 2;
        ring.position.set(x, 1.06, -0.2);
        root.add(ring);
      }
      const pan = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.17, 0.11, 14), secondary);
      pan.position.set(0.44, 1.12, -0.2);
      root.add(pan);
      const panStick = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.32, 6), timber);
      panStick.rotation.z = Math.PI / 2;
      panStick.position.set(0.79, 1.14, -0.2);
      root.add(panStick);
      const saute = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 6), primary);
      saute.scale.y = 0.3;
      saute.position.set(0.44, 1.16, -0.2);
      root.add(saute);

      const hood = new THREE.Mesh(new THREE.ConeGeometry(0.8, 0.6, 4, 1, true), timber);
      hood.rotation.y = Math.PI / 4;
      hood.position.set(0.04, 2.02, -0.06);
      root.add(hood);
      const collar = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.045, 6, 16), secondary);
      collar.rotation.x = Math.PI / 2;
      collar.position.set(0.04, 2.3, -0.06);
      root.add(collar);
      const flue = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.44, 10), secondary);
      flue.position.set(0.04, 2.52, -0.06);
      root.add(flue);

      const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.88, 8), secondary);
      rail.rotation.z = Math.PI / 2;
      rail.position.set(0.42, 1.8, 0.34);
      root.add(rail);
      for (let index = 0; index < 3; index += 1) {
        const x = 0.12 + index * 0.3;
        const size = 0.09 + index * 0.028;
        const hook = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.011, 5, 10, Math.PI), secondary);
        hook.position.set(x, 1.76, 0.34);
        root.add(hook);
        const hung = new THREE.Mesh(new THREE.CylinderGeometry(size, size * 0.86, size * 1.6, 12), index === 1 ? primary : secondary);
        hung.position.set(x, 1.66 - size * 0.8, 0.34);
        root.add(hung);
      }
    } else if (motif === "fitness") {
      // Level 2 finally puts a bar in the empty J-hooks the level 1 rack has been
      // holding out, loads it with a plate each side, and stands a plate tree beside
      // it. The rack stops being furniture and becomes a lift.
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 1.78, 8), dark);
      bar.rotation.z = Math.PI / 2;
      bar.position.set(0, 1.53, 0.04);
      root.add(bar);
      for (const x of [-0.26, 0.26]) {
        const knurl = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.062, 0.24, 8), timber);
        knurl.rotation.z = Math.PI / 2;
        knurl.position.set(x, 1.53, 0.04);
        root.add(knurl);
      }
      for (const x of [-0.66, 0.66]) {
        const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.31, 0.31, 0.11, 14), x < 0 ? primary : secondary);
        plate.rotation.z = Math.PI / 2;
        plate.position.set(x, 1.53, 0.04);
        root.add(plate);
        const collar = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.024, 6, 12), secondary);
        collar.rotation.y = Math.PI / 2;
        collar.position.set(x + Math.sign(x) * 0.12, 1.53, 0.04);
        root.add(collar);
      }
      const tree = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 0.86, 8), timber);
      tree.position.set(-0.98, 0.6, -0.44);
      root.add(tree);
      this.addBox(root, [0.34, 0.07, 0.34], [-0.98, 0.2, -0.44], timber);
      for (let index = 0; index < 3; index += 1) {
        const peg = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.24, 6), secondary);
        peg.rotation.x = Math.PI / 2;
        peg.position.set(-0.98, 0.44 + index * 0.24, -0.32);
        root.add(peg);
        const spare = new THREE.Mesh(new THREE.CylinderGeometry(0.19 - index * 0.03, 0.19 - index * 0.03, 0.07, 12), index === 1 ? primary : secondary);
        spare.rotation.x = Math.PI / 2;
        spare.position.set(-0.98, 0.44 + index * 0.24, -0.26);
        root.add(spare);
      }
      for (const x of [0.5, 0.86]) {
        const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.22, 8), dark);
        handle.rotation.z = Math.PI / 2;
        handle.position.set(x, 0.3, -0.4);
        root.add(handle);
        for (const dx of [-0.14, 0.14]) {
          const bell = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 7), x > 0.7 ? primary : secondary);
          bell.scale.set(0.8, 1, 1);
          bell.position.set(x + dx, 0.3, -0.4);
          root.add(bell);
        }
      }
    } else if (motif === "cinematic") {
      // Level 2 mounts the two reels the level 1 spindle was waiting for, threads a
      // film loop between them and bolts a copper lamphouse and chimney on the back.
      // From here on the machine is visibly running.
      for (const x of [-0.34, 0.34]) {
        const arm = this.addBox(root, [0.08, 0.5, 0.08], [x, 1.72, 0.04], timber);
        arm.rotation.z = x * 0.14;
        const reel = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.055, 7, 18), x < 0 ? primary : secondary);
        reel.name = "equipment-rotor";
        reel.position.set(x * 1.18, 1.98, 0.08);
        root.add(reel);
        const spool = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.1, 10), secondary);
        spool.rotation.x = Math.PI / 2;
        spool.position.set(x * 1.18, 1.98, 0.08);
        root.add(spool);
        for (let index = 0; index < 3; index += 1) {
          const spoke = this.addBox(root, [0.5, 0.03, 0.02], [x * 1.18, 1.98, 0.08], dark);
          spoke.rotation.z = index / 3 * Math.PI;
        }
      }
      this.addBox(root, [0.82, 0.025, 0.02], [0, 2.24, 0.08], dark);
      const slack = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.014, 5, 14, Math.PI), dark);
      slack.rotation.z = Math.PI;
      slack.position.set(0, 1.86, 0.08);
      root.add(slack);

      const lamphouse = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.44, 12), secondary);
      lamphouse.rotation.x = Math.PI / 2;
      lamphouse.position.set(0, 1.3, -0.44);
      root.add(lamphouse);
      const chimney = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.09, 0.46, 8), secondary);
      chimney.position.set(0, 1.72, -0.44);
      root.add(chimney);
      const vent = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.022, 5, 12), secondary);
      vent.rotation.x = Math.PI / 2;
      vent.position.set(0, 1.94, -0.44);
      root.add(vent);
      const aperture = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.026, 6, 14), primary);
      aperture.position.set(0.3, 1.3, -0.32);
      root.add(aperture);
    } else {
      for (const x of [-0.45, 0.45]) {
        const loop = new THREE.Mesh(new THREE.TorusGeometry(0.48, 0.1, 8, 18, Math.PI * 1.55), x < 0 ? primary : secondary);
        loop.rotation.z = x < 0 ? 0.5 : -2.6;
        loop.position.set(x, 1.5, 0);
        root.add(loop);
      }
      this.addBox(root, [1.65, 0.5, 0.85], [0, 0.83, 0], dark);
    }
  }

  /**
   * The fitting that says WHICH station this is, at level 3.
   *
   * The motif branches below decide what the machine is — a crusher, a range, a
   * projector — which is the identity that was missing before. But every one of them
   * dropped the upgrade key, so once a room reached level 3 all four of its stations grew
   * the same attachment: the rework won variety between businesses and lost it between
   * machines standing in the same room.
   *
   * This is small on purpose. The trade owns the silhouette; the key owns one legible
   * detail hung off it, in the same place every time so it can be learned.
   */
  private addAdvancedKeyFitting(
    key: UpgradeKey,
    root: THREE.Group,
    secondary: THREE.MeshStandardMaterial,
    dark: THREE.MeshStandardMaterial,
    cream: THREE.MeshStandardMaterial,
  ): void {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.62, 8), dark);
    post.position.set(-0.86, 1.42, 0.52);
    root.add(post);

    if (key === "yield") {
      // A grading scale: three graded cream discs on a brass arm.
      for (let index = 0; index < 3; index += 1) {
        const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.13 - index * 0.03, 0.13 - index * 0.03, 0.03, 12), cream);
        disc.position.set(-0.86 + index * 0.16, 1.76, 0.52);
        root.add(disc);
      }
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.03, 0.05), secondary);
      arm.position.set(-0.7, 1.71, 0.52);
      root.add(arm);
      return;
    }
    if (key === "capacity") {
      // A stacked hopper: two brass drums, one above the other.
      for (let index = 0; index < 2; index += 1) {
        const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.17, 0.24, 12), secondary);
        drum.position.set(-0.86, 1.82 + index * 0.27, 0.52);
        root.add(drum);
      }
      return;
    }
    if (key === "speed") {
      // A governor that actually turns, so the fast station is the one in motion.
      const hub = new THREE.Group();
      hub.name = "equipment-rotor";
      hub.position.set(-0.86, 1.84, 0.52);
      for (let index = 0; index < 3; index += 1) {
        const vane = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.02, 0.07), secondary);
        vane.rotation.y = (index / 3) * Math.PI * 2;
        hub.add(vane);
      }
      root.add(hub);
      return;
    }
    // appeal: a lit shade, the only one of the four that glows.
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.2, 10, 1, true), cream);
    shade.position.set(-0.86, 1.86, 0.52);
    root.add(shade);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), secondary);
    bulb.position.set(-0.86, 1.78, 0.52);
    root.add(bulb);
  }

  private createAdvancedModule(
    motif: InteriorEquipmentMotif,
    key: UpgradeKey,
    root: THREE.Group,
    primary: THREE.MeshStandardMaterial,
    secondary: THREE.MeshStandardMaterial,
    dark: THREE.MeshStandardMaterial,
    cream: THREE.MeshStandardMaterial,
    timber: THREE.MeshStandardMaterial,
  ): void {
    // Which station, before which trade — so the four machines in one room stay tellable
    // apart even though they now all belong to the same business.
    this.addAdvancedKeyFitting(key, root, secondary, dark, cream);
    if (motif === "botanical") {
      this.createTrellisModule(root, primary, secondary, dark, cream, timber);
      return;
    }
    if (motif === "hydraulic") {
      this.createFiltrationBank(root, primary, secondary, dark, cream, timber);
      return;
    }
    if (motif === "solar") {
      this.createHeliostatWings(root, primary, secondary, dark, cream, timber);
      return;
    }
    if (motif === "geologic") {
      this.createSluiceDeck(root, primary, secondary, dark, cream, timber);
      return;
    }
    if (motif === "forestry") {
      this.createSeasoningRack(root, primary, secondary, dark, cream, timber);
      return;
    }
    if (motif === "circular") {
      this.createReclaimCascade(root, primary, secondary, dark, cream, timber);
      return;
    }
    if (motif === "maker") {
      this.createToolWall(root, primary, secondary, dark, cream, timber);
      return;
    }
    if (motif === "industrial") {
      this.createAssemblyLine(root, primary, secondary, dark, cream, timber);
      return;
    }
    if (motif === "construction") {
      this.createScaffoldDeck(root, primary, secondary, dark, cream, timber);
      return;
    }
    if (motif === "packaging") {
      this.createFlatpackLine(root, primary, secondary, dark, cream, timber);
      return;
    }
    if (motif === "logistics") {
      this.createRouteSorter(root, primary, secondary, dark, cream, timber);
      return;
    }
    if (motif === "retail") {
      this.createServeCounter(root, primary, secondary, dark, cream, timber);
      return;
    }
    if (motif === "culinary") {
      this.createPassKitchen(root, primary, secondary, dark, cream, timber);
      return;
    }
    if (motif === "fitness") {
      this.createCircuitRig(root, primary, secondary, dark, cream, timber);
      return;
    }
    if (motif === "cinematic") {
      this.createScreenHouse(root, primary, secondary, dark, cream, timber);
      return;
    }
    if (key === "yield") {
      const sensor = new THREE.Mesh(new THREE.TorusGeometry(0.82, 0.07, 8, 24), secondary);
      sensor.name = "equipment-rotor";
      sensor.rotation.x = Math.PI / 2;
      sensor.position.y = 2.15;
      root.add(sensor);
      const probe = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1.4, 8), dark);
      probe.position.y = 1.72;
      root.add(probe);
    } else if (key === "capacity") {
      for (const x of [-0.9, 0.9]) {
        const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.34, 1.1, 10), x < 0 ? primary : secondary);
        pod.position.set(x, 1.25, 0);
        root.add(pod);
      }
      this.addBox(root, [2.1, 0.12, 0.18], [0, 1.86, 0], dark);
    } else if (key === "speed") {
      const rotor = new THREE.Mesh(new THREE.TorusGeometry(0.64, 0.14, 9, 20), secondary);
      rotor.name = "equipment-rotor";
      rotor.position.y = 1.75;
      root.add(rotor);
      for (const x of [-0.52, 0.52]) this.addBox(root, [0.18, 1.35, 0.18], [x, 1.45, 0], primary);
    } else {
      const canopy = new THREE.Mesh(new THREE.ConeGeometry(1.02, 0.52, 8, 1, true), secondary);
      canopy.position.y = 2.35;
      canopy.rotation.y = Math.PI / 8;
      root.add(canopy);
      for (const x of [-0.72, 0.72]) {
        const lantern = new THREE.Mesh(new THREE.SphereGeometry(0.16, 9, 7), primary);
        lantern.position.set(x, 1.9, 0);
        root.add(lantern);
      }
    }
  }

  private createMasterModule(
    design: InteriorEquipmentDesign,
    root: THREE.Group,
    primary: THREE.MeshStandardMaterial,
    secondary: THREE.MeshStandardMaterial,
    dark: THREE.MeshStandardMaterial,
    timber: THREE.MeshStandardMaterial,
  ): void {
    if (design.motif === "botanical") {
      this.createConservatoryCrown(root, primary, secondary, timber);
      return;
    }
    if (design.motif === "hydraulic") {
      this.createCondenserCrown(root, primary, secondary, dark);
      return;
    }
    if (design.motif === "solar") {
      this.createSolarCrown(root, primary, secondary, timber);
      return;
    }
    if (design.motif === "geologic") {
      this.createGeodeCrown(root, primary, secondary, dark, timber);
      return;
    }
    if (design.motif === "forestry") {
      this.createCanopyCrown(root, primary, secondary, dark, timber);
      return;
    }
    if (design.motif === "circular") {
      this.createLoopCrown(root, primary, secondary, dark, timber);
      return;
    }
    if (design.motif === "maker") {
      this.createArtisanCrown(root, primary, secondary, dark, timber);
      return;
    }
    if (design.motif === "industrial") {
      this.createFoundryCrown(root, primary, secondary, dark, timber);
      return;
    }
    if (design.motif === "construction") {
      this.createSkylineCrown(root, primary, secondary, dark, timber);
      return;
    }
    if (design.motif === "packaging") {
      this.createPackhouseCrown(root, primary, secondary, dark, timber);
      return;
    }
    if (design.motif === "logistics") {
      this.createQuayCrown(root, primary, secondary, dark, timber);
      return;
    }
    if (design.motif === "retail") {
      this.createLanternCanopy(root, primary, secondary, dark, timber);
      return;
    }
    if (design.motif === "culinary") {
      this.createHearthCrown(root, primary, secondary, dark, timber);
      return;
    }
    if (design.motif === "fitness") {
      this.createWellnessGrove(root, primary, secondary, dark, timber);
      return;
    }
    if (design.motif === "cinematic") {
      this.createMarqueeCrown(root, primary, secondary, dark, timber);
      return;
    }
    const seed = [...design.form].reduce((total, character) => total + character.charCodeAt(0), 0);
    const beacon = new THREE.Mesh(
      seed % 2 === 0 ? new THREE.OctahedronGeometry(0.28, 0) : new THREE.IcosahedronGeometry(0.27, 0),
      secondary,
    );
    beacon.name = "equipment-pulse";
    beacon.position.y = 2.76;
    root.add(beacon);
    const satelliteCount = 2 + seed % 3;
    for (let index = 0; index < satelliteCount; index += 1) {
      const angle = index / satelliteCount * Math.PI * 2;
      const satellite = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), primary);
      satellite.position.set(Math.cos(angle) * 0.55, 2.7 + (index % 2) * 0.13, Math.sin(angle) * 0.55);
      root.add(satellite);
    }
  }

  private createQualityMachine(
    root: THREE.Group,
    accent: THREE.MeshStandardMaterial,
    dark: THREE.MeshStandardMaterial,
    cream: THREE.MeshStandardMaterial,
  ): void {
    const vat = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.72, 1.4, 14), dark);
    vat.position.y = 1.18;
    vat.castShadow = true;
    root.add(vat);
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.65, 0.08, 8, 20), accent);
    band.rotation.x = Math.PI / 2;
    band.position.y = 1.35;
    root.add(band);
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.48, 0.28, 14), cream);
    bowl.position.y = 1.96;
    root.add(bowl);
    for (const side of [-1, 1]) {
      const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 7), accent);
      leaf.scale.set(0.55, 1.25, 0.32);
      leaf.rotation.z = side * 0.62;
      leaf.position.set(side * 0.28, 2.34, 0);
      root.add(leaf);
    }
  }

  private createCapacityMachine(
    root: THREE.Group,
    accent: THREE.MeshStandardMaterial,
    dark: THREE.MeshStandardMaterial,
    timber: THREE.MeshStandardMaterial,
  ): void {
    this.addBox(root, [1.75, 0.16, 1.15], [0, 0.72, 0], timber);
    for (const x of [-0.58, 0, 0.58]) {
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.31, 1.3, 12), x === 0 ? accent : dark);
      tank.position.set(x, 1.44, 0);
      tank.castShadow = true;
      root.add(tank);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 7), accent);
      cap.scale.y = 0.45;
      cap.position.set(x, 2.1, 0);
      root.add(cap);
    }
    this.addBox(root, [1.9, 0.12, 0.18], [0, 2.28, 0], timber);
  }

  private createFlowMachine(
    root: THREE.Group,
    accent: THREE.MeshStandardMaterial,
    dark: THREE.MeshStandardMaterial,
    cream: THREE.MeshStandardMaterial,
  ): void {
    this.addBox(root, [1.8, 0.45, 1.2], [0, 0.82, 0], dark);
    for (const z of [-0.34, 0, 0.34]) {
      const roller = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 1.55, 12), accent);
      roller.rotation.z = Math.PI / 2;
      roller.position.set(0, 1.12, z);
      roller.name = "flow-roller";
      root.add(roller);
    }
    const console = this.addBox(root, [1.25, 0.76, 0.25], [0, 1.76, -0.32], cream);
    console.rotation.x = -0.28;
    for (const x of [-0.34, 0, 0.34]) {
      const light = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), accent);
      light.position.set(x, 1.82, -0.48);
      root.add(light);
    }
  }

  private createAppealMachine(
    root: THREE.Group,
    accent: THREE.MeshStandardMaterial,
    dark: THREE.MeshStandardMaterial,
    timber: THREE.MeshStandardMaterial,
  ): void {
    this.addBox(root, [1.4, 0.6, 1.0], [0, 0.8, 0], timber);
    this.addBox(root, [1.65, 1.18, 0.18], [0, 1.68, -0.18], dark);
    const screen = this.addBox(root, [1.32, 0.85, 0.08], [0, 1.7, -0.31], accent);
    screen.material.emissiveIntensity = 0.75;
    for (const side of [-1, 1]) {
      const lantern = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8), accent);
      lantern.scale.y = 1.35;
      lantern.position.set(side * 0.9, 1.68, 0);
      root.add(lantern);
    }
  }

  /**
   * Level 1 — the bare starting machine, in the shape of the trade.
   *
   * A greenhouse opens with a seed trough, an aquaworks with an open catch basin, a
   * sungrid with one panel on a post. The motif decides the form and the upgrade key
   * only bolts one small fitting onto it, so a glance reads the trade first and the
   * key second. All fifteen motifs now return from their own branch — the four generic
   * frames below are the landing place for a motif added LATER, not a path anything
   * currently takes. Kept deliberately: deleting them would make the next trade added to
   * the game render nothing at all rather than something plain.
   */
  private createBaseMachine(
    motif: InteriorEquipmentMotif,
    key: UpgradeKey,
    root: THREE.Group,
    primary: THREE.MeshStandardMaterial,
    secondary: THREE.MeshStandardMaterial,
    dark: THREE.MeshStandardMaterial,
    cream: THREE.MeshStandardMaterial,
    timber: THREE.MeshStandardMaterial,
  ): void {
    if (motif === "botanical") {
      this.createSeedTrough(key, root, primary, secondary, dark, cream, timber);
      return;
    }
    if (motif === "hydraulic") {
      this.createCatchBasin(key, root, primary, secondary, dark, cream, timber);
      return;
    }
    if (motif === "solar") {
      this.createPanelPost(key, root, primary, secondary, dark, cream, timber);
      return;
    }
    if (motif === "geologic") {
      this.createOreCradle(key, root, primary, secondary, dark, cream, timber);
      return;
    }
    if (motif === "forestry") {
      this.createSawTrestle(key, root, primary, secondary, dark, cream, timber);
      return;
    }
    if (motif === "circular") {
      this.createSortingBench(key, root, primary, secondary, dark, cream, timber);
      return;
    }
    if (motif === "maker") {
      this.createJoinersBench(key, root, primary, secondary, dark, cream, timber);
      return;
    }
    if (motif === "industrial") {
      this.createForgeHearth(key, root, primary, secondary, dark, cream, timber);
      return;
    }
    if (motif === "construction") {
      this.createSiteTrestle(key, root, primary, secondary, dark, cream, timber);
      return;
    }
    if (motif === "packaging") {
      this.createFoldingTable(key, root, primary, secondary, dark, cream, timber);
      return;
    }
    if (motif === "logistics") {
      this.createDispatchCart(key, root, primary, secondary, dark, cream, timber);
      return;
    }
    if (motif === "retail") {
      this.createMarketStall(key, root, primary, secondary, dark, cream, timber);
      return;
    }
    if (motif === "culinary") {
      this.createHearthBench(key, root, primary, secondary, dark, cream, timber);
      return;
    }
    if (motif === "fitness") {
      this.createTrainingPlatform(key, root, primary, secondary, dark, cream, timber);
      return;
    }
    if (motif === "cinematic") {
      this.createLanternProjector(key, root, primary, secondary, dark, cream, timber);
      return;
    }
    if (key === "yield") this.createQualityMachine(root, primary, dark, cream);
    else if (key === "capacity") this.createCapacityMachine(root, primary, dark, timber);
    else if (key === "speed") this.createFlowMachine(root, primary, dark, cream);
    else this.createAppealMachine(root, primary, dark, timber);
  }

  /**
   * Botanical level 1 — a timber seed trough on legs, three sprouts in dark soil.
   *
   * Deliberately the humblest machine in the room: no glass, no brass, nothing that
   * moves. Everything the greenhouse grows into later hangs off this one bench.
   */
  private createSeedTrough(
    key: UpgradeKey,
    root: THREE.Group,
    primary: THREE.MeshStandardMaterial,
    secondary: THREE.MeshStandardMaterial,
    dark: THREE.MeshStandardMaterial,
    cream: THREE.MeshStandardMaterial,
    timber: THREE.MeshStandardMaterial,
  ): void {
    for (const x of [-0.62, 0.62]) {
      for (const z of [-0.32, 0.32]) this.addBox(root, [0.12, 0.62, 0.12], [x, 0.61, z], timber);
    }
    this.addBox(root, [1.5, 0.1, 0.92], [0, 0.87, 0], timber);
    for (const z of [-0.46, 0.46]) this.addBox(root, [1.5, 0.32, 0.09], [0, 1.06, z], timber);
    for (const x of [-0.75, 0.75]) this.addBox(root, [0.09, 0.32, 0.92], [x, 1.06, 0], timber);
    this.addBox(root, [1.34, 0.2, 0.78], [0, 1.0, 0], dark);

    for (const x of [-0.44, 0, 0.44]) {
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.055, 0.32, 6), primary);
      stem.position.set(x, 1.26, 0);
      root.add(stem);
      for (const side of [-1, 1]) {
        const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), side < 0 ? primary : secondary);
        leaf.scale.set(1, 0.3, 0.55);
        leaf.rotation.z = side * 0.5;
        leaf.position.set(x + side * 0.13, 1.4, 0);
        root.add(leaf);
      }
    }

    if (key === "yield") {
      const cloche = new THREE.Mesh(
        new THREE.SphereGeometry(0.3, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
        cream,
      );
      cloche.position.set(0, 1.14, 0);
      root.add(cloche);
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), secondary);
      knob.position.set(0, 1.46, 0);
      root.add(knob);
    } else if (key === "capacity") {
      this.addBox(root, [1.5, 0.08, 0.86], [0, 0.6, 0], timber);
      for (const x of [-0.42, 0.42]) {
        const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.13, 0.24, 10), cream);
        pot.position.set(x, 0.76, 0);
        root.add(pot);
        const fill = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.05, 10), dark);
        fill.position.set(x, 0.87, 0);
        root.add(fill);
      }
    } else if (key === "speed") {
      for (const x of [-0.68, 0.68]) this.addBox(root, [0.05, 0.52, 0.05], [x, 1.46, -0.3], timber);
      const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1.42, 8), secondary);
      rail.rotation.z = Math.PI / 2;
      rail.position.set(0, 1.7, -0.3);
      root.add(rail);
      for (const x of [-0.44, 0, 0.44]) {
        const drop = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), primary);
        drop.scale.y = 1.5;
        drop.position.set(x, 1.58, -0.3);
        root.add(drop);
      }
    } else {
      this.addBox(root, [1.36, 0.24, 0.05], [0, 1.06, 0.53], cream);
      for (const x of [-0.55, 0.55]) {
        const bloom = new THREE.Mesh(new THREE.SphereGeometry(0.12, 9, 7), secondary);
        bloom.position.set(x, 1.32, 0.24);
        root.add(bloom);
        const bud = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), primary);
        bud.position.set(x, 1.44, 0.24);
        root.add(bud);
      }
    }
  }

  /**
   * Hydraulic level 1 — an open catch basin on a timber counter, fed by one brass spout.
   *
   * Sits left of centre so the level 2 reservoir can stand beside it rather than
   * inside it; the water is a thin lit disc, which is the cheapest honest water there is.
   */
  private createCatchBasin(
    key: UpgradeKey,
    root: THREE.Group,
    primary: THREE.MeshStandardMaterial,
    secondary: THREE.MeshStandardMaterial,
    dark: THREE.MeshStandardMaterial,
    cream: THREE.MeshStandardMaterial,
    timber: THREE.MeshStandardMaterial,
  ): void {
    this.addBox(root, [0.9, 0.14, 0.88], [-0.24, 0.79, 0], timber);
    for (const x of [-0.6, 0.1]) {
      for (const z of [-0.32, 0.32]) this.addBox(root, [0.11, 0.72, 0.11], [x, 0.5, z], timber);
    }

    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.34, 0.36, 14), dark);
    bowl.position.set(-0.26, 1.04, 0);
    root.add(bowl);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.44, 0.045, 6, 18), secondary);
    rim.rotation.x = Math.PI / 2;
    rim.position.set(-0.26, 1.21, 0);
    root.add(rim);
    const water = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.05, 14), primary);
    water.position.set(-0.26, 1.16, 0);
    root.add(water);

    const column = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 1.0, 8), secondary);
    column.position.set(-0.86, 1.34, 0);
    root.add(column);
    const elbow = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.055, 6, 14, Math.PI / 2), secondary);
    elbow.rotation.z = Math.PI;
    elbow.position.set(-0.56, 1.84, 0);
    root.add(elbow);
    const fall = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.055, 0.38, 7), primary);
    fall.position.set(-0.56, 1.34, 0);
    root.add(fall);

    if (key === "yield") {
      for (const x of [-0.56, 0.04]) this.addBox(root, [0.04, 0.28, 0.04], [x, 1.48, 0], secondary);
      const sieve = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.06, 12), cream);
      sieve.position.set(-0.26, 1.62, 0);
      root.add(sieve);
      for (const x of [-0.42, -0.1]) {
        const drip = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), primary);
        drip.scale.y = 1.4;
        drip.position.set(x, 1.44, 0.06);
        root.add(drip);
      }
    } else if (key === "capacity") {
      const sump = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.24, 0.4, 12), dark);
      sump.position.set(-0.24, 0.44, 0);
      root.add(sump);
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.035, 6, 16), secondary);
      band.rotation.x = Math.PI / 2;
      band.position.set(-0.24, 0.58, 0);
      root.add(band);
      const downpipe = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.3, 7), secondary);
      downpipe.position.set(-0.24, 0.78, 0);
      root.add(downpipe);
    } else if (key === "speed") {
      const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.045, 6, 14), secondary);
      wheel.name = "equipment-rotor";
      wheel.position.set(-0.26, 1.3, 0);
      root.add(wheel);
      for (let index = 0; index < 4; index += 1) {
        const angle = index * Math.PI / 2;
        const paddle = this.addBox(
          wheel,
          [0.3, 0.07, 0.3],
          [Math.cos(angle) * 0.15, Math.sin(angle) * 0.15, 0],
          cream,
        );
        paddle.rotation.z = angle;
      }
      const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.62, 6), dark);
      axle.rotation.x = Math.PI / 2;
      axle.position.set(-0.26, 1.3, 0);
      root.add(axle);
      for (const z of [-0.3, 0.3]) this.addBox(root, [0.07, 0.5, 0.07], [-0.26, 1.12, z], timber);
    } else {
      this.addBox(root, [0.07, 0.6, 0.07], [-0.86, 1.42, 0.34], timber);
      this.addBox(root, [0.9, 0.07, 0.07], [-0.46, 1.7, 0.34], timber);
      for (const x of [-0.66, -0.2]) {
        const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.22, 5), dark);
        cord.position.set(x, 1.58, 0.34);
        root.add(cord);
        const lantern = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), primary);
        lantern.scale.y = 1.2;
        lantern.position.set(x, 1.4, 0.34);
        root.add(lantern);
      }
    }
  }

  /**
   * Solar level 1 — one tilted panel on a short mast, standing forward of centre.
   *
   * Forward, because the level 2 collector hub grows up the middle of the station and
   * would otherwise swallow the mast whole; kept there, the first panel stays readable
   * as the thing the array was built around.
   */
  private createPanelPost(
    key: UpgradeKey,
    root: THREE.Group,
    primary: THREE.MeshStandardMaterial,
    secondary: THREE.MeshStandardMaterial,
    dark: THREE.MeshStandardMaterial,
    cream: THREE.MeshStandardMaterial,
    timber: THREE.MeshStandardMaterial,
  ): void {
    this.addBox(root, [0.78, 0.26, 0.78], [0, 0.63, 0.3], timber);
    this.addBox(root, [0.86, 0.06, 0.86], [0, 0.79, 0.3], secondary);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.9, 8), dark);
    mast.position.set(0, 1.24, 0.3);
    root.add(mast);

    const panel = new THREE.Group();
    panel.position.set(0, 1.72, 0.3);
    panel.rotation.x = -0.55;
    root.add(panel);
    this.addBox(panel, [1.16, 0.04, 0.78], [0, -0.035, 0], secondary);
    this.addBox(panel, [1.06, 0.05, 0.68], [0, 0, 0], dark);
    for (const x of [-0.34, 0, 0.34]) this.addBox(panel, [0.025, 0.025, 0.66], [x, 0.035, 0], cream);

    if (key === "yield") {
      const reflector = this.addBox(root, [1.0, 0.04, 0.34], [0, 1.36, 0.72], cream);
      reflector.rotation.x = 0.62;
      const sensor = new THREE.Mesh(new THREE.SphereGeometry(0.08, 9, 7), primary);
      sensor.position.set(0.5, 1.5, 0.5);
      root.add(sensor);
    } else if (key === "capacity") {
      for (const x of [-0.45, 0.45]) {
        const jar = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.46, 10), secondary);
        jar.position.set(x, 0.99, 0.3);
        root.add(jar);
        const cap = new THREE.Mesh(new THREE.SphereGeometry(0.15, 9, 7), primary);
        cap.scale.y = 0.5;
        cap.position.set(x, 1.24, 0.3);
        root.add(cap);
      }
    } else if (key === "speed") {
      const gear = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.05, 6, 12), primary);
      gear.name = "equipment-rotor";
      gear.position.set(0, 1.6, 0.3);
      root.add(gear);
      for (let index = 0; index < 6; index += 1) {
        const angle = index * Math.PI / 3;
        const tooth = this.addBox(
          gear,
          [0.1, 0.06, 0.08],
          [Math.cos(angle) * 0.17, Math.sin(angle) * 0.17, 0],
          secondary,
        );
        tooth.rotation.z = angle;
      }
      const drive = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.44, 6), dark);
      drive.rotation.z = 0.5;
      drive.position.set(0.24, 1.44, 0.3);
      root.add(drive);
    } else {
      const shade = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.2, 10, 1, true), cream);
      shade.position.set(0, 1.5, 0.62);
      root.add(shade);
      const lantern = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), primary);
      lantern.scale.y = 1.15;
      lantern.position.set(0, 1.34, 0.62);
      root.add(lantern);
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.36, 6), secondary);
      arm.rotation.x = Math.PI / 2;
      arm.position.set(0, 1.56, 0.46);
      root.add(arm);
    }
  }

  /**
   * Botanical level 3 — a timber trellis grown across the trough, with hanging
   * planters and a misting ring. Read together with levels 1 and 2 it is the moment
   * the greenhouse stops being a bench and becomes a growing frame.
   */
  private createTrellisModule(
    root: THREE.Group,
    primary: THREE.MeshStandardMaterial,
    secondary: THREE.MeshStandardMaterial,
    dark: THREE.MeshStandardMaterial,
    cream: THREE.MeshStandardMaterial,
    timber: THREE.MeshStandardMaterial,
  ): void {
    for (const x of [-0.78, 0.78]) this.addBox(root, [0.1, 1.62, 0.1], [x, 1.5, -0.12], timber);
    for (const y of [1.06, 1.56, 2.06]) this.addBox(root, [1.66, 0.07, 0.07], [0, y, -0.12], timber);
    for (const x of [-0.26, 0.26]) this.addBox(root, [0.06, 1.5, 0.06], [x, 1.55, -0.12], timber);

    for (let index = 0; index < 7; index += 1) {
      const along = index / 6;
      const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), index % 2 === 0 ? primary : secondary);
      leaf.scale.set(1, 0.32, 0.6);
      leaf.rotation.z = (index % 2 === 0 ? 1 : -1) * 0.6;
      leaf.position.set(-0.78 + along * 1.56, 1.5 + Math.sin(along * Math.PI * 2) * 0.44, -0.04);
      root.add(leaf);
    }

    for (const x of [-0.78, 0.78]) {
      this.addBox(root, [0.07, 0.07, 0.5], [x, 2.06, 0.14], timber);
      const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.3, 5), dark);
      cord.position.set(x, 1.9, 0.36);
      root.add(cord);
      const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.15, 0.26, 10), cream);
      pot.position.set(x, 1.62, 0.36);
      root.add(pot);
      const spill = new THREE.Mesh(new THREE.SphereGeometry(0.19, 9, 7), secondary);
      spill.scale.set(1, 0.7, 1);
      spill.position.set(x, 1.44, 0.36);
      root.add(spill);
    }

    const mist = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.035, 6, 20), primary);
    mist.rotation.x = Math.PI / 2;
    mist.position.y = 2.3;
    root.add(mist);
    for (let index = 0; index < 4; index += 1) {
      const angle = index * Math.PI / 2 + Math.PI / 4;
      const nozzle = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), secondary);
      nozzle.position.set(Math.cos(angle) * 0.6, 2.23, Math.sin(angle) * 0.6);
      root.add(nozzle);
    }
  }

  /**
   * Hydraulic level 3 — a back rank of two glass filtration columns under a brass
   * header, plus a gauge on the counter. Standing behind the level 2 reservoir keeps
   * the silhouette clear from the front while making the machine plainly deeper.
   */
  private createFiltrationBank(
    root: THREE.Group,
    primary: THREE.MeshStandardMaterial,
    secondary: THREE.MeshStandardMaterial,
    dark: THREE.MeshStandardMaterial,
    cream: THREE.MeshStandardMaterial,
    timber: THREE.MeshStandardMaterial,
  ): void {
    const glass = new THREE.MeshStandardMaterial({
      color: 0xd6f0ea,
      roughness: 0.14,
      metalness: 0.06,
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
    });

    for (const x of [-0.85, 0.85]) {
      const column = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 1.24, 12), glass);
      column.position.set(x, 1.46, -0.62);
      root.add(column);
      for (const y of [0.86, 2.06]) {
        const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.09, 12), secondary);
        collar.position.set(x, y, -0.62);
        root.add(collar);
      }
      const bed = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.21, 0.34, 12), dark);
      bed.position.set(x, 1.07, -0.62);
      root.add(bed);
      const charge = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.3, 12), primary);
      charge.position.set(x, 1.62, -0.62);
      root.add(charge);
      this.addBox(root, [0.16, 0.1, 0.34], [x, 0.79, -0.62], timber);
    }

    const header = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.38, 8), secondary);
    header.rotation.z = Math.PI / 2;
    header.position.set(0, 2.22, -0.62);
    root.add(header);
    for (const side of [-1, 1]) {
      const elbow = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.055, 6, 12, Math.PI / 2), secondary);
      elbow.rotation.z = side < 0 ? Math.PI / 2 : 0;
      elbow.position.set(side * 0.69, 2.06, -0.62);
      root.add(elbow);
    }

    const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.42, 6), secondary);
    stand.position.set(0.34, 1.2, 0.2);
    root.add(stand);
    const dial = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.06, 14), cream);
    dial.rotation.x = Math.PI / 2;
    dial.position.set(0.34, 1.46, 0.2);
    root.add(dial);
    const bezel = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.03, 6, 16), secondary);
    bezel.position.set(0.34, 1.46, 0.2);
    root.add(bezel);
    this.addBox(root, [0.02, 0.11, 0.02], [0.34, 1.51, 0.24], dark);
  }

  /**
   * Solar level 3 — two heliostat mirror wings on brass arms, a toothed tracker
   * collar that actually turns, and a charge stack behind. The station stops being a
   * panel and becomes an array you can see aiming itself.
   */
  private createHeliostatWings(
    root: THREE.Group,
    primary: THREE.MeshStandardMaterial,
    secondary: THREE.MeshStandardMaterial,
    dark: THREE.MeshStandardMaterial,
    cream: THREE.MeshStandardMaterial,
    timber: THREE.MeshStandardMaterial,
  ): void {
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.06, 8, 20), primary);
    collar.name = "equipment-rotor";
    collar.position.y = 1.42;
    root.add(collar);
    for (let index = 0; index < 8; index += 1) {
      const angle = index * Math.PI / 4;
      const tooth = this.addBox(
        collar,
        [0.13, 0.07, 0.1],
        [Math.cos(angle) * 0.5, Math.sin(angle) * 0.5, 0],
        secondary,
      );
      tooth.rotation.z = angle;
    }

    for (const side of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.62, 8), dark);
      arm.rotation.z = Math.PI / 2;
      arm.position.set(side * 0.66, 1.78, 0);
      root.add(arm);
      const wing = new THREE.Group();
      wing.position.set(side * 1.0, 1.82, 0);
      wing.rotation.z = -side * 0.42;
      root.add(wing);
      this.addBox(wing, [0.5, 0.04, 0.62], [0, 0, 0], cream);
      this.addBox(wing, [0.56, 0.03, 0.68], [0, -0.035, 0], secondary);
      this.addBox(root, [0.07, 0.42, 0.07], [side * 1.0, 1.6, 0], timber);
    }

    const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.22, 0.78, 10), secondary);
    stack.position.set(0, 1.16, -0.62);
    root.add(stack);
    for (const y of [0.94, 1.38]) {
      const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.03, 6, 14), timber);
      hoop.rotation.x = Math.PI / 2;
      hoop.position.set(0, y, -0.62);
      root.add(hoop);
    }
    const charge = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), primary);
    charge.position.set(0, 1.62, -0.62);
    root.add(charge);
  }

  /**
   * Botanical level 4 — the trellis is roofed over in a ribbed glass dome and the
   * whole station reads as a finished conservatory. Nothing else in the ladder puts
   * a roof on, so level 4 is unmistakable from across the room.
   */
  private createConservatoryCrown(
    root: THREE.Group,
    primary: THREE.MeshStandardMaterial,
    secondary: THREE.MeshStandardMaterial,
    timber: THREE.MeshStandardMaterial,
  ): void {
    const glass = new THREE.MeshStandardMaterial({
      color: 0xd8f2df,
      roughness: 0.12,
      metalness: 0.04,
      transparent: true,
      opacity: 0.26,
      depthWrite: false,
    });
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(0.9, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2),
      glass,
    );
    dome.position.y = 1.95;
    root.add(dome);

    for (let index = 0; index < 4; index += 1) {
      const rib = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.028, 5, 14, Math.PI), timber);
      rib.rotation.y = index * Math.PI / 4;
      rib.position.y = 1.95;
      root.add(rib);
    }
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.05, 6, 24), timber);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 1.95;
    root.add(ring);

    for (let index = 0; index < 3; index += 1) {
      const angle = index / 3 * Math.PI * 2 + 0.4;
      const fruit = new THREE.Mesh(new THREE.SphereGeometry(0.1, 9, 7), index === 1 ? primary : secondary);
      fruit.position.set(Math.cos(angle) * 0.46, 2.36, Math.sin(angle) * 0.46);
      root.add(fruit);
    }

    const finial = new THREE.Mesh(new THREE.OctahedronGeometry(0.19, 0), secondary);
    finial.name = "equipment-pulse";
    finial.position.y = 2.86;
    root.add(finial);
    const bloom = new THREE.Mesh(new THREE.SphereGeometry(0.09, 9, 7), primary);
    bloom.position.y = 2.72;
    root.add(bloom);
  }

  /**
   * Hydraulic level 4 — a brass condensing coil crowns the column bank and three
   * sheets of water fall from the header into a catch trough. Water you can see
   * moving, which is the point of the whole trade.
   */
  private createCondenserCrown(
    root: THREE.Group,
    primary: THREE.MeshStandardMaterial,
    secondary: THREE.MeshStandardMaterial,
    dark: THREE.MeshStandardMaterial,
  ): void {
    const sheet = new THREE.MeshStandardMaterial({
      color: 0xbfe6ef,
      roughness: 0.1,
      metalness: 0.05,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
    });

    const coilRadii = [0.62, 0.54, 0.45, 0.34];
    coilRadii.forEach((radius, index) => {
      const loop = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.05, 6, 20), secondary);
      loop.rotation.x = Math.PI / 2;
      loop.position.y = 2.3 + index * 0.15;
      root.add(loop);
    });
    const spindle = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.6, 8), dark);
    spindle.position.y = 2.5;
    root.add(spindle);

    for (const x of [-0.45, 0, 0.45]) {
      const fall = this.addBox(root, [0.3, 0.8, 0.02], [x, 1.95, -0.62], sheet);
      fall.castShadow = false;
    }
    this.addBox(root, [1.3, 0.12, 0.32], [0, 1.5, -0.62], dark);
    for (const x of [-0.45, 0, 0.45]) {
      const splash = new THREE.Mesh(new THREE.SphereGeometry(0.09, 9, 7), primary);
      splash.scale.y = 0.55;
      splash.position.set(x, 1.58, -0.62);
      root.add(splash);
    }

    const droplet = new THREE.Mesh(new THREE.IcosahedronGeometry(0.2, 0), primary);
    droplet.name = "equipment-pulse";
    droplet.position.y = 2.86;
    root.add(droplet);
  }

  /**
   * Solar level 4 — a ring of louvred collectors and a lit spire above the wings,
   * with warm lanterns hung under the crown. The array finally looks like it is
   * collecting from every direction at once.
   */
  private createSolarCrown(
    root: THREE.Group,
    primary: THREE.MeshStandardMaterial,
    secondary: THREE.MeshStandardMaterial,
    timber: THREE.MeshStandardMaterial,
  ): void {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.05, 6, 24), timber);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 2.38;
    root.add(ring);

    for (let index = 0; index < 6; index += 1) {
      const angle = index / 6 * Math.PI * 2;
      const bay = new THREE.Group();
      bay.rotation.y = -angle;
      bay.position.y = 2.44;
      root.add(bay);
      const louvre = this.addBox(bay, [0.34, 0.04, 0.26], [0.7, 0, 0], secondary);
      louvre.rotation.z = 0.5;
      const cell = this.addBox(bay, [0.28, 0.03, 0.2], [0.7, 0.045, 0], primary);
      cell.rotation.z = 0.5;
      this.addBox(bay, [0.06, 0.16, 0.06], [0.7, -0.11, 0], timber);
    }

    const spire = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.44, 8), secondary);
    spire.position.y = 2.62;
    root.add(spire);
    const beacon = new THREE.Mesh(new THREE.OctahedronGeometry(0.16, 0), primary);
    beacon.name = "equipment-pulse";
    beacon.position.y = 2.88;
    root.add(beacon);

    for (let index = 0; index < 3; index += 1) {
      const angle = index / 3 * Math.PI * 2 + 0.6;
      const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.2, 5), timber);
      cord.position.set(Math.cos(angle) * 0.7, 2.28, Math.sin(angle) * 0.7);
      root.add(cord);
      const lantern = new THREE.Mesh(new THREE.SphereGeometry(0.11, 9, 7), primary);
      lantern.position.set(Math.cos(angle) * 0.7, 2.13, Math.sin(angle) * 0.7);
      root.add(lantern);
    }
  }


  /**
   * Living green, independent of the station's accent colour.
   *
   * Planting reads as planting only if it is the colour of a leaf: the mine's appeal
   * accent is pale blue and the timberyard's is gold, so moss and canopy drawn in the
   * station palette came out as blue fuzz and cream popcorn. Foliage gets its own
   * material for the same reason glass and water do.
   */
  private leafMaterial(): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({ color: 0x86ae5f, roughness: 0.78, metalness: 0.02 });
  }

  /**
   * Geologic level 1 — a stone crusher bed on timber sleepers, with a hand crank
   * and a feed chute. No moving jaw, no screening, no lamps: the mine starts with
   * rock, a bench to break it on, and somebody's arm. Every later level bolts onto
   * this bed, so the crusher never stops being the thing at the middle of the mine.
   */
  private createOreCradle(
    key: UpgradeKey,
    root: THREE.Group,
    primary: THREE.MeshStandardMaterial,
    secondary: THREE.MeshStandardMaterial,
    dark: THREE.MeshStandardMaterial,
    cream: THREE.MeshStandardMaterial,
    timber: THREE.MeshStandardMaterial,
  ): void {
    const stone = new THREE.MeshStandardMaterial({ color: 0x9a9288, roughness: 0.94, metalness: 0.02 });

    for (const z of [-0.4, 0.4]) this.addBox(root, [1.46, 0.16, 0.18], [0, 0.57, z], timber);
    this.addBox(root, [1.3, 0.34, 0.84], [0, 0.82, 0], stone);
    this.addBox(root, [1.36, 0.07, 0.9], [0, 1.02, 0], secondary);

    for (const side of [-1, 1]) {
      const slab = this.addBox(root, [0.6, 0.06, 0.78], [side * 0.29, 1.14, 0], stone);
      slab.rotation.z = side * 0.42;
    }
    for (const [x, z] of [[-0.15, 0.1], [0.17, -0.08]] as Array<[number, number]>) {
      const lump = new THREE.Mesh(new THREE.DodecahedronGeometry(0.11, 0), dark);
      lump.position.set(x, 1.16, z);
      root.add(lump);
    }

    for (const x of [-0.34, 0.34]) this.addBox(root, [0.09, 0.66, 0.09], [x, 1.3, -0.6], timber);
    const chute = this.addBox(root, [0.78, 0.06, 0.62], [0, 1.62, -0.54], timber);
    chute.rotation.x = 0.5;
    for (const x of [-0.39, 0.39]) {
      const rail = this.addBox(root, [0.05, 0.16, 0.62], [x, 1.66, -0.54], timber);
      rail.rotation.x = 0.5;
    }
    const feed = new THREE.Mesh(new THREE.DodecahedronGeometry(0.1, 0), primary);
    feed.position.set(0, 1.72, -0.68);
    root.add(feed);

    const crank = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.04, 6, 14), secondary);
    crank.position.set(0.84, 1.12, -0.3);
    root.add(crank);
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.14, 6), timber);
    grip.rotation.x = Math.PI / 2;
    grip.position.set(0.99, 1.12, -0.3);
    root.add(grip);

    if (key === "yield") {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.055, 0.5, 6), secondary);
      post.position.set(-0.68, 1.34, 0.3);
      root.add(post);
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.44, 6), secondary);
      arm.rotation.z = Math.PI / 2;
      arm.position.set(-0.46, 1.57, 0.3);
      root.add(arm);
      const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.02, 12), cream);
      lens.position.set(-0.26, 1.5, 0.3);
      root.add(lens);
      const bezel = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.028, 6, 14), secondary);
      bezel.rotation.x = Math.PI / 2;
      bezel.position.set(-0.26, 1.5, 0.3);
      root.add(bezel);
      const specimen = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.24, 5), primary);
      specimen.position.set(-0.26, 1.14, 0.3);
      root.add(specimen);
    } else if (key === "capacity") {
      this.addBox(root, [0.5, 0.48, 0.62], [-0.95, 0.75, 0], stone);
      this.addBox(root, [0.55, 0.07, 0.67], [-0.95, 0.99, 0], secondary);
      for (const [x, z] of [[-1.02, 0.1], [-0.86, -0.09]] as Array<[number, number]>) {
        const load = new THREE.Mesh(new THREE.DodecahedronGeometry(0.1, 0), primary);
        load.position.set(x, 1.06, z);
        root.add(load);
      }
    } else if (key === "speed") {
      const flywheel = new THREE.Group();
      flywheel.name = "equipment-rotor";
      flywheel.position.set(0.86, 1.24, 0.42);
      root.add(flywheel);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.045, 6, 16), secondary);
      flywheel.add(rim);
      for (let index = 0; index < 3; index += 1) {
        const spoke = this.addBox(flywheel, [0.48, 0.045, 0.04], [0, 0, 0], timber);
        spoke.rotation.z = index * Math.PI / 3;
      }
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.1, 8), dark);
      hub.rotation.x = Math.PI / 2;
      flywheel.add(hub);
      const pitman = this.addBox(root, [0.05, 0.5, 0.05], [0.58, 1.4, 0.42], dark);
      pitman.rotation.z = 0.5;
      const striker = this.addBox(root, [0.24, 0.3, 0.24], [0.34, 1.56, 0.1], dark);
      striker.rotation.z = 0.1;
    } else {
      const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.24, 0.42, 10), timber);
      pedestal.position.set(0.74, 0.7, 0.5);
      root.add(pedestal);
      const showpiece = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.44, 5), primary);
      showpiece.position.set(0.74, 1.13, 0.5);
      root.add(showpiece);
      this.addBox(root, [0.07, 0.86, 0.07], [-0.9, 0.94, 0.46], timber);
      this.addBox(root, [0.36, 0.07, 0.07], [-0.74, 1.34, 0.46], timber);
      const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.16, 5), dark);
      cord.position.set(-0.58, 1.24, 0.46);
      root.add(cord);
      const lantern = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), primary);
      lantern.scale.y = 1.2;
      lantern.position.set(-0.58, 1.08, 0.46);
      root.add(lantern);
    }
  }

  /**
   * Forestry level 1 — a log across two trestles, a hand saw leaning on it, curls of
   * shaving on the floor and one sapling in a pot. Nothing is powered yet; the whole
   * of level 1 is what two people and an afternoon can do.
   */
  private createSawTrestle(
    key: UpgradeKey,
    root: THREE.Group,
    primary: THREE.MeshStandardMaterial,
    secondary: THREE.MeshStandardMaterial,
    dark: THREE.MeshStandardMaterial,
    cream: THREE.MeshStandardMaterial,
    timber: THREE.MeshStandardMaterial,
  ): void {
    for (const x of [-0.6, 0.6]) {
      for (const side of [-1, 1]) {
        const leg = this.addBox(root, [0.11, 0.86, 0.11], [x, 0.9, side * 0.26], timber);
        leg.rotation.x = side * 0.3;
      }
      this.addBox(root, [0.14, 0.12, 0.68], [x, 1.29, 0], timber);
      this.addBox(root, [0.08, 0.08, 0.52], [x, 0.86, 0], timber);
    }

    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.28, 1.72, 10), timber);
    log.rotation.z = Math.PI / 2;
    log.position.set(0, 1.63, 0);
    root.add(log);
    for (const x of [-0.5, 0.42]) {
      const bark = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.035, 5, 12), dark);
      bark.rotation.y = Math.PI / 2;
      bark.position.set(x, 1.63, 0);
      root.add(bark);
    }
    for (const [x, radius] of [[-0.86, 0.3], [0.86, 0.28]] as Array<[number, number]>) {
      const face = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 0.03, 10), cream);
      face.rotation.z = Math.PI / 2;
      face.position.set(x, 1.63, 0);
      root.add(face);
    }

    const saw = new THREE.Group();
    saw.position.set(0.2, 1.45, 0.44);
    saw.rotation.z = 0.55;
    root.add(saw);
    this.addBox(saw, [1.1, 0.2, 0.03], [0, 0, 0], cream);
    this.addBox(saw, [1.1, 0.05, 0.04], [0, 0.11, 0], secondary);
    this.addBox(saw, [0.16, 0.24, 0.09], [-0.62, -0.03, 0], timber);
    for (let index = 0; index < 8; index += 1) {
      const tooth = this.addBox(saw, [0.06, 0.06, 0.035], [-0.42 + index * 0.12, -0.1, 0], cream);
      tooth.rotation.z = Math.PI / 4;
    }

    for (const [x, z, radius] of [[-0.48, 0.58, 0.1], [-0.18, 0.64, 0.07], [0.56, 0.6, 0.09]] as Array<[number, number, number]>) {
      const curl = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.022, 5, 10, Math.PI * 1.4), cream);
      curl.rotation.x = Math.PI / 2;
      curl.position.set(x, 0.52, z);
      root.add(curl);
    }

    const foliage = this.leafMaterial();
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.13, 0.26, 10), cream);
    pot.position.set(-0.7, 0.63, 0.55);
    root.add(pot);
    const soil = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.05, 10), dark);
    soil.position.set(-0.7, 0.77, 0.55);
    root.add(soil);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.045, 0.34, 6), timber);
    stem.position.set(-0.7, 0.94, 0.55);
    root.add(stem);
    for (const side of [-1, 1]) {
      const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), foliage);
      leaf.scale.set(1, 0.32, 0.6);
      leaf.rotation.z = side * 0.5;
      leaf.position.set(-0.7 + side * 0.12, 1.08, 0.55);
      root.add(leaf);
    }

    if (key === "yield") {
      this.addBox(root, [0.44, 0.16, 0.2], [-0.3, 2.0, 0], timber);
      this.addBox(root, [0.1, 0.16, 0.18], [-0.34, 2.12, 0], secondary);
      const shaving = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.02, 5, 10, Math.PI * 1.5), cream);
      shaving.rotation.x = Math.PI / 2;
      shaving.position.set(-0.02, 1.96, 0);
      root.add(shaving);
      for (const angle of [0.4, -0.4]) {
        const leg = this.addBox(root, [0.32, 0.04, 0.03], [0.62, 1.98, 0.2], secondary);
        leg.rotation.z = angle;
      }
    } else if (key === "capacity") {
      for (const [x, y] of [[-0.26, 0.63], [0.02, 0.63], [-0.12, 0.86]] as Array<[number, number]>) {
        const billet = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.66, 8), timber);
        billet.rotation.x = Math.PI / 2;
        billet.position.set(x, y, 0);
        root.add(billet);
        const face = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.03, 8), cream);
        face.rotation.x = Math.PI / 2;
        face.position.set(x, y, 0.34);
        root.add(face);
      }
      const seedling = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.04, 0.28, 6), timber);
      seedling.position.set(0.62, 0.63, 0.58);
      root.add(seedling);
      const sprout = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), foliage);
      sprout.scale.set(1, 0.42, 0.7);
      sprout.position.set(0.62, 0.8, 0.58);
      root.add(sprout);
    } else if (key === "speed") {
      const flywheel = new THREE.Group();
      flywheel.name = "equipment-rotor";
      flywheel.position.set(0.9, 0.96, 0.34);
      root.add(flywheel);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.05, 6, 16), secondary);
      flywheel.add(rim);
      for (let index = 0; index < 3; index += 1) {
        const spoke = this.addBox(flywheel, [0.5, 0.045, 0.04], [0, 0, 0], timber);
        spoke.rotation.z = index * Math.PI / 3;
      }
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.1, 8), dark);
      hub.rotation.x = Math.PI / 2;
      flywheel.add(hub);
      const treadle = this.addBox(root, [0.56, 0.06, 0.3], [0.66, 0.56, 0.34], timber);
      treadle.rotation.z = -0.09;
      const pitman = this.addBox(root, [0.05, 0.44, 0.05], [0.88, 0.76, 0.34], dark);
      pitman.rotation.z = 0.12;
    } else {
      const board = this.addBox(root, [0.9, 0.66, 0.05], [0, 1.02, 0.62], cream);
      board.rotation.x = -0.22;
      for (const y of [0.88, 1.02, 1.16]) this.addBox(root, [0.82, 0.02, 0.012], [0, y, 0.68], secondary);
      for (const x of [-0.38, 0.38]) this.addBox(root, [0.06, 0.5, 0.06], [x, 0.74, 0.72], timber);
      this.addBox(root, [0.07, 0.9, 0.07], [0.94, 0.96, 0.5], timber);
      this.addBox(root, [0.4, 0.07, 0.07], [0.76, 1.4, 0.5], timber);
      const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.16, 5), dark);
      cord.position.set(0.58, 1.3, 0.5);
      root.add(cord);
      const lantern = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), primary);
      lantern.scale.y = 1.2;
      lantern.position.set(0.58, 1.14, 0.5);
      root.add(lantern);
    }
  }

  /**
   * Circular level 1 — a sorting bench with three woven bins and a hand tray.
   *
   * The recovery lab begins as hands and baskets: glass in one bin, metal in the
   * next, fibre in the third. Everything the loop becomes later is machinery bolted
   * around this bench, and the bench stays visible through all four levels.
   */
  private createSortingBench(
    key: UpgradeKey,
    root: THREE.Group,
    primary: THREE.MeshStandardMaterial,
    secondary: THREE.MeshStandardMaterial,
    dark: THREE.MeshStandardMaterial,
    cream: THREE.MeshStandardMaterial,
    timber: THREE.MeshStandardMaterial,
  ): void {
    this.addBox(root, [1.66, 0.1, 0.92], [0, 0.98, 0], timber);
    for (const x of [-0.7, 0.7]) {
      for (const z of [-0.36, 0.36]) this.addBox(root, [0.1, 0.44, 0.1], [x, 0.71, z], timber);
    }
    this.addBox(root, [1.5, 0.06, 0.68], [0, 0.66, 0], timber);
    this.addBox(root, [1.4, 0.02, 0.24], [0, 1.04, 0.24], dark);

    for (let index = 0; index < 3; index += 1) {
      const x = -0.5 + index * 0.5;
      const bin = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.2, 0.34, 10, 1, true), timber);
      bin.position.set(x, 1.2, -0.08);
      root.add(bin);
      for (const y of [1.09, 1.33]) {
        const weave = new THREE.Mesh(new THREE.TorusGeometry(0.235, 0.022, 5, 12), secondary);
        weave.rotation.x = Math.PI / 2;
        weave.position.set(x, y, -0.08);
        root.add(weave);
      }
      if (index === 0) {
        const cullet = new THREE.Mesh(new THREE.SphereGeometry(0.15, 9, 7), primary);
        cullet.scale.y = 0.55;
        cullet.position.set(x, 1.3, -0.08);
        root.add(cullet);
      } else if (index === 1) {
        for (const offset of [-0.07, 0.07]) {
          const offcut = this.addBox(root, [0.14, 0.08, 0.14], [x + offset, 1.3, -0.08 + offset], secondary);
          offcut.rotation.y = offset * 6;
        }
      } else {
        const fibre = new THREE.Mesh(new THREE.SphereGeometry(0.16, 9, 7), cream);
        fibre.scale.set(1, 0.45, 0.8);
        fibre.position.set(x, 1.31, -0.08);
        root.add(fibre);
      }
    }

    const tray = this.addBox(root, [1.36, 0.05, 0.42], [0, 1.12, 0.44], cream);
    tray.rotation.x = 0.3;
    for (const x of [-0.45, 0, 0.45]) {
      const divider = this.addBox(root, [0.04, 0.12, 0.42], [x, 1.16, 0.44], timber);
      divider.rotation.x = 0.3;
    }
    for (const [x, material] of [[-0.22, primary], [0.24, secondary]] as Array<[number, THREE.MeshStandardMaterial]>) {
      const sorted = new THREE.Mesh(new THREE.DodecahedronGeometry(0.075, 0), material);
      sorted.position.set(x, 1.2, 0.4);
      root.add(sorted);
    }

    if (key === "yield") {
      this.addBox(root, [0.07, 0.6, 0.07], [-0.78, 1.33, 0.5], timber);
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.56, 6), secondary);
      arm.rotation.z = Math.PI / 2;
      arm.position.set(-0.5, 1.6, 0.5);
      root.add(arm);
      const eye = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.1, 0.16, 12), secondary);
      eye.position.set(-0.24, 1.52, 0.5);
      root.add(eye);
      const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.02, 12), primary);
      lens.position.set(-0.24, 1.43, 0.5);
      root.add(lens);
    } else if (key === "capacity") {
      for (const [x, z] of [[-0.24, -0.14], [0.28, 0.12]] as Array<[number, number]>) {
        const bale = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.6, 12), cream);
        bale.rotation.z = Math.PI / 2;
        bale.position.set(x, 0.73, z);
        root.add(bale);
        for (const twine of [-0.17, 0.17]) {
          const band = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.02, 5, 12), timber);
          band.rotation.y = Math.PI / 2;
          band.position.set(x + twine, 0.73, z);
          root.add(band);
        }
      }
    } else if (key === "speed") {
      for (const z of [-0.16, 0.08, 0.32]) {
        const roller = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 1.24, 10), secondary);
        roller.name = "flow-roller";
        roller.rotation.z = Math.PI / 2;
        roller.position.set(0, 0.78, z);
        root.add(roller);
      }
      const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.035, 6, 12), secondary);
      wheel.position.set(0.78, 0.78, 0.32);
      root.add(wheel);
      const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.12, 6), timber);
      grip.rotation.x = Math.PI / 2;
      grip.position.set(0.9, 0.78, 0.32);
      root.add(grip);
    } else {
      const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 0.4, 10), timber);
      pedestal.position.set(0.92, 0.69, 0.44);
      root.add(pedestal);
      const vase = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.16, 0.26, 10), primary);
      vase.position.set(0.92, 1.02, 0.44);
      root.add(vase);
      const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.1, 10), primary);
      neck.position.set(0.92, 1.2, 0.44);
      root.add(neck);
      for (const side of [-1, 1]) {
        const sprig = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), side < 0 ? secondary : cream);
        sprig.scale.set(1, 0.34, 0.6);
        sprig.rotation.z = side * 0.6;
        sprig.position.set(0.92 + side * 0.1, 1.32, 0.44);
        root.add(sprig);
      }
    }
  }

  /**
   * Geologic level 3 — a washing sluice down the left flank and a turning grading
   * drum on the right. Level 2 gave the bed a jaw; level 3 is the first time the mine
   * separates what it has broken, with water you can see running over the riffles.
   */
  private createSluiceDeck(
    root: THREE.Group,
    primary: THREE.MeshStandardMaterial,
    secondary: THREE.MeshStandardMaterial,
    dark: THREE.MeshStandardMaterial,
    cream: THREE.MeshStandardMaterial,
    timber: THREE.MeshStandardMaterial,
  ): void {
    const water = new THREE.MeshStandardMaterial({
      color: 0xbfe6ef,
      roughness: 0.12,
      metalness: 0.05,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
    });

    const sluice = new THREE.Group();
    sluice.position.set(-1.0, 1.36, 0.05);
    sluice.rotation.x = 0.22;
    root.add(sluice);
    this.addBox(sluice, [0.5, 0.06, 1.5], [0, 0, 0], timber);
    for (const x of [-0.26, 0.26]) this.addBox(sluice, [0.05, 0.2, 1.5], [x, 0.1, 0], timber);
    for (const z of [-0.5, 0, 0.5]) this.addBox(sluice, [0.44, 0.05, 0.05], [0, 0.06, z], secondary);
    const flow = this.addBox(sluice, [0.42, 0.03, 1.42], [0, 0.07, 0], water);
    flow.castShadow = false;
    for (const z of [-0.55, 0.55]) this.addBox(root, [0.09, 0.9, 0.09], [-1.0, 0.95, z], timber);
    const moss = this.addBox(root, [0.3, 0.09, 0.24], [-1.0, 1.63, -0.68], cream);
    moss.rotation.x = 0.22;
    const moss_leaf = this.leafMaterial();
    for (const x of [-1.08, -0.92]) {
      const tuft = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), moss_leaf);
      tuft.scale.y = 0.5;
      tuft.position.set(x, 1.7, -0.68);
      root.add(tuft);
    }

    const drum = new THREE.Group();
    drum.name = "equipment-rotor";
    drum.position.set(1.0, 1.6, -0.15);
    root.add(drum);
    const shell = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.66, 12, 1, true), secondary);
    shell.rotation.x = Math.PI / 2;
    drum.add(shell);
    for (let index = 0; index < 6; index += 1) {
      const angle = index * Math.PI / 3;
      this.addBox(drum, [0.07, 0.07, 0.7], [Math.cos(angle) * 0.3, Math.sin(angle) * 0.3, 0], timber);
    }
    const core = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.76, 6), dark);
    core.rotation.x = Math.PI / 2;
    drum.add(core);
    for (const z of [-0.46, 0.46]) this.addBox(root, [0.09, 0.82, 0.09], [1.0, 1.11, z], timber);
    const fines = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.16, 0.26, 10), cream);
    fines.position.set(1.0, 0.63, 0.48);
    root.add(fines);

    this.addBox(root, [1.12, 0.06, 0.34], [0, 2.05, -0.74], timber);
    for (const x of [-0.48, 0.48]) this.addBox(root, [0.06, 0.5, 0.06], [x, 1.78, -0.74], timber);
    for (const x of [-0.34, 0, 0.34]) {
      this.addBox(root, [0.26, 0.06, 0.24], [x, 2.11, -0.74], cream);
      const sample = new THREE.Mesh(new THREE.DodecahedronGeometry(0.07, 0), x === 0 ? secondary : primary);
      sample.position.set(x, 2.19, -0.74);
      root.add(sample);
    }
  }

  /**
   * Forestry level 3 — a seasoning rack of drying boards under a canvas awning on the
   * left, and a leather belt that finally drives the level 2 blade from a pulley.
   * Level 3 is the moment the mill stops cutting one log and starts holding stock.
   */
  private createSeasoningRack(
    root: THREE.Group,
    primary: THREE.MeshStandardMaterial,
    secondary: THREE.MeshStandardMaterial,
    dark: THREE.MeshStandardMaterial,
    cream: THREE.MeshStandardMaterial,
    timber: THREE.MeshStandardMaterial,
  ): void {
    for (const z of [-0.55, 0.55]) this.addBox(root, [0.09, 1.5, 0.09], [-1.08, 1.25, z], timber);
    for (let index = 0; index < 3; index += 1) {
      const y = 1.0 + index * 0.44;
      this.addBox(root, [0.42, 0.05, 1.24], [-1.08, y, 0], timber);
      for (let plank = 0; plank <= index; plank += 1) {
        const board = this.addBox(
          root,
          [0.36, 0.045, 1.1],
          [-1.08 + plank * 0.02, y + 0.06 + plank * 0.06, plank * 0.03],
          plank % 2 === 0 ? cream : timber,
        );
        board.rotation.y = plank * 0.02;
      }
    }
    const awning = this.addBox(root, [0.64, 0.04, 1.4], [-1.14, 2.14, 0], cream);
    awning.rotation.z = -0.28;
    for (const z of [-0.66, 0.66]) this.addBox(awning, [0.66, 0.05, 0.1], [0, 0.01, z], primary);
    this.addBox(root, [0.07, 0.07, 1.44], [-0.86, 2.22, 0], timber);
    this.addBox(root, [0.07, 0.07, 1.44], [-1.4, 2.06, 0], timber);
    const leaf = this.leafMaterial();
    for (const z of [-0.42, 0.42]) {
      const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.2, 5), dark);
      cord.position.set(-0.86, 2.08, z);
      root.add(cord);
      const bundle = new THREE.Mesh(new THREE.SphereGeometry(0.16, 9, 7), leaf);
      bundle.scale.set(0.7, 1.1, 0.7);
      bundle.position.set(-0.86, 1.88, z);
      root.add(bundle);
    }

    const pulley = new THREE.Group();
    pulley.name = "equipment-rotor";
    pulley.position.set(0.95, 1.2, -0.02);
    root.add(pulley);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.05, 6, 14), secondary);
    pulley.add(rim);
    for (let index = 0; index < 3; index += 1) {
      const spoke = this.addBox(pulley, [0.42, 0.04, 0.04], [0, 0, 0], timber);
      spoke.rotation.z = index * Math.PI / 3;
    }
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.1, 8), dark);
    hub.rotation.x = Math.PI / 2;
    pulley.add(hub);
    for (const z of [-0.09, 0.05]) {
      const belt = this.addBox(root, [1.12, 0.045, 0.03], [0.535, 1.57, z], dark);
      belt.rotation.z = -0.73;
    }
    for (const z of [-0.42, 0.42]) this.addBox(root, [0.09, 0.72, 0.09], [0.95, 0.86, z], timber);

    const bin = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.18, 0.34, 10, 1, true), cream);
    bin.position.set(0.6, 0.67, 0.62);
    root.add(bin);
    for (const y of [0.56, 0.78]) {
      const weave = new THREE.Mesh(new THREE.TorusGeometry(0.215, 0.02, 5, 12), timber);
      weave.rotation.x = Math.PI / 2;
      weave.position.set(0.6, y, 0.62);
      root.add(weave);
    }
    const dust = new THREE.Mesh(new THREE.SphereGeometry(0.19, 9, 7), cream);
    dust.scale.y = 0.4;
    dust.position.set(0.6, 0.85, 0.62);
    root.add(dust);
  }

  /**
   * Circular level 3 — a three-step shaking cascade behind, a glass cullet column and
   * a wash trough the level 1 tray now drains into. Level 3 is where the loop gets
   * water and gravity, and the sorted stream first becomes visible end to end.
   */
  private createReclaimCascade(
    root: THREE.Group,
    primary: THREE.MeshStandardMaterial,
    secondary: THREE.MeshStandardMaterial,
    dark: THREE.MeshStandardMaterial,
    cream: THREE.MeshStandardMaterial,
    timber: THREE.MeshStandardMaterial,
  ): void {
    const water = new THREE.MeshStandardMaterial({
      color: 0xbfe6ef,
      roughness: 0.12,
      metalness: 0.05,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
    });
    const glass = new THREE.MeshStandardMaterial({
      color: 0xd6f0ea,
      roughness: 0.14,
      metalness: 0.06,
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
    });

    for (const x of [-0.8, 0.8]) this.addBox(root, [0.09, 1.86, 0.09], [x, 1.45, -0.68], timber);
    for (let index = 0; index < 3; index += 1) {
      const y = 1.05 + index * 0.42;
      const deck = this.addBox(root, [1.48, 0.06, 0.4], [0, y, -0.68], timber);
      deck.rotation.z = index % 2 === 0 ? 0.14 : -0.14;
      for (const x of [-0.42, 0, 0.42]) this.addBox(deck, [0.05, 0.11, 0.38], [x, 0.08, 0], secondary);
      for (const [x, material] of [[-0.24, primary], [0.3, secondary]] as Array<[number, THREE.MeshStandardMaterial]>) {
        const lump = new THREE.Mesh(new THREE.DodecahedronGeometry(0.07, 0), material);
        lump.position.set(x, 0.11, 0.06);
        deck.add(lump);
      }
    }
    const planter = this.addBox(root, [0.3, 0.1, 0.26], [0.56, 2.02, -0.68], cream);
    planter.rotation.z = -0.14;
    const leaf = this.leafMaterial();
    for (const x of [0.48, 0.64]) {
      const tuft = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), leaf);
      tuft.scale.y = 0.5;
      tuft.position.set(x, 2.1, -0.68);
      root.add(tuft);
    }

    const column = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 1.0, 12), glass);
    column.position.set(1.02, 1.5, -0.2);
    root.add(column);
    for (const y of [1.02, 1.98]) {
      const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.08, 12), secondary);
      collar.position.set(1.02, y, -0.2);
      root.add(collar);
    }
    for (const [y, material] of [[1.2, primary], [1.44, secondary], [1.66, primary]] as Array<[number, THREE.MeshStandardMaterial]>) {
      const shard = new THREE.Mesh(new THREE.DodecahedronGeometry(0.11, 0), material);
      shard.position.set(1.02, y, -0.2);
      root.add(shard);
    }

    this.addBox(root, [1.3, 0.18, 0.36], [0, 0.62, 0.66], dark);
    this.addBox(root, [1.36, 0.06, 0.42], [0, 0.7, 0.66], timber);
    const bath = this.addBox(root, [1.22, 0.03, 0.3], [0, 0.72, 0.66], water);
    bath.castShadow = false;
    for (const x of [-0.32, 0.3]) {
      const splash = new THREE.Mesh(new THREE.SphereGeometry(0.08, 9, 7), primary);
      splash.scale.y = 0.5;
      splash.position.set(x, 0.75, 0.66);
      root.add(splash);
    }
  }

  /**
   * Geologic level 4 — a copper flue, a ring of hanging lamps and a split geode whose
   * glowing heart is the only lit thing on the machine. Nothing below level 4 opens a
   * stone, so the finished crusher reads from the door.
   */
  private createGeodeCrown(
    root: THREE.Group,
    primary: THREE.MeshStandardMaterial,
    secondary: THREE.MeshStandardMaterial,
    dark: THREE.MeshStandardMaterial,
    timber: THREE.MeshStandardMaterial,
  ): void {
    const flue = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.19, 0.52, 10), secondary);
    flue.position.set(0, 2.6, -0.5);
    root.add(flue);
    const cowl = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.22, 10, 1, true), secondary);
    cowl.position.set(0, 2.92, -0.5);
    root.add(cowl);

    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.74, 0.045, 6, 22), timber);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 2.42;
    root.add(ring);
    for (let index = 0; index < 3; index += 1) {
      const angle = index / 3 * Math.PI * 2 + 0.5;
      const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.2, 5), dark);
      cord.position.set(Math.cos(angle) * 0.74, 2.32, Math.sin(angle) * 0.74);
      root.add(cord);
      const lantern = new THREE.Mesh(new THREE.SphereGeometry(0.11, 9, 7), primary);
      lantern.position.set(Math.cos(angle) * 0.74, 2.17, Math.sin(angle) * 0.74);
      root.add(lantern);
      const crystal = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.24, 5), secondary);
      crystal.position.set(Math.cos(angle + 1.05) * 0.74, 2.54, Math.sin(angle + 1.05) * 0.74);
      root.add(crystal);
    }

    for (const side of [-1, 1]) {
      const half = new THREE.Group();
      half.position.set(side * 0.3, 2.62, 0);
      half.rotation.y = side < 0 ? Math.PI : 0;
      half.rotation.z = side * 0.22;
      root.add(half);
      const shell = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 8, 0, Math.PI), dark);
      half.add(shell);
      const lining = new THREE.Mesh(new THREE.SphereGeometry(0.25, 12, 8, 0, Math.PI), secondary);
      lining.position.x = 0.04;
      half.add(lining);
      for (let index = 0; index < 3; index += 1) {
        const spike = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.16, 5), primary);
        spike.rotation.z = -Math.PI / 2;
        spike.position.set(0.1, (index - 1) * 0.13, (index - 1) * 0.1);
        half.add(spike);
      }
    }
    const heart = new THREE.Mesh(new THREE.IcosahedronGeometry(0.19, 0), primary);
    heart.name = "equipment-pulse";
    heart.position.y = 2.62;
    root.add(heart);
  }

  /**
   * Forestry level 4 — a living tree grows up through the mill and roofs it, with
   * lanterns slung from the branches and a lit seed pod hanging at the centre.
   * The finished timberworks is the only station in the game with a canopy on it.
   */
  private createCanopyCrown(
    root: THREE.Group,
    primary: THREE.MeshStandardMaterial,
    secondary: THREE.MeshStandardMaterial,
    dark: THREE.MeshStandardMaterial,
    timber: THREE.MeshStandardMaterial,
  ): void {
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.2, 2.3, 8), timber);
    trunk.position.set(-0.86, 1.62, -0.74);
    root.add(trunk);
    for (const [angle, x, y] of [[0.7, -0.6, 2.32], [-0.5, -1.06, 2.18]] as Array<[number, number, number]>) {
      const branch = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 0.6, 6), timber);
      branch.rotation.z = angle;
      branch.position.set(x, y, -0.66);
      root.add(branch);
    }

    const canopy: Array<[number, number, number, number]> = [
      [-0.86, 2.62, -0.6, 0.5],
      [-0.32, 2.68, -0.34, 0.46],
      [0.24, 2.62, -0.12, 0.42],
      [-0.6, 2.56, 0.18, 0.38],
      [0.68, 2.54, -0.38, 0.34],
    ];
    const leaf = this.leafMaterial();
    canopy.forEach(([x, y, z, radius], index) => {
      const leaves = new THREE.Mesh(new THREE.SphereGeometry(radius, 10, 7), index % 2 === 0 ? leaf : secondary);
      leaves.scale.y = 0.55;
      leaves.position.set(x, y, z);
      root.add(leaves);
    });

    for (const [x, z] of [[-0.5, -0.5], [0.3, -0.2]] as Array<[number, number]>) {
      const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.28, 5), dark);
      cord.position.set(x, 2.36, z);
      root.add(cord);
      const lantern = new THREE.Mesh(new THREE.SphereGeometry(0.12, 9, 7), primary);
      lantern.scale.y = 1.15;
      lantern.position.set(x, 2.18, z);
      root.add(lantern);
    }

    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.24, 5), timber);
    stalk.position.set(-0.1, 2.42, -0.28);
    root.add(stalk);
    const pod = new THREE.Mesh(new THREE.OctahedronGeometry(0.2, 0), secondary);
    pod.name = "equipment-pulse";
    pod.position.set(-0.1, 2.18, -0.28);
    root.add(pod);
  }

  /**
   * Circular level 4 — the loop closes overhead: a timber hoop hung with planters made
   * of what the lab recovered, two brass rings crossed through each other, and a lit
   * core at the middle. Level 4 is the only level where the material comes back as a
   * garden rather than as feedstock.
   */
  private createLoopCrown(
    root: THREE.Group,
    primary: THREE.MeshStandardMaterial,
    secondary: THREE.MeshStandardMaterial,
    dark: THREE.MeshStandardMaterial,
    timber: THREE.MeshStandardMaterial,
  ): void {
    const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.05, 6, 22), timber);
    hoop.rotation.x = Math.PI / 2;
    hoop.position.y = 2.3;
    root.add(hoop);

    const leaf = this.leafMaterial();
    for (let index = 0; index < 4; index += 1) {
      const angle = index / 4 * Math.PI * 2 + 0.4;
      const x = Math.cos(angle) * 0.72;
      const z = Math.sin(angle) * 0.72;
      const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.16, 5), dark);
      cord.position.set(x, 2.2, z);
      root.add(cord);
      const planter = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.09, 0.18, 9), index % 2 === 0 ? secondary : timber);
      planter.position.set(x, 2.03, z);
      root.add(planter);
      const spill = new THREE.Mesh(new THREE.SphereGeometry(0.13, 9, 7), leaf);
      spill.scale.set(1, 0.6, 1);
      spill.position.set(x, 1.94, z);
      root.add(spill);
    }

    for (const turn of [0, Math.PI / 2]) {
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.05, 6, 20), secondary);
      band.rotation.y = turn;
      band.position.y = 2.46;
      root.add(band);
    }
    for (let index = 0; index < 3; index += 1) {
      const angle = index / 3 * Math.PI * 2 + 0.9;
      const recovered = new THREE.Mesh(new THREE.DodecahedronGeometry(0.08, 0), index === 1 ? primary : timber);
      recovered.position.set(Math.cos(angle) * 0.4, 2.46 + Math.sin(angle) * 0.4, 0);
      root.add(recovered);
    }
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.2, 0), primary);
    core.name = "equipment-pulse";
    core.position.y = 2.46;
    root.add(core);
  }

  /**
   * Maker level 1 — a joiner's bench: four legs, a slab top, a brass vice on the
   * front edge and a tray of hand tools at the back. Nothing turns and nothing is
   * driven; the whole of level 1 is one person, a vice and a set of chisels. Every
   * later level bolts onto this benchtop, so the bench never stops being the middle
   * of the workshop.
   */
  private createJoinersBench(
    key: UpgradeKey,
    root: THREE.Group,
    primary: THREE.MeshStandardMaterial,
    secondary: THREE.MeshStandardMaterial,
    dark: THREE.MeshStandardMaterial,
    cream: THREE.MeshStandardMaterial,
    timber: THREE.MeshStandardMaterial,
  ): void {
    for (const x of [-0.66, 0.66]) {
      for (const z of [-0.3, 0.3]) this.addBox(root, [0.12, 0.44, 0.12], [x, 0.7, z], timber);
      this.addBox(root, [0.1, 0.08, 0.68], [x, 0.62, 0], timber);
    }
    this.addBox(root, [1.42, 0.07, 0.08], [0, 0.62, 0], timber);
    this.addBox(root, [1.66, 0.12, 0.94], [0, 0.98, 0], timber);
    this.addBox(root, [1.66, 0.1, 0.07], [0, 0.87, 0.47], timber);

    this.addBox(root, [0.36, 0.2, 0.07], [0.7, 0.92, 0.42], secondary);
    this.addBox(root, [0.36, 0.2, 0.07], [0.7, 0.92, 0.58], dark);
    const screw = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.3, 8), secondary);
    screw.rotation.x = Math.PI / 2;
    screw.position.set(0.7, 0.92, 0.56);
    root.add(screw);
    const vhandle = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.26, 6), secondary);
    vhandle.rotation.z = Math.PI / 2;
    vhandle.position.set(0.7, 0.92, 0.72);
    root.add(vhandle);

    this.addBox(root, [1.5, 0.05, 0.2], [0, 1.07, -0.32], timber);
    this.addBox(root, [1.5, 0.1, 0.04], [0, 1.11, -0.43], timber);
    const mallet = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.2, 8), timber);
    mallet.rotation.z = Math.PI / 2;
    mallet.position.set(-0.52, 1.14, -0.32);
    root.add(mallet);
    const malletGrip = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.032, 0.3, 6), timber);
    malletGrip.rotation.x = Math.PI / 2;
    malletGrip.position.set(-0.52, 1.13, -0.12);
    root.add(malletGrip);
    for (const x of [-0.1, 0.06]) {
      this.addBox(root, [0.045, 0.02, 0.22], [x, 1.11, -0.28], secondary);
      const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.028, 0.16, 6), timber);
      grip.rotation.x = Math.PI / 2;
      grip.position.set(x, 1.12, -0.45);
      root.add(grip);
    }
    this.addBox(root, [0.26, 0.02, 0.04], [0.42, 1.11, -0.24], secondary);
    this.addBox(root, [0.04, 0.02, 0.2], [0.3, 1.11, -0.34], dark);

    for (const [x, turn] of [[-0.28, 0.6], [0.16, -0.9]] as Array<[number, number]>) {
      const curl = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.02, 4, 9, Math.PI * 1.5), timber);
      curl.rotation.x = 1.24;
      curl.rotation.z = turn;
      curl.position.set(x, 0.53, 0.66);
      root.add(curl);
    }
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.085, 0.18, 9), cream);
    pot.position.set(-0.78, 1.13, 0.28);
    root.add(pot);
    const herb = this.leafMaterial();
    for (const [dx, dz] of [[-0.06, 0.03], [0.05, -0.04], [0, 0.06]] as Array<[number, number]>) {
      const tuft = new THREE.Mesh(new THREE.SphereGeometry(0.075, 8, 6), herb);
      tuft.scale.y = 0.7;
      tuft.position.set(-0.78 + dx, 1.26, 0.28 + dz);
      root.add(tuft);
    }

    if (key === "yield") {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.033, 0.042, 0.44, 6), secondary);
      post.position.set(-0.62, 1.26, 0.02);
      root.add(post);
      this.addBox(root, [0.3, 0.04, 0.04], [-0.47, 1.46, 0.02], secondary);
      const dial = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.03, 14), cream);
      dial.rotation.x = Math.PI / 2;
      dial.position.set(-0.3, 1.46, 0.02);
      root.add(dial);
      const bezel = new THREE.Mesh(new THREE.TorusGeometry(0.135, 0.026, 6, 14), secondary);
      bezel.position.set(-0.3, 1.46, 0.02);
      root.add(bezel);
      const needle = this.addBox(root, [0.1, 0.012, 0.012], [-0.27, 1.48, 0.04], dark);
      needle.rotation.z = 0.7;
      const specimen = this.addBox(root, [0.24, 0.1, 0.18], [-0.3, 1.09, 0.02], timber);
      specimen.rotation.y = 0.2;
    } else if (key === "capacity") {
      this.addBox(root, [0.84, 0.44, 0.8], [-0.36, 0.72, 0], timber);
      for (const y of [0.58, 0.72, 0.86]) {
        this.addBox(root, [0.74, 0.11, 0.04], [-0.36, y, 0.41], cream);
        const pull = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.12, 6), secondary);
        pull.rotation.z = Math.PI / 2;
        pull.position.set(-0.36, y, 0.44);
        root.add(pull);
      }
      this.addBox(root, [0.42, 0.05, 0.3], [0.32, 1.07, -0.02], dark);
      for (const [dx, dz] of [[-0.12, 0.05], [0.03, -0.05], [0.13, 0.04]] as Array<[number, number]>) {
        const part = new THREE.Mesh(new THREE.DodecahedronGeometry(0.055, 0), dx < 0 ? primary : secondary);
        part.position.set(0.32 + dx, 1.13, -0.02 + dz);
        root.add(part);
      }
    } else if (key === "speed") {
      const treadle = this.addBox(root, [0.62, 0.06, 0.28], [-0.62, 0.54, 0.44], timber);
      treadle.rotation.x = 0.1;
      const crank = new THREE.Group();
      crank.name = "equipment-rotor";
      crank.position.set(-0.86, 0.76, 0.2);
      root.add(crank);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.035, 6, 14), secondary);
      crank.add(rim);
      for (let index = 0; index < 3; index += 1) {
        const spoke = this.addBox(crank, [0.36, 0.04, 0.035], [0, 0, 0], timber);
        spoke.rotation.z = index * Math.PI / 3;
      }
      const pitman = this.addBox(root, [0.05, 0.34, 0.05], [-0.72, 0.66, 0.32], dark);
      pitman.rotation.z = 0.34;
      const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.34, 5), dark);
      cord.position.set(-0.86, 0.98, 0.2);
      root.add(cord);
    } else {
      this.addBox(root, [0.66, 0.06, 0.4], [0.2, 1.08, 0.14], timber);
      const bowl = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 7, 0, Math.PI * 2, 0, Math.PI / 2), secondary);
      bowl.rotation.x = Math.PI;
      bowl.scale.y = 0.7;
      bowl.position.set(0.08, 1.19, 0.14);
      root.add(bowl);
      const cloche = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), cream);
      cloche.position.set(0.08, 1.11, 0.14);
      root.add(cloche);
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), secondary);
      knob.position.set(0.08, 1.35, 0.14);
      root.add(knob);
      this.addBox(root, [0.07, 0.62, 0.07], [0.74, 1.35, -0.02], timber);
      this.addBox(root, [0.3, 0.06, 0.06], [0.61, 1.62, -0.02], timber);
      const hang = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.14, 5), dark);
      hang.position.set(0.48, 1.52, -0.02);
      root.add(hang);
      const lantern = new THREE.Mesh(new THREE.SphereGeometry(0.11, 9, 7), primary);
      lantern.scale.y = 1.2;
      lantern.position.set(0.48, 1.37, -0.02);
      root.add(lantern);
    }
  }

  /**
   * Industrial level 1 — a brick hearth with a live fire, an anvil on a stump, a
   * quench tub and a pair of tongs. There is no chimney and nothing is powered: the
   * factory starts as one smith at a coal fire, and everything the plant becomes is
   * built on top of this hearth and this anvil.
   */
  private createForgeHearth(
    key: UpgradeKey,
    root: THREE.Group,
    primary: THREE.MeshStandardMaterial,
    secondary: THREE.MeshStandardMaterial,
    dark: THREE.MeshStandardMaterial,
    cream: THREE.MeshStandardMaterial,
    timber: THREE.MeshStandardMaterial,
  ): void {
    const brick = new THREE.MeshStandardMaterial({ color: 0x9c6d55, roughness: 0.95, metalness: 0.02 });

    this.addBox(root, [1.06, 0.52, 0.94], [-0.44, 0.76, 0], brick);
    this.addBox(root, [1.14, 0.08, 1.0], [-0.44, 1.05, 0], secondary);
    this.addBox(root, [0.64, 0.07, 0.56], [-0.44, 1.11, 0], primary);
    for (const [dx, dz] of [[-0.18, 0.08], [0.06, -0.1], [0.16, 0.09]] as Array<[number, number]>) {
      const coal = new THREE.Mesh(new THREE.DodecahedronGeometry(0.07, 0), dark);
      coal.position.set(-0.44 + dx, 1.16, dz);
      root.add(coal);
    }
    this.addBox(root, [0.22, 0.14, 0.2], [-0.02, 1.16, -0.34], cream);

    const stump = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.46, 10), timber);
    stump.position.set(0.62, 0.73, 0.2);
    root.add(stump);
    this.addBox(root, [0.2, 0.13, 0.2], [0.62, 1.02, 0.2], dark);
    this.addBox(root, [0.52, 0.15, 0.26], [0.62, 1.15, 0.2], dark);
    const horn = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.26, 7), dark);
    horn.rotation.z = -Math.PI / 2;
    horn.position.set(0.95, 1.15, 0.2);
    root.add(horn);

    const tub = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.16, 0.32, 10), timber);
    tub.position.set(0.14, 0.66, 0.66);
    root.add(tub);
    for (const y of [0.58, 0.76]) {
      const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.185, 0.018, 5, 12), secondary);
      hoop.rotation.x = Math.PI / 2;
      hoop.position.set(0.14, y, 0.66);
      root.add(hoop);
    }
    const quench = new THREE.MeshStandardMaterial({
      color: 0xbfe6ef, roughness: 0.14, metalness: 0.05, transparent: true, opacity: 0.44, depthWrite: false,
    });
    const surface = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.02, 10), quench);
    surface.position.set(0.14, 0.8, 0.66);
    surface.castShadow = false;
    root.add(surface);

    for (const [turn, dz] of [[0.42, 0.34], [0.34, 0.46]] as Array<[number, number]>) {
      const tong = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.66, 6), dark);
      tong.rotation.z = turn;
      tong.position.set(0.12, 0.86, dz);
      root.add(tong);
    }
    this.addBox(root, [0.32, 0.12, 0.24], [-0.96, 1.15, -0.28], cream);
    const herb = this.leafMaterial();
    for (const [dx, dz] of [[-0.09, 0], [0.02, -0.05], [0.08, 0.05]] as Array<[number, number]>) {
      const tuft = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), herb);
      tuft.scale.y = 0.65;
      tuft.position.set(-0.96 + dx, 1.26, -0.28 + dz);
      root.add(tuft);
    }

    if (key === "yield") {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.044, 0.56, 6), secondary);
      post.position.set(-1.0, 1.32, 0.24);
      root.add(post);
      this.addBox(root, [0.26, 0.04, 0.04], [-0.87, 1.58, 0.24], secondary);
      const gauge = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.05, 12), cream);
      gauge.rotation.x = Math.PI / 2;
      gauge.position.set(-0.72, 1.58, 0.24);
      root.add(gauge);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.125, 0.024, 6, 14), secondary);
      rim.position.set(-0.72, 1.58, 0.24);
      root.add(rim);
      const probe = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.46, 5), dark);
      probe.rotation.z = 0.6;
      probe.position.set(-0.6, 1.34, 0.16);
      root.add(probe);
      const billet = this.addBox(root, [0.24, 0.08, 0.14], [0.62, 1.27, 0.2], primary);
      billet.rotation.y = 0.12;
    } else if (key === "capacity") {
      for (const z of [-0.3, 0.3]) this.addBox(root, [0.09, 0.72, 0.09], [-0.98, 0.86, z], timber);
      for (const y of [0.78, 1.12]) this.addBox(root, [0.12, 0.07, 0.72], [-0.98, y, 0], secondary);
      for (const [dy, dz] of [[0.86, -0.16], [0.86, 0.12], [1.2, -0.06], [1.2, 0.18]] as Array<[number, number]>) {
        const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.66, 6), dark);
        bar.rotation.x = Math.PI / 2;
        bar.position.set(-0.98, dy, dz);
        root.add(bar);
      }
      for (let index = 0; index < 3; index += 1) {
        const ingot = this.addBox(root, [0.34, 0.1, 0.2], [0.36, 0.56 + index * 0.11, 0.62], secondary);
        ingot.rotation.y = index * 0.14;
      }
    } else if (key === "speed") {
      const housing = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.22, 12), dark);
      housing.rotation.x = Math.PI / 2;
      housing.position.set(-0.98, 0.78, 0.42);
      root.add(housing);
      const fan = new THREE.Group();
      fan.name = "equipment-rotor";
      fan.position.set(-0.98, 0.78, 0.56);
      root.add(fan);
      for (let index = 0; index < 4; index += 1) {
        const blade = this.addBox(fan, [0.34, 0.09, 0.03], [0, 0, 0], secondary);
        blade.rotation.z = index * Math.PI / 4;
      }
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.09, 8), secondary);
      hub.rotation.x = Math.PI / 2;
      fan.add(hub);
      const duct = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.5, 8), secondary);
      duct.rotation.z = Math.PI / 2;
      duct.position.set(-0.72, 0.9, 0.42);
      root.add(duct);
      const elbow = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.07, 6, 10, Math.PI / 2), secondary);
      elbow.rotation.y = -Math.PI / 2;
      elbow.position.set(-0.46, 0.9, 0.3);
      root.add(elbow);
    } else {
      const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.24, 0.42, 10), timber);
      pedestal.position.set(0.8, 0.7, -0.36);
      root.add(pedestal);
      const showpiece = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.05, 6, 14), primary);
      showpiece.position.set(0.8, 1.12, -0.36);
      root.add(showpiece);
      this.addBox(root, [0.5, 0.32, 0.05], [0.24, 1.3, -0.5], cream);
      for (const dx of [-0.14, 0.02]) this.addBox(root, [0.2, 0.03, 0.02], [0.24 + dx, 1.34, -0.53], dark);
      this.addBox(root, [0.07, 0.72, 0.07], [1.0, 0.88, -0.06], timber);
      this.addBox(root, [0.3, 0.06, 0.06], [0.87, 1.22, -0.06], timber);
      const hang = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.14, 5), dark);
      hang.position.set(0.74, 1.12, -0.06);
      root.add(hang);
      const lantern = new THREE.Mesh(new THREE.SphereGeometry(0.12, 9, 7), primary);
      lantern.scale.y = 1.2;
      lantern.position.set(0.74, 0.96, -0.06);
      root.add(lantern);
    }
  }

  /**
   * Construction level 1 — a layout trestle: two sawhorses under a raked board, a
   * plan pinned flat on it, a stack of panels and a tub of mortar on the floor. The
   * site starts as a drawing and a stack of material; the gantry, the scaffold and
   * the finished module all arrive later, over this same board.
   */
  private createSiteTrestle(
    key: UpgradeKey,
    root: THREE.Group,
    primary: THREE.MeshStandardMaterial,
    secondary: THREE.MeshStandardMaterial,
    dark: THREE.MeshStandardMaterial,
    cream: THREE.MeshStandardMaterial,
    timber: THREE.MeshStandardMaterial,
  ): void {
    for (const x of [-0.56, 0.56]) {
      for (const side of [-1, 1]) {
        const leg = this.addBox(root, [0.1, 0.62, 0.1], [x, 0.78, side * 0.24], timber);
        leg.rotation.x = side * 0.26;
      }
      this.addBox(root, [0.14, 0.11, 0.62], [x, 1.12, 0], timber);
    }
    const board = this.addBox(root, [1.7, 0.09, 0.98], [0, 1.2, 0], timber);
    board.rotation.x = -0.2;
    const plan = this.addBox(root, [1.26, 0.02, 0.64], [0, 1.27, 0.01], cream);
    plan.rotation.x = -0.2;
    for (const [dz, w] of [[-0.12, 0.9], [0.1, 0.62]] as Array<[number, number]>) {
      const line = this.addBox(root, [w, 0.01, 0.02], [0, 1.29 + dz * 0.2, dz], secondary);
      line.rotation.x = -0.2;
    }
    const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.62, 8), cream);
    roll.rotation.z = Math.PI / 2;
    roll.position.set(0.38, 1.36, -0.32);
    root.add(roll);
    const rule = this.addBox(root, [0.86, 0.02, 0.06], [-0.24, 1.32, -0.16], secondary);
    rule.rotation.x = -0.2;
    rule.rotation.y = 0.16;

    for (let index = 0; index < 3; index += 1) {
      const slab = this.addBox(root, [0.7, 0.07, 0.5], [-0.86, 0.55 + index * 0.08, 0.42], timber);
      slab.rotation.y = index * 0.06 - 0.06;
    }
    this.addBox(root, [0.42, 0.24, 0.38], [0.92, 0.63, 0.28], dark);
    this.addBox(root, [0.34, 0.05, 0.3], [0.92, 0.76, 0.28], cream);

    this.addBox(root, [0.07, 0.92, 0.07], [0.9, 0.97, -0.44], timber);
    this.addBox(root, [0.3, 0.06, 0.06], [0.77, 1.4, -0.44], timber);
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.32, 5), dark);
    cord.position.set(0.64, 1.22, -0.44);
    root.add(cord);
    const bob = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.16, 6), secondary);
    bob.rotation.z = Math.PI;
    bob.position.set(0.64, 0.99, -0.44);
    root.add(bob);

    const saplingPot = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.12, 0.24, 9), cream);
    saplingPot.position.set(-0.92, 0.62, -0.4);
    root.add(saplingPot);
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.34, 6), timber);
    trunk.position.set(-0.92, 0.9, -0.4);
    root.add(trunk);
    const leaf = this.leafMaterial();
    for (const [dx, dy, r] of [[-0.08, 1.1, 0.14], [0.08, 1.12, 0.12], [0, 1.2, 0.11]] as Array<[number, number, number]>) {
      const crownLeaf = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), leaf);
      crownLeaf.scale.y = 0.7;
      crownLeaf.position.set(-0.92 + dx, dy, -0.4);
      root.add(crownLeaf);
    }

    if (key === "yield") {
      const head = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.1, 8), secondary);
      head.position.set(0.16, 1.16, 0.72);
      root.add(head);
      for (let index = 0; index < 3; index += 1) {
        const angle = index / 3 * Math.PI * 2;
        const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.74, 6), timber);
        foot.position.set(0.16 + Math.cos(angle) * 0.14, 0.83, 0.72 + Math.sin(angle) * 0.14);
        foot.rotation.z = -Math.cos(angle) * 0.32;
        foot.rotation.x = Math.sin(angle) * 0.32;
        root.add(foot);
      }
      const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.38, 10), secondary);
      scope.rotation.z = Math.PI / 2;
      scope.position.set(0.16, 1.28, 0.72);
      root.add(scope);
      const eyepiece = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.1, 8), dark);
      eyepiece.rotation.z = Math.PI / 2;
      eyepiece.position.set(0.4, 1.28, 0.72);
      root.add(eyepiece);
      this.addBox(root, [0.05, 0.5, 0.12], [-0.5, 1.24, 0.7], cream);
      for (const dy of [-0.14, 0.06]) this.addBox(root, [0.06, 0.08, 0.13], [-0.5, 1.24 + dy, 0.7], primary);
    } else if (key === "capacity") {
      this.addBox(root, [0.78, 0.08, 0.6], [-0.34, 0.54, 0.68], timber);
      for (const dx of [-0.28, 0.28]) this.addBox(root, [0.1, 0.1, 0.6], [-0.34 + dx, 0.46, 0.68], timber);
      for (let row = 0; row < 2; row += 1) {
        for (let index = 0; index < 3; index += 1) {
          const block = this.addBox(
            root,
            [0.22, 0.1, 0.16],
            [-0.58 + index * 0.24, 0.63 + row * 0.11, 0.68],
            row === 0 ? secondary : primary,
          );
          block.rotation.y = (index - 1) * 0.05;
        }
      }
      for (const [turn, dx] of [[0.16, 0.5], [0.24, 0.6], [0.1, 0.7]] as Array<[number, number]>) {
        const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 1.0, 5), dark);
        rod.rotation.z = turn;
        rod.position.set(dx, 0.98, 0.6);
        root.add(rod);
      }
    } else if (key === "speed") {
      for (const z of [-0.22, 0.22]) this.addBox(root, [0.08, 0.6, 0.08], [-0.9, 1.05, z], timber);
      this.addBox(root, [0.12, 0.09, 0.56], [-0.9, 1.38, 0], timber);
      const winch = new THREE.Group();
      winch.name = "equipment-rotor";
      winch.position.set(-0.9, 1.2, 0.28);
      root.add(winch);
      const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.2, 10), secondary);
      drum.rotation.x = Math.PI / 2;
      winch.add(drum);
      for (const dx of [-0.14, 0.14]) {
        const flange = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.03, 12), dark);
        flange.rotation.x = Math.PI / 2;
        flange.position.z = dx;
        winch.add(flange);
      }
      const handle = this.addBox(winch, [0.24, 0.04, 0.04], [0.12, 0, 0.2], secondary);
      handle.rotation.z = 0.4;
      const line = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.4, 5), dark);
      line.position.set(-0.9, 0.94, 0.28);
      root.add(line);
      const hook = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.026, 5, 10, Math.PI * 1.5), dark);
      hook.position.set(-0.9, 0.7, 0.28);
      root.add(hook);
    } else {
      for (const x of [-0.6, 0.6]) this.addBox(root, [0.08, 0.92, 0.08], [x, 1.0, -0.62], timber);
      this.addBox(root, [1.4, 0.66, 0.06], [0, 1.56, -0.62], cream);
      this.addBox(root, [1.5, 0.08, 0.1], [0, 1.93, -0.62], timber);
      for (const [dx, dy] of [[-0.42, 0.06], [0, -0.04], [0.42, 0.05]] as Array<[number, number]>) {
        const card = this.addBox(root, [0.34, 0.26, 0.02], [dx, 1.56 + dy, -0.58], dx === 0 ? primary : secondary);
        card.rotation.z = dx * 0.06;
      }
      for (const x of [-0.5, 0.5]) {
        const lantern = new THREE.Mesh(new THREE.SphereGeometry(0.1, 9, 7), primary);
        lantern.scale.y = 1.2;
        lantern.position.set(x, 2.04, -0.62);
        root.add(lantern);
      }
      this.addBox(root, [1.24, 0.14, 0.2], [0, 1.15, -0.5], timber);
      const hedge = this.leafMaterial();
      for (let index = 0; index < 4; index += 1) {
        const tuft = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), hedge);
        tuft.scale.y = 0.6;
        tuft.position.set(-0.42 + index * 0.28, 1.26, -0.5);
        root.add(tuft);
      }
    }
  }

  /**
   * Maker level 3 — the shop gets stocked. A pegboard wall of hung tools rises behind
   * the bench, a bank of parts drawers fills the left end, jars of fasteners line a
   * shelf and a swing-arm lamp reaches over the work. Level 2 gave the bench power;
   * level 3 is the moment it stops being one bench and starts being a workshop.
   */
  private createToolWall(
    root: THREE.Group,
    primary: THREE.MeshStandardMaterial,
    secondary: THREE.MeshStandardMaterial,
    dark: THREE.MeshStandardMaterial,
    cream: THREE.MeshStandardMaterial,
    timber: THREE.MeshStandardMaterial,
  ): void {
    for (const x of [-0.96, 0.96]) this.addBox(root, [0.1, 1.5, 0.1], [x, 1.36, -0.66], timber);
    this.addBox(root, [1.94, 1.16, 0.07], [0, 1.78, -0.68], timber);
    this.addBox(root, [2.02, 0.08, 0.12], [0, 2.4, -0.68], timber);

    const saw = this.addBox(root, [0.62, 0.24, 0.03], [-0.5, 2.02, -0.62], secondary);
    saw.rotation.z = 0.08;
    this.addBox(root, [0.16, 0.18, 0.05], [-0.86, 1.98, -0.62], timber);
    for (const [x, y] of [[0.08, 2.06], [0.28, 2.06]] as Array<[number, number]>) {
      this.addBox(root, [0.05, 0.28, 0.03], [x, y, -0.62], secondary);
      const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.03, 0.16, 6), timber);
      grip.position.set(x, y - 0.22, -0.62);
      root.add(grip);
    }
    const head = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.22, 8), dark);
    head.rotation.z = Math.PI / 2;
    head.position.set(0.66, 2.1, -0.62);
    root.add(head);
    this.addBox(root, [0.05, 0.3, 0.04], [0.66, 1.92, -0.62], timber);
    const coil = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.03, 5, 14), primary);
    coil.position.set(-0.16, 1.52, -0.62);
    root.add(coil);
    this.addBox(root, [0.28, 0.03, 0.03], [0.42, 1.62, -0.62], secondary);
    this.addBox(root, [0.03, 0.22, 0.03], [0.29, 1.51, -0.62], secondary);

    this.addBox(root, [0.52, 0.92, 0.54], [-0.96, 0.96, 0.02], timber);
    for (let index = 0; index < 4; index += 1) {
      this.addBox(root, [0.44, 0.16, 0.04], [-0.96, 0.66 + index * 0.22, 0.3], cream);
      const pull = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.1, 6), secondary);
      pull.rotation.z = Math.PI / 2;
      pull.position.set(-0.96, 0.66 + index * 0.22, 0.33);
      root.add(pull);
    }

    this.addBox(root, [0.86, 0.05, 0.24], [0.5, 1.3, -0.56], timber);
    for (let index = 0; index < 3; index += 1) {
      const jar = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.22, 10), cream);
      jar.position.set(0.2 + index * 0.3, 1.44, -0.56);
      root.add(jar);
      const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.105, 0.04, 10), secondary);
      lid.position.set(0.2 + index * 0.3, 1.57, -0.56);
      root.add(lid);
      const fill = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.08, 8), index === 1 ? primary : dark);
      fill.position.set(0.2 + index * 0.3, 1.38, -0.56);
      root.add(fill);
    }

    this.addBox(root, [0.09, 0.34, 0.09], [0.92, 1.24, -0.34], timber);
    const upper = this.addBox(root, [0.56, 0.06, 0.06], [0.68, 1.5, -0.34], secondary);
    upper.rotation.z = 0.42;
    const lower = this.addBox(root, [0.5, 0.06, 0.06], [0.3, 1.56, -0.3], secondary);
    lower.rotation.z = -0.3;
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.16, 10, 1, true), secondary);
    shade.rotation.x = Math.PI;
    shade.position.set(0.08, 1.44, -0.28);
    root.add(shade);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.075, 9, 7), primary);
    bulb.position.set(0.08, 1.36, -0.28);
    root.add(bulb);

    const leaf = this.leafMaterial();
    for (let index = 0; index < 5; index += 1) {
      const tuft = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), index % 2 === 0 ? leaf : secondary);
      tuft.scale.y = 0.6;
      tuft.position.set(-0.72 + index * 0.36, 2.5, -0.68);
      root.add(tuft);
    }
    for (const x of [-0.34, 0.46]) {
      const trail = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.012, 0.44, 5), leaf);
      trail.position.set(x, 2.24, -0.62);
      root.add(trail);
    }
  }

  /**
   * Industrial level 3 — the forge stops being a forge and becomes a line. A roller
   * conveyor runs across the front carrying work away from the anvil, a jointed arm
   * feeds it, the quench trough moves out to the line and a copper recuperator climbs
   * the chimney to give the heat back. This is the level where the plant scales.
   */
  private createAssemblyLine(
    root: THREE.Group,
    primary: THREE.MeshStandardMaterial,
    secondary: THREE.MeshStandardMaterial,
    dark: THREE.MeshStandardMaterial,
    cream: THREE.MeshStandardMaterial,
    timber: THREE.MeshStandardMaterial,
  ): void {
    for (const x of [-0.74, 0.74]) this.addBox(root, [0.1, 0.52, 0.1], [x, 0.76, 0.7], timber);
    for (const dz of [-0.17, 0.17]) this.addBox(root, [1.78, 0.1, 0.07], [0, 1.04, 0.7 + dz], secondary);
    for (let index = 0; index < 5; index += 1) {
      const roller = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.34, 10), secondary);
      roller.rotation.z = Math.PI / 2;
      roller.position.set(-0.7 + index * 0.35, 1.06, 0.7);
      roller.name = "flow-roller";
      root.add(roller);
    }
    for (const [x, kind] of [[-0.5, 0], [0.18, 1], [0.72, 0]] as Array<[number, number]>) {
      const work = kind === 0
        ? this.addBox(root, [0.2, 0.12, 0.2], [x, 1.19, 0.7], primary)
        : this.addBox(root, [0.24, 0.1, 0.22], [x, 1.18, 0.7], cream);
      work.rotation.y = x * 0.2;
    }

    this.addBox(root, [0.16, 0.66, 0.16], [0.94, 1.2, 0.24], timber);
    const upperArm = this.addBox(root, [0.5, 0.11, 0.11], [0.74, 1.58, 0.24], secondary);
    upperArm.rotation.z = 0.34;
    const foreArm = this.addBox(root, [0.44, 0.1, 0.1], [0.5, 1.5, 0.42], secondary);
    foreArm.rotation.z = -0.5;
    const elbow = new THREE.Mesh(new THREE.SphereGeometry(0.09, 9, 7), dark);
    elbow.position.set(0.62, 1.66, 0.32);
    root.add(elbow);
    for (const dz of [-0.06, 0.06]) this.addBox(root, [0.05, 0.16, 0.04], [0.34, 1.32, 0.5 + dz], dark);

    this.addBox(root, [1.0, 0.26, 0.32], [-0.7, 0.64, 0.36], dark);
    const bath = new THREE.MeshStandardMaterial({
      color: 0xbfe6ef, roughness: 0.14, metalness: 0.05, transparent: true, opacity: 0.44, depthWrite: false,
    });
    const water = this.addBox(root, [0.92, 0.03, 0.26], [-0.7, 0.76, 0.36], bath);
    water.castShadow = false;
    for (const [x, r] of [[-0.94, 0.07], [-0.62, 0.09], [-0.4, 0.06]] as Array<[number, number]>) {
      const steam = new THREE.Mesh(new THREE.SphereGeometry(r, 7, 5), cream);
      steam.position.set(x, 0.92 + r, 0.36);
      root.add(steam);
    }

    for (let index = 0; index < 3; index += 1) {
      const arc = new THREE.Mesh(new THREE.TorusGeometry(0.46, 0.045, 6, 12, Math.PI), secondary);
      arc.rotation.y = Math.PI / 2;
      arc.position.set(-0.44, 1.7 + index * 0.28, -0.02);
      root.add(arc);
    }
    const riser = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.86, 8), secondary);
    riser.position.set(-0.44, 1.98, 0.44);
    root.add(riser);

    this.addBox(root, [0.5, 0.14, 0.24], [0.62, 1.16, 0.98], timber);
    const leaf = this.leafMaterial();
    for (let index = 0; index < 3; index += 1) {
      const tuft = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), leaf);
      tuft.scale.y = 0.65;
      tuft.position.set(0.44 + index * 0.18, 1.27, 0.98);
      root.add(tuft);
    }
  }

  /**
   * Construction level 3 — the site is manned. A braced scaffold tower goes up on the
   * left with two plank decks and a canvas sheet over the top, a mixer drum turns on
   * its frame, a barrow waits by the trestle and a green-roof tray is already growing
   * on the upper deck. Level 3 is the level where work is happening at height.
   */
  private createScaffoldDeck(
    root: THREE.Group,
    primary: THREE.MeshStandardMaterial,
    secondary: THREE.MeshStandardMaterial,
    dark: THREE.MeshStandardMaterial,
    cream: THREE.MeshStandardMaterial,
    timber: THREE.MeshStandardMaterial,
  ): void {
    const standards: Array<[number, number]> = [[-0.98, -0.42], [-0.98, 0.42], [-0.56, -0.42], [-0.56, 0.42]];
    for (const [x, z] of standards) this.addBox(root, [0.07, 1.9, 0.07], [x, 1.44, z], secondary);
    for (const y of [0.94, 1.66, 2.34]) {
      for (const z of [-0.42, 0.42]) this.addBox(root, [0.5, 0.06, 0.06], [-0.77, y, z], secondary);
      for (const x of [-0.98, -0.56]) this.addBox(root, [0.06, 0.06, 0.9], [x, y, 0], secondary);
    }
    for (const [y, turn] of [[1.3, 0.9], [2.0, -0.9]] as Array<[number, number]>) {
      const brace = this.addBox(root, [0.05, 0.86, 0.05], [-0.77, y, -0.42], secondary);
      brace.rotation.z = turn;
    }
    for (const y of [1.72, 2.4]) {
      this.addBox(root, [0.52, 0.06, 0.94], [-0.77, y, 0], timber);
      this.addBox(root, [0.54, 0.1, 0.05], [-0.77, y + 0.09, 0.46], timber);
    }
    const sheet = this.addBox(root, [0.72, 0.05, 1.04], [-0.77, 2.74, 0], cream);
    sheet.rotation.z = 0.16;
    for (const z of [-0.44, 0.44]) this.addBox(root, [0.6, 0.04, 0.04], [-0.77, 2.76, z], timber);

    const leaf = this.leafMaterial();
    this.addBox(root, [0.44, 0.12, 0.34], [-0.77, 2.52, -0.24], timber);
    for (let index = 0; index < 3; index += 1) {
      const tuft = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), index === 1 ? leaf : primary);
      tuft.scale.y = 0.6;
      tuft.position.set(-0.9 + index * 0.13, 2.63, -0.24);
      root.add(tuft);
    }

    for (const z of [-0.16, 0.34]) this.addBox(root, [0.09, 0.56, 0.09], [0.84, 0.78, z], timber);
    this.addBox(root, [0.12, 0.08, 0.6], [0.84, 1.08, 0.1], timber);
    const mixer = new THREE.Group();
    mixer.name = "equipment-rotor";
    mixer.position.set(0.84, 1.22, 0.1);
    root.add(mixer);
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.19, 0.4, 12), secondary);
    drum.rotation.x = Math.PI / 2;
    mixer.add(drum);
    for (let index = 0; index < 4; index += 1) {
      const fin = this.addBox(mixer, [0.44, 0.04, 0.04], [0, 0, 0.16], dark);
      fin.rotation.z = index * Math.PI / 4;
    }
    const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.03, 5, 12), dark);
    mouth.position.z = 0.2;
    mixer.add(mouth);

    const barrowTray = this.addBox(root, [0.44, 0.2, 0.34], [0.16, 0.66, 0.78], dark);
    barrowTray.rotation.z = 0.16;
    this.addBox(root, [0.36, 0.05, 0.28], [0.16, 0.76, 0.78], cream);
    for (const dz of [-0.16, 0.16]) {
      const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.56, 6), timber);
      handle.rotation.z = Math.PI / 2;
      handle.position.set(0.48, 0.6, 0.78 + dz);
      root.add(handle);
    }
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.07, 10), dark);
    wheel.rotation.x = Math.PI / 2;
    wheel.position.set(-0.16, 0.56, 0.78);
    root.add(wheel);

    for (let index = 0; index < 3; index += 1) {
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.7, 8), primary);
      pipe.rotation.z = Math.PI / 2;
      pipe.position.set(0.34, 0.56 + index * 0.14, -0.72 + (index % 2) * 0.14);
      root.add(pipe);
    }
  }

  /**
   * Maker level 4 — the finished workshop hangs its work overhead: a timber hoop slung
   * on three cords, three turned and joined pieces hanging from it, a brass gear
   * rosette above and the masterpiece lit under a glass cloche at the centre.
   */
  private createArtisanCrown(
    root: THREE.Group,
    primary: THREE.MeshStandardMaterial,
    secondary: THREE.MeshStandardMaterial,
    dark: THREE.MeshStandardMaterial,
    timber: THREE.MeshStandardMaterial,
  ): void {
    const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.05, 6, 22), timber);
    hoop.rotation.x = Math.PI / 2;
    hoop.position.y = 2.34;
    root.add(hoop);
    for (let index = 0; index < 3; index += 1) {
      const angle = index / 3 * Math.PI * 2 + 0.4;
      const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.42, 5), dark);
      cord.position.set(Math.cos(angle) * 0.72, 2.55, Math.sin(angle) * 0.72);
      root.add(cord);
    }
    const boss = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.13, 0.12, 8), timber);
    boss.position.y = 2.8;
    root.add(boss);

    const spindle = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.42, 8), timber);
    spindle.position.set(-0.66, 2.1, 0.24);
    root.add(spindle);
    for (const y of [1.96, 2.24]) {
      const collar = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.025, 5, 12), secondary);
      collar.rotation.x = Math.PI / 2;
      collar.position.set(-0.66, y, 0.24);
      root.add(collar);
    }
    const seat = this.addBox(root, [0.34, 0.06, 0.34], [0.6, 2.06, 0.3], timber);
    seat.rotation.y = 0.3;
    for (const [dx, dz] of [[-0.11, -0.11], [0.11, -0.11], [0, 0.13]] as Array<[number, number]>) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.28, 5), timber);
      leg.position.set(0.6 + dx, 1.9, 0.3 + dz);
      root.add(leg);
    }
    const dish = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 7, 0, Math.PI * 2, 0, Math.PI / 2), secondary);
    dish.rotation.x = Math.PI;
    dish.scale.y = 0.6;
    dish.position.set(0.06, 2.12, -0.66);
    root.add(dish);

    const rosette = new THREE.Group();
    rosette.name = "equipment-rotor";
    rosette.position.set(0, 2.58, -0.02);
    root.add(rosette);
    const outer = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.035, 6, 16), secondary);
    rosette.add(outer);
    for (let index = 0; index < 8; index += 1) {
      const angle = index * Math.PI / 4;
      const tooth = this.addBox(rosette, [0.06, 0.045, 0.05], [Math.cos(angle) * 0.24, Math.sin(angle) * 0.24, 0], timber);
      tooth.rotation.z = angle;
    }
    const inner = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.028, 5, 12), primary);
    inner.position.z = 0.06;
    rosette.add(inner);

    const glass = new THREE.MeshStandardMaterial({
      color: 0xdff0ec, roughness: 0.08, metalness: 0.04, transparent: true, opacity: 0.32, depthWrite: false,
    });
    const cloche = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), glass);
    cloche.position.y = 2.36;
    cloche.castShadow = false;
    root.add(cloche);
    const finial = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), secondary);
    finial.position.y = 2.66;
    root.add(finial);
    const masterpiece = new THREE.Mesh(new THREE.OctahedronGeometry(0.17, 0), primary);
    masterpiece.name = "equipment-pulse";
    masterpiece.position.y = 2.5;
    root.add(masterpiece);

    const leaf = this.leafMaterial();
    for (let index = 0; index < 4; index += 1) {
      const angle = index / 4 * Math.PI * 2 + 1.1;
      const sprig = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), leaf);
      sprig.scale.y = 0.55;
      sprig.position.set(Math.cos(angle) * 0.72, 2.42, Math.sin(angle) * 0.72);
      root.add(sprig);
    }
  }

  /**
   * Industrial level 4 — the plant pours. A crucible tips on trunnions over a mould,
   * a copper recuperator wraps the flue and gives the heat back, planted ledges soften
   * the stack and a hot ingot glows in the sand. The finished factory is the only
   * station in the room with molten metal running down it.
   */
  private createFoundryCrown(
    root: THREE.Group,
    primary: THREE.MeshStandardMaterial,
    secondary: THREE.MeshStandardMaterial,
    dark: THREE.MeshStandardMaterial,
    timber: THREE.MeshStandardMaterial,
  ): void {
    for (const x of [0.14, 1.02]) this.addBox(root, [0.09, 0.5, 0.09], [x, 2.42, 0.14], timber);
    this.addBox(root, [1.02, 0.09, 0.12], [0.58, 2.7, 0.14], timber);

    const crucible = new THREE.Group();
    crucible.position.set(0.42, 2.46, 0.14);
    crucible.rotation.z = -0.5;
    root.add(crucible);
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.15, 0.3, 12), dark);
    crucible.add(pot);
    const lip = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.03, 5, 14), secondary);
    lip.rotation.x = Math.PI / 2;
    lip.position.y = 0.15;
    crucible.add(lip);
    const melt = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.04, 12), primary);
    melt.position.y = 0.12;
    crucible.add(melt);
    for (const dz of [-0.2, 0.2]) {
      const trunnion = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.12, 6), secondary);
      trunnion.rotation.x = Math.PI / 2;
      trunnion.position.set(0.42, 2.46, 0.14 + dz);
      root.add(trunnion);
    }
    const stream = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.055, 0.34, 6), primary);
    stream.position.set(0.62, 2.3, 0.14);
    stream.rotation.z = -0.18;
    root.add(stream);
    this.addBox(root, [0.44, 0.16, 0.34], [0.68, 2.06, 0.14], dark);
    this.addBox(root, [0.48, 0.05, 0.38], [0.68, 2.16, 0.14], secondary);
    const ingot = new THREE.Mesh(new THREE.IcosahedronGeometry(0.13, 0), primary);
    ingot.name = "equipment-pulse";
    ingot.position.set(0.68, 2.24, 0.14);
    root.add(ingot);

    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.44, 0.055, 6, 18), secondary);
    collar.rotation.x = Math.PI / 2;
    collar.position.set(-0.44, 2.34, -0.02);
    root.add(collar);
    const takeoff = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.56, 8), secondary);
    takeoff.position.set(-0.92, 2.06, -0.02);
    root.add(takeoff);
    const bend = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.055, 6, 10, Math.PI / 2), secondary);
    bend.rotation.x = Math.PI / 2;
    bend.rotation.z = Math.PI;
    bend.position.set(-0.78, 2.34, -0.02);
    root.add(bend);

    this.addBox(root, [0.9, 0.12, 0.28], [-0.44, 2.02, 0.42], timber);
    const leaf = this.leafMaterial();
    for (let index = 0; index < 4; index += 1) {
      const tuft = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), index % 2 === 0 ? leaf : secondary);
      tuft.scale.y = 0.6;
      tuft.position.set(-0.74 + index * 0.2, 2.14, 0.42);
      root.add(tuft);
    }
    for (const [x, z] of [[-0.02, 0.34], [-0.86, 0.3]] as Array<[number, number]>) {
      const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.2, 5), dark);
      cord.position.set(x, 2.5, z);
      root.add(cord);
      const lantern = new THREE.Mesh(new THREE.SphereGeometry(0.11, 9, 7), primary);
      lantern.scale.y = 1.15;
      lantern.position.set(x, 2.34, z);
      root.add(lantern);
    }
  }

  /**
   * Construction level 4 — the module is finished and landed on the gantry: a framed
   * timber house with lit windows, a planted roof, bunting strung off the beam and a
   * lantern hung under the eaves. Every other level was building; this one is built.
   */
  private createSkylineCrown(
    root: THREE.Group,
    primary: THREE.MeshStandardMaterial,
    secondary: THREE.MeshStandardMaterial,
    dark: THREE.MeshStandardMaterial,
    timber: THREE.MeshStandardMaterial,
  ): void {
    this.addBox(root, [1.06, 0.09, 0.86], [0, 2.46, -0.2], timber);
    const walls = this.addBox(root, [0.9, 0.36, 0.72], [0, 2.68, -0.2], secondary);
    walls.rotation.y = 0.02;
    for (const x of [-0.44, 0.44]) {
      for (const z of [-0.55, 0.15]) this.addBox(root, [0.08, 0.42, 0.08], [x, 2.68, z], timber);
    }
    this.addBox(root, [0.96, 0.07, 0.08], [0, 2.88, 0.15], timber);
    for (const x of [-0.22, 0.22]) {
      this.addBox(root, [0.24, 0.2, 0.03], [x, 2.7, 0.17], primary);
    }
    this.addBox(root, [0.16, 0.28, 0.03], [0, 2.64, 0.17], timber);

    const roof = new THREE.Mesh(new THREE.ConeGeometry(0.78, 0.24, 4, 1), timber);
    roof.rotation.y = Math.PI / 4;
    roof.position.set(0, 2.9, -0.2);
    root.add(roof);
    const leaf = this.leafMaterial();
    for (const [dx, dz, r] of [[-0.24, -0.28, 0.13], [0.2, -0.1, 0.12], [-0.04, -0.34, 0.11], [0.26, -0.36, 0.1]] as Array<[number, number, number]>) {
      const turf = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), leaf);
      turf.scale.y = 0.5;
      turf.position.set(dx, 2.92, -0.2 + dz);
      root.add(turf);
    }
    const chimney = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.22, 8), secondary);
    chimney.position.set(0.3, 2.92, -0.42);
    root.add(chimney);

    for (const [x, dy] of [[-0.7, 0.06], [-0.36, -0.02], [0.36, -0.02], [0.7, 0.06]] as Array<[number, number]>) {
      const pennant = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.14, 3), x < 0 ? primary : secondary);
      pennant.rotation.z = Math.PI;
      pennant.position.set(x, 2.36 + dy, 0.06);
      root.add(pennant);
    }
    const bunting = this.addBox(root, [1.6, 0.02, 0.02], [0, 2.46, 0.06], dark);
    bunting.rotation.z = 0.01;

    const hang = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.16, 5), dark);
    hang.position.set(0.5, 2.36, 0.14);
    root.add(hang);
    const lamp = new THREE.Mesh(new THREE.OctahedronGeometry(0.14, 0), primary);
    lamp.name = "equipment-pulse";
    lamp.position.set(0.5, 2.18, 0.14);
    root.add(lamp);
  }


  /**
   * Packaging level 1 — a folding table: trestle legs, a slab top, a brass crease
   * rule along the back edge, a stack of flat blanks and one crate folded up by hand.
   *
   * Nothing is powered and nothing turns; the packhouse starts with flat card, a
   * straight edge and somebody's thumbs. Every later level bolts onto this benchtop.
   */
  private createFoldingTable(
    key: UpgradeKey,
    root: THREE.Group,
    primary: THREE.MeshStandardMaterial,
    secondary: THREE.MeshStandardMaterial,
    dark: THREE.MeshStandardMaterial,
    cream: THREE.MeshStandardMaterial,
    timber: THREE.MeshStandardMaterial,
  ): void {
    for (const x of [-0.66, 0.66]) {
      for (const z of [-0.34, 0.34]) this.addBox(root, [0.11, 0.46, 0.11], [x, 0.72, z], timber);
    }
    this.addBox(root, [1.5, 0.06, 0.11], [0, 0.62, 0], timber);
    this.addBox(root, [1.66, 0.1, 0.94], [0, 1.0, 0], timber);
    this.addBox(root, [1.6, 0.035, 0.09], [0, 1.07, -0.4], secondary);
    for (const x of [-0.74, 0.74]) this.addBox(root, [0.08, 0.1, 0.14], [x, 1.09, -0.4], timber);

    for (let index = 0; index < 4; index += 1) {
      const blank = this.addBox(root, [0.64, 0.025, 0.44], [-0.44, 1.07 + index * 0.03, 0.12], cream);
      blank.rotation.y = (index - 1.5) * 0.035;
    }

    this.addBox(root, [0.5, 0.04, 0.42], [0.42, 1.07, 0.04], timber);
    for (const side of [-1, 1]) {
      const flap = this.addBox(root, [0.5, 0.3, 0.035], [0.42, 1.21, side * 0.24], timber);
      flap.rotation.x = side * 0.42;
    }
    const endFlap = this.addBox(root, [0.035, 0.28, 0.42], [0.65, 1.19, 0.04], timber);
    endFlap.rotation.z = -0.46;

    const spool = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.032, 6, 12), secondary);
    spool.position.set(0.84, 1.16, -0.24);
    root.add(spool);
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.16, 10), cream);
    pot.position.set(-0.82, 1.13, -0.2);
    root.add(pot);
    const brush = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.24, 6), timber);
    brush.rotation.z = 0.5;
    brush.position.set(-0.76, 1.26, -0.2);
    root.add(brush);

    if (key === "yield") {
      this.addBox(root, [0.58, 0.05, 0.05], [0.06, 1.09, -0.24], secondary);
      this.addBox(root, [0.05, 0.05, 0.34], [-0.2, 1.09, -0.08], secondary);
      const gauge = this.addBox(root, [0.26, 0.3, 0.02], [-0.2, 1.27, -0.26], cream);
      gauge.rotation.y = 0.22;
      const mark = this.addBox(root, [0.12, 0.12, 0.012], [-0.2, 1.27, -0.24], primary);
      mark.rotation.z = 0.78;
      mark.rotation.y = 0.22;
    } else if (key === "capacity") {
      this.addBox(root, [1.46, 0.06, 0.76], [0, 0.7, 0], timber);
      for (const [x, scale] of [[-0.38, 0.5], [0.34, 0.42]] as Array<[number, number]>) {
        const crate = this.addBox(root, [scale, scale * 0.62, scale * 0.86], [x, 0.9, 0], timber);
        crate.rotation.y = x * 0.3;
        this.addBox(crate, [scale * 0.86, 0.02, scale * 0.72], [0, scale * 0.29, 0], dark);
        this.addBox(crate, [scale * 1.03, 0.05, scale * 0.9], [0, 0, 0], secondary);
      }
    } else if (key === "speed") {
      for (const x of [-0.7, 0.7]) this.addBox(root, [0.08, 0.1, 0.46], [x, 1.0, 0.68], timber);
      for (const z of [0.52, 0.68, 0.84]) {
        const roller = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 1.34, 10), secondary);
        roller.name = "flow-roller";
        roller.rotation.z = Math.PI / 2;
        roller.position.set(0, 1.04, z);
        root.add(roller);
      }
    } else {
      const easel = this.addBox(root, [0.42, 0.32, 0.02], [0.68, 1.3, 0.2], cream);
      easel.rotation.x = -0.26;
      easel.rotation.y = -0.2;
      const stamp = this.addBox(root, [0.16, 0.16, 0.012], [0.68, 1.32, 0.24], primary);
      stamp.rotation.x = -0.26;
      stamp.rotation.y = -0.2;
      const prop = this.addBox(root, [0.03, 0.28, 0.03], [0.68, 1.2, 0.1], timber);
      prop.rotation.x = 0.3;
      const block = this.addBox(root, [0.16, 0.08, 0.14], [0.3, 1.11, 0.3], timber);
      block.rotation.y = 0.2;
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), secondary);
      knob.position.set(0.3, 1.2, 0.3);
      root.add(knob);
      const pad = this.addBox(root, [0.2, 0.04, 0.16], [0.02, 1.07, 0.36], dark);
      pad.rotation.y = -0.16;
    }
  }

  /**
   * Logistics level 1 — a two-wheel dispatch cart with two roped parcels and a slate.
   *
   * The depot opens with one cart that somebody pushes: no rack, no chute, no board.
   * The cart stays at the middle of every later level, which is why it is parked
   * square to the front and the racking grows behind it.
   */
  private createDispatchCart(
    key: UpgradeKey,
    root: THREE.Group,
    primary: THREE.MeshStandardMaterial,
    secondary: THREE.MeshStandardMaterial,
    dark: THREE.MeshStandardMaterial,
    cream: THREE.MeshStandardMaterial,
    timber: THREE.MeshStandardMaterial,
  ): void {
    this.addBox(root, [1.06, 0.09, 0.64], [0, 0.88, 0], timber);
    for (const z of [-0.24, 0.24]) this.addBox(root, [1.02, 0.07, 0.08], [0, 0.81, z], timber);

    const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.36, 8), dark);
    axle.rotation.z = Math.PI / 2;
    axle.position.set(0, 0.78, 0);
    root.add(axle);
    for (const x of [-0.64, 0.64]) {
      const tyre = new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.055, 7, 16), dark);
      tyre.rotation.y = Math.PI / 2;
      tyre.position.set(x, 0.78, 0);
      root.add(tyre);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.1, 10), secondary);
      hub.rotation.z = Math.PI / 2;
      hub.position.set(x, 0.78, 0);
      root.add(hub);
      for (let index = 0; index < 4; index += 1) {
        const spoke = this.addBox(root, [0.04, 0.5, 0.035], [x, 0.78, 0], timber);
        spoke.rotation.y = Math.PI / 2;
        spoke.rotation.z = index * Math.PI / 4;
      }
    }
    const prop = this.addBox(root, [0.08, 0.44, 0.08], [0, 0.7, 0.42], timber);
    prop.rotation.x = 0.34;

    for (const x of [-0.36, 0.36]) {
      const handle = this.addBox(root, [0.07, 0.72, 0.07], [x, 1.16, -0.4], timber);
      handle.rotation.x = -0.32;
    }
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.9, 8), secondary);
    grip.rotation.z = Math.PI / 2;
    grip.position.set(0, 1.46, -0.56);
    root.add(grip);

    const heavy = this.addBox(root, [0.46, 0.38, 0.44], [-0.24, 1.12, 0], cream);
    heavy.rotation.y = 0.12;
    for (const turn of [0, Math.PI / 2]) {
      const strap = this.addBox(heavy, [turn === 0 ? 0.48 : 0.07, 0.4, turn === 0 ? 0.07 : 0.46], [0, 0, 0], secondary);
      strap.rotation.y = 0;
    }
    const light = this.addBox(root, [0.4, 0.3, 0.38], [0.28, 1.08, 0.04], timber);
    light.rotation.y = -0.16;
    const label = this.addBox(light, [0.22, 0.16, 0.01], [0, 0.02, 0.2], cream);
    label.rotation.y = 0;
    const slate = this.addBox(root, [0.36, 0.28, 0.03], [0.42, 0.7, 0.4], dark);
    slate.rotation.x = -0.38;
    slate.rotation.y = -0.2;
    for (const y of [0.68, 0.74]) {
      const chalk = this.addBox(root, [0.22, 0.02, 0.012], [0.42, y, 0.36], cream);
      chalk.rotation.x = -0.38;
      chalk.rotation.y = -0.2;
    }

    if (key === "yield") {
      const post = this.addBox(root, [0.07, 0.52, 0.07], [-0.5, 1.16, 0.34], timber);
      post.rotation.z = 0.06;
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.34, 6), secondary);
      arm.rotation.z = Math.PI / 2;
      arm.position.set(-0.35, 1.4, 0.34);
      root.add(arm);
      const loupe = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.08, 0.14, 12), secondary);
      loupe.position.set(-0.2, 1.36, 0.34);
      root.add(loupe);
      const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.02, 12), primary);
      lens.position.set(-0.2, 1.28, 0.34);
      root.add(lens);
      const seal = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.02, 8), primary);
      seal.rotation.x = Math.PI / 2;
      seal.position.set(-0.24, 1.16, 0.23);
      root.add(seal);
    } else if (key === "capacity") {
      const stack = this.addBox(root, [0.42, 0.32, 0.4], [-0.24, 1.47, 0], timber);
      stack.rotation.y = -0.18;
      const top = this.addBox(root, [0.34, 0.24, 0.32], [-0.2, 1.75, 0.02], cream);
      top.rotation.y = 0.24;
      for (const turn of [-0.5, 0.5]) {
        const net = this.addBox(root, [0.03, 0.86, 0.03], [-0.22, 1.5, 0], dark);
        net.rotation.z = turn;
      }
      for (const y of [1.35, 1.66]) this.addBox(root, [0.5, 0.03, 0.03], [-0.22, y, 0.2], dark);
    } else if (key === "speed") {
      for (const x of [-0.34, 0.34]) {
        const caster = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.14, 10), secondary);
        caster.name = "flow-roller";
        caster.rotation.z = Math.PI / 2;
        caster.position.set(x, 0.6, 0.42);
        root.add(caster);
        this.addBox(root, [0.05, 0.18, 0.05], [x, 0.74, 0.42], dark);
      }
      const bell = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), secondary);
      bell.rotation.x = Math.PI;
      bell.position.set(0.32, 1.42, -0.54);
      root.add(bell);
      const clapper = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 5), primary);
      clapper.position.set(0.32, 1.34, -0.54);
      root.add(clapper);
    } else {
      const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.16, 5), dark);
      cord.position.set(-0.12, 1.36, -0.5);
      root.add(cord);
      const tag = this.addBox(root, [0.34, 0.24, 0.02], [-0.12, 1.16, -0.5], cream);
      tag.rotation.y = 0.16;
      const stripe = this.addBox(root, [0.3, 0.06, 0.01], [-0.12, 1.2, -0.49], secondary);
      stripe.rotation.y = 0.16;
      const hook = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.014, 5, 10, Math.PI), secondary);
      hook.position.set(0.3, 1.44, -0.52);
      root.add(hook);
      const lantern = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), primary);
      lantern.scale.y = 1.2;
      lantern.position.set(0.3, 1.32, -0.52);
      root.add(lantern);
    }
  }

  /**
   * Retail level 1 — a cloth-covered market trestle with two tilted produce trays,
   * a chalk price board and a bare awning pole with the canopy still rolled up.
   *
   * The rolled cloth is deliberate: it is the promise the level 4 lantern canopy
   * finally unfurls. Level 1 is one table, one seller, no shelter and no light.
   */
  private createMarketStall(
    key: UpgradeKey,
    root: THREE.Group,
    primary: THREE.MeshStandardMaterial,
    secondary: THREE.MeshStandardMaterial,
    dark: THREE.MeshStandardMaterial,
    cream: THREE.MeshStandardMaterial,
    timber: THREE.MeshStandardMaterial,
  ): void {
    for (const x of [-0.64, 0.64]) {
      for (const side of [-1, 1]) {
        const leg = this.addBox(root, [0.09, 0.58, 0.09], [x, 0.76, side * 0.24], timber);
        leg.rotation.x = side * 0.26;
      }
      this.addBox(root, [0.09, 0.05, 0.52], [x, 0.72, 0], timber);
    }
    this.addBox(root, [1.68, 0.09, 0.9], [0, 1.02, 0], timber);
    this.addBox(root, [1.72, 0.025, 0.94], [0, 1.08, 0], cream);
    this.addBox(root, [1.72, 0.2, 0.03], [0, 0.98, 0.47], cream);
    for (const x of [-0.6, -0.2, 0.2, 0.6]) {
      const scallop = new THREE.Mesh(new THREE.SphereGeometry(0.1, 9, 6), cream);
      scallop.scale.set(1, 0.7, 0.2);
      scallop.position.set(x, 0.88, 0.47);
      root.add(scallop);
    }

    for (const [x, first, second] of [[-0.42, primary, secondary], [0.42, secondary, primary]] as Array<[number, THREE.MeshStandardMaterial, THREE.MeshStandardMaterial]>) {
      const tray = this.addBox(root, [0.66, 0.05, 0.42], [x, 1.15, 0.06], timber);
      tray.rotation.x = -0.22;
      this.addBox(root, [0.66, 0.11, 0.04], [x, 1.15, 0.26], timber);
      for (let index = 0; index < 3; index += 1) {
        const fruit = new THREE.Mesh(new THREE.SphereGeometry(0.1, 9, 7), index === 1 ? second : first);
        fruit.position.set(x - 0.2 + index * 0.2, 1.24 + (index % 2) * 0.02, 0.06 - (index % 2) * 0.08);
        root.add(fruit);
      }
    }

    const board = this.addBox(root, [0.34, 0.26, 0.025], [-0.84, 1.24, 0.28], dark);
    board.rotation.y = 0.42;
    for (const y of [1.2, 1.28]) {
      const chalk = this.addBox(root, [0.22, 0.02, 0.012], [-0.83, y, 0.29], cream);
      chalk.rotation.y = 0.42;
    }

    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 1.7, 8), timber);
    pole.position.set(-0.88, 1.34, 0.6);
    root.add(pole);
    const rolled = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.4, 10), cream);
    rolled.rotation.z = Math.PI / 2;
    rolled.position.set(-0.68, 2.12, 0.6);
    root.add(rolled);
    for (const x of [-0.8, -0.56]) {
      const tie = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.016, 5, 10), secondary);
      tie.rotation.y = Math.PI / 2;
      tie.position.set(x, 2.12, 0.6);
      root.add(tie);
    }

    if (key === "yield") {
      const leaf = this.leafMaterial();
      for (const [x, z] of [[-0.66, 0.16], [0.66, 0.16]] as Array<[number, number]>) {
        const bed = new THREE.Mesh(new THREE.SphereGeometry(0.14, 9, 6), leaf);
        bed.scale.set(1, 0.32, 0.7);
        bed.position.set(x, 1.2, z);
        root.add(bed);
      }
      const can = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.22, 10), secondary);
      can.position.set(0.02, 1.2, -0.3);
      root.add(can);
      const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.035, 0.3, 7), secondary);
      spout.rotation.z = -0.9;
      spout.position.set(0.18, 1.26, -0.3);
      root.add(spout);
      const bail = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.014, 5, 10, Math.PI), secondary);
      bail.position.set(-0.08, 1.32, -0.3);
      root.add(bail);
    } else if (key === "capacity") {
      this.addBox(root, [1.46, 0.06, 0.7], [0, 0.72, 0], timber);
      for (const [x, scale] of [[-0.4, 0.46], [0.36, 0.4]] as Array<[number, number]>) {
        const crate = this.addBox(root, [scale, scale * 0.66, scale * 0.9], [x, 0.91, 0], timber);
        crate.rotation.y = x * 0.24;
        this.addBox(crate, [scale * 0.84, 0.02, scale * 0.74], [0, scale * 0.31, 0], dark);
      }
      const sack = new THREE.Mesh(new THREE.SphereGeometry(0.19, 10, 8), cream);
      sack.scale.set(0.9, 1.05, 0.8);
      sack.position.set(0.82, 0.9, 0.16);
      root.add(sack);
    } else if (key === "speed") {
      for (const z of [0.56, 0.72]) {
        const roller = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.72, 10), secondary);
        roller.name = "flow-roller";
        roller.rotation.z = Math.PI / 2;
        roller.position.set(0.42, 1.06, z);
        root.add(roller);
      }
      for (const x of [0.08, 0.76]) this.addBox(root, [0.07, 0.1, 0.3], [x, 1.03, 0.64], timber);
      for (let index = 0; index < 3; index += 1) {
        this.addBox(root, [0.28, 0.02, 0.24], [-0.5, 1.11 + index * 0.025, 0.3], cream);
      }
      const bell = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), secondary);
      bell.position.set(-0.02, 1.11, 0.3);
      root.add(bell);
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 5), primary);
      knob.position.set(-0.02, 1.21, 0.3);
      root.add(knob);
    } else {
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.32, 6), secondary);
      arm.rotation.z = Math.PI / 2;
      arm.position.set(-0.73, 1.98, 0.6);
      root.add(arm);
      const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.16, 5), dark);
      cord.position.set(-0.58, 1.88, 0.6);
      root.add(cord);
      const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.2, 8), cream);
      lamp.position.set(-0.58, 1.69, 0.6);
      root.add(lamp);
      const cap = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.09, 8), secondary);
      cap.position.set(-0.58, 1.82, 0.6);
      root.add(cap);
      const glow = new THREE.Mesh(new THREE.SphereGeometry(0.07, 9, 7), primary);
      glow.position.set(-0.58, 1.69, 0.6);
      root.add(glow);
      const card = this.addBox(root, [0.36, 0.24, 0.02], [-0.88, 1.5, 0.72], cream);
      card.rotation.y = -0.3;
      const rule = this.addBox(root, [0.28, 0.05, 0.01], [-0.87, 1.54, 0.73], secondary);
      rule.rotation.y = -0.3;
    }
  }

  /**
   * Packaging level 3 — a take-away roller bed with a strap-banding arch over it, a
   * kraft roll on brass arms and a planted offcut-return bin.
   *
   * Level 2 gave the bench a press it works by lever; level 3 is the first time a
   * finished crate leaves the bench on its own rollers and gets banded on the way out.
   */
  private createFlatpackLine(
    root: THREE.Group,
    primary: THREE.MeshStandardMaterial,
    secondary: THREE.MeshStandardMaterial,
    dark: THREE.MeshStandardMaterial,
    cream: THREE.MeshStandardMaterial,
    timber: THREE.MeshStandardMaterial,
  ): void {
    for (const x of [0.3, 0.86]) {
      for (const z of [-0.08, 0.6] as const) this.addBox(root, [0.08, 0.36, 0.08], [x, 0.67, z], timber);
      this.addBox(root, [0.07, 0.1, 1.06], [x, 0.85, 0.26], timber);
    }
    for (let index = 0; index < 4; index += 1) {
      const roller = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.058, 0.62, 10), secondary);
      roller.name = "flow-roller";
      roller.rotation.z = Math.PI / 2;
      roller.position.set(0.58, 0.87, -0.16 + index * 0.29);
      root.add(roller);
    }
    const parcel = this.addBox(root, [0.4, 0.34, 0.4], [0.58, 1.1, 0.7], timber);
    parcel.rotation.y = 0.06;
    this.addBox(parcel, [0.42, 0.06, 0.42], [0, 0.02, 0], secondary);
    this.addBox(parcel, [0.2, 0.14, 0.01], [0, 0.1, 0.21], cream);

    for (const x of [0.34, 0.82]) {
      this.addBox(root, [0.07, 0.78, 0.07], [x, 1.55, 0.7], secondary);
      this.addBox(root, [0.13, 0.05, 0.13], [x, 1.18, 0.7], dark);
    }
    this.addBox(root, [0.62, 0.1, 0.14], [0.58, 1.98, 0.7], timber);
    const reel = new THREE.Group();
    reel.name = "equipment-rotor";
    reel.position.set(0.34, 1.74, 0.82);
    root.add(reel);
    const reelRim = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.045, 6, 12), secondary);
    reel.add(reelRim);
    for (let index = 0; index < 3; index += 1) {
      const spoke = this.addBox(reel, [0.32, 0.035, 0.03], [0, 0, 0], timber);
      spoke.rotation.z = index * Math.PI / 3;
    }
    const strap = this.addBox(root, [0.03, 0.34, 0.05], [0.36, 1.52, 0.82], cream);
    strap.rotation.z = 0.1;
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.23, 0.022, 5, 14), primary);
    band.rotation.y = Math.PI / 2;
    band.position.set(0.58, 1.1, 0.7);
    root.add(band);

    for (const x of [-0.94, -0.3]) this.addBox(root, [0.06, 0.5, 0.06], [x, 1.51, -0.68], secondary);
    const kraft = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.68, 12), cream);
    kraft.rotation.z = Math.PI / 2;
    kraft.position.set(-0.62, 1.8, -0.68);
    root.add(kraft);
    const sheet = this.addBox(root, [0.62, 0.5, 0.02], [-0.62, 1.4, -0.6], cream);
    sheet.rotation.x = 0.12;
    const core = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.74, 8), secondary);
    core.rotation.z = Math.PI / 2;
    core.position.set(-0.62, 1.8, -0.68);
    root.add(core);

    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.2, 10), secondary);
    pot.position.set(-0.62, 1.16, 0.12);
    root.add(pot);
    const nozzle = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.12, 8), primary);
    nozzle.position.set(-0.62, 1.31, 0.12);
    root.add(nozzle);

    const bin = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.21, 0.52, 12, 1, true), timber);
    bin.position.set(-0.84, 0.76, 0.58);
    root.add(bin);
    for (const y of [0.56, 0.96]) {
      const weave = new THREE.Mesh(new THREE.TorusGeometry(0.245, 0.022, 5, 14), secondary);
      weave.rotation.x = Math.PI / 2;
      weave.position.set(-0.84, y, 0.58);
      root.add(weave);
    }
    for (const [x, z] of [[-0.92, 0.52], [-0.76, 0.64]] as Array<[number, number]>) {
      const offcut = this.addBox(root, [0.16, 0.05, 0.12], [x, 1.0, z], cream);
      offcut.rotation.y = x * 3;
      offcut.rotation.z = 0.2;
    }
    const leaf = this.leafMaterial();
    const tuft = new THREE.Mesh(new THREE.SphereGeometry(0.14, 9, 7), leaf);
    tuft.scale.set(1, 0.5, 0.9);
    tuft.position.set(-0.84, 1.06, 0.58);
    root.add(tuft);
  }

  /**
   * Logistics level 3 — a sloping roller chute off a turning diverter head, two woven
   * destination bins at its foot and a pegged route board.
   *
   * Level 2 stacked the depot; level 3 is where it starts to *sort*. The chute reads
   * downhill from the rack behind to the bins at the front, so the route is legible.
   */
  private createRouteSorter(
    root: THREE.Group,
    primary: THREE.MeshStandardMaterial,
    secondary: THREE.MeshStandardMaterial,
    dark: THREE.MeshStandardMaterial,
    cream: THREE.MeshStandardMaterial,
    timber: THREE.MeshStandardMaterial,
  ): void {
    const tilt = 0.36;
    for (const x of [0.26, 0.88]) {
      const rail = this.addBox(root, [0.06, 0.1, 1.24], [x, 1.22, 0.02], timber);
      rail.rotation.x = tilt;
      this.addBox(root, [0.07, 0.92, 0.07], [x, 0.96, -0.5], timber);
      this.addBox(root, [0.07, 0.5, 0.07], [x, 0.75, 0.42], timber);
    }
    for (let index = 0; index < 4; index += 1) {
      const z = -0.45 + index * 0.3;
      const roller = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.062, 0.6, 10), secondary);
      roller.name = "flow-roller";
      roller.rotation.z = Math.PI / 2;
      roller.position.set(0.57, 1.24 - z * Math.sin(tilt), z);
      root.add(roller);
    }
    this.addBox(root, [0.68, 0.06, 0.06], [0.57, 0.98, 0.42], dark);
    this.addBox(root, [0.68, 0.06, 0.06], [0.57, 1.34, -0.5], dark);
    const rider = this.addBox(root, [0.3, 0.24, 0.28], [0.57, 1.46, -0.22], cream);
    rider.rotation.x = tilt;
    this.addBox(rider, [0.32, 0.05, 0.3], [0, 0.03, 0], secondary);

    const diverter = new THREE.Group();
    diverter.name = "equipment-rotor";
    diverter.position.set(0.57, 1.62, -0.62);
    root.add(diverter);
    const diverterRim = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.04, 6, 14), secondary);
    diverter.add(diverterRim);
    for (let index = 0; index < 4; index += 1) {
      const paddle = this.addBox(diverter, [0.36, 0.05, 0.09], [0, 0, 0], timber);
      paddle.rotation.z = index * Math.PI / 4;
    }

    for (const [x, z, fill] of [[0.2, 0.62, primary], [0.86, 0.6, cream]] as Array<[number, number, THREE.MeshStandardMaterial]>) {
      const bin = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.2, 0.48, 12, 1, true), timber);
      bin.position.set(x, 0.74, z);
      root.add(bin);
      for (const y of [0.56, 0.92]) {
        const weave = new THREE.Mesh(new THREE.TorusGeometry(0.235, 0.022, 5, 14), secondary);
        weave.rotation.x = Math.PI / 2;
        weave.position.set(x, y, z);
        root.add(weave);
      }
      const load = this.addBox(root, [0.28, 0.2, 0.26], [x, 1.0, z], fill);
      load.rotation.y = x;
    }

    const face = 0.52;
    const frame = this.addBox(root, [0.66, 0.52, 0.05], [-0.82, 1.5, 0.0], cream);
    frame.rotation.y = face;
    for (const [dx, dy] of [[-0.2, 0.14], [0.0, -0.04], [0.2, 0.12]] as Array<[number, number]>) {
      const peg = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.08, 6), secondary);
      peg.rotation.x = Math.PI / 2;
      peg.rotation.y = face;
      peg.position.set(-0.79 + dx * Math.cos(face), 1.5 + dy, -dx * Math.sin(face) + 0.04);
      root.add(peg);
    }
    for (const [dx, lean] of [[-0.1, 0.5], [0.12, -0.4]] as Array<[number, number]>) {
      const route = this.addBox(root, [0.3, 0.025, 0.01], [-0.79 + dx * Math.cos(face), 1.53, -dx * Math.sin(face) + 0.03], primary);
      route.rotation.y = face;
      route.rotation.z = lean;
    }
    const hood = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.14, 8), secondary);
    hood.position.set(-0.82, 1.9, 0.0);
    root.add(hood);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), primary);
    lamp.position.set(-0.82, 1.8, 0.0);
    root.add(lamp);
    this.addBox(root, [0.06, 0.3, 0.06], [-0.82, 2.06, 0.0], timber);
  }

  /**
   * Retail level 3 — a serving counter across the front with a copper refill urn, a
   * glass dome over the produce and a hanging herb frame.
   *
   * Level 2 filled the shelves; level 3 is where the stall becomes a shop you are
   * served at, and the first glass and running copper appear.
   */
  private createServeCounter(
    root: THREE.Group,
    primary: THREE.MeshStandardMaterial,
    secondary: THREE.MeshStandardMaterial,
    dark: THREE.MeshStandardMaterial,
    cream: THREE.MeshStandardMaterial,
    timber: THREE.MeshStandardMaterial,
  ): void {
    const glass = new THREE.MeshStandardMaterial({
      color: 0xd8efe8,
      roughness: 0.13,
      metalness: 0.06,
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
    });

    this.addBox(root, [1.5, 0.5, 0.32], [0, 0.76, 0.74], timber);
    this.addBox(root, [1.58, 0.07, 0.44], [0, 1.05, 0.74], cream);
    for (const x of [-0.66, 0.66]) this.addBox(root, [0.05, 0.05, 0.34], [x, 0.62, 0.9], secondary);
    const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.4, 8), secondary);
    rail.rotation.z = Math.PI / 2;
    rail.position.set(0, 0.62, 0.92);
    root.add(rail);
    for (const x of [-0.4, 0.1, 0.5]) this.addBox(root, [0.28, 0.02, 0.32], [x, 1.09, 0.74], primary);

    const urn = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.19, 0.34, 12), secondary);
    urn.position.set(-0.52, 1.26, 0.72);
    root.add(urn);
    const lid = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.14, 12), secondary);
    lid.position.set(-0.52, 1.5, 0.72);
    root.add(lid);
    const finial = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), primary);
    finial.position.set(-0.52, 1.59, 0.72);
    root.add(finial);
    const tap = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.16, 6), secondary);
    tap.rotation.x = Math.PI / 2;
    tap.position.set(-0.52, 1.18, 0.9);
    root.add(tap);
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.06, 0.12, 10), cream);
    cup.position.set(-0.52, 1.15, 0.99);
    root.add(cup);

    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 9, 0, Math.PI * 2, 0, Math.PI / 2), glass);
    dome.position.set(0.38, 1.09, 0.74);
    root.add(dome);
    const domeRim = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.022, 6, 16), secondary);
    domeRim.rotation.x = Math.PI / 2;
    domeRim.position.set(0.38, 1.1, 0.74);
    root.add(domeRim);
    for (const [dx, dz] of [[-0.08, -0.04], [0.08, 0.04]] as Array<[number, number]>) {
      const cake = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.1, 12), cream);
      cake.position.set(0.38 + dx, 1.14, 0.74 + dz);
      root.add(cake);
      const icing = new THREE.Mesh(new THREE.CylinderGeometry(0.078, 0.078, 0.025, 12), primary);
      icing.position.set(0.38 + dx, 1.2, 0.74 + dz);
      root.add(icing);
    }

    const leaf = this.leafMaterial();
    this.addBox(root, [0.09, 0.86, 0.4], [0.95, 1.62, 0.12], timber);
    for (let index = 0; index < 3; index += 1) {
      const pocket = this.addBox(root, [0.05, 0.16, 0.18], [0.89, 1.34 + index * 0.28, 0.02 + (index % 2) * 0.2], cream);
      pocket.rotation.z = 0.12;
      const herb = new THREE.Mesh(new THREE.SphereGeometry(0.12, 9, 7), leaf);
      herb.scale.set(0.7, 0.8, 1);
      herb.position.set(0.85, 1.46 + index * 0.28, 0.02 + (index % 2) * 0.2);
      root.add(herb);
    }

    const line = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.5, 5), dark);
    line.rotation.z = Math.PI / 2;
    line.position.set(-0.05, 2.14, -0.16);
    root.add(line);
    for (let index = 0; index < 4; index += 1) {
      const x = -0.62 + index * 0.38;
      const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.14, 5), dark);
      cord.position.set(x, 2.06, -0.16);
      root.add(cord);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.085, 9, 7), index % 2 === 0 ? primary : secondary);
      lamp.scale.y = 1.15;
      lamp.position.set(x, 1.93, -0.16);
      root.add(lamp);
    }
  }

  /**
   * Packaging level 4 — an overhead gantry with a travelling taping head, kraft
   * bunting, hanging lanterns and a planter along the beam.
   *
   * The line finally runs over the bench instead of beside it, and the seal mark
   * turning above the gantry is the only lit thing on the machine.
   */
  private createPackhouseCrown(
    root: THREE.Group,
    primary: THREE.MeshStandardMaterial,
    secondary: THREE.MeshStandardMaterial,
    dark: THREE.MeshStandardMaterial,
    timber: THREE.MeshStandardMaterial,
  ): void {
    for (const x of [-0.84, 0.84]) this.addBox(root, [0.1, 0.44, 0.1], [x, 2.2, -0.1], timber);
    this.addBox(root, [1.9, 0.13, 0.18], [0, 2.48, -0.1], timber);
    this.addBox(root, [1.84, 0.04, 0.07], [0, 2.38, -0.1], secondary);

    const head = this.addBox(root, [0.34, 0.24, 0.3], [0.26, 2.22, -0.1], dark);
    head.rotation.y = 0.06;
    const tape = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.035, 6, 12), secondary);
    tape.rotation.y = Math.PI / 2;
    tape.position.set(0.26, 2.2, 0.08);
    root.add(tape);
    const tail = this.addBox(root, [0.2, 0.02, 0.16], [0.26, 2.08, 0.02], primary);
    tail.rotation.x = 0.4;
    for (const dx of [-0.13, 0.13]) this.addBox(root, [0.05, 0.12, 0.05], [0.26 + dx, 2.4, -0.1], secondary);

    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.5, 5), dark);
    cord.rotation.z = Math.PI / 2;
    cord.position.set(0, 2.3, 0.34);
    root.add(cord);
    for (let index = 0; index < 5; index += 1) {
      const flag = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.18, 3), index % 2 === 0 ? primary : secondary);
      flag.rotation.x = Math.PI;
      flag.position.set(-0.6 + index * 0.3, 2.2, 0.34);
      root.add(flag);
    }

    for (const x of [-0.66, 0.66]) {
      const hang = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.18, 5), dark);
      hang.position.set(x, 2.32, -0.1);
      root.add(hang);
      const lantern = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), primary);
      lantern.scale.y = 1.2;
      lantern.position.set(x, 2.14, -0.1);
      root.add(lantern);
    }

    const trough = this.addBox(root, [0.52, 0.11, 0.22], [-0.5, 2.6, -0.1], timber);
    trough.rotation.z = 0.03;
    const leaf = this.leafMaterial();
    for (const x of [-0.66, -0.5, -0.34]) {
      const tuft = new THREE.Mesh(new THREE.SphereGeometry(0.11, 9, 7), leaf);
      tuft.scale.set(1, 0.6, 1);
      tuft.position.set(x, 2.68, -0.1);
      root.add(tuft);
    }

    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.03, 6, 18), secondary);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(0.4, 2.72, -0.1);
    root.add(ring);
    const seal = new THREE.Mesh(new THREE.OctahedronGeometry(0.17, 0), primary);
    seal.name = "equipment-pulse";
    seal.position.set(0.4, 2.72, -0.1);
    root.add(seal);
  }

  /**
   * Logistics level 4 — a lit arrival board over the depot, a small jib with a hanging
   * crate, signal lanterns and a quayside planter.
   *
   * Nothing below level 4 tells anyone when a cargo lands, so the board is what reads
   * from the door: this depot is on a timetable now.
   */
  private createQuayCrown(
    root: THREE.Group,
    primary: THREE.MeshStandardMaterial,
    secondary: THREE.MeshStandardMaterial,
    dark: THREE.MeshStandardMaterial,
    timber: THREE.MeshStandardMaterial,
  ): void {
    for (const x of [-0.68, 0.68]) this.addBox(root, [0.09, 0.44, 0.09], [x, 2.06, -0.34], timber);
    this.addBox(root, [1.6, 0.5, 0.09], [0, 2.52, -0.34], dark);
    for (const y of [2.29, 2.75]) this.addBox(root, [1.68, 0.06, 0.13], [0, y, -0.34], secondary);
    for (let index = 0; index < 6; index += 1) {
      const slat = this.addBox(
        root,
        [0.4, 0.09, 0.02],
        [-0.46 + (index % 3) * 0.46, 2.64 - Math.floor(index / 3) * 0.22, -0.28],
        index === 1 || index === 5 ? primary : timber,
      );
      slat.rotation.x = 0.04;
    }

    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.065, 0.66, 8), secondary);
    mast.position.set(-0.86, 2.28, 0.16);
    root.add(mast);
    const jib = this.addBox(root, [0.6, 0.08, 0.08], [-0.58, 2.56, 0.16], timber);
    jib.rotation.z = -0.14;
    const stay = this.addBox(root, [0.05, 0.42, 0.05], [-0.74, 2.46, 0.16], dark);
    stay.rotation.z = 0.7;
    const sheave = new THREE.Group();
    sheave.name = "equipment-rotor";
    sheave.position.set(-0.32, 2.5, 0.16);
    root.add(sheave);
    const sheaveRim = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.026, 5, 12), secondary);
    sheave.add(sheaveRim);
    const fall = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.26, 5), dark);
    fall.position.set(-0.32, 2.3, 0.16);
    root.add(fall);
    const slung = this.addBox(root, [0.28, 0.24, 0.26], [-0.32, 2.06, 0.16], timber);
    slung.rotation.y = 0.2;
    this.addBox(slung, [0.3, 0.05, 0.28], [0, 0.02, 0], secondary);

    for (const x of [0.1, 0.52, 0.9]) {
      const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.16, 5), dark);
      cord.position.set(x, 2.32, 0.3);
      root.add(cord);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), x === 0.52 ? secondary : primary);
      lamp.scale.y = 1.2;
      lamp.position.set(x, 2.16, 0.3);
      root.add(lamp);
    }

    const trough = this.addBox(root, [0.46, 0.1, 0.2], [0.56, 2.82, -0.34], timber);
    const leaf = this.leafMaterial();
    for (const x of [0.42, 0.56, 0.7]) {
      const tuft = new THREE.Mesh(new THREE.SphereGeometry(0.1, 9, 7), leaf);
      tuft.scale.set(1, 0.6, 1);
      tuft.position.set(x, 2.9, -0.34);
      root.add(tuft);
    }
    trough.rotation.z = -0.02;

    const beacon = new THREE.Mesh(new THREE.OctahedronGeometry(0.16, 0), primary);
    beacon.name = "equipment-pulse";
    beacon.position.set(-0.4, 2.88, -0.34);
    root.add(beacon);
    this.addBox(root, [0.06, 0.16, 0.06], [-0.4, 2.74, -0.34], secondary);
  }

  /**
   * Retail level 4 — the leaf-fan canopy the level 1 pole has been carrying rolled up
   * all along, a hanging trade sign, four lanterns and a lit lantern core.
   *
   * This is the one level that changes the silhouette of the stall rather than adding
   * to its worktop, so a finished shop reads across the room.
   */
  private createLanternCanopy(
    root: THREE.Group,
    primary: THREE.MeshStandardMaterial,
    secondary: THREE.MeshStandardMaterial,
    dark: THREE.MeshStandardMaterial,
    timber: THREE.MeshStandardMaterial,
  ): void {
    const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.76, 0.05, 6, 22), timber);
    hoop.rotation.x = Math.PI / 2;
    hoop.position.y = 2.3;
    root.add(hoop);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.5, 8), timber);
    mast.position.y = 2.44;
    root.add(mast);

    const leaf = this.leafMaterial();
    for (let index = 0; index < 6; index += 1) {
      const petal = new THREE.Group();
      petal.rotation.y = index / 6 * Math.PI * 2 + 0.3;
      root.add(petal);
      const blade = new THREE.Mesh(new THREE.ConeGeometry(0.38, 0.84, 4, 1, true), index % 2 === 0 ? primary : secondary);
      blade.rotation.x = Math.PI / 2 + 0.5;
      blade.position.set(0, 2.46, 0.46);
      petal.add(blade);
      const rib = this.addBox(petal, [0.045, 0.045, 0.62], [0, 2.54, 0.34], timber);
      rib.rotation.x = -0.34;
    }
    const boss = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), secondary);
    boss.position.y = 2.68;
    root.add(boss);
    const finial = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.22, 8), secondary);
    finial.position.y = 2.86;
    root.add(finial);

    for (let index = 0; index < 4; index += 1) {
      const angle = 0.34 + index * 0.82;
      const x = Math.cos(angle) * 0.76;
      const z = Math.sin(angle) * 0.76;
      const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.18, 5), dark);
      cord.position.set(x, 2.2, z);
      root.add(cord);
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.2, 8), timber);
      body.position.set(x, 2.0, z);
      root.add(body);
      const cap = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.09, 8), secondary);
      cap.position.set(x, 2.13, z);
      root.add(cap);
      const glow = new THREE.Mesh(new THREE.SphereGeometry(0.07, 9, 7), primary);
      glow.position.set(x, 2.0, z);
      root.add(glow);
    }

    for (const dx of [-0.3, 0.3]) {
      const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.26, 5), secondary);
      chain.position.set(dx, 2.14, 0.62);
      root.add(chain);
    }
    const sign = this.addBox(root, [0.84, 0.3, 0.05], [0, 1.87, 0.62], timber);
    this.addBox(root, [0.7, 0.06, 0.02], [0, 1.93, 0.66], secondary);
    this.addBox(root, [0.44, 0.05, 0.02], [-0.1, 1.82, 0.66], secondary);
    sign.rotation.x = 0.03;

    const trough = this.addBox(root, [0.42, 0.11, 0.18], [0, 2.26, -0.74], timber);
    trough.rotation.x = 0.03;
    for (const x of [-0.13, 0, 0.13]) {
      const spill = new THREE.Mesh(new THREE.SphereGeometry(0.11, 9, 7), leaf);
      spill.scale.set(1, 0.55, 0.9);
      spill.position.set(x, 2.33, -0.74);
      root.add(spill);
    }

    const core = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 9), primary);
    core.name = "equipment-pulse";
    core.position.set(0, 2.1, 0);
    root.add(core);
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.028, 6, 16), secondary);
    collar.rotation.x = Math.PI / 2;
    collar.position.set(0, 2.24, 0);
    root.add(collar);
  }

  /**
   * Culinary level 1 — a timber prep counter with a clay hearth block at one end,
   * one copper pot over the embers, a chopping board and a knife. That is the whole
   * restaurant: a cook, a fire and a bench.
   *
   * The middle of the counter is left bare on purpose. Level 2 drops the cast range,
   * its flue and the pot rail into exactly that gap, so the kitchen is seen to grow
   * around the first fire rather than being replaced by a bigger machine.
   */
  private createHearthBench(
    key: UpgradeKey,
    root: THREE.Group,
    primary: THREE.MeshStandardMaterial,
    secondary: THREE.MeshStandardMaterial,
    dark: THREE.MeshStandardMaterial,
    cream: THREE.MeshStandardMaterial,
    timber: THREE.MeshStandardMaterial,
  ): void {
    for (const x of [-0.74, 0.74]) {
      for (const z of [-0.34, 0.34]) this.addBox(root, [0.11, 0.88, 0.11], [x, 0.47, z], timber);
      this.addBox(root, [0.11, 0.06, 0.62], [x, 0.28, 0], timber);
    }
    this.addBox(root, [1.72, 0.1, 0.96], [0, 0.96, 0], timber);
    this.addBox(root, [1.76, 0.03, 1.0], [0, 1.02, 0], cream);
    this.addBox(root, [1.76, 0.14, 0.04], [0, 0.93, 0.5], timber);

    this.addBox(root, [0.66, 0.44, 0.6], [-0.5, 1.25, -0.16], dark);
    this.addBox(root, [0.72, 0.06, 0.66], [-0.5, 1.5, -0.16], secondary);
    for (const x of [-0.75, -0.25]) this.addBox(root, [0.08, 0.26, 0.06], [x, 1.14, 0.14], secondary);
    const ember = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 7), primary);
    ember.scale.set(1.1, 0.5, 0.45);
    ember.position.set(-0.5, 1.1, 0.12);
    root.add(ember);
    for (const x of [-0.62, -0.38]) {
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.2, 6), timber);
      log.rotation.x = Math.PI / 2;
      log.position.set(x, 1.09, 0.1);
      root.add(log);
    }

    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.22, 0.3, 14), secondary);
    pot.position.set(-0.5, 1.68, -0.16);
    root.add(pot);
    const potLid = new THREE.Mesh(new THREE.SphereGeometry(0.26, 12, 7, 0, Math.PI * 2, 0, Math.PI / 2), secondary);
    potLid.scale.y = 0.46;
    potLid.position.set(-0.5, 1.83, -0.16);
    root.add(potLid);
    const potKnob = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), timber);
    potKnob.position.set(-0.5, 1.92, -0.16);
    root.add(potKnob);

    const leaf = this.leafMaterial();
    this.addBox(root, [0.6, 0.05, 0.4], [0.54, 1.06, 0.24], timber);
    for (let index = 0; index < 4; index += 1) {
      const slice = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.02, 9), index % 2 === 0 ? leaf : cream);
      slice.position.set(0.33 + index * 0.14, 1.1, 0.18 + (index % 2) * 0.11);
      root.add(slice);
    }
    const blade = this.addBox(root, [0.3, 0.016, 0.07], [0.5, 1.1, 0.06], cream);
    blade.rotation.y = 0.24;
    const grip = this.addBox(root, [0.14, 0.035, 0.05], [0.72, 1.1, 0.01], timber);
    grip.rotation.y = 0.24;

    if (key === "yield") {
      const mortar = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.11, 0.18, 12), cream);
      mortar.position.set(0.16, 1.12, -0.3);
      root.add(mortar);
      const pestle = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.055, 0.24, 8), cream);
      pestle.rotation.z = 0.5;
      pestle.position.set(0.2, 1.24, -0.3);
      root.add(pestle);
      const herbPot = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.1, 0.2, 10), timber);
      herbPot.position.set(-0.02, 1.13, 0.26);
      root.add(herbPot);
      for (const dx of [-0.07, 0.02, 0.08]) {
        const sprig = new THREE.Mesh(new THREE.SphereGeometry(0.09, 9, 7), leaf);
        sprig.scale.set(0.8, 1.35, 0.7);
        sprig.position.set(-0.02 + dx, 1.3, 0.26 + dx * 0.6);
        root.add(sprig);
      }
    } else if (key === "capacity") {
      this.addBox(root, [1.5, 0.07, 0.78], [0, 0.6, 0], timber);
      for (const x of [-0.46, 0.02]) {
        const crock = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.12, 0.28, 12), cream);
        crock.position.set(x, 0.78, 0.04);
        root.add(crock);
        const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.04, 12), secondary);
        lid.position.set(x, 0.94, 0.04);
        root.add(lid);
      }
      for (let index = 0; index < 3; index += 1) {
        const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.11, 0.07, 12), cream);
        bowl.position.set(0.52, 0.68 + index * 0.075, 0.02);
        root.add(bowl);
      }
      const braid = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.3, 7), cream);
      braid.position.set(0.84, 0.78, -0.3);
      root.add(braid);
    } else if (key === "speed") {
      this.addBox(root, [0.86, 0.06, 0.22], [0.42, 1.18, 0.44], timber);
      for (const x of [0.06, 0.78]) this.addBox(root, [0.07, 0.12, 0.2], [x, 1.09, 0.44], timber);
      for (const x of [0.24, 0.6]) {
        const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.12, 0.035, 14), cream);
        plate.position.set(x, 1.23, 0.44);
        root.add(plate);
        const serving = new THREE.Mesh(new THREE.SphereGeometry(0.09, 9, 7), primary);
        serving.scale.y = 0.5;
        serving.position.set(x, 1.27, 0.44);
        root.add(serving);
      }
      const bell = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 7, 0, Math.PI * 2, 0, Math.PI / 2), secondary);
      bell.position.set(0.88, 1.05, 0.3);
      root.add(bell);
      const striker = new THREE.Mesh(new THREE.SphereGeometry(0.035, 7, 5), dark);
      striker.position.set(0.88, 1.16, 0.3);
      root.add(striker);
    } else {
      const runner = this.addBox(root, [1.7, 0.02, 0.34], [0, 1.05, 0.28], primary);
      runner.rotation.x = 0.02;
      this.addBox(root, [1.7, 0.18, 0.02], [0, 0.96, 0.45], primary);
      const vase = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 0.2, 10), cream);
      vase.position.set(0.18, 1.16, 0.3);
      root.add(vase);
      for (const dx of [-0.06, 0.05]) {
        const posy = new THREE.Mesh(new THREE.SphereGeometry(0.07, 9, 7), dx < 0 ? secondary : primary);
        posy.position.set(0.18 + dx, 1.32, 0.3);
        root.add(posy);
        const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.14, 5), leaf);
        stalk.position.set(0.18 + dx, 1.24, 0.3);
        root.add(stalk);
      }
      const menu = this.addBox(root, [0.28, 0.22, 0.02], [0.72, 1.18, 0.32], dark);
      menu.rotation.set(0.3, -0.4, 0);
      for (const y of [1.14, 1.2]) {
        const chalk = this.addBox(root, [0.18, 0.018, 0.012], [0.72, y, 0.33], cream);
        chalk.rotation.y = -0.4;
      }
    }
  }

  /**
   * Culinary level 3 — the service pass. A timber shelf goes up behind the range,
   * three brass heat lamps hang over it, plated dishes wait under cloches and the
   * cook picks garnish out of a herb trough without leaving the fire.
   *
   * A hand-cranked churn on the counter end is the only moving part, so the level
   * reads as "this kitchen now serves people" rather than "this kitchen got bigger".
   */
  private createPassKitchen(
    root: THREE.Group,
    primary: THREE.MeshStandardMaterial,
    secondary: THREE.MeshStandardMaterial,
    dark: THREE.MeshStandardMaterial,
    cream: THREE.MeshStandardMaterial,
    timber: THREE.MeshStandardMaterial,
  ): void {
    for (const x of [-0.86, 0.86]) this.addBox(root, [0.1, 1.5, 0.1], [x, 1.55, -0.6], timber);
    this.addBox(root, [1.92, 0.08, 0.44], [0, 1.62, -0.6], timber);
    this.addBox(root, [1.92, 0.09, 0.16], [0, 2.26, -0.6], timber);

    for (const x of [-0.54, 0, 0.54]) {
      const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.2, 5), dark);
      cord.position.set(x, 2.11, -0.6);
      root.add(cord);
      const shade = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.2, 10, 1, true), secondary);
      shade.position.set(x, 1.95, -0.6);
      root.add(shade);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.075, 9, 7), primary);
      bulb.position.set(x, 1.86, -0.6);
      root.add(bulb);
    }

    for (const x of [-0.56, 0.56]) {
      const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.14, 0.04, 14), cream);
      plate.position.set(x, 1.68, -0.6);
      root.add(plate);
      const cloche = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), secondary);
      cloche.scale.y = 0.82;
      cloche.position.set(x, 1.69, -0.6);
      root.add(cloche);
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.032, 7, 5), timber);
      knob.position.set(x, 1.83, -0.6);
      root.add(knob);
    }

    const leaf = this.leafMaterial();
    this.addBox(root, [0.6, 0.15, 0.26], [0, 1.73, -0.6], timber);
    this.addBox(root, [0.62, 0.03, 0.28], [0, 1.81, -0.6], secondary);
    for (const x of [-0.18, 0, 0.18]) {
      const sprig = new THREE.Mesh(new THREE.SphereGeometry(0.11, 9, 7), leaf);
      sprig.scale.set(0.95, 1.25, 0.7);
      sprig.position.set(x, 1.88, -0.6);
      root.add(sprig);
    }

    const ticket = this.addBox(root, [1.44, 0.02, 0.02], [0, 2.14, -0.44], secondary);
    ticket.rotation.z = 0.01;
    for (const x of [-0.42, 0.08, 0.44]) {
      const slip = this.addBox(root, [0.16, 0.2, 0.008], [x, 2.03, -0.44], cream);
      slip.rotation.z = x * 0.12;
    }
    this.addBox(root, [0.07, 0.07, 0.3], [0.86, 2.22, -0.45], timber);
    const spindle = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.14, 6), secondary);
    spindle.position.set(0.86, 2.14, -0.34);
    root.add(spindle);
    const carousel = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.022, 6, 16), secondary);
    carousel.name = "equipment-rotor";
    carousel.position.set(0.86, 2.0, -0.34);
    root.add(carousel);
    const carouselHub = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.05, 8), timber);
    carouselHub.rotation.x = Math.PI / 2;
    carouselHub.position.set(0.86, 2.0, -0.34);
    root.add(carouselHub);
    for (let index = 0; index < 4; index += 1) {
      const angle = index / 4 * Math.PI * 2;
      const docket = this.addBox(root, [0.09, 0.11, 0.006], [0.86 + Math.cos(angle) * 0.15, 2.0 + Math.sin(angle) * 0.15, -0.32], cream);
      docket.rotation.z = angle;
    }
  }

  /**
   * Culinary level 4 — the dining atelier. A vine-hung pergola frames the whole
   * kitchen, a copper cowl and vane cap the flue, lanterns light the pass and a
   * glazed cake dome sits out front where the guests can see it.
   *
   * This is the only culinary level that changes the silhouette, so a finished
   * restaurant reads from the far side of the room.
   */
  private createHearthCrown(
    root: THREE.Group,
    primary: THREE.MeshStandardMaterial,
    secondary: THREE.MeshStandardMaterial,
    dark: THREE.MeshStandardMaterial,
    timber: THREE.MeshStandardMaterial,
  ): void {
    const leaf = this.leafMaterial();
    for (const x of [-1.02, 1.02]) {
      for (const z of [-0.84, 0.84]) this.addBox(root, [0.11, 2.44, 0.11], [x, 1.24, z], timber);
      this.addBox(root, [0.13, 0.13, 1.8], [x, 2.4, 0], timber);
    }
    for (const x of [-0.96, -0.54, 0.54, 0.96]) this.addBox(root, [0.08, 0.08, 1.86], [x, 2.5, 0], timber);
    for (const z of [-0.84, 0.84]) this.addBox(root, [2.16, 0.09, 0.09], [0, 2.5, z], timber);

    for (const [x, z] of [[-0.96, -0.5], [-0.54, 0.42], [0.54, -0.36], [0.96, 0.5], [-0.96, 0.62], [0.96, -0.62]] as Array<[number, number]>) {
      const vine = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.34, 5), leaf);
      vine.position.set(x, 2.32, z);
      root.add(vine);
      const cluster = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 7), leaf);
      cluster.scale.set(1, 0.72, 1);
      cluster.position.set(x, 2.12, z);
      root.add(cluster);
    }
    for (const x of [-0.78, -0.26, 0.26, 0.78]) {
      const swag = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.028, 5, 10, Math.PI), leaf);
      swag.rotation.z = Math.PI;
      swag.position.set(x, 2.44, 0.84);
      root.add(swag);
    }

    const cowl = new THREE.Mesh(new THREE.ConeGeometry(0.29, 0.2, 10), secondary);
    cowl.position.set(0.04, 2.82, -0.06);
    root.add(cowl);
    const vane = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.018, 5, 12), secondary);
    vane.name = "equipment-rotor";
    vane.position.set(0.04, 2.92, -0.06);
    root.add(vane);
    for (let index = 0; index < 3; index += 1) {
      const blade = this.addBox(root, [0.15, 0.03, 0.012], [0.04, 2.92, -0.06], secondary);
      blade.rotation.z = index / 3 * Math.PI;
    }

    for (const x of [-0.7, 0.7]) {
      const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.24, 5), dark);
      cord.position.set(x, 2.32, 0.5);
      root.add(cord);
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.22, 8), timber);
      body.position.set(x, 2.08, 0.5);
      root.add(body);
      const cap = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.09, 8), secondary);
      cap.position.set(x, 2.22, 0.5);
      root.add(cap);
      const glow = new THREE.Mesh(new THREE.SphereGeometry(0.07, 9, 7), primary);
      glow.position.set(x, 2.08, 0.5);
      root.add(glow);
    }

    const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.13, 0.14, 12), secondary);
    stand.position.set(0.86, 1.14, 0.6);
    root.add(stand);
    const cakePlate = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.03, 16), secondary);
    cakePlate.position.set(0.86, 1.22, 0.6);
    root.add(cakePlate);
    const cake = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.17, 0.16, 14), primary);
    cake.position.set(0.86, 1.32, 0.6);
    root.add(cake);
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(0.24, 14, 9, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshStandardMaterial({
        color: 0xdff0ec, roughness: 0.1, metalness: 0.04, transparent: true, opacity: 0.34, depthWrite: false,
      }),
    );
    dome.scale.y = 1.15;
    dome.position.set(0.86, 1.23, 0.6);
    root.add(dome);

    const heart = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 9), primary);
    heart.name = "equipment-pulse";
    heart.position.set(-0.5, 1.12, 0.16);
    root.add(heart);
  }

  /**
   * Fitness level 1 — a timber lifting platform under a bare rack: two uprights,
   * three ladder rungs and a pair of empty J-hooks with no bar in them yet.
   *
   * The empty hooks are the whole point. Level 2 puts a loaded bar into them, so the
   * first upgrade lands in a slot the player has already been looking at. Everything
   * else here is what someone would train with on day one: stone weights, a coiled
   * rope and a chalk bowl.
   */
  private createTrainingPlatform(
    key: UpgradeKey,
    root: THREE.Group,
    primary: THREE.MeshStandardMaterial,
    secondary: THREE.MeshStandardMaterial,
    dark: THREE.MeshStandardMaterial,
    cream: THREE.MeshStandardMaterial,
    timber: THREE.MeshStandardMaterial,
  ): void {
    this.addBox(root, [1.94, 0.16, 1.28], [0, 0.08, 0], timber);
    this.addBox(root, [0.86, 0.035, 1.16], [0, 0.17, 0], dark);
    for (const x of [-0.64, 0.64]) this.addBox(root, [0.4, 0.03, 1.14], [x, 0.175, 0], cream);

    for (const x of [-0.66, 0.66]) {
      this.addBox(root, [0.14, 1.42, 0.14], [x, 0.87, -0.18], timber);
      this.addBox(root, [0.16, 0.1, 0.66], [x, 0.21, -0.18], timber);
      const arm = this.addBox(root, [0.12, 0.07, 0.28], [x, 1.44, -0.04], secondary);
      arm.rotation.x = 0.05;
      const hook = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.18, 7), secondary);
      hook.position.set(x, 1.54, 0.06);
      root.add(hook);
    }
    this.addBox(root, [1.36, 0.11, 0.11], [0, 0.5, -0.18], timber);
    for (const y of [0.78, 1.02, 1.26]) {
      const rung = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.34, 8), secondary);
      rung.rotation.z = Math.PI / 2;
      rung.position.set(0, y, -0.18);
      root.add(rung);
    }

    const coil = new THREE.Mesh(new THREE.TorusGeometry(0.21, 0.055, 6, 16), cream);
    coil.rotation.x = Math.PI / 2;
    coil.position.set(0.62, 0.22, 0.44);
    root.add(coil);
    const coilInner = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.05, 6, 14), cream);
    coilInner.rotation.x = Math.PI / 2;
    coilInner.position.set(0.62, 0.27, 0.44);
    root.add(coilInner);
    for (const [x, radius] of [[-0.56, 0.17], [-0.28, 0.13]] as Array<[number, number]>) {
      const stone = new THREE.Mesh(new THREE.SphereGeometry(radius, 10, 8), dark);
      stone.scale.y = 0.86;
      stone.position.set(x, 0.16 + radius * 0.8, 0.46);
      root.add(stone);
      const handle = new THREE.Mesh(new THREE.TorusGeometry(radius * 0.5, 0.02, 5, 10, Math.PI), secondary);
      handle.position.set(x, 0.16 + radius * 1.6, 0.46);
      root.add(handle);
    }
    const chalkBowl = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.1, 0.14, 12), timber);
    chalkBowl.position.set(0.14, 0.23, 0.5);
    root.add(chalkBowl);
    const chalkFill = new THREE.Mesh(new THREE.SphereGeometry(0.11, 9, 6), cream);
    chalkFill.scale.y = 0.4;
    chalkFill.position.set(0.14, 0.3, 0.5);
    root.add(chalkFill);

    if (key === "yield") {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 1.5, 8), timber);
      post.position.set(0.98, 0.91, 0.28);
      root.add(post);
      for (let index = 0; index < 6; index += 1) {
        this.addBox(root, [0.16, 0.02, 0.02], [1.04, 0.42 + index * 0.2, 0.28], index % 2 === 0 ? cream : secondary);
      }
      const caliper = this.addBox(root, [0.06, 0.03, 0.3], [0.98, 1.5, 0.4], secondary);
      caliper.rotation.x = 0.3;
      const plumb = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.6, 5), dark);
      plumb.position.set(0.86, 1.28, 0.28);
      root.add(plumb);
      const bob = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.12, 8), secondary);
      bob.rotation.x = Math.PI;
      bob.position.set(0.86, 0.94, 0.28);
      root.add(bob);
    } else if (key === "capacity") {
      for (const x of [0.36, 0.9]) this.addBox(root, [0.11, 0.3, 0.28], [x, 0.31, 0.5], timber);
      this.addBox(root, [0.78, 0.1, 0.38], [0.63, 0.51, 0.5], timber);
      for (let index = 0; index < 3; index += 1) {
        const x = -0.5 + index * 0.34;
        const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.2, 7), dark);
        shaft.rotation.z = Math.PI / 2;
        shaft.position.set(x, 0.3, -0.44);
        root.add(shaft);
        for (const dx of [-0.12, 0.12]) {
          const head = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.08, 10), index === 1 ? primary : secondary);
          head.rotation.z = Math.PI / 2;
          head.position.set(x + dx, 0.3, -0.44);
          root.add(head);
        }
      }
    } else if (key === "speed") {
      const peg = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.16, 6), secondary);
      peg.rotation.x = Math.PI / 2;
      peg.position.set(0.66, 1.34, -0.06);
      root.add(peg);
      for (const radius of [0.2, 0.15]) {
        const loop = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.016, 5, 16), primary);
        loop.position.set(0.66, 1.34 - radius, 0.02);
        root.add(loop);
      }
      for (const flip of [-1, 1]) {
        const glassCone = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.16, 10, 1, true), cream);
        glassCone.rotation.z = flip < 0 ? Math.PI : 0;
        glassCone.position.set(-0.9, 0.44 + flip * 0.08, 0.3);
        root.add(glassCone);
        this.addBox(root, [0.24, 0.03, 0.24], [-0.9, 0.44 + flip * 0.19, 0.3], timber);
      }
      const sand = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.11, 10), secondary);
      sand.rotation.z = Math.PI;
      sand.position.set(-0.9, 0.38, 0.3);
      root.add(sand);
      for (const x of [-1.02, -0.78]) this.addBox(root, [0.04, 0.4, 0.04], [x, 0.44, 0.3], timber);
    } else {
      const leaf = this.leafMaterial();
      const planter = this.addBox(root, [0.42, 0.3, 0.36], [0.94, 0.31, -0.5], timber);
      planter.rotation.y = 0.2;
      for (const [dx, dz] of [[-0.1, 0], [0.08, -0.06], [0.02, 0.09]] as Array<[number, number]>) {
        const frond = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 7), leaf);
        frond.scale.set(0.8, 1.25, 0.8);
        frond.position.set(0.94 + dx, 0.58, -0.5 + dz);
        root.add(frond);
      }
      for (let index = 0; index < 3; index += 1) {
        this.addBox(root, [0.3, 0.05, 0.24], [-0.86, 0.2 + index * 0.05, 0.42], index === 1 ? primary : cream);
      }
      const jug = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.26, 12), secondary);
      jug.position.set(-0.9, 0.31, -0.44);
      root.add(jug);
      const jugWater = new THREE.Mesh(
        new THREE.CylinderGeometry(0.085, 0.1, 0.16, 12),
        new THREE.MeshStandardMaterial({
          color: 0xbfe6ef, roughness: 0.14, metalness: 0.05, transparent: true, opacity: 0.5, depthWrite: false,
        }),
      );
      jugWater.position.set(-0.9, 0.28, -0.44);
      root.add(jugWater);
      const jugBail = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.014, 5, 10, Math.PI), secondary);
      jugBail.rotation.y = Math.PI / 2;
      jugBail.position.set(-0.9, 0.44, -0.44);
      root.add(jugBail);
    }
  }

  /**
   * Fitness level 3 — the rack becomes a rig. The uprights are extended, a pull-up
   * bar is thrown across the top, a cable pulley feeds a stack of four plates and a
   * climbing rope hangs from the crossbeam beside a dumbbell shelf.
   *
   * One bar was a lift; this is a circuit somebody could spend an hour in.
   */
  private createCircuitRig(
    root: THREE.Group,
    primary: THREE.MeshStandardMaterial,
    secondary: THREE.MeshStandardMaterial,
    dark: THREE.MeshStandardMaterial,
    cream: THREE.MeshStandardMaterial,
    timber: THREE.MeshStandardMaterial,
  ): void {
    for (const x of [-0.66, 0.66]) this.addBox(root, [0.12, 0.76, 0.12], [x, 1.92, -0.18], timber);
    this.addBox(root, [1.62, 0.14, 0.2], [0, 2.32, -0.18], timber);
    this.addBox(root, [0.24, 0.1, 0.94], [-0.66, 2.3, 0.3], timber);
    this.addBox(root, [0.24, 0.1, 0.42], [0.66, 2.3, 0.06], timber);
    const pullBar = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.5, 10), secondary);
    pullBar.rotation.z = Math.PI / 2;
    pullBar.position.set(0, 2.28, 0.24);
    root.add(pullBar);
    for (const x of [-0.44, 0.44]) {
      const wrap = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.058, 0.2, 8), timber);
      wrap.rotation.z = Math.PI / 2;
      wrap.position.set(x, 2.28, 0.24);
      root.add(wrap);
    }

    this.addBox(root, [0.14, 0.1, 0.42], [0.82, 2.3, -0.42], timber);
    const pulley = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.032, 6, 14), secondary);
    pulley.name = "equipment-rotor";
    pulley.position.set(0.82, 2.18, -0.6);
    root.add(pulley);
    const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.1, 5), dark);
    cable.position.set(0.82, 1.63, -0.6);
    root.add(cable);
    for (const x of [0.7, 0.94]) {
      const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 1.1, 6), secondary);
      rail.position.set(x, 0.72, -0.6);
      root.add(rail);
    }
    this.addBox(root, [0.4, 0.08, 0.36], [0.82, 0.2, -0.6], timber);
    for (let index = 0; index < 4; index += 1) {
      this.addBox(root, [0.34, 0.11, 0.3], [0.82, 0.32 + index * 0.13, -0.6], index % 2 === 0 ? primary : dark);
    }
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.24, 7), timber);
    grip.rotation.z = Math.PI / 2;
    grip.position.set(0.82, 1.12, -0.6);
    root.add(grip);

    const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.6, 7), cream);
    rope.position.set(-0.66, 1.5, 0.58);
    root.add(rope);
    for (const y of [0.78, 1.06, 1.34, 1.62, 1.9]) {
      const knot = new THREE.Mesh(new THREE.SphereGeometry(0.072, 8, 6), cream);
      knot.scale.y = 0.62;
      knot.position.set(-0.66, y, 0.58);
      root.add(knot);
    }
    const ropeEye = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.014, 5, 10), secondary);
    ropeEye.position.set(-0.66, 2.24, 0.58);
    root.add(ropeEye);

    for (const x of [-0.9, 0.9]) this.addBox(root, [0.09, 0.62, 0.09], [x, 0.47, -0.86], timber);
    for (const y of [0.5, 0.78]) {
      this.addBox(root, [1.94, 0.07, 0.32], [0, y, -0.86], timber);
      for (let index = 0; index < 3; index += 1) {
        const x = -0.62 + index * 0.62;
        const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.22, 7), dark);
        shaft.rotation.z = Math.PI / 2;
        shaft.position.set(x, y + 0.13, -0.86);
        root.add(shaft);
        for (const dx of [-0.13, 0.13]) {
          const head = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.09, 10), index === 1 ? primary : secondary);
          head.rotation.z = Math.PI / 2;
          head.position.set(x + dx, y + 0.13, -0.86);
          root.add(head);
        }
      }
    }
  }

  /**
   * Fitness level 4 — the harbour wellness grove. A planted trough runs the length of
   * the rig with vines trailing off it, two hanging baskets flank the pull-up bar, a
   * copper drinking fountain with a glass water column stands at one corner and a
   * brass gong marks a finished set.
   *
   * The gym stops being equipment and becomes somewhere pleasant to be, which is what
   * the appeal line of a solarpunk gym is actually selling.
   */
  private createWellnessGrove(
    root: THREE.Group,
    primary: THREE.MeshStandardMaterial,
    secondary: THREE.MeshStandardMaterial,
    dark: THREE.MeshStandardMaterial,
    timber: THREE.MeshStandardMaterial,
  ): void {
    const leaf = this.leafMaterial();
    this.addBox(root, [1.86, 0.2, 0.4], [0, 2.5, -0.18], timber);
    this.addBox(root, [1.9, 0.04, 0.44], [0, 2.61, -0.18], secondary);
    for (let index = 0; index < 5; index += 1) {
      const x = -0.74 + index * 0.37;
      const bed = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 7), leaf);
      bed.scale.set(1, 0.6, 0.85);
      bed.position.set(x, 2.64, -0.18);
      root.add(bed);
      if (index % 2 === 0) {
        const trail = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.52, 5), leaf);
        trail.position.set(x, 2.14, 0.02);
        root.add(trail);
        const tip = new THREE.Mesh(new THREE.SphereGeometry(0.11, 9, 7), leaf);
        tip.scale.set(0.8, 1.2, 0.8);
        tip.position.set(x, 1.88, 0.02);
        root.add(tip);
      }
    }
    for (const x of [-0.94, 0.94]) {
      const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.4, 5), dark);
      cord.position.set(x, 2.1, 0.24);
      root.add(cord);
      const basket = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.15, 0.24, 12, 1, true), timber);
      basket.position.set(x, 1.8, 0.24);
      root.add(basket);
      const weave = new THREE.Mesh(new THREE.TorusGeometry(0.195, 0.02, 5, 14), secondary);
      weave.rotation.x = Math.PI / 2;
      weave.position.set(x, 1.9, 0.24);
      root.add(weave);
      const spill = new THREE.Mesh(new THREE.SphereGeometry(0.21, 10, 7), leaf);
      spill.scale.set(1, 0.7, 1);
      spill.position.set(x, 1.92, 0.24);
      root.add(spill);
    }

    const fountainPost = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.15, 1.02, 10), timber);
    fountainPost.position.set(-0.98, 0.51, 0.62);
    root.add(fountainPost);
    const basin = new THREE.Mesh(new THREE.CylinderGeometry(0.23, 0.16, 0.16, 14), secondary);
    basin.position.set(-0.98, 1.08, 0.62);
    root.add(basin);
    const water = new THREE.MeshStandardMaterial({
      color: 0xbfe6ef, roughness: 0.14, metalness: 0.05, transparent: true, opacity: 0.46, depthWrite: false,
    });
    const pool = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.04, 14), water);
    pool.position.set(-0.98, 1.13, 0.62);
    root.add(pool);
    const column = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.36, 8), water);
    column.position.set(-0.98, 1.32, 0.72);
    root.add(column);
    const spout = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.026, 6, 12, Math.PI), secondary);
    spout.rotation.y = Math.PI / 2;
    spout.position.set(-0.98, 1.5, 0.62);
    root.add(spout);
    const tap = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.42, 8), secondary);
    tap.position.set(-0.98, 1.32, 0.52);
    root.add(tap);

    for (const x of [0.72, 1.08]) this.addBox(root, [0.08, 1.0, 0.08], [x, 0.5, 0.66], timber);
    this.addBox(root, [0.52, 0.09, 0.1], [0.9, 1.03, 0.66], timber);
    const gongRing = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.03, 6, 18), secondary);
    gongRing.position.set(0.9, 0.72, 0.66);
    root.add(gongRing);
    const gong = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.035, 18), primary);
    gong.rotation.x = Math.PI / 2;
    gong.position.set(0.9, 0.72, 0.66);
    root.add(gong);
    const gongBoss = new THREE.Mesh(new THREE.SphereGeometry(0.07, 9, 7), secondary);
    gongBoss.scale.z = 0.5;
    gongBoss.position.set(0.9, 0.72, 0.69);
    root.add(gongBoss);
    for (const dx of [-0.1, 0.1]) {
      const hanger = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.14, 5), dark);
      hanger.position.set(0.9 + dx, 0.92, 0.66);
      root.add(hanger);
    }

    const sunCord = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.2, 5), dark);
    sunCord.position.set(0, 2.3, -0.5);
    root.add(sunCord);
    const sunRing = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.022, 6, 16), secondary);
    sunRing.rotation.x = Math.PI / 2;
    sunRing.position.set(0, 2.18, -0.5);
    root.add(sunRing);
    const sunGlobe = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 9), primary);
    sunGlobe.name = "equipment-pulse";
    sunGlobe.position.set(0, 2.14, -0.5);
    root.add(sunGlobe);
    const mallet = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.3, 6), timber);
    mallet.rotation.z = 0.5;
    mallet.position.set(1.12, 0.62, 0.66);
    root.add(mallet);
  }

  /**
   * Cinematic level 1 — a hand-cranked lantern projector on a timber plinth: a dark
   * body, a brass lens barrel aimed at the back wall, a crank, a stack of film cans
   * and one bare spindle with no reel on it.
   *
   * The bare spindle is the hook for level 2, which mounts the reels and threads the
   * film. No screen, no marquee, no sound: one machine and whoever turns the handle.
   */
  private createLanternProjector(
    key: UpgradeKey,
    root: THREE.Group,
    primary: THREE.MeshStandardMaterial,
    secondary: THREE.MeshStandardMaterial,
    dark: THREE.MeshStandardMaterial,
    cream: THREE.MeshStandardMaterial,
    timber: THREE.MeshStandardMaterial,
  ): void {
    this.addBox(root, [1.22, 0.88, 0.86], [0, 0.48, 0], timber);
    this.addBox(root, [1.36, 0.1, 0.98], [0, 0.97, 0], timber);
    this.addBox(root, [1.3, 0.03, 0.92], [0, 1.03, 0], cream);
    for (const x of [-0.3, 0.3]) {
      this.addBox(root, [0.5, 0.62, 0.04], [x, 0.52, 0.44], cream);
      const pull = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), secondary);
      pull.position.set(x + (x < 0 ? 0.2 : -0.2), 0.52, 0.48);
      root.add(pull);
    }

    const body = this.addBox(root, [0.8, 0.46, 0.62], [0, 1.28, -0.02], dark);
    body.rotation.x = -0.04;
    this.addBox(root, [0.84, 0.05, 0.66], [0, 1.53, -0.02], secondary);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, 0.34, 12), secondary);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 1.32, -0.44);
    root.add(barrel);
    const lensRing = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.03, 6, 14), secondary);
    lensRing.position.set(0, 1.32, -0.6);
    root.add(lensRing);
    const lens = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.12, 0.02, 14),
      new THREE.MeshStandardMaterial({
        color: 0xdff0ec, roughness: 0.08, metalness: 0.06, transparent: true, opacity: 0.5, depthWrite: false,
      }),
    );
    lens.rotation.x = Math.PI / 2;
    lens.position.set(0, 1.32, -0.6);
    root.add(lens);

    const spindle = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.3, 7), secondary);
    spindle.position.set(-0.28, 1.66, -0.02);
    root.add(spindle);
    const spindleCap = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), secondary);
    spindleCap.position.set(-0.28, 1.82, -0.02);
    root.add(spindleCap);

    const crankShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.18, 6), secondary);
    crankShaft.rotation.z = Math.PI / 2;
    crankShaft.position.set(0.48, 1.24, -0.02);
    root.add(crankShaft);
    const crankArm = this.addBox(root, [0.03, 0.2, 0.03], [0.57, 1.32, -0.02], secondary);
    crankArm.rotation.z = 0.2;
    const crankKnob = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.08, 8), timber);
    crankKnob.rotation.z = Math.PI / 2;
    crankKnob.position.set(0.6, 1.42, -0.02);
    root.add(crankKnob);

    for (let index = 0; index < 3; index += 1) {
      const can = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.05, 16), index === 1 ? primary : secondary);
      can.position.set(0.5, 1.07 + index * 0.055, 0.3);
      can.rotation.y = index * 0.3;
      root.add(can);
    }

    if (key === "yield") {
      const focus = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.028, 6, 16), primary);
      focus.rotation.x = Math.PI / 2;
      focus.position.set(0, 1.32, -0.32);
      root.add(focus);
      const caseBox = this.addBox(root, [0.36, 0.09, 0.24], [-0.5, 1.09, 0.28], timber);
      caseBox.rotation.y = 0.24;
      for (const dx of [-0.1, 0.02, 0.12]) {
        const disc = new THREE.Mesh(
          new THREE.CylinderGeometry(0.06, 0.06, 0.02, 12),
          new THREE.MeshStandardMaterial({
            color: 0xdff0ec, roughness: 0.08, metalness: 0.05, transparent: true, opacity: 0.46, depthWrite: false,
          }),
        );
        disc.position.set(-0.5 + dx, 1.15, 0.28 - dx * 0.25);
        root.add(disc);
      }
    } else if (key === "capacity") {
      this.addBox(root, [1.1, 0.06, 0.74], [0, 0.56, -0.04], timber);
      for (let index = 0; index < 4; index += 1) {
        const can = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.21, 0.06, 16), index % 2 === 0 ? primary : secondary);
        can.position.set(-0.28, 0.62 + index * 0.065, -0.04);
        root.add(can);
      }
      for (let index = 0; index < 3; index += 1) {
        const upright = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.05, 16), index === 1 ? secondary : cream);
        upright.rotation.x = Math.PI / 2;
        upright.position.set(0.32, 0.78, -0.04 + index * 0.07);
        root.add(upright);
      }
    } else if (key === "speed") {
      const flywheel = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.04, 7, 16), secondary);
      flywheel.name = "equipment-rotor";
      flywheel.position.set(0.62, 1.24, 0.26);
      root.add(flywheel);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.07, 10), dark);
      hub.rotation.x = Math.PI / 2;
      hub.position.set(0.62, 1.24, 0.26);
      root.add(hub);
      const takeUp = this.addBox(root, [0.06, 0.34, 0.06], [0.34, 1.62, -0.02], timber);
      takeUp.rotation.z = -0.34;
      const idler = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.05, 10), secondary);
      idler.rotation.x = Math.PI / 2;
      idler.position.set(0.44, 1.78, -0.02);
      root.add(idler);
      const belt = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.012, 5, 18), dark);
      belt.position.set(0.5, 1.24, 0.18);
      root.add(belt);
    } else {
      for (const flip of [-1, 1]) {
        const leg = this.addBox(root, [0.05, 0.72, 0.05], [-0.86, 1.36, flip * 0.16], timber);
        leg.rotation.x = flip * 0.22;
      }
      const board = this.addBox(root, [0.5, 0.66, 0.04], [-0.86, 1.5, 0.04], cream);
      board.rotation.set(0, 0.34, 0);
      const banner = this.addBox(root, [0.42, 0.14, 0.02], [-0.87, 1.72, 0.06], primary);
      banner.rotation.set(0, 0.34, 0);
      const strip = this.addBox(root, [0.3, 0.08, 0.02], [-0.88, 1.3, 0.07], secondary);
      strip.rotation.set(0, 0.34, 0);
      const star = new THREE.Mesh(new THREE.SphereGeometry(0.08, 9, 7), secondary);
      star.scale.set(1, 1, 0.4);
      star.position.set(-0.88, 1.52, 0.08);
      root.add(star);
    }
  }

  /**
   * Cinematic level 3 — the projector finally has somewhere to throw. A roller screen
   * on timber posts goes up at the back, pleated curtains hang either side, a brass
   * sound horn sits on a stand and two bentwood seats face the picture.
   *
   * The room is what turns a projector into a cinema, so this level adds the room.
   */
  private createScreenHouse(
    root: THREE.Group,
    primary: THREE.MeshStandardMaterial,
    secondary: THREE.MeshStandardMaterial,
    dark: THREE.MeshStandardMaterial,
    cream: THREE.MeshStandardMaterial,
    timber: THREE.MeshStandardMaterial,
  ): void {
    for (const x of [-1.04, 1.04]) {
      this.addBox(root, [0.12, 2.66, 0.12], [x, 1.35, -0.96], timber);
      this.addBox(root, [0.3, 0.09, 0.42], [x, 0.06, -0.96], timber);
    }
    const roller = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 2.18, 10), secondary);
    roller.rotation.z = Math.PI / 2;
    roller.position.set(0, 2.66, -0.96);
    root.add(roller);
    this.addBox(root, [1.98, 1.0, 0.05], [0, 2.1, -0.96], cream);
    this.addBox(root, [2.02, 0.07, 0.09], [0, 1.57, -0.96], secondary);
    for (const y of [2.6, 1.6]) this.addBox(root, [2.0, 0.03, 0.07], [0, y, -0.9], timber);

    for (const x of [-0.86, 0.86]) {
      for (const dx of [-0.09, 0.09]) {
        const pleat = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.1, 1.06, 8), primary);
        pleat.position.set(x + dx, 2.1, -0.86);
        root.add(pleat);
      }
      const tieback = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.022, 5, 12), secondary);
      tieback.rotation.y = Math.PI / 2;
      tieback.position.set(x, 1.77, -0.86);
      root.add(tieback);
    }

    const hornPost = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.86, 8), timber);
    hornPost.position.set(1.0, 0.43, 0.28);
    root.add(hornPost);
    this.addBox(root, [0.28, 0.06, 0.28], [1.0, 0.03, 0.28], timber);
    const horn = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.5, 12, 1, true), secondary);
    horn.rotation.x = -Math.PI / 2;
    horn.position.set(1.0, 1.0, 0.5);
    root.add(horn);
    const hornThroat = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.22, 10), secondary);
    hornThroat.rotation.x = Math.PI / 2;
    hornThroat.position.set(1.0, 1.0, 0.66);
    root.add(hornThroat);

    for (const x of [-0.72, 0.14]) {
      const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.13, 0.42, 8), timber);
      pedestal.position.set(x, 0.21, 0.96);
      root.add(pedestal);
      const seat = this.addBox(root, [0.44, 0.08, 0.4], [x, 0.46, 0.96], timber);
      seat.rotation.y = -x * 0.18;
      const back = this.addBox(root, [0.44, 0.42, 0.06], [x, 0.7, 1.14], primary);
      back.rotation.set(-0.18, -x * 0.18, 0);
      const cushion = this.addBox(root, [0.36, 0.05, 0.32], [x, 0.52, 0.96], dark);
      cushion.rotation.y = -x * 0.18;
    }
  }

  /**
   * Cinematic level 4 — the lantern marquee. A bulb-lit board crowns the screen, a
   * planted trough runs along its top, a soft beam hangs between the lens and the
   * picture and three warm globes light the seats.
   *
   * Level 3 built the room; this lights it and puts the name outside, which is the
   * point at which a projector becomes a picture house.
   */
  private createMarqueeCrown(
    root: THREE.Group,
    primary: THREE.MeshStandardMaterial,
    secondary: THREE.MeshStandardMaterial,
    dark: THREE.MeshStandardMaterial,
    timber: THREE.MeshStandardMaterial,
  ): void {
    const leaf = this.leafMaterial();
    for (const x of [-1.04, 1.04]) {
      this.addBox(root, [0.12, 2.5, 0.12], [x, 1.27, 0.62], timber);
      this.addBox(root, [0.3, 0.09, 0.4], [x, 0.06, 0.62], timber);
      const brace = this.addBox(root, [0.09, 0.09, 0.6], [x, 2.4, 0.3], timber);
      brace.rotation.x = 0.16;
    }
    this.addBox(root, [2.24, 0.42, 0.16], [0, 2.66, 0.62], timber);
    this.addBox(root, [2.3, 0.06, 0.24], [0, 2.89, 0.62], secondary);
    this.addBox(root, [2.3, 0.06, 0.24], [0, 2.43, 0.62], secondary);
    for (let index = 0; index < 3; index += 1) {
      this.addBox(root, [0.42, 0.09, 0.03], [-0.52 + index * 0.52, 2.72, 0.72], index === 1 ? primary : secondary);
    }
    this.addBox(root, [1.1, 0.07, 0.03], [0, 2.57, 0.72], secondary);
    for (let index = 0; index < 7; index += 1) {
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.062, 9, 7), primary);
      bulb.position.set(-0.96 + index * 0.32, 2.36, 0.72);
      root.add(bulb);
      const socket = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.05, 8), secondary);
      socket.position.set(-0.96 + index * 0.32, 2.42, 0.72);
      root.add(socket);
    }
    for (let index = 0; index < 5; index += 1) {
      const swag = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 7), leaf);
      swag.scale.set(1, 0.58, 0.85);
      swag.position.set(-0.8 + index * 0.4, 2.94, 0.62);
      root.add(swag);
    }

    const picture = this.addBox(root, [1.76, 0.82, 0.03], [0, 2.12, -0.92], new THREE.MeshStandardMaterial({
      color: 0xfff4d8, roughness: 0.92, metalness: 0, emissive: new THREE.Color(0xffe4a8), emissiveIntensity: 0.9,
    }));
    picture.receiveShadow = false;
    const beam = new THREE.Mesh(
      new THREE.ConeGeometry(0.82, 0.5, 16, 1, true),
      new THREE.MeshStandardMaterial({
        color: 0xfff0cf, roughness: 0.9, metalness: 0, transparent: true, opacity: 0.22, depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    beam.rotation.x = Math.PI / 2 - 0.9;
    beam.position.set(0, 1.72, -0.72);
    root.add(beam);
    const halo = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.022, 6, 16), secondary);
    halo.position.set(0, 1.36, -0.64);
    root.add(halo);

    for (const [x, z] of [[-0.62, 0.34], [0, 0.48], [0.62, 0.34]] as Array<[number, number]>) {
      const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.4, 5), dark);
      cord.position.set(x, 2.5, z);
      root.add(cord);
      const shell = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.16, 0.22, 10, 1, true), timber);
      shell.position.set(x, 2.2, z);
      root.add(shell);
      const globe = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), primary);
      globe.position.set(x, 2.17, z);
      root.add(globe);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.145, 0.018, 5, 12), secondary);
      ring.rotation.x = Math.PI / 2;
      ring.position.set(x, 2.31, z);
      root.add(ring);
    }

    const lampCore = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 9), primary);
    lampCore.name = "equipment-pulse";
    lampCore.position.set(0, 1.3, -0.44);
    root.add(lampCore);
  }


  /** A flat colour, shared between every piece of kit that asks for the same one. */

  /** Build one piece of floor kit into `root`, and report the radius it occupies. */

  private addBox<T extends THREE.Material>(
    parent: THREE.Object3D,
    size: readonly [number, number, number],
    position: readonly [number, number, number],
    material: T,
  ): THREE.Mesh<THREE.BoxGeometry, T> {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
    mesh.position.set(...position);
    mesh.castShadow = this.renderer.shadowMap.enabled;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  private updateMovement(delta: number): void {
    const movement = new THREE.Vector3();
    if (this.keys.has("w") || this.keys.has("arrowup")) movement.z -= 1;
    if (this.keys.has("s") || this.keys.has("arrowdown")) movement.z += 1;
    if (this.keys.has("a") || this.keys.has("arrowleft")) movement.x -= 1;
    if (this.keys.has("d") || this.keys.has("arrowright")) movement.x += 1;

    if (movement.lengthSq() === 0 && this.moveTarget) {
      movement.copy(this.moveTarget).sub(this.player.position);
      movement.y = 0;
      if (movement.length() < 0.09) {
        movement.set(0, 0, 0);
        this.moveTarget = null;
      }
    }

    let walking = false;
    let movementSpeed = 0;
    if (movement.lengthSq() > 0) {
      movement.normalize();
      const step = movement.multiplyScalar(WALK_SPEED * delta);
      const beforeX = this.player.position.x;
      const beforeZ = this.player.position.z;
      const nextX = this.player.position.x + step.x;
      const nextZ = this.player.position.z + step.z;
      if (this.isWalkable(nextX, this.player.position.z)) this.player.position.x = nextX;
      else if (this.moveTarget) this.moveTarget = null;
      if (this.isWalkable(this.player.position.x, nextZ)) this.player.position.z = nextZ;
      else if (this.moveTarget) this.moveTarget = null;
      const movedX = this.player.position.x - beforeX;
      const movedZ = this.player.position.z - beforeZ;
      walking = movedX * movedX + movedZ * movedZ > 1e-8;
      movementSpeed = planarSpeed(movedX, movedZ, delta);
      if (walking) {
        this.player.rotation.y = dampInteriorAvatarYaw(
          this.player.rotation.y,
          interiorAvatarYaw(movedX, movedZ),
          delta,
        );
      }
    }

    this.updatePlayerAnimations(delta, movementSpeed);
    if (this.playerMixer) {
      this.player.position.y = 0;
    } else {
      this.player.position.y = walking ? Math.sin(this.elapsed * 10) * 0.035 : 0;
      const legs = this.playerFallback?.getObjectByName("interior-player-legs");
      if (legs) {
        const swing = walking ? Math.sin(this.elapsed * 10) * 0.42 : 0;
        const left = legs.getObjectByName("left-leg");
        const right = legs.getObjectByName("right-leg");
        if (left) left.rotation.x = swing;
        if (right) right.rotation.x = -swing;
      }
    }

    if (this.callbacks.onMoved && this.player.position.distanceToSquared(this.lastMoveReport) > 0.04) {
      this.lastMoveReport.copy(this.player.position);
      this.callbacks.onMoved({ x: this.player.position.x, z: this.player.position.z });
    }
  }

  private isWalkable(x: number, z: number): boolean {
    if (x < -ROOM_HALF_WIDTH + PLAYER_RADIUS + 0.18 || x > ROOM_HALF_WIDTH - PLAYER_RADIUS - 0.18) return false;
    if (z < -ROOM_HALF_DEPTH + PLAYER_RADIUS + 0.22 || z > ROOM_HALF_DEPTH - PLAYER_RADIUS - 0.18) return false;
    return this.obstacles.every((obstacle) => {
      const dx = x - obstacle.x;
      const dz = z - obstacle.z;
      const radius = obstacle.radius + PLAYER_RADIUS;
      return dx * dx + dz * dz >= radius * radius;
    });
  }

  private animateRoom(): void {
    for (const station of this.stations.values()) {
      station.root.traverse((child) => {
        if (child.name === "flow-roller") child.rotation.x = this.elapsed * 1.7;
        else if (child.name === "equipment-rotor") child.rotation.z = this.elapsed * 0.82;
        else if (child.name === "equipment-pulse") {
          const pulse = 1 + Math.sin(this.elapsed * 2.7) * 0.12;
          child.scale.setScalar(pulse);
          child.rotation.y = this.elapsed * 0.7;
        } else if (child.name === "blueprint-scan") {
          child.rotation.z = this.elapsed * 0.65;
          child.position.y = 0.58 + Math.sin(this.elapsed * 2.2) * 0.15;
        }
      });
      const level = this.upgrades[station.definition.key];
      station.label.position.y = 3.05 + Math.sin(this.elapsed * 1.65 + STATIONS.indexOf(station.definition)) * 0.035;
      for (let index = 0; index < station.lamps.length; index += 1) {
        const lamp = station.lamps[index];
        if (index < level) lamp.scale.setScalar(1 + Math.sin(this.elapsed * 3 + index) * 0.08);
      }
    }
    for (const ambient of this.ambientObjects) {
      const phase = this.elapsed * ambient.speed;
      if (ambient.motion === "spin-x") ambient.object.rotation.x = phase;
      else if (ambient.motion === "spin-y") ambient.object.rotation.y = phase;
      else if (ambient.motion === "spin-z") ambient.object.rotation.z = phase;
      else if (ambient.motion === "pulse") {
        const scale = 1 + Math.sin(phase * 2.2) * 0.045;
        ambient.object.scale.setScalar(scale);
      } else ambient.object.position.y = ambient.originY + Math.sin(phase * 1.8) * 0.08;
    }
    if (this.exitHalo) this.exitHalo.rotation.z = Math.sin(this.elapsed * 0.8) * 0.08;
  }

  private isWalkableTargetDistance(target: TargetId): number {
    const point = target === "exit" ? this.exitApproach : this.stations.get(target)?.root.position;
    if (!point) return Number.POSITIVE_INFINITY;
    return Math.hypot(this.player.position.x - point.x, this.player.position.z - point.z);
  }

  private resolveSelection(): InteriorSelection | null {
    let nearest: TargetId | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const station of this.stations.values()) {
      const distance = this.isWalkableTargetDistance(station.definition.key);
      if (distance <= STATION_RANGE && distance < nearestDistance) {
        nearest = station.definition.key;
        nearestDistance = distance;
      }
    }
    const exitDistance = Math.hypot(
      this.player.position.x - this.exitApproach.x,
      this.player.position.z - this.exitApproach.z,
    );
    if (exitDistance <= EXIT_RANGE && exitDistance < nearestDistance) {
      nearest = "exit";
      nearestDistance = exitDistance;
    }

    const target = nearest ?? this.hoverTarget ?? this.chosenTarget;
    if (!target) return null;
    if (target === "exit") {
      const distance = Math.hypot(
        this.player.position.x - this.exitApproach.x,
        this.player.position.z - this.exitApproach.z,
      );
      return { kind: "exit", label: "Return outside", distance, nearby: distance <= EXIT_RANGE };
    }
    const station = this.stations.get(target);
    if (!station) return null;
    const distance = this.isWalkableTargetDistance(target);
    return {
      kind: "upgrade",
      key: target,
      label: station.design.name,
      level: this.upgrades[target],
      ceiling: this.upgradeCeiling,
      distance,
      nearby: distance <= STATION_RANGE,
    };
  }

  private refreshSelection(force = false): void {
    if (!this.active) return;
    const selection = this.resolveSelection();
    const selectionSignature = selection
      ? `${selection.kind}:${selection.kind === "upgrade" ? selection.key : "exit"}:${selection.nearby}:${Math.round(selection.distance * 2)}`
      : "none";
    if (force || selectionSignature !== this.selectionSignature) {
      this.selectionSignature = selectionSignature;
      this.callbacks.onSelectionChange?.(selection);
    }

    const targetId: TargetId | null = selection?.kind === "upgrade" ? selection.key : selection ? "exit" : null;
    for (const station of this.stations.values()) {
      const highlighted = station.definition.key === targetId;
      // Shown only when this station is the one being pointed at or walked to. An
      // always-on ring is a port; a ring that appears when you reach for something is
      // feedback.
      station.halo.visible = highlighted;
      station.halo.material.opacity = selection?.nearby ? 0.62 : 0.34;
      station.halo.scale.setScalar(highlighted ? 1.06 : 1);
      for (const material of station.highlightMaterials) material.emissiveIntensity = highlighted ? 1.05 : 0.4;
    }
    if (this.exitHalo) this.exitHalo.material.opacity = targetId === "exit" ? (selection?.nearby ? 0.76 : 0.5) : 0.28;

    const prompt = selection ? this.createPrompt(selection) : null;
    const promptSignature = prompt
      ? `${selectionSignature}:${prompt.available}:${prompt.actionLabel}:${prompt.detail}`
      : "none";
    if (force || promptSignature !== this.promptSignature) {
      this.promptSignature = promptSignature;
      this.callbacks.onPromptChange?.(prompt);
    }
  }

  private createPrompt(selection: InteriorSelection): InteriorPrompt {
    if (selection.kind === "exit") {
      return {
        selection,
        title: "Return to the district",
        detail: selection.nearby ? "The exit is ready." : "Walk to the marked doorway.",
        actionLabel: "Exit business",
        available: selection.nearby,
        inputHint: selection.nearby ? "Press E to leave" : "Click the door to walk there",
      };
    }
    const station = this.stations.get(selection.key);
    const maximum = selection.level >= selection.ceiling;
    const unpurchased = selection.level === 0;
    return {
      selection,
      title: unpurchased ? `${selection.label} · Not installed` : `${selection.label} · Level ${selection.level}`,
      detail: maximum
        ? `This station has reached the current level ${selection.ceiling} ceiling.`
        : station?.design.description ?? "Install the next equipment level.",
      actionLabel: maximum ? "Maximum level" : unpurchased ? `Purchase ${selection.label}` : `Install level ${selection.level + 1}`,
      available: selection.nearby && !maximum,
      inputHint: selection.nearby
        ? maximum ? "Upgrade ceiling reached" : "Press E to inspect and upgrade"
        : "Click the station to walk within range",
    };
  }

  private updateStationVisual(station: InteriorStation): void {
    const level = this.upgrades[station.definition.key];
    station.blueprint.visible = level === 0;
    for (let index = 0; index < station.modules.length; index += 1) station.modules[index].visible = index < level;
    for (let index = 0; index < station.lamps.length; index += 1) {
      const installed = index < level;
      const locked = index >= this.upgradeCeiling;
      station.lamps[index].material.color.set(installed ? 0xffdb68 : locked ? 0x263d3d : 0x49605c);
      station.lamps[index].material.emissiveIntensity = installed ? 1.6 : 0.05;
    }
    const oldTexture = station.label.material.map;
    const accent = new THREE.Color(station.design.secondary);
    const nextTexture = this.createStationTexture(station.definition, station.design, level, accent);
    station.label.material.map = nextTexture;
    station.label.material.needsUpdate = true;
    if (oldTexture) {
      oldTexture.dispose();
      this.textures.delete(oldTexture);
    }
  }

  private pickTarget(): TargetId | null {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObjects(this.interactiveObjects, false)[0]?.object;
    const target = hit?.userData.interiorTarget as TargetId | undefined;
    return target ?? null;
  }

  private setPointer(event: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.set(
      ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
      -((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1,
    );
  }

  private requestExit(): void {
    this.setActive(false);
    this.callbacks.onExit?.();
  }

  private normaliseLevels(levels: Record<UpgradeKey, number>): Record<UpgradeKey, number> {
    return {
      yield: clampLevel(levels.yield, this.upgradeCeiling),
      capacity: clampLevel(levels.capacity, this.upgradeCeiling),
      speed: clampLevel(levels.speed, this.upgradeCeiling),
      appeal: clampLevel(levels.appeal, this.upgradeCeiling),
    };
  }

  private createStationTexture(
    definition: StationDefinition,
    design: InteriorEquipmentDesign,
    level: number,
    accent: THREE.Color,
  ): THREE.Texture {
    return this.createSignTexture(
      design.name,
      level === 0 ? `${definition.icon}  NOT INSTALLED · CHOOSE & BUY` : `${definition.icon}  LEVEL ${level} / ${this.upgradeCeiling}`,
      `#${accent.getHexString()}`,
      768,
      216,
    );
  }

  private createSignTexture(
    title: string,
    subtitle: string,
    accent: string,
    width: number,
    height: number,
  ): THREE.CanvasTexture {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D is required for interior signs.");
    // The plate is drawn the way the city outside draws everything: a flat fill, a hard
    // dark border, no gradient and no glow. The old one was a soft-shadowed rounded card
    // with a coloured stroke — a UI chip floating in a world that has no soft edges
    // anywhere else in it.
    context.clearRect(0, 0, width, height);
    const inset = Math.round(height * 0.09);
    const radius = Math.round(height * 0.12);
    // The dark border first, as a slightly larger plate underneath.
    this.roundedRect(context, inset - 6, inset - 6, width - (inset - 6) * 2, height - (inset - 6) * 2, radius + 4);
    context.fillStyle = "#0d2426";
    context.fill();
    // Then the face, in the accent, leaving the dark showing as a drawn edge.
    this.roundedRect(context, inset, inset, width - inset * 2, height - inset * 2, radius);
    context.fillStyle = "#12494c";
    context.fill();
    // A solid accent bar down the left, the way the world's own plaques are keyed.
    context.fillStyle = accent;
    context.fillRect(inset, inset + radius * 0.4, Math.round(width * 0.018), height - inset * 2 - radius * 0.8);
    context.fillStyle = "#f8eccd";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.font = `800 ${this.fittedFontSize(context, title, width * 0.82, height * 0.31)}px system-ui, sans-serif`;
    context.fillText(title, width / 2, height * 0.43);
    context.fillStyle = accent;
    context.font = `700 ${this.fittedFontSize(context, subtitle, width * 0.82, height * 0.19)}px system-ui, sans-serif`;
    context.fillText(subtitle, width / 2, height * 0.71);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy());
    texture.needsUpdate = true;
    this.textures.add(texture);
    return texture;
  }

  private fittedFontSize(context: CanvasRenderingContext2D, text: string, maxWidth: number, preferred: number): number {
    let size = preferred;
    while (size > 18) {
      context.font = `800 ${size}px system-ui, sans-serif`;
      if (context.measureText(text).width <= maxWidth) break;
      size -= 2;
    }
    return Math.floor(size);
  }

  private roundedRect(
    context: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
  ): void {
    const r = Math.min(radius, width / 2, height / 2);
    context.beginPath();
    context.moveTo(x + r, y);
    context.lineTo(x + width - r, y);
    context.quadraticCurveTo(x + width, y, x + width, y + r);
    context.lineTo(x + width, y + height - r);
    context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    context.lineTo(x + r, y + height);
    context.quadraticCurveTo(x, y + height, x, y + height - r);
    context.lineTo(x, y + r);
    context.quadraticCurveTo(x, y, x + r, y);
    context.closePath();
  }

  private isTextInput(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    return target.isContentEditable || target.matches("input, textarea, select, button, [role='textbox']");
  }

  private emitClearedSelection(): void {
    this.selectionSignature = "";
    this.promptSignature = "";
    this.callbacks.onSelectionChange?.(null);
    this.callbacks.onPromptChange?.(null);
  }

  private restoreCanvasState(): void {
    const restore = (name: string, value: string | null): void => {
      if (value === null) this.canvas.removeAttribute(name);
      else this.canvas.setAttribute(name, value);
    };
    restore("tabindex", this.previousCanvasState.tabIndex);
    restore("role", this.previousCanvasState.role);
    restore("aria-label", this.previousCanvasState.ariaLabel);
    this.canvas.style.touchAction = this.previousCanvasState.touchAction;
    this.canvas.style.cursor = "";
  }
}
