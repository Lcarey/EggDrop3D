import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { freshDesign, useEditorStore } from "./editor/store";

vi.mock("./scene/BuildScene", () => ({
  BuildScene: () => <div data-testid="build-scene">WebGL build scene</div>,
}));

vi.mock("./scene/DropScene", () => ({
  DropScene: ({ runId, running, playbackRate, onComplete }: {
    runId: number;
    running: boolean;
    playbackRate: number;
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
    <div data-testid="drop-scene" data-playback-rate={playbackRate}>
      Physics run {runId}
      {running && <button onClick={() => onComplete({
        outcome: "cracked",
        heightFt: useEditorStore.getState().design.heightFt,
        impactSpeedMps: 5.5,
        peakG: 82,
        peakForceN: 47,
        damage: 1,
        score: null,
      })}>Finish simulated run</button>}
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
  playbackRate: 0.2,
  gravityBodyId: "earth",
  liveEggSpeedMps: 0,
  peakEggSpeedMps: 0,
  cloud: { id: null, version: null, editToken: null, readOnly: false, saving: false },
});

const openLab = async () => {
  render(<App />);
  await screen.findByRole("heading", { name: "Choose a material" });
};

describe("EggDrop3D app workflow", () => {
  beforeEach(() => {
    localStorage.clear();
    history.replaceState({}, "", "/");
    resetStore();
  });

  it("renders all 17 named materials with costs and an always-present egg", async () => {
    await openLab();
    const inventory = screen.getByRole("complementary", { name: "Material inventory" });
    const cards = inventory.querySelectorAll(".material-card");
    expect(cards).toHaveLength(17);
    for (const label of [
      "Straws", "Tape", "Glue", "Balloons", "Bubble wrap", "String", "Cardboard", "Craft sticks",
      "Paper cups", "Cotton balls", "Foam blocks", "Sponges", "Rubber bands", "Newspaper",
      "Plastic bags", "Packing peanuts", "Fishing weights",
    ]) expect(within(inventory).getByRole("button", { name: new RegExp(label, "i") })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Your egg" })).toBeInTheDocument();
    expect(screen.getByText("Chicken egg")).toBeInTheDocument();
  });

  it("supports slider endpoints and an intermediate half-foot value", async () => {
    const user = userEvent.setup();
    await openLab();
    await user.click(screen.getByRole("button", { name: /set up drop/i }));

    const dialog = screen.getByRole("dialog", { name: /how high/i });
    const slider = within(dialog).getByRole("slider", { name: "Drop height in feet" });
    expect(slider).toHaveAttribute("min", "5");
    expect(slider).toHaveAttribute("max", "100");
    expect(slider).toHaveAttribute("step", "0.5");
    expect(within(dialog).getByText(/bare-egg baseline/i)).toBeInTheDocument();

    fireEvent.change(slider, { target: { value: "5" } });
    expect(within(dialog).getByText("5.0")).toBeInTheDocument();
    fireEvent.change(slider, { target: { value: "27.5" } });
    expect(within(dialog).getByText("27.5")).toBeInTheDocument();
    fireEvent.change(slider, { target: { value: "50" } });
    expect(within(dialog).getByText("50.0")).toBeInTheDocument();
    fireEvent.change(slider, { target: { value: "100" } });
    expect(within(dialog).getByText("100.0")).toBeInTheDocument();
  });

  it("selects drop speed from 0.1× to 2× and uses it for the run and live label", async () => {
    const user = userEvent.setup();
    await openLab();
    await user.click(screen.getByRole("button", { name: /set up drop/i }));

    const dialog = screen.getByRole("dialog", { name: /how high/i });
    const speedSlider = within(dialog).getByRole("slider", { name: "Drop playback speed" });
    expect(speedSlider).toHaveAttribute("min", "0.1");
    expect(speedSlider).toHaveAttribute("max", "2");
    expect(speedSlider).toHaveAttribute("step", "0.1");
    expect(speedSlider).toHaveValue("0.2");
    expect(within(dialog).getByText("0.2×")).toBeInTheDocument();

    for (const value of ["0.1", "1.3", "2"]) {
      fireEvent.change(speedSlider, { target: { value } });
      expect(speedSlider).toHaveValue(value);
      expect(within(dialog).getByText(`${Number(value).toFixed(1)}×`)).toBeInTheDocument();
    }

    fireEvent.change(speedSlider, { target: { value: "1.3" } });
    await user.click(within(dialog).getByRole("button", { name: /release contraption/i }));

    expect(screen.getByTestId("drop-scene")).toHaveAttribute("data-playback-rate", "1.3");
    expect(screen.getByText(/Dropping from 15\.0 ft on Earth · 1\.3×/)).toBeInTheDocument();
  });

  it("runs the bare-egg drop, reports metrics, and resets to edit or drop again", async () => {
    const user = userEvent.setup();
    await openLab();
    await user.click(screen.getByRole("button", { name: /set up drop/i }));
    fireEvent.change(screen.getByRole("slider", { name: "Drop height in feet" }), { target: { value: "5" } });
    await user.click(screen.getByRole("button", { name: /release contraption/i }));

    expect(screen.getByTestId("drop-scene")).toHaveTextContent("Physics run 1");
    await user.click(screen.getByRole("button", { name: /finish simulated run/i }));
    const result = screen.getByRole("dialog", { name: /crack! back to the lab/i });
    expect(within(result).getByText("5.0 ft")).toBeInTheDocument();
    expect(within(result).getByText("5.5 m/s")).toBeInTheDocument();
    expect(within(result).getByText("82 G")).toBeInTheDocument();
    expect(within(result).getByText("47 N")).toBeInTheDocument();

    await user.click(within(result).getByRole("button", { name: /drop again/i }));
    expect(screen.getByTestId("drop-scene")).toHaveTextContent("Physics run 2");
    await user.click(screen.getByRole("button", { name: /finish simulated run/i }));
    await user.click(screen.getByRole("button", { name: /edit build/i }));
    expect(screen.getByTestId("build-scene")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /set up drop/i })).toBeEnabled();
  });

  it("recovers a valid local draft and autosaves subsequent edits", async () => {
    const draft = freshDesign();
    draft.name = "Recovered classroom design";
    draft.heightFt = 22.5;
    localStorage.setItem("eggdrop3d:active-draft:v1", JSON.stringify(draft));
    const user = userEvent.setup();
    await openLab();

    const name = screen.getByRole("textbox", { name: "Design name" });
    expect(name).toHaveValue("Recovered classroom design");
    expect(screen.getByText("22.5 ft")).toBeInTheDocument();
    await user.clear(name);
    await user.type(name, "Autosaved revision");

    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem("eggdrop3d:active-draft:v1") ?? "null") as { name?: string } | null;
      expect(saved?.name).toBe("Autosaved revision");
    }, { timeout: 1_500 });
  });

  it("includes the phone viewing guidance in the accessible document", async () => {
    await openLab();
    expect(screen.getByText("Small-screen viewer")).toBeInTheDocument();
    expect(screen.getByText(/use a tablet or computer for precise 3D editing/i)).toBeInTheDocument();
  });
});
