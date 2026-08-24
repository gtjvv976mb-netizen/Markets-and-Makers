import { describe, expect, it } from "vitest";
import { BUSINESS } from "../src/data";
import { proceduralSceneFor } from "../src/proceduralAssets";
import { snapToTileCentre as designSnap, tileYaw } from "../src/worldDesigns";
import worldDesignManifest from "../public/assets/world/highlands-rivers-v1/world-designs-v1/manifest.json";

const manifest = worldDesignManifest as { assets: Array<{ id: string; category: string; file: string }> };

describe("procedural asset catalogue", () => {
  // The GLBs these URLs point at are no longer shipped, so a stem the catalogue does
  // not answer becomes a 404 and a hard load failure in the browser.
  it("answers every business model referenced by the catalogue", () => {
    const missing = Object.entries(BUSINESS)
      .filter(([, config]) => !proceduralSceneFor(config.model))
      .map(([key, config]) => `${key} -> ${config.model}`);
    expect(missing).toEqual([]);
  });

  it("answers every world-design asset except the rigged avatar", () => {
    const missing = manifest.assets
      .filter((asset) => asset.category !== "avatar")
      .filter((asset) => !proceduralSceneFor(asset.file))
      .map((asset) => asset.file);
    expect(missing).toEqual([]);
  });

  it("leaves the rigged avatar to the real loader, so its clips survive", () => {
    const avatar = manifest.assets.find((asset) => asset.category === "avatar");
    expect(avatar).toBeDefined();
    expect(proceduralSceneFor(avatar!.file)).toBeNull();
  });

  it("builds each asset as one merged mesh, which the instancer requires", () => {
    for (const asset of manifest.assets.filter((entry) => entry.category !== "avatar")) {
      const scene = proceduralSceneFor(asset.file);
      let meshes = 0;
      scene!.traverse((object) => {
        if ((object as { isMesh?: boolean }).isMesh) meshes += 1;
      });
      expect(`${asset.id}:${meshes}`).toBe(`${asset.id}:1`);
    }
  });

  it("gives every asset real geometry with vertex colours", () => {
    const scene = proceduralSceneFor("b05-canopy-greenhouse.glb");
    let checked = false;
    scene!.traverse((object) => {
      const mesh = object as { isMesh?: boolean; geometry?: { attributes: Record<string, { count: number }> } };
      if (!mesh.isMesh || !mesh.geometry) return;
      expect(mesh.geometry.attributes.position!.count).toBeGreaterThan(100);
      expect(mesh.geometry.attributes.color).toBeDefined();
      checked = true;
    });
    expect(checked).toBe(true);
  });
});

describe("the tile rule", () => {
  it("snaps positions onto 2 m tile centres", () => {
    expect(designSnap(-88.08)).toBe(-88);
    expect(designSnap(57.92)).toBe(58);
    expect(designSnap(-61.92)).toBe(-62);
    expect(designSnap(46)).toBe(46);
  });

  it("squares built things onto quarter turns and leaves planting alone", () => {
    expect(tileYaw("street", 75)).toBe(90);
    expect(tileYaw("vehicles", 195)).toBe(180);
    expect(tileYaw("boats", 15)).toBe(0);
    expect(tileYaw("trees", 15)).toBe(15);
    expect(tileYaw("shrubs", 105)).toBe(105);
  });

  it("keeps a snapped prop on the tile it was authored against", () => {
    // Worst authored drift is 0.25 m, well inside a 2 m tile, so the ground the prop
    // was validated against is still the ground it lands on.
    for (const value of [-88.08, -89.92, 57.92, -60.08, 12.25, -3.75]) {
      expect(Math.abs(designSnap(value) - value)).toBeLessThanOrEqual(1);
    }
  });

  it("rounds a half-tile offset up to the next centre", () => {
    expect(designSnap(3)).toBe(4);
    expect(designSnap(1)).toBe(2);
  });
});
