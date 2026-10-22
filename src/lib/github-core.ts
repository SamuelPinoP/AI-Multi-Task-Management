/**
 * A project's linked GitHub repository (SMART-12): reading what the owner
 * typed, and shaping GitHub's public REST API answers for the project page
 * and its share page. No server-only imports; src/lib/github.ts fetches.
 */

const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const NAME = /^[A-Za-z0-9._-]{1,100}$/;

/**
 * "owner/name" from what someone pastes: `owner/name`, a github.com URL
 * (with or without https://, .git, or a path after the name), or null.
 */
export function parseGithubRepo(input: unknown): string | null {
  if (typeof input !== "string") return null;
  let value = input.trim();
  if (!value) return null;
  value = value.replace(/^git@github\.com:/i, "");
  value = value.replace(/^(?:https?:\/\/)?(?:www\.)?github\.com\//i, "");
  const [owner, rawName] = value.split(/[/?#]/);
  const name = rawName?.replace(/\.git$/i, "");
  if (!owner || !name || !OWNER.test(owner) || !NAME.test(name) || name === "." || name === "..") return null;
  return `${owner}/${name}`;
}

export function githubRepoUrl(repo: string) {
  return `https://github.com/${repo}`;
}

/** Only links into github.com are shown, whatever the API answers. */
function safeGithubUrl(value: unknown, fallback: string) {
  return typeof value === "string" && value.startsWith("https://github.com/") ? value : fallback;
}

export type GithubItem = {
  number: number;
  title: string;
  url: string;
  author: string | null;
  updatedAt: string;
  draft: boolean;
};

export type GithubSummary = {
  repo: string;
  url: string;
  description: string | null;
  stars: number;
  forks: number;
  /** GitHub counts open issues and pull requests together. */
  openItems: number;
  pushedAt: string | null;
  archived: boolean;
  pulls: GithubItem[];
  issues: GithubItem[];
};

export type GithubProblem = "not-found" | "rate-limited" | "unavailable";

type ApiRepo = {
  full_name?: unknown;
  html_url?: unknown;
  description?: unknown;
  stargazers_count?: unknown;
  forks_count?: unknown;
  open_issues_count?: unknown;
  pushed_at?: unknown;
  archived?: unknown;
  private?: unknown;
};

type ApiItem = {
  number?: unknown;
  title?: unknown;
  html_url?: unknown;
  user?: { login?: unknown } | null;
  updated_at?: unknown;
  draft?: unknown;
  pull_request?: unknown;
};

const count = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0);

function toItem(item: ApiItem, repo: string): GithubItem | null {
  if (typeof item.number !== "number" || typeof item.title !== "string") return null;
  return {
    number: item.number,
    title: item.title,
    url: safeGithubUrl(item.html_url, `${githubRepoUrl(repo)}/issues/${item.number}`),
    author: typeof item.user?.login === "string" ? item.user.login : null,
    updatedAt: typeof item.updated_at === "string" ? item.updated_at : "",
    draft: item.draft === true,
  };
}

/**
 * Builds the summary from `GET /repos/{repo}`, `/pulls` and `/issues` (the
 * issues list also holds pull requests, which are dropped there).
 */
export function summarizeGithubRepo(repo: string, apiRepo: ApiRepo, pulls: ApiItem[], issues: ApiItem[], limit = 5): GithubSummary {
  const fullName = typeof apiRepo.full_name === "string" && parseGithubRepo(apiRepo.full_name) ? apiRepo.full_name : repo;
  const items = (list: ApiItem[]) =>
    list
      .map((item) => toItem(item, fullName))
      .filter((item): item is GithubItem => item !== null)
      .slice(0, limit);
  return {
    repo: fullName,
    url: safeGithubUrl(apiRepo.html_url, githubRepoUrl(fullName)),
    description: typeof apiRepo.description === "string" && apiRepo.description.trim() ? apiRepo.description.trim() : null,
    stars: count(apiRepo.stargazers_count),
    forks: count(apiRepo.forks_count),
    openItems: count(apiRepo.open_issues_count),
    pushedAt: typeof apiRepo.pushed_at === "string" ? apiRepo.pushed_at : null,
    archived: apiRepo.archived === true,
    pulls: items(Array.isArray(pulls) ? pulls : []),
    issues: items((Array.isArray(issues) ? issues : []).filter((item) => !item.pull_request)),
  };
}

/** What an unsuccessful GitHub answer means for the reader. */
export function githubProblemFor(status: number): GithubProblem {
  if (status === 404) return "not-found";
  if (status === 403 || status === 429) return "rate-limited";
  return "unavailable";
}

export function describeGithubProblem(problem: GithubProblem, repo: string) {
  if (problem === "not-found") return `GitHub doesn't show a public repository called ${repo}. It may be private, renamed or deleted.`;
  if (problem === "rate-limited") return "GitHub is limiting requests right now. The latest issues and pull requests will show again soon.";
  return "GitHub couldn't be reached. The latest issues and pull requests will show again soon.";
}
