import { MATERIAL_BY_ID } from "./catalog.js";
import type {
  EggDamageState,
  MaterialId,
  Vec3,
} from "./contracts.js";

export const FEET_TO_METERS = 0.3048;
export const STANDARD_GRAVITY_MPS2 = 9.80665;
export const SEA_LEVEL_AIR_DENSITY_KG_M3 = 1.225;
export const DEFAULT_SNAP_METERS = 0.05;
export const DEFAULT_ROTATION_SNAP_RADIANS = Math.PI / 12;

export function feetToMeters(feet: number): number {
  assertFinite(feet, "feet");
  return feet * FEET_TO_METERS;
}

export function metersToFeet(meters: number): number {
  assertFinite(meters, "meters");
  return meters / FEET_TO_METERS;
}

export function snapScalar(value: number, increment: number): number {
  assertFinite(value, "value");
  assertPositiveFinite(increment, "increment");
  const snapped = Math.round(value / increment) * increment;
  return Object.is(snapped, -0) ? 0 : snapped;
}

export function snapVec3(
  value: Readonly<Vec3>,
  increment = DEFAULT_SNAP_METERS,
): Vec3 {
  return [
    snapScalar(value[0], increment),
    snapScalar(value[1], increment),
    snapScalar(value[2], increment),
  ];
}

export function snapRadians(
  radians: number,
  increment = DEFAULT_ROTATION_SNAP_RADIANS,
): number {
  return snapScalar(radians, increment);
}

export function clamp(value: number, minimum: number, maximum: number): number {
  assertFinite(value, "value");
  assertFinite(minimum, "minimum");
  assertFinite(maximum, "maximum");
  if (minimum > maximum) {
    throw new RangeError("minimum cannot be greater than maximum");
  }
  return Math.min(maximum, Math.max(minimum, value));
}

export function magnitude(vector: Readonly<Vec3>): number {
  assertFiniteVec3(vector, "vector");
  return Math.hypot(vector[0], vector[1], vector[2]);
}

export interface DragForceInput {
  velocityMps: Readonly<Vec3>;
  dragCoefficient: number;
  crossSectionAreaM2: number;
  airDensityKgM3?: number;
}

/** Returns force in newtons, opposite to the supplied world-space velocity. */
export function calculateDragForce({
  velocityMps,
  dragCoefficient,
  crossSectionAreaM2,
  airDensityKgM3 = SEA_LEVEL_AIR_DENSITY_KG_M3,
}: DragForceInput): Vec3 {
  assertFiniteVec3(velocityMps, "velocityMps");
  assertNonNegativeFinite(dragCoefficient, "dragCoefficient");
  assertNonNegativeFinite(crossSectionAreaM2, "crossSectionAreaM2");
  assertNonNegativeFinite(airDensityKgM3, "airDensityKgM3");

  const speed = magnitude(velocityMps);
  if (speed === 0 || dragCoefficient === 0 || crossSectionAreaM2 === 0) {
    return [0, 0, 0];
  }

  const forceMagnitude =
    0.5 * airDensityKgM3 * dragCoefficient * crossSectionAreaM2 * speed * speed;
  const scale = -forceMagnitude / speed;
  return velocityMps.map((component) => {
    const force = component * scale;
    return Object.is(force, -0) ? 0 : force;
  }) as Vec3;
}

export interface BuoyancyForceInput {
  volumeM3: number;
  buoyancyFactor?: number;
  airDensityKgM3?: number;
  gravityMps2?: number;
}

/** Returns the upward buoyant force in newtons. */
export function calculateBuoyantForceN({
  volumeM3,
  buoyancyFactor = 1,
  airDensityKgM3 = SEA_LEVEL_AIR_DENSITY_KG_M3,
  gravityMps2 = STANDARD_GRAVITY_MPS2,
}: BuoyancyForceInput): number {
  assertNonNegativeFinite(volumeM3, "volumeM3");
  assertNonNegativeFinite(buoyancyFactor, "buoyancyFactor");
  assertNonNegativeFinite(airDensityKgM3, "airDensityKgM3");
  assertNonNegativeFinite(gravityMps2, "gravityMps2");
  return volumeM3 * buoyancyFactor * airDensityKgM3 * gravityMps2;
}

export function calculateBuoyantForce(input: BuoyancyForceInput): Vec3 {
  return [0, calculateBuoyantForceN(input), 0];
}

export function calculateBoxVolumeM3(dimensions: Readonly<Vec3>): number {
  assertFiniteVec3(dimensions, "dimensions");
  dimensions.forEach((dimension) =>
    assertPositiveFinite(dimension, "dimension"),
  );
  return dimensions[0] * dimensions[1] * dimensions[2];
}

export function calculatePartMassKg(
  materialId: MaterialId,
  dimensions: Readonly<Vec3>,
): number {
  return (
    calculateBoxVolumeM3(dimensions) *
    MATERIAL_BY_ID[materialId].physics.densityKgM3
  );
}

export function impactSpeedFromDropHeightMps(
  heightFt: number,
  gravityMps2 = STANDARD_GRAVITY_MPS2,
): number {
  assertNonNegativeFinite(heightFt, "heightFt");
  assertNonNegativeFinite(gravityMps2, "gravityMps2");
  return Math.sqrt(2 * gravityMps2 * feetToMeters(heightFt));
}

export function calculatePeakG(
  deltaVelocityMps: number,
  impactDurationSeconds: number,
): number {
  assertNonNegativeFinite(deltaVelocityMps, "deltaVelocityMps");
  assertPositiveFinite(impactDurationSeconds, "impactDurationSeconds");
  return deltaVelocityMps / impactDurationSeconds / STANDARD_GRAVITY_MPS2;
}

export function calculatePeakForceN(massKg: number, peakG: number): number {
  assertNonNegativeFinite(massKg, "massKg");
  assertNonNegativeFinite(peakG, "peakG");
  return massKg * peakG * STANDARD_GRAVITY_MPS2;
}

export interface EggDamageInput {
  peakG: number;
  referenceCrackG: number;
  cushioning?: number;
}

/**
 * Converts a collision into normalized egg damage. Cushioning is a 0..1 impact
 * reduction; damage reaches 1 at the mission's reference crack load.
 */
export function calculateEggDamage({
  peakG,
  referenceCrackG,
  cushioning = 0,
}: EggDamageInput): number {
  assertNonNegativeFinite(peakG, "peakG");
  assertPositiveFinite(referenceCrackG, "referenceCrackG");
  assertFinite(cushioning, "cushioning");

  const reduction = clamp(cushioning, 0, 1);
  const effectiveG = peakG * (1 - reduction);
  return clamp(effectiveG / referenceCrackG, 0, 1);
}

export function accumulateEggDamage(
  currentDamage: number,
  impactDamage: number,
): number {
  return clamp(currentDamage + impactDamage, 0, 1);
}

export function eggDamageState(damage: number): EggDamageState {
  assertFinite(damage, "damage");
  return damage >= 1 ? "cracked" : "survived";
}

function assertFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${name} must be finite`);
  }
}

function assertPositiveFinite(value: number, name: string): void {
  assertFinite(value, name);
  if (value <= 0) {
    throw new RangeError(`${name} must be greater than zero`);
  }
}

function assertNonNegativeFinite(value: number, name: string): void {
  assertFinite(value, name);
  if (value < 0) {
    throw new RangeError(`${name} cannot be negative`);
  }
}

function assertFiniteVec3(value: Readonly<Vec3>, name: string): void {
  value.forEach((component) => assertFinite(component, name));
}
