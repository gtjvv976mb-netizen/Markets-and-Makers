import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { clone as cloneSkeleton } from "three/addons/utils/SkeletonUtils.js";
import { BUSINESS, CIVIC_BUILDINGS, ISLANDS, PLOTS, CURRENCY_CODE } from "./data";
import { OFFICIAL_PRESENTATION_CAMERA, SOLARPUNK_MATERIALS } from "./artStandard";
import {
  characterHeightScale, dampWrappedYaw, headingYaw, planarSpeed, STANDARD_CHARACTER_HEIGHT_M,
  walkAnimationRate, yawCorrectionFor, type CharacterFrontAxis,
} from "./characterRig";
import {
  chooseCitizenDestination, citizenPopulation, citizenPurposeAtHour, createCitizenProfile, customerAppeal, navigationSurfaceCost,
  purposeForBusiness, representedPartySize, type CitizenDestination, type CitizenProfile, type CitizenPurpose,
} from "./citizenSimulation";
import { HIGHLANDS_WORLD_BASE, HIGHLANDS_WORLD_ENTRY, plotArrival, worldChunkAt } from "./highlandsWorld";
import { loadWorldDesigns } from "./worldDesigns";
import type { GameState } from "./state";
import type { RemotePlayer } from "./network";

interface WorldCallbacks {
  onPlotSelected: (plotId: string) => void;
  onMoved: () => void;
  onLoadProgress: (progress: number, label: string) => void;
}

interface Citizen {
  index: number;
  group: THREE.Group;
  model: THREE.Group;
  mixer: THREE.AnimationMixer;
  idleAction: THREE.AnimationAction | null;
  walkAction: THREE.AnimationAction | null;
  walking: boolean;
  profile: CitizenProfile;
  path: THREE.Vector3[];
  pathIndex: number;
  destination: CitizenDestination | null;
  purpose: CitizenPurpose;
  waitingUntil: number;
  nextDecisionAt: number;
  activityId: number | null;
  transactionIndicator: THREE.Sprite;
  groundY: number;
}

interface CitizenActivityTrip {
  activityId: number;
  plotId: string;
  remainingActors: number;
  expiresAt: number;
}

const CITIZEN_AVATARS: ReadonlyArray<{ file: string; frontAxis: CharacterFrontAxis }> = [
  { file: "av02-urban-gardener.glb", frontAxis: "+X" },
  { file: "av03-solar-technician.glb", frontAxis: "+X" },
  { file: "av04-market-grocer.glb", frontAxis: "+X" },
  { file: "av05-fabricator-engineer.glb", frontAxis: "+X" },
  { file: "av06-harbor-courier.glb", frontAxis: "+Z" },
  { file: "av07-community-chef.glb", frontAxis: "+X" },
  { file: "av08-cooperative-shopkeeper.glb", frontAxis: "+Z" },
  { file: "av10-repair-mechanic.glb", frontAxis: "+X" },
  { file: "av12-water-systems-biologist.glb", frontAxis: "+X" },
];

const CITIZEN_AVATAR_BASE = "./assets/avatars/mercedonians/runtime";
const PLAYER_WALK_SPEED_MPS = 2;
const VISIBLE_CITIZENS = 24;
const CITIZEN_DECISION_INTERVAL_SECONDS = 8;
const CITIZEN_TERRAIN_GRID = `${HIGHLANDS_WORLD_BASE}/terrain-grid.json`;

const CAMERA_ELEVATION_TANGENT = Math.tan(THREE.MathUtils.degToRad(OFFICIAL_PRESENTATION_CAMERA.elevationDegrees));
const MAX_WALK_STEP = 0.62;
const GRID_SEAM_PROBE = 0.025;

interface NavigationQueueNode { key: string; cellX: number; cellY: number; cost: number; score: number; }

function pushNavigationNode(heap: NavigationQueueNode[], node: NavigationQueueNode): void {
  heap.push(node);
  let index = heap.length - 1;
  while (index > 0) {
    const parent = Math.floor((index - 1) / 2);
    if (heap[parent]!.score <= node.score) break;
    heap[index] = heap[parent]!;
    index = parent;
  }
  heap[index] = node;
}

function popNavigationNode(heap: NavigationQueueNode[]): NavigationQueueNode | null {
  const first = heap[0];
  const last = heap.pop();
  if (!first || !last) return first ?? null;
  if (heap.length === 0) return first;
  let index = 0;
  while (true) {
    const left = index * 2 + 1;
    const right = left + 1;
    if (left >= heap.length) break;
    const child = right < heap.length && heap[right]!.score < heap[left]!.score ? right : left;
    if (heap[child]!.score >= last.score) break;
    heap[index] = heap[child]!;
    index = child;
  }
  heap[index] = last;
  return first;
}

export class World3D {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.OrthographicCamera;

  private readonly loader = new GLTFLoader();
  private readonly callbacks: WorldCallbacks;
  private readonly canvas: HTMLCanvasElement;
  private readonly clock = new THREE.Clock();
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly keys = new Set<string>();
  private readonly plotMeshes = new Map<string, THREE.Mesh>();
  private readonly plotDecor = new Map<string, THREE.Group>();
  private readonly walkableMeshes: THREE.Mesh[] = [];
  private readonly chunkRoots: Array<{ object: THREE.Object3D; cx: number; cy: number }> = [];
  private readonly down = new THREE.Vector3(0, -1, 0);
  private readonly citizens: Citizen[] = [];
  private readonly citizenTerrain = new Map<string, string>();
  private readonly citizenGroundCache = new Map<string, number | null>();
  private citizenDistrict = "";
  private citizenDecisionSequence = 0;
  private citizenActivityInitialized = false;
  private readonly citizenActivityCursor = new Map<string, number>();
  private readonly pendingCitizenTrips = new Map<string, CitizenActivityTrip[]>();
  private readonly peers = new Map<string, { group: THREE.Group; target: THREE.Vector3; seen: number; gaitPhase: number }>();
  private readonly peerRoot = new THREE.Group();
  private readonly avatar = new THREE.Group();
  private readonly cameraTarget = new THREE.Vector3();
  private readonly walkMarker = new THREE.Mesh(
    new THREE.RingGeometry(0.36, 0.58, 24),
    new THREE.MeshBasicMaterial({ color: 0xffdc67, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  private readonly waterMaterials = new Set<THREE.MeshStandardMaterial>();
  private readonly dynamicShadows = window.matchMedia("(min-width: 900px)").matches && (navigator.hardwareConcurrency ?? 4) >= 6;
  private sun: THREE.DirectionalLight | null = null;
  private clickTarget: THREE.Vector3 | null = null;
  private inputEnabled = true;
  private readonly buildings = new Map<string, THREE.Group>();
  private readonly buildingBannerHeights = new Map<string, number>();
  private buildingSignature = "";
  private buildingLoadToken = 0;
  private cameraYaw = Math.PI / 4;
  private cameraDistance = 34;
  private cameraHeight = this.cameraDistance * CAMERA_ELEVATION_TANGENT;
  private currentIsland = "hearth";
  private avatarGroundY = 1.02;
  private avatarMixer: THREE.AnimationMixer | null = null;
  private avatarIdleAction: THREE.AnimationAction | null = null;
  private avatarWalkAction: THREE.AnimationAction | null = null;
  private avatarWalking = false;
  private visibleChunkKey = "";
  private running = false;
  private saveAccumulator = 0;
  private onPositionCheckpoint: (() => void) | null = null;
  private onFrame: (() => void) | null = null;

  constructor(canvas: HTMLCanvasElement, callbacks: WorldCallbacks) {
    this.canvas = canvas;
    this.callbacks = callbacks;
    this.loader.setMeshoptDecoder(MeshoptDecoder);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.28;
    this.renderer.shadowMap.enabled = this.dynamicShadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setClearColor(0x0fa8bb, 1);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, window.innerWidth < 780 ? 1.15 : 1.45));
    this.camera = new THREE.OrthographicCamera(-30, 30, 20, -20, 0.1, 900);
    const initialAxisOffset = this.cameraDistance / Math.sqrt(2);
    this.camera.position.set(initialAxisOffset, this.cameraHeight, initialAxisOffset);
    this.scene.background = new THREE.Color(0x0fa8bb);
    this.scene.fog = new THREE.FogExp2(0x46bdca, 0.00042);
    this.setupLighting();
    this.setupAvatar();
    this.walkMarker.rotation.x = -Math.PI / 2;
    this.walkMarker.position.y = 1.2;
    this.walkMarker.visible = false;
    this.scene.add(this.walkMarker);
    this.setupInput();
    this.resize();
  }

  private setupLighting(): void {
    const hemisphere = new THREE.HemisphereLight(0xedfff5, 0x64714a, 1.38);
    this.scene.add(hemisphere);
    const sun = new THREE.DirectionalLight(0xffdda0, 3.08);
    sun.position.set(-90, 145, 85);
    sun.castShadow = this.dynamicShadows;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -64;
    sun.shadow.camera.right = 64;
    sun.shadow.camera.top = 64;
    sun.shadow.camera.bottom = -64;
    sun.shadow.camera.near = 20;
    sun.shadow.camera.far = 320;
    sun.shadow.bias = -0.00035;
    sun.shadow.normalBias = 0.035;
    this.scene.add(sun);
    this.scene.add(sun.target);
    this.sun = sun;
    const fill = new THREE.DirectionalLight(0xb8f5ef, 0.78);
    fill.position.set(100, 80, -120);
    this.scene.add(fill);
  }

  private setupAvatar(): void {
    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.62, 20),
      new THREE.MeshBasicMaterial({ color: 0x164e4d, transparent: true, opacity: 0.22, depthWrite: false }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.025;
    shadow.userData.keepWithCivicAvatar = true;
    this.avatar.add(shadow);

    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.38, 0.86, 5, 10),
      new THREE.MeshStandardMaterial({ color: 0xe8755f, roughness: 0.72 }),
    );
    body.position.y = 1.08;
    this.avatar.add(body);

