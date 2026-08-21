export const MATERIAL_IDS = [
  "straw",
  "tape",
  "glue",
  "balloon",
  "bubbleWrap",
  "string",
  "cardboard",
  "craftStick",
  "paperCup",
  "cottonBall",
  "foamBlock",
  "sponge",
  "rubberBand",
  "newspaper",
  "plasticBag",
  "packingPeanuts",
  "fishingWeight",
] as const;

export type MaterialId = (typeof MATERIAL_IDS)[number];

export const MISSION_IDS = ["first-flight", "air-time", "final-drop"] as const;

export type MissionId = (typeof MISSION_IDS)[number];

export const DESIGN_MODES = ["sandbox", "challenge"] as const;

export type DesignMode = (typeof DESIGN_MODES)[number];

export const JOINT_KINDS = ["fixed", "rope", "spring"] as const;

export type JointKind = (typeof JOINT_KINDS)[number];
export type JointMaterialId = "tape" | "glue" | "string" | "rubberBand";

export type Vec3 = [number, number, number];
export type Quaternion = [number, number, number, number];

export interface Transform {
  position: Vec3;
  rotation: Quaternion;
  dimensions: Vec3;
}

export interface DesignPartV1 {
  id: string;
  materialId: MaterialId;
  transform: Transform;
}

export interface DesignJointV1 {
  id: string;
  kind: JointKind;
  materialId: JointMaterialId;
  bodyA: string;
  bodyB: string;
  anchorA: Vec3;
  anchorB: Vec3;
}

export interface DesignV1 {
  schemaVersion: 1;
  physicsVersion: 1;
  name: string;
  mode: DesignMode;
  missionId: MissionId | null;
  heightFt: number;
  eggTransform: Transform;
  parts: DesignPartV1[];
  joints: DesignJointV1[];
}

export const DROP_OUTCOMES = ["survived", "cracked"] as const;

export type DropOutcome = (typeof DROP_OUTCOMES)[number];

export interface DropResult {
  outcome: DropOutcome;
  heightFt: number;
  impactSpeedMps: number;
  peakG: number;
  peakForceN: number;
  damage: number;
  score: number | null;
}

export interface PublicDesign {
  id: string;
  design: DesignV1;
  version: number;
  createdAt: string;
  updatedAt: string;
  derivedFromId?: string;
}

export interface CreateDesignResponse extends PublicDesign {
  editToken: string;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export type MaterialCategory =
  | "structure"
  | "connector"
  | "cushion"
  | "aerodynamic";

export type MaterialBehavior =
  | "rigid"
  | "flexible"
  | "fixedJoint"
  | "ropeJoint"
  | "springJoint"
  | "cushion"
  | "drag"
  | "buoyant";

export type MaterialGeometry =
  | "rod"
  | "strip"
  | "sphere"
  | "sheet"
  | "rope"
  | "box"
  | "cup"
  | "puff"
  | "bag"
  | "cluster";

export interface MaterialPhysics {
  densityKgM3: number;
  friction: number;
  restitution: number;
  linearDamping: number;
  angularDamping: number;
  dragCoefficient: number;
  cushioning: number;
  buoyancyFactor: number;
  breakForceN: number;
}

export interface MaterialDefinition {
  id: MaterialId;
  label: string;
  description: string;
  category: MaterialCategory;
  behaviors: readonly MaterialBehavior[];
  geometry: MaterialGeometry;
  cost: number;
  color: string;
  defaultDimensions: Vec3;
  physics: Readonly<MaterialPhysics>;
}

export interface MissionDefinition {
  id: MissionId;
  label: string;
  description: string;
  targetHeightFt: number;
  availableCost: number;
  referenceCrackG: number;
  inventory: Readonly<Record<MaterialId, number>>;
}

export type EggDamageState = DropOutcome;
