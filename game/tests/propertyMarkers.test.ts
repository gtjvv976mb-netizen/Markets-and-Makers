import { describe, expect, it } from "vitest";
import { BUSINESS, CIVIC_BUILDINGS, ISLANDS, PLOTS, type LicenseKey } from "../src/data";
import { propertyMarkerModels } from "../src/propertyMarkers";
import { createFreshState, type BusinessRecord } from "../src/state";

function businessRecord(plotId: string, license: LicenseKey | null, buildingPlaced: boolean): BusinessRecord {
  return {
    plotId,
    license,
    buildingPlaced,
    job: null,
    upgrades: { yield: 0, capacity: 0, speed: 0, appeal: 0 },
    condition: 100,
    brokenDown: false,
    jobsCompleted: 0,
  };
}

describe("world property banners", () => {
  it("covers every civic building and property in its district exactly once", () => {
    for (const island of ISLANDS) {
      const state = createFreshState();
      state.island = island.id;
      const markers = propertyMarkerModels(state, () => 1, () => null);
      const expectedIds = [
        ...CIVIC_BUILDINGS.filter((building) => building.island === island.id).map((building) => `civic-${building.id}`),
        ...PLOTS.filter((plot) => plot.island === island.id).map((plot) => plot.id),
      ].sort();

      expect(markers.map((marker) => marker.id).sort()).toEqual(expectedIds);
      expect(new Set(markers.map((marker) => marker.id)).size).toBe(expectedIds.length);
      expect(markers.every((marker) => marker.title.trim().length > 0)).toBe(true);
      expect(markers.every((marker) => marker.icon?.trim().length)).toBeTruthy();
      expect(markers.every((marker) => marker.accent?.trim().length)).toBeTruthy();
      expect(markers.every((marker) => [marker.x, marker.y, marker.z].every(Number.isFinite))).toBe(true);
    }
  });

  it("places every civic nameplate above its authored roof", () => {
    // The smallest civic building is 5.30m high on a 1.035m ground plane.
    // Every authored clearance is larger than that roof elevation.
    expect(CIVIC_BUILDINGS).toHaveLength(9);
    expect(CIVIC_BUILDINGS.every((building) => building.bannerY > 6.34)).toBe(true);
    expect(new Set(CIVIC_BUILDINGS.map((building) => building.name)).size).toBe(CIVIC_BUILDINGS.length);
  });

  it("uses each business's name, emblem, color, and calculated roof anchor", () => {
    const plot = PLOTS.find((entry) => entry.island === "hearth")!;
    for (const [license, config] of Object.entries(BUSINESS) as Array<[LicenseKey, (typeof BUSINESS)[LicenseKey]]>) {
      const state = createFreshState();
      state.island = plot.island;
      state.portfolio[plot.id] = businessRecord(plot.id, license, true);
      const marker = propertyMarkerModels(state, () => 1, () => 9.75).find((entry) => entry.id === plot.id);

      expect(marker).toMatchObject({
        id: plot.id,
        kind: "owned",
        title: config.name,
        icon: config.icon,
        accent: config.color,
        y: 9.75,
        building: true,
      });
    }
  });

  it("keeps vacant and unbuilt properties visibly distinct from buildings", () => {
    const state = createFreshState();
    const plot = PLOTS.find((entry) => entry.island === state.island)!;
    const vacant = propertyMarkerModels(state, () => 1, () => null).find((entry) => entry.id === plot.id);
    expect(vacant).toMatchObject({ label: "For lease", title: plot.name.replace(/ Plot$/, ""), building: false });

    state.portfolio[plot.id] = businessRecord(plot.id, null, false);
    const leased = propertyMarkerModels(state, () => 1, () => null).find((entry) => entry.id === plot.id);
    expect(leased).toMatchObject({ label: "Yours", title: plot.name.replace(/ Plot$/, ""), building: false });
  });
});
