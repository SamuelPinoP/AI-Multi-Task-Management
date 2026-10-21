import assert from "node:assert/strict";
import test from "node:test";
import { burnUp, projectInsights, STALE_TASK_DAYS, type InsightTask } from "./project-insights";

// Wednesday, October 21, 2026, 10 AM wall clock.
const now = new Date(2026, 9, 21, 10, 0);
const day = (offset: number, hour = 9) => new Date(2026, 9, 21 + offset, hour, 0);
const dueDate = (offset: number) => new Date(Date.UTC(2026, 9, 21 + offset));

function task(overrides: Partial<InsightTask> & { id: string }): InsightTask {
  return {
    title: overrides.id,
    status: "TODO",
    dueDate: null,
    createdAt: day(-3),
    updatedAt: day(-1),
    completedAt: null,
    ...overrides,
  };
}

test("burn-up counts scope and done at the end of each day", () => {
  const points = burnUp(
    [
      task({ id: "a", createdAt: day(-5) }),
      task({ id: "b", createdAt: day(-5), status: "DONE", completedAt: day(-2) }),
      task({ id: "c", createdAt: day(-1), status: "DONE", completedAt: day(0) }),
    ],
    now,
  );
  // A young project still gets a week of daily points, ending today.
  assert.equal(points.length, 8);
  assert.deepEqual(points.at(-1)?.date, new Date(2026, 9, 21));
  assert.deepEqual(
    points.map((point) => [point.scope, point.done]),
    [[0, 0], [0, 0], [2, 0], [2, 0], [2, 0], [2, 1], [3, 1], [3, 2]],
  );
});

test("burn-up switches to weekly points after a month and stops at 12 weeks", () => {
  const sixWeeks = burnUp([task({ id: "a", createdAt: day(-40) })], now);
  assert.equal(sixWeeks.length, 7);
  assert.equal(sixWeeks[1].date.getTime() - sixWeeks[0].date.getTime() >= 6 * 86_400_000, true);

  const old = burnUp([task({ id: "a", createdAt: day(-400) })], now);
  assert.equal(old.length, 13);
  assert.equal(old[0].scope, 1);
});

test("a reopened task is not done; old finished tasks fall back to their last update", () => {
  const points = burnUp(
    [task({ id: "reopened", status: "TODO", completedAt: null }), task({ id: "legacy", status: "DONE", updatedAt: day(-1) })],
    now,
  );
  assert.equal(points.at(-1)?.done, 1);
  assert.equal(points.at(-3)?.done, 0);
});

test("on track, with progress and the week's completions", () => {
  const insights = projectInsights(
    [
      task({ id: "a", dueDate: dueDate(2) }),
      task({ id: "b", status: "DONE", completedAt: day(-2) }),
      task({ id: "c", status: "DONE", completedAt: day(-10), updatedAt: day(-10) }),
      task({ id: "d" }),
    ],
    { updatedAt: day(-30) },
    now,
  );
  assert.equal(insights.status, "ON_TRACK");
  assert.equal(insights.reason, "Nothing is overdue");
  assert.equal(insights.percentDone, 50);
  assert.equal(insights.doneThisWeek, 1);
  assert.equal(insights.overduePercent, 0);
});

test("overdue work puts a project at risk", () => {
  const insights = projectInsights(
    [task({ id: "a", dueDate: dueDate(-1) }), task({ id: "b", dueDate: dueDate(-3) }), task({ id: "c" }), task({ id: "d", status: "DONE", dueDate: dueDate(-5) })],
    { updatedAt: day(0) },
    now,
  );
  assert.equal(insights.status, "AT_RISK");
  assert.equal(insights.reason, "2 tasks past due");
  assert.equal(insights.overdue, 2);
  assert.equal(insights.overduePercent, 67);
});

test("no updates for a week makes a project stale; old open tasks are listed", () => {
  const insights = projectInsights(
    [
      task({ id: "recent", updatedAt: day(-8) }),
      task({ id: "old", updatedAt: day(-STALE_TASK_DAYS) }),
      task({ id: "older", updatedAt: day(-30) }),
      task({ id: "finished", status: "DONE", completedAt: day(-40), updatedAt: day(-40) }),
    ],
    { updatedAt: day(-20) },
    now,
  );
  assert.equal(insights.status, "STALE");
  assert.equal(insights.reason, "No updates in 8 days");
  assert.deepEqual(
    insights.staleTasks.map((item) => [item.id, item.idleDays]),
    [["older", 30], ["old", STALE_TASK_DAYS]],
  );
});

test("an empty project", () => {
  const insights = projectInsights([], { updatedAt: day(0) }, now);
  assert.equal(insights.status, "ON_TRACK");
  assert.equal(insights.reason, "No tasks yet");
  assert.equal(insights.percentDone, 0);
  assert.equal(insights.burnUp.length, 8);
});
