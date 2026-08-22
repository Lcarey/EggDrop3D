import { describe, expect, it } from "vitest";
import type { Vec3 } from "@eggdrop/shared";
import { calculateImplicitSpinDragTorque, calculateProjectedDrag } from "./aero";

const IDENTITY = [0, 0, 0, 1] as const;
/** 90 degrees about Z: local +Y maps to world -X. */
const QUARTER_TURN_Z = [0, 0, Math.SQRT1_2, Math.SQRT1_2] as const;
const SHEET: Vec3 = [0.44, 0.015, 0.44];
const AIR = 1.225;

describe("projected flat-plate drag", () => {
  it("presents the full face area falling face-on and far less edge-on", () => {
    const faceOn = calculateProjectedDrag({
      velocityMps: [0, -5, 0],
      rotation: IDENTITY,
      dimensions: SHEET,
      dragCoefficient: 1.05,
      airDensityKgM3: AIR,
    });
    expect(faceOn.projectedAreaM2).toBeCloseTo(0.44 * 0.44, 12);
    const edgeOn = calculateProjectedDrag({
      velocityMps: [0, -5, 0],
      rotation: QUARTER_TURN_Z,
      dimensions: SHEET,
      dragCoefficient: 1.05,
      airDensityKgM3: AIR,
    });
    expect(edgeOn.projectedAreaM2).toBeCloseTo(0.015 * 0.44, 6);
    expect(Math.hypot(...faceOn.forceN)).toBeGreaterThan(Math.hypot(...edgeOn.forceN) * 20);
  });

  it("opposes the relative wind and puts the centre of pressure on the windward face", () => {
    const drag = calculateProjectedDrag({
      velocityMps: [0, -5, 0],
      rotation: IDENTITY,
      dimensions: SHEET,
      dragCoefficient: 1.05,
      airDensityKgM3: AIR,
    });
    expect(drag.forceN[1]).toBeGreaterThan(0);
    expect(drag.forceN[0]).toBe(0);
    // Falling downward, the windward face is the bottom one.
    expect(drag.applicationOffsetM[1]).toBeCloseTo(-0.015 / 2, 12);
  });

  it("shifts the centre of pressure laterally when tilted, creating a torque lever", () => {
    const tilt = Math.PI / 8;
    const rotation = [0, 0, Math.sin(tilt / 2), Math.cos(tilt / 2)] as const;
    const drag = calculateProjectedDrag({
      velocityMps: [0, -5, 0],
      rotation,
      dimensions: SHEET,
      dragCoefficient: 1.05,
      airDensityKgM3: AIR,
    });
    expect(Math.abs(drag.applicationOffsetM[0])).toBeGreaterThan(0.001);
  });

  it("is zero at rest and in vacuum", () => {
    expect(calculateProjectedDrag({
      velocityMps: [0, 0, 0],
      rotation: IDENTITY,
      dimensions: SHEET,
      dragCoefficient: 1.05,
      airDensityKgM3: AIR,
    }).forceN).toEqual([0, 0, 0]);
    expect(calculateProjectedDrag({
      velocityMps: [0, -5, 0],
      rotation: IDENTITY,
      dimensions: SHEET,
      dragCoefficient: 1.05,
      airDensityKgM3: 0,
    }).forceN).toEqual([0, 0, 0]);
  });
});

describe("implicit quadratic spin drag", () => {
  const input = {
    rotation: IDENTITY,
    dimensions: SHEET,
    massKg: 0.5,
    dragCoefficient: 1.05,
    airDensityKgM3: AIR,
    dtSeconds: 1 / 240,
  };

  it("opposes the spin and grows superlinearly with spin rate", () => {
    const slow = calculateImplicitSpinDragTorque({ ...input, angularVelocityRps: [0, 2, 0] });
    const fast = calculateImplicitSpinDragTorque({ ...input, angularVelocityRps: [0, 4, 0] });
    expect(slow[1]).toBeLessThan(0);
    expect(Math.abs(fast[1])).toBeGreaterThan(Math.abs(slow[1]) * 3);
  });

  it("can never reverse the spin in a single step, even at absurd rates", () => {
    const omega = 10_000;
    const torque = calculateImplicitSpinDragTorque({ ...input, angularVelocityRps: [omega, 0, 0] });
    const inertia = input.massKg * (SHEET[1] ** 2 + SHEET[2] ** 2) / 12;
    const deltaOmega = torque[0] * input.dtSeconds / inertia;
    expect(deltaOmega).toBeLessThan(0);
    expect(Math.abs(deltaOmega)).toBeLessThanOrEqual(omega);
  });

  it("vanishes in vacuum and at zero spin", () => {
    expect(calculateImplicitSpinDragTorque({ ...input, airDensityKgM3: 0, angularVelocityRps: [0, 5, 0] })).toEqual([0, 0, 0]);
    expect(calculateImplicitSpinDragTorque({ ...input, angularVelocityRps: [0, 0, 0] })).toEqual([0, 0, 0]);
  });
});
