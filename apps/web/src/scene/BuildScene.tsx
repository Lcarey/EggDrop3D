import { ContactShadows, Grid, Line, OrbitControls, PerspectiveCamera, TransformControls } from "@react-three/drei";
import { Canvas, type ThreeEvent } from "@react-three/fiber";
import type { DesignPartV1, MaterialId, Transform } from "@eggdrop/shared";
import { snapVec3 } from "@eggdrop/shared";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Group, PerspectiveCamera as ThreePerspectiveCamera, Quaternion, Vector3 } from "three";
import { DEFAULT_DIMENSIONS, useEditorStore, getBodyTransform } from "../editor/store";
import { MATERIAL_VISUALS } from "../editor/materialVisuals";
import { EggVisual, PartVisual } from "./PartVisual";

type BuildSceneProps = { editable: boolean; fitNonce: number };
type SolidMaterialId = keyof typeof DEFAULT_DIMENSIONS;

const isSolidMaterial = (materialId: MaterialId | null): materialId is SolidMaterialId =>
  materialId !== null && materialId in DEFAULT_DIMENSIONS;

const localAnchor = (event: ThreeEvent<PointerEvent>, transform: Transform): [number, number, number] => {
  const origin = new Vector3(...transform.position);
  const inverse = new Quaternion(...transform.rotation).invert();
  const value = event.point.clone().sub(origin).applyQuaternion(inverse);
  return [value.x, value.y, value.z];
};

// The pickable "ends" of a body: the six face centres plus the eight corners of
// its local bounding box. A click snaps to whichever end is nearest, so rod-like
// parts (straws, craft sticks) resolve to their tips.
const nearestEndAnchor = (event: ThreeEvent<PointerEvent>, transform: Transform): [number, number, number] => {
  const clicked = new Vector3(...localAnchor(event, transform));
  const hx = transform.dimensions[0] / 2;
  const hy = transform.dimensions[1] / 2;
  const hz = transform.dimensions[2] / 2;
  const candidates = [
    new Vector3(hx, 0, 0), new Vector3(-hx, 0, 0),
    new Vector3(0, hy, 0), new Vector3(0, -hy, 0),
    new Vector3(0, 0, hz), new Vector3(0, 0, -hz),
  ];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    candidates.push(new Vector3(sx * hx, sy * hy, sz * hz));
  }
  let best = candidates[0]!;
  for (const candidate of candidates) {
    if (candidate.distanceToSquared(clicked) < best.distanceToSquared(clicked)) best = candidate;
  }
  return [best.x, best.y, best.z];
};

const placementFromHit = (
  event: ThreeEvent<PointerEvent>,
  dimensions: [number, number, number],
): [number, number, number] => {
  const normal = event.face?.normal.clone().transformDirection(event.object.matrixWorld).normalize() ?? new Vector3(0, 1, 0);
  const clearance = (
    Math.abs(normal.x) * dimensions[0] +
    Math.abs(normal.y) * dimensions[1] +
    Math.abs(normal.z) * dimensions[2]
  ) / 2 + .005;
  const point = event.point.clone().addScaledVector(normal, clearance);
  return snapVec3([point.x, point.y, point.z], .05);
};

function SceneCamera({ fitNonce }: { fitNonce: number }) {
  const camera = useRef<ThreePerspectiveCamera>(null);
  useEffect(() => {
    if (!camera.current) return;
    camera.current.position.set(1.25, 1.05, 1.45);
    camera.current.lookAt(0, .28, 0);
  }, [fitNonce]);
  return <PerspectiveCamera ref={camera} makeDefault fov={42} near={0.01} far={100} position={[1.25, 1.05, 1.45]} />;
}

