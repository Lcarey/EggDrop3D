import { create } from "zustand";
import { Quaternion, Vector3 } from "three";
import {
  MAX_JOINTS,
  MAX_PARTS,
  MISSION_BY_ID,
  countDesignMaterials,
  DEFAULT_GRAVITY_BODY_ID,
  type DesignV1,
  type DropResult,
  type GravityBodyId,
  type JointMaterialId,
  type MaterialId,
  type Transform,
} from "@eggdrop/shared";
import { DEFAULT_DROP_PLAYBACK_RATE, normalizeDropPlaybackRate } from "../dropPlayback";

export type EditorStage = "build" | "dropSetup" | "dropping" | "result";
export type TransformMode = "translate" | "rotate" | "scale";

export type CloudState = {
  id: string | null;
  version: number | null;
  editToken: string | null;
  readOnly: boolean;
  saving: boolean;
};

export type ConnectorDraft = {
  materialId: JointMaterialId;
  bodyA?: string;
  anchorA?: [number, number, number];
};

export type SnapDraft = {
  bodyA?: string;
  anchorA?: [number, number, number];
};

const connectorKind = {
  tape: "fixed",
  glue: "fixed",
  string: "rope",
  rubberBand: "spring",
} as const;

const isConnectorMaterial = (materialId: MaterialId | null): materialId is JointMaterialId =>
  materialId === "tape" || materialId === "glue" || materialId === "string" || materialId === "rubberBand";

export const DEFAULT_DIMENSIONS: Record<Exclude<MaterialId, JointMaterialId>, [number, number, number]> = {
  straw: [0.025, 0.42, 0.025],
  balloon: [0.24, 0.3, 0.24],
  bubbleWrap: [0.24, 0.045, 0.24],
  cardboard: [0.36, 0.025, 0.26],
  craftStick: [0.035, 0.3, 0.015],
  paperCup: [0.12, 0.16, 0.12],
  cottonBall: [0.08, 0.08, 0.08],
  foamBlock: [0.16, 0.12, 0.16],
  sponge: [0.18, 0.08, 0.12],
  newspaper: [0.14, 0.12, 0.14],
  plasticBag: [0.4, 0.018, 0.4],
  packingPeanuts: [0.12, 0.08, 0.1],
  fishingWeight: [0.015, 0.025, 0.015],
};

const clone = <T,>(value: T): T => structuredClone(value);
const worldPoint = (transform: Transform, local: [number, number, number]) =>
  new Vector3(...local).applyQuaternion(new Quaternion(...transform.rotation)).add(new Vector3(...transform.position));
const makeId = () => globalThis.crypto?.randomUUID?.() ?? `part-${Date.now()}-${Math.random().toString(36).slice(2)}`;

// Glued anchor pairs must stay coincident while building. Whenever a body
// moves (or rotates/resizes — anchors are rotation-dependent local offsets),
// walk every body reachable through glue joints and translate it so each glue
// pair shares one world point again. Seeded bodies keep their transforms;
// partners only ever translate — their rotation and dimensions are untouched.
const settleGlue = (design: DesignV1, seedIds: string[], settled = new Set<string>()) => {
  const glueJoints = design.joints.filter((joint) => joint.materialId === "glue");
  if (glueJoints.length === 0) return;
  for (const id of seedIds) settled.add(id);
  const queue = [...seedIds];
  while (queue.length > 0) {
    const currentId = queue.shift()!;
    for (const joint of glueJoints) {
      if (joint.bodyA !== currentId && joint.bodyB !== currentId) continue;
      const partnerId = joint.bodyA === currentId ? joint.bodyB : joint.bodyA;
      if (settled.has(partnerId)) continue;
      settled.add(partnerId);
      queue.push(partnerId);
      const currentTransform = getBodyTransform(design, currentId);
      const partnerTransform = getBodyTransform(design, partnerId);
      if (!currentTransform || !partnerTransform) continue;
      const currentAnchor = joint.bodyA === currentId ? joint.anchorA : joint.anchorB;
      const partnerAnchor = joint.bodyA === currentId ? joint.anchorB : joint.anchorA;
      const delta = worldPoint(currentTransform, currentAnchor).sub(worldPoint(partnerTransform, partnerAnchor));
      partnerTransform.position = [
        partnerTransform.position[0] + delta.x,
        partnerTransform.position[1] + delta.y,
        partnerTransform.position[2] + delta.z,
      ];
    }
  }
};

