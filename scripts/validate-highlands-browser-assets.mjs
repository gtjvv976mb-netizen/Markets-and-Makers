#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { dirname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = join(repository, "game/public/assets/world/highlands-rivers-v1");
const maximumCloudflareAsset = 25 * 1024 * 1024;

const problems = [];
const check = (condition, message) => { if (!condition) problems.push(message); };
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const inside = (base, relativePath) => {
  const candidate = resolve(base, normalize(relativePath));
  return candidate === base || candidate.startsWith(`${base}${sep}`) ? candidate : null;
};

const packageManifest = JSON.parse(await readFile(join(root, "browser-package.json"), "utf8"));
check(packageManifest.schema === "markets-and-makers.highlands-rivers-world.browser-package.v1", "unexpected browser package schema");
check(packageManifest.source?.sha256 === "a351cc398ac3b6987ab5177e60bba3b42d623843046a0a003d0b8ea77c14a05e", "source Highlands preview hash drifted");
check(packageManifest.counts?.nodes === 326, "expected 326 world nodes");
check(packageManifest.counts?.materials === 31, "expected 31 authored materials");
check(packageManifest.counts?.images === 40, "expected 40 shared textures");
check(packageManifest.counts?.buffers === 2, "expected two browser-safe geometry buffers");

const browserWorldManifest = JSON.parse(await readFile(join(root, "..", "manifest.json"), "utf8"));
check(browserWorldManifest.active_world?.id === "highlands-rivers-v1", "browser world manifest does not activate Highlands & Rivers");
check(browserWorldManifest.active_world?.entrypoint === "highlands-rivers-v1/world.gltf", "browser world entrypoint drifted");
check(browserWorldManifest.active_world?.source_sha256 === packageManifest.source?.sha256, "browser world source lock drifted");
check(browserWorldManifest.rollback_world?.entrypoint === "sunwoven-reach-v1.glb", "legacy rollback world is not declared");

for (const entry of packageManifest.files ?? []) {
  const path = inside(root, entry.file);
  check(Boolean(path), `unsafe browser-package path ${entry.file}`);
  if (!path) continue;
  try {
    const bytes = await readFile(path);
    check(bytes.length === entry.bytes, `${entry.file} byte size drifted`);
    check(sha256(bytes) === entry.sha256, `${entry.file} hash drifted`);
    check(bytes.length < maximumCloudflareAsset, `${entry.file} exceeds Cloudflare's per-file asset ceiling`);
  } catch {
    problems.push(`${entry.file} is missing`);
  }
}

const gltf = JSON.parse(await readFile(join(root, packageManifest.entrypoint), "utf8"));
check(gltf.asset?.extras?.sourceSha256 === packageManifest.source.sha256, "gltf source lock does not match browser package");
check((gltf.nodes?.length ?? 0) === packageManifest.counts.nodes, "gltf node count does not match browser package");
check((gltf.materials?.length ?? 0) === packageManifest.counts.materials, "gltf material count does not match browser package");
for (const buffer of gltf.buffers ?? []) {
  const path = inside(root, buffer.uri);
  check(Boolean(path), `unsafe buffer URI ${buffer.uri}`);
  if (path) check((await stat(path)).size === buffer.byteLength, `${buffer.uri} declared byteLength drifted`);
}
for (const image of gltf.images ?? []) {
  const path = inside(root, image.uri);
  check(Boolean(path), `unsafe image URI ${image.uri}`);
  if (path) await stat(path).catch(() => problems.push(`${image.uri} is missing`));
}

const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
const layout = JSON.parse(await readFile(join(root, "layout.json"), "utf8"));
check(manifest.counts?.chunks === 256, "runtime manifest must declare 256 chunks");
check(manifest.counts?.government_buildings === 9, "runtime manifest must declare 9 civic buildings");
check(manifest.counts?.total_empty_plots === 42, "runtime manifest must declare 42 empty plots");
check((layout.plots?.existing?.length ?? 0) + (layout.plots?.added?.length ?? 0) === 42, "layout must contain exactly 42 empty plots");
check(layout.world?.dimensions_m?.[0] === 512 && layout.world?.dimensions_m?.[1] === 512, "world must remain 512 by 512 metres");

if (problems.length) {
  console.error(`Highlands browser validation failed (${problems.length}):`);
  for (const problem of problems) console.error(`- ${problem}`);
  process.exit(1);
}
console.log(`Highlands browser validation passed: ${packageManifest.files.length} packaged files, 256 terrain chunks, 9 civic buildings, 42 empty plots.`);
