// Runs evaluation cases (#311) through the real chat flow: runAgentChat with
// its caps, fallbacks and agent loop, the real tools, and the sample workspace
// in memory. Only the model and the planner are stand-ins: the model is a live
// provider or a case's reference answer, and the planner (which reads Postgres
// in the app) builds its answer from the same workspace.
//
// For live runs, requests are paced under the free plan's per-minute limits
// and a 429 is retried after a wait, so a run measures the model rather than
// the quota. Those waits don't count toward the 30-second deadline: the loop
// gets a longer one here, and the scorer checks the time the model itself took.
import type { AgentRunOutcome } from "@prisma/client";
import { AGENT_LIMITS } from "@/lib/ai/agent-loop";
import { runAgentChat } from "@/lib/ai/chat";
import { applyChatEvent, emptyAnswer, type ChatAnswer } from "@/lib/ai/chat-client";
import { DEFAULT_APP_DAILY_REQUESTS, DEFAULT_USER_DAILY_REQUESTS, type AgentConfig } from "@/lib/ai/config";
import type { Ability, EvalCase } from "@/lib/ai/evals/case";
import { createMemoryDb } from "@/lib/ai/evals/memory-db";
import { scoreCase, type Check, type ObservedCall } from "@/lib/ai/evals/score";
import { loadWorkspace, type Workspace } from "@/lib/ai/evals/workspace";
import { plannerAnswer } from "@/lib/ai/fallback";
import { PROPOSAL_TTL_MS, type ProposalDraft, type ProposalStep } from "@/lib/ai/proposals";
import { createScriptedProvider } from "@/lib/ai/providers/fake";
import { AGENT_TOOLS } from "@/lib/ai/tools";
import type { AgentTool, ToolContext } from "@/lib/ai/tools/define";
import { listOpenTasks } from "@/lib/ai/tools/read-tools";
import { ProviderError, type Provider, type ProviderErrorKind, type ProviderEvent, type ProviderRequest } from "@/lib/ai/types";
import type { PlannerPriority, PlannerSection, PlannerSuggestion } from "@/lib/smart-planner";
import { toWallClock } from "@/lib/user-time";

/** The loop's deadline in a run: room for the pacing waits. The scorer holds the model to AGENT_LIMITS'. */
export const RUN_DEADLINE_MS = 5 * 60_000;
/** Waits before retrying a request the provider refused for its rate limit or an outage. */
export const RETRY_DELAYS_MS = [15_000, 30_000, 60_000];
const RETRIED_KINDS = new Set<ProviderErrorKind>(["rate_limited", "unavailable"]);
const INJECTED_STATUS: Record<"rate_limited" | "unavailable" | "timeout", number> = { rate_limited: 429, unavailable: 503, timeout: 504 };

export type RunClock = { now(): number; sleep(ms: number): Promise<void> };

export const SYSTEM_CLOCK: RunClock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/** One model request as the run saw it. */
export type RequestRecord = {
  /** A failure the case asked for (setup.failure), not one from the provider. */
  injected: boolean;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  error?: string;
  errorKind?: ProviderErrorKind;
  /** The provider's HTTP status when it answered with an error; none for an error midway through its stream. */
  status?: number;
  /** Refused for a rate limit or an outage, and sent again after a wait. */
  retried?: boolean;
};

/** About 4 characters a token, the usual rule of thumb: enough to pace requests and size a run. */
export function estimateTokens(request: Pick<ProviderRequest, "system" | "messages" | "tools">) {
  return Math.ceil((request.system.length + JSON.stringify(request.messages).length + JSON.stringify(request.tools).length) / 4);
}

export type PaceLimits = { requestsPerMinute?: number; tokensPerMinute?: number };

export type Pacer = {
  /** Waits until a request of about `tokens` tokens fits in the last minute's limits; call the result with the real count. */
  reserve(tokens: number): Promise<(actualTokens: number) => void>;
};

