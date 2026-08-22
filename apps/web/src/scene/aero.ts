import { calculateDragForce, type Vec3 } from "@eggdrop/shared";

/**
 * Attitude-dependent flat-plate aerodynamics for box-like parts. Replaces the
 * old orientation-blind max-face-area drag (an edge-on cardboard sheet used
 * to drag exactly like a face-on one) and the hand-tuned linear spin damping
 * with geometry-derived models: projected area summed over the three face
 * pairs, force applied at the area-weighted windward centroid (a real centre
 * of pressure, so sheets weathervane and tumble believably), and quadratic
 * angular drag from the flat-plate strip integral, integrated implicitly so
 * it is unconditionally stable at any spin rate without inertia-ratio caps.
 */

type Quat = readonly [number, number, number, number];

const rotateByQuaternion = (v: Vec3, [qx, qy, qz, qw]: Quat): Vec3 => {
  // v' = v + 2q×(q×v + wv) with q the vector part.
  const cx = qy * v[2] - qz * v[1] + qw * v[0];
  const cy = qz * v[0] - qx * v[2] + qw * v[1];
  const cz = qx * v[1] - qy * v[0] + qw * v[2];
  return [
    v[0] + 2 * (qy * cz - qz * cy),
    v[1] + 2 * (qz * cx - qx * cz),
    v[2] + 2 * (qx * cy - qy * cx),
  ];
};

export type ProjectedDragInput = {
  /** Velocity of the body relative to the air, m/s. */
  velocityMps: Vec3;
  /** Body rotation quaternion [x, y, z, w]. */
  rotation: Quat;
  dimensions: Vec3;
  dragCoefficient: number;
  airDensityKgM3: number;
};

export type ProjectedDrag = {
  forceN: Vec3;
  /** Centre of pressure relative to the body's centre of mass, metres. */
  applicationOffsetM: Vec3;
  /** Flow-projected reference area actually used, m². */
  projectedAreaM2: number;
};

/**
 * How far the centre of pressure leads toward the upstream edge of an
 * obliquely-struck face, as a fraction of the in-plane flow component times
 * the face span — the thin-airfoil quarter-chord result. This is what makes
 * a tilted falling sheet feel a real torque (flutter/tumble) instead of a
 * pure force through its centroid.
 */
const CENTER_OF_PRESSURE_LEAD = 0.25;

export const calculateProjectedDrag = ({
  velocityMps,
  rotation,
  dimensions,
  dragCoefficient,
  airDensityKgM3,
}: ProjectedDragInput): ProjectedDrag => {
  const speed = Math.hypot(velocityMps[0], velocityMps[1], velocityMps[2]);
  if (speed < 1e-9 || airDensityKgM3 <= 0) {
    return { forceN: [0, 0, 0], applicationOffsetM: [0, 0, 0], projectedAreaM2: 0 };
  }
  const direction: Vec3 = [velocityMps[0] / speed, velocityMps[1] / speed, velocityMps[2] / speed];
  // Flow direction expressed in the body frame; component i is exactly the
  // facing factor n_i . v of face pair i.
  const inverse: Quat = [-rotation[0], -rotation[1], -rotation[2], rotation[3]];
  const flow = rotateByQuaternion(direction, inverse);
  const faceAreas = [
    dimensions[1] * dimensions[2],
    dimensions[0] * dimensions[2],
    dimensions[0] * dimensions[1],
  ];
  let projectedAreaM2 = 0;
  const centroidLocal: [number, number, number] = [0, 0, 0];
  for (let axis = 0; axis < 3; axis += 1) {
    const facing = flow[axis]!;
    const contribution = Math.abs(facing) * faceAreas[axis]!;
    if (contribution <= 0) continue;
    projectedAreaM2 += contribution;
    // Pressure acts on the windward face: the one whose outward normal points
    // along the motion (it meets the oncoming air first)...
    centroidLocal[axis] = centroidLocal[axis]! + contribution * Math.sign(facing) * dimensions[axis]! / 2;
    // ...shifted toward that face's leading (upstream-of-motion) edge when
    // the flow strikes obliquely.
    for (let other = 0; other < 3; other += 1) {
      if (other === axis) continue;
      centroidLocal[other] = centroidLocal[other]! + contribution * CENTER_OF_PRESSURE_LEAD * flow[other]! * dimensions[other]!;
    }
  }
  if (projectedAreaM2 <= 0) {
    return { forceN: [0, 0, 0], applicationOffsetM: [0, 0, 0], projectedAreaM2: 0 };
  }
  const forceN = calculateDragForce({
    velocityMps,
    dragCoefficient,
    crossSectionAreaM2: projectedAreaM2,
    airDensityKgM3,
  });
  const applicationOffsetM = rotateByQuaternion(
    [
      centroidLocal[0] / projectedAreaM2,
      centroidLocal[1] / projectedAreaM2,
      centroidLocal[2] / projectedAreaM2,
    ],
    rotation,
  );
  return { forceN, applicationOffsetM, projectedAreaM2 };
};

export type SpinDragInput = {
  /** World-space angular velocity, rad/s. */
  angularVelocityRps: Vec3;
  /** Body rotation quaternion [x, y, z, w]. */
  rotation: Quat;
  dimensions: Vec3;
  massKg: number;
  dragCoefficient: number;
  airDensityKgM3: number;
  dtSeconds: number;
};

/**
 * Quadratic angular drag torque (world space, N·m) for a spinning box.
 * Per-axis coefficient from the flat-plate strip integral: a plate of span L
 * and width d rotating about its central axis feels tau = rho*Cd*L*d^4/64 *
 * omega^2 per side pair. Solved implicitly per axis (omega' = omega/(1 +
 * c*|omega|*dt/I)) so a single step can never overshoot or reverse the spin.
 */
export const calculateImplicitSpinDragTorque = ({
  angularVelocityRps,
  rotation,
  dimensions,
  massKg,
  dragCoefficient,
  airDensityKgM3,
  dtSeconds,
}: SpinDragInput): Vec3 => {
  if (airDensityKgM3 <= 0 || dtSeconds <= 0) return [0, 0, 0];
  const inverse: Quat = [-rotation[0], -rotation[1], -rotation[2], rotation[3]];
  const local = rotateByQuaternion(angularVelocityRps, inverse);
  const [dx, dy, dz] = dimensions;
  const stripIntegral = (spanA: number, spanB: number) =>
    (spanA * spanB ** 4 + spanB * spanA ** 4) / 32;
  const coefficients = [
    0.5 * airDensityKgM3 * dragCoefficient * stripIntegral(dy, dz),
    0.5 * airDensityKgM3 * dragCoefficient * stripIntegral(dx, dz),
    0.5 * airDensityKgM3 * dragCoefficient * stripIntegral(dx, dy),
  ];
  const inertias = [
    massKg * (dy * dy + dz * dz) / 12,
    massKg * (dx * dx + dz * dz) / 12,
    massKg * (dx * dx + dy * dy) / 12,
  ];
  const localTorque: Vec3 = [0, 0, 0];
  for (let axis = 0; axis < 3; axis += 1) {
    const omega = local[axis]!;
    if (omega === 0 || inertias[axis]! <= 0) continue;
    const next = omega / (1 + coefficients[axis]! * Math.abs(omega) * dtSeconds / inertias[axis]!);
    localTorque[axis] = inertias[axis]! * (next - omega) / dtSeconds;
  }
  return rotateByQuaternion(localTorque, rotation);
};