// Re-establishes every glue bond in a design, e.g. drafts saved before glue
// coincidence was enforced. Each glue component settles around its first body.
const settleAllGlue = (design: DesignV1) => {
  const settled = new Set<string>();
  for (const joint of design.joints) {
    if (joint.materialId !== "glue" || settled.has(joint.bodyA) || settled.has(joint.bodyB)) continue;
    settleGlue(design, [joint.bodyA], settled);
  }
};

const hasInventory = (design: DesignV1, materialId: MaterialId) => {
  if (design.mode !== "challenge" || !design.missionId) return true;
  const counts = countDesignMaterials(design);
  return counts[materialId] < MISSION_BY_ID[design.missionId].inventory[materialId];
};

export const freshDesign = (): DesignV1 => ({
  schemaVersion: 1,
  physicsVersion: 1,
  name: "My egg drop",
  mode: "sandbox",
  missionId: null,
  heightFt: 15,
  eggTransform: {
    position: [0, 0.38, 0],
    rotation: [0, 0, 0, 1],
    dimensions: [0.048, 0.064, 0.048],
  },
  parts: [],
  joints: [],
});

type EditorStore = {
  design: DesignV1;
  past: DesignV1[];
  future: DesignV1[];
  selectedId: string | null;
  activeMaterial: MaterialId | null;
  connectorDraft: ConnectorDraft | null;
  snapDraft: SnapDraft | null;
  transformMode: TransformMode;
  stage: EditorStage;
  runId: number;
  result: DropResult | null;
  playbackRate: number;
  gravityBodyId: GravityBodyId;
  liveEggSpeedMps: number;
  peakEggSpeedMps: number;
  cloud: CloudState;
  setDesign: (design: DesignV1) => void;
  setCloud: (cloud: Partial<CloudState>) => void;
  commit: (change: (draft: DesignV1) => void) => void;
  setName: (name: string) => void;
  setModeAndMission: (mode: DesignV1["mode"], missionId: DesignV1["missionId"], heightFt: number) => void;
  setHeight: (heightFt: number) => void;
  setPlaybackRate: (playbackRate: number) => void;
  setGravityBodyId: (gravityBodyId: GravityBodyId) => void;
  chooseMaterial: (materialId: MaterialId | null) => void;
  placePart: (materialId: MaterialId, position: [number, number, number]) => void;
  beginOrFinishConnector: (bodyId: string, anchor: [number, number, number]) => void;
  setSnapMode: (active: boolean) => void;
  pickSnapEnd: (bodyId: string, anchor: [number, number, number]) => void;
  select: (id: string | null) => void;
  setTransformMode: (mode: TransformMode) => void;
  updateTransform: (id: string, transform: Transform) => void;
  duplicateSelected: () => void;
  deleteSelected: () => void;
  removeJoint: (id: string) => void;
  clear: () => void;
  undo: () => void;
  redo: () => void;
  openDropSetup: () => void;
  cancelDropSetup: () => void;
  release: () => void;
  finishRun: (result: DropResult) => void;
  abortRun: () => void;
  dropAgain: () => void;
  editBuild: () => void;
};

