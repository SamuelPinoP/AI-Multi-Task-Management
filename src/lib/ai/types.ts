// The AI assistant's vocabulary (#307), shared by the agent loop, the tools and
// every model provider. Features talk to models only through `Provider`; the
// concrete providers live in ./providers and nowhere else imports them.

/** One turn of the conversation, in the provider-neutral form the agent loop keeps. */
export type AgentMessage =
  | { role: "user"; content: string }
  | {
      role: "assistant";
      content: string;
      toolCalls?: ToolCall[];
      /**
       * The provider's own record of this turn, handed back to it verbatim on the next request.
       * Gemini needs this: its "thought signatures" must come back with the tool calls they belong
       * to. Other providers ignore it. Never sent to the browser.
       */
      providerState?: unknown;
    }
  | { role: "tool"; results: ToolResult[] };

export type ToolCall = {
  /** The provider's id for the call, or one made up here (see `localCallId`). */
  id: string;
  name: string;
  /** As the model wrote them: unvalidated until the tool's schema has checked them. */
  args: unknown;
};

export type ToolResult = {
  callId: string;
  name: string;
  /** What the model reads back. Workspace content inside it is wrapped as data (see ../prompt.ts). */
  content: Record<string, unknown>;
};

/** A tool as the model sees it: its input schema is JSON Schema made from the tool's Zod schema. */
export type ToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type TokenUsage = { inputTokens: number; outputTokens: number };

export type ProviderRequest = {
  model: string;
  system: string;
  messages: AgentMessage[];
  tools: ToolDefinition[];
  /**
   * The one tool the model must call, for a request that wants only that call, such as an
   * estimate (#540). Gemini and OpenAI-compatible providers force it. Anthropic's models think
   * before they answer, and its API refuses a forced tool with thinking, so there the prompt asks.
   */
  toolChoice?: string;
  maxOutputTokens: number;
  /** Aborts the request: the run's deadline passed, or the person went away. */
  signal: AbortSignal;
};

/** What a provider streams back for one request. `finish` comes last, exactly once. */
export type ProviderEvent =
  | { type: "text"; text: string }
  | { type: "tool_call"; call: ToolCall }
  | { type: "finish"; usage: TokenUsage; providerState?: unknown };

export interface Provider {
  /** "gemini", "fake"…: stored in the usage log. */
  readonly name: string;
  /** Sends the conversation and tool definitions; streams back text and tool calls. Throws ProviderError. */
  stream(request: ProviderRequest): AsyncIterable<ProviderEvent>;
}

/**
 * Why a provider request failed:
 * - `rate_limited`: HTTP 429, too many requests for the key's quota;
 * - `unavailable`: the provider is down, overloaded or out of credit (5xx, 402);
 * - `timeout`: no complete answer before the deadline;
 * - `rejected`: the request was refused (400, 403, 404): a bad key, model or request.
 */
export type ProviderErrorKind = "rate_limited" | "unavailable" | "timeout" | "rejected";

export class ProviderError extends Error {
  readonly kind: ProviderErrorKind;
  /** The provider's HTTP status, when there was one. */
  readonly status?: number;

  constructor(kind: ProviderErrorKind, message: string, status?: number) {
    super(message);
    this.name = "ProviderError";
    this.kind = kind;
    this.status = status;
  }
}

/** Ids the agent makes up for providers that don't name their tool calls. */
export function localCallId(index: number) {
  return `local-${index}`;
}

export function isLocalCallId(id: string) {
  return id.startsWith("local-");
}
