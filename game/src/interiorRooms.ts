/**
 * What each trade's room and machines LOOK like — data, not geometry.
 *
 * The interior was rebuilt from scratch to the owner's specification. The file this replaces
 * carried roughly five thousand lines of hand-written meshes: four machines for each of
 * fifteen trades, at five upgrade levels each, every one authored by hand. It could not be
 * reasoned about, the trades drifted apart in quality, and a change to "how a machine looks"
 * meant editing three hundred call sites.
 *
 * Here a machine is a RECIPE — a base form, a palette, and up to four modules that appear as
 * it is upgraded. `interiorWorld.ts` builds the geometry from that. Fifteen trades stay
 * genuinely distinct because their forms and palettes differ, not because someone typed
 * fifteen hundred coordinates.
 */

import type { LicenseKey, UpgradeKey } from "./data";

/** The silhouette family a machine is built from. */
export type MachineForm =
  | "tank"        // vertical cylinders: water, brewing, storage
  | "press"       // a heavy frame with a descending head
  | "rack"        // open shelving, tall and light
  | "hearth"      // a squat drum with a lit mouth
  | "loom"        // a wide frame strung with lines
  | "array"       // tilted panels on posts
  | "conveyor"    // a low belt on rollers
  | "counter"     // a serving surface with a glass front
  | "cradle"      // a curved berth holding something
  | "column";     // a fluted stack, tallest of the set

/** How a machine grows: which modules light up at which level. */
export interface MachineModule {
  /** 1-4: the upgrade level at which this part appears. */
  at: number;
  /** Where it sits, relative to the machine's own centre, in tile units. */
  at3: readonly [number, number, number];
  size: readonly [number, number, number];
  /** "accent" reads as the trade's colour; "trim" is its timber; "glass" glows. */
  finish: "accent" | "trim" | "glass" | "dark";
  /** Optional quarter-turn, for parts that read better angled. */
  tilt?: number;
}

export interface MachineDesign {
  name: string;
  description: string;
  form: MachineForm;
  /** The machine's own colour, distinct from the room's. */
  secondary: number;
  modules: readonly MachineModule[];
}

export type InteriorArchitecture =
  | "living-water-gallery" | "heliostat-atrium" | "canopy-biome" | "reclaimed-strata-vault"
  | "regrowth-timber-hall" | "circular-packhouse" | "sawtooth-atelier" | "clean-forge-hall"
  | "civic-prefab-studio" | "solar-quay-depot" | "lantern-market-pavilion"
  | "edible-garden-kitchen" | "kinetic-wellness-grove" | "lantern-theatre"
  | "materials-loop-lab";

/** A wall treatment: the ONLY place a trade's character is allowed to live besides its floor. */
export type WallMotif =
  | "pipes"     // a run of pipe with valve wheels
  | "sunburst"  // a disc with collector panels
  | "trellis"   // a diagonal lattice
  | "seams"     // ore veins inlaid at angles
  | "planks"    // alternating vertical cladding
  | "crates"    // nested square outlines
  | "pegboard"  // a tool wall of pegs
  | "chevrons"  // a hazard band
  | "blueprint" // a drawing board with a plan on it
  | "chart"     // a route board with plotted points
  | "awning"    // scalloped shade over the glazing
  | "shelf"     // a plate shelf and a hearth arch
  | "rings"     // concentric rings
  | "marquee"   // a border of bulbs
  | "loop";     // a closed circle with chutes

export interface RoomDesign {
  displayName: string;
  description: string;
  regenerativeSystem: string;
  architecture: InteriorArchitecture;
  motif: WallMotif;
  /** Openings in the back wall: [centre in wall units -1..1, width in tiles]. */
  glazing: ReadonlyArray<readonly [number, number]>;
  accent: number;
  floor: number;
  path: number;
  wall: number;
  trim: number;
  glass: number;
  sky: number;
}

