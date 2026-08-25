import { describe, expect, it } from "vitest";
import roadnet from "../public/world/roadnet.json";

// The furniture is laid out from the middle of each street outwards, so slot k and slot
// -k hold the same piece and both kerbs hold the same run. Lamps used to alternate sides
// every 18 m, which meant no two stretches of road matched and nothing lined up across
// the carriageway. This checks the arithmetic that replaced it.
const net = roadnet as unknown as { tileSize: number; carriageways: [number, number, number, number][] };
const PITCH = 7;
const PATTERN = ["lamp", "shrub", "bench", "shrub"] as const;

/** The same walk buildStreets makes, without needing a WebGL context. */
const slotsFor = (band: [number, number, number, number]) => {
  const [, , from, to] = band;
  const startM = from * net.tileSize;
  const endM = to * net.tileSize;
  const middle = (startM + endM) / 2;
  const steps = Math.floor((endM - startM) / 2 / PITCH);
  const out: Array<{ at: number; kind: string }> = [];
  for (let k = -steps; k <= steps; k += 1) {
    const at = middle + k * PITCH;
    if (at < startM + 3 || at > endM - 3) continue;
    out.push({ at, kind: PATTERN[Math.abs(k) % PATTERN.length]! });
  }
  return out;
};

describe("street furniture", () => {
  it("reads the same from either end of a street", () => {
    for (const band of net.carriageways) {
      const slots = slotsFor(band);
      const middle = ((band[2] + band[3]) * net.tileSize) / 2;
      const kinds = slots.map((s) => s.kind);
      expect(kinds).toEqual([...kinds].reverse());
      // and the positions mirror about the centre of the street
      // + 0 because negating zero gives -0, which toEqual treats as a different number.
      const offsets = slots.map((s) => s.at - middle + 0);
      expect(offsets.map((o) => -o + 0).reverse()).toEqual(offsets);
    }
  });

  it("puts a lamp in the middle of every street it furnishes", () => {
    const furnished = net.carriageways.filter((b) => slotsFor(b).length > 0);
    expect(furnished.length).toBeGreaterThan(0);
    for (const band of furnished) {
      const slots = slotsFor(band);
      const middle = ((band[2] + band[3]) * net.tileSize) / 2;
      const centre = slots.find((s) => Math.abs(s.at - middle) < 0.001);
      if (centre) expect(centre.kind).toBe("lamp");
    }
  });

  it("repeats lamp, shrub, bench, shrub outwards from the centre", () => {
    // The run is anchored at the middle of the street, not at either end, so the cycle
    // is read from the centre outwards. Reading it from one end starts wherever the
    // street happens to finish.
    const long = net.carriageways.map(slotsFor).find((s) => s.length >= 9)!;
    const middle = long[Math.floor(long.length / 2)]!.at;
    const bySteps = [0, 1, 2, 3, 4].map(
      (k) => long.find((s) => Math.abs(Math.abs(s.at - middle) - k * PITCH) < 0.001)!.kind,
    );
    expect(bySteps).toEqual(["lamp", "shrub", "bench", "shrub", "lamp"]);
  });
});
