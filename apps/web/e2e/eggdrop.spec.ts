import { expect, test } from "@playwright/test";

const materialNames = [
  "Straws", "Tape", "Glue", "Balloons", "Bubble wrap", "String", "Cardboard", "Craft sticks",
  "Paper cups", "Cotton balls", "Foam blocks", "Sponges", "Rubber bands", "Newspaper",
  "Plastic bags", "Packing peanuts", "Fishing weights",
];

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.getByRole("heading", { name: "Choose a material" }).waitFor();
});

test("inventory and continuous height controls are complete", async ({ page }) => {
  const inventory = page.getByRole("complementary", { name: "Material inventory" });
  await expect(inventory.locator(".material-card")).toHaveCount(17);
  for (const label of materialNames) await expect(inventory.getByRole("button", { name: new RegExp(label, "i") })).toBeVisible();

  await page.getByRole("button", { name: /set up drop/i }).click();
  const dialog = page.getByRole("dialog", { name: /how high/i });
  const slider = dialog.getByRole("slider", { name: "Drop height in feet" });
  await expect(slider).toHaveAttribute("min", "5");
  await expect(slider).toHaveAttribute("max", "100");
  await expect(slider).toHaveAttribute("step", "0.5");

  await slider.fill("5");
  await expect(dialog.locator(".height-readout strong")).toHaveText("5.0");
  await slider.fill("27.5");
  await expect(dialog.locator(".height-readout strong")).toHaveText("27.5");
  await slider.fill("50");
  await expect(dialog.locator(".height-readout strong")).toHaveText("50.0");
  await slider.fill("100");
  await expect(dialog.locator(".height-readout strong")).toHaveText("100.0");

  const gravitySlider = dialog.getByRole("slider", { name: "Gravity strength" });
  await expect(gravitySlider).toHaveAttribute("min", "0");
  await expect(gravitySlider).toHaveAttribute("max", "7");
  await expect(gravitySlider).toHaveAttribute("step", "1");
  await gravitySlider.fill("0");
  await expect(dialog.getByText("Moon", { exact: true })).toBeVisible();
  await gravitySlider.fill("7");
  await expect(dialog.getByText("Jupiter", { exact: true })).toBeVisible();

  const speedSlider = dialog.getByRole("slider", { name: "Drop playback speed" });
  await expect(speedSlider).toHaveAttribute("min", "0.1");
  await expect(speedSlider).toHaveAttribute("max", "2");
  await expect(speedSlider).toHaveAttribute("step", "0.1");
  await expect(speedSlider).toHaveValue("0.2");
  for (const value of ["0.1", "1.3", "2"]) {
    await speedSlider.fill(value);
    await expect(dialog.getByText(`${Number(value).toFixed(1)}×`, { exact: true })).toBeVisible();
  }
  await dialog.getByRole("button", { name: /keep building/i }).click();
  await expect(page.getByLabel("3D building workspace")).toBeVisible();
});

test("a 5 ft bare egg produces a result and can return to editing", async ({ page }) => {
  await page.getByRole("button", { name: /set up drop/i }).click();
  const setup = page.getByRole("dialog", { name: /how high/i });
  await expect(setup.getByText(/bare-egg baseline/i)).toBeVisible();
  await setup.getByRole("slider", { name: "Drop height in feet" }).fill("5");
  await setup.getByRole("button", { name: /release contraption/i }).click();

  const result = page.getByRole("dialog", { name: "Crack! Back to the lab." });
  await expect(result).toBeVisible({ timeout: 22_000 });
  await expect(result.getByRole("heading", { name: "Crack! Back to the lab." })).toBeVisible();
  await expect(result.getByText("5.0 ft")).toBeVisible();
  const metric = async (label: string) => {
    const value = await result.locator(".metric-grid > div").filter({ hasText: label }).locator("strong").innerText();
    return Number.parseFloat(value);
  };
  expect(await metric("Impact speed")).toBeGreaterThan(4);
  expect(await metric("Peak load")).toBeGreaterThan(0);
  expect(await metric("Peak force")).toBeGreaterThan(0);
  await result.getByRole("button", { name: /edit build/i }).click();
  await expect(page.locator(".app-shell")).toHaveClass(/stage-build/);
  await expect(page.getByRole("heading", { name: "Your egg" })).toBeVisible();
  await expect(page.locator(".height-chip strong")).toHaveText("5.0 ft");
  await expect(page.getByRole("button", { name: /set up drop/i })).toBeEnabled();
});

