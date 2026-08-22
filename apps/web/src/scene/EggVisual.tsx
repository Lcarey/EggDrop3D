import type { Transform } from "@eggdrop/shared";
import { useMemo } from "react";
import { DoubleSide, type MeshPhysicalMaterialParameters } from "three";
import { getEggShellTextures } from "./eggTextures";

type EggVisualProps = {
  transform: Transform;
  selected?: boolean;
  cracked?: boolean;
};

type ShellPieceProps = {
  shell: MeshPhysicalMaterialParameters;
  radius?: number;
  phiStart?: number;
  phiLength?: number;
  thetaStart?: number;
  thetaLength?: number;
  position?: [number, number, number];
  rotation?: [number, number, number];
};

function ShellPiece({
  shell,
  radius = 0.52,
  phiStart = 0,
  phiLength = Math.PI * 2,
  thetaStart = 0,
  thetaLength = Math.PI,
  position = [0, 0, 0],
  rotation = [0, 0, 0],
}: ShellPieceProps) {
  return (
    <mesh position={position} rotation={rotation} castShadow receiveShadow>
      <sphereGeometry args={[radius, 48, 36, phiStart, phiLength, thetaStart, thetaLength]} />
      <meshPhysicalMaterial {...shell} side={DoubleSide} />
    </mesh>
  );
}

function CrackedEggBody({ shell }: { shell: MeshPhysicalMaterialParameters }) {
  return (
    <group>
      <ShellPiece
        shell={shell}
        phiStart={0}
        phiLength={Math.PI}
        thetaStart={0}
        thetaLength={Math.PI * 0.62}
        position={[-0.14, 0.06, 0]}
        rotation={[0.12, 0.08, 0.42]}
      />
      <ShellPiece
        shell={shell}
        phiStart={Math.PI}
        phiLength={Math.PI}
        thetaStart={0}
        thetaLength={Math.PI * 0.58}
        position={[0.16, 0.04, 0.02]}
        rotation={[-0.08, -0.12, -0.38]}
      />
      <ShellPiece
        shell={shell}
        radius={0.22}
        phiStart={0.2}
        phiLength={1.1}
        thetaStart={Math.PI * 0.52}
        thetaLength={Math.PI * 0.28}
        position={[-0.28, -0.18, 0.1]}
        rotation={[0.4, 0.5, 0.9]}
      />
      <ShellPiece
        shell={shell}
        radius={0.16}
        phiStart={1.8}
        phiLength={0.9}
        thetaStart={Math.PI * 0.48}
        thetaLength={Math.PI * 0.22}
        position={[0.3, -0.14, -0.08]}
        rotation={[-0.3, -0.6, -0.7]}
      />
      <ShellPiece
        shell={shell}
        radius={0.11}
        phiStart={0.5}
        phiLength={0.7}
        thetaStart={Math.PI * 0.7}
        thetaLength={Math.PI * 0.18}
        position={[0.05, -0.34, 0.14]}
        rotation={[0.2, 0.1, 0.2]}
      />

      <mesh position={[0, -0.02, 0]} castShadow>
        <sphereGeometry args={[0.44, 40, 32]} />
        <meshPhysicalMaterial
          color="#f8f6f2"
          roughness={0.38}
          metalness={0}
          transmission={0.22}
          thickness={0.35}
          ior={1.33}
          transparent
          opacity={0.94}
        />
      </mesh>

      <mesh position={[0.04, -0.12, 0.02]} castShadow>
        <sphereGeometry args={[0.3, 36, 28]} />
        <meshPhysicalMaterial
          color="#efb21a"
          emissive="#a85d08"
          emissiveIntensity={0.08}
          roughness={0.22}
          metalness={0}
          clearcoat={0.45}
          clearcoatRoughness={0.18}
        />
      </mesh>

      <mesh position={[0.1, -0.34, 0.06]} rotation={[0.1, 0.2, 0]} scale={[0.34, 0.1, 0.28]} castShadow receiveShadow>
        <sphereGeometry args={[1, 32, 24]} />
        <meshPhysicalMaterial
          color="#f5f2ea"
          roughness={0.42}
          metalness={0}
          transmission={0.35}
          thickness={0.2}
          transparent
          opacity={0.92}
        />
      </mesh>
      <mesh position={[-0.14, -0.42, -0.05]} rotation={[0, -0.3, 0]} scale={[0.26, 0.08, 0.22]} castShadow receiveShadow>
        <sphereGeometry args={[1, 28, 20]} />
        <meshPhysicalMaterial
          color="#f3f0e8"
          roughness={0.45}
          metalness={0}
          transmission={0.3}
          thickness={0.18}
          transparent
          opacity={0.9}
        />
      </mesh>
      <mesh position={[0.02, -0.5, 0.1]} rotation={[0.15, 0, 0]} scale={[0.2, 0.06, 0.18]} castShadow receiveShadow>
        <sphereGeometry args={[1, 24, 18]} />
        <meshPhysicalMaterial
          color="#ece8df"
          roughness={0.48}
          metalness={0}
          transmission={0.28}
          thickness={0.15}
          transparent
          opacity={0.88}
        />
      </mesh>
      <mesh position={[-0.06, -0.56, 0.04]} rotation={[0.2, 0.15, 0]} scale={[0.14, 0.05, 0.12]} castShadow receiveShadow>
        <sphereGeometry args={[1, 20, 16]} />
        <meshPhysicalMaterial color="#e8e4dc" roughness={0.5} transparent opacity={0.85} />
      </mesh>
    </group>
  );
}

export function EggVisual({ transform, selected = false, cracked = false }: EggVisualProps) {
  const textures = useMemo(() => getEggShellTextures(), []);
  const shell = useMemo<MeshPhysicalMaterialParameters>(() => ({
    map: textures.map,
    bumpMap: textures.bumpMap,
    bumpScale: 0.018,
    color: "#f6f0e4",
    roughness: 0.42,
    metalness: 0,
    clearcoat: 0.72,
    clearcoatRoughness: 0.14,
    emissive: selected ? "#2b80ce" : "#000000",
    emissiveIntensity: selected ? 0.14 : 0,
  }), [textures, selected]);

  return (
    <group scale={transform.dimensions}>
      {cracked ? (
        <CrackedEggBody shell={shell} />
      ) : (
        <>
          <mesh castShadow receiveShadow scale={[5, 5, 5]}>
            <sphereGeometry args={[0.1, 64, 48]} />
            <meshPhysicalMaterial {...shell} />
          </mesh>
          {selected && (
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.55, 0]} scale={[5.8, 5.8, 5.8]}>
              <ringGeometry args={[0.105, 0.12, 32]} />
              <meshBasicMaterial color="#2b80ce" transparent opacity={0.72} side={DoubleSide} />
            </mesh>
          )}
        </>
      )}
    </group>
  );
}
