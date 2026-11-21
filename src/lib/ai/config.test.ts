import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_APP_DAILY_REQUESTS, DEFAULT_USER_DAILY_REQUESTS, readAgentConfig } from "./config";
import { AI_NOTICE_VERSION, hasAcceptedNotice, parseNoticeAgreement } from "./notice";
import { createFakeProvider } from "./providers/fake";
import { GEMINI_DEFAULT_MODEL } from "./providers/gemini";
import { createProvider } from "./providers/index";
import type { ProviderEvent, ProviderRequest } from "./types";

test("Gemini 3.1 Flash-Lite by default, on when its key is set", () => {
  assert.deepEqual(readAgentConfig({ GEMINI_API_KEY: "key" }), {
    provider: "gemini",
    model: GEMINI_DEFAULT_MODEL,
    caps: { userDailyRequests: DEFAULT_USER_DAILY_REQUESTS, appDailyRequests: DEFAULT_APP_DAILY_REQUESTS },
    freeTier: true,
    disabledReason: null,
  });
  assert.equal(GEMINI_DEFAULT_MODEL, "gemini-3.1-flash-lite");
});

test("the free tier is assumed until AI_FREE_TIER is \"false\"", () => {
  assert.equal(readAgentConfig({}).freeTier, true);
  assert.equal(readAgentConfig({ AI_FREE_TIER: "true" }).freeTier, true);
  assert.equal(readAgentConfig({ AI_FREE_TIER: "maybe" }).freeTier, true, "anything unclear keeps the safer setting");
  assert.equal(readAgentConfig({ AI_FREE_TIER: " FALSE " }).freeTier, false);
});

test("off without a key, and the planner answers", () => {
  assert.equal(readAgentConfig({}).disabledReason, "missing_key");
  assert.equal(readAgentConfig({ GEMINI_API_KEY: "   " }).disabledReason, "missing_key");
  assert.equal(createProvider(readAgentConfig({}), {}), null);
});

test("another model or provider is a setting, not a code change", () => {
  const config = readAgentConfig({ AI_PROVIDER: " Gemini ", AI_MODEL: " gemini-3.5-flash-lite ", GEMINI_API_KEY: "key" });
  assert.equal(config.provider, "gemini");
  assert.equal(config.model, "gemini-3.5-flash-lite");
  assert.equal(createProvider(config, { GEMINI_API_KEY: "key" })?.name, "gemini");
});

test("an unknown provider leaves the assistant off, prototype names included", () => {
  for (const name of ["openai", "__proto__", "constructor", "toString"]) {
    const config = readAgentConfig({ AI_PROVIDER: name, GEMINI_API_KEY: "key" });
    assert.equal(config.disabledReason, "unknown_provider", name);
    assert.equal(createProvider(config, {}), null, name);
  }
});

test("the fake provider runs in tests, never on Vercel", () => {
  const local = readAgentConfig({ AI_PROVIDER: "fake" });
  assert.equal(local.disabledReason, null);
  assert.equal(local.model, "fake");
  assert.equal(createProvider(local, {})?.name, "fake");
  assert.equal(readAgentConfig({ AI_PROVIDER: "fake", VERCEL: "1" }).disabledReason, "test_provider");
});

test("Claude and Groq run locally and in evaluations, never on Vercel until the notices name them (#311)", () => {
  const claude = readAgentConfig({ AI_PROVIDER: "anthropic", CLAUDE_API_KEY: "key" });
  assert.equal(claude.disabledReason, null);
  assert.equal(claude.model, "claude-haiku-5-5");
  assert.equal(createProvider(claude, { CLAUDE_API_KEY: "key" })?.name, "anthropic");
  assert.equal(readAgentConfig({ AI_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "key" }).disabledReason, "missing_key", "never the key Claude Code reads");

  const groq = readAgentConfig({ AI_PROVIDER: "groq", GROQ_API_KEY: "key" });
  assert.equal(groq.disabledReason, null);
  assert.equal(groq.model, "openai/gpt-oss-120b");
  assert.equal(createProvider(groq, { GROQ_API_KEY: "key" })?.name, "groq");

  for (const env of [
    { AI_PROVIDER: "anthropic", CLAUDE_API_KEY: "key", VERCEL: "1" },
    { AI_PROVIDER: "groq", GROQ_API_KEY: "key", VERCEL: "1" },
  ]) {
    const config = readAgentConfig(env);
    assert.equal(config.disabledReason, "evaluation_provider", env.AI_PROVIDER);
    assert.equal(createProvider(config, env), null, env.AI_PROVIDER);
  }
});

test("caps are whole numbers; anything else keeps the default, and 0 stops the model", () => {
  const caps = (user?: string, app?: string) => readAgentConfig({ AI_USER_DAILY_REQUESTS: user, AI_APP_DAILY_REQUESTS: app }).caps;
  assert.deepEqual(caps("25", " 300 "), { userDailyRequests: 25, appDailyRequests: 300 });
  assert.deepEqual(caps("0", "0"), { userDailyRequests: 0, appDailyRequests: 0 });
  for (const value of ["-1", "1.5", "lots", ""]) {
    assert.deepEqual(caps(value, value), { userDailyRequests: DEFAULT_USER_DAILY_REQUESTS, appDailyRequests: DEFAULT_APP_DAILY_REQUESTS }, value);
  }
  assert.equal(caps("99999999").userDailyRequests, 1_000_000);
});

