import { defineConfig, devices } from "@playwright/test";

/**
 * Visual regression screenshots (TEST-05, #269), kept apart from the e2e suite
 * so a changed pixel never fails `npm run test:e2e`. Run with
 * `npm run test:visual`, which starts the server like the e2e runner does.
 *
 * Reference images are made on Linux in CI: Windows and macOS render fonts
 * differently, so their images stay local (see .gitignore).
 */
const e2ePort = process.env.E2E_PORT || "3100";
const baseURL = process.env.PLAYWRIGHT_BASE_URL || `http://localhost:${e2ePort}`;
const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: "./tests/visual",
  snapshotPathTemplate: "{testDir}/__screenshots__/{arg}-{projectName}-{platform}{ext}",
  timeout: 60_000,
  workers: 1,
  expect: {
    timeout: 10_000,
    // About 1,000 pixels on a desktop screenshot: enough for anti-aliasing,
    // too few to hide a changed word or a moved card.
    toHaveScreenshot: { maxDiffPixelRatio: 0.001 },
  },
  reporter: isCI
    ? [["list"], ["github"], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    // The production build's service worker would cache pages between tests.
    serviceWorkers: "block",
    timezoneId: process.env.TZ || undefined,
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
    { name: "phone", use: { ...devices["Pixel 7"] } },
  ],
});
