import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { AGENT_LIMITS, type AgentLimits } from "./agent-loop";
import { allowanceFor } from "./allowance";
import {
  answerMode,
  MAX_MESSAGE_CHARS,
  MODEL_HISTORY,
  modelMessages,
  OUTDATED_PAGE_MESSAGE,
  parseChatRequest,
  runAgentChat,
  type ChatEvent,
  type ChatInput,
  type StoredAnswer,
} from "./chat";
import type { ChatSummary } from "./chat-history-core";
import type { AgentConfig } from "./config";
import type { ProposalStep } from "./proposals";
import { createScriptedProvider, type ScriptedTurn } from "./providers/fake";
import { defineTool, type AgentTool, type ToolContext, type ToolDb } from "./tools/define";
import { ProviderError } from "./types";

const context: ToolContext = {
  userId: "user-1",
  now: new Date(2026, 10, 16, 9, 30),
  realNow: new Date("2026-11-16T14:30:00.000Z"),
  timeZone: "America/New_York",
  db: {} as ToolDb,
};

const tool = defineTool({
  name: "list_items",
  label: "Listing items",
  description: "Lists items.",
  input: z.strictObject({}),
  access: "read",
  async run() {
    return { data: { items: [{ title: "Pay rent" }] }, sources: [{ kind: "task", id: "t1", title: "Pay rent", href: "/tasks?task=t1" }] };
  },
});

const PLANNER = { text: "- Pay rent: Overdue by 2 days.", sources: [{ kind: "task" as const, id: "t1", title: "Pay rent", href: "/tasks?task=t1" }] };
const ask = (question = "What's due?"): ChatInput => ({ question, history: [] });
const STORED: ChatSummary = { id: "chat-1", title: "What's due?", updatedAt: "2026-11-16T14:30:02.000Z" };
const PROPOSAL_EXPIRES = new Date("2026-11-16T15:30:02.000Z");

async function chat({
  turns = [],
  used = { user: 0, app: 0 },
  config = {},
  noProvider = false,
  usedToday,
  limits,
  input = ask(),
  country = null,
  signal = new AbortController().signal,
  save,
  tools = [tool],
}: {
  turns?: ScriptedTurn[];
  used?: { user: number; app: number };
  config?: Partial<AgentConfig>;
  noProvider?: boolean;
  usedToday?: () => Promise<{ user: number; app: number }>;
  limits?: AgentLimits;
  input?: ChatInput;
  country?: string | null;
  signal?: AbortSignal;
  save?: (answer: StoredAnswer) => Promise<ChatSummary | null>;
  tools?: AgentTool[];
}) {
  const provider = createScriptedProvider(turns);
  const events: ChatEvent[] = [];
  const saved: StoredAnswer[] = [];
  const proposed: ProposalStep[][] = [];
  let plannerCalls = 0;
  const result = await runAgentChat(
    input,
    {
      config: { provider: "scripted", model: "test-model", caps: { userDailyRequests: 10, appDailyRequests: 100 }, freeTier: true, disabledReason: null, ...config },
      provider: noProvider ? null : provider,
      tools,
      context,
      country,
      usedToday: usedToday ?? (async () => used),
      planner: async () => {
        plannerCalls += 1;
        return PLANNER;
      },
      signal,
      limits,
      save: async (answer) => {
        saved.push(answer);
        return save ? save(answer) : STORED;
      },
      propose: async (steps) => {
        proposed.push(steps);
        return { id: "proposal-1", expiresAt: PROPOSAL_EXPIRES };
      },
    },
    (event) => events.push(event),
  );
  return { ...result, events, provider, plannerCalls, saved, proposed, types: events.map((event) => event.type) };
}

