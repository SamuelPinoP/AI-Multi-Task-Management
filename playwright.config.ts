import { defineConfig, devices } from "@playwright/test";

const e2ePort = process.env.E2E_PORT || "3100";
// tests/e2e/github-stub.ts answers for GitHub's API on this port (SMART-12),
// and tests/e2e/google-stub.ts for Google's sign-in on the next one (#356).
const githubStubUrl = `http://127.0.0.1:${Number(e2ePort) + 1000}`;
const googleStubUrl = `http://127.0.0.1:${Number(e2ePort) + 1001}`;
const baseURL =
  process.env.PLAYWRIGHT_BASE_URL || `http://localhost:${e2ePort}`;
const isCI = Boolean(process.env.CI);
// "start" builds the app and serves the production build. A dev server takes
// about a second to hydrate each page, so tests that type or click right after
// load can act on the server-rendered HTML. Both modes use webpack, because
// Turbopack won't compile a worktree whose node_modules is a junction to
// another checkout; CI's `npm run build` still uses Turbopack, like Vercel.
const serveProductionBuild = process.env.E2E_SERVER_MODE === "start";
const nextCli = "node node_modules/next/dist/bin/next";
const serverArgs = `--hostname localhost --port ${e2ePort}`;
// Vercel preview URLs are behind Deployment Protection; CI passes this secret
// so the @smoke tests can reach them.
const vercelBypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: ["./tests/e2e/github-stub.ts", "./tests/e2e/google-stub.ts"],
  timeout: 60_000,
  // One worker: a cold dev server compiling routes for two workers at once
  // aborts navigations, and the suite is small.
  workers: 1,
  // On CI a failed test runs once more, so one slow moment on the runner
  // doesn't block a merge. A test that passes only on its retry still counts
  // as flaky: the GitHub reporter marks it with an error annotation and the
  // run summary counts it, so it gets fixed rather than hidden (#466).
  // Locally, a failure fails at once.
  retries: isCI ? 1 : 0,
  expect: { timeout: 10_000 },
  reporter: isCI
    ? [["list"], ["github"], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    // The production build registers a service worker (SMART-10). It would
    // answer requests before page.route() mocks see them, so only pwa.spec.ts
    // turns it on.
    serviceWorkers: "block",
    // The browser follows TZ like the test process does. Chromium on Windows
    // ignores TZ, so with TZ=UTC a test's new Date() and the page disagree on
    // the date every evening. user-time-zone.spec.ts still sets its own zone.
    timezoneId: process.env.TZ || undefined,
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
        command: serveProductionBuild
          ? `${nextCli} build --webpack && ${nextCli} start ${serverArgs}`
          : `${nextCli} dev --webpack ${serverArgs}`,
        env: {
          // APP_ADMIN_EMAIL in tests/e2e/helpers.ts: the account that may open the free-tier usage page (#286).
          ADMIN_EMAILS: "usage-admin@example.test",
          EMAIL_PROVIDER: "disabled",
          GUEST_LOGIN_ENABLED: "true",
          PROJECT_CHAT_DEFAULT_STORAGE_PROVIDER: "local",
          PROJECT_CHAT_PUBLIC_UPLOAD_PATH: "/uploads/project-chat",
          PROJECT_CHAT_STORAGE_PROVIDER: "",
          PROJECT_CHAT_VIDEO_STORAGE_PROVIDER: "local",
          SIGNUP_ENABLED: "true",
          GITHUB_API_URL: githubStubUrl,
          GITHUB_TOKEN: "",
          // The OAuth client tests/e2e/google-stub.ts accepts; test values, not secrets.
          GOOGLE_CLIENT_ID: "e2e-client.apps.googleusercontent.com",
          GOOGLE_CLIENT_SECRET: "e2e-client-secret",
          GOOGLE_OAUTH_URL: googleStubUrl,
          // The AI assistant answers by the fake provider's rules (#307): no test calls a real model.
          AI_PROVIDER: "fake",
          GEMINI_API_KEY: "",
          // AI apps over MCP (#478), with the signing secret tests/e2e/mcp.spec.ts mints tokens with.
          MCP_ENABLED: "true",
          MCP_TOKEN_SECRET: "e2e-mcp-token-secret-not-a-real-secret",
        },
        reuseExistingServer: process.env.PLAYWRIGHT_REUSE_SERVER === "true",
        // The production build runs inside this timeout too.
        timeout: serveProductionBuild ? 600_000 : 120_000,
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
      testMatch: /(workspace|app-shell|accent-color|home|tasks|quick-add|projects|notes|events|calendar|accessibility|project-insights|subtasks|goals|linked-notes|project-templates|project-github|tree|chat-composer|chat-messages|chat-search|phone-fields|text-size|labels|bulk-edit|tasks-by-project|tasks-phone|task-comments|direct-messages|project-members|add-people|phone-titles|usage|users|feedback|ai-page|ai-proposal-card|ai-tickets|ai-bar|ai-dock|guest-mode|guest-start|integrations|oauth).spec.ts/,
    },
  ],
});
