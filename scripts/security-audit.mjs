// Checks the production dependencies for high and critical advisories with `npm audit`, for
// .github/workflows/security-audit.yml (#508). It reads only package-lock.json, so it needs no
// `npm ci`.
//
//   node scripts/security-audit.mjs          prints the report; exits 1 when it finds advisories
//   node scripts/security-audit.mjs --issue  also opens, updates or closes the "security-audit"
//                                            issue with `gh`; exits 0 unless something failed
//   add --dry-run                            prints what it would change on GitHub instead
//
// CI's `npm audit` step fails every pull request while main has such an advisory, even one
// published against a package nobody touched (#508). This check finds it within a day, usually
// before a pull request runs into it, and opens one issue for it, assigned to the repository owner.
import { execFileSync, execSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const LABEL = "security-audit";
/** The labels every ticket needs (AGENTS.md, "Issues"), plus the one this script finds its issue by. */
export const ISSUE_LABELS = [LABEL, "type: chore", "area: security", "priority: high"];
const SEVERITY_ORDER = ["critical", "high"];
const MARKER = /^<!-- advisories: (.*) -->$/m;
const MAX_ROWS = 50;
const MAX_PATHS = 3;
/** Enough to say "and N more" without walking every route through a large dependency graph. */
const PATH_LIMIT = 20;

/** How each vulnerable package is installed, from a direct dependency down to it: [["prisma", "@prisma/config", "effect"]]. */
function installPaths(name, vulnerabilities, seen = new Set([name])) {
  const entry = vulnerabilities[name];
  const paths = entry?.isDirect ? [[name]] : [];
  for (const parent of entry?.effects ?? []) {
    if (seen.has(parent)) continue;
    for (const path of installPaths(parent, vulnerabilities, new Set([...seen, parent]))) {
      if (paths.length >= PATH_LIMIT) return paths;
      paths.push([...path, name]);
    }
  }
  return paths.length ? paths : [[name]];
}

/**
 * The high and critical advisories in an `npm audit --json` report, most severe first, each with
 * the installed versions (from the lockfile) and how the package gets installed.
 */
export function advisoriesFrom(audit, lockfile = {}) {
  const vulnerabilities = audit?.vulnerabilities ?? {};
  const packages = lockfile.packages ?? {};
  const found = new Map();
  for (const entry of Object.values(vulnerabilities)) {
    for (const via of entry.via ?? []) {
      // A string names a vulnerable dependency, listed under its own name; objects are advisories.
      if (typeof via !== "object" || !SEVERITY_ORDER.includes(via.severity)) continue;
      const id = String(via.url ?? "").match(/GHSA(-[a-z0-9]{4}){3}$/i)?.[0] ?? `npm-${via.source}`;
      const name = via.name ?? entry.name;
      const key = `${id}:${name}`;
      if (found.has(key)) continue;
      const versions = [...new Set((entry.nodes ?? []).map((node) => packages[node]?.version).filter(Boolean))];
      found.set(key, { key, id, name, severity: via.severity, title: via.title ?? id, url: via.url ?? null, range: via.range ?? entry.range ?? "", versions, paths: installPaths(name, vulnerabilities) });
    }
  }
  return [...found.values()].sort(
    (a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
  );
}

const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;
const listing = (names) => (names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);
/**
 * Keeps a value inside one Markdown table cell. Backslashes are escaped first: otherwise a title
 * ending in "\" would turn the escaped "\|" after it back into a column break.
 */
const cell = (text) =>
  String(text)
    .replace(/\s+/g, " ")
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|");
const code = (text) => `\`${String(text).replace(/`/g, "'")}\``;

export function auditTitle(advisories) {
  const names = [...new Set(advisories.map((advisory) => advisory.name))];
  if (advisories.length === 1) return `Security audit: ${names[0]} has a ${advisories[0].severity}-severity advisory`;
  const where = names.length <= 3 ? listing(names) : `${names.length} production dependencies`;
  return `Security audit: ${advisories.length} high or critical advisories in ${where}`;
}

