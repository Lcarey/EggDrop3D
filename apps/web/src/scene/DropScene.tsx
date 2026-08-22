import { Billboard, ContactShadows, Line, OrbitControls, PerspectiveCamera, Text } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { LabEnvironment, LandingGround } from "./scenery";
import {
  BallCollider,
  CapsuleCollider,
  CuboidCollider,
  CylinderCollider,
  Physics,
  RigidBody,
  useAfterPhysicsStep,
  useBeforePhysicsStep,
  useFixedJoint,
  useRapier,
  useRopeJoint,
  useSphericalJoint,
  useSpringJoint,
  type RapierRigidBody,
  type ContactForcePayload,
  type CollisionEnterPayload,
  type FixedJointParams,
} from "@react-three/rapier";
import {
  MATERIAL_BY_ID,
  SEA_LEVEL_AIR_DENSITY_KG_M3,
  STANDARD_GRAVITY_MPS2,
  calculateBalloonSimMassKg,
  calculateBuoyantForceN,
  calculateDragForce,
  calculateMissionScore,
  calculatePartMassKg,
  feetToMeters,
  MAX_DROP_HEIGHT_FT,
  type DesignJointV1,
  type DesignPartV1,
  type DesignV1,
  type DropOutcome,
  type DropResult,
  type MaterialId,
} from "@eggdrop/shared";
import { calculateImplicitSpinDragTorque, calculateProjectedDrag } from "./aero";
import { BALLOON_MAX_REACTION_MPS2, calculatePneumaticContactForceN } from "./balloonContact";
import {
  MIN_SEGMENTED_ROPE_LENGTH_M,
  ROPE_SEGMENT_RADIUS_M,
  planRopeChain,
  type RopeSegmentLayout,
} from "./ropeChain";
import { classifyBodyMotion, maxPlausibleSpeedMps } from "./watchdog";
import { createWindField, type WindField } from "./wind";
import { Suspense, createRef, useEffect, useMemo, useRef, useState, type ComponentRef, type RefObject } from "react";
import { BufferGeometry, Quaternion, TOUCH, Vector3, type Group } from "three";
import { DEFAULT_DROP_PLAYBACK_RATE, normalizeDropPlaybackRate } from "../dropPlayback";
import { useEditorStore } from "../editor/store";
import { EggVisual, PartVisual } from "./PartVisual";
import { PlasticBagCanopyVisual } from "./PlasticBagCanopyVisual";
import { calculatePlasticBagCanopyForce } from "./parachute";
import {
  calculateDropInterpolationAlpha,
  copyDropRenderPose,
  createDropRenderPose,
  interpolateDropRenderPose,
  type DropRenderPose,
} from "./dropInterpolation";

type BodyRefs = Record<string, RefObject<RapierRigidBody>>;
type DropPoseFrame = {
  previous: DropRenderPose;
  current: DropRenderPose;
  displayed: DropRenderPose;
};
type DropPoseFrames = Record<string, DropPoseFrame>;
type DropOrbitControls = ComponentRef<typeof OrbitControls>;
type DropSceneProps = {
  design: DesignV1;
  runId: number;
  running: boolean;
  playbackRate: number;
  gravityMps2: number;
  airDensityKgM3: number;
  onComplete: (result: DropResult) => void;
};

const EGG_MASS_KG = .057;

/**
 * Rapier body damping is a stand-in for small unmodelled aero effects
 * (surface flutter, micro-turbulence), so it must scale with the local
 * atmosphere. Constant damping acted as phantom drag in vacuum: Moon landings
 * arrived 6–29% below vacuum free-fall, with the deficit ranking exactly by
 * the material's damping coefficient. Thin air scales it down (never up —
 * dense-atmosphere drag is carried by the explicit aero model); a tiny floor
 * stays for solver hygiene, never exceeding the material's own value.
 */
const SOLVER_HYGIENE_DAMPING = .01;
export const atmosphericDamping = (baseDamping: number, airDensityKgM3: number): number =>
  Math.max(
    Math.min(baseDamping, SOLVER_HYGIENE_DAMPING),
    baseDamping * Math.min(1, airDensityKgM3 / SEA_LEVEL_AIR_DENSITY_KG_M3),
  );

/** A body joined (directly or transitively) to a plastic bag, with its mass. */
type BagLoadEntry = { bodyId: string; massKg: number };
type BagLoad = { entries: BagLoadEntry[]; refs: BodyRefs };

/**
 * Air velocity of the body relative to the wind at its altitude. Real air is
 * never perfectly still; without a lateral nudge a statically unstable build
 * — e.g. a heavy egg balanced on top of a draggy sheet — balances on its
 * unstable equilibrium all the way down because the simulation is otherwise
 * perfectly symmetric. The wind field's log-law profile is zero at ground
 * level, so settled bodies feel still air and can sleep.
 */
const relativeAirVelocity = (
  velocity: { x: number; y: number; z: number },
  wind: WindField,
  heightM: number,
): [number, number, number] => {
  const gust = wind.velocityAt(heightM);
  return [
    velocity.x - gust[0],
    velocity.y - gust[1],
    velocity.z - gust[2],
  ];
};

export const DROP_RELEASE_HOLD_SECONDS = .5;
export const DROP_PLAYBACK_RATE = DEFAULT_DROP_PLAYBACK_RATE;
/**
 * 240 Hz physics. At 60 Hz a ~8 m/s landing moves bodies 13 cm in a single
 * step — bigger than a whole contraption — so CCD stops the parts that hit
 * the ground mid-step while the welded rest of the assembly completes the
 * full step. The fixed joints end up violated by ~10 cm and the solver's
 * correction impulse trampolined entire structures upward at 3-4× the impact
 * speed. Smaller steps keep per-step travel below part size. The extra steps
 * are cheap: playback advances simulation time at 0.2× real time.
 */
export const DROP_FIXED_STEP_SECONDS = 1 / 240;
/** Fraction of a legacy 60 Hz step per physics step; scales per-step constants. */
const STEP_RATE_SCALE = DROP_FIXED_STEP_SECONDS * 60;
export const DROP_OUTCOME_REVEAL_SECONDS = .8;
/** Real (wall-clock) seconds the egg must stay still on a grounded contraption to win. */
export const DROP_SETTLE_REAL_SECONDS = 3;
export const DROP_SIMULATION_TIMEOUT_SECONDS = 20;
export const calculateDropMaxWallSeconds = (playbackRate = DROP_PLAYBACK_RATE) => DROP_RELEASE_HOLD_SECONDS
  + DROP_SIMULATION_TIMEOUT_SECONDS / normalizeDropPlaybackRate(playbackRate)
  + DROP_OUTCOME_REVEAL_SECONDS;
export const DROP_MAX_WALL_SECONDS = calculateDropMaxWallSeconds();
export const DROP_DAMAGE_ARM_SECONDS = .15;
const FIXED_STEP_EPSILON = 1e-10;

export const calculatePlaybackSimulationDelta = (
  realElapsedBefore: number,
  frameDelta: number,
  playbackRate = DROP_PLAYBACK_RATE,
) => {
  const elapsed = Number.isFinite(realElapsedBefore) ? Math.max(0, realElapsedBefore) : 0;
  const delta = Number.isFinite(frameDelta) ? Math.max(0, frameDelta) : 0;
  const activeBefore = Math.max(0, elapsed - DROP_RELEASE_HOLD_SECONDS);
  const activeAfter = Math.max(0, elapsed + delta - DROP_RELEASE_HOLD_SECONDS);
  return (activeAfter - activeBefore) * normalizeDropPlaybackRate(playbackRate);
};

const transformHalfDiagonal = (dimensions: [number, number, number]) =>
  Math.hypot(dimensions[0], dimensions[1], dimensions[2]) / 2;

export const calculateDropCameraDistance = (design: DesignV1) => {
  const eggPosition = design.eggTransform.position;
  let framingRadius = transformHalfDiagonal(design.eggTransform.dimensions);
  for (const part of design.parts) {
    const centerDistance = Math.hypot(
      part.transform.position[0] - eggPosition[0],
      part.transform.position[1] - eggPosition[1],
      part.transform.position[2] - eggPosition[2],
    );
    framingRadius = Math.max(framingRadius, centerDistance + transformHalfDiagonal(part.transform.dimensions));
  }
  return Math.min(5.5, Math.max(.78, framingRadius * 3.2));
};

const verticalHalfExtent = (dimensions: [number, number, number], rotation: [number, number, number, number]) => {
  const quaternion = new Quaternion(...rotation);
  const xAxis = new Vector3(1, 0, 0).applyQuaternion(quaternion);
  const yAxis = new Vector3(0, 1, 0).applyQuaternion(quaternion);
  const zAxis = new Vector3(0, 0, 1).applyQuaternion(quaternion);
  return (
    Math.abs(xAxis.y) * dimensions[0] +
    Math.abs(yAxis.y) * dimensions[1] +
    Math.abs(zAxis.y) * dimensions[2]
  ) / 2;
};

const dropOffset = (design: DesignV1) => {
  let lowest = design.eggTransform.position[1] - verticalHalfExtent(design.eggTransform.dimensions, design.eggTransform.rotation);
  for (const part of design.parts) {
    lowest = Math.min(
      lowest,
      part.transform.position[1] - verticalHalfExtent(part.transform.dimensions, part.transform.rotation),
    );
  }
  return feetToMeters(design.heightFt) - lowest;
};

const worldAnchor = (transform: DesignV1["eggTransform"], anchor: [number, number, number]) =>
  new Vector3(...anchor)
    .applyQuaternion(new Quaternion(...transform.rotation))
    .add(new Vector3(...transform.position));

const transformForBody = (design: DesignV1, bodyId: string) =>
  bodyId === "egg" ? design.eggTransform : design.parts.find((part) => part.id === bodyId)!.transform;

const localAnchorAtWorldPoint = (transform: DesignV1["eggTransform"], point: Vector3) => {
  const local = point.clone()
    .sub(new Vector3(...transform.position))
    .applyQuaternion(new Quaternion(...transform.rotation).invert());
  return [local.x, local.y, local.z] as [number, number, number];
};

/**
 * Rapier fixed-joint frames must already coincide in world space. The two
 * points selected for a strip of tape are often separated, so using them
 * directly makes the solver snap the bodies together on the first tick.
 * Build a coincident frame at the tape midpoint instead; this preserves the
 * exact contraption pose the student authored.
 */
export const calculateFixedJointFrames = (design: DesignV1, joint: DesignJointV1): FixedJointParams => {
  const transformA = transformForBody(design, joint.bodyA);
  const transformB = transformForBody(design, joint.bodyB);
  const midpoint = worldAnchor(transformA, joint.anchorA)
    .add(worldAnchor(transformB, joint.anchorB))
    .multiplyScalar(.5);
  const rotationA = new Quaternion(...transformA.rotation);
  const rotationB = new Quaternion(...transformB.rotation);
  const frameB = rotationB.clone().invert().multiply(rotationA).normalize();

  return [
    localAnchorAtWorldPoint(transformA, midpoint),
    [0, 0, 0, 1] as [number, number, number, number],
    localAnchorAtWorldPoint(transformB, midpoint),
    [frameB.x, frameB.y, frameB.z, frameB.w] as [number, number, number, number],
  ];
};

/**
 * A balloon's rigid collider is only its fully-squashed "core". The outer
 * 40% of the radius is a squishy air cushion simulated by BalloonSuspension:
 * rigid spheres cannot compress, so without this a loaded balloon behaved
 * like a marble — transmitting instantaneous stops (cracking the egg) and
 * squirting out sideways from under any weight.
 */
export const BALLOON_CORE_RATIO = .5;

function PartCollider({ part, mass }: { part: DesignPartV1; mass: number }) {
  const [x, y, z] = part.transform.dimensions;
  switch (part.materialId) {
    case "balloon":
      return <BallCollider args={[Math.max(x, y, z) / 2 * BALLOON_CORE_RATIO]} mass={mass} />;
    case "cottonBall":
    case "newspaper":
    case "packingPeanuts":
      return <BallCollider args={[Math.max(x, y, z) / 2]} mass={mass} />;
    case "paperCup":
      return <CylinderCollider args={[y / 2, Math.max(x, z) / 2]} mass={mass} />;
    default:
      return <CuboidCollider args={[x / 2, y / 2, z / 2]} mass={mass} />;
  }
}

