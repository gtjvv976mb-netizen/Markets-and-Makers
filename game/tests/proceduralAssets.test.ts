import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { BUSINESS } from "../src/data";
import { BUSINESS_PROCEDURAL_SPECS, proceduralSceneFor } from "../src/proceduralAssets";
import { snapToTileCentre as designSnap, tileYaw } from "../src/worldDesigns";
import worldDesignManifest from "../public/assets/world/highlands-rivers-v1/world-designs-v1/manifest.json";
import officialArtManifest from "../../art/official-v1/manifest.json";
// .gltf is not a JSON extension vite will parse, so read it as text.
import worldGltfText from "../public/assets/world/highlands-rivers-v1/world.gltf?raw";
import { civicStructureFor, CIVIC_NODE_NAMES } from "../src/proceduralAssets";

const manifest = worldDesignManifest as { assets: Array<{ id: string; category: string; file: string }> };
const officialBusinesses = (officialArtManifest as unknown as { businesses: Array<{ license_key: string; footprint_tiles: [number, number] }> }).businesses;
const modelStem = (model: string): string => (model.split("/").pop() ?? "").replace(/\.glb$/i, "");

const meshesIn = (scene: THREE.Object3D): THREE.Mesh[] => {
  const meshes: THREE.Mesh[] = [];
  scene.traverse((object) => {
    if ((object as THREE.Mesh).isMesh) meshes.push(object as THREE.Mesh);
  });
  return meshes;
};

const geometrySignature = (geometry: THREE.BufferGeometry): string => {
  let hash = 0x811c9dc5;
  const add = (value: number): void => {
    hash ^= value;
    hash = Math.imul(hash, 0x01000193);
  };
  const position = geometry.getAttribute("position");
  for (let i = 0; i < position.count; i += 1) {
    add(Math.round(position.getX(i) * 1_000));
    add(Math.round(position.getY(i) * 1_000));
    add(Math.round(position.getZ(i) * 1_000));
  }
  const index = geometry.getIndex();
  if (index) for (let i = 0; i < index.count; i += 1) add(index.getX(i));
  return (hash >>> 0).toString(16).padStart(8, "0");
};

describe("procedural asset catalogue", () => {
  // The GLBs these URLs point at are no longer shipped, so a stem the catalogue does
  // not answer becomes a 404 and a hard load failure in the browser.
  it("answers every business model referenced by the catalogue", () => {
    const missing = Object.entries(BUSINESS)
      .filter(([, config]) => !proceduralSceneFor(config.model))
      .map(([key, config]) => `${key} -> ${config.model}`);
    expect(missing).toEqual([]);
  });

  it("answers every world-design asset except the rigged avatar", () => {
    const missing = manifest.assets
      .filter((asset) => asset.category !== "avatar")
      .filter((asset) => !proceduralSceneFor(asset.file))
      .map((asset) => asset.file);
    expect(missing).toEqual([]);
  });

  it("leaves the rigged avatar to the real loader, so its clips survive", () => {
    const avatar = manifest.assets.find((asset) => asset.category === "avatar");
    expect(avatar).toBeDefined();
    expect(proceduralSceneFor(avatar!.file)).toBeNull();
  });

  it("builds each asset as one merged mesh, which the instancer requires", () => {
    for (const asset of manifest.assets.filter((entry) => entry.category !== "avatar")) {
      const scene = proceduralSceneFor(asset.file);
      let meshes = 0;
      scene!.traverse((object) => {
        if ((object as { isMesh?: boolean }).isMesh) meshes += 1;
      });
      expect(`${asset.id}:${meshes}`).toBe(`${asset.id}:1`);
    }
  });

  it("gives every asset real geometry with vertex colours", () => {
    const scene = proceduralSceneFor("b05-canopy-greenhouse.glb");
    let checked = false;
    scene!.traverse((object) => {
      const mesh = object as { isMesh?: boolean; geometry?: { attributes: Record<string, { count: number }> } };
      if (!mesh.isMesh || !mesh.geometry) return;
      expect(mesh.geometry.attributes.position!.count).toBeGreaterThan(100);
      expect(mesh.geometry.attributes.color).toBeDefined();
      checked = true;
    });
    expect(checked).toBe(true);
  });
});

