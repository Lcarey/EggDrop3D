import { feetToMeters, type Vec3 } from "@eggdrop/shared";

/**
 * Simulation health checks. Nothing used to monitor the solver, so a
 * constraint divergence simply played out — bodies at 5x10^12 m/s, the camera
 * chasing the egg into deep space, and petanewton "impacts" recorded as
 * results. These helpers classify each body every step so the scene can
 * clamp a first offence and end honestly-unstable runs early.
 */

export type BodyMotionHealth = "ok" | "runaway" | "invalid";

/** Bodies flung beyond this distance from the pad are unrecoverable. */
export const WATCHDOG_MAX_DISTANCE_M = 500;
/** Generous floor so slow drops with big pendulum swings never trip it. */
const MIN_PLAUSIBLE_SPEED_BOUND_MPS = 25;
/** Headroom over ideal vacuum free-fall for joint whip and bounces. */
const FREE_FALL_HEADROOM = 1.5;

/**
 * The fastest any body in a drop could plausibly move: vacuum free-fall from
 * the drop height with headroom. Anything beyond this is solver divergence,
 * not physics.
 */
export const maxPlausibleSpeedMps = (heightFt: number, gravityMps2: number): number => {
  const freeFall = Math.sqrt(2 * Math.max(0, gravityMps2) * feetToMeters(Math.max(0, heightFt)));
  return Math.max(MIN_PLAUSIBLE_SPEED_BOUND_MPS, FREE_FALL_HEADROOM * freeFall);
};

export const classifyBodyMotion = (
  position: Readonly<Vec3>,
  velocity: Readonly<Vec3>,
  maxSpeedMps: number,
): BodyMotionHealth => {
  for (let axis = 0; axis < 3; axis += 1) {
    if (!Number.isFinite(position[axis]!) || !Number.isFinite(velocity[axis]!)) return "invalid";
  }
  const speed = Math.hypot(velocity[0], velocity[1], velocity[2]);
  const distance = Math.hypot(position[0], position[1], position[2]);
  if (speed > maxSpeedMps || distance > WATCHDOG_MAX_DISTANCE_M) return "runaway";
  return "ok";
};