    const vest = new THREE.Mesh(
      new THREE.CylinderGeometry(0.41, 0.37, 0.48, 10),
      new THREE.MeshStandardMaterial({ color: 0x1f7778, roughness: 0.68 }),
    );
    vest.position.y = 1.18;
    this.avatar.add(vest);

    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.29, 12, 8),
      new THREE.MeshStandardMaterial({ color: 0xc98962, roughness: 0.78 }),
    );
    head.position.y = 2.0;
    this.avatar.add(head);

    const limbMaterial = new THREE.MeshStandardMaterial({ color: 0x244f58, roughness: 0.76 });
    const skinMaterial = new THREE.MeshStandardMaterial({ color: 0xc98962, roughness: 0.78 });
    const legGeometry = new THREE.CapsuleGeometry(0.11, 0.44, 3, 7);
    const armGeometry = new THREE.CapsuleGeometry(0.09, 0.4, 3, 7);
    for (const side of [-1, 1]) {
      const leg = new THREE.Mesh(legGeometry, limbMaterial);
      leg.position.set(side * 0.18, 0.48, 0);
      this.avatar.add(leg);
      const arm = new THREE.Mesh(armGeometry, skinMaterial);
      arm.position.set(side * 0.46, 1.18, 0);
      arm.rotation.z = side * 0.14;
      this.avatar.add(arm);
    }

    const hair = new THREE.Mesh(
      new THREE.SphereGeometry(0.3, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.48),
      new THREE.MeshStandardMaterial({ color: 0x3b3028, roughness: 0.86 }),
    );
    hair.position.y = 2.09;
    this.avatar.add(hair);

    const backpack = new THREE.Mesh(
      new THREE.BoxGeometry(0.48, 0.6, 0.2, 1, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0xe0ad3d, roughness: 0.72 }),
    );
    // Fallback avatar is +Z-forward, matching the actor root used by movement.
    backpack.position.set(0, 1.2, -0.36);
    this.avatar.add(backpack);

    this.avatar.position.set(0, 1.02, 34);
    this.scene.add(this.avatar);
    this.scene.add(this.peerRoot);
  }

  private setupAvatarAnimations(model: THREE.Group, animations: THREE.AnimationClip[]): void {
    const idleClip = THREE.AnimationClip.findByName(animations, "Idle");
    const walkClip = THREE.AnimationClip.findByName(animations, "Walk");
    if (!idleClip || !walkClip) {
      console.warn("The civic avatar is missing its Idle or Walk animation; using fallback motion.");
      return;
    }
    this.avatarMixer = new THREE.AnimationMixer(model);
    this.avatarIdleAction = this.avatarMixer.clipAction(idleClip);
    this.avatarWalkAction = this.avatarMixer.clipAction(walkClip);
    this.avatarIdleAction.reset().setEffectiveWeight(1).play();
    this.avatarWalkAction.setEffectiveWeight(0).play();
    this.avatarWalking = false;
  }

  private updateAvatarAnimations(delta: number, movementSpeed: number): void {
    if (!this.avatarMixer || !this.avatarIdleAction || !this.avatarWalkAction) return;
    const walking = movementSpeed > 0.05;
    this.avatarWalkAction.timeScale = walkAnimationRate(movementSpeed);
    if (walking !== this.avatarWalking) {
      const incoming = walking ? this.avatarWalkAction : this.avatarIdleAction;
      const outgoing = walking ? this.avatarIdleAction : this.avatarWalkAction;
      incoming.reset().setEffectiveTimeScale(walking ? this.avatarWalkAction.timeScale : 1).setEffectiveWeight(1).play();
      incoming.crossFadeFrom(outgoing, 0.18, true);
      this.avatarWalking = walking;
    }
    this.avatarMixer.update(delta);
  }

  private styleMaterial(material: THREE.MeshStandardMaterial): void {
    const color = SOLARPUNK_MATERIALS[material.name];
    if (color) {
      // A base-color swatch should be white-tinted in Three.js; applying the
      // palette again multiplies the authored texture and crushes it to black.
      material.color.set(material.map ? 0xffffff : color);
    }
    // The authored terrain package intentionally reuses its painted swatch in the
    // normal slot for Blender previews. Three.js interprets that RGB art as a
    // tangent-space normal map, which turns sunlit grass nearly black. Keep real
    // building normal maps, but drop only these duplicate terrain bindings.
    if (material.normalMap && material.map && material.normalMap.source === material.map.source) material.normalMap = null;
    material.roughness = material.name.includes("WATER") || material.name.includes("GLASS")
      ? Math.min(material.roughness, 0.34)
      : THREE.MathUtils.clamp(material.roughness, 0.58, 0.9);
    if (material.name.includes("WATER")) {
      material.transparent = true;
      material.opacity = material.name === "MAT_MM_WATER" ? 0.76 : 0.9;
      material.metalness = 0.04;
      material.emissive = new THREE.Color(0x063f49);
      material.emissiveIntensity = 0.1;
      this.waterMaterials.add(material);
    }
    if (material.name.includes("GLASS")) {
      material.transparent = true;
      material.opacity = 0.58;
      material.depthWrite = false;
    }
    material.needsUpdate = true;
  }

  private setupInput(): void {
    window.addEventListener("keydown", (event) => {
      if (!this.inputEnabled) return;
      if (["INPUT", "TEXTAREA", "SELECT"].includes((event.target as HTMLElement | null)?.tagName ?? "")) return;
      this.keys.add(event.code);
      if (event.code === "KeyQ") this.cameraYaw -= Math.PI / 2;
      if (event.code === "KeyE") this.cameraYaw += Math.PI / 2;
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(event.code)) event.preventDefault();
    });
    window.addEventListener("keyup", (event) => this.keys.delete(event.code));
    window.addEventListener("blur", () => this.keys.clear());
    window.addEventListener("resize", () => this.resize());
    this.canvas.addEventListener("pointerdown", (event) => this.handlePointer(event));
    this.canvas.addEventListener("wheel", (event) => {
      if (!this.inputEnabled) return;
      event.preventDefault();
      this.cameraDistance = THREE.MathUtils.clamp(this.cameraDistance + Math.sign(event.deltaY) * 4, 24, 72);
      this.cameraHeight = this.cameraDistance * CAMERA_ELEVATION_TANGENT;
      this.resize();
    }, { passive: false });
  }

  private handlePointer(event: PointerEvent): void {
    if (!this.inputEnabled) return;
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const plots = this.raycaster.intersectObjects([...this.plotMeshes.values()], false);
    if (plots.length > 0) {
      const id = plots[0].object.userData.plotId as string;
      this.callbacks.onPlotSelected(id);
      return;
    }
    const hit = this.firstWalkableHit(
      this.raycaster.intersectObjects(this.walkableMeshes, false).filter((entry) => this.isEffectivelyVisible(entry.object)),
    );
    if (hit) {
      this.clickTarget = hit.point.clone();
      this.walkMarker.position.set(hit.point.x, hit.point.y + 0.12, hit.point.z);
      this.walkMarker.visible = true;
    }
  }

  async load(): Promise<void> {
    this.callbacks.onLoadProgress(0.06, "Preparing Mercedonia");
    const gltf = await this.loader.loadAsync(HIGHLANDS_WORLD_ENTRY, (event) => {
      if (event.total > 0) this.callbacks.onLoadProgress(0.08 + (event.loaded / event.total) * 0.22, "Opening the Highlands & Rivers world");
    });
    this.callbacks.onLoadProgress(0.76, "Mapping mountains, rivers and civic routes");
    gltf.scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.frustumCulled = true;
      const isTerrain = object.name.includes("TERRAIN") || object.name.includes("PLINTH");
      const isWater = object.name.includes("WATER");
      object.castShadow = this.dynamicShadows && !isTerrain && !isWater;
      object.receiveShadow = this.dynamicShadows && (isTerrain || object.name.includes("MESH"));
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (material instanceof THREE.MeshStandardMaterial) this.styleMaterial(material);
      }
    });
    const bridgeProxyMaterial = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthWrite: false,
      colorWrite: false,
    });
    bridgeProxyMaterial.name = "MAT_BRIDGE_WALK_PROXY";
    for (const object of gltf.scene.children) {
      const index = object.userData.chunk_index as unknown;
      if (Array.isArray(index) && index.length === 2 && index.every(Number.isFinite)) {
        const [cx, cy] = index as [number, number];
        this.chunkRoots.push({ object, cx, cy });
        object.traverse((child) => {
          if (child instanceof THREE.Mesh) this.walkableMeshes.push(child);
        });
        continue;
      }
      if (object.userData.family === "bridge") {
        const footprint = Array.isArray(object.userData.footprint_tiles) ? object.userData.footprint_tiles : [1, 1];
        // Overlap adjacent invisible proxies very slightly so visual plank seams
        // never become navigation gaps at a bridge segment boundary.
        const width = Math.max(0.5, Number(footprint[0] ?? 1) * 2 + 0.04);
        const depth = Math.max(0.5, Number(footprint[1] ?? 1) * 2 + 0.04);
        const walkY = Number(object.userData.walk_z_m ?? 1);
        const proxy = new THREE.Mesh(new THREE.BoxGeometry(width, 0.04, depth), bridgeProxyMaterial);
        proxy.name = `${object.name}_WALK_PROXY`;
        proxy.position.y = walkY - 0.02;
        proxy.castShadow = false;
        proxy.receiveShadow = false;
        object.add(proxy);
        this.walkableMeshes.push(proxy);
      }
      if (/BRIDGE|HARBOR|_BR_/.test(object.name)) {
        object.traverse((child) => {
          if (child instanceof THREE.Mesh) this.walkableMeshes.push(child);
        });
      }
    }
    gltf.scene.name = "MM_HIGHLANDS_RIVERS_WORLD_V1";
    gltf.scene.traverse((object) => {
      if (object.name === "MM_HRW_GOVERNMENT_FERRY") object.visible = false;
    });
    this.scene.add(gltf.scene);
    this.callbacks.onLoadProgress(0.84, "Planting the solarpunk garden city");
    try {
      const designs = await loadWorldDesigns(
        this.loader,
        (x, z) => this.sampleWalkHeight(x, z, true),
        this.dynamicShadows,
        (completed, total, label) => {
          this.callbacks.onLoadProgress(0.84 + (completed / total) * 0.08, `Placing ${label}`);
        },
      );
      for (const chunk of designs.chunks) {
        this.scene.add(chunk.object);
        this.chunkRoots.push(chunk);
      }
      if (designs.avatar) {
        for (const child of this.avatar.children) child.visible = Boolean(child.userData.keepWithCivicAvatar);
        this.avatar.add(designs.avatar.group);
        this.setupAvatarAnimations(designs.avatar.group, designs.avatar.animations);
      }
    }
    catch (error) {
      console.error("Required world-design scenery failed to load.", error);
      throw error;
    }
    this.callbacks.onLoadProgress(0.93, "Opening starter plots");
    this.updateChunkVisibility(true);
    this.avatarGroundY = this.sampleWalkHeight(this.avatar.position.x, this.avatar.position.z, true) ?? 1.02;
    this.createPlotMarkers();
    await this.loadCitizenNavigation();
    await this.createCitizens();
    this.callbacks.onLoadProgress(1, "Mercedonia garden city ready");
  }

  private materialNameAt(hit: THREE.Intersection): string {
    const mesh = hit.object as THREE.Mesh;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    return materials[hit.face?.materialIndex ?? 0]?.name ?? "";
  }

  private firstWalkableHit(hits: THREE.Intersection[]): THREE.Intersection | null {
    const first = hits[0];
    if (!first) return null;
    const material = this.materialNameAt(first);
    if (/WATER|RIVER|FOAM|CAVE_VOID/.test(material)) return null;
    return first;
  }

  private isEffectivelyVisible(object: THREE.Object3D): boolean {
    for (let current: THREE.Object3D | null = object; current; current = current.parent) {
      if (!current.visible) return false;
    }
    return true;
  }

  private raycastWalkHeight(x: number, z: number, allowHidden: boolean): number | null {
    this.raycaster.set(new THREE.Vector3(x, 40, z), this.down);
    const hits = this.raycaster.intersectObjects(this.walkableMeshes, false)
      .filter((hit) => allowHidden || this.isEffectivelyVisible(hit.object));
    return this.firstWalkableHit(hits)?.point.y ?? null;
  }

  private sampleWalkHeight(x: number, z: number, allowHidden = false): number | null {
    const direct = this.raycastWalkHeight(x, z, allowHidden);
    if (direct !== null) return direct;

    // Authored tile keylines intentionally leave a hairline reveal at the 2 m
    // grid edge. Probe both sides of a seam, but only bridge it when opposite
    // walk surfaces agree in height. A coast/water edge has no matching pair,
    // and a cliff step exceeds MAX_WALK_STEP, so both remain blocked.
    const axisPairs = [
      [[GRID_SEAM_PROBE, 0], [-GRID_SEAM_PROBE, 0]],
      [[0, GRID_SEAM_PROBE], [0, -GRID_SEAM_PROBE]],
    ] as const;
    for (const pair of axisPairs) {
      const first = this.raycastWalkHeight(x + pair[0][0], z + pair[0][1], allowHidden);
      const second = this.raycastWalkHeight(x + pair[1][0], z + pair[1][1], allowHidden);
      if (first !== null && second !== null && Math.abs(first - second) <= MAX_WALK_STEP) {
        return (first + second) / 2;
      }
    }

    // At a four-tile corner, axial probes still lie on keylines. Require all
    // four quadrants to be walkable and mutually compatible before crossing.
    const corners = [
      [GRID_SEAM_PROBE, GRID_SEAM_PROBE],
      [GRID_SEAM_PROBE, -GRID_SEAM_PROBE],
      [-GRID_SEAM_PROBE, GRID_SEAM_PROBE],
      [-GRID_SEAM_PROBE, -GRID_SEAM_PROBE],
    ] as const;
    const cornerHeights = corners.map(([dx, dz]) => this.raycastWalkHeight(x + dx, z + dz, allowHidden));
    if (cornerHeights.every((height): height is number => height !== null)) {
      const minimum = Math.min(...cornerHeights);
      const maximum = Math.max(...cornerHeights);
      if (maximum - minimum <= MAX_WALK_STEP) {
        return cornerHeights.reduce((sum, height) => sum + height, 0) / cornerHeights.length;
      }
    }
    return null;
  }

  private updateChunkVisibility(force = false): void {
    const chunk = worldChunkAt(this.avatar.position.x, this.avatar.position.z);
    if (!chunk) return;
    const key = `${chunk[0]}:${chunk[1]}`;
    if (!force && key === this.visibleChunkKey) return;
    this.visibleChunkKey = key;
    for (const entry of this.chunkRoots) {
      const padding = Number(entry.object.userData.visibilityPaddingChunks ?? 0);
      entry.object.visible = Math.abs(entry.cx - chunk[0]) <= 3 + padding && Math.abs(entry.cy - chunk[1]) <= 3 + padding;
    }
  }

  private createPlotMarkers(): void {
    for (const plot of PLOTS) {
      const groundY = this.sampleWalkHeight(plot.x, plot.z, true) ?? 1.02;
      const color = new THREE.Color(0xf2c452);
      const material = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.32,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const marker = new THREE.Mesh(new THREE.PlaneGeometry(plot.width, plot.depth), material);
      marker.rotation.x = -Math.PI / 2;
      marker.position.set(plot.x, groundY + 0.07, plot.z);
      marker.userData.plotId = plot.id;
      marker.name = `MM_PLOT_${plot.id}`;
      this.scene.add(marker);
      this.plotMeshes.set(plot.id, marker);

      const decor = new THREE.Group();
      decor.position.set(plot.x, groundY + 0.09, plot.z);
      const outline = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(plot.width, 0.08, plot.depth)),
        new THREE.LineBasicMaterial({ color: 0xffdc67, transparent: true, opacity: 0.95 }),
      );
      decor.add(outline);
      const beaconGeometry = new THREE.CylinderGeometry(0.13, 0.13, 1.2, 8);
      const beaconMaterial = new THREE.MeshBasicMaterial({ color: 0xffdc67, transparent: true, opacity: 0.78 });
      for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const beacon = new THREE.Mesh(beaconGeometry, beaconMaterial);
        beacon.position.set(x * plot.width * 0.47, 0.62, z * plot.depth * 0.47);
        decor.add(beacon);
      }
      const labelCanvas = document.createElement("canvas");
      labelCanvas.width = 512;
      labelCanvas.height = 128;
      const context = labelCanvas.getContext("2d");
      if (context) {
        context.fillStyle = "rgba(16,67,70,.92)";
        context.beginPath();
        context.roundRect(8, 8, 496, 112, 30);
        context.fill();
        context.fillStyle = "#ffdd73";
        context.font = "800 34px system-ui";
        context.textAlign = "center";
        context.fillText("AVAILABLE PLOT", 256, 54);
        context.fillStyle = "#ffffff";
        context.font = "700 25px system-ui";
        context.fillText(`${plot.name} · ${plot.price} ${CURRENCY_CODE}`, 256, 92);
      }
      const labelTexture = new THREE.CanvasTexture(labelCanvas);
      labelTexture.colorSpace = THREE.SRGBColorSpace;
      const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture, transparent: true, depthWrite: false }));
      label.position.y = 3.8;
      label.scale.set(8.4, 2.1, 1);
      label.userData.plotLabel = true;
      decor.add(label);
      this.scene.add(decor);
      this.plotDecor.set(plot.id, decor);
    }
  }

  private normalizeCitizenModel(source: THREE.Object3D): THREE.Group {
    const model = new THREE.Group();
    const avatar = cloneSkeleton(source);
    const bounds = new THREE.Box3().setFromObject(avatar, true);
    const size = bounds.getSize(new THREE.Vector3());
    const scale = characterHeightScale(size.y);
    avatar.scale.setScalar(scale);
    avatar.position.set(
      -(bounds.min.x + bounds.max.x) * 0.5 * scale,
      -bounds.min.y * scale,
      -(bounds.min.z + bounds.max.z) * 0.5 * scale,
    );
    avatar.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.castShadow = this.dynamicShadows;
      object.receiveShadow = true;
      object.frustumCulled = true;
    });
    model.add(avatar);
    model.userData.characterHeightM = STANDARD_CHARACTER_HEIGHT_M;
    return model;
  }

  private makeCitizenTransactionIndicator(): THREE.Sprite {
    const canvas = document.createElement("canvas");
    canvas.width = 96;
    canvas.height = 96;
    const context = canvas.getContext("2d");
    if (context) {
      context.fillStyle = "rgba(8,47,53,.92)";
      context.beginPath();
      context.arc(48, 48, 43, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = "#f4ad3e";
      context.lineWidth = 7;
      context.stroke();
      context.fillStyle = "#fff8df";
      context.font = "800 42px Georgia";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText("M", 48, 51);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const indicator = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
    indicator.position.y = STANDARD_CHARACTER_HEIGHT_M + .48;
    indicator.scale.set(.64, .64, 1);
    indicator.visible = false;
    return indicator;
  }

  private async loadCitizenNavigation(): Promise<void> {
    const response = await fetch(CITIZEN_TERRAIN_GRID);
    if (!response.ok) throw new Error(`Unable to load citizen navigation grid (${response.status})`);
    const grid = await response.json() as {
      rows?: Array<{ y: number; runs: Array<{ x0: number; x1: number; surface: string }> }>;
    };
    for (const row of grid.rows ?? []) {
      for (const run of row.runs ?? []) {
        for (let cellX = run.x0; cellX <= run.x1; cellX += 1) {
          this.citizenTerrain.set(`${cellX}:${row.y}`, run.surface);
        }
      }
    }
    if (this.citizenTerrain.size === 0) throw new Error("Citizen navigation grid contains no terrain cells");
  }

  private async createCitizens(): Promise<void> {
    this.callbacks.onLoadProgress(0.94, "Welcoming Mercedonians");
    const templates = (await Promise.all(CITIZEN_AVATARS.map(async (definition) => {
      const url = `${CITIZEN_AVATAR_BASE}/${definition.file}`;
      try {
        const gltf = await this.loader.loadAsync(url);
        return {
          model: this.normalizeCitizenModel(gltf.scene),
          animations: gltf.animations,
          yawCorrection: yawCorrectionFor(definition.frontAxis),
        };
      }
      catch (error) {
        console.warn(`Citizen model unavailable: ${url}`, error);
        return null;
      }
    }))).filter((template): template is {
      model: THREE.Group;
      animations: THREE.AnimationClip[];
      yawCorrection: number;
    } => template !== null);
    if (templates.length === 0) return;
    for (let index = 0; index < VISIBLE_CITIZENS; index += 1) {
      const group = new THREE.Group();
      const shadow = new THREE.Mesh(
        new THREE.CircleGeometry(0.36, 12),
        new THREE.MeshBasicMaterial({ color: 0x123d3f, transparent: true, opacity: 0.18, depthWrite: false }),
      );
      shadow.rotation.x = -Math.PI / 2;
      shadow.position.y = 0.02;
      group.add(shadow);
      const template = templates[index % templates.length];
      const model = cloneSkeleton(template.model) as THREE.Group;
      model.rotation.y = template.yawCorrection;
      group.add(model);
      const mixer = new THREE.AnimationMixer(model);
      const idle = THREE.AnimationClip.findByName(template.animations, "Idle");
      const walk = THREE.AnimationClip.findByName(template.animations, "Walk");
      let idleAction: THREE.AnimationAction | null = null;
      let walkAction: THREE.AnimationAction | null = null;
      if (idle) {
        idleAction = mixer.clipAction(idle);
        idleAction.time = (index * .137) % idle.duration;
        idleAction.play();
      }
      if (walk) {
        walkAction = mixer.clipAction(walk);
        walkAction.time = (index * 0.173) % walk.duration;
        walkAction.setEffectiveWeight(0);
        walkAction.play();
      }
      const transactionIndicator = this.makeCitizenTransactionIndicator();
      group.add(transactionIndicator);
      group.name = `MM_MERCEDONIAN_${String(index + 1).padStart(2, "0")}`;
      this.scene.add(group);
      this.citizens.push({
        index,
        group,
        model,
        mixer,
        idleAction,
        walkAction,
        walking: false,
        profile: createCitizenProfile(index),
        path: [],
        pathIndex: 0,
        destination: null,
        purpose: "home",
        waitingUntil: 0,
        nextDecisionAt: index * .16,
        activityId: null,
        transactionIndicator,
        groundY: 1.04,
      });
    }
  }

  private citizenGroundAtCell(cellX: number, cellY: number): number | null {
    const key = `${cellX}:${cellY}`;
    if (this.citizenGroundCache.has(key)) return this.citizenGroundCache.get(key) ?? null;
    const ground = this.sampleWalkHeight(cellX * 2, -cellY * 2, true);
    this.citizenGroundCache.set(key, ground);
    return ground;
  }

  private citizenPointBlocked(x: number, z: number): boolean {
    for (const plot of PLOTS) {
      if (plot.island !== this.currentIsland) continue;
      if (Math.abs(x - plot.x) < plot.width / 2 + .7 && Math.abs(z - plot.z) < plot.depth / 2 + .7) return true;
    }
    for (const building of CIVIC_BUILDINGS) {
      if (building.island !== this.currentIsland) continue;
      if (Math.hypot(x - building.x, z - building.z) < 6.5) return true;
    }
    return false;
  }

  private citizenCellBlocked(cellX: number, cellY: number): boolean {
    return this.citizenPointBlocked(cellX * 2, -cellY * 2);
  }

  private citizenCellWalkable(cellX: number, cellY: number): boolean {
    const surface = this.citizenTerrain.get(`${cellX}:${cellY}`) ?? "";
    return Number.isFinite(navigationSurfaceCost(surface))
      && !this.citizenCellBlocked(cellX, cellY)
      && this.citizenGroundAtCell(cellX, cellY) !== null;
  }

  private nearestCitizenCell(
    x: number,
    z: number,
  ): { cellX: number; cellY: number } | null {
    const originX = Math.round(x / 2);
    const originY = Math.round(-z / 2);
    for (let radius = 0; radius <= 6; radius += 1) {
      const candidates: Array<{ cellX: number; cellY: number; distance: number }> = [];
      for (let dx = -radius; dx <= radius; dx += 1) {
        for (let dy = -radius; dy <= radius; dy += 1) {
          if (radius > 0 && Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
          const cellX = originX + dx;
          const cellY = originY + dy;
          if (!this.citizenCellWalkable(cellX, cellY)) continue;
          candidates.push({ cellX, cellY, distance: Math.hypot(cellX * 2 - x, -cellY * 2 - z) });
        }
      }
      candidates.sort((a, b) => a.distance - b.distance);
      if (candidates[0]) return candidates[0];
    }
    return null;
  }

  private findCitizenPath(
    from: { x: number; z: number },
    destination: CitizenDestination,
  ): THREE.Vector3[] {
    const start = this.nearestCitizenCell(from.x, from.z);
    const end = this.nearestCitizenCell(destination.x, destination.z);
    if (!start || !end) return [];
    const endKey = `${end.cellX}:${end.cellY}`;
    const queue: NavigationQueueNode[] = [];
    const cameFrom = new Map<string, string>();
    const cells = new Map<string, readonly [number, number]>();
    const bestCost = new Map<string, number>();
    const startKey = `${start.cellX}:${start.cellY}`;
    bestCost.set(startKey, 0);
    cells.set(startKey, [start.cellX, start.cellY]);
    pushNavigationNode(queue, {
      key: startKey,
      cellX: start.cellX,
      cellY: start.cellY,
      cost: 0,
      score: Math.hypot(end.cellX - start.cellX, end.cellY - start.cellY),
    });
    const directions = [
      [1, 0], [-1, 0], [0, 1], [0, -1],
      [1, 1], [1, -1], [-1, 1], [-1, -1],
    ] as const;
    let reached = false;
    for (let guard = 0; queue.length > 0 && guard < 7_500; guard += 1) {
      const current = popNavigationNode(queue)!;
      if (current.key === endKey) { reached = true; break; }
      const currentCost = bestCost.get(current.key);
      const currentY = this.citizenGroundAtCell(current.cellX, current.cellY);
      // A cheaper copy may have entered the heap after this one.
      if (currentCost === undefined || current.cost !== currentCost || currentY === null) continue;
      for (const [dx, dy] of directions) {
        const nextX = current.cellX + dx;
        const nextY = current.cellY + dy;
        if (!this.citizenCellWalkable(nextX, nextY)) continue;
        if (dx !== 0 && dy !== 0
          && (!this.citizenCellWalkable(current.cellX + dx, current.cellY)
            || !this.citizenCellWalkable(current.cellX, current.cellY + dy))) continue;
        const nextGround = this.citizenGroundAtCell(nextX, nextY);
        if (nextGround === null || Math.abs(nextGround - currentY) > MAX_WALK_STEP) continue;
        const nextKey = `${nextX}:${nextY}`;
        const surface = this.citizenTerrain.get(nextKey) ?? "";
        const stepCost = navigationSurfaceCost(surface) * (dx !== 0 && dy !== 0 ? Math.SQRT2 : 1);
        const candidate = currentCost + stepCost;
        if (candidate >= (bestCost.get(nextKey) ?? Number.POSITIVE_INFINITY)) continue;
        bestCost.set(nextKey, candidate);
        cameFrom.set(nextKey, current.key);
        cells.set(nextKey, [nextX, nextY]);
        pushNavigationNode(queue, {
          key: nextKey,
          cellX: nextX,
          cellY: nextY,
          cost: candidate,
          score: candidate + Math.hypot(end.cellX - nextX, end.cellY - nextY),
        });
      }
    }
    if (!reached) return [];
    const routeKeys: string[] = [endKey];
    while (routeKeys.at(-1) !== startKey) {
      const previous = cameFrom.get(routeKeys.at(-1)!);
      if (!previous) return [];
      routeKeys.push(previous);
    }
    routeKeys.reverse();
    const route = routeKeys.slice(1).flatMap((key) => {
      const cell = cells.get(key);
      if (!cell) return [];
      const ground = this.citizenGroundAtCell(cell[0], cell[1]);
      return ground === null ? [] : [new THREE.Vector3(cell[0] * 2, ground, -cell[1] * 2)];
    });
    const finalGround = this.sampleWalkHeight(destination.x, destination.z, true);
    if (finalGround === null || this.citizenPointBlocked(destination.x, destination.z)) return [];
    const startGround = this.citizenGroundAtCell(start.cellX, start.cellY);
    if (startGround === null) return [];
    const segmentStart = route.at(-1) ?? new THREE.Vector3(start.cellX * 2, startGround, -start.cellY * 2);
    const finalDistance = Math.hypot(destination.x - segmentStart.x, destination.z - segmentStart.z);
    const finalSteps = Math.max(1, Math.ceil(finalDistance / .5));
    let previousGround = segmentStart.y;
    const approach: THREE.Vector3[] = [];
    for (let step = 1; step <= finalSteps; step += 1) {
      const progress = step / finalSteps;
      const x = THREE.MathUtils.lerp(segmentStart.x, destination.x, progress);
      const z = THREE.MathUtils.lerp(segmentStart.z, destination.z, progress);
      if (this.citizenPointBlocked(x, z)) return [];
      const ground = this.sampleWalkHeight(x, z, true);
      if (ground === null || Math.abs(ground - previousGround) > MAX_WALK_STEP) return [];
      approach.push(new THREE.Vector3(x, ground, z));
      previousGround = ground;
    }
    route.push(...approach);
    return route;
  }

  private citizenDestinations(state: GameState): CitizenDestination[] {
    const district = ISLANDS.find((entry) => entry.id === this.currentIsland) ?? ISLANDS[0];
    const destinations: CitizenDestination[] = [];
    const fallbackPurposes: CitizenPurpose[] = ["home", "work", "essential", "meal", "wellness", "leisure", "civic"];
    for (let index = 0; index < fallbackPurposes.length; index += 1) {
      const purpose = fallbackPurposes[index]!;
      const fallbackX = district.spawnX + ((index % 3) - 1) * 4;
      const fallbackZ = district.spawnZ + (Math.floor(index / 3) - 1) * 4;
      const fallbackCell = this.nearestCitizenCell(fallbackX, fallbackZ);
      destinations.push({
        id: `district-${district.id}-${purpose}`,
        island: district.id,
        kind: purpose === "home" ? "home" : "district",
        purpose,
        x: fallbackCell ? fallbackCell.cellX * 2 : fallbackX,
        z: fallbackCell ? -fallbackCell.cellY * 2 : fallbackZ,
        operational: true,
        appeal: .42,
        capacity: 99,
        priceIndex: 1,
      });
    }
    const civicPurpose = (id: string): CitizenPurpose => {
      if (id === "homes") return "home";
      if (id === "clinic") return "wellness";
      if (id === "academy" || id === "registry" || id === "cityhall") return "civic";
      return "work";
    };
    for (const [index, building] of CIVIC_BUILDINGS.filter((entry) => entry.island === district.id).entries()) {
      destinations.push({
        id: `civic-${building.id}`,
        island: building.island,
        kind: building.id === "homes" ? "home" : "civic",
        purpose: civicPurpose(building.id),
        x: building.x + (index % 2 === 0 ? 7.5 : -7.5),
        z: building.z + (index % 3 - 1) * 2,
        operational: true,
        appeal: 1.05,
        capacity: 20,
        priceIndex: 1,
      });
    }
    for (const record of Object.values(state.portfolio)) {
      if (!record.buildingPlaced || !record.license) continue;
      const plot = PLOTS.find((entry) => entry.id === record.plotId);
      if (!plot || plot.island !== district.id) continue;
      const arrival = plotArrival(plot);
      const activeBusiness = record.plotId === state.ownedPlotId;
      const operational = !record.brokenDown
        && record.condition > 0
        && (!activeBusiness || (!state.suppliesCut && state.staff > 0));
      destinations.push({
        id: `business-${plot.id}`,
        island: plot.island,
        kind: "business",
        purpose: purposeForBusiness(record.license),
        x: arrival.x,
        z: arrival.z,
        operational,
        appeal: customerAppeal({
          staff: state.staff,
          appealLevel: record.upgrades.appeal,
          qualityLevel: record.upgrades.yield,
          reputation: state.reputation,
          specialization: state.specialization,
          sponsored: state.sponsoredUntil > Date.now(),
        }),
        capacity: operational ? 2 + record.upgrades.capacity * 3 + Math.min(4, state.staff) : 0,
        priceIndex: record.plotId === state.ownedPlotId ? state.servicePriceIndex : 1,
        plotId: plot.id,
        license: record.license,
      });
    }
    return destinations;
  }

  private setCitizenWalking(citizen: Citizen, walking: boolean): void {
    if (citizen.walking === walking) return;
    citizen.walking = walking;
    const incoming = walking ? citizen.walkAction : citizen.idleAction;
    const outgoing = walking ? citizen.idleAction : citizen.walkAction;
    if (incoming) {
      incoming.reset().setEffectiveWeight(1).play();
      if (outgoing) incoming.crossFadeFrom(outgoing, .2, true);
    }
  }

  private assignCitizenTrip(
    citizen: Citizen,
    destination: CitizenDestination,
    elapsed: number,
    activityId: number | null = null,
  ): boolean {
    const path = this.findCitizenPath(citizen.group.position, destination);
    if (path.length === 0) return false;
    citizen.path = path;
    citizen.pathIndex = 0;
    citizen.destination = destination;
    citizen.purpose = destination.purpose;
    citizen.activityId = activityId;
    citizen.waitingUntil = 0;
    citizen.nextDecisionAt = elapsed + CITIZEN_DECISION_INTERVAL_SECONDS;
    citizen.transactionIndicator.visible = false;
    this.setCitizenWalking(citizen, true);
    return true;
  }

  private planCitizenRoutine(citizen: Citizen, state: GameState, elapsed: number): void {
    const gameHour = (new Date().getHours() + elapsed / 75) % 24;
    const purpose = citizenPurposeAtHour(gameHour, citizen.index);
    const destinations = this.citizenDestinations(state);
    const destination = chooseCitizenDestination(
      destinations,
      purpose,
      citizen.profile,
      citizen.group.position,
      citizen.index * 65_537 + ++this.citizenDecisionSequence + Math.floor(gameHour * 12),
    ) ?? destinations.find((entry) => entry.purpose === "home") ?? null;
    if (!destination || !this.assignCitizenTrip(citizen, destination, elapsed)) {
      citizen.nextDecisionAt = elapsed + 3;
      this.setCitizenWalking(citizen, false);
    }
  }

  private resetCitizenDistrict(state: GameState, elapsed: number): void {
    this.citizenDistrict = state.island;
    const district = ISLANDS.find((entry) => entry.id === state.island) ?? ISLANDS[0];
    for (const citizen of this.citizens) {
      const angle = citizen.index * 2.399963;
      const radius = 4 + (citizen.index % 5) * 1.4;
      const cell = this.nearestCitizenCell(
        district.spawnX + Math.cos(angle) * radius,
        district.spawnZ + Math.sin(angle) * radius,
      );
      const ground = cell ? this.citizenGroundAtCell(cell.cellX, cell.cellY) : null;
      citizen.group.position.set(
        cell ? cell.cellX * 2 : district.spawnX,
        ground ?? this.sampleWalkHeight(district.spawnX, district.spawnZ, true) ?? 1.02,
        cell ? -cell.cellY * 2 : district.spawnZ,
      );
      citizen.group.visible = true;
      citizen.groundY = citizen.group.position.y;
      citizen.path = [];
      citizen.pathIndex = 0;
      citizen.destination = null;
      citizen.activityId = null;
      citizen.waitingUntil = 0;
      citizen.nextDecisionAt = elapsed + citizen.index * .12;
      citizen.transactionIndicator.visible = false;
      this.setCitizenWalking(citizen, false);
    }
  }

  private syncCitizenActivity(state: GameState, elapsed: number): void {
    // Existing save history is already settled; only animate events created after
    // this world loaded. Each district keeps its own cursor so a purchase made on
    // another island is still waiting when the player travels there.
    if (!this.citizenActivityInitialized) {
      for (const island of ISLANDS) this.citizenActivityCursor.set(island.id, state.citizenActivitySequence);
      this.citizenActivityInitialized = true;
      return;
    }
    const islandId = this.currentIsland;
    const cursor = this.citizenActivityCursor.get(islandId) ?? state.citizenActivitySequence;
    const activities = state.citizenActivity
      .filter((entry) => entry.island === islandId && entry.id > cursor)
      .sort((a, b) => a.id - b.id);
    this.citizenActivityCursor.set(islandId, state.citizenActivitySequence);
    const queue = this.pendingCitizenTrips.get(islandId) ?? [];
    const population = citizenPopulation(
      Object.values(state.portfolio).filter((record) => record.buildingPlaced).length,
      state.reputation,
      state.visitorsServed,
    );
    const party = representedPartySize(population, VISIBLE_CITIZENS, 0);
    for (const activity of activities) {
      if (queue.some((entry) => entry.activityId === activity.id)) continue;
      queue.push({
        activityId: activity.id,
        plotId: activity.plotId,
        remainingActors: Math.min(6, Math.max(1, Math.ceil(activity.visitors / Math.max(1, party)))),
        expiresAt: elapsed + 90,
      });
    }
    this.pendingCitizenTrips.set(islandId, queue);

    if (queue.length === 0) return;
    const destinations = this.citizenDestinations(state);
    for (const trip of queue) {
      if (trip.remainingActors <= 0 || trip.expiresAt <= elapsed) continue;
      const destination = destinations.find((entry) => entry.plotId === trip.plotId);
      // A settled cohort never walks through a closed or missing business. Keep
      // it queued briefly in case repairs finish, otherwise let it expire safely.
      if (!destination?.operational || destination.capacity <= 0) continue;
      const available = this.citizens
        .filter((citizen) => citizen.activityId === null)
        .sort((a, b) => {
          const aDistance = (a.group.position.x - destination.x) ** 2 + (a.group.position.z - destination.z) ** 2;
          const bDistance = (b.group.position.x - destination.x) ** 2 + (b.group.position.z - destination.z) ** 2;
          return aDistance - bDistance;
        });
      for (const citizen of available) {
        if (trip.remainingActors <= 0) break;
        if (this.assignCitizenTrip(citizen, destination, elapsed, trip.activityId)) trip.remainingActors -= 1;
      }
    }
    this.pendingCitizenTrips.set(islandId, queue.filter((entry) => entry.remainingActors > 0 && entry.expiresAt > elapsed));
  }

  /** Colour derived from the peer id so the same player looks the same to everyone. */
  private peerColor(playerId: string): THREE.Color {
    let hash = 0;
    for (let i = 0; i < playerId.length; i += 1) hash = (hash * 31 + playerId.charCodeAt(i)) >>> 0;
    return new THREE.Color().setHSL((hash % 360) / 360, 0.52, 0.56);
  }

  private makePeerAvatar(playerId: string): THREE.Group {
    const group = new THREE.Group();
    const tint = this.peerColor(playerId);
    const visualRoot = new THREE.Group();
    visualRoot.name = "MM_PEER_VISUAL";
    group.add(visualRoot);

    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.38, 20),
      new THREE.MeshBasicMaterial({ color: 0x0d3b3f, transparent: true, opacity: 0.2, depthWrite: false }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.02;
    group.add(shadow);

    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.28, 0.58, 4, 10),
      new THREE.MeshStandardMaterial({ color: tint, roughness: 0.72 }),
    );
    body.position.y = 1.02;
    visualRoot.add(body);

    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.25, 16, 12),
      new THREE.MeshStandardMaterial({ color: 0xf0d0ae, roughness: 0.86 }),
    );
    head.position.y = 1.56;
    visualRoot.add(head);

    const limbMaterial = new THREE.MeshStandardMaterial({ color: tint.clone().multiplyScalar(.72), roughness: .76 });
    for (const side of [-1, 1]) {
      const legPivot = new THREE.Group();
      legPivot.name = side < 0 ? "MM_PEER_LEFT_LEG" : "MM_PEER_RIGHT_LEG";
      legPivot.position.set(side * .14, .58, 0);
      const leg = new THREE.Mesh(new THREE.CapsuleGeometry(.09, .4, 3, 8), limbMaterial);
      leg.position.y = -.29;
      legPivot.add(leg);
      visualRoot.add(legPivot);

      const armPivot = new THREE.Group();
      armPivot.name = side < 0 ? "MM_PEER_LEFT_ARM" : "MM_PEER_RIGHT_ARM";
      armPivot.position.set(side * .35, 1.27, 0);
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(.07, .36, 3, 8), limbMaterial);
      arm.position.y = -.25;
      armPivot.add(arm);
      visualRoot.add(armPivot);
    }

    const marker = new THREE.Mesh(
      new THREE.ConeGeometry(0.22, 0.42, 10),
      new THREE.MeshBasicMaterial({ color: tint, transparent: true, opacity: 0.9 }),
    );
    marker.position.y = STANDARD_CHARACTER_HEIGHT_M + .42;
    marker.rotation.x = Math.PI;
    marker.userData.peerMarker = true;
    group.add(marker);
    group.userData.characterHeightM = STANDARD_CHARACTER_HEIGHT_M;

    return group;
  }

  /** Apply one authoritative island snapshot. Positions are eased, not snapped. */
  setRemotePlayers(players: RemotePlayer[]): void {
    const now = performance.now();
    for (const player of players) {
      let peer = this.peers.get(player.playerId);
      if (!peer) {
        const group = this.makePeerAvatar(player.playerId);
        const groundY = this.sampleWalkHeight(player.x, player.z, true) ?? 1.02;
        group.position.set(player.x, groundY, player.z);
        this.peerRoot.add(group);
        peer = {
          group,
          target: new THREE.Vector3(player.x, groundY, player.z),
          seen: now,
          gaitPhase: (group.id % 17) / 17 * Math.PI * 2,
        };
        this.peers.set(player.playerId, peer);
      }
      peer.target.set(player.x, this.sampleWalkHeight(player.x, player.z, true) ?? peer.target.y, player.z);
      peer.seen = now;
    }
    for (const [id, peer] of this.peers) {
      if (now - peer.seen < 8000) continue;
      this.peerRoot.remove(peer.group);
      peer.group.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
        else material?.dispose();
      });
      this.peers.delete(id);
    }
  }

  get peerCount(): number { return this.peers.size; }

  /** The server may reject a step; when it does we accept its position. */
  applyCorrection(x: number, z: number, state: GameState): void {
    state.player = { x, z };
    this.teleportToState(state);
  }

  private updatePeers(delta: number, elapsed: number): void {
    const ease = Math.min(1, delta * 7.5);
    for (const peer of this.peers.values()) {
      const previousX = peer.group.position.x;
      const previousZ = peer.group.position.z;
      peer.group.position.lerp(peer.target, ease);
      peer.group.position.y = peer.target.y;
      const movedX = peer.group.position.x - previousX;
      const movedZ = peer.group.position.z - previousZ;
      const speed = planarSpeed(movedX, movedZ, delta);
      if (speed > .01) {
        peer.group.rotation.y = dampWrappedYaw(peer.group.rotation.y, headingYaw(movedX, movedZ), delta, 10);
      }
      const gaitRate = walkAnimationRate(speed);
      if (gaitRate > 0) peer.gaitPhase += delta * Math.PI * 2 * gaitRate;
      const stride = gaitRate > 0 ? Math.sin(peer.gaitPhase) * .42 : 0;
      const poseBlend = 1 - Math.exp(-delta * 12);
      const leftLeg = peer.group.getObjectByName("MM_PEER_LEFT_LEG")!;
      const rightLeg = peer.group.getObjectByName("MM_PEER_RIGHT_LEG")!;
      const leftArm = peer.group.getObjectByName("MM_PEER_LEFT_ARM")!;
      const rightArm = peer.group.getObjectByName("MM_PEER_RIGHT_ARM")!;
      leftLeg.rotation.x = THREE.MathUtils.lerp(leftLeg.rotation.x, stride, poseBlend);
      rightLeg.rotation.x = THREE.MathUtils.lerp(rightLeg.rotation.x, -stride, poseBlend);
      leftArm.rotation.x = THREE.MathUtils.lerp(leftArm.rotation.x, -stride * .8, poseBlend);
      rightArm.rotation.x = THREE.MathUtils.lerp(rightArm.rotation.x, stride * .8, poseBlend);
      const visualRoot = peer.group.getObjectByName("MM_PEER_VISUAL")!;
      const soleCompensation = -.49 * (1 - Math.cos(stride));
      visualRoot.position.y = THREE.MathUtils.lerp(visualRoot.position.y, soleCompensation, poseBlend);
      const marker = peer.group.children.find((child) => child.userData.peerMarker);
      if (marker) marker.position.y = STANDARD_CHARACTER_HEIGHT_M + .42 + Math.sin(elapsed * 3 + peer.group.position.z) * 0.08;
    }
  }

  /** Called once per rendered frame, so screen-space labels can track the camera. */
  setFrameCallback(callback: () => void): void {
    this.onFrame = callback;
  }

  /**
   * Project world points into canvas pixels so HTML labels can sit over the scene.
   * Anything behind the camera or off-canvas is reported as off-screen.
   */
  project(points: Array<{ id: string; x: number; y: number; z: number }>): Array<{ id: string; sx: number; sy: number; onScreen: boolean }> {
    const width = Math.max(1, this.canvas.clientWidth);
    const height = Math.max(1, this.canvas.clientHeight);
    const vector = new THREE.Vector3();
    return points.map((point) => {
      vector.set(point.x, point.y, point.z).project(this.camera);
      const sx = (vector.x * 0.5 + 0.5) * width;
      const sy = (-vector.y * 0.5 + 0.5) * height;
      const onScreen = vector.z < 1 && sx > -80 && sy > -60 && sx < width + 80 && sy < height + 60;
      return { id: point.id, sx, sy, onScreen };
    });
  }

  /** Ground position of the player, for placing a "you are here" marker. */
  playerPoint(): { x: number; y: number; z: number } {
    return { x: this.avatar.position.x, y: this.avatar.position.y + 2.4, z: this.avatar.position.z };
  }

  setPositionCheckpoint(callback: () => void): void {
    this.onPositionCheckpoint = callback;
  }

  setInputEnabled(enabled: boolean): void {
    this.inputEnabled = enabled;
    if (enabled) return;
    this.keys.clear();
    this.clickTarget = null;
    this.walkMarker.visible = false;
  }

  walkTo(x: number, z: number): void {
    if (!this.inputEnabled) return;
    const groundY = this.sampleWalkHeight(x, z, true);
    if (groundY === null) return;
    const target = new THREE.Vector3(x, groundY, z);
    this.clickTarget = target;
    this.walkMarker.position.set(target.x, groundY + 0.12, target.z);
    this.walkMarker.visible = true;
  }

  setSelectedPlot(plotId: string | null, ownedPlotId: string | null): void {
    for (const [id, mesh] of this.plotMeshes) {
      const material = mesh.material as THREE.MeshBasicMaterial;
      const decor = this.plotDecor.get(id);
      if (id === ownedPlotId) {
        material.color.set(0x55d49b);
        material.opacity = 0.42;
        if (decor) decor.visible = false;
      } else if (id === plotId) {
        material.color.set(0xffdc67);
        material.opacity = 0.52;
        if (decor) decor.visible = true;
      } else {
        material.color.set(0xf2c452);
        material.opacity = 0.2;
        if (decor) decor.visible = true;
      }
    }
  }

  async syncBuildings(state: GameState): Promise<void> {
    const desired = Object.values(state.portfolio)
      .filter((record): record is GameState["portfolio"][string] & { license: keyof typeof BUSINESS } => Boolean(record.buildingPlaced && record.license))
      .sort((a, b) => a.plotId.localeCompare(b.plotId));
    const signature = desired.map((record) => `${record.plotId}:${record.license}`).join("|");
    if (signature === this.buildingSignature) return;
    this.buildingSignature = signature;
    const token = ++this.buildingLoadToken;

    const desiredIds = new Set(desired.map((record) => record.plotId));
    for (const [plotId, model] of this.buildings) {
      const record = desired.find((entry) => entry.plotId === plotId);
      if (record && model.userData.license === record.license) continue;
      this.scene.remove(model);
      this.buildings.delete(plotId);
      this.buildingBannerHeights.delete(plotId);
    }

    await Promise.all(desired.map(async (record) => {
      if (this.buildings.has(record.plotId)) return;
      const plot = PLOTS.find((entry) => entry.id === record.plotId);
      if (!plot || !record.license || !desiredIds.has(plot.id)) return;
      const config = BUSINESS[record.license];
      const gltf = await this.loader.loadAsync(config.model);
      if (token !== this.buildingLoadToken) return;
      const model = gltf.scene;
      const bounds = new THREE.Box3().setFromObject(model);
      const size = bounds.getSize(new THREE.Vector3());
      const scale = Math.min((plot.width - 2) / Math.max(1, size.x), (plot.depth - 2) / Math.max(1, size.z), 1);
      model.scale.setScalar(scale);
      const scaledBounds = new THREE.Box3().setFromObject(model);
      const center = scaledBounds.getCenter(new THREE.Vector3());
      const groundY = this.sampleWalkHeight(plot.x, plot.z, true) ?? 1.02;
      model.position.set(plot.x - center.x, groundY - scaledBounds.min.y, plot.z - center.z);
      model.name = `MM_PLAYER_${record.license.toUpperCase()}_${plot.id.toUpperCase()}`;
      model.userData.license = record.license;
      model.userData.plotId = plot.id;
      model.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.frustumCulled = true;
          object.castShadow = this.dynamicShadows;
          object.receiveShadow = this.dynamicShadows;
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          for (const material of materials) if (material instanceof THREE.MeshStandardMaterial) this.styleMaterial(material);
        }
      });
      this.scene.add(model);
      const worldBounds = new THREE.Box3().setFromObject(model);
      this.buildingBannerHeights.set(plot.id, worldBounds.max.y + 1.15);
      this.buildings.set(plot.id, model);
    }));
  }

  buildingBannerY(plotId: string): number | null {
    return this.buildingBannerHeights.get(plotId) ?? null;
  }

  isNearOwnedBusiness(state: GameState): boolean {
    if (!state.ownedPlotId || !state.buildingPlaced) return false;
    const plot = PLOTS.find((entry) => entry.id === state.ownedPlotId);
    return Boolean(plot && Math.hypot(state.player.x - plot.x, state.player.z - plot.z) < 13);
  }

  teleportToState(state: GameState): void {
    this.currentIsland = state.island;
    this.avatar.position.x = state.player.x;
    this.avatar.position.z = state.player.z;
    this.updateChunkVisibility(true);
    let groundY = this.sampleWalkHeight(state.player.x, state.player.z, true);
    if (groundY === null) {
      const district = ISLANDS.find((entry) => entry.id === state.island) ?? ISLANDS[0];
      state.player = { x: district.spawnX, z: district.spawnZ };
      this.avatar.position.x = state.player.x;
      this.avatar.position.z = state.player.z;
      this.updateChunkVisibility(true);
      groundY = this.sampleWalkHeight(state.player.x, state.player.z, true);
    }
    this.avatarGroundY = groundY ?? 1.02;
    this.avatar.position.y = this.avatarGroundY;
    this.clickTarget = null;
    this.cameraTarget.set(state.player.x, this.avatarGroundY + 0.18, state.player.z);
  }

  private resize(): void {
    const width = Math.max(1, this.canvas.clientWidth);
    const height = Math.max(1, this.canvas.clientHeight);
    this.renderer.setSize(width, height, false);
    const aspect = width / height;
    const vertical = this.cameraDistance * 0.72;
    this.camera.left = -vertical * aspect;
    this.camera.right = vertical * aspect;
    this.camera.top = vertical;
    this.camera.bottom = -vertical;
    this.camera.updateProjectionMatrix();
  }

  private movementVector(): THREE.Vector3 {
    const forward = Number(this.keys.has("KeyW") || this.keys.has("ArrowUp")) - Number(this.keys.has("KeyS") || this.keys.has("ArrowDown"));
    const right = Number(this.keys.has("KeyD") || this.keys.has("ArrowRight")) - Number(this.keys.has("KeyA") || this.keys.has("ArrowLeft"));
    if (!forward && !right) return new THREE.Vector3();
    const forwardVector = new THREE.Vector3(-Math.sin(this.cameraYaw), 0, -Math.cos(this.cameraYaw));
    const rightVector = new THREE.Vector3(Math.cos(this.cameraYaw), 0, -Math.sin(this.cameraYaw));
    return forwardVector.multiplyScalar(forward).add(rightVector.multiplyScalar(right)).normalize();
  }

  private tryMoveTo(x: number, z: number): boolean {
    const groundY = this.sampleWalkHeight(x, z);
    if (groundY === null || Math.abs(groundY - this.avatarGroundY) > MAX_WALK_STEP) return false;
    this.avatar.position.x = x;
    this.avatar.position.z = z;
    this.avatarGroundY = groundY;
    this.updateChunkVisibility();
    return true;
  }

  private updateMovement(delta: number, state: GameState): number {
    if (!this.inputEnabled) return 0;
    const previousX = this.avatar.position.x;
    const previousZ = this.avatar.position.z;
    const direction = this.movementVector();
    let moved = false;
    if (direction.lengthSq() > 0) {
      this.clickTarget = null;
      const distance = delta * PLAYER_WALK_SPEED_MPS;
      const nextX = this.avatar.position.x + direction.x * distance;
      const nextZ = this.avatar.position.z + direction.z * distance;
      moved = this.tryMoveTo(nextX, nextZ)
        || this.tryMoveTo(nextX, this.avatar.position.z)
        || this.tryMoveTo(this.avatar.position.x, nextZ);
    } else if (this.clickTarget) {
      const deltaTarget = this.clickTarget.clone().sub(this.avatar.position);
      deltaTarget.y = 0;
      if (deltaTarget.length() < 0.25) {
        this.clickTarget = null;
        this.walkMarker.visible = false;
      }
      else {
        deltaTarget.normalize();
        const distance = Math.min(delta * PLAYER_WALK_SPEED_MPS, this.avatar.position.distanceTo(this.clickTarget));
        moved = this.tryMoveTo(
          this.avatar.position.x + deltaTarget.x * distance,
          this.avatar.position.z + deltaTarget.z * distance,
        );
        if (!moved) {
          this.clickTarget = null;
          this.walkMarker.visible = false;
        }
      }
    }
    if (!moved) return 0;
    const movedX = this.avatar.position.x - previousX;
    const movedZ = this.avatar.position.z - previousZ;
    const movementSpeed = planarSpeed(movedX, movedZ, delta);
    if (movementSpeed <= 0.001) return 0;
    this.avatar.rotation.y = dampWrappedYaw(
      this.avatar.rotation.y,
      headingYaw(movedX, movedZ),
      delta,
    );
    state.player.x = this.avatar.position.x;
    state.player.z = this.avatar.position.z;
    this.callbacks.onMoved();
    return movementSpeed;
  }

  private updateCitizens(delta: number, elapsed: number, state: GameState): void {
    if (this.citizenDistrict !== state.island) this.resetCitizenDistrict(state, elapsed);
    this.syncCitizenActivity(state, elapsed);
    const population = citizenPopulation(
      Object.values(state.portfolio).filter((record) => record.buildingPlaced).length,
      state.reputation,
      state.visitorsServed,
    );
    for (const citizen of this.citizens) {
      citizen.group.visible = true;
      citizen.group.userData.representedCitizens = representedPartySize(
        population,
        VISIBLE_CITIZENS,
        citizen.index,
      );
      if (citizen.waitingUntil > 0) {
        if (elapsed < citizen.waitingUntil) {
          this.setCitizenWalking(citizen, false);
          citizen.mixer.update(delta);
          continue;
        }
        citizen.waitingUntil = 0;
        citizen.activityId = null;
        citizen.transactionIndicator.visible = false;
        citizen.destination = null;
        citizen.nextDecisionAt = elapsed;
      }
      if (citizen.pathIndex >= citizen.path.length) {
        if (citizen.destination) {
          const businessVisit = citizen.destination.kind === "business";
          // Routine browsing is not a payment. Only a settled activity cohort
          // receives the currency badge, so the world never invents a purchase.
          citizen.transactionIndicator.visible = citizen.activityId !== null;
          citizen.waitingUntil = elapsed + (businessVisit ? 4.5 + (citizen.index % 4) : 2.5 + (citizen.index % 3));
          citizen.path = [];
          citizen.pathIndex = 0;
          this.setCitizenWalking(citizen, false);
          citizen.mixer.update(delta);
          continue;
        }
        if (elapsed >= citizen.nextDecisionAt) this.planCitizenRoutine(citizen, state, elapsed);
        citizen.mixer.update(delta);
        continue;
      }

      const previousX = citizen.group.position.x;
      const previousZ = citizen.group.position.z;
      let remaining = citizen.profile.walkingSpeedMps * delta;
      while (remaining > 0 && citizen.pathIndex < citizen.path.length) {
        const target = citizen.path[citizen.pathIndex]!;
        const dx = target.x - citizen.group.position.x;
        const dz = target.z - citizen.group.position.z;
        const distance = Math.hypot(dx, dz);
        if (distance <= Math.max(.001, remaining)) {
          citizen.group.position.copy(target);
          citizen.groundY = target.y;
          citizen.pathIndex += 1;
          remaining -= distance;
          continue;
        }
        const ratio = remaining / distance;
        citizen.group.position.x += dx * ratio;
        citizen.group.position.z += dz * ratio;
        citizen.group.position.y += (target.y - citizen.group.position.y) * ratio;
        citizen.groundY = citizen.group.position.y;
        remaining = 0;
      }
      const movedX = citizen.group.position.x - previousX;
      const movedZ = citizen.group.position.z - previousZ;
      const speed = planarSpeed(movedX, movedZ, delta);
      if (speed > .01) {
        citizen.group.rotation.y = dampWrappedYaw(
          citizen.group.rotation.y,
          headingYaw(movedX, movedZ),
          delta,
          10,
        );
        this.setCitizenWalking(citizen, true);
        if (citizen.walkAction) citizen.walkAction.timeScale = walkAnimationRate(speed);
      } else {
        this.setCitizenWalking(citizen, false);
      }
      citizen.mixer.update(delta);
    }
  }

  private updateWorldMotion(elapsed: number, moving: boolean): void {
    this.avatar.position.y = this.avatarMixer
      ? this.avatarGroundY
      : this.avatarGroundY + Math.sin(elapsed * (moving ? 9 : 2.2)) * (moving ? 0.055 : 0.018);
    if (this.walkMarker.visible) {
      const pulse = 0.9 + Math.sin(elapsed * 5) * 0.12;
      this.walkMarker.scale.setScalar(pulse);
      (this.walkMarker.material as THREE.MeshBasicMaterial).opacity = 0.7 + Math.sin(elapsed * 5) * 0.2;
    }
    for (const [id, decor] of this.plotDecor) {
      if (!decor.visible) continue;
      const pulse = 1 + Math.sin(elapsed * 2.2 + id.length) * 0.025;
      decor.scale.set(pulse, 1, pulse);
      // The interactive HTML markers carry this text now; the in-scene sign would
      // otherwise render the same words twice, stacked.
      const label = decor.children.find((child) => child.userData.plotLabel);
      if (label) label.visible = false;
    }
    for (const material of this.waterMaterials) material.opacity = 0.82 + Math.sin(elapsed * 0.7) * 0.035;
  }

  private updateCamera(delta: number): void {
    const target = new THREE.Vector3(this.avatar.position.x, 1.2, this.avatar.position.z);
    const smooth = 1 - Math.exp(-delta * 6);
    this.cameraTarget.lerp(target, smooth);
    const offset = new THREE.Vector3(
      Math.sin(this.cameraYaw) * this.cameraDistance,
      this.cameraHeight,
      Math.cos(this.cameraYaw) * this.cameraDistance,
    );
    this.camera.position.copy(this.cameraTarget).add(offset);
    this.camera.lookAt(this.cameraTarget);
    if (this.sun) {
      this.sun.target.position.copy(this.cameraTarget);
      this.sun.position.set(this.cameraTarget.x - 90, 145, this.cameraTarget.z + 85);
    }
  }

  start(state: GameState): void {
    if (this.running) return;
    this.running = true;
    this.teleportToState(state);
    const animate = (): void => {
      if (!this.running) return;
      requestAnimationFrame(animate);
      const delta = Math.min(0.05, this.clock.getDelta());
      const movementSpeed = this.updateMovement(delta, state);
      this.updateAvatarAnimations(delta, movementSpeed);
      this.updateCitizens(delta, this.clock.elapsedTime, state);
      this.updatePeers(delta, this.clock.elapsedTime);
      this.updateWorldMotion(this.clock.elapsedTime, movementSpeed > 0.05);
      this.updateCamera(delta);
      this.onFrame?.();
      this.saveAccumulator += delta;
      if (this.saveAccumulator >= 3) {
        this.saveAccumulator = 0;
        this.onPositionCheckpoint?.();
      }
      this.renderer.render(this.scene, this.camera);
    };
    animate();
  }

  dispose(): void {
    this.running = false;
    this.renderer.dispose();
  }
}
