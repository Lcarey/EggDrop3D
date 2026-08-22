import { expect, test } from "@playwright/test";

// Regression for the balloon-lift solver explosion: a glued cluster of 15
// default-size balloons lifts an egg hanging on a long diagonal tape tether
// under Jupiter gravity. The egg's reported speed used to run away
// geometrically (observed at ~5.5e12 m/s) once the rigid tether network
// started oscillating; any speed beyond vacuum free-fall from the drop
// height (~7 m/s here) plus generous headroom means the solver diverged.
const offsets: [number, number, number][] = [
  // Two-layer blob; centres ~0.2 m apart so soft shells interpenetrate like a
  // hand-packed cluster (cores are 0.095 m, so several pairs nearly touch).
  [0, 0, 0], [0.2, 0, 0.04], [-0.2, 0, -0.04], [0.04, 0, 0.2], [-0.04, 0, -0.2],
  [0.15, 0.03, -0.15], [-0.15, -0.03, 0.15], [0.16, 0.02, 0.16],
  [0.02, 0.22, 0.02], [0.21, 0.22, 0.05], [-0.18, 0.22, -0.03],
  [0.05, 0.24, 0.2], [-0.03, 0.2, -0.19], [0.15, 0.24, -0.14], [-0.13, 0.2, 0.15],
];
const clusterCenter = [0.9, 1.6, 0];

// Glue graph with cycles, like hand-gluing every balloon to whatever
// neighbours it touches: chain plus ring-closing and cross links.
const gluePairs: [number, number][] = [
  [0, 1], [1, 5], [5, 3], [3, 7], [7, 2], [2, 4], [4, 6], [6, 0],
  [0, 8], [8, 9], [9, 10], [10, 11], [11, 12], [12, 13],
  [13, 14], [14, 8],
];

const design = {
  schemaVersion: 1,
  physicsVersion: 1,
  name: "Balloon lift regression",
  mode: "sandbox",
  missionId: null,
  heightFt: 8,
  eggTransform: { position: [-0.4, 0.15, 0], rotation: [0, 0, 0, 1], dimensions: [0.048, 0.064, 0.048] },
  parts: offsets.map((offset, index) => ({
    id: `b${index}`,
    materialId: "balloon",
    transform: {
      position: [clusterCenter[0]! + offset[0], clusterCenter[1]! + offset[1], clusterCenter[2]! + offset[2]],
      rotation: [0, 0, 0, 1],
      dimensions: [0.3, 0.38, 0.3],
    },
  })),
  joints: [
    ...gluePairs.map(([a, b], index) => ({
      id: `g${index}`,
      kind: "fixed",
      materialId: "glue",
      bodyA: `b${a}`,
      bodyB: `b${b}`,
      anchorA: [0.1, 0, 0],
      anchorB: [-0.1, 0, 0],
    })),
    // Diagonal tape: egg near the pad, cluster up and to the side, anchored at
    // the facing surfaces like the app's tape tool.
    { id: "tape-egg", kind: "fixed", materialId: "tape", bodyA: "egg", bodyB: "b0", anchorA: [0, 0.032, 0], anchorB: [-0.1, -0.13, 0] },
  ],
};

test("a rising balloon lift with a long tape tether keeps physically plausible speeds", async ({ page }) => {
  test.setTimeout(70_000);
  await page.addInitScript((draft) => {
    localStorage.setItem("eggdrop3d:active-draft:v1", JSON.stringify(draft));
  }, design);
  await page.goto("/");
  await page.getByRole("heading", { name: "Choose a material" }).waitFor();
  await expect(page.getByText("15 parts · 17 connections")).toBeVisible();

  await page.getByRole("button", { name: /set up drop/i }).click();
  const setup = page.getByRole("dialog", { name: /how high/i });
  await setup.getByRole("slider", { name: "Gravity strength" }).fill("7");
  // 0.1x playback matches the recording where the runaway was observed.
  await setup.getByRole("slider", { name: "Drop playback speed" }).fill("0.1");
  await setup.getByRole("button", { name: /release contraption/i }).click();

  let maxTopSpeed = 0;
  const started = Date.now();
  while (Date.now() - started < 45_000) {
    const text = await page.locator(".speed-metric strong").last().textContent().catch(() => null);
    const value = text ? Number.parseFloat(text) : Number.NaN;
    if (Number.isFinite(value)) maxTopSpeed = Math.max(maxTopSpeed, value);
    if (maxTopSpeed > 25) break;
    const done = await page.getByRole("dialog", { name: /The egg survived|Crack!/i }).count();
    if (done > 0) break;
    await page.waitForTimeout(200);
  }
  // Vacuum free-fall from 8 ft on Jupiter is ~11 m/s; a rising balloon lift
  // moves at a couple of m/s. 25 m/s only trips on solver divergence.
  expect(maxTopSpeed).toBeLessThan(25);
});
