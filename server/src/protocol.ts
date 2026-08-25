import { z } from "zod";

const helloSchema = z.object({
  type: z.literal("hello"),
  playerId: z.string().uuid(),
  islandId: z.enum(["hearth", "kite", "sun", "kiln", "copper", "tide", "lantern", "green", "pulse"]),
  // Islands spawn away from the origin. Without a declared spawn the first move reads as a
  // teleport, is rejected, and — because a rejected move never advances the stored position —
  // every later move is measured from (0,0) too, pinning the player permanently.
  x: z.number().finite().min(-500).max(500).optional(),
  z: z.number().finite().min(-500).max(500).optional()
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

/**
 * The ceiling must sit above the client's own walk speed or every honest move is read
 * as a teleport — and because a rejected move never advances the stored position, the
 * player is then pinned for the rest of the session, measured forever from where they
 * last succeeded. PLAYER_WALK_SPEED_MPS in game/src/world.ts is 10; 15 leaves half
 * again for latency bursts and for the 0.05s floor on `elapsed` below, while still
 * refusing anything that looks like a jump across the district.
 */
export function validateMove(previous: PositionSample, next: PositionSample, maxSpeed = 15): boolean {
  if (next.sequence <= previous.sequence || next.at < previous.at) return false;
  const elapsed = Math.max(0.05, Math.min(1.5, (next.at - previous.at) / 1000));
  const distance = Math.hypot(next.x - previous.x, next.z - previous.z);
  return distance <= maxSpeed * elapsed + 0.75;
}
