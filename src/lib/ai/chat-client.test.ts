import assert from "node:assert/strict";
import test from "node:test";
import type { Allowance } from "./allowance";
import type { ChatEvent } from "./chat";
import {
  allowanceIn,
  allowanceLine,
  allowanceText,
  answerBlocks,
  applyChatEvent,
  chatGroups,
  chatTitle,
  createEventReader,
  emptyAnswer,
  finishedStep,
  PLANNER_NOTE,
  textRuns,
  turnsFromMessages,
} from "./chat-client";
import type { StoredMessage } from "./chat-history-core";
import type { Source } from "./tools/define";

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

test("a model's answer collects its lookups, sources and text as they stream in", () => {
  const answer = fold([
    { type: "start", mode: "agent", model: "fake", allowance },
    { type: "tool", name: "list_open_tasks", label: "Checking your open tasks" },
    { type: "sources", items: [task] },
    { type: "tool", name: "list_projects", label: "Checking your projects" },
    { type: "sources", items: [project, task] },
    { type: "text", text: "One task is " },
    { type: "text", text: "overdue." },
    { type: "done", outcome: "ANSWERED", allowance, chat: { id: "chat-1", title: "Rotate the API keys", updatedAt: "2026-11-16T14:30:02.000Z" } },
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
    { type: "done", outcome: "USER_LIMIT", allowance, chat: null },
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
    { type: "done", outcome: "RATE_LIMITED", allowance, chat: null },
  ]);
  assert.equal(answer.notice, "The AI service is busy right now.");
  assert.equal(answer.text, "- Rotate the API keys");
  assert.deepEqual(answer.sources, [task]);
});

test("an error from AI Multi is kept for the chat to show", () => {
  const answer = fold([
    { type: "error", message: "Something went wrong on our side. Try again in a moment." },
    { type: "done", outcome: "FAILED", allowance: null, chat: null },
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
  assert.equal(allowanceIn({ type: "done", outcome: "ANSWERED", allowance, chat: null }), allowance);
  assert.equal(allowanceIn({ type: "done", outcome: "FAILED", allowance: null, chat: null }), null);
  assert.equal(allowanceIn({ type: "text", text: "Hi" }), null);
  assert.equal(allowanceText(allowance), "38 of 40 left today");
});

test("the allowance shows under the box unless the planner answers whatever it is", () => {
  assert.equal(allowanceLine(null), null);
  assert.equal(allowanceLine({ mode: "agent", noticeAccepted: true, allowance }), "38 of 40 left today");
  // Used up: it still says so.
  const used = { ...allowance, user: { used: 40, limit: 40, remaining: 0 } };
  assert.equal(allowanceLine({ mode: "planner", reason: "user_limit", noticeAccepted: true, allowance: used }), "0 of 40 left today");
  // No model here, or the person's country: the allowance means nothing.
  assert.equal(allowanceLine({ mode: "planner", reason: "region", noticeAccepted: true, allowance }), null);
  assert.equal(allowanceLine({ mode: "planner", reason: "disabled", noticeAccepted: false, allowance }), null);
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

const stored = (id: string, role: StoredMessage["role"], content: string, sources: Source[] = []): StoredMessage => ({
  id,
  role,
  content,
  sources,
  createdAt: "2026-11-18T10:00:00.000Z",
});

test("a stored chat becomes its questions and answers again, the planner's marked as such (#452)", () => {
  const turns = turnsFromMessages([
    stored("m1", "USER", "What's overdue?"),
    stored("m2", "ASSISTANT", "Rotate the API keys.", [task]),
    stored("m3", "USER", "[429] And next?"),
    stored("m4", "PLANNER", "- Whitewall: due Friday", [project]),
  ]);
  const answer = (text: string, sources: Source[], notice: string | null) => ({ steps: [], sources, text, notice, error: null, done: true });
  assert.deepEqual(turns, [
    { id: "m1", question: "What's overdue?", answer: answer("Rotate the API keys.", [task], null) },
    // The planner's reason at the time (a busy model, a cap since reset) would be out of date.
    { id: "m3", question: "[429] And next?", answer: answer("- Whitewall: due Friday", [project], PLANNER_NOTE) },
  ]);
});

test("a question without its answer, or an answer without its question, is left out", () => {
  const turns = turnsFromMessages([
    stored("a0", "ASSISTANT", "Nobody asked"),
    stored("q1", "USER", "Never answered"),
    stored("q2", "USER", "Answered"),
    stored("a2", "ASSISTANT", "Yes"),
  ]);
  assert.deepEqual(
    turns.map((item) => [item.question, item.answer.text]),
    [["Answered", "Yes"]],
  );
});

test("chats group by the day of their latest message, in the person's time zone (#452)", () => {
  // 10 AM in New York.
  const now = new Date("2026-11-18T15:00:00.000Z");
  const chats = [
    { id: "today", updatedAt: "2026-11-18T14:00:00.000Z" },
    // 10 PM on the 17th in New York, but already the 18th in UTC.
    { id: "last-night", updatedAt: "2026-11-18T03:00:00.000Z" },
    { id: "yesterday", updatedAt: "2026-11-17T12:00:00.000Z" },
    { id: "this-week", updatedAt: "2026-11-12T12:00:00.000Z" },
    { id: "this-month", updatedAt: "2026-10-25T12:00:00.000Z" },
    { id: "older", updatedAt: "2026-08-30T12:00:00.000Z" },
  ];
  const groups = (timeZone: string | null) => chatGroups(chats, timeZone, now).map((group) => [group.label, group.chats.map((chat) => chat.id)]);
  assert.deepEqual(groups("America/New_York"), [
    ["Today", ["today"]],
    ["Yesterday", ["last-night", "yesterday"]],
    ["Previous 7 days", ["this-week"]],
    ["Previous 30 days", ["this-month"]],
    ["Older", ["older"]],
  ]);
  assert.deepEqual(groups(null)[0], ["Today", ["today", "last-night"]], "without a zone, days are UTC's");
  // A clock a little ahead of the browser's still says today, and empty groups are left out.
  assert.deepEqual(
    chatGroups([{ id: "ahead", updatedAt: "2026-11-18T15:00:05.000Z" }], "UTC", now).map((group) => group.label),
    ["Today"],
  );
  assert.deepEqual(chatGroups([], "UTC", now), []);
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
