import { Environment, Lightformer } from "@react-three/drei";
import { useMemo } from "react";
import { CanvasTexture, SRGBColorSpace } from "three";

/**
 * Shared scene dressing for the build and drop stages.
 *
 * LabEnvironment bakes a tiny procedural light rig into a 64px environment map
 * once (frames={1}), so clearcoat, transmission, and metal materials get real
 * reflections without loading an HDRI or paying any per-frame cost.
 */
export function LabEnvironment() {
  return (
    <Environment resolution={64} frames={1}>
      <color attach="background" args={["#b9d9e8"]} />
      {/* Broad cool skylight from above. */}
      <Lightformer intensity={1.4} rotation-x={Math.PI / 2} position={[0, 6, 0]} scale={[12, 12, 1]} color="#eef8ff" />
      {/* Warm key panel, matches the directional light's side. */}
      <Lightformer intensity={1.05} rotation-y={-Math.PI / 2.6} position={[5, 2.5, 3]} scale={[6, 4, 1]} color="#ffe9c9" />
      {/* Soft cool fill from the opposite side. */}
      <Lightformer intensity={0.55} rotation-y={Math.PI / 2.4} position={[-5, 1.5, -1]} scale={[6, 3, 1]} color="#d9ecff" />
      {/* Green-tinted ground bounce. */}
      <Lightformer intensity={0.4} rotation-x={-Math.PI / 2} position={[0, -4, 0]} scale={[14, 14, 1]} color="#9db98c" />
    </Environment>
  );
}

const makePadTexture = (): CanvasTexture | null => {
  if (typeof document === "undefined") return null;
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const center = size / 2;

  // Soft grass vignette: lighter, slightly worn centre fading to nothing.
  const vignette = ctx.createRadialGradient(center, center, 0, center, center, center);
  vignette.addColorStop(0, "rgba(228, 232, 205, 0.5)");
  vignette.addColorStop(0.35, "rgba(210, 220, 185, 0.28)");
  vignette.addColorStop(0.75, "rgba(190, 205, 165, 0.1)");
  vignette.addColorStop(1, "rgba(190, 205, 165, 0)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, size, size);

  // Landing-pad target rings.
  const rings: Array<[number, string, number]> = [
    [0.46, "rgba(255, 255, 255, 0.85)", 7],
    [0.36, "rgba(222, 91, 76, 0.75)", 6],
    [0.26, "rgba(255, 255, 255, 0.8)", 5],
    [0.16, "rgba(222, 91, 76, 0.7)", 5],
  ];
  for (const [radius, style, width] of rings) {
    ctx.beginPath();
    ctx.strokeStyle = style;
    ctx.lineWidth = width;
    ctx.arc(center, center, radius * size, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.fillStyle = "rgba(222, 91, 76, 0.8)";
  ctx.arc(center, center, 0.045 * size, 0, Math.PI * 2);
  ctx.fill();

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
};

let padTexture: CanvasTexture | null | undefined;

type LandingGroundProps = {
  /** Radius of the decal disc in metres. */
  radiusM?: number;
  /** World-space height; keep it a hair above the physical ground to avoid z-fighting. */
  yM?: number;
};

/**
 * A transparent landing-target decal laid over the existing ground. One static
 * mesh, one shared 512px texture — no per-frame work.
 */
export function LandingGround({ radiusM = 1.8, yM = 0.002 }: LandingGroundProps) {
  const texture = useMemo(() => {
    if (padTexture === undefined) padTexture = makePadTexture();
    return padTexture;
  }, []);
  if (!texture) return null;
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, yM, 0]} receiveShadow>
      <circleGeometry args={[radiusM, 48]} />
      <meshStandardMaterial map={texture} transparent depthWrite={false} polygonOffset polygonOffsetFactor={-1} roughness={1} />
    </mesh>
  );
}
