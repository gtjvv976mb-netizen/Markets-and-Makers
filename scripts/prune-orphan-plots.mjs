// Drops generated plots that the road prune left without frontage.
//
// Plots are laid against the planned street grid, but the grid is pruned afterwards —
// dead-end tails get cut back — so a handful of lots end up facing a street that is no
// longer there. A lot with no road is a lot nobody can lease.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const net = JSON.parse(readFileSync(resolve(root, "game/public/world/roadnet.json"), "utf8"));
const file = resolve(root, "game/src/generatedPlots.ts");

const road = new Set();
for (const [y, a, b] of net.roadRuns) for (let x = a; x <= b; x += 1) road.add(`${x},${y}`);

const REACH = 2;
const source = readFileSync(file, "utf8");
const lines = source.split("\n");
let dropped = 0;
const kept = lines.filter((line) => {
  const m = /^\s*\["[^"]+","[^"]*",(-?\d+),(-?\d+),(-?\d+),(-?\d+)/.exec(line);
  if (!m) return true;
  const [x0, z0, x1, z1] = m.slice(1, 5).map(Number);
  for (let x = x0 - REACH; x <= x1 + REACH; x += 1) {
    for (let z = z0 - REACH; z <= z1 + REACH; z += 1) {
      if (x >= x0 && x <= x1 && z >= z0 && z <= z1) continue;
      if (road.has(`${x},${z}`)) return true;
    }
  }
  dropped += 1;
  return false;
});

writeFileSync(file, kept.join("\n"));
const total = lines.length - kept.length + kept.filter((l) => /^\s*\["/.test(l)).length;
console.log(`plots ${total} -> ${total - dropped}; dropped ${dropped} without frontage`);
