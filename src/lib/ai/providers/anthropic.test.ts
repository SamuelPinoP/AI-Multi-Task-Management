import assert from "node:assert/strict";
import test from "node:test";
import { ProviderError, type AgentMessage, type ProviderEvent, type ProviderRequest } from "../types";
import { ANTHROPIC_API_VERSION, ANTHROPIC_DEFAULT_MODEL, createAnthropicProvider, toAnthropicMessages, type AnthropicEffort } from "./anthropic";

/** Server-sent events as Anthropic streams them, split into small pieces to exercise the reader. */
function sseResponse(events: Array<Record<string, unknown>>, pieceLength = 9) {
  const text = events.map((event) => `event: ${String(event.type)}\ndata: ${JSON.stringify(event)}\n\n`).join("");
  const bytes = new TextEncoder().encode(text);
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let at = 0; at < bytes.length; at += pieceLength) controller.enqueue(bytes.slice(at, at + pieceLength));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

function errorResponse(status: number, type: string, message: string) {
  return new Response(JSON.stringify({ type: "error", error: { type, message } }), { status, headers: { "Content-Type": "application/json" } });
}

function fakeFetch(answer: Response | Error) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = (async (url: string | URL, init: RequestInit) => {
    calls.push({ url: String(url), init });
    if (answer instanceof Error) throw answer;
    return answer;
  }) as typeof fetch;
  return { fetchImpl, calls };
}

function request(overrides: Partial<ProviderRequest> = {}): ProviderRequest {
  return {
    model: ANTHROPIC_DEFAULT_MODEL,
    system: "Be brief.",
    messages: [{ role: "user", content: "What's due today?" }],
    tools: [{ name: "list_open_tasks", description: "Lists open tasks.", parameters: { type: "object", properties: {}, additionalProperties: false } }],
    maxOutputTokens: 512,
    signal: new AbortController().signal,
    ...overrides,
  };
}

async function collect(answer: Response | Error, overrides: Partial<ProviderRequest> = {}, effort?: AnthropicEffort | null) {
  const { fetchImpl, calls } = fakeFetch(answer);
  const events: ProviderEvent[] = [];
  const provider = createAnthropicProvider({ apiKey: "test-key", fetch: fetchImpl, ...(effort !== undefined ? { effort } : {}) });
  for await (const event of provider.stream(request(overrides))) events.push(event);
  return { events, calls };
}

async function failure(answer: Response | Error) {
  try {
    await collect(answer);
  } catch (error) {
    return error;
  }
  assert.fail("expected the stream to fail");
}

const start = { type: "message_start", message: { usage: { input_tokens: 40, cache_read_input_tokens: 2, output_tokens: 1 } } };
const stop = (reason: string, outputTokens = 9) => [
  { type: "message_delta", delta: { stop_reason: reason }, usage: { output_tokens: outputTokens } },
  { type: "message_stop" },
];

test("sends the conversation, the tools and the key the way Claude expects", async () => {
  const { calls } = await collect(
    sseResponse([
      start,
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Nothing." } },
      { type: "content_block_stop", index: 0 },
      ...stop("end_turn"),
    ]),
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.anthropic.com/v1/messages");
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(calls[0].init.headers, { "Content-Type": "application/json", "x-api-key": "test-key", "anthropic-version": ANTHROPIC_API_VERSION });
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), {
    model: "claude-haiku-5-5",
    max_tokens: 512,
    system: "Be brief.",
    messages: [{ role: "user", content: "What's due today?" }],
    tools: [{ name: "list_open_tasks", description: "Lists open tasks.", input_schema: { type: "object", properties: {}, additionalProperties: false } }],
    output_config: { effort: "low" },
    stream: true,
  });
});

test("leaves the effort out for models without it, and the tools when there are none", async () => {
  const done = sseResponse([start, { type: "content_block_start", index: 0, content_block: { type: "text", text: "Hi" } }, { type: "content_block_stop", index: 0 }, ...stop("end_turn")]);
  const { events, calls } = await collect(done, { tools: [] }, null);
  assert.deepEqual(events[0], { type: "text", text: "Hi" }, "text that comes whole in the block's start still streams");
  const body = JSON.parse(String(calls[0].init.body));
  assert.equal("output_config" in body, false);
  assert.equal("tools" in body, false);
});

test("leaves the tool to the model even when the request names one: Claude thinks first (#540)", async () => {
  const done = sseResponse([start, { type: "content_block_start", index: 0, content_block: { type: "text", text: "Hi" } }, { type: "content_block_stop", index: 0 }, ...stop("end_turn")]);
  const { calls } = await collect(done, { toolChoice: "list_open_tasks" });
  const body = JSON.parse(String(calls[0].init.body));
  assert.equal("tool_choice" in body, false);
  assert.deepEqual(body.output_config, { effort: "low" });
});

test("streams the answer's text and reports the tokens, cached ones included", async () => {
  const { events } = await collect(
    sseResponse([
      start,
      { type: "ping" },
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Two tasks " } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "are due." } },
      { type: "content_block_stop", index: 0 },
      ...stop("end_turn", 12),
    ]),
  );
  assert.deepEqual(events.slice(0, 2), [
    { type: "text", text: "Two tasks " },
    { type: "text", text: "are due." },
  ]);
  assert.deepEqual(events[2], {
    type: "finish",
    usage: { inputTokens: 42, outputTokens: 12 },
    providerState: { provider: "anthropic", content: [{ type: "text", text: "Two tasks are due." }] },
  });
});

