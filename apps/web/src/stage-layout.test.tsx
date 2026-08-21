import { fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { freshDesign, useEditorStore } from "./editor/store";

const styles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

vi.mock("./scene/BuildScene", () => ({
  BuildScene: () => <div data-testid="build-scene">WebGL build scene</div>,
}));

vi.mock("./scene/DropScene", () => ({
  DropScene: ({ running, onComplete }: {
    running: boolean;
    onComplete: (result: {
      outcome: "cracked";
      heightFt: number;
      impactSpeedMps: number;
      peakG: number;
      peakForceN: number;
      damage: number;
      score: null;
    }) => void;
  }) => (
    <div data-testid="drop-scene">
      Drop scene
      {running && <button onClick={() => onComplete({
        outcome: "cracked",
        heightFt: useEditorStore.getState().design.heightFt,
        impactSpeedMps: 5.5,
        peakG: 82,
        peakForceN: 47,
        damage: 1,
        score: null,
      })}>Finish layout test drop</button>}
    </div>
  ),
}));

const resetStore = () => useEditorStore.setState({
  design: freshDesign(),
  past: [],
  future: [],
  selectedId: "egg",
  activeMaterial: null,
  connectorDraft: null,
  transformMode: "translate",
  stage: "build",
  runId: 0,
  result: null,
  cloud: { id: null, version: null, editToken: null, readOnly: false, saving: false },
});

describe("drop-focused stage layout", () => {
  beforeEach(() => {
    localStorage.clear();
    history.replaceState({}, "", "/");
    resetStore();
  });

  it("keeps the Inspector in build, then removes it while dropping and showing results", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "Choose a material" });

    const shell = screen.getByRole("main");
    const stage = screen.getByRole("region", { name: "3D building workspace" });
    expect(shell).toHaveClass("stage-build");
    expect(stage).toHaveClass("lab-stage");
    expect(screen.getByRole("complementary", { name: "Inspector" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /set up drop/i }));
    expect(shell).toHaveClass("stage-dropSetup");
    expect(screen.getByRole("complementary", { name: "Inspector" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /release contraption/i }));
    expect(shell).toHaveClass("stage-dropping");
    expect(screen.queryByRole("complementary", { name: "Inspector" })).not.toBeInTheDocument();
    expect(screen.getByTestId("drop-scene")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /finish layout test drop/i }));
    expect(shell).toHaveClass("stage-result");
    expect(screen.queryByRole("complementary", { name: "Inspector" })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: /crack! back to the lab/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /edit build/i }));
    expect(shell).toHaveClass("stage-build");
    expect(screen.getByRole("complementary", { name: "Inspector" })).toBeInTheDocument();
  });

  it("spans the lab through the former Inspector column on desktop and tablet", () => {
    expect(styles).toContain(
      ".app-shell.stage-dropping .lab-stage,.app-shell.stage-result .lab-stage { grid-column:2/-1; }",
    );

    const tabletStart = styles.indexOf("@media (max-width:900px)");
    const phoneStart = styles.indexOf("@media (max-width:700px)");
    expect(tabletStart).toBeGreaterThan(-1);
    expect(phoneStart).toBeGreaterThan(tabletStart);
    const tabletRules = styles.slice(tabletStart, phoneStart);
    expect(tabletRules).toContain(
      ".app-shell { grid-template:64px minmax(0,1fr) 74px / 210px minmax(410px,1fr); }",
    );
    expect(tabletRules).toContain(".inspector-panel { position:fixed;");
  });
});
