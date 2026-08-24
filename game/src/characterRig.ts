export type CharacterFrontAxis = "+X" | "+Z";

/**
 * Game actors steer their local +Z axis along travel. Imported characters are
 * authored facing either +X or +Z, so their visual child needs this fixed yaw.
 */
export function yawCorrectionFor(frontAxis: CharacterFrontAxis): number {
  return frontAxis === "+X" ? -Math.PI / 2 : 0;
}

export function headingYaw(deltaX: number, deltaZ: number): number {
  return Math.atan2(deltaX, deltaZ);
}

/** Smooth a heading without taking the long way around the -PI/PI seam. */
export function dampWrappedYaw(current: number, target: number, deltaSeconds: number, response = 14): number {
  const shortestDelta = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return current + shortestDelta * (1 - Math.exp(-response * deltaSeconds));
}

export function planarSpeed(deltaX: number, deltaZ: number, deltaSeconds: number): number {
  if (deltaSeconds <= 0) return 0;
  return Math.hypot(deltaX, deltaZ) / deltaSeconds;
}
