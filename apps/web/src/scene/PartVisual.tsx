import { Line } from "@react-three/drei";
import type { MaterialId } from "@eggdrop/shared";
import {
  BoxGeometry,
  type BufferGeometry,
  CapsuleGeometry,
  CircleGeometry,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  DoubleSide,
  IcosahedronGeometry,
  type Material,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  SphereGeometry,
  TorusGeometry,
} from "three";
import { RoundedBoxGeometry } from "three-stdlib";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { MATERIAL_VISUALS } from "../editor/materialVisuals";
import { EggVisual } from "./EggVisual";
import { getCardboardBump, getCardboardMap, getNewsprintMap, getStrawMap } from "./partTextures";

export { EggVisual };

type PartVisualProps = {
  materialId: MaterialId;
  selected?: boolean;
  ghost?: boolean;
};

// ---------------------------------------------------------------------------
// Shared geometry. Every part instance references these module-level
// singletons instead of allocating its own copies on mount, and multi-blob
// parts (bubble bumps, cotton, peanuts) are pre-merged into one buffer each so
// a part costs one draw call instead of up to ten.
// ---------------------------------------------------------------------------

type Placed = {
  geometry: BufferGeometry;
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: [number, number, number];
};

const mergePlaced = (parts: Placed[]): BufferGeometry => {
  const clones = parts.map(({ geometry, position, rotation, scale }) => {
    const clone = geometry.clone();
    if (scale) clone.scale(...scale);
    if (rotation) {
      clone.rotateX(rotation[0]);
      clone.rotateY(rotation[1]);
      clone.rotateZ(rotation[2]);
    }
    if (position) clone.translate(...position);
    return clone;
  });
  const merged = mergeGeometries(clones);
  for (const clone of clones) clone.dispose();
  if (!merged) throw new Error("PartVisual: failed to merge geometries");
  return merged;
};

const UNIT_BOX = new BoxGeometry(1, 1, 1);
const STRAW_TUBE = new CylinderGeometry(0.42, 0.42, 1, 18);
const BALLOON_BODY = new SphereGeometry(0.5, 28, 20);
const BALLOON_KNOT = new ConeGeometry(0.08, 0.15, 10);
const ROUNDED_CRAFT = new RoundedBoxGeometry(1, 1, 1, 3, 0.24);
const ROUNDED_FOAM = new RoundedBoxGeometry(1, 1, 1, 2, 0.08);
const ROUNDED_SPONGE = new RoundedBoxGeometry(1, 1, 1, 3, 0.12);
const CUP_WALL = new CylinderGeometry(0.44, 0.31, 1, 24, 1, true);
const CUP_BASE = new CircleGeometry(0.31, 24);
const NEWSPAPER_WAD = new IcosahedronGeometry(0.55, 1);
const WEIGHT_BODY = new SphereGeometry(0.44, 20, 16);
const WEIGHT_LOOP = new TorusGeometry(0.07, 0.028, 8, 14);

const bubbleTemplate = new SphereGeometry(1, 12, 8);
const BUBBLE_BUMPS = mergePlaced(
  [-0.3, 0, 0.3].flatMap((x) => [-0.3, 0, 0.3].map((z): Placed => ({
    geometry: bubbleTemplate,
    scale: [0.16, 0.12, 0.16],
    position: [x, 0.58, z],
  }))),
);

const cottonTemplate = new DodecahedronGeometry(0.38, 1);
const COTTON_CLUMP = mergePlaced([
  { geometry: cottonTemplate },
  { geometry: cottonTemplate, position: [0.25, 0.08, 0] },
  { geometry: cottonTemplate, position: [-0.2, 0.13, 0.1] },
  { geometry: cottonTemplate, position: [0.05, -0.18, -0.14] },
]);

const peanutTemplate = new CapsuleGeometry(0.2, 0.42, 5, 10);
const PEANUT_PILE = mergePlaced([
  { geometry: peanutTemplate, position: [-0.23, 0.02, 0] },
  { geometry: peanutTemplate, rotation: [0, 0, 0.75], position: [0.2, 0.13, 0.03] },
  { geometry: peanutTemplate, rotation: [0, 0, 1.5], position: [0, -0.18, -0.13] },
]);

bubbleTemplate.dispose();
cottonTemplate.dispose();
peanutTemplate.dispose();

// ---------------------------------------------------------------------------
// Shared materials, cached per (materialId, selected, ghost). The full app
// needs only a few dozen combinations, so this eliminates per-instance
// material allocation and lets the renderer batch identical materials.
// ---------------------------------------------------------------------------

const finish = (materialId: MaterialId, selected: boolean, ghost: boolean) => {
  const material = MATERIAL_VISUALS[materialId];
  return {
    color: ghost ? "#58c789" : material.color,
    roughness: materialId === "balloon" || materialId === "plasticBag" ? 0.28 : 0.72,
    metalness: 0,
    transparent: ghost || materialId === "bubbleWrap" || materialId === "plasticBag",
    opacity: ghost ? 0.46 : materialId === "plasticBag" ? 0.62 : materialId === "bubbleWrap" ? 0.74 : 1,
    emissive: selected ? "#2b80ce" : "#000000",
    emissiveIntensity: selected ? 0.22 : 0,
  };
};

type PartMaterials = Record<string, Material>;

const materialCache = new Map<string, PartMaterials>();

