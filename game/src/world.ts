import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { BUSINESS, ISLANDS, PLOTS, SUNMARK_CODE } from "./data";
import { OFFICIAL_PRESENTATION_CAMERA, SOLARPUNK_MATERIALS } from "./artStandard";
import type { GameState } from "./state";
import type { RemotePlayer } from "./network";

interface WorldCallbacks {
  onPlotSelected: (plotId: string) => void;
  onMoved: () => void;
  onLoadProgress: (progress: number, label: string) => void;
}

interface Citizen {
  group: THREE.Group;
  phase: number;
  radius: number;
  speed: number;
  centerX: number;
  centerZ: number;
}

const CAMERA_ELEVATION_TANGENT = Math.tan(THREE.MathUtils.degToRad(OFFICIAL_PRESENTATION_CAMERA.elevationDegrees));

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
  private readonly groundMeshes = new Map<string, THREE.Mesh>();
  private readonly citizens: Citizen[] = [];
  private readonly peers = new Map<string, { group: THREE.Group; target: THREE.Vector3; seen: number }>();
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
  private building: THREE.Group | null = null;
  private buildingSignature = "";
  private buildingLoadToken = 0;
  private cameraYaw = Math.PI / 4;
  private cameraDistance = 38;
  private cameraHeight = this.cameraDistance * CAMERA_ELEVATION_TANGENT;
  private currentIsland = "hearth";
  private running = false;
  private saveAccumulator = 0;
  private onPositionCheckpoint: (() => void) | null = null;
  private onFrame: (() => void) | null = null;

  constructor(canvas: HTMLCanvasElement, callbacks: WorldCallbacks) {
    this.canvas = canvas;
    this.callbacks = callbacks;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.AgXToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.shadowMap.enabled = this.dynamicShadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setClearColor(0x0fa8bb, 1);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, window.innerWidth < 780 ? 1.15 : 1.45));
    this.camera = new THREE.OrthographicCamera(-30, 30, 20, -20, 0.1, 900);
    const initialAxisOffset = this.cameraDistance / Math.sqrt(2);
    this.camera.position.set(initialAxisOffset, this.cameraHeight, initialAxisOffset);
    this.scene.background = new THREE.Color(0x0fa8bb);
    this.scene.fog = new THREE.FogExp2(0x68c9cf, 0.00048);
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
    const hemisphere = new THREE.HemisphereLight(0xe9fff1, 0x526044, 1.08);
    this.scene.add(hemisphere);
    const sun = new THREE.DirectionalLight(0xffe0a8, 2.45);
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
    const fill = new THREE.DirectionalLight(0xb8f5ef, 0.55);
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
    backpack.position.set(0, 1.2, 0.36);
    this.avatar.add(backpack);

    this.avatar.position.set(0, 1.02, 34);
    this.scene.add(this.avatar);
    this.scene.add(this.peerRoot);
  }

  private styleMaterial(material: THREE.MeshStandardMaterial): void {
    const color = SOLARPUNK_MATERIALS[material.name];
    if (color) material.color.set(color);
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
      event.preventDefault();
      this.cameraDistance = THREE.MathUtils.clamp(this.cameraDistance + Math.sign(event.deltaY) * 4, 24, 72);
      this.cameraHeight = this.cameraDistance * CAMERA_ELEVATION_TANGENT;
      this.resize();
    }, { passive: false });
  }

  private handlePointer(event: PointerEvent): void {
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
    const ground = this.groundMeshes.get(this.currentIsland);
    if (!ground) return;
    const intersections = this.raycaster.intersectObject(ground, false);
    if (intersections[0]) {
      this.clickTarget = intersections[0].point.clone();
      this.walkMarker.position.set(this.clickTarget.x, 1.2, this.clickTarget.z);
      this.walkMarker.visible = true;
    }
  }

  async load(): Promise<void> {
    this.callbacks.onLoadProgress(0.06, "Preparing the Sunwoven Reach");
    const gltf = await this.loader.loadAsync("./assets/world/sunwoven-reach-v1.glb", (event) => {
      if (event.total > 0) this.callbacks.onLoadProgress(0.08 + (event.loaded / event.total) * 0.72, "Streaming original terrain and buildings");
    });
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
    gltf.scene.name = "MM_ORIGINAL_SUNWOVEN_REACH_V1";
    this.scene.add(gltf.scene);
    this.callbacks.onLoadProgress(0.84, "Opening starter plots");
    this.createGrounds();
    this.createAmbientWorld();
    this.createPlotMarkers();
    this.createCitizens();
    this.callbacks.onLoadProgress(1, "World ready");
  }

  private createGrounds(): void {
    for (const island of ISLANDS) {
      const material = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false });
      const mesh = new THREE.Mesh(new THREE.CircleGeometry(island.radius, 48), material);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(island.x, 1.12, island.z);
      mesh.name = `MM_NAV_${island.id}`;
      this.scene.add(mesh);
      this.groundMeshes.set(island.id, mesh);
    }
  }

  private createAmbientWorld(): void {
    const treeSites: Array<{ x: number; z: number; scale: number; angle: number; color: THREE.Color }> = [];
    const shrubSites: Array<{ x: number; z: number; scale: number; color: THREE.Color }> = [];
    const leafColors = [0x4f8f3b, 0x6da744, 0x82b84c, 0x3f7f4b].map((value) => new THREE.Color(value));
    for (const [islandIndex, island] of ISLANDS.entries()) {
      const desired = island.id === "hearth" ? 34 : 11;
      for (let index = 0; index < desired; index += 1) {
        const angle = (index / desired) * Math.PI * 2 + islandIndex * 0.39;
        const radius = island.radius * (0.67 + (index % 4) * 0.055);
        const x = island.x + Math.cos(angle) * radius;
        const z = island.z + Math.sin(angle) * radius;
        if (island.id === "hearth" && PLOTS.some((plot) => Math.abs(x - plot.x) < plot.width * 0.72 && Math.abs(z - plot.z) < plot.depth * 0.82)) continue;
        treeSites.push({ x, z, scale: 0.82 + (index % 5) * 0.08, angle, color: leafColors[(index + islandIndex) % leafColors.length] });
        shrubSites.push({ x: island.x + Math.cos(angle + 0.08) * (radius - 2.2), z: island.z + Math.sin(angle + 0.08) * (radius - 2.2), scale: 0.72 + (index % 3) * 0.13, color: leafColors[(index + islandIndex + 1) % leafColors.length] });
      }
    }

    const trunk = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.22, 0.34, 1.75, 7),
      new THREE.MeshStandardMaterial({ color: 0x775033, roughness: 0.88 }),
      treeSites.length,
    );
    const crown = new THREE.InstancedMesh(
      new THREE.DodecahedronGeometry(1.18, 0),
      new THREE.MeshStandardMaterial({ color: 0x69a542, roughness: 0.84 }),
      treeSites.length,
    );
    const crownTop = new THREE.InstancedMesh(
      new THREE.DodecahedronGeometry(0.82, 0),
      new THREE.MeshStandardMaterial({ color: 0x84b84c, roughness: 0.82 }),
      treeSites.length,
    );
    const dummy = new THREE.Object3D();
    treeSites.forEach((site, index) => {
      dummy.position.set(site.x, 1.92, site.z);
      dummy.rotation.set(0, site.angle, 0);
      dummy.scale.setScalar(site.scale);
      dummy.updateMatrix();
      trunk.setMatrixAt(index, dummy.matrix);
      dummy.position.y = 3.45;
      dummy.scale.set(site.scale * 1.08, site.scale * 0.9, site.scale);
      dummy.updateMatrix();
      crown.setMatrixAt(index, dummy.matrix);
      crown.setColorAt(index, site.color);
      dummy.position.set(site.x + Math.cos(site.angle) * 0.34, 4.18, site.z + Math.sin(site.angle) * 0.34);
      dummy.scale.setScalar(site.scale * 0.72);
      dummy.updateMatrix();
      crownTop.setMatrixAt(index, dummy.matrix);
      crownTop.setColorAt(index, site.color.clone().offsetHSL(0.01, 0.03, 0.08));
    });
    for (const mesh of [trunk, crown, crownTop]) {
      mesh.name = "MM_AMBIENT_TREE_BATCH";
      mesh.castShadow = this.dynamicShadows;
      mesh.receiveShadow = this.dynamicShadows;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      this.scene.add(mesh);
    }

    const shrubs = new THREE.InstancedMesh(
      new THREE.DodecahedronGeometry(0.48, 0),
      new THREE.MeshStandardMaterial({ color: 0x65a848, roughness: 0.88 }),
      shrubSites.length,
    );
    shrubSites.forEach((site, index) => {
      dummy.position.set(site.x, 1.48, site.z);
      dummy.rotation.set(0, index * 0.93, 0);
      dummy.scale.set(site.scale * 1.35, site.scale * 0.72, site.scale);
      dummy.updateMatrix();
      shrubs.setMatrixAt(index, dummy.matrix);
      shrubs.setColorAt(index, site.color);
    });
    shrubs.instanceMatrix.needsUpdate = true;
    if (shrubs.instanceColor) shrubs.instanceColor.needsUpdate = true;
    this.scene.add(shrubs);

    const lampSites = Array.from({ length: 18 }, (_, index) => {
      const radius = index % 2 === 0 ? 18 : 31;
      const angle = index * (Math.PI * 2 / 18) + 0.18;
      return { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius };
    });
    const lampPosts = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.07, 0.1, 2.5, 6),
      new THREE.MeshStandardMaterial({ color: 0x315d60, roughness: 0.68 }),
      lampSites.length,
    );
    const lampLights = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.18, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0xffd46a, emissive: 0xffb52e, emissiveIntensity: 0.55, roughness: 0.42 }),
      lampSites.length,
    );
    lampSites.forEach((site, index) => {
      dummy.position.set(site.x, 2.3, site.z);
      dummy.rotation.set(0, index, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      lampPosts.setMatrixAt(index, dummy.matrix);
      dummy.position.y = 3.6;
      dummy.updateMatrix();
      lampLights.setMatrixAt(index, dummy.matrix);
    });
    lampPosts.instanceMatrix.needsUpdate = true;
    lampLights.instanceMatrix.needsUpdate = true;
    this.scene.add(lampPosts, lampLights);

    const sunwell = ISLANDS.find((island) => island.id === "sun");
    if (sunwell) {
      const panelCount = 8;
      const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.08, 0.1, 1.2, 6), new THREE.MeshStandardMaterial({ color: 0x63777b, roughness: 0.72 }), panelCount);
      const panels = new THREE.InstancedMesh(new THREE.BoxGeometry(1.7, 0.08, 0.9), new THREE.MeshStandardMaterial({ color: 0x245d7b, emissive: 0x0b2734, emissiveIntensity: 0.12, roughness: 0.36 }), panelCount);
      for (let index = 0; index < panelCount; index += 1) {
        const angle = index * Math.PI * 2 / panelCount;
        const x = sunwell.x + Math.cos(angle) * 17;
        const z = sunwell.z + Math.sin(angle) * 17;
        dummy.position.set(x, 1.72, z);
        dummy.rotation.set(0, angle, 0);
        dummy.scale.setScalar(1);
        dummy.updateMatrix();
        poles.setMatrixAt(index, dummy.matrix);
        dummy.position.y = 2.36;
        dummy.rotation.set(-0.28, angle, 0);
        dummy.updateMatrix();
        panels.setMatrixAt(index, dummy.matrix);
      }
      poles.instanceMatrix.needsUpdate = true;
      panels.instanceMatrix.needsUpdate = true;
      this.scene.add(poles, panels);
    }
  }

  private createPlotMarkers(): void {
    for (const plot of PLOTS) {
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
      marker.position.set(plot.x, 1.18, plot.z);
      marker.userData.plotId = plot.id;
      marker.name = `MM_PLOT_${plot.id}`;
      this.scene.add(marker);
      this.plotMeshes.set(plot.id, marker);

      const decor = new THREE.Group();
      decor.position.set(plot.x, 1.2, plot.z);
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
        context.fillText(`${plot.name} · ${plot.price} ${SUNMARK_CODE}`, 256, 92);
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

  private createCitizens(): void {
    const bodyGeometry = new THREE.CapsuleGeometry(0.24, 0.52, 3, 7);
    const colors = [0x2f7777, 0xe17a58, 0xd1a445, 0x739667, 0x735f8d];
    for (let index = 0; index < 24; index += 1) {
      const group = new THREE.Group();
      const shadow = new THREE.Mesh(
        new THREE.CircleGeometry(0.36, 12),
        new THREE.MeshBasicMaterial({ color: 0x123d3f, transparent: true, opacity: 0.18, depthWrite: false }),
      );
      shadow.rotation.x = -Math.PI / 2;
      shadow.position.y = 0.02;
      group.add(shadow);
      const body = new THREE.Mesh(
        bodyGeometry,
        new THREE.MeshStandardMaterial({ color: colors[index % colors.length], roughness: 0.78 }),
      );
      body.position.y = 0.8;
      group.add(body);
      const head = new THREE.Mesh(
        new THREE.SphereGeometry(0.18, 8, 6),
        new THREE.MeshStandardMaterial({ color: index % 3 === 0 ? 0x8e5d42 : 0xc98c65, roughness: 0.8 }),
      );
      head.position.y = 1.42;
      group.add(head);
      this.scene.add(group);
      this.citizens.push({
        group,
        phase: index * 0.79,
        radius: 10 + (index % 6) * 6.2,
        speed: 0.09 + (index % 5) * 0.012,
        centerX: ((index % 3) - 1) * 7,
        centerZ: ((index % 4) - 1.5) * 5,
      });
    }
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

    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.78, 20),
      new THREE.MeshBasicMaterial({ color: 0x0d3b3f, transparent: true, opacity: 0.2, depthWrite: false }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = -0.98;
    group.add(shadow);

    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.42, 0.86, 4, 10),
      new THREE.MeshStandardMaterial({ color: tint, roughness: 0.72 }),
    );
    body.position.y = 0.12;
    group.add(body);

    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.36, 16, 12),
      new THREE.MeshStandardMaterial({ color: 0xf0d0ae, roughness: 0.86 }),
    );
    head.position.y = 1.02;
    group.add(head);

    const marker = new THREE.Mesh(
      new THREE.ConeGeometry(0.22, 0.42, 10),
      new THREE.MeshBasicMaterial({ color: tint, transparent: true, opacity: 0.9 }),
    );
    marker.position.y = 1.86;
    marker.rotation.x = Math.PI;
    marker.userData.peerMarker = true;
    group.add(marker);

    return group;
  }

  /** Apply one authoritative island snapshot. Positions are eased, not snapped. */
  setRemotePlayers(players: RemotePlayer[]): void {
    const now = performance.now();
    for (const player of players) {
      let peer = this.peers.get(player.playerId);
      if (!peer) {
        const group = this.makePeerAvatar(player.playerId);
        group.position.set(player.x, 1.02, player.z);
        this.peerRoot.add(group);
        peer = { group, target: new THREE.Vector3(player.x, 1.02, player.z), seen: now };
        this.peers.set(player.playerId, peer);
      }
      peer.target.set(player.x, 1.02, player.z);
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
    this.avatar.position.x = x;
    this.avatar.position.z = z;
    state.player.x = x;
    state.player.z = z;
    this.clickTarget = null;
  }

  private updatePeers(delta: number, elapsed: number): void {
    const ease = Math.min(1, delta * 7.5);
    for (const peer of this.peers.values()) {
      peer.group.position.lerp(peer.target, ease);
      peer.group.position.y = 1.02 + Math.sin(elapsed * 2.4 + peer.group.position.x) * 0.02;
      const marker = peer.group.children.find((child) => child.userData.peerMarker);
      if (marker) marker.position.y = 1.86 + Math.sin(elapsed * 3 + peer.group.position.z) * 0.08;
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

  walkTo(x: number, z: number): void {
    const target = new THREE.Vector3(x, 1.12, z);
    this.clampToIsland(target);
    this.clickTarget = target;
    this.walkMarker.position.set(target.x, 1.2, target.z);
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

  async syncBuilding(state: GameState): Promise<void> {
    const signature = state.buildingPlaced && state.license && state.ownedPlotId
      ? `${state.license}:${state.ownedPlotId}`
      : "";
    if (signature === this.buildingSignature) return;
    this.buildingSignature = signature;
    const token = ++this.buildingLoadToken;
    if (this.building) {
      this.scene.remove(this.building);
      this.building = null;
    }
    if (!signature || !state.license || !state.ownedPlotId) return;
    const plot = PLOTS.find((entry) => entry.id === state.ownedPlotId);
    if (!plot) return;
    const config = BUSINESS[state.license];
    const gltf = await this.loader.loadAsync(config.model);
    if (token !== this.buildingLoadToken) return;
    const model = gltf.scene;
    const bounds = new THREE.Box3().setFromObject(model);
    const size = bounds.getSize(new THREE.Vector3());
    const scale = Math.min((plot.width - 2) / Math.max(1, size.x), (plot.depth - 2) / Math.max(1, size.z), 1);
    model.scale.setScalar(scale);
    const scaledBounds = new THREE.Box3().setFromObject(model);
    const center = scaledBounds.getCenter(new THREE.Vector3());
    model.position.set(plot.x - center.x, 1.02 - scaledBounds.min.y, plot.z - center.z);
    model.name = `MM_PLAYER_${state.license.toUpperCase()}`;
    model.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.frustumCulled = true;
        object.castShadow = this.dynamicShadows;
        object.receiveShadow = this.dynamicShadows;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) if (material instanceof THREE.MeshStandardMaterial) this.styleMaterial(material);
      }
    });
    this.building = model;
    this.scene.add(model);
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
    this.clickTarget = null;
    this.cameraTarget.set(state.player.x, 1.2, state.player.z);
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

  private clampToIsland(position: THREE.Vector3): void {
    const island = ISLANDS.find((entry) => entry.id === this.currentIsland) ?? ISLANDS[0];
    const dx = position.x - island.x;
    const dz = position.z - island.z;
    const distance = Math.hypot(dx, dz);
    const max = island.radius - 2;
    if (distance > max) {
      position.x = island.x + (dx / distance) * max;
      position.z = island.z + (dz / distance) * max;
    }
  }

  private updateMovement(delta: number, state: GameState): void {
    const direction = this.movementVector();
    let moved = false;
    if (direction.lengthSq() > 0) {
      this.clickTarget = null;
      this.avatar.position.addScaledVector(direction, delta * 6.5);
      this.avatar.rotation.y = Math.atan2(direction.x, direction.z);
      moved = true;
    } else if (this.clickTarget) {
      const deltaTarget = this.clickTarget.clone().sub(this.avatar.position);
      deltaTarget.y = 0;
      if (deltaTarget.length() < 0.25) {
        this.clickTarget = null;
        this.walkMarker.visible = false;
      }
      else {
        deltaTarget.normalize();
        this.avatar.position.addScaledVector(deltaTarget, Math.min(delta * 6.5, this.avatar.position.distanceTo(this.clickTarget)));
        this.avatar.rotation.y = Math.atan2(deltaTarget.x, deltaTarget.z);
        moved = true;
      }
    }
    if (!moved) return;
    this.clampToIsland(this.avatar.position);
    state.player.x = this.avatar.position.x;
    state.player.z = this.avatar.position.z;
    this.callbacks.onMoved();
  }

  private updateCitizens(elapsed: number): void {
    for (const citizen of this.citizens) {
      const angle = citizen.phase + elapsed * citizen.speed;
      citizen.group.position.x = citizen.centerX + Math.cos(angle) * citizen.radius;
      citizen.group.position.z = citizen.centerZ + Math.sin(angle * 1.11) * citizen.radius * 0.72;
      citizen.group.position.y = 1.04;
      citizen.group.rotation.y = -angle + Math.PI / 2;
      citizen.group.visible = this.currentIsland === "hearth";
    }
  }

  private updateWorldMotion(elapsed: number, moving: boolean): void {
    this.avatar.position.y = 1.02 + Math.sin(elapsed * (moving ? 9 : 2.2)) * (moving ? 0.055 : 0.018);
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
      this.updateMovement(delta, state);
      this.updateCitizens(this.clock.elapsedTime);
      this.updatePeers(delta, this.clock.elapsedTime);
      this.updateWorldMotion(this.clock.elapsedTime, this.keys.size > 0 || Boolean(this.clickTarget));
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
