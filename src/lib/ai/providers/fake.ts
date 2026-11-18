// Stand-ins for a model, so no test ever calls a real API (#307).
// - `createScriptedProvider`: unit tests write each answer in advance.
// - `createFakeProvider`: AI_PROVIDER="fake", for the e2e tests' server. It
//   follows simple rules (below). The configuration refuses it on Vercel.
import { localCallId, ProviderError, type Provider, type ProviderEvent, type ProviderRequest, type TokenUsage } from "@/lib/ai/types";

export type ScriptedTurn = {
  /** Streamed in two pieces, to exercise streaming. */
  text?: string;
  toolCalls?: Array<{ name: string; args: unknown }>;
  /** Thrown instead of answering, like a 429. */
  error?: ProviderError;
  /** Never answers: waits until the request is aborted (the run's deadline, or the person leaving). */
  hang?: boolean;
  usage?: TokenUsage;
};

export type ScriptedProvider = Provider & {
  /** Every request received, for assertions. */
  requests: ProviderRequest[];
};

function abortError(signal: AbortSignal) {
  return signal.reason instanceof Error ? signal.reason : new DOMException("The request was aborted.", "AbortError");
}

/** Answers each request with the next turn of `turns`; one more request than turns is a test failure. */
export function createScriptedProvider(turns: ScriptedTurn[], name = "scripted"): ScriptedProvider {
  const requests: ProviderRequest[] = [];
  return {
    name,
    requests,
    async *stream(request): AsyncGenerator<ProviderEvent> {
      // A snapshot: the agent keeps adding to the same history.
      requests.push({ ...request, messages: structuredClone(request.messages) });
      const turn = turns[requests.length - 1];
      if (!turn) throw new Error(`The scripted provider has no turn ${requests.length}.`);
      if (turn.hang) {
        await new Promise<void>((_resolve, reject) => {
          if (request.signal.aborted) reject(abortError(request.signal));
          request.signal.addEventListener("abort", () => reject(abortError(request.signal)), { once: true });
        });
      }
      if (turn.error) throw turn.error;
      if (turn.text) {
        const half = Math.ceil(turn.text.length / 2);
        yield { type: "text", text: turn.text.slice(0, half) };
        if (turn.text.length > half) yield { type: "text", text: turn.text.slice(half) };
      }
      for (const [index, call] of (turn.toolCalls ?? []).entries()) {
        yield { type: "tool_call", call: { id: localCallId(index), name: call.name, args: call.args } };
      }
      yield { type: "finish", usage: turn.usage ?? { inputTokens: 100, outputTokens: 20 }, providerState: { provider: name, turn: requests.length } };
    },
  };
}

function estimateTokens(text: string) {
  return Math.ceil(text.length / 4);
}

/** Titles (or names) of the items in a tool result, wherever its `data` lists them, with any percent done. */
function titlesIn(content: Record<string, unknown>) {
  const data = content.data;
  if (!data || typeof data !== "object") return [];
  return Object.values(data)
    .filter(Array.isArray)
    .flat()
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const { title, name, percentDone } = item as { title?: unknown; name?: unknown; percentDone?: unknown };
      const label = title ?? name;
      if (typeof label !== "string") return null;
      return typeof percentDone === "number" ? `${label} (${percentDone}%)` : label;
    })
    .filter((title): title is string => title !== null);
}

/**
 * The e2e tests' model. Rules, on the person's latest message:
 * - "[429]" or "[503]" in it: fails like a rate limit or an outage;
 * - "[history]" in it: answers with the messages it was sent before this one, so the tests can see
 *   which earlier turns the server gave the model (#452);
 * - a tool's name in it (optionally followed by JSON arguments): calls that tool;
 * - otherwise: answers "You asked: …".
 * After tool results, it answers with the titles they list (and any percent done), or the tool's error.
 */
export function createFakeProvider(): Provider {
  return {
    name: "fake",
    async *stream(request): AsyncGenerator<ProviderEvent> {
      const last = request.messages.at(-1);
      const input = estimateTokens(request.system + JSON.stringify(request.messages) + JSON.stringify(request.tools));
      const finish = (output: string): ProviderEvent => ({
        type: "finish",
        usage: { inputTokens: input, outputTokens: estimateTokens(output) },
        providerState: { provider: "fake" },
      });

      if (last?.role === "tool") {
        const lines = last.results.map((result) => {
          if (typeof result.content.error === "string") return `${result.name} failed: ${result.content.error}`;
          const titles = titlesIn(result.content);
          return titles.length ? `${result.name} found ${titles.length}: ${titles.join("; ")}` : `${result.name} found nothing`;
        });
        const text = lines.join("\n");
        yield { type: "text", text };
        yield finish(text);
        return;
      }

      const content = last?.role === "user" ? last.content : "";
      if (content.includes("[429]")) throw new ProviderError("rate_limited", "The fake provider's rate limit", 429);
      if (content.includes("[503]")) throw new ProviderError("unavailable", "The fake provider is down", 503);

      if (content.includes("[history]")) {
        const earlier = request.messages.slice(0, -1).map((message) => (message.role === "tool" ? "tool: …" : `${message.role}: ${message.content}`));
        const text = `Earlier messages: ${earlier.length ? earlier.join(" | ") : "none"}`;
        yield { type: "text", text };
        yield finish(text);
        return;
      }

      const tool = request.tools.find((candidate) => new RegExp(`\\b${candidate.name}\\b`).test(content));
      if (tool) {
        const after = content.slice(content.indexOf(tool.name) + tool.name.length);
        const json = after.slice(after.indexOf("{"), after.lastIndexOf("}") + 1);
        let args: unknown = {};
        try {
          if (json) args = JSON.parse(json);
        } catch {
          args = { unreadable: json };
        }
        yield { type: "tool_call", call: { id: localCallId(0), name: tool.name, args } };
        yield finish(tool.name);
        return;
      }

      const text = `You asked: ${content.slice(0, 200)}`;
      yield { type: "text", text };
      yield finish(text);
    },
  };
}
