// Google Gemini through its REST API (#307), with plain fetch rather than an
// SDK: no new dependency, and every byte sent is visible here, which matters
// while the free tier's terms ask apps to send as little as they can.
//
// It uses generateContent's streaming form. Google now calls generateContent
// "legacy" but "fully supported", and recommends its newer Interactions API
// for new projects; moving to it touches only this file.
// API reference: https://aistudio.google.com/api-reference/generate-content/stream-generate-content.md
import { readSseData } from "@/lib/ai/providers/sse";
import {
  isLocalCallId,
  localCallId,
  ProviderError,
  type AgentMessage,
  type Provider,
  type ProviderEvent,
  type ProviderRequest,
  type ToolCall,
} from "@/lib/ai/types";

/** Gemini 3.1 Flash-Lite: stable, and the free tier's largest daily quota of the current models (#256). */
export const GEMINI_DEFAULT_MODEL = "gemini-3.1-flash-lite";

const API_BASE = "https://generativelanguage.googleapis.com/v1beta";

type GeminiPart = {
  text?: string;
  /** A summary of the model's thinking; never shown, but kept in the turn's state. */
  thought?: boolean;
  /** Opaque. On Gemini 3, the first function call of each step carries one, and it must come back. */
  thoughtSignature?: string;
  functionCall?: { id?: string; name: string; args?: Record<string, unknown> };
  functionResponse?: { id?: string; name: string; response: Record<string, unknown> };
};

type GeminiContent = { role: "user" | "model"; parts: GeminiPart[] };

type GeminiChunk = {
  candidates?: Array<{ content?: { parts?: GeminiPart[] }; finishReason?: string }>;
  usageMetadata?: {
    promptTokenCount?: number;
    toolUsePromptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
  };
  promptFeedback?: { blockReason?: string };
  error?: { code?: number; message?: string; status?: string };
};

/** What this provider keeps of a model turn: its parts, signatures included, to send back verbatim. */
type GeminiState = { provider: "gemini"; parts: GeminiPart[] };

function isGeminiState(value: unknown): value is GeminiState {
  return typeof value === "object" && value !== null && (value as GeminiState).provider === "gemini" && Array.isArray((value as GeminiState).parts);
}

/** The conversation in Gemini's shape: tool results go back as the user's turn, as Gemini expects. */
export function toGeminiContents(messages: AgentMessage[]): GeminiContent[] {
  return messages.map((message): GeminiContent => {
    if (message.role === "user") return { role: "user", parts: [{ text: message.content }] };
    if (message.role === "tool") {
      return {
        role: "user",
        parts: message.results.map((result) => ({
          functionResponse: { ...(isLocalCallId(result.callId) ? {} : { id: result.callId }), name: result.name, response: result.content },
        })),
      };
    }
    // A turn this provider produced comes back exactly as it was received (thought signatures included);
    // earlier turns, which the browser sends as text, as plain text.
    if (isGeminiState(message.providerState)) return { role: "model", parts: message.providerState.parts };
    return { role: "model", parts: [{ text: message.content }] };
  });
}

type JsonSchema = Record<string, unknown>;

function isSchema(value: unknown): value is JsonSchema {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A branch that optionalArgument (src/lib/ai/tools/define.ts) adds for an argument left out as null or "". */
function isLeftOutBranch(branch: unknown) {
  const json = JSON.stringify(branch);
  return json === '{"type":"null"}' || json === '{"type":"string","maxLength":0}';
}

/**
 * A tool's parameters as Gemini gets them (#504): without the null and "" branches, so each optional
 * argument is one schema with its description beside its type, as before #504. With the branches,
 * the description sat beside anyOf, which Google's own schema type doesn't allow (Vertex AI says
 * anyOf "must be the only field set", google/adk-python#3281), and the model acted as if it never
 * saw it: it named tasks and projects by id, and passed defaults it was told to leave out. Gemini needs no
 * branches: unlike Groq, it doesn't refuse a call over its schema, and the tools take null and "" anyway.
 */
export function geminiSchema(schema: JsonSchema): JsonSchema {
  const result: JsonSchema = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === "properties" && isSchema(value)) {
      result[key] = Object.fromEntries(Object.entries(value).map(([name, property]) => [name, isSchema(property) ? geminiSchema(property) : property]));
    } else if (key === "items" && isSchema(value)) {
      result[key] = geminiSchema(value);
    } else if (key === "anyOf" && Array.isArray(value)) {
      result[key] = value.filter((branch) => !isLeftOutBranch(branch)).map((branch) => (isSchema(branch) ? geminiSchema(branch) : branch));
    } else if (key === "type" && Array.isArray(value)) {
      const types = value.filter((type) => type !== "null");
      result[key] = types.length === 1 ? types[0] : types;
    } else {
      result[key] = value;
    }
  }
  const { anyOf, ...rest } = result;
  // One branch left: it is the argument's own schema, and the description goes beside its type.
  return Array.isArray(anyOf) && anyOf.length === 1 && isSchema(anyOf[0]) ? { ...anyOf[0], ...rest } : result;
}

