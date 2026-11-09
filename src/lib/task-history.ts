/**
 * A task's change history (#279): which changes become history entries, and
 * how they read. No server imports, so the rules have unit tests and the task
 * page shares the wording.
 *
 * Entries keep the values as they read at the time ("High", "Babel",
 * "Samuel"), the way Linear and Jira do, so renaming a project later doesn't
 * rewrite old history.
 */
import { priorityLabels, type Priority } from "@/lib/priority";

export type TaskEventKind =
  | "CREATED"
  | "STATUS"
  | "PRIORITY"
  | "ASSIGNEE"
  | "DUE_DATE"
  | "PROJECT"
  | "LABEL_ADDED"
  | "LABEL_REMOVED"
  | "TITLE"
  | "DESCRIPTION";

export type TaskEventDraft = { kind: TaskEventKind; fromValue: string | null; toValue: string | null };

/** What history compares: the fields people care about, as they read. */
export type TaskHistoryState = {
  title: string;
  description: string | null;
  status: "TODO" | "IN_PROGRESS" | "DONE";
  priority: Priority;
  /** `YYYY-MM-DD` or null. */
  dueDate: string | null;
  projectName: string | null;
  assigneeName: string | null;
  labelNames: string[];
};

export const STATUS_WORDS = { TODO: "To do", IN_PROGRESS: "In progress", DONE: "Done" } as const;

/** The history entries between two states of a task, in a stable order. */
export function diffTaskHistory(before: TaskHistoryState, after: TaskHistoryState): TaskEventDraft[] {
  const events: TaskEventDraft[] = [];
  if (before.title !== after.title) events.push({ kind: "TITLE", fromValue: before.title, toValue: after.title });
  if ((before.description ?? "") !== (after.description ?? "")) events.push({ kind: "DESCRIPTION", fromValue: null, toValue: null });
  if (before.status !== after.status) events.push({ kind: "STATUS", fromValue: STATUS_WORDS[before.status], toValue: STATUS_WORDS[after.status] });
  if (before.priority !== after.priority) {
    events.push({ kind: "PRIORITY", fromValue: priorityLabels[before.priority], toValue: priorityLabels[after.priority] });
  }
  if (before.dueDate !== after.dueDate) events.push({ kind: "DUE_DATE", fromValue: before.dueDate, toValue: after.dueDate });
  if (before.projectName !== after.projectName) events.push({ kind: "PROJECT", fromValue: before.projectName, toValue: after.projectName });
  if (before.assigneeName !== after.assigneeName) events.push({ kind: "ASSIGNEE", fromValue: before.assigneeName, toValue: after.assigneeName });
  const old = new Set(before.labelNames);
  const now = new Set(after.labelNames);
  for (const name of after.labelNames) if (!old.has(name)) events.push({ kind: "LABEL_ADDED", fromValue: null, toValue: name });
  for (const name of before.labelNames) if (!now.has(name)) events.push({ kind: "LABEL_REMOVED", fromValue: name, toValue: null });
  return events;
}

function dayName(key: string) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function quote(value: string) {
  return `“${value}”`;
}

/** "changed the priority from Medium to High": the sentence after the person's name. */
export function describeTaskEvent(event: TaskEventDraft) {
  const { kind, fromValue: from, toValue: to } = event;
  switch (kind) {
    case "CREATED":
      return "created the task";
    case "TITLE":
      return `renamed the task to ${quote(to ?? "")}`;
    case "DESCRIPTION":
      return "edited the description";
    case "STATUS":
      return to === "Done" ? "marked it done" : from === "Done" ? `reopened it as ${to}` : `moved it to ${to}`;
    case "PRIORITY":
      return to === priorityLabels.NONE ? "removed the priority" : `set the priority to ${to}${from && from !== priorityLabels.NONE ? ` (was ${from})` : ""}`;
    case "DUE_DATE":
      return to ? `set the due date to ${dayName(to)}${from ? ` (was ${dayName(from)})` : ""}` : "removed the due date";
    case "PROJECT":
      return to ? `moved it to ${to}${from ? ` from ${from}` : ""}` : `took it out of ${from ?? "its project"}`;
    case "ASSIGNEE":
      return to ? `assigned it to ${to}` : `unassigned ${from ?? "it"}`;
    case "LABEL_ADDED":
      return `added the label ${quote(to ?? "")}`;
    case "LABEL_REMOVED":
      return `removed the label ${quote(from ?? "")}`;
  }
}

/** How long a task title can be (#352): long enough to say everything, short enough to stay a title. */
export const TASK_TITLE_MAX = 2000;

/** How long a comment can be. */
export const COMMENT_MAX = 5000;

/** The trimmed comment, or null when it's empty or too long. */
export function cleanComment(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const body = value.replace(/\r\n/g, "\n").trim();
  return body && body.length <= COMMENT_MAX ? body : null;
}

/**
 * Who may comment on a task (#279): on a personal task, its owner; in a
 * project, every member (#385) and the task's assignee. `projectAccess` is
 * this person's level in the task's project, or null without one.
 */
export function mayCommentOnTask(
  task: { userId: string; projectId: string | null; assigneeUserId: string | null },
  userId: string,
  projectAccess: "OWNER" | "ADMIN" | "EDITOR" | null,
): boolean {
  if (!task.projectId) return task.userId === userId;
  return task.assigneeUserId === userId || projectAccess !== null;
}