describe("redesigned procedural business buildings", () => {
  const entries = Object.entries(BUSINESS);
  const officialByLicense = new Map(officialBusinesses.map((entry) => [entry.license_key, entry]));

  it("covers exactly fifteen official licences with fifteen distinct model stems", () => {
    expect(entries).toHaveLength(15);
    expect(entries.map(([license]) => license).sort()).toEqual(officialBusinesses.map((entry) => entry.license_key).sort());
    const stems = entries.map(([, config]) => modelStem(config.model));
    expect(new Set(stems).size).toBe(15);
    expect(stems.sort()).toEqual(Object.keys(BUSINESS_PROCEDURAL_SPECS).sort());
  });

  it("uses fifteen geometrically unique silhouettes, not palette-swapped clones", () => {
    const signatures = entries.map(([, config]) => {
      const meshes = meshesIn(proceduralSceneFor(config.model)!);
      expect(meshes).toHaveLength(1);
      return geometrySignature(meshes[0]!.geometry);
    });
    expect(new Set(signatures).size).toBe(15);
  });

  it("keeps every building to one opaque vertex-colour draw call", () => {
    for (const [license, config] of entries) {
      const scene = proceduralSceneFor(config.model)!;
      const meshes = meshesIn(scene);
      expect(meshes, license).toHaveLength(1);
      const mesh = meshes[0]!;
      expect(Array.isArray(mesh.material), license).toBe(false);
      expect(mesh.material, license).toBeInstanceOf(THREE.MeshStandardMaterial);
      const material = mesh.material as THREE.MeshStandardMaterial;
      expect(material.vertexColors, license).toBe(true);
      expect(material.transparent, license).toBe(false);
      expect(material.map, license).toBeNull();
      expect(mesh.geometry.getAttribute("position"), license).toBeDefined();
      expect(mesh.geometry.getAttribute("color"), license).toBeDefined();
      expect(mesh.geometry.getAttribute("uv"), license).toBeUndefined();
    }
  });

  it("grounds every structure and holds it inside its official plot footprint", () => {
    for (const [license, config] of entries) {
      const scene = proceduralSceneFor(config.model)!;
      scene.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(scene, true);
      const size = bounds.getSize(new THREE.Vector3());
      const official = officialByLicense.get(license)!;
      expect(Math.abs(bounds.min.y), `${license}:minY`).toBeLessThan(0.001);
      expect(size.x, `${license}:width`).toBeLessThanOrEqual(official.footprint_tiles[0] * 2 + 0.5);
      expect(size.z, `${license}:depth`).toBeLessThanOrEqual(official.footprint_tiles[1] * 2 + 0.5);
      expect(size.y, `${license}:height`).toBeGreaterThan(3);
      expect(size.y, `${license}:height`).toBeLessThanOrEqual(10);
      expect([size.x, size.y, size.z].every(Number.isFinite), license).toBe(true);
    }
  });

  it("publishes identity, recognition cues and mobile budgets with each scene", () => {
    let totalTriangles = 0;
    for (const [license, config] of entries) {
      const stem = modelStem(config.model);
      const scene = proceduralSceneFor(config.model)!;
      const spec = BUSINESS_PROCEDURAL_SPECS[stem]!;
      const official = officialByLicense.get(license)!;
      const mesh = meshesIn(scene)[0]!;
      const triangles = (mesh.geometry.getIndex()?.count ?? mesh.geometry.getAttribute("position").count) / 3;
      totalTriangles += triangles;
      expect(scene.userData).toMatchObject({
        schema: "markets-and-makers.procedural-business.v1",
        businessLicense: license,
        assetId: `mm_biz_${license}_v2`,
        modelStem: stem,
        footprintTiles: official.footprint_tiles,
        tileSizeM: 2,
        upAxis: "+Y",
        customerFront: "+Z",
        mobileProfile: "lite",
      });
      expect(scene.userData.silhouette.length, `${license}:silhouette`).toBeGreaterThan(12);
      expect(scene.userData.heroProp.length, `${license}:heroProp`).toBeGreaterThan(8);
      expect(scene.userData.regenerativeSystem.length, `${license}:regenerativeSystem`).toBeGreaterThan(12);
      expect(scene.userData.sourceParts, `${license}:parts`).toBeLessThanOrEqual(spec.maxSourceParts);
      expect(triangles, `${license}:triangles`).toBeGreaterThan(200);
      expect(triangles, `${license}:triangles`).toBeLessThanOrEqual(spec.maxTriangles);
      expect(scene.name).toMatch(/^MM_PROC_B\d{2}_[A-Z0-9_]+$/);
      expect(mesh.name).toBe(scene.name.replace("MM_PROC_", "MESH_"));
      expect((mesh.material as THREE.Material).name).toBe(scene.name.replace("MM_PROC_", "MAT_PROC_"));
    }
    expect(totalTriangles).toBeLessThanOrEqual(40_000);
  });
});

