// Any API that speaks OpenAI's Chat Completions (#311), such as Groq's, with
// plain fetch like gemini.ts. Groq serves open-weight models such as
// gpt-oss-120b, with a free plan that needs no card.
// Groq's reference: https://console.groq.com/docs/api-reference#chat-create
import { readSseData } from "@/lib/ai/providers/sse";
import { localCallId, ProviderError, type AgentMessage, type Provider, type ProviderEvent, type ProviderRequest, type ToolCall } from "@/lib/ai/types";

export const GROQ_BASE_URL = "https://api.groq.com/openai/v1";
/** OpenAI's open-weight gpt-oss-120b on Groq. */
export const GROQ_DEFAULT_MODEL = "openai/gpt-oss-120b";

type ChatToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };

type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ChatToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

type ChatUsage = { prompt_tokens?: number; completion_tokens?: number };

type ChatChunk = {
  choices?: Array<{
    delta?: {
      content?: string | null;
      tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: ChatUsage | null;
  /** Groq puts the usage here on the last chunk. */
  x_groq?: { usage?: ChatUsage; error?: string };
  error?: { message?: string; type?: string; code?: string | number };
};

/** The conversation in Chat Completions' shape: the instructions first, one message per tool result. */
export function toChatMessages(system: string, messages: AgentMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [{ role: "system", content: system }];
  for (const message of messages) {
    if (message.role === "user") out.push({ role: "user", content: message.content });
    else if (message.role === "tool") {
      for (const result of message.results) out.push({ role: "tool", tool_call_id: result.callId, content: JSON.stringify(result.content) });
    } else {
      const calls = (message.toolCalls ?? []).map(
        (call): ChatToolCall => ({ id: call.id, type: "function", function: { name: call.name, arguments: typeof call.args === "string" ? call.args : JSON.stringify(call.args ?? {}) } }),
      );
      // A turn that only calls tools has no text: null, as the API expects.
      out.push({ role: "assistant", content: message.content || (calls.length ? null : ""), ...(calls.length ? { tool_calls: calls } : {}) });
    }
  }
  return out;
}

export function chatRequestBody(request: ProviderRequest) {
  return {
    model: request.model,
    messages: toChatMessages(request.system, request.messages),
    ...(request.tools.length
      ? {
          tools: request.tools.map((tool) => ({ type: "function", function: { name: tool.name, description: tool.description, parameters: tool.parameters } })),
          tool_choice: "auto",
        }
      : {}),
    max_completion_tokens: request.maxOutputTokens,
    stream: true,
    stream_options: { include_usage: true },
  };
}

function errorKind(status: number) {
  if (status === 429) return "rate_limited" as const;
  if (status === 504) return "timeout" as const;
  // 413: the request is bigger than the plan's tokens a minute, so waiting won't help either.
  if (status === 400 || status === 401 || status === 403 || status === 404 || status === 413 || status === 422) return "rejected" as const;
  // 498: Groq's flex tier is out of capacity; 5xx: the provider's side.
  return "unavailable" as const;
}

function describe(error: ChatChunk["error"]) {
  return `${error?.type ?? error?.code ?? "error"}: ${error?.message ?? "no message"}`.slice(0, 300);
}

export function createOpenAiCompatibleProvider({
  name,
  baseUrl,
  apiKey,
  fetch: fetchImpl = fetch,
}: {
  /** "groq": stored in the usage log, and named in errors. */
  name: string;
  baseUrl: string;
  apiKey: string;
  fetch?: typeof fetch;
}): Provider {
  return {
    name,
    async *stream(request): AsyncGenerator<ProviderEvent> {
      let response: Response;
      try {
        response = await fetchImpl(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify(chatRequestBody(request)),
          signal: request.signal,
        });
      } catch (error) {
        if (request.signal.aborted) throw error;
        throw new ProviderError("unavailable", `Couldn't reach ${name}: ${error instanceof Error ? error.message : "unknown error"}`);
      }
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as ChatChunk | null;
        throw new ProviderError(errorKind(response.status), `${name} answered ${response.status} ${describe(body?.error)}`, response.status);
      }
      if (!response.body) throw new ProviderError("unavailable", `${name} sent an empty response`);

      // Tool calls arrive in pieces, by index: the id and name first, then the arguments' JSON.
      const pieces = new Map<number, { id?: string; name: string; arguments: string }>();
      const usage = { inputTokens: 0, outputTokens: 0 };
      let finishReason: string | undefined;
      let answered = false;

      try {
        for await (const data of readSseData(response.body)) {
          if (data.trim() === "[DONE]") break;
          let chunk: ChatChunk;
          try {
            chunk = JSON.parse(data) as ChatChunk;
          } catch {
            throw new ProviderError("unavailable", `${name} sent a malformed stream`);
          }
          if (chunk.error) throw new ProviderError("unavailable", `${name} stream error ${describe(chunk.error)}`);
          if (chunk.x_groq?.error) throw new ProviderError("unavailable", `${name} stream error: ${chunk.x_groq.error}`.slice(0, 300));
          const reported = chunk.usage ?? chunk.x_groq?.usage;
          if (reported) {
            usage.inputTokens = reported.prompt_tokens ?? usage.inputTokens;
            usage.outputTokens = reported.completion_tokens ?? usage.outputTokens;
          }
          const choice = chunk.choices?.[0];
          if (choice?.delta?.content) {
            answered = true;
            yield { type: "text", text: choice.delta.content };
          }
          for (const piece of choice?.delta?.tool_calls ?? []) {
            const index = piece.index ?? 0;
            const found = pieces.get(index) ?? { name: "", arguments: "" };
            if (piece.id) found.id = piece.id;
            if (piece.function?.name) found.name += piece.function.name;
            if (piece.function?.arguments) found.arguments += piece.function.arguments;
            pieces.set(index, found);
          }
          if (choice?.finish_reason) finishReason = choice.finish_reason;
        }
      } catch (error) {
        if (request.signal.aborted || error instanceof ProviderError) throw error;
        throw new ProviderError("unavailable", `${name}'s stream broke off: ${error instanceof Error ? error.message : "unknown error"}`);
      }

      if (!finishReason) throw new ProviderError("unavailable", `${name}'s stream ended before the answer did`);
      const ordered = [...pieces.entries()].sort(([a], [b]) => a - b);
      for (const [position, piece] of ordered.entries()) {
        let args: unknown = {};
        try {
          args = piece[1].arguments ? JSON.parse(piece[1].arguments) : {};
        } catch {
          // The agent loop's validation tells the model, which may try again.
          args = piece[1].arguments;
        }
        const call: ToolCall = { id: piece[1].id ?? localCallId(position), name: piece[1].name, args };
        answered = true;
        yield { type: "tool_call", call };
      }
      if (!answered && finishReason === "content_filter") throw new ProviderError("rejected", `${name} stopped without an answer: ${finishReason}`);
      yield { type: "finish", usage };
    },
  };
}
