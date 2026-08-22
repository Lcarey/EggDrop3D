import type { Vec3 } from "@eggdrop/shared";

/**
 * Filtered-noise wind model (a discrete Ornstein-Uhlenbeck process per
 * horizontal axis — the same shaping idea as the aerospace-standard Dryden
 * turbulence spectra). White noise pushed through a first-order low-pass
 * filter gives gusts that build and fade over seconds instead of the visibly
 * periodic fixed sinusoids this replaces. Runs are seeded, so a given drop
 * replays identically while different runs see different weather.
 */

/** Long-run standard deviation of each horizontal gust component, m/s. */
export const WIND_SIGMA_MPS = 0.35;
/** Gust correlation time: how long a gust "lasts", seconds. */
export const WIND_CORRELATION_SECONDS = 2.5;
/** Aerodynamic roughness length of the landing field, metres (short grass). */
export const WIND_ROUGHNESS_LENGTH_M = 0.03;
/** Height at which the model outputs its nominal intensity, metres. */
export const WIND_REFERENCE_HEIGHT_M = 3;

/** Deterministic 32-bit PRNG (mulberry32); good enough for gust noise. */
const createRandom = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

export type WindField = {
  /** Advance the gust state by one fixed physics step. */
  step(dtSeconds: number): void;
  /**
   * Wind velocity at a given height above the ground, m/s. Horizontal only,
   * so drop timing stays untouched. Follows the log-law boundary-layer
   * profile: zero at the surface (settled bodies feel still air and can
   * sleep — for the physical reason, not via a body-speed gate) and growing
   * with altitude.
   */
  velocityAt(heightM: number): Vec3;
};

export const createWindField = (seed: number): WindField => {
  const random = createRandom(seed);
  // Box-Muller for approximately Gaussian increments.
  const gaussian = () => {
    const a = Math.max(random(), 1e-12);
    const b = random();
    return Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * b);
  };
  let gustX = 0;
  let gustZ = 0;
  const referenceScale = Math.log(WIND_REFERENCE_HEIGHT_M / WIND_ROUGHNESS_LENGTH_M);
  return {
    step(dtSeconds: number) {
      // Exact discretization of the OU process: mean-reverting decay plus a
      // noise kick sized so the long-run standard deviation is WIND_SIGMA_MPS
      // for any step size.
      const decay = Math.exp(-dtSeconds / WIND_CORRELATION_SECONDS);
      const kick = WIND_SIGMA_MPS * Math.sqrt(1 - decay * decay);
      gustX = gustX * decay + kick * gaussian();
      gustZ = gustZ * decay + kick * gaussian();
    },
    velocityAt(heightM: number): Vec3 {
      if (!Number.isFinite(heightM) || heightM <= WIND_ROUGHNESS_LENGTH_M) return [0, 0, 0];
      const profile = Math.log(heightM / WIND_ROUGHNESS_LENGTH_M) / referenceScale;
      return [gustX * profile, 0, gustZ * profile];
    },
  };
};
