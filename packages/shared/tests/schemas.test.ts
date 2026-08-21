import { describe, expect, it } from "vitest";

import {
  ApiErrorBodySchema,
  CreateDesignResponseSchema,
  DesignV1Schema,
  DropResultSchema,
  isDesignPayloadWithinLimit,
  MAX_DESIGN_PAYLOAD_BYTES,
  MAX_JOINTS,
  MAX_PARTS,
  PublicDesignSchema,
  serializedJsonByteLength,
} from "../src/index.js";
import type { DesignJointV1, DesignPartV1 } from "../src/index.js";
import { transform, validDesign } from "./fixtures.js";

describe("DesignV1Schema", () => {
  it("accepts and normalizes a valid v1 design", () => {
    const result = DesignV1Schema.parse(validDesign({ name: "  Capsule  " }));
    expect(result.name).toBe("Capsule");
  });

  it("rejects non-finite transforms, zero quaternions, and invalid dimensions", () => {
    const nonFinite = validDesign();
    nonFinite.eggTransform.position[0] = Number.NaN;
    expect(DesignV1Schema.safeParse(nonFinite).success).toBe(false);

    const zeroRotation = validDesign();
    zeroRotation.eggTransform.rotation = [0, 0, 0, 0];
    expect(DesignV1Schema.safeParse(zeroRotation).success).toBe(false);

    const invalidDimensions = validDesign();
    invalidDimensions.parts[0]!.transform.dimensions[1] = 0;
    expect(DesignV1Schema.safeParse(invalidDimensions).success).toBe(false);
  });

  it("enforces the 5–50 foot continuous height range", () => {
    expect(DesignV1Schema.safeParse(validDesign({ heightFt: 5 })).success).toBe(true);
    expect(DesignV1Schema.safeParse(validDesign({ heightFt: 27.375 })).success).toBe(true);
    expect(DesignV1Schema.safeParse(validDesign({ heightFt: 50 })).success).toBe(true);
    expect(DesignV1Schema.safeParse(validDesign({ heightFt: 4.999 })).success).toBe(false);
    expect(DesignV1Schema.safeParse(validDesign({ heightFt: 50.001 })).success).toBe(false);
  });

  it("enforces safe, unique IDs and valid joint references", () => {
    const duplicatePart = validDesign();
    duplicatePart.parts[1]!.id = duplicatePart.parts[0]!.id;
    expect(DesignV1Schema.safeParse(duplicatePart).success).toBe(false);

    const duplicateEntity = validDesign();
    duplicateEntity.joints[0]!.id = duplicateEntity.parts[0]!.id;
    expect(DesignV1Schema.safeParse(duplicateEntity).success).toBe(false);

    const missingBody = validDesign();
    missingBody.joints[0]!.bodyB = "missing";
    expect(DesignV1Schema.safeParse(missingBody).success).toBe(false);

    const badId = validDesign();
    badId.parts[0]!.id = "spaces are unsafe";
    expect(DesignV1Schema.safeParse(badId).success).toBe(false);

    const reservedId = validDesign();
    reservedId.parts[0]!.id = "egg";
    expect(DesignV1Schema.safeParse(reservedId).success).toBe(false);
  });

  it("allows joints to anchor a part to the special egg body", () => {
    const anchoredEgg = validDesign();
    anchoredEgg.joints[0]!.bodyB = "egg";
    expect(DesignV1Schema.safeParse(anchoredEgg).success).toBe(true);
  });

  it("requires the connector material that matches each joint kind", () => {
    const mismatch = validDesign();
    mismatch.joints[0]!.materialId = "string";
    expect(DesignV1Schema.safeParse(mismatch).success).toBe(false);

    // Fixed joints accept both of their connector materials.
    const glued = validDesign();
    glued.joints[0]!.materialId = "glue";
    expect(DesignV1Schema.safeParse(glued).success).toBe(true);

    const sameBody = validDesign();
    sameBody.joints[0]!.bodyB = "part-a";
    expect(DesignV1Schema.safeParse(sameBody).success).toBe(false);
  });

  it("locks sandbox and challenge mission semantics", () => {
    expect(
      DesignV1Schema.safeParse(
        validDesign({ mode: "sandbox", missionId: null }),
      ).success,
    ).toBe(true);
    expect(
      DesignV1Schema.safeParse(
        validDesign({ mode: "sandbox", missionId: "first-flight" }),
      ).success,
    ).toBe(false);
    expect(
      DesignV1Schema.safeParse(validDesign({ mode: "challenge", missionId: null }))
        .success,
    ).toBe(false);
  });

  it("applies challenge inventory limits to parts and connector joints", () => {
    const forbiddenBalloon = validDesign({
      parts: [
        { id: "part-a", materialId: "balloon", transform: transform() },
      ],
      joints: [],
    });
    expect(DesignV1Schema.safeParse(forbiddenBalloon).success).toBe(false);

    const parts: DesignPartV1[] = Array.from({ length: 6 }, (_, index) => ({
      id: `part-${index}`,
      materialId: "straw",
      transform: transform(),
    }));
    const ropeJoints: DesignJointV1[] = Array.from({ length: 5 }, (_, index) => ({
      id: `rope-${index}`,
      kind: "rope",
      materialId: "string",
      bodyA: "part-0",
      bodyB: `part-${index + 1}`,
      anchorA: [0, 0, 0],
      anchorB: [0, 0, 0],
    }));
    expect(
      DesignV1Schema.safeParse(validDesign({ parts, joints: ropeJoints })).success,
    ).toBe(false);
  });

  it("caps designs at 100 parts and 200 joints", () => {
    const overParts = Array.from({ length: MAX_PARTS + 1 }, (_, index) => ({
      id: `part-${index}`,
      materialId: "straw" as const,
      transform: transform(),
    }));
    expect(
      DesignV1Schema.safeParse(
        validDesign({
          mode: "sandbox",
          missionId: null,
          parts: overParts,
          joints: [],
        }),
      ).success,
    ).toBe(false);

    const parts = [
      { id: "part-a", materialId: "straw" as const, transform: transform() },
      { id: "part-b", materialId: "straw" as const, transform: transform() },
    ];
    const overJoints = Array.from({ length: MAX_JOINTS + 1 }, (_, index) => ({
      id: `joint-${index}`,
      kind: "fixed" as const,
      materialId: "tape" as const,
      bodyA: "part-a",
      bodyB: "part-b",
      anchorA: [0, 0, 0] as [number, number, number],
      anchorB: [0, 0, 0] as [number, number, number],
    }));
    expect(
      DesignV1Schema.safeParse(
        validDesign({
          mode: "sandbox",
          missionId: null,
          parts,
          joints: overJoints,
        }),
      ).success,
    ).toBe(false);
  });

  it("rejects unknown object fields", () => {
    expect(
      DesignV1Schema.safeParse({ ...validDesign(), unexpected: true }).success,
    ).toBe(false);
  });
});

