import { describe, expect, it } from "vitest";
import { WORLD_ASSET_VERSION, versionedWorldUrl } from "../src/tileTextures";
import packageManifest from "../public/assets/world/highlands-rivers-v1/browser-package.json";

const manifest = packageManifest as { files: Array<{ file: string; sha256: string }> };
const buffer = manifest.files.find((entry) => entry.file === "buffers/world-0.bin")!;

describe("world asset version", () => {
  // The world files carry a seven-day cache header on paths that never change, so a
  // rebuilt world would keep being served from a returning player's disk cache for a
  // week. Tying the version to the buffer's own hash means rebuilding the world without
  // bumping it fails here rather than quietly shipping stale geometry to everyone who
  // has visited recently.
  it("matches the world buffer actually on disk", () => {
    expect(WORLD_ASSET_VERSION).toBe(buffer.sha256.slice(0, 8));
  });

  it("stamps world assets, under either root", () => {
    expect(versionedWorldUrl("./assets/world/highlands-rivers-v1/world.gltf"))
      .toBe(`./assets/world/highlands-rivers-v1/world.gltf?v=${WORLD_ASSET_VERSION}`);
    expect(versionedWorldUrl("./world/roadnet.json"))
      .toBe(`./world/roadnet.json?v=${WORLD_ASSET_VERSION}`);
  });

  it("preserves a query that is already there", () => {
    expect(versionedWorldUrl("./world/roadnet.json?x=1"))
      .toBe(`./world/roadnet.json?x=1&v=${WORLD_ASSET_VERSION}`);
  });

  it("leaves everything else alone", () => {
    // Hashed bundles and the avatar runtime are cached correctly on their own terms;
    // stamping them would only defeat that.
    for (const url of [
      "./assets/index-abc123.js",
      "./assets/avatars/mercedonians/runtime/manifest.json",
      "./assets/brand/logo.png",
      "data:image/png;base64,AAAA",
    ]) {
      expect(versionedWorldUrl(url)).toBe(url);
    }
  });
});
