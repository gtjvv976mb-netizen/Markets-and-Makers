import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

type ManifestRecord = {
  license_key: string;
  asset_id: string;
  file: string;
  sha256: string;
  bytes: number;
  triangles: number;
  vertices: number;
  footprint_tiles: [number, number];
};

type Manifest = {
  schema: string;
  tile_size_m: number;
  businesses: ManifestRecord[];
};

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(repoRoot, "art", "businesses-v2", "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Manifest;
if (manifest.schema !== "markets-and-makers.business-buildings.v2") throw new Error(`Unexpected manifest schema: ${manifest.schema}`);
if (manifest.businesses.length !== 15) throw new Error(`Expected 15 businesses, got ${manifest.businesses.length}`);
if (new Set(manifest.businesses.map((entry) => entry.license_key)).size !== 15) throw new Error("Business licence keys are not unique");
if (new Set(manifest.businesses.map((entry) => entry.sha256)).size !== 15) throw new Error("Two exported GLBs have identical binary content");

const loader = new GLTFLoader();
let totalBytes = 0;
let totalTriangles = 0;

for (const entry of manifest.businesses) {
  const absolute = path.join(repoRoot, "art", "businesses-v2", entry.file);
  const bytes = await readFile(absolute);
  if (bytes.subarray(0, 4).toString("ascii") !== "glTF") throw new Error(`${entry.license_key}: invalid GLB magic`);
  if (bytes.readUInt32LE(4) !== 2) throw new Error(`${entry.license_key}: expected GLB version 2`);
  if (bytes.readUInt32LE(8) !== bytes.byteLength) throw new Error(`${entry.license_key}: corrupt GLB byte length header`);
  if (bytes.byteLength !== entry.bytes) throw new Error(`${entry.license_key}: manifest byte count drift`);
  if (createHash("sha256").update(bytes).digest("hex") !== entry.sha256) throw new Error(`${entry.license_key}: checksum mismatch`);

  const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const gltf = await loader.parseAsync(data, path.dirname(absolute));
  if (gltf.animations.length !== 0) throw new Error(`${entry.license_key}: static building contains animations`);
  if (gltf.cameras.length !== 0) throw new Error(`${entry.license_key}: building contains cameras`);

  const meshes: THREE.Mesh[] = [];
  const forbidden: string[] = [];
  let metadata: Record<string, unknown> | undefined;
  gltf.scene.traverse((object) => {
    if ((object as THREE.Mesh).isMesh) meshes.push(object as THREE.Mesh);
    if ((object as THREE.Light).isLight) forbidden.push(`light:${object.name}`);
    if (object.userData.schema === "markets-and-makers.procedural-business.v1") metadata = object.userData;
  });
  if (forbidden.length) throw new Error(`${entry.license_key}: ${forbidden.join(", ")}`);
  if (meshes.length !== 1) throw new Error(`${entry.license_key}: expected one mesh, got ${meshes.length}`);
  if (!metadata) throw new Error(`${entry.license_key}: exported identity metadata is missing`);
  if (metadata.businessLicense !== entry.license_key || metadata.assetId !== entry.asset_id) throw new Error(`${entry.license_key}: identity metadata mismatch`);
  if (metadata.upAxis !== "+Y" || metadata.customerFront !== "+Z") throw new Error(`${entry.license_key}: axis metadata mismatch`);

  const mesh = meshes[0]!;
  if (Array.isArray(mesh.material)) throw new Error(`${entry.license_key}: more than one material primitive`);
  const material = mesh.material as THREE.MeshStandardMaterial;
  if (!material.vertexColors || material.map || material.transparent || material.side !== THREE.FrontSide) throw new Error(`${entry.license_key}: material is outside mobile-lite profile`);
  if (mesh.geometry.getAttribute("uv")) throw new Error(`${entry.license_key}: unexpected UV stream`);
  if (!mesh.geometry.getAttribute("color")) throw new Error(`${entry.license_key}: vertex colours missing`);
  const triangles = (mesh.geometry.getIndex()?.count ?? mesh.geometry.getAttribute("position").count) / 3;
  const vertices = mesh.geometry.getAttribute("position").count;
  if (triangles !== entry.triangles || vertices !== entry.vertices) throw new Error(`${entry.license_key}: geometry counts drifted from manifest`);
  if (triangles > 8_000) throw new Error(`${entry.license_key}: ${triangles} triangles exceeds mobile hard cap`);

  gltf.scene.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(gltf.scene, true);
  const size = bounds.getSize(new THREE.Vector3());
  if (Math.abs(bounds.min.y) > 0.001) throw new Error(`${entry.license_key}: not grounded (${bounds.min.y})`);
  if (size.x > entry.footprint_tiles[0] * manifest.tile_size_m + 0.01 || size.z > entry.footprint_tiles[1] * manifest.tile_size_m + 0.01) {
    throw new Error(`${entry.license_key}: ${size.x.toFixed(3)}×${size.z.toFixed(3)} m exceeds official footprint`);
  }

  totalBytes += bytes.byteLength;
  totalTriangles += triangles;
}

console.log(`Business v2 validation passed: 15 unique GLBs, ${totalTriangles.toLocaleString()} triangles, ${totalBytes.toLocaleString()} bytes, one draw call each.`);
