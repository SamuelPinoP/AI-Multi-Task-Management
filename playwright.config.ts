import { defineConfig, devices } from "@playwright/test";

const e2ePort = process.env.E2E_PORT || "3100";
const baseURL =
  process.env.PLAYWRIGHT_BASE_URL || `http://localhost:${e2ePort}`;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    screenshot: "only-on-failure",
    trace: "on-first-retry",
    video: "retain-on-failure",
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
  ],
});
