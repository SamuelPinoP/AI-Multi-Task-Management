import http from "node:http";

/**
 * Playwright global setup: a stand-in for GitHub's REST API (SMART-12), so the
 * GitHub tests never depend on github.com or its rate limits. The app reaches
 * it through GITHUB_API_URL, set by scripts/run-playwright-e2e.mjs and
 * playwright.config.ts to http://127.0.0.1:<E2E port + 1000>.
 *
 * - ai-multi-demo/roadmap: a public repository with one pull request and two issues.
 * - ai-multi-demo/hidden: private (a token could see it); the app must refuse it.
 * - ai-multi-demo/busy: answers 403, like GitHub's rate limit.
 * - anything else: 404.
 */
export const STUB_REPO = "ai-multi-demo/roadmap";

const updated = "2026-10-20T15:00:00Z";
const item = (number: number, title: string, extra: Record<string, unknown> = {}) => ({
  number,
  title,
  html_url: `https://github.com/${STUB_REPO}/${extra.pull_request ? "pull" : "issues"}/${number}`,
  user: { login: "octo-dev" },
  updated_at: updated,
  ...extra,
});

const routes: Record<string, { status: number; body: unknown }> = {
  [`/repos/${STUB_REPO}`]: {
    status: 200,
    body: {
      full_name: STUB_REPO,
      html_url: `https://github.com/${STUB_REPO}`,
      description: "Demo repository for the share page",
      stargazers_count: 42,
      forks_count: 3,
      open_issues_count: 3,
      pushed_at: updated,
      archived: false,
      private: false,
    },
  },
  [`/repos/${STUB_REPO}/pulls`]: { status: 200, body: [item(12, "Add the share page", { draft: false, pull_request: {} })] },
  [`/repos/${STUB_REPO}/issues`]: {
    status: 200,
    // GitHub's issue list includes pull requests; the app must drop them.
    body: [item(12, "Add the share page", { pull_request: {} }), item(7, "Export the calendar"), item(5, "Dark mode for charts")],
  },
  "/repos/ai-multi-demo/hidden": { status: 200, body: { full_name: "ai-multi-demo/hidden", private: true } },
  "/repos/ai-multi-demo/busy": { status: 403, body: { message: "API rate limit exceeded" } },
};

export function githubStubPort() {
  return Number(process.env.E2E_PORT || "3100") + 1000;
}

export default async function globalSetup() {
  const server = http.createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://stub").pathname;
    const route = routes[path] ?? { status: 404, body: { message: "Not Found" } };
    response.writeHead(route.status, { "Content-Type": "application/json" });
    response.end(JSON.stringify(route.body));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(githubStubPort(), "127.0.0.1", resolve);
  });
  return async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };
}
