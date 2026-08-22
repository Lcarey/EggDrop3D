import { describe, expect, it } from "vitest";
import { Quaternion, Vector3 } from "three";
import { freshDesign } from "../editor/store";
import {
  atmosphericDamping,
  calculateAssemblyContactPairs,
  calculateBracingJoints,
  calculateDropCameraDistance,
  calculateFixedJointFrames,
  calculateWeldedAssemblyRoots,
  DROP_OUTCOME_REVEAL_SECONDS,
  DROP_FIXED_STEP_SECONDS,
  DROP_MAX_WALL_SECONDS,
  DROP_PLAYBACK_RATE,
  DROP_RELEASE_HOLD_SECONDS,
  DROP_SIMULATION_TIMEOUT_SECONDS,
  calculateDropMaxWallSeconds,
  calculatePlaybackSimulationDelta,
} from "./DropScene";

const worldPoint = (
  position: [number, number, number],
  rotation: [number, number, number, number],
  local: [number, number, number],
) => new Vector3(...local).applyQuaternion(new Quaternion(...rotation)).add(new Vector3(...position));

const countFixedSteps = (frameDeltas: readonly number[], playbackRate = DROP_PLAYBACK_RATE) => {
  let realElapsed = 0;
  let accumulator = 0;
  let steps = 0;

  for (const frameDelta of frameDeltas) {
    accumulator += calculatePlaybackSimulationDelta(realElapsed, frameDelta, playbackRate);
    realElapsed += frameDelta;
    while (accumulator + 1e-12 >= DROP_FIXED_STEP_SECONDS) {
      accumulator -= DROP_FIXED_STEP_SECONDS;
      steps += 1;
    }
  }

  return { realElapsed, accumulator, steps };
};

describe("drop playback timing", () => {
  it("holds the world stationary for exactly the first 500 ms", () => {
    expect(DROP_RELEASE_HOLD_SECONDS).toBe(0.5);
    expect(calculatePlaybackSimulationDelta(0, 0.499)).toBe(0);
    expect(calculatePlaybackSimulationDelta(0.499, 0.001)).toBe(0);
    expect(countFixedSteps(Array.from({ length: 30 }, () => 1 / 60)).steps).toBe(0);
  });

  it("carries only post-hold time across a frame that straddles release", () => {
    expect(calculatePlaybackSimulationDelta(0.49, 0.02)).toBeCloseTo(0.01 * DROP_PLAYBACK_RATE, 12);
    expect(calculatePlaybackSimulationDelta(0.5, 0.1)).toBeCloseTo(0.1 * DROP_PLAYBACK_RATE, 12);
    expect(calculatePlaybackSimulationDelta(0.6, 0.1)).toBeCloseTo(0.1 * DROP_PLAYBACK_RATE, 12);
  });

  it("advances fixed 1/240-second steps at 0.2× real time", () => {
    expect(DROP_PLAYBACK_RATE).toBe(0.2);
    const result = countFixedSteps([
      ...Array.from({ length: 30 }, () => 1 / 60),
      ...Array.from({ length: 300 }, () => 1 / 60),
    ]);

    expect(result.realElapsed).toBeCloseTo(5.5, 10);
    expect(result.steps).toBe(240);
    expect(result.accumulator).toBeCloseTo(0, 10);
  });

  it("scales elapsed simulation time from 0.1× through 2× without changing the fixed physics step", () => {
    expect(DROP_FIXED_STEP_SECONDS).toBeCloseTo(1 / 240, 12);

    for (const [playbackRate, expectedSteps] of [
      [0.1, 24],
      [0.2, 48],
      [1, 240],
      [2, 480],
    ] as const) {
      const result = countFixedSteps([
        ...Array.from({ length: 30 }, () => 1 / 60),
        ...Array.from({ length: 60 }, () => 1 / 60),
      ], playbackRate);

      expect(result.steps, `${playbackRate}×`).toBe(expectedSteps);
      expect(result.accumulator, `${playbackRate}×`).toBeCloseTo(0, 10);
    }
  });

  it("is partition-invariant across 30, 60, and 120 Hz render frames", () => {
    for (const renderHz of [30, 60, 120]) {
      const result = countFixedSteps(Array.from({ length: renderHz * 5.5 }, () => 1 / renderHz));
      expect(result.steps, `${renderHz} Hz`).toBe(240);
      expect(result.accumulator, `${renderHz} Hz`).toBeCloseTo(0, 10);
    }
  });

  it("reserves a visible outcome linger after impact", () => {
    expect(DROP_OUTCOME_REVEAL_SECONDS).toBeGreaterThanOrEqual(0.5);
  });

  it("allows the full simulation timeout at slow-motion playback speed", () => {
    expect(DROP_SIMULATION_TIMEOUT_SECONDS).toBe(20);
    expect(DROP_MAX_WALL_SECONDS).toBeGreaterThanOrEqual(
      DROP_RELEASE_HOLD_SECONDS + DROP_SIMULATION_TIMEOUT_SECONDS / DROP_PLAYBACK_RATE,
    );
    expect(calculateDropMaxWallSeconds(0.1)).toBeCloseTo(
      DROP_RELEASE_HOLD_SECONDS + DROP_SIMULATION_TIMEOUT_SECONDS / 0.1 + DROP_OUTCOME_REVEAL_SECONDS,
      12,
    );
    expect(calculateDropMaxWallSeconds(2)).toBeCloseTo(
      DROP_RELEASE_HOLD_SECONDS + DROP_SIMULATION_TIMEOUT_SECONDS / 2 + DROP_OUTCOME_REVEAL_SECONDS,
      12,
    );
  });

  it("sanitizes negative and non-finite timing inputs", () => {
    expect(calculatePlaybackSimulationDelta(-1, 0.25)).toBe(0);
    expect(calculatePlaybackSimulationDelta(Number.NaN, Number.NaN)).toBe(0);
    expect(calculatePlaybackSimulationDelta(Number.POSITIVE_INFINITY, -1)).toBe(0);
  });
});

