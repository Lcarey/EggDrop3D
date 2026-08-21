import { describe, expect, it } from "vitest";

import {
  accumulateEggDamage,
  calculateBuoyantForce,
  calculateDragForce,
  calculateEggDamage,
  calculatePeakForceN,
  eggDamageState,
  feetToMeters,
  impactSpeedFromDropHeightMps,
  metersToFeet,
  snapRadians,
  snapScalar,
  snapVec3,
  STANDARD_GRAVITY_MPS2,
} from "../src/index.js";

describe("unit and snap helpers", () => {
  it("converts feet and meters without losing precision", () => {
    expect(feetToMeters(50)).toBeCloseTo(15.24, 12);
    expect(metersToFeet(15.24)).toBeCloseTo(50, 12);
  });

  it("snaps scalar, vector, and angle values", () => {
    expect(snapScalar(0.113, 0.025)).toBeCloseTo(0.125);
    expect(snapVec3([0.024, -0.039, 0.051], 0.025)).toEqual([0.025, -0.05, 0.05]);
    expect(snapRadians(0.51, 0.25)).toBe(0.5);
  });

  it("uses the agreed five-centimeter default position grid", () => {
    expect(snapVec3([0.024, 0.026, 0.074])).toEqual([0, 0.05, 0.05]);
  });

  it("rejects invalid snap increments", () => {
    expect(() => snapScalar(1, 0)).toThrow(RangeError);
    expect(() => snapScalar(Number.NaN, 1)).toThrow(RangeError);
  });
});

describe("aerodynamic helpers", () => {
  it("calculates drag opposite to velocity", () => {
    const force = calculateDragForce({
      velocityMps: [3, -4, 0],
      dragCoefficient: 1,
      crossSectionAreaM2: 0.5,
    });
    expect(force[0]).toBeLessThan(0);
    expect(force[1]).toBeGreaterThan(0);
    expect(force[2]).toBe(0);
    expect(Math.hypot(...force)).toBeCloseTo(0.5 * 1.225 * 0.5 * 25, 10);
  });

  it("returns zero drag at rest and upward buoyancy", () => {
    expect(
      calculateDragForce({
        velocityMps: [0, 0, 0],
        dragCoefficient: 2,
        crossSectionAreaM2: 1,
      }),
    ).toEqual([0, 0, 0]);
    const buoyancy = calculateBuoyantForce({ volumeM3: 1 });
    expect(buoyancy).toEqual([0, 1.225 * STANDARD_GRAVITY_MPS2, 0]);
  });
});

describe("impact and damage helpers", () => {
  it("calculates vacuum impact speed and peak force", () => {
    expect(impactSpeedFromDropHeightMps(50)).toBeCloseTo(
      Math.sqrt(2 * STANDARD_GRAVITY_MPS2 * 15.24),
      12,
    );
    expect(calculatePeakForceN(0.06, 80)).toBeCloseTo(
      0.06 * 80 * STANDARD_GRAVITY_MPS2,
      12,
    );
  });

  it("applies cushioning, accumulates damage, and classifies egg state", () => {
    expect(
      calculateEggDamage({ peakG: 80, referenceCrackG: 80, cushioning: 0.5 }),
    ).toBe(0.5);
    expect(accumulateEggDamage(0.7, 0.6)).toBe(1);
    expect(eggDamageState(0.2)).toBe("survived");
    expect(eggDamageState(0.99)).toBe("survived");
    expect(eggDamageState(1)).toBe("cracked");
  });
});
