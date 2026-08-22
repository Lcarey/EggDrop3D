import { Billboard, ContactShadows, Line, OrbitControls, PerspectiveCamera, Text } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import {
  BallCollider,
  CapsuleCollider,
  CuboidCollider,
  CylinderCollider,
  Physics,
  RigidBody,
  useBeforePhysicsStep,
  useFixedJoint,
  useRapier,
  useRopeJoint,
  useSpringJoint,
  type RapierRigidBody,
  type ContactForcePayload,
  type CollisionEnterPayload,
  type FixedJointParams,
} from "@react-three/rapier";
import {
  MATERIAL_BY_ID,
  calculateBuoyantForceN,
  calculateDragForce,
  calculateMissionScore,
  calculatePartMassKg,
  feetToMeters,
  MAX_DROP_HEIGHT_FT,
  type DesignJointV1,
  type DesignPartV1,
  type DesignV1,
  type DropResult,
  type MaterialId,
} from "@eggdrop/shared";
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
  onComplete: (result: DropResult) => void;
};

const AIR_DENSITY = 1.225;
const EGG_MASS_KG = .057;

/** A body joined (directly or transitively) to a plastic bag, with its mass. */
type BagLoadEntry = { bodyId: string; massKg: number };
type BagLoad = { entries: BagLoadEntry[]; refs: BodyRefs };

/**
 * Deterministic low-frequency gusts in m/s (horizontal only, so drop timing
 * is untouched). Real air is never perfectly still; without a lateral nudge a
 * statically unstable build — e.g. a heavy egg balanced on top of a draggy
 * sheet — balances on its unstable equilibrium all the way down because the
 * simulation is otherwise perfectly symmetric. The amplitude is a light
 * breeze: the resulting force scales with each body's drag area, so big
 * sheets get rocked while a bare egg barely feels it.
 */
export const calculateGustVelocityMps = (timeSeconds: number): [number, number, number] => [
  .28 * Math.sin(timeSeconds * 1.1 + .9) + .18 * Math.sin(timeSeconds * 2.6 + 4.2),
  0,
  .28 * Math.sin(timeSeconds * 1.5 + 2.4) + .18 * Math.sin(timeSeconds * 3.1 + 1.1),
];

/**
 * Air velocity relative to the body, including gusts. The gust contribution
 * fades out below ~1 m/s of body speed so settled bodies feel still air and
 * can sleep instead of being dragged across the ground.
 */
