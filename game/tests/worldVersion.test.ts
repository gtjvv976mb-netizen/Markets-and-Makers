import { describe, expect, it } from "vitest";
import { WORLD_ASSET_VERSION, versionedWorldUrl } from "../src/tileTextures";


describe("world asset version", () => {
  // The world files carry a long cache header on paths that never change, so this key
  // is what makes a rebuilt world reach a returning player. It is generated from those
  // files rather than maintained by hand — the hand-maintained version broke the first
  // time a world file changed that was not the one it was tied to.
  it("is a real fingerprint, not a placeholder", () => {
    expect(WORLD_ASSET_VERSION).toMatch(/^[0-9a-f]{12}$/);
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
