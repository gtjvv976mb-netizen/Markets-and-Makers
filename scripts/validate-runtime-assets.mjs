// Every asset the shipped app asks for must exist in public/.
//
// validate-official-art checks the reference library under art/, which is where
// artwork is authored. It says nothing about game/public, which is what the browser
// actually fetches — so a brand asset can be deleted from public/ while index.html
// still points at it, the build stays green, and the deploy serves a 404 where the
// logo should be. That is not hypothetical: it is the state one of the two checkouts
// was left in on 2026-08-26, with markets-makers-official.avif gone from disk and
// still referenced twice.
//
// This runs in the build, so it protects whoever builds — either checkout, either
// assistant — without anyone having to agree to run it.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const game = resolve(workspace, "game");
const publicDir = resolve(game, "public");

/** Files that can name an asset. Vite rewrites imports; these are raw URL strings. */
const SOURCES = [resolve(game, "index.html"), resolve(game, "src")];
const SOURCE_EXTENSIONS = new Set([".html", ".ts", ".tsx", ".css", ".js"]);

/** A big texture on a phone is a stall, not a nicety. Warn well before it hurts. */
const LARGE_ASSET_BYTES = 512 * 1024;

const failures = [];
const warnings = [];

/**
 * Stems the client builds instead of downloading.
 *
 * installProceduralLoader answers building and decoration URLs from a generated
 * catalogue, so those paths are referenced in source, never fetched, and correctly
 * absent from public/. The first draft of this script did not know that and reported
 * all fifteen business models as missing — a validator that cries wolf gets switched
 * off, so it reads the same catalogue the loader does rather than keeping its own copy
 * to drift out of date. Delete a generator and its stem stops being exempt, which is
 * the behaviour we want.
 */
function proceduralStems() {
  const source = resolve(game, "src/proceduralAssets.ts");
  if (!existsSync(source)) return new Set();
  const text = readFileSync(source, "utf8");
  const stems = new Set();
  for (const table of ["STRUCTURES", "DECORATIONS"]) {
    const start = text.indexOf(`const ${table}: Record<string, () => THREE.Group> = {`);
    if (start < 0) continue;
    // Keys are quoted stems, one per entry, up to the closing brace of the table.
    const body = text.slice(start, text.indexOf("\n};", start));
    for (const [, stem] of body.matchAll(/["']([\w.-]+)["']\s*:/g)) stems.add(stem);
  }
  return stems;
}

const generated = proceduralStems();
const stemOf = (path) => path.split("/").pop().replace(/\.[^.]+$/, "");

function sourceFiles() {
  const found = [];
  const walk = (path) => {
    const stat = statSync(path);
    if (stat.isFile()) {
      if (SOURCE_EXTENSIONS.has(extname(path))) found.push(path);
      return;
    }
    for (const entry of readdirSync(path)) walk(join(path, entry));
  };
  for (const source of SOURCES) if (existsSync(source)) walk(source);
  return found;
}

// "/assets/brand/x.avif" or "./assets/world/y.json" — the forms the app actually uses.
// A reference carrying ${...} is built at runtime and cannot be resolved from here.
const REFERENCE = /["'`](\.?\/assets\/[^"'`]+)["'`]/g;

const referenced = new Map();
for (const file of sourceFiles()) {
  const text = readFileSync(file, "utf8");
  for (const [, raw] of text.matchAll(REFERENCE)) {
    if (raw.includes("${") || raw.includes("*")) continue;
    const relative = raw.replace(/^\.?\//, "");
    if (!referenced.has(relative)) referenced.set(relative, []);
    referenced.get(relative).push(file.replace(`${workspace}/`, ""));
  }
}

for (const [relative, sites] of referenced) {
  if (generated.has(stemOf(relative))) continue;
  const onDisk = resolve(publicDir, relative);
  if (!existsSync(onDisk)) {
    failures.push(`missing asset: public/${relative}\n    wanted by ${[...new Set(sites)].join(", ")}`);
    continue;
  }
  const { size } = statSync(onDisk);
  if (size > LARGE_ASSET_BYTES) {
    warnings.push(`large asset: public/${relative} is ${(size / 1024 / 1024).toFixed(2)} MB`);
  }
}

for (const warning of warnings) console.warn(`  warning: ${warning}`);

if (failures.length > 0) {
  console.error("Runtime assets are missing from public/:\n");
  for (const failure of failures) console.error(`  - ${failure}`);
  console.error("\nThe build serves these paths verbatim; a missing file is a 404 in the live game.");
  process.exit(1);
}

const checked = [...referenced.keys()].filter((relative) => !generated.has(stemOf(relative))).length;
console.log(`runtime assets ok — ${checked} fetched and present, ${referenced.size - checked} generated in the client`);
