// One message to the AI assistant, from request to usage record (#307): check
// the daily caps, run the agent loop, and fall back to the rule-based planner
// (saying why) when no model can answer. Then store the question and its answer
// in the person's chat history (#452). Everything it touches comes in as a
// dependency, so the whole flow is unit tested with a fake provider; the
// server wiring is in ./server.ts and the route in src/app/api/agent/chat.
import { z } from "zod";
import type { AgentRunOutcome } from "@prisma/client";
import { runAgentLoop, type AgentLimits, type LoopEvent, type LoopResult } from "@/lib/ai/agent-loop";
import { allowanceFor, exhaustedCap, type Allowance } from "@/lib/ai/allowance";
import { applyChatEvent, emptyAnswer } from "@/lib/ai/chat-client";
import type { ChatRole, ChatSummary } from "@/lib/ai/chat-history-core";
import { MAX_MESSAGE_CHARS, MAX_MESSAGES, MODEL_HISTORY } from "@/lib/ai/chat-limits";
import type { AgentConfig } from "@/lib/ai/config";
import { fallbackMessage, type FallbackReason } from "@/lib/ai/fallback";
import { systemPrompt } from "@/lib/ai/prompt";
import { newDraft, type ProposalStep, type ProposalView } from "@/lib/ai/proposals";
import { regionAllowed } from "@/lib/ai/region";
import type { AgentTool, Source, ToolContext } from "@/lib/ai/tools/define";
import type { AgentMessage, Provider, ProviderError } from "@/lib/ai/types";

export { MAX_MESSAGE_CHARS, MAX_MESSAGES, MODEL_HISTORY };

/**
 * `{ message, chatId? }`: the person's question, and the stored chat it continues (#452). The
 * browser sends only the question: the earlier messages the model sees come from the database.
 */
export const chatRequestSchema = z.strictObject({
  chatId: z.string().trim().min(1).max(64).optional(),
  message: z
    .string({ error: "Send a message." })
    .trim()
    .min(1, "Messages can't be empty.")
    .max(MAX_MESSAGE_CHARS, `Keep each message under ${MAX_MESSAGE_CHARS.toLocaleString("en-US")} characters.`),
});

export type ChatRequest = z.infer<typeof chatRequestSchema>;

/** For a page loaded before #452, which still sends the whole conversation. */
export const OUTDATED_PAGE_MESSAGE = "AI Multi has been updated. Reload the page and ask again.";

export function parseChatRequest(body: unknown): { request: ChatRequest } | { error: string } {
  if (body && typeof body === "object" && "messages" in body) return { error: OUTDATED_PAGE_MESSAGE };
  const parsed = chatRequestSchema.safeParse(body);
  return parsed.success ? { request: parsed.data } : { error: parsed.error.issues[0]?.message ?? "Invalid request." };
}

/**
 * The answer's stream, one JSON object per line (application/x-ndjson):
 * - `start` first: whether a model or the planner answers (and why), and today's allowance;
 * - `tool` and `sources` while the model looks things up (the panel links the sources, #308);
 * - `text` pieces of the answer;
 * - `notice` when the model fails midway and the planner takes over;
 * - `proposal` when the answer proposes changes (#310): the card the person applies or cancels;
 * - `error` when something in AI Multi failed;
 * - `done` last, with the outcome, the allowance after this message, and the stored chat the
 *   question and its answer are now in (#452), or null when they weren't stored.
 */
export type ChatEvent =
  | { type: "start"; mode: "agent"; model: string; allowance: Allowance }
  | { type: "start"; mode: "planner"; reason: FallbackReason; message: string; allowance: Allowance }
  | LoopEvent
  | { type: "notice"; reason: FallbackReason; message: string }
  | { type: "proposal"; proposal: ProposalView }
  | { type: "error"; message: string }
  | { type: "done"; outcome: AgentRunOutcome; allowance: Allowance | null; chat: ChatSummary | null };

/** Who answers the next message: a model, or the rule-based planner and why. */
export type AnswerMode = { mode: "agent" } | { mode: "planner"; reason: FallbackReason };

/**
 * What the chat knows before the first question (#308, `GET /api/agent/status`): whether the
 * person agreed to the data notice, today's allowance, and who would answer.
 */
export type AgentStatus = AnswerMode & { noticeAccepted: boolean; allowance: Allowance };

/**
 * Who answers, before anything is sent: the planner when the assistant is off (no provider or
 * key), when the free tier doesn't serve the person's country (region.ts), or when today's
 * allowance is used up, the person's own reported first; otherwise the model.
 */
export function answerMode({
  config,
  hasProvider,
  country,
  allowance,
}: {
  config: AgentConfig;
  hasProvider: boolean;
  country: string | null;
  allowance: Allowance;
}): AnswerMode {
  if (!hasProvider || config.disabledReason) return { mode: "planner", reason: "disabled" };
  if (!regionAllowed(country, config.freeTier)) return { mode: "planner", reason: "region" };
  const cap = exhaustedCap(allowance);
  if (cap) return { mode: "planner", reason: cap === "user" ? "user_limit" : "app_limit" };
  return { mode: "agent" };
}

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
  /**
   * Stores the question with its answer, once the answer has arrived in full (#452), and returns the
   * chat they're now in: a new one, or the one they continue. Null when that chat is gone.
   */
  save(answer: StoredAnswer): Promise<ChatSummary | null>;
  /** Stores the changes an answer proposed (#310), pending until the person applies or cancels them. */
  propose(steps: ProposalStep[]): Promise<{ id: string; expiresAt: Date }>;
};