describe("drop camera framing", () => {
  it("uses a close minimum framing distance for the bare egg", () => {
    expect(calculateDropCameraDistance(freshDesign())).toBe(0.78);
  });

  it("backs up monotonically to fit a normal contraption around the egg", () => {
    const nearDesign = freshDesign();
    nearDesign.parts = [{
      id: "frame-part",
      materialId: "foamBlock",
      transform: {
        position: [0.4, nearDesign.eggTransform.position[1], 0],
        rotation: [0, 0, 0, 1],
        dimensions: [0.2, 0.2, 0.2],
      },
    }];
    const farDesign = structuredClone(nearDesign);
    farDesign.parts[0]!.transform.position[0] = 0.9;

    const bareDistance = calculateDropCameraDistance(freshDesign());
    const nearDistance = calculateDropCameraDistance(nearDesign);
    const farDistance = calculateDropCameraDistance(farDesign);
    expect(nearDistance).toBeGreaterThan(bareDistance);
    expect(farDistance).toBeGreaterThan(nearDistance);
    expect(nearDistance).toBeCloseTo((0.4 + Math.sqrt(0.2 ** 2 * 3) / 2) * 3.2, 10);
  });

  it("clamps oversized builds to a bounded camera distance", () => {
    const design = freshDesign();
    design.parts = [{
      id: "far-part",
      materialId: "cardboard",
      transform: {
        position: [20, 20, 20],
        rotation: [0, 0, 0, 1],
        dimensions: [3, 3, 3],
      },
    }];
    expect(calculateDropCameraDistance(design)).toBe(5.5);
  });
});