test("assembles a tool call from pieces of JSON, keeping the thinking before it whole", async () => {
  const { events } = await collect(
    sseResponse([
      start,
      { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "", signature: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "sig-1" } },
      { type: "content_block_stop", index: 0 },
      { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "toolu_01", name: "list_open_tasks", input: {} } },
      { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"du' } },
      { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: 'e": "today"}' } },
      { type: "content_block_stop", index: 1 },
      ...stop("tool_use"),
    ]),
  );
  assert.deepEqual(events[0], { type: "tool_call", call: { id: "toolu_01", name: "list_open_tasks", args: { due: "today" } } });
  assert.deepEqual(events[1], {
    type: "finish",
    usage: { inputTokens: 42, outputTokens: 9 },
    providerState: {
      provider: "anthropic",
      content: [
        { type: "thinking", thinking: "", signature: "sig-1" },
        { type: "tool_use", id: "toolu_01", name: "list_open_tasks", input: { due: "today" } },
      ],
    },
  });
});

test("unreadable tool input reaches the agent as it was, for validation to reject", async () => {
  const { events } = await collect(
    sseResponse([
      start,
      { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_02", name: "list_open_tasks", input: {} } },
      { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"due": tod' } },
      { type: "content_block_stop", index: 0 },
      ...stop("tool_use"),
    ]),
  );
  assert.deepEqual(events[0], { type: "tool_call", call: { id: "toolu_02", name: "list_open_tasks", args: '{"due": tod' } });
});

test("sends its own turns back unchanged, tool results as the person's turn, and stored answers as text", () => {
  const state = {
    provider: "anthropic",
    content: [
      { type: "thinking", thinking: "", signature: "sig-1" },
      { type: "tool_use", id: "toolu_01", name: "list_open_tasks", input: { due: "today" } },
    ],
  };
  const messages: AgentMessage[] = [
    { role: "user", content: "What did I ask?" },
    { role: "assistant", content: "Your tasks." },
    { role: "user", content: "What's due today?" },
    { role: "assistant", content: "", toolCalls: [{ id: "toolu_01", name: "list_open_tasks", args: { due: "today" } }], providerState: state },
    { role: "tool", results: [{ callId: "toolu_01", name: "list_open_tasks", content: { note: "n", data: { total: 0 } } }] },
    { role: "assistant", content: "Checking.", toolCalls: [{ id: "local-0", name: "task_stats", args: {} }] },
  ];
  assert.deepEqual(toAnthropicMessages(messages), [
    { role: "user", content: "What did I ask?" },
    { role: "assistant", content: [{ type: "text", text: "Your tasks." }] },
    { role: "user", content: "What's due today?" },
    { role: "assistant", content: state.content },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_01", content: '{"note":"n","data":{"total":0}}' }] },
    {
      role: "assistant",
      content: [
        { type: "text", text: "Checking." },
        { type: "tool_use", id: "local-0", name: "task_stats", input: {} },
      ],
    },
  ]);
});

test("HTTP errors map to the agent's kinds", async () => {
  const cases: Array<[number, string, ProviderError["kind"]]> = [
    [429, "rate_limit_error", "rate_limited"],
    [529, "overloaded_error", "unavailable"],
    [500, "api_error", "unavailable"],
    [402, "billing_error", "unavailable"],
    [504, "timeout_error", "timeout"],
    [400, "invalid_request_error", "rejected"],
    [401, "authentication_error", "rejected"],
    [404, "not_found_error", "rejected"],
    [413, "request_too_large", "rejected"],
  ];
  for (const [status, type, kind] of cases) {
    const error = await failure(errorResponse(status, type, "Something happened."));
    assert.ok(error instanceof ProviderError, String(status));
    assert.equal(error.kind, kind, String(status));
    assert.equal(error.status, status);
    assert.match(error.message, new RegExp(`Anthropic answered ${status} ${type}: Something happened.`));
  }
});

test("failures midway end the request with the right kind", async () => {
  const overloaded = await failure(sseResponse([start, { type: "error", error: { type: "overloaded_error", message: "Overloaded" } }]));
  assert.ok(overloaded instanceof ProviderError);
  assert.equal(overloaded.kind, "unavailable");
  const limited = await failure(sseResponse([start, { type: "error", error: { type: "rate_limit_error", message: "Slow down" } }]));
  assert.equal((limited as ProviderError).kind, "rate_limited");

  const cut = await failure(sseResponse([start, { type: "content_block_start", index: 0, content_block: { type: "text", text: "Half" } }]));
  assert.match((cut as ProviderError).message, /ended before the answer did/);
  const refused = await failure(sseResponse([start, ...stop("refusal")]));
  assert.equal((refused as ProviderError).kind, "rejected");

  const garbled = new Response(new TextEncoder().encode("data: {not json\n\n"), { status: 200 });
  assert.match((await failure(garbled) as ProviderError).message, /malformed stream/);
  const offline = await failure(new TypeError("fetch failed"));
  assert.equal((offline as ProviderError).kind, "unavailable");
});

test("a request aborted by the deadline or the person leaving fails as an abort, not a provider error", async () => {
  const controller = new AbortController();
  controller.abort(new Error("The agent's deadline passed."));
  const { fetchImpl } = fakeFetch(new DOMException("aborted", "AbortError"));
  const provider = createAnthropicProvider({ apiKey: "k", fetch: fetchImpl });
  await assert.rejects(
    (async () => {
      for await (const event of provider.stream(request({ signal: controller.signal }))) void event;
    })(),
    (error: unknown) => !(error instanceof ProviderError),
  );
});
