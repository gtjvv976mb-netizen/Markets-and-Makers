#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const projectRoot = resolve(import.meta.dirname, "../../..");
const sourceDir = join(projectRoot, "game/public/assets/avatars/mercedonians");
const runtimeDir = join(sourceDir, "runtime");

const avatars = [
  ["av02-urban-gardener.glb", 0.014],
  ["av03-solar-technician.glb", 0.014],
  ["av04-market-grocer.glb", 0.014],
  ["av05-fabricator-engineer.glb", 0.014],
  ["av06-harbor-courier.glb", 0.007],
  ["av07-community-chef.glb", 0.014],
  ["av08-cooperative-shopkeeper.glb", 0.007],
  ["av10-repair-mechanic.glb", 0.014],
  ["av12-water-systems-biologist.glb", 0.014],
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

function inspect(path) {
  const report = runCli(["inspect", path, "--format=csv"], true);
  const meshMatch = report.match(/^\d+,[^,]*,TRIANGLES,\d+,(\d+),/m);
  if (!meshMatch) throw new Error(`Unable to read triangle count for ${path}`);
  const triangles = Number(meshMatch[1]);
  const animations = [...report.matchAll(/\n\d+,(Idle|Walk),/g)].map((match) => match[1]);
  if (!animations.includes("Idle") || !animations.includes("Walk")) {
    throw new Error(`${basename(path)} lost its Idle or Walk animation`);
  }
  return { triangles, animations };
}

mkdirSync(runtimeDir, { recursive: true });
const manifest = [];

for (const [file, ratio] of avatars) {
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
  manifest.push({
    file,
    source: { bytes: statSync(input).size, sha256: sha256(input) },
    runtime: { bytes: statSync(output).size, sha256: sha256(output), ...details },
  });
}

writeFileSync(
  join(runtimeDir, "manifest.json"),
  `${JSON.stringify({ schema: "markets-and-makers.mercedonians-runtime.v1", avatars: manifest }, null, 2)}\n`,
);

const sourceBytes = manifest.reduce((total, item) => total + item.source.bytes, 0);
const runtimeBytes = manifest.reduce((total, item) => total + item.runtime.bytes, 0);
const runtimeTriangles = manifest.reduce((total, item) => total + item.runtime.triangles, 0);
console.log(`Optimized ${manifest.length} citizens: ${sourceBytes} -> ${runtimeBytes} bytes, ${runtimeTriangles} triangles.`);
