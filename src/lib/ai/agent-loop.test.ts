import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import {
  AGENT_LIMITS,
  EMPTY_ANSWER_MESSAGE,
  INVALID_ARGUMENTS_MESSAGE,
  runAgentLoop,
  STEP_LIMIT_MESSAGE,
  type LoopEvent,
} from "./agent-loop";
import { DATA_NOTE } from "./prompt";
import { createScriptedProvider, type ScriptedTurn } from "./providers/fake";
import { defineTool, toolDefinition, type AgentTool, type ToolContext, type ToolDb } from "./tools/define";
import { ProviderError, type AgentMessage } from "./types";

const context: ToolContext = {
  userId: "user-from-session",
  now: new Date(2026, 10, 16, 9, 30),
  realNow: new Date("2026-11-16T14:30:00.000Z"),
  timeZone: "America/New_York",
  db: {} as ToolDb,
};

function itemsTool(runs: Array<{ count: number; userId: string }>, fail = false) {
  return defineTool({
    name: "list_items",
    label: "Listing items",
    description: "Lists the person's items.",
    input: z.strictObject({ count: z.number().int().min(1).max(3).describe("How many.") }),
    access: "read",
    async run({ count }, toolContext) {
      runs.push({ count, userId: toolContext.userId });
      if (fail) throw new Error("database down");
      return {
        data: { items: Array.from({ length: count }, (_, index) => ({ title: `Item ${index + 1}` })) },
        sources: [{ kind: "task", id: "task-1", title: "Item 1", href: "/tasks?task=task-1" }],
      };
    },
  });
}

async function run(turns: ScriptedTurn[], options: { tools?: AgentTool[]; signal?: AbortSignal; deadlineMs?: number; messages?: AgentMessage[] } = {}) {
  const runs: Array<{ count: number; userId: string }> = [];
  const provider = createScriptedProvider(turns);
  const events: LoopEvent[] = [];
  const result = await runAgentLoop({
    provider,
    model: "test-model",
    system: "The system prompt",
    messages: options.messages ?? [{ role: "user", content: "What are my items?" }],
    tools: options.tools ?? [itemsTool(runs)],
    context,
    signal: options.signal ?? new AbortController().signal,
    limits: { ...AGENT_LIMITS, deadlineMs: options.deadlineMs ?? AGENT_LIMITS.deadlineMs },
    emit: (event) => events.push(event),
  });
  return { provider, events, result, runs };
}

const texts = (events: LoopEvent[]) => events.filter((event) => event.type === "text").map((event) => event.text).join("");

test("streams a direct answer from one model request", async () => {
  const { provider, events, result } = await run([{ text: "You have no items.", usage: { inputTokens: 120, outputTokens: 8 } }]);
  assert.equal(result.outcome, "answered");
  assert.equal(result.modelRequests, 1);
  assert.deepEqual(result.usage, { inputTokens: 120, outputTokens: 8 });
  assert.equal(events.filter((event) => event.type === "text").length, 2, "the text arrives in pieces");
  assert.equal(texts(events), "You have no items.");
  assert.equal(provider.requests[0].system, "The system prompt");
  assert.equal(provider.requests[0].model, "test-model");
  assert.deepEqual(provider.requests[0].tools.map((tool) => tool.name), ["list_items"]);
});

test("runs a tool with the session's user and hands its result back as data", async () => {
  const { provider, events, result, runs } = await run([
    { toolCalls: [{ name: "list_items", args: { count: 2 } }], usage: { inputTokens: 100, outputTokens: 10 } },
    { text: "Item 1 and Item 2.", usage: { inputTokens: 150, outputTokens: 12 } },
  ]);
  assert.equal(result.outcome, "answered");
  assert.equal(result.modelRequests, 2);
  assert.deepEqual(result.toolCalls, ["list_items"]);
  assert.deepEqual(result.usage, { inputTokens: 250, outputTokens: 22 });
  assert.deepEqual(runs, [{ count: 2, userId: "user-from-session" }]);
  assert.deepEqual(
    events.map((event) => event.type),
    ["tool", "sources", "text", "text"],
  );
  assert.deepEqual(events[0], { type: "tool", name: "list_items", label: "Listing items" });

  const [, assistant, tool] = provider.requests[1].messages;
  assert.equal(assistant.role, "assistant");
  assert.deepEqual(assistant.role === "assistant" && assistant.providerState, { provider: "scripted", turn: 1 }, "the provider's own state comes back");
  assert.equal(tool.role, "tool");
  assert.deepEqual(tool.role === "tool" && tool.results[0].content, {
    note: DATA_NOTE,
    data: { items: [{ title: "Item 1" }, { title: "Item 2" }] },
  });
});

test("tells the model once about invalid arguments, which never reach the tool", async () => {
  const { provider, result, runs } = await run([
    { toolCalls: [{ name: "list_items", args: { count: "lots" } }] },
    { toolCalls: [{ name: "list_items", args: { count: 1 } }] },
    { text: "One item." },
  ]);
  assert.equal(result.outcome, "answered");
  assert.equal(result.validationFailures, 1);
  assert.deepEqual(runs, [{ count: 1, userId: "user-from-session" }]);
  const firstResult = provider.requests[1].messages.at(-1);
  assert.ok(firstResult?.role === "tool");
  assert.match(String(firstResult.results[0].content.error), /^Invalid arguments\. .*count/);
});

