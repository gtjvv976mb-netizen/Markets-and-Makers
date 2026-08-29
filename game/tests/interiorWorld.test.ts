import { describe, expect, it } from "vitest";
import { BUSINESS, type LicenseKey, type UpgradeKey } from "../src/data";
import {
  dampInteriorAvatarYaw,
  INTERIOR_EQUIPMENT_CATALOG,
  INTERIOR_ROOMS,
  interiorAvatarYaw,
} from "../src/interiorWorld";

const upgradeKeys: UpgradeKey[] = ["yield", "capacity", "speed", "appeal"];

describe("business interior equipment catalog", () => {
  it("gives every business a complete four-machine equipment set", () => {
    const licenses = Object.keys(BUSINESS) as LicenseKey[];
    expect(licenses).toHaveLength(15);
    expect(Object.keys(INTERIOR_EQUIPMENT_CATALOG).sort()).toEqual([...licenses].sort());

    for (const license of licenses) {
      expect(Object.keys(INTERIOR_EQUIPMENT_CATALOG[license]).sort()).toEqual([...upgradeKeys].sort());
    }
  });

  it("uses distinct, business-specific models rather than recoloring one generic set", () => {
    const licenses = Object.keys(BUSINESS) as LicenseKey[];
    const designs = licenses.flatMap((license) => upgradeKeys.map((key) => ({
      license,
      key,
      design: INTERIOR_EQUIPMENT_CATALOG[license][key],
    })));

    expect(designs).toHaveLength(60);
    expect(new Set(designs.map(({ design }) => design.form)).size).toBe(60);
    expect(new Set(designs.map(({ design }) => design.name)).size).toBe(60);

    for (const { license, key, design } of designs) {
      expect(design.form).toContain(`${license}-${key}`);
      expect(design.name.length).toBeGreaterThan(3);
      const copy = design.description.toLowerCase();
      expect(
        copy.includes(BUSINESS[license].name.toLowerCase())
          || copy.includes(BUSINESS[license].sector.toLowerCase()),
      ).toBe(true);
      expect(design.primary).toMatch(/^#[0-9a-f]{6}$/i);
      expect(design.secondary).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

describe("business interior avatar heading", () => {
  it("turns the shared avatar's +Z actor front toward every cardinal movement", () => {
    const directions = [
      { x: 0, z: -1, yaw: Math.PI },
      { x: 1, z: 0, yaw: Math.PI / 2 },
      { x: 0, z: 1, yaw: 0 },
      { x: -1, z: 0, yaw: -Math.PI / 2 },
    ];

    for (const direction of directions) {
      const yaw = interiorAvatarYaw(direction.x, direction.z);
      expect(Math.cos(yaw - direction.yaw)).toBeCloseTo(1, 8);
    }
  });

  it("damps over the short arc at the PI seam", () => {
    const current = Math.PI - 0.05;
    const target = -Math.PI + 0.05;
    const next = dampInteriorAvatarYaw(current, target, 1 / 60);
    const travelled = Math.atan2(Math.sin(next - current), Math.cos(next - current));

    expect(travelled).toBeGreaterThan(0);
    expect(travelled).toBeLessThan(0.1);
  });
});

describe("business interiors", () => {
  const licenses = Object.keys(BUSINESS) as LicenseKey[];

  it("gives every business its own room", () => {
    expect(Object.keys(INTERIOR_ROOMS).sort()).toEqual([...licenses].sort());
  });

  it("makes no two trades share a palette", () => {
    // The whole point of the pass: a mine must not be the greenhouse in another
    // colour, and two businesses must not be the same room twice.
    const seen = new Map<string, LicenseKey>();
    for (const license of licenses) {
      const room = INTERIOR_ROOMS[license];
      const signature = [room.floor, room.wall, room.trim, room.glass, room.sky].join("/");
      const clash = seen.get(signature);
      expect(clash, `${license} has the same palette as ${clash}`).toBeUndefined();
      seen.set(signature, license);
    }
  });

  it("gives all 15 trades a distinct architecture and floor-production diagram", () => {
    const architectures = licenses.map((license) => INTERIOR_ROOMS[license].architecture);
    const floorPatterns = licenses.map((license) => INTERIOR_ROOMS[license].floorPattern);

    expect(new Set(architectures).size).toBe(licenses.length);
    expect(new Set(floorPatterns).size).toBe(licenses.length);
  });

  it("describes each room as a Mercedonian solarpunk production system", () => {
    for (const license of licenses) {
      const room = INTERIOR_ROOMS[license];
      expect(room.displayName.length, `${license} needs a room identity`).toBeGreaterThan(8);
      expect(room.description.length, `${license} needs a production story`).toBeGreaterThan(45);
      expect(room.regenerativeSystem.length, `${license} needs a regenerative system`).toBeGreaterThan(18);
      expect(room.accent).toBeGreaterThan(0);
    }

    expect(INTERIOR_EQUIPMENT_CATALOG.workshop.yield.name).toBe("MercSpec Calibrator");
  });




});
