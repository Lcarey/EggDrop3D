import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      command: "npm run start:local -w @eggdrop/api --prefix ../..",
      url: "http://127.0.0.1:8787/api/health",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: "npm run preview",
      url: "http://127.0.0.1:4173",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
  // The desktop workspace already ships Google Chrome; CI can override this
  // with PLAYWRIGHT_CHANNEL=chromium after installing Playwright browsers.
  projects: [{
    name: "chromium",
    use: {
      ...devices["Desktop Chrome"],
      channel: process.env.PLAYWRIGHT_CHANNEL ?? (process.env.CI ? "chromium" : "chrome"),
    },
  }],
});
