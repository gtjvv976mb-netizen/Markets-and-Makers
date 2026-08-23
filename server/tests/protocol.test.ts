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