test("ends the message on a second invalid call", async () => {
  const { events, result, runs } = await run([
    { toolCalls: [{ name: "list_items", args: { count: 9 } }] },
    { toolCalls: [{ name: "list_items", args: {} }] },
  ]);
  assert.equal(result.outcome, "invalid_arguments");
  assert.equal(result.validationFailures, 2);
  assert.equal(result.modelRequests, 2);
  assert.deepEqual(runs, []);
  assert.equal(texts(events), INVALID_ARGUMENTS_MESSAGE);
});

test("a model can't choose whose data a tool reads: unknown arguments are refused", async () => {
  const { provider, runs } = await run([
    { toolCalls: [{ name: "list_items", args: { count: 1, userId: "someone-else" } }] },
    { text: "Sorry." },
  ]);
  assert.deepEqual(runs, []);
  const toolTurn = provider.requests[1].messages.at(-1);
  assert.ok(toolTurn?.role === "tool");
  assert.match(String(toolTurn.results[0].content.error), /userId/);
});

test("an unknown tool counts as an invalid call and lists the real ones", async () => {
  const { provider, result } = await run([{ toolCalls: [{ name: "delete_everything", args: {} }] }, { text: "I can't do that." }]);
  assert.equal(result.validationFailures, 1);
  const toolTurn = provider.requests[1].messages.at(-1);
  assert.ok(toolTurn?.role === "tool");
  assert.equal(toolTurn.results[0].content.error, "There is no tool named delete_everything. The tools are: list_items.");
});

test("tools marked runsFirst run first in their round, and the model gets the results in its own order (#310)", async () => {
  const ran: string[] = [];
  const proposer = (name: string, runsFirst?: boolean) =>
    defineTool({
      name,
      label: name,
      description: name,
      input: z.strictObject({}),
      access: "propose",
      runsFirst,
      async run() {
        ran.push(name);
        return { data: { tool: name }, sources: [] };
      },
    });
  const { provider, result } = await run(
    [{ toolCalls: [{ name: "create_task", args: {} }, { name: "create_project", args: {} }] }, { text: "Here's what I'd add." }],
    { tools: [proposer("create_task"), proposer("create_project", true)] },
  );
  assert.equal(result.outcome, "answered");
  assert.deepEqual(ran, ["create_project", "create_task"], "the new project is in the draft before its task looks for it");
  const toolTurn = provider.requests[1].messages.at(-1);
  assert.ok(toolTurn?.role === "tool");
  assert.deepEqual(
    toolTurn.results.map((found) => found.content.data),
    [{ tool: "create_task" }, { tool: "create_project" }],
  );
});

test("stops after the step limit without running tools it can't report on", async () => {
  const always = { toolCalls: [{ name: "list_items", args: { count: 1 } }] };
  const { events, result, runs } = await run(Array.from({ length: AGENT_LIMITS.maxModelRequests }, () => always));
  assert.equal(result.outcome, "step_limit");
  assert.equal(result.modelRequests, AGENT_LIMITS.maxModelRequests);
  assert.equal(runs.length, AGENT_LIMITS.maxModelRequests - 1);
  assert.equal(texts(events), STEP_LIMIT_MESSAGE);
});

test("a provider error ends the loop at once with the error", async () => {
  const { result } = await run([{ error: new ProviderError("rate_limited", "Too many requests", 429) }]);
  assert.equal(result.outcome, "provider_error");
  assert.equal(result.error?.kind, "rate_limited");
  assert.equal(result.error?.status, 429);
  assert.equal(result.modelRequests, 1);
});

test("a provider that never answers is stopped by the deadline", async () => {
  const started = Date.now();
  const { result } = await run([{ hang: true }], { deadlineMs: 50 });
  assert.equal(result.outcome, "timed_out");
  assert.ok(Date.now() - started < 2_000, "it doesn't hang");
});

test("stops when the person goes away", async () => {
  const leaving = new AbortController();
  setTimeout(() => leaving.abort(), 20);
  const { result } = await run([{ hang: true }], { signal: leaving.signal });
  assert.equal(result.outcome, "cancelled");
});

test("a failing tool is reported to the model, which answers without it", async () => {
  const runs: Array<{ count: number; userId: string }> = [];
  const original = console.error;
  const logged: unknown[] = [];
  console.error = (...args: unknown[]) => logged.push(args);
  try {
    const { provider, result } = await run(
      [{ toolCalls: [{ name: "list_items", args: { count: 1 } }] }, { text: "The lookup failed." }],
      { tools: [itemsTool(runs, true)] },
    );
    assert.equal(result.outcome, "answered");
    const toolTurn = provider.requests[1].messages.at(-1);
    assert.ok(toolTurn?.role === "tool");
    assert.match(String(toolTurn.results[0].content.error), /lookup failed/);
    assert.deepEqual(logged, [["agent_tool_failed", { tool: "list_items", error: "Error" }]]);
  } finally {
    console.error = original;
  }
});

test("an empty answer still tells the person something", async () => {
  const { events, result } = await run([{ text: "" }]);
  assert.equal(result.outcome, "answered");
  assert.equal(texts(events), EMPTY_ANSWER_MESSAGE);
});

test("a tool is described to the model by its Zod schema, as JSON Schema", () => {
  const definition = toolDefinition(itemsTool([]));
  assert.equal(definition.name, "list_items");
  assert.equal(definition.description, "Lists the person's items.");
  assert.equal(definition.parameters.$schema, undefined);
  assert.equal(definition.parameters.type, "object");
  assert.equal(definition.parameters.additionalProperties, false);
  assert.deepEqual(definition.parameters.required, ["count"]);
  assert.deepEqual(definition.parameters.properties, {
    count: { type: "integer", minimum: 1, maximum: 3, description: "How many." },
  });
});
