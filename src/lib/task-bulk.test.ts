import assert from "node:assert/strict";
import test from "node:test";
import {
  BULK_TASK_LIMIT,
  describeBulkChange,
  nextCompletedAtFor,
  parseBulkChange,
  parseBulkIds,
  parseSnapshots,
} from "./task-bulk";

test("ids: 1 to 200 distinct strings", () => {
  assert.deepEqual(parseBulkIds(["a", "b", "a"]).ids, ["a", "b"]);
  assert.ok(parseBulkIds([]).error);
  assert.ok(parseBulkIds("a").error);
  assert.ok(parseBulkIds(["a", 3]).error);
  assert.ok(parseBulkIds([""]).error);
  const many = Array.from({ length: BULK_TASK_LIMIT + 1 }, (_, index) => `t${index}`);
  assert.ok(parseBulkIds(many).error);
  assert.equal(parseBulkIds(many.slice(0, BULK_TASK_LIMIT)).ids?.length, BULK_TASK_LIMIT);
});

test("a change needs at least one valid field", () => {
  assert.ok(parseBulkChange({}).error);
  assert.ok(parseBulkChange(null).error);
  assert.ok(parseBulkChange([]).error);
  assert.deepEqual(parseBulkChange({ priority: "URGENT" }).change, { priority: "URGENT" });
  assert.deepEqual(parseBulkChange({ status: "DONE", dueDate: null }).change, { status: "DONE", dueDate: null });
  assert.ok(parseBulkChange({ priority: "CRITICAL" }).error);
  assert.ok(parseBulkChange({ status: "ARCHIVED" }).error);
  assert.ok(parseBulkChange({ dueDate: "next friday" }).error);
  assert.deepEqual(parseBulkChange({ dueDate: "2026-11-13" }).change, { dueDate: "2026-11-13" });
});

test("project and assignee: an id, or null (or empty) to clear", () => {
  assert.deepEqual(parseBulkChange({ projectId: "p1" }).change, { projectId: "p1" });
  assert.deepEqual(parseBulkChange({ projectId: "" }).change, { projectId: null });
  assert.deepEqual(parseBulkChange({ assigneeId: null }).change, { assigneeId: null });
  assert.ok(parseBulkChange({ projectId: 7 }).error);
});

test("labels: lists of ids, never the same label added and removed", () => {
  assert.deepEqual(parseBulkChange({ addLabelIds: ["l1", "l1"] }).change, { addLabelIds: ["l1"] });
  assert.ok(parseBulkChange({ addLabelIds: ["l1"], removeLabelIds: ["l1"] }).error);
  assert.ok(parseBulkChange({ addLabelIds: "l1" }).error);
  // An empty list changes nothing, so on its own it isn't a change.
  assert.ok(parseBulkChange({ removeLabelIds: [] }).error);
});

test("snapshots for Undo carry every field, once per task", () => {
  const snapshot = { id: "t1", status: "TODO", priority: "NONE", dueDate: null, projectId: null, assigneeId: null, labelIds: [] };
  assert.equal(parseSnapshots([snapshot]).snapshots?.length, 1);
  assert.ok(parseSnapshots([snapshot, snapshot]).error);
  assert.ok(parseSnapshots([{ ...snapshot, priority: undefined }]).error);
  assert.ok(parseSnapshots([{ ...snapshot, dueDate: "soon" }]).error);
  assert.ok(parseSnapshots([]).error);
  assert.ok(parseSnapshots("t1").error);
});

test("completedAt: kept for tasks already done, now for newly done, cleared otherwise", () => {
  const before = new Date("2026-11-01T10:00:00Z");
  const now = new Date("2026-11-06T10:00:00Z");
  assert.equal(nextCompletedAtFor("DONE", "DONE", before, now), before);
  assert.equal(nextCompletedAtFor("TODO", "DONE", null, now), now);
  assert.equal(nextCompletedAtFor("DONE", "TODO", before, now), null);
  assert.equal(nextCompletedAtFor("IN_PROGRESS", "IN_PROGRESS", null, now), null);
});

test("toasts say what happened in plain words", () => {
  assert.equal(describeBulkChange({ status: "DONE" }, 3), "3 tasks marked done");
  assert.equal(describeBulkChange({ priority: "HIGH" }, 1), "1 task set to High priority");
  assert.equal(describeBulkChange({ priority: "NONE" }, 2), "Priority cleared on 2 tasks");
  assert.equal(describeBulkChange({ dueDate: null }, 2), "Due date cleared on 2 tasks");
  assert.equal(describeBulkChange({ dueDate: "2026-11-13" }, 2, { due: "Fri, Nov 13" }), "2 tasks due Fri, Nov 13");
  assert.equal(describeBulkChange({ projectId: "p" }, 2, { project: "Babel" }), "2 tasks moved to Babel");
  assert.equal(describeBulkChange({ assigneeId: null }, 4), "4 tasks unassigned");
  assert.equal(describeBulkChange({ addLabelIds: ["l"] }, 2, { label: "bug" }), "Label “bug” added to 2 tasks");
});