function JointLines() {
  const design = useEditorStore((state) => state.design);
  return design.joints.map((joint) => {
    const bodyA = getBodyTransform(design, joint.bodyA);
    const bodyB = getBodyTransform(design, joint.bodyB);
    if (!bodyA || !bodyB) return null;
    const a = new Vector3(...joint.anchorA).applyQuaternion(new Quaternion(...bodyA.rotation)).add(new Vector3(...bodyA.position));
    const b = new Vector3(...joint.anchorB).applyQuaternion(new Quaternion(...bodyB.rotation)).add(new Vector3(...bodyB.position));
    // Glue anchors are kept coincident, so the bond renders as a dot, not a line.
    if (joint.materialId === "glue") {
      return (
        <mesh key={joint.id} position={a.add(b).multiplyScalar(0.5)}>
          <sphereGeometry args={[0.011, 16, 16]} />
          <meshBasicMaterial color="#fdfaf0" />
        </mesh>
      );
    }
    const color = joint.materialId === "tape" ? "#f2c94c" : joint.materialId === "string" ? "#6f5138" : "#de5b4c";
    return <Line key={joint.id} points={[a, b]} color={color} lineWidth={joint.materialId === "tape" ? 5 : 2.5} dashed={joint.materialId === "rubberBand"} dashSize={.03} gapSize={.018} />;
  });
}

// Marks the first picked point for both the snap tool and the glue connector.
function SnapEndMarker() {
  const design = useEditorStore((state) => state.design);
  const snapDraft = useEditorStore((state) => state.snapDraft);
  const connectorDraft = useEditorStore((state) => state.connectorDraft);
  const glueDraft = connectorDraft?.materialId === "glue" ? connectorDraft : null;
  const bodyA = snapDraft?.bodyA ?? glueDraft?.bodyA;
  const anchorA = snapDraft?.anchorA ?? glueDraft?.anchorA;
  if (!bodyA || !anchorA) return null;
  const transform = getBodyTransform(design, bodyA);
  if (!transform) return null;
  const world = new Vector3(...anchorA)
    .applyQuaternion(new Quaternion(...transform.rotation))
    .add(new Vector3(...transform.position));
  return (
    <group position={world}>
      <mesh>
        <sphereGeometry args={[0.012, 20, 20]} />
        <meshBasicMaterial color="#ff8a1e" depthTest={false} transparent opacity={0.95} />
      </mesh>
      <mesh>
        <sphereGeometry args={[0.02, 20, 20]} />
        <meshBasicMaterial color="#ffcf4d" depthTest={false} transparent opacity={0.35} />
      </mesh>
    </group>
  );
}

function EditableBody({ part, editable, setOrbitEnabled }: { part?: DesignPartV1; editable: boolean; setOrbitEnabled: (value: boolean) => void }) {
  const id = part?.id ?? "egg";
  const transform = useEditorStore((state) => part ? state.design.parts.find((candidate) => candidate.id === id)?.transform : state.design.eggTransform) ?? (part?.transform as Transform);
  const selected = useEditorStore((state) => state.selectedId === id);
  const activeMaterial = useEditorStore((state) => state.activeMaterial);
  const connectorDraft = useEditorStore((state) => state.connectorDraft);
  const snapDraft = useEditorStore((state) => state.snapDraft);
  const transformMode = useEditorStore((state) => state.transformMode);
  const select = useEditorStore((state) => state.select);
  const beginOrFinishConnector = useEditorStore((state) => state.beginOrFinishConnector);
  const pickSnapEnd = useEditorStore((state) => state.pickSnapEnd);
  const placePart = useEditorStore((state) => state.placePart);
  const updateTransform = useEditorStore((state) => state.updateTransform);
  const group = useRef<Group>(null!);

  if (!transform) return null;

  const handlePointerDown = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    if (!editable) return;
    if (snapDraft) {
      pickSnapEnd(id, nearestEndAnchor(event, transform));
      return;
    }
    if (connectorDraft) {
      beginOrFinishConnector(id, localAnchor(event, transform));
      return;
    }
    if (isSolidMaterial(activeMaterial)) {
      placePart(activeMaterial, placementFromHit(event, DEFAULT_DIMENSIONS[activeMaterial]));
      return;
    }
    select(id);
  };

  const object = (
    <group
      ref={group}
      position={transform.position}
      quaternion={transform.rotation}
      scale={part ? transform.dimensions : [1, 1, 1]}
      onPointerDown={handlePointerDown}
    >
      {part
        ? <PartVisual materialId={part.materialId} selected={selected} />
        : <EggVisual transform={transform} selected={selected} />}
    </group>
  );

  if (!selected || !editable || connectorDraft || snapDraft) return object;
  return (
    <>
      {object}
      <TransformControls
        object={group}
        mode={id === "egg" && transformMode === "scale" ? "translate" : transformMode}
        translationSnap={.05}
        rotationSnap={Math.PI / 12}
        scaleSnap={.05}
        size={.72}
        onMouseDown={() => setOrbitEnabled(false)}
        onMouseUp={() => {
          setOrbitEnabled(true);
          if (!group.current) return;
          const next: Transform = {
            position: [group.current.position.x, group.current.position.y, group.current.position.z],
            rotation: [group.current.quaternion.x, group.current.quaternion.y, group.current.quaternion.z, group.current.quaternion.w],
            dimensions: id === "egg"
              ? transform.dimensions
              : [Math.max(.01, group.current.scale.x), Math.max(.01, group.current.scale.y), Math.max(.01, group.current.scale.z)],
          };
          updateTransform(id, next);
        }}
      />
    </>
  );
}