/** The ids the issue was last written with, so a change to the list can be announced. */
export function advisoryKeys(advisories) {
  return advisories.map((advisory) => advisory.key).sort().join(",");
}

export function keysInBody(body) {
  return String(body ?? "").replace(/\r\n/g, "\n").match(MARKER)?.[1] ?? "";
}

/** The issue: what was found, how to fix it, and when it's done (AGENTS.md, "Issues"). */
export function issueBody(advisories, { repo, runUrl }) {
  const rows = advisories.slice(0, MAX_ROWS).map((advisory) => {
    const link = advisory.url ? `[${cell(advisory.title)}](${advisory.url})` : cell(advisory.title);
    const paths = advisory.paths.slice(0, MAX_PATHS).map((path) => path.map(code).join(" › "));
    if (advisory.paths.length > MAX_PATHS) paths.push(advisory.paths.length >= PATH_LIMIT ? "and more" : `and ${advisory.paths.length - MAX_PATHS} more`);
    return `| ${code(advisory.name)} | ${cell(advisory.versions.join(", ") || "?")} | ${advisory.severity} | ${link} (${advisory.id}) | ${cell(advisory.range)} | ${paths.join("<br>")} |`;
  });
  const more = advisories.length > MAX_ROWS ? [``, `And ${advisories.length - MAX_ROWS} more: run \`npm audit --omit=dev\` for the full list.`] : [];
  const workflow = `https://github.com/${repo}/blob/main/.github/workflows/security-audit.yml`;
  return [
    "### Summary",
    "",
    `\`npm audit\` finds ${plural(advisories.length, "advisory", "advisories")} rated high or critical in the production dependencies on \`main\`. Until it's fixed, CI's \`npm audit\` step fails every pull request, so fix this before anything else.`,
    "",
    "### Advisories",
    "",
    "| Package | Installed | Severity | Advisory | Affected versions | Installed through |",
    "|---|---|---|---|---|---|",
    ...rows,
    ...more,
    "",
    "### How to fix",
    "",
    "1. Update the package, or the dependency that brings it in, to a release with the fix. Dependabot opens a security update when one exists.",
    "2. If a dependency pins a vulnerable version and no release of it fixes that, add an `overrides` entry scoped to that dependency in `package.json`, as #509 did for `effect` under `@prisma/config`, and check that the dependency still works.",
    "3. Open a pull request that says `Fixes` and this issue's number.",
    "",
    "### Acceptance criteria",
    "",
    "- [ ] `npm audit --omit=dev --audit-level=high` passes on `main`.",
    "- [ ] The production deploy after the fix succeeds.",
    "",
    "### Details",
    "",
    `- Opened by [\`security-audit.yml\`](${workflow})${runUrl ? ` ([this run](${runUrl}))` : ""}, which checks \`main\` every day and after each merge that changes \`package.json\` or \`package-lock.json\`. It keeps this list current, comments when it changes, and closes this issue once \`main\` is clean.`,
    "- Estimate: S. Migration: none. Free-tier cost: none.",
    "",
    `<!-- advisories: ${advisoryKeys(advisories)} -->`,
  ].join("\n");
}

export function cleanReport(audit) {
  const checked = audit?.metadata?.dependencies?.prod;
  return `\`npm audit\`: no high or critical advisories in the production dependencies${typeof checked === "number" ? ` (${checked} packages)` : ""}.`;
}

/**
 * What to change on GitHub, given the advisories found and the open issue, if any: open one,
 * update it (commenting when the list changed, which notifies the owner), close it, or nothing.
 */
export function nextStep(advisories, openIssue, { repo, runUrl, today }) {
  const run = runUrl ? `, [run](${runUrl})` : "";
  if (!advisories.length) {
    if (!openIssue) return { kind: "none" };
    return {
      kind: "close",
      number: openIssue.number,
      comment: `\`npm audit\` finds no high or critical advisories in the production dependencies on \`main\` any more (${today}${run}). Closing.`,
    };
  }
  const title = auditTitle(advisories);
  const body = issueBody(advisories, { repo, runUrl });
  if (!openIssue) return { kind: "open", title, body };
  const changed = keysInBody(openIssue.body) !== advisoryKeys(advisories);
  return {
    kind: "update",
    number: openIssue.number,
    title,
    body,
    comment: changed ? `The list of advisories changed (${today}${run}): ${title.replace(/^Security audit: /, "")}. The issue above has the current list.` : null,
  };
}

