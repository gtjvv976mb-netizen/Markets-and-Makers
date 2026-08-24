#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "../../..");
const stagingRoot = mkdtempSync(join(tmpdir(), "markets-makers-rigs-"));
const citizenRoot = join(stagingRoot, "citizens");
const civicSource = join(stagingRoot, "av01-civic-maker-rigged.glb");

function run(script, args) {
  execFileSync(process.execPath, [join(projectRoot, script), ...args], {
    cwd: projectRoot,
    env: process.env,
    stdio: "inherit",
  });
}

try {
  run("scripts/rig-mercedonian-avatars.mjs", [
    "--output-root", citizenRoot,
    "--civic-output", civicSource,
  ]);
  run("scripts/worldgen/mercedonians/optimize_mercedonian_avatars.mjs", [
    "--source-root", citizenRoot,
    "--civic-source", civicSource,
  ]);
}
finally {
  rmSync(stagingRoot, { recursive: true, force: true });
}