export const useEditorStore = create<EditorStore>((set, get) => ({
  design: freshDesign(),
  past: [],
  future: [],
  selectedId: "egg",
  activeMaterial: null,
  connectorDraft: null,
  snapDraft: null,
  transformMode: "translate",
  stage: "build",
  runId: 0,
  result: null,
  playbackRate: DEFAULT_DROP_PLAYBACK_RATE,
  gravityBodyId: DEFAULT_GRAVITY_BODY_ID,
  liveEggSpeedMps: 0,
  peakEggSpeedMps: 0,
  cloud: { id: null, version: null, editToken: null, readOnly: false, saving: false },
  setDesign: (design) => set(() => {
    const next = clone(design);
    // Heal drafts saved before glue coincidence was enforced during moves.
    settleAllGlue(next);
    return { design: next, past: [], future: [], selectedId: "egg", activeMaterial: null, connectorDraft: null, snapDraft: null, stage: "build", result: null };
  }),
  setCloud: (cloud) => set((state) => ({ cloud: { ...state.cloud, ...cloud } })),
  commit: (change) => set((state) => {
    const next = clone(state.design);
    change(next);
    return { design: next, past: [...state.past, clone(state.design)].slice(-50), future: [], result: null };
  }),
  setName: (name) => get().commit((design) => { design.name = name.slice(0, 60); }),
  setModeAndMission: (mode, missionId, heightFt) => get().commit((design) => {
    design.mode = mode;
    design.missionId = missionId;
    design.heightFt = heightFt;
    design.parts = [];
    design.joints = [];
  }),
  setHeight: (heightFt) => set((state) => ({ design: { ...state.design, heightFt } })),
  setPlaybackRate: (playbackRate) => set({ playbackRate: normalizeDropPlaybackRate(playbackRate) }),
  setGravityBodyId: (gravityBodyId) => set({ gravityBodyId }),
  chooseMaterial: (materialId) => set({
    activeMaterial: materialId,
    selectedId: null,
    connectorDraft: isConnectorMaterial(materialId) ? { materialId } : null,
    snapDraft: null,
  }),
  placePart: (materialId, position) => {
    if (isConnectorMaterial(materialId)) return;
    const current = get().design;
    if (current.parts.length >= MAX_PARTS || !hasInventory(current, materialId)) {
      set({ activeMaterial: null });
      return;
    }
    get().commit((design) => {
      design.parts.push({
        id: makeId(),
        materialId,
        transform: { position, rotation: [0, 0, 0, 1], dimensions: DEFAULT_DIMENSIONS[materialId] },
      });
    });
    const newest = get().design.parts.at(-1);
    const next = get().design;
    set({
      selectedId: newest?.id ?? null,
      activeMaterial: next.parts.length >= MAX_PARTS || !hasInventory(next, materialId) ? null : materialId,
    });
  },
  beginOrFinishConnector: (bodyId, anchor) => {
    const draft = get().connectorDraft;
    if (!draft) return;
    const current = get().design;
    if (current.joints.length >= MAX_JOINTS || !hasInventory(current, draft.materialId)) {
      set({ connectorDraft: null, activeMaterial: null });
      return;
    }
    if (!draft.bodyA) {
      set({ connectorDraft: { ...draft, bodyA: bodyId, anchorA: anchor } });
      return;
    }
    if (draft.bodyA === bodyId) return;
    get().commit((design) => {
      design.joints.push({
        id: makeId(),
        kind: connectorKind[draft.materialId],
        materialId: draft.materialId,
        bodyA: draft.bodyA!,
        bodyB: bodyId,
        anchorA: draft.anchorA ?? [0, 0, 0],
        anchorB: anchor,
      });
      // Glue pulls the second body over (translation only) so the two clicked
      // points share one world position, dragging its own glued partners along.
      if (draft.materialId === "glue") settleGlue(design, [draft.bodyA!]);
    });
    const next = get().design;
    const exhausted = next.joints.length >= MAX_JOINTS || !hasInventory(next, draft.materialId);
    set({
      connectorDraft: exhausted ? null : { materialId: draft.materialId },
      activeMaterial: exhausted ? null : draft.materialId,
    });
  },
  setSnapMode: (active) => set({
    snapDraft: active ? {} : null,
    ...(active ? { activeMaterial: null, connectorDraft: null, selectedId: null } : {}),
  }),
  pickSnapEnd: (bodyId, anchor) => {
    const draft = get().snapDraft;
    if (!draft) return;
    if (!draft.bodyA || !draft.anchorA || draft.bodyA === bodyId) {
      set({ snapDraft: { bodyA: bodyId, anchorA: anchor } });
      return;
    }
    const design = get().design;
    const first = getBodyTransform(design, draft.bodyA);
    const second = getBodyTransform(design, bodyId);
    if (!first || !second) {
      set({ snapDraft: {} });
      return;
    }
    const delta = worldPoint(first, draft.anchorA).sub(worldPoint(second, anchor));
    get().commit((next) => {
      const transform = getBodyTransform(next, bodyId);
      if (!transform) return;
      transform.position = [
        transform.position[0] + delta.x,
        transform.position[1] + delta.y,
        transform.position[2] + delta.z,
      ];
      // The snap target stays put; the snapped body's glue partners follow it.
      settleGlue(next, [draft.bodyA!, bodyId]);
    });
    set({ snapDraft: {}, selectedId: bodyId });
  },
  select: (selectedId) => set({ selectedId, activeMaterial: null, connectorDraft: null, snapDraft: null }),
  setTransformMode: (transformMode) => set({ transformMode }),
  updateTransform: (id, transform) => get().commit((design) => {
    if (id === "egg") design.eggTransform = clone(transform);
    else {
      const part = design.parts.find((candidate) => candidate.id === id);
      if (part) part.transform = clone(transform);
    }
    settleGlue(design, [id]);
  }),
  duplicateSelected: () => {
    const id = get().selectedId;
    if (!id || id === "egg") return;
    const current = get().design;
    const source = current.parts.find((part) => part.id === id);
    if (!source) return;
    if (current.parts.length >= MAX_PARTS || !hasInventory(current, source.materialId)) {
      set({ activeMaterial: null, connectorDraft: null });
      return;
    }
    const copyId = makeId();
    get().commit((design) => {
      const copy = clone(source);
      copy.id = copyId;
      copy.transform.position[0] += 0.1;
      copy.transform.position[2] += 0.1;
      design.parts.push(copy);
    });
    set({ selectedId: copyId });
  },
  deleteSelected: () => {
    const id = get().selectedId;
    if (!id || id === "egg") return;
    get().commit((design) => {
      design.parts = design.parts.filter((part) => part.id !== id);
      design.joints = design.joints.filter((joint) => joint.bodyA !== id && joint.bodyB !== id);
    });
    set({ selectedId: "egg" });
  },
  removeJoint: (id) => get().commit((design) => { design.joints = design.joints.filter((joint) => joint.id !== id); }),
  clear: () => get().commit((design) => { design.parts = []; design.joints = []; }),
  undo: () => set((state) => {
    const previous = state.past.at(-1);
    if (!previous) return state;
    return { design: clone(previous), past: state.past.slice(0, -1), future: [clone(state.design), ...state.future], selectedId: "egg" };
  }),
  redo: () => set((state) => {
    const next = state.future[0];
    if (!next) return state;
    return { design: clone(next), past: [...state.past, clone(state.design)], future: state.future.slice(1), selectedId: "egg" };
  }),
  openDropSetup: () => set({ stage: "dropSetup", selectedId: null, activeMaterial: null, connectorDraft: null, snapDraft: null }),
  cancelDropSetup: () => set({ stage: "build" }),
  release: () => set((state) => ({ stage: "dropping", runId: state.runId + 1, result: null, liveEggSpeedMps: 0, peakEggSpeedMps: 0 })),
  // Ignore completions that land after the user quit the run with Escape.
  finishRun: (result) => set((state) => (state.stage === "dropping" ? { stage: "result", result, liveEggSpeedMps: 0, peakEggSpeedMps: 0 } : state)),
  abortRun: () => set((state) => (state.stage === "dropping" ? { stage: "build", result: null, liveEggSpeedMps: 0, peakEggSpeedMps: 0 } : state)),
  dropAgain: () => set((state) => ({ stage: "dropping", runId: state.runId + 1, result: null, liveEggSpeedMps: 0, peakEggSpeedMps: 0 })),
  editBuild: () => set({ stage: "build", result: null, selectedId: "egg", liveEggSpeedMps: 0, peakEggSpeedMps: 0 }),
}));

export const getBodyTransform = (design: DesignV1, id: string): Transform | undefined =>
  id === "egg" ? design.eggTransform : design.parts.find((part) => part.id === id)?.transform;
