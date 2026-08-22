import { expect, test, type Page } from "@playwright/test";
import { ALL_SPECS, PLANET_INDEX, type ValidationSpec } from "./validation/designs";

/**
 * Regression coverage for the five defects found by the 100-structure physics
 * validation campaign (PHYSICS_VALIDATION_REPORT.md). Each test reuses the
 * exact corpus structure that exposed the bug.
 *
 * BUG-1  peak G normalized by local planet gravity
 * BUG-2  static body damping acting as phantom drag in vacuum
 * BUG-3  impact-speed metric decoupled from the egg's touchdown speed
 * BUG-4  welded balloon assemblies with overlapping shells injecting energy
 * BUG-5  peak load/force reporting per-step solver spikes
 * OBS-1  sim timeout publishing "survived" while the egg is still airborne
 */

const byId = (id: string): ValidationSpec => {
  const spec = ALL_SPECS.find((candidate) => candidate.id === id);
  if (!spec) throw new Error(`validation spec ${id} not found`);
  return spec;
};

interface RunOutcome {
  maxTopMps: number;
  heading: string;
  impactMps: number | null;
  peakG: number | null;
  peakForceN: number | null;
}

/** Seed the design, release at the spec's height/planet at 1x, run to the result card. */
const runDrop = async (page: Page, spec: ValidationSpec, budgetMs = 45_000): Promise<RunOutcome> => {
  await page.addInitScript((design) => {
    localStorage.setItem("eggdrop3d:active-draft:v1", JSON.stringify(design));
  }, spec.design);
  await page.goto("/");
  await page.getByRole("heading", { name: "Choose a material" }).waitFor();
  await page.getByRole("button", { name: /set up drop/i }).click();
  const setup = page.getByRole("dialog", { name: /how high/i });
  await setup.getByRole("slider", { name: "Drop height in feet" }).fill(String(spec.settings.heightFt));
  await setup.getByRole("slider", { name: "Planet" }).fill(String(PLANET_INDEX[spec.settings.planet]));
  await setup.getByRole("slider", { name: "Drop playback speed" }).fill("1");
  await setup.getByRole("button", { name: /release contraption/i }).click();

  const dialog = page.getByRole("dialog", { name: /The egg survived|Crack!|still airborne/i });
  let maxTopMps = 0;
  const started = Date.now();
  while (Date.now() - started < budgetMs) {
    const texts = await page.locator(".speed-metric strong").allTextContents().catch(() => [] as string[]);
    const top = Number.parseFloat(texts[texts.length - 1] ?? "");
    if (Number.isFinite(top)) maxTopMps = Math.max(maxTopMps, top);
    if ((await dialog.count()) > 0) break;
    await page.waitForTimeout(150);
  }
  await expect(dialog).toBeVisible();
  const heading = await dialog.getByRole("heading").first().innerText();
  const metric = async (label: string): Promise<number | null> => {
    const text = await dialog
      .locator(".metric-grid > div")
      .filter({ hasText: label })
      .locator("strong")
      .innerText()
      .catch(() => null);
    if (text === null) return null;
    const value = Number.parseFloat(text);
    return Number.isFinite(value) ? value : null;
  };
  return {
    maxTopMps,
    heading,
    impactMps: await metric("Impact speed"),
    peakG: await metric("Peak load"),
    peakForceN: await metric("Peak force"),
  };
};

test.describe("BUG-4: welded balloon assemblies stay stable", () => {
  test("three balloons taped to the egg descend at plausible speeds", async ({ page }) => {
    test.setTimeout(90_000);
    // Used to diverge to the watchdog ceiling (17.8 m/s top vs vacuum 12.2).
    const run = await runDrop(page, byId("v-a1-tape-cluster-3"));
    expect(run.maxTopMps).toBeLessThan(13);
  });

  test("an egg sandwiched between two taped balloons does not launch", async ({ page }) => {
    test.setTimeout(90_000);
    // Used to reach 15.7 m/s within half a second and fly off camera.
    const run = await runDrop(page, byId("f10-balloon-sandwich"));
    expect(run.maxTopMps).toBeLessThan(13);
  });
});

test("BUG-3: reported impact speed tracks the egg, not flung debris", async ({ page }) => {
  test.setTimeout(90_000);
  // Straw outriggers used to report impact 22.6 m/s — above vacuum free-fall
  // from 50 ft (17.3) and above the egg's own observed top speed (12.2).
  const run = await runDrop(page, byId("f5-straw-outriggers"));
  expect(run.impactMps).not.toBeNull();
  expect(run.impactMps!).toBeLessThanOrEqual(run.maxTopMps + 2);
  expect(run.impactMps!).toBeLessThanOrEqual(26); // 1.5 x vacuum free-fall ceiling
});

test("BUG-5: a cushioned foam landing reports the load the shell felt", async ({ page }) => {
  test.setTimeout(90_000);
  // 10 ft onto a foam block: kinematic deceleration is ~25 G, but the raw
  // solver-step metric reported 163 G (invariant I4 violation).
  const run = await runDrop(page, byId("v-f1-foam-10ft"));
  expect(run.peakG).not.toBeNull();
  expect(run.peakG!).toBeLessThan(60);
  expect(run.peakForceN).not.toBeNull();
  expect(run.peakForceN!).toBeLessThan(40);
});

test("BUG-1: peak G is planet-independent (faster impact reads higher G)", async ({ page }) => {
  test.setTimeout(120_000);
  // Same bare egg from 5 ft: the Moon impact (2.2 m/s) used to read 300 G
  // while the Jupiter impact (8.6 m/s) read 99 G, because G was divided by
  // the local planet gravity.
  const moon = await runDrop(page, byId("f1-bare-moon-5"));
  const jupiter = await runDrop(page, byId("f1-bare-jupiter-5"));
  expect(moon.peakG).not.toBeNull();
  expect(jupiter.peakG).not.toBeNull();
  expect(jupiter.peakG!).toBeGreaterThan(moon.peakG!);
});

test("BUG-2: vacuum free-fall arrives at full speed (no phantom drag)", async ({ page }) => {
  test.setTimeout(90_000);
  // Bare egg, 100 ft on the airless Moon: vacuum free-fall is 9.94 m/s; the
  // constant body damping used to shave 8% off.
  const run = await runDrop(page, byId("f1-bare-moon-100"));
  const vacuumMps = Math.sqrt(2 * 1.62 * 100 * 0.3048);
  expect(run.impactMps).not.toBeNull();
  expect(run.impactMps!).toBeGreaterThanOrEqual(0.97 * vacuumMps);
});

test("OBS-1: a floater that never lands reports airborne, not survived", async ({ page }) => {
  test.setTimeout(90_000);
  // Four near-neutral balloons: the assembly was rising past the 100 ft
  // marker when the 20 s timeout used to declare "The egg survived".
  const run = await runDrop(page, byId("f3-neutral-four"));
  expect(run.heading).toMatch(/airborne/i);
});
