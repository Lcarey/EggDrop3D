import { describe, expect, it } from "vitest";
import { Quaternion, Vector3 } from "three";
import { freshDesign } from "../editor/store";
import {
  calculateAssemblyContactPairs,
  calculateDropCameraDistance,
  calculateFixedJointFrames,
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

  it("advances fixed 1/60-second steps at 0.2× real time", () => {
    expect(DROP_PLAYBACK_RATE).toBe(0.2);
    const result = countFixedSteps([
      ...Array.from({ length: 30 }, () => 1 / 60),
      ...Array.from({ length: 300 }, () => 1 / 60),
    ]);

    expect(result.realElapsed).toBeCloseTo(5.5, 10);
    expect(result.steps).toBe(60);
    expect(result.accumulator).toBeCloseTo(0, 10);
  });

  it("scales elapsed simulation time from 0.1× through 2× without changing the fixed physics step", () => {
    expect(DROP_FIXED_STEP_SECONDS).toBeCloseTo(1 / 60, 12);

    for (const [playbackRate, expectedSteps] of [
      [0.1, 6],
      [0.2, 12],
      [1, 60],
      [2, 120],
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
      expect(result.steps, `${renderHz} Hz`).toBe(60);
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

  it("suppresses contacts across a whole taped assembly, not just directly-taped pairs", () => {
    const design = freshDesign();
    const strawAt = (id: string, x: number) => ({
      id,
      materialId: "straw" as const,
      transform: {
        position: [x, 0.4, 0] as [number, number, number],
        rotation: [0, 0, 0, 1] as [number, number, number, number],
        dimensions: [0.025, 0.42, 0.025] as [number, number, number],
      },
    });
    design.parts = [strawAt("a", -0.1), strawAt("b", 0), strawAt("c", 0.1), strawAt("loose", 0.5)];
    const tape = (id: string, bodyA: string, bodyB: string) => ({
      id,
      kind: "fixed" as const,
      materialId: "tape" as const,
      bodyA,
      bodyB,
      anchorA: [0, 0.21, 0] as [number, number, number],
      anchorB: [0, 0.21, 0] as [number, number, number],
    });
    // a-b-c is one taped chain; "loose" is only tied to the egg by string.
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

    // a-c share the assembly through b but have no joint of their own; those
    // contacts would fight the tape constraints and visibly stretch them.
    expect(calculateAssemblyContactPairs(design)).toEqual([["a", "c"]]);
  });

  it("keeps contacts alive between separate assemblies and rope-tied bodies", () => {
    const design = freshDesign();
    design.parts = [];
    design.joints = [];
    expect(calculateAssemblyContactPairs(design)).toEqual([]);
  });
});
