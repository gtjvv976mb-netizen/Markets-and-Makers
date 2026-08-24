export type CharacterFrontAxis = "+X" | "+Z";

/** One authored metre scale for the player, citizens and remote players. */
export const STANDARD_CHARACTER_HEIGHT_M = 1.82;

/**
 * Imported characters arrive with very different object transforms and source
 * units. Always fit their measured, posed height to the same physical height.
 */
export function characterHeightScale(
  measuredHeight: number,
  targetHeight = STANDARD_CHARACTER_HEIGHT_M,
): number {
  if (!Number.isFinite(measuredHeight) || measuredHeight <= 0) return 1;
  return targetHeight / measuredHeight;
}

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

/** Keep planted feet believable when a character's travel speed changes. */
export function walkAnimationRate(speedMps: number, referenceSpeedMps = 1.35): number {
  if (!Number.isFinite(speedMps) || speedMps <= 0.03) return 0;
  return Math.min(1.45, Math.max(0.18, speedMps / referenceSpeedMps));
}
