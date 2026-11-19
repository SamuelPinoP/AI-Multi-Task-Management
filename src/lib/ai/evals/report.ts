// A run's numbers (#311): the score, what a message costs at list prices, how
// long the model took, and how many messages a day a free plan would allow at
// the run's average use. Printed by the CLI and saved with the run's results.
import type { CaseResult } from "@/lib/ai/evals/run";
import { costUsd, type ModelInfo } from "@/lib/ai/evals/pricing";

export type RunSummary = {
  cases: number;
  /** Cases whose provider didn't fail for its own reasons (a quota, an outage). */
  scored: number;
  passed: number;
  /** Passed cases as a share of the scored ones, from 0 to 1. */
  score: number;
  byAbility: Array<{ ability: string; scored: number; passed: number }>;
  failed: string[];
  skipped: string[];
  /** Cases where something in AI Multi failed. */
  errors: string[];
  /** Cases where a model was asked at all: caps and the person's country send the rest to the planner. */
  messages: number;
  modelRequests: number;
  retries: number;
  inputTokens: number;
  outputTokens: number;
  /** At list prices, in US dollars; null without a price. */
  costUsd: number | null;
  costPerMessageUsd: number | null;
  requestsPerMessage: number;
  tokensPerMessage: number;
  /** The model's time per message, waits for rate limits left out. */
  modelTimeMs: { median: number; p95: number; max: number };
  /** Messages a day the free plan allows at the run's average use, and the limit that decides it. */
  freePlanMessagesPerDay: { messages: number; limitedBy: string } | null;
};

function percentile(sorted: number[], share: number) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(share * sorted.length) - 1))];
}

export function summarize(results: CaseResult[], info: ModelInfo | null): RunSummary {
  const scored = results.filter((result) => result.skipped === null);
  const asked = results.filter((result) => result.modelRequests > 0);
  const total = (pick: (result: CaseResult) => number, from = results) => from.reduce((sum, result) => sum + pick(result), 0);
  const inputTokens = total((result) => result.inputTokens);
  const outputTokens = total((result) => result.outputTokens);
  const modelRequests = total((result) => result.modelRequests);
  const cost = costUsd({ inputTokens, outputTokens }, info?.price ?? null);
  const times = asked.map((result) => result.modelTimeMs).sort((a, b) => a - b);
  const requestsPerMessage = asked.length ? modelRequests / asked.length : 0;
  const tokensPerMessage = asked.length ? (inputTokens + outputTokens) / asked.length : 0;

  let freePlanMessagesPerDay: RunSummary["freePlanMessagesPerDay"] = null;
  const plan = info?.freePlan;
  if (plan && asked.length) {
    const limits = [
      plan.requestsPerDay && requestsPerMessage ? { messages: plan.requestsPerDay / requestsPerMessage, limitedBy: `${plan.requestsPerDay.toLocaleString("en-US")} requests a day` } : null,
      plan.tokensPerDay && tokensPerMessage ? { messages: plan.tokensPerDay / tokensPerMessage, limitedBy: `${plan.tokensPerDay.toLocaleString("en-US")} tokens a day` } : null,
    ].filter((limit) => limit !== null);
    const tightest = limits.sort((a, b) => a.messages - b.messages)[0];
    if (tightest) freePlanMessagesPerDay = { messages: Math.floor(tightest.messages), limitedBy: tightest.limitedBy };
  }

  const abilities = [...new Set(results.map((result) => result.ability))];
  return {
    cases: results.length,
    scored: scored.length,
    passed: scored.filter((result) => result.passed).length,
    score: scored.length ? scored.filter((result) => result.passed).length / scored.length : 0,
    byAbility: abilities.map((ability) => {
      const ofAbility = scored.filter((result) => result.ability === ability);
      return { ability, scored: ofAbility.length, passed: ofAbility.filter((result) => result.passed).length };
    }),
    failed: scored.filter((result) => !result.passed).map((result) => result.id),
    skipped: results.filter((result) => result.skipped !== null).map((result) => result.id),
    errors: results.filter((result) => result.error !== null).map((result) => result.id),
    messages: asked.length,
    modelRequests,
    retries: total((result) => result.retries),
    inputTokens,
    outputTokens,
    costUsd: cost,
    costPerMessageUsd: cost !== null && asked.length ? cost / asked.length : null,
    requestsPerMessage,
    tokensPerMessage,
    modelTimeMs: { median: percentile(times, 0.5), p95: percentile(times, 0.95), max: times.at(-1) ?? 0 },
    freePlanMessagesPerDay,
  };
}

