import { describe, expect, it } from "vitest";
import { MATERIAL_BY_ID, calculatePartMassKg, type Vec3 } from "@eggdrop/shared";
import {
  CANOPY_BILLOW_REFERENCE_SPEED_MPS,
  calculateCanopyBillow,
  calculateCanopyBlockage,
  calculateCanopyBulgeM,
  calculatePlasticBagCanopyForce,
} from "./parachute";

const AIR_DENSITY = 1.225;
const BAG_DIMENSIONS: Vec3 = [0.4, 0.018, 0.4];
const BAG_DRAG = MATERIAL_BY_ID.plasticBag.physics.dragCoefficient;

const canopyForce = (
  velocityMps: Vec3,
  canopyNormal: Vec3 = [0, 1, 0],
  dimensions: Vec3 = BAG_DIMENSIONS,
) => calculatePlasticBagCanopyForce({
  velocityMps,
  canopyNormal,
  dimensions,
  dragCoefficient: BAG_DRAG,
  airDensityKgM3: AIR_DENSITY,
});

const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

describe("canopy billow", () => {
  it("stays limp at rest and while moving upward", () => {
    expect(calculateCanopyBillow(0)).toBe(0);
    expect(calculateCanopyBillow(-2)).toBe(0);
    expect(calculateCanopyBillow(Number.NaN)).toBe(0);
  });

  it("is half inflated at the reference descent speed and saturates below 1", () => {
    expect(calculateCanopyBillow(CANOPY_BILLOW_REFERENCE_SPEED_MPS)).toBeCloseTo(0.5, 12);
    expect(calculateCanopyBillow(1)).toBeLessThan(calculateCanopyBillow(3));
    expect(calculateCanopyBillow(3)).toBeLessThan(calculateCanopyBillow(10));
    expect(calculateCanopyBillow(1000)).toBeLessThan(1);
  });

  it("maps billow to a dome height scaled by the smaller canopy span", () => {
    expect(calculateCanopyBulgeM(0, BAG_DIMENSIONS)).toBe(0);
    expect(calculateCanopyBulgeM(1, BAG_DIMENSIONS)).toBeGreaterThan(0.1);
    expect(calculateCanopyBulgeM(0.5, [0.2, 0.018, 0.6])).toBeCloseTo(calculateCanopyBulgeM(0.5, [0.2, 0.018, 0.2]), 12);
    expect(calculateCanopyBulgeM(2, BAG_DIMENSIONS)).toBe(calculateCanopyBulgeM(1, BAG_DIMENSIONS));
  });
});

describe("plastic-bag canopy force", () => {
  it("is deterministic and zero at rest", () => {
    expect(canopyForce([0, 0, 0])).toEqual({ forceN: [0, 0, 0], applicationOffsetM: [0, 0, 0], billow: 0 });
    expect(canopyForce([1, -3, 0.5])).toEqual(canopyForce([1, -3, 0.5]));
  });

  it("always opposes the velocity", () => {
    const { forceN } = canopyForce([1.5, -4, -0.8]);
    expect(forceN[0]).toBeLessThan(0);
    expect(forceN[1]).toBeGreaterThan(0);
    expect(forceN[2]).toBeGreaterThan(0);
  });

  it("drags a descending bag far harder than the same bag moving upward", () => {
    // Edge-on to the flow in both cases, so the difference is pure billow.
    const sideways: Vec3 = [1, 0, 0];
    const descending = canopyForce([0, -4, 0], sideways);
    const rising = canopyForce([0, 4, 0], sideways);
    expect(rising.billow).toBe(0);
    expect(descending.billow).toBeGreaterThan(0.7);
    const descendingMagnitude = Math.hypot(...descending.forceN);
    const risingMagnitude = Math.hypot(...rising.forceN);
    expect(descendingMagnitude).toBeGreaterThan(risingMagnitude * 4);
  });

  it("settles an egg payload near 2 m/s, well below free-fall", () => {
    // Egg (57 g) under a default bag: drag beats total weight by 2.2 m/s (so
    // terminal velocity sits far below the ~13 m/s free-fall from 30 ft and
    // below the egg's crack-load landing speed) but not yet at 1.8 m/s (the
    // bag parachutes, it does not float).
    const payloadKg = 0.057 + calculatePartMassKg("plasticBag", BAG_DIMENSIONS);
    const weightN = payloadKg * 9.80665;
    expect(canopyForce([0, -2.2, 0]).forceN[1]).toBeGreaterThan(weightN);
    expect(canopyForce([0, -1.8, 0]).forceN[1]).toBeLessThan(weightN);
  });

  it("moves the centre of pressure above the sheet only while billowed", () => {
    const limp = canopyForce([2, 0, 0]);
    expect(limp.applicationOffsetM).toEqual([0, 0, 0]);
    const billowed = canopyForce([0, -4, 0]);
    expect(billowed.applicationOffsetM[1]).toBeGreaterThan(0.02);
    expect(billowed.applicationOffsetM[0]).toBe(0);
    expect(billowed.applicationOffsetM[2]).toBe(0);
  });

  it("stays unblocked for an absent or slung-below load", () => {
    expect(calculateCanopyBlockage(0)).toBe(0);
    expect(calculateCanopyBlockage(-0.3)).toBe(0);
    expect(calculateCanopyBlockage(Number.NaN)).toBe(0);
    const slungBelow = calculatePlasticBagCanopyForce({
      velocityMps: [0, -4, 0],
      canopyNormal: [0, 1, 0],
      dimensions: BAG_DIMENSIONS,
      dragCoefficient: BAG_DRAG,
      airDensityKgM3: AIR_DENSITY,
      supportedLoadHeightM: -0.3,
    });
    expect(slungBelow).toEqual(canopyForce([0, -4, 0]));
  });

  it("collapses billow, drag, and the righting offset when the load rides on top", () => {
    const open = canopyForce([0, -4, 0]);
    const blocked = calculatePlasticBagCanopyForce({
      velocityMps: [0, -4, 0],
      canopyNormal: [0, 1, 0],
      dimensions: BAG_DIMENSIONS,
      dragCoefficient: BAG_DRAG,
      airDensityKgM3: AIR_DENSITY,
      supportedLoadHeightM: 0.3,
    });
    expect(blocked.billow).toBeLessThan(open.billow * 0.2);
    expect(blocked.forceN[1]).toBeGreaterThan(0);
    expect(blocked.forceN[1]).toBeLessThan(open.forceN[1] * 0.5);
    expect(blocked.applicationOffsetM[1]).toBeLessThan(open.applicationOffsetM[1] * 0.2);
  });

  it("torques a tilted descending canopy back upright", () => {
    const tilt = Math.PI / 5;
    const tiltedNormal: Vec3 = [Math.sin(tilt), Math.cos(tilt), 0];
    const { forceN, applicationOffsetM } = canopyForce([0, -4, 0], tiltedNormal);
    const torque = cross(applicationOffsetM, forceN);
    // Positive torque about +z rotates the +x-leaning normal back toward +y.
    expect(torque[2]).toBeGreaterThan(0);
    const upright = canopyForce([0, -4, 0]);
    expect(Math.hypot(...cross(upright.applicationOffsetM, upright.forceN))).toBe(0);
  });
});