/** Keeps a run under per-minute limits, counting the requests and tokens of the last 60 seconds. */
export function createPacer(limits: PaceLimits, clock: RunClock = SYSTEM_CLOCK): Pacer {
  const MINUTE = 60_000;
  const window: Array<{ at: number; tokens: number }> = [];
  return {
    async reserve(tokens) {
      while (true) {
        const now = clock.now();
        while (window.length && window[0].at <= now - MINUTE) window.shift();
        const used = window.reduce((sum, entry) => sum + entry.tokens, 0);
        const tooMany = limits.requestsPerMinute !== undefined && window.length >= limits.requestsPerMinute;
        // A request bigger than the whole limit goes alone, once the minute is clear.
        const tooBig = limits.tokensPerMinute !== undefined && window.length > 0 && used + tokens > limits.tokensPerMinute;
        if (!tooMany && !tooBig) break;
        await clock.sleep(window[0].at + MINUTE - now + 100);
      }
      const entry = { at: clock.now(), tokens };
      window.push(entry);
      return (actualTokens) => {
        if (actualTokens > 0) entry.tokens = actualTokens;
      };
    },
  };
}

/**
 * The provider as a run uses it: fails where the case says to, paces and retries live requests,
 * and records every request's time and tokens.
 */
export function instrumentProvider(
  inner: Provider,
  {
    records,
    calls,
    failure,
    pacer,
    clock = SYSTEM_CLOCK,
  }: {
    records: RequestRecord[];
    /** Every tool call the model asks for, as it wrote it. */
    calls?: ObservedCall[];
    failure?: EvalCase["setup"]["failure"];
    pacer?: Pacer;
    clock?: RunClock;
  },
): Provider {
  let requests = 0;
  return {
    name: inner.name,
    async *stream(request): AsyncGenerator<ProviderEvent> {
      requests += 1;
      if (failure && failure.onRequest === requests) {
        records.push({ injected: true, latencyMs: 0, inputTokens: 0, outputTokens: 0, error: `The case's ${failure.kind} failure`, errorKind: failure.kind });
        throw new ProviderError(failure.kind, `Failed on purpose for an evaluation case: ${failure.kind}`, INJECTED_STATUS[failure.kind]);
      }
      for (let attempt = 0; ; attempt += 1) {
        const settle = pacer ? await pacer.reserve(estimateTokens(request) + 300) : undefined;
        const record: RequestRecord = { injected: false, latencyMs: 0, inputTokens: 0, outputTokens: 0 };
        records.push(record);
        const started = clock.now();
        let streamed = false;
        try {
          for await (const event of inner.stream(request)) {
            if (event.type === "tool_call") calls?.push({ name: event.call.name, args: event.call.args });
            if (event.type === "finish") {
              record.inputTokens = event.usage.inputTokens;
              record.outputTokens = event.usage.outputTokens;
            }
            streamed = true;
            yield event;
          }
          record.latencyMs = clock.now() - started;
          settle?.(record.inputTokens + record.outputTokens);
          return;
        } catch (error) {
          record.latencyMs = clock.now() - started;
          settle?.(record.inputTokens + record.outputTokens);
          record.error = error instanceof Error ? error.message : String(error);
          if (error instanceof ProviderError) {
            record.errorKind = error.kind;
            record.status = error.status;
          }
          // Only a live run retries, and only before anything reached the agent.
          const retry =
            pacer !== undefined &&
            !streamed &&
            !request.signal.aborted &&
            error instanceof ProviderError &&
            RETRIED_KINDS.has(error.kind) &&
            attempt < RETRY_DELAYS_MS.length;
          if (!retry) throw error;
          record.retried = true;
          await clock.sleep(RETRY_DELAYS_MS[attempt]);
        }
      }
    },
  };
}

/** A case's reference answer as a provider, with token counts estimated from each request's size. */
export function createReferenceProvider(evalCase: EvalCase): Provider & { requests: ProviderRequest[] } {
  const scripted = createScriptedProvider(
    evalCase.reference.map((turn) => ({ text: turn.text, toolCalls: turn.toolCalls })),
    "reference",
  );
  return {
    name: "reference",
    requests: scripted.requests,
    async *stream(request): AsyncGenerator<ProviderEvent> {
      let output = 0;
      for await (const event of scripted.stream(request)) {
        if (event.type === "finish") {
          yield { ...event, usage: { inputTokens: estimateTokens(request), outputTokens: output } };
          continue;
        }
        output += Math.ceil((event.type === "text" ? event.text.length : JSON.stringify(event.call).length) / 4);
        yield event;
      }
    },
  };
}

type PlannerTask = { id: string; title: string; priority?: string; when?: string };

function plannerPriority(priority: string | undefined): PlannerPriority {
  if (priority === "URGENT" || priority === "HIGH") return "HIGH";
  return priority === "MEDIUM" ? "MEDIUM" : "LOW";
}

