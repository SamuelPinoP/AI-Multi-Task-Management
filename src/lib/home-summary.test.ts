import assert from "node:assert/strict";
import test from "node:test";
import {
  dailyCounts,
  daysFrom,
  dueLabel,
  greetingFor,
  overdueCounts,
  projectHealth,
  relativeTime,
  sortFocusTasks,
  sparklinePaths,
  taskSummary,
} from "./home-summary";

// Wall-clock "now": Tuesday, October 20, 2026 at 1:20 PM.
const now = new Date(2026, 9, 20, 13, 20);
const day = (offset: number) => new Date(2026, 9, 20 + offset);
// Due dates as Vercel stores them: midnight UTC.
const due = (offset: number) => new Date(Date.UTC(2026, 9, 20 + offset));

test("daysFrom compares dates, not times", () => {
  assert.equal(daysFrom(due(0), now), 0);
  assert.equal(daysFrom(due(-3), now), -3);
  assert.equal(daysFrom(new Date(2026, 9, 21, 0, 5), now), 1);
});

test("focus order: overdue, today, upcoming, no date; then date and priority", () => {
  const tasks = [
    { id: "none", dueDate: null, priority: "HIGH" as const },
    { id: "later", dueDate: due(3), priority: "HIGH" as const },
    { id: "today-low", dueDate: due(0), priority: "LOW" as const },
    { id: "today-high", dueDate: due(0), priority: "HIGH" as const },
    { id: "late", dueDate: due(-2), priority: "LOW" as const },
  ];
  assert.deepEqual(
    sortFocusTasks(tasks, now).map((task) => task.id),
    ["late", "today-high", "today-low", "later", "none"],
  );
});

test("due labels", () => {
  assert.equal(dueLabel(due(-3), now), "3 days late");
  assert.equal(dueLabel(due(-1), now), "Yesterday");
  assert.equal(dueLabel(due(0), now), "Today");
  assert.equal(dueLabel(due(1), now), "Tomorrow");
  assert.equal(dueLabel(due(2), now), "Thu");
  assert.equal(dueLabel(due(10), now), "Oct 30");
});

test("dailyCounts buckets the last seven days, oldest first", () => {
  const counts = dailyCounts([day(0), day(0), day(-6), day(-7), day(1), new Date(2026, 9, 18, 23, 59)], now);
  assert.deepEqual(counts, [1, 0, 0, 0, 1, 0, 2]);
});

test("overdueCounts follows creation, due date and completion", () => {
  const tasks = [
    // Due 5 days ago, still open: overdue from 4 days ago on.
    { dueDate: due(-5), createdAt: day(-10), completedAt: null },
    // Due 3 days ago, finished yesterday morning: overdue only at the end of 2 days ago.
    { dueDate: due(-3), createdAt: day(-10), completedAt: new Date(2026, 9, 19, 9, 0) },
    // Created today with a past due date: overdue today only.
    { dueDate: due(-2), createdAt: day(0), completedAt: null },
  ];
  // Days: -6 -5 -4 -3 -2 -1 0
  assert.deepEqual(overdueCounts(tasks, now), [0, 0, 1, 1, 2, 1, 2]);
});

test("project health: overdue is at risk, a quiet week is stale", () => {
  assert.deepEqual(projectHealth({ totalTasks: 13, doneTasks: 8, overdueTasks: 0, lastUpdate: day(-1) }, now), {
    status: "ON_TRACK",
    percentDone: 62,
    idleDays: 1,
  });
  assert.equal(projectHealth({ totalTasks: 8, doneTasks: 3, overdueTasks: 3, lastUpdate: day(0) }, now).status, "AT_RISK");
  assert.equal(projectHealth({ totalTasks: 5, doneTasks: 1, overdueTasks: 0, lastUpdate: day(-9) }, now).status, "STALE");
  assert.equal(projectHealth({ totalTasks: 0, doneTasks: 0, overdueTasks: 0, lastUpdate: day(0) }, now).percentDone, 0);
});

test("greeting by hour", () => {
  assert.equal(greetingFor(8), "Good morning");
  assert.equal(greetingFor(13), "Good afternoon");
  assert.equal(greetingFor(21), "Good evening");
});

test("task summary sentence", () => {
  assert.equal(taskSummary(4, 2), "4 tasks due today and 2 overdue.");
  assert.equal(taskSummary(1, 0), "1 task due today.");
  assert.equal(taskSummary(0, 1), "1 task overdue.");
  assert.equal(taskSummary(0, 0), "Nothing is due today.");
});

test("relative times", () => {
  const real = new Date("2026-10-20T17:20:00.000Z");
  assert.equal(relativeTime(new Date("2026-10-20T17:19:40.000Z"), real), "now");
  assert.equal(relativeTime(new Date("2026-10-20T17:08:00.000Z"), real), "12m");
  assert.equal(relativeTime(new Date("2026-10-20T14:20:00.000Z"), real), "3h");
  assert.equal(relativeTime(new Date("2026-10-18T17:20:00.000Z"), real), "2d");
  assert.match(relativeTime(new Date("2026-10-01T17:20:00.000Z"), real), /^(Sep 30|Oct 1)$/);
});

test("sparkline paths scale to the tallest value", () => {
  const { line, area, last } = sparklinePaths([0, 2, 4], 72, 26, 3);
  assert.equal(line, "M0 23 L36 13 L72 3");
  assert.equal(area, "M0 23 L36 13 L72 3 L72 26 L0 26Z");
  assert.deepEqual(last, { x: 72, y: 3 });
  assert.equal(sparklinePaths([0, 0]).line, "M0 23 L72 23");
});
