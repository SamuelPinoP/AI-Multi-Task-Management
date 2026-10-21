import assert from "node:assert/strict";
import test from "node:test";
import { createsDependencyCycle, openBlockers, subtaskProgress, topLevelTasks } from "./task-relations";

test("subtask progress counts done subtasks", () => {
  assert.deepEqual(subtaskProgress([{ status: "DONE" }, { status: "TODO" }, { status: "IN_PROGRESS" }, { status: "DONE" }]), { done: 2, total: 4 });
  assert.deepEqual(subtaskProgress(undefined), { done: 0, total: 0 });
});

test("only open blockers block", () => {
  const blockers = openBlockers([
    { blockedBy: { id: "a", title: "A", status: "DONE" } },
    { blockedBy: { id: "b", title: "B", status: "IN_PROGRESS" } },
  ]);
  assert.deepEqual(blockers.map((task) => task.id), ["b"]);
  assert.deepEqual(openBlockers(undefined), []);
});

test("dependency loops are found, direct or through other tasks", async () => {
  // c waits on b, b waits on a.
  const edges = [
    { taskId: "c", blockedById: "b" },
    { taskId: "b", blockedById: "a" },
  ];
  const load = async (ids: string[]) => edges.filter((edge) => ids.includes(edge.taskId));

  assert.equal(await createsDependencyCycle("a", "a", load), true);
  // "b waits on c" would loop straight back.
  assert.equal(await createsDependencyCycle("b", "c", load), true);
  // "a waits on c" loops through b.
  assert.equal(await createsDependencyCycle("a", "c", load), true);
  // "c waits on a" adds a shortcut, not a loop.
  assert.equal(await createsDependencyCycle("c", "a", load), false);
  assert.equal(await createsDependencyCycle("d", "c", load), false);
});

test("a loop that doesn't include the task doesn't hang the check", async () => {
  const edges = [
    { taskId: "x", blockedById: "y" },
    { taskId: "y", blockedById: "x" },
  ];
  const load = async (ids: string[]) => edges.filter((edge) => ids.includes(edge.taskId));
  assert.equal(await createsDependencyCycle("z", "x", load), false);
});

test("the list keeps top-level tasks and orphaned subtasks", () => {
  const tasks = [
    { id: "parent", parentId: null },
    { id: "child", parentId: "parent" },
    { id: "orphan", parentId: "deleted-parent" },
    { id: "plain" },
  ];
  assert.deepEqual(topLevelTasks(tasks).map((task) => task.id), ["parent", "orphan", "plain"]);
});
