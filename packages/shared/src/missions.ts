import type { MaterialId, MissionDefinition, MissionId } from "./contracts.js";
import { calculateInventoryCost } from "./economy.js";

function mission(
  definition: Omit<MissionDefinition, "availableCost">,
): MissionDefinition {
  return {
    ...definition,
    availableCost: calculateInventoryCost(definition.inventory),
  };
}

const FIRST_FLIGHT_INVENTORY = {
  straw: 12,
  tape: 10,
  glue: 6,
  balloon: 0,
  bubbleWrap: 4,
  string: 4,
  cardboard: 4,
  craftStick: 8,
  paperCup: 4,
  cottonBall: 8,
  foamBlock: 2,
  sponge: 2,
  rubberBand: 2,
  newspaper: 4,
  plasticBag: 0,
  packingPeanuts: 6,
  fishingWeight: 0,
} as const satisfies Readonly<Record<MaterialId, number>>;

const AIR_TIME_INVENTORY = {
  straw: 10,
  tape: 8,
  glue: 4,
  balloon: 4,
  bubbleWrap: 2,
  string: 8,
  cardboard: 3,
  craftStick: 4,
  paperCup: 2,
  cottonBall: 4,
  foamBlock: 2,
  sponge: 2,
  rubberBand: 4,
  newspaper: 2,
  plasticBag: 2,
  packingPeanuts: 4,
  fishingWeight: 2,
} as const satisfies Readonly<Record<MaterialId, number>>;

const FINAL_DROP_INVENTORY = {
  straw: 10,
  tape: 8,
  glue: 4,
  balloon: 3,
  bubbleWrap: 3,
  string: 6,
  cardboard: 3,
  craftStick: 6,
  paperCup: 3,
  cottonBall: 6,
  foamBlock: 3,
  sponge: 3,
  rubberBand: 4,
  newspaper: 4,
  plasticBag: 2,
  packingPeanuts: 6,
  fishingWeight: 2,
} as const satisfies Readonly<Record<MaterialId, number>>;

export const MISSION_CATALOG = [
  mission({
    id: "first-flight",
    label: "First Flight",
    description: "Protect the egg on a 10-foot introductory drop.",
    targetHeightFt: 10,
    referenceCrackG: 80,
    inventory: FIRST_FLIGHT_INVENTORY,
  }),
  mission({
    id: "air-time",
    label: "Air Time",
    description: "Use drag and lift to survive from at least 25 feet.",
    targetHeightFt: 25,
    referenceCrackG: 80,
    inventory: AIR_TIME_INVENTORY,
  }),
  mission({
    id: "final-drop",
    label: "Final Drop",
    description: "Engineer a complete system for the full 50-foot drop.",
    targetHeightFt: 50,
    referenceCrackG: 80,
    inventory: FINAL_DROP_INVENTORY,
  }),
] as const satisfies readonly MissionDefinition[];

export const MISSION_BY_ID: Readonly<Record<MissionId, MissionDefinition>> =
  Object.freeze(
    Object.fromEntries(MISSION_CATALOG.map((item) => [item.id, item])) as Record<
      MissionId,
      MissionDefinition
    >,
  );

export function getMission(missionId: MissionId): MissionDefinition {
  return MISSION_BY_ID[missionId];
}