function AerodynamicForces({ bodyRef, materialId, dimensions, gravityMps2, airDensityKgM3, wind, load }: { bodyRef: RefObject<RapierRigidBody>; materialId: MaterialId; dimensions: [number, number, number]; gravityMps2: number; airDensityKgM3: number; wind: WindField; load?: BagLoad }) {
  const realMassKg = Math.max(.001, calculatePartMassKg(materialId, dimensions));
  // Balloons carry the air inside them plus the "added mass" of air they
  // shove aside; simulating that inertia (instead of a hand-tuned floor)
  // keeps the mass ratio against heavy payloads physical.
  const simMassKg = materialId === "balloon"
    ? calculateBalloonSimMassKg(dimensions, airDensityKgM3)
    : realMassKg;
  useBeforePhysicsStep(() => {
    const body = bodyRef.current;
    if (!body) return;
    body.resetForces(false);
    body.resetTorques(false);
    // Rotational air drag, solved implicitly so a single step can never
    // overshoot or reverse the spin. Real panels flutter against big
    // rotational resistance; without this a thin body can wind up unbounded
    // spin from repeated contact impulses and slice through the scene like a
    // saw blade.
    const rotation = body.rotation();
    const rotationQuat: [number, number, number, number] = [rotation.x, rotation.y, rotation.z, rotation.w];
    const spin = body.angvel();
    const spinTorque = calculateImplicitSpinDragTorque({
      angularVelocityRps: [spin.x, spin.y, spin.z],
      rotation: rotationQuat,
      dimensions,
      massKg: simMassKg,
      dragCoefficient: MATERIAL_BY_ID[materialId].physics.dragCoefficient,
      airDensityKgM3,
      dtSeconds: DROP_FIXED_STEP_SECONDS,
    });
    body.addTorque({ x: spinTorque[0], y: spinTorque[1], z: spinTorque[2] }, true);
    const velocity = body.linvel();
    const center = body.translation();
    const airVelocity = relativeAirVelocity(velocity, wind, center.y);
    const airSpeed = Math.hypot(airVelocity[0], airVelocity[1], airVelocity[2]);
    if (airSpeed > .01) {
      if (materialId === "plasticBag") {
        // Parachute model: a descending bag billows into a canopy with far
        // more drag than a flat sheet, and the force applies at the dome's
        // centre of pressure above the centre of mass so a loaded bag
        // self-rights canopy-up instead of tumbling. A joined payload whose
        // centre of mass rides above the sheet blocks that inflation, so an
        // egg perched on top of a bag gets no parachute.
        const normal = new Vector3(0, 1, 0).applyQuaternion(new Quaternion(rotation.x, rotation.y, rotation.z, rotation.w));
        let supportedLoadHeightM = 0;
        if (load) {
          let totalKg = 0;
          let weightedY = 0;
          for (const entry of load.entries) {
            const other = load.refs[entry.bodyId]?.current;
            if (!other) continue;
            weightedY += other.translation().y * entry.massKg;
            totalKg += entry.massKg;
          }
          if (totalKg > 0) supportedLoadHeightM = weightedY / totalKg - center.y;
        }
        const canopy = calculatePlasticBagCanopyForce({
          velocityMps: airVelocity,
          canopyNormal: [normal.x, normal.y, normal.z],
          dimensions,
          dragCoefficient: MATERIAL_BY_ID.plasticBag.physics.dragCoefficient,
          airDensityKgM3,
          supportedLoadHeightM,
        });
        body.addForceAtPoint(
          { x: canopy.forceN[0], y: canopy.forceN[1], z: canopy.forceN[2] },
          {
            x: center.x + canopy.applicationOffsetM[0],
            y: center.y + canopy.applicationOffsetM[1],
            z: center.z + canopy.applicationOffsetM[2],
          },
          true,
        );
      } else {
        // Attitude-dependent drag: the flow-projected area of the oriented
        // box, applied at the centre of pressure (leading toward the upstream
        // edge for oblique flow) so tilted sheets feel real flutter/tumble
        // torque instead of a pure force through the centroid.
        const drag = calculateProjectedDrag({
          velocityMps: airVelocity,
          rotation: rotationQuat,
          dimensions,
          dragCoefficient: MATERIAL_BY_ID[materialId].physics.dragCoefficient,
          airDensityKgM3,
        });
        body.addForceAtPoint(
          { x: drag.forceN[0], y: drag.forceN[1], z: drag.forceN[2] },
          {
            x: center.x + drag.applicationOffsetM[0],
            y: center.y + drag.applicationOffsetM[1],
            z: center.z + drag.applicationOffsetM[2],
          },
          true,
        );
      }
    }
    if (materialId === "balloon") {
      // Buoyancy must use the same box-volume basis as calculatePartMassKg
      // (the catalog calibration test pins that contract). Using the smaller
      // ellipsoid volume here while weight used the box volume shrank net
      // lift to near zero, so balloons knocked down during a landing rested
      // on the ground looking dead instead of floating back up.
      const buoyancy = calculateBuoyantForceN({
        volumeM3: dimensions[0] * dimensions[1] * dimensions[2],
        buoyancyFactor: MATERIAL_BY_ID.balloon.physics.buoyancyFactor,
        airDensityKgM3,
        gravityMps2,
      });
      // Cancel gravity on the added air inertia: the air a balloon carries is
      // neutrally buoyant, so it adds inertia but no net weight.
      const gravityCompensation = Math.max(0, simMassKg - realMassKg) * gravityMps2;
      body.addForce({ x: 0, y: buoyancy + gravityCompensation, z: 0 }, true);
    }
  });
  return null;
}

/** Lateral scrub while the balloon's soft shell touches the ground. */
const BALLOON_GROUND_DRAG = .8;
/**
 * Coulomb friction coefficient for the balloon shell: latex on cardboard or
 * grass is grippy (~0.6). The pneumatic shell force is a pure normal push;
 * without a tangential component, nothing holds a loose balloon under its
 * payload, so a landing raft see-saws and squirts its cushion out sideways.
 */
const BALLOON_SHELL_FRICTION = .6;

const BALL_APPROX_MATERIALS = new Set<MaterialId>(["balloon", "cottonBall", "newspaper", "packingPeanuts", "paperCup"]);

/**
 * Root id of each body's welded (fixed-joint) assembly, egg included; bodies
 * not welded to anything are their own root. Balloon shell forces must never
 * fire between members of the same welded assembly: the shell pushes the pair
 * apart while the weld constraint pulls it back together, and that tug-of-war
 * pumps energy every step. Three or more balloons taped to an egg diverged to
 * the watchdog ceiling, and an egg sandwiched between two taped balloons
 * launched above free-fall speed. Chained (tether) fixed joints do not weld.
 */
export const calculateWeldedAssemblyRoots = (design: DesignV1): Map<string, string> => {
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    const ancestor = parent.get(id) ?? id;
    if (ancestor === id) return id;
    const root = find(ancestor);
    parent.set(id, root);
    return root;
  };
  for (const joint of design.joints) {
    if (joint.kind !== "fixed" || isChainedJoint(design, joint)) continue;
    parent.set(find(joint.bodyA), find(joint.bodyB));
  }
  const roots = new Map<string, string>();
  for (const id of ["egg", ...design.parts.map((part) => part.id)]) roots.set(id, find(id));
  return roots;
};

/**
 * Squishy-balloon model. The outer shell between the rigid core and the
 * visual radius is a pneumatic compliant contact: internal gauge pressure
 * times the growing sphere-plane contact patch, stiffening as the stroke is
 * used up, with the step solved implicitly (backward Euler on the contact
 * DOF). Unlike the hand-tuned one-way springs and force caps this replaces,
 * it is unconditionally stable at any mass ratio, conserves momentum
 * (equal-and-opposite application), and cannot trampoline.
 */
function BalloonSuspension({ design, refs }: { design: DesignV1; refs: BodyRefs }) {
  const balloons = useMemo(
    () => design.parts
      .filter((part) => part.materialId === "balloon")
      .map((part) => ({ id: part.id, radius: Math.max(...part.transform.dimensions) / 2 })),
    [design],
  );
  const targets = useMemo(() => [
    { id: "egg", ball: true, radius: Math.max(...design.eggTransform.dimensions) / 2, halfExtents: null as Vector3 | null },
    ...design.parts
      .filter((part) => part.materialId !== "balloon")
      .map((part) => {
        const [x, y, z] = part.transform.dimensions;
        return {
          id: part.id,
          ball: BALL_APPROX_MATERIALS.has(part.materialId),
          radius: Math.max(x, y, z) / 2,
          halfExtents: new Vector3(x / 2, y / 2, z / 2),
        };
      }),
  ], [design]);
  const weldedRoots = useMemo(() => calculateWeldedAssemblyRoots(design), [design]);

  useBeforePhysicsStep(() => {
    for (const balloon of balloons) {
      const body = refs[balloon.id]?.current;
      if (!body) continue;
      const radius = balloon.radius;
      const shellDepthM = radius * (1 - BALLOON_CORE_RATIO);
      const center = body.translation();
      const balloonVelocity = body.linvel();
      const balloonMass = body.mass();
      // A ground-backed balloon is a pinched gas column: the ground supplies
      // the reaction, so the column decelerates the payload against the
      // ground's infinite mass rather than against the balloon's few grams.
      const groundBacked = center.y < radius * 1.6;

      // Ground contact: the shell squashes against the floor. The floor is
      // immovable, so the pair's reduced mass is just the balloon's own.
      const groundPenetration = radius - center.y;
      if (groundPenetration > 0) {
        // Signed approach speed: the damper must also act while the shell
        // rebounds, or the stored gas-spring energy returns in full and the
        // balloon trampolines its payload.
        const groundForce = calculatePneumaticContactForceN({
          penetrationM: groundPenetration,
          shellDepthM,
          balloonRadiusM: radius,
          approachSpeedMps: -balloonVelocity.y,
          reducedMassKg: Math.max(1e-4, balloonMass),
          dtSeconds: DROP_FIXED_STEP_SECONDS,
        });
        // Load-proportional Coulomb friction plus a small viscous scrub. The
        // friction is clamped so it can only arrest the slip within the step,
        // never reverse it (which would jitter).
        const slipSpeed = Math.hypot(balloonVelocity.x, balloonVelocity.z);
        const stoppingForceN = (balloonMass * slipSpeed) / DROP_FIXED_STEP_SECONDS;
        const frictionN = Math.min(BALLOON_SHELL_FRICTION * Math.max(0, groundForce), stoppingForceN);
        const frictionScale = slipSpeed > 1e-6 ? frictionN / slipSpeed : 0;
        body.addForce({
          x: -balloonVelocity.x * (BALLOON_GROUND_DRAG + frictionScale),
          y: groundForce,
          z: -balloonVelocity.z * (BALLOON_GROUND_DRAG + frictionScale),
        }, true);
      }

      const centerVec = new Vector3(center.x, center.y, center.z);
      for (const target of targets) {
        // Welded pairs are one rigid body as far as the solver is concerned;
        // the weld carries the load, so a shell force here only fights it.
        if (weldedRoots.get(balloon.id) === weldedRoots.get(target.id)) continue;
        const other = refs[target.id]?.current;
        if (!other) continue;
        const position = other.translation();
        let closest: Vector3;
        if (target.ball || !target.halfExtents) {
          const toCenter = centerVec.clone().sub(new Vector3(position.x, position.y, position.z));
          const distance = toCenter.length();
          if (distance < 1e-6) continue;
          closest = new Vector3(position.x, position.y, position.z)
            .add(toCenter.multiplyScalar(Math.min(target.radius, distance) / distance));
        } else {
          const rotation = other.rotation();
          const quaternion = new Quaternion(rotation.x, rotation.y, rotation.z, rotation.w);
          const local = centerVec.clone()
            .sub(new Vector3(position.x, position.y, position.z))
            .applyQuaternion(quaternion.clone().invert())
            .clamp(target.halfExtents.clone().negate(), target.halfExtents);
          closest = local.applyQuaternion(quaternion).add(new Vector3(position.x, position.y, position.z));
        }
        const delta = centerVec.clone().sub(closest);
        const distance = delta.length();
        if (distance < 1e-6 || distance >= radius) continue;
        // Normal points from the target's surface toward the balloon centre;
        // the gas pushes the target away along -normal.
        const normal = delta.clone().divideScalar(distance);
        // Only support bodies pressing down from above. A glancing or lateral
        // shell contact against a free balloon mostly deflects around it (the
        // balloon rolls aside) rather than transmitting force; modelling only
        // the load-bearing direction keeps loose cushions under their payload
        // instead of squirting them out from under a tilting raft.
        if (normal.y > -.35) continue;
        const penetrationM = radius - distance;
        const targetVelocity = other.linvel();
        // Approach speed of the contact point (including the target's spin —
        // a tilting panel must see its pitch mode damped, or it see-saws).
        const angular = other.angvel();
        const armX = closest.x - position.x;
        const armY = closest.y - position.y;
        const armZ = closest.z - position.z;
        const pointVelocity = new Vector3(
          targetVelocity.x + angular.y * armZ - angular.z * armY,
          targetVelocity.y + angular.z * armX - angular.x * armZ,
          targetVelocity.z + angular.x * armY - angular.y * armX,
        );
        const approachSpeedMps =
          (pointVelocity.x - balloonVelocity.x) * normal.x
          + (pointVelocity.y - balloonVelocity.y) * normal.y
          + (pointVelocity.z - balloonVelocity.z) * normal.z;
        const targetMass = Math.max(1e-4, other.mass());
        const reducedMassKg = groundBacked
          ? targetMass
          : (targetMass * Math.max(1e-4, balloonMass)) / (targetMass + Math.max(1e-4, balloonMass));
        const force = calculatePneumaticContactForceN({
          penetrationM,
          shellDepthM,
          balloonRadiusM: radius,
          approachSpeedMps,
          reducedMassKg,
          dtSeconds: DROP_FIXED_STEP_SECONDS,
        });
        if (force <= 0) continue;
        // Coulomb friction on the shell: oppose the tangential slip of the
        // contact point, capped at mu*N and at the force that would arrest
        // the slip within one step (so it can never reverse it). This is what
        // keeps a loose cushion under a landing panel and damps see-sawing.
        const relX = pointVelocity.x - balloonVelocity.x;
        const relY = pointVelocity.y - balloonVelocity.y;
        const relZ = pointVelocity.z - balloonVelocity.z;
        const tangentX = relX - approachSpeedMps * normal.x;
        const tangentY = relY - approachSpeedMps * normal.y;
        const tangentZ = relZ - approachSpeedMps * normal.z;
        const slipSpeedMps = Math.hypot(tangentX, tangentY, tangentZ);
        let frictionX = 0;
        let frictionY = 0;
        let frictionZ = 0;
        if (slipSpeedMps > 1e-6) {
          const frictionN = Math.min(
            BALLOON_SHELL_FRICTION * force,
            (reducedMassKg * slipSpeedMps) / DROP_FIXED_STEP_SECONDS,
          );
          frictionX = (-tangentX / slipSpeedMps) * frictionN;
          frictionY = (-tangentY / slipSpeedMps) * frictionN;
          frictionZ = (-tangentZ / slipSpeedMps) * frictionN;
        }
        const push = {
          x: -normal.x * force + frictionX,
          y: -normal.y * force + frictionY,
          z: -normal.z * force + frictionZ,
        };
        // Ball-shaped bodies get the force through their centre: a surface
        // application point would torque their tiny rotational inertia.
        if (target.ball) other.addForce(push, true);
        else other.addForceAtPoint(push, { x: closest.x, y: closest.y, z: closest.z }, true);
        // Reaction on the balloon, capped in acceleration: the membrane
        // deflects locally long before the whole balloon is batted away at
        // F/m of its few grams. The steady load share still comes through
        // (it is well under the cap), so a pinched balloon is held down
        // under its payload instead of extruding out; only the landing
        // transient is absorbed by the membrane (and, when ground-backed,
        // supplied by the ground) rather than kicking the latex away.
        const reactionScale = Math.min(1, (balloonMass * BALLOON_MAX_REACTION_MPS2) / force);
        body.addForceAtPoint(
          {
            x: (normal.x * force - frictionX) * reactionScale,
            y: (normal.y * force - frictionY) * reactionScale,
            z: (normal.z * force - frictionZ) * reactionScale,
          },
          { x: closest.x, y: closest.y, z: closest.z },
          true,
        );
      }
    }
  });
  return null;
}

