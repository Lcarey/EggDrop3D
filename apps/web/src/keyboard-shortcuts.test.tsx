import { fireEvent, render, screen } from "@testing-library/react";
import { Quaternion, Vector3 } from "three";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { freshDesign, useEditorStore } from "./editor/store";

vi.mock("./scene/BuildScene", () => ({
  BuildScene: () => <div data-testid="build-scene">WebGL build scene</div>,
}));

vi.mock("./scene/DropScene", () => ({
  DropScene: () => <div data-testid="drop-scene">WebGL drop scene</div>,
}));

const PART_ID = "keyboard-test-part";
const START_POSITION: [number, number, number] = [0.1, 0.25, -0.15];

const MOVEMENT_COMMANDS = [
  { key: "ArrowLeft", code: "ArrowLeft", axis: "X", index: 0, direction: -1, badge: "←", name: "Left arrow" },
  { key: "ArrowRight", code: "ArrowRight", axis: "X", index: 0, direction: 1, badge: "→", name: "Right arrow" },
  { key: "PageDown", code: "PageDown", axis: "Y", index: 1, direction: -1, badge: "PgDn", name: "Page Down" },
  { key: "PageUp", code: "PageUp", axis: "Y", index: 1, direction: 1, badge: "PgUp", name: "Page Up" },
  { key: "ArrowUp", code: "ArrowUp", axis: "Z", index: 2, direction: -1, badge: "↑", name: "Up arrow" },
  { key: "ArrowDown", code: "ArrowDown", axis: "Z", index: 2, direction: 1, badge: "↓", name: "Down arrow" },
] as const;

const ROTATION_COMMANDS = [
  { key: "u", code: "KeyU", axis: "X", vector: new Vector3(1, 0, 0), direction: -1, badge: "U", name: "U" },
  { key: "i", code: "KeyI", axis: "X", vector: new Vector3(1, 0, 0), direction: 1, badge: "I", name: "I" },
  { key: "j", code: "KeyJ", axis: "Y", vector: new Vector3(0, 1, 0), direction: -1, badge: "J", name: "J" },
  { key: "k", code: "KeyK", axis: "Y", vector: new Vector3(0, 1, 0), direction: 1, badge: "K", name: "K" },
  { key: "n", code: "KeyN", axis: "Z", vector: new Vector3(0, 0, 1), direction: -1, badge: "N", name: "N" },
  { key: "m", code: "KeyM", axis: "Z", vector: new Vector3(0, 0, 1), direction: 1, badge: "M", name: "M" },
] as const;

const ALL_COMMANDS = [
  ...MOVEMENT_COMMANDS.map(({ key, code }) => ({ key, code })),
  ...ROTATION_COMMANDS.map(({ key, code }) => ({ key, code })),
];

const resetStoreWithSelectedPart = () => {
  const design = freshDesign();
  design.parts = [{
    id: PART_ID,
    materialId: "straw",
    transform: {
      position: [...START_POSITION],
      rotation: [0, 0, 0, 1],
      dimensions: [0.025, 0.42, 0.025],
    },
  }];
  useEditorStore.setState({
    design,
    past: [],
    future: [],
    selectedId: PART_ID,
    activeMaterial: null,
    connectorDraft: null,
    snapDraft: null,
    transformMode: "translate",
    stage: "build",
    runId: 0,
    result: null,
    cloud: { id: null, version: null, editToken: null, readOnly: false, saving: false },
  });
};

const openLab = async () => {
  render(<App />);
  await screen.findByRole("heading", { name: "Choose a material" });
};

const selectedTransform = () => useEditorStore.getState().design.parts.find((part) => part.id === PART_ID)!.transform;

const expectVecClose = (actual: readonly number[], expected: readonly number[]) => {
  expected.forEach((value, index) => expect(actual[index]).toBeCloseTo(value, 10));
};

