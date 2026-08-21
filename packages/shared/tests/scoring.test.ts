import { describe, expect, it } from "vitest";

import {
  calculateDesignCost,
  calculateMissionScore,
  calculateScore,
  MISSION_BY_ID,
} from "../src/index.js";
import { validDesign } from "./fixtures.js";

describe("calculateScore", () => {
  it("implements the locked score formula", () => {
    expect(
      calculateScore({
        outcome: "survived",
        heightFt: 25,
        targetHeightFt: 25,
        usedCost: 25,
        availableCost: 100,
        peakG: 40,
        referenceCrackG: 80,
      }),
    ).toBe(14_500);
  });

  it("returns null unless the egg survives at or above mission height", () => {
    const input = {
      outcome: "survived" as const,
      heightFt: 24.99,
      targetHeightFt: 25,
      usedCost: 25,
      availableCost: 100,
      peakG: 40,
      referenceCrackG: 80,
    };
    expect(calculateScore(input)).toBeNull();
    expect(calculateScore({ ...input, outcome: "cracked", heightFt: 25 })).toBeNull();
  });

  it("clamps only the peak-G score component", () => {
    expect(
      calculateScore({
        outcome: "survived",
        heightFt: 10,
        targetHeightFt: 10,
        usedCost: 100,
        availableCost: 100,
        peakG: 160,
        referenceCrackG: 80,
      }),
    ).toBe(11_000);
  });
});

describe("calculateMissionScore", () => {
  it("derives budget and used cost from the mission and design", () => {
    const design = validDesign();
    const mission = MISSION_BY_ID["first-flight"];
    const expected = calculateScore({
      outcome: "survived",
      heightFt: 10,
      targetHeightFt: mission.targetHeightFt,
      usedCost: calculateDesignCost(design),
      availableCost: mission.availableCost,
      peakG: 20,
      referenceCrackG: mission.referenceCrackG,
    });
    expect(
      calculateMissionScore(design, {
        outcome: "survived",
        heightFt: 10,
        peakG: 20,
      }),
    ).toBe(expected);
  });

  it("does not score sandbox designs", () => {
    expect(
      calculateMissionScore(
        validDesign({ mode: "sandbox", missionId: null }),
        { outcome: "survived", heightFt: 50, peakG: 1 },
      ),
    ).toBeNull();
  });
});

