import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { BUSINESS } from "../game/src/data";
import { BUSINESS_PROCEDURAL_SPECS, proceduralSceneFor } from "../game/src/proceduralAssets";

// GLTFExporter uses the browser FileReader API even when a model contains no images.
// This minimal Node implementation keeps the authoring export repeatable in CI.
class NodeFileReader {
  result: ArrayBuffer | string | null = null;
  onloadend: ((event: { target: NodeFileReader }) => void) | null = null;
  onerror: ((error: unknown) => void) | null = null;

  readAsArrayBuffer(blob: Blob): void {
    void blob.arrayBuffer()
      .then((buffer) => {
        this.result = buffer;
        this.onloadend?.({ target: this });
      })
      .catch((error: unknown) => this.onerror?.(error));
  }

  readAsDataURL(blob: Blob): void {
    void blob.arrayBuffer()
      .then((buffer) => {
        this.result = `data:${blob.type};base64,${Buffer.from(buffer).toString("base64")}`;
        this.onloadend?.({ target: this });
      })
      .catch((error: unknown) => this.onerror?.(error));
  }
}

Object.defineProperty(globalThis, "FileReader", { configurable: true, value: NodeFileReader });

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(repoRoot, "art", "businesses-v2", "models");
const exporter = new GLTFExporter();
const tileSizeM = 2;

const modelStem = (model: string): string => (model.split("/").pop() ?? "").replace(/\.glb$/i, "");

type ExportRecord = {
  license_key: string;
  name: string;
  model_stem: string;
  asset_id: string;
  file: string;
  sha256: string;
  bytes: number;
  triangles: number;
  vertices: number;
  source_parts: number;
  footprint_tiles: readonly [number, number];
  bounds_m: { min: number[]; max: number[]; size: number[] };
  silhouette: string;
  hero_prop: string;
  regenerative_system: string;
};

await mkdir(outputDir, { recursive: true });
const records: ExportRecord[] = [];

for (const [license, config] of Object.entries(BUSINESS)) {
  const stem = modelStem(config.model);
  const spec = BUSINESS_PROCEDURAL_SPECS[stem];
  const scene = proceduralSceneFor(config.model);
  if (!spec || !scene) throw new Error(`${license}: procedural source is missing`);

  scene.updateMatrixWorld(true);
  const meshes: THREE.Mesh[] = [];
  scene.traverse((object) => {
    if ((object as THREE.Mesh).isMesh) meshes.push(object as THREE.Mesh);
  });
  if (meshes.length !== 1) throw new Error(`${license}: expected one mesh, got ${meshes.length}`);

  const mesh = meshes[0]!;
  const geometry = mesh.geometry;
  const triangles = (geometry.getIndex()?.count ?? geometry.getAttribute("position").count) / 3;
  const vertices = geometry.getAttribute("position").count;
  const bounds = new THREE.Box3().setFromObject(scene, true);
  const size = bounds.getSize(new THREE.Vector3());
  if (Math.abs(bounds.min.y) > 0.001) throw new Error(`${license}: model is not grounded (${bounds.min.y})`);
  if (triangles > spec.maxTriangles) throw new Error(`${license}: ${triangles} triangles exceeds ${spec.maxTriangles}`);
  if (scene.userData.sourceParts > spec.maxSourceParts) throw new Error(`${license}: ${scene.userData.sourceParts} source parts exceeds ${spec.maxSourceParts}`);

  const exported = await exporter.parseAsync(scene, {
    binary: true,
    onlyVisible: true,
    trs: false,
    truncateDrawRange: true,
  });
  if (!(exported instanceof ArrayBuffer)) throw new Error(`${license}: exporter did not produce binary GLB data`);

  const bytes = new Uint8Array(exported);
  const file = `${stem}-v2-lod0.glb`;
  await writeFile(path.join(outputDir, file), bytes);
  records.push({
    license_key: license,
    name: config.name,
    model_stem: stem,
    asset_id: spec.assetId,
    file: `models/${file}`,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    bytes: bytes.byteLength,
    triangles,
    vertices,
    source_parts: scene.userData.sourceParts,
    footprint_tiles: spec.footprintTiles,
    bounds_m: {
      min: bounds.min.toArray().map((value) => Number(value.toFixed(4))),
      max: bounds.max.toArray().map((value) => Number(value.toFixed(4))),
      size: size.toArray().map((value) => Number(value.toFixed(4))),
    },
    silhouette: spec.silhouette,
    hero_prop: spec.heroProp,
    regenerative_system: spec.regenerativeSystem,
  });
}

const manifest = {
  schema: "markets-and-makers.business-buildings.v2",
  status: "mobile-lite-production-candidate",
  runtime_source: "game/src/proceduralAssets.ts",
  axes: { up: "+Y", customer_front: "+Z" },
  units: "metres",
  pivot: "bottom-centre",
  tile_size_m: tileSizeM,
  material_profile: "one opaque PBR vertex-colour material per building",
  mobile_limits: {
    max_triangles_per_building: 8_000,
    max_source_parts_per_building: 78,
    max_materials_per_building: 1,
    max_textures_per_building: 0,
  },
  businesses: records,
};

await writeFile(path.join(repoRoot, "art", "businesses-v2", "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

const totalBytes = records.reduce((sum, record) => sum + record.bytes, 0);
const totalTriangles = records.reduce((sum, record) => sum + record.triangles, 0);
console.log(`Exported ${records.length} unique business GLBs: ${totalTriangles.toLocaleString()} triangles, ${totalBytes.toLocaleString()} bytes.`);
