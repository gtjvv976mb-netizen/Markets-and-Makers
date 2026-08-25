import { describe, expect, it } from "vitest";
import roadnet from "../public/world/roadnet.json";
import { GENERATED_PLOT_CELLS } from "../src/generatedPlots";

// The road network has broken quietly more than once: a prune that ignored connectivity
// split the city into five islands that each looked correct on their own, and a checker
// that misread the run encoding reported 86% dead ends on a network that had 10%. These
// assertions are the ruler both the builder and the reviewer use.
const net = roadnet as unknown as {
  tileSize: number;
  roadRuns: [number, number, number][];
  carriageways: [number, number, number, number][];
};

/** Runs are [y, xStart, xEnd] with an inclusive end. */
const cells = new Set<string>();
for (const [y, a, b] of net.roadRuns) for (let x = a; x <= b; x += 1) cells.add(`${x},${y}`);

describe("the road network", () => {
  it("draws asphalt as one connected surface", () => {
    const seed = cells.values().next().value as string;
    const seen = new Set([seed]);
    const stack = [seed];
    while (stack.length) {
      const [x, y] = stack.pop()!.split(",").map(Number);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const k = `${x + dx},${y + dy}`;
        if (cells.has(k) && !seen.has(k)) { seen.add(k); stack.push(k); }
      }
    }
    expect(seen.size).toBe(cells.size);
  });

  it("never lets a street stop in a field", () => {
    const dangling = net.carriageways.filter(([axis, centre, from, to]) => {
      const fixed = Math.floor(centre);
      return [[from, -1], [to, 1]].some(([end, step]) => {
        const beyond = end + step;
        const ahead = axis === 0
          ? [`${beyond},${fixed}`, `${beyond},${fixed + 1}`]
          : [`${fixed},${beyond}`, `${fixed + 1},${beyond}`];
        const across = axis === 0
          ? [`${end},${fixed - 1}`, `${end},${fixed + 2}`]
          : [`${fixed - 1},${end}`, `${fixed + 2},${end}`];
        return !ahead.some((c) => cells.has(c)) && !across.some((c) => cells.has(c));
      });
    });
    expect(dangling).toEqual([]);
  });

  it("does not run two streets side by side down the same frontage", () => {
    const pairs: string[] = [];
    net.carriageways.forEach((a, i) => {
      for (const b of net.carriageways.slice(i + 1)) {
        if (a[0] !== b[0]) continue;
        if (Math.abs(a[1] - b[1]) > 6) continue;
        if (Math.min(a[3], b[3]) - Math.max(a[2], b[2]) < 4) continue;
        pairs.push(`${a[1]} beside ${b[1]}`);
      }
    });
    expect(pairs).toEqual([]);
  });

  it("gives every generated plot a road to front onto", () => {
    const orphans = GENERATED_PLOT_CELLS.filter(([, , x0, z0, x1, z1]) => {
      for (let x = x0 - 2; x <= x1 + 2; x += 1) {
        for (let z = z0 - 2; z <= z1 + 2; z += 1) {
          if (x >= x0 && x <= x1 && z >= z0 && z <= z1) continue;
          if (cells.has(`${x},${z}`)) return false;
        }
      }
      return true;
    }).map(([id]) => id);
    expect(orphans).toEqual([]);
  });
});