const getMaterials = (materialId: MaterialId, selected: boolean, ghost: boolean): PartMaterials => {
  const key = `${materialId}|${selected ? 1 : 0}|${ghost ? 1 : 0}`;
  const existing = materialCache.get(key);
  if (existing) return existing;

  const base = finish(materialId, selected, ghost);
  let materials: PartMaterials;
  switch (materialId) {
    case "straw": {
      const map = ghost ? null : getStrawMap(MATERIAL_VISUALS.straw.color);
      materials = { body: new MeshStandardMaterial({ ...base, ...(map ? { map, color: "#ffffff" } : {}) }) };
      break;
    }
    case "balloon":
      materials = {
        body: new MeshPhysicalMaterial({ ...base, roughness: 0.18, clearcoat: 0.9, clearcoatRoughness: 0.12, envMapIntensity: 1.4 }),
        knot: new MeshStandardMaterial(base),
      };
      break;
    case "bubbleWrap":
      materials = { body: new MeshPhysicalMaterial({ ...base, transmission: ghost ? 0 : 0.12, envMapIntensity: 1.1 }) };
      break;
    case "cardboard": {
      const map = ghost ? null : getCardboardMap();
      const bumpMap = ghost ? null : getCardboardBump();
      materials = {
        body: new MeshStandardMaterial({
          ...base,
          roughness: 0.9,
          ...(map ? { map } : {}),
          ...(bumpMap ? { bumpMap, bumpScale: 0.4 } : {}),
        }),
      };
      break;
    }
    case "paperCup":
      materials = {
        wall: new MeshStandardMaterial({ ...base, side: DoubleSide }),
        base: new MeshStandardMaterial(base),
      };
      break;
    case "newspaper": {
      const map = ghost ? null : getNewsprintMap();
      materials = { body: new MeshStandardMaterial({ ...base, roughness: 1, flatShading: true, ...(map ? { map, color: "#ffffff" } : {}) }) };
      break;
    }
    case "plasticBag":
      materials = { body: new MeshPhysicalMaterial({ ...base, side: DoubleSide, roughness: 0.18, envMapIntensity: 1.2 }) };
      break;
    case "fishingWeight":
      materials = { body: new MeshStandardMaterial({ ...base, metalness: 0.72, roughness: 0.34, envMapIntensity: 1.3 }) };
      break;
    case "cottonBall":
    case "sponge":
      materials = { body: new MeshStandardMaterial({ ...base, roughness: 1 }) };
      break;
    case "foamBlock":
      materials = { body: new MeshStandardMaterial({ ...base, roughness: 0.95 }) };
      break;
    case "packingPeanuts":
      materials = { body: new MeshStandardMaterial({ ...base, roughness: 0.9 }) };
      break;
    default:
      materials = { body: new MeshStandardMaterial(base) };
  }
  materialCache.set(key, materials);
  return materials;
};

export function PartVisual({ materialId, selected = false, ghost = false }: PartVisualProps) {
  const materials = getMaterials(materialId, selected, ghost);
  switch (materialId) {
    case "straw":
      return <mesh castShadow receiveShadow geometry={STRAW_TUBE} material={materials.body} />;
    case "balloon":
      return (
        <group>
          <mesh castShadow scale={[0.95, 1.08, 0.95]} geometry={BALLOON_BODY} material={materials.body} />
          <mesh position={[0, -0.53, 0]} rotation={[0, 0, Math.PI / 4]} geometry={BALLOON_KNOT} material={materials.knot} />
        </group>
      );
    case "bubbleWrap":
      return (
        <group>
          <mesh castShadow receiveShadow geometry={UNIT_BOX} material={materials.body} />
          <mesh geometry={BUBBLE_BUMPS} material={materials.body} />
        </group>
      );
    case "cardboard":
      return <mesh castShadow receiveShadow geometry={UNIT_BOX} material={materials.body} />;
    case "craftStick":
      return <mesh castShadow geometry={ROUNDED_CRAFT} material={materials.body} />;
    case "paperCup":
      return (
        <group>
          <mesh castShadow geometry={CUP_WALL} material={materials.wall} />
          <mesh position={[0, -0.49, 0]} rotation={[-Math.PI / 2, 0, 0]} geometry={CUP_BASE} material={materials.base} />
        </group>
      );
    case "cottonBall":
      return <mesh castShadow geometry={COTTON_CLUMP} material={materials.body} />;
    case "foamBlock":
      return <mesh castShadow receiveShadow geometry={ROUNDED_FOAM} material={materials.body} />;
    case "sponge":
      return <mesh castShadow receiveShadow geometry={ROUNDED_SPONGE} material={materials.body} />;
    case "newspaper":
      return <mesh castShadow geometry={NEWSPAPER_WAD} material={materials.body} />;
    case "packingPeanuts":
      return <mesh castShadow geometry={PEANUT_PILE} material={materials.body} />;
    case "plasticBag":
      return (
        <group>
          <mesh castShadow geometry={UNIT_BOX} material={materials.body} />
          <Line points={[[-.42, 0, -.48], [0, -.55, 0], [.42, 0, -.48]]} color="#82b7d9" lineWidth={1.2} />
          <Line points={[[-.42, 0, .48], [0, -.55, 0], [.42, 0, .48]]} color="#82b7d9" lineWidth={1.2} />
        </group>
      );
    case "fishingWeight":
      return (
        <group>
          <mesh castShadow receiveShadow position={[0, -0.04, 0]} scale={[0.9, 1.04, 0.9]} geometry={WEIGHT_BODY} material={materials.body} />
          <mesh castShadow position={[0, 0.44, 0]} geometry={WEIGHT_LOOP} material={materials.body} />
        </group>
      );
    default:
      return null;
  }
}