export function geminiRequestBody(request: ProviderRequest) {
  return {
    systemInstruction: { parts: [{ text: request.system }] },
    contents: toGeminiContents(request.messages),
    ...(request.tools.length
      ? {
          tools: [
            {
              functionDeclarations: request.tools.map((tool) => ({
                name: tool.name,
                description: tool.description,
                parametersJsonSchema: geminiSchema(tool.parameters),
              })),
            },
          ],
          toolConfig: { functionCallingConfig: { mode: "AUTO" } },
        }
      : {}),
    generationConfig: { maxOutputTokens: request.maxOutputTokens },
    // Keep this request out of the project's request logs ("store"), which paid projects otherwise keep for 55 days.
    store: false,
  };
}

function errorKind(status: number) {
  if (status === 429) return "rate_limited" as const;
  if (status === 504) return "timeout" as const;
  if (status === 400 || status === 401 || status === 403 || status === 404) return "rejected" as const;
  // 402: prepaid credit used up; 5xx: Google's side.
  return "unavailable" as const;
}

/** Gemini's own words, for the server log only: they name the problem, never the person's data. */
function describe(error: GeminiChunk["error"], fallback: string) {
  return `${error?.status ?? fallback}: ${error?.message ?? "no message"}`.slice(0, 300);
}

async function errorFromResponse(response: Response) {
  const body = (await response.json().catch(() => null)) as GeminiChunk | null;
  return new ProviderError(errorKind(response.status), `Gemini answered ${response.status} ${describe(body?.error, "")}`, response.status);
}

/** Merges streamed text into the previous part, so a turn's state stays short. */
function addPart(parts: GeminiPart[], part: GeminiPart) {
  const last = parts.at(-1);
  const plainText = (value: GeminiPart | undefined) =>
    value !== undefined && typeof value.text === "string" && !value.thought && !value.thoughtSignature && Object.keys(value).length === 1;
  if (plainText(part) && plainText(last)) last!.text += part.text!;
  else parts.push({ ...part });
}

export function createGeminiProvider({ apiKey, fetch: fetchImpl = fetch }: { apiKey: string; fetch?: typeof fetch }): Provider {
  return {
    name: "gemini",
    async *stream(request): AsyncGenerator<ProviderEvent> {
      let response: Response;
      try {
        response = await fetchImpl(`${API_BASE}/models/${encodeURIComponent(request.model)}:streamGenerateContent?alt=sse`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
          body: JSON.stringify(geminiRequestBody(request)),
          signal: request.signal,
        });
      } catch (error) {
        if (request.signal.aborted) throw error;
        throw new ProviderError("unavailable", `Couldn't reach Gemini: ${error instanceof Error ? error.message : "unknown error"}`);
      }
      if (!response.ok) throw await errorFromResponse(response);
      if (!response.body) throw new ProviderError("unavailable", "Gemini sent an empty response");

      const parts: GeminiPart[] = [];
      const usage = { inputTokens: 0, outputTokens: 0 };
      let finishReason: string | undefined;
      let calls = 0;
      let answered = false;

      try {
        for await (const data of readSseData(response.body)) {
          let chunk: GeminiChunk;
          try {
            chunk = JSON.parse(data) as GeminiChunk;
          } catch {
            throw new ProviderError("unavailable", "Gemini sent a malformed stream");
          }
          if (chunk.error) {
            throw new ProviderError(errorKind(chunk.error.code ?? 500), `Gemini stream error ${describe(chunk.error, "")}`, chunk.error.code);
          }
          if (chunk.promptFeedback?.blockReason) {
            throw new ProviderError("rejected", `Gemini blocked the request: ${chunk.promptFeedback.blockReason}`);
          }
          if (chunk.usageMetadata) {
            // Counts are running totals; the last chunk has the final ones. Thinking is billed as output.
            const meta = chunk.usageMetadata;
            usage.inputTokens = (meta.promptTokenCount ?? 0) + (meta.toolUsePromptTokenCount ?? 0);
            usage.outputTokens = (meta.candidatesTokenCount ?? 0) + (meta.thoughtsTokenCount ?? 0);
          }

          const candidate = chunk.candidates?.[0];
          for (const part of candidate?.content?.parts ?? []) {
            addPart(parts, part);
            if (part.functionCall) {
              const call: ToolCall = { id: part.functionCall.id ?? localCallId(calls), name: part.functionCall.name, args: part.functionCall.args ?? {} };
              calls += 1;
              answered = true;
              yield { type: "tool_call", call };
            } else if (part.text && !part.thought) {
              answered = true;
              yield { type: "text", text: part.text };
            }
          }
          if (candidate?.finishReason) finishReason = candidate.finishReason;
        }
      } catch (error) {
        if (request.signal.aborted || error instanceof ProviderError) throw error;
        throw new ProviderError("unavailable", `Gemini's stream broke off: ${error instanceof Error ? error.message : "unknown error"}`);
      }

      if (!finishReason) throw new ProviderError("unavailable", "Gemini's stream ended before the answer did");
      // SAFETY, RECITATION, MALFORMED_FUNCTION_CALL and the like, with nothing to show for it.
      if (!answered && finishReason !== "STOP" && finishReason !== "MAX_TOKENS") {
        throw new ProviderError("rejected", `Gemini stopped without an answer: ${finishReason}`);
      }
      yield { type: "finish", usage, providerState: { provider: "gemini", parts } satisfies GeminiState };
    },
  };
}