describe("payload size helpers", () => {
  it("measures UTF-8 bytes instead of JavaScript code units", () => {
    expect(serializedJsonByteLength("🐣")).toBe(4);
  });

  it("enforces the inclusive 250KB maximum", () => {
    expect(isDesignPayloadWithinLimit("a".repeat(MAX_DESIGN_PAYLOAD_BYTES))).toBe(
      true,
    );
    expect(
      isDesignPayloadWithinLimit("a".repeat(MAX_DESIGN_PAYLOAD_BYTES + 1)),
    ).toBe(false);
    expect(isDesignPayloadWithinLimit(undefined)).toBe(false);
  });
});

describe("response schemas", () => {
  const publicDesign = {
    id: "design-123",
    design: validDesign(),
    version: 1,
    createdAt: "2026-08-21T12:00:00.000Z",
    updatedAt: "2026-08-21T12:00:00.000Z",
  };

  it("validates public and create responses", () => {
    expect(PublicDesignSchema.safeParse(publicDesign).success).toBe(true);
    expect(
      CreateDesignResponseSchema.safeParse({
        ...publicDesign,
        editToken: "a-secure-edit-token",
      }).success,
    ).toBe(true);
  });

  it("validates drop results and API errors", () => {
    expect(
      DropResultSchema.safeParse({
        outcome: "survived",
        heightFt: 25.5,
        impactSpeedMps: 8.2,
        peakG: 38,
        peakForceN: 22,
        damage: 0.475,
        score: 14_200,
      }).success,
    ).toBe(true);
    expect(
      ApiErrorBodySchema.safeParse({
        error: { code: "NOT_FOUND", message: "Design not found" },
      }).success,
    ).toBe(true);
    expect(
      DropResultSchema.safeParse({
        outcome: "broken",
        heightFt: 25,
        impactSpeedMps: 8,
        peakG: 100,
        peakForceN: 50,
        damage: 2,
        score: null,
      }).success,
    ).toBe(false);
  });
});
