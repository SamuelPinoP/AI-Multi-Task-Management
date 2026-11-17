import assert from "node:assert/strict";
import test from "node:test";
import type { Allowance } from "./allowance";
import type { ChatEvent } from "./chat";
import { MAX_MESSAGE_CHARS, MAX_MESSAGES } from "./chat-limits";
import {
  allowanceIn,
  allowanceText,
  answerBlocks,
  applyChatEvent,
  chatTitle,
  createEventReader,
  emptyAnswer,
  finishedStep,
  requestMessages,
  textRuns,
  type ChatTurn,
} from "./chat-client";

const allowance: Allowance = {
  user: { used: 2, limit: 40, remaining: 38 },
  app: { used: 10, limit: 400, remaining: 390 },
  resetsAt: "2026-11-17T08:00:00.000Z",
};

const task = { kind: "task" as const, id: "t1", title: "Rotate the API keys", href: "/tasks?task=t1" };
const project = { kind: "project" as const, id: "p1", title: "Whitewall", href: "/projects/p1" };

function fold(events: ChatEvent[]) {
  return events.reduce(applyChatEvent, emptyAnswer());
}

function turn(question: string, text: string, extra: Partial<ChatTurn["answer"]> = {}): ChatTurn {
  return { id: question, question, answer: { ...emptyAnswer(), text, done: true, ...extra } };
}

test("a model's answer collects its lookups, sources and text as they stream in", () => {
  const answer = fold([
    { type: "start", mode: "agent", model: "fake", allowance },
    { type: "tool", name: "list_open_tasks", label: "Checking your open tasks" },
    { type: "sources", items: [task] },
    { type: "tool", name: "list_projects", label: "Checking your projects" },
    { type: "sources", items: [project, task] },
    { type: "text", text: "One task is " },
    { type: "text", text: "overdue." },
    { type: "done", outcome: "ANSWERED", allowance },
  ]);
  assert.deepEqual(answer, {
    steps: ["Checking your open tasks", "Checking your projects"],
    // Each item once, in the order it was first used.
    sources: [task, project],
    text: "One task is overdue.",
    notice: null,
    error: null,
    done: true,
  });
});

test("the same lookup twice is one step", () => {
  const step = { type: "tool", name: "list_events", label: "Checking your calendar" } as const;
  assert.deepEqual(fold([step, step]).steps, ["Checking your calendar"]);
});

test("the planner's answer says why it answers instead", () => {
  const answer = fold([
    { type: "start", mode: "planner", reason: "user_limit", message: "You've used today's AI allowance.", allowance },
    { type: "text", text: "- Rotate the API keys: overdue" },
    { type: "done", outcome: "USER_LIMIT", allowance },
  ]);
  assert.equal(answer.notice, "You've used today's AI allowance.");
  assert.equal(answer.text, "- Rotate the API keys: overdue");
});

test("when the model fails partway, the planner's answer replaces the partial one", () => {
  const answer = fold([
    { type: "start", mode: "agent", model: "fake", allowance },
    { type: "sources", items: [project] },
    { type: "text", text: "Half an ans" },
    { type: "notice", reason: "rate_limited", message: "The AI service is busy right now." },
    { type: "sources", items: [task] },
    { type: "text", text: "- Rotate the API keys" },
    { type: "done", outcome: "RATE_LIMITED", allowance },
  ]);
  assert.equal(answer.notice, "The AI service is busy right now.");
  assert.equal(answer.text, "- Rotate the API keys");
  assert.deepEqual(answer.sources, [task]);
});

test("an error from AI Multi is kept for the chat to show", () => {
  const answer = fold([
    { type: "error", message: "Something went wrong on our side. Try again in a moment." },
    { type: "done", outcome: "FAILED", allowance: null },
  ]);
  assert.equal(answer.error, "Something went wrong on our side. Try again in a moment.");
  assert.equal(answer.done, true);
});

test("events of a kind the chat doesn't know leave the answer as it was", () => {
  const before = fold([{ type: "text", text: "Hi" }]);
  assert.equal(applyChatEvent(before, { type: "later" } as unknown as ChatEvent), before);
});

test("the allowance comes from the first and the last event", () => {
  assert.equal(allowanceIn({ type: "start", mode: "agent", model: "fake", allowance }), allowance);
  assert.equal(allowanceIn({ type: "done", outcome: "ANSWERED", allowance }), allowance);
  assert.equal(allowanceIn({ type: "done", outcome: "FAILED", allowance: null }), null);
  assert.equal(allowanceIn({ type: "text", text: "Hi" }), null);
  assert.equal(allowanceText(allowance), "38 of 40 left today");
});

test("a finished step reads in the past tense", () => {
  assert.equal(finishedStep("Checking your open tasks"), "Checked your open tasks");
  assert.equal(finishedStep("Counting your tasks"), "Counted your tasks");
  assert.equal(finishedStep("Searching your notes"), "Searched your notes");
  assert.equal(finishedStep("Thinking it over"), "Thinking it over");
});

