// #231: runs the checks a pull request's "Testing evidence" section reports
// (AGENTS.md, "Pull requests") and prints them as a Markdown table with real
// counts, ready to paste. Progress, and the output of any check that fails, go
// to stderr; the table goes to stdout, so `npm run -s evidence > evidence.md`
// keeps only the table.
//
// Usage: npm run evidence [-- --build] [-- --e2e [spec ...]] [-- --verbose]
//   --build    also runs the production build (`npm run build`).
//   --e2e      builds, then runs Playwright against that build with TZ=UTC,
//              like CI: every spec, or only the ones named. Set E2E_PORT when
//              port 3100 is taken.
//   --verbose  streams each check's output while it runs.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const isWindows = process.platform === "win32";
const args = process.argv.slice(2);
const verbose = args.includes("--verbose");
const runE2e = args.includes("--e2e");
const runBuild = runE2e || args.includes("--build");
const specs = args.filter((arg) => !arg.startsWith("--"));
const scratch = mkdtempSync(path.join(tmpdir(), "testing-evidence-"));
const node = process.execPath;
const rows = [];

// Runs a command from the repository root and resolves with whether it exited
// cleanly and its combined output. npm needs a shell on Windows (npm.cmd), and
// Node deprecates passing a shell separate arguments, so it gets one string.
function run(command, commandArgs, env = {}) {
  return new Promise((resolve) => {
    const options = { cwd: root, env: { ...process.env, ...env } };
    const child =
      isWindows && command === "npm"
        ? spawn([command, ...commandArgs].join(" "), { ...options, shell: true })
        : spawn(command, commandArgs, options);
    let output = "";
    let stdout = "";
    const collect = (chunk) => {
      output += chunk;
      if (verbose) process.stderr.write(chunk);
    };
    child.stdout.setEncoding("utf8").on("data", (chunk) => {
      stdout += chunk;
      collect(chunk);
    });
    child.stderr.setEncoding("utf8").on("data", collect);
    child.on("error", (error) => resolve({ ok: false, output: `${output}${error.message}\n`, stdout }));
    child.on("close", (status) => resolve({ ok: status === 0, output, stdout }));
  });
}

// Runs one check and records its row. `body` resolves with { ok, result, output }.
async function check(name, command, body) {
  process.stderr.write(`${name}: running...\n`);
  const started = Date.now();
  const { ok, result, output } = await body().catch((error) => ({
    ok: false,
    result: "the check itself crashed",
    output: error.stack,
  }));
  process.stderr.write(`${name}: ${ok ? "passed" : "FAILED"} in ${Math.round((Date.now() - started) / 1000)}s\n`);
  if (!ok && !verbose && output) {
    process.stderr.write(`${output.trimEnd().split(/\r?\n/).slice(-40).join("\n")}\n\n`);
  }
  rows.push({ name, command, result: `${ok ? "Pass" : "**Fail**"}: ${result}`, ok });
}

function skip(name, command, reason) {
  rows.push({ name, command, result: `Not run: ${reason}`, ok: true });
}

const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;

// node:test ends each run with a summary ("ℹ tests 229", "ℹ pass 229", ...);
// returns one { tests, pass, fail, ... } object per run in the output.
function testRuns(output) {
  const runs = [];
  for (const [, key, value] of output.matchAll(/^\S+ (tests|pass|fail|cancelled|skipped|todo) (\d+)\r?$/gm)) {
    if (key === "tests") runs.push({});
    if (runs.length > 0) runs.at(-1)[key] = Number(value);
  }
  return runs;
}

function describeTests(counts) {
  const parts = [`${counts.pass} of ${plural(counts.tests, "test")} passed`];
  if (counts.fail) parts.push(`${counts.fail} failed`);
  for (const key of ["cancelled", "skipped", "todo"]) if (counts[key]) parts.push(`${counts[key]} ${key}`);
  return parts.join(", ");
}

async function nodeTests(script) {
  const result = await run("npm", ["run", script]);
  const [counts] = testRuns(result.output);
  if (!counts) return { ...result, result: "couldn't read the test counts" };
  return { ...result, ok: result.ok && !counts.fail, result: describeTests(counts) };
}

const commit = await run("git", ["rev-parse", "--short", "HEAD"]);
const changes = await run("git", ["status", "--porcelain"]);

await check("Lint", "`npm run lint -- --max-warnings=0`", async () => {
  const report = path.join(scratch, "eslint.json");
  const eslint = path.join("node_modules", "eslint", "bin", "eslint.js");
  const lint = await run(node, [eslint, "--format", "json", "--output-file", report]);
  if (!existsSync(report)) return { ...lint, ok: false, result: "ESLint didn't finish" };
  const files = JSON.parse(readFileSync(report, "utf8"));
  const errors = files.reduce((sum, file) => sum + file.errorCount, 0);
  const warnings = files.reduce((sum, file) => sum + file.warningCount, 0);
  const problems = files.flatMap((file) =>
    file.messages.map((m) => `${path.relative(root, file.filePath)}:${m.line}:${m.column} ${m.message} (${m.ruleId})`),
  );
  // Rules differ a little by file type; count the ones a .tsx file gets.
  const sample = files.find((file) => file.filePath.endsWith(".tsx")) ?? files[0];
  const config = await run(node, [eslint, "--print-config", sample.filePath]);
  const severity = (value) => (Array.isArray(value) ? value[0] : value);
  const rules = Object.values(JSON.parse(config.stdout).rules ?? {}).filter((value) => ![0, "off"].includes(severity(value)));
  return {
    ok: errors === 0 && warnings === 0,
    result: `${plural(files.length, "file")} checked against ${rules.length} rules: ${plural(errors, "error")}, ${plural(warnings, "warning")}`,
    output: problems.join("\n") || lint.output,
  };
});

