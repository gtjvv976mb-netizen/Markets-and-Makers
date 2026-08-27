import { describe, expect, it } from "vitest";
import { BUSINESS, type LicenseKey, type UpgradeKey } from "../src/data";
import {
  dampInteriorAvatarYaw,
  INTERIOR_EQUIPMENT_CATALOG,
  INTERIOR_ROOMS,
  interiorAvatarYaw,
  PROP_SLOTS,
  ROOM_HALF_DEPTH,
  ROOM_HALF_WIDTH,
  STATIONS,
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

  it("gives every trade a distinct floor kit", () => {
    const seen = new Map<string, LicenseKey>();
    for (const license of licenses) {
      const kit = INTERIOR_ROOMS[license].props;
      expect(kit.length, `${license} has no floor kit`).toBeGreaterThan(0);
      expect(kit.length).toBeLessThanOrEqual(PROP_SLOTS.length);
      const clash = seen.get(kit.join(","));
      expect(clash, `${license} has the same kit as ${clash}`).toBeUndefined();
      seen.set(kit.join(","), license);
    }
  });

  it("leads each trade's kit with the piece that names it", () => {
    // The two slots flanking the door are the first thing seen on entering, so they
    // carry the signature piece rather than the shared crates every trade owns.
    const signature: Record<LicenseKey, string> = {
      aquaworks: "tanks", sungrid: "solar", greenhouse: "beds", mine: "orecart",
      timberworks: "logs", cratemill: "crates", workshop: "toolwall", factory: "conveyor",
      construction: "scaffold", freight: "pallets", shop: "shelves", restaurant: "diner",
      gym: "weights", cinema: "seats", recycler: "bins",
    };
    for (const license of licenses) {
      expect(INTERIOR_ROOMS[license].props[0], `${license} does not lead with its own kit`)
        .toBe(signature[license]);
    }
  });

  it("never stands kit on a station, the door or the walkway", () => {
    const DOOR = { x: 0, z: -5.73, clear: 1.6 };
    const KIT_REACH = 1.2;      // the largest radius any piece reports
    const STATION_REACH = 1.5;  // base plus its halo

    for (const [x, z] of PROP_SLOTS) {
      expect(Math.abs(x) + KIT_REACH, `kit at ${x},${z} reaches through the side wall`)
        .toBeLessThanOrEqual(ROOM_HALF_WIDTH);
      expect(Math.abs(z) + KIT_REACH / 2, `kit at ${x},${z} reaches through the end wall`)
        .toBeLessThanOrEqual(ROOM_HALF_DEPTH);

      for (const station of STATIONS) {
        const [sx, sz] = station.position;
        expect(
          Math.hypot(x - sx, z - sz),
          `kit at ${x},${z} fouls the ${station.key} station`,
        ).toBeGreaterThan(KIT_REACH + STATION_REACH);
      }

      expect(Math.hypot(x - DOOR.x, z - DOOR.z), `kit at ${x},${z} blocks the door`)
        .toBeGreaterThan(KIT_REACH + DOOR.clear);

      // The walkway runs up the middle of the room, 2.35 wide.
      const blocksWalkway = Math.abs(x) < 1.18 + KIT_REACH;
      expect(blocksWalkway, `kit at ${x},${z} stands in the walkway`).toBe(false);
    }
  });

  it("stands no two pieces of kit inside each other", () => {
    for (let i = 0; i < PROP_SLOTS.length; i += 1) {
      for (let j = i + 1; j < PROP_SLOTS.length; j += 1) {
        const [ax, az] = PROP_SLOTS[i]!;
        const [bx, bz] = PROP_SLOTS[j]!;
        expect(Math.hypot(ax - bx, az - bz)).toBeGreaterThan(2.4);
      }
    }
  });
});
