import {
  MAX_JOINTS,
  MAX_PARTS,
  MISSION_BY_ID,
  type DesignJointV1,
  type DesignPartV1,
} from "@eggdrop/shared";
import { Quaternion, Vector3 } from "three";
import { beforeEach, describe, expect, it } from "vitest";
import { freshDesign, getBodyTransform, useEditorStore } from "./store";

const makePart = (index: number, materialId: DesignPartV1["materialId"] = "straw"): DesignPartV1 => ({
  id: `part-${index}`,
  materialId,
  transform: {
    position: [index * 0.01, 0.25, 0],
    rotation: [0, 0, 0, 1],
    dimensions: [0.025, 0.42, 0.025],
  },
});

const makeJoint = (index: number, bodyB = "part-0"): DesignJointV1 => ({
  id: `joint-${index}`,
  kind: "fixed",
  materialId: "tape",
  bodyA: "egg",
  bodyB,
  anchorA: [0, 0, 0],
  anchorB: [0, 0, 0],
});

const resetStore = () => useEditorStore.setState({
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
  playbackRate: 0.2,
  cloud: { id: null, version: null, editToken: null, readOnly: false, saving: false },
});

const glueGap = (jointIndex = 0) => {
  const design = useEditorStore.getState().design;
  const joint = design.joints[jointIndex]!;
  const a = getBodyTransform(design, joint.bodyA)!;
  const b = getBodyTransform(design, joint.bodyB)!;
  const pointA = new Vector3(...joint.anchorA).applyQuaternion(new Quaternion(...a.rotation)).add(new Vector3(...a.position));
  const pointB = new Vector3(...joint.anchorB).applyQuaternion(new Quaternion(...b.rotation)).add(new Vector3(...b.position));
  return pointA.distanceTo(pointB);
};

const expectPositionClose = (actual: readonly number[], expected: readonly number[]) => {
  expected.forEach((value, index) => expect(actual[index]).toBeCloseTo(value, 10));
};

