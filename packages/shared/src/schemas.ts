import { z } from "zod";

import {
  DESIGN_MODES,
  DROP_OUTCOMES,
  JOINT_KINDS,
  MATERIAL_IDS,
  MISSION_IDS,
} from "./contracts.js";
import type {
  ApiErrorBody,
  CreateDesignResponse,
  DesignJointV1,
  DesignPartV1,
  DesignV1,
  DropResult,
  PublicDesign,
  Quaternion,
  Transform,
  Vec3,
} from "./contracts.js";
import { countDesignMaterials } from "./economy.js";
import { MISSION_BY_ID } from "./missions.js";
import {
  isDesignPayloadWithinLimit,
  MAX_DESIGN_PAYLOAD_BYTES,
} from "./payload.js";

export const MAX_PARTS = 100;
export const MAX_JOINTS = 200;
export const MIN_DROP_HEIGHT_FT = 5;
export const MAX_DROP_HEIGHT_FT = 50;
export const MAX_DESIGN_NAME_LENGTH = 60;

const finiteNumber = z.number().finite();
const nonNegativeFiniteNumber = finiteNumber.min(0);
const idSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9_-]*$/,
    "IDs may contain only letters, numbers, underscores, and hyphens",
  );

export const EntityIdSchema = idSchema;
export const MaterialIdSchema = z.enum(MATERIAL_IDS);
export const MissionIdSchema = z.enum(MISSION_IDS);
export const DesignModeSchema = z.enum(DESIGN_MODES);
export const JointKindSchema = z.enum(JOINT_KINDS);
export const JointMaterialIdSchema = z.enum(["tape", "glue", "string", "rubberBand"]);
export const DropOutcomeSchema = z.enum(DROP_OUTCOMES);

export const Vec3Schema: z.ZodType<Vec3> = z.tuple([
  finiteNumber,
  finiteNumber,
  finiteNumber,
]);

export const QuaternionSchema: z.ZodType<Quaternion> = z
  .tuple([finiteNumber, finiteNumber, finiteNumber, finiteNumber])
  .superRefine((rotation, context) => {
    const magnitudeSquared = rotation.reduce(
      (total, component) => total + component * component,
      0,
    );
    if (magnitudeSquared <= Number.EPSILON) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Rotation quaternion cannot be the zero quaternion",
      });
    }
  });

const DimensionsSchema: z.ZodType<Vec3> = z.tuple([
  finiteNumber.positive(),
  finiteNumber.positive(),
  finiteNumber.positive(),
]);

export const TransformSchema: z.ZodType<Transform> = z.strictObject({
  position: Vec3Schema,
  rotation: QuaternionSchema,
  dimensions: DimensionsSchema,
});

export const DesignPartV1Schema: z.ZodType<DesignPartV1> = z.strictObject({
  id: EntityIdSchema,
  materialId: MaterialIdSchema,
  transform: TransformSchema,
});

