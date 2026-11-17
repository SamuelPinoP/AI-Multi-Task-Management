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

async function fakeAnswer(messages: ProviderRequest["messages"]) {
  const events: ProviderEvent[] = [];
  const request: ProviderRequest = {
    model: "fake",
    system: "System",
    messages,
    tools: [{ name: "list_open_tasks", description: "", parameters: {} }],
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
