import { expect, test } from "@playwright/test";

// Repro for the balloon-lift solver explosion: a glued cluster of 14 balloons
// lifts an egg hanging on a long rigid tape tether under Jupiter gravity.
// The recorded bug showed the egg speed jumping to ~5.5e12 m/s mid-flight.
const offsets: [number, number, number][] = [
  [0, 0, 0], [0.18, 0, 0.05], [-0.18, 0, -0.05], [0.05, 0, 0.18], [-0.05, 0, -0.18],
  [0.13, 0.02, -0.13], [-0.13, -0.02, 0.13], [0.02, 0.2, 0.02], [0.2, 0.2, 0.06],
  [-0.16, 0.2, -0.04], [0.06, 0.2, 0.19], [-0.04, 0.2, -0.17], [0.14, 0.22, -0.12], [-0.12, 0.18, 0.14],
];
const clusterCenter = [1.0, 2.6, 0];

const design = {
  schemaVersion: 1,
  physicsVersion: 1,
  name: "Balloon lift long tether repro",
  mode: "sandbox",
  missionId: null,
  heightFt: 8,
  eggTransform: { position: [0, 0.15, 0], rotation: [0, 0, 0, 1], dimensions: [0.048, 0.064, 0.048] },
  parts: offsets.map((offset, index) => ({
    id: `b${index}`,
    materialId: "balloon",
    transform: {
      position: [clusterCenter[0]! + offset[0], clusterCenter[1]! + offset[1], clusterCenter[2]! + offset[2]],
      rotation: [0, 0, 0, 1],
      dimensions: [0.24, 0.3, 0.24],
    },
  })),
  joints: [
    ...offsets.slice(1).map((_, index) => ({
      id: `g${index}`,
      kind: "fixed",
      materialId: "glue",
      bodyA: `b${index}`,
      bodyB: `b${index + 1}`,
      anchorA: [0.09, 0, 0],
      anchorB: [-0.09, 0, 0],
    })),
    { id: "tape-egg", kind: "fixed", materialId: "tape", bodyA: "egg", bodyB: "b0", anchorA: [0, 0.032, 0], anchorB: [0, -0.15, 0] },
  ],
};

test("a balloon lift with a long tape tether keeps finite speeds", async ({ page }) => {
  await page.addInitScript((draft) => {
    localStorage.setItem("eggdrop3d:active-draft:v1", JSON.stringify(draft));
  }, design);
  await page.goto("/");
  await page.getByRole("heading", { name: "Choose a material" }).waitFor();
  await expect(page.getByText("14 parts · 14 connections")).toBeVisible();

  await page.getByRole("button", { name: /set up drop/i }).click();
  const setup = page.getByRole("dialog", { name: /how high/i });
  await setup.getByRole("slider", { name: "Gravity strength" }).fill("7");
  await setup.getByRole("slider", { name: "Drop playback speed" }).fill("1");
  await setup.getByRole("button", { name: /release contraption/i }).click();

  let maxTopSpeed = 0;
  const started = Date.now();
  while (Date.now() - started < 18_000) {
    const text = await page.locator(".speed-metric strong").last().textContent().catch(() => null);
    const value = text ? Number.parseFloat(text) : Number.NaN;
    if (Number.isFinite(value)) maxTopSpeed = Math.max(maxTopSpeed, value);
    const done = await page.getByRole("dialog", { name: /The egg survived|Crack!/i }).count();
    if (done > 0) break;
    await page.waitForTimeout(200);
  }
  console.log(`max top speed observed: ${maxTopSpeed} m/s`);
  expect(maxTopSpeed).toBeLessThan(100);
});