describe("the tile rule", () => {
  it("snaps positions onto 2 m tile centres", () => {
    expect(designSnap(-88.08)).toBe(-88);
    expect(designSnap(57.92)).toBe(58);
    expect(designSnap(-61.92)).toBe(-62);
    expect(designSnap(46)).toBe(46);
  });

  it("squares built things onto quarter turns and leaves planting alone", () => {
    expect(tileYaw("street", 75)).toBe(90);
    expect(tileYaw("vehicles", 195)).toBe(180);
    expect(tileYaw("boats", 15)).toBe(0);
    expect(tileYaw("trees", 15)).toBe(15);
    expect(tileYaw("shrubs", 105)).toBe(105);
  });

  it("keeps a snapped prop on the tile it was authored against", () => {
    // Worst authored drift is 0.25 m, well inside a 2 m tile, so the ground the prop
    // was validated against is still the ground it lands on.
    for (const value of [-88.08, -89.92, 57.92, -60.08, 12.25, -3.75]) {
      expect(Math.abs(designSnap(value) - value)).toBeLessThanOrEqual(1);
    }
  });

  it("rounds a half-tile offset up to the next centre", () => {
    expect(designSnap(3)).toBe(4);
    expect(designSnap(1)).toBe(2);
  });
});

describe("civic landmarks", () => {
  const world = JSON.parse(worldGltfText) as { nodes: Array<{ name?: string }>; materials: unknown[]; images: unknown[] };

  it("builds all nine the world reserves sites for", () => {
    expect(CIVIC_NODE_NAMES).toHaveLength(9);
    for (const name of CIVIC_NODE_NAMES) expect(civicStructureFor(name)).not.toBeNull();
  });

  it("builds each as one merged mesh with real geometry", () => {
    for (const name of CIVIC_NODE_NAMES) {
      const scene = civicStructureFor(name)!;
      let meshes = 0;
      let vertices = 0;
      scene.traverse((object) => {
        const mesh = object as { isMesh?: boolean; geometry?: { attributes: Record<string, { count: number }> } };
        if (!mesh.isMesh || !mesh.geometry) return;
        meshes += 1;
        vertices += mesh.geometry.attributes.position!.count;
      });
      expect(`${name}:${meshes}`).toBe(`${name}:1`);
      expect(vertices).toBeGreaterThan(200);
    }
  });

  // The 293k triangles of baked landmarks were stripped from world.gltf because the
  // client generates them. If the world is ever re-baked with them, this fails rather
  // than quietly shipping both — one drawn over the other, and the download back.
  it("no longer carries the baked landmark geometry", () => {
    const baked = world.nodes.filter((node) => (node.name ?? "").startsWith("MM_CIVIC_"));
    expect(baked.map((node) => node.name)).toEqual([]);
  });

  it("dropped the materials and textures that only dressed them", () => {
    // 40 images minus the nine colour/normal/orm sets the landmarks used.
    expect(world.images).toHaveLength(13);
    expect(world.materials).toHaveLength(22);
  });
});
