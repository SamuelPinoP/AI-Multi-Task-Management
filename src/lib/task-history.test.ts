import assert from "node:assert/strict";
import test from "node:test";
import { cleanComment, COMMENT_MAX, describeTaskEvent, diffTaskHistory, mayCommentOnTask, type TaskHistoryState } from "./task-history";

const base: TaskHistoryState = {
  title: "Free tier metrics",
  description: "Vercel limits",
  status: "TODO",
  priority: "NONE",
  dueDate: null,
  projectName: null,
  assigneeName: null,
  labelNames: ["research"],
};

test("no change, no history", () => {
  assert.deepEqual(diffTaskHistory(base, { ...base }), []);
  // An empty description and none at all are the same.
  assert.deepEqual(diffTaskHistory({ ...base, description: "" }, { ...base, description: null }), []);
});

test("each changed field becomes one entry, with the values as they read", () => {
  const after: TaskHistoryState = {
    ...base,
    status: "DONE",
    priority: "HIGH",
    dueDate: "2026-11-13",
    projectName: "Babel",
    assigneeName: "Samuel",
    labelNames: ["design"],
  };
  assert.deepEqual(diffTaskHistory(base, after), [
    { kind: "STATUS", fromValue: "To do", toValue: "Done" },
    { kind: "PRIORITY", fromValue: "No priority", toValue: "High" },
    { kind: "DUE_DATE", fromValue: null, toValue: "2026-11-13" },
    { kind: "PROJECT", fromValue: null, toValue: "Babel" },
    { kind: "ASSIGNEE", fromValue: null, toValue: "Samuel" },
    { kind: "LABEL_ADDED", fromValue: null, toValue: "design" },
    { kind: "LABEL_REMOVED", fromValue: "research", toValue: null },
  ]);
});

test("title and description changes are recorded; the description's text isn't copied", () => {
  assert.deepEqual(diffTaskHistory(base, { ...base, title: "Usage page", description: "New text" }), [
    { kind: "TITLE", fromValue: "Free tier metrics", toValue: "Usage page" },
    { kind: "DESCRIPTION", fromValue: null, toValue: null },
  ]);
});

test("entries read as plain sentences", () => {
  assert.equal(describeTaskEvent({ kind: "CREATED", fromValue: null, toValue: null }), "created the task");
  assert.equal(describeTaskEvent({ kind: "STATUS", fromValue: "To do", toValue: "Done" }), "marked it done");
  assert.equal(describeTaskEvent({ kind: "STATUS", fromValue: "Done", toValue: "To do" }), "reopened it as To do");
  assert.equal(describeTaskEvent({ kind: "STATUS", fromValue: "To do", toValue: "In progress" }), "moved it to In progress");
  assert.equal(describeTaskEvent({ kind: "PRIORITY", fromValue: "No priority", toValue: "High" }), "set the priority to High");
  assert.equal(describeTaskEvent({ kind: "PRIORITY", fromValue: "Medium", toValue: "High" }), "set the priority to High (was Medium)");
  assert.equal(describeTaskEvent({ kind: "PRIORITY", fromValue: "High", toValue: "No priority" }), "removed the priority");
  assert.equal(describeTaskEvent({ kind: "DUE_DATE", fromValue: "2026-11-13", toValue: null }), "removed the due date");
  assert.match(describeTaskEvent({ kind: "DUE_DATE", fromValue: null, toValue: "2026-11-13" }), /^set the due date to Nov 13, 2026$/);
  assert.equal(describeTaskEvent({ kind: "PROJECT", fromValue: null, toValue: "Babel" }), "moved it to Babel");
  assert.equal(describeTaskEvent({ kind: "PROJECT", fromValue: "Babel", toValue: null }), "took it out of Babel");
  assert.equal(describeTaskEvent({ kind: "ASSIGNEE", fromValue: "Ana", toValue: null }), "unassigned Ana");
  assert.equal(describeTaskEvent({ kind: "LABEL_ADDED", fromValue: null, toValue: "bug" }), "added the label “bug”");
});

test("comments: trimmed, Windows line breaks unified, empty or too long refused", () => {
  assert.equal(cleanComment("  Looks good\r\nShip it  "), "Looks good\nShip it");
  assert.equal(cleanComment("   "), null);
  assert.equal(cleanComment(42), null);
  assert.equal(cleanComment("x".repeat(COMMENT_MAX)), "x".repeat(COMMENT_MAX));
  assert.equal(cleanComment("x".repeat(COMMENT_MAX + 1)), null);
});

test("who may comment: a personal task's owner; in a project, every member and the assignee", () => {
  const personal = { userId: "owner", projectId: null, assigneeUserId: null };
  assert.equal(mayCommentOnTask(personal, "owner", null), true);
  assert.equal(mayCommentOnTask(personal, "someone else", null), false);

  const shared = { userId: "owner", projectId: "project", assigneeUserId: "assignee" };
  assert.equal(mayCommentOnTask(shared, "owner", "OWNER"), true);
  assert.equal(mayCommentOnTask(shared, "admin", "ADMIN"), true);
  assert.equal(mayCommentOnTask(shared, "editor", "EDITOR"), true);
  assert.equal(mayCommentOnTask(shared, "assignee", "EDITOR"), true);
  assert.equal(mayCommentOnTask(shared, "outsider", null), false);
});