const REPO = process.env.GITHUB_REPOSITORY || "SamuelPinoP/AI-Multi-Task-Management";

/**
 * `gh` is an executable everywhere, so it runs without a shell: arguments with spaces stay whole.
 * GH_REPO names the repository, so it works outside a checkout too.
 */
function gh(args, input) {
  return execFileSync("gh", args, { encoding: "utf8", input, env: { ...process.env, GH_REPO: REPO }, stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"] });
}

function runAudit() {
  let output;
  try {
    // One fixed command line: Windows needs a shell to find npm.
    output = execSync("npm audit --omit=dev --package-lock-only --json", { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    // npm audit exits non-zero when it finds something; its report is still on stdout.
    if (typeof error.stdout !== "string" || !error.stdout.trim()) throw error;
    output = error.stdout;
  }
  const audit = JSON.parse(output);
  // When the registry can't be reached, npm still answers in JSON, with an error instead of a report.
  if (audit.error) throw new Error(audit.error.summary || audit.error.code || "npm audit failed");
  return audit;
}

function applyStep(step, { owner, dryRun }) {
  const run = (args, input) => (dryRun ? console.log(`[dry run] gh ${args.join(" ")}${input ? `\n${input}` : ""}`) : gh(args, input));
  switch (step.kind) {
    case "open": {
      const labels = ISSUE_LABELS.flatMap((label) => ["--label", label]);
      run(["issue", "create", "--title", step.title, "--body-file", "-", ...labels, ...(owner ? ["--assignee", owner] : [])], step.body);
      break;
    }
    case "update":
      run(["issue", "edit", String(step.number), "--title", step.title, "--body-file", "-"], step.body);
      if (step.comment) run(["issue", "comment", String(step.number), "--body-file", "-"], step.comment);
      break;
    case "close":
      run(["issue", "close", String(step.number), "--comment", step.comment]);
      break;
  }
}

function main(argv) {
  const manageIssue = argv.includes("--issue");
  const dryRun = argv.includes("--dry-run");
  const repo = REPO;
  const runUrl = process.env.GITHUB_RUN_ID ? `${process.env.GITHUB_SERVER_URL || "https://github.com"}/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}` : null;
  const summary = (text) => process.env.GITHUB_STEP_SUMMARY && appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);

  let audit;
  try {
    audit = runAudit();
  } catch (error) {
    // Nothing on GitHub changes: a failed run says nothing about the dependencies.
    console.log(`Couldn't run \`npm audit\`: ${String(error.message).split("\n")[0]}`);
    return 2;
  }
  const lockfile = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));
  const advisories = advisoriesFrom(audit, lockfile);
  const report = advisories.length ? issueBody(advisories, { repo, runUrl }) : cleanReport(audit);
  console.log(report);
  summary(report);
  if (!manageIssue) return advisories.length ? 1 : 0;

  // --force: the label usually exists, and this keeps its color and description as written here.
  if (!dryRun) gh(["label", "create", LABEL, "--force", "--color", "B60205", "--description", "npm audit found a high or critical advisory on main"]);
  const [openIssue] = JSON.parse(gh(["issue", "list", "--label", LABEL, "--state", "open", "--json", "number,body", "--limit", "1"]));
  const step = nextStep(advisories, openIssue ?? null, { repo, runUrl, today: new Date().toISOString().slice(0, 10) });
  applyStep(step, { owner: process.env.OWNER, dryRun });
  const done = { none: "No issue to open or close.", open: "Opened the issue.", update: `Updated #${step.number}.`, close: `Closed #${step.number}.` }[step.kind];
  const outcome = dryRun && step.kind !== "none" ? `[dry run] Nothing changed; it would have: ${done}` : done;
  console.log(outcome);
  summary(`\n${outcome}`);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(error);
    process.exitCode = 2;
  }
}