/**
 * The planner's answer on the sample workspace. The app's planner (src/lib/smart-planner.ts) reads
 * Postgres; this one builds the same kind of answer from the open-tasks tool: overdue first, then
 * due today, then the coming week.
 */
export async function samplePlannerAnswer(context: ToolContext) {
  const lookup = async (due: "overdue" | "today" | "next_7_days") => ((await listOpenTasks.run({ due }, context)).data as { tasks: PlannerTask[] }).tasks;
  const overdue = await lookup("overdue");
  const today = await lookup("today");
  const week = await lookup("next_7_days");
  const suggestion = (task: PlannerTask, reason: string): PlannerSuggestion => ({
    id: `task:${task.id}`,
    title: task.title,
    reason,
    priority: plannerPriority(task.priority),
    kind: "TASK",
    related: { type: "TASK", id: task.id, label: task.title },
    actionHref: `/tasks?task=${encodeURIComponent(task.id)}`,
    canCreateTask: false,
  });
  const section = (key: PlannerSection["key"], suggestions: PlannerSuggestion[]): PlannerSection => ({ key, title: key, description: "", suggestions });
  return plannerAnswer({
    sections: [
      section("urgent", overdue.map((task) => suggestion(task, `Overdue, ${task.when?.toLowerCase()}`))),
      section("dueToday", today.map((task) => suggestion(task, "Due today"))),
      section(
        "upcoming",
        week.filter((task) => task.when !== "Today").map((task) => suggestion(task, `Due ${task.when === "Tomorrow" ? "tomorrow" : task.when}`)),
      ),
    ],
  });
}

export type RunOptions = {
  /** The model under test for a case: a live provider, or the case's reference answer. */
  providerFor(evalCase: EvalCase): Provider;
  model: string;
  /** Paces a live provider under its free plan's limits. Leave out for replays. */
  pacer?: Pacer;
  clock?: RunClock;
};

export type CaseResult = {
  id: string;
  ability: Ability;
  summary: string;
  request: string;
  passed: boolean;
  /**
   * Why the case wasn't scored: the provider itself failed (its quota, an outage) rather than the
   * model answering badly. Null when it was scored.
   */
  skipped: string | null;
  checks: Check[];
  answer: string;
  outcome: AgentRunOutcome;
  toolCalls: ObservedCall[];
  modelRequests: number;
  retries: number;
  inputTokens: number;
  outputTokens: number;
  modelTimeMs: number;
  /** The changes the answer proposed (#310); never applied in a run. */
  proposal: ProposalStep[];
  /** Something in AI Multi failed: a bug to fix, not a score. */
  error: string | null;
  /**
   * The provider refused a request (a bad key, model or request) or the model's answer (a tool call
   * that failed its schema check), in its words. The case is still scored.
   */
  refused: string | null;
};

const workspaces = new Map<string, Workspace>();

function workspaceFor(name: string) {
  let workspace = workspaces.get(name);
  if (!workspace) {
    workspace = loadWorkspace(name);
    workspaces.set(name, workspace);
  }
  return workspace;
}

export async function runCase(evalCase: EvalCase, options: RunOptions): Promise<CaseResult> {
  return (await runCaseAndRecords(evalCase, options)).result;
}

