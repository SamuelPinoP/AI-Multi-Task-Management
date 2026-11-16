// One message to the AI assistant, from request to usage record (#307): check
// the daily caps, run the agent loop, and fall back to the rule-based planner
// (saying why) when no model can answer. Everything it touches comes in as a
// dependency, so the whole flow is unit tested with a fake provider; the
// server wiring is in ./server.ts and the route in src/app/api/agent/chat.
import { z } from "zod";
import type { AgentRunOutcome } from "@prisma/client";
import { runAgentLoop, type AgentLimits, type LoopEvent, type LoopResult } from "@/lib/ai/agent-loop";
import { allowanceFor, exhaustedCap, type Allowance } from "@/lib/ai/allowance";
import type { AgentConfig } from "@/lib/ai/config";
import { fallbackMessage, type FallbackReason } from "@/lib/ai/fallback";
import { systemPrompt } from "@/lib/ai/prompt";
import { regionAllowed } from "@/lib/ai/region";
import type { AgentTool, Source, ToolContext } from "@/lib/ai/tools/define";
import type { AgentMessage, Provider, ProviderError } from "@/lib/ai/types";

export const MAX_MESSAGE_CHARS = 4000;
/** Messages one request may carry: the chat panel keeps the conversation while it's open (#308). */
export const MAX_MESSAGES = 40;
/** How many of the latest messages the model sees. Older ones stay here: less data sent, fewer tokens. */
export const MODEL_HISTORY = 12;

export const chatRequestSchema = z.strictObject({
  messages: z
    .array(
      z.strictObject({
        role: z.enum(["user", "assistant"]),
        content: z
          .string()
          .trim()
          .min(1, "Messages can't be empty.")
          .max(MAX_MESSAGE_CHARS, `Keep each message under ${MAX_MESSAGE_CHARS.toLocaleString("en-US")} characters.`),
      }),
    )
    .min(1, "Send a message.")
    .max(MAX_MESSAGES, `Start a new chat: one can hold up to ${MAX_MESSAGES} messages.`)
    .refine((messages) => messages.at(-1)?.role === "user", "The last message must be yours."),
});

export type ChatRequest = z.infer<typeof chatRequestSchema>;

export function parseChatRequest(body: unknown): { request: ChatRequest } | { error: string } {
  const parsed = chatRequestSchema.safeParse(body);
  return parsed.success ? { request: parsed.data } : { error: parsed.error.issues[0]?.message ?? "Invalid request." };
}

/**
 * The answer's stream, one JSON object per line (application/x-ndjson):
 * - `start` first: whether a model or the planner answers (and why), and today's allowance;
 * - `tool` and `sources` while the model looks things up (the panel links the sources, #308);
 * - `text` pieces of the answer;
 * - `notice` when the model fails midway and the planner takes over;
 * - `error` when something in AI Multi failed;
 * - `done` last, with the outcome and the allowance after this message.
 */
export type ChatEvent =
  | { type: "start"; mode: "agent"; model: string; allowance: Allowance }
  | { type: "start"; mode: "planner"; reason: FallbackReason; message: string; allowance: Allowance }
  | LoopEvent
  | { type: "notice"; reason: FallbackReason; message: string }
  | { type: "error"; message: string }
  | { type: "done"; outcome: AgentRunOutcome; allowance: Allowance | null };

/** The usage log's row for this message (the AgentRun table), less who and when. */
export type RunRecord = {
  provider: string | null;
  model: string | null;
  outcome: AgentRunOutcome;
  modelRequests: number;
  toolCalls: string[];
  validationFailures: number;
  inputTokens: number;
  outputTokens: number;
};

export type ChatDependencies = {
  config: AgentConfig;
  /** Null when the assistant is off (see AgentConfig.disabledReason). */
  provider: Provider | null;
  tools: AgentTool[];
  context: ToolContext;
  /** Where the request comes from (Vercel's `x-vercel-ip-country`), for the free tier's regions (region.ts). */
  country: string | null;
  /** Model requests counted today (see allowance.ts): the person's, and everyone's. */
  usedToday(): Promise<{ user: number; app: number }>;
  /** The rule-based planner's answer. */
  planner(): Promise<{ text: string; sources: Source[] }>;
  /** Aborted when the person goes away. */
  signal: AbortSignal;
  limits?: AgentLimits;
};

export type ChatResult = {
  record: RunRecord;
  /** For the server log. */
  providerError?: ProviderError;
  failure?: unknown;
};

