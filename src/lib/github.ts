import "server-only";
import { githubProblemFor, summarizeGithubRepo, type GithubProblem, type GithubSummary } from "@/lib/github-core";

/**
 * Reads public repositories from GitHub's REST API (SMART-12). Without a
 * token GitHub allows 60 requests an hour per server address, so answers are
 * kept for 10 minutes (Next.js data cache, shared by every visitor).
 * GITHUB_TOKEN (optional, read-only public access) raises the limit to 5,000.
 * GITHUB_API_URL points the tests at a local stand-in.
 */
const CACHE_SECONDS = 600;
const TIMEOUT_MS = 8_000;

function apiBase() {
  return (process.env.GITHUB_API_URL?.trim() || "https://api.github.com").replace(/\/+$/, "");
}

function requestHeaders() {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "AI-Multi",
  };
  const token = process.env.GITHUB_TOKEN?.trim();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function repoPath(repo: string) {
  return repo.split("/").map(encodeURIComponent).join("/");
}

async function getJson(path: string, cached: boolean): Promise<{ data: unknown } | { problem: GithubProblem }> {
  const response = await fetch(`${apiBase()}${path}`, {
    headers: requestHeaders(),
    signal: AbortSignal.timeout(TIMEOUT_MS),
    ...(cached ? { next: { revalidate: CACHE_SECONDS } } : { cache: "no-store" as const }),
  });
  if (!response.ok) return { problem: githubProblemFor(response.status) };
  return { data: await response.json() };
}

/**
 * Checks that `repo` is a public repository before a project links it, and
 * returns GitHub's spelling of its name. A token could see private ones; those
 * are refused, because the share page would show them to anyone.
 */
export async function lookUpGithubRepo(repo: string): Promise<{ repo: string } | { problem: GithubProblem }> {
  try {
    const result = await getJson(`/repos/${repoPath(repo)}`, false);
    if ("problem" in result) return result;
    const data = result.data as { full_name?: unknown; private?: unknown };
    if (data.private === true) return { problem: "not-found" };
    return { repo: typeof data.full_name === "string" ? data.full_name : repo };
  } catch {
    return { problem: "unavailable" };
  }
}

/** The repository's description, counts and latest open pull requests and issues. */
export async function fetchGithubSummary(repo: string): Promise<{ summary: GithubSummary } | { problem: GithubProblem }> {
  try {
    const path = repoPath(repo);
    const [details, pulls, issues] = await Promise.all([
      getJson(`/repos/${path}`, true),
      getJson(`/repos/${path}/pulls?state=open&sort=updated&direction=desc&per_page=5`, true),
      getJson(`/repos/${path}/issues?state=open&sort=updated&direction=desc&per_page=15`, true),
    ]);
    if ("problem" in details) return details;
    if ((details.data as { private?: unknown }).private === true) return { problem: "not-found" };
    const list = (result: typeof pulls) => ("data" in result && Array.isArray(result.data) ? result.data : []);
    return {
      summary: summarizeGithubRepo(repo, details.data as Parameters<typeof summarizeGithubRepo>[1], list(pulls), list(issues)),
    };
  } catch {
    return { problem: "unavailable" };
  }
}
