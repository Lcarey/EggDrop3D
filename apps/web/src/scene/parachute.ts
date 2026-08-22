import type { Vec3 } from "@eggdrop/shared";

/**
 * Plastic-bag parachute model. A falling bag rammed by air from below billows
 * into a canopy: its effective drag area and coefficient grow with descent
 * speed, and the centre of pressure moves up into the dome, which torques a
 * tilted canopy back upright like a pendulum. All functions are pure so the
 * physics step and the billowing visual share one deterministic model.
 */

/** Descent speed at which the canopy is half inflated. */
export const CANOPY_BILLOW_REFERENCE_SPEED_MPS = 1.2;
/** Facing-area floor of a limp flat sheet slicing edge-on through air. */
export const CANOPY_FLAT_FACING_FLOOR = 0.18;
/** A fully billowed canopy catches air at almost any angle of attack. */
export const CANOPY_BILLOWED_FACING_FLOOR = 0.85;
/**
 * Extra drag a fully billowed canopy gains over the flat sheet. Tuned so a
 * default bag carrying an egg settles near 2 m/s: slow enough that touchdown
 * stays below the egg's crack load and the rebound is too soft to register a
 * second impact.
 */
export const CANOPY_DRAG_GAIN = 2;
/** Centre-of-pressure height above the sheet centre, per sqrt(canopy area). */
export const CANOPY_PRESSURE_HEIGHT_RATIO = 0.22;
/** Dome height of a fully billowed canopy relative to its smaller span. */
export const CANOPY_BULGE_RATIO = 0.38;
/** Load height above the sheet at which the canopy is half blocked. */
export const CANOPY_LOAD_BLOCK_REFERENCE_M = 0.04;

/**
 * How much a joined payload riding above the sheet blocks the canopy,
 * 0 (free) to 1 (fully blocked). A parachute only works with its load slung
 * below: a payload resting on top presses the film down and fills the dome,
 * so inflation — and the self-righting pressure offset that comes with it —
 * collapses as the load's centre of mass rises above the sheet.
 */
export const calculateCanopyBlockage = (supportedLoadHeightM: number): number => {
  const height = Number.isFinite(supportedLoadHeightM) ? Math.max(0, supportedLoadHeightM) : 0;
  return height / (height + CANOPY_LOAD_BLOCK_REFERENCE_M);
};

/**
 * How inflated the canopy is, 0 (limp) to 1 (fully billowed), as a saturating
 * function of descent speed. Positive input means moving downward.
 */
export const calculateCanopyBillow = (descentSpeedMps: number): number => {
  const descent = Number.isFinite(descentSpeedMps) ? Math.max(0, descentSpeedMps) : 0;
  return descent / (descent + CANOPY_BILLOW_REFERENCE_SPEED_MPS);
};

/** World-space dome height (metres) of the billowed canopy, for the visual. */
export const calculateCanopyBulgeM = (billow: number, dimensions: Readonly<Vec3>): number =>
  Math.max(0, Math.min(1, billow)) * CANOPY_BULGE_RATIO * Math.min(dimensions[0], dimensions[2]);

export type CanopyForceInput = {
  velocityMps: Readonly<Vec3>;
  /** World-space unit vector of the bag's local +Y (sheet normal). */
  canopyNormal: Readonly<Vec3>;
  dimensions: Readonly<Vec3>;
  dragCoefficient: number;
  airDensityKgM3: number;
  /**
   * World-vertical metres of the joined payload's centre of mass above the
   * sheet centre. Positive (load riding on top) collapses the canopy.
   */
  supportedLoadHeightM?: number;
};

export type CanopyForce = {
  forceN: Vec3;
  /** World offset from the centre of mass where the force applies. */
  applicationOffsetM: Vec3;
  billow: number;
};

/**
 * Aerodynamic force on the bag. While descending, the billowed canopy drags
 * with near-full flat area regardless of attitude and an inflated-canopy drag
 * coefficient; the force applies above the centre of mass (along the sheet
 * normal, scaled by billow) so a loaded canopy self-rights instead of
 * tumbling. When limp (at rest or moving up) it degrades to the old
 * facing-scaled flat sheet with the force through the centre.
 */
export const calculatePlasticBagCanopyForce = ({
  velocityMps,
  canopyNormal,
  dimensions,
  dragCoefficient,
  airDensityKgM3,
  supportedLoadHeightM = 0,
}: CanopyForceInput): CanopyForce => {
  const speed = Math.hypot(velocityMps[0], velocityMps[1], velocityMps[2]);
  if (speed < 1e-6) return { forceN: [0, 0, 0], applicationOffsetM: [0, 0, 0], billow: 0 };

  const flatAreaM2 = dimensions[0] * dimensions[2];
  const billow = calculateCanopyBillow(-velocityMps[1])
    * (1 - calculateCanopyBlockage(supportedLoadHeightM));
  const facing = Math.abs(
    (canopyNormal[0] * velocityMps[0] + canopyNormal[1] * velocityMps[1] + canopyNormal[2] * velocityMps[2]) / speed,
  );
  const facingFloor = CANOPY_FLAT_FACING_FLOOR
    + (CANOPY_BILLOWED_FACING_FLOOR - CANOPY_FLAT_FACING_FLOOR) * billow;
  const effectiveAreaM2 = flatAreaM2 * (facingFloor + (1 - facingFloor) * facing);
  const effectiveDragCoefficient = dragCoefficient * (1 + CANOPY_DRAG_GAIN * billow);
  const magnitudeN = 0.5 * airDensityKgM3 * effectiveDragCoefficient * effectiveAreaM2 * speed * speed;
  const scale = -magnitudeN / speed;
  const pressureHeightM = billow * CANOPY_PRESSURE_HEIGHT_RATIO * Math.sqrt(flatAreaM2);

  return {
    forceN: [velocityMps[0] * scale, velocityMps[1] * scale, velocityMps[2] * scale],
    applicationOffsetM: [
      canopyNormal[0] * pressureHeightM,
      canopyNormal[1] * pressureHeightM,
      canopyNormal[2] * pressureHeightM,
    ],
    billow,
  };
};
