import assert from "node:assert/strict";
import test from "node:test";
import {
  activityAction,
  bandSuggestion,
  barHeights,
  dailyCounts,
  daysFrom,
  describeWeek,
  dueLabel,
  formatMinutes,
  greetingFor,
  nowAndNext,
  overdueCounts,
  projectHealth,
  relativeTime,
  sortFocusTasks,
  taskSummary,
  weekDayLabels,
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
  assert.deepEqual(projectHealth({ totalTasks: 13, doneTasks: 8, inProgressTasks: 0, overdueTasks: 0, lastUpdate: day(-1) }, now), {
    status: "ON_TRACK",
    percentDone: 62,
    idleDays: 1,
  });
  assert.equal(projectHealth({ totalTasks: 8, doneTasks: 3, inProgressTasks: 0, overdueTasks: 3, lastUpdate: day(0) }, now).status, "AT_RISK");
  assert.equal(projectHealth({ totalTasks: 5, doneTasks: 1, inProgressTasks: 0, overdueTasks: 0, lastUpdate: day(-9) }, now).status, "STALE");
  assert.equal(projectHealth({ totalTasks: 0, doneTasks: 0, inProgressTasks: 0, overdueTasks: 0, lastUpdate: day(0) }, now).percentDone, 0);
});

test("project health: nothing done or in progress hasn't started", () => {
  const fresh = { totalTasks: 4, doneTasks: 0, inProgressTasks: 0, overdueTasks: 0, lastUpdate: day(0) };
  assert.equal(projectHealth(fresh, now).status, "NOT_STARTED");
  assert.equal(projectHealth({ ...fresh, totalTasks: 0 }, now).status, "NOT_STARTED");
  assert.equal(projectHealth({ ...fresh, inProgressTasks: 1 }, now).status, "ON_TRACK");
  assert.equal(projectHealth({ ...fresh, doneTasks: 1 }, now).status, "ON_TRACK");
  // Overdue and quiet projects keep their status.
  assert.equal(projectHealth({ ...fresh, overdueTasks: 1 }, now).status, "AT_RISK");
  assert.equal(projectHealth({ ...fresh, lastUpdate: day(-9) }, now).status, "STALE");
});

test("activity messages read on after a name", () => {
  assert.equal(activityAction("Created task: “Draft slides”"), "created the task “Draft slides”");
  assert.equal(activityAction("Completed task: “Fix: login”"), "completed the task “Fix: login”");
  assert.equal(activityAction("Restored note: “Plan”"), "restored the note “Plan”");
  assert.equal(activityAction('Added a discussion comment in project "AI Multi".'), 'added a discussion comment in project "AI Multi"');
  // A message that starts with a name or an acronym stays as it is.
  assert.equal(activityAction("AI planner suggested a task"), "AI planner suggested a task");
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
  // Older dates: in the runtime's own zone (UTC-12 to UTC+14), or in the one given.
  const eveningInUtc = new Date("2026-10-01T17:20:00.000Z");
  const morningInUtc = new Date("2026-10-01T05:00:00.000Z");
  assert.match(relativeTime(eveningInUtc, real), /^(Sep 30|Oct 1|Oct 2)$/);
  assert.equal(relativeTime(eveningInUtc, real, "UTC"), "Oct 1");
  assert.equal(relativeTime(eveningInUtc, real, "Pacific/Kiritimati"), "Oct 2");
  assert.equal(relativeTime(morningInUtc, real, "Pacific/Pago_Pago"), "Sep 30");
  assert.equal(relativeTime(morningInUtc, real, null), relativeTime(morningInUtc, real));
});

test("bar heights scale to the busiest day, and an empty week stays flat", () => {
  assert.deepEqual(barHeights([0, 2, 4]), [0, 0.5, 1]);
  assert.deepEqual(barHeights([0, 0, 0]), [0, 0, 0]);
  assert.deepEqual(barHeights([]), []);
});

