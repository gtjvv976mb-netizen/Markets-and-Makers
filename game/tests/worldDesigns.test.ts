import { describe, expect, it, vi } from "vitest";
import {
  WORLD_DESIGN_GROUNDING,
  worldDesignGrounding,
  worldDesignPlacementY,
  worldDesignSupportSamples,
  type WorldDesignAsset,
  type WorldDesignGrounding,
  type WorldDesignPlacement,
} from "../src/worldDesigns";

const grounding: WorldDesignGrounding = {
  baseAnchorXZ: [0, 0],
  footprintM: [2, 4],
  supportPoints: [[1, 0], [-1, 0], [0, 2]],
  groundClearanceM: 0.02,
  forwardAxis: "z",
  placementRole: "flat-land",
};

const placement = (overrides: Partial<WorldDesignPlacement> = {}): WorldDesignPlacement => ({
  id: "test-placement",
  assetId: "test-asset",
  position: [10, 20],
  yawDegrees: 0,
  anchor: "ground",
  ...overrides,
});

describe("world-design grounding", () => {
  it("provides a complete curated grounding contract for all 16 runtime assets", () => {
    expect(Object.keys(WORLD_DESIGN_GROUNDING)).toHaveLength(16);
    for (const metadata of Object.values(WORLD_DESIGN_GROUNDING)) {
      expect(metadata.baseAnchorXZ.every(Number.isFinite)).toBe(true);
      expect(metadata.footprintM.every((dimension) => dimension > 0)).toBe(true);
      expect(metadata.supportPoints.every((point) => point.length === 2 && point.every(Number.isFinite))).toBe(true);
      expect(metadata.groundClearanceM).toBeGreaterThanOrEqual(0);
    }
    expect(WORLD_DESIGN_GROUNDING.bv01_sunwake_ferry.waterlineM).toBeGreaterThan(0);
    expect(WORLD_DESIGN_GROUNDING.bv02_makers_workboat.waterlineM).toBeGreaterThan(0);
  });

  it("rotates every support point around the placement and always samples its centre", () => {
    const samples = worldDesignSupportSamples(10, 20, 90, grounding);
    expect(samples).toHaveLength(grounding.supportPoints.length + 1);
    expect(samples[0]).toEqual([10, 20]);
    expect(samples[1][0]).toBeCloseTo(10);
    expect(samples[1][1]).toBeCloseTo(19);
    expect(samples[3][0]).toBeCloseTo(12);
    expect(samples[3][1]).toBeCloseTo(20);
  });

  it("uses every support probe, the highest verified height, and curated clearance", () => {
    const sampleGround = vi.fn((x: number, z: number) => {
      if (x === 11 && z === 20) return 2.15;
      if (x === 9 && z === 20) return null;
      return 2.1;
    });
    expect(worldDesignPlacementY(placement({ surfaceY: 2.1 }), grounding, sampleGround)).toBeCloseTo(2.17);
    expect(sampleGround).toHaveBeenCalledTimes(grounding.supportPoints.length + 1);
  });

  it("uses authored surfaceY only as a verified fallback and rejects missing ground", () => {
    expect(worldDesignPlacementY(placement({ surfaceY: 3.2 }), grounding, () => null)).toBeCloseTo(3.22);
    expect(() => worldDesignPlacementY(placement(), grounding, () => null)).toThrow(/missing support probe/i);
    expect(() => worldDesignPlacementY(placement({ surfaceY: 4 }), grounding, () => 3)).toThrow(/disagrees/i);
    expect(() => worldDesignPlacementY(placement(), grounding, (x) => x === 11 ? 2.3 : 2)).toThrow(/terrain step/i);
  });

  it("uses the curated waterline instead of the legacy sink value", () => {
    const waterGrounding = WORLD_DESIGN_GROUNDING.bv01_sunwake_ferry;
    const ferry = placement({ anchor: "water", surfaceY: -0.18, sinkM: 99 });
    expect(worldDesignPlacementY(ferry, waterGrounding, () => 100)).toBeCloseTo(-1.08);
    expect(() => worldDesignPlacementY(placement({ anchor: "water" }), waterGrounding, () => 0)).toThrow(/surfaceY/i);
  });

  it("prefers nested manifest grounding while retaining curated fields not yet authored", () => {
    const asset: WorldDesignAsset = {
      id: "st01_sunrail_lamp",
      name: "Lamp",
      category: "street",
      file: "lamp.glb",
      fit: "height",
      targetM: 4.8,
      grounding: { baseAnchorXZ: [0.2, -0.1], groundClearanceM: 0.03 },
    };
    const resolved = worldDesignGrounding(asset);
    expect(resolved.baseAnchorXZ).toEqual([0.2, -0.1]);
    expect(resolved.groundClearanceM).toBe(0.03);
    expect(resolved.supportPoints).toEqual(WORLD_DESIGN_GROUNDING.st01_sunrail_lamp.supportPoints);
  });
});
