import { describe, expect, it } from "vitest";
import { CIVIC_BUILDINGS, ISLANDS, PLOTS } from "../src/data";
import { HIGHLANDS_WORLD_ENTRY, plotArrival, worldChunkAt } from "../src/highlandsWorld";

describe("Highlands & Rivers runtime contract", () => {
  it("publishes the versioned authored-material world", () => {
    expect(HIGHLANDS_WORLD_ENTRY).toBe("./assets/world/highlands-rivers-v1/world.gltf");
  });

  it("keeps nine economic districts in one connected world", () => {
    expect(ISLANDS).toHaveLength(9);
    expect(new Set(ISLANDS.map((district) => district.id)).size).toBe(9);
    expect(ISLANDS.every((district) => worldChunkAt(district.spawnX, district.spawnZ))).toBe(true);
    expect(ISLANDS.find((district) => district.id === "lantern")).toMatchObject({ spawnX: -74, spawnZ: -30 });
  });

  it("exposes all 42 empty player plots while retaining legacy holdings", () => {
    expect(PLOTS).toHaveLength(42);
    expect(new Set(PLOTS.map((plot) => plot.id)).size).toBe(42);
    for (const id of ["garden-row", "seabreeze", "north-canopy", "kitecrest-loft", "solar-terrace", "forge-lane"]) {
      expect(PLOTS.some((plot) => plot.id === id), id).toBe(true);
    }
    expect(PLOTS.every((plot) => plot.width % 2 === 0 && plot.depth % 2 === 0)).toBe(true);
    expect(PLOTS.every((plot) => {
      const arrival = plotArrival(plot);
      return arrival.x % 2 === 0 && arrival.z % 2 === 0 && worldChunkAt(arrival.x, arrival.z) !== null;
    })).toBe(true);
    expect(plotArrival(PLOTS.find((plot) => plot.id === "lantern-walk")!).x)
      .toBeGreaterThan(PLOTS.find((plot) => plot.id === "lantern-walk")!.x);
    expect(plotArrival(PLOTS.find((plot) => plot.id === "tidepool-works")!).x)
      .toBeLessThan(PLOTS.find((plot) => plot.id === "tidepool-works")!.x);
    expect(plotArrival(PLOTS.find((plot) => plot.id === "pulsegrove-court")!).z)
      .toBeLessThan(PLOTS.find((plot) => plot.id === "pulsegrove-court")!.z);
    expect(plotArrival(PLOTS.find((plot) => plot.id === "garden-row")!).z)
      .toBeGreaterThan(PLOTS.find((plot) => plot.id === "garden-row")!.z);
  });

  it("exposes all nine government-owned civic buildings", () => {
    expect(CIVIC_BUILDINGS).toHaveLength(9);
    expect(new Set(CIVIC_BUILDINGS.map((building) => building.id)).size).toBe(9);
    expect(CIVIC_BUILDINGS.every((building) => building.island === "hearth")).toBe(true);
  });

  it("maps continuous world metres to the exact 16 by 16 chunk grid", () => {
    expect(worldChunkAt(-256, 160)).toEqual([0, 0]);
    expect(worldChunkAt(0, 0)).toEqual([8, 5]);
    expect(worldChunkAt(254, -350)).toEqual([15, 15]);
    expect(worldChunkAt(-258, 0)).toBeNull();
    expect(worldChunkAt(0, -352)).toBeNull();
  });
});