function PhysicsPart({ part, offset, bodyRef, gravityMps2, airDensityKgM3, wind, load }: { part: DesignPartV1; offset: number; bodyRef: RefObject<RapierRigidBody>; gravityMps2: number; airDensityKgM3: number; wind: WindField; load?: BagLoad }) {
  const definition = MATERIAL_BY_ID[part.materialId];
  const realMass = Math.max(.001, calculatePartMassKg(part.materialId, part.transform.dimensions));
  const mass = part.materialId === "balloon"
    ? calculateBalloonSimMassKg(part.transform.dimensions, airDensityKgM3)
    : realMass;
  const contactAreaM2 = Math.max(
    part.transform.dimensions[0] * part.transform.dimensions[1],
    part.transform.dimensions[0] * part.transform.dimensions[2],
    part.transform.dimensions[1] * part.transform.dimensions[2],
  );
  return (
    <RigidBody
      ref={bodyRef}
      colliders={false}
      position={[part.transform.position[0], part.transform.position[1] + offset, part.transform.position[2]]}
      quaternion={part.transform.rotation}
      friction={definition.physics.friction}
      restitution={definition.physics.restitution}
      linearDamping={atmosphericDamping(definition.physics.linearDamping, airDensityKgM3)}
      angularDamping={atmosphericDamping(definition.physics.angularDamping, airDensityKgM3)}
      ccd
      canSleep
      userData={{ bodyId: part.id, materialId: part.materialId, contactAreaM2 }}
    >
      <PartCollider part={part} mass={mass} />
      <AerodynamicForces bodyRef={bodyRef} materialId={part.materialId} dimensions={part.transform.dimensions} gravityMps2={gravityMps2} airDensityKgM3={airDensityKgM3} wind={wind} load={load} />
    </RigidBody>
  );
}

function EggAerodynamicForces({ bodyRef, dimensions, airDensityKgM3, wind }: { bodyRef: RefObject<RapierRigidBody>; dimensions: [number, number, number]; airDensityKgM3: number; wind: WindField }) {
  useBeforePhysicsStep(() => {
    const body = bodyRef.current;
    if (!body) return;
    body.resetForces(false);
    body.resetTorques(false);
    // Rolling resistance. The egg's rotational inertia is so tiny that
    // frictional micro-slips against a jittering surface ratchet up huge
    // spin, which then converts to linear speed and skates the egg away.
    const spin = body.angvel();
    const eggInertia = .4 * EGG_MASS_KG * (Math.max(...dimensions) / 2) ** 2;
    const rollResistance = eggInertia * 30;
    body.addTorque({ x: -spin.x * rollResistance, y: -spin.y * rollResistance, z: -spin.z * rollResistance }, true);
    const velocity = body.linvel();
    const center = body.translation();
    const area = Math.PI * dimensions[0] * dimensions[2] / 4;
    const drag = calculateDragForce({
      velocityMps: relativeAirVelocity(velocity, wind, center.y),
      dragCoefficient: .47,
      crossSectionAreaM2: area,
      airDensityKgM3,
    });
    body.addForce({ x: drag[0], y: drag[1], z: drag[2] }, true);
  });
  return null;
}

function FixedConnector({ joint, refs, design }: { joint: DesignJointV1; refs: BodyRefs; design: DesignV1 }) {
  const frames = useMemo(() => calculateFixedJointFrames(design, joint), [design, joint]);
  const fixedJoint = useFixedJoint(refs[joint.bodyA]!, refs[joint.bodyB]!, frames);
  useEffect(() => {
    // A taped pair acts as one rigid assembly. Letting the connected colliders
    // fight their fixed constraint creates artificial launch impulses.
    fixedJoint?.current?.setContactsEnabled(false);
  }, [fixedJoint]);
  return null;
}

// NOTE on multibody joints: reduced-coordinate (multibody) fixed joints were
// tried for taped/glued assemblies — they make assemblies exactly rigid by
// construction instead of holding them together with corrective impulses.
// Rapier's JS build panics ("RuntimeError: unreachable", then a poisoned
// world) when a multibody tree coexists with impulse joints and CCD in the
// same island, so welds stay impulse fixed joints; SolverTuning's extra
// per-body iterations and the segmented tethers keep them well-conditioned.

function RopeConnector({ joint, refs, design }: { joint: DesignJointV1; refs: BodyRefs; design: DesignV1 }) {
  const aTransform = transformForBody(design, joint.bodyA);
  const bTransform = transformForBody(design, joint.bodyB);
  const length = Math.max(.05, worldAnchor(aTransform, joint.anchorA).distanceTo(worldAnchor(bTransform, joint.anchorB)));
  useRopeJoint(refs[joint.bodyA]!, refs[joint.bodyB]!, [joint.anchorA, joint.anchorB, length]);
  return null;
}

function SpringConnector({ joint, refs, design }: { joint: DesignJointV1; refs: BodyRefs; design: DesignV1 }) {
  const aTransform = transformForBody(design, joint.bodyA);
  const bTransform = transformForBody(design, joint.bodyB);
  const length = Math.max(.04, worldAnchor(aTransform, joint.anchorA).distanceTo(worldAnchor(bTransform, joint.anchorB)));
  useSpringJoint(refs[joint.bodyA]!, refs[joint.bodyB]!, [joint.anchorA, joint.anchorB, length, 38, 3.8]);
  return null;
}

/** World-space distance between a joint's two anchors in the build pose. */
const jointSpanM = (design: DesignV1, joint: DesignJointV1) =>
  worldAnchor(transformForBody(design, joint.bodyA), joint.anchorA)
    .distanceTo(worldAnchor(transformForBody(design, joint.bodyB), joint.anchorB));

/** Collider approximation of any body (the egg included) in the build pose. */
const buildShapeForBody = (design: DesignV1, bodyId: string): BuildPoseShape => {
  if (bodyId === "egg") {
    return {
      kind: "sphere",
      center: new Vector3(...design.eggTransform.position),
      radius: Math.max(...design.eggTransform.dimensions) / 2,
    };
  }
  return buildPoseShape(design.parts.find((part) => part.id === bodyId)!);
};

/**
 * Approximate clearance between two build-pose shapes, metres (<= 0 when they
 * touch or overlap). Box-box uses the largest separation over the SAT
 * candidate axes, which lower-bounds the true gap — erring toward "closer",
 * the safe direction for keeping welds rigid.
 */
const shapeGapM = (a: BuildPoseShape, b: BuildPoseShape): number => {
  if (a.kind === "sphere" && b.kind === "sphere") {
    return a.center.distanceTo(b.center) - a.radius - b.radius;
  }
  if (a.kind === "sphere" || b.kind === "sphere") {
    const sphere = (a.kind === "sphere" ? a : b) as Extract<BuildPoseShape, { kind: "sphere" }>;
    const box = (a.kind === "box" ? a : b) as Extract<BuildPoseShape, { kind: "box" }>;
    return closestPointOnBox(sphere.center, box).distanceTo(sphere.center) - sphere.radius;
  }
  const boxA = a as Extract<BuildPoseShape, { kind: "box" }>;
  const boxB = b as Extract<BuildPoseShape, { kind: "box" }>;
  const delta = boxB.center.clone().sub(boxA.center);
  const candidateAxes: Vector3[] = [...boxA.axes, ...boxB.axes];
  for (const axisA of boxA.axes) {
    for (const axisB of boxB.axes) {
      const cross = axisA.clone().cross(axisB);
      if (cross.lengthSq() > 1e-8) candidateAxes.push(cross.normalize());
    }
  }
  let gap = Number.NEGATIVE_INFINITY;
  for (const axis of candidateAxes) {
    gap = Math.max(gap, Math.abs(delta.dot(axis)) - projectBoxOntoAxis(axis, boxA) - projectBoxOntoAxis(axis, boxB));
  }
  return gap;
};

/** Bodies must be at least this far apart before a connector is a tether. */
const CHAIN_MIN_BODY_GAP_M = .05;

/**
 * Long connectors between separated bodies become segmented chains instead of
 * one joint spanning the whole gap. A single metres-long constraint between
 * very light bodies is massless, dragless, cannot sag or swing, and is
 * exactly the ill-conditioned configuration that made balloon tethers
 * diverge; a chain of short capsule links joined by spherical joints is many
 * well-conditioned constraints with real mass. Long tape qualifies too: a
 * strip of tape spanning a gap is a flexible tether in reality, not a rigid
 * weld. Both the anchor span and the body gap must be large — tape between
 * touching parts is a weld no matter where the anchor clicks landed.
 */
export const isChainedJoint = (design: DesignV1, joint: DesignJointV1): boolean => {
  if (joint.kind !== "rope" && joint.kind !== "fixed") return false;
  if (jointSpanM(design, joint) < MIN_SEGMENTED_ROPE_LENGTH_M) return false;
  const gap = shapeGapM(buildShapeForBody(design, joint.bodyA), buildShapeForBody(design, joint.bodyB));
  return gap >= CHAIN_MIN_BODY_GAP_M;
};

