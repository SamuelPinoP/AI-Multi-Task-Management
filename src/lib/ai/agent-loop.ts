// The agent loop (#307): ask the model, run the tools it calls, hand back
// their results, and repeat until it answers. It is bounded three ways: a
// fixed number of model requests per message, a deadline, and one second
// chance for invalid tool arguments. Provider failures end it with the error,
// never a hang; the caller decides what the person sees instead.
import { asData } from "@/lib/ai/prompt";
import { describeInvalidArguments, toolDefinition, type AgentTool, type Source, type ToolContext } from "@/lib/ai/tools/define";
import { ProviderError, type AgentMessage, type Provider, type TokenUsage, type ToolCall, type ToolResult } from "@/lib/ai/types";

export type AgentLimits = {
  /** Model requests per message: each round of tool calls takes one, and so does the answer. */
  maxModelRequests: number;
  /** For the whole message. Well under the route's maxDuration (60 s) and Vercel's limit. */
  deadlineMs: number;
  maxOutputTokens: number;
  /** Invalid tool calls the model is told about and may correct; one more ends the message. */
  maxValidationFailures: number;
};

export const AGENT_LIMITS: AgentLimits = {
  maxModelRequests: 4,
  deadlineMs: 30_000,
  maxOutputTokens: 1024,
  maxValidationFailures: 1,
};

export const STEP_LIMIT_MESSAGE = "That needed more lookups than I can do for one message. Try asking something narrower.";
export const INVALID_ARGUMENTS_MESSAGE = "I couldn't look that up. Try asking in a different way.";
export const EMPTY_ANSWER_MESSAGE = "I don't have an answer for that. Try asking in a different way.";

/** What the loop shows the person while it runs. */
export type LoopEvent =
  | { type: "text"; text: string }
  | { type: "tool"; name: string; label: string }
  | { type: "sources"; items: Source[] };

export type LoopOutcome = "answered" | "step_limit" | "invalid_arguments" | "provider_error" | "timed_out" | "cancelled";

export type LoopResult = {
  outcome: LoopOutcome;
  /** Set when the outcome is "provider_error". */
  error?: ProviderError;
  modelRequests: number;
  /** Tool names, in the order the model called them. */
  toolCalls: string[];
  validationFailures: number;
  usage: TokenUsage;
};

export async function runAgentLoop({
  provider,
  model,
  system,
  messages,
  tools,
  context,
  signal,
  limits = AGENT_LIMITS,
  emit,
}: {
  provider: Provider;
  model: string;
  system: string;
  messages: AgentMessage[];
  tools: AgentTool[];
  context: ToolContext;
  /** Aborted when the person goes away. */
  signal: AbortSignal;
  limits?: AgentLimits;
  emit: (event: LoopEvent) => void;
}): Promise<LoopResult> {
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(new Error("The agent's deadline passed.")), limits.deadlineMs);
  const requestSignal = AbortSignal.any([signal, deadline.signal]);
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  const definitions = tools.map(toolDefinition);
  const history = [...messages];
  const result: LoopResult = {
    outcome: "answered",
    modelRequests: 0,
    toolCalls: [],
    validationFailures: 0,
    usage: { inputTokens: 0, outputTokens: 0 },
  };
  const stopped = (): LoopOutcome | null => (signal.aborted ? "cancelled" : deadline.signal.aborted ? "timed_out" : null);

  async function runTool(call: ToolCall): Promise<ToolResult> {
    result.toolCalls.push(call.name);
    const reply = (content: Record<string, unknown>): ToolResult => ({ callId: call.id, name: call.name, content });
    const tool = byName.get(call.name);
    if (!tool) {
      result.validationFailures += 1;
      return reply({ error: `There is no tool named ${call.name}. The tools are: ${[...byName.keys()].join(", ")}.` });
    }
    // Only tools that read run straight away; changes will go through the person's confirmation (#310).
    if (tool.access !== "read") return reply({ error: `${call.name} can't run here.` });
    const parsed = tool.input.safeParse(call.args);
    if (!parsed.success) {
      result.validationFailures += 1;
      return reply({ error: describeInvalidArguments(parsed.error) });
    }
    emit({ type: "tool", name: tool.name, label: tool.label });
    try {
      const output = await tool.run(parsed.data, context);
      if (output.sources.length) emit({ type: "sources", items: output.sources });
      return reply(asData(output.data));
    } catch (error) {
      console.error("agent_tool_failed", { tool: tool.name, error: error instanceof Error ? error.name : "UnknownError" });
      return reply({ error: "The lookup failed. Answer without it, and say it failed." });
    }
  }

  try {
    while (true) {
      result.modelRequests += 1;

      let text = "";
      const calls: ToolCall[] = [];
      let providerState: unknown;
      try {
        for await (const event of provider.stream({ model, system, messages: history, tools: definitions, maxOutputTokens: limits.maxOutputTokens, signal: requestSignal })) {
          if (event.type === "text") {
            text += event.text;
            emit(event);
          } else if (event.type === "tool_call") {
            calls.push(event.call);
          } else {
            result.usage.inputTokens += event.usage.inputTokens;
            result.usage.outputTokens += event.usage.outputTokens;
            providerState = event.providerState;
          }
        }
      } catch (error) {
        const stop = stopped();
        if (stop) {
          result.outcome = stop;
          break;
        }
        if (error instanceof ProviderError) {
          result.outcome = "provider_error";
          result.error = error;
          break;
        }
        throw error;
      }

      const stop = stopped();
      if (stop) {
        result.outcome = stop;
        break;
      }
      history.push({ role: "assistant", content: text, toolCalls: calls, providerState });
      if (calls.length === 0) {
        if (!text.trim()) emit({ type: "text", text: EMPTY_ANSWER_MESSAGE });
        result.outcome = "answered";
        break;
      }
      // More tools wanted, but no request left to read their results with: don't run them.
      if (result.modelRequests >= limits.maxModelRequests) {
        result.outcome = "step_limit";
        emit({ type: "text", text: STEP_LIMIT_MESSAGE });
        break;
      }

      const results: ToolResult[] = [];
      for (const call of calls) results.push(await runTool(call));
      if (result.validationFailures > limits.maxValidationFailures) {
        result.outcome = "invalid_arguments";
        emit({ type: "text", text: INVALID_ARGUMENTS_MESSAGE });
        break;
      }
      history.push({ role: "tool", results });
    }
  } finally {
    clearTimeout(timer);
  }
  return result;
}
