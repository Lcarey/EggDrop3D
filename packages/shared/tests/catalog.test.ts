import { describe, expect, it } from "vitest";

import {
  calculateInventoryCost,
  calculateBuoyantForceN,
  calculatePartMassKg,
  MATERIAL_BY_ID,
  MATERIAL_CATALOG,
  MATERIAL_IDS,
  MISSION_BY_ID,
  MISSION_CATALOG,
} from "../src/index.js";

describe("material catalog", () => {
  it("defines each of the 17 locked materials exactly once", () => {
    expect(MATERIAL_CATALOG).toHaveLength(17);
    expect(MATERIAL_CATALOG.map(({ id }) => id)).toEqual(MATERIAL_IDS);
    expect(new Set(MATERIAL_CATALOG.map(({ id }) => id)).size).toBe(17);
  });

  it("provides usable cost, presentation, geometry, and physics metadata", () => {
    for (const material of MATERIAL_CATALOG) {
      expect(material.label.length).toBeGreaterThan(0);
      expect(material.description.length).toBeGreaterThan(0);
      expect(material.color).toMatch(/^#[0-9a-f]{6}$/i);
      expect(material.cost).toBeGreaterThan(0);
      expect(material.behaviors.length).toBeGreaterThan(0);
      expect(material.defaultDimensions.every((value) => value > 0)).toBe(true);
      expect(material.physics.densityKgM3).toBeGreaterThan(0);
      expect(material.physics.friction).toBeGreaterThanOrEqual(0);
      expect(material.physics.restitution).toBeGreaterThanOrEqual(0);
      expect(material.physics.restitution).toBeLessThanOrEqual(1);
      expect(material.physics.cushioning).toBeGreaterThanOrEqual(0);
      expect(material.physics.cushioning).toBeLessThanOrEqual(1);
    }
  });

  it("keeps connector behavior aligned with joint material semantics", () => {
    expect(MATERIAL_BY_ID.tape.behaviors).toContain("fixedJoint");
    expect(MATERIAL_BY_ID.glue.behaviors).toContain("fixedJoint");
    expect(MATERIAL_BY_ID.string.behaviors).toContain("ropeJoint");
    expect(MATERIAL_BY_ID.rubberBand.behaviors).toContain("springJoint");
  });

  it("calibrates an inflated balloon to produce net displaced-air lift", () => {
    const balloon = MATERIAL_BY_ID.balloon;
    const volume = balloon.defaultDimensions.reduce((product, value) => product * value, 1);
    const buoyancy = calculateBuoyantForceN({
      volumeM3: volume,
      buoyancyFactor: balloon.physics.buoyancyFactor,
    });
    const weight = calculatePartMassKg("balloon", balloon.defaultDimensions) * 9.80665;
    expect(balloon.physics.densityKgM3).toBeLessThan(1.225);
    expect(buoyancy).toBeGreaterThan(weight);
  });

  it("keeps the agreed per-piece costs", () => {
    expect(
      Object.fromEntries(MATERIAL_CATALOG.map(({ id, cost }) => [id, cost])),
    ).toEqual({
      straw: 1,
      tape: 1,
      glue: 2,
      balloon: 5,
      bubbleWrap: 4,
      string: 1,
      cardboard: 3,
      craftStick: 2,
      paperCup: 3,
      cottonBall: 1,
      foamBlock: 4,
      sponge: 4,
      rubberBand: 2,
      newspaper: 2,
      plasticBag: 4,
      packingPeanuts: 1,
      fishingWeight: 2,
    });
  });
});

describe("mission catalog", () => {
  it("defines the exact mission progression", () => {
    expect(MISSION_CATALOG.map(({ id, targetHeightFt }) => [id, targetHeightFt])).toEqual([
      ["first-flight", 10],
      ["air-time", 25],
      ["final-drop", 50],
    ]);
    expect(MISSION_CATALOG.every(({ referenceCrackG }) => referenceCrackG === 80)).toBe(
      true,
    );
  });

  it("preserves the locked inventory quantities", () => {
    expect(MISSION_BY_ID["first-flight"].inventory).toEqual({
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
    });
    expect(MISSION_BY_ID["air-time"].inventory.balloon).toBe(4);
    expect(MISSION_BY_ID["air-time"].inventory.plasticBag).toBe(2);
    expect(MISSION_BY_ID["air-time"].inventory.glue).toBe(4);
    expect(MISSION_BY_ID["final-drop"].inventory).toEqual({
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
    });
  });

  it("derives each available budget from inventory and catalog costs", () => {
    for (const mission of MISSION_CATALOG) {
      expect(mission.availableCost).toBe(calculateInventoryCost(mission.inventory));
    }
  });
});