test("the data notice counts from its current version on", () => {
  assert.equal(hasAcceptedNotice(null), false);
  assert.equal(hasAcceptedNotice(undefined), false);
  assert.equal(hasAcceptedNotice(new Date("2026-11-15T23:59:59.000Z")), false, "agreed to an older notice");
  assert.equal(hasAcceptedNotice(new Date(`${AI_NOTICE_VERSION}T00:00:00.000Z`)), true);
  assert.equal(hasAcceptedNotice(new Date("2027-01-01T00:00:00.000Z")), true);
  assert.equal(hasAcceptedNotice(new Date("2027-01-01T00:00:00.000Z"), new Date("2027-02-01T00:00:00.000Z")), false, "a newer notice asks again");
});

test("an agreement must name the notice the person was shown", () => {
  assert.deepEqual(parseNoticeAgreement({ version: AI_NOTICE_VERSION }), { ok: true });
  for (const body of [null, {}, { version: "2026-01-01" }, { version: 20261116 }, "yes"]) {
    assert.ok("error" in parseNoticeAgreement(body), JSON.stringify(body));
  }
});

async function fakeAnswer(messages: ProviderRequest["messages"], tools = ["list_open_tasks"]) {
  const events: ProviderEvent[] = [];
  const request: ProviderRequest = {
    model: "fake",
    system: "System",
    messages,
    tools: tools.map((name) => ({ name, description: "", parameters: {} })),
    maxOutputTokens: 100,
    signal: new AbortController().signal,
  };
  for await (const event of createFakeProvider().stream(request)) events.push(event);
  return events;
}

test("the e2e fake calls the tool a message names, then lists what it found", async () => {
  const call = await fakeAnswer([{ role: "user", content: 'Please list_open_tasks {"due":"today"}' }]);
  assert.deepEqual(call[0], { type: "tool_call", call: { id: "local-0", name: "list_open_tasks", args: { due: "today" } } });
  const answer = await fakeAnswer([
    { role: "user", content: "list_open_tasks" },
    { role: "tool", results: [{ callId: "local-0", name: "list_open_tasks", content: { note: "n", data: { total: 2, tasks: [{ title: "A" }, { title: "B" }] } } }] },
  ]);
  assert.deepEqual(answer[0], { type: "text", text: "list_open_tasks found 2: A; B" });
  const stats = await fakeAnswer([
    { role: "user", content: "task_stats" },
    {
      role: "tool",
      results: [
        {
          callId: "local-0",
          name: "task_stats",
          content: { note: "n", data: { overall: { percentDone: 25 }, projects: [{ name: "AI Multi", percentDone: 33 }, { name: "No project", percentDone: 0 }] } },
        },
      ],
    },
  ]);
  assert.deepEqual(stats[0], { type: "text", text: "task_stats found 2: AI Multi (33%); No project (0%)" }, "with each item's percent done");
  assert.deepEqual((await fakeAnswer([{ role: "user", content: "Hello" }]))[0], { type: "text", text: "You asked: Hello" });
  await assert.rejects(fakeAnswer([{ role: "user", content: "[429]" }]), { name: "ProviderError", kind: "rate_limited" });
});

test("the e2e fake calls every tool a message names, in order, and says what each one proposed (#310)", async () => {
  const tools = ["create_project", "create_task", "create_event", "trash_task"];
  // Braces and a tool's name inside the arguments belong to them.
  const message = 'create_project {"name":"QA {Whitewall}"} then create_task {"title":"Say \\"create_event\\"","project":"QA {Whitewall}"} create_event';
  const calls = (await fakeAnswer([{ role: "user", content: message }], tools)).flatMap((event) => (event.type === "tool_call" ? [event.call] : []));
  assert.deepEqual(calls, [
    { id: "local-0", name: "create_project", args: { name: "QA {Whitewall}" } },
    { id: "local-1", name: "create_task", args: { title: 'Say "create_event"', project: "QA {Whitewall}" } },
    { id: "local-2", name: "create_event", args: {} },
  ]);
  const answer = await fakeAnswer(
    [
      { role: "user", content: message },
      {
        role: "tool",
        results: [
          { callId: "local-0", name: "create_project", content: { note: "n", data: { proposed: 'New project "QA"', ref: "new-1", proposedSoFar: 1 } } },
          { callId: "local-1", name: "trash_task", content: { note: "n", data: { proposed: null, reason: '2 tasks match "Write".', matches: [{ title: "Write A" }] } } },
        ],
      },
    ],
    tools,
  );
  assert.deepEqual(answer[0], { type: "text", text: 'Proposed: New project "QA"\ntrash_task proposed nothing: 2 tasks match "Write".' });
});
