import { describe, expect, it } from "vitest";
import { DesignV1Schema } from "@eggdrop/shared";

import {
  ALL_SPECS,
  VALIDATION_SPECS,
  VALIDATION_VARIANTS,
  PLANET_INDEX,
} from "../../e2e/validation/designs";

// Every corpus design must be schema-valid before the Playwright campaign
// runs: an invalid draft would silently fall back to the bare-egg default and
// produce false verdicts (AGENTS.md section 1, reproduce fidelity).
describe("physics validation corpus", () => {
  it("has 100 base structures with unique ids", () => {
    expect(VALIDATION_SPECS).toHaveLength(100);
    const ids = new Set(ALL_SPECS.map((spec) => spec.id));
    expect(ids.size).toBe(ALL_SPECS.length);
  });

  it("uses all 17 materials and all 8 planets somewhere", () => {
    const materials = new Set<string>();
    const planets = new Set<string>();
    for (const spec of VALIDATION_SPECS) {
      planets.add(spec.settings.planet);
      for (const part of spec.design.parts) materials.add(part.materialId);
      for (const joint of spec.design.joints) materials.add(joint.materialId);
    }
    expect(planets.size).toBe(Object.keys(PLANET_INDEX).length);
    expect(materials.size).toBe(17);
  });

  it("keeps variants keyed to an existing parent structure", () => {
    const baseIds = new Set(VALIDATION_SPECS.map((spec) => spec.id));
    for (const variant of VALIDATION_VARIANTS) {
      expect(variant.parentId, `${variant.id} needs parentId`).toBeTruthy();
      expect(baseIds.has(variant.parentId!), `${variant.id} parent ${variant.parentId}`).toBe(true);
    }
  });

  for (const spec of ALL_SPECS) {
    it(`${spec.id} is DesignV1Schema-valid`, () => {
      const parsed = DesignV1Schema.safeParse(spec.design);
      const issues = parsed.success ? "" : JSON.stringify(parsed.error.issues, null, 2);
      expect(parsed.success, issues).toBe(true);
      expect(spec.design.heightFt).toBe(spec.settings.heightFt);
    });
  }
});