/** Four modules, appearing at levels 1-4, arranged around a machine's own footprint. */
function ladder(
  finishes: readonly ["accent" | "trim" | "glass" | "dark", "accent" | "trim" | "glass" | "dark",
                     "accent" | "trim" | "glass" | "dark", "accent" | "trim" | "glass" | "dark"],
  spread = 0.34,
): readonly MachineModule[] {
  return [
    { at: 1, at3: [-spread, 0.30, 0.10], size: [0.26, 0.30, 0.26], finish: finishes[0] },
    { at: 2, at3: [spread, 0.30, -0.10], size: [0.26, 0.30, 0.26], finish: finishes[1] },
    { at: 3, at3: [0, 0.78, 0], size: [0.52, 0.20, 0.42], finish: finishes[2] },
    { at: 4, at3: [0, 1.02, 0.16], size: [0.34, 0.26, 0.24], finish: finishes[3], tilt: 0.22 },
  ];
}

const M = (
  name: string, description: string, form: MachineForm, secondary: number,
  finishes: readonly ["accent" | "trim" | "glass" | "dark", "accent" | "trim" | "glass" | "dark",
                      "accent" | "trim" | "glass" | "dark", "accent" | "trim" | "glass" | "dark"],
): MachineDesign => ({ name, description, form, secondary, modules: ladder(finishes) });

/**
 * Fifteen trades, four machines each. The names carry the fiction; the forms carry the
 * silhouette; the palette carries the trade. Nothing here describes a coordinate.
 */
