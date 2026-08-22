import { STANDARD_GRAVITY_MPS2 } from "@eggdrop/shared";
import { act, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { TOUCH } from "three";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { freshDesign } from "../editor/store";
import {
  DROP_FIXED_STEP_SECONDS,
  DROP_OUTCOME_REVEAL_SECONDS,
  DROP_SETTLE_REAL_SECONDS,
  DropScene,
  calculateDropZoomLimits,
} from "./DropScene";

type FrameCallback = (state: {
  camera: {
    position: { x: number; y: number; z: number };
    lookAt: (x: number, y: number, z: number) => void;
  };
}, delta: number) => void;
type BeforeStepCallback = () => void;
type VisualObjectState = {
  position: { x: number; y: number; z: number; copy: (source: { x: number; y: number; z: number }) => void };
  quaternion: { x: number; y: number; z: number; w: number; copy: (source: { x: number; y: number; z: number; w: number }) => void };
};

const playbackHarness = vi.hoisted(() => ({
  frameCallbacks: new Map<FrameCallback, number>(),
  beforeStepCallbacks: new Set<BeforeStepCallback>(),
  stepDeltas: [] as number[],
  stepEffect: undefined as undefined | ((delta: number) => void),
  visualObjects: new WeakMap<object, VisualObjectState>(),
  collision: undefined as undefined | ((payload: unknown) => void),
  zoomControlsProps: undefined as undefined | {
    enableZoom?: boolean;
    enableRotate?: boolean;
    enablePan?: boolean;
    minDistance?: number;
    maxDistance?: number;
    zoomToCursor?: boolean;
    touches?: { ONE: number; TWO: number };
    onChange?: () => void;
  },
  eggBody: {
    position: { x: 0, y: 1, z: 0 },
    velocity: { x: 0, y: -10, z: 0 },
    translation() { return { ...this.position }; },
    linvel() { return { ...this.velocity }; },
    angvel: () => ({ x: 0, y: 0, z: 0 }),
    rotation: () => ({ x: 0, y: 0, z: 0, w: 1 }),
    isSleeping: () => false,
    resetForces: () => undefined,
    resetTorques: () => undefined,
    addForce: () => undefined,
    addForceAtPoint: () => undefined,
    addTorque: () => undefined,
    mass: () => .057,
  },
  // Per-bodyId rigid-body stand-ins; ids without an entry fall back to eggBody.
  bodyOverrides: {} as Record<string, unknown>,
}));

vi.mock("@react-three/fiber", async () => {
  const React = await import("react");
  return {
    Canvas: ({ children }: { children: ReactNode }) => React.createElement("div", { "data-testid": "drop-canvas" }, children),
    useFrame: (callback: FrameCallback, priority = 0) => {
      const callbackRef = React.useRef(callback);
      callbackRef.current = callback;
      React.useLayoutEffect(() => {
        const run: FrameCallback = (state, delta) => callbackRef.current(state, delta);
        playbackHarness.frameCallbacks.set(run, priority);
        return () => { playbackHarness.frameCallbacks.delete(run); };
      }, [priority]);
    },
  };
});

vi.mock("@react-three/drei", async () => {
  const React = await import("react");
  const OrbitControls = React.forwardRef((props: {
    enableZoom?: boolean;
    enableRotate?: boolean;
    enablePan?: boolean;
    minDistance?: number;
    maxDistance?: number;
    zoomToCursor?: boolean;
    touches?: { ONE: number; TWO: number };
    onChange?: () => void;
  }, ref) => {
    const controls = React.useMemo(() => ({
      target: {
        x: 0,
        y: 0,
        z: 0,
        copy(source: { x: number; y: number; z: number }) {
          this.x = source.x;
          this.y = source.y;
          this.z = source.z;
          return this;
        },
      },
      update() {
        frameState.camera.lookAt(this.target.x, this.target.y, this.target.z);
      },
    }), []);
    React.useImperativeHandle(ref, () => controls, [controls]);
    React.useLayoutEffect(() => {
      playbackHarness.zoomControlsProps = props;
      return () => { playbackHarness.zoomControlsProps = undefined; };
    }, [props]);
    return React.createElement("div", {
      "data-testid": "drop-zoom-controls",
      "data-enable-zoom": String(Boolean(props.enableZoom)),
      "data-enable-rotate": String(Boolean(props.enableRotate)),
      "data-enable-pan": String(Boolean(props.enablePan)),
    });
  });
  return {
    Billboard: () => null,
    ContactShadows: () => null,
    Line: () => null,
    OrbitControls,
    PerspectiveCamera: () => React.createElement("div", { "data-testid": "drop-camera" }),
    Text: () => null,
  };
});

vi.mock("./PartVisual", async () => {
  const React = await import("react");
  return {
    EggVisual: ({ cracked = false }: { cracked?: boolean }) => React.createElement("div", {
      "data-testid": "egg-visual",
      "data-cracked": String(cracked),
    }),
    PartVisual: () => null,
  };
});

vi.mock("@react-three/rapier", async () => {
  const React = await import("react");
  const Physics = ({ children, paused, timeStep }: { children: ReactNode; paused?: boolean; timeStep?: number }) => React.createElement(
    "div",
    { "data-testid": "physics-world", "data-paused": String(Boolean(paused)), "data-timestep": String(timeStep) },
    children,
  );
  const RigidBody = React.forwardRef<unknown, { children?: ReactNode; userData?: { bodyId?: string } }>((props, ref) => {
    const bodyId = props.userData?.bodyId;
    React.useImperativeHandle(ref, () => (bodyId && playbackHarness.bodyOverrides[bodyId]) || playbackHarness.eggBody);
    return React.createElement("div", { "data-testid": `body-${bodyId ?? "unknown"}` }, props.children);
  });
  const CapsuleCollider = ({ onCollisionEnter }: { onCollisionEnter?: (payload: unknown) => void }) => {
    React.useLayoutEffect(() => {
      playbackHarness.collision = onCollisionEnter;
      return () => { playbackHarness.collision = undefined; };
    }, [onCollisionEnter]);
    return React.createElement("div", { "data-testid": "egg-collider" });
  };
  return {
    BallCollider: () => null,
    CapsuleCollider,
    CuboidCollider: () => null,
    CylinderCollider: () => null,
    Physics,
    RigidBody,
    useBeforePhysicsStep: (callback: BeforeStepCallback) => {
      const callbackRef = React.useRef(callback);
      callbackRef.current = callback;
      React.useLayoutEffect(() => {
        const run = () => callbackRef.current();
        playbackHarness.beforeStepCallbacks.add(run);
        return () => { playbackHarness.beforeStepCallbacks.delete(run); };
      }, []);
    },
    useFixedJoint: () => undefined,
    useRapier: () => ({
      step: (delta: number) => {
        playbackHarness.stepDeltas.push(delta);
        for (const callback of [...playbackHarness.beforeStepCallbacks]) callback();
        playbackHarness.stepEffect?.(delta);
      },
    }),
    useRopeJoint: () => undefined,
    useSpringJoint: () => undefined,
  };
});

const frameState = {
  camera: { position: { x: 0, y: 2, z: 0 }, lookAt: vi.fn<(x: number, y: number, z: number) => void>() },
};
const originalConsoleError = console.error;

const advanceFrame = (delta: number) => {
  act(() => {
    const callbacks = [...playbackHarness.frameCallbacks.entries()]
      .sort(([, priorityA], [, priorityB]) => priorityA - priorityB);
    for (const [callback] of callbacks) callback(frameState, delta);
  });
};

describe("DropScene playback presentation", () => {
  beforeEach(() => {
    playbackHarness.visualObjects = new WeakMap<object, VisualObjectState>();
    const visualObjectFor = (element: object) => {
      let state = playbackHarness.visualObjects.get(element);
      if (state) return state;
      state = {
        position: {
          x: 0,
          y: 0,
          z: 0,
          copy(source) {
            this.x = source.x;
            this.y = source.y;
            this.z = source.z;
          },
        },
        quaternion: {
          x: 0,
          y: 0,
          z: 0,
          w: 1,
          copy(source) {
            this.x = source.x;
            this.y = source.y;
            this.z = source.z;
            this.w = source.w;
          },
        },
      };
      playbackHarness.visualObjects.set(element, state);
      return state;
    };
    Object.defineProperty(HTMLElement.prototype, "position", {
      configurable: true,
      get() { return visualObjectFor(this).position; },
    });
    Object.defineProperty(HTMLElement.prototype, "quaternion", {
      configurable: true,
      get() { return visualObjectFor(this).quaternion; },
    });
    // React DOM represents the Three.js intrinsic used by joint guide lines as
    // an HTMLElement in this focused harness. Supply the two geometry methods
    // that DropJointLines calls so connected-design frames can be exercised.
    Object.defineProperty(HTMLElement.prototype, "setFromPoints", {
      configurable: true,
      value: () => undefined,
    });
    Object.defineProperty(HTMLElement.prototype, "computeBoundingSphere", {
      configurable: true,
      value: () => undefined,
    });
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      const message = String(args[0] ?? "");
      if (/unrecognized in this browser|incorrect casing|does not recognize the/.test(message)) return;
      originalConsoleError(...args);
    });
    playbackHarness.frameCallbacks.clear();
    playbackHarness.beforeStepCallbacks.clear();
    playbackHarness.stepDeltas.length = 0;
    playbackHarness.stepEffect = undefined;
    playbackHarness.collision = undefined;
    playbackHarness.zoomControlsProps = undefined;
    playbackHarness.bodyOverrides = {};
    playbackHarness.eggBody.position = { x: 0, y: 1, z: 0 };
    playbackHarness.eggBody.velocity = { x: 0, y: -10, z: 0 };
    frameState.camera.position = { x: 0, y: 2, z: 0 };
    frameState.camera.lookAt.mockClear();
  });

  it("keeps the camera and drop scene rendered while physics is held for 500 ms", () => {
    render(<DropScene design={freshDesign()} runId={1} running playbackRate={0.2} gravityMps2={STANDARD_GRAVITY_MPS2} onComplete={vi.fn()} />);

    expect(screen.getByTestId("drop-canvas")).toBeInTheDocument();
    expect(screen.getByTestId("drop-camera")).toBeInTheDocument();
    expect(screen.getByTestId("egg-visual")).toHaveAttribute("data-cracked", "false");
    expect(screen.getByTestId("physics-world")).toHaveAttribute("data-paused", "true");
    expect(screen.getByTestId("physics-world")).toHaveAttribute("data-timestep", String(DROP_FIXED_STEP_SECONDS));

    advanceFrame(0.499);
    advanceFrame(0.001);
    expect(playbackHarness.stepDeltas).toEqual([]);

    // 100 ms at 0.2× playback advances 20 ms of simulation: four 1/240 steps.
    advanceFrame(0.1);
    expect(playbackHarness.stepDeltas).toEqual(Array(4).fill(DROP_FIXED_STEP_SECONDS));
  });

  it("uses the selected playback rate while keeping every Rapier step fixed at 1/240 second", () => {
    render(<DropScene design={freshDesign()} runId={1} running playbackRate={2} gravityMps2={STANDARD_GRAVITY_MPS2} onComplete={vi.fn()} />);

    advanceFrame(0.5);
    expect(playbackHarness.stepDeltas).toEqual([]);
    // One 60 Hz render frame at 2× playback advances 1/30 s: eight 1/240 steps.
    advanceFrame(1 / 60);
    expect(playbackHarness.stepDeltas).toEqual(Array(8).fill(DROP_FIXED_STEP_SECONDS));
  });

  it("enables pinch zoom during a drop while keeping camera rotation and panning locked", () => {
    render(<DropScene design={freshDesign()} runId={1} running playbackRate={0.2} gravityMps2={STANDARD_GRAVITY_MPS2} onComplete={vi.fn()} />);

    expect(screen.getByTestId("drop-zoom-controls")).toHaveAttribute("data-enable-zoom", "true");
    expect(screen.getByTestId("drop-zoom-controls")).toHaveAttribute("data-enable-rotate", "false");
    expect(screen.getByTestId("drop-zoom-controls")).toHaveAttribute("data-enable-pan", "false");

    const controls = playbackHarness.zoomControlsProps;
    expect(controls?.zoomToCursor).toBe(false);
    expect(controls?.touches).toEqual({ ONE: TOUCH.ROTATE, TWO: TOUCH.DOLLY_PAN });
    expect(controls?.minDistance).toBeGreaterThan(0);
    expect(controls?.maxDistance).toBeGreaterThan(controls?.minDistance ?? Number.POSITIVE_INFINITY);
  });

  it("keeps the initial drop framing inside finite, usable zoom bounds", () => {
    for (const framingDistance of [.1, .78, 1.5, 8, Number.NaN]) {
      const limits = calculateDropZoomLimits(framingDistance);
      expect(Number.isFinite(limits.minDistance)).toBe(true);
      expect(Number.isFinite(limits.maxDistance)).toBe(true);
      expect(limits.minDistance).toBeGreaterThanOrEqual(.25);
      expect(limits.maxDistance).toBeGreaterThanOrEqual(3.2);
      expect(limits.maxDistance).toBeGreaterThan(limits.minDistance);
    }
  });

  it("preserves the user's pinch-zoom distance while the camera follows the falling egg", () => {
    render(<DropScene design={freshDesign()} runId={1} running playbackRate={0.2} gravityMps2={STANDARD_GRAVITY_MPS2} onComplete={vi.fn()} />);

    // Establish the camera target during the motionless release hold, then
    // emulate OrbitControls moving the camera farther from that target.
    advanceFrame(1 / 60);
    const initialTarget = frameState.camera.lookAt.mock.lastCall;
    expect(initialTarget).toBeDefined();
    const [targetX, targetY, targetZ] = initialTarget!;
    const offsetX = frameState.camera.position.x - targetX;
    const offsetY = frameState.camera.position.y - targetY;
    const offsetZ = frameState.camera.position.z - targetZ;
    frameState.camera.position.x = targetX + offsetX * 1.6;
    frameState.camera.position.y = targetY + offsetY * 1.6;
    frameState.camera.position.z = targetZ + offsetZ * 1.6;
    playbackHarness.zoomControlsProps?.onChange?.();
    const zoomedDistance = Math.hypot(offsetX, offsetY, offsetZ) * 1.6;

    advanceFrame(1 / 60);
    const followedTarget = frameState.camera.lookAt.mock.lastCall!;
    const followedDistance = Math.hypot(
      frameState.camera.position.x - followedTarget[0],
      frameState.camera.position.y - followedTarget[1],
      frameState.camera.position.z - followedTarget[2],
    );
    expect(followedDistance).toBeCloseTo(zoomedDistance, 4);
  });

  it("feeds the egg visual and camera a smooth 60 Hz pose between physics samples", () => {
    render(<DropScene design={freshDesign()} runId={1} running playbackRate={0.2} gravityMps2={STANDARD_GRAVITY_MPS2} onComplete={vi.fn()} />);
    const eggVisualGroup = screen.getByTestId("egg-visual").parentElement!;
    advanceFrame(.5);
    // Keep the fake Rapier body aligned with the design's height before
    // applying per-step motion; the real body is initialized at this pose.
    playbackHarness.eggBody.position.y = playbackHarness.visualObjects.get(eggVisualGroup)!.position.y;
    playbackHarness.stepEffect = () => {
      playbackHarness.eggBody.position.y -= .025;
    };

    const cameraTargetY: number[] = [];
    const renderedEggY: number[] = [];
    for (let frame = 0; frame < 20; frame += 1) {
      advanceFrame(1 / 60);
      const lastLookAt = frameState.camera.lookAt.mock.lastCall;
      expect(lastLookAt).toBeDefined();
      cameraTargetY.push(lastLookAt![1]);
      renderedEggY.push(playbackHarness.visualObjects.get(eggVisualGroup)!.position.y);
    }

    // By the third physics interval initialization is complete. The camera's
    // target should then advance every display frame, rather than remaining
    // still for four frames before jumping on each fifth frame.
    for (const samples of [cameraTargetY, renderedEggY]) {
      const steadyWindow = samples.slice(10);
      const motion = steadyWindow.slice(1).map((value, index) => value - steadyWindow[index]!);
      expect(motion).toHaveLength(9);
      for (const delta of motion) {
        expect(delta).toBeLessThan(-.005);
        expect(delta).toBeGreaterThan(-.04);
      }
    }
  });

  it("reveals the visible cracked state before publishing the result", () => {
    const onComplete = vi.fn();
    render(<DropScene design={freshDesign()} runId={1} running playbackRate={0.2} gravityMps2={STANDARD_GRAVITY_MPS2} onComplete={onComplete} />);

    advanceFrame(0.5);
    advanceFrame(0.1);
    expect(playbackHarness.collision).toBeTypeOf("function");
    playbackHarness.eggBody.position.y = 0.05;
    act(() => playbackHarness.collision?.({
      other: {
        rigidBody: { linvel: () => ({ x: 0, y: 0, z: 0 }) },
        rigidBodyObject: { userData: { bodyId: "ground", materialId: "ground", contactAreaM2: 0 } },
      },
    }));

    // The first render frame publishes the cracked visual and starts the
    // outcome-reveal clock, but must not cover it with the result yet.
    advanceFrame(1 / 60);
    expect(screen.getByTestId("egg-visual")).toHaveAttribute("data-cracked", "true");
    expect(onComplete).not.toHaveBeenCalled();

    advanceFrame(DROP_OUTCOME_REVEAL_SECONDS - 0.01);
    expect(onComplete).not.toHaveBeenCalled();
    advanceFrame(0.01);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete.mock.calls[0]?.[0]).toMatchObject({ outcome: "cracked", damage: 1 });
  });

  it("keeps an egg taped to balloons in the visible drop until it reaches the ground", () => {
    const design = freshDesign();
    design.heightFt = 5;
    design.parts = [
      {
        id: "balloon-left",
        materialId: "balloon",
        transform: {
          position: [-0.18, 0.68, 0],
          rotation: [0, 0, 0, 1],
          dimensions: [0.3, 0.38, 0.3],
        },
      },
      {
        id: "balloon-right",
        materialId: "balloon",
        transform: {
          position: [0.18, 0.68, 0],
          rotation: [0, 0, 0, 1],
          dimensions: [0.3, 0.38, 0.3],
        },
      },
    ];
    design.joints = [
      {
        id: "tape-left",
        kind: "fixed",
        materialId: "tape",
        bodyA: "egg",
        bodyB: "balloon-left",
        anchorA: [-0.02, 0.03, 0],
        anchorB: [0.16, -0.19, 0],
      },
      {
        id: "tape-right",
        kind: "fixed",
        materialId: "tape",
        bodyA: "egg",
        bodyB: "balloon-right",
        anchorA: [0.02, 0.03, 0],
        anchorB: [-0.16, -0.19, 0],
      },
    ];
    const onComplete = vi.fn();

    render(<DropScene design={design} runId={1} running playbackRate={0.2} gravityMps2={STANDARD_GRAVITY_MPS2} onComplete={onComplete} />);

    // The assembled contraption gets the same motionless release hold as a
    // bare egg; connector setup must not skip straight to the result screen.
    advanceFrame(0.499);
    advanceFrame(0.001);
    expect(playbackHarness.stepDeltas).toEqual([]);
    expect(onComplete).not.toHaveBeenCalled();

    // Reproduce the early damage event that a fixed tape joint can generate
    // on its first physics step while the contraption is still high in frame.
    playbackHarness.eggBody.velocity = { x: 0, y: -20, z: 0 };
    advanceFrame(0.1);
    act(() => playbackHarness.collision?.({
      other: {
        rigidBody: { linvel: () => ({ x: 0, y: 0, z: 0 }) },
        rigidBodyObject: { userData: { bodyId: "balloon-left", materialId: "balloon", contactAreaM2: 0.09 } },
      },
    }));
    advanceFrame(1 / 60);

    // Even after the normal result-reveal interval, the drop must remain
    // visible while the egg is still falling rather than covering the canvas.
    playbackHarness.eggBody.position.y = 0.55;
    advanceFrame(DROP_OUTCOME_REVEAL_SECONDS + 0.25);
    expect(onComplete).not.toHaveBeenCalled();

    // Reaching the ground starts the visible crack/splat linger, after which
    // the result can safely replace the simulation.
    playbackHarness.eggBody.position.y = 0.05;
    advanceFrame(1 / 60);
    advanceFrame(DROP_OUTCOME_REVEAL_SECONDS - 0.01);
    expect(onComplete).not.toHaveBeenCalled();
    advanceFrame(0.01);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete.mock.calls[0]?.[0]).toMatchObject({ outcome: "cracked" });
  });

  it("wins 3 real seconds after the egg rests on the ground even while another part keeps moving", () => {
    const design = freshDesign();
    design.heightFt = 5;
    design.parts = [
      {
        id: "straw-loose",
        materialId: "straw",
        transform: {
          position: [0.4, 0.02, 0],
          rotation: [0, 0, 0, 1],
          dimensions: [0.2, 0.012, 0.012],
        },
      },
    ];
    // A loose straw that never settles: under the old all-bodies rule this
    // would hold the verdict hostage until the 20 s simulation timeout.
    const looseStrawBody = {
      position: { x: 0.4, y: 0.02, z: 0 },
      velocity: { x: 2, y: 0, z: 2 },
      translation() { return { ...this.position }; },
      linvel() { return { ...this.velocity }; },
      angvel: () => ({ x: 0, y: 0, z: 6 }),
      rotation: () => ({ x: 0, y: 0, z: 0, w: 1 }),
      isSleeping: () => false,
      resetForces: () => undefined,
      resetTorques: () => undefined,
      addForce: () => undefined,
      addForceAtPoint: () => undefined,
      addTorque: () => undefined,
      mass: () => .001,
    };
    playbackHarness.bodyOverrides["straw-loose"] = looseStrawBody;
    const onComplete = vi.fn();

    render(<DropScene design={design} runId={1} running playbackRate={0.2} gravityMps2={STANDARD_GRAVITY_MPS2} onComplete={onComplete} />);
    advanceFrame(0.499);
    advanceFrame(0.001);

    // The egg comes to rest on the ground immediately after release.
    playbackHarness.eggBody.position = { x: 0, y: 0.03, z: 0 };
    playbackHarness.eggBody.velocity = { x: 0, y: 0, z: 0 };

    // At 0.2× playback the 0.35 s simulation-time startup guard lasts 1.75
    // real seconds; the settle timer then counts real (wall-clock) time.
    const guardFrames = Math.ceil(0.35 / 0.2 * 60);
    for (let frame = 0; frame < guardFrames; frame += 1) advanceFrame(1 / 60);
    // Just under the settle threshold: no verdict yet.
    for (let frame = 0; frame < (DROP_SETTLE_REAL_SECONDS - 0.25) * 60; frame += 1) advanceFrame(1 / 60);
    expect(onComplete).not.toHaveBeenCalled();

    // Crossing 3 real seconds of egg stillness queues the survived verdict.
    for (let frame = 0; frame < 0.5 * 60; frame += 1) advanceFrame(1 / 60);
    expect(onComplete).not.toHaveBeenCalled();
    advanceFrame(DROP_OUTCOME_REVEAL_SECONDS + 0.05);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete.mock.calls[0]?.[0]).toMatchObject({ outcome: "survived" });
  });
});
