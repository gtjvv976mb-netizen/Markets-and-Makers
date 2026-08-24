import { describe, expect, it } from "vitest";
import {
  characterHeightScale, dampWrappedYaw, headingYaw, planarSpeed, STANDARD_CHARACTER_HEIGHT_M,
  walkAnimationRate, yawCorrectionFor, type CharacterFrontAxis,
} from "../src/characterRig";

function correctedFacing(frontAxis: CharacterFrontAxis, deltaX: number, deltaZ: number): [number, number] {
  const yaw = headingYaw(deltaX, deltaZ) + yawCorrectionFor(frontAxis);
  if (frontAxis === "+X") return [Math.cos(yaw), -Math.sin(yaw)];
  return [Math.sin(yaw), Math.cos(yaw)];
}

describe("character rig orientation", () => {
  it.each([
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
  ])("aligns both supported source axes with travel (%s, %s)", (deltaX, deltaZ) => {
    const length = Math.hypot(deltaX, deltaZ);
    for (const axis of ["+X", "+Z"] as const) {
      const [facingX, facingZ] = correctedFacing(axis, deltaX, deltaZ);
      const alignment = facingX * (deltaX / length) + facingZ * (deltaZ / length);
      expect(alignment).toBeGreaterThan(0.999999);
    }
  });

  it("wraps smoothly across the PI seam", () => {
    const current = Math.PI - 0.03;
    const target = -Math.PI + 0.03;
    const next = dampWrappedYaw(current, target, 1 / 60);
    expect(next).toBeGreaterThan(current);
    expect(next - current).toBeLessThan(0.03);
  });

  it("derives animation speed from actual displacement", () => {
    expect(planarSpeed(0.3, 0.4, 0.1)).toBeCloseTo(5);
    expect(planarSpeed(1, 1, 0)).toBe(0);
  });

  it("normalizes every imported body to one physical height", () => {
    for (const sourceHeight of [.91, 1.82, 2.05, 3.64, 12]) {
      expect(sourceHeight * characterHeightScale(sourceHeight)).toBeCloseTo(STANDARD_CHARACTER_HEIGHT_M, 8);
    }
  });

  it("keeps walking cadence in a planted-foot range", () => {
    expect(walkAnimationRate(0)).toBe(0);
    expect(walkAnimationRate(.02)).toBe(0);
    expect(walkAnimationRate(1.35)).toBeCloseTo(1);
    expect(walkAnimationRate(.1)).toBe(.18);
    expect(walkAnimationRate(4)).toBe(1.45);
  });
});
