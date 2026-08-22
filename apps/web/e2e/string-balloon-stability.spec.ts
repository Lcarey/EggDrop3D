import { expect, test } from "@playwright/test";

test("two overlapping balloons on strings stay stable through a 100 ft drop", async ({ page }) => {
  test.setTimeout(90_000);
  await page.addInitScript((design) => {
    localStorage.setItem("eggdrop3d:active-draft:v1", JSON.stringify(design));
  }, {
    schemaVersion: 1,
    physicsVersion: 1,
    name: "Two balloon strings",
    mode: "sandbox",
    missionId: null,
    heightFt: 100,
    eggTransform: { position: [0, 0.55, 0], rotation: [0, 0, 0, 1], dimensions: [0.048, 0.064, 0.048] },
    parts: [
      { id: "bl", materialId: "balloon", transform: { position: [-0.22, 0.28, 0], rotation: [0, 0, 0, 1], dimensions: [0.3, 0.38, 0.3] } },
      { id: "br", materialId: "balloon", transform: { position: [0.22, 0.28, 0], rotation: [0, 0, 0, 1], dimensions: [0.3, 0.38, 0.3] } },
    ],
    joints: [
      { id: "s1", kind: "rope", materialId: "string", bodyA: "egg", bodyB: "bl", anchorA: [0, -0.032, 0], anchorB: [0, 0.19, 0] },
      { id: "s2", kind: "rope", materialId: "string", bodyA: "egg", bodyB: "br", anchorA: [0, -0.032, 0], anchorB: [0, 0.19, 0] },
    ],
  });
  await page.goto("/");
  await page.getByRole("heading", { name: "Choose a material" }).waitFor();
  await page.getByRole("button", { name: /set up drop/i }).click();
  const setup = page.getByRole("dialog", { name: /how high/i });
  await setup.getByRole("slider", { name: "Drop height in feet" }).fill("100");
  await setup.getByRole("slider", { name: "Planet" }).fill("3");
  await setup.getByRole("slider", { name: "Drop playback speed" }).fill("1");
  await setup.getByRole("button", { name: /release contraption/i }).click();

  let maxTop = 0;
  const started = Date.now();
  while (Date.now() - started < 60_000) {
    const tops = await page.locator(".speed-metric strong").allTextContents();
    for (const text of tops) {
      const value = Number.parseFloat(text);
      if (Number.isFinite(value)) maxTop = Math.max(maxTop, value);
    }
    if (maxTop > 25) break;
    const done = await page.getByRole("dialog", { name: /The egg survived|Crack!/i }).count();
    if (done > 0) break;
    await page.waitForTimeout(200);
  }
  expect(maxTop).toBeLessThan(25);
});
