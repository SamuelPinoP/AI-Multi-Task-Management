import assert from "node:assert/strict";
import test from "node:test";
import { parseEventTimes, parseRepeatUntil } from "./event-time";
import { describeTemplateContents, findProjectTemplate, planTemplate, PROJECT_TEMPLATES } from "./project-templates";
import { parseTaskDueDateForStorage } from "./task-date-buckets";

const today = { year: 2026, month: 10, day: 21 };

test("the three templates from the issue exist and are found by id", () => {
  assert.deepEqual(
    PROJECT_TEMPLATES.map((template) => template.id),
    ["capstone", "sprint", "job-search"],
  );
  assert.equal(findProjectTemplate("sprint")?.name, "Sprint");
  assert.equal(findProjectTemplate("nope"), null);
  assert.equal(findProjectTemplate(undefined), null);
  assert.equal(findProjectTemplate(42), null);
});

test("every template's tasks and events pass the same checks as the forms", () => {
  for (const template of PROJECT_TEMPLATES) {
    const plan = planTemplate(template, today);
    assert.ok(plan.tasks.length > 0, template.id);
    assert.ok(plan.events.length > 0, template.id);
    for (const task of plan.tasks) {
      assert.ok(task.title.trim(), template.id);
      if (task.dueDate) assert.ok(parseTaskDueDateForStorage(task.dueDate), `${template.id}: ${task.title}`);
    }
    for (const event of plan.events) {
      assert.ok(parseEventTimes(event).value, `${template.id}: ${event.title}`);
      assert.equal(parseRepeatUntil(event, event.recurrence !== "NONE").error, undefined, `${template.id}: ${event.title}`);
    }
  }
});

test("dates count from the creation day, across month and year ends", () => {
  const capstone = planTemplate(findProjectTemplate("capstone")!, { year: 2026, month: 12, day: 30 });
  assert.equal(capstone.tasks[0].dueDate, "2027-01-02");
  assert.equal(capstone.tasks.at(-1)?.dueDate, "2027-03-24");
  assert.deepEqual(capstone.events[0], {
    title: "Advisor check-in",
    description: "Progress since last time, blockers, and the plan for next week.",
    recurrence: "WEEKLY",
    startDate: "2027-01-06",
    startTime: "10:00",
    endDate: null,
    endTime: "10:30",
    repeatUntil: "2027-03-24",
  });
});

test("templates fill the board, repeat weekly tasks and leave open-ended check-ins open", () => {
  const sprint = planTemplate(findProjectTemplate("sprint")!, today);
  assert.equal(sprint.tasks[0].status, "IN_PROGRESS");
  assert.equal(sprint.tasks[0].dueDate, "2026-10-21");
  assert.equal(sprint.events.find((event) => event.recurrence === "NONE")?.repeatUntil, null);

  const jobs = planTemplate(findProjectTemplate("job-search")!, today);
  assert.ok(jobs.tasks.some((task) => task.recurrence === "WEEKLY"));
  assert.equal(jobs.events[0].repeatUntil, null);

  const capstone = planTemplate(findProjectTemplate("capstone")!, today);
  assert.deepEqual(capstone.tasks.find((task) => task.title === "Write the final report")?.subtasks, [
    "First draft",
    "Revise with feedback",
    "Proofread",
  ]);
});

test("the picker says what a template adds", () => {
  assert.equal(describeTemplateContents(findProjectTemplate("capstone")!), "Adds 10 tasks and a recurring check-in");
  assert.equal(describeTemplateContents(findProjectTemplate("sprint")!), "Adds 7 tasks and a recurring check-in");
});