function PlacementPlane({ editable }: { editable: boolean }) {
  const activeMaterial = useEditorStore((state) => state.activeMaterial);
  const placePart = useEditorStore((state) => state.placePart);
  const select = useEditorStore((state) => state.select);
  const [ghost, setGhost] = useState<[number, number, number] | null>(null);
  const solidMaterial = isSolidMaterial(activeMaterial) ? activeMaterial : null;
  const isSolid = solidMaterial !== null;
  const dimensions = useMemo(() => {
    if (!solidMaterial) return null;
    return DEFAULT_DIMENSIONS[solidMaterial];
  }, [solidMaterial]);

  return (
    <>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -.006, 0]}
        onPointerMove={(event) => {
          if (!editable || !isSolid || !dimensions) return;
          event.stopPropagation();
          setGhost(snapVec3([event.point.x, dimensions[1] / 2, event.point.z], .05));
        }}
        onPointerDown={(event) => {
          event.stopPropagation();
          if (editable && solidMaterial && ghost) placePart(solidMaterial, ghost);
          else select(null);
        }}
      >
        <planeGeometry args={[3, 3]} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>
      {editable && isSolid && ghost && dimensions && (
        <group position={ghost} scale={dimensions}>
          <PartVisual materialId={solidMaterial!} ghost />
        </group>
      )}
    </>
  );
}

function BuildWorld({ editable, fitNonce }: BuildSceneProps) {
  const parts = useEditorStore((state) => state.design.parts);
  const [orbitEnabled, setOrbitEnabled] = useState(true);
  return (
    <>
      <SceneCamera fitNonce={fitNonce} />
      <color attach="background" args={["#bfe3ef"]} />
      <fog attach="fog" args={["#d9edf2", 3.5, 7]} />
      <ambientLight intensity={1.15} />
      <hemisphereLight args={["#e7f9ff", "#627856", 1.25]} />
      <directionalLight position={[2.6, 4, 2]} intensity={2.1} castShadow shadow-mapSize={[1024, 1024]} />
      <Grid position={[0, -.004, 0]} args={[2.5, 2.5]} cellSize={.05} sectionSize={.25} cellColor="#76a3aa" sectionColor="#477986" fadeDistance={3} fadeStrength={1.5} infiniteGrid />
      <PlacementPlane editable={editable} />
      <EditableBody editable={editable} setOrbitEnabled={setOrbitEnabled} />
      {parts.map((part) => <EditableBody key={part.id} part={part} editable={editable} setOrbitEnabled={setOrbitEnabled} />)}
      <JointLines />
      <SnapEndMarker />
      <ContactShadows position={[0, .002, 0]} opacity={.32} scale={2.2} blur={2.6} far={1.3} />
      <OrbitControls enabled={orbitEnabled} makeDefault target={[0, .25, 0]} minDistance={.45} maxDistance={4} minPolarAngle={.15} maxPolarAngle={Math.PI / 2.04} />
    </>
  );
}

export function BuildScene(props: BuildSceneProps) {
  return (
    <Canvas
      shadows
      dpr={[1, 1.65]}
      gl={{ antialias: true, alpha: false }}
      fallback={<div className="webgl-fallback" role="alert"><span>🥚</span><strong>3D graphics are unavailable</strong><p>Enable WebGL or try a current browser to build and drop this design.</p></div>}
    >
      <Suspense fallback={null}><BuildWorld {...props} /></Suspense>
    </Canvas>
  );
}
