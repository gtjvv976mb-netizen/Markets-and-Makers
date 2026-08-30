/**
 * The inside of a business, rebuilt from scratch to the owner's specification.
 *
 * What the file this replaces got wrong, and what the specification is, in one place so the
 * next person does not have to excavate it from seven thousand lines:
 *
 *   A ROOM, NOT A DIORAMA. Square, walls wrapping the placement grid exactly, so every tile
 *   a player can see is a tile they can build on. Nothing stands on the floor except what
 *   the owner put there — no dressing, no painted overlays, no ghost holograms of machines
 *   nobody bought. Nothing hangs in the air: the room has no ceiling by design (that is how
 *   the camera sees in), so anything drawn at height had nothing holding it up and read as
 *   scaffolding. Windows and the door are REAL OPENINGS — the walls are built as segments
 *   around them, so daylight reads through from either side.
 *
 *   ONE DRAWN TILE IS ONE PLACEMENT TILE. The floor texture repeats exactly FLOOR_COLUMNS x
 *   FLOOR_ROWS over exactly that many tile widths. A machine sits dead centre in a tile a
 *   player can point at.
 *
 *   IDENTITY LIVES ON THE WALLS. Fifteen trades differ by palette, window rhythm and one
 *   wall motif each — never by clutter on the floor.
 *
 *   THE FLOOR IS ARRANGED, NOT DECORATED. Machines are dragged from the Build tray onto any
 *   serviced tile, turned with R, and the floor they face is the floor that matters (the
 *   rule itself lives in floorEffects.ts, which the authority also runs).
 *
 * Geometry is built from `interiorRooms.ts`, which is data. This file knows how to draw a
 * form, not what fifteen trades look like.
 */

import * as THREE from "three";
import { dampWrappedYaw, headingYaw, planarSpeed, walkAnimationRate } from "./characterRig";
import {
  BUSINESS, DEFAULT_EQUIPMENT_TILES, FITTINGS, FLOOR_COLUMNS, FLOOR_ROWS, FLOOR_TILE,
  FLOOR_WALKWAY_COLUMN, MAX_UPGRADE_LEVEL, apronTiles,
  tileIsBuildable, tileToWorld, worldToTile,
} from "./data";
import type { BusinessConfig, Facing, FittingKey, LicenseKey, UpgradeKey } from "./data";
import { INTERIOR_EQUIPMENT_CATALOG, INTERIOR_ROOMS } from "./interiorRooms";
import type { MachineDesign, RoomDesign } from "./interiorRooms";
import { createPlayerMercedonian } from "./mercedonianAvatar";
import { surfaceTile } from "./tileTextures";

export { INTERIOR_EQUIPMENT_CATALOG, INTERIOR_ROOMS } from "./interiorRooms";
export type { MachineDesign, RoomDesign, InteriorArchitecture } from "./interiorRooms";

/** The room wraps the grid exactly: every visible tile is a buildable tile. */
export const ROOM_HALF_WIDTH = (FLOOR_COLUMNS * FLOOR_TILE) / 2;
export const ROOM_HALF_DEPTH = (FLOOR_ROWS * FLOOR_TILE) / 2;

const WALL_HEIGHT = 4.7;
const SILL = 1.05;
const HEAD = 3.7;
const WALL_THICK = 0.35;
const PLAYER_RADIUS = 0.42;
const PLAYER_SPEED = 6.2;
const INTERACT_RANGE = 2.4;

export interface InteriorEnterOptions {
  business: BusinessConfig;
  license?: LicenseKey;
  upgrades: Record<UpgradeKey, number>;
  upgradeCeiling: number;
  tiles?: Record<string, { column: number; row: number }>;
  fittings?: Partial<Record<FittingKey, { column: number; row: number } | null>>;
  facings?: Partial<Record<UpgradeKey, Facing>>;
  /** The room asks; the store decides. A refusal leaves the machine where it was. */
  onPlace?: (key: string, column: number, row: number, kind: "station" | "fitting") => boolean;
}

export type InteriorSelection =
  | { kind: "upgrade"; key: UpgradeKey; label: string; level: number; ceiling: number; distance: number; nearby: boolean }
  | { kind: "exit"; label: string; distance: number; nearby: boolean };

export interface InteriorPrompt {
  selection: InteriorSelection;
  title: string;
  detail: string;
  actionLabel: string;
  available: boolean;
  inputHint: string;
}

export interface InteriorWorldCallbacks {
  onInteract?: (key: UpgradeKey) => void;
  onExit?: () => void;
  onSelectionChange?: (selection: InteriorSelection | null) => void;
  onPromptChange?: (prompt: InteriorPrompt | null) => void;
  onMoved?: (position: { x: number; z: number }) => void;
}

export type InteriorMoveDirection = "forward" | "backward" | "left" | "right";

const STATION_KEYS = Object.keys(DEFAULT_EQUIPMENT_TILES) as UpgradeKey[];

/** Face the aisle unless the owner turned it. Mirrors the store, which owns the rule. */
export function defaultFacing(column: number): Facing {
  return column < FLOOR_WALKWAY_COLUMN ? "E" : "W";
}

export function interiorAvatarYaw(directionX: number, directionZ: number): number {
  return headingYaw(directionX, directionZ);
}

export function dampInteriorAvatarYaw(current: number, target: number, delta: number): number {
  return dampWrappedYaw(current, target, delta);
}

interface Station {
  key: UpgradeKey;
  design: MachineDesign;
  root: THREE.Group;
  /** Parts that appear one per upgrade level. */
  modules: THREE.Object3D[];
  label: THREE.Sprite;
  hitbox: THREE.Mesh;
}

function disposeTree(root: THREE.Object3D): void {
  root.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    node.geometry.dispose();
    const material = node.material;
    if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
    else material.dispose();
  });
}

