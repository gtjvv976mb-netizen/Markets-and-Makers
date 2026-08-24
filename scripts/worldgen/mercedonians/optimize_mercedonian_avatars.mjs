#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const projectRoot = resolve(import.meta.dirname, "../../..");
const options = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  options.set(process.argv[index], process.argv[index + 1]);
}
const sourceDir = resolve(options.get("--source-root") ?? join(projectRoot, "game/public/assets/avatars/mercedonians"));
const runtimeDir = resolve(options.get("--runtime-root") ?? join(projectRoot, "game/public/assets/avatars/mercedonians/runtime"));
const civicSource = options.has("--civic-source") ? resolve(options.get("--civic-source")) : null;
const civicRuntime = resolve(options.get("--civic-runtime") ?? join(
  projectRoot,
  "game/public/assets/world/highlands-rivers-v1/world-designs-v1/models/av01-civic-maker.glb",
));

const avatars = [
  { file: "av02-urban-gardener.glb", ratio: 0.014, frontAxis: "+X" },
  { file: "av03-solar-technician.glb", ratio: 0.014, frontAxis: "+X" },
  { file: "av04-market-grocer.glb", ratio: 0.014, frontAxis: "+X" },
  { file: "av05-fabricator-engineer.glb", ratio: 0.014, frontAxis: "+X" },
  { file: "av06-harbor-courier.glb", ratio: 0.007, frontAxis: "+Z" },
  { file: "av07-community-chef.glb", ratio: 0.014, frontAxis: "+X" },
  { file: "av08-cooperative-shopkeeper.glb", ratio: 0.007, frontAxis: "+Z" },
  { file: "av10-repair-mechanic.glb", ratio: 0.014, frontAxis: "+X" },
  { file: "av12-water-systems-biologist.glb", ratio: 0.014, frontAxis: "+X" },
];

const cliOverride = process.env.MM_GLTF_TRANSFORM_BIN;