function seconds(ms: number) {
  return `${(ms / 1000).toFixed(1)} s`;
}

function dollars(value: number) {
  return value >= 0.01 ? `$${value.toFixed(2)}` : `$${value.toFixed(6)}`;
}

/** One line per case as it ends, and the failed checks under it. */
export function formatCaseResult(result: CaseResult) {
  const status = result.skipped ? "SKIP" : result.passed ? "PASS" : "FAIL";
  const calls = result.toolCalls.length ? result.toolCalls.map((call) => call.name).join(", ") : "no tools";
  const lines = [
    `${status}  ${result.id.padEnd(32)} ${result.outcome.padEnd(15)} ${String(result.modelRequests).padStart(1)} req  ${seconds(result.modelTimeMs).padStart(7)}  ${calls}`,
  ];
  if (result.skipped) lines.push(`      ${result.skipped}`);
  if (result.error) lines.push(`      Error in AI Multi: ${result.error}`);
  if (result.refused) lines.push(`      The provider refused a request: ${result.refused}`);
  for (const check of result.checks.filter((found) => !found.passed)) lines.push(`      x ${check.name}${check.detail ? `: ${check.detail}` : ""}`);
  if (!result.passed && !result.skipped) lines.push(`      Answer: ${JSON.stringify(result.answer.slice(0, 400))}`);
  return lines.join("\n");
}

export function formatSummary(summary: RunSummary, { provider, model, info }: { provider: string; model: string; info: ModelInfo | null }) {
  const percent = Math.round(summary.score * 100);
  const lines = [
    "",
    `${provider} / ${model}: ${summary.passed} of ${summary.scored} cases passed (${percent}%)${summary.skipped.length ? `, ${summary.skipped.length} not scored` : ""}`,
    `  By ability: ${summary.byAbility.map((row) => `${row.ability} ${row.passed}/${row.scored}`).join(", ")}`,
  ];
  if (summary.failed.length) lines.push(`  Failed: ${summary.failed.join(", ")}`);
  if (summary.skipped.length) lines.push(`  Not scored (the provider failed): ${summary.skipped.join(", ")}`);
  if (summary.errors.length) lines.push(`  Errors in AI Multi: ${summary.errors.join(", ")}`);
  lines.push(
    `  Tokens: ${summary.inputTokens.toLocaleString("en-US")} in, ${summary.outputTokens.toLocaleString("en-US")} out, over ${summary.modelRequests} model requests${summary.retries ? ` (${summary.retries} retried after a rate limit or an outage)` : ""}`,
    `  Per message (${summary.messages} asked a model): ${summary.requestsPerMessage.toFixed(2)} requests, ${Math.round(summary.tokensPerMessage).toLocaleString("en-US")} tokens`,
  );
  if (summary.costUsd !== null && summary.costPerMessageUsd !== null) {
    lines.push(
      `  Cost at list prices: ${dollars(summary.costPerMessageUsd)} a message, ${dollars(summary.costPerMessageUsd * 1000)} per 1,000 messages (${dollars(summary.costUsd)} for this run)`,
    );
  }
  lines.push(`  Model time per message: median ${seconds(summary.modelTimeMs.median)}, 95th percentile ${seconds(summary.modelTimeMs.p95)}, slowest ${seconds(summary.modelTimeMs.max)}`);
  if (summary.freePlanMessagesPerDay) {
    lines.push(`  Free plan: about ${summary.freePlanMessagesPerDay.messages.toLocaleString("en-US")} messages a day, limited by ${summary.freePlanMessagesPerDay.limitedBy}`);
  }
  if (info) lines.push(`  Prices and limits checked ${info.checked}: ${info.sources.join(", ")}`);
  return lines.join("\n");
}

/** results/2026-11-19-openai-gpt-oss-120b.json */
export function resultFileName(ranAt: Date, model: string) {
  const slug = model
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${ranAt.toISOString().slice(0, 10)}-${slug}.json`;
}

/** The name, or the first free one of name-2.json, name-3.json…: a run never overwrites an earlier one's results. */
export function unusedFileName(fileName: string, exists: (name: string) => boolean) {
  if (!exists(fileName)) return fileName;
  const dot = fileName.lastIndexOf(".");
  for (let copy = 2; ; copy += 1) {
    const candidate = `${fileName.slice(0, dot)}-${copy}${fileName.slice(dot)}`;
    if (!exists(candidate)) return candidate;
  }
}
