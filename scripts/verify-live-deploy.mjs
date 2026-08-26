// After a deploy, ask the live site rather than the build log.
//
// A green build proves the bundle compiled. It does not prove Cloudflare is serving it,
// that the entry document is the new one, or that the assets it names came back as
// anything other than a 404 page with a 200 status. Chikoria shipped sealed tokens
// twice against images that existed locally and had never been published; the tell
// would have been one curl. This is that curl, run automatically so nobody has to
// remember it.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ORIGIN = process.env.MM_LIVE_ORIGIN ?? "https://www.markets-makers.com";
const TIMEOUT_MS = 20_000;
const DIST = join(dirname(fileURLToPath(import.meta.url)), "..", "game", "dist");

/** The hashed entry files an index.html points at. */
function bundlesIn(html) {
  return [...html.matchAll(/\/assets\/index-[A-Za-z0-9_-]+\.(?:js|css)/g)].map((m) => m[0]).sort();
}

async function text(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { redirect: "follow", signal: controller.signal, cache: "no-store" });
    return { status: response.status, body: await response.text(), cache: response.headers.get("cf-cache-status") ?? "" };
  } finally {
    clearTimeout(timer);
  }
}

async function head(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { redirect: "follow", signal: controller.signal });
    const body = await response.arrayBuffer();
    return { status: response.status, bytes: body.byteLength, type: response.headers.get("content-type") ?? "" };
  } finally {
    clearTimeout(timer);
  }
}

const failures = [];

const index = await head(`${ORIGIN}/`).catch((error) => ({ error: String(error) }));
if (index.error) failures.push(`could not reach ${ORIGIN}/ — ${index.error}`);
else {
  if (index.status !== 200) failures.push(`${ORIGIN}/ returned ${index.status}`);
  if (index.bytes < 500) failures.push(`${ORIGIN}/ returned only ${index.bytes} bytes`);
  console.log(`  ${ORIGIN}/ — ${index.status}, ${index.bytes} bytes`);
}

// The worker serves a single-page app: an unknown path returns index.html with a 200,
// so a missing asset cannot be detected by status alone. Compare it against a path
// that certainly does not exist, and treat "identical to the fallback" as missing.
const decoy = await head(`${ORIGIN}/assets/__no_such_asset__.bin`).catch(() => null);

for (const asset of ["/assets/brand/markets-makers-official.avif", "/assets/brand/mm-maker-crest.svg"]) {
  const result = await head(`${ORIGIN}${asset}`).catch((error) => ({ error: String(error) }));
  if (result.error) {
    failures.push(`could not reach ${asset} — ${result.error}`);
    continue;
  }
  const servedTheFallback = decoy !== null && result.bytes === decoy.bytes && result.type.includes("text/html");
  if (result.status !== 200 || servedTheFallback) {
    failures.push(`${asset} is not being served (${result.status}${servedTheFallback ? ", got the SPA fallback" : ""})`);
  } else {
    console.log(`  ${asset} — ${result.status}, ${result.bytes} bytes, ${result.type}`);
  }
}

// THE CHECK THAT MATTERS: is the live page pointing at the bundle we just built?
//
// Everything above can pass while players still receive the previous release. That is not
// hypothetical — it happened on 2026-08-27: both new assets uploaded and returned 200, the
// entry document was a cached copy naming the OLD bundle, and this script called it green.
// A deploy that changes nothing a player can load is a failed deploy, and it should say so
// rather than printing "verified".
try {
  const built = bundlesIn(await readFile(join(DIST, "index.html"), "utf8"));
  const live = await text(`${ORIGIN}/`);
  const serving = bundlesIn(live.body);
  const missing = built.filter((file) => !serving.includes(file));
  if (built.length === 0) {
    failures.push("could not find a hashed bundle in game/dist/index.html — did the build run?");
  } else if (missing.length > 0) {
    failures.push(
      `the live page is not serving this build.\n`
      + `      built:   ${built.join(", ")}\n`
      + `      serving: ${serving.join(", ") || "(none found)"}\n`
      + `      cf-cache-status: ${live.cache || "unknown"}\n`
      + `      The assets almost certainly uploaded fine — it is the entry document that is\n`
      + `      stale. Purge the cached HTML for this zone, or wait out its TTL. A Cache Rule\n`
      + `      that ignores query strings will keep serving it however many times you deploy.`);
  } else {
    console.log(`  entry document names this build — ${built.join(", ")}`);
  }
} catch (error) {
  failures.push(`could not compare the built bundle with the live one — ${error}`);
}

if (failures.length > 0) {
  console.error("\nThe deploy is live but not serving correctly:\n");
  for (const failure of failures) console.error(`  - ${failure}`);
  console.error("\n`wrangler rollback <id>` is faster than debugging under pressure.");
  process.exit(1);
}

console.log("live deploy verified");