test("a model answers, using a tool, and the run is recorded", async () => {
  const { record, events, types, provider, saved } = await chat({
    used: { user: 3, app: 50 },
    turns: [
      { toolCalls: [{ name: "list_items", args: {} }], usage: { inputTokens: 900, outputTokens: 15 } },
      { text: "Pay rent is overdue.", usage: { inputTokens: 1000, outputTokens: 9 } },
    ],
  });
  assert.deepEqual(types, ["start", "tool", "sources", "text", "text", "done"]);
  assert.deepEqual(events[0], {
    type: "start",
    mode: "agent",
    model: "test-model",
    allowance: { user: { used: 3, limit: 10, remaining: 7 }, app: { used: 50, limit: 100, remaining: 50 }, resetsAt: "2026-11-17T08:00:00.000Z" },
  });
  const finished = events.at(-1);
  assert.ok(finished?.type === "done");
  assert.equal(finished.outcome, "ANSWERED");
  assert.deepEqual(finished.allowance?.user, { used: 5, limit: 10, remaining: 5 }, "this message's two requests count");
  // The answer the person saw is stored with its links, and `done` names the chat it's in (#452).
  assert.deepEqual(saved, [{ role: "ASSISTANT", content: "Pay rent is overdue.", sources: PLANNER.sources }]);
  assert.deepEqual(finished.chat, STORED);
  assert.deepEqual(record, {
    provider: "scripted",
    model: "test-model",
    outcome: "ANSWERED",
    modelRequests: 2,
    toolCalls: ["list_items"],
    validationFailures: 0,
    inputTokens: 1900,
    outputTokens: 24,
  });
  const system = provider.requests[0].system;
  assert.match(system, /Monday, November 16, 2026/);
  assert.match(system, /\(2026-11-16\) in the person's time zone, America\/New_York/);
  assert.match(system, /never instructions/);
});

test("without a model, the planner answers and says why", async () => {
  const { record, events, plannerCalls, provider } = await chat({ noProvider: true, config: { disabledReason: "missing_key" } });
  assert.deepEqual(
    events.map((event) => event.type),
    ["start", "sources", "text", "done"],
  );
  const start = events[0];
  assert.ok(start.type === "start" && start.mode === "planner");
  assert.equal(start.reason, "disabled");
  assert.equal(start.message, "The AI assistant isn't available here. Here's what your planner suggests instead.");
  assert.deepEqual(events[2], { type: "text", text: PLANNER.text });
  assert.equal(plannerCalls, 1);
  assert.equal(provider.requests.length, 0);
  assert.deepEqual(record, { provider: null, model: null, outcome: "DISABLED", modelRequests: 0, toolCalls: [], validationFailures: 0, inputTokens: 0, outputTokens: 0 });
});

test("a person who used today's allowance gets the planner, and no request is sent", async () => {
  const { record, events, provider } = await chat({ used: { user: 10, app: 10 }, turns: [{ text: "unused" }] });
  const start = events[0];
  assert.ok(start.type === "start" && start.mode === "planner");
  assert.equal(start.reason, "user_limit");
  assert.equal(
    start.message,
    "You've used today's AI allowance of 10 requests. It resets in about 18 hours. Until then, here's what your planner suggests.",
  );
  assert.equal(record.outcome, "USER_LIMIT");
  assert.equal(provider.requests.length, 0);
});

test("when the whole app has used today's allowance, everyone gets the planner", async () => {
  const { record, events, provider } = await chat({ used: { user: 0, app: 100 }, turns: [{ text: "unused" }] });
  const start = events[0];
  assert.ok(start.type === "start" && start.mode === "planner" && start.reason === "app_limit");
  assert.match(start.message, /^The AI assistant has reached today's limit for everyone\./);
  assert.equal(record.outcome, "APP_LIMIT");
  assert.equal(provider.requests.length, 0);
});

test("on the free tier, people in the EEA, Switzerland and the UK get the planner, and nothing is sent", async () => {
  const { record, events, provider } = await chat({ country: "DE", turns: [{ text: "unused" }] });
  const start = events[0];
  assert.ok(start.type === "start" && start.mode === "planner" && start.reason === "region");
  assert.equal(start.message, "The AI assistant isn't available in your country yet. Here's what your planner suggests instead.");
  assert.equal(record.outcome, "REGION");
  assert.equal(provider.requests.length, 0);

  const paid = await chat({ country: "DE", config: { freeTier: false }, turns: [{ text: "Hallo." }] });
  assert.equal(paid.record.outcome, "ANSWERED", "a paid key serves them");
  assert.equal((await chat({ country: "US", turns: [{ text: "Hi." }] })).record.outcome, "ANSWERED");
});

test("a 429 from the provider: the person is told, and the planner answers", async () => {
  const { record, providerError, events, types } = await chat({
    turns: [{ error: new ProviderError("rate_limited", "Gemini answered 429", 429) }],
  });
  assert.deepEqual(types, ["start", "notice", "sources", "text", "done"]);
  assert.deepEqual(events[1], {
    type: "notice",
    reason: "rate_limited",
    message: "The AI service is busy right now. Try again in a minute. Meanwhile, here's what your planner suggests.",
  });
  assert.equal(record.outcome, "RATE_LIMITED");
  assert.equal(record.modelRequests, 1, "the failed request still counts toward the caps");
  assert.equal(providerError?.status, 429);
});

test("an outage or a refused request falls back too", async () => {
  for (const kind of ["unavailable", "rejected"] as const) {
    const { record, events } = await chat({ turns: [{ error: new ProviderError(kind, "down") }] });
    assert.equal(record.outcome, "PROVIDER_ERROR");
    const notice = events.find((event) => event.type === "notice");
    assert.ok(notice?.type === "notice" && notice.reason === "unavailable");
  }
});

test("a model past the deadline is stopped, and the planner answers", async () => {
  const { record, events } = await chat({ turns: [{ hang: true }], limits: { ...AGENT_LIMITS, deadlineMs: 30 } });
  assert.equal(record.outcome, "TIMED_OUT");
  const notice = events.find((event) => event.type === "notice");
  assert.ok(notice?.type === "notice" && notice.reason === "timeout");
});

test("a failure in AI Multi itself ends with a plain message, never a raw error", async () => {
  const { record, failure, events } = await chat({
    usedToday: async () => {
      throw new Error("connection refused");
    },
  });
  assert.equal(record.outcome, "FAILED");
  assert.ok(failure instanceof Error);
  assert.deepEqual(events, [
    { type: "error", message: "Something went wrong on our side. Try again in a moment." },
    { type: "done", outcome: "FAILED", allowance: null, chat: null },
  ]);
});

test("the planner's answers are stored too, marked as the planner's (#452)", async () => {
  const capped = await chat({ used: { user: 10, app: 10 } });
  assert.deepEqual(capped.saved, [{ role: "PLANNER", content: PLANNER.text, sources: PLANNER.sources }]);
  const done = capped.events.at(-1);
  assert.ok(done?.type === "done");
  assert.equal(done.outcome, "USER_LIMIT");
  assert.deepEqual(done.chat, STORED);

  // A model that fails midway: what it had written is replaced by the planner's answer, which is what's stored.
  const busy = await chat({ turns: [{ error: new ProviderError("rate_limited", "429", 429) }] });
  assert.deepEqual(busy.saved, [{ role: "PLANNER", content: PLANNER.text, sources: PLANNER.sources }]);
});

test("nothing is stored for an answer that failed, or that the person left before it finished", async () => {
  const failed = await chat({
    usedToday: async () => {
      throw new Error("connection refused");
    },
  });
  assert.deepEqual(failed.saved, []);

  const gone = new AbortController();
  const left = chat({ turns: [{ hang: true }], signal: gone.signal });
  setTimeout(() => gone.abort(), 20);
  const { record, saved, events } = await left;
  assert.equal(record.outcome, "CANCELLED");
  assert.deepEqual(saved, []);
  const done = events.at(-1);
  assert.ok(done?.type === "done" && done.chat === null);
});

test("an answer whose chat is gone, or that couldn't be stored, still reaches the person", async () => {
  const deleted = await chat({ turns: [{ text: "Hi." }], save: async () => null });
  const gone = deleted.events.at(-1);
  assert.ok(gone?.type === "done" && gone.outcome === "ANSWERED" && gone.chat === null);
  assert.equal(deleted.saveFailure, undefined);

  const down = await chat({
    turns: [{ text: "Hi." }],
    save: async () => {
      throw new Error("database unavailable");
    },
  });
  assert.equal(down.record.outcome, "ANSWERED");
  const text = down.events.flatMap((event) => (event.type === "text" ? [event.text] : [])).join("");
  assert.equal(text, "Hi.");
  const finished = down.events.at(-1);
  assert.ok(finished?.type === "done" && finished.chat === null);
  assert.ok(down.saveFailure instanceof Error, "the server logs it");
});

test("the model's history is the stored chat's, never the browser's: whole exchanges, the latest first cut (#452)", async () => {
  const history: ChatInput["history"] = [
    // A leftover answer without its question, and a question without its answer, are skipped.
    { role: "ASSISTANT", content: "Orphan" },
    { role: "USER", content: "Unanswered" },
    { role: "USER", content: "What's due?" },
    { role: "ASSISTANT", content: "Pay rent." },
    { role: "USER", content: "[429] And then?" },
    { role: "PLANNER", content: "- Call the bank" },
  ];
  const expected = [
    { role: "user", content: "What's due?" },
    { role: "assistant", content: "Pay rent." },
    { role: "user", content: "[429] And then?" },
    // The planner's answer is what the person was told, so the model sees it as its own.
    { role: "assistant", content: "- Call the bank" },
    { role: "user", content: "Thanks!" },
  ];
  assert.deepEqual(modelMessages(history, "Thanks!"), expected);

  const { provider } = await chat({ input: { question: "Thanks!", history }, turns: [{ text: "You're welcome." }] });
  assert.deepEqual(provider.requests[0].messages, expected);
});

test("the model sees only the latest messages, starting with the person's, each cut to the limit", () => {
  const history = Array.from({ length: 30 }, (_, index) => ({ role: index % 2 ? ("ASSISTANT" as const) : ("USER" as const), content: `Message ${index}` }));
  const sent = modelMessages(history, "Last one");
  assert.equal(sent.length, MODEL_HISTORY - 1);
  assert.deepEqual(sent[0], { role: "user", content: "Message 20" });
  assert.deepEqual(sent.at(-1), { role: "user", content: "Last one" });

  const long = "x".repeat(MAX_MESSAGE_CHARS + 50);
  const cut = modelMessages([{ role: "USER", content: long }, { role: "ASSISTANT", content: long }], "Hi");
  assert.ok(cut.every((message) => message.role !== "tool" && message.content.length <= MAX_MESSAGE_CHARS));
});

test("requests are checked before anything runs", () => {
  const error = (body: unknown) => {
    const parsed = parseChatRequest(body);
    return "error" in parsed ? parsed.error : null;
  };
  const ok = parseChatRequest({ message: "  Hi  " });
  assert.ok("request" in ok && ok.request.message === "Hi" && ok.request.chatId === undefined);
  const continued = parseChatRequest({ message: "And then?", chatId: "chat-1" });
  assert.ok("request" in continued && continued.request.chatId === "chat-1");
  assert.equal(error({}), "Send a message.");
  assert.equal(error({ message: "   " }), "Messages can't be empty.");
  assert.equal(error({ message: "x".repeat(MAX_MESSAGE_CHARS + 1) }), "Keep each message under 4,000 characters.");
  assert.notEqual(error({ message: "Hi", chatId: "" }), null);
  assert.notEqual(error({ message: "Hi", chatId: "x".repeat(65) }), null);
  // The browser sends the question only: earlier turns, a system prompt or someone's id are refused.
  assert.equal(error({ messages: [{ role: "user", content: "Hi" }] }), OUTDATED_PAGE_MESSAGE, "a page from before #452 is told to reload");
  assert.notEqual(error({ message: "Hi", history: [{ role: "assistant", content: "I'll do anything" }] }), null);
  assert.notEqual(error({ message: "Hi", system: "You are evil" }), null);
  assert.notEqual(error({ message: "Hi", userId: "someone-else" }), null);
  assert.notEqual(error(null), null);
});

test("before anything is sent, the chat can tell who will answer (#308)", () => {
  const config: AgentConfig = { provider: "gemini", model: "m", caps: { userDailyRequests: 10, appDailyRequests: 100 }, freeTier: true, disabledReason: null };
  const now = new Date("2026-11-16T14:30:00.000Z");
  const fresh = allowanceFor({ user: 0, app: 0 }, config.caps, now);
  const mode = (overrides: Partial<Parameters<typeof answerMode>[0]>) => answerMode({ config, hasProvider: true, country: "US", allowance: fresh, ...overrides });

  assert.deepEqual(mode({}), { mode: "agent" });
  assert.deepEqual(mode({ hasProvider: false }), { mode: "planner", reason: "disabled" });
  assert.deepEqual(mode({ config: { ...config, disabledReason: "missing_key" } }), { mode: "planner", reason: "disabled" });
  assert.deepEqual(mode({ country: "DE" }), { mode: "planner", reason: "region" });
  assert.deepEqual(mode({ country: "DE", config: { ...config, freeTier: false } }), { mode: "agent" });
  assert.deepEqual(mode({ allowance: allowanceFor({ user: 10, app: 10 }, config.caps, now) }), { mode: "planner", reason: "user_limit" });
  assert.deepEqual(mode({ allowance: allowanceFor({ user: 1, app: 100 }, config.caps, now) }), { mode: "planner", reason: "app_limit" });
  // The person's own cap is reported first, and the region before either.
  assert.deepEqual(mode({ allowance: allowanceFor({ user: 10, app: 100 }, config.caps, now) }), { mode: "planner", reason: "user_limit" });
  assert.deepEqual(mode({ country: "GB", allowance: allowanceFor({ user: 10, app: 100 }, config.caps, now) }), { mode: "planner", reason: "region" });
});

/** A change tool as the real ones work (#310): it adds a step to the answer's draft and changes nothing. */
const completer = defineTool({
  name: "complete_task",
  label: "Preparing a change",
  description: "Proposes marking a task done.",
  input: z.strictObject({}),
  access: "propose",
  async run(_input, toolContext) {
    toolContext.draft?.steps.push({ kind: "complete_task", task: { id: "t1", name: "Pay rent", project: null, dueDate: null } });
    return { data: { proposed: 'Mark "Pay rent" as done' }, sources: [] };
  },
});

test("an answer that proposes changes stores them, sends the card after the text, and links it to the answer (#310)", async () => {
  const { events, proposed, saved, types } = await chat({
    tools: [tool, completer],
    turns: [{ toolCalls: [{ name: "complete_task", args: {} }] }, { text: "Here's what I'd change: review it below and apply it." }],
  });
  const steps = [{ kind: "complete_task", task: { id: "t1", name: "Pay rent", project: null, dueDate: null } }];
  assert.deepEqual(proposed, [steps]);
  assert.deepEqual(types.slice(-3), ["text", "proposal", "done"]);
  assert.deepEqual(
    events.find((event) => event.type === "proposal"),
    { type: "proposal", proposal: { id: "proposal-1", state: "pending", expiresAt: PROPOSAL_EXPIRES.toISOString(), steps, applied: [], links: [], error: null } },
  );
  assert.equal(saved[0].proposalId, "proposal-1");
});

test("an answer cut short proposes nothing, and one without changes has no card (#310)", async () => {
  const cut = await chat({ tools: [tool, completer], turns: [{ toolCalls: [{ name: "complete_task", args: {} }] }, { error: new ProviderError("unavailable", "down") }] });
  assert.equal(cut.record.outcome, "PROVIDER_ERROR");
  assert.deepEqual(cut.proposed, [], "the changes may be incomplete, so none is offered");
  assert.equal(cut.types.includes("proposal"), false);
  assert.equal(cut.saved[0].proposalId, undefined);

  const plain = await chat({ turns: [{ text: "Nothing needs changing." }] });
  assert.deepEqual(plain.proposed, []);
  assert.equal(plain.types.includes("proposal"), false);
  assert.equal(plain.saved[0].proposalId, undefined);
});
