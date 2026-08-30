import { describe, expect, it } from "vitest";
import { BUSINESS, type LicenseKey, type UpgradeKey } from "../src/data";
const FORMS = ["tank", "press", "rack", "hearth", "loom", "array", "conveyor", "counter", "cradle", "column"];

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
    // Sixty distinct machines, built from ten silhouette families.
    //
    // This used to demand sixty distinct FORM STRINGS, which only made sense while every
    // machine was a hand-authored mesh — five thousand lines that could not be reasoned
    // about and drifted in quality between trades. A machine is a recipe now, so the
    // guarantee that matters is that no two machines are the same machine: unique names,
    // unique colours, and no single silhouette carrying more than a third of the roster.
    expect(new Set(designs.map(({ design }) => design.name)).size).toBe(60);
    expect(new Set(designs.map(({ design }) => design.secondary)).size).toBe(60);
    const byForm = new Map<string, number>();
    for (const { design } of designs) byForm.set(design.form, (byForm.get(design.form) ?? 0) + 1);
    expect(byForm.size, "the roster must use many silhouettes, not one").toBeGreaterThanOrEqual(8);
    expect(Math.max(...byForm.values()), "no silhouette may dominate the roster").toBeLessThan(designs.length / 3);
    // And within any one trade, its four machines must not be four of the same shape.
    for (const license of licenses) {
      const forms = upgradeKeys.map((key) => INTERIOR_EQUIPMENT_CATALOG[license][key].form);
      expect(new Set(forms).size, `${license} reuses a silhouette across its own machines`).toBeGreaterThanOrEqual(3);
    }

    for (const { license, key, design } of designs) {
      // A machine is a RECIPE now — a silhouette family, a colour, and modules that appear
      // as it is upgraded — not a hand-authored mesh per trade per level. The contract is
      // that every trade still reads as its own: a real form, a real name, its own colour,
      // and one module per upgrade level so buying always changes the silhouette.
      expect(FORMS, `${license}.${key} form`).toContain(design.form);
      expect(design.name.length).toBeGreaterThan(3);
      expect(design.description.length).toBeGreaterThan(12);
      expect(typeof design.secondary, `${license}.${key} colour`).toBe("number");
      expect(design.modules.map((module) => module.at))
        .toEqual([1, 2, 3, 4]);
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

  it("gives all 15 trades a distinct architecture and wall motif", () => {
    const architectures = licenses.map((license) => INTERIOR_ROOMS[license].architecture);
    // The floor carries no per-trade diagram any more — the owner's rule is that nothing is
    // painted on it. Identity moved to the walls, so THAT is what must stay distinct.
    const motifs = licenses.map((license) => INTERIOR_ROOMS[license].motif);

    expect(new Set(architectures).size).toBe(licenses.length);
    expect(new Set(motifs).size).toBe(licenses.length);
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
