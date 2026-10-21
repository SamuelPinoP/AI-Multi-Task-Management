import assert from "node:assert/strict";
import test from "node:test";
import { mondayOf, nextWeekDayKey, shiftWeek, weekDayKeys, weekKeyOf, weekLabel, weekStart, weeklyReview } from "./weekly-review";

test("ISO week keys, including the weeks around New Year", () => {
  assert.equal(weekKeyOf(new Date(2026, 9, 21)), "2026-W43");
  assert.equal(weekKeyOf(new Date(2026, 9, 19)), "2026-W43");
  assert.equal(weekKeyOf(new Date(2026, 9, 25)), "2026-W43");
  // Jan 1, 2027 is a Friday, so it belongs to 2026's last week.
  assert.equal(weekKeyOf(new Date(2027, 0, 1)), "2026-W53");
  assert.equal(weekKeyOf(new Date(2027, 0, 4)), "2027-W01");
  // Dec 29, 2025 is the Monday of 2026-W01.
  assert.equal(weekKeyOf(new Date(2025, 11, 29)), "2026-W01");
});

test("week starts, shifts and labels", () => {
  assert.deepEqual(weekStart("2026-W43"), new Date(2026, 9, 19));
  assert.deepEqual(mondayOf(new Date(2026, 9, 25, 23, 0)), new Date(2026, 9, 19));
  assert.equal(weekStart("2026-W54"), null);
  assert.equal(weekStart("2027-W53"), null);
  assert.equal(weekStart("nonsense"), null);
  assert.equal(shiftWeek("2026-W43", 1), "2026-W44");
  assert.equal(shiftWeek("2026-W53", 1), "2027-W01");
  assert.equal(shiftWeek("2026-W01", -1), "2025-W52");
  assert.equal(weekLabel("2026-W43"), "Oct 19 – 25");
  assert.equal(weekLabel("2026-W44"), "Oct 26 – Nov 1");
  assert.deepEqual(weekDayKeys("2026-W43"), [
    "2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25",
  ]);
});

test("carrying forward keeps the weekday", () => {
  assert.equal(nextWeekDayKey("2026-10-20"), "2026-10-27");
  assert.equal(nextWeekDayKey(new Date(Date.UTC(2026, 9, 28))), "2026-11-04");
  // Across the end of daylight saving time in many zones.
  assert.equal(nextWeekDayKey("2026-10-31"), "2026-11-07");
});

test("the review sorts tasks and goals into done, slipped and next", () => {
  // Wednesday of 2026-W43.
  const now = new Date(2026, 9, 21, 15, 0);
  const due = (day: number) => new Date(Date.UTC(2026, 9, day));
  const tasks = [
    { id: "done-mon", title: "", status: "DONE" as const, dueDate: due(19), completedAt: new Date(2026, 9, 19, 17, 0) },
    { id: "done-last-week", title: "", status: "DONE" as const, dueDate: null, completedAt: new Date(2026, 9, 18, 23, 0) },
    { id: "slipped-tue", title: "", status: "TODO" as const, dueDate: due(20), completedAt: null },
    { id: "due-today", title: "", status: "IN_PROGRESS" as const, dueDate: due(21), completedAt: null },
    { id: "due-fri", title: "", status: "TODO" as const, dueDate: due(23), completedAt: null },
    { id: "next-mon", title: "", status: "TODO" as const, dueDate: due(26), completedAt: null },
    { id: "older", title: "", status: "TODO" as const, dueDate: due(12), completedAt: null },
  ];
  const goals = [
    { id: "g-open", title: "", status: "ACTIVE" as const, targetWeek: "2026-W43" },
    { id: "g-done", title: "", status: "COMPLETED" as const, targetWeek: "2026-W43" },
    { id: "g-next", title: "", status: "ACTIVE" as const, targetWeek: "2026-W44" },
  ];
  const review = weeklyReview("2026-W43", tasks, goals, now);
  assert.deepEqual(review.done.map((task) => task.id), ["done-mon"]);
  assert.deepEqual(review.slipped.map((task) => task.id), ["slipped-tue", "due-today"]);
  assert.deepEqual(review.openGoals.map((goal) => goal.id), ["g-open"]);
  assert.deepEqual(review.nextTasks.map((task) => task.id), ["next-mon"]);
  assert.deepEqual(review.nextGoals.map((goal) => goal.id), ["g-next"]);

  // Reviewing a past week: everything due that week counts.
  const later = weeklyReview("2026-W43", tasks, goals, new Date(2026, 10, 2));
  assert.deepEqual(later.slipped.map((task) => task.id), ["slipped-tue", "due-today", "due-fri"]);
});
