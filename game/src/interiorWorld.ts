import * as THREE from "three";
import { dampWrappedYaw, headingYaw, planarSpeed, walkAnimationRate } from "./characterRig";
import { BUSINESS, MAX_UPGRADE_LEVEL } from "./data";
import type { BusinessConfig, LicenseKey, UpgradeKey } from "./data";
import { createPlayerMercedonian } from "./mercedonianAvatar";

export interface InteriorEnterOptions {
  business: BusinessConfig;
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
//
// The kit is placed, never scattered. Six authored slots sit clear of the four upgrade
// stations, the exit door at the back, and the centre walkway, so nothing a business
// owns can ever block the way to a station it owns.

/** Where floor kit may stand: [x, z, facing]. Clear of stations, door and walkway. */
export const PROP_SLOTS: ReadonlyArray<readonly [number, number, number]> = [
  // Four low support-kit bays sit along the cutaway front edge. The rear wall is now
  // reserved for each business's authored production centerpiece and living system.
  [-3.4, 4.8, Math.PI],
  [3.4, 4.8, Math.PI],
  [-6.6, 4.85, Math.PI],
  [6.6, 4.85, Math.PI],
];

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
  /** Floor kit, taken in order into PROP_SLOTS. Fewer than six leaves slots empty. */
  props: readonly PropKind[];
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
    props: ["tanks", "conveyor", "bins", "shelves"],
    light: { key: 0xd6f4ff, keyStrength: 2.4, bounce: 0x2c5a63, fill: 0x8fe6ea, fillStrength: 1.05, level: 1.7 } },
  sungrid: { displayName: "Heliostat Control Atrium", description: "A sun-washed energy hall that turns daylight, storage and distribution into one readable circuit.", regenerativeSystem: "Solar microgrid · second-life battery bank", architecture: "heliostat-atrium", floorPattern: "solar-circuit", accent: 0xf2c94c, floor: 0xd9cfa6, path: 0xcabf90, wall: 0x9a9673, trim: 0x8a6f3c, glass: 0xd8e9a8, sky: 0x2c4a3a,
    props: ["solar", "toolwall", "crates", "conveyor"],
    light: { key: 0xfff0c2, keyStrength: 3.4, bounce: 0x6a6a3c, fill: 0xffe9a8, fillStrength: 1.15, level: 2.0 } },
  greenhouse: { displayName: "Canopy Biome House", description: "A humid barrel-biome of hydroponic rows, rain capture and pollinator rails under a living glass canopy.", regenerativeSystem: "Rain capture · nutrient recirculation · pollinator habitat", architecture: "canopy-biome", floorPattern: "growing-rows", accent: 0x82bd55, floor: 0xc6bd8c, path: 0xb3ac7c, wall: 0x7f9668, trim: 0x6f5a34, glass: 0xb9e7b0, sky: 0x1d4630,
    props: ["beds", "shelves", "crates", "tanks"],
    light: { key: 0xf4ffd9, keyStrength: 3.2, bounce: 0x3f6a3a, fill: 0xc8f0a8, fillStrength: 1.2, level: 2.1 } },
  mine: { displayName: "Reclaimed Strata Vault", description: "A rock-cut assay chamber where clean electric tools work beside mist collectors and active habitat restoration.", regenerativeSystem: "Dust capture · water mist recovery · moss reclamation", architecture: "reclaimed-strata-vault", floorPattern: "strata-bands", accent: 0xd58d4f, floor: 0x9b9188, path: 0x8b8078, wall: 0x6f6862, trim: 0x4f4a45, glass: 0x9fb2b8, sky: 0x241f1c,
    props: ["orecart", "conveyor", "toolwall", "bins"],
    light: { key: 0xffd9a0, keyStrength: 1.5, bounce: 0x241d18, fill: 0x6d8b96, fillStrength: 0.45, level: 0.95 } },
  timberworks: { displayName: "Regrowth Timber Hall", description: "An open glulam shed joining a solar kiln, provenance wall and seedling nursery to every cut board.", regenerativeSystem: "Solar kiln · seedling replacement ledger · sawdust recovery", architecture: "regrowth-timber-hall", floorPattern: "timber-grain", accent: 0xc8914a, floor: 0xc7a273, path: 0xb69065, wall: 0x8d6c46, trim: 0x6c4f2f, glass: 0xcfe0a8, sky: 0x2a3a24,
    props: ["logs", "toolwall", "conveyor", "shelves"],
    light: { key: 0xffe6b8, keyStrength: 2.7, bounce: 0x5a4028, fill: 0xd2e6a4, fillStrength: 0.8, level: 1.6 } },
  cratemill: { displayName: "Circular Packhouse", description: "A flat-pack line where reusable frames, nesting crates and return bins keep materials moving in a loop.", regenerativeSystem: "Reusable packaging pool · offcut return loop", architecture: "circular-packhouse", floorPattern: "folding-grid", accent: 0xe39a52, floor: 0xcbb187, path: 0xbaa077, wall: 0x8f7550, trim: 0x6f5537, glass: 0xd8dfae, sky: 0x2f3b2a,
    props: ["crates", "conveyor", "pallets", "toolwall"],
    light: { key: 0xffe3ae, keyStrength: 2.6, bounce: 0x5c452a, fill: 0xd8dfae, fillStrength: 0.75, level: 1.55 } },
  workshop: { displayName: "Component Atelier", description: "A sawtooth-lit Mercedonian atelier with an overhead tool rail, repair benches and a reclaimed-parts library.", regenerativeSystem: "Repair-first fabrication · reclaimed component library", architecture: "sawtooth-atelier", floorPattern: "maker-sparks", accent: 0xe98262, floor: 0xc4b596, path: 0xb2a385, wall: 0x84836c, trim: 0x6d5738, glass: 0xc9e3d0, sky: 0x243d3a,
    props: ["toolwall", "crates", "shelves", "pallets"],
    light: { key: 0xffe1b0, keyStrength: 2.6, bounce: 0x4a4636, fill: 0x9fd8c6, fillStrength: 0.8, level: 1.6 } },
  factory: { displayName: "Clean Forge Hall", description: "A five-bay fabrication floor with compact robotics, daylight clerestories and visible closed-loop cooling.", regenerativeSystem: "Heat recovery · closed-loop coolant · rooftop solar", architecture: "clean-forge-hall", floorPattern: "assembly-line", accent: 0xe7ad45, floor: 0xa9a9a2, path: 0x999992, wall: 0x767a7c, trim: 0x565b5e, glass: 0xa9cfd6, sky: 0x1e2e33,
    props: ["conveyor", "toolwall", "pallets", "bins"],
    light: { key: 0xe8f0ff, keyStrength: 2.5, bounce: 0x33393c, fill: 0x9ec6d6, fillStrength: 0.9, level: 1.45 } },
  construction: { displayName: "Civic Prefab Studio", description: "A design room and assembly bay where district models become low-waste modular building panels.", regenerativeSystem: "Design-for-disassembly · permeable planted work yard", architecture: "civic-prefab-studio", floorPattern: "survey-grid", accent: 0xe5a949, floor: 0xb8ada0, path: 0xa79c90, wall: 0x827a70, trim: 0x64594d, glass: 0xc4d8c0, sky: 0x2b3630,
    props: ["scaffold", "pallets", "crates", "conveyor"],
    light: { key: 0xffeccb, keyStrength: 2.8, bounce: 0x4c463c, fill: 0xb8ccb4, fillStrength: 0.7, level: 1.6 } },
  freight: { displayName: "Solar Quay Depot", description: "A harbour dispatch deck with route intelligence, shore power and compact electric cargo handling.", regenerativeSystem: "Solar shore power · reusable cargo pooling", architecture: "solar-quay-depot", floorPattern: "quay-route", accent: 0x4ab6bd, floor: 0xb0a894, path: 0x9f9784, wall: 0x7c7566, trim: 0x5c5648, glass: 0xb6d2d6, sky: 0x223034,
    props: ["pallets", "crates", "shelves", "bins"],
    light: { key: 0xffeed2, keyStrength: 2.4, bounce: 0x3e3a30, fill: 0xa8c6cc, fillStrength: 0.8, level: 1.45 } },
  shop: { displayName: "Lantern Market Pavilion", description: "A compact produce market and café beneath a leaf-fan canopy, built around refill and return stations.", regenerativeSystem: "Reusable cup loop · local produce cooling · herb wall", architecture: "lantern-market-pavilion", floorPattern: "market-petals", accent: 0xeb7f68, floor: 0xdcc9a8, path: 0xcbb897, wall: 0x9a8367, trim: 0x7a5f42, glass: 0xf0d5b8, sky: 0x3a3026,
    props: ["shelves", "crates", "diner", "bins"],
    light: { key: 0xfff0d0, keyStrength: 2.9, bounce: 0x6b543a, fill: 0xffdcb4, fillStrength: 1.0, level: 1.85 } },
  restaurant: { displayName: "Edible Garden Kitchen", description: "An open conservatory kitchen where the solar hearth, herb beds and dining garden share one warm room.", regenerativeSystem: "Solar cooking · food-waste compost · rain-chain irrigation", architecture: "edible-garden-kitchen", floorPattern: "hearth-ring", accent: 0xf09a63, floor: 0xd8b58c, path: 0xc7a37b, wall: 0x96694a, trim: 0x74492f, glass: 0xf5cf9a, sky: 0x3d2a1e,
    props: ["diner", "shelves", "bins", "tanks"],
    light: { key: 0xffd9a2, keyStrength: 3.0, bounce: 0x6a3f26, fill: 0xffc98a, fillStrength: 1.05, level: 1.8 } },
  gym: { displayName: "Kinetic Wellness Grove", description: "An airy lotus-rib hall where movement powers the recovery garden and cooling channel.", regenerativeSystem: "Human-powered generation · passive cooling · refill bar", architecture: "kinetic-wellness-grove", floorPattern: "kinetic-orbit", accent: 0x56bba4, floor: 0xa8bfae, path: 0x97ae9d, wall: 0x6f8b7c, trim: 0x50695c, glass: 0xb9e2d4, sky: 0x1c3a33,
    props: ["weights", "shelves", "tanks", "toolwall"],
    light: { key: 0xeaffef, keyStrength: 2.7, bounce: 0x2f5147, fill: 0xa8e6d2, fillStrength: 1.0, level: 1.75 } },
  cinema: { displayName: "Lantern Theatre", description: "A timber-acoustic screening room and planted foyer crowned by a luminous Mercedonian lantern marquee.", regenerativeSystem: "Low-energy projection · reclaimed acoustic timber", architecture: "lantern-theatre", floorPattern: "projector-beam", accent: 0xe6ad4d, floor: 0x6d6070, path: 0x5f5363, wall: 0x4b4152, trim: 0x352d3b, glass: 0x9a86b4, sky: 0x1a1522,
    props: ["seats", "shelves", "diner", "crates"],
    light: { key: 0xb49ad8, keyStrength: 1.2, bounce: 0x1a1522, fill: 0x8a72b4, fillStrength: 0.55, level: 0.8 } },
  recycler: { displayName: "Materials Loop Laboratory", description: "A clean recovery lab where sorting bays, sample galleries and feedstock banks close the city material loop.", regenerativeSystem: "Optical sorting · remanufacturing feedstock loop", architecture: "materials-loop-lab", floorPattern: "circular-loop", accent: 0x77b95a, floor: 0xa9b394, path: 0x98a284, wall: 0x74805f, trim: 0x555f43, glass: 0xc0dba8, sky: 0x252f22,
    props: ["bins", "conveyor", "crates", "pallets"],
    light: { key: 0xf2ffd6, keyStrength: 2.5, bounce: 0x424a34, fill: 0xbcd8a4, fillStrength: 0.85, level: 1.55 } },
};