describe("fixed tape setup", () => {
  it("creates coincident Rapier frames without snapping separated tape endpoints", () => {
    const design = freshDesign();
    design.parts = [{
      id: "balloon",
      materialId: "balloon",
      transform: {
        position: [-0.32, 0.74, 0.12],
        rotation: [0, 0, Math.sin(Math.PI / 16), Math.cos(Math.PI / 16)],
        dimensions: [0.3, 0.38, 0.3],
      },
    }];
    const joint = {
      id: "tape",
      kind: "fixed" as const,
      materialId: "tape" as const,
      bodyA: "egg",
      bodyB: "balloon",
      anchorA: [-0.02, 0.03, 0] as [number, number, number],
      anchorB: [0.12, -0.17, 0.01] as [number, number, number],
    };
    const clickedA = worldPoint(design.eggTransform.position, design.eggTransform.rotation, joint.anchorA);
    const clickedB = worldPoint(design.parts[0]!.transform.position, design.parts[0]!.transform.rotation, joint.anchorB);
    expect(clickedA.distanceTo(clickedB)).toBeGreaterThan(0.05);

    const [anchorA, frameA, anchorB, frameB] = calculateFixedJointFrames(design, joint);
    const fixedA = worldPoint(design.eggTransform.position, design.eggTransform.rotation, anchorA as [number, number, number]);
    const fixedB = worldPoint(design.parts[0]!.transform.position, design.parts[0]!.transform.rotation, anchorB as [number, number, number]);
    expect(fixedA.distanceTo(fixedB)).toBeLessThan(1e-10);

    const worldFrameA = new Quaternion(...design.eggTransform.rotation).multiply(new Quaternion(...frameA as [number, number, number, number]));
    const worldFrameB = new Quaternion(...design.parts[0]!.transform.rotation).multiply(new Quaternion(...frameB as [number, number, number, number]));
    expect(worldFrameA.angleTo(worldFrameB)).toBeLessThan(1e-10);
  });

  const strawAt = (id: string, x: number, rotation: [number, number, number, number] = [0, 0, 0, 1]) => ({
    id,
    materialId: "straw" as const,
    transform: {
      position: [x, 0.4, 0] as [number, number, number],
      rotation,
      dimensions: [0.025, 0.42, 0.025] as [number, number, number],
    },
  });
  const tape = (id: string, bodyA: string, bodyB: string) => ({
    id,
    kind: "fixed" as const,
    materialId: "tape" as const,
    bodyA,
    bodyB,
    anchorA: [0, 0.21, 0] as [number, number, number],
    anchorB: [0, 0.21, 0] as [number, number, number],
  });
  const SIDEWAYS: [number, number, number, number] = [0, 0, Math.SQRT1_2, Math.SQRT1_2];

  it("suppresses overlapping non-jointed pairs across a whole taped assembly", () => {
    const design = freshDesign();
    // Vertical straws a and c overlap each other (centres 10 mm apart, 25 mm
    // wide); the sideways straw b crosses both. "loose" is far away, tied to
    // the egg only by string.
    design.parts = [strawAt("a", 0), strawAt("b", 0.005, SIDEWAYS), strawAt("c", 0.01), strawAt("loose", 0.5)];
    design.joints = [
      tape("t1", "a", "b"),
      tape("t2", "b", "c"),
      {
        id: "s1",
        kind: "rope" as const,
        materialId: "string" as const,
        bodyA: "loose",
        bodyB: "egg",
        anchorA: [0, 0.21, 0] as [number, number, number],
        anchorB: [0, 0.032, 0] as [number, number, number],
      },
    ];

    // a-c share the assembly through b, have no joint of their own, and
    // interpenetrate in the build pose; those contacts would fight the tape
    // constraints and visibly stretch them.
    expect(calculateAssemblyContactPairs(design)).toEqual([["a", "c"]]);
  });

  it("keeps load-bearing contacts between butted, non-overlapping assembly members", () => {
    const design = freshDesign();
    const shelf = {
      id: "shelf",
      materialId: "cardboard" as const,
      transform: {
        position: [0, 0.5, 0] as [number, number, number],
        rotation: [0, 0, 0, 1] as [number, number, number, number],
        dimensions: [0.4, 0.01, 0.4] as [number, number, number],
      },
    };
    const legAt = (id: string, x: number) => ({
      id,
      materialId: "craftStick" as const,
      transform: {
        // Leg top face exactly butts the shelf underside (y = 0.495).
        position: [x, 0.2475, 0] as [number, number, number],
        rotation: [0, 0, 0, 1] as [number, number, number, number],
        dimensions: [0.02, 0.495, 0.02] as [number, number, number],
      },
    });
    design.parts = [shelf, legAt("leg1", -0.15), legAt("leg2", 0.15)];
    design.joints = [tape("t1", "shelf", "leg1"), tape("t2", "shelf", "leg2")];

    // leg1-leg2 share the assembly through the shelf but touch nothing; their
    // contacts (and the butted shelf contacts) must stay on to brace the
    // table, or it sags through itself after landing.
    expect(calculateAssemblyContactPairs(design)).toEqual([]);
  });

  it("never suppresses contacts involving the egg but still bridges assemblies through it", () => {
    const design = freshDesign();
    // Both straws overlap the egg's position and each other.
    design.parts = [strawAt("a", -0.005), strawAt("b", 0.005)];
    design.parts.forEach((part) => { part.transform.position[1] = 0.38; });
    design.joints = [tape("t1", "egg", "a"), tape("t2", "egg", "b")];

    const pairs = calculateAssemblyContactPairs(design);
    // a and b form one assembly through the egg and interpenetrate, so their
    // mutual contacts are suppressed — but no pair may ever include the egg,
    // or a collapsing structure can push the egg through a panel unopposed.
    expect(pairs).toEqual([["a", "b"]]);
    expect(pairs.flat()).not.toContain("egg");
  });

  it("keeps contacts alive between separate assemblies and rope-tied bodies", () => {
    const design = freshDesign();
    design.parts = [];
    design.joints = [];
    expect(calculateAssemblyContactPairs(design)).toEqual([]);
  });
});

