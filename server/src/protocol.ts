import { z } from "zod";

const helloSchema = z.object({
  type: z.literal("hello"),
  playerId: z.string().uuid(),
  islandId: z.enum(["hearth", "kite", "sun", "kiln", "copper", "tide", "lantern", "green", "pulse"])
});

const moveSchema = z.object({
  type: z.literal("move"),
  sequence: z.number().int().nonnegative(),
  x: z.number().finite().min(-500).max(500),
  z: z.number().finite().min(-500).max(500),
  sentAt: z.number().finite().nonnegative()
});

const pingSchema = z.object({ type: z.literal("ping"), sentAt: z.number().finite() });

export const clientMessageSchema = z.discriminatedUnion("type", [helloSchema, moveSchema, pingSchema]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;

export interface PositionSample {
  x: number;
  z: number;
  at: number;
  sequence: number;
}

export function validateMove(previous: PositionSample, next: PositionSample, maxSpeed = 8): boolean {
  if (next.sequence <= previous.sequence || next.at < previous.at) return false;
  const elapsed = Math.max(0.05, Math.min(1.5, (next.at - previous.at) / 1000));
  const distance = Math.hypot(next.x - previous.x, next.z - previous.z);
  return distance <= maxSpeed * elapsed + 0.75;
}
