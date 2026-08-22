import { describe, expect, it } from "vitest";
import type { Vec3 } from "@eggdrop/shared";
import {
  planRopeChain,
  ROPE_SEGMENT_TARGET_LENGTH_M,
} from "./ropeChain";

const rotate = (v: Vec3, [qx, qy, qz, qw]: readonly [number, number, number, number]): Vec3 => {
  const cx = qy * v[2] - qz * v[1] + qw * v[0];
  const cy = qz * v[0] - qx * v[2] + qw * v[1];
  const cz = qx * v[1] - qy * v[0] + qw * v[2];
  return [
    v[0] + 2 * (qy * cz - qz * cy),
    v[1] + 2 * (qz * cx - qx * cz),
    v[2] + 2 * (qx * cy - qy * cx),
  ];
};

describe("rope chain planning", () => {
  it("splits the rope into segments near the target length spanning the gap", () => {
    const segments = planRopeChain([0, 3, 0], [0, 0.3, 0], 2.7);
    expect(segments.length).toBe(Math.ceil(2.7 / ROPE_SEGMENT_TARGET_LENGTH_M));
    const total = segments.reduce((sum, segment) => sum + segment.lengthM, 0);
    expect(total).toBeCloseTo(2.7, 9);
    expect(segments[0]!.position[1]).toBeLessThan(3);
    expect(segments.at(-1)!.position[1]).toBeGreaterThan(0.3);
  });

  it("aligns every segment's local +Y with the chain direction", () => {
    const segments = planRopeChain([0, 2, 0], [1, 0, 1], 2.5);
    const gapDirection = [1 / Math.sqrt(6), -2 / Math.sqrt(6), 1 / Math.sqrt(6)] as Vec3;
    for (const segment of segments) {
      const axis = rotate([0, 1, 0], segment.rotation);
      expect(axis[0]).toBeCloseTo(gapDirection[0], 6);
      expect(axis[1]).toBeCloseTo(gapDirection[1], 6);
      expect(axis[2]).toBeCloseTo(gapDirection[2], 6);
    }
  });

  it("lays slack rope along the line and handles straight-down chains", () => {
    const slack = planRopeChain([0, 1, 0], [0, 0.5, 0], 1.5);
    expect(slack.reduce((sum, segment) => sum + segment.lengthM, 0)).toBeCloseTo(1.5, 9);
    const down = rotate([0, 1, 0], slack[0]!.rotation);
    expect(down[1]).toBeCloseTo(-1, 9);
  });
});
