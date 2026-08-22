/**
 * Pneumatic compliant-contact law for the squishy outer shell of a balloon.
 * Replaces the hand-tuned one-way springs, force caps, and grounded/airborne
 * mode switch of the old suspension: the force is what a gas-filled membrane
 * actually exerts — internal gauge pressure times the growing sphere-plane
 * contact patch, stiffening as the shell stroke is used up — and the step is
 * solved implicitly (one-dimensional backward Euler on the contact DOF), so
 * it is unconditionally stable at 240 Hz with no caps, conserves momentum
 * when applied equal-and-opposite, and can never trampoline (the damper
 * removes energy; the implicit solve cannot overshoot equilibrium).
 */

/** Party-balloon internal gauge pressure, pascals (soft, a few hundred Pa). */
export const BALLOON_GAUGE_PRESSURE_PA = 800;
/** Fraction of critical damping: latex hysteresis and air squeezed aside. */
export const BALLOON_CONTACT_DAMPING_RATIO = 0.5;
/**
 * Cap on the acceleration a contact reaction may give the balloon, m/s^2.
 * A rigid body is the wrong model for the reaction side: pressing on a real
 * balloon first deflects the membrane locally while the far side lags, so the
 * balloon as a whole is accelerated far more gently than F/m of its few grams
 * suggests. Without this cap a payload resting on a balloon in flight bats it
 * away at hundreds of m/s^2 in a single step and the cushion disintegrates.
 * The value is sized so a balloon can still match a payload closing at a few
 * m/s within its shell stroke (v^2 / (2 * stroke) ~ 60 m/s^2).
 */
export const BALLOON_MAX_REACTION_MPS2 = 100;

export type PneumaticContactInput = {
  /** How deep the other body intrudes into the shell, metres (>= 0). */
  penetrationM: number;
  /** Usable squish depth before the rigid core takes over, metres. */
  shellDepthM: number;
  /** Balloon radius, for the sphere-plane contact patch, metres. */
  balloonRadiusM: number;
  /** Closing speed along the contact normal, m/s (positive = approaching). */
  approachSpeedMps: number;
  /** Reduced mass of the pair, m1*m2/(m1+m2), kg. */
  reducedMassKg: number;
  dtSeconds: number;
};

/** Quasi-static shell force at a given penetration: pressure x patch area. */
export const pneumaticShellForceN = (
  penetrationM: number,
  shellDepthM: number,
  balloonRadiusM: number,
): number => {
  const depth = Math.min(Math.max(0, penetrationM), shellDepthM);
  if (depth <= 0) return 0;
  const patchAreaM2 = Math.PI * Math.max(0, 2 * balloonRadiusM * depth - depth * depth);
  // Isothermal stiffening as the available shell stroke is consumed: the gas
  // has nowhere to go, so pressure rises toward the end of travel.
  const stiffening = shellDepthM / Math.max(shellDepthM - depth * 0.8, shellDepthM * 0.2);
  return BALLOON_GAUGE_PRESSURE_PA * patchAreaM2 * stiffening;
};

/**
 * Contact force for this step, newtons, >= 0 along the normal (gas can only
 * push). Apply to the intruding body away from the balloon centre and
 * equal-and-opposite to the balloon.
 */
export const calculatePneumaticContactForceN = ({
  penetrationM,
  shellDepthM,
  balloonRadiusM,
  approachSpeedMps,
  reducedMassKg,
  dtSeconds,
}: PneumaticContactInput): number => {
  if (penetrationM <= 0 || shellDepthM <= 0 || reducedMassKg <= 0 || dtSeconds <= 0) return 0;
  const force = pneumaticShellForceN(penetrationM, shellDepthM, balloonRadiusM);
  // Local stiffness for the implicit solve. Probe backward at the end of the
  // stroke: the shell force is clamped there, and a zero forward derivative
  // would degenerate the implicit solve into an explicit (unstable) kick.
  const probe = Math.max(1e-5, shellDepthM * 1e-3);
  const backward = penetrationM + probe > shellDepthM;
  const probed = pneumaticShellForceN(
    backward ? penetrationM - probe : penetrationM + probe,
    shellDepthM,
    balloonRadiusM,
  );
  const stiffness = Math.max(0, (backward ? force - probed : probed - force) / probe);
  const damping = BALLOON_CONTACT_DAMPING_RATIO * 2 * Math.sqrt(stiffness * reducedMassKg);
  // Backward-Euler solve of the 1-D contact DOF: m dv = -(F + k v' dt + c v') dt.
  const nextApproach = (reducedMassKg * approachSpeedMps - force * dtSeconds)
    / (reducedMassKg + dtSeconds * dtSeconds * stiffness + dtSeconds * damping);
  return Math.max(0, force + stiffness * nextApproach * dtSeconds + damping * nextApproach);
};