await check("Types (`tsc --noEmit`)", "`npm run typecheck`", async () => {
  const tsc = await run(node, [path.join("node_modules", "typescript", "bin", "tsc"), "--noEmit", "--listFiles"]);
  const lines = tsc.output.split(/\r?\n/);
  const errors = lines.filter((line) => /error TS\d+:/.test(line)).length;
  // --listFiles prints every file in the program; count this repository's
  // sources, not node_modules or the types Next.js generates into .next.
  const normalize = (file) => (isWindows ? path.normalize(file).toLowerCase() : path.normalize(file));
  const base = normalize(root);
  const listed = (line) => path.isAbsolute(line.trim());
  const files = lines.filter((line) => {
    const file = normalize(line.trim());
    return listed(line) && file.startsWith(base) && !/[\\/](node_modules|\.next)[\\/]/.test(file);
  }).length;
  return {
    ok: tsc.ok && errors === 0,
    result: `${plural(errors, "error")} in ${plural(files, "file")}`,
    output: lines.filter((line) => !listed(line)).join("\n"),
  };
});

await check("Unit tests", "`npm run test:unit`", () => nodeTests("test:unit"));

await check("Unit tests in other time zones", "`npm run test:unit:zones`", async () => {
  const result = await run("npm", ["run", "test:unit:zones"]);
  const zones = [...result.output.matchAll(/^=== npm run test:unit with TZ=(\S+)/gm)].map((match) => match[1]);
  const runs = testRuns(result.output);
  if (runs.length === 0) return { ...result, result: "couldn't read the test counts" };
  const ok = result.ok && runs.every((counts) => !counts.fail);
  const same = runs.every((counts) => describeTests(counts) === describeTests(runs[0]));
  const summary = same
    ? `${describeTests(runs[0])} in each of ${plural(runs.length, "zone")}`
    : runs.map((counts, index) => `${zones[index] ?? `run ${index + 1}`}: ${describeTests(counts)}`).join("; ");
  return { ...result, ok, result: same && zones.length > 0 ? `${summary} (${zones.join(", ")})` : summary };
});

await check("Storage tests", "`npm run test:storage`", () => nodeTests("test:storage"));

await check("Single Radix UI copy", "`node scripts/check-single-radix.mjs`", async () => {
  const radix = await run(node, [path.join("scripts", "check-single-radix.mjs")]);
  return { ...radix, result: radix.ok ? "one version of each @radix-ui package" : "a package is installed twice" };
});

let built = false;
if (runBuild) {
  await check("Production build", "`npm run build`", async () => {
    const build = await run("npm", ["run", "build"]);
    built = build.ok;
    return { ...build, result: build.ok ? "built" : "the build failed" };
  });
} else {
  skip("Production build", "`npm run build`", "CI builds every push");
}

const e2eCommand = `\`npm run test:e2e${specs.length ? ` -- ${specs.map((spec) => path.basename(spec)).join(" ")}` : ""}\``;
if (runE2e && built) {
  await check("E2E (Playwright, production build, TZ=UTC)", e2eCommand, async () => {
    const report = path.join(scratch, "playwright.json");
    const e2e = await run(node, [path.join("scripts", "run-playwright-e2e.mjs"), "--reporter=list,json", ...specs], {
      E2E_SERVER_MODE: "start",
      PLAYWRIGHT_JSON_OUTPUT_FILE: report,
      TZ: "UTC",
    });
    if (!existsSync(report)) return { ...e2e, ok: false, result: "Playwright didn't finish" };
    const { stats, suites } = JSON.parse(readFileSync(report, "utf8"));
    const parts = [`${stats.expected} passed`];
    if (stats.unexpected) parts.push(`${stats.unexpected} failed`);
    if (stats.flaky) parts.push(`${stats.flaky} flaky`);
    if (stats.skipped) parts.push(`${stats.skipped} skipped`);
    return { ...e2e, ok: e2e.ok && stats.unexpected === 0, result: `${parts.join(", ")} in ${plural(suites.length, "spec file")}` };
  });
} else if (runE2e) {
  skip("E2E (Playwright)", e2eCommand, "the build failed");
} else {
  skip("E2E (Playwright)", "`npm run test:e2e`", "CI runs every spec on every push");
}

rmSync(scratch, { recursive: true, force: true });

const where = commit.ok ? `\`${commit.output.trim()}\`` : "this checkout";
const dirty = changes.output.trim() ? ", plus uncommitted changes" : "";
console.log(`Checks run on ${where}${dirty}:\n`);
console.log("| Check | Command | Result |");
console.log("|---|---|---|");
for (const row of rows) console.log(`| ${row.name} | ${row.command} | ${row.result} |`);
if (rows.some((row) => !row.ok)) process.exitCode = 1;