export const INTERIOR_EQUIPMENT_CATALOG:
  Record<LicenseKey, Record<UpgradeKey, MachineDesign>> = {
  aquaworks: {
    yield: M("Purity Helix", "Reed beds and pressure loops that make every litre visible.", "tank", 0x45c9cf, ["glass", "accent", "trim", "glass"]),
    capacity: M("Reservoir Loom", "Holding tanks that let a day's draw wait for its buyer.", "column", 0x3fb2bb, ["accent", "glass", "accent", "trim"]),
    speed: M("Currentline Manifold", "Balanced pumps that shorten every cycle on the line.", "press", 0x5ad6d0, ["dark", "accent", "glass", "accent"]),
    appeal: M("Tideglass Welcome Cascade", "A tasting rail where the district can see what it drinks.", "counter", 0x7fe3dd, ["trim", "glass", "accent", "glass"]),
  },
  sungrid: {
    yield: M("Photon Tuner", "Tracking mirrors that follow the sun across the hall.", "array", 0xf2c94c, ["accent", "glass", "accent", "glass"]),
    capacity: M("HelioCell Bank", "Retired packs, re-racked to hold the evening's charge.", "rack", 0xe0b93f, ["dark", "accent", "trim", "accent"]),
    speed: M("Sunstep Relay", "Conversion that wastes less of what the roof collected.", "conveyor", 0xffd964, ["accent", "dark", "glass", "accent"]),
    appeal: M("Radiance Beacon", "A lit face that tells the street this grid is honest.", "column", 0xffe694, ["glass", "trim", "glass", "accent"]),
  },
  greenhouse: {
    yield: M("Cultivar Prism", "Hydroponic rows under a lens that lengthens the day.", "loom", 0x82bd55, ["glass", "accent", "trim", "glass"]),
    capacity: M("Canopy Stack", "Vertical beds: three harvests in one footprint.", "rack", 0x6fae48, ["trim", "accent", "trim", "accent"]),
    speed: M("Pollinator Rail", "A tended circuit that sets fruit faster than waiting does.", "conveyor", 0x9ed36a, ["accent", "glass", "accent", "trim"]),
    appeal: M("Bloomfront Pavilion", "The face of the glasshouse, and its best advertisement.", "counter", 0xb9e08a, ["glass", "trim", "glass", "accent"]),
  },
  mine: {
    yield: M("VeinScope Separator", "A clean electric face that takes rock without the dust.", "press", 0xd58d4f, ["dark", "accent", "dark", "accent"]),
    capacity: M("Strata Hopper", "Sorted ore, held until the district wants it.", "column", 0xc07c42, ["dark", "trim", "dark", "accent"]),
    speed: M("GeoPulse Drill", "The belt that stops the face waiting on the cart.", "conveyor", 0xe6a061, ["accent", "dark", "accent", "glass"]),
    appeal: M("Crystal Gallery", "Cut samples, lit — a mine that looks like a museum.", "rack", 0xf0b57e, ["glass", "trim", "glass", "accent"]),
  },
  timberworks: {
    yield: M("GrainSense Planer", "Reads the grain, then cuts along it and not across.", "press", 0xc8914a, ["trim", "accent", "trim", "dark"]),
    capacity: M("Regrowth Rack", "Seasoning stacks with the seedling ledger beside them.", "rack", 0xb47f3d, ["trim", "trim", "accent", "trim"]),
    speed: M("Canopy Sawline", "A solar kiln and a sawline that keep pace with each other.", "conveyor", 0xd9a463, ["accent", "dark", "accent", "glass"]),
    appeal: M("Timber Storywall", "Every board's provenance, on the wall behind the counter.", "counter", 0xe8bd85, ["trim", "glass", "trim", "accent"]),
  },
  cratemill: {
    yield: M("FitMark Jig", "Folds a flat sheet into a crate in one stroke.", "press", 0xe39a52, ["accent", "trim", "accent", "dark"]),
    capacity: M("Nesting Crate Tower", "Crates that stack inside each other until they are needed.", "rack", 0xcf8946, ["trim", "accent", "trim", "accent"]),
    speed: M("Packflow Roller", "The belt that brings yesterday's crates back to the line.", "conveyor", 0xf0ac6b, ["accent", "dark", "glass", "accent"]),
    appeal: M("TradeMark Display", "Where a maker collects, and sees the loop working.", "counter", 0xf7c48f, ["glass", "trim", "accent", "glass"]),
  },
  workshop: {
    yield: M("MercSpec Calibrator", "The bench that turns a part into a good part.", "press", 0xe98262, ["dark", "accent", "trim", "accent"]),
    capacity: M("Modular Parts Vault", "Reclaimed components, catalogued and to hand.", "rack", 0xd77354, ["trim", "trim", "accent", "trim"]),
    speed: M("Gearpath Bench", "Every tool arrives without a walk across the floor.", "loom", 0xf2957a, ["accent", "dark", "accent", "glass"]),
    appeal: M("Artisan Showcase", "Repair-first, in public — the atelier's whole argument.", "counter", 0xf9b39d, ["glass", "trim", "glass", "accent"]),
  },
  factory: {
    yield: M("Precision Forge", "Compact robotics in a bay a person can still walk into.", "hearth", 0xe7ad45, ["dark", "accent", "dark", "glass"]),
    capacity: M("Fabrication Cell Array", "Five stations that can all run at once.", "conveyor", 0xd49b3c, ["accent", "trim", "accent", "dark"]),
    speed: M("Assembly Synchroline", "Closed-loop heat recovery: the line never stops to cool.", "tank", 0xf6bf63, ["glass", "dark", "glass", "accent"]),
    appeal: M("Mercedonian Demo Rig", "A clerestory face that makes heavy work look light.", "column", 0xffd287, ["glass", "trim", "accent", "glass"]),
  },
  construction: {
    yield: M("Module Survey Table", "Squares a modular panel to the millimetre, every time.", "press", 0xe5a949, ["dark", "accent", "trim", "accent"]),
    capacity: M("Civic Panel Gantry", "Prefabs, stacked in the order the site will want them.", "rack", 0xd19740, ["trim", "trim", "accent", "dark"]),
    speed: M("QuickSet Crane", "Moves a panel the length of the studio without a crew.", "conveyor", 0xf3bd6d, ["accent", "dark", "accent", "glass"]),
    appeal: M("Buildfolio Wall", "The district in miniature, where clients decide.", "counter", 0xfad297, ["glass", "trim", "glass", "accent"]),
  },
  freight: {
    yield: M("CargoProof Scanner", "Holds a pallet still while the quay does the work.", "cradle", 0x4ab6bd, ["dark", "accent", "dark", "accent"]),
    capacity: M("QuayStack Depot", "The depot's memory: what is going where, and when.", "rack", 0x3fa4ab, ["trim", "accent", "trim", "accent"]),
    speed: M("RoutePulse Sorter", "Shore power and a plotted course, before the tide turns.", "array", 0x62c9cf, ["glass", "dark", "glass", "accent"]),
    appeal: M("Arrival Board", "Where a maker hands over and stops worrying.", "counter", 0x8bdce0, ["glass", "trim", "accent", "glass"]),
  },
  shop: {
    yield: M("Freshness Bench", "Local, cold, and stacked where the light falls on it.", "counter", 0xeb7f68, ["glass", "accent", "trim", "glass"]),
    capacity: M("Marketstock Shelves", "Bring the jar back; the wall does the rest.", "rack", 0xd97159, ["trim", "accent", "trim", "accent"]),
    speed: M("QuickServe Counter", "A queue that moves, under a light that flatters.", "column", 0xf59280, ["accent", "glass", "accent", "glass"]),
    appeal: M("Lantern Window", "The face on the aisle, and the reason they came in.", "counter", 0xfcb3a4, ["glass", "trim", "glass", "accent"]),
  },
  restaurant: {
    yield: M("Flavor Garden Range", "Cooks on light, and tastes like it took longer.", "hearth", 0xf09a63, ["dark", "accent", "glass", "accent"]),
    capacity: M("Hearthline Pantry", "The garden that shortens the supply chain to nothing.", "loom", 0xdc8a55, ["trim", "trim", "accent", "trim"]),
    speed: M("Service Choreographer", "Where a kitchen stops being slow.", "conveyor", 0xf9ae7f, ["accent", "dark", "accent", "glass"]),
    appeal: M("Sunset Dining Atelier", "Dining in the middle of what is being cooked.", "counter", 0xffc9a2, ["glass", "trim", "glass", "accent"]),
  },
  gym: {
    yield: M("FormSense Trainer", "Every session puts something back into the grid.", "loom", 0x56bba4, ["glass", "accent", "trim", "glass"]),
    capacity: M("Circuit Equipment Wall", "Space to come back tomorrow, which is the whole business.", "rack", 0x4aa892, ["trim", "trim", "accent", "trim"]),
    speed: M("Kinetic Recovery Loop", "A route through the room that never queues.", "conveyor", 0x6fcfb8, ["accent", "dark", "accent", "glass"]),
    appeal: M("Harbor Wellness Grove", "Cold water, good light, somewhere to stand.", "counter", 0x9be0d0, ["glass", "trim", "glass", "accent"]),
  },
  cinema: {
    yield: M("Image & Sound Master", "Low-energy light, thrown properly.", "column", 0xe6ad4d, ["dark", "glass", "dark", "glass"]),
    capacity: M("Dual Auditorium Rack", "Reclaimed timber, and every seat can hear.", "rack", 0xd29c42, ["trim", "trim", "dark", "trim"]),
    speed: M("ReelFlow Projector", "Empties and resets a house between showings.", "conveyor", 0xf2c069, ["accent", "dark", "accent", "glass"]),
    appeal: M("Lantern Marquee Studio", "The lit promise on the street outside.", "counter", 0xffd894, ["glass", "trim", "glass", "accent"]),
  },
  recycler: {
    yield: M("Material Purity Sorter", "Sees what a thing is made of, and sends it the right way.", "conveyor", 0x77b95a, ["glass", "accent", "dark", "glass"]),
    capacity: M("Circular Feedstock Bank", "Sorted stock, held until a maker needs exactly that.", "rack", 0x68a84e, ["trim", "accent", "trim", "accent"]),
    speed: M("Loopline Separator", "Turns yesterday's waste into this morning's input.", "press", 0x8cc96f, ["accent", "dark", "accent", "glass"]),
    appeal: M("Reclaimed Design Gallery", "Proof, at eye level, that the loop actually closes.", "rack", 0xaadd93, ["glass", "trim", "glass", "accent"]),
  },
};