test("minutes read as hours and minutes", () => {
  assert.equal(formatMinutes(0), "0 min");
  assert.equal(formatMinutes(45), "45 min");
  assert.equal(formatMinutes(60), "1 h");
  assert.equal(formatMinutes(110.4), "1 h 50 min");
  assert.equal(formatMinutes(-5), "0 min");
});

test("week labels end with today, and the series reads out with its days", () => {
  assert.deepEqual(weekDayLabels(now), ["Wed", "Thu", "Fri", "Sat", "Sun", "Mon", "Today"]);
  assert.equal(describeWeek([0, 1, 0, 0, 2, 0, 3], now), "Wed 0, Thu 1, Fri 0, Sat 0, Sun 2, Mon 0, Today 3");
  // Across a month boundary: Sunday, November 1.
  assert.deepEqual(weekDayLabels(new Date(2026, 10, 1, 9), 3), ["Fri", "Sat", "Today"]);
});

// Today at hh:mm on the same wall clock as `now` above.
const at = (hours: number, minutes = 0) => new Date(2026, 9, 20, hours, minutes);
const standup = { title: "Standup", start: at(9), end: at(9, 30), hasStartTime: true };
const review = { title: "Review", start: at(13), end: at(14), hasStartTime: true };
const sync = { title: "Sync", start: at(16), end: at(17), hasStartTime: true };
const allDay = { title: "Holiday", start: at(0), end: null, hasStartTime: false };
const topTask = { id: "slides", title: "Draft slides" };
const secondTask = { id: "budget", title: "Check the budget" };

test("now and next: the event under way and the next one to start", () => {
  const band = nowAndNext([sync, allDay, standup, review], at(13, 20), [topTask]);
  assert.equal(band.current?.title, "Review");
  assert.equal(band.next?.title, "Sync");
  // An event under way wins over the top Focus task.
  assert.equal(band.task, null);
  assert.equal(band.empty, false);
});

test("now and next: between events, after the last one, and an event with no end", () => {
  const reminder = { title: "Call back", start: at(12), end: null, hasStartTime: true };
  assert.deepEqual(nowAndNext([standup, sync, reminder], at(12, 30)), { current: null, task: null, next: sync, empty: false });
  assert.deepEqual(nowAndNext([standup, sync], at(18)), { current: null, task: null, next: null, empty: false });
  // An event ends at its end time: at 9:30 the standup is over.
  assert.equal(nowAndNext([standup], at(9, 30)).current, null);
  assert.equal(nowAndNext([], at(9)).next, null);
});

test("now and next: with no event under way, Now falls back to the top Focus task", () => {
  assert.equal(nowAndNext([standup, sync], at(12), [topTask, secondTask]).task, topTask);
  assert.equal(nowAndNext([], at(12), [topTask, secondTask]).task, topTask);
  assert.equal(nowAndNext([standup], at(12), []).task, null);
});

test("now and next: the band is empty only with no events and no tasks", () => {
  assert.equal(nowAndNext([], at(12), []).empty, true);
  // An all-day event or a task is enough to show the full band.
  assert.equal(nowAndNext([allDay], at(12), []).empty, false);
  assert.equal(nowAndNext([], at(12), [topTask]).empty, false);
});

test("suggested next skips events and the task Now already shows", () => {
  const event = { kind: "EVENT", related: { type: "EVENT", id: "standup" } };
  const slides = { kind: "TASK", related: { type: "TASK", id: "slides" } };
  const budget = { kind: "TASK", related: { type: "TASK", id: "budget" } };
  const project = { kind: "PROJECT", related: { type: "PROJECT", id: "slides" } };
  assert.equal(bandSuggestion([event, slides, budget], "slides"), budget);
  assert.equal(bandSuggestion([event, slides, budget], null), slides);
  // Only tasks are matched by id; a project with the same id still counts.
  assert.equal(bandSuggestion([slides, project], "slides"), project);
  assert.equal(bandSuggestion([event, slides], "slides"), null);
  assert.equal(bandSuggestion([], null), null);
});