test("an egg taped to balloons remains visible through its fall before results", async ({ page }) => {
  await page.evaluate((design) => {
    localStorage.setItem("eggdrop3d:active-draft:v1", JSON.stringify(design));
  }, {
    schemaVersion: 1,
    physicsVersion: 1,
    name: "Taped balloon regression",
    mode: "sandbox",
    missionId: null,
    heightFt: 5,
    eggTransform: { position: [0, 0.38, 0], rotation: [0, 0, 0, 1], dimensions: [0.048, 0.064, 0.048] },
    parts: [
      { id: "balloon-left", materialId: "balloon", transform: { position: [-0.18, 0.68, 0], rotation: [0, 0, 0, 1], dimensions: [0.3, 0.38, 0.3] } },
      { id: "balloon-right", materialId: "balloon", transform: { position: [0.18, 0.68, 0], rotation: [0, 0, 0, 1], dimensions: [0.3, 0.38, 0.3] } },
    ],
    joints: [
      { id: "tape-left", kind: "fixed", materialId: "tape", bodyA: "egg", bodyB: "balloon-left", anchorA: [-0.02, 0.03, 0], anchorB: [0.16, -0.19, 0] },
      { id: "tape-right", kind: "fixed", materialId: "tape", bodyA: "egg", bodyB: "balloon-right", anchorA: [0.02, 0.03, 0], anchorB: [-0.16, -0.19, 0] },
    ],
  });
  await page.reload();
  await page.getByRole("heading", { name: "Choose a material" }).waitFor();
  await expect(page.getByText("2 parts · 2 connections")).toBeVisible();

  await page.getByRole("button", { name: /set up drop/i }).click();
  await page.getByRole("button", { name: /release contraption/i }).click();
  await expect(page.locator(".app-shell")).toHaveClass(/stage-dropping/);
  await expect(page.locator(".lab-stage canvas")).toBeVisible();

  // A bad fixed-joint startup impulse used to publish Crack after roughly the
  // hold + reveal interval, before the assembly had visibly descended.
  await page.waitForTimeout(1_600);
  await expect(page.locator(".app-shell")).toHaveClass(/stage-dropping/);
  await expect(page.getByRole("dialog", { name: /The egg survived|Crack!/i })).toHaveCount(0);

  const result = page.getByRole("dialog", { name: /The egg survived|Crack!/i });
  await expect(result).toBeVisible({ timeout: 20_000 });
  await expect(result.getByText("5.0 ft")).toBeVisible();
});

test("an egg on a cardboard raft over loose balloons survives and settles promptly", async ({ page }) => {
  // Regression for the balloon-raft bug: balloons used to act like rigid
  // marbles, squirting out from under the cardboard, so the landing never
  // settled (20 s timeout) and the egg cracked "for no reason". The soft
  // balloon suspension must cushion the raft, count the landing quickly, and
  // keep the egg intact.
  const balloonGrid = [-0.18, 0, 0.18];
  // addInitScript runs before the app boots on the next navigation, so the
  // draft cannot be clobbered by the app's own 500 ms draft autosave.
  await page.addInitScript((design) => {
    localStorage.setItem("eggdrop3d:active-draft:v1", JSON.stringify(design));
  }, {
    schemaVersion: 1,
    physicsVersion: 1,
    name: "Balloon raft regression",
    mode: "sandbox",
    missionId: null,
    heightFt: 5,
    eggTransform: { position: [0, 0.347, 0], rotation: [0, 0, 0, 1], dimensions: [0.048, 0.064, 0.048] },
    parts: [
      ...balloonGrid.flatMap((x, ix) => balloonGrid.map((z, iz) => ({
        id: `balloon-${ix}-${iz}`,
        materialId: "balloon",
        transform: { position: [x, 0.15, z], rotation: [0, 0, 0, 1], dimensions: [0.24, 0.3, 0.24] },
      }))),
      { id: "raft", materialId: "cardboard", transform: { position: [0, 0.3075, 0], rotation: [0, 0, 0, 1], dimensions: [0.44, 0.015, 0.44] } },
    ],
    joints: [],
  });
  await page.reload();
  await page.getByRole("heading", { name: "Choose a material" }).waitFor();
  await expect(page.getByText("10 parts · 0 connections")).toBeVisible();

  await page.getByRole("button", { name: /set up drop/i }).click();
  const setup = page.getByRole("dialog", { name: /how high/i });
  await setup.getByRole("slider", { name: "Drop height in feet" }).fill("5");
  await setup.getByRole("slider", { name: "Drop playback speed" }).fill("1");
  await setup.getByRole("button", { name: /release contraption/i }).click();

  // At 1× playback a cushioned landing settles in a few seconds; only the
  // old glitching raft needed the full 20 s simulation timeout.
  const result = page.getByRole("dialog", { name: /the egg survived/i });
  await expect(result).toBeVisible({ timeout: 15_000 });
  await expect(result.getByText("5.0 ft")).toBeVisible();
});

