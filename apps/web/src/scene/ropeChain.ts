import type { Vec3 } from "@eggdrop/shared";

/**
 * Segmented-rope layout. A string (or a long tape tether) used to be one
 * rapier joint spanning its whole length — a massless, dragless constraint
 * that cannot sag or swing and, when metres long between very light bodies,
 * is exactly the ill-conditioned configuration that diverges. Instead we
 * build a chain of short capsule links joined by spherical joints: many
 * short, well-conditioned constraints with real mass and per-segment drag.
 */

export const ROPE_SEGMENT_TARGET_LENGTH_M = 0.07;
export const ROPE_SEGMENT_RADIUS_M = 0.004;
/** Connectors shorter than this stay a single plain joint. */
export const MIN_SEGMENTED_ROPE_LENGTH_M = 0.15;

export type RopeSegmentLayout = {
  /** World position of the segment centre. */
  position: Vec3;
  /** World rotation aligning the capsule's local +Y with the chain, [x,y,z,w]. */
  rotation: [number, number, number, number];
  /** Full length of this segment, metres. */
  lengthM: number;
};

const quaternionFromYAxisTo = (direction: Vec3): [number, number, number, number] => {
  // Rotates local +Y onto `direction` (unit). Shortest arc.
  const dot = direction[1];
  if (dot > 1 - 1e-9) return [0, 0, 0, 1];
  if (dot < -1 + 1e-9) return [1, 0, 0, 0];
  const axis: Vec3 = [direction[2], 0, -direction[0]];
  const axisLength = Math.hypot(axis[0], axis[1], axis[2]);
  const halfCos = Math.sqrt((1 + dot) / 2);
  const halfSin = Math.sqrt((1 - dot) / 2);
  return [
    (axis[0] / axisLength) * halfSin,
    (axis[1] / axisLength) * halfSin,
    (axis[2] / axisLength) * halfSin,
    halfCos,
  ];
};

/**
 * Lays the chain in a straight line between the two world anchors. If the
 * rope is longer than the gap, segments are placed at even spacing along the
 * line and the surplus length relaxes into sag over the first physics steps
 * (the spherical joints pull the chain together).
 */
export const planRopeChain = (
  startWorld: Vec3,
  endWorld: Vec3,
  ropeLengthM: number,
): RopeSegmentLayout[] => {
  const gap: Vec3 = [
    endWorld[0] - startWorld[0],
    endWorld[1] - startWorld[1],
    endWorld[2] - startWorld[2],
  ];
  const distance = Math.hypot(gap[0], gap[1], gap[2]);
  const length = Math.max(ropeLengthM, 1e-3);
  const count = Math.max(2, Math.ceil(length / ROPE_SEGMENT_TARGET_LENGTH_M));
  const segmentLength = length / count;
  const direction: Vec3 = distance > 1e-9
    ? [gap[0] / distance, gap[1] / distance, gap[2] / distance]
    : [0, -1, 0];
  const rotation = quaternionFromYAxisTo(direction);
  const spacing = distance > 1e-9 ? distance / count : segmentLength;
  return Array.from({ length: count }, (_, index) => {
    const along = spacing * (index + 0.5);
    return {
      position: [
        startWorld[0] + direction[0] * along,
        startWorld[1] + direction[1] * along,
        startWorld[2] + direction[2] * along,
      ] as Vec3,
      rotation,
      lengthM: segmentLength,
    };
  });
};