describe("welded assembly roots (balloon shell-force suppression)", () => {
  const balloonAt = (id: string, x: number, y = 0.15) => ({
    id,
    materialId: "balloon" as const,
    transform: {
      position: [x, y, 0] as [number, number, number],
      rotation: [0, 0, 0, 1] as [number, number, number, number],
      dimensions: [0.3, 0.38, 0.3] as [number, number, number],
    },
  });
  const tapeJoint = (id: string, bodyA: string, bodyB: string) => ({
    id,
    kind: "fixed" as const,
    materialId: "tape" as const,
    bodyA,
    bodyB,
    anchorA: [0, 0, 0] as [number, number, number],
    anchorB: [0, 0, 0] as [number, number, number],
  });

  it("merges balloons welded to the egg into one assembly, transitively", () => {
    const design = freshDesign();
    design.parts = [balloonAt("b1", -0.18), balloonAt("b2", 0.18), balloonAt("free", 2)];
    design.joints = [tapeJoint("t1", "egg", "b1"), tapeJoint("t2", "egg", "b2")];
    const roots = calculateWeldedAssemblyRoots(design);
    expect(roots.get("b1")).toBe(roots.get("egg"));
    expect(roots.get("b2")).toBe(roots.get("egg"));
    expect(roots.get("b1")).toBe(roots.get("b2"));
    expect(roots.get("free")).not.toBe(roots.get("egg"));
  });

  it("does not weld rope-tied bodies", () => {
    const design = freshDesign();
    design.parts = [balloonAt("b1", 0.18)];
    design.joints = [{
      id: "s1",
      kind: "rope" as const,
      materialId: "string" as const,
      bodyA: "egg",
      bodyB: "b1",
      anchorA: [0, 0.032, 0] as [number, number, number],
      anchorB: [-0.15, 0, 0] as [number, number, number],
    }];
    const roots = calculateWeldedAssemblyRoots(design);
    expect(roots.get("b1")).not.toBe(roots.get("egg"));
  });

  it("does not weld across a long chained tape tether", () => {
    const design = freshDesign();
    // Balloon 1.5 m above the egg: the fixed joint spans far more than the
    // chaining threshold with a wide body gap, so it is simulated as a
    // flexible chain, not a weld.
    design.parts = [balloonAt("b1", 0, 1.9)];
    design.joints = [{
      ...tapeJoint("t1", "egg", "b1"),
      anchorA: [0, 0.032, 0] as [number, number, number],
      anchorB: [0, -0.19, 0] as [number, number, number],
    }];
    const roots = calculateWeldedAssemblyRoots(design);
    expect(roots.get("b1")).not.toBe(roots.get("egg"));
  });
});