async function runCaseAndRecords(evalCase: EvalCase, options: RunOptions): Promise<{ result: CaseResult; records: RequestRecord[] }> {
  const workspace = workspaceFor(evalCase.workspace);
  const clock = evalCase.clock ?? workspace.clock;
  const realNow = new Date(clock.now);
  const context: ToolContext = {
    userId: workspace.person,
    now: toWallClock(clock.timeZone, realNow),
    realNow,
    timeZone: clock.timeZone,
    db: createMemoryDb(workspace.tables),
  };

  // The real tools, recording what ran with the arguments as validated. They also hand over the
  // answer's draft of changes (#310), kept here even when the answer ends without a proposal, so
  // the scorer can read a call's ref to a new item ("new-1") as that item's name (#548).
  const executedCalls: ObservedCall[] = [];
  const answerDraft: { current?: ProposalDraft } = {};
  const tools = AGENT_TOOLS.map(
    (tool): AgentTool => ({
      ...tool,
      async run(args, toolContext) {
        executedCalls.push({ name: tool.name, args });
        answerDraft.current ??= toolContext.draft;
        return tool.run(args, toolContext);
      },
    }),
  );
  const records: RequestRecord[] = [];
  const attemptedCalls: ObservedCall[] = [];
  const inner = options.providerFor(evalCase);
  const provider = instrumentProvider(inner, { records, calls: attemptedCalls, failure: evalCase.setup.failure, pacer: options.pacer, clock: options.clock });
  const config: AgentConfig = {
    provider: inner.name,
    model: options.model,
    caps: { userDailyRequests: DEFAULT_USER_DAILY_REQUESTS, appDailyRequests: DEFAULT_APP_DAILY_REQUESTS },
    freeTier: true,
    disabledReason: null,
  };

  // The workspace as it was, to check that nothing changed: proposals are only stored, never applied (#310).
  const before = JSON.stringify(workspace.tables);
  let answer: ChatAnswer = emptyAnswer();
  const result = await runAgentChat(
    { question: evalCase.request, history: evalCase.history },
    {
      config,
      provider,
      tools,
      context,
      country: evalCase.setup.country ?? "US",
      usedToday: async () => evalCase.setup.usedToday ?? { user: 0, app: 0 },
      planner: () => samplePlannerAnswer(context),
      signal: new AbortController().signal,
      limits: { ...AGENT_LIMITS, deadlineMs: RUN_DEADLINE_MS },
      save: async () => null,
      propose: async () => ({ id: `proposal-${evalCase.id}`, expiresAt: new Date(realNow.getTime() + PROPOSAL_TTL_MS) }),
    },
    (event) => {
      answer = applyChatEvent(answer, event);
    },
  );

  const answered = records.filter((record) => !record.injected && !record.error);
  const refused = records.find((record) => !record.injected && record.errorKind === "rejected");
  const lastRecord = records.at(-1);
  const skipped =
    lastRecord && !lastRecord.injected && lastRecord.errorKind && lastRecord.errorKind !== "rejected" ? `The provider failed: ${lastRecord.error}` : null;
  const observed = {
    outcome: result.record.outcome,
    answer: answer.text,
    attemptedCalls,
    executedCalls,
    modelRequests: result.record.modelRequests,
    modelTimeMs: records.filter((record) => !record.injected).reduce((sum, record) => sum + record.latencyMs, 0),
    proposal: answer.proposal?.steps ?? [],
    drafted: answerDraft.current?.steps ?? [],
    workspaceChanged: JSON.stringify(workspace.tables) !== before,
  };
  const checks = scoreCase(evalCase, observed, workspace);
  const caseResult: CaseResult = {
    id: evalCase.id,
    ability: evalCase.ability,
    summary: evalCase.summary,
    request: evalCase.request,
    passed: checks.every((check) => check.passed),
    skipped,
    checks,
    answer: answer.text,
    outcome: result.record.outcome,
    toolCalls: attemptedCalls,
    modelRequests: result.record.modelRequests,
    retries: records.filter((record) => record.retried).length,
    inputTokens: answered.reduce((sum, record) => sum + record.inputTokens, 0),
    outputTokens: answered.reduce((sum, record) => sum + record.outputTokens, 0),
    modelTimeMs: observed.modelTimeMs,
    proposal: observed.proposal,
    error: result.failure ? (result.failure instanceof Error ? `${result.failure.name}: ${result.failure.message}` : String(result.failure)) : null,
    refused: refused ? (refused.error ?? "refused") : null,
  };
  return { result: caseResult, records };
}

/**
 * Runs cases one after another (a free plan's limits allow little else), reporting each as it ends.
 * Stops when the provider refuses a request with an error status before it has answered any: a
 * wrong key or model name would fail every case alike, and that's no score. A refusal midway
 * through a stream, such as Groq refusing a tool call that doesn't match its schema, is about one
 * answer, so the run goes on.
 */
export async function runCases(cases: EvalCase[], options: RunOptions, onResult?: (result: CaseResult, index: number) => void) {
  const results: CaseResult[] = [];
  let answeredOnce = false;
  for (const [index, evalCase] of cases.entries()) {
    const { result, records } = await runCaseAndRecords(evalCase, options);
    results.push(result);
    onResult?.(result, index);
    if (result.inputTokens > 0) answeredOnce = true;
    const refusedRequest = records.find((record) => !record.injected && record.errorKind === "rejected" && record.status !== undefined);
    if (refusedRequest && !answeredOnce) {
      throw new Error(
        `The provider refused a request before answering any, so the run stopped. Check the key and the model's name. It said: ${refusedRequest.error ?? "refused"}`,
      );
    }
  }
  return results;
}