type TargetId = UpgradeKey | "exit";

export const ROOM_HALF_WIDTH = 8;
export const ROOM_HALF_DEPTH = 6;
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

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (!this.active) return;
    this.setPointer(event);
    const target = this.pickTarget();
    this.hoverTarget = target;
    this.canvas.style.cursor = target ? "pointer" : "crosshair";
    this.refreshSelection();
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
      "Business interior. Move with W A S D or arrow keys, click the floor to walk, press E near equipment to interact, and Escape to leave.",
    );
    canvas.style.touchAction = "none";

    this.scene.background = new THREE.Color(0x123e42);
    this.scene.fog = new THREE.Fog(0xcde9d6, 18, 36);
    this.camera.position.set(10.5, 13.5, 15.5);
    this.camera.lookAt(this.cameraLookAt);

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
      this.clock.start();
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
    const ratio = nextWidth / nextHeight;
    let viewHeight = 13.4;
    let viewWidth = viewHeight * ratio;
    if (viewWidth < 18.2) {
      viewWidth = 18.2;
      viewHeight = viewWidth / ratio;
    }
    this.camera.left = -viewWidth / 2;
    this.camera.right = viewWidth / 2;
    this.camera.top = viewHeight / 2;
    this.camera.bottom = -viewHeight / 2;
    this.camera.updateProjectionMatrix();
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
    disposeObject(this.content);
    disposeObject(this.player);
    for (const texture of this.textures) texture.dispose();
    this.textures.clear();
    this.renderer.dispose();
    this.restoreCanvasState();
  }

  private readonly animate = (): void => {
    if (!this.active || this.disposed) return;
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
    const cream = new THREE.MeshStandardMaterial({ color: 0xe9d9b4, roughness: 0.9 });
    const stone = new THREE.MeshStandardMaterial({ color: design.wall, roughness: 0.88 });
    const timber = new THREE.MeshStandardMaterial({ color: design.trim, roughness: 0.82 });
    const teal = new THREE.MeshStandardMaterial({ color: 0x1c6667, roughness: 0.72 });
    const accentMaterial = new THREE.MeshStandardMaterial({
      color: design.accent,
      roughness: 0.52,
      metalness: 0.12,
      emissive: new THREE.Color(design.accent).multiplyScalar(0.12),
      emissiveIntensity: 0.4,
    });
    const floorMaterial = new THREE.MeshStandardMaterial({ color: design.floor, roughness: 0.94 });
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

    const grid = new THREE.GridHelper(12, 12, design.trim, design.path);
    grid.scale.x = 4 / 3;
    grid.position.y = 0.012;
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.18;
    this.content.add(grid);

    this.createRoomShell(design, stone, timber, teal, glass, accentMaterial);
    this.createFloorStory(design);

    this.createBusinessSign(accent);
    this.createExitDoor(accent, timber, teal);
    for (const definition of STATIONS) this.createStation(definition, cream, teal, timber);
    this.createSignatureSystem(design, cream, timber, teal, accentMaterial, glass);
    this.dressRoom(design);

    // Only the two by the side walls: the front pair stood where the outer floor kit
    // now goes, and every room brings its own greenery if the trade calls for it.
    for (const [x, z, scale] of [
      [-7.15, -1.0, 0.85], [7.1, -1.0, 0.85],
    ] as Array<[number, number, number]>) {
      this.createPlant(x, z, scale, accent);
    }

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
    const sideRails = (material: THREE.Material, height = 4.55): void => {
      for (const x of [-7.55, 7.55]) {
        box([0.2, height, 0.3], [x, height / 2, -5.72], material);
        box([0.15, 0.16, 11.8], [x, height, 0], material);
      }
    };

    // Low, non-negotiable plinths tell the collision boundary without enclosing the
    // camera. Everything above them is business-specific.
    box([16.5, 0.44, 0.5], [0, 0.2, -6.05], stone);
    box([0.5, 0.44, 12.4], [-8.05, 0.2, 0], stone);
    box([0.5, 0.44, 12.4], [8.05, 0.2, 0], stone);

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
        for (const x of [-7.35, 7.35]) {
          for (const z of [-4.6, -1.5, 1.6, 4.7]) {
            const rib = new THREE.Mesh(new THREE.TorusGeometry(2.45, 0.065, 5, 14, Math.PI * 0.48), timber);
            rib.position.set(x, 2.25, z);
            rib.rotation.y = x < 0 ? Math.PI / 2 : -Math.PI / 2;
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
  private createFloorStory(design: RoomDesign): void {
    const path = new THREE.Mesh(
      new THREE.PlaneGeometry(2.35, 10.5),
      new THREE.MeshStandardMaterial({ color: design.path, roughness: 0.92 }),
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

  /**
   * The production story seen from the entrance. These are intentionally larger and
   * more literal than the upgrade stations: a Mercedonian should know whether this is
   * a water plant, cinema or timber hall before reading any interface copy.
   */
  private createSignatureSystem(
    design: RoomDesign,
    cream: THREE.MeshStandardMaterial,
    timber: THREE.MeshStandardMaterial,
    teal: THREE.MeshStandardMaterial,
    accent: THREE.MeshStandardMaterial,
    glass: THREE.MeshPhysicalMaterial,
  ): void {
    const root = new THREE.Group();
    root.name = `interior-signature-${design.architecture}`;
    this.content.add(root);
    const dark = this.propMaterial(0x29494a, 0.66, 0.18);
    const metal = this.propMaterial(0x7f9191, 0.46, 0.42);
    const copper = this.propMaterial(0xa76e42, 0.48, 0.34);
    const green = this.propMaterial(0x5d913f, 0.82);
    const soil = this.propMaterial(0x5f4931, 0.9);
    const gold = this.propMaterial(0xe1b64c, 0.46, 0.24);
    const rust = this.propMaterial(0xb56849, 0.68, 0.1);
    const glow = new THREE.MeshStandardMaterial({
      color: design.accent,
      emissive: design.accent,
      emissiveIntensity: 0.85,
      roughness: 0.38,
      transparent: true,
      opacity: 0.9,
    });
    const box = (
      size: readonly [number, number, number],
      at: readonly [number, number, number],
      material: THREE.Material,
    ): THREE.Mesh => this.addBox(root, size, at, material);
    const cylinder = (
      radius: number,
      height: number,
      at: readonly [number, number, number],
      material: THREE.Material,
      segments = 10,
    ): THREE.Mesh => {
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, segments), material);
      mesh.position.set(...at);
      mesh.castShadow = this.renderer.shadowMap.enabled;
      mesh.receiveShadow = true;
      root.add(mesh);
      return mesh;
    };
    const cone = (
      top: number,
      bottom: number,
      height: number,
      at: readonly [number, number, number],
      material: THREE.Material,
    ): THREE.Mesh => {
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(top, bottom, height, 10), material);
      mesh.position.set(...at);
      mesh.castShadow = this.renderer.shadowMap.enabled;
      root.add(mesh);
      return mesh;
    };
    const torus = (
      radius: number,
      tube: number,
      at: readonly [number, number, number],
      material: THREE.Material,
      arc = Math.PI * 2,
    ): THREE.Mesh => {
      const mesh = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 7, 22, arc), material);
      mesh.position.set(...at);
      mesh.castShadow = this.renderer.shadowMap.enabled;
      root.add(mesh);
      return mesh;
    };
    const sphere = (
      radius: number,
      at: readonly [number, number, number],
      material: THREE.Material,
    ): THREE.Mesh => {
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 9, 6), material);
      mesh.position.set(...at);
      mesh.castShadow = this.renderer.shadowMap.enabled;
      root.add(mesh);
      return mesh;
    };
    const animate = (object: THREE.Object3D, motion: "spin-x" | "spin-y" | "spin-z" | "pulse" | "float", speed = 1): void => {
      this.ambientObjects.push({ object, motion, speed, originY: object.position.y });
    };
    const plantTuft = (x: number, y: number, z: number, scale = 1): void => {
      cylinder(0.045 * scale, 0.42 * scale, [x, y + 0.2 * scale, z], green, 6);
      for (const offset of [-0.15, 0, 0.15]) {
        const leaf = sphere(0.17 * scale, [x + offset * scale, y + 0.46 * scale + Math.abs(offset) * 0.25, z], green);
        leaf.scale.set(0.65, 1.25, 0.55);
      }
    };

    switch (design.architecture) {
      case "living-water-gallery": {
        for (const [x, radius, height] of [[-4.15, 0.68, 2.45], [-2.75, 0.48, 1.75]] as Array<[number, number, number]>) {
          cylinder(radius, height, [x, height / 2 + 0.15, -5.25], glass, 12);
          cylinder(radius * 1.07, 0.13, [x, 0.16, -5.25], copper, 12);
          cylinder(radius * 1.07, 0.13, [x, height + 0.14, -5.25], copper, 12);
        }
        const pipe = torus(1.15, 0.09, [-3.45, 2.45, -5.05], copper, Math.PI);
        animate(pipe, "pulse", 1.2);
        box([3.15, 0.1, 0.24], [3.8, 0.28, -5.25], teal);
        for (const x of [2.65, 3.25, 3.85, 4.45, 5.05]) plantTuft(x, 0.3, -5.2, 0.72);
        for (const z of [-3.4, -1.6, 0.2, 2.0]) {
          const flow = box([0.33, 0.035, 0.55], [0, 0.07, z], glow);
          animate(flow, "pulse", 0.65 + z * 0.04);
        }
        break;
      }
      case "heliostat-atrium": {
        for (let row = 0; row < 2; row += 1) for (let column = 0; column < 4; column += 1) {
          const x = 2.6 + column * 0.82;
          box([0.68, 0.58, 0.42], [x, 0.46 + row * 0.68, -5.3], row % 2 ? accent : teal);
          box([0.48, 0.05, 0.44], [x, 0.78 + row * 0.68, -5.28], gold);
        }
        cylinder(0.13, 2.65, [-4.1, 1.45, -5.15], metal, 10);
        const rotor = new THREE.Group();
        rotor.position.set(-4.1, 2.55, -5.15);
        root.add(rotor);
        for (let i = 0; i < 3; i += 1) {
          const blade = this.addBox(rotor, [1.65, 0.1, 0.28], [0.65, 0, 0], accent);
          blade.rotation.y = (i / 3) * Math.PI * 2;
        }
        sphere(0.24, [-4.1, 2.55, -5.15], gold);
        animate(rotor, "spin-y", 0.72);
        break;
      }
      case "canopy-biome": {
        box([4.2, 0.44, 0.82], [-3.9, 0.23, -5.22], timber);
        box([4.0, 0.12, 0.67], [-3.9, 0.5, -5.2], soil);
        for (const x of [-5.45, -4.7, -3.95, -3.2, -2.45]) plantTuft(x, 0.52, -5.18, 0.82);
        cylinder(0.7, 2.35, [4.65, 1.2, -5.2], glass, 12);
        cylinder(0.76, 0.11, [4.65, 0.1, -5.2], teal, 12);
        cylinder(0.76, 0.11, [4.65, 2.35, -5.2], teal, 12);
        box([7.7, 0.1, 0.12], [0, 2.65, -5.03], metal);
        const pollinator = box([0.6, 0.28, 0.38], [-1.5, 2.45, -4.98], accent);
        animate(pollinator, "float", 0.8);
        break;
      }
      case "reclaimed-strata-vault": {
        for (const [x, radius, color] of [[-5.0, 0.66, 0x756b64], [-4.15, 0.52, 0x8c7967], [-3.4, 0.45, 0x625e5c]] as Array<[number, number, number]>) {
          const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(radius, 0), this.propMaterial(color));
          rock.position.set(x, radius, -5.15);
          root.add(rock);
        }
        for (const [x, height] of [[-5.1, 1.0], [-4.35, 1.35], [-3.55, 0.8]] as Array<[number, number]>) {
          const crystal = cone(0, 0.22, height, [x, height / 2 + 0.45, -4.92], glow);
          crystal.rotation.z = (x + 4.2) * 0.18;
        }
        box([2.4, 0.38, 0.75], [3.85, 0.42, -5.15], dark);
        const drill = cylinder(0.28, 2.15, [3.85, 1.35, -4.95], metal, 10);
        drill.rotation.z = Math.PI / 2;
        const drillTip = cone(0, 0.36, 0.9, [2.45, 1.35, -4.95], accent);
        drillTip.rotation.z = Math.PI / 2;
        animate(drill, "spin-x", 1.45);
        break;
      }
      case "regrowth-timber-hall": {
        box([3.15, 2.25, 0.78], [3.95, 1.15, -5.2], dark);
        const kilnPanel = box([2.75, 0.11, 0.92], [3.95, 2.36, -5.05], teal);
        kilnPanel.rotation.x = 0.18;
        const saw = torus(1.0, 0.16, [-4.0, 1.55, -5.02], metal);
        for (let i = 0; i < 8; i += 1) {
          const tooth = box([0.24, 0.42, 0.16], [-4.0 + Math.cos(i * Math.PI / 4) * 1.12, 1.55 + Math.sin(i * Math.PI / 4) * 1.12, -5.02], metal);
          tooth.rotation.z = i * Math.PI / 4;
        }
        cylinder(0.2, 0.5, [-4.0, 1.55, -5.02], copper, 10).rotation.x = Math.PI / 2;
        animate(saw, "spin-z", 0.55);
        for (const x of [-1.9, -1.3, 1.3, 1.9]) plantTuft(x, 0.05, -5.18, 0.62);
        break;
      }
      case "circular-packhouse": {
        for (const size of [2.7, 2.05, 1.4]) {
          const frame = new THREE.Group();
          frame.position.set(-3.85, size / 2 + 0.2, -5.12 + size * 0.015);
          root.add(frame);
          this.addBox(frame, [size, 0.13, 0.15], [0, size / 2, 0], timber);
          this.addBox(frame, [size, 0.13, 0.15], [0, -size / 2, 0], timber);
          this.addBox(frame, [0.13, size, 0.15], [-size / 2, 0, 0], timber);
          this.addBox(frame, [0.13, size, 0.15], [size / 2, 0, 0], timber);
        }
        box([3.4, 0.35, 0.82], [3.8, 0.48, -5.15], dark);
        for (const x of [2.45, 3.1, 3.75, 4.4, 5.05]) {
          const roller = cylinder(0.14, 0.7, [x, 0.77, -5.02], metal, 8);
          roller.rotation.x = Math.PI / 2;
          animate(roller, "spin-x", 1.25);
        }
        box([0.85, 0.7, 0.6], [3.75, 1.3, -5.12], accent);
        break;
      }
      case "sawtooth-atelier": {
        const gear = new THREE.Group();
        gear.position.set(-4.15, 1.75, -5.05);
        root.add(gear);
        const gearRing = new THREE.Mesh(new THREE.TorusGeometry(1.05, 0.18, 8, 22), accent);
        gear.add(gearRing);
        for (let i = 0; i < 10; i += 1) {
          const tooth = this.addBox(gear, [0.24, 0.44, 0.18], [Math.cos(i * Math.PI / 5) * 1.23, Math.sin(i * Math.PI / 5) * 1.23, 0], accent);
          tooth.rotation.z = i * Math.PI / 5;
        }
        const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.28, 10), copper);
        hub.rotation.x = Math.PI / 2;
        gear.add(hub);
        animate(gear, "spin-z", 0.34);
        box([5.2, 0.14, 0.18], [3.5, 2.65, -5.0], metal);
        for (const x of [1.25, 2.75, 4.25, 5.75]) {
          box([0.09, 1.2, 0.09], [x, 2.08, -5.0], metal);
          box([0.46, 0.18, 0.3], [x, 1.45, -5.0], x % 2 ? accent : gold);
        }
        break;
      }
      case "clean-forge-hall": {
        for (const x of [-5.1, 5.1]) box([0.24, 2.75, 0.24], [x, 1.42, -5.05], metal);
        box([10.5, 0.25, 0.28], [0, 2.75, -5.05], metal);
        box([3.2, 0.32, 0.82], [-3.55, 0.38, -5.15], dark);
        box([3.2, 0.32, 0.82], [3.55, 0.38, -5.15], dark);
        for (const x of [-4.65, -3.9, -3.15, -2.4, 2.4, 3.15, 3.9, 4.65]) {
          const roller = cylinder(0.13, 0.7, [x, 0.66, -5.02], metal, 8);
          roller.rotation.x = Math.PI / 2;
          animate(roller, "spin-x", 1.05);
        }
        for (const x of [-3.75, 3.75]) {
          const arm = new THREE.Group();
          arm.position.set(x, 0.55, -4.92);
          root.add(arm);
          const shoulder = new THREE.Mesh(new THREE.SphereGeometry(0.32, 9, 6), accent);
          arm.add(shoulder);
          const upper = this.addBox(arm, [0.28, 1.25, 0.28], [0, 0.72, 0], accent);
          upper.rotation.z = x < 0 ? -0.42 : 0.42;
          sphere(0.25, [x + (x < 0 ? 0.48 : -0.48), 1.66, -4.92], gold);
          animate(arm, "pulse", 0.55);
        }
        break;
      }
      case "civic-prefab-studio": {
        box([3.2, 0.16, 1.5], [-3.95, 0.12, -5.05], timber);
        box([3.2, 2.15, 0.16], [-3.95, 1.24, -5.62], cream);
        box([0.16, 2.15, 1.5], [-5.48, 1.24, -5.05], accent);
        box([0.16, 2.15, 1.5], [-2.42, 1.24, -5.05], teal);
        for (const x of [2.3, 5.3]) box([0.2, 2.55, 0.2], [x, 1.3, -5.1], metal);
        box([3.2, 0.22, 0.25], [3.8, 2.52, -5.1], accent);
        const hookLine = box([0.05, 1.4, 0.05], [3.8, 1.78, -5.0], dark);
        const hook = torus(0.25, 0.07, [3.8, 1.0, -5.0], gold, Math.PI * 1.35);
        hook.rotation.z = -0.35;
        animate(hookLine, "float", 0.5);
        break;
      }
      case "solar-quay-depot": {
        box([4.15, 2.05, 0.82], [-3.65, 1.08, -5.18], rust);
        for (const x of [-5.25, -4.25, -3.25, -2.25]) box([0.09, 1.78, 0.86], [x, 1.08, -5.15], copper);
        box([2.9, 0.18, 0.95], [4.0, 0.32, -5.1], dark);
        box([1.25, 0.85, 0.72], [4.0, 0.82, -5.0], cream);
        for (const x of [3.25, 4.75]) {
          const wheel = cylinder(0.28, 0.16, [x, 0.26, -4.95], dark, 10);
          wheel.rotation.x = Math.PI / 2;
        }
        box([2.7, 0.75, 0.1], [0, 3.05, -5.55], teal);
        for (const [x, y] of [[-0.75, 2.95], [0.1, 3.2], [0.95, 3.02]] as Array<[number, number]>) sphere(0.13, [x, y, -5.43], glow);
        break;
      }
      case "lantern-market-pavilion": {
        box([5.4, 0.82, 1.0], [-3.35, 0.5, -5.08], timber);
        box([5.2, 0.16, 1.03], [-3.35, 0.98, -5.06], cream);
        const produce = [0xd95f4d, 0xe2b94d, 0x6ea84d, 0x9b5baa];
        for (let i = 0; i < 14; i += 1) sphere(0.16, [-5.45 + (i % 7) * 0.7, 1.16 + Math.floor(i / 7) * 0.29, -4.85], this.propMaterial(produce[i % produce.length]!));
        box([2.0, 1.8, 0.42], [4.5, 1.0, -5.3], teal);
        for (const y of [0.55, 1.15, 1.75]) box([1.75, 0.09, 0.48], [4.5, y, -5.08], timber);
        for (const x of [2.55, 3.45, 4.35, 5.25, 6.15]) {
          const lantern = sphere(0.18, [x, 2.72 + (Math.round(x) % 2) * 0.18, -5.0], glow);
          lantern.scale.y = 1.35;
          animate(lantern, "float", 0.55 + x * 0.03);
        }
        break;
      }
      case "edible-garden-kitchen": {
        cylinder(1.05, 1.25, [-3.9, 0.72, -5.05], cream, 12);
        const ovenMouth = torus(0.62, 0.16, [-3.9, 1.0, -4.35], copper, Math.PI);
        ovenMouth.rotation.x = Math.PI / 2;
        const hood = cone(0.35, 1.05, 1.25, [-3.9, 1.95, -5.05], accent);
        hood.rotation.z = Math.PI;
        const ember = sphere(0.42, [-3.9, 0.82, -4.34], glow);
        animate(ember, "pulse", 1.35);
        box([4.1, 0.42, 0.82], [3.75, 0.26, -5.15], timber);
        box([3.9, 0.1, 0.68], [3.75, 0.52, -5.12], soil);
        for (const x of [2.2, 2.85, 3.5, 4.15, 4.8, 5.45]) plantTuft(x, 0.53, -5.1, 0.58);
        for (const y of [0.75, 1.2, 1.65, 2.1]) sphere(0.09, [6.2, y, -5.0], glass);
        break;
      }
      case "kinetic-wellness-grove": {
        const wheel = new THREE.Group();
        wheel.position.set(-4.25, 1.65, -5.0);
        root.add(wheel);
        wheel.add(new THREE.Mesh(new THREE.TorusGeometry(1.25, 0.15, 8, 24), accent));
        for (let i = 0; i < 8; i += 1) {
          const spoke = this.addBox(wheel, [2.25, 0.07, 0.1], [0, 0, 0], metal);
          spoke.rotation.z = i * Math.PI / 4;
        }
        animate(wheel, "spin-z", 0.46);
        box([3.65, 2.45, 0.28], [3.95, 1.3, -5.55], timber);
        for (const [x, y] of [[2.6, 0.7], [3.2, 1.4], [3.9, 0.9], [4.6, 1.7], [5.3, 1.05]] as Array<[number, number]>) sphere(0.17, [x, y, -5.32], x % 2 ? accent : gold);
        box([4.5, 0.12, 0.48], [0.4, 0.16, -5.0], glass);
        for (const x of [-1.2, -0.4, 0.4, 1.2, 2.0]) plantTuft(x, 0.2, -5.05, 0.5);
        break;
      }
      case "lantern-theatre": {
        const screenMaterial = new THREE.MeshStandardMaterial({ color: 0xe9e2cf, emissive: design.accent, emissiveIntensity: 0.34, roughness: 0.7 });
        box([5.0, 2.55, 0.12], [-3.85, 1.55, -5.52], screenMaterial);
        box([5.35, 0.16, 0.18], [-3.85, 0.22, -5.45], gold);
        box([2.1, 1.15, 0.72], [4.25, 1.15, -5.0], dark);
        for (const x of [3.7, 4.8]) {
          const reel = torus(0.44, 0.09, [x, 1.72, -4.62], metal);
          for (let i = 0; i < 5; i += 1) sphere(0.08, [x + Math.cos(i * Math.PI * 0.4) * 0.25, 1.72 + Math.sin(i * Math.PI * 0.4) * 0.25, -4.56], dark);
          animate(reel, "spin-z", x < 4 ? 0.45 : -0.38);
        }
        const lens = cylinder(0.25, 0.68, [4.25, 1.08, -4.42], glow, 10);
        lens.rotation.x = Math.PI / 2;
        for (const x of [-6.4, -5.45, 5.45, 6.4]) {
          const lantern = sphere(0.2, [x, 3.55, -5.18], glow);
          lantern.scale.y = 1.45;
          animate(lantern, "float", 0.6);
        }
        break;
      }
      case "materials-loop-lab": {
        const loop = torus(1.35, 0.18, [-3.95, 1.7, -5.02], accent);
        animate(loop, "spin-z", 0.26);
        const hopper = cone(0.45, 1.05, 1.25, [3.85, 2.05, -5.05], metal);
        hopper.rotation.z = Math.PI;
        box([0.4, 0.95, 0.4], [3.85, 1.0, -5.05], dark);
        box([4.2, 0.35, 0.72], [3.85, 0.42, -5.12], teal);
        const bayColours = [0x4d92ad, 0x78a953, 0xd29a43];
        for (let i = 0; i < 3; i += 1) box([1.05, 0.82, 0.75], [2.45 + i * 1.4, 0.87, -5.08], this.propMaterial(bayColours[i]!));
        for (const [x, color] of [[-5.2, 0x6b91a0], [-4.2, 0x8ea55d], [-3.25, 0xbb7650]] as Array<[number, number]>) {
          box([0.72, 0.72, 0.48], [x, 0.52, -5.02], this.propMaterial(color));
          box([0.68, 0.05, 0.5], [x, 0.52, -4.74], dark);
        }
        break;
      }
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
    const sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: signTexture, transparent: true, depthWrite: false }));
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
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
    label.scale.set(3.0, 0.84, 1);
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
    teal: THREE.MeshStandardMaterial,
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

    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.16, 1.3, 0.32, 12), teal);
    base.position.y = 0.16;
    base.receiveShadow = true;
    base.castShadow = true;
    root.add(base);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.1, 0.18, 12), activeMaterial);
    top.position.y = 0.4;
    top.castShadow = true;
    root.add(top);

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

    const halo = new THREE.Mesh(
      new THREE.RingGeometry(1.25, 1.48, 32),
      new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }),
    );
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = 0.025;
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
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture, transparent: true, depthWrite: false }));
    label.scale.set(3.25, 0.92, 1);
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

    if (key === "yield") this.createQualityMachine(modules[0], primary, dark, cream);
    else if (key === "capacity") this.createCapacityMachine(modules[0], primary, dark, timber);
    else if (key === "speed") this.createFlowMachine(modules[0], primary, dark, cream);
    else this.createAppealMachine(modules[0], primary, dark, timber);

    this.createMotifModule(design.motif, modules[1], primary, secondary, dark, timber);
    this.createAdvancedModule(key, modules[2], primary, secondary, dark);
    this.createMasterModule(design, modules[3], primary, secondary);
    return modules;
  }

  private createBlueprint(key: UpgradeKey, design: InteriorEquipmentDesign, color: THREE.Color): THREE.Group {
    const root = new THREE.Group();
    root.name = `${design.form}-purchase-blueprint`;
    const material = new THREE.MeshBasicMaterial({
      color,
      wireframe: true,
      transparent: true,
      opacity: 0.38,
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
      for (const [x, height] of [[-0.55, 0.9], [0, 1.35], [0.55, 0.72]] as Array<[number, number]>) {
        const crystal = new THREE.Mesh(new THREE.ConeGeometry(0.28, height, 5), x === 0 ? secondary : primary);
        crystal.position.set(x, 0.64 + height / 2, 0.1);
        root.add(crystal);
      }
    } else if (motif === "forestry") {
      for (const z of [-0.34, 0.34]) {
        const log = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 1.55, 10), timber);
        log.rotation.z = Math.PI / 2;
        log.position.set(0, 1.15, z);
        root.add(log);
      }
      const saw = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.08, 18), secondary);
      saw.rotation.x = Math.PI / 2;
      saw.position.set(0, 1.78, -0.05);
      root.add(saw);
    } else if (motif === "packaging") {
      for (const [x, y, scale] of [[-0.46, 1.05, 0.66], [0.38, 1.05, 0.8], [0, 1.72, 0.6]] as Array<[number, number, number]>) {
        const crate = this.addBox(root, [scale, scale, scale], [x, y, 0], timber);
        const band = this.addBox(crate, [scale * 1.05, 0.08, scale * 1.06], [0, 0, 0], secondary);
        band.position.y = scale * 0.16;
      }
    } else if (motif === "maker") {
      for (const [x, size] of [[-0.44, 0.52], [0.42, 0.38]] as Array<[number, number]>) {
        const gear = new THREE.Mesh(new THREE.TorusGeometry(size, 0.11, 8, 14), x < 0 ? primary : secondary);
        gear.name = "equipment-rotor";
        gear.position.set(x, 1.55 + size * 0.35, 0);
        root.add(gear);
      }
    } else if (motif === "industrial") {
      for (const x of [-0.52, 0.52]) {
        const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.28, 1.45, 10), x < 0 ? primary : secondary);
        stack.position.set(x, 1.55, 0);
        root.add(stack);
      }
      this.addBox(root, [1.65, 0.18, 0.8], [0, 2.23, 0], dark);
    } else if (motif === "construction") {
      for (const x of [-0.72, 0.72]) this.addBox(root, [0.15, 1.8, 0.15], [x, 1.45, 0], secondary);
      this.addBox(root, [1.65, 0.16, 0.18], [0, 2.34, 0], primary);
      const hook = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.055, 7, 14, Math.PI * 1.5), dark);
      hook.position.set(0.35, 1.75, 0);
      root.add(hook);
    } else if (motif === "logistics") {
      for (const x of [-0.58, 0, 0.58]) {
        const parcel = this.addBox(root, [0.48, 0.48 + Math.abs(x) * 0.25, 0.7], [x, 1.05, 0], x === 0 ? secondary : timber);
        parcel.rotation.y = x * 0.18;
      }
      this.addBox(root, [1.85, 0.12, 0.18], [0, 1.65, -0.2], primary);
    } else if (motif === "retail") {
      this.addBox(root, [1.72, 1.45, 0.16], [0, 1.45, 0.2], timber);
      for (const y of [0.92, 1.45, 1.98]) this.addBox(root, [1.55, 0.1, 0.6], [0, y, 0], primary);
      for (const x of [-0.55, 0, 0.55]) {
        const good = new THREE.Mesh(new THREE.SphereGeometry(0.15, 9, 6), secondary);
        good.position.set(x, 1.66, -0.1);
        root.add(good);
      }
    } else if (motif === "culinary") {
      const range = new THREE.Mesh(new THREE.CylinderGeometry(0.58, 0.68, 0.8, 14), dark);
      range.position.y = 1.04;
      root.add(range);
      const lid = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 7, 0, Math.PI * 2, 0, Math.PI / 2), secondary);
      lid.position.y = 1.48;
      root.add(lid);
      const hood = new THREE.Mesh(new THREE.ConeGeometry(0.72, 0.72, 4, 1, true), primary);
      hood.rotation.y = Math.PI / 4;
      hood.position.y = 2.18;
      root.add(hood);
    } else if (motif === "fitness") {
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.75, 8), dark);
      bar.rotation.z = Math.PI / 2;
      bar.position.y = 1.5;
      root.add(bar);
      for (const x of [-0.72, 0.72]) {
        const weight = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.18, 12), x < 0 ? primary : secondary);
        weight.rotation.z = Math.PI / 2;
        weight.position.set(x, 1.5, 0);
        root.add(weight);
      }
    } else if (motif === "cinematic") {
      const projector = this.addBox(root, [1.1, 0.65, 0.85], [0, 1.25, 0], dark);
      projector.rotation.y = 0.08;
      for (const x of [-0.34, 0.34]) {
        const reel = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.08, 7, 16), x < 0 ? primary : secondary);
        reel.name = "equipment-rotor";
        reel.position.set(x, 1.9, 0);
        root.add(reel);
      }
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

  private createAdvancedModule(
    key: UpgradeKey,
    root: THREE.Group,
    primary: THREE.MeshStandardMaterial,
    secondary: THREE.MeshStandardMaterial,
    dark: THREE.MeshStandardMaterial,
  ): void {
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
  ): void {
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
   * Stand this trade's floor kit around the walls.
   *
   * Each piece is a handful of boxes in the room's own palette — enough to say
   * "this is a mine" from the door without competing with the four upgrade stations,
   * which are what the player is actually here to read. Every piece is registered as
   * an obstacle, so the kit is as solid indoors as the buildings are outdoors.
   */
  private dressRoom(design: RoomDesign): void {
    design.props.forEach((kind, index) => {
      const slot = PROP_SLOTS[index];
      if (!slot) return;
      const [x, z, facing] = slot;
      const root = new THREE.Group();
      root.name = `interior-prop-${kind}-${index}`;
      root.position.set(x, 0, z);
      root.rotation.y = facing;
      this.content.add(root);
      const radius = this.buildProp(root, kind, design);
      this.obstacles.push({ x, z, radius });
    });
  }

  /** A flat colour, shared between every piece of kit that asks for the same one. */
  private propMaterial(colour: number, rough = 0.82, metal = 0): THREE.MeshStandardMaterial {
    const key = `${colour}:${rough}:${metal}`;
    const existing = this.propMaterials.get(key);
    if (existing) return existing;
    const material = new THREE.MeshStandardMaterial({ color: colour, roughness: rough, metalness: metal });
    this.propMaterials.set(key, material);
    return material;
  }

  /** Build one piece of floor kit into `root`, and report the radius it occupies. */
  private buildProp(root: THREE.Group, kind: PropKind, design: RoomDesign): number {
    const box = (
      size: readonly [number, number, number],
      at: readonly [number, number, number],
      colour: number,
      rough = 0.82,
      metal = 0,
    ): THREE.Mesh => this.addBox(root, size, at, this.propMaterial(colour, rough, metal));
    const cyl = (r: number, h: number, at: readonly [number, number, number], colour: number, seg = 8): THREE.Mesh => {
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), this.propMaterial(colour));
      mesh.position.set(at[0], at[1], at[2]);
      mesh.castShadow = this.renderer.shadowMap.enabled;
      mesh.receiveShadow = true;
      root.add(mesh);
      return mesh;
    };
    const TIMBER = 0x8a6540;
    const STEEL = 0x76858a;
    const DARK = 0x3c4a4d;

    switch (kind) {
      case "tanks": {
        for (const [dx, r, h] of [[-0.5, 0.34, 1.5], [0.45, 0.26, 1.1]] as Array<[number, number, number]>) {
          cyl(r, h, [dx, h / 2, 0], design.glass, 10);
          cyl(r * 1.1, 0.09, [dx, h, 0], STEEL, 10);
          cyl(r * 1.1, 0.09, [dx, 0.05, 0], STEEL, 10);
        }
        box([1.5, 0.09, 0.09], [0, 1.18, 0.2], STEEL, 0.5, 0.4);
        return 1.0;
      }
      case "solar": {
        for (const dx of [-0.42, 0.42]) {
          box([0.09, 0.86, 0.09], [dx, 0.43, 0], STEEL, 0.5, 0.4);
        }
        const panel = box([1.42, 0.07, 0.82], [0, 0.94, 0.06], 0x27506b, 0.34, 0.25);
        panel.rotation.x = -0.42;
        box([1.46, 0.06, 0.1], [0, 0.68, 0.36], STEEL, 0.5, 0.4);
        return 0.95;
      }
      case "beds": {
        box([1.7, 0.36, 0.78], [0, 0.18, 0], TIMBER);
        box([1.58, 0.1, 0.66], [0, 0.4, 0], 0x5a4630);
        for (const dx of [-0.55, 0, 0.55]) {
          cyl(0.05, 0.42, [dx, 0.62, 0], 0x4f7a3c, 6);
          const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.2, 6, 4), this.propMaterial(0x6ea34c));
          leaf.position.set(dx, 0.88, 0);
          root.add(leaf);
        }
        return 1.0;
      }
      case "orecart": {
        box([1.12, 0.56, 0.72], [0, 0.44, 0], DARK, 0.7, 0.3);
        box([1.0, 0.12, 0.6], [0, 0.76, 0], 0x6b5a4a);
        for (const dx of [-0.38, 0.38]) for (const dz of [-0.3, 0.3]) {
          const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.08, 8), this.propMaterial(0x2b3336));
          wheel.rotation.z = Math.PI / 2;
          wheel.position.set(dx, 0.16, dz);
          root.add(wheel);
        }
        for (const [dx, r] of [[-0.24, 0.17], [0.16, 0.2], [0.4, 0.13]] as Array<[number, number]>) {
          const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0), this.propMaterial(0x8b8078));
          rock.position.set(dx, 0.86, 0);
          root.add(rock);
        }
        return 0.95;
      }
      case "logs": {
        for (const [row, count, y] of [[0, 4, 0.22], [1, 3, 0.6]] as Array<[number, number, number]>) {
          for (let i = 0; i < count; i += 1) {
            const log = cyl(0.19, 1.5, [(i - (count - 1) / 2) * 0.4 + row * 0.2, y, 0], TIMBER, 8);
            log.rotation.z = Math.PI / 2;
          }
        }
        box([0.1, 0.94, 0.1], [-0.92, 0.47, 0], STEEL, 0.5, 0.4);
        box([0.1, 0.94, 0.1], [0.92, 0.47, 0], STEEL, 0.5, 0.4);
        return 1.05;
      }
      case "crates": {
        const shades = [0xb9915f, 0xa8814f, 0xc7a370];
        let i = 0;
        for (const [dx, dy, dz, sz] of [
          [-0.4, 0.3, 0, 0.58], [0.35, 0.32, 0.05, 0.62], [-0.1, 0.86, 0, 0.5],
        ] as Array<[number, number, number, number]>) {
          const shade = shades[i % shades.length]!;
          box([sz, sz, sz], [dx, dy, dz], shade);
          box([sz * 1.02, 0.05, sz * 0.24], [dx, dy, dz], 0x6f5537);
          i += 1;
        }
        return 0.9;
      }
      case "toolwall": {
        box([1.7, 1.16, 0.11], [0, 1.15, -0.3], TIMBER);            // pegboard
        box([1.7, 0.1, 0.62], [0, 0.86, 0], 0x9a8a70, 0.8);          // bench top
        for (const dx of [-0.76, 0.76]) box([0.1, 0.86, 0.5], [dx, 0.43, 0], 0x6f5537);
        for (const [dx, w, h] of [[-0.55, 0.1, 0.42], [-0.2, 0.26, 0.1], [0.2, 0.09, 0.5], [0.6, 0.2, 0.2]] as Array<[number, number, number]>) {
          box([w, h, 0.06], [dx, 1.42, -0.22], 0x51636a, 0.5, 0.45);  // tools hung up
        }
        return 0.95;
      }
      case "conveyor": {
        box([1.9, 0.1, 0.66], [0, 0.72, 0], DARK, 0.62, 0.2);
        for (const dx of [-0.78, 0, 0.78]) box([0.11, 0.72, 0.11], [dx, 0.36, 0], STEEL, 0.5, 0.4);
        for (let i = -3; i <= 3; i += 1) {
          const roller = cyl(0.07, 0.6, [i * 0.26, 0.81, 0], STEEL, 6);
          roller.rotation.x = Math.PI / 2;
        }
        return 1.05;
      }
      case "scaffold": {
        for (const dx of [-0.7, 0.7]) for (const dz of [-0.3, 0.3]) box([0.09, 1.7, 0.09], [dx, 0.85, dz], STEEL, 0.5, 0.4);
        for (const y of [0.6, 1.16, 1.7]) box([1.5, 0.08, 0.08], [0, y, -0.3], STEEL, 0.5, 0.4);
        box([1.44, 0.08, 0.62], [0, 1.2, 0], TIMBER);
        box([1.2, 0.5, 0.1], [0, 0.32, 0.28], 0xc4b48a);
        return 0.95;
      }
      case "pallets": {
        for (const [dy, count] of [[0.08, 1], [0.24, 1], [0.4, 1]] as Array<[number, number]>) {
          void count;
          box([1.5, 0.09, 0.86], [0, dy, 0], TIMBER);
        }
        box([1.1, 0.62, 0.72], [0, 0.79, 0], 0xb08a58);
        box([1.12, 0.05, 0.2], [0, 0.79, 0], 0x6f5537);
        return 0.95;
      }
      case "shelves": {
        box([1.8, 0.09, 0.5], [0, 0.42, -0.16], TIMBER);
        box([1.8, 0.09, 0.5], [0, 0.94, -0.16], TIMBER);
        box([1.8, 0.09, 0.5], [0, 1.46, -0.16], TIMBER);
        for (const dx of [-0.86, 0.86]) box([0.1, 1.6, 0.5], [dx, 0.8, -0.16], 0x6f5537);
        const goods = [0xd9a441, 0x7fae5c, 0xc9663f, 0x69a9b0];
        let g = 0;
        for (const y of [0.58, 1.1, 1.62]) for (const dx of [-0.5, 0, 0.5]) {
          box([0.26, 0.24, 0.26], [dx, y, -0.16], goods[g % goods.length]!);
          g += 1;
        }
        return 1.0;
      }
      case "diner": {
        cyl(0.42, 0.06, [0, 0.74, 0], TIMBER, 10);
        cyl(0.09, 0.74, [0, 0.37, 0], STEEL, 8);
        cyl(0.3, 0.05, [0, 0.03, 0], STEEL, 10);
        for (const [dx, dz] of [[-0.66, 0], [0.66, 0]] as Array<[number, number]>) {
          box([0.36, 0.07, 0.36], [dx, 0.44, dz], 0x9a6a44);
          box([0.36, 0.44, 0.07], [dx + (dx < 0 ? -0.14 : 0.14), 0.66, dz], 0x9a6a44);
          for (const lx of [-0.13, 0.13]) for (const lz of [-0.13, 0.13]) {
            box([0.05, 0.44, 0.05], [dx + lx, 0.22, dz + lz], 0x6f4a2e);
          }
        }
        return 1.0;
      }
      case "weights": {
        box([1.8, 0.12, 0.5], [0, 0.28, 0], DARK, 0.6, 0.3);
        box([1.8, 0.12, 0.5], [0, 0.74, 0], DARK, 0.6, 0.3);
        for (const dx of [-0.86, 0.86]) box([0.11, 0.92, 0.5], [dx, 0.46, 0], STEEL, 0.5, 0.4);
        for (const [dx, r] of [[-0.5, 0.17], [-0.1, 0.15], [0.3, 0.13], [0.62, 0.11]] as Array<[number, number]>) {
          const plate = cyl(r, 0.1, [dx, 0.92, 0], 0x2f3a3d, 10);
          plate.rotation.z = Math.PI / 2;
        }
        for (const [dx, r] of [[-0.45, 0.19], [0.05, 0.16], [0.45, 0.14]] as Array<[number, number]>) {
          const plate = cyl(r, 0.1, [dx, 0.46, 0], 0x44525a, 10);
          plate.rotation.z = Math.PI / 2;
        }
        return 1.0;
      }
      case "seats": {
        for (const row of [0, 1]) {
          const dz = row * 0.62;
          for (const dx of [-0.62, 0, 0.62]) {
            box([0.5, 0.1, 0.44], [dx, 0.44, dz], 0x6d3f4a);
            box([0.5, 0.52, 0.09], [dx, 0.7, dz - 0.2], 0x7c4855);
            box([0.09, 0.44, 0.44], [dx - 0.28, 0.22, dz], 0x4a2c34);
            box([0.09, 0.44, 0.44], [dx + 0.28, 0.22, dz], 0x4a2c34);
          }
        }
        return 1.15;
      }
      case "bins": {
        const colours = [0x4f8b5c, 0x3f7794, 0xb5883c];
        colours.forEach((colour, i) => {
          const dx = (i - 1) * 0.62;
          box([0.54, 0.86, 0.54], [dx, 0.43, 0], colour);
          box([0.6, 0.08, 0.6], [dx, 0.9, 0], 0x3a4a3f);
          box([0.3, 0.04, 0.3], [dx, 0.95, 0], 0x2c3a30);
        });
        return 1.0;
      }
    }
  }

  private createPlant(x: number, z: number, scale: number, accent: THREE.Color): void {
    const root = new THREE.Group();
    root.position.set(x, 0, z);
    root.scale.setScalar(scale);
    this.content.add(root);
    const pot = new THREE.Mesh(
      new THREE.CylinderGeometry(0.48, 0.36, 0.64, 10),
      new THREE.MeshStandardMaterial({ color: 0xb7734b, roughness: 0.88 }),
    );
    pot.position.y = 0.32;
    pot.castShadow = true;
    root.add(pot);
    const stemMaterial = new THREE.MeshStandardMaterial({ color: 0x456d39, roughness: 0.84 });
    for (let index = 0; index < 7; index += 1) {
      const angle = (index / 7) * Math.PI * 2;
      const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.34, 10, 7), stemMaterial);
      leaf.scale.set(0.58, 1.35, 0.42);
      leaf.rotation.z = angle;
      leaf.position.set(Math.cos(angle) * 0.28, 0.93 + (index % 2) * 0.18, Math.sin(angle) * 0.24);
      root.add(leaf);
    }
    const bloom = new THREE.Mesh(
      new THREE.SphereGeometry(0.13, 9, 6),
      new THREE.MeshStandardMaterial({ color: accent.clone().lerp(new THREE.Color(0xffd45e), 0.5), roughness: 0.6 }),
    );
    bloom.position.y = 1.38;
    root.add(bloom);
  }

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
      station.halo.material.opacity = highlighted ? (selection?.nearby ? 0.72 : 0.48) : 0.18;
      station.halo.scale.setScalar(highlighted ? 1.08 : 1);
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
    context.clearRect(0, 0, width, height);
    context.shadowColor = "rgba(5, 31, 34, .42)";
    context.shadowBlur = Math.round(height * 0.06);
    context.shadowOffsetY = Math.round(height * 0.035);
    this.roundedRect(context, 18, 18, width - 36, height - 36, height * 0.18);
    context.fillStyle = "#123e42";
    context.fill();
    context.shadowColor = "transparent";
    context.lineWidth = Math.max(6, height * 0.045);
    context.strokeStyle = accent;
    context.stroke();
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
