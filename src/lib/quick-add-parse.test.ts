import assert from "node:assert/strict";
import test from "node:test";
import { normalizeQuickAddName, parseQuickAdd } from "./quick-add-parse";

// Tuesday, October 20, 2026, 2 PM local time.
const now = new Date(2026, 9, 20, 14, 0);
const projects = [
  { id: "p1", name: "Capstone Project" },
  { id: "p2", name: "Home" },
  { id: "p3", name: "Homework" },
];
const members = [
  { id: "m1", name: "Dana Lee", email: "dana@example.com" },
  { id: "m2", name: "Dan Ortiz", email: null },
  { id: "m3", name: "Sam Pino", email: "samp@example.com" },
];

test("parses the example from the issue", () => {
  const result = parseQuickAdd("Draft slides fri 3pm #Capstone !high @Dana", { now, projects, members });
  assert.equal(result.title, "Draft slides");
  assert.equal(result.dueDate, "2026-10-23");
  assert.equal(result.dueText, "fri 3pm");
  assert.equal(result.priority, "HIGH");
  assert.deepEqual(result.project, projects[0]);
  assert.deepEqual(result.assignee, members[0]);
  assert.deepEqual(result.hints, []);
});

test("plain text stays as typed", () => {
  for (const text of ["Read chapter 3", "Ask May about budget", "Review 2 PRs", "Email dana@example.com", "Learn C#"]) {
    const result = parseQuickAdd(text, { now, projects });
    assert.equal(result.title, text);
    assert.equal(result.dueDate, null);
    assert.equal(result.project, null);
    assert.equal(result.priority, null);
  }
});

test("relative and absolute dates", () => {
  const cases: [string, string, string][] = [
    ["Pay rent tomorrow", "Pay rent", "2026-10-21"],
    ["Buy milk today", "Buy milk", "2026-10-20"],
    ["Submit report next monday", "Submit report", "2026-10-26"],
    ["Plan trip oct 30", "Plan trip", "2026-10-30"],
    ["Meeting in 3 days", "Meeting", "2026-10-23"],
    ["Do it by Friday", "Do it", "2026-10-23"],
    ["Send invoice due tomorrow", "Send invoice", "2026-10-21"],
    ["Book flights march 3", "Book flights", "2027-03-03"],
  ];
  for (const [text, title, dueDate] of cases) {
    const result = parseQuickAdd(text, { now });
    assert.equal(result.title, title, text);
    assert.equal(result.dueDate, dueDate, text);
  }
});

test("a time without a day is not a due date", () => {
  for (const text of ["Call mom at 5", "3pm standup"]) {
    const result = parseQuickAdd(text, { now });
    assert.equal(result.dueDate, null, text);
    assert.equal(result.title, text);
  }
});

test("priority words and shortcuts", () => {
  assert.equal(parseQuickAdd("Fix login !urgent", { now }).priority, "HIGH");
  assert.equal(parseQuickAdd("Fix login !2", { now }).priority, "MEDIUM");
  assert.equal(parseQuickAdd("!low Tidy desk", { now }).priority, "LOW");
  assert.equal(parseQuickAdd("!low Tidy desk", { now }).title, "Tidy desk");
  const unknown = parseQuickAdd("Say hi!great", { now });
  assert.equal(unknown.priority, null);
  assert.equal(unknown.title, "Say hi!great");
});

test("project names: case, punctuation, prefixes and ambiguity", () => {
  assert.equal(parseQuickAdd("A #capstone-project", { now, projects }).project?.id, "p1");
  assert.equal(parseQuickAdd("A #CAP", { now, projects }).project?.id, "p1");
  // "Home" is an exact match even though "Homework" shares the prefix.
  assert.equal(parseQuickAdd("A #home", { now, projects }).project?.id, "p2");

  const ambiguous = parseQuickAdd("A #ho", { now, projects });
  assert.equal(ambiguous.project, null);
  assert.equal(ambiguous.title, "A #ho");
  assert.deepEqual(ambiguous.hints, [{ kind: "project", token: "#ho", message: "#ho matches several projects" }]);

  const missing = parseQuickAdd("A #garden", { now, projects });
  assert.equal(missing.hints[0]?.message, "No project called #garden");

  // Issue numbers are left alone without a hint.
  const issue = parseQuickAdd("Fix bug #12", { now, projects });
  assert.equal(issue.title, "Fix bug #12");
  assert.deepEqual(issue.hints, []);
});

test("assignees need a project and match first names, full names and emails", () => {
  const noProject = parseQuickAdd("Call @Dana", { now, projects, members });
  assert.equal(noProject.assignee, null);
  assert.equal(noProject.title, "Call @Dana");
  assert.equal(noProject.hints[0]?.message, "Add a #project to assign @Dana");

  // Members not loaded yet: no assignee and no hint.
  const pending = parseQuickAdd("Call @Dana #cap", { now, projects });
  assert.equal(pending.assignee, null);
  assert.deepEqual(pending.hints, []);

  assert.equal(parseQuickAdd("Call @samp #cap", { now, projects, members }).assignee?.id, "m3");
  assert.equal(parseQuickAdd("Call @ortiz #cap", { now, projects, members }).assignee?.id, "m2");
  assert.equal(parseQuickAdd("Call @dana #cap", { now, projects, members }).assignee?.id, "m1");

  // "dan" is Dan Ortiz exactly, even though "Dana" starts with it.
  assert.equal(parseQuickAdd("Call @dan #cap", { now, projects, members }).assignee?.id, "m2");
  const ambiguous = parseQuickAdd("Call @da #cap", { now, projects, members });
  assert.equal(ambiguous.assignee, null);
  assert.equal(ambiguous.hints[0]?.message, "@da matches several people in Capstone Project");
});

test("ignored kinds stay in the title", () => {
  const ignore = new Set(["date", "project"] as const);
  const result = parseQuickAdd("Draft slides fri #Capstone !high", { now, projects, ignore });
  assert.equal(result.title, "Draft slides fri #Capstone");
  assert.equal(result.dueDate, null);
  assert.equal(result.project, null);
  assert.equal(result.priority, "HIGH");
});

test("tokens are not read as dates", () => {
  const result = parseQuickAdd("Plan #Q4 !1", { now, projects: [{ id: "q", name: "Q4" }] });
  assert.equal(result.title, "Plan");
  assert.equal(result.dueDate, null);
  assert.equal(result.project?.id, "q");
});

test("a title made only of tokens keeps the typed text", () => {
  assert.equal(parseQuickAdd("tomorrow", { now }).title, "tomorrow");
  assert.equal(parseQuickAdd("tomorrow", { now }).dueDate, "2026-10-21");
});

test("normalizes names", () => {
  assert.equal(normalizeQuickAddName("Café Plans-2026"), "cafeplans2026");
});