function runCli(args, capture = false) {
  const command = cliOverride || "npx";
  const commandArgs = cliOverride ? args : ["--yes", "@gltf-transform/cli@4.3.0", ...args];
  const result = spawnSync(command, commandArgs, {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || `${command} exited with status ${result.status}`);
  }
  return result.stdout || "";
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function glbJson(path) {
  const bytes = readFileSync(path);
  if (bytes.toString("utf8", 0, 4) !== "glTF") throw new Error(`${path} is not a binary glTF`);
  const jsonLength = bytes.readUInt32LE(12);
  return JSON.parse(bytes.toString("utf8", 20, 20 + jsonLength));
}

function inspect(path) {
  const report = runCli(["inspect", path, "--format=csv"], true);
  const meshMatch = report.match(/^\d+,[^,]*,TRIANGLES,\d+,(\d+),/m);
  if (!meshMatch) throw new Error(`Unable to read triangle count for ${path}`);
  const triangles = Number(meshMatch[1]);
  const animations = [...report.matchAll(/\n\d+,(Idle|Walk),/g)].map((match) => match[1]);
  if (!animations.includes("Idle") || !animations.includes("Walk")) {
    throw new Error(`${basename(path)} lost its Idle or Walk animation`);
  }
  const document = glbJson(path);
  const meshPrimitive = document.meshes?.[0]?.primitives?.[0];
  const skin = document.skins?.[0];
  const rig = document.asset?.extras?.marketsAndMakersRig;
  if (!skin || skin.joints?.length !== 15 || meshPrimitive?.attributes?.JOINTS_0 === undefined || meshPrimitive?.attributes?.WEIGHTS_0 === undefined) {
    throw new Error(`${basename(path)} does not contain the complete 15-joint skinned humanoid`);
  }
  if (rig?.schema !== "markets-and-makers.humanoid-rig.v2" || !["+X", "+Z"].includes(rig.frontAxis)) {
    throw new Error(`${basename(path)} lost its v2 rig metadata`);
  }
  return {
    triangles,
    animations,
    rig: {
      schema: rig.schema,
      skeleton: rig.skeleton,
      joints: skin.joints.length,
      frontAxis: rig.frontAxis,
      yawCorrectionDegrees: rig.yawCorrectionDegrees,
      rootMotion: rig.rootMotion,
    },
  };
}

mkdirSync(runtimeDir, { recursive: true });
const manifest = [];

for (const { file, ratio, frontAxis } of avatars) {
  const input = join(sourceDir, file);
  const output = join(runtimeDir, file);
  runCli([
    "optimize", input, output,
    "--compress", "meshopt",
    "--meshopt-level", "high",
    "--flatten", "false",
    "--join", "false",
    "--instance", "false",
    "--palette", "false",
    "--simplify", "true",
    "--simplify-ratio", String(ratio),
    "--simplify-error", "0.008",
    "--texture-size", "256",
    "--texture-compress", "webp",
  ]);
  const details = inspect(output);
  if (details.rig.frontAxis !== frontAxis || details.rig.yawCorrectionDegrees !== (frontAxis === "+X" ? -90 : 0)) {
    throw new Error(`${file} rig orientation metadata does not match its authored forward axis`);
  }
  manifest.push({
    file,
    frontAxis,
    yawCorrectionDegrees: details.rig.yawCorrectionDegrees,
    rig: details.rig,
    source: { bytes: statSync(input).size, sha256: sha256(input) },
    runtime: { bytes: statSync(output).size, sha256: sha256(output), ...details },
  });
}

writeFileSync(
  join(runtimeDir, "manifest.json"),
  `${JSON.stringify({ schema: "markets-and-makers.mercedonians-runtime.v2", avatars: manifest }, null, 2)}\n`,
);

if (civicSource) {
  const sourceDetails = inspect(civicSource);
  const ratio = Math.min(1, 18_000 / Math.max(1, sourceDetails.triangles));
  mkdirSync(dirname(civicRuntime), { recursive: true });
  runCli([
    "optimize", civicSource, civicRuntime,
    "--compress", "meshopt",
    "--meshopt-level", "high",
    "--flatten", "false",
    "--join", "false",
    "--instance", "false",
    "--palette", "false",
    "--simplify", "true",
    "--simplify-ratio", String(ratio),
    "--simplify-error", "0.012",
    "--texture-size", "512",
    "--texture-compress", "webp",
  ]);
  const details = inspect(civicRuntime);
  if (details.rig.frontAxis !== "+X" || details.rig.yawCorrectionDegrees !== -90) {
    throw new Error("Civic avatar rig orientation metadata is invalid");
  }
  const runtime = {
    bytes: statSync(civicRuntime).size,
    sha256: sha256(civicRuntime),
    triangles: details.triangles,
  };
  const worldDesignRoot = join(projectRoot, "game/public/assets/world/highlands-rivers-v1/world-designs-v1");
  for (const manifestName of ["manifest.json", "build-manifest.json"]) {
    const manifestPath = join(worldDesignRoot, manifestName);
    const worldManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const player = worldManifest.assets?.find((asset) => asset.id === "av01_civic_maker");
    if (!player) throw new Error(`${manifestName} is missing av01_civic_maker`);
    const previousBytes = player.runtime?.bytes ?? 0;
    const previousTriangles = player.runtime?.triangles ?? 0;
    player.frontAxis = "+X";
    player.yawCorrectionDegrees = -90;
    player.rig = details.rig;
    player.runtime = runtime;
    if (manifestName === "build-manifest.json") {
      worldManifest.counts.runtimeBytes += runtime.bytes - previousBytes;
      worldManifest.counts.runtimeTriangles += runtime.triangles - previousTriangles;
    }
    writeFileSync(manifestPath, `${JSON.stringify(worldManifest, null, 2)}\n`);
  }
  console.log(`Optimized civic player: ${sourceDetails.triangles} -> ${details.triangles} triangles, ${runtime.bytes} bytes.`);
}

const sourceBytes = manifest.reduce((total, item) => total + item.source.bytes, 0);
const runtimeBytes = manifest.reduce((total, item) => total + item.runtime.bytes, 0);
const runtimeTriangles = manifest.reduce((total, item) => total + item.runtime.triangles, 0);
console.log(`Optimized ${manifest.length} citizens: ${sourceBytes} -> ${runtimeBytes} bytes, ${runtimeTriangles} triangles.`);
