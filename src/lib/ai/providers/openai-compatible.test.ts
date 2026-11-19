import assert from "node:assert/strict";
import test from "node:test";
import { ProviderError, type AgentMessage, type ProviderEvent, type ProviderRequest } from "../types";
import { createOpenAiCompatibleProvider, GROQ_BASE_URL, GROQ_DEFAULT_MODEL, toChatMessages } from "./openai-compatible";

/** Server-sent events as Chat Completions streams them, ending with [DONE], split into small pieces. */
function sseResponse(chunks: unknown[], { pieceLength = 7, done = true } = {}) {
  const lines = chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`);
  if (done) lines.push("data: [DONE]\n\n");
  const bytes = new TextEncoder().encode(lines.join(""));
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let at = 0; at < bytes.length; at += pieceLength) controller.enqueue(bytes.slice(at, at + pieceLength));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

function errorResponse(status: number, message: string) {
  return new Response(JSON.stringify({ error: { message, type: "invalid_request_error", code: "some_code" } }), { status, headers: { "Content-Type": "application/json" } });
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
    model: GROQ_DEFAULT_MODEL,
    system: "Be brief.",
    messages: [{ role: "user", content: "What's due today?" }],
    tools: [{ name: "list_open_tasks", description: "Lists open tasks.", parameters: { type: "object", properties: {}, additionalProperties: false } }],
    maxOutputTokens: 512,
    signal: new AbortController().signal,
    ...overrides,
  };
}

function groq(fetchImpl: typeof fetch) {
  return createOpenAiCompatibleProvider({ name: "groq", baseUrl: GROQ_BASE_URL, apiKey: "test-key", fetch: fetchImpl });
}

async function collect(answer: Response | Error, overrides: Partial<ProviderRequest> = {}) {
  const { fetchImpl, calls } = fakeFetch(answer);
  const events: ProviderEvent[] = [];
  for await (const event of groq(fetchImpl).stream(request(overrides))) events.push(event);
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

const text = (content: string) => ({ choices: [{ index: 0, delta: { content } }] });
const finish = (reason: string) => ({ choices: [{ index: 0, delta: {}, finish_reason: reason }] });
const usage = (prompt: number, completion: number) => ({ choices: [], usage: { prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion } });

test("sends the conversation, the tools and the key the way Chat Completions expects", async () => {
  const { calls } = await collect(sseResponse([text("Nothing."), finish("stop"), usage(30, 4)]));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.groq.com/openai/v1/chat/completions");
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(calls[0].init.headers, { "Content-Type": "application/json", Authorization: "Bearer test-key" }, "the key goes in a header, never the URL");
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), {
    model: "openai/gpt-oss-120b",
    messages: [
      { role: "system", content: "Be brief." },
      { role: "user", content: "What's due today?" },
    ],
    tools: [{ type: "function", function: { name: "list_open_tasks", description: "Lists open tasks.", parameters: { type: "object", properties: {}, additionalProperties: false } } }],
    tool_choice: "auto",
    max_completion_tokens: 512,
    stream: true,
    stream_options: { include_usage: true },
  });

  const { calls: noTools } = await collect(sseResponse([text("Hi"), finish("stop")]), { tools: [] });
  const body = JSON.parse(String(noTools[0].init.body));
  assert.equal("tools" in body, false);
  assert.equal("tool_choice" in body, false, "tool_choice without tools is an error");
});

test("streams the answer's text and reports the tokens from the last chunk", async () => {
  const { events } = await collect(sseResponse([{ choices: [{ index: 0, delta: { role: "assistant", content: "" } }] }, text("Two tasks "), text("are due."), finish("stop"), usage(120, 9)]));
  assert.deepEqual(events, [
    { type: "text", text: "Two tasks " },
    { type: "text", text: "are due." },
    { type: "finish", usage: { inputTokens: 120, outputTokens: 9 } },
  ]);
});

test("reads Groq's usage from x_groq when the standard field is missing", async () => {
  const { events } = await collect(sseResponse([text("Hi"), { choices: [{ index: 0, delta: {}, finish_reason: "stop" }], x_groq: { id: "req_1", usage: { prompt_tokens: 50, completion_tokens: 2 } } }]));
  assert.deepEqual(events.at(-1), { type: "finish", usage: { inputTokens: 50, outputTokens: 2 } });
});

test("assembles tool calls from pieces, by index, in order", async () => {
  const { events } = await collect(
    sseResponse([
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 1, id: "call_b", type: "function", function: { name: "task_stats", arguments: "" } }] } }] },
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_a", type: "function", function: { name: "list_open_tasks", arguments: '{"du' } }] } }] },
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: 'e":"today"}' } }] } }] },
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 1, function: { arguments: "{}" } }] } }] },
      finish("tool_calls"),
      usage(80, 20),
    ]),
  );
  assert.deepEqual(events, [
    { type: "tool_call", call: { id: "call_a", name: "list_open_tasks", args: { due: "today" } } },
    { type: "tool_call", call: { id: "call_b", name: "task_stats", args: {} } },
    { type: "finish", usage: { inputTokens: 80, outputTokens: 20 } },
  ]);
});

test("names unnamed tool calls, and passes unreadable arguments on for validation to reject", async () => {
  const { events } = await collect(
    sseResponse([
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { name: "list_open_tasks", arguments: '{"due": tod' } }] } }] },
      finish("tool_calls"),
    ]),
  );
  assert.deepEqual(events[0], { type: "tool_call", call: { id: "local-0", name: "list_open_tasks", args: '{"due": tod' } });
});

test("sends history in Chat Completions' shape: one message per tool result, arguments as JSON text", () => {
  const messages: AgentMessage[] = [
    { role: "user", content: "What's due today?" },
    {
      role: "assistant",
      content: "",
      toolCalls: [
        { id: "call_a", name: "list_open_tasks", args: { due: "today" } },
        { id: "call_b", name: "task_stats", args: '{"bad' },
      ],
    },
    {
      role: "tool",
      results: [
        { callId: "call_a", name: "list_open_tasks", content: { data: { total: 0 } } },
        { callId: "call_b", name: "task_stats", content: { error: "Invalid arguments" } },
      ],
    },
    { role: "assistant", content: "Nothing is due." },
  ];
  assert.deepEqual(toChatMessages("Be brief.", messages), [
    { role: "system", content: "Be brief." },
    { role: "user", content: "What's due today?" },
    {
      role: "assistant",
      content: null,
      tool_calls: [
        { id: "call_a", type: "function", function: { name: "list_open_tasks", arguments: '{"due":"today"}' } },
        { id: "call_b", type: "function", function: { name: "task_stats", arguments: '{"bad' } },
      ],
    },
    { role: "tool", tool_call_id: "call_a", content: '{"data":{"total":0}}' },
    { role: "tool", tool_call_id: "call_b", content: '{"error":"Invalid arguments"}' },
    { role: "assistant", content: "Nothing is due." },
  ]);
});

test("HTTP errors map to the agent's kinds", async () => {
  const cases: Array<[number, ProviderError["kind"]]> = [
    [429, "rate_limited"],
    [498, "unavailable"],
    [500, "unavailable"],
    [503, "unavailable"],
    [504, "timeout"],
    [400, "rejected"],
    [401, "rejected"],
    [404, "rejected"],
    [413, "rejected"],
    [422, "rejected"],
  ];
  for (const [status, kind] of cases) {
    const error = await failure(errorResponse(status, "Something happened."));
    assert.ok(error instanceof ProviderError, String(status));
    assert.equal(error.kind, kind, String(status));
    assert.equal(error.status, status);
    assert.match(error.message, new RegExp(`^groq answered ${status} invalid_request_error: Something happened\\.$`));
  }
  const unreadable = await failure(new Response("<html>Bad gateway</html>", { status: 502 }));
  assert.match((unreadable as ProviderError).message, /^groq answered 502 error: no message$/);
});

test("failures midway end the request with the right kind", async () => {
  const midway = await failure(sseResponse([text("Half"), { error: { message: "Service overloaded", type: "server_error" } }]));
  assert.ok(midway instanceof ProviderError);
  assert.equal(midway.kind, "unavailable");
  assert.match(midway.message, /server_error: Service overloaded/);
  const groqError = await failure(sseResponse([text("Half"), { choices: [], x_groq: { error: "over capacity" } }]));
  assert.equal((groqError as ProviderError).kind, "unavailable");

  const cut = await failure(sseResponse([text("Half")], { done: false }));
  assert.match((cut as ProviderError).message, /ended before the answer did/);
  const filtered = await failure(sseResponse([finish("content_filter")]));
  assert.equal((filtered as ProviderError).kind, "rejected");

  const garbled = new Response(new TextEncoder().encode("data: {not json\n\n"), { status: 200 });
  assert.match((await failure(garbled) as ProviderError).message, /malformed stream/);
  const offline = await failure(new TypeError("fetch failed"));
  assert.equal((offline as ProviderError).kind, "unavailable");
  assert.match((offline as ProviderError).message, /Couldn't reach groq: fetch failed/);
});

test("an answer cut off by the token limit is still an answer, as with Gemini", async () => {
  const { events } = await collect(sseResponse([text("Two tasks are"), finish("length"), usage(60, 512)]));
  assert.deepEqual(events, [
    { type: "text", text: "Two tasks are" },
    { type: "finish", usage: { inputTokens: 60, outputTokens: 512 } },
  ]);
});

test("a request aborted by the deadline or the person leaving fails as an abort, not a provider error", async () => {
  const controller = new AbortController();
  controller.abort(new Error("The agent's deadline passed."));
  const { fetchImpl } = fakeFetch(new DOMException("aborted", "AbortError"));
  await assert.rejects(
    (async () => {
      for await (const event of groq(fetchImpl).stream(request({ signal: controller.signal }))) void event;
    })(),
    (error: unknown) => !(error instanceof ProviderError),
  );
});
