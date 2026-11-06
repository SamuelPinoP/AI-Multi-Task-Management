/**
 * Changing several tasks at once (#281): the request shapes, checked here
 * without server imports so the rules have unit tests and the page can share
 * the types. `PATCH /api/tasks/bulk` applies them.
 */
import { isPriority, priorityLabels, type Priority } from "@/lib/priority";

/** At most this many tasks per request. */
export const BULK_TASK_LIMIT = 200;

export type BulkStatus = "TODO" | "IN_PROGRESS" | "DONE";
const STATUSES: readonly BulkStatus[] = ["TODO", "IN_PROGRESS", "DONE"];

/** One change applied to every chosen task; fields left out stay as they are. */
export type BulkTaskChange = {
  status?: BulkStatus;
  priority?: Priority;
  /** `YYYY-MM-DD`, or null for no due date. */
  dueDate?: string | null;
  /** Null takes the tasks out of their project. */
  projectId?: string | null;
  /** Null unassigns them. */
  assigneeId?: string | null;
  addLabelIds?: string[];
  removeLabelIds?: string[];
};

/** A task's fields before a bulk change, so Undo can put each one back. */
export type TaskSnapshot = {
  id: string;
  status: BulkStatus;
  priority: Priority;
  dueDate: string | null;
  projectId: string | null;
  assigneeId: string | null;
  labelIds: string[];
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function isId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 64;
}

function idList(value: unknown, max: number) {
  if (!Array.isArray(value) || !value.every(isId)) return null;
  const ids = [...new Set(value as string[])];
  return ids.length <= max ? ids : null;
}

/** The task ids: 1 to 200 distinct strings. */
export function parseBulkIds(value: unknown): { ids?: string[]; error?: string } {
  const ids = idList(value, BULK_TASK_LIMIT);
  if (!ids) return { error: `Send between 1 and ${BULK_TASK_LIMIT} task ids.` };
  if (!ids.length) return { error: "Pick at least one task." };
  return { ids };
}

function nullableId(value: unknown): string | null | undefined {
  if (value === null || value === "") return null;
  return isId(value) ? value : undefined;
}

/** Checks a change. Every field is optional, but at least one must be there. */
export function parseBulkChange(value: unknown): { change?: BulkTaskChange; error?: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { error: "Say what to change." };
  const input = value as Record<string, unknown>;
  const change: BulkTaskChange = {};

  if (input.status !== undefined) {
    if (!STATUSES.includes(input.status as BulkStatus)) return { error: "Invalid status" };
    change.status = input.status as BulkStatus;
  }
  if (input.priority !== undefined) {
    if (!isPriority(input.priority)) return { error: "Invalid priority" };
    change.priority = input.priority;
  }
  if (input.dueDate !== undefined) {
    if (input.dueDate !== null && !(typeof input.dueDate === "string" && DATE.test(input.dueDate))) return { error: "Invalid due date" };
    change.dueDate = input.dueDate as string | null;
  }
  if (input.projectId !== undefined) {
    const projectId = nullableId(input.projectId);
    if (projectId === undefined) return { error: "Invalid project" };
    change.projectId = projectId;
  }
  if (input.assigneeId !== undefined) {
    const assigneeId = nullableId(input.assigneeId);
    if (assigneeId === undefined) return { error: "Invalid assignee" };
    change.assigneeId = assigneeId;
  }
  for (const key of ["addLabelIds", "removeLabelIds"] as const) {
    if (input[key] === undefined) continue;
    const ids = idList(input[key], 20);
    if (!ids) return { error: "Invalid labels" };
    if (ids.length) change[key] = ids;
  }
  if (change.addLabelIds && change.removeLabelIds?.some((id) => change.addLabelIds?.includes(id))) {
    return { error: "A label can't be added and removed at once." };
  }
  if (!Object.keys(change).length) return { error: "Say what to change." };
  return { change };
}

/** Checks Undo's snapshots: one per task, every field present. */
export function parseSnapshots(value: unknown): { snapshots?: TaskSnapshot[]; error?: string } {
  if (!Array.isArray(value) || !value.length || value.length > BULK_TASK_LIMIT) return { error: "Nothing to restore." };
  const snapshots: TaskSnapshot[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object") return { error: "Invalid snapshot" };
    const raw = item as Record<string, unknown>;
    const projectId = nullableId(raw.projectId);
    const assigneeId = nullableId(raw.assigneeId);
    const labelIds = idList(raw.labelIds, 20);
    if (
      !isId(raw.id) ||
      seen.has(raw.id) ||
      !STATUSES.includes(raw.status as BulkStatus) ||
      !isPriority(raw.priority) ||
      !(raw.dueDate === null || (typeof raw.dueDate === "string" && DATE.test(raw.dueDate))) ||
      projectId === undefined ||
      assigneeId === undefined ||
      !labelIds
    ) {
      return { error: "Invalid snapshot" };
    }
    seen.add(raw.id);
    snapshots.push({
      id: raw.id,
      status: raw.status as BulkStatus,
      priority: raw.priority,
      dueDate: raw.dueDate as string | null,
      projectId,
      assigneeId,
      labelIds,
    });
  }
  return { snapshots };
}

/** `completedAt` after a status change: kept for tasks that stay done, now for newly done, cleared otherwise. */
export function nextCompletedAtFor(oldStatus: BulkStatus, newStatus: BulkStatus, previous: Date | null, now: Date) {
  if (newStatus !== "DONE") return null;
  return oldStatus === "DONE" ? previous : now;
}

const STATUS_WORDS: Record<BulkStatus, string> = { TODO: "To do", IN_PROGRESS: "In progress", DONE: "Done" };

function tasksWord(count: number) {
  return `${count} task${count === 1 ? "" : "s"}`;
}

/** The toast after a bulk change, e.g. "3 tasks set to High priority". */
export function describeBulkChange(
  change: BulkTaskChange,
  count: number,
  names: { project?: string; assignee?: string; label?: string; due?: string } = {},
) {
  const tasks = tasksWord(count);
  if (change.status === "DONE") return `${tasks} marked done`;
  if (change.status) return `${tasks} moved to ${STATUS_WORDS[change.status]}`;
  if (change.priority) return change.priority === "NONE" ? `Priority cleared on ${tasks}` : `${tasks} set to ${priorityLabels[change.priority]} priority`;
  if (change.dueDate !== undefined) return change.dueDate === null ? `Due date cleared on ${tasks}` : `${tasks} due ${names.due ?? change.dueDate}`;
  if (change.projectId !== undefined) return change.projectId === null ? `${tasks} taken out of their project` : `${tasks} moved to ${names.project ?? "the project"}`;
  if (change.assigneeId !== undefined) return change.assigneeId === null ? `${tasks} unassigned` : `${tasks} assigned to ${names.assignee ?? "a member"}`;
  if (change.addLabelIds) return `Label ${names.label ? `“${names.label}” ` : ""}added to ${tasks}`;
  if (change.removeLabelIds) return `Label ${names.label ? `“${names.label}” ` : ""}removed from ${tasks}`;
  return `${tasks} changed`;
}
