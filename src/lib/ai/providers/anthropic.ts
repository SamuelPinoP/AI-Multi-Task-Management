// Anthropic's Claude through the Messages API (#311), with plain fetch like
// gemini.ts: no SDK dependency, and every byte sent is visible here.
//
// Claude Haiku 5.5 thinks before it answers when it needs to. Its thinking
// blocks come back with a signature and must be sent back unchanged with the
// tool results, so a turn's blocks are kept whole in its providerState.
// API reference: https://platform.claude.com/docs/en/api/messages
import { readSseData } from "@/lib/ai/providers/sse";
import { localCallId, ProviderError, type AgentMessage, type Provider, type ProviderEvent, type ProviderRequest, type ToolCall } from "@/lib/ai/types";

/** Claude Haiku 5.5: the fast, low-cost Claude, at $0.10 / $0.50 per million tokens. */
export const ANTHROPIC_DEFAULT_MODEL = "claude-haiku-5-5";

const API_URL = "https://api.anthropic.com/v1/messages";
/** The API version this file is written for. */
export const ANTHROPIC_API_VERSION = "2026-10-21";

export type AnthropicEffort = "low" | "medium" | "high";

type TextBlock = { type: "text"; text: string };
type ThinkingBlock = { type: "thinking"; thinking: string; signature: string };
type RedactedThinkingBlock = { type: "redacted_thinking"; data: string };
type ToolUseBlock = { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };
type ToolResultBlock = { type: "tool_result"; tool_use_id: string; content: string };
/** What a model turn holds. Other block types (server tools) aren't requested, so never arrive. */
type AssistantBlock = TextBlock | ThinkingBlock | RedactedThinkingBlock | ToolUseBlock;

type AnthropicMessage = { role: "user"; content: string | ToolResultBlock[] } | { role: "assistant"; content: AssistantBlock[] };

type Usage = { input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number };

type StreamEvent =
  | { type: "message_start"; message?: { usage?: Usage } }
  | { type: "content_block_start"; index: number; content_block: AssistantBlock }
  | {
      type: "content_block_delta";
      index: number;
      delta:
        | { type: "text_delta"; text: string }
        | { type: "input_json_delta"; partial_json: string }
        | { type: "thinking_delta"; thinking: string }
        | { type: "signature_delta"; signature: string };
    }
  | { type: "content_block_stop"; index: number }
  | { type: "message_delta"; delta?: { stop_reason?: string | null }; usage?: Usage }
  | { type: "message_stop" }
  | { type: "ping" }
  | { type: "error"; error?: { type?: string; message?: string } };

/** What this provider keeps of a model turn: its blocks, thinking signatures included, to send back verbatim. */
type AnthropicState = { provider: "anthropic"; content: AssistantBlock[] };

function isAnthropicState(value: unknown): value is AnthropicState {
  return typeof value === "object" && value !== null && (value as AnthropicState).provider === "anthropic" && Array.isArray((value as AnthropicState).content);
}

/** The conversation in Claude's shape: tool results go back in the person's turn, as Claude expects. */
export function toAnthropicMessages(messages: AgentMessage[]): AnthropicMessage[] {
  return messages.map((message): AnthropicMessage => {
    if (message.role === "user") return { role: "user", content: message.content };
    if (message.role === "tool") {
      return {
        role: "user",
        content: message.results.map((result) => ({ type: "tool_result", tool_use_id: result.callId, content: JSON.stringify(result.content) })),
      };
    }
    // A turn this provider produced comes back exactly as it was received; earlier turns, stored as text, as text.
    if (isAnthropicState(message.providerState)) return { role: "assistant", content: message.providerState.content };
    const calls = (message.toolCalls ?? []).map(
      (call): ToolUseBlock => ({ type: "tool_use", id: call.id, name: call.name, input: call.args && typeof call.args === "object" ? (call.args as Record<string, unknown>) : {} }),
    );
    return { role: "assistant", content: [...(message.content || !calls.length ? [{ type: "text" as const, text: message.content }] : []), ...calls] };
  });
}

export function anthropicRequestBody(request: ProviderRequest, effort: AnthropicEffort | null = "low") {
  return {
    model: request.model,
    max_tokens: request.maxOutputTokens,
    system: request.system,
    messages: toAnthropicMessages(request.messages),
    // No tool_choice, even for `toolChoice`: Claude thinks before it answers, and the API refuses a
    // forced tool with thinking. The prompt asks for the call instead.
    ...(request.tools.length
      ? { tools: request.tools.map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.parameters })) }
      : {}),
    // Lookups need little thinking, and thinking counts toward max_tokens. Older models don't take it.
    ...(effort ? { output_config: { effort } } : {}),
    stream: true,
  };
}

function errorKind(status: number) {
  if (status === 429) return "rate_limited" as const;
  if (status === 504) return "timeout" as const;
  if (status === 400 || status === 401 || status === 403 || status === 404 || status === 413) return "rejected" as const;
  // 402: credit used up; 500: Anthropic's side; 529: overloaded.
  return "unavailable" as const;
}

/** The kind of an error the stream reports midway, by Anthropic's error type. */
function streamErrorKind(type: string | undefined) {
  if (type === "rate_limit_error") return "rate_limited" as const;
  if (type === "timeout_error") return "timeout" as const;
  if (type === "invalid_request_error" || type === "authentication_error" || type === "permission_error" || type === "not_found_error" || type === "request_too_large") {
    return "rejected" as const;
  }
  return "unavailable" as const;
}

