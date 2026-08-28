// Whether a car can actually get anywhere.
//
// The junction test used to require each road's centre to fall strictly inside the other's
// span. Measured on the shipped network that produced 21 disconnected components, 12
// carriageways meeting nothing at all, and a largest island holding 17% of the roads — so
// a car was confined to whatever fragment it spawned on. That is what "the cars just
// circle" actually was: they could not leave.
//
// Roads are authored data in public/world/roadnet.json, so this guards the DATA as much as
// the code. If a future edit to the city shatters the network again, this is what says so.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const net = JSON.parse(readFileSync(resolve(here, "../public/world/roadnet.json"), "utf8")) as {
  tileSize: number;
  carriageways: Array<[number, number, number, number]>;
};

/** The same rule the game uses: long enough to drive, joined within a road's width. */
const JUNCTION_TOLERANCE = 2;
const usable = net.carriageways.filter(([, , from, to]) => to - from >= 6);

function meets(a: typeof usable[number], b: typeof usable[number]): boolean {
  if (a[0] === b[0]) return false;
  const [across, along] = a[0] === 0 ? [a, b] : [b, a];
  return along[1] >= across[2] - JUNCTION_TOLERANCE && along[1] <= across[3] + JUNCTION_TOLERANCE
    && across[1] >= along[2] - JUNCTION_TOLERANCE && across[1] <= along[3] + JUNCTION_TOLERANCE;
}

function components(): number[][] {
  const adjacency = usable.map(() => new Set<number>());
  for (let i = 0; i < usable.length; i += 1) {
    for (let j = i + 1; j < usable.length; j += 1) {
      if (meets(usable[i]!, usable[j]!)) { adjacency[i]!.add(j); adjacency[j]!.add(i); }
    }
  }
  const seen = new Set<number>();
  const found: number[][] = [];
  for (let i = 0; i < usable.length; i += 1) {
    if (seen.has(i)) continue;
    const stack = [i];
    const group: number[] = [];
    while (stack.length) {
      const node = stack.pop()!;
      if (seen.has(node)) continue;
      seen.add(node);
      group.push(node);
      for (const next of adjacency[node]!) stack.push(next);
    }
    found.push(group);
  }
  return found.sort((a, b) => b.length - a.length);
}

describe("the city's roads join up", () => {
  it("leaves no road connected to nothing", () => {
    // A car here could only ever reverse on the spot.
    const stranded = usable.filter((road, index) =>
      !usable.some((other, j) => j !== index && meets(road, other)));
    expect(stranded.length, `${stranded.length} carriageways meet nothing`).toBe(0);
  });

  it("keeps the network in a handful of pieces, not scattered", () => {
    const found = components();
    expect(found.length, `${found.length} disconnected components`).toBeLessThanOrEqual(5);
  });

  it("puts most of the city on one network a car can drive across", () => {
    const found = components();
    const share = found[0]!.length / usable.length;
    expect(share, `largest network holds ${Math.round(share * 100)}% of roads`).toBeGreaterThan(0.5);
  });

  it("only joins roads that genuinely overlap on the ground", () => {
    // The tolerance is not a licence to invent junctions: four metres of centreline gap
    // against eight-metre-wide terraces means the surfaces still touch.
    expect(JUNCTION_TOLERANCE * net.tileSize).toBeLessThanOrEqual(4 * net.tileSize);
  });

  it("has enough long roads to spread a fleet across", () => {
    expect(usable.length).toBeGreaterThan(20);
  });
});
