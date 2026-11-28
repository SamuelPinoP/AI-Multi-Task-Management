import assert from "node:assert/strict";
import test from "node:test";
import { AGENT_TOOLS } from "../tools";
import { toolDefinition } from "../tools/define";
import { ProviderError, type AgentMessage, type ProviderEvent, type ProviderRequest } from "../types";
import { createGeminiProvider, GEMINI_DEFAULT_MODEL, geminiRequestBody, toGeminiContents } from "./gemini";

function sseResponse(chunks: unknown[], pieceLength = 7) {
  const bytes = new TextEncoder().encode(chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\r\n\r\n`).join(""));
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let at = 0; at < bytes.length; at += pieceLength) controller.enqueue(bytes.slice(at, at + pieceLength));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

function errorResponse(status: number, statusName: string, message: string) {
  return new Response(JSON.stringify({ error: { code: status, message, status: statusName } }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
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
    model: GEMINI_DEFAULT_MODEL,
    system: "Be brief.",
    messages: [{ role: "user", content: "What's due today?" }],
    tools: [{ name: "list_open_tasks", description: "Lists open tasks.", parameters: { type: "object", properties: {}, additionalProperties: false } }],
    maxOutputTokens: 512,
    signal: new AbortController().signal,
    ...overrides,
  };
}

async function collect(answer: Response | Error, overrides: Partial<ProviderRequest> = {}) {
  const { fetchImpl, calls } = fakeFetch(answer);
  const events: ProviderEvent[] = [];
  for await (const event of createGeminiProvider({ apiKey: "test-key", fetch: fetchImpl }).stream(request(overrides))) events.push(event);
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

const done = { candidates: [{ content: { parts: [] }, finishReason: "STOP" }] };

test("sends the conversation, the tools and the key the way Gemini expects", async () => {
  const { calls } = await collect(sseResponse([{ candidates: [{ content: { parts: [{ text: "Nothing." }] }, finishReason: "STOP" }] }]));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:streamGenerateContent?alt=sse");
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(calls[0].init.headers, { "Content-Type": "application/json", "x-goog-api-key": "test-key" }, "the key goes in a header, never the URL");
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), {
    systemInstruction: { parts: [{ text: "Be brief." }] },
    contents: [{ role: "user", parts: [{ text: "What's due today?" }] }],
    tools: [
      {
        functionDeclarations: [
          {
            name: "list_open_tasks",
            description: "Lists open tasks.",
            parametersJsonSchema: { type: "object", properties: {}, additionalProperties: false },
          },
        ],
      },
    ],
    toolConfig: { functionCallingConfig: { mode: "AUTO" } },
    generationConfig: { maxOutputTokens: 512 },
    store: false,
  });
});

test("without tools, sends no tool settings", async () => {
  const { calls } = await collect(sseResponse([{ candidates: [{ content: { parts: [{ text: "Hi." }] }, finishReason: "STOP" }] }]), { tools: [] });
  const body = JSON.parse(String(calls[0].init.body));
  assert.equal(body.tools, undefined);
  assert.equal(body.toolConfig, undefined);
});

test("a request that names the tool to call makes Gemini call that one (#540)", () => {
  assert.deepEqual(geminiRequestBody(request({ toolChoice: "list_open_tasks" })).toolConfig, {
    functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["list_open_tasks"] },
  });
});

test("gives Gemini each optional argument as one schema, its description beside its type, without the null and empty-text branches (#504)", () => {
  const tools = AGENT_TOOLS.map(toolDefinition);
  const body = geminiRequestBody(request({ tools }));
  assert.ok(body.tools);
  const declarations = body.tools[0].functionDeclarations;
  const property = (tool: string, name: string) =>
    (declarations.find((declaration) => declaration.name === tool)?.parametersJsonSchema.properties as Record<string, unknown>)[name];
  // Arguments whose descriptions went unread beside anyOf in the November 26 run.
  assert.deepEqual(property("list_projects", "status"), { type: "string", enum: ["ACTIVE", "COMPLETED", "ARCHIVED"], description: "Leave out for active projects." });
  assert.deepEqual(property("create_task", "parent"), {
    type: "string",
    maxLength: 200,
    description: "To make it a subtask: the parent task's title or id, or the ref create_task or create_ticket returned for a new one.",
  });
  assert.deepEqual(property("create_task", "dueDate"), { type: "string", description: "When it's due, YYYY-MM-DD." });
  for (const [index, tool] of tools.entries()) {
    const sent = JSON.stringify(declarations[index].parametersJsonSchema);
    assert.doesNotMatch(sent, /anyOf|"null"|"maxLength":0[,}]/, tool.name);
    assert.equal(sent.split('"description"').length, JSON.stringify(tool.parameters).split('"description"').length, `${tool.name} keeps every description`);
  }
});

test("streams text and tool calls, and keeps the thought signature for the next request", async () => {
  const signed = { functionCall: { id: "call-1", name: "list_open_tasks", args: { due: "today" } }, thoughtSignature: "c2lnbmF0dXJl" };
  const { events } = await collect(
    sseResponse([
      { candidates: [{ content: { role: "model", parts: [{ text: "Let me " }] } }] },
      { candidates: [{ content: { role: "model", parts: [{ text: "check." }] } }] },
      {
        candidates: [{ content: { role: "model", parts: [signed] }, finishReason: "STOP" }],
        usageMetadata: { promptTokenCount: 812, candidatesTokenCount: 20, thoughtsTokenCount: 15 },
      },
    ]),
  );
  assert.deepEqual(events, [
    { type: "text", text: "Let me " },
    { type: "text", text: "check." },
    { type: "tool_call", call: { id: "call-1", name: "list_open_tasks", args: { due: "today" } } },
    {
      type: "finish",
      usage: { inputTokens: 812, outputTokens: 35 },
      providerState: { provider: "gemini", parts: [{ text: "Let me check." }, signed] },
    },
  ]);
});

test("names unnamed tool calls itself, and leaves those names out when answering", async () => {
  const { events } = await collect(
    sseResponse([{ candidates: [{ content: { parts: [{ functionCall: { name: "list_open_tasks" } }] }, finishReason: "STOP" }] }]),
  );
  assert.deepEqual(events[0], { type: "tool_call", call: { id: "local-0", name: "list_open_tasks", args: {} } });
  const [toolTurn] = toGeminiContents([{ role: "tool", results: [{ callId: "local-0", name: "list_open_tasks", content: { data: [] } }] }]);
  assert.deepEqual(toolTurn, { role: "user", parts: [{ functionResponse: { name: "list_open_tasks", response: { data: [] } } }] });
});

test("sends earlier turns back: its own verbatim, the browser's as text, tool results as the user's", () => {
  const modelParts = [{ functionCall: { id: "call-1", name: "list_open_tasks", args: {} }, thoughtSignature: "sig" }];
  const history: AgentMessage[] = [
    { role: "user", content: "Hi" },
    { role: "assistant", content: "Hello! How can I help?" },
    { role: "user", content: "What's due?" },
    { role: "assistant", content: "", toolCalls: [{ id: "call-1", name: "list_open_tasks", args: {} }], providerState: { provider: "gemini", parts: modelParts } },
    { role: "tool", results: [{ callId: "call-1", name: "list_open_tasks", content: { note: "n", data: { tasks: [] } } }] },
    { role: "assistant", content: "From another provider", providerState: { provider: "anthropic", parts: ["x"] } },
  ];
  assert.deepEqual(toGeminiContents(history), [
    { role: "user", parts: [{ text: "Hi" }] },
    { role: "model", parts: [{ text: "Hello! How can I help?" }] },
    { role: "user", parts: [{ text: "What's due?" }] },
    { role: "model", parts: modelParts },
    { role: "user", parts: [{ functionResponse: { id: "call-1", name: "list_open_tasks", response: { note: "n", data: { tasks: [] } } } }] },
    { role: "model", parts: [{ text: "From another provider" }] },
  ]);
});

test("HTTP errors become provider errors of the right kind", async () => {
  const cases: Array<[number, string, ProviderError["kind"]]> = [
    [429, "RESOURCE_EXHAUSTED", "rate_limited"],
    [400, "INVALID_ARGUMENT", "rejected"],
    [403, "PERMISSION_DENIED", "rejected"],
    [404, "NOT_FOUND", "rejected"],
    [402, "RESOURCE_EXHAUSTED", "unavailable"],
    [500, "INTERNAL", "unavailable"],
    [503, "UNAVAILABLE", "unavailable"],
    [504, "DEADLINE_EXCEEDED", "timeout"],
  ];
  for (const [status, name, kind] of cases) {
    const error = await failure(errorResponse(status, name, "Something about the request"));
    assert.ok(error instanceof ProviderError, `${status}`);
    assert.equal(error.kind, kind, `${status}`);
    assert.equal(error.status, status);
    assert.match(error.message, new RegExp(`${status} ${name}: Something about the request`));
  }
});

test("an unreachable or broken stream is 'unavailable', never a hang", async () => {
  const unreachable = await failure(new TypeError("fetch failed"));
  assert.ok(unreachable instanceof ProviderError && unreachable.kind === "unavailable");

  const cut = await failure(sseResponse([{ candidates: [{ content: { parts: [{ text: "Half an ans" }] } }] }]));
  assert.ok(cut instanceof ProviderError && cut.kind === "unavailable");
  assert.match(cut.message, /ended before the answer did/);

  const garbled = await failure(new Response("data: {not json\n\n", { status: 200 }));
  assert.ok(garbled instanceof ProviderError && garbled.kind === "unavailable");

  const midway = await failure(sseResponse([{ error: { code: 503, status: "UNAVAILABLE", message: "Overloaded" } }]));
  assert.ok(midway instanceof ProviderError && midway.kind === "unavailable");
});

test("blocked or empty answers are 'rejected'; a cut-off answer still counts", async () => {
  const blocked = await failure(sseResponse([{ promptFeedback: { blockReason: "SAFETY" } }]));
  assert.ok(blocked instanceof ProviderError && blocked.kind === "rejected");

  const empty = await failure(sseResponse([{ candidates: [{ finishReason: "SAFETY" }] }]));
  assert.ok(empty instanceof ProviderError && empty.kind === "rejected");
  assert.match(empty.message, /SAFETY/);

  const { events } = await collect(sseResponse([{ candidates: [{ content: { parts: [{ text: "A long answ" }] }, finishReason: "MAX_TOKENS" }] }]));
  assert.equal(events.at(-1)?.type, "finish");
  const quiet = await collect(sseResponse([done]));
  assert.equal(quiet.events.length, 1, "an empty STOP is left to the agent loop to explain");
});

test("an aborted request stays an abort, so the loop can tell a deadline from an outage", async () => {
  const controller = new AbortController();
  controller.abort();
  const abort = new DOMException("The operation was aborted.", "AbortError");
  try {
    await collect(abort, { signal: controller.signal });
    assert.fail("expected the stream to fail");
  } catch (error) {
    assert.equal(error, abort);
  }
});
