import { MATERIAL_BY_ID } from "./catalog.js";
import { MATERIAL_IDS } from "./contracts.js";
import type { DesignV1, MaterialId } from "./contracts.js";

export type MaterialCounts = Record<MaterialId, number>;

export function emptyMaterialCounts(): MaterialCounts {
  return Object.fromEntries(MATERIAL_IDS.map((id) => [id, 0])) as MaterialCounts;
}

export function countDesignMaterials(
  design: Pick<DesignV1, "parts" | "joints">,
): MaterialCounts {
  const counts = emptyMaterialCounts();

  for (const part of design.parts) {
    counts[part.materialId] += 1;
  }

  for (const joint of design.joints) {
    counts[joint.materialId] += 1;
  }

  return counts;
}

export function calculateInventoryCost(
  inventory: Readonly<Record<MaterialId, number>>,
): number {
  return MATERIAL_IDS.reduce(
    (total, materialId) =>
      total + inventory[materialId] * MATERIAL_BY_ID[materialId].cost,
    0,
  );
}

export function calculateDesignCost(
  design: Pick<DesignV1, "parts" | "joints">,
): number {
  const counts = countDesignMaterials(design);
  return calculateInventoryCost(counts);
}

