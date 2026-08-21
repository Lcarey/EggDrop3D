import { Quaternion, Vector3 } from "three";

/**
 * A render pose is deliberately separate from Rapier's authoritative body
 * transform. Slow-motion playback still advances Rapier in fixed 1/60-second
 * ticks, while this pose can be sampled on every display frame.
 */
export type DropRenderPose = {
  position: Vector3;
  rotation: Quaternion;
};

export const createDropRenderPose = (
  position: readonly [number, number, number],
  rotation: readonly [number, number, number, number],
): DropRenderPose => ({
  position: new Vector3(...position),
  rotation: new Quaternion(...rotation).normalize(),
});

export const copyDropRenderPose = (target: DropRenderPose, source: DropRenderPose) => {
  target.position.copy(source.position);
  target.rotation.copy(source.rotation);
  return target;
};

export const calculateDropInterpolationAlpha = (accumulatorSeconds: number, fixedStepSeconds: number) => {
  if (!Number.isFinite(accumulatorSeconds) || !Number.isFinite(fixedStepSeconds) || fixedStepSeconds <= 0) return 0;
  return Math.min(1, Math.max(0, accumulatorSeconds / fixedStepSeconds));
};

/**
 * Samples between the last two completed physics states without allocating.
 * Quaternion.slerp also follows the shortest rotational path, avoiding a
 * visible spin when a component crosses the quaternion sign boundary.
 */
export const interpolateDropRenderPose = (
  target: DropRenderPose,
  previous: DropRenderPose,
  current: DropRenderPose,
  alpha: number,
) => {
  const safeAlpha = Number.isFinite(alpha) ? Math.min(1, Math.max(0, alpha)) : 0;
  target.position.lerpVectors(previous.position, current.position, safeAlpha);
  target.rotation.copy(previous.rotation).slerp(current.rotation, safeAlpha).normalize();
  return target;
};