const chainSegmentId = (jointId: string, index: number) => `${jointId}#chain${index}`;

type ChainPlans = Record<string, RopeSegmentLayout[]>;

const calculateChainPlans = (design: DesignV1, offset: number): ChainPlans => {
  const plans: ChainPlans = {};
  for (const joint of design.joints) {
    if (!isChainedJoint(design, joint)) continue;
    const start = worldAnchor(transformForBody(design, joint.bodyA), joint.anchorA);
    const end = worldAnchor(transformForBody(design, joint.bodyB), joint.anchorB);
    plans[joint.id] = planRopeChain(
      [start.x, start.y + offset, start.z],
      [end.x, end.y + offset, end.z],
      start.distanceTo(end),
    );
  }
  return plans;
};

/** Spherical link with pair contacts suppressed (links overlap at the pins). */
function ChainSphericalJoint({
  refA,
  refB,
  anchorA,
  anchorB,
}: {
  refA: RefObject<RapierRigidBody>;
  refB: RefObject<RapierRigidBody>;
  anchorA: [number, number, number];
  anchorB: [number, number, number];
}) {
  const link = useSphericalJoint(refA, refB, [anchorA, anchorB]);
  useEffect(() => {
    link?.current?.setContactsEnabled(false);
  }, [link]);
  return null;
}

function SegmentedChainConnector({ joint, plan, refs, airDensityKgM3 }: { joint: DesignJointV1; plan: RopeSegmentLayout[]; refs: BodyRefs; airDensityKgM3: number }) {
  const totalLengthM = plan.reduce((sum, segment) => sum + segment.lengthM, 0);
  // Real string/tape is a few grams per metre; floor keeps the solver happy.
  const segmentMassKg = Math.max(.002, totalLengthM * .004 / plan.length);
  return (
    <>
      {plan.map((segment, index) => {
        const id = chainSegmentId(joint.id, index);
        return (
          <RigidBody
            key={id}
            ref={refs[id]}
            colliders={false}
            position={segment.position}
            quaternion={segment.rotation}
            linearDamping={atmosphericDamping(.25, airDensityKgM3)}
            angularDamping={atmosphericDamping(.6, airDensityKgM3)}
            ccd
            canSleep
            userData={{ bodyId: id, materialId: joint.materialId, contactAreaM2: 0 }}
          >
            <CapsuleCollider
              args={[Math.max(.001, segment.lengthM / 2 - ROPE_SEGMENT_RADIUS_M), ROPE_SEGMENT_RADIUS_M]}
              mass={segmentMassKg}
              // Sensor: the chain is held by spherical joints; solid capsules
              // batting balloons or the egg inject impulses and the links
              // visually "break apart" into a spray of brown segments.
              sensor
            />
          </RigidBody>
        );
      })}
      <ChainSphericalJoint
        refA={refs[joint.bodyA]!}
        refB={refs[chainSegmentId(joint.id, 0)]!}
        anchorA={joint.anchorA}
        anchorB={[0, -plan[0]!.lengthM / 2, 0]}
      />
      {plan.slice(0, -1).map((segment, index) => (
        <ChainSphericalJoint
          key={`${joint.id}#link${index}`}
          refA={refs[chainSegmentId(joint.id, index)]!}
          refB={refs[chainSegmentId(joint.id, index + 1)]!}
          anchorA={[0, segment.lengthM / 2, 0]}
          anchorB={[0, -plan[index + 1]!.lengthM / 2, 0]}
        />
      ))}
      <ChainSphericalJoint
        refA={refs[chainSegmentId(joint.id, plan.length - 1)]!}
        refB={refs[joint.bodyB]!}
        anchorA={[0, plan[plan.length - 1]!.lengthM / 2, 0]}
        anchorB={joint.anchorB}
      />
    </>
  );
}

type BuildPoseShape =
  | { kind: "sphere"; center: Vector3; radius: number }
  | { kind: "box"; center: Vector3; axes: [Vector3, Vector3, Vector3]; halfExtents: Vector3 };

/**
 * Approximation of a part's rigid collider in its authored build pose, using
 * the same shape mapping as PartCollider (paper cups are treated as their
 * bounding box, which errs toward suppressing — the safe direction for a
 * shape that is fully inside the box).
 */
const buildPoseShape = (part: DesignPartV1): BuildPoseShape => {
  const [x, y, z] = part.transform.dimensions;
  const center = new Vector3(...part.transform.position);
  switch (part.materialId) {
    case "balloon":
      return { kind: "sphere", center, radius: Math.max(x, y, z) / 2 * BALLOON_CORE_RATIO };
    case "cottonBall":
    case "newspaper":
    case "packingPeanuts":
      return { kind: "sphere", center, radius: Math.max(x, y, z) / 2 };
    default: {
      const rotation = new Quaternion(...part.transform.rotation);
      return {
        kind: "box",
        center,
        axes: [
          new Vector3(1, 0, 0).applyQuaternion(rotation),
          new Vector3(0, 1, 0).applyQuaternion(rotation),
          new Vector3(0, 0, 1).applyQuaternion(rotation),
        ],
        halfExtents: new Vector3(x / 2, y / 2, z / 2),
      };
    }
  }
};

/**
 * Pairs must interpenetrate at least this deep in the build pose before their
 * contacts are suppressed. Parts merely butted against each other (table legs
 * against a shelf) stay just under it, keeping their load-bearing contacts.
 */
const SUPPRESSION_OVERLAP_M = .003;

const projectBoxOntoAxis = (axis: Vector3, box: Extract<BuildPoseShape, { kind: "box" }>) =>
  Math.abs(axis.dot(box.axes[0])) * box.halfExtents.x
  + Math.abs(axis.dot(box.axes[1])) * box.halfExtents.y
  + Math.abs(axis.dot(box.axes[2])) * box.halfExtents.z;

const closestPointOnBox = (point: Vector3, box: Extract<BuildPoseShape, { kind: "box" }>) => {
  const offset = point.clone().sub(box.center);
  const closest = box.center.clone();
  const extents = [box.halfExtents.x, box.halfExtents.y, box.halfExtents.z];
  for (let axisIndex = 0; axisIndex < 3; axisIndex += 1) {
    const along = Math.max(-extents[axisIndex]!, Math.min(extents[axisIndex]!, offset.dot(box.axes[axisIndex]!)));
    closest.add(box.axes[axisIndex]!.clone().multiplyScalar(along));
  }
  return closest;
};

/** True when the shapes overlap deeper than SUPPRESSION_OVERLAP_M in the build pose. */
export const shapesInterpenetrate = (a: BuildPoseShape, b: BuildPoseShape): boolean => {
  if (a.kind === "sphere" && b.kind === "sphere") {
    return a.center.distanceTo(b.center) < a.radius + b.radius - SUPPRESSION_OVERLAP_M;
  }
  if (a.kind === "sphere" || b.kind === "sphere") {
    const sphere = (a.kind === "sphere" ? a : b) as Extract<BuildPoseShape, { kind: "sphere" }>;
    const box = (a.kind === "box" ? a : b) as Extract<BuildPoseShape, { kind: "box" }>;
    return closestPointOnBox(sphere.center, box).distanceTo(sphere.center) < sphere.radius - SUPPRESSION_OVERLAP_M;
  }
  // OBB-OBB separating axis test requiring every axis overlap to exceed the
  // threshold, so the SAT minimum-penetration lower bound clears it too.
  const boxA = a as Extract<BuildPoseShape, { kind: "box" }>;
  const boxB = b as Extract<BuildPoseShape, { kind: "box" }>;
  const delta = boxB.center.clone().sub(boxA.center);
  const candidateAxes: Vector3[] = [...boxA.axes, ...boxB.axes];
  for (const axisA of boxA.axes) {
    for (const axisB of boxB.axes) {
      const cross = axisA.clone().cross(axisB);
      if (cross.lengthSq() > 1e-8) candidateAxes.push(cross.normalize());
    }
  }
  return candidateAxes.every((axis) =>
    projectBoxOntoAxis(axis, boxA) + projectBoxOntoAxis(axis, boxB) - Math.abs(delta.dot(axis)) > SUPPRESSION_OVERLAP_M);
};

/**
 * Bodies taped into one rigid assembly must not collide with each other where
 * they overlap. Straw cages overlap at their taped crossings, and while
 * contacts are already disabled between each directly-taped pair, the *other*
 * straws of the same assembly still push apart wherever they overlap. Those
 * contacts fight the fixed joints every solver step, so tape visibly
 * stretched and stayed stretched (~10 cm) after landing.
 *
 * The suppression is surgical, not blanket:
 * - The egg is never a member. Suppressing egg contacts let collapsing
 *   structures squeeze the egg straight through a cardboard panel. Joints
 *   through the egg still merge its neighbours into one assembly, and the
 *   egg's directly-taped partner is still handled inside FixedConnector.
 * - Only pairs that already interpenetrate in the build pose are suppressed.
 *   Butted parts (table legs against a shelf) keep their contacts, which
 *   brace the structure; without them assemblies sag through themselves,
 *   never settle, and crush whatever is inside.
 */
export const calculateAssemblyContactPairs = (design: DesignV1): [string, string][] => {
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    const ancestor = parent.get(id) ?? id;
    if (ancestor === id) return id;
    const root = find(ancestor);
    parent.set(id, root);
    return root;
  };
  const directlyJointed = new Set<string>();
  const pairKey = (a: string, b: string) => (a < b ? `${a}\0${b}` : `${b}\0${a}`);
  for (const joint of design.joints) {
    if (joint.kind !== "fixed") continue;
    // A long tape tether is simulated as a flexible chain, not a weld, so it
    // does not merge its endpoints into one rigid assembly.
    if (isChainedJoint(design, joint)) continue;
    directlyJointed.add(pairKey(joint.bodyA, joint.bodyB));
    parent.set(find(joint.bodyA), find(joint.bodyB));
  }
  const shapes = new Map(design.parts.map((part) => [part.id, buildPoseShape(part)]));
  const assemblies = new Map<string, string[]>();
  for (const part of design.parts) {
    const root = find(part.id);
    assemblies.set(root, [...(assemblies.get(root) ?? []), part.id]);
  }
  const pairs: [string, string][] = [];
  for (const members of assemblies.values()) {
    for (let i = 0; i < members.length; i += 1) {
      for (let j = i + 1; j < members.length; j += 1) {
        if (directlyJointed.has(pairKey(members[i]!, members[j]!))) continue;
        if (!shapesInterpenetrate(shapes.get(members[i]!)!, shapes.get(members[j]!)!)) continue;
        pairs.push([members[i]!, members[j]!]);
      }
    }
  }
  return pairs;
};

/** Overlapping balloon shells in the build pose: rigid cores fighting each
 * other every step is the main source of balloon-cluster jitter. */
export const calculateOverlappingBalloonPairs = (design: DesignV1): [string, string][] => {
  const balloons = design.parts.filter((part) => part.materialId === "balloon");
  const pairs: [string, string][] = [];
  for (let i = 0; i < balloons.length; i += 1) {
    for (let j = i + 1; j < balloons.length; j += 1) {
      const a = balloons[i]!;
      const b = balloons[j]!;
      const centerA = new Vector3(...a.transform.position);
      const centerB = new Vector3(...b.transform.position);
      const radiusA = Math.max(...a.transform.dimensions) / 2;
      const radiusB = Math.max(...b.transform.dimensions) / 2;
      const overlap = radiusA + radiusB - centerA.distanceTo(centerB);
      if (overlap > SUPPRESSION_OVERLAP_M) pairs.push([a.id, b.id]);
    }
  }
  return pairs;
};

/**
 * Hidden bracing welds for star-shaped weld hubs. Three or more fixed joints
 * meeting at one body (typically balloons taped straight to the egg) are the
 * worst case for the sequential impulse solver: every correction must funnel
 * through the hub, and when the hub has tiny rotational inertia (the egg's is
 * ~2e-5 kg·m²) each joint's fix swings the hub and violates its siblings, so
 * the star oscillates and pumps energy — 3+ taped balloons used to diverge to
 * the watchdog ceiling while the 2-balloon case stayed clean. The assembly is
 * rigid by definition, so adding consistent spoke-to-spoke welds (a ring per
 * hub) is kinematically a no-op; it just gives the solver direct paths that
 * bypass the hub. The egg itself never gets extra constraints, and braces are
 * dropped when a user joint on the hub breaks so debris separates honestly.
 */
