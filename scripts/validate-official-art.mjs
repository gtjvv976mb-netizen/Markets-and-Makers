import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const library = resolve(workspace, "art/official-v1");
const failures = [];

function fail(message) {
  failures.push(message);
}

function pngDimensions(file) {
  const bytes = readFileSync(file);
  const signature = "89504e470d0a1a0a";
  if (bytes.length < 24 || bytes.subarray(0, 8).toString("hex") !== signature) {
    throw new Error("not a valid PNG");
  }
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

function checkReference(relativePath, exactSquare = false) {
  const file = resolve(library, relativePath);
  if (!existsSync(file)) {
    fail(`missing reference: ${relativePath}`);
    return;
  }
  try {
    const [width, height] = pngDimensions(file);
    if (exactSquare && (width !== 1254 || height !== 1254)) {
      fail(`${relativePath} must be the approved 1254×1254 turnaround master; found ${width}×${height}`);
    }
    if (!exactSquare && Math.min(width, height) < 1000) {
      fail(`${relativePath} is below the 1000 px reference minimum; found ${width}×${height}`);
    }
  } catch (error) {
    fail(`${relativePath}: ${error.message}`);
  }
}

const manifestPath = resolve(library, "manifest.json");
if (!existsSync(manifestPath)) fail("missing art/official-v1/manifest.json");
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : {};

const expectedLicenses = [
  "aquaworks", "sungrid", "greenhouse", "mine", "timberworks", "cratemill", "workshop", "factory",
  "construction", "freight", "shop", "restaurant", "gym", "cinema", "recycler",
];
const businesses = Array.isArray(manifest.businesses) ? manifest.businesses : [];
if (manifest.schema !== "markets-and-makers.official-art.v1") fail("unexpected official-art schema");
if (manifest.status !== "approved-production-authority") fail("official art is not marked approved-production-authority");
if (manifest.tile_size_m !== 2) fail("official tile size must be 2 m");
if (manifest.source_axes?.up !== "+Z" || manifest.source_axes?.customer_front !== "-Y") fail("Blender source axes must remain +Z up / -Y front");
if (manifest.gltf_axes?.up !== "+Y" || manifest.gltf_axes?.customer_front !== "+Z") fail("glTF axes must remain +Y up / +Z front");
if (manifest.turntable_panel_order?.map((entry) => entry.degrees).join(",") !== "0,90,180,270") fail("turntable panels must remain ordered 0°, 90°, 180°, 270°");
if (businesses.length !== expectedLicenses.length) fail(`expected 15 business references; found ${businesses.length}`);

const licenseKeys = businesses.map((entry) => entry.license_key);
const assetIds = businesses.map((entry) => entry.asset_id);
if (new Set(licenseKeys).size !== licenseKeys.length) fail("business license keys must be unique");
if (new Set(assetIds).size !== assetIds.length) fail("business asset IDs must be unique");
for (const key of expectedLicenses) if (!licenseKeys.includes(key)) fail(`missing license mapping: ${key}`);

for (const entry of businesses) {
  if (!/^mm_biz_[a-z0-9_]+_v1$/.test(entry.asset_id ?? "")) fail(`invalid stable asset ID for ${entry.license_key}`);
  if (!Array.isArray(entry.footprint_tiles) || entry.footprint_tiles.length !== 2 || entry.footprint_tiles.some((value) => !Number.isInteger(value) || value <= 0)) {
    fail(`invalid footprint for ${entry.license_key}`);
  }
  checkReference(entry.turntable, true);
  checkReference(entry.approved_original ?? entry.style_source);
}

const publicStructures = Array.isArray(manifest.public_structures) ? manifest.public_structures : [];
if (publicStructures.length !== 1) fail(`expected one public structure reference; found ${publicStructures.length}`);
for (const entry of publicStructures) {
  checkReference(entry.turntable, true);
  checkReference(entry.approved_original ?? entry.style_source);
}

const tileManifestPath = resolve(library, manifest.world_tile_kit ?? "");
if (!manifest.world_tile_kit || !existsSync(tileManifestPath)) {
  fail("missing official world-tile manifest");
} else {
  const tileManifest = JSON.parse(readFileSync(tileManifestPath, "utf8"));
  const tiles = Array.isArray(tileManifest.tiles) ? tileManifest.tiles : [];
  if (tileManifest.schema !== "markets-and-makers.logo-world-tiles.v1") fail("unexpected logo-world tile schema");
  if (tileManifest.status !== "approved-official-models-v4") fail("logo-world tile inventory has unexpected status");
  if (tiles.length !== 50 || tileManifest.counts?.structural_sources !== 50) fail(`expected 50 structural world tiles; found ${tiles.length}`);
  if (new Set(tiles.map((entry) => entry.id)).size !== tiles.length) fail("world-tile IDs must be unique");
  if (new Set(tiles.map((entry) => entry.key)).size !== tiles.length) fail("world-tile keys must be unique");
  checkReference(`world-tiles-v1/${tileManifest.visual_reference?.file ?? ""}`);
}

const checksumPath = resolve(library, "checksums.sha256");
if (!existsSync(checksumPath)) {
  fail("missing immutable reference fingerprints");
} else {
  const lines = readFileSync(checksumPath, "utf8").trim().split(/\r?\n/).filter(Boolean);
  if (lines.length !== 25) fail(`expected 25 reference fingerprints; found ${lines.length}`);
  for (const line of lines) {
    const match = /^([0-9a-f]{64})  (.+)$/.exec(line);
    if (!match) {
      fail(`malformed checksum line: ${line}`);
      continue;
    }
    const file = resolve(workspace, match[2]);
    if (!existsSync(file)) {
      fail(`checksummed file is missing: ${match[2]}`);
      continue;
    }
    const actual = createHash("sha256").update(readFileSync(file)).digest("hex");
    if (actual !== match[1]) fail(`reference fingerprint changed: ${match[2]}`);
  }
}

if (failures.length) {
  console.error(`Official art validation failed (${failures.length}):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Official art validation passed: ${businesses.length} businesses, ${publicStructures.length} public structure, 50 world tiles, 25 locked references.`);
