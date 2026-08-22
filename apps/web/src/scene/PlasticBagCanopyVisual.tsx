import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { DoubleSide, PlaneGeometry } from "three";
import { MATERIAL_VISUALS } from "../editor/materialVisuals";
import type { DropRenderPose } from "./dropInterpolation";
import { calculateCanopyBillow, calculateCanopyBlockage, calculateCanopyBulgeM } from "./parachute";

const CANOPY_SEGMENTS = 12;
/** How much the sheet edge gathers inward when the dome is fully billowed. */
const CANOPY_GATHER_RATIO = 0.12;

type PlasticBagCanopyVisualProps = {
  /** Physics-step poses of the bag body; velocity is derived from them. */
  pose: { previous: DropRenderPose; current: DropRenderPose };
  dimensions: [number, number, number];
  stepSeconds: number;
  /** Poses and masses of bodies joined to the bag, for canopy blockage. */
  loadPoses?: { pose: { current: DropRenderPose }; massKg: number }[];
};

/**
 * Drop-scene visual for the plastic bag. The flat sheet morphs into an
 * upward-bulged dome whose height tracks the bag's descent speed through the
 * shared canopy-billow model, so it billows like a parachute while falling
 * and relaxes flat at rest. Build mode keeps the plain flat PartVisual.
 */
export function PlasticBagCanopyVisual({ pose, dimensions, stepSeconds, loadPoses }: PlasticBagCanopyVisualProps) {
  const [dx, , dz] = dimensions;
  const geometry = useMemo(() => {
    const plane = new PlaneGeometry(dx, dz, CANOPY_SEGMENTS, CANOPY_SEGMENTS);
    plane.rotateX(-Math.PI / 2);
    return plane;
  }, [dx, dz]);
  const basePositions = useMemo(() => Float32Array.from(geometry.attributes.position!.array), [geometry]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const displayedBillow = useRef(0);

  useFrame((_, delta) => {
    const descentSpeed = (pose.previous.position.y - pose.current.position.y) / stepSeconds;
    // Mirror the physics model: a joined payload riding above the sheet
    // blocks inflation, so the visual stays flat when the canopy force does.
    let supportedLoadHeightM = 0;
    if (loadPoses && loadPoses.length > 0) {
      let totalKg = 0;
      let weightedY = 0;
      for (const load of loadPoses) {
        weightedY += load.pose.current.position.y * load.massKg;
        totalKg += load.massKg;
      }
      if (totalKg > 0) supportedLoadHeightM = weightedY / totalKg - pose.current.position.y;
    }
    const target = calculateCanopyBillow(descentSpeed) * (1 - calculateCanopyBlockage(supportedLoadHeightM));
    // Ease toward the physics-driven billow so the dome inflates and relaxes
    // smoothly instead of popping between frames.
    displayedBillow.current += (target - displayedBillow.current) * (1 - Math.exp(-delta * 8));
    const billow = displayedBillow.current;
    const bulge = calculateCanopyBulgeM(billow, dimensions);
    const position = geometry.attributes.position!;
    const halfX = dx / 2;
    const halfZ = dz / 2;
    for (let index = 0; index < position.count; index += 1) {
      const baseX = basePositions[index * 3]!;
      const baseZ = basePositions[index * 3 + 2]!;
      const radial = Math.min(1, (baseX / halfX) ** 2 + (baseZ / halfZ) ** 2);
      // The sheet is inextensible: as the dome rises the rim gathers inward.
      const gather = 1 - CANOPY_GATHER_RATIO * billow * radial;
      position.setXYZ(index, baseX * gather, bulge * (1 - radial), baseZ * gather);
    }
    position.needsUpdate = true;
    geometry.computeVertexNormals();
  });

  return (
    <mesh geometry={geometry} castShadow>
      <meshPhysicalMaterial
        color={MATERIAL_VISUALS.plasticBag.color}
        transparent
        opacity={0.62}
        roughness={0.18}
        metalness={0}
        side={DoubleSide}
      />
    </mesh>
  );
}