const LOOP_OUTCOMES: Record<Exclude<LoopResult["outcome"], "provider_error">, AgentRunOutcome> = {
  answered: "ANSWERED",
  step_limit: "STEP_LIMIT",
  invalid_arguments: "INVALID_ARGUMENTS",
  timed_out: "TIMED_OUT",
  cancelled: "CANCELLED",
};

/** What the person is told when the model couldn't finish, or null when nothing more is needed. */
function fallbackFor(loop: LoopResult): FallbackReason | null {
  if (loop.outcome === "timed_out") return "timeout";
  if (loop.outcome !== "provider_error" || !loop.error) return null;
  if (loop.error.kind === "rate_limited") return "rate_limited";
  return loop.error.kind === "timeout" ? "timeout" : "unavailable";
}

/** The latest messages, starting with one of the person's, as every provider expects. */
export function modelMessages(request: ChatRequest): AgentMessage[] {
  const messages = request.messages.slice(-MODEL_HISTORY);
  while (messages[0]?.role === "assistant") messages.shift();
  return messages.map((message) => ({ role: message.role, content: message.content }));
}

export async function runAgentChat(
  request: ChatRequest,
  deps: ChatDependencies,
  emit: (event: ChatEvent) => void,
): Promise<ChatResult> {
  const { config, provider, context } = deps;
  const now = context.realNow;
  const record: RunRecord = {
    provider: null,
    model: null,
    outcome: "FAILED",
    modelRequests: 0,
    toolCalls: [],
    validationFailures: 0,
    inputTokens: 0,
    outputTokens: 0,
  };
  let allowance: Allowance | null = null;

  const answerWithPlanner = async () => {
    const answer = await deps.planner();
    if (answer.sources.length) emit({ type: "sources", items: answer.sources });
    emit({ type: "text", text: answer.text });
  };

  try {
    allowance = allowanceFor(await deps.usedToday(), config.caps, now);
    const cap = exhaustedCap(allowance);
    const blocked = !regionAllowed(deps.country, config.freeTier);
    if (!provider || config.disabledReason || blocked || cap) {
      const reason: FallbackReason =
        !provider || config.disabledReason ? "disabled" : blocked ? "region" : cap === "user" ? "user_limit" : "app_limit";
      const outcomes: Record<string, AgentRunOutcome> = { disabled: "DISABLED", region: "REGION", user_limit: "USER_LIMIT", app_limit: "APP_LIMIT" };
      record.outcome = outcomes[reason];
      emit({ type: "start", mode: "planner", reason, message: fallbackMessage(reason, allowance, now), allowance });
      await answerWithPlanner();
      emit({ type: "done", outcome: record.outcome, allowance });
      return { record };
    }

    record.provider = provider.name;
    record.model = config.model;
    emit({ type: "start", mode: "agent", model: config.model, allowance });
    const loop = await runAgentLoop({
      provider,
      model: config.model,
      system: systemPrompt({ realNow: now, timeZone: context.timeZone }),
      messages: modelMessages(request),
      tools: deps.tools,
      context,
      signal: deps.signal,
      limits: deps.limits,
      emit,
    });
    record.modelRequests = loop.modelRequests;
    record.toolCalls = loop.toolCalls;
    record.validationFailures = loop.validationFailures;
    record.inputTokens = loop.usage.inputTokens;
    record.outputTokens = loop.usage.outputTokens;
    record.outcome =
      loop.outcome === "provider_error" ? (loop.error?.kind === "rate_limited" ? "RATE_LIMITED" : "PROVIDER_ERROR") : LOOP_OUTCOMES[loop.outcome];

    // A message that started within the allowance finishes, so the count can pass the cap by a few requests.
    allowance = allowanceFor(
      { user: allowance.user.used + loop.modelRequests, app: allowance.app.used + loop.modelRequests },
      config.caps,
      now,
    );
    const fallback = fallbackFor(loop);
    if (fallback) {
      emit({ type: "notice", reason: fallback, message: fallbackMessage(fallback, allowance, now) });
      await answerWithPlanner();
    }
    emit({ type: "done", outcome: record.outcome, allowance });
    return { record, providerError: loop.error };
  } catch (failure) {
    record.outcome = "FAILED";
    emit({ type: "error", message: "Something went wrong on our side. Try again in a moment." });
    emit({ type: "done", outcome: "FAILED", allowance });
    return { record, failure };
  }
}