describe("editor store", () => {
  beforeEach(resetStore);

  it("places, duplicates, deletes, undoes, and redoes solid materials", () => {
    const editor = useEditorStore.getState();
    editor.placePart("straw", [0.1, 0.25, -0.1]);

    const original = useEditorStore.getState().design.parts[0]!;
    expect(original.materialId).toBe("straw");
    expect(original.transform.dimensions).toEqual([0.025, 0.42, 0.025]);
    expect(useEditorStore.getState().selectedId).toBe(original.id);

    useEditorStore.getState().duplicateSelected();
    const duplicated = useEditorStore.getState().design.parts[1]!;
    expect(duplicated.id).not.toBe(original.id);
    expect(duplicated.transform.position).toEqual([0.2, 0.25, 0]);

    useEditorStore.getState().deleteSelected();
    expect(useEditorStore.getState().design.parts.map((part) => part.id)).toEqual([original.id]);
    expect(useEditorStore.getState().selectedId).toBe("egg");

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().design.parts).toHaveLength(2);
    useEditorStore.getState().redo();
    expect(useEditorStore.getState().design.parts).toHaveLength(1);
  });

  it("creates the correct two-anchor joint and removes it with a deleted body", () => {
    useEditorStore.getState().placePart("foamBlock", [0, 0.1, 0]);
    const bodyId = useEditorStore.getState().design.parts[0]!.id;

    useEditorStore.getState().chooseMaterial("rubberBand");
    useEditorStore.getState().beginOrFinishConnector("egg", [0, -0.02, 0]);
    useEditorStore.getState().beginOrFinishConnector(bodyId, [0, 0.04, 0]);

    expect(useEditorStore.getState().design.joints).toEqual([
      expect.objectContaining({
        kind: "spring",
        materialId: "rubberBand",
        bodyA: "egg",
        bodyB: bodyId,
        anchorA: [0, -0.02, 0],
        anchorB: [0, 0.04, 0],
      }),
    ]);
    expect(useEditorStore.getState().connectorDraft).toEqual({ materialId: "rubberBand" });

    useEditorStore.getState().select(bodyId);
    useEditorStore.getState().deleteSelected();
    expect(useEditorStore.getState().design.joints).toHaveLength(0);
  });

  it("glue pulls the second body onto the clicked point and bonds it in one undo step", () => {
    useEditorStore.getState().placePart("foamBlock", [0, 0.1, 0]);
    useEditorStore.getState().placePart("cardboard", [0.5, 0.3, 0.2]);
    const [first, second] = useEditorStore.getState().design.parts;

    useEditorStore.getState().chooseMaterial("glue");
    expect(useEditorStore.getState().connectorDraft).toEqual({ materialId: "glue" });

    useEditorStore.getState().beginOrFinishConnector(first!.id, [0.08, 0, 0]);
    useEditorStore.getState().beginOrFinishConnector(second!.id, [-0.15, 0.006, 0]);

    // First clicked point sits at world [0.08, 0.1, 0]; the cardboard translates
    // so its clicked local point lands exactly there.
    const moved = useEditorStore.getState().design.parts[1]!;
    expect(moved.transform.position[0]).toBeCloseTo(0.23, 10);
    expect(moved.transform.position[1]).toBeCloseTo(0.094, 10);
    expect(moved.transform.position[2]).toBeCloseTo(0, 10);
    expect(moved.transform.rotation).toEqual([0, 0, 0, 1]);
    expect(useEditorStore.getState().design.parts[0]!.transform.position).toEqual([0, 0.1, 0]);

    expect(useEditorStore.getState().design.joints).toEqual([
      expect.objectContaining({
        kind: "fixed",
        materialId: "glue",
        bodyA: first!.id,
        bodyB: second!.id,
        anchorA: [0.08, 0, 0],
        anchorB: [-0.15, 0.006, 0],
      }),
    ]);
    // Glue stays armed for the next bond in sandbox mode.
    expect(useEditorStore.getState().connectorDraft).toEqual({ materialId: "glue" });

    // One undo reverts both the translation and the joint atomically.
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().design.joints).toHaveLength(0);
    expect(useEditorStore.getState().design.parts[1]!.transform.position).toEqual([0.5, 0.3, 0.2]);
  });

  it("keeps glued anchor pairs coincident when a glued part is moved or rotated", () => {
    useEditorStore.getState().placePart("straw", [0, 0.21, 0]);
    useEditorStore.getState().placePart("straw", [0.4, 0.21, 0.3]);
    const [first, second] = useEditorStore.getState().design.parts;
    useEditorStore.getState().chooseMaterial("glue");
    useEditorStore.getState().beginOrFinishConnector(first!.id, [0, 0.21, 0]);
    useEditorStore.getState().beginOrFinishConnector(second!.id, [0, -0.21, 0]);
    expect(glueGap()).toBeCloseTo(0, 10);

    // Translating the first straw drags its glued partner by the same delta.
    useEditorStore.getState().updateTransform(first!.id, {
      position: [0.2, 0.31, -0.05],
      rotation: [0, 0, 0, 1],
      dimensions: [0.025, 0.42, 0.025],
    });
    expectPositionClose(useEditorStore.getState().design.parts[1]!.transform.position, [0.2, 0.73, -0.05]);
    expect(useEditorStore.getState().design.parts[1]!.transform.rotation).toEqual([0, 0, 0, 1]);
    expect(glueGap()).toBeCloseTo(0, 10);

    // Rotating it re-translates the partner (partner keeps its own rotation).
    useEditorStore.getState().updateTransform(first!.id, {
      position: [0.2, 0.31, -0.05],
      rotation: [0, 0, Math.SQRT1_2, Math.SQRT1_2],
      dimensions: [0.025, 0.42, 0.025],
    });
    expectPositionClose(useEditorStore.getState().design.parts[1]!.transform.position, [-0.01, 0.52, -0.05]);
    expect(useEditorStore.getState().design.parts[1]!.transform.rotation).toEqual([0, 0, 0, 1]);
    expect(glueGap()).toBeCloseTo(0, 10);
  });

  it("moves chained glue groups as one, undoes in one step, and follows the snap tool", () => {
    useEditorStore.getState().placePart("straw", [0, 0.21, 0]);
    useEditorStore.getState().placePart("straw", [0.4, 0.21, 0.3]);
    useEditorStore.getState().placePart("straw", [0.8, 0.21, 0.6]);
    const [a, b, c] = useEditorStore.getState().design.parts;
    useEditorStore.getState().chooseMaterial("glue");
    useEditorStore.getState().beginOrFinishConnector(a!.id, [0, 0.21, 0]);
    useEditorStore.getState().beginOrFinishConnector(b!.id, [0, -0.21, 0]);
    useEditorStore.getState().beginOrFinishConnector(b!.id, [0, 0.21, 0]);
    useEditorStore.getState().beginOrFinishConnector(c!.id, [0, -0.21, 0]);
    expectPositionClose(useEditorStore.getState().design.parts[1]!.transform.position, [0, 0.63, 0]);
    expectPositionClose(useEditorStore.getState().design.parts[2]!.transform.position, [0, 1.05, 0]);

    // Moving A translates the whole glued tower.
    const pastBefore = useEditorStore.getState().past.length;
    useEditorStore.getState().updateTransform(a!.id, {
      position: [0.1, 0.21, 0.2],
      rotation: [0, 0, 0, 1],
      dimensions: [0.025, 0.42, 0.025],
    });
    expectPositionClose(useEditorStore.getState().design.parts[1]!.transform.position, [0.1, 0.63, 0.2]);
    expectPositionClose(useEditorStore.getState().design.parts[2]!.transform.position, [0.1, 1.05, 0.2]);
    expect(glueGap(0)).toBeCloseTo(0, 10);
    expect(glueGap(1)).toBeCloseTo(0, 10);
    expect(useEditorStore.getState().past).toHaveLength(pastBefore + 1);

    // A single undo restores every member of the group.
    useEditorStore.getState().undo();
    expectPositionClose(useEditorStore.getState().design.parts[0]!.transform.position, [0, 0.21, 0]);
    expectPositionClose(useEditorStore.getState().design.parts[1]!.transform.position, [0, 0.63, 0]);
    expectPositionClose(useEditorStore.getState().design.parts[2]!.transform.position, [0, 1.05, 0]);

    // Snapping a glued body drags its glue partners along too.
    useEditorStore.getState().setSnapMode(true);
    useEditorStore.getState().pickSnapEnd("egg", [0, 0.032, 0]);
    useEditorStore.getState().pickSnapEnd(a!.id, [0, -0.21, 0]);
    expectPositionClose(useEditorStore.getState().design.parts[0]!.transform.position, [0, 0.622, 0]);
    expectPositionClose(useEditorStore.getState().design.parts[1]!.transform.position, [0, 1.042, 0]);
    expectPositionClose(useEditorStore.getState().design.parts[2]!.transform.position, [0, 1.462, 0]);
    expect(glueGap(0)).toBeCloseTo(0, 10);
    expect(glueGap(1)).toBeCloseTo(0, 10);
  });

  it("snap-ends translates the second picked body onto the first without rotating", () => {
    useEditorStore.getState().placePart("straw", [0, 0.25, 0]);
    useEditorStore.getState().placePart("straw", [0.4, 0.25, 0.2]);
    const [first, second] = useEditorStore.getState().design.parts;

    useEditorStore.getState().setSnapMode(true);
    expect(useEditorStore.getState()).toMatchObject({ snapDraft: {}, selectedId: null, activeMaterial: null, connectorDraft: null });

    useEditorStore.getState().pickSnapEnd(first!.id, [0, 0.21, 0]);
    expect(useEditorStore.getState().snapDraft).toEqual({ bodyA: first!.id, anchorA: [0, 0.21, 0] });

    // Re-picking on the same body replaces the first end instead of snapping.
    const pastBefore = useEditorStore.getState().past.length;
    useEditorStore.getState().pickSnapEnd(first!.id, [0, -0.21, 0]);
    expect(useEditorStore.getState().snapDraft).toEqual({ bodyA: first!.id, anchorA: [0, -0.21, 0] });
    expect(useEditorStore.getState().past).toHaveLength(pastBefore);
    useEditorStore.getState().pickSnapEnd(first!.id, [0, 0.21, 0]);

    useEditorStore.getState().pickSnapEnd(second!.id, [0, -0.21, 0]);
    const moved = useEditorStore.getState().design.parts[1]!;
    // First straw's top end sits at world [0, 0.46, 0]; the second straw's bottom
    // end must land there, so its centre moves to [0, 0.67, 0].
    expect(moved.transform.position[0]).toBeCloseTo(0, 10);
    expect(moved.transform.position[1]).toBeCloseTo(0.67, 10);
    expect(moved.transform.position[2]).toBeCloseTo(0, 10);
    expect(moved.transform.rotation).toEqual([0, 0, 0, 1]);
    expect(useEditorStore.getState().design.parts[0]!.transform.position).toEqual([0, 0.25, 0]);
    expect(useEditorStore.getState()).toMatchObject({ snapDraft: {}, selectedId: second!.id });

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().design.parts[1]!.transform.position).toEqual([0.4, 0.25, 0.2]);
  });

  it("snap-ends can move the egg and clears when a tool or selection changes", () => {
    useEditorStore.getState().placePart("straw", [0.3, 0.25, 0]);
    const partId = useEditorStore.getState().design.parts[0]!.id;

    useEditorStore.getState().setSnapMode(true);
    useEditorStore.getState().pickSnapEnd(partId, [0, -0.21, 0]);
    useEditorStore.getState().pickSnapEnd("egg", [0, 0.032, 0]);
    const egg = useEditorStore.getState().design.eggTransform;
    expect(egg.position[0]).toBeCloseTo(0.3, 10);
    expect(egg.position[1]).toBeCloseTo(0.008, 10);
    expect(egg.position[2]).toBeCloseTo(0, 10);
    expect(egg.rotation).toEqual([0, 0, 0, 1]);

    expect(useEditorStore.getState().snapDraft).toEqual({});
    useEditorStore.getState().select(null);
    expect(useEditorStore.getState().snapDraft).toBeNull();

    useEditorStore.getState().setSnapMode(true);
    useEditorStore.getState().chooseMaterial("tape");
    expect(useEditorStore.getState().snapDraft).toBeNull();
  });

  it("keeps the permanent egg while clearing or deleting", () => {
    const egg = structuredClone(useEditorStore.getState().design.eggTransform);
    useEditorStore.getState().deleteSelected();
    expect(getBodyTransform(useEditorStore.getState().design, "egg")).toEqual(egg);

    useEditorStore.getState().placePart("cardboard", [0, 0.1, 0]);
    useEditorStore.getState().clear();
    expect(useEditorStore.getState().design.parts).toHaveLength(0);
    expect(useEditorStore.getState().design.eggTransform).toEqual(egg);
  });

  it("resets construction for a mission and advances the drop lifecycle", () => {
    useEditorStore.getState().placePart("sponge", [0, 0.1, 0]);
    useEditorStore.getState().setModeAndMission("challenge", "air-time", 25);
    expect(useEditorStore.getState().design).toMatchObject({
      mode: "challenge",
      missionId: "air-time",
      heightFt: 25,
      parts: [],
      joints: [],
    });

    useEditorStore.getState().openDropSetup();
    expect(useEditorStore.getState().stage).toBe("dropSetup");
    useEditorStore.getState().setHeight(31.5);
    useEditorStore.getState().release();
    expect(useEditorStore.getState()).toMatchObject({ stage: "dropping", runId: 1, result: null });

    const result = {
      outcome: "survived" as const,
      heightFt: 31.5,
      impactSpeedMps: 8.4,
      peakG: 21,
      peakForceN: 12,
      damage: 0.31,
      score: 12_345,
    };
    useEditorStore.getState().finishRun(result);
    expect(useEditorStore.getState()).toMatchObject({ stage: "result", result });
    useEditorStore.getState().dropAgain();
    expect(useEditorStore.getState()).toMatchObject({ stage: "dropping", runId: 2, result: null });
    useEditorStore.getState().editBuild();
    expect(useEditorStore.getState()).toMatchObject({ stage: "build", selectedId: "egg", result: null });
  });

  it("stores a per-run playback rate with a 0.2× default", () => {
    expect(useEditorStore.getState().playbackRate).toBe(0.2);

    for (const playbackRate of [0.1, 1.3, 2]) {
      useEditorStore.getState().setPlaybackRate(playbackRate);
      expect(useEditorStore.getState().playbackRate).toBe(playbackRate);
    }

    useEditorStore.getState().release();
    expect(useEditorStore.getState()).toMatchObject({ stage: "dropping", playbackRate: 2 });
  });

  it("caps names at the shared schema limit", () => {
    useEditorStore.getState().setName("x".repeat(80));
    expect(useEditorStore.getState().design.name).toHaveLength(60);
  });

  it("enforces mission quantities for solids and clears an exhausted placement tool", () => {
    useEditorStore.getState().setModeAndMission("challenge", "first-flight", 10);
    const limit = MISSION_BY_ID["first-flight"].inventory.straw;
    useEditorStore.getState().chooseMaterial("straw");

    for (let index = 0; index < limit; index += 1) {
      useEditorStore.getState().placePart("straw", [index * 0.05, 0.25, 0]);
    }

    expect(useEditorStore.getState().design.parts).toHaveLength(limit);
    expect(useEditorStore.getState().activeMaterial).toBeNull();
    useEditorStore.getState().placePart("straw", [9, 9, 9]);
    expect(useEditorStore.getState().design.parts).toHaveLength(limit);

    // Duplication is another construction path and must obey the same budget.
    useEditorStore.getState().duplicateSelected();
    expect(useEditorStore.getState().design.parts).toHaveLength(limit);

    // First Flight supplies no balloons, so even a direct store action is denied.
    expect(MISSION_BY_ID["first-flight"].inventory.balloon).toBe(0);
    useEditorStore.getState().chooseMaterial("balloon");
    useEditorStore.getState().placePart("balloon", [0, 1, 0]);
    expect(useEditorStore.getState().design.parts.some((part) => part.materialId === "balloon")).toBe(false);
    expect(useEditorStore.getState().activeMaterial).toBeNull();
  });

  it("enforces mission connector quantities and cancels an exhausted connector tool", () => {
    useEditorStore.getState().setModeAndMission("challenge", "first-flight", 10);
    useEditorStore.getState().placePart("foamBlock", [0, 0.1, 0]);
    const bodyId = useEditorStore.getState().design.parts[0]!.id;
    const limit = MISSION_BY_ID["first-flight"].inventory.tape;
    useEditorStore.getState().chooseMaterial("tape");

    for (let index = 0; index < limit; index += 1) {
      useEditorStore.getState().beginOrFinishConnector("egg", [index * 0.001, 0, 0]);
      useEditorStore.getState().beginOrFinishConnector(bodyId, [0, 0, 0]);
    }

    expect(useEditorStore.getState().design.joints).toHaveLength(limit);
    expect(useEditorStore.getState()).toMatchObject({ activeMaterial: null, connectorDraft: null });
    useEditorStore.getState().beginOrFinishConnector("egg", [0, 0, 0]);
    expect(useEditorStore.getState().design.joints).toHaveLength(limit);
  });

  it("enforces the 100-part cap for placement and duplication", () => {
    const design = freshDesign();
    design.parts = Array.from({ length: MAX_PARTS - 1 }, (_, index) => makePart(index));
    useEditorStore.getState().setDesign(design);
    useEditorStore.getState().chooseMaterial("straw");
    useEditorStore.getState().placePart("straw", [0, 0.25, 0]);

    expect(useEditorStore.getState().design.parts).toHaveLength(MAX_PARTS);
    expect(useEditorStore.getState().activeMaterial).toBeNull();
    useEditorStore.getState().placePart("straw", [0, 0.25, 0]);
    expect(useEditorStore.getState().design.parts).toHaveLength(MAX_PARTS);

    useEditorStore.setState({
      selectedId: "part-0",
      activeMaterial: "tape",
      connectorDraft: { materialId: "tape" },
    });
    useEditorStore.getState().duplicateSelected();
    expect(useEditorStore.getState().design.parts).toHaveLength(MAX_PARTS);
    expect(useEditorStore.getState()).toMatchObject({ activeMaterial: null, connectorDraft: null });
  });

  it("enforces the 200-joint cap and clears connector state", () => {
    const design = freshDesign();
    design.parts = [makePart(0)];
    design.joints = Array.from({ length: MAX_JOINTS - 1 }, (_, index) => makeJoint(index));
    useEditorStore.getState().setDesign(design);
    useEditorStore.getState().chooseMaterial("string");
    useEditorStore.getState().beginOrFinishConnector("egg", [0, 0, 0]);
    useEditorStore.getState().beginOrFinishConnector("part-0", [0, 0, 0]);

    expect(useEditorStore.getState().design.joints).toHaveLength(MAX_JOINTS);
    expect(useEditorStore.getState()).toMatchObject({ activeMaterial: null, connectorDraft: null });
    useEditorStore.getState().chooseMaterial("string");
    useEditorStore.getState().beginOrFinishConnector("egg", [0, 0, 0]);
    expect(useEditorStore.getState().design.joints).toHaveLength(MAX_JOINTS);
    expect(useEditorStore.getState()).toMatchObject({ activeMaterial: null, connectorDraft: null });
  });
});
