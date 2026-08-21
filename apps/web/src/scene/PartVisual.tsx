import { Line, RoundedBox } from "@react-three/drei";
import type { MaterialId, Transform } from "@eggdrop/shared";
import { DoubleSide } from "three";
import { MATERIAL_VISUALS } from "../editor/materialVisuals";

type PartVisualProps = {
  materialId: MaterialId;
  selected?: boolean;
  ghost?: boolean;
};

const finish = (materialId: MaterialId, selected = false, ghost = false) => {
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

export function PartVisual({ materialId, selected = false, ghost = false }: PartVisualProps) {
  const props = finish(materialId, selected, ghost);
  switch (materialId) {
    case "straw":
      return <mesh castShadow receiveShadow><cylinderGeometry args={[0.42, 0.42, 1, 18]} /><meshStandardMaterial {...props} /></mesh>;
    case "balloon":
      return (
        <group>
          <mesh castShadow scale={[0.95, 1.08, 0.95]}><sphereGeometry args={[0.5, 28, 20]} /><meshPhysicalMaterial {...props} roughness={0.2} clearcoat={0.7} /></mesh>
          <mesh position={[0, -0.53, 0]} rotation={[0, 0, Math.PI / 4]}><coneGeometry args={[0.08, 0.15, 10]} /><meshStandardMaterial {...props} /></mesh>
        </group>
      );
    case "bubbleWrap":
      return (
        <group>
          <mesh castShadow receiveShadow><boxGeometry args={[1, 1, 1]} /><meshPhysicalMaterial {...props} transmission={ghost ? 0 : 0.12} /></mesh>
          {[-0.3, 0, 0.3].flatMap((x) => [-0.3, 0, 0.3].map((z) => (
            <mesh key={`${x}-${z}`} position={[x, 0.58, z]} scale={[0.16, 0.12, 0.16]}><sphereGeometry args={[1, 12, 8]} /><meshPhysicalMaterial {...props} /></mesh>
          )))}
        </group>
      );
    case "cardboard":
      return <mesh castShadow receiveShadow><boxGeometry args={[1, 1, 1]} /><meshStandardMaterial {...props} roughness={0.9} /></mesh>;
    case "craftStick":
      return <RoundedBox args={[1, 1, 1]} radius={0.24} smoothness={3} castShadow><meshStandardMaterial {...props} /></RoundedBox>;
    case "paperCup":
      return (
        <group>
          <mesh castShadow><cylinderGeometry args={[0.44, 0.31, 1, 24, 1, true]} /><meshStandardMaterial {...props} side={DoubleSide} /></mesh>
          <mesh position={[0, -0.49, 0]} rotation={[-Math.PI / 2, 0, 0]}><circleGeometry args={[0.31, 24]} /><meshStandardMaterial {...props} /></mesh>
        </group>
      );
    case "cottonBall":
      return (
        <group>
          {[[0, 0, 0], [.25, .08, 0], [-.2, .13, .1], [.05, -.18, -.14]].map((position, index) => (
            <mesh key={index} position={position as [number, number, number]} castShadow><dodecahedronGeometry args={[0.38, 1]} /><meshStandardMaterial {...props} roughness={1} /></mesh>
          ))}
        </group>
      );
    case "foamBlock":
      return <RoundedBox args={[1, 1, 1]} radius={0.08} smoothness={2} castShadow receiveShadow><meshStandardMaterial {...props} roughness={0.95} /></RoundedBox>;
    case "sponge":
      return <RoundedBox args={[1, 1, 1]} radius={0.12} smoothness={3} castShadow receiveShadow><meshStandardMaterial {...props} roughness={1} /></RoundedBox>;
    case "newspaper":
      return <mesh castShadow><icosahedronGeometry args={[0.55, 1]} /><meshStandardMaterial {...props} roughness={1} flatShading /></mesh>;
    case "plasticBag":
      return (
        <group>
          <mesh castShadow><boxGeometry args={[1, 1, 1]} /><meshPhysicalMaterial {...props} side={DoubleSide} roughness={0.18} /></mesh>
          <Line points={[[-.42, 0, -.48], [0, -.55, 0], [.42, 0, -.48]]} color="#82b7d9" lineWidth={1.2} />
          <Line points={[[-.42, 0, .48], [0, -.55, 0], [.42, 0, .48]]} color="#82b7d9" lineWidth={1.2} />
        </group>
      );
    case "fishingWeight":
      return (
        <group>
          <mesh castShadow receiveShadow position={[0, -0.04, 0]} scale={[0.9, 1.04, 0.9]}><sphereGeometry args={[0.44, 20, 16]} /><meshStandardMaterial {...props} metalness={0.72} roughness={0.34} /></mesh>
          <mesh castShadow position={[0, 0.44, 0]}><torusGeometry args={[0.07, 0.028, 8, 14]} /><meshStandardMaterial {...props} metalness={0.72} roughness={0.34} /></mesh>
        </group>
      );
    case "packingPeanuts":
      return (
        <group>
          {[[-.23, .02, 0], [.2, .13, .03], [0, -.18, -.13]].map((position, index) => (
            <mesh key={index} position={position as [number, number, number]} rotation={[0, 0, index * .75]} castShadow><capsuleGeometry args={[0.2, 0.42, 5, 10]} /><meshStandardMaterial {...props} roughness={.9} /></mesh>
          ))}
        </group>
      );
    default:
      return null;
  }
}

export function EggVisual({ transform, selected = false, cracked = false }: { transform: Transform; selected?: boolean; cracked?: boolean }) {
  if (cracked) {
    return (
      <group scale={transform.dimensions}>
        <mesh position={[-.35, 0, 0]} rotation={[0, 0, .45]} castShadow><sphereGeometry args={[.52, 24, 16, 0, Math.PI]} /><meshStandardMaterial color="#f7ead2" roughness={.72} side={DoubleSide} /></mesh>
        <mesh position={[.35, 0, 0]} rotation={[0, Math.PI, -.45]} castShadow><sphereGeometry args={[.52, 24, 16, 0, Math.PI]} /><meshStandardMaterial color="#f7ead2" roughness={.72} side={DoubleSide} /></mesh>
        <mesh position={[0, -.3, 0]} scale={[.46,.18,.46]}><sphereGeometry args={[.5,20,12]} /><meshPhysicalMaterial color="#f7ac1a" roughness={.3} /></mesh>
      </group>
    );
  }
  return (
    <group scale={transform.dimensions}>
      <mesh castShadow receiveShadow scale={[5, 5, 5]}>
        <sphereGeometry args={[0.1, 36, 28]} />
        <meshPhysicalMaterial color="#f7ead2" roughness={0.62} clearcoat={0.08} emissive={selected ? "#2b80ce" : "#000"} emissiveIntensity={selected ? .18 : 0} />
      </mesh>
      {selected && <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.55, 0]} scale={[5.8, 5.8, 5.8]}><ringGeometry args={[.105,.12,32]} /><meshBasicMaterial color="#2b80ce" transparent opacity={.72} side={DoubleSide} /></mesh>}
    </group>
  );
}
