import { describe, expect, it } from "vitest";
import { clientMessageSchema, validateMove } from "../src/protocol.js";

describe("realtime protocol", () => {
  it("accepts a bounded movement message", () => {
    expect(clientMessageSchema.safeParse({ type: "move", sequence: 1, x: 2, z: 3, sentAt: 1000 }).success).toBe(true);
  });

  it("rejects invalid islands and unbounded coordinates", () => {
    expect(clientMessageSchema.safeParse({ type: "hello", playerId: crypto.randomUUID(), islandId: "moon" }).success).toBe(false);
    expect(clientMessageSchema.safeParse({ type: "move", sequence: 1, x: 9000, z: 3, sentAt: 1000 }).success).toBe(false);
  });

  it("rejects speed and replay violations", () => {
    const previous = { x: 0, z: 0, at: 1000, sequence: 8 };
    expect(validateMove(previous, { x: 4, z: 0, at: 2000, sequence: 9 })).toBe(true);
    expect(validateMove(previous, { x: 30, z: 0, at: 2000, sequence: 9 })).toBe(false);
    expect(validateMove(previous, { x: 1, z: 0, at: 2000, sequence: 8 })).toBe(false);
  });
});

describe("spawn handshake", () => {
  it("accepts a declared spawn position in hello", () => {
    const parsed = clientMessageSchema.safeParse({
      type: "hello",
      playerId: "11111111-1111-4111-8111-111111111111",
      islandId: "hearth",
      x: 0,
      z: 34
    });
    expect(parsed.success).toBe(true);
  });

  it("still accepts hello without a position", () => {
    const parsed = clientMessageSchema.safeParse({
      type: "hello",
      playerId: "11111111-1111-4111-8111-111111111111",
      islandId: "hearth"
    });
    expect(parsed.success).toBe(true);
  });

  it("pins a player forever when presence is seeded away from the real spawn", () => {
    // Regression: presence used to start at (0,0) while islands spawn at z=34, so the
    // first step read as a 34-unit teleport. A rejected move never advances the stored
    // position, so every later move was measured from (0,0) too and nobody could walk.
    const wrong = { x: 0, z: 0, at: 1_000, sequence: 0 };
    const step = { x: 0.6, z: 34, at: 1_100, sequence: 1 };
    expect(validateMove(wrong, step)).toBe(false);

    const seeded = { x: 0, z: 34, at: 1_000, sequence: 0 };
    expect(validateMove(seeded, step)).toBe(true);
  });

  it("accepts a walk at the client's actual movement speed", () => {
    let previous = { x: 0, z: 34, at: 1_000, sequence: 0 };
    for (let i = 1; i <= 12; i += 1) {
      const next = { x: i * 0.65, z: 34, at: 1_000 + i * 100, sequence: i };
      expect(validateMove(previous, next), `step ${i} rejected`).toBe(true);
      previous = next;
    }
  });
});
