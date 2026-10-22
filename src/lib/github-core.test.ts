import assert from "node:assert/strict";
import test from "node:test";
import { describeGithubProblem, githubProblemFor, parseGithubRepo, summarizeGithubRepo } from "./github-core";

test("reads owner/name from what people paste", () => {
  assert.equal(parseGithubRepo("vercel/next.js"), "vercel/next.js");
  assert.equal(parseGithubRepo("  https://github.com/vercel/next.js  "), "vercel/next.js");
  assert.equal(parseGithubRepo("github.com/vercel/next.js/pulls?q=is%3Aopen"), "vercel/next.js");
  assert.equal(parseGithubRepo("https://www.github.com/SamuelPinoP/AI-Multi-Task-Management.git"), "SamuelPinoP/AI-Multi-Task-Management");
  assert.equal(parseGithubRepo("git@github.com:octo-org/hello_world.git"), "octo-org/hello_world");
  assert.equal(parseGithubRepo("https://github.com/octo-org/repo#readme"), "octo-org/repo");
});

test("refuses anything that isn't a GitHub repository", () => {
  for (const input of [
    "",
    "   ",
    "vercel",
    "https://gitlab.com/group/project",
    "https://github.com/vercel",
    "-bad/name",
    "owner/..",
    "owner/name with spaces",
    "../../etc/passwd",
    "a".repeat(40) + "/repo",
    null,
    42,
  ]) {
    assert.equal(parseGithubRepo(input), null, String(input));
  }
});

const repoJson = {
  full_name: "Octo/Roadmap",
  html_url: "https://github.com/Octo/Roadmap",
  description: "  A demo  ",
  stargazers_count: 7,
  forks_count: 2,
  open_issues_count: 3,
  pushed_at: "2026-10-20T15:00:00Z",
  archived: false,
};

test("shapes GitHub's answers: issues without pull requests, newest few", () => {
  const pull = { number: 12, title: "Add sharing", html_url: "https://github.com/Octo/Roadmap/pull/12", user: { login: "sam" }, updated_at: "2026-10-20T15:00:00Z", draft: true, pull_request: {} };
  const issue = (number: number) => ({ number, title: `Issue ${number}`, html_url: `https://github.com/Octo/Roadmap/issues/${number}`, user: { login: "dana" }, updated_at: "2026-10-19T10:00:00Z" });
  const summary = summarizeGithubRepo("octo/roadmap", repoJson, [pull], [pull, ...[1, 2, 3, 4, 5, 6].map(issue)]);
  assert.equal(summary.repo, "Octo/Roadmap");
  assert.equal(summary.description, "A demo");
  assert.equal(summary.stars, 7);
  assert.equal(summary.openItems, 3);
  assert.deepEqual(summary.pulls, [{ number: 12, title: "Add sharing", url: "https://github.com/Octo/Roadmap/pull/12", author: "sam", updatedAt: "2026-10-20T15:00:00Z", draft: true }]);
  assert.deepEqual(
    summary.issues.map((item) => item.number),
    [1, 2, 3, 4, 5],
  );
});

test("never links outside github.com, and survives odd answers", () => {
  const summary = summarizeGithubRepo(
    "octo/roadmap",
    { ...repoJson, full_name: "<script>", html_url: "javascript:alert(1)", stargazers_count: -1, description: "" },
    [{ number: 1, title: "x", html_url: "https://evil.example/1" }, { title: "no number" }, { number: 2 }],
    "not a list" as unknown as [],
  );
  assert.equal(summary.repo, "octo/roadmap");
  assert.equal(summary.url, "https://github.com/octo/roadmap");
  assert.equal(summary.stars, 0);
  assert.equal(summary.description, null);
  assert.deepEqual(summary.pulls.map((item) => item.url), ["https://github.com/octo/roadmap/issues/1"]);
  assert.deepEqual(summary.issues, []);
});

test("explains GitHub's errors", () => {
  assert.equal(githubProblemFor(404), "not-found");
  assert.equal(githubProblemFor(403), "rate-limited");
  assert.equal(githubProblemFor(429), "rate-limited");
  assert.equal(githubProblemFor(502), "unavailable");
  assert.match(describeGithubProblem("not-found", "octo/x"), /octo\/x/);
});
