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

/** The JSON object `text` starts with (after spaces), its braces balanced; "" when it starts with none. */
function leadingObject(text: string) {
  const start = text.search(/\S/);
  if (start < 0 || text[start] !== "{") return "";
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
    } else if (char === '"') inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  // Never closed: the tool gets it as unreadable arguments.
  return text.slice(start);
}

/** Every tool `content` names, in order, each with the JSON arguments that follow its name. */
function toolCallsIn(content: string, names: string[]) {
  if (!names.length) return [];
  const calls: Array<{ name: string; args: unknown }> = [];
  let readUpTo = 0;
  for (const match of content.matchAll(new RegExp(`\\b(${names.join("|")})\\b`, "g"))) {
    // A tool's name inside an earlier call's arguments, such as a title, isn't a call.
    if (match.index < readUpTo) continue;
    const end = match.index + match[0].length;
    const json = leadingObject(content.slice(end));
    readUpTo = end + (json ? content.slice(end).indexOf(json) + json.length : 0);
    let args: unknown = {};
    try {
      if (json) args = JSON.parse(json);
    } catch {
      args = { unreadable: json };
    }
    calls.push({ name: match[1], args });
  }
  return calls;
}

/** What the model says about one tool result. */
function resultLine(result: { name: string; content: Record<string, unknown> }) {
  if (typeof result.content.error === "string") return `${result.name} failed: ${result.content.error}`;
  // A change tool (#310): what it proposed, or why it proposed nothing.
  const data = result.content.data as { proposed?: unknown; reason?: unknown } | undefined;
  if (data && typeof data === "object" && "proposed" in data) {
    return typeof data.proposed === "string" ? `Proposed: ${data.proposed}` : `${result.name} proposed nothing: ${String(data.reason)}`;
  }
  const titles = titlesIn(result.content);
  return titles.length ? `${result.name} found ${titles.length}: ${titles.join("; ")}` : `${result.name} found nothing`;
}

/**
 * The e2e tests' model. Rules, on the person's latest message:
 * - "[429]" or "[503]" in it: fails like a rate limit or an outage;
 * - "[history]" in it: answers with the messages it was sent before this one, so the tests can see
 *   which earlier turns the server gave the model (#452);
 * - tools' names in it, each optionally followed by its JSON arguments: calls them all, in order;
 * - otherwise: answers "You asked: …".
 * After tool results, it answers with a line per result: the change proposed ("Proposed: …") or
 * why none was, the titles it lists (and any percent done), or the tool's error.
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
        const text = last.results.map(resultLine).join("\n");
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

      const calls = toolCallsIn(
        content,
        request.tools.map((tool) => tool.name),
      );
      if (calls.length) {
        for (const [index, call] of calls.entries()) yield { type: "tool_call", call: { id: localCallId(index), name: call.name, args: call.args } };
        yield finish(calls.map((call) => call.name).join(" "));
        return;
      }

      const text = `You asked: ${content.slice(0, 200)}`;
      yield { type: "text", text };
      yield finish(text);
    },
  };
}