export class InteriorWorld {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 200);
  private readonly clock = new THREE.Clock();
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly textures = new Set<THREE.Texture>();

  private content = new THREE.Group();
  private floor: THREE.Mesh | null = null;
  private grid: THREE.Group | null = null;
  private ghost: THREE.Group | null = null;

  private readonly stations = new Map<UpgradeKey, Station>();
  private readonly fittingRoots = new Map<FittingKey, THREE.Group>();
  private readonly interactive: THREE.Object3D[] = [];
  private readonly blockers: Array<{ x: number; z: number; radius: number }> = [];

  private player = new THREE.Group();
  private playerMixer: THREE.AnimationMixer | null = null;
  private playerWalk: THREE.AnimationAction | null = null;
  private playerIdle: THREE.AnimationAction | null = null;
  private playerWalking = false;

  private business: BusinessConfig | null = null;
  private license: LicenseKey = "workshop";
  private upgrades: Record<UpgradeKey, number> = { yield: 0, capacity: 0, speed: 0, appeal: 0 };
  private upgradeCeiling = MAX_UPGRADE_LEVEL;
  private tiles: Record<string, { column: number; row: number }> = {};
  private fittingTiles: Partial<Record<FittingKey, { column: number; row: number } | null>> = {};
  private facings: Partial<Record<UpgradeKey, Facing>> = {};
  private onPlace: InteriorEnterOptions["onPlace"] | null = null;

  private carrying: { kind: "station" | "fitting"; key: string } | null = null;
  private ghostTile: { column: number; row: number } | null = null;

  private active = false;
  private running = false;
  private disposed = false;
  private elapsed = 0;
  private selection: InteriorSelection | null = null;
  private prompt: InteriorPrompt | null = null;
  private readonly keys = new Set<string>();
  private readonly moveInput = new Set<InteriorMoveDirection>();

  // Orbit, clamped to the open corner: the two far walls are solid, so the camera must stay
  // in the quadrant the low walls face or it would look at a blank slab.
  private cameraYaw = Math.atan2(10.5, 15.5);
  private cameraPitch = 0.62;
  private cameraZoom = 1;
  private static readonly YAW_RANGE = 0.82;
  private static readonly PITCH_MIN = 0.3;
  private static readonly PITCH_MAX = 1.2;
  private static readonly ZOOM_MIN = 0.62;
  private static readonly ZOOM_MAX = 1.5;
  private readonly yawHome = Math.atan2(10.5, 15.5);
  private dragging: { x: number; y: number } | null = null;
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private pinch = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly callbacks: InteriorWorldCallbacks = {},
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.AgXToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // No fog indoors: a room is not a landscape, and the camera sits far enough out that any
    // distance haze tuned for the old, smaller room greyed the whole interior.
    this.scene.fog = null;
    this.scene.add(this.content);
    this.camera.position.set(14, 14, 14);
    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("pointerup", this.onPointerUp);
    canvas.addEventListener("pointercancel", this.onPointerUp);
    canvas.addEventListener("wheel", this.onWheel, { passive: false });
    canvas.addEventListener("keydown", this.onKeyDown);
    canvas.addEventListener("keyup", this.onKeyUp);
  }

  // ── lifecycle ──────────────────────────────────────────────────────────────

  enter(options: InteriorEnterOptions): void {
    if (this.disposed) return;
    this.business = options.business;
    this.license = options.license
      ?? (Object.keys(BUSINESS) as LicenseKey[]).find((key) => BUSINESS[key] === options.business)
      ?? "workshop";
    this.upgradeCeiling = THREE.MathUtils.clamp(Math.floor(options.upgradeCeiling), 1, MAX_UPGRADE_LEVEL);
    this.upgrades = this.normalise(options.upgrades);
    this.tiles = { ...DEFAULT_EQUIPMENT_TILES, ...(options.tiles ?? {}) };
    this.fittingTiles = { ...(options.fittings ?? {}) };
    this.facings = { ...(options.facings ?? {}) };
    this.onPlace = options.onPlace ?? null;
    this.carrying = null;
    this.ghostTile = null;

    this.build();
    const spawn = tileToWorld(FLOOR_WALKWAY_COLUMN, FLOOR_ROWS - 2);
    this.player.position.set(spawn.x, 0, spawn.z);
    this.cameraYaw = this.yawHome;
    this.cameraPitch = 0.62;
    this.cameraZoom = 1;
    this.setActive(true);
    this.canvas.focus({ preventScroll: true });
    this.start();
  }

  exit(): void {
    this.setActive(false);
    this.selection = null;
    this.prompt = null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.running = false;
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerup", this.onPointerUp);
    this.canvas.removeEventListener("pointercancel", this.onPointerUp);
    this.canvas.removeEventListener("wheel", this.onWheel);
    this.canvas.removeEventListener("keydown", this.onKeyDown);
    this.canvas.removeEventListener("keyup", this.onKeyUp);
    disposeTree(this.content);
    for (const texture of this.textures) texture.dispose();
    this.textures.clear();
    this.renderer.dispose();
  }

  private setActive(active: boolean): void {
    if (this.active === active) return;
    this.active = active;
    this.keys.clear();
    this.moveInput.clear();
    if (active) {
      this.resize();
      window.setTimeout(() => this.resize(), 60);
    }
  }

  resize(width?: number, height?: number): void {
    const w = Math.max(1, Math.floor(width ?? this.canvas.clientWidth ?? 1));
    const h = Math.max(1, Math.floor(height ?? this.canvas.clientHeight ?? 1));
    // The interior is a few dozen draw calls, so it can afford real pixels — the old cap of
    // 1.6 was written for the open world's budget and read as a blurred room.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, w < 700 ? 1.5 : 2));
    this.renderer.setSize(w, h, false);
    this.frameCamera(w, h);
  }

  private frameCamera(width: number, height: number): void {
    const ratio = width / Math.max(1, height);
    let viewHeight = ROOM_HALF_DEPTH * 1.9 * this.cameraZoom;
    let viewWidth = viewHeight * ratio;
    const minWidth = ROOM_HALF_WIDTH * 1.78 * this.cameraZoom;
    if (viewWidth < minWidth) { viewWidth = minWidth; viewHeight = viewWidth / ratio; }
    this.camera.left = -viewWidth / 2;
    this.camera.right = viewWidth / 2;
    this.camera.top = viewHeight / 2;
    this.camera.bottom = -viewHeight / 2;
    this.camera.updateProjectionMatrix();
  }

  private placeCamera(): void {
    const radius = ROOM_HALF_WIDTH * 2.05;
    const horizontal = Math.cos(this.cameraPitch) * radius;
    this.camera.position.set(
      Math.sin(this.cameraYaw) * horizontal,
      Math.sin(this.cameraPitch) * radius,
      Math.cos(this.cameraYaw) * horizontal,
    );
    this.camera.lookAt(0, 0.9, 0);
  }

  private start(): void {
    if (this.running) return;
    this.running = true;
    const frame = (): void => {
      if (!this.running || this.disposed) return;
      requestAnimationFrame(frame);
      const delta = Math.min(0.05, this.clock.getDelta());
      this.elapsed += delta;
      if (this.active) {
        this.stepPlayer(delta);
        this.refreshSelection();
      }
      this.placeCamera();
      this.renderer.render(this.scene, this.camera);
    };
    frame();
  }

  // ── the room ───────────────────────────────────────────────────────────────

  private design(): RoomDesign { return INTERIOR_ROOMS[this.license]; }

  private tiled(colour: number, motif: Parameters<typeof surfaceTile>[0], repeatX: number, repeatY: number): THREE.Texture {
    const texture = surfaceTile(motif, new THREE.Color(colour)).clone();
    texture.needsUpdate = true;
    texture.repeat.set(repeatX, repeatY);
    this.textures.add(texture);
    return texture;
  }

  private build(): void {
    this.scene.remove(this.content);
    disposeTree(this.content);
    for (const texture of this.textures) texture.dispose();
    this.textures.clear();
    this.content = new THREE.Group();
    this.scene.add(this.content);
    this.stations.clear();
    this.fittingRoots.clear();
    this.interactive.length = 0;
    this.blockers.length = 0;
    this.grid = null;
    this.ghost = null;

    const design = this.design();
    this.scene.background = new THREE.Color(design.sky);
    this.buildLighting(design);
    this.buildFloor(design);
    this.buildWalls(design);
    this.buildMotif(design);
    this.buildDoor(design);
    for (const key of STATION_KEYS) this.buildStation(key, design);
    this.buildFittings(design);
    this.setupPlayer();
    this.rebuildBlockers();
    this.applyLevels();
  }

  private buildLighting(design: RoomDesign): void {
    // Measured by looking: hemisphere 1.05 + key 1.5 + ambient 0.34 under AgX at 1.12 exposure
    // washed every machine to white and flattened the wall motifs out of existence. A room
    // lit like a room keeps its palette.
    this.content.add(new THREE.HemisphereLight(0xffffff, new THREE.Color(design.floor).getHex(), 0.55));
    const key = new THREE.DirectionalLight(0xfff3d8, 1.05);
    key.position.set(-ROOM_HALF_WIDTH, 16, ROOM_HALF_DEPTH);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -ROOM_HALF_WIDTH * 1.4;
    key.shadow.camera.right = ROOM_HALF_WIDTH * 1.4;
    key.shadow.camera.top = ROOM_HALF_DEPTH * 1.4;
    key.shadow.camera.bottom = -ROOM_HALF_DEPTH * 1.4;
    this.content.add(key);
    this.content.add(new THREE.AmbientLight(0xffffff, 0.22));
  }

  /** The whole floor is drawn tiles: one texture repeat per placement tile, exactly. */
  private buildFloor(design: RoomDesign): void {
    const motif = design.architecture === "canopy-biome" || design.architecture === "living-water-gallery" ? "speckle"
      : design.architecture === "regrowth-timber-hall" || design.architecture === "sawtooth-atelier" ? "planks"
      : "flagstone";
    this.floor = new THREE.Mesh(
      new THREE.PlaneGeometry(FLOOR_COLUMNS * FLOOR_TILE, FLOOR_ROWS * FLOOR_TILE),
      new THREE.MeshStandardMaterial({
        color: 0xffffff, roughness: 0.94,
        map: this.tiled(design.floor, motif, FLOOR_COLUMNS, FLOOR_ROWS),
      }),
    );
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.receiveShadow = true;
    this.content.add(this.floor);

    // The walkway: exactly its own column, the one strip on the floor that means something.
    const top = tileToWorld(FLOOR_WALKWAY_COLUMN, 0);
    const end = tileToWorld(FLOOR_WALKWAY_COLUMN, FLOOR_ROWS - 1);
    const path = new THREE.Mesh(
      new THREE.PlaneGeometry(FLOOR_TILE, FLOOR_ROWS * FLOOR_TILE),
      new THREE.MeshStandardMaterial({
        color: 0xffffff, roughness: 0.92, map: this.tiled(design.path, "road", 1, FLOOR_ROWS),
      }),
    );
    path.rotation.x = -Math.PI / 2;
    path.position.set(top.x, 0.014, (top.z + end.z) / 2);
    path.receiveShadow = true;
    this.content.add(path);
  }

  /**
   * Walls built as SEGMENTS AROUND their openings — piers, a sill band and a header band,
   * with glass in the hole. A window applied to the face of a solid slab is a picture of a
   * window: it shows nothing from outside and reads as a billboard from inside.
   *
   * The two far faces are solid to height; the two near ones stay knee-high so the camera
   * can see in, which is why the orbit is clamped to that corner.
   */
  private buildWalls(design: RoomDesign): void {
    const face = new THREE.MeshStandardMaterial({ color: design.wall, roughness: 0.86, metalness: 0.04 });
    const trim = new THREE.MeshStandardMaterial({ color: design.trim, roughness: 0.8 });
    const pane = new THREE.MeshPhysicalMaterial({
      color: design.glass, transmission: 0.6, transparent: true, opacity: 0.42,
      roughness: 0.12, side: THREE.DoubleSide,
    });
    const slab = (size: readonly [number, number, number], at: readonly [number, number, number], material: THREE.Material): THREE.Mesh => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
      mesh.position.set(...at);
      mesh.receiveShadow = true;
      // The tall faces cast no shadow: the lighting is tuned for an open room, and letting
      // them cast drops half the floor into dusk.
      mesh.castShadow = false;
      this.content.add(mesh);
      return mesh;
    };

    const back = -(ROOM_HALF_DEPTH + WALL_THICK / 2);
    const left = -(ROOM_HALF_WIDTH + WALL_THICK / 2);
    const span = ROOM_HALF_WIDTH * 2 + WALL_THICK;
    const depth = ROOM_HALF_DEPTH * 2 + WALL_THICK;

    const wall = (
      length: number,
      openings: ReadonlyArray<readonly [number, number]>,
      doorway: readonly [number, number] | null,
      put: (size: readonly [number, number, number], centre: number, y: number, material: THREE.Material) => void,
    ): void => {
      const all = [...openings, ...(doorway ? [doorway] : [])].slice().sort((a, b) => a[0] - b[0]);
      let cursor = -length / 2;
      for (const [centre, width] of all) {
        const startEdge = centre - width / 2;
        if (startEdge - cursor > 0.05) put([startEdge - cursor, WALL_HEIGHT, WALL_THICK], (cursor + startEdge) / 2, WALL_HEIGHT / 2, face);
        cursor = centre + width / 2;
      }
      if (length / 2 - cursor > 0.05) put([length / 2 - cursor, WALL_HEIGHT, WALL_THICK], (cursor + length / 2) / 2, WALL_HEIGHT / 2, face);
      for (const [centre, width] of openings) put([width, SILL, WALL_THICK], centre, SILL / 2, face);
      for (const [centre, width] of all) put([width, WALL_HEIGHT - HEAD, WALL_THICK], centre, (WALL_HEIGHT + HEAD) / 2, face);
      for (const [centre, width] of openings) put([width - 0.1, HEAD - SILL - 0.08, 0.06], centre, (SILL + HEAD) / 2, pane);
    };

    const scale = ROOM_HALF_WIDTH - 1.3;
    const plan = design.glazing.map(([at, width]) => [at * scale, width] as const);
    wall(span, plan, [0, 2.5], (size, centre, y, material) => slab(size, [centre, y, back], material));
    const sidePlan: ReadonlyArray<readonly [number, number]> = [
      [-ROOM_HALF_DEPTH * 0.55, 2.4], [0, 2.4], [ROOM_HALF_DEPTH * 0.55, 2.4],
    ];
    wall(depth, sidePlan, null, (size, centre, y, material) =>
      slab([size[2], size[1], size[0]], [left, y, centre], material));

    slab([span + 0.1, 0.18, WALL_THICK + 0.07], [0, WALL_HEIGHT + 0.09, back], trim);
    slab([WALL_THICK + 0.07, 0.18, depth + 0.1], [left, WALL_HEIGHT + 0.09, 0], trim);
    // The near walls: knee-high, so the camera is never walled out.
    slab([0.5, 0.44, depth], [ROOM_HALF_WIDTH + 0.05, 0.2, 0], trim);
    slab([span, 0.44, 0.5], [0, 0.2, ROOM_HALF_DEPTH + 0.05], trim);
  }

  /** One motif per trade, flush to the wall. The only decoration in the room. */
  private buildMotif(design: RoomDesign): void {
    const back = -(ROOM_HALF_DEPTH - 0.02);
    const left = -(ROOM_HALF_WIDTH - 0.02);
    const flat = (colour: number, opacity = 1): THREE.MeshBasicMaterial =>
      new THREE.MeshBasicMaterial({ color: colour, transparent: opacity < 1, opacity, side: THREE.DoubleSide });
    const accent = flat(design.accent);
    const trim = flat(design.trim);
    const onBack = (u: number, y: number, w: number, h: number, m: THREE.Material, rot = 0): void => {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
      mesh.position.set(u, y, back); mesh.rotation.z = rot; this.content.add(mesh);
    };
    const onLeft = (v: number, y: number, w: number, h: number, m: THREE.Material, rot = 0): void => {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
      mesh.position.set(left, y, v); mesh.rotation.y = Math.PI / 2; mesh.rotation.z = rot; this.content.add(mesh);
    };
    const disc = (u: number, y: number, r: number, m: THREE.Material): void => {
      const mesh = new THREE.Mesh(new THREE.CircleGeometry(r, 22), m);
      mesh.position.set(u, y, back); this.content.add(mesh);
    };
    const ring = (u: number, y: number, r: number, m: THREE.Material): void => {
      const mesh = new THREE.Mesh(new THREE.TorusGeometry(r, 0.07, 6, 26), m);
      mesh.position.set(u, y, back); this.content.add(mesh);
    };
    const W = ROOM_HALF_WIDTH, D = ROOM_HALF_DEPTH;

    switch (design.motif) {
      case "pipes":
        onBack(0, 4.1, W * 1.7, 0.13, accent);
        for (const u of [-W * 0.6, -W * 0.2, W * 0.2, W * 0.6]) ring(u, 4.1, 0.3, accent);
        onLeft(0, 4.1, D * 1.7, 0.13, accent);
        break;
      case "sunburst":
        disc(0, 4.05, 1.35, accent);
        for (const [u, t] of [[-W * 0.6, 0.2], [-W * 0.36, 0.1], [W * 0.36, -0.1], [W * 0.6, -0.2]] as const) onBack(u, 4.0, 1.6, 0.95, trim, t);
        for (const v of [-D * 0.5, 0, D * 0.5]) onLeft(v, 4.05, 1.6, 0.95, trim, 0.12);
        break;
      case "trellis":
        for (const u of [-W * 0.7, -W * 0.35, 0, W * 0.35, W * 0.7]) { onBack(u, 4.05, 3.2, 0.09, trim, 0.6); onBack(u, 4.05, 3.2, 0.09, trim, -0.6); }
        for (const v of [-D * 0.55, 0, D * 0.55]) { onLeft(v, 4.05, 3.2, 0.09, trim, 0.6); onLeft(v, 4.05, 3.2, 0.09, trim, -0.6); }
        break;
      case "seams":
        for (const [u, y, w, t] of [[-W * 0.55, 4.2, 3.2, 0.1], [-W * 0.1, 4.4, 2.6, -0.14], [W * 0.34, 4.05, 3.0, 0.08], [W * 0.68, 4.35, 2.1, -0.1]] as const) onBack(u, y, w, 0.11, accent, t);
        for (const v of [-D * 0.45, D * 0.3]) onLeft(v, 4.2, 2.7, 0.11, accent, 0.1);
        break;
      case "planks":
        for (let i = 0; i < 14; i += 1) onBack(-W + 1.1 + i * ((W * 2 - 2.2) / 13), 4.15, 0.85, 0.95, i % 2 === 0 ? trim : accent);
        for (let i = 0; i < 10; i += 1) onLeft(-D + 1.2 + i * ((D * 2 - 2.4) / 9), 4.15, 0.85, 0.95, i % 2 === 0 ? trim : accent);
        break;
      case "crates":
        for (const [u, s] of [[-W * 0.6, 1.0], [-W * 0.6, 0.56], [0, 1.25], [0, 0.72], [W * 0.6, 1.0], [W * 0.6, 0.56]] as const) {
          const mesh = new THREE.Mesh(new THREE.RingGeometry(s - 0.08, s, 4, 1, Math.PI / 4), accent);
          mesh.position.set(u, 4.1, back); this.content.add(mesh);
        }
        break;
      case "pegboard":
        onBack(-W * 0.4, 4.05, W * 0.8, 1.5, flat(design.trim, 0.85));
        for (let px = 0; px < 7; px += 1) for (let py = 0; py < 3; py += 1) {
          const peg = new THREE.Mesh(new THREE.CircleGeometry(0.055, 8), accent);
          peg.position.set(-W * 0.4 - W * 0.3 + px * (W * 0.1), 3.6 + py * 0.5, back); this.content.add(peg);
        }
        onLeft(0, 4.0, D * 1.2, 0.09, accent);
        break;
      case "chevrons":
        for (let i = 0; i < 16; i += 1) onBack(-W + 1.1 + i * ((W * 2 - 2.2) / 15), 4.3, 0.5, 0.26, i % 2 === 0 ? accent : trim, -0.5);
        break;
      case "blueprint":
        onBack(-W * 0.4, 4.05, W * 0.75, 1.8, flat(0x14424e));
        onBack(-W * 0.4, 3.65, W * 0.46, 0.07, accent);
        onBack(-W * 0.55, 4.2, 0.07, 1.0, accent);
        onBack(-W * 0.25, 4.2, 0.07, 1.0, accent);
        onLeft(0, 4.05, D * 0.75, 1.8, flat(0x14424e));
        break;
      case "chart":
        onBack(W * 0.4, 4.1, W * 0.7, 1.7, flat(0x0f3a44));
        for (const [du, dy] of [[-0.3, -0.45], [-0.08, -0.12], [0.14, 0.2], [0.32, 0.5]] as const) disc(W * 0.4 + du * W * 0.6, 4.1 + dy, 0.08, accent);
        onLeft(0, 1.1, D * 1.5, 0.45, flat(design.trim, 0.9));
        break;
      case "awning":
        for (let i = 0; i < 12; i += 1) {
          const scallop = new THREE.Mesh(new THREE.CircleGeometry(0.5, 14, Math.PI, Math.PI), i % 2 === 0 ? accent : flat(0xf0e0b8));
          scallop.position.set(-W + 1.4 + i * ((W * 2 - 2.8) / 11), 4.25, back); this.content.add(scallop);
        }
        break;
      case "shelf":
        onBack(W * 0.4, 3.6, W * 0.65, 0.08, trim);
        for (const du of [-0.26, -0.13, 0, 0.13, 0.26]) disc(W * 0.4 + du * W * 0.65, 3.95, 0.24, flat(0xf3e6c6));
        { const arch = new THREE.Mesh(new THREE.RingGeometry(1.05, 1.22, 20, 1, 0, Math.PI), accent);
          arch.position.set(-W * 0.45, 2.2, back); this.content.add(arch); }
        break;
      case "rings":
        for (const [u, r] of [[-W * 0.18, 1.05], [0, 0.78], [W * 0.18, 1.05]] as const) ring(u, 4.05, r, accent);
        onLeft(0, 2.2, D * 1.6, 0.08, trim);
        break;
      case "marquee":
        for (let i = 0; i < 13; i += 1) disc(-W * 0.45 + i * (W * 0.075), 4.5, 0.075, accent);
        onLeft(0, 2.6, D * 1.3, 2.4, flat(0x0d0f1c));
        break;
      case "loop":
        ring(0, 4.05, 1.25, accent);
        for (const [u, t] of [[-W * 0.55, 0.35], [-W * 0.34, 0.18], [W * 0.34, -0.18], [W * 0.55, -0.35]] as const) onBack(u, 3.7, 2.3, 0.09, accent, t);
        break;
    }
  }

  /** The door: a real opening in the back wall, on the walkway axis. */
  private buildDoor(design: RoomDesign): void {
    const root = new THREE.Group();
    root.position.set(0, 0, -(ROOM_HALF_DEPTH - 0.16));
    const timber = new THREE.MeshStandardMaterial({ color: design.trim, roughness: 0.78 });
    const leaf = new THREE.MeshStandardMaterial({
      color: new THREE.Color(design.wall).lerp(new THREE.Color(0x000000), 0.25), roughness: 0.7,
      emissive: new THREE.Color(design.accent).multiplyScalar(0.1), emissiveIntensity: 0.5,
    });
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, pos: readonly [number, number, number]): THREE.Mesh => {
      const mesh = new THREE.Mesh(geo, mat); mesh.position.set(...pos); mesh.castShadow = true; root.add(mesh); return mesh;
    };
    add(new THREE.BoxGeometry(2.3, 3.5, 0.16), timber, [0, 1.75, 0]);
    add(new THREE.BoxGeometry(1.9, 3.1, 0.2), leaf, [0, 1.6, 0.06]);
    add(new THREE.SphereGeometry(0.09, 10, 8), new THREE.MeshStandardMaterial({ color: 0xe3b449, metalness: 0.7, roughness: 0.3 }), [0.62, 1.5, 0.18]);

    const hit = new THREE.Mesh(new THREE.BoxGeometry(2.4, 3.6, 1.2),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.001, depthWrite: false }));
    hit.position.set(0, 1.8, 0.6);
    hit.userData.target = "exit";
    root.add(hit);
    this.interactive.push(hit);
    this.content.add(root);
  }

  // ── machines ───────────────────────────────────────────────────────────────

  /** Build one machine from its recipe: a base form, then modules that appear as it levels. */
  private buildStation(key: UpgradeKey, room: RoomDesign): void {
    const machine = INTERIOR_EQUIPMENT_CATALOG[this.license][key];
    const root = new THREE.Group();
    root.name = `station-${key}`;
    const secondary = new THREE.Color(machine.secondary);
    const body = new THREE.MeshStandardMaterial({ color: secondary, roughness: 0.55, metalness: 0.16 });
    const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color(room.trim).lerp(new THREE.Color(0x000000), 0.3), roughness: 0.72 });
    const glass = new THREE.MeshStandardMaterial({
      color: room.glass, roughness: 0.2, transparent: true, opacity: 0.72,
      emissive: new THREE.Color(machine.secondary).multiplyScalar(0.25), emissiveIntensity: 0.7,
    });
    const trim = new THREE.MeshStandardMaterial({ color: room.trim, roughness: 0.74 });
    const pick = (finish: string): THREE.Material =>
      finish === "accent" ? body : finish === "trim" ? trim : finish === "glass" ? glass : dark;
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, pos: readonly [number, number, number], rotX = 0): THREE.Mesh => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(...pos); mesh.rotation.x = rotX;
      mesh.castShadow = true; mesh.receiveShadow = true;
      root.add(mesh); return mesh;
    };

    // The base form: what this machine IS before anyone upgrades it.
    switch (machine.form) {
      case "tank":
        add(new THREE.CylinderGeometry(0.34, 0.36, 0.9, 14), body, [0, 0.45, 0]);
        add(new THREE.CylinderGeometry(0.37, 0.37, 0.08, 14), dark, [0, 0.92, 0]);
        break;
      case "press":
        for (const x of [-0.3, 0.3]) add(new THREE.BoxGeometry(0.12, 0.9, 0.12), dark, [x, 0.45, 0]);
        add(new THREE.BoxGeometry(0.86, 0.16, 0.5), body, [0, 0.86, 0]);
        add(new THREE.BoxGeometry(0.62, 0.14, 0.42), dark, [0, 0.2, 0]);
        break;
      case "rack":
        for (const y of [0.24, 0.54, 0.84]) add(new THREE.BoxGeometry(0.82, 0.05, 0.42), trim, [0, y, 0]);
        for (const [x, z] of [[-0.37, -0.18], [0.37, -0.18], [-0.37, 0.18], [0.37, 0.18]] as const) add(new THREE.BoxGeometry(0.06, 0.9, 0.06), dark, [x, 0.45, z]);
        break;
      case "hearth":
        add(new THREE.CylinderGeometry(0.38, 0.4, 0.62, 14), dark, [0, 0.31, 0]);
        add(new THREE.CircleGeometry(0.2, 14), glass, [0, 0.34, 0.41]);
        add(new THREE.CylinderGeometry(0.06, 0.06, 0.5, 8), dark, [0.22, 0.87, -0.16]);
        break;
      case "loom":
        for (const x of [-0.42, 0.42]) add(new THREE.BoxGeometry(0.09, 0.92, 0.09), trim, [x, 0.46, 0]);
        add(new THREE.BoxGeometry(0.95, 0.09, 0.16), trim, [0, 0.9, 0]);
        for (let i = 0; i < 5; i += 1) add(new THREE.BoxGeometry(0.03, 0.6, 0.03), body, [-0.32 + i * 0.16, 0.55, 0]);
        break;
      case "array":
        add(new THREE.CylinderGeometry(0.07, 0.09, 0.7, 8), dark, [0, 0.35, 0]);
        add(new THREE.BoxGeometry(0.9, 0.06, 0.6), body, [0, 0.76, 0], 0.36);
        break;
      case "conveyor":
        for (const x of [-0.36, 0.36]) add(new THREE.CylinderGeometry(0.11, 0.11, 0.42, 10), dark, [x, 0.3, 0], Math.PI / 2);
        add(new THREE.BoxGeometry(0.86, 0.05, 0.4), body, [0, 0.42, 0]);
        for (const [x, z] of [[-0.32, -0.16], [0.32, -0.16], [-0.32, 0.16], [0.32, 0.16]] as const) add(new THREE.BoxGeometry(0.05, 0.28, 0.05), dark, [x, 0.14, z]);
        break;
      case "counter":
        add(new THREE.BoxGeometry(0.92, 0.5, 0.44), trim, [0, 0.25, 0]);
        add(new THREE.BoxGeometry(0.96, 0.06, 0.48), body, [0, 0.53, 0]);
        add(new THREE.BoxGeometry(0.84, 0.28, 0.03), glass, [0, 0.7, 0.2]);
        break;
      case "cradle":
        add(new THREE.BoxGeometry(0.92, 0.12, 0.5), dark, [0, 0.12, 0]);
        for (const z of [-0.22, 0.22]) add(new THREE.TorusGeometry(0.3, 0.06, 6, 16, Math.PI), body, [0, 0.24, z], 0);
        break;
      case "column":
        add(new THREE.CylinderGeometry(0.3, 0.34, 1.05, 12), body, [0, 0.52, 0]);
        for (let i = 0; i < 6; i += 1) {
          const angle = (i / 6) * Math.PI * 2;
          add(new THREE.BoxGeometry(0.05, 1.0, 0.05), dark, [Math.cos(angle) * 0.31, 0.52, Math.sin(angle) * 0.31]);
        }
        break;
    }

    // Upgrade modules: hidden until bought, revealed by applyLevels.
    const modules: THREE.Object3D[] = [];
    for (const module of machine.modules) {
      const mesh = add(new THREE.BoxGeometry(...module.size), pick(module.finish), module.at3, module.tilt ?? 0);
      mesh.visible = false;
      modules.push(mesh);
    }

    const label = this.makeLabel(machine.name, 0, new THREE.Color(machine.secondary));
    label.position.set(0, 1.45, 0);
    root.add(label);

    const hit = new THREE.Mesh(new THREE.BoxGeometry(1.5, 2.2, 1.5),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.001, depthWrite: false }));
    hit.position.y = 0.7;
    hit.userData.target = key;
    root.add(hit);
    this.interactive.push(hit);

    // Authored at roughly one unit tall, which read as a toy once the room grew to 17x17
    // tiles. Scaled to own its tile: a machine should look like something a person works at.
    root.scale.setScalar(1.55);
    this.content.add(root);
    this.stations.set(key, { key, design: machine, root, modules, label, hitbox: hit });
    this.layoutStation(key);
  }

  /** Six fittings, each shaped like its job, so the floor says what feeds what. */
  private buildFittings(room: RoomDesign): void {
    const accent = new THREE.MeshStandardMaterial({ color: room.accent, roughness: 0.44, metalness: 0.2 });
    const dark = new THREE.MeshStandardMaterial({ color: room.trim, roughness: 0.68 });
    const timber = new THREE.MeshStandardMaterial({ color: room.trim, roughness: 0.8 });
    const glass = new THREE.MeshStandardMaterial({ color: room.glass, roughness: 0.18, transparent: true, opacity: 0.6 });
    const build = (root: THREE.Group, geo: THREE.BufferGeometry, mat: THREE.Material, pos: readonly [number, number, number], rot?: readonly [number, number, number]): void => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(...pos);
      if (rot) mesh.rotation.set(...rot);
      mesh.castShadow = true; root.add(mesh);
    };

    for (const key of Object.keys(FITTINGS) as FittingKey[]) {
      const root = new THREE.Group();
      root.name = `fitting-${key}`;
      switch (key) {
        case "hopper":
          build(root, new THREE.CylinderGeometry(0.32, 0.1, 0.44, 10, 1, true), accent, [0, 0.6, 0]);
          build(root, new THREE.CylinderGeometry(0.1, 0.1, 0.3, 8), dark, [0, 0.23, 0]);
          break;
        case "kiln":
          build(root, new THREE.CylinderGeometry(0.34, 0.36, 0.58, 12), dark, [0, 0.29, 0]);
          build(root, new THREE.CircleGeometry(0.18, 12), accent, [0, 0.32, 0.37]);
          break;
        case "governor":
          build(root, new THREE.CylinderGeometry(0.08, 0.11, 0.62, 8), dark, [0, 0.31, 0]);
          build(root, new THREE.SphereGeometry(0.12, 10, 8), accent, [0, 0.7, 0]);
          for (const s of [-1, 1]) build(root, new THREE.SphereGeometry(0.07, 8, 6), accent, [0.2 * s, 0.58, 0]);
          break;
        case "sorter":
          build(root, new THREE.BoxGeometry(0.74, 0.07, 0.28), dark, [0, 0.52, 0], [0, 0, 0.22]);
          for (const s of [-1, 1]) build(root, new THREE.BoxGeometry(0.26, 0.24, 0.26), accent, [0.22 * s, 0.12, 0]);
          break;
        case "rack":
          for (const y of [0.19, 0.44, 0.68]) build(root, new THREE.BoxGeometry(0.7, 0.04, 0.34), timber, [0, y, 0]);
          for (const [x, z] of [[-0.32, -0.15], [0.32, -0.15], [-0.32, 0.15], [0.32, 0.15]] as const) build(root, new THREE.BoxGeometry(0.05, 0.74, 0.05), dark, [x, 0.37, z]);
          break;
        case "counter":
          build(root, new THREE.BoxGeometry(0.82, 0.48, 0.4), timber, [0, 0.24, 0]);
          build(root, new THREE.BoxGeometry(0.84, 0.06, 0.44), accent, [0, 0.51, 0]);
          build(root, new THREE.BoxGeometry(0.76, 0.24, 0.03), glass, [0, 0.66, 0.19]);
          break;
      }
      root.visible = false;
      this.content.add(root);
      this.fittingRoots.set(key, root);
    }
    this.layoutFittings();
  }

  private makeLabel(title: string, level: number, accent: THREE.Color): THREE.Sprite {
    const canvas = document.createElement("canvas");
    canvas.width = 768; canvas.height = 224;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      // The world's own plate, taken from world.ts's plot marker rather than invented: a
      // dark teal ground, a gold title, and the level as pips — legible at the size a label
      // in a room is actually drawn, which a line of small text is not.
      const pad = 14, radius = 52;
      ctx.beginPath();
      ctx.roundRect(pad, pad, canvas.width - pad * 2, canvas.height - pad * 2, radius);
      ctx.fillStyle = "rgba(16,67,70,.92)"; ctx.fill();
      ctx.textAlign = "center";
      ctx.fillStyle = "#ffdd73";
      let size = 66;
      do { ctx.font = `800 ${size}px system-ui, sans-serif`; size -= 2; }
      while (size > 24 && ctx.measureText(title).width > canvas.width * 0.82);
      ctx.fillText(title, canvas.width / 2, canvas.height * 0.46);
      const pips = Math.max(1, this.upgradeCeiling);
      const owned = Math.max(0, Math.min(pips, Math.floor(level)));
      if (owned === 0) {
        ctx.fillStyle = "#ffffff";
        ctx.font = `700 ${Math.round(canvas.height * 0.18)}px system-ui, sans-serif`;
        ctx.fillText("NOT INSTALLED", canvas.width / 2, canvas.height * 0.76);
      } else {
        const r = canvas.height * 0.06, gap = r * 3.2;
        const startX = canvas.width / 2 - ((pips - 1) * gap) / 2;
        for (let i = 0; i < pips; i += 1) {
          ctx.beginPath(); ctx.arc(startX + i * gap, canvas.height * 0.70, r, 0, Math.PI * 2);
          if (i < owned) { ctx.fillStyle = `#${accent.getHexString()}`; ctx.fill(); }
          else { ctx.strokeStyle = "rgba(255,255,255,.38)"; ctx.lineWidth = Math.max(2, r * 0.34); ctx.stroke(); }
        }
      }
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    this.textures.add(texture);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
    sprite.scale.set(2.6, 0.65, 1);
    return sprite;
  }

  /**
   * The player's body, from the shared factory — with a fallback that keeps the room usable
   * if the avatar generator ever throws.
   *
   * The generator builds a rig procedurally at boot. If it fails, the alternative to a
   * fallback is a room the player cannot see themselves in, standing in for a game they
   * cannot play; a plain capsule is a far better failure than that. The fallback lives
   * strictly inside the catch, so the ordinary path is the shared avatar and nothing else.
   */
  private setupPlayer(): void {
    this.player = new THREE.Group();
    this.content.add(this.player);
    try {
      const mercedonian = createPlayerMercedonian(this.renderer.shadowMap.enabled);
      this.player.add(mercedonian.group);
      this.playerMixer = new THREE.AnimationMixer(mercedonian.group);
      // The factory returns a clip LIST, not named actions: pick idle and walk by name, and
      // fall back to the first clip so a rig with one animation still moves.
      const pick = (match: RegExp): THREE.AnimationClip | undefined =>
        mercedonian.animations.find((clip) => match.test(clip.name.toLowerCase()));
      const idleClip = pick(/idle|stand/) ?? mercedonian.animations[0];
      const walkClip = pick(/walk|run|move/) ?? mercedonian.animations[0];
      this.playerIdle = idleClip ? this.playerMixer.clipAction(idleClip) : null;
      this.playerWalk = walkClip ? this.playerMixer.clipAction(walkClip) : null;
      this.playerIdle?.play();
    } catch {
      this.playerMixer = null;
      this.playerIdle = null;
      this.playerWalk = null;
      const fallback = this.createPlayerFallback();
      fallback.name = "interior-mercedonian-fallback";
      this.player.add(fallback);
    }
  }

  private createPlayerFallback(): THREE.Object3D {
    const group = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.28, 0.72, 6, 12),
      new THREE.MeshStandardMaterial({ color: 0x2f6f74, roughness: 0.7 }),
    );
    body.position.y = 0.78;
    body.castShadow = true;
    group.add(body);
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.2, 12, 10),
      new THREE.MeshStandardMaterial({ color: 0xf0d7b4, roughness: 0.8 }),
    );
    head.position.y = 1.42;
    head.castShadow = true;
    group.add(head);
    return group;
  }

  // ── layout ─────────────────────────────────────────────────────────────────

  private facingOf(key: UpgradeKey): Facing {
    const tile = this.tiles[key] ?? DEFAULT_EQUIPMENT_TILES[key];
    return this.facings[key] ?? defaultFacing(tile?.column ?? 0);
  }

  private layoutStation(key: UpgradeKey): void {
    const station = this.stations.get(key);
    const tile = this.tiles[key] ?? DEFAULT_EQUIPMENT_TILES[key];
    if (!station || !tile) return;
    const world = tileToWorld(tile.column, tile.row);
    station.root.position.set(world.x, 0, world.z);
    station.root.rotation.y = { N: Math.PI, E: -Math.PI / 2, S: 0, W: Math.PI / 2 }[this.facingOf(key)];
  }

  private layoutFittings(): void {
    for (const [key, root] of this.fittingRoots) {
      const tile = this.fittingTiles[key] ?? null;
      if (!tile) { root.visible = false; continue; }
      const world = tileToWorld(tile.column, tile.row);
      root.position.set(world.x, 0, world.z);
      root.rotation.y = world.x > 0 ? -Math.PI / 2 : Math.PI / 2;
      root.visible = true;
    }
  }

  /** Walk-blockers built from where things ACTUALLY stand, and only for what exists. */
  private rebuildBlockers(): void {
    this.blockers.length = 0;
    for (const key of this.stations.keys()) {
      if ((this.upgrades[key] ?? 0) <= 0) continue;   // not bought is not there
      const tile = this.tiles[key] ?? DEFAULT_EQUIPMENT_TILES[key];
      if (!tile) continue;
      const world = tileToWorld(tile.column, tile.row);
      this.blockers.push({ x: world.x, z: world.z, radius: 0.86 });
    }
    for (const tile of Object.values(this.fittingTiles)) {
      if (!tile) continue;
      const world = tileToWorld(tile.column, tile.row);
      this.blockers.push({ x: world.x, z: world.z, radius: 0.5 });
    }
  }

  private normalise(levels: Record<UpgradeKey, number>): Record<UpgradeKey, number> {
    const out = {} as Record<UpgradeKey, number>;
    for (const key of STATION_KEYS) {
      out[key] = THREE.MathUtils.clamp(Math.floor(levels[key] ?? 0), 0, this.upgradeCeiling);
    }
    return out;
  }

  /** An unbought machine is NOT THERE: no mesh, no collider, no click. */
  private applyLevels(): void {
    for (const [key, station] of this.stations) {
      const level = this.upgrades[key] ?? 0;
      station.root.visible = level > 0;
      station.modules.forEach((module, index) => { module.visible = index < level; });
      const accent = new THREE.Color(station.design.secondary);
      const next = this.makeLabel(station.design.name, level, accent);
      const previous = station.label.material.map;
      station.label.material.map = next.material.map;
      station.label.material.needsUpdate = true;
      if (previous) { previous.dispose(); this.textures.delete(previous); }
    }
  }

  updateUpgradeLevels(levels: Record<UpgradeKey, number>, ceiling = this.upgradeCeiling): void {
    const nextCeiling = THREE.MathUtils.clamp(Math.floor(ceiling), 1, MAX_UPGRADE_LEVEL);
    const ceilingChanged = nextCeiling !== this.upgradeCeiling;
    this.upgradeCeiling = nextCeiling;
    this.upgrades = this.normalise(levels);
    if (ceilingChanged && this.business) this.build();
    else this.applyLevels();
    this.rebuildBlockers();
    this.refreshSelection(true);
  }

  setFacings(facings: Partial<Record<UpgradeKey, Facing>>): void {
    this.facings = { ...facings };
    for (const key of this.stations.keys()) this.layoutStation(key);
  }

  // ── placement ──────────────────────────────────────────────────────────────

  get isPlacing(): boolean { return this.carrying !== null; }

  beginPlacement(key: string, kind: "station" | "fitting" = "station"): void {
    if (!this.active) return;
    this.carrying = { kind, key };
    this.ghostTile = (kind === "station" ? this.tiles[key] : this.fittingTiles[key as FittingKey])
      ?? DEFAULT_EQUIPMENT_TILES[key] ?? { column: FLOOR_WALKWAY_COLUMN - 1, row: 1 };
    this.showGrid(true);
    this.makeGhost(kind);
    this.updateGhost();
    this.canvas.style.cursor = "grabbing";
  }

  endPlacement(commit: boolean): void {
    const held = this.carrying;
    const tile = this.ghostTile;
    this.carrying = null;
    this.showGrid(false);
    this.clearGhost();
    this.canvas.style.cursor = "grab";
    if (!commit || !held || !tile) return;
    if (this.onPlace?.(held.key, tile.column, tile.row, held.kind)) {
      if (held.kind === "station") { this.tiles = { ...this.tiles, [held.key]: tile }; this.layoutStation(held.key as UpgradeKey); }
      else { this.fittingTiles = { ...this.fittingTiles, [held.key as FittingKey]: tile }; this.layoutFittings(); }
      this.rebuildBlockers();
    }
  }

  /** The tile grid, shown ONLY while something is in hand — an aid, never decoration. */
  private showGrid(visible: boolean): void {
    if (visible && !this.grid) {
      const group = new THREE.Group();
      const ok = new THREE.MeshBasicMaterial({ color: 0x8ecb69, transparent: true, opacity: 0.26, depthWrite: false });
      const no = new THREE.MeshBasicMaterial({ color: 0xb0503a, transparent: true, opacity: 0.16, depthWrite: false });
      for (let row = 0; row < FLOOR_ROWS; row += 1) for (let column = 0; column < FLOOR_COLUMNS; column += 1) {
        const world = tileToWorld(column, row);
        const pad = new THREE.Mesh(new THREE.PlaneGeometry(FLOOR_TILE * 0.9, FLOOR_TILE * 0.9),
          tileIsBuildable(column, row) ? ok : no);
        pad.rotation.x = -Math.PI / 2;
        pad.position.set(world.x, 0.03, world.z);
        group.add(pad);
      }
      this.grid = group;
      this.content.add(group);
    }
    if (this.grid) this.grid.visible = visible;
  }

  private makeGhost(kind: "station" | "fitting"): void {
    this.clearGhost();
    const group = new THREE.Group();
    const size = kind === "fitting" ? 0.8 : 1.1;
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(size, kind === "fitting" ? 0.9 : 1.4, size),
      new THREE.MeshBasicMaterial({ color: 0x8ecb69, transparent: true, opacity: 0.45, depthWrite: false }),
    );
    mesh.position.y = kind === "fitting" ? 0.45 : 0.7;
    group.add(mesh);
    this.ghost = group;
    this.content.add(group);
  }

  private clearGhost(): void {
    if (!this.ghost) return;
    this.content.remove(this.ghost);
    disposeTree(this.ghost);
    this.ghost = null;
  }

  private updateGhost(): void {
    if (!this.ghost || !this.ghostTile || !this.carrying) return;
    const { column, row } = this.ghostTile;
    const world = tileToWorld(column, row);
    this.ghost.position.set(world.x, 0, world.z);
    const held = this.carrying;
    const stationClash = Object.entries(this.tiles).some(([key, tile]) =>
      !(held.kind === "station" && key === held.key) && tile.column === column && tile.row === row);
    const fittingClash = Object.entries(this.fittingTiles).some(([key, tile]) =>
      !!tile && !(held.kind === "fitting" && key === held.key) && tile.column === column && tile.row === row);
    const allowed = tileIsBuildable(column, row) && !stationClash && !fittingClash;
    this.ghost.traverse((node) => {
      if (node instanceof THREE.Mesh && node.material instanceof THREE.MeshBasicMaterial) {
        node.material.color.set(allowed ? 0x8ecb69 : 0xb0503a);
      }
    });
  }

  private pointerToTile(): void {
    if (!this.floor || !this.carrying) return;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObject(this.floor, false)[0];
    if (!hit) return;
    this.ghostTile = worldToTile(hit.point.x, hit.point.z);
    this.updateGhost();
  }

  // ── movement, selection, input ─────────────────────────────────────────────

  setMoveInput(direction: InteriorMoveDirection, active: boolean): void {
    if (active) this.moveInput.add(direction); else this.moveInput.delete(direction);
  }

  private moveVector(): THREE.Vector3 {
    const vector = new THREE.Vector3();
    const forward = this.keys.has("w") || this.keys.has("arrowup") || this.moveInput.has("forward");
    const back = this.keys.has("s") || this.keys.has("arrowdown") || this.moveInput.has("backward");
    const left = this.keys.has("a") || this.keys.has("arrowleft") || this.moveInput.has("left");
    const right = this.keys.has("d") || this.keys.has("arrowright") || this.moveInput.has("right");
    if (forward) vector.z -= 1;
    if (back) vector.z += 1;
    if (left) vector.x -= 1;
    if (right) vector.x += 1;
    if (vector.lengthSq() === 0) return vector;
    // Camera-relative, so "forward" means away from the viewer however the room is turned.
    vector.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.cameraYaw);
    return vector.normalize();
  }

  private blocked(x: number, z: number): boolean {
    if (Math.abs(x) > ROOM_HALF_WIDTH - PLAYER_RADIUS) return true;
    if (Math.abs(z) > ROOM_HALF_DEPTH - PLAYER_RADIUS) return true;
    return this.blockers.some((blocker) =>
      Math.hypot(blocker.x - x, blocker.z - z) < blocker.radius + PLAYER_RADIUS);
  }

  private stepPlayer(delta: number): void {
    const direction = this.moveVector();
    let moved = false;
    if (direction.lengthSq() > 0) {
      const distance = delta * PLAYER_SPEED;
      const nextX = this.player.position.x + direction.x * distance;
      const nextZ = this.player.position.z + direction.z * distance;
      // Slide along whatever is in the way rather than stopping dead against it.
      if (!this.blocked(nextX, nextZ)) { this.player.position.set(nextX, 0, nextZ); moved = true; }
      else if (!this.blocked(nextX, this.player.position.z)) { this.player.position.x = nextX; moved = true; }
      else if (!this.blocked(this.player.position.x, nextZ)) { this.player.position.z = nextZ; moved = true; }
      if (moved) {
        this.player.rotation.y = dampWrappedYaw(this.player.rotation.y, headingYaw(direction.x, direction.z), delta);
        this.callbacks.onMoved?.({ x: this.player.position.x, z: this.player.position.z });
      }
    }
    const speed = moved ? planarSpeed(direction.x * PLAYER_SPEED * delta, direction.z * PLAYER_SPEED * delta, delta) : 0;
    if (this.playerMixer) {
      const walking = speed > 0.05;
      if (walking !== this.playerWalking && this.playerIdle && this.playerWalk) {
        const from = walking ? this.playerIdle : this.playerWalk;
        const to = walking ? this.playerWalk : this.playerIdle;
        to.reset().setEffectiveWeight(1).play();
        to.crossFadeFrom(from, 0.18, true);
        this.playerWalking = walking;
      }
      if (this.playerWalk) this.playerWalk.timeScale = walkAnimationRate(speed);
      this.playerMixer.update(delta);
    }
  }

  private resolveSelection(): InteriorSelection | null {
    let best: InteriorSelection | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const [key, station] of this.stations) {
      if ((this.upgrades[key] ?? 0) <= 0 && !station.root.visible) {
        // An unbought machine still has a tile: it can be selected to BUY, but only from
        // the tray. In the room it is not there to walk up to.
        continue;
      }
      const distance = Math.hypot(station.root.position.x - this.player.position.x, station.root.position.z - this.player.position.z);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = {
          kind: "upgrade", key, label: station.design.name,
          level: this.upgrades[key] ?? 0, ceiling: this.upgradeCeiling,
          distance, nearby: distance <= INTERACT_RANGE,
        };
      }
    }
    const doorDistance = Math.hypot(this.player.position.x, this.player.position.z + ROOM_HALF_DEPTH);
    if (doorDistance < bestDistance) {
      best = { kind: "exit", label: "Return outside", distance: doorDistance, nearby: doorDistance <= INTERACT_RANGE + 0.6 };
    }
    return best;
  }

  private refreshSelection(force = false): void {
    const selection = this.resolveSelection();
    const changed = force
      || selection?.kind !== this.selection?.kind
      || (selection?.kind === "upgrade" && this.selection?.kind === "upgrade" && selection.key !== this.selection.key)
      || selection?.nearby !== this.selection?.nearby
      || (selection?.kind === "upgrade" && this.selection?.kind === "upgrade" && selection.level !== this.selection.level);
    this.selection = selection;
    if (!changed) return;
    this.callbacks.onSelectionChange?.(selection);
    this.prompt = selection ? this.promptFor(selection) : null;
    this.callbacks.onPromptChange?.(this.prompt);
  }

  private promptFor(selection: InteriorSelection): InteriorPrompt {
    if (selection.kind === "exit") {
      return {
        selection, title: "Return to Mercedonia", detail: "Step through the door to the district.",
        actionLabel: "Leave", available: selection.nearby, inputHint: "E",
      };
    }
    const machine = INTERIOR_EQUIPMENT_CATALOG[this.license][selection.key];
    const maxed = selection.level >= selection.ceiling;
    return {
      selection,
      title: machine.name,
      detail: machine.description,
      actionLabel: maxed ? "At its ceiling" : selection.level === 0 ? "Install" : `Upgrade to level ${selection.level + 1}`,
      available: selection.nearby && !maxed,
      inputHint: "E",
    };
  }

  focusTarget(key: UpgradeKey): void {
    const tile = this.tiles[key] ?? DEFAULT_EQUIPMENT_TILES[key];
    if (!tile) return;
    const world = tileToWorld(tile.column, tile.row);
    // Stand at the machine's working face, so the walk-up prompt resolves immediately.
    const apron = apronTiles(tile, this.facingOf(key), Math.max(1, this.upgrades[key] ?? 1))[0];
    const stand = apron ? tileToWorld(apron.column, apron.row) : { x: world.x, z: world.z + 1.4 };
    this.player.position.set(stand.x, 0, stand.z);
    this.refreshSelection(true);
  }

  interact(): void {
    if (!this.active) return;
    const selection = this.selection;
    if (!selection || !selection.nearby) return;
    if (selection.kind === "exit") { this.setActive(false); this.callbacks.onExit?.(); return; }
    if (selection.level >= selection.ceiling) return;
    this.callbacks.onInteract?.(selection.key);
  }

  private pickTarget(): string | null {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObjects(this.interactive, false).find((entry) => {
      let node: THREE.Object3D | null = entry.object;
      while (node) { if (!node.visible) return false; node = node.parent; }
      return true;
    });
    return (hit?.object.userData.target as string | undefined) ?? null;
  }

  private setPointer(event: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.set(
      ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
      -((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1,
    );
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (!this.active) return;
    this.canvas.focus({ preventScroll: true });
    this.setPointer(event);
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    // Capture can throw when the pointer lifted between dispatch and here — a real,
    // observed NotFoundError, and optional chaining does not guard a THROWING method.
    try { this.canvas.setPointerCapture(event.pointerId); } catch { /* pointer already gone */ }
    if (this.carrying) { this.pointerToTile(); return; }
    this.dragging = { x: event.clientX, y: event.clientY };
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (!this.active) return;
    this.setPointer(event);
    if (this.pointers.has(event.pointerId)) this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.carrying) { this.pointerToTile(); return; }
    if (this.pointers.size >= 2) { this.pinchZoom(); return; }
    if (!this.dragging) return;
    const dx = event.clientX - this.dragging.x;
    const dy = event.clientY - this.dragging.y;
    this.dragging = { x: event.clientX, y: event.clientY };
    this.cameraYaw = THREE.MathUtils.clamp(this.cameraYaw - dx * 0.006,
      this.yawHome - InteriorWorld.YAW_RANGE, this.yawHome + InteriorWorld.YAW_RANGE);
    this.cameraPitch = THREE.MathUtils.clamp(this.cameraPitch + dy * 0.005,
      InteriorWorld.PITCH_MIN, InteriorWorld.PITCH_MAX);
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    try { this.canvas.releasePointerCapture(event.pointerId); } catch { /* pointer already gone */ }
    this.pointers.delete(event.pointerId);
    this.pinch = 0;
    if (this.carrying) { this.endPlacement(true); return; }
    const wasDragging = this.dragging;
    this.dragging = null;
    if (!this.active || !wasDragging) return;
    // A click, not a drag: select what is under the cursor and walk to it.
    const target = this.pickTarget();
    if (target && target !== "exit") this.focusTarget(target as UpgradeKey);
  };

  private pinchZoom(): void {
    const points = [...this.pointers.values()];
    if (points.length < 2) return;
    const distance = Math.hypot(points[0]!.x - points[1]!.x, points[0]!.y - points[1]!.y);
    if (this.pinch > 0) {
      this.cameraZoom = THREE.MathUtils.clamp(this.cameraZoom * (this.pinch / Math.max(1, distance)),
        InteriorWorld.ZOOM_MIN, InteriorWorld.ZOOM_MAX);
      this.frameCamera(this.canvas.clientWidth || 1, this.canvas.clientHeight || 1);
    }
    this.pinch = distance;
  }

  private readonly onWheel = (event: WheelEvent): void => {
    if (!this.active) return;
    event.preventDefault();
    this.cameraZoom = THREE.MathUtils.clamp(this.cameraZoom * (event.deltaY > 0 ? 1.08 : 0.93),
      InteriorWorld.ZOOM_MIN, InteriorWorld.ZOOM_MAX);
    this.frameCamera(this.canvas.clientWidth || 1, this.canvas.clientHeight || 1);
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.active) return;
    const key = event.key.toLowerCase();
    if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(key)) {
      event.preventDefault();
      this.keys.add(key);
      return;
    }
    if (key === "e" && !event.repeat) { event.preventDefault(); this.interact(); }
    else if (key === "escape" && !event.repeat) {
      event.preventDefault();
      // One Escape, one undo: with a machine in hand it cancels the PLACEMENT. Closing the
      // whole room mid-drag left the player outside holding an unresolved machine.
      if (this.carrying) { this.endPlacement(false); return; }
      this.setActive(false);
      this.callbacks.onExit?.();
    }
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.key.toLowerCase());
  };
}