test("the stream's lines become events, whatever size its pieces arrive in", () => {
  const reader = createEventReader();
  assert.deepEqual(reader.push('{"type":"text","te'), []);
  assert.deepEqual(reader.push('xt":"Hello"}\n{"type":"text","text":" there"}\n\n{"type":"do'), [
    { type: "text", text: "Hello" },
    { type: "text", text: " there" },
  ]);
  assert.deepEqual(reader.push('ne","outcome":"ANSWERED","allowance":null}'), []);
  assert.deepEqual(reader.end(), [{ type: "done", outcome: "ANSWERED", allowance: null }]);
  assert.deepEqual(reader.end(), []);
});

test("lines that aren't events are skipped", () => {
  const reader = createEventReader();
  assert.deepEqual(reader.push('not json\n42\nnull\n{"no":"type"}\n{"type":"text","text":"ok"}\n'), [{ type: "text", text: "ok" }]);
});

test("a new question goes with the finished exchanges before it", () => {
  const turns = [
    turn("What's overdue?", "Rotate the API keys."),
    // A failed answer leaves its question out, so the roles keep alternating.
    turn("And Whitewall?", "", { error: "Something went wrong." }),
    // So does one still arriving.
    { id: "x", question: "Still going", answer: { ...emptyAnswer(), text: "Partial" } },
    turn("What analytics can you give?", "You've done 33%."),
  ];
  assert.deepEqual(requestMessages(turns, "  Thanks! "), [
    { role: "user", content: "What's overdue?" },
    { role: "assistant", content: "Rotate the API keys." },
    { role: "user", content: "What analytics can you give?" },
    { role: "assistant", content: "You've done 33%." },
    { role: "user", content: "Thanks!" },
  ]);
});

test("a long chat sends only as many whole exchanges as one request may carry", () => {
  const turns = Array.from({ length: 30 }, (_, index) => turn(`Question ${index}`, `Answer ${index}`));
  const messages = requestMessages(turns, "Last one");
  assert.ok(messages.length <= MAX_MESSAGES);
  assert.equal(messages.length % 2, 1);
  assert.deepEqual(messages[0], { role: "user", content: "Question 11" });
  assert.deepEqual(messages.at(-1), { role: "user", content: "Last one" });
});

test("every message is cut to what the endpoint accepts", () => {
  const long = "x".repeat(MAX_MESSAGE_CHARS + 50);
  const messages = requestMessages([turn("Q", long)], long);
  assert.ok(messages.every((message) => message.content.length <= MAX_MESSAGE_CHARS));
});

test("a chat is named after its first question, cut at a word", () => {
  assert.equal(chatTitle("What's overdue?"), "What's overdue?");
  assert.equal(chatTitle("  What   analytics\ncan you give? "), "What analytics can you give?");
  assert.equal(chatTitle("Create a task to send the Babel invoice on Friday at noon"), "Create a task to send the Babel invoice on…");
  assert.equal(chatTitle("x".repeat(60)), `${"x".repeat(43)}…`);
});

test("bold runs are found and everything else stays plain text", () => {
  assert.deepEqual(textRuns("Plain"), [{ text: "Plain", strong: false }]);
  assert.deepEqual(textRuns("**Whitewall** is at risk, **25%** done"), [
    { text: "Whitewall", strong: true },
    { text: " is at risk, ", strong: false },
    { text: "25%", strong: true },
    { text: " done", strong: false },
  ]);
  assert.deepEqual(textRuns("<b>not html</b> and **unclosed"), [{ text: "<b>not html</b> and **unclosed", strong: false }]);
});

test("an answer's text becomes paragraphs and lists", () => {
  assert.deepEqual(answerBlocks("Here's what's due:\n- Rotate the keys\n* Book the dentist\n\nThat's all.\nGood luck."), [
    { kind: "paragraph", lines: [[{ text: "Here's what's due:", strong: false }]] },
    {
      kind: "list",
      ordered: false,
      items: [[{ text: "Rotate the keys", strong: false }], [{ text: "Book the dentist", strong: false }]],
    },
    { kind: "paragraph", lines: [[{ text: "That's all.", strong: false }], [{ text: "Good luck.", strong: false }]] },
  ]);
  assert.deepEqual(answerBlocks("## Your week\r\n1. Standup\r\n2) Review"), [
    { kind: "paragraph", lines: [[{ text: "Your week", strong: true }]] },
    { kind: "list", ordered: true, items: [[{ text: "Standup", strong: false }], [{ text: "Review", strong: false }]] },
  ]);
  // A bullet list and a numbered one side by side stay two lists.
  assert.equal(answerBlocks("- a\n1. b").length, 2);
  assert.deepEqual(answerBlocks(" \n\n "), []);
});