export const calculateBracingJoints = (design: DesignV1, brokenJointIds?: ReadonlySet<string>): DesignJointV1[] => {
  const pairKey = (a: string, b: string) => (a < b ? `${a}\0${b}` : `${b}\0${a}`);
  const spokesByHub = new Map<string, string[]>();
  const weldedKeys = new Set<string>();
  for (const joint of design.joints) {
    if (joint.kind !== "fixed" || isChainedJoint(design, joint)) continue;
    if (brokenJointIds?.has(joint.id)) continue;
    weldedKeys.add(pairKey(joint.bodyA, joint.bodyB));
    spokesByHub.set(joint.bodyA, [...(spokesByHub.get(joint.bodyA) ?? []), joint.bodyB]);
    spokesByHub.set(joint.bodyB, [...(spokesByHub.get(joint.bodyB) ?? []), joint.bodyA]);
  }
  const braces: DesignJointV1[] = [];
  const seen = new Set<string>();
  for (const [hub, spokes] of spokesByHub) {
    if (spokes.length < 2) continue;
    for (let index = 0; index < spokes.length; index += 1) {
      const bodyA = spokes[index]!;
      const bodyB = spokes[(index + 1) % spokes.length]!;
      if (bodyA === bodyB || bodyA === "egg" || bodyB === "egg") continue;
      const key = pairKey(bodyA, bodyB);
      if (weldedKeys.has(key) || seen.has(key)) continue;
      seen.add(key);
      const transformA = transformForBody(design, bodyA);
      const transformB = transformForBody(design, bodyB);
      const worldMid = new Vector3(...transformA.position).add(new Vector3(...transformB.position)).multiplyScalar(.5);
      braces.push({
        id: `brace:${hub}:${bodyA}:${bodyB}`,
        kind: "fixed",
        materialId: "tape",
        bodyA,
        bodyB,
        anchorA: localAnchorAtWorldPoint(transformA, worldMid.clone()),
        anchorB: localAnchorAtWorldPoint(transformB, worldMid.clone()),
      });
    }
  }
  return braces;
};

/**
 * Rapier only exposes pair-wise contact disabling through joints, so each
 * suppressed pair gets a rope joint far longer than the scene ever gets —
 * it never pulls taut and exists purely to carry `contactsEnabled = false`.
 */
function AssemblyContactSuppressor({ bodyA, bodyB, refs }: { bodyA: string; bodyB: string; refs: BodyRefs }) {
  const noopJoint = useRopeJoint(refs[bodyA]!, refs[bodyB]!, [[0, 0, 0], [0, 0, 0], 1000]);
  useEffect(() => {
    noopJoint?.current?.setContactsEnabled(false);
  }, [noopJoint]);
  return null;
}

