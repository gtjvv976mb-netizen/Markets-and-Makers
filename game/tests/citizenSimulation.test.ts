import { describe, expect, it } from "vitest";
import {
  chooseCitizenDestination, citizenPopulation, citizenPurposeAtHour, createCitizenProfile, customerAppeal,
  destinationWeight, navigationSurfaceCost, representedPartySize, type CitizenDestination,
} from "../src/citizenSimulation";

const destination = (overrides: Partial<CitizenDestination> = {}): CitizenDestination => ({
  id: "shop",
  island: "hearth",
  kind: "business",
  purpose: "essential",
  x: 8,
  z: 0,
  operational: true,
  appeal: 1,
  capacity: 4,
  priceIndex: 1,
  plotId: "garden-row",
  license: "shop",
  ...overrides,
});

describe("representative citizen simulation", () => {
  it("uses deterministic profiles, routines and destinations", () => {
    expect(createCitizenProfile(7)).toEqual(createCitizenProfile(7));
    expect(citizenPurposeAtHour(12, 7)).toBe(citizenPurposeAtHour(12, 7));
    const profile = createCitizenProfile(3);
    const options = [destination(), destination({ id: "far", x: 40, appeal: 1.4 })];
    expect(chooseCitizenDestination(options, "essential", profile, { x: 0, z: 0 }, 91)?.id)
      .toBe(chooseCitizenDestination(options, "essential", profile, { x: 0, z: 0 }, 91)?.id);
  });

  it("never sends customers to closed or full businesses", () => {
    const profile = createCitizenProfile(1);
    expect(destinationWeight(destination({ operational: false }), "essential", profile, 2)).toBe(0);
    expect(destinationWeight(destination({ capacity: 0 }), "essential", profile, 2)).toBe(0);
  });

  it("rewards appeal and distance while respecting price sensitivity", () => {
    const profile = createCitizenProfile(4);
    const baseline = destinationWeight(destination(), "essential", profile, 8);
    expect(destinationWeight(destination({ appeal: 2 }), "essential", profile, 8)).toBeGreaterThan(baseline);
    expect(destinationWeight(destination({ priceIndex: 1.3 }), "essential", profile, 8)).toBeLessThan(baseline);
    expect(destinationWeight(destination(), "essential", profile, 60)).toBeLessThan(baseline);
  });

  it("grows represented cohorts without changing actor count or size", () => {
    const small = Array.from({ length: 24 }, (_, index) => representedPartySize(120, 24, index));
    const large = Array.from({ length: 24 }, (_, index) => representedPartySize(257, 24, index));
    expect(small).toHaveLength(24);
    expect(large).toHaveLength(24);
    expect(small.reduce((sum, value) => sum + value, 0)).toBe(120);
    expect(large.reduce((sum, value) => sum + value, 0)).toBe(257);
  });

  it("uses one population and appeal model for visible choices and monetary demand", () => {
    expect(citizenPopulation(0, 0, 0)).toBe(citizenPopulation(1, 0, 0));
    expect(citizenPopulation(3, 16, 80)).toBeGreaterThan(citizenPopulation(1, 0, 0));
    const baseline = customerAppeal({
      staff: 1, appealLevel: 0, qualityLevel: 0, reputation: 0,
      specialization: null, sponsored: false,
    });
    expect(customerAppeal({
      staff: 3, appealLevel: 2, qualityLevel: 2, reputation: 20,
      specialization: "community", sponsored: true,
    })).toBeGreaterThan(baseline);
  });

  it("prefers paths, roads and bridges and blocks water", () => {
    expect(navigationSurfaceCost("road")).toBe(1);
    expect(navigationSurfaceCost("path")).toBe(1);
    expect(navigationSurfaceCost("bridge")).toBe(1);
    expect(navigationSurfaceCost("land_l0")).toBeGreaterThan(1);
    expect(navigationSurfaceCost("natural_water")).toBe(Number.POSITIVE_INFINITY);
    expect(navigationSurfaceCost("ocean")).toBe(Number.POSITIVE_INFINITY);
  });
});
