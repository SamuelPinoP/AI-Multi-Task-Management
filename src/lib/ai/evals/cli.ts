// npm run agent:eval -- --provider <name> (#311): runs the evaluation cases
// against a model and prints each case's checks, the score, the tokens, what a
// message costs at list prices and how long the model took. Live runs save
// their results to src/lib/ai/evals/results/<date>-<model>.json.
//
// The key comes from AGENT_EVAL_API_KEY, set for one terminal session, and
// never from the app's own variables: evaluation runs use their own key (for
// Gemini, from a separate Google project), so they never draw on the app's
// free pool. See CONTRIBUTING.md, "Changing the AI assistant".
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { ABILITIES, loadCases, type EvalCase } from "@/lib/ai/evals/case";
import { costUsd, modelInfo, UNKNOWN_PACE } from "@/lib/ai/evals/pricing";
import { formatCaseResult, formatSummary, resultFileName, summarize, unusedFileName } from "@/lib/ai/evals/report";
import { createPacer, createReferenceProvider, runCases, type RunOptions } from "@/lib/ai/evals/run";
import { PROVIDERS } from "@/lib/ai/providers";

const RESULTS_DIR = path.join("src", "lib", "ai", "evals", "results");
const KEY_VARIABLE = "AGENT_EVAL_API_KEY";

const USAGE = `Usage: npm run agent:eval -- --provider <name> [options]

  --provider <name>   reference (replays each case's reference answer: checks the cases, not a model),
                      or a provider: ${Object.keys(PROVIDERS)
                        .filter((name) => !PROVIDERS[name].testOnly)
                        .join(", ")}
  --model <id>        The model to run; the provider's default when left out.
  --case <id>         Only this case; repeat for more.
  --ability <name>    Only this ability's cases; repeat for more. One of: ${ABILITIES.join(", ")}.
  --dry-run           Print the results without saving them.
  --list              List the cases and stop.

Live providers read their key from ${KEY_VARIABLE}, set for this terminal only. In PowerShell, a
masked prompt keeps the key off the screen and out of the history file:
  $env:${KEY_VARIABLE} = [System.Net.NetworkCredential]::new("", (Read-Host "Paste the key" -AsSecureString)).Password
Clear it once the run is saved: Remove-Item Env:${KEY_VARIABLE}
Use a key made for evaluations: for Gemini, one from a separate Google project.`;

function fail(message: string): never {
  console.error(`${message}\n\n${USAGE}`);
  process.exit(2);
}

function selectCases(all: EvalCase[], ids: string[], abilities: string[]) {
  for (const id of ids) if (!all.some((found) => found.id === id)) fail(`There is no case named ${id}. Run with --list to see them.`);
  for (const ability of abilities) if (!(ABILITIES as readonly string[]).includes(ability)) fail(`There is no ability named ${ability}.`);
  return all.filter((found) => (!ids.length || ids.includes(found.id)) && (!abilities.length || abilities.includes(found.ability)));
}

function gitCommit() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

async function main() {
  let values;
  try {
    ({ values } = parseArgs({
      options: {
        provider: { type: "string" },
        model: { type: "string" },
        case: { type: "string", multiple: true },
        ability: { type: "string", multiple: true },
        "dry-run": { type: "boolean", default: false },
        list: { type: "boolean", default: false },
        help: { type: "boolean", default: false },
      },
      strict: true,
    }));
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
  if (values.help) {
    console.log(USAGE);
    return;
  }

  const cases = selectCases(loadCases(), values.case ?? [], values.ability ?? []);
  if (values.list) {
    for (const found of cases) console.log(`${found.id.padEnd(32)} ${found.summary}`);
    console.log(`\n${cases.length} cases.`);
    return;
  }

  const providerName = values.provider?.trim().toLowerCase();
  if (!providerName) fail("Say which provider to run with --provider.");
  let options: RunOptions;
  let model: string;
  if (providerName === "reference") {
    model = "reference";
    options = { model, providerFor: createReferenceProvider };
  } else {
    const spec = Object.hasOwn(PROVIDERS, providerName) ? PROVIDERS[providerName] : undefined;
    if (!spec || spec.testOnly) fail(`There is no provider named ${providerName}.`);
    const key = process.env[KEY_VARIABLE]?.trim();
    if (!key) fail(`Set ${KEY_VARIABLE} to a ${providerName} key for this terminal session first.`);
    // Only the key goes in: never the app's own environment, whatever it holds.
    const provider = spec.create(spec.apiKeyEnv ? { [spec.apiKeyEnv]: key } : {});
    model = values.model?.trim() || spec.defaultModel;
    const pace = modelInfo(providerName, model)?.pace ?? UNKNOWN_PACE;
    options = { model, providerFor: () => provider, pacer: createPacer(pace) };
  }
  const info = modelInfo(providerName, model);

  console.log(`Running ${cases.length} cases with ${providerName} / ${model}.\n`);
  const ranAt = new Date();
  const results = await runCases(cases, options, (result) => console.log(formatCaseResult(result)));
  const summary = summarize(results, info);
  console.log(formatSummary(summary, { provider: providerName, model, info }));

  if (providerName === "reference") {
    console.log("\nThese were the reference answers, replayed: every case should pass. Their token counts are estimates (about 4 characters a token), close to what a live run sends.");
    if (summary.passed !== summary.cases) process.exitCode = 1;
    return;
  }
  if (summary.errors.length) process.exitCode = 1;
  if (values["dry-run"]) return;

  const file = path.join(RESULTS_DIR, unusedFileName(resultFileName(ranAt, model), (name) => existsSync(path.join(RESULTS_DIR, name))));
  mkdirSync(RESULTS_DIR, { recursive: true });
  const saved = {
    version: 1,
    ranAt: ranAt.toISOString(),
    provider: providerName,
    model,
    commit: gitCommit(),
    cases: cases.length === loadCases().length ? "all" : cases.map((found) => found.id),
    pricing: info,
    summary,
    results: results.map((result) => ({ ...result, costUsd: costUsd(result, info?.price ?? null) })),
  };
  writeFileSync(file, `${JSON.stringify(saved, null, 2)}\n`);
  console.log(`\nSaved ${file.replaceAll("\\", "/")}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
