import RAPIER from "@dimforge/rapier3d-compat";
import { beforeAll, describe, expect, it } from "vitest";

const vector = (x: number, y: number, z: number) => ({ x, y, z });
const distance = (a: RAPIER.Vector, b: RAPIER.Vector) =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

const addBall = (world: RAPIER.World, body: RAPIER.RigidBody, radius = 0.05) =>
  world.createCollider(RAPIER.ColliderDesc.ball(radius).setDensity(100), body);

describe("deterministic raw Rapier safeguards", () => {
  beforeAll(async () => {
    await RAPIER.init();
  });

  it("keeps a CCD egg above the landing plane after a 50 ft fall", () => {
    const eggRadius = 0.032;
    const world = new RAPIER.World(vector(0, -9.81, 0));
    world.timestep = 1 / 60;
    world.maxCcdSubsteps = 4;
    world.createCollider(RAPIER.ColliderDesc.cuboid(5, 0.05, 5).setTranslation(0, -0.05, 0));
    const egg = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(0, 50 * 0.3048 + eggRadius, 0)
        .setCcdEnabled(true),
    );
    world.createCollider(RAPIER.ColliderDesc.ball(eggRadius).setDensity(17), egg);

    let minimumCenterY = Number.POSITIVE_INFINITY;
    let peakSpeed = 0;
    for (let step = 0; step < 300; step += 1) {
      world.step();
      minimumCenterY = Math.min(minimumCenterY, egg.translation().y);
      peakSpeed = Math.max(peakSpeed, Math.abs(egg.linvel().y));
    }

    expect(peakSpeed).toBeGreaterThan(15);
    expect(minimumCenterY).toBeGreaterThan(0.02);
    expect(egg.translation().y).toBeCloseTo(eggRadius, 2);
  });

  it("holds a fixed joint's relative separation under load", () => {
    const world = new RAPIER.World(vector(0, 0, 0));
    world.timestep = 1 / 60;
    const bodyA = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 0, 0));
    const bodyB = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(1, 0, 0));
    addBall(world, bodyA);
    addBall(world, bodyB);
    const identity = { x: 0, y: 0, z: 0, w: 1 };
    world.createImpulseJoint(
      RAPIER.JointData.fixed(vector(0.5, 0, 0), identity, vector(-0.5, 0, 0), identity),
      bodyA,
      bodyB,
      true,
    );
    bodyA.setLinvel(vector(5, 2, 0), true);

    for (let step = 0; step < 120; step += 1) world.step();
    expect(distance(bodyA.translation(), bodyB.translation())).toBeCloseTo(1, 3);
  });

  it("keeps a rope below its maximum length", () => {
    const world = new RAPIER.World(vector(0, 0, 0));
    world.timestep = 1 / 60;
    const anchor = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0, 0));
    const payload = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0.5, 0, 0));
    addBall(world, payload);
    world.createImpulseJoint(
      RAPIER.JointData.rope(1, vector(0, 0, 0), vector(0, 0, 0)),
      anchor,
      payload,
      true,
    );
    payload.setLinvel(vector(8, 2, 0), true);

    let maximumLength = 0;
    for (let step = 0; step < 120; step += 1) {
      world.step();
      maximumLength = Math.max(maximumLength, distance(anchor.translation(), payload.translation()));
    }
    expect(maximumLength).toBeLessThan(1.002);
  });

  it("returns a stretched spring toward its rest length", () => {
    const world = new RAPIER.World(vector(0, 0, 0));
    world.timestep = 1 / 60;
    const anchor = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0, 0));
    const payload = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(2, 0, 0).setLinearDamping(0.5),
    );
    addBall(world, payload);
    world.createImpulseJoint(
      RAPIER.JointData.spring(1, 100, 8, vector(0, 0, 0), vector(0, 0, 0)),
      anchor,
      payload,
      true,
    );

    for (let step = 0; step < 240; step += 1) world.step();
    expect(distance(anchor.translation(), payload.translation())).toBeCloseTo(1, 3);
  });

  it("steps the full 100-body design budget without instability", () => {
    const world = new RAPIER.World(vector(0, -9.81, 0));
    world.timestep = 1 / 60;
    world.createCollider(RAPIER.ColliderDesc.cuboid(6, 0.05, 6).setTranslation(0, -0.05, 0));
    const bodies = Array.from({ length: 100 }, (_, index) => {
      const column = index % 10;
      const row = Math.floor(index / 10);
      const body = world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic().setTranslation((column - 4.5) * 0.11, 0.2 + row * 0.11, 0),
      );
      addBall(world, body, 0.045);
      return body;
    });

    const started = Date.now();
    for (let step = 0; step < 120; step += 1) world.step();
    const elapsedMs = Date.now() - started;

    expect(elapsedMs).toBeLessThan(4_000);
    expect(bodies.every((body) => Number.isFinite(body.translation().y) && body.translation().y > -0.1)).toBe(true);
  });
});