function PhysicsConnectors({ design, refs, chainPlans, brokenJointIds, airDensityKgM3 }: { design: DesignV1; refs: BodyRefs; chainPlans: ChainPlans; brokenJointIds: ReadonlySet<string>; airDensityKgM3: number }) {
  const assemblyContactPairs = useMemo(() => calculateAssemblyContactPairs(design), [design]);
  const overlappingBalloonPairs = useMemo(() => calculateOverlappingBalloonPairs(design), [design]);
  const bracingJoints = useMemo(() => calculateBracingJoints(design, brokenJointIds), [design, brokenJointIds]);
  const suppressedPairs = useMemo(() => {
    const seen = new Set<string>();
    const merged: [string, string][] = [];
    for (const [bodyA, bodyB] of [...assemblyContactPairs, ...overlappingBalloonPairs]) {
      const key = bodyA < bodyB ? `${bodyA}\0${bodyB}` : `${bodyB}\0${bodyA}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push([bodyA, bodyB]);
    }
    return merged;
  }, [assemblyContactPairs, overlappingBalloonPairs]);
  return (
    <>
      {design.joints.map((joint) => {
        if (!refs[joint.bodyA] || !refs[joint.bodyB]) return null;
        if (brokenJointIds.has(joint.id)) return null;
        if (chainPlans[joint.id]) return <SegmentedChainConnector key={joint.id} joint={joint} plan={chainPlans[joint.id]!} refs={refs} airDensityKgM3={airDensityKgM3} />;
        if (joint.kind === "fixed") return <FixedConnector key={joint.id} joint={joint} refs={refs} design={design} />;
        if (joint.kind === "rope") return <RopeConnector key={joint.id} joint={joint} refs={refs} design={design} />;
        return <SpringConnector key={joint.id} joint={joint} refs={refs} design={design} />;
      })}
      {bracingJoints.map((joint) => (
        refs[joint.bodyA] && refs[joint.bodyB]
          ? <FixedConnector key={joint.id} joint={joint} refs={refs} design={design} />
          : null
      ))}
      {suppressedPairs.map(([bodyA, bodyB]) => (
        refs[bodyA] && refs[bodyB]
          ? <AssemblyContactSuppressor key={`suppress:${bodyA}:${bodyB}`} bodyA={bodyA} bodyB={bodyB} refs={refs} />
          : null
      ))}
    </>
  );
}

/**
 * Breakable connectors. Rapier does not expose per-joint constraint forces,
 * so the transmitted load is estimated from what the joint demonstrably does:
 * both sides of a rigid connection undergo the same non-gravitational
 * acceleration, and the joint must supply the lighter side's share of that
 * force. The estimate is low-pass filtered (same constant as egg damage) so
 * single-step solver noise cannot snap anything, and compared against the
 * connector material's breakForceN from the catalog.
 */
function JointBreakMonitor({
  design,
  refs,
  chainPlans,
  brokenJointIds,
  gravityMps2,
  onBreak,
}: {
  design: DesignV1;
  refs: BodyRefs;
  chainPlans: ChainPlans;
  brokenJointIds: ReadonlySet<string>;
  gravityMps2: number;
  onBreak: (jointId: string) => void;
}) {
  const elapsed = useRef(0);
  const previousVelocities = useRef<Record<string, Vector3>>({});
  const filteredLoadN = useRef<Record<string, number>>({});
  useBeforePhysicsStep(() => {
    elapsed.current += DROP_FIXED_STEP_SECONDS;
    const accelerations: Record<string, number> = {};
    for (const [bodyId, ref] of Object.entries(refs)) {
      const body = ref.current;
      if (!body) continue;
      const velocity = body.linvel();
      const previous = previousVelocities.current[bodyId];
      if (previous) {
        accelerations[bodyId] = Math.hypot(
          velocity.x - previous.x,
          velocity.y - previous.y - (-gravityMps2 * DROP_FIXED_STEP_SECONDS),
          velocity.z - previous.z,
        ) / DROP_FIXED_STEP_SECONDS;
        previous.set(velocity.x, velocity.y, velocity.z);
      } else {
        previousVelocities.current[bodyId] = new Vector3(velocity.x, velocity.y, velocity.z);
      }
    }
    if (elapsed.current < DROP_DAMAGE_ARM_SECONDS) return;
    const retain = Math.pow(.35, STEP_RATE_SCALE);
    for (const joint of design.joints) {
      if (brokenJointIds.has(joint.id) || chainPlans[joint.id]) continue;
      const bodyA = refs[joint.bodyA]?.current;
      const bodyB = refs[joint.bodyB]?.current;
      if (!bodyA || !bodyB) continue;
      const loadA = (typeof bodyA.mass === "function" ? bodyA.mass() : 0) * (accelerations[joint.bodyA] ?? 0);
      const loadB = (typeof bodyB.mass === "function" ? bodyB.mass() : 0) * (accelerations[joint.bodyB] ?? 0);
      const load = Math.min(loadA, loadB);
      const filtered = (filteredLoadN.current[joint.id] ?? 0) * retain + load * (1 - retain);
      filteredLoadN.current[joint.id] = filtered;
      const breakForceN = MATERIAL_BY_ID[joint.materialId]?.physics.breakForceN ?? Number.POSITIVE_INFINITY;
      if (filtered > breakForceN) onBreak(joint.id);
    }
  });
  return null;
}

const createPoseFrame = (
  position: readonly [number, number, number],
  rotation: readonly [number, number, number, number],
): DropPoseFrame => {
  const current = createDropRenderPose(position, rotation);
  return {
    previous: createDropRenderPose(position, rotation),
    current,
    displayed: createDropRenderPose(position, rotation),
  };
};

const createDropPoseFrames = (design: DesignV1, offset: number, chainPlans: ChainPlans): DropPoseFrames => Object.fromEntries([
  [
    "egg",
    createPoseFrame(
      [design.eggTransform.position[0], design.eggTransform.position[1] + offset, design.eggTransform.position[2]],
      design.eggTransform.rotation,
    ),
  ],
  ...design.parts.map((part) => [
    part.id,
    createPoseFrame(
      [part.transform.position[0], part.transform.position[1] + offset, part.transform.position[2]],
      part.transform.rotation,
    ),
  ]),
  ...Object.entries(chainPlans).flatMap(([jointId, plan]) => plan.map((segment, index) => [
    chainSegmentId(jointId, index),
    createPoseFrame(segment.position, segment.rotation),
  ])),
]);

const PRESENTATION_PRIORITY = -50;
const CAMERA_PRIORITY = -40;

export const calculateDropZoomLimits = (framingDistance: number) => {
  const safeFramingDistance = Number.isFinite(framingDistance) ? Math.max(.1, framingDistance) : .78;
  const initialDistance = Math.hypot(
    safeFramingDistance * .48,
    Math.max(.2, safeFramingDistance * .2),
    safeFramingDistance * .88,
  );
  return {
    minDistance: Math.max(.25, initialDistance * .42),
    maxDistance: Math.max(6.4, initialDistance * 6),
  };
};

function InterpolatedBodyVisual({
  pose,
  children,
  scale,
}: {
  pose: DropPoseFrame;
  children: React.ReactNode;
  scale?: [number, number, number];
}) {
  const groupRef = useRef<Group>(null);
  useFrame(() => {
    const group = groupRef.current;
    if (!group?.position?.copy || !group.quaternion?.copy) return;
    group.position.copy(pose.displayed.position);
    group.quaternion.copy(pose.displayed.rotation);
  }, PRESENTATION_PRIORITY);

  return (
    <group
      ref={groupRef}
      position={[pose.displayed.position.x, pose.displayed.position.y, pose.displayed.position.z]}
      quaternion={[pose.displayed.rotation.x, pose.displayed.rotation.y, pose.displayed.rotation.z, pose.displayed.rotation.w]}
      scale={scale}
    >
      {children}
    </group>
  );
}

function InterpolatedDropVisuals({
  design,
  poses,
  cracked,
  bagLoads,
  chainPlans,
}: {
  design: DesignV1;
  poses: DropPoseFrames;
  cracked: boolean;
  bagLoads: Record<string, BagLoadEntry[]>;
  chainPlans: ChainPlans;
}) {
  const jointById = useMemo(() => new Map(design.joints.map((joint) => [joint.id, joint])), [design]);
  return (
    <>
      <InterpolatedBodyVisual pose={poses.egg!}>
        <EggVisual transform={design.eggTransform} cracked={cracked} />
      </InterpolatedBodyVisual>
      {Object.entries(chainPlans).flatMap(([jointId, plan]) => {
        const materialId = jointById.get(jointId)?.materialId;
        const color = materialId === "tape" ? "#f2c94c" : materialId === "string" ? "#70513a" : "#df5d4e";
        return plan.map((segment, index) => {
          const id = chainSegmentId(jointId, index);
          const pose = poses[id];
          if (!pose) return null;
          return (
            <InterpolatedBodyVisual key={id} pose={pose}>
              <mesh castShadow>
                <capsuleGeometry args={[ROPE_SEGMENT_RADIUS_M, Math.max(.01, segment.lengthM - ROPE_SEGMENT_RADIUS_M * 2), 3, 8]} />
                <meshStandardMaterial color={color} roughness={.85} />
              </mesh>
            </InterpolatedBodyVisual>
          );
        });
      })}
      {design.parts.map((part) => (
        part.materialId === "plasticBag"
          // The bag gets a dedicated drop visual (unscaled group, geometry in
          // world units) that billows into a canopy while descending.
          ? (
            <InterpolatedBodyVisual key={part.id} pose={poses[part.id]!}>
              <PlasticBagCanopyVisual
                pose={poses[part.id]!}
                dimensions={part.transform.dimensions}
                stepSeconds={DROP_FIXED_STEP_SECONDS}
                loadPoses={bagLoads[part.id]?.flatMap(({ bodyId, massKg }) => (
                  poses[bodyId] ? [{ pose: poses[bodyId]!, massKg }] : []
                ))}
              />
            </InterpolatedBodyVisual>
          )
          : (
            <InterpolatedBodyVisual key={part.id} pose={poses[part.id]!} scale={part.transform.dimensions}>
              <PartVisual materialId={part.materialId} />
            </InterpolatedBodyVisual>
          )
      ))}
    </>
  );
}

function DropJointLines({ design, poses, chainPlans, brokenJointIds }: { design: DesignV1; poses: DropPoseFrames; chainPlans: ChainPlans; brokenJointIds: ReadonlySet<string> }) {
  const geometries = useRef<Record<string, BufferGeometry<any> | null>>({});
  // Chained joints render their own segment capsules, and broken joints no
  // longer connect anything.
  const drawn = design.joints.filter((joint) => !chainPlans[joint.id] && !brokenJointIds.has(joint.id));
  useFrame(() => {
    for (const joint of drawn) {
      const geometry = geometries.current[joint.id];
      const bodyA = poses[joint.bodyA]?.displayed;
      const bodyB = poses[joint.bodyB]?.displayed;
      if (!geometry || !bodyA || !bodyB) continue;
      const a = new Vector3(...joint.anchorA)
        .applyQuaternion(bodyA.rotation)
        .add(bodyA.position);
      const b = new Vector3(...joint.anchorB)
        .applyQuaternion(bodyB.rotation)
        .add(bodyB.position);
      geometry.setFromPoints([a, b]);
      geometry.computeBoundingSphere();
    }
  }, PRESENTATION_PRIORITY);
  return (
    <>{drawn.map((joint) => (
      <line key={joint.id}>
        <bufferGeometry ref={(node) => { geometries.current[joint.id] = node; }} />
        <lineBasicMaterial color={joint.materialId === "tape" ? "#f2c94c" : joint.materialId === "string" ? "#70513a" : "#df5d4e"} linewidth={joint.materialId === "tape" ? 4 : 2} />
      </line>
    ))}</>
  );
}

function CameraFollow({
  eggPose,
  startPosition,
  framingDistance,
  controlsRef,
}: {
  eggPose: DropPoseFrame;
  startPosition: [number, number, number];
  framingDistance: number;
  controlsRef: RefObject<DropOrbitControls | null>;
}) {
  const [startX, startY, startZ] = startPosition;
  const offsetX = framingDistance * .48;
  const offsetZ = framingDistance * .88;
  const offsetY = Math.max(.2, framingDistance * .2);
  const initialTargetY = Math.max(.08, startY + .04);
  const initialCameraPosition = useMemo<[number, number, number]>(() => [
    startX + offsetX,
    initialTargetY + offsetY,
    startZ + offsetZ,
  ], [initialTargetY, offsetX, offsetY, offsetZ, startX, startZ]);
  const followedTarget = useRef(new Vector3(startX, initialTargetY, startZ));
  useFrame(({ camera }, delta) => {
    const egg = eggPose.displayed.position;
    const targetY = Math.max(.08, egg.y + .04);
    const factor = 1 - Math.exp(-delta * 4.5);
    const target = followedTarget.current;
    const moveX = (egg.x - target.x) * factor;
    const moveY = (targetY - target.y) * factor;
    const moveZ = (egg.z - target.z) * factor;

    // Translate the camera and its focus by the same amount. OrbitControls is
    // therefore free to change only their distance (pinch/wheel zoom), and
    // the follow loop will not pull that user-selected zoom back to default.
    target.set(target.x + moveX, target.y + moveY, target.z + moveZ);
    camera.position.x += moveX;
    camera.position.y += moveY;
    camera.position.z += moveZ;
    const controls = controlsRef.current;
    if (controls) {
      controls.target.copy(target);
      controls.update();
    } else {
      camera.lookAt(target);
    }
  }, CAMERA_PRIORITY);
  return <PerspectiveCamera makeDefault fov={40} near={.01} far={100} position={initialCameraPosition} />;
}

function DropCameraRig({
  eggPose,
  startPosition,
  framingDistance,
}: {
  eggPose: DropPoseFrame;
  startPosition: [number, number, number];
  framingDistance: number;
}) {
  const controlsRef = useRef<DropOrbitControls>(null);
  const zoomLimits = calculateDropZoomLimits(framingDistance);
  return (
    <>
      <CameraFollow
        eggPose={eggPose}
        startPosition={startPosition}
        framingDistance={framingDistance}
        controlsRef={controlsRef}
      />
      <OrbitControls
        ref={controlsRef}
        makeDefault
        enableZoom
        enableRotate={false}
        enablePan={false}
        enableDamping={false}
        zoomToCursor={false}
        touches={{ ONE: TOUCH.ROTATE, TWO: TOUCH.DOLLY_PAN }}
        minDistance={zoomLimits.minDistance}
        maxDistance={zoomLimits.maxDistance}
        zoomSpeed={.8}
      />
    </>
  );
}

function PlaybackStepper({
  running,
  playbackRate,
  refs,
  poses,
}: {
  running: boolean;
  playbackRate: number;
  refs: BodyRefs;
  poses: DropPoseFrames;
}) {
  const { step } = useRapier();
  const realElapsed = useRef(0);
  const simulationAccumulator = useRef(0);
  useFrame((_, delta) => {
    if (!running) {
      for (const pose of Object.values(poses)) copyDropRenderPose(pose.displayed, pose.current);
      return;
    }
    const simulationDelta = calculatePlaybackSimulationDelta(realElapsed.current, delta, playbackRate);
    realElapsed.current += delta;
    simulationAccumulator.current += simulationDelta;
    while (simulationAccumulator.current + FIXED_STEP_EPSILON >= DROP_FIXED_STEP_SECONDS) {
      for (const pose of Object.values(poses)) copyDropRenderPose(pose.previous, pose.current);
      step(DROP_FIXED_STEP_SECONDS);
      for (const [bodyId, bodyRef] of Object.entries(refs)) {
        const body = bodyRef.current;
        const pose = poses[bodyId];
        if (!body || !pose) continue;
        const position = body.translation();
        const rotation = body.rotation();
        pose.current.position.set(position.x, position.y, position.z);
        pose.current.rotation.set(rotation.x, rotation.y, rotation.z, rotation.w).normalize();
      }
      simulationAccumulator.current = Math.max(0, simulationAccumulator.current - DROP_FIXED_STEP_SECONDS);
    }
    const alpha = calculateDropInterpolationAlpha(simulationAccumulator.current, DROP_FIXED_STEP_SECONDS);
    for (const pose of Object.values(poses)) {
      interpolateDropRenderPose(pose.displayed, pose.previous, pose.current, alpha);
    }
  }, -100);
  return null;
}

/** Advances the shared wind field once per physics step. */
function WindStepper({ wind }: { wind: WindField }) {
  useBeforePhysicsStep(() => {
    wind.step(DROP_FIXED_STEP_SECONDS);
  });
  return null;
}

/**
 * Targeted solver settings, applied once after the bodies exist. Bodies that
 * participate in joints (or are balloons, whose contacts span huge mass
 * ratios) get extra solver iterations so their constraints converge, and
 * every collider gets a soft-CCD prediction margin so fast bodies generate
 * speculative contacts before tunnelling instead of after.
 */
function SolverTuning({ design, refs }: { design: DesignV1; refs: BodyRefs }) {
  useEffect(() => {
    const jointed = new Set(design.joints.flatMap((joint) => [joint.bodyA, joint.bodyB]));
    const balloons = new Set(design.parts.filter((part) => part.materialId === "balloon").map((part) => part.id));
    for (const [bodyId, ref] of Object.entries(refs)) {
      const body = ref.current;
      if (!body) continue;
      const needsIterations = jointed.has(bodyId) || balloons.has(bodyId) || bodyId.includes("#chain");
      if (needsIterations && typeof body.setAdditionalSolverIterations === "function") {
        body.setAdditionalSolverIterations(4);
      }
      if (typeof body.setSoftCcdPrediction === "function") body.setSoftCcdPrediction(.25);
    }
  }, [design, refs]);
  return null;
}

function DropWorld({ design, runId, running, playbackRate, gravityMps2, airDensityKgM3, onComplete }: DropSceneProps) {
  const offset = useMemo(() => dropOffset(design), [design]);
  const framingDistance = useMemo(() => calculateDropCameraDistance(design), [design]);
  // Seeded per run: a given drop replays identically, reruns see new weather.
  const wind = useMemo(() => createWindField((0x9e3779b9 ^ runId) >>> 0), [runId]);
  const chainPlans = useMemo(() => calculateChainPlans(design, offset), [design, offset]);
  const [brokenJointIds, setBrokenJointIds] = useState<ReadonlySet<string>>(new Set<string>());
  const refs = useMemo<BodyRefs>(() => Object.fromEntries([
    "egg",
    ...design.parts.map((part) => part.id),
    ...Object.entries(chainPlans).flatMap(([jointId, plan]) => plan.map((_, index) => chainSegmentId(jointId, index))),
  ].map((id) => [id, createRef<RapierRigidBody>() as RefObject<RapierRigidBody>])), [design, chainPlans]);
  // For each plastic bag, every body joined to it (directly or through other
  // parts) with its mass, so the canopy model can tell a slung-below payload
  // from one riding on top of the sheet.
  const bagLoads = useMemo(() => {
    const adjacency = new Map<string, string[]>();
    for (const joint of design.joints) {
      if (!adjacency.has(joint.bodyA)) adjacency.set(joint.bodyA, []);
      if (!adjacency.has(joint.bodyB)) adjacency.set(joint.bodyB, []);
      adjacency.get(joint.bodyA)!.push(joint.bodyB);
      adjacency.get(joint.bodyB)!.push(joint.bodyA);
    }
    const partById = new Map(design.parts.map((part) => [part.id, part]));
    const loads: Record<string, BagLoadEntry[]> = {};
    for (const part of design.parts) {
      if (part.materialId !== "plasticBag") continue;
      const visited = new Set([part.id]);
      const queue = [part.id];
      const entries: BagLoadEntry[] = [];
      while (queue.length > 0) {
        const current = queue.shift()!;
        for (const next of adjacency.get(current) ?? []) {
          if (visited.has(next)) continue;
          visited.add(next);
          queue.push(next);
          const massKg = next === "egg"
            ? EGG_MASS_KG
            : (() => {
              const other = partById.get(next);
              return other ? calculatePartMassKg(other.materialId, other.transform.dimensions) : 0;
            })();
          if (massKg > 0) entries.push({ bodyId: next, massKg });
        }
      }
      if (entries.length > 0) loads[part.id] = entries;
    }
    return loads;
  }, [design]);
  const poses = useMemo(() => createDropPoseFrames(design, offset, chainPlans), [design, offset, chainPlans]);
  const [cracked, setCracked] = useState(false);
  const monitorHandlers = useRef<{
    collision?: (payload: CollisionEnterPayload) => void;
    contact?: (payload: ContactForcePayload) => void;
  }>({});

  return (
    <>
      <DropCameraRig
        eggPose={poses.egg!}
        startPosition={[design.eggTransform.position[0], offset + design.eggTransform.position[1], design.eggTransform.position[2]]}
        framingDistance={framingDistance}
      />
      <color attach="background" args={["#b8e0ef"]} />
      <fog attach="fog" args={["#d8edf2", 8, Math.max(28, offset + 6)]} />
      <ambientLight intensity={1.1} />
      <hemisphereLight args={["#ecfbff", "#6a795b", 1.35]} />
      <directionalLight position={[4, 12, 5]} intensity={2.25} castShadow shadow-mapSize={[1024, 1024]} />
      <LabEnvironment />
      <LandingGround radiusM={1.8} yM={0.006} />
      <DropTower heightM={Math.max(16, offset + 2)} maxHeightFt={MAX_DROP_HEIGHT_FT} />
      {/*
        Contraptions routinely stack a heavy panel (~1.6 kg cardboard) on
        near-massless parts (~5 g balloons). Rapier's default 4 solver
        iterations cannot converge on those ~300:1 mass-ratio contacts, which
        made light parts sink through the ground, jitter forever (so landings
        never counted), and spike phantom crush forces that cracked the egg.
        More iterations plus a length unit matched to centimetre-scale parts
        keeps these stacks stable.
      */}
      <Physics
        gravity={[0, -gravityMps2, 0]}
        timeStep={DROP_FIXED_STEP_SECONDS}
        numSolverIterations={16}
        numInternalPgsIterations={4}
        lengthUnit={0.1}
        paused
      >
        <WindStepper wind={wind} />
        <PlaybackStepper running={running} playbackRate={playbackRate} refs={refs} poses={poses} />
        <RigidBody type="fixed" colliders={false} userData={{ bodyId: "ground", materialId: "ground", contactAreaM2: 0 }}>
          <CuboidCollider args={[6, .05, 6]} position={[0, -.05, 0]} friction={.88} restitution={.05} />
          <mesh receiveShadow position={[0, -.055, 0]}><boxGeometry args={[12, .1, 12]} /><meshStandardMaterial color="#75966b" roughness={1} /></mesh>
        </RigidBody>
        <RigidBody
          ref={refs.egg!}
          colliders={false}
          position={[design.eggTransform.position[0], design.eggTransform.position[1] + offset, design.eggTransform.position[2]]}
          quaternion={design.eggTransform.rotation}
          linearDamping={atmosphericDamping(.04, airDensityKgM3)}
          angularDamping={atmosphericDamping(.08, airDensityKgM3)}
          ccd
          userData={{ bodyId: "egg", materialId: "egg" }}
        >
          <CapsuleCollider
            args={[.008, .024]}
            mass={EGG_MASS_KG}
            friction={.42}
            restitution={.16}
            onCollisionEnter={(payload) => monitorHandlers.current.collision?.(payload)}
            onContactForce={(payload) => monitorHandlers.current.contact?.(payload)}
          />
          <EggAerodynamicForces bodyRef={refs.egg!} dimensions={design.eggTransform.dimensions} airDensityKgM3={airDensityKgM3} wind={wind} />
        </RigidBody>
        {design.parts.map((part) => <PhysicsPart key={part.id} part={part} offset={offset} bodyRef={refs[part.id]!} gravityMps2={gravityMps2} airDensityKgM3={airDensityKgM3} wind={wind} load={bagLoads[part.id] ? { entries: bagLoads[part.id]!, refs } : undefined} />)}
        <PhysicsConnectors design={design} refs={refs} chainPlans={chainPlans} brokenJointIds={brokenJointIds} airDensityKgM3={airDensityKgM3} />
        <JointBreakMonitor design={design} refs={refs} chainPlans={chainPlans} brokenJointIds={brokenJointIds} gravityMps2={gravityMps2} onBreak={(jointId) => setBrokenJointIds((previous) => previous.has(jointId) ? previous : new Set(previous).add(jointId))} />
        <BalloonSuspension design={design} refs={refs} />
        <SolverTuning design={design} refs={refs} />
        <InterpolatedDropVisuals design={design} poses={poses} cracked={cracked} bagLoads={bagLoads} chainPlans={chainPlans} />
        <DropJointLines design={design} poses={poses} chainPlans={chainPlans} brokenJointIds={brokenJointIds} />
        <MonitorBridge design={design} refs={refs} eggRef={refs.egg!} running={running} playbackRate={playbackRate} gravityMps2={gravityMps2} onComplete={onComplete} setCracked={setCracked} handlers={monitorHandlers} />
      </Physics>
      <ContactShadows position={[0, .01, 0]} opacity={.38} scale={5} blur={2.4} far={4} resolution={256} />
    </>
  );
}

type MonitorHandlers = React.MutableRefObject<{
  collision?: (payload: CollisionEnterPayload) => void;
  contact?: (payload: ContactForcePayload) => void;
}>;

type MonitorBridgeProps = {
  design: DesignV1;
  refs: BodyRefs;
  eggRef: RefObject<RapierRigidBody>;
  running: boolean;
  playbackRate: number;
  gravityMps2: number;
  onComplete: (result: DropResult) => void;
  setCracked: (value: boolean) => void;
  handlers: MonitorHandlers;
};

function MonitorBridge({ handlers, design, refs, eggRef, running, playbackRate, gravityMps2, onComplete, setCracked }: MonitorBridgeProps) {
  const elapsed = useRef(0);
  const realElapsed = useRef(0);
  const settleTime = useRef(0);
  const completed = useRef(false);
  const pendingOutcome = useRef<DropOutcome | null>(null);
  const outcomeRevealTime = useRef(0);
  const outcomeRevealStarted = useRef(false);
  const impactSpeed = useRef(0);
  const touchdownSpeed = useRef(0);
  const wasNearGround = useRef(false);
  const peakG = useRef(0);
  const peakForce = useRef(0);
  const damage = useRef(0);
  const physicsElapsed = useRef(0);
  const preStepVelocity = useRef(new Vector3());
  const previousStepVelocity = useRef<Vector3 | null>(null);
  const filteredAccelerationG = useRef(0);
  const recentRelativeSpeeds = useRef<Record<string, number>>({});
  const recentContactShellG = useRef<number[]>([]);
  const crackPending = useRef(false);
  const runawayStrikes = useRef(0);
  const watchdogTripped = useRef(false);
  const maxWallSeconds = calculateDropMaxWallSeconds(playbackRate);
  // The drop height refers to the contraption's lowest point, so the topmost
  // body of a tall build starts higher and can legitimately fall faster; the
  // plausibility bound must cover it too.
  const maxPlausibleSpeed = useMemo(() => {
    let lowest = design.eggTransform.position[1] - Math.max(...design.eggTransform.dimensions) / 2;
    let highest = design.eggTransform.position[1] + Math.max(...design.eggTransform.dimensions) / 2;
    for (const part of design.parts) {
      const half = Math.max(...part.transform.dimensions) / 2;
      lowest = Math.min(lowest, part.transform.position[1] - half);
      highest = Math.max(highest, part.transform.position[1] + half);
    }
    const spanFt = Math.max(0, highest - lowest) / feetToMeters(1);
    return maxPlausibleSpeedMps(design.heightFt + spanFt, gravityMps2);
  }, [design, gravityMps2]);
  const bodyHalfExtents = useMemo(() => Object.fromEntries([
    ["egg", Math.max(...design.eggTransform.dimensions) / 2],
    ...design.parts.map((part) => [part.id, Math.max(...part.transform.dimensions) / 2]),
  ]) as Record<string, number>, [design]);
  const contactProperties = (payload: CollisionEnterPayload | ContactForcePayload) => {
    const userData = payload.other.rigidBodyObject?.userData as { materialId?: MaterialId | "ground"; contactAreaM2?: number } | undefined;
    const materialId = userData?.materialId ?? "ground";
    const cushioning = materialId === "ground" ? 0 : MATERIAL_BY_ID[materialId]?.physics.cushioning ?? 0;
    const contactArea = materialId === "ground" ? 0 : Math.max(0, userData?.contactAreaM2 ?? 0);
    const areaRelief = Math.min(.25, Math.sqrt(contactArea / .01) * .12);
    return { cushioning, areaRelief };
  };

  const addDamage = (amount: number) => {
    damage.current = Math.min(1, damage.current + Math.max(0, amount));
    if (damage.current >= 1) {
      crackPending.current = true;
      setCracked(true);
    }
  };

  const nearbyProtection = () => {
    const eggBody = eggRef.current;
    if (!eggBody) return { cushioning: 0, areaRelief: 0 };
    const eggPosition = eggBody.translation();
    const eggRadius = bodyHalfExtents.egg ?? .032;
    let nearest: { gap: number; materialId: MaterialId; contactAreaM2: number } | null = null;
    for (const part of design.parts) {
      const body = refs[part.id]?.current;
      if (!body) continue;
      const position = body.translation();
      const gap = Math.hypot(position.x - eggPosition.x, position.y - eggPosition.y, position.z - eggPosition.z)
        - eggRadius - (bodyHalfExtents[part.id] ?? 0);
      if (gap <= .06 && (!nearest || gap < nearest.gap)) {
        nearest = {
          gap,
          materialId: part.materialId,
          contactAreaM2: Math.max(
            part.transform.dimensions[0] * part.transform.dimensions[1],
            part.transform.dimensions[0] * part.transform.dimensions[2],
            part.transform.dimensions[1] * part.transform.dimensions[2],
          ),
        };
      }
    }
    if (!nearest) return { cushioning: 0, areaRelief: 0 };
    return {
      cushioning: MATERIAL_BY_ID[nearest.materialId].physics.cushioning,
      areaRelief: Math.min(.25, Math.sqrt(nearest.contactAreaM2 / .01) * .12),
    };
  };

  const finish = (outcome: DropOutcome) => {
    if (completed.current) return;
    completed.current = true;
    // An egg that rides a contraption down may never touch anything itself,
    // so no collision ever records an impact speed. Fall back to the egg's
    // speed at the moment the assembly first reached the ground.
    const impactSpeedMps = impactSpeed.current > 0 ? impactSpeed.current : touchdownSpeed.current;
    const base = { outcome, heightFt: design.heightFt, impactSpeedMps, peakG: peakG.current, peakForceN: peakForce.current, damage: Math.min(1, damage.current) };
    onComplete({ ...base, score: calculateMissionScore(design, base) });
  };

  // Watchdog, applied after every step so the bound is absolute: no body can
  // plausibly exceed vacuum free-fall from the drop height (plus headroom).
  // Anything faster is solver divergence, not physics — clamp the first
  // offences so a transient cannot snowball, and end the run honestly if the
  // simulation keeps diverging.
  useAfterPhysicsStep(() => {
    if (watchdogTripped.current) return;
    for (const ref of Object.values(refs)) {
      const body = ref.current;
      if (!body) continue;
      const position = body.translation();
      const bodyVelocity = body.linvel();
      const health = classifyBodyMotion(
        [position.x, position.y, position.z],
        [bodyVelocity.x, bodyVelocity.y, bodyVelocity.z],
        maxPlausibleSpeed,
      );
      if (health === "ok") continue;
      if (health === "invalid") {
        watchdogTripped.current = true;
        break;
      }
      runawayStrikes.current += 1;
      const speed = Math.hypot(bodyVelocity.x, bodyVelocity.y, bodyVelocity.z);
      if (speed > maxPlausibleSpeed && typeof body.setLinvel === "function") {
        const scale = maxPlausibleSpeed / speed;
        body.setLinvel({ x: bodyVelocity.x * scale, y: bodyVelocity.y * scale, z: bodyVelocity.z * scale }, true);
      }
      const angular = body.angvel?.();
      if (angular && typeof body.setAngvel === "function") {
        const spinSpeed = Math.hypot(angular.x, angular.y, angular.z);
        if (spinSpeed > 50) {
          const scale = 50 / spinSpeed;
          body.setAngvel({ x: angular.x * scale, y: angular.y * scale, z: angular.z * scale }, true);
        }
      }
      // Two full simulated seconds of continuous clamping means the run is
      // genuinely unstable, not just recovering from a bad impulse.
      if (runawayStrikes.current > 2 / DROP_FIXED_STEP_SECONDS) watchdogTripped.current = true;
    }
    if (watchdogTripped.current && !completed.current) {
      finish(damage.current >= 1 ? "cracked" : "survived");
    }
  });

  useBeforePhysicsStep(() => {
    physicsElapsed.current += DROP_FIXED_STEP_SECONDS;
    const velocity = eggRef.current?.linvel();
    if (!velocity) return;
    preStepVelocity.current.set(velocity.x, velocity.y, velocity.z);
    const eggVelocity = new Vector3(velocity.x, velocity.y, velocity.z);
    // The recorded speeds exist to capture the approach speed right before a
    // collision event (the solver may have already zeroed the velocities when
    // the event fires). Decay them quickly so they never bill a later, gentle
    // touch for a speed reached seconds earlier — e.g. an egg that rode a
    // cushioned raft down and only brushes the ground afterwards.
    const RELATIVE_SPEED_DECAY = Math.pow(.82, STEP_RATE_SCALE);
    recentRelativeSpeeds.current.ground = Math.max(
      (recentRelativeSpeeds.current.ground ?? 0) * RELATIVE_SPEED_DECAY,
      eggVelocity.length(),
    );
    for (const [bodyId, ref] of Object.entries(refs)) {
      if (bodyId === "egg" || !ref.current) continue;
      const other = ref.current.linvel();
      const relativeSpeed = eggVelocity.clone().sub(new Vector3(other.x, other.y, other.z)).length();
      recentRelativeSpeeds.current[bodyId] = Math.max(
        (recentRelativeSpeeds.current[bodyId] ?? 0) * RELATIVE_SPEED_DECAY,
        relativeSpeed,
      );
    }
    const previous = previousStepVelocity.current;
    if (previous && physicsElapsed.current >= DROP_DAMAGE_ARM_SECONDS) {
      const nonGravityDelta = eggVelocity.clone().sub(previous).sub(new Vector3(0, -gravityMps2 * DROP_FIXED_STEP_SECONDS, 0));
      // G is a planet-independent unit: the same deceleration must read the
      // same load everywhere. Dividing by the local gravity made identical
      // impacts read 300 G on the Moon and 99 G on Jupiter, and silently
      // scaled the fixed damage thresholds by 1/g per planet.
      const sampledG = nonGravityDelta.length() / DROP_FIXED_STEP_SECONDS / STANDARD_GRAVITY_MPS2;
      // Filter retention and damage accumulation are per-step quantities
      // originally tuned at 60 Hz; scale them so behaviour is step-rate
      // independent.
      const retain = Math.pow(.35, STEP_RATE_SCALE);
      filteredAccelerationG.current = filteredAccelerationG.current * retain + sampledG * (1 - retain);
      const filteredG = Math.min(300, filteredAccelerationG.current);
      if (filteredG > 4) {
        const { cushioning, areaRelief } = nearbyProtection();
        const effectiveShellG = filteredG * (1 - cushioning * .78) * (1 - areaRelief);
        // Report the load the shell actually felt (post-cushioning): the raw
        // solver-step value showed 163 G for a 6.5 m/s landing onto foam that
        // kinematically decelerates the egg at ~25 G.
        peakG.current = Math.max(peakG.current, effectiveShellG);
        peakForce.current = Math.max(peakForce.current, EGG_MASS_KG * effectiveShellG * STANDARD_GRAVITY_MPS2);
        if (effectiveShellG >= 80) addDamage(effectiveShellG / 80 * STEP_RATE_SCALE);
        else if (effectiveShellG > 20) addDamage((effectiveShellG - 20) / 80 * .08 * STEP_RATE_SCALE);
      }
    } else if (physicsElapsed.current < DROP_DAMAGE_ARM_SECONDS) {
      filteredAccelerationG.current = 0;
    }
    previousStepVelocity.current = eggVelocity;
  });

  handlers.current.collision = (payload) => {
    if (!running || completed.current) return;
    const otherUserData = payload.other.rigidBodyObject?.userData as { bodyId?: string } | undefined;
    const otherBodyId = otherUserData?.bodyId ?? "ground";
    const otherVelocity = payload.other.rigidBody?.linvel() ?? { x: 0, y: 0, z: 0 };
    const fallbackRelative = preStepVelocity.current.clone().sub(new Vector3(otherVelocity.x, otherVelocity.y, otherVelocity.z)).length();
    // The egg's own pre-contact speed. The relative speed feeds the damage
    // estimate only: a loose part flung by the landing (a straw kicked to
    // 20+ m/s) once made the "impact speed" read above vacuum free-fall, and
    // an egg riding a cushioned raft under-reported a 10 m/s arrival as 3.
    // Clamp the relative speed too, so a solver-kicked part cannot claim the
    // egg was decelerated harder than any physical closing speed allows.
    const eggSpeed = preStepVelocity.current.length();
    const relativeSpeed = Math.min(
      Math.max(fallbackRelative, recentRelativeSpeeds.current[otherBodyId] ?? 0),
      eggSpeed + maxPlausibleSpeed,
    );
    recentRelativeSpeeds.current[otherBodyId] = 0;
    if (relativeSpeed < .35) return;
    const { cushioning, areaRelief } = contactProperties(payload);
    const impactDuration = .0035 + cushioning * .026 + areaRelief * .012;
    // relativeSpeed / impactDuration models slamming into an immovable
    // surface, but a light loose part (a ~4 g straw) cannot decelerate the
    // egg that hard: momentum exchange caps the egg's velocity change at the
    // m/(m + m_egg) share of the closing speed. The ground and other fixed
    // bodies keep factor 1, and heavy parts (cardboard) are barely affected.
    const otherBody = payload.other.rigidBody;
    const massFactor = typeof otherBody?.isDynamic === "function" && typeof otherBody.mass === "function" && otherBody.isDynamic()
      ? otherBody.mass() / (otherBody.mass() + EGG_MASS_KG)
      : 1;
    const eventG = Math.min(300, relativeSpeed * massFactor / impactDuration / STANDARD_GRAVITY_MPS2);
    const effectiveShellG = eventG * (1 - cushioning * .78) * (1 - areaRelief);
    impactSpeed.current = Math.max(impactSpeed.current, eggSpeed);
    peakG.current = Math.max(peakG.current, effectiveShellG);
    peakForce.current = Math.max(peakForce.current, EGG_MASS_KG * effectiveShellG * STANDARD_GRAVITY_MPS2);
    addDamage(effectiveShellG / 80);
  };
  handlers.current.contact = (payload) => {
    if (!running || completed.current) return;
    const force = Math.max(payload.maxForceMagnitude, payload.totalForceMagnitude);
    const forceG = force / EGG_MASS_KG / STANDARD_GRAVITY_MPS2;
    const { cushioning, areaRelief } = contactProperties(payload);
    const effectiveShellG = forceG * (1 - cushioning * .78) * (1 - areaRelief);
    // Rapier's per-event force is a single 240 Hz solver impulse; a lone
    // spike saturated the display (300 G / 240 N from a 1.1 m/s bumpered
    // landing). A real crush lasts many steps, so only the running median of
    // a sustained burst feeds the reported peaks; damage keeps seeing every
    // event so a genuine sharp hit still counts against the shell.
    const window = recentContactShellG.current;
    window.push(effectiveShellG);
    if (window.length > 5) window.shift();
    if (window.length >= 3) {
      const medianShellG = Math.min(300, [...window].sort((a, b) => a - b)[Math.floor((window.length - 1) / 2)]!);
      peakG.current = Math.max(peakG.current, medianShellG);
      peakForce.current = Math.max(peakForce.current, EGG_MASS_KG * medianShellG * STANDARD_GRAVITY_MPS2);
    }
    if (effectiveShellG > 32) addDamage((effectiveShellG - 32) / 80 * .08);
  };
  useFrame((_, delta) => {
    if (!running || completed.current) return;
    const eggBody = eggRef.current;
    if (eggBody) {
      const velocity = eggBody.linvel();
      const speed = Math.hypot(velocity.x, velocity.y, velocity.z);
      const liveEggSpeedMps = useEditorStore.getState().liveEggSpeedMps;
      if (Math.abs(speed - liveEggSpeedMps) >= 0.05) {
        const peakEggSpeedMps = Math.max(useEditorStore.getState().peakEggSpeedMps, speed);
        useEditorStore.setState({ liveEggSpeedMps: speed, peakEggSpeedMps });
      }
    }
    const simulationDelta = calculatePlaybackSimulationDelta(realElapsed.current, delta, playbackRate);
    realElapsed.current += delta;
    elapsed.current += simulationDelta;

    const bodies = Object.entries(refs).flatMap(([id, ref]) => ref.current ? [[id, ref.current] as const] : []);
    const nearGround = bodies.some(([id, body]) => body.translation().y - (bodyHalfExtents[id] ?? 0) <= .14);
    if (nearGround && !wasNearGround.current && eggBody) {
      const velocity = eggBody.linvel();
      touchdownSpeed.current = Math.hypot(velocity.x, velocity.y, velocity.z);
    }
    wasNearGround.current = nearGround;
    // Only the egg needs to be at rest for a win — other parts wiggling or
    // rolling somewhere should not hold the verdict hostage.
    const eggSettled = Boolean(eggBody) && (eggBody!.isSleeping() || (() => {
      const velocity = eggBody!.linvel();
      const angular = eggBody!.angvel();
      // The angular threshold is loose on purpose: an egg resting on a live
      // cushion (balloons, wind) rocks in place at up to ~1 rad/s, which on a
      // 2.4 cm shell is invisible; actual travel is pinned by the linear
      // threshold. A strict angular gate kept resetting the settle timer and
      // pushed cushioned wins out to the 20 s simulation timeout.
      return Math.hypot(velocity.x, velocity.y, velocity.z) < .16 && Math.hypot(angular.x, angular.y, angular.z) < 1.5;
    })());

    if (pendingOutcome.current) {
      if (crackPending.current && pendingOutcome.current !== "cracked") {
        pendingOutcome.current = "cracked";
        outcomeRevealTime.current = 0;
        outcomeRevealStarted.current = false;
      }
      const safetyTimeout = elapsed.current >= DROP_SIMULATION_TIMEOUT_SECONDS || realElapsed.current >= maxWallSeconds;
      if (pendingOutcome.current === "cracked" && !nearGround && !safetyTimeout) {
        outcomeRevealTime.current = 0;
        outcomeRevealStarted.current = false;
        return;
      }
      if (!outcomeRevealStarted.current) {
        outcomeRevealStarted.current = true;
        outcomeRevealTime.current = 0;
        return;
      }
      outcomeRevealTime.current += delta;
      if (outcomeRevealTime.current >= DROP_OUTCOME_REVEAL_SECONDS) finish(pendingOutcome.current);
      return;
    }
    if (crackPending.current) {
      pendingOutcome.current = "cracked";
      outcomeRevealTime.current = 0;
      outcomeRevealStarted.current = nearGround;
      return;
    }
    // The settle timer runs on real (wall-clock) time so the win fires 3 s after
    // the egg visibly comes to rest, regardless of the slow-motion playback rate.
    if (elapsed.current > .35 && nearGround && eggSettled) settleTime.current += delta;
    else settleTime.current = 0;
    if (settleTime.current >= DROP_SETTLE_REAL_SECONDS) {
      pendingOutcome.current = "survived";
      outcomeRevealTime.current = 0;
      outcomeRevealStarted.current = false;
    } else if (elapsed.current >= DROP_SIMULATION_TIMEOUT_SECONDS || realElapsed.current >= maxWallSeconds) {
      // Time ran out. "Survived" while the egg is still floating (or rising
      // past the tower top on a balloon lift) misrepresents the run: nothing
      // landed. Publish a distinct airborne outcome for eggs still well off
      // the ground.
      const eggAltitudeM = eggBody
        ? eggBody.translation().y - (bodyHalfExtents.egg ?? 0)
        : 0;
      pendingOutcome.current = !nearGround && eggAltitudeM > 1 ? "airborne" : "survived";
      outcomeRevealTime.current = 0;
      outcomeRevealStarted.current = false;
    }
  });
  return null;
}

function dropHeightMarksFt(maxHeightFt: number, stepFt = 5) {
  const stepCount = Math.floor(maxHeightFt / stepFt);
  return Array.from({ length: stepCount + 1 }, (_, index) => index * stepFt);
}

function DropTower({ heightM, maxHeightFt }: { heightM: number; maxHeightFt: number }) {
  const marks = dropHeightMarksFt(maxHeightFt);
  const towerHeightM = Math.max(heightM, feetToMeters(maxHeightFt));
  return (
    <group>
      <Line points={[[-1.35, 0, -.5], [-1.35, towerHeightM, -.5]]} color="#31546c" lineWidth={2} />
      {marks.map((feet) => {
        const y = feetToMeters(feet);
        const major = feet % 10 === 0;
        return <Line key={feet} points={[[-1.35, y, -.5], [-1.18, y, -.5]]} color={major ? "#f5bd32" : "#6e8da0"} lineWidth={major ? 3 : 1.5} />;
      })}
      {/*
        drei's Text suspends while troika fetches its font. Keep the labels in
        their own boundary so a slow or failed font load can never blank the
        tower, ticks, or ground disc that share the scene-wide Suspense.
      */}
      <Suspense fallback={null}>
        {marks.map((feet) => {
          const y = feetToMeters(feet);
          const major = feet % 10 === 0;
          return (
            <Billboard key={feet} position={[-1.12, y, -.5]}>
              <Text fontSize={major ? .17 : .13} color={major ? "#f5bd32" : "#54718a"} anchorX="left" anchorY="middle" outlineWidth={.006} outlineColor="#ffffff" characters="0123456789'">{`${feet}'`}</Text>
            </Billboard>
          );
        })}
      </Suspense>
      <mesh position={[0, .004, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow><circleGeometry args={[4.8, 48]} /><meshStandardMaterial color="#78986d" roughness={1} /></mesh>
    </group>
  );
}

export function DropScene({ design, runId, running, playbackRate, gravityMps2, airDensityKgM3, onComplete }: DropSceneProps) {
  const normalizedPlaybackRate = normalizeDropPlaybackRate(playbackRate);
  return (
    <Canvas
      key={runId}
      shadows
      dpr={[1, 1.55]}
      gl={{ antialias: true, stencil: false, powerPreference: "high-performance" }}
      fallback={<div className="webgl-fallback" role="alert"><span>🥚</span><strong>3D graphics are unavailable</strong><p>Enable WebGL or try a current browser to run this drop.</p></div>}
    >
      <Suspense fallback={null}><DropWorld design={design} runId={runId} running={running} playbackRate={normalizedPlaybackRate} gravityMps2={gravityMps2} airDensityKgM3={airDensityKgM3} onComplete={onComplete} /></Suspense>
    </Canvas>
  );
}