export const DesignJointV1Schema: z.ZodType<DesignJointV1> = z
  .strictObject({
    id: EntityIdSchema,
    kind: JointKindSchema,
    materialId: JointMaterialIdSchema,
    bodyA: EntityIdSchema,
    bodyB: EntityIdSchema,
    anchorA: Vec3Schema,
    anchorB: Vec3Schema,
  })
  .superRefine((joint, context) => {
    if (joint.bodyA === joint.bodyB) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A joint must connect two different bodies",
        path: ["bodyB"],
      });
    }

    const allowedMaterials = {
      fixed: ["tape", "glue"],
      rope: ["string"],
      spring: ["rubberBand"],
    } as const;

    if (!(allowedMaterials[joint.kind] as readonly string[]).includes(joint.materialId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${joint.kind} joints must use ${allowedMaterials[joint.kind].join(" or ")}`,
        path: ["materialId"],
      });
    }
  });

const DesignV1BaseSchema = z.strictObject({
  schemaVersion: z.literal(1),
  physicsVersion: z.literal(1),
  name: z.string().trim().min(1).max(MAX_DESIGN_NAME_LENGTH),
  mode: DesignModeSchema,
  missionId: MissionIdSchema.nullable(),
  heightFt: finiteNumber.min(MIN_DROP_HEIGHT_FT).max(MAX_DROP_HEIGHT_FT),
  eggTransform: TransformSchema,
  parts: z.array(DesignPartV1Schema).max(MAX_PARTS),
  joints: z.array(DesignJointV1Schema).max(MAX_JOINTS),
});

export const DesignV1Schema: z.ZodType<DesignV1> = DesignV1BaseSchema.superRefine(
  (design, context) => {
    if (design.mode === "sandbox" && design.missionId !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Sandbox designs cannot select a mission",
        path: ["missionId"],
      });
    }

    if (design.mode === "challenge" && design.missionId === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Challenge designs must select a mission",
        path: ["missionId"],
      });
    }

    const partIds = new Set<string>();
    const allEntityIds = new Set<string>();

    design.parts.forEach((part, index) => {
      if (part.id === "egg") {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "The part ID 'egg' is reserved for the egg body",
          path: ["parts", index, "id"],
        });
      }
      if (partIds.has(part.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate part ID: ${part.id}`,
          path: ["parts", index, "id"],
        });
      }
      partIds.add(part.id);
      allEntityIds.add(part.id);
    });

    design.joints.forEach((joint, index) => {
      if (allEntityIds.has(joint.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate entity ID: ${joint.id}`,
          path: ["joints", index, "id"],
        });
      }
      allEntityIds.add(joint.id);

      if (joint.bodyA !== "egg" && !partIds.has(joint.bodyA)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Joint references missing body: ${joint.bodyA}`,
          path: ["joints", index, "bodyA"],
        });
      }

      if (joint.bodyB !== "egg" && !partIds.has(joint.bodyB)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Joint references missing body: ${joint.bodyB}`,
          path: ["joints", index, "bodyB"],
        });
      }
    });

    if (design.mode === "challenge" && design.missionId !== null) {
      const mission = MISSION_BY_ID[design.missionId];
      const counts = countDesignMaterials(design);

      for (const materialId of MATERIAL_IDS) {
        if (counts[materialId] > mission.inventory[materialId]) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: `${materialId} count ${counts[materialId]} exceeds mission limit ${mission.inventory[materialId]}`,
            path: ["parts"],
          });
        }
      }
    }

    if (!isDesignPayloadWithinLimit(design)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Design payload exceeds ${MAX_DESIGN_PAYLOAD_BYTES} bytes`,
      });
    }
  },
);

export const DropResultSchema: z.ZodType<DropResult> = z.strictObject({
  outcome: DropOutcomeSchema,
  heightFt: finiteNumber.min(MIN_DROP_HEIGHT_FT).max(MAX_DROP_HEIGHT_FT),
  impactSpeedMps: nonNegativeFiniteNumber,
  peakG: nonNegativeFiniteNumber,
  peakForceN: nonNegativeFiniteNumber,
  damage: finiteNumber.min(0).max(1),
  score: z.number().int().min(0).nullable(),
});

const isoTimestampSchema = z.string().datetime({ offset: true });

export const PublicDesignSchema: z.ZodType<PublicDesign> = z.strictObject({
  id: EntityIdSchema,
  design: DesignV1Schema,
  version: z.number().int().positive(),
  createdAt: isoTimestampSchema,
  updatedAt: isoTimestampSchema,
  derivedFromId: EntityIdSchema.optional(),
});

export const CreateDesignResponseSchema: z.ZodType<CreateDesignResponse> =
  z.strictObject({
    id: EntityIdSchema,
    design: DesignV1Schema,
    version: z.number().int().positive(),
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
    derivedFromId: EntityIdSchema.optional(),
    editToken: z.string().min(16).max(512),
  });

export const ApiErrorBodySchema: z.ZodType<ApiErrorBody> = z.strictObject({
  error: z.strictObject({
    code: z.string().min(1).max(64),
    message: z.string().min(1).max(500),
    details: z.unknown().optional(),
  }),
});

export function parseDesignV1(value: unknown): DesignV1 {
  return DesignV1Schema.parse(value);
}
