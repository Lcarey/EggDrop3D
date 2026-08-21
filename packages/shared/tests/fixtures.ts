import type { DesignV1, Transform } from "../src/index.js";

export function transform(
  position: [number, number, number] = [0, 0, 0],
): Transform {
  return {
    position,
    rotation: [0, 0, 0, 1],
    dimensions: [0.1, 0.1, 0.1],
  };
}

export function validDesign(
  overrides: Partial<DesignV1> = {},
): DesignV1 {
  return {
    schemaVersion: 1,
    physicsVersion: 1,
    name: "Test capsule",
    mode: "challenge",
    missionId: "first-flight",
    heightFt: 10,
    eggTransform: transform([0, 0.2, 0]),
    parts: [
      { id: "part-a", materialId: "straw", transform: transform() },
      {
        id: "part-b",
        materialId: "cardboard",
        transform: transform([0.1, 0, 0]),
      },
    ],
    joints: [
      {
        id: "joint-a",
        kind: "fixed",
        materialId: "tape",
        bodyA: "part-a",
        bodyB: "part-b",
        anchorA: [0, 0, 0],
        anchorB: [0, 0, 0],
      },
    ],
    ...overrides,
  };
}