describe("bracing joints for star-shaped weld hubs", () => {
  const balloonAt = (id: string, x: number, z = 0) => ({
    id,
    materialId: "balloon" as const,
    transform: {
      position: [x, 0.68, z] as [number, number, number],
      rotation: [0, 0, 0, 1] as [number, number, number, number],
      dimensions: [0.3, 0.38, 0.3] as [number, number, number],
    },
  });
  const tapeJoint = (id: string, bodyA: string, bodyB: string) => ({
    id,
    kind: "fixed" as const,
    materialId: "tape" as const,
    bodyA,
    bodyB,
    anchorA: [0, 0.03, 0] as [number, number, number],
    anchorB: [0, -0.19, 0] as [number, number, number],
  });

  it("braces the spokes of a 3-weld egg hub into a ring that bypasses the egg", () => {
    const design = freshDesign();
    design.parts = [balloonAt("b1", -0.18), balloonAt("b2", 0.18), balloonAt("b3", 0, -0.18)];
    design.joints = [tapeJoint("t1", "egg", "b1"), tapeJoint("t2", "egg", "b2"), tapeJoint("t3", "egg", "b3")];
    const braces = calculateBracingJoints(design);
    expect(braces).toHaveLength(3);
    expect(braces.every((joint) => joint.kind === "fixed")).toBe(true);
    expect(braces.flatMap((joint) => [joint.bodyA, joint.bodyB])).not.toContain("egg");
    // Each brace welds at the world midpoint of its pair, preserving the pose.
    for (const brace of braces) {
      const a = design.parts.find((part) => part.id === brace.bodyA)!;
      const b = design.parts.find((part) => part.id === brace.bodyB)!;
      const worldA = worldPoint(a.transform.position, a.transform.rotation, brace.anchorA);
      const worldB = worldPoint(b.transform.position, b.transform.rotation, brace.anchorB);
      expect(worldA.distanceTo(worldB)).toBeLessThan(1e-10);
    }
  });

  it("does not duplicate an existing weld between two spokes", () => {
    const design = freshDesign();
    design.parts = [balloonAt("b1", -0.18), balloonAt("b2", 0.18)];
    design.joints = [
      tapeJoint("t1", "egg", "b1"),
      tapeJoint("t2", "egg", "b2"),
      tapeJoint("t3", "b1", "b2"),
    ];
    expect(calculateBracingJoints(design)).toHaveLength(0);
  });

  it("drops braces whose hub joints have broken", () => {
    const design = freshDesign();
    design.parts = [balloonAt("b1", -0.18), balloonAt("b2", 0.18), balloonAt("b3", 0, -0.18)];
    design.joints = [tapeJoint("t1", "egg", "b1"), tapeJoint("t2", "egg", "b2"), tapeJoint("t3", "egg", "b3")];
    // With t3 broken the hub has two spokes left: a single brace remains.
    expect(calculateBracingJoints(design, new Set(["t3"]))).toHaveLength(1);
    expect(calculateBracingJoints(design, new Set(["t2", "t3"]))).toHaveLength(0);
  });

  it("ignores single welds and rope joints", () => {
    const design = freshDesign();
    design.parts = [balloonAt("b1", -0.18), balloonAt("b2", 0.18)];
    design.joints = [
      tapeJoint("t1", "egg", "b1"),
      {
        id: "s1",
        kind: "rope" as const,
        materialId: "string" as const,
        bodyA: "egg",
        bodyB: "b2",
        anchorA: [0, 0.032, 0] as [number, number, number],
        anchorB: [-0.15, 0, 0] as [number, number, number],
      },
    ];
    expect(calculateBracingJoints(design)).toHaveLength(0);
  });
});

describe("atmospheric damping (no phantom drag in vacuum)", () => {
  it("keeps the full material damping at Earth sea level", () => {
    expect(atmosphericDamping(0.45, 1.225)).toBeCloseTo(0.45, 12);
  });

  it("reduces damping to the hygiene floor in vacuum", () => {
    expect(atmosphericDamping(0.45, 0)).toBeCloseTo(0.01, 12);
    expect(atmosphericDamping(0.04, 0)).toBeCloseTo(0.01, 12);
  });

  it("never raises damping above the material value, even in dense air", () => {
    expect(atmosphericDamping(0.3, 65)).toBeCloseTo(0.3, 12);
  });

  it("never raises a tiny material damping up to the floor", () => {
    expect(atmosphericDamping(0.005, 0)).toBeCloseTo(0.005, 12);
  });

  it("scales proportionally in thin atmospheres", () => {
    expect(atmosphericDamping(0.4, 0.245)).toBeCloseTo(0.08, 12);
  });
});