describe("selected-piece keyboard movement and rotation", () => {
  beforeEach(() => {
    localStorage.clear();
    history.replaceState({}, "", "/");
    resetStoreWithSelectedPart();
  });

  it("assigns all twelve commands to unique, unmodified keys", () => {
    const codes = ALL_COMMANDS.map(({ code }) => code);

    expect(codes).toHaveLength(12);
    expect(new Set(codes).size).toBe(12);
    expect(MOVEMENT_COMMANDS.every(({ code }) => /^(Arrow(Left|Right|Up|Down)|Page(Up|Down))$/.test(code))).toBe(true);
    expect(ROTATION_COMMANDS.every(({ key }) => /^[a-z]$/.test(key))).toBe(true);
  });

  it.each(MOVEMENT_COMMANDS)("$key moves exactly 5 cm in its assigned direction", async ({ key, code, index, direction }) => {
    await openLab();

    const notPrevented = fireEvent.keyDown(window, { key, code, altKey: false, shiftKey: false, ctrlKey: false });
    const moved = [...START_POSITION];
    moved[index] = moved[index]! + direction * 0.05;
    expectVecClose(selectedTransform().position, moved);
    expect(selectedTransform().rotation).toEqual([0, 0, 0, 1]);
    expect(useEditorStore.getState().past).toHaveLength(1);
    // preventDefault must fire so arrows and PageUp/PageDown never scroll the page.
    expect(notPrevented).toBe(false);
  });

  it.each(ROTATION_COMMANDS)("$key rotates exactly 15 degrees in its assigned direction", async ({ key, code, vector, direction }) => {
    await openLab();

    fireEvent.keyDown(window, { key, code, altKey: false, shiftKey: false, ctrlKey: false });
    expectVecClose(selectedTransform().position, START_POSITION);
    const actual = new Quaternion(...selectedTransform().rotation);
    const expected = new Quaternion().setFromAxisAngle(vector, direction * Math.PI / 12);
    expect(actual.angleTo(expected)).toBeCloseTo(0, 10);
    expect(actual.angleTo(new Quaternion())).toBeCloseTo(Math.PI / 12, 10);
    expect(useEditorStore.getState().past).toHaveLength(1);
  });

  it("ignores movement keys pressed with modifiers", async () => {
    const before = structuredClone(selectedTransform());
    await openLab();

    for (const { key, code } of MOVEMENT_COMMANDS) {
      fireEvent.keyDown(window, { key, code, shiftKey: true });
      fireEvent.keyDown(window, { key, code, altKey: true });
      fireEvent.keyDown(window, { key, code, metaKey: true });
      fireEvent.keyDown(window, { key, code, ctrlKey: true });
    }
    fireEvent.keyDown(window, { key: "u", code: "KeyU", ctrlKey: true });

    expect(selectedTransform()).toEqual(before);
    expect(useEditorStore.getState().past).toHaveLength(0);
  });

  it("retires the old Q/W/A/S/Z/X movement letters and W/E/R mode commands", async () => {
    useEditorStore.setState({ transformMode: "scale" });
    const before = structuredClone(selectedTransform());
    await openLab();

    for (const key of ["q", "w", "a", "s", "z", "x", "e", "r"]) {
      fireEvent.keyDown(window, { key, code: `Key${key.toUpperCase()}` });
    }

    expect(selectedTransform()).toEqual(before);
    expect(useEditorStore.getState().past).toHaveLength(0);
    expect(useEditorStore.getState().transformMode).toBe("scale");
  });

  it("does nothing when no body is selected", async () => {
    useEditorStore.setState({ selectedId: null });
    const before = structuredClone(useEditorStore.getState().design);
    await openLab();

    for (const { key, code } of ALL_COMMANDS) {
      fireEvent.keyDown(window, { key, code });
    }

    expect(useEditorStore.getState().design).toEqual(before);
    expect(useEditorStore.getState().past).toHaveLength(0);
  });

  it("does nothing outside editable build mode", async () => {
    useEditorStore.setState({ stage: "dropSetup" });
    const before = structuredClone(selectedTransform());
    await openLab();

    fireEvent.keyDown(window, { key: "ArrowLeft", code: "ArrowLeft" });
    fireEvent.keyDown(window, { key: "i", code: "KeyI" });

    expect(selectedTransform()).toEqual(before);
  });

  it("does nothing when the selected body is read-only", async () => {
    useEditorStore.setState((state) => ({
      cloud: { ...state.cloud, readOnly: true },
    }));
    const before = structuredClone(selectedTransform());
    await openLab();

    fireEvent.keyDown(window, { key: "ArrowDown", code: "ArrowDown" });
    fireEvent.keyDown(window, { key: "U", code: "KeyU" });

    expect(selectedTransform()).toEqual(before);
  });

  it("ignores held-key repeat events", async () => {
    const before = structuredClone(selectedTransform());
    await openLab();

    fireEvent.keyDown(window, { key: "ArrowRight", code: "ArrowRight", repeat: true });
    fireEvent.keyDown(window, { key: "j", code: "KeyJ", repeat: true });

    expect(selectedTransform()).toEqual(before);
    expect(useEditorStore.getState().past).toHaveLength(0);
  });

  it("shows one accessible badge per direction and explicitly names every numeric field", async () => {
    await openLab();

    for (const axis of ["X", "Y", "Z"]) {
      const positionInput = screen.getByRole("spinbutton", { name: `${axis} position in metres` });
      const rotationInput = screen.getByRole("spinbutton", { name: `${axis} rotation in degrees` });
      const movement = MOVEMENT_COMMANDS.filter((command) => command.axis === axis);
      const rotation = ROTATION_COMMANDS.filter((command) => command.axis === axis);

      expect(positionInput).toBeVisible();
      expect(rotationInput).toBeVisible();
      expect(positionInput).toHaveAccessibleDescription(
        `Press ${movement[0]!.name} to move negative 0.05 metres. Press ${movement[1]!.name} to move positive 0.05 metres.`,
      );
      expect(rotationInput).toHaveAccessibleDescription(
        `Press ${rotation[0]!.name} to rotate negative 15 degrees. Press ${rotation[1]!.name} to rotate positive 15 degrees.`,
      );
    }

    const badges = Array.from(document.querySelectorAll<HTMLElement>(".shortcut-badges kbd"));
    const expectedBadges = [...MOVEMENT_COMMANDS.map(({ badge }) => badge), ...ROTATION_COMMANDS.map(({ badge }) => badge)];
    expect(badges).toHaveLength(12);
    expect(badges.map((badge) => badge.textContent?.trim())).toEqual(expectedBadges);
    expect(new Set(badges.map((badge) => badge.textContent?.trim()))).toHaveLength(12);

    for (const { badge, axis, direction, name } of MOVEMENT_COMMANDS) {
      const element = badges.find((candidate) => candidate.textContent?.trim() === badge)!;
      expect(element).toHaveAccessibleName(`${name}: move ${direction < 0 ? "negative" : "positive"} 0.05 metres on the ${axis} axis`);
    }
    for (const { badge, axis, direction, name } of ROTATION_COMMANDS) {
      const element = badges.find((candidate) => candidate.textContent?.trim() === badge)!;
      expect(element).toHaveAccessibleName(`${name}: rotate ${direction < 0 ? "negative" : "positive"} 15 degrees about the ${axis} axis`);
    }

    const accessibleText = badges.map((badge) => `${badge.getAttribute("aria-label")} ${badge.textContent}`).join(" ");
    expect(accessibleText).not.toMatch(/shift|alt|option|control|ctrl|⌥|⇧/i);
  });

  it("does not intercept movement or rotation shortcuts while typing", async () => {
    await openLab();
    const before = structuredClone(selectedTransform());
    const nameInput = screen.getByRole("textbox", { name: "Design name" });
    const textarea = document.body.appendChild(document.createElement("textarea"));
    const select = document.body.appendChild(document.createElement("select"));
    const editable = document.body.appendChild(document.createElement("div"));
    editable.setAttribute("contenteditable", "true");

    for (const target of [nameInput, textarea, select, editable]) {
      fireEvent.keyDown(target, { key: "ArrowLeft", code: "ArrowLeft" });
      fireEvent.keyDown(target, { key: "PageUp", code: "PageUp" });
      fireEvent.keyDown(target, { key: "m", code: "KeyM" });
    }

    expect(selectedTransform()).toEqual(before);
    expect(useEditorStore.getState().past).toHaveLength(0);
    textarea.remove();
    select.remove();
    editable.remove();
  });
});