const relativeAirVelocity = (
  velocity: { x: number; y: number; z: number },
  speed: number,
  timeSeconds: number,
): [number, number, number] => {
  const gust = calculateGustVelocityMps(timeSeconds);
  const envelope = Math.min(1, speed / 1.2);
  return [
    velocity.x - gust[0] * envelope,
    velocity.y - gust[1] * envelope,
    velocity.z - gust[2] * envelope,
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

function AerodynamicForces({ bodyRef, materialId, dimensions, gravityMps2, load }: { bodyRef: RefObject<RapierRigidBody>; materialId: MaterialId; dimensions: [number, number, number]; gravityMps2: number; load?: BagLoad }) {
  const elapsed = useRef(0);
  useBeforePhysicsStep(() => {
    const body = bodyRef.current;
    if (!body) return;
    elapsed.current += DROP_FIXED_STEP_SECONDS;
    body.resetForces(false);
    body.resetTorques(false);
    // Rotational air drag. Real panels flutter against big rotational
    // resistance; without this a thin body can wind up unbounded spin from
    // repeated contact impulses and slice through the scene like a saw blade.
    // Capped against the body's smallest moment of inertia to keep the
    // explicit integration stable for tiny parts.
    const spin = body.angvel();
    const [dx, dy, dz] = dimensions;
    const mass = materialId === "balloon"
      ? Math.max(BALLOON_MIN_SIM_MASS_KG, calculatePartMassKg(materialId, dimensions))
      : Math.max(.001, calculatePartMassKg(materialId, dimensions));
    const sorted = [dx, dy, dz].sort((a, b) => a - b);
    const minInertia = mass * (sorted[0]! ** 2 + sorted[1]! ** 2) / 12;
    const spinDrag = Math.min(
      minInertia * 25,
      .6 * MATERIAL_BY_ID[materialId].physics.dragCoefficient * Math.max(dx * dy, dx * dz, dy * dz),
    );
    body.addTorque({ x: -spin.x * spinDrag, y: -spin.y * spinDrag, z: -spin.z * spinDrag }, true);
    const velocity = body.linvel();
    const speed = Math.hypot(velocity.x, velocity.y, velocity.z);
    if (speed > .01) {
      const airVelocity = relativeAirVelocity(velocity, speed, elapsed.current);
      if (materialId === "plasticBag") {
        // Parachute model: a descending bag billows into a canopy with far
        // more drag than a flat sheet, and the force applies at the dome's
        // centre of pressure above the centre of mass so a loaded bag
        // self-rights canopy-up instead of tumbling. A joined payload whose
        // centre of mass rides above the sheet blocks that inflation, so an
        // egg perched on top of a bag gets no parachute.
        const rotation = body.rotation();
        const normal = new Vector3(0, 1, 0).applyQuaternion(new Quaternion(rotation.x, rotation.y, rotation.z, rotation.w));
        const center = body.translation();
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
          airDensityKgM3: AIR_DENSITY,
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
        const area = Math.max(dimensions[0] * dimensions[1], dimensions[0] * dimensions[2], dimensions[1] * dimensions[2]);
        const drag = calculateDragForce({
          velocityMps: airVelocity,
          dragCoefficient: MATERIAL_BY_ID[materialId].physics.dragCoefficient,
          crossSectionAreaM2: area,
          airDensityKgM3: AIR_DENSITY,
        });
        body.addForce({ x: drag[0], y: drag[1], z: drag[2] }, true);
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
        gravityMps2,
      });
      // Cancel gravity on the artificial inertia floor so the balloon still
      // weighs what real latex weighs while colliding like it has air inside.
      const realMass = Math.max(.001, calculatePartMassKg("balloon", dimensions));
      const gravityCompensation = Math.max(0, BALLOON_MIN_SIM_MASS_KG - realMass) * gravityMps2;
      body.addForce({ x: 0, y: buoyancy + gravityCompensation, z: 0 }, true);
    }
  });
  return null;
}

/**
 * Simulated balloon inertia floor. The latex alone weighs ~10 g, but a moving
 * balloon also carries the air inside it plus the "added mass" of air it
 * shoves aside, and a ~1:140 mass ratio against a cardboard payload makes the
 * rigid-body solver eject balloons like watermelon seeds. The extra inertia
 * is cancelled out of gravity in AerodynamicForces so weight and lift are
 * unchanged.
 */
const BALLOON_MIN_SIM_MASS_KG = .09;

const BALLOON_COLUMN_STIFFNESS = 700;
const BALLOON_COLUMN_DAMPING = 20;
const BALLOON_COLUMN_MAX_FORCE = 60;
const BALLOON_REACTION_MAX_FORCE = 3;
const BALLOON_SELF_SPRING = 90;
const BALLOON_SELF_DAMPING = 1.6;
const BALLOON_GROUND_DRAG = .8;

const BALL_APPROX_MATERIALS = new Set<MaterialId>(["balloon", "cottonBall", "newspaper", "packingPeanuts", "paperCup"]);

/**
 * Squishy-balloon model. Bodies pressing down into the soft outer shell of a
 * ground-backed balloon are held up by a spring-damper "air column" anchored
 * to the ground, so a balloon raft decelerates its payload over the shell's
 * compression stroke like a real balloon instead of stopping it in a single
 * physics step. Spring stiffness is capped per target mass to keep the
 * explicit integration stable, and light balloons receive no reaction force
 * (the ground supplies it), which avoids the huge-mass-ratio impulses that
 * ejected balloons sideways. A gentle self-spring keeps an unloaded balloon
 * resting at its full visual radius rather than sinking to its rigid core.
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

  useBeforePhysicsStep(() => {
    for (const balloon of balloons) {
      const body = refs[balloon.id]?.current;
      if (!body) continue;
      const radius = balloon.radius;
      const center = body.translation();
      const balloonVelocity = body.linvel();
      const grounded = center.y < radius * 1.6;

      if (grounded) {
        // Hold the balloon itself at its visual radius and scrub lateral
        // sliding. Like the payload columns, the spring fades while the
        // balloon moves up so it absorbs landings instead of trampolining.
        const selfRelease = balloonVelocity.y > 0 ? Math.max(0, 1 - balloonVelocity.y / .3) : 1;
        const selfLift = Math.max(0,
          BALLOON_SELF_SPRING * (radius - center.y) * selfRelease
          + BALLOON_SELF_DAMPING * Math.max(0, -balloonVelocity.y));
        body.addForce({ x: -balloonVelocity.x * BALLOON_GROUND_DRAG, y: selfLift, z: -balloonVelocity.z * BALLOON_GROUND_DRAG }, true);
      }

      const centerVec = new Vector3(center.x, center.y, center.z);
      for (const target of targets) {
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
        const normal = delta.clone().divideScalar(distance);
        // Only support bodies pressing down from above; side/below contacts
        // stay on the rigid core.
        if (normal.y > -.35) continue;
        const mass = other.mass();
        const damping = Math.min(BALLOON_COLUMN_DAMPING, mass * 40);
        const targetVelocity = other.linvel();

        if (!grounded) {
          // In flight, a pure damper keeps the payload from crushing the
          // shell down to the rigid core. Damper-only means it can only
          // remove relative-approach energy, so it cannot levitate anything,
          // and it preserves the full spring stroke for touchdown. The equal
          // and opposite reaction transmits the payload's weight down through
          // the balloon so the assembly actually descends as a unit.
          const closing = (targetVelocity.x - balloonVelocity.x) * normal.x
            + (targetVelocity.y - balloonVelocity.y) * normal.y
            + (targetVelocity.z - balloonVelocity.z) * normal.z;
          // Gate on the target's own motion toward the balloon: a buoyant
          // balloon drifting up into a resting payload must not "damp" the
          // payload skyward (the asymmetric force caps would mint momentum).
          const targetApproach = targetVelocity.x * normal.x + targetVelocity.y * normal.y + targetVelocity.z * normal.z;
          const speed = Math.min(4, Math.max(0, Math.min(closing, targetApproach)));
          const force = Math.min(BALLOON_COLUMN_MAX_FORCE, damping * speed);
          if (force <= 0) continue;
          const airPush = { x: -normal.x * force, y: -normal.y * force, z: -normal.z * force };
          // Ball-shaped bodies get the force through their centre: a surface
          // application point would torque their tiny rotational inertia.
          if (target.ball) other.addForce(airPush, true);
          else other.addForceAtPoint(airPush, { x: closest.x, y: closest.y, z: closest.z }, true);
          // Cap the reaction by what the balloon's inertia can absorb in one
          // step; transmitting the full transient would kick it away.
          const reaction = Math.min(force, BALLOON_REACTION_MAX_FORCE);
          body.addForceAtPoint(
            { x: normal.x * reaction, y: normal.y * reaction, z: normal.z * reaction },
            { x: closest.x, y: closest.y, z: closest.z },
            true,
          );
          continue;
        }

        const stiffness = Math.min(BALLOON_COLUMN_STIFFNESS, mass * 2400);
        // Stroke is capped at the squishable shell depth; beyond that the
        // rigid core takes over.
        const compression = Math.min(radius * .45, Math.max(0, radius * 2 - closest.y));
        // Damp using the contact point's own vertical velocity (including
        // rotation), not the centroid's: a tilting panel otherwise sees pure
        // undamped springs on its pitch mode and see-saws itself to pieces.
        const angular = other.angvel();
        const pointVerticalVelocity = targetVelocity.y
          + angular.z * (closest.x - position.x)
          - angular.x * (closest.z - position.z);
        // Cap the damper's speed input so first contact at full descent speed
        // ramps the force up over the stroke instead of spiking instantly.
        const approach = Math.min(4, Math.max(0, -pointVerticalVelocity));
        // A real balloon dissipates the squeeze (air escapes, latex
        // hysteresis); returning the full spring energy turned the cushion
        // into a trampoline. Fade the spring to zero as the contact point
        // rises so the cushion is one-way: full support at rest and while
        // compressing, no launch assist.
        const releaseFactor = pointVerticalVelocity > 0 ? Math.max(0, 1 - pointVerticalVelocity / .3) : 1;
        const force = Math.min(BALLOON_COLUMN_MAX_FORCE, stiffness * compression * releaseFactor + damping * approach);
        if (force <= 0) continue;
        if (target.ball) other.addForce({ x: 0, y: force, z: 0 }, true);
        else other.addForceAtPoint({ x: 0, y: force, z: 0 }, { x: closest.x, y: closest.y, z: closest.z }, true);
      }
    }
  });
  return null;
}

function PhysicsPart({ part, offset, bodyRef, gravityMps2, load }: { part: DesignPartV1; offset: number; bodyRef: RefObject<RapierRigidBody>; gravityMps2: number; load?: BagLoad }) {
  const definition = MATERIAL_BY_ID[part.materialId];
  const realMass = Math.max(.001, calculatePartMassKg(part.materialId, part.transform.dimensions));
  const mass = part.materialId === "balloon" ? Math.max(realMass, BALLOON_MIN_SIM_MASS_KG) : realMass;
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
      linearDamping={definition.physics.linearDamping}
      angularDamping={definition.physics.angularDamping}
      ccd
      canSleep
      userData={{ bodyId: part.id, materialId: part.materialId, contactAreaM2 }}
    >
      <PartCollider part={part} mass={mass} />
      <AerodynamicForces bodyRef={bodyRef} materialId={part.materialId} dimensions={part.transform.dimensions} gravityMps2={gravityMps2} load={load} />
    </RigidBody>
  );
}

function EggAerodynamicForces({ bodyRef, dimensions }: { bodyRef: RefObject<RapierRigidBody>; dimensions: [number, number, number] }) {
  const elapsed = useRef(0);
  useBeforePhysicsStep(() => {
    const body = bodyRef.current;
    if (!body) return;
    elapsed.current += DROP_FIXED_STEP_SECONDS;
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
    const speed = Math.hypot(velocity.x, velocity.y, velocity.z);
    const area = Math.PI * dimensions[0] * dimensions[2] / 4;
    const drag = calculateDragForce({
      velocityMps: relativeAirVelocity(velocity, speed, elapsed.current),
      dragCoefficient: .47,
      crossSectionAreaM2: area,
      airDensityKgM3: AIR_DENSITY,
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

function PhysicsConnectors({ design, refs }: { design: DesignV1; refs: BodyRefs }) {
  const assemblyContactPairs = useMemo(() => calculateAssemblyContactPairs(design), [design]);
  return (
    <>
      {design.joints.map((joint) => {
        if (!refs[joint.bodyA] || !refs[joint.bodyB]) return null;
        if (joint.kind === "fixed") return <FixedConnector key={joint.id} joint={joint} refs={refs} design={design} />;
        if (joint.kind === "rope") return <RopeConnector key={joint.id} joint={joint} refs={refs} design={design} />;
        return <SpringConnector key={joint.id} joint={joint} refs={refs} design={design} />;
      })}
      {assemblyContactPairs.map(([bodyA, bodyB]) => (
        refs[bodyA] && refs[bodyB]
          ? <AssemblyContactSuppressor key={`suppress:${bodyA}:${bodyB}`} bodyA={bodyA} bodyB={bodyB} refs={refs} />
          : null
      ))}
    </>
  );
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

const createDropPoseFrames = (design: DesignV1, offset: number): DropPoseFrames => Object.fromEntries([
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
    maxDistance: Math.max(3.2, initialDistance * 3),
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
}: {
  design: DesignV1;
  poses: DropPoseFrames;
  cracked: boolean;
  bagLoads: Record<string, BagLoadEntry[]>;
}) {
  return (
    <>
      <InterpolatedBodyVisual pose={poses.egg!}>
        <EggVisual transform={design.eggTransform} cracked={cracked} />
      </InterpolatedBodyVisual>
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

function DropJointLines({ design, poses }: { design: DesignV1; poses: DropPoseFrames }) {
  const geometries = useRef<Record<string, BufferGeometry<any> | null>>({});
  useFrame(() => {
    for (const joint of design.joints) {
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
    <>{design.joints.map((joint) => (
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

function DropWorld({ design, running, playbackRate, gravityMps2, onComplete }: Omit<DropSceneProps, "runId">) {
  const offset = useMemo(() => dropOffset(design), [design]);
  const framingDistance = useMemo(() => calculateDropCameraDistance(design), [design]);
  const refs = useMemo<BodyRefs>(() => Object.fromEntries(["egg", ...design.parts.map((part) => part.id)].map((id) => [id, createRef<RapierRigidBody>() as RefObject<RapierRigidBody>])), [design]);
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
  const poses = useMemo(() => createDropPoseFrames(design, offset), [design, offset]);
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
          linearDamping={.04}
          angularDamping={.08}
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
          <EggAerodynamicForces bodyRef={refs.egg!} dimensions={design.eggTransform.dimensions} />
        </RigidBody>
        {design.parts.map((part) => <PhysicsPart key={part.id} part={part} offset={offset} bodyRef={refs[part.id]!} gravityMps2={gravityMps2} load={bagLoads[part.id] ? { entries: bagLoads[part.id]!, refs } : undefined} />)}
        <PhysicsConnectors design={design} refs={refs} />
        <BalloonSuspension design={design} refs={refs} />
        <InterpolatedDropVisuals design={design} poses={poses} cracked={cracked} bagLoads={bagLoads} />
        <DropJointLines design={design} poses={poses} />
        <MonitorBridge design={design} refs={refs} eggRef={refs.egg!} running={running} playbackRate={playbackRate} gravityMps2={gravityMps2} onComplete={onComplete} setCracked={setCracked} handlers={monitorHandlers} />
      </Physics>
      <ContactShadows position={[0, .01, 0]} opacity={.38} scale={5} blur={2.4} far={4} />
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
  const pendingOutcome = useRef<"survived" | "cracked" | null>(null);
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
  const crackPending = useRef(false);
  const maxWallSeconds = calculateDropMaxWallSeconds(playbackRate);
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

  const finish = (outcome: "survived" | "cracked") => {
    if (completed.current) return;
    completed.current = true;
    // An egg that rides a contraption down may never touch anything itself,
    // so no collision ever records an impact speed. Fall back to the egg's
    // speed at the moment the assembly first reached the ground.
    const impactSpeedMps = impactSpeed.current > 0 ? impactSpeed.current : touchdownSpeed.current;
    const base = { outcome, heightFt: design.heightFt, impactSpeedMps, peakG: peakG.current, peakForceN: peakForce.current, damage: Math.min(1, damage.current) };
    onComplete({ ...base, score: calculateMissionScore(design, base) });
  };

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
      const sampledG = nonGravityDelta.length() / DROP_FIXED_STEP_SECONDS / gravityMps2;
      // Filter retention and damage accumulation are per-step quantities
      // originally tuned at 60 Hz; scale them so behaviour is step-rate
      // independent.
      const retain = Math.pow(.35, STEP_RATE_SCALE);
      filteredAccelerationG.current = filteredAccelerationG.current * retain + sampledG * (1 - retain);
      const filteredG = Math.min(300, filteredAccelerationG.current);
      if (filteredG > 4) {
        const { cushioning, areaRelief } = nearbyProtection();
        const effectiveShellG = filteredG * (1 - cushioning * .78) * (1 - areaRelief);
        peakG.current = Math.max(peakG.current, filteredG);
        peakForce.current = Math.max(peakForce.current, EGG_MASS_KG * filteredG * gravityMps2);
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
    const relativeSpeed = Math.max(fallbackRelative, recentRelativeSpeeds.current[otherBodyId] ?? 0);
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
    const eventG = Math.min(300, relativeSpeed * massFactor / impactDuration / gravityMps2);
    const effectiveShellG = eventG * (1 - cushioning * .78) * (1 - areaRelief);
    impactSpeed.current = Math.max(impactSpeed.current, relativeSpeed);
    peakG.current = Math.max(peakG.current, eventG);
    peakForce.current = Math.max(peakForce.current, EGG_MASS_KG * eventG * gravityMps2);
    addDamage(effectiveShellG / 80);
  };
  handlers.current.contact = (payload) => {
    if (!running || completed.current) return;
    const force = Math.max(payload.maxForceMagnitude, payload.totalForceMagnitude);
    const forceG = force / EGG_MASS_KG / gravityMps2;
    const { cushioning, areaRelief } = contactProperties(payload);
    const effectiveShellG = forceG * (1 - cushioning * .78) * (1 - areaRelief);
    peakForce.current = Math.max(peakForce.current, force);
    peakG.current = Math.max(peakG.current, Math.min(300, forceG));
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
      return Math.hypot(velocity.x, velocity.y, velocity.z) < .16 && Math.hypot(angular.x, angular.y, angular.z) < .35;
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
    if (settleTime.current >= DROP_SETTLE_REAL_SECONDS || elapsed.current >= DROP_SIMULATION_TIMEOUT_SECONDS || realElapsed.current >= maxWallSeconds) {
      pendingOutcome.current = "survived";
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

export function DropScene({ design, runId, running, playbackRate, gravityMps2, onComplete }: DropSceneProps) {
  const normalizedPlaybackRate = normalizeDropPlaybackRate(playbackRate);
  return (
    <Canvas
      key={runId}
      shadows
      dpr={[1, 1.55]}
      gl={{ antialias: true }}
      fallback={<div className="webgl-fallback" role="alert"><span>🥚</span><strong>3D graphics are unavailable</strong><p>Enable WebGL or try a current browser to run this drop.</p></div>}
    >
      <Suspense fallback={null}><DropWorld design={design} running={running} playbackRate={normalizedPlaybackRate} gravityMps2={gravityMps2} onComplete={onComplete} /></Suspense>
    </Canvas>
  );
}
