// Prints the monthly maintenance report as Markdown (see
// .github/workflows/maintenance-report.yml). Needs `npm ci` and an
// authenticated `gh`; every section degrades to a note instead of failing.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const REPO = process.env.GITHUB_REPOSITORY || "SamuelPinoP/AI-Multi-Task-Management";
const today = new Date();
const lines = [];
const say = (text = "") => lines.push(text);

function run(command, args) {
  try {
    return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32" });
  } catch (error) {
    // npm outdated and npm audit exit non-zero when they find something.
    if (typeof error.stdout === "string" && error.stdout.trim()) return error.stdout;
    throw error;
  }
}

function json(command, args) {
  return JSON.parse(run(command, args));
}

const major = (version) => Number(String(version).replace(/^[^\d]*/, "").split(".")[0]);
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

say(`Automatic monthly check, ${today.toISOString().slice(0, 10)}. Items found automatically are listed first, then a short checklist only a person can do.`);
say();
say("To hand this to Claude, open Claude Code in the project and say: *work through the latest maintenance issue*.");
say();

// 1. Major upgrades Dependabot skips.
say("## Major upgrades waiting");
say();
try {
  const outdated = json("npm", ["outdated", "--json"]);
  const majors = Object.entries(outdated)
    // @types/node follows the Node runtime (next section); pre-releases aren't upgrades yet.
    .filter(([name]) => name !== "@types/node")
    .filter(([, info]) => info.current && info.latest && !String(info.latest).includes("-"))
    .filter(([, info]) => major(info.latest) > major(info.current))
    .sort(([a], [b]) => a.localeCompare(b));
  if (majors.length === 0) {
    say("None. Every package is on its latest major version.");
  } else {
    say("Dependabot skips major versions, so these need a planned upgrade. Each one can need code changes; try it on a branch and let CI decide.");
    say();
    say("| Package | Installed | Latest | Release notes |");
    say("| --- | --- | --- | --- |");
    for (const [name, info] of majors) {
      say(`| \`${name}\` | ${info.current} | ${info.latest} | [npm](https://www.npmjs.com/package/${name}?activeTab=versions) |`);
    }
  }
} catch (error) {
  say(`Couldn't run \`npm outdated\`: ${error.message.split("\n")[0]}`);
}
say();

// 2. Node.js runtime.
say("## Node.js runtime");
say();
try {
  const runtimeMajor = major(pkg.engines?.node ?? "");
  const typesMajor = major(pkg.devDependencies?.["@types/node"] ?? "");
  if (!runtimeMajor) throw new Error("package.json has no engines.node field");
  const response = await fetch("https://raw.githubusercontent.com/nodejs/Release/main/schedule.json");
  const schedule = await response.json();
  const entry = schedule[`v${runtimeMajor}`];
  const end = entry ? new Date(entry.end) : null;
  const monthsLeft = end ? Math.round((end - today) / (30 * 24 * 3600 * 1000)) : null;
  say(`The app runs on Node ${runtimeMajor} (\`engines.node\` in package.json; keep the Vercel project setting the same).`);
  if (end) {
    say(
      monthsLeft <= 6
        ? `- [ ] **Node ${runtimeMajor} stops getting security fixes on ${entry.end} (in about ${monthsLeft} months).** Move to the next even-numbered Node release: \`engines.node\`, \`@types/node\`, both workflow files and the Vercel project setting.`
        : `Node ${runtimeMajor} gets security fixes until ${entry.end}. Nothing to do yet.`,
    );
  }
  if (typesMajor && typesMajor !== runtimeMajor) {
    say(`- [ ] \`@types/node\` is ${typesMajor}.x but the runtime is Node ${runtimeMajor}: set it to \`^${runtimeMajor}\`.`);
  }
} catch (error) {
  say(`Couldn't check the Node.js release schedule: ${error.message.split("\n")[0]}`);
}
say();

// 3. Dependabot PRs that didn't merge themselves.
say("## Dependabot pull requests that are stuck");
say();
try {
  const prs = json("gh", ["pr", "list", "-R", REPO, "--author", "app/dependabot", "--state", "open", "--json", "number,title,createdAt,url"]);
  const stuck = prs.filter((pr) => today - new Date(pr.createdAt) > 3 * 24 * 3600 * 1000);
  if (stuck.length === 0) {
    say("None. Dependabot PRs merge themselves once their checks pass.");
  } else {
    say("These have been open for more than 3 days, which usually means a check failed and needs a fix:");
    say();
    for (const pr of stuck) say(`- [ ] [#${pr.number} ${pr.title}](${pr.url})`);
  }
} catch (error) {
  say(`Couldn't list Dependabot PRs: ${error.message.split("\n")[0]}`);
}
say();

// 4. Security findings.
say("## Security findings");
say();
try {
  const audit = json("npm", ["audit", "--omit=dev", "--json"]);
  const counts = audit.metadata?.vulnerabilities ?? {};
  const names = Object.entries(audit.vulnerabilities ?? {}).map(([name, info]) => `\`${name}\` (${info.severity})`);
  say(
    names.length === 0
      ? "`npm audit`: no known issues in production dependencies."
      : `\`npm audit\` on production dependencies: ${counts.critical ?? 0} critical, ${counts.high ?? 0} high, ${counts.moderate ?? 0} moderate, ${counts.low ?? 0} low: ${names.join(", ")}. CI already blocks high and critical ones.`,
  );
} catch (error) {
  say(`Couldn't run \`npm audit\`: ${error.message.split("\n")[0]}`);
}
try {
  const alerts = json("gh", ["api", `repos/${REPO}/code-scanning/alerts?state=open&per_page=100`]);
  say(
    alerts.length === 0
      ? "Code scanning (CodeQL): no open alerts."
      : `- [ ] Code scanning (CodeQL): ${alerts.length} open alert(s). [Review them](https://github.com/${REPO}/security/code-scanning).`,
  );
} catch (error) {
  say(`Couldn't read code scanning alerts: ${error.message.split("\n")[0]}`);
}
say();

// 5. What only a person can check.
say("## Checklist");
say();
say("- [ ] The latest [CI run on main](https://github.com/" + REPO + "/actions/workflows/ci.yml?query=branch%3Amain) is green.");
say("- [ ] Open the live app, sign in, and open a chat attachment.");
say("- [ ] Free-tier usage is comfortably inside the limits: Vercel (Usage tab), Neon (production and preview databases), Cloudflare R2 (the app caps itself at 8 GB of the free 10 GB), and Gmail sending (about 500 emails a day; Gmail warns in the sending account's inbox when it's reached).");
say("- [ ] No surprise charges or new payment methods on Vercel, Neon, Cloudflare, AWS or GitHub.");
say();
say("When the boxes are done, close this issue. Next month's check opens a new one and closes this one if it's still open.");

console.log(lines.join("\n"));