/**
 * An answer as the chat history keeps it: what the person saw, who wrote it, and the changes it
 * proposed (#310), if any.
 */
export type StoredAnswer = { role: Exclude<ChatRole, "USER">; content: string; sources: Source[]; proposalId?: string };

/** A message to answer: the question, and the stored chat's latest messages, oldest first ([] for a new chat). */
export type ChatInput = { question: string; history: Array<{ role: ChatRole; content: string }> };

export type ChatResult = {
  record: RunRecord;
  /** For the server log. */
  providerError?: ProviderError;
  failure?: unknown;
  /** The answer went out, but storing it failed. */
  saveFailure?: unknown;
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

/**
 * What the model sees (#452): the stored chat's question-and-answer pairs, never the browser's copy,
 * then the new question; the latest MODEL_HISTORY messages, starting with one of the person's, as
 * every provider expects. The planner's answers count as the assistant's: they're what the person
 * was told. Each message is cut to MAX_MESSAGE_CHARS, as the endpoint once required.
 */
export function modelMessages(history: ChatInput["history"], question: string): AgentMessage[] {
  const messages: AgentMessage[] = [];
  let asked: string | null = null;
  for (const message of history) {
    if (message.role === "USER") {
      asked = message.content;
    } else if (asked !== null) {
      messages.push({ role: "user", content: asked.slice(0, MAX_MESSAGE_CHARS) }, { role: "assistant", content: message.content.slice(0, MAX_MESSAGE_CHARS) });
      asked = null;
    }
  }
  messages.push({ role: "user", content: question });
  const latest = messages.slice(-MODEL_HISTORY);
  while (latest[0]?.role === "assistant") latest.shift();
  return latest;
}

export async function runAgentChat(
  input: ChatInput,
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
  // The answer as the person sees it, folded from the same events the browser gets, to store it.
  let shown = emptyAnswer();
  let byPlanner = false;
  const send = (event: ChatEvent) => {
    shown = applyChatEvent(shown, event);
    emit(event);
  };

  const answerWithPlanner = async () => {
    byPlanner = true;
    const answer = await deps.planner();
    if (answer.sources.length) send({ type: "sources", items: answer.sources });
    send({ type: "text", text: answer.text });
  };

  let saveFailure: unknown;
  let proposalId: string | undefined;
  /** Stores a complete answer, never a partial one or one the person left before it finished. */
  const save = async (outcome: AgentRunOutcome): Promise<ChatSummary | null> => {
    if (outcome === "CANCELLED" || deps.signal.aborted || shown.error || !shown.text.trim()) return null;
    try {
      return await deps.save({ role: byPlanner ? "PLANNER" : "ASSISTANT", content: shown.text, sources: shown.sources, ...(proposalId ? { proposalId } : {}) });
    } catch (error) {
      saveFailure = error;
      return null;
    }
  };

  try {
    allowance = allowanceFor(await deps.usedToday(), config.caps, now);
    const decided = answerMode({ config, hasProvider: provider !== null, country: deps.country, allowance });
    if (!provider || decided.mode === "planner") {
      const reason: FallbackReason = decided.mode === "planner" ? decided.reason : "disabled";
      const outcomes: Record<string, AgentRunOutcome> = { disabled: "DISABLED", region: "REGION", user_limit: "USER_LIMIT", app_limit: "APP_LIMIT" };
      record.outcome = outcomes[reason];
      send({ type: "start", mode: "planner", reason, message: fallbackMessage(reason, allowance, now), allowance });
      await answerWithPlanner();
      send({ type: "done", outcome: record.outcome, allowance, chat: await save(record.outcome) });
      return { record, saveFailure };
    }

    record.provider = provider.name;
    record.model = config.model;
    send({ type: "start", mode: "agent", model: config.model, allowance });
    // The changes this message proposes (#310); the write tools add to it, and change nothing.
    const draft = newDraft();
    const loop = await runAgentLoop({
      provider,
      model: config.model,
      system: systemPrompt({ realNow: now, timeZone: context.timeZone }),
      messages: modelMessages(input.history, input.question),
      tools: deps.tools,
      context: { ...context, draft, request: input.question },
      signal: deps.signal,
      limits: deps.limits,
      emit: send,
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
    // Only a finished answer proposes: one cut short (a limit, an outage) may be missing changes.
    if (loop.outcome === "answered" && draft.steps.length) {
      const stored = await deps.propose(draft.steps);
      proposalId = stored.id;
      send({ type: "proposal", proposal: { id: stored.id, state: "pending", expiresAt: stored.expiresAt.toISOString(), steps: draft.steps, applied: [], links: [], error: null } });
    }
    const fallback = fallbackFor(loop);
    if (fallback) {
      send({ type: "notice", reason: fallback, message: fallbackMessage(fallback, allowance, now) });
      await answerWithPlanner();
    }
    send({ type: "done", outcome: record.outcome, allowance, chat: await save(record.outcome) });
    return { record, providerError: loop.error, saveFailure };
  } catch (failure) {
    record.outcome = "FAILED";
    emit({ type: "error", message: "Something went wrong on our side. Try again in a moment." });
    emit({ type: "done", outcome: "FAILED", allowance, chat: null });
    return { record, failure };
  }
}