/** Fifteen rooms. Palette, wall motif and window rhythm — nothing that stands on the floor. */
export const INTERIOR_ROOMS: Record<LicenseKey, RoomDesign> = {
  aquaworks: {
    displayName: "Living Filtration Gallery",
    description: "A bright tidal hall where reed beds, pressure loops and clear-water tanks make every litre visible.",
    regenerativeSystem: "Closed-loop water recovery · living reed filtration",
    architecture: "living-water-gallery", motif: "pipes",
    glazing: [[-0.66, 1.7], [-0.36, 1.7], [0.36, 1.7], [0.66, 1.7]],
    accent: 0x45c9cf, floor: 0xbfd3d6, path: 0xa9c4c9, wall: 0x7f9aa1, trim: 0x5d7f88, glass: 0x9cdfe0, sky: 0x123e42,
  },
  sungrid: {
    displayName: "Heliostat Control Atrium",
    description: "A sun-washed energy hall that turns daylight, storage and distribution into one readable circuit.",
    regenerativeSystem: "Solar microgrid · second-life battery bank",
    architecture: "heliostat-atrium", motif: "sunburst",
    glazing: [[-0.64, 2.3], [-0.33, 2.3], [0.33, 2.3], [0.64, 2.3]],
    accent: 0xf2c94c, floor: 0xd9cfa6, path: 0xcabf90, wall: 0x9a9673, trim: 0x8a6f3c, glass: 0xd8e9a8, sky: 0x2c4a3a,
  },
  greenhouse: {
    displayName: "Canopy Biome House",
    description: "A humid barrel-biome of hydroponic rows, rain capture and pollinator rails under a living glass canopy.",
    regenerativeSystem: "Rain capture · nutrient recirculation · pollinator habitat",
    architecture: "canopy-biome", motif: "trellis",
    glazing: [[-0.62, 2.9], [-0.28, 2.9], [0.28, 2.9], [0.62, 2.9]],
    accent: 0x82bd55, floor: 0xc6bd8c, path: 0xb3ac7c, wall: 0x7f9668, trim: 0x6f5a34, glass: 0xb9e7b0, sky: 0x1d4630,
  },
  mine: {
    displayName: "Reclaimed Strata Vault",
    description: "A rock-cut assay chamber where clean electric tools work beside mist collectors and moss reclamation.",
    regenerativeSystem: "Dust capture · water mist recovery · moss reclamation",
    architecture: "reclaimed-strata-vault", motif: "seams",
    glazing: [[-0.5, 1.5], [0.5, 1.5]],
    accent: 0xd58d4f, floor: 0x9b9188, path: 0x8b8078, wall: 0x6f6862, trim: 0x4f4a45, glass: 0x9fb2b8, sky: 0x241f1c,
  },
  timberworks: {
    displayName: "Regrowth Timber Hall",
    description: "An open glulam shed joining a solar kiln, provenance wall and seedling nursery to every cut board.",
    regenerativeSystem: "Solar kiln · seedling replacement ledger · sawdust recovery",
    architecture: "regrowth-timber-hall", motif: "planks",
    glazing: [[-0.6, 2.4], [-0.3, 2.4], [0.3, 2.4], [0.6, 2.4]],
    accent: 0xc8914a, floor: 0xc7a273, path: 0xb69065, wall: 0x8d6c46, trim: 0x6c4f2f, glass: 0xcfe0a8, sky: 0x2a3a24,
  },
  cratemill: {
    displayName: "Circular Packhouse",
    description: "A flat-pack line where reusable frames, nesting crates and return bins keep materials moving in a loop.",
    regenerativeSystem: "Reusable packaging pool · offcut return loop",
    architecture: "circular-packhouse", motif: "crates",
    glazing: [[-0.72, 1.3], [-0.48, 1.3], [-0.24, 1.3], [0.24, 1.3], [0.48, 1.3], [0.72, 1.3]],
    accent: 0xe39a52, floor: 0xcbb187, path: 0xbaa077, wall: 0x8f7550, trim: 0x6f5537, glass: 0xd8dfae, sky: 0x2f3b2a,
  },
  workshop: {
    displayName: "Component Atelier",
    description: "A sawtooth-lit atelier with an overhead tool rail, repair benches and a reclaimed-parts library.",
    regenerativeSystem: "Repair-first fabrication · reclaimed component library",
    architecture: "sawtooth-atelier", motif: "pegboard",
    glazing: [[-0.62, 2.1], [-0.3, 2.1], [0.3, 2.1], [0.62, 2.1]],
    accent: 0xe98262, floor: 0xc4b596, path: 0xb2a385, wall: 0x84836c, trim: 0x6d5738, glass: 0xc9e3d0, sky: 0x243d3a,
  },
  factory: {
    displayName: "Clean Forge Hall",
    description: "A five-bay fabrication floor with compact robotics, daylight clerestories and visible closed-loop cooling.",
    regenerativeSystem: "Heat recovery · closed-loop coolant · rooftop solar",
    architecture: "clean-forge-hall", motif: "chevrons",
    glazing: [[-0.7, 1.4], [-0.46, 1.4], [-0.22, 1.4], [0.22, 1.4], [0.46, 1.4], [0.7, 1.4]],
    accent: 0xe7ad45, floor: 0xa9a9a2, path: 0x999992, wall: 0x767a7c, trim: 0x565b5e, glass: 0xa9cfd6, sky: 0x1e2e33,
  },
  construction: {
    displayName: "Civic Prefab Studio",
    description: "A design room and assembly bay where district models become low-waste modular building panels.",
    regenerativeSystem: "Design-for-disassembly · permeable planted work yard",
    architecture: "civic-prefab-studio", motif: "blueprint",
    glazing: [[-0.6, 2.3], [-0.3, 2.3], [0.3, 2.3], [0.6, 2.3]],
    accent: 0xe5a949, floor: 0xb8ada0, path: 0xa79c90, wall: 0x827a70, trim: 0x64594d, glass: 0xc4d8c0, sky: 0x2b3630,
  },
  freight: {
    displayName: "Solar Quay Depot",
    description: "A harbour dispatch deck with route intelligence, shore power and compact electric cargo handling.",
    regenerativeSystem: "Solar shore power · reusable cargo pooling",
    architecture: "solar-quay-depot", motif: "chart",
    glazing: [[-0.48, 4.6], [0.48, 4.6]],
    accent: 0x4ab6bd, floor: 0xb0a894, path: 0x9f9784, wall: 0x7c7566, trim: 0x5c5648, glass: 0xb6d2d6, sky: 0x223034,
  },
  shop: {
    displayName: "Lantern Market Pavilion",
    description: "A compact produce market and café beneath a leaf-fan canopy, built around refill and return stations.",
    regenerativeSystem: "Reusable cup loop · local produce cooling · herb wall",
    architecture: "lantern-market-pavilion", motif: "awning",
    glazing: [[-0.45, 4.2], [0.45, 4.2]],
    accent: 0xeb7f68, floor: 0xdcc9a8, path: 0xcbb897, wall: 0x9a8367, trim: 0x7a5f42, glass: 0xf0d5b8, sky: 0x3a3026,
  },
  restaurant: {
    displayName: "Edible Garden Kitchen",
    description: "An open conservatory kitchen where the solar hearth, herb beds and dining garden share one warm room.",
    regenerativeSystem: "Solar cooking · food-waste compost · rain-chain irrigation",
    architecture: "edible-garden-kitchen", motif: "shelf",
    glazing: [[-0.45, 4.2], [0.45, 4.2]],
    accent: 0xf09a63, floor: 0xd8b58c, path: 0xc7a37b, wall: 0x96694a, trim: 0x74492f, glass: 0xf5cf9a, sky: 0x3d2a1e,
  },
  gym: {
    displayName: "Kinetic Wellness Grove",
    description: "An airy lotus-rib hall where movement powers the recovery garden and cooling channel.",
    regenerativeSystem: "Human-powered generation · passive cooling · refill bar",
    architecture: "kinetic-wellness-grove", motif: "rings",
    glazing: [[-0.45, 4.4], [0.45, 4.4]],
    accent: 0x56bba4, floor: 0xa8bfae, path: 0x97ae9d, wall: 0x6f8b7c, trim: 0x50695c, glass: 0xb9e2d4, sky: 0x1c3a33,
  },
  cinema: {
    displayName: "Lantern Theatre",
    description: "A timber-acoustic screening room and planted foyer crowned by a luminous lantern marquee.",
    regenerativeSystem: "Low-energy projection · reclaimed acoustic timber",
    architecture: "lantern-theatre", motif: "marquee",
    glazing: [[-0.6, 1.3], [0.6, 1.3]],
    accent: 0xe6ad4d, floor: 0x6d6070, path: 0x5f5363, wall: 0x4b4152, trim: 0x352d3b, glass: 0x9a86b4, sky: 0x1a1522,
  },
  recycler: {
    displayName: "Materials Loop Laboratory",
    description: "A clean recovery lab where sorting bays, sample galleries and feedstock banks close the material loop.",
    regenerativeSystem: "Optical sorting · remanufacturing feedstock loop",
    architecture: "materials-loop-lab", motif: "loop",
    glazing: [[-0.6, 2.0], [-0.28, 2.0], [0.28, 2.0], [0.6, 2.0]],
    accent: 0x77b95a, floor: 0xa9b394, path: 0x98a284, wall: 0x74805f, trim: 0x555f43, glass: 0xc0dba8, sky: 0x252f22,
  },
};
