import assert from "node:assert/strict";
import test from "node:test";
import { parseTaskDueDateForStorage } from "@/lib/task-date-buckets";
import { TASK_TITLE_MAX } from "@/lib/task-history";
import { parseBody, taskCreateSchema, taskUpdateSchema, TITLE_TOO_LONG } from "./task";

const create = (body: unknown) => parseBody(taskCreateSchema, body);
const update = (body: unknown) => parseBody(taskUpdateSchema, body);
const errorOf = (result: { error: string } | { data: unknown }) => ("error" in result ? result.error : null);

const FULL_UPDATE = { title: "Write the report", status: "TODO", priority: "NONE", recurrence: "NONE" };

test("a new task needs only a title: the rest is left out, empty or null", () => {
  const result = create({ title: "  Buy milk  " });
  assert.ok("data" in result);
  // Status, priority, repeat and labels are left out, so the task gets the defaults (src/lib/task-writes.ts).
  assert.deepEqual(result.data, {
    title: "Buy milk",
    dueDate: null,
    description: "",
    projectId: null,
    assigneeId: null,
    parentId: null,
    noteId: null,
  });
});

test("a title is required, after trimming, and stays under the limit with the routes' messages", () => {
  for (const title of [undefined, "", "   ", 42, null]) assert.equal(errorOf(create({ title })), "Title is required", String(title));
  assert.equal(errorOf(create({ title: "x".repeat(TASK_TITLE_MAX) })), null);
  assert.equal(errorOf(create({ title: "x".repeat(TASK_TITLE_MAX + 1) })), TITLE_TOO_LONG);
  assert.equal(TITLE_TOO_LONG, "Keep the title under 2000 characters; put the rest in the description.");
});

test("an empty status, priority or repeat counts as left out on a new task; a wrong one is refused", () => {
  for (const empty of ["", null, false, undefined]) {
    const result = create({ title: "T", status: empty, priority: empty, recurrence: empty });
    assert.ok("data" in result, String(empty));
    assert.deepEqual([result.data.status, result.data.priority, result.data.recurrence], [undefined, undefined, undefined]);
  }
  const result = create({ title: "T", status: "IN_PROGRESS", priority: "HIGH", recurrence: "WEEKLY" });
  assert.ok("data" in result);
  assert.deepEqual([result.data.status, result.data.priority, result.data.recurrence], ["IN_PROGRESS", "HIGH", "WEEKLY"]);

  assert.equal(errorOf(create({ title: "T", status: "LATER" })), "Invalid status");
  assert.equal(errorOf(create({ title: "T", priority: "CRITICAL" })), "Invalid priority");
  assert.equal(errorOf(create({ title: "T", recurrence: "YEARLY" })), "Invalid recurrence");
  assert.equal(errorOf(create({ title: "T", status: 3 })), "Invalid status");
});

test("a due date is a day, stored as the routes store it; empty means none, and anything else is refused", () => {
  const result = create({ title: "T", dueDate: "2026-11-20" });
  assert.ok("data" in result);
  assert.deepEqual(result.data.dueDate, parseTaskDueDateForStorage("2026-11-20"));
  const longer = create({ title: "T", dueDate: "2026-11-20T00:00:00.000Z" });
  assert.ok("data" in longer);
  assert.deepEqual(longer.data.dueDate, parseTaskDueDateForStorage("2026-11-20"));

  for (const empty of ["", null, undefined]) {
    const none = create({ title: "T", dueDate: empty });
    assert.ok("data" in none);
    assert.equal(none.data.dueDate, null);
  }
  for (const wrong of ["next Friday", 20261120, { day: 20 }]) assert.equal(errorOf(create({ title: "T", dueDate: wrong })), "Invalid due date", String(wrong));
});

test("ids are trimmed, and a blank or non-text id is none", () => {
  const result = create({ title: "T", projectId: "  p1  ", assigneeId: "", parentId: 7, noteId: null, labelIds: ["l1"] });
  assert.ok("data" in result);
  assert.deepEqual(
    [result.data.projectId, result.data.assigneeId, result.data.parentId, result.data.noteId, result.data.labelIds],
    ["p1", null, null, null, ["l1"]],
  );
});

test("the first problem is reported in the order the routes checked: title, status, priority, repeat, due date", () => {
  assert.equal(errorOf(create({ title: "", status: "LATER", dueDate: "soon" })), "Title is required");
  assert.equal(errorOf(create({ title: "T", status: "LATER", priority: "CRITICAL" })), "Invalid status");
  assert.equal(errorOf(create({ title: "T", priority: "CRITICAL", recurrence: "YEARLY" })), "Invalid priority");
  assert.equal(errorOf(create({ title: "T", recurrence: "YEARLY", dueDate: "soon" })), "Invalid recurrence");
});

test("an edit sends every field: status, priority and repeat are required", () => {
  const result = update({ ...FULL_UPDATE, description: "  Due Friday  ", dueDate: "2026-11-23", projectId: "p1", assigneeId: " m1 " });
  assert.ok("data" in result);
  assert.deepEqual(result.data, {
    title: "Write the report",
    status: "TODO",
    priority: "NONE",
    recurrence: "NONE",
    dueDate: parseTaskDueDateForStorage("2026-11-23"),
    description: "Due Friday",
    projectId: "p1",
    assigneeId: "m1",
  });

  assert.equal(errorOf(update({ title: "T" })), "Invalid status");
  assert.equal(errorOf(update({ ...FULL_UPDATE, priority: undefined })), "Invalid priority");
  assert.equal(errorOf(update({ ...FULL_UPDATE, recurrence: "" })), "Invalid recurrence");
  assert.equal(errorOf(update({ ...FULL_UPDATE, title: " " })), "Title is required");
});

test("a body that isn't an object reads as empty, so it gets the title's message", () => {
  for (const body of [null, [], "title", 5]) assert.equal(errorOf(create(body)), "Title is required", JSON.stringify(body));
});
