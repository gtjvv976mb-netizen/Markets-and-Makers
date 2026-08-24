#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repository = resolve(scriptDirectory, "../../..");

const options = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  options.set(process.argv[index], process.argv[index + 1]);
}

const inputRoot = resolve(options.get("--input") ?? "");
const runtimeRoot = resolve(options.get("--runtime") ?? join(repository, "game/public/assets/world/highlands-rivers-v1/world-designs-v1"));
const renderRoot = resolve(options.get("--renders") ?? join(repository, "outputs/markets-and-makers-world-designs-v1"));
const temporaryRoot = resolve(options.get("--temporary") ?? "/private/tmp/markets-and-makers-world-designs-v1");
const blender = options.get("--blender") ?? "/opt/homebrew/bin/blender";
const renderEnabled = options.get("--skip-renders") !== "true";

if (!inputRoot || inputRoot === "/") {
  throw new Error("Pass --input with the uploaded 'world designs' folder.");
}

const catalogPath = join(scriptDirectory, "assets.json");
const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function glbJson(path) {
  const bytes = readFileSync(path);
  if (bytes.toString("utf8", 0, 4) !== "glTF") throw new Error(`${path} is not a binary glTF file`);
  const length = bytes.readUInt32LE(12);
  const type = bytes.readUInt32LE(16);
  if (type !== 0x4e4f534a) throw new Error(`${path} has no JSON chunk`);
  return JSON.parse(bytes.toString("utf8", 20, 20 + length));
}

function triangleCount(path) {
  const gltf = glbJson(path);
  let triangles = 0;
  for (const mesh of gltf.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      if ((primitive.mode ?? 4) !== 4) continue;
      if (primitive.indices !== undefined) triangles += Math.floor((gltf.accessors?.[primitive.indices]?.count ?? 0) / 3);
      else triangles += Math.floor((gltf.accessors?.[primitive.attributes?.POSITION]?.count ?? 0) / 3);
    }
  }
  return triangles;
}

function run(command, args) {
  console.log(`[world-designs] ${command} ${args.join(" ")}`);
  execFileSync(command, args, { stdio: "inherit" });
}

mkdirSync(join(runtimeRoot, "models"), { recursive: true });
mkdirSync(renderRoot, { recursive: true });
rmSync(temporaryRoot, { recursive: true, force: true });
mkdirSync(temporaryRoot, { recursive: true });

const records = [];
for (const asset of catalog.assets) {
  const source = join(inputRoot, asset.source);
  const sourceBytes = readFileSync(source);
  const sourceTriangles = triangleCount(source);
  const ratio = Math.min(1, asset.triangle_target / Math.max(1, sourceTriangles));
  const runtime = join(runtimeRoot, asset.runtime_file);
  const decoded = join(temporaryRoot, `${asset.id}-decoded.glb`);
  const render = join(renderRoot, `${asset.id}.png`);
  let optimizationSource = source;

  if (asset.category === "avatar") {
    const rigged = join(temporaryRoot, `${asset.id}-rigged.glb`);
    run(process.execPath, [
      join(repository, "scripts/rig-mercedonian-avatars.mjs"),
      "--skip-citizens", "true",
      "--civic-source", source,
      "--civic-output", rigged,
    ]);
    optimizationSource = rigged;
  }

  run("npx", [
    "--yes", "@gltf-transform/cli@4.3.0", "optimize", optimizationSource, runtime,
    "--simplify-ratio", ratio.toFixed(8), "--simplify-error", "0.012",
    "--texture-size", String(asset.texture_size), "--texture-compress", "webp",
    "--compress", "meshopt", "--meshopt-level", "high",
    "--flatten", asset.category === "avatar" ? "false" : "true",
    "--join", asset.category === "avatar" ? "false" : "true",
    "--palette", "false", "--instance", "false",
  ]);

  if (renderEnabled) {
    run("npx", ["--yes", "@gltf-transform/cli@4.3.0", "copy", optimizationSource, decoded]);
    run(blender, [
      "--background", "--factory-startup", "--python-exit-code", "1",
      "--python", join(scriptDirectory, "render_glb_asset.py"), "--",
      "--input", decoded, "--output", render, "--name", asset.name,
    ]);
  }

  const runtimeBytes = readFileSync(runtime);
  const runtimeTriangles = triangleCount(runtime);
  const rig = asset.category === "avatar" ? glbJson(runtime).asset?.extras?.marketsAndMakersRig : null;
  records.push({
    id: asset.id,
    name: asset.name,
    category: asset.category,
    file: asset.runtime_file,
    fit: asset.fit,
    targetM: asset.target_m,
    textureSize: asset.texture_size,
    ...(rig ? { frontAxis: rig.frontAxis, yawCorrectionDegrees: rig.yawCorrectionDegrees, rig } : {}),
    source: {
      relativeFile: asset.source,
      bytes: sourceBytes.length,
      sha256: sha256(sourceBytes),
      triangles: sourceTriangles,
    },
    runtime: {
      bytes: runtimeBytes.length,
      sha256: sha256(runtimeBytes),
      triangles: runtimeTriangles,
    },
    render: renderEnabled ? {
      file: `${asset.id}.png`,
      resolution: [1920, 1080],
    } : null,
  });
}

const buildManifest = {
  schema: "markets-and-makers.world-design-build.v1",
  version: catalog.version,
  createdAt: new Date().toISOString(),
  sourceCatalog: "scripts/worldgen/world-designs-v1/assets.json",
  counts: {
    assets: records.length,
    sourceTriangles: records.reduce((sum, asset) => sum + asset.source.triangles, 0),
    runtimeTriangles: records.reduce((sum, asset) => sum + asset.runtime.triangles, 0),
    sourceBytes: records.reduce((sum, asset) => sum + asset.source.bytes, 0),
    runtimeBytes: records.reduce((sum, asset) => sum + asset.runtime.bytes, 0),
  },
  assets: records,
};
writeFileSync(join(runtimeRoot, "build-manifest.json"), `${JSON.stringify(buildManifest, null, 2)}\n`);
writeFileSync(join(renderRoot, "render-manifest.json"), `${JSON.stringify(buildManifest, null, 2)}\n`);

if (renderEnabled) {
  run("python3", [
    join(scriptDirectory, "create_contact_sheet.py"), "--catalog", catalogPath,
    "--renders", renderRoot, "--output", join(renderRoot, "catalog.png"),
  ]);
}

console.log(`[world-designs] Complete: ${records.length} assets, ${buildManifest.counts.runtimeTriangles.toLocaleString()} unique runtime triangles, ${(buildManifest.counts.runtimeBytes / 1048576).toFixed(2)} MiB.`);