test("cloud save, update, public share, and second-browser remix stay ownership-safe", async ({ browser }) => {
  const origin = "http://127.0.0.1:5173";
  const ownerContext = await browser.newContext({ baseURL: origin });
  await ownerContext.grantPermissions(["clipboard-read", "clipboard-write"], { origin });
  const owner = await ownerContext.newPage();
  await owner.goto("/");
  await owner.getByRole("heading", { name: "Choose a material" }).waitFor();

  await owner.getByRole("button", { name: /^save$/i }).click();
  await expect(owner.getByText(/private edit key stays on this device/i)).toBeVisible();
  await expect(owner).toHaveURL(/\/design\/[0-9a-f-]+$/i);
  const shareUrl = owner.url();
  const designId = shareUrl.split("/").at(-1)!;
  const tokenMap = await owner.evaluate(() => localStorage.getItem("eggdrop3d:edit-tokens:v1"));
  expect(tokenMap).toContain(designId);
  expect(shareUrl).not.toContain("token");

  const name = owner.getByRole("textbox", { name: "Design name" });
  await name.fill("Cloud classroom flyer");
  await owner.getByRole("button", { name: /^update$/i }).click();
  await expect(owner.getByText("Cloud design updated.")).toBeVisible();
  await owner.getByRole("button", { name: /^share$/i }).click();
  await expect(owner.getByText("Read-only share link copied.")).toBeVisible();
  await expect.poll(() => owner.evaluate(() => navigator.clipboard.readText())).toBe(shareUrl);

  const visitorContext = await browser.newContext({ baseURL: origin });
  const visitor = await visitorContext.newPage();
  await visitor.goto(shareUrl);
  await visitor.getByRole("heading", { name: "Choose a material" }).waitFor();
  await expect(visitor.getByRole("textbox", { name: "Design name" })).toHaveValue("Cloud classroom flyer");
  await expect(visitor.getByRole("textbox", { name: "Design name" })).toBeDisabled();
  await expect(visitor.getByRole("button", { name: /remix/i })).toBeEnabled();
  await expect(visitor.getByRole("button", { name: /^save$/i })).toHaveCount(0);
  expect(await visitor.evaluate(() => localStorage.getItem("eggdrop3d:edit-tokens:v1"))).toBeNull();

  await visitor.getByRole("button", { name: /remix/i }).click();
  await expect(visitor).toHaveURL(`${origin}/`);
  await expect(visitor.getByRole("textbox", { name: "Design name" })).toHaveValue("Cloud classroom flyer remix");
  await expect(visitor.getByRole("textbox", { name: "Design name" })).toBeEnabled();
  await expect(visitor.getByRole("button", { name: /^save$/i })).toBeEnabled();
  expect(await visitor.evaluate(() => localStorage.getItem("eggdrop3d:edit-tokens:v1"))).toBeNull();

  await visitorContext.close();
  await ownerContext.close();
});

test.describe("phone experience", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("locks precision editing while retaining drop and remix actions", async ({ page }) => {
    await page.route("**/api/designs/mobile_share", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "mobile_share",
          version: 1,
          createdAt: "2026-08-21T12:00:00.000Z",
          updatedAt: "2026-08-21T12:00:00.000Z",
          design: {
            schemaVersion: 1,
            physicsVersion: 1,
            name: "Shared phone design",
            mode: "sandbox",
            missionId: null,
            heightFt: 15,
            eggTransform: { position: [0, 0.38, 0], rotation: [0, 0, 0, 1], dimensions: [0.048, 0.064, 0.048] },
            parts: [],
            joints: [],
          },
        }),
      });
    });
    await page.goto("/design/mobile_share");
    await page.getByRole("heading", { name: "Choose a material" }).waitFor();

    await expect(page.getByText("Small-screen viewer")).toBeVisible();
    await expect(page.getByText(/use a tablet or computer for precise 3D editing/i)).toBeVisible();
    await expect(page.locator(".material-card:disabled")).toHaveCount(17);
    // The name and mode controls collapse out of the phone header, but their
    // disabled state still prevents hidden precision-editing paths.
    await expect(page.locator(".design-name input")).toBeDisabled();
    await expect(page.locator(".mode-switch button:disabled")).toHaveCount(2);
    await expect(page.getByRole("button", { name: /remix/i })).toBeEnabled();
    await expect(page.getByRole("button", { name: /set up drop/i })).toBeEnabled();
    await expect(page.getByLabel("3D building workspace")).toBeVisible();
  });
});
