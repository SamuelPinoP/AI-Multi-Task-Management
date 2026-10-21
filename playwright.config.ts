import { defineConfig, devices } from "@playwright/test";

const e2ePort = process.env.E2E_PORT || "3100";
const baseURL =
  process.env.PLAYWRIGHT_BASE_URL || `http://localhost:${e2ePort}`;
const isCI = Boolean(process.env.CI);
// Vercel preview URLs are behind Deployment Protection; CI passes this secret
// so the @smoke tests can reach them.
const vercelBypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  // One worker: a cold dev server compiling routes for two workers at once
  // aborts navigations, and the suite is small.
  workers: 1,
  expect: { timeout: 10_000 },
  reporter: isCI
    ? [["list"], ["github"], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    extraHTTPHeaders: vercelBypassSecret
      ? {
          "x-vercel-protection-bypass": vercelBypassSecret,
          "x-vercel-set-bypass-cookie": "true",
        }
      : undefined,
    // CI records every test (video, trace, screenshot) so each run can be
    // watched afterwards from the HTML report.
    screenshot: isCI ? "on" : "only-on-failure",
    trace: isCI ? "on" : "on-first-retry",
    video: isCI ? "on" : "retain-on-failure",
  },
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: `node node_modules/next/dist/bin/next dev --webpack --hostname localhost --port ${e2ePort}`,
        env: {
          EMAIL_PROVIDER: "disabled",
          GUEST_LOGIN_ENABLED: "true",
          PROJECT_CHAT_DEFAULT_STORAGE_PROVIDER: "local",
          PROJECT_CHAT_PUBLIC_UPLOAD_PATH: "/uploads/project-chat",
          PROJECT_CHAT_STORAGE_PROVIDER: "",
          PROJECT_CHAT_VIDEO_STORAGE_PROVIDER: "local",
          SIGNUP_ENABLED: "true",
        },
        reuseExistingServer: process.env.PLAYWRIGHT_REUSE_SERVER === "true",
        timeout: 120_000,
        url: baseURL,
      },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      // The browser flows again on a phone-sized screen.
      name: "mobile",
      use: { ...devices["Pixel 7"] },
      testMatch: /(workspace|app-shell|home|tasks|goals|projects|notes|events|accessibility)\.spec\.ts/,
    },
  ],
});
