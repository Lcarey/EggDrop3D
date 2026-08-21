import type { DesignV1, DropOutcome, DropResult } from "./contracts.js";
import { calculateDesignCost } from "./economy.js";
import { MISSION_BY_ID } from "./missions.js";
import { clamp } from "./physics.js";

export interface ScoreInput {
  outcome: DropOutcome;
  heightFt: number;
  targetHeightFt: number;
  usedCost: number;
  availableCost: number;
  peakG: number;
  referenceCrackG: number;
}

export function calculateScore({
  outcome,
  heightFt,
  targetHeightFt,
  usedCost,
  availableCost,
  peakG,
  referenceCrackG,
}: ScoreInput): number | null {
  assertNonNegativeFinite(heightFt, "heightFt");
  assertNonNegativeFinite(targetHeightFt, "targetHeightFt");
  assertNonNegativeFinite(usedCost, "usedCost");
  assertPositiveFinite(availableCost, "availableCost");
  assertNonNegativeFinite(peakG, "peakG");
  assertPositiveFinite(referenceCrackG, "referenceCrackG");

  if (usedCost > availableCost) {
    throw new RangeError("usedCost cannot exceed availableCost");
  }

  if (outcome !== "survived" || heightFt < targetHeightFt) {
    return null;
  }

  return (
    10_000 +
    Math.round(100 * heightFt) +
    Math.round(2_000 * (1 - usedCost / availableCost)) +
    Math.round(1_000 * (1 - clamp(peakG / referenceCrackG, 0, 1)))
  );
}

export function calculateMissionScore(
  design: DesignV1,
  result: Pick<DropResult, "outcome" | "heightFt" | "peakG">,
): number | null {
  if (design.mode !== "challenge" || design.missionId === null) {
    return null;
  }

  const mission = MISSION_BY_ID[design.missionId];
  return calculateScore({
    outcome: result.outcome,
    heightFt: result.heightFt,
    targetHeightFt: mission.targetHeightFt,
    usedCost: calculateDesignCost(design),
    availableCost: mission.availableCost,
    peakG: result.peakG,
    referenceCrackG: mission.referenceCrackG,
  });
}

function assertPositiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive finite number`);
  }
}

function assertNonNegativeFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative finite number`);
  }
}