/** Anthropic's own words, for the server log only: they name the problem, never the person's data. */
function describe(error: { type?: string; message?: string } | undefined) {
  return `${error?.type ?? "error"}: ${error?.message ?? "no message"}`.slice(0, 300);
}

async function errorFromResponse(response: Response) {
  const body = (await response.json().catch(() => null)) as { error?: { type?: string; message?: string } } | null;
  return new ProviderError(errorKind(response.status), `Anthropic answered ${response.status} ${describe(body?.error)}`, response.status);
}

function inputTokens(usage: Usage) {
  return (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
}

export function createAnthropicProvider({
  apiKey,
  effort = "low",
  fetch: fetchImpl = fetch,
}: {
  apiKey: string;
  /** How hard the model thinks: `output_config.effort`. Null leaves it out, for models without it. */
  effort?: AnthropicEffort | null;
  fetch?: typeof fetch;
}): Provider {
  return {
    name: "anthropic",
    async *stream(request): AsyncGenerator<ProviderEvent> {
      let response: Response;
      try {
        response = await fetchImpl(API_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": ANTHROPIC_API_VERSION },
          body: JSON.stringify(anthropicRequestBody(request, effort)),
          signal: request.signal,
        });
      } catch (error) {
        if (request.signal.aborted) throw error;
        throw new ProviderError("unavailable", `Couldn't reach Anthropic: ${error instanceof Error ? error.message : "unknown error"}`);
      }
      if (!response.ok) throw await errorFromResponse(response);
      if (!response.body) throw new ProviderError("unavailable", "Anthropic sent an empty response");

      // Blocks by their index in the turn; a tool call's input arrives as pieces of JSON.
      const blocks: AssistantBlock[] = [];
      const partialJson = new Map<number, string>();
      const usage = { inputTokens: 0, outputTokens: 0 };
      let stopReason: string | undefined;
      let calls = 0;
      let answered = false;

      try {
        for await (const data of readSseData(response.body)) {
          let event: StreamEvent;
          try {
            event = JSON.parse(data) as StreamEvent;
          } catch {
            throw new ProviderError("unavailable", "Anthropic sent a malformed stream");
          }
          switch (event.type) {
            case "error":
              throw new ProviderError(streamErrorKind(event.error?.type), `Anthropic stream error ${describe(event.error)}`);
            case "message_start":
              if (event.message?.usage) {
                usage.inputTokens = inputTokens(event.message.usage);
                usage.outputTokens = event.message.usage.output_tokens ?? 0;
              }
              break;
            case "content_block_start": {
              const block = event.content_block;
              blocks[event.index] =
                block.type === "tool_use"
                  ? { type: "tool_use", id: block.id, name: block.name, input: {} }
                  : block.type === "text"
                    ? { type: "text", text: "" }
                    : { ...block };
              if (block.type === "tool_use") partialJson.set(event.index, "");
              if (block.type === "text" && block.text) {
                (blocks[event.index] as TextBlock).text = block.text;
                answered = true;
                yield { type: "text", text: block.text };
              }
              break;
            }
            case "content_block_delta": {
              const block = blocks[event.index];
              const delta = event.delta;
              if (delta.type === "text_delta" && block?.type === "text") {
                block.text += delta.text;
                answered = true;
                yield { type: "text", text: delta.text };
              } else if (delta.type === "input_json_delta" && block?.type === "tool_use") {
                partialJson.set(event.index, (partialJson.get(event.index) ?? "") + delta.partial_json);
              } else if (delta.type === "thinking_delta" && block?.type === "thinking") {
                block.thinking += delta.thinking;
              } else if (delta.type === "signature_delta" && block?.type === "thinking") {
                block.signature = (block.signature ?? "") + delta.signature;
              }
              break;
            }
            case "content_block_stop": {
              const block = blocks[event.index];
              if (block?.type !== "tool_use") break;
              const json = partialJson.get(event.index) ?? "";
              let args: unknown = {};
              try {
                args = json ? JSON.parse(json) : {};
              } catch {
                // The agent loop's validation tells the model, which may try again.
                args = json;
              }
              block.input = args && typeof args === "object" && !Array.isArray(args) ? (args as Record<string, unknown>) : {};
              const call: ToolCall = { id: block.id || localCallId(calls), name: block.name, args };
              calls += 1;
              answered = true;
              yield { type: "tool_call", call };
              break;
            }
            case "message_delta":
              if (event.delta?.stop_reason) stopReason = event.delta.stop_reason;
              // Running totals; the last event has the final ones.
              if (event.usage?.output_tokens !== undefined) usage.outputTokens = event.usage.output_tokens;
              if (event.usage?.input_tokens !== undefined) usage.inputTokens = inputTokens(event.usage);
              break;
            default:
              break;
          }
        }
      } catch (error) {
        if (request.signal.aborted || error instanceof ProviderError) throw error;
        throw new ProviderError("unavailable", `Anthropic's stream broke off: ${error instanceof Error ? error.message : "unknown error"}`);
      }

      if (!stopReason) throw new ProviderError("unavailable", "Anthropic's stream ended before the answer did");
      // Declined by the model's safeguards, or too long to read, with nothing to show for it.
      if (!answered && (stopReason === "refusal" || stopReason === "model_context_window_exceeded")) {
        throw new ProviderError("rejected", `Anthropic stopped without an answer: ${stopReason}`);
      }
      yield { type: "finish", usage, providerState: { provider: "anthropic", content: blocks.filter(Boolean) } satisfies AnthropicState };
    },
  };
}
