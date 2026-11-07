import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getProjectAccess } from "@/lib/project-access";
import { formatTaskDueDateInput } from "@/lib/task-date-buckets";
import { diffTaskHistory, mayCommentOnTask, type TaskHistoryState } from "@/lib/task-history";

/** What a task's history compares (#279). */
export const HISTORY_SELECT = {
  id: true,
  title: true,
  description: true,
  status: true,
  priority: true,
  dueDate: true,
  project: { select: { name: true } },
  assignee: { select: { name: true } },
  labels: { select: { label: { select: { name: true } } } },
} satisfies Prisma.TaskSelect;

type HistoryRow = Prisma.TaskGetPayload<{ select: typeof HISTORY_SELECT }>;

function stateOf(task: HistoryRow): TaskHistoryState {
  return {
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    dueDate: task.dueDate ? formatTaskDueDateInput(task.dueDate) : null,
    projectName: task.project?.name ?? null,
    assigneeName: task.assignee?.name ?? null,
    labelNames: task.labels.map((row) => row.label.name).sort(),
  };
}

/** The tasks' current state, to compare after a change. */
export async function loadHistoryStates(ids: string[]) {
  const rows = await prisma.task.findMany({ where: { id: { in: ids } }, select: HISTORY_SELECT });
  return new Map(rows.map((row) => [row.id, stateOf(row)]));
}

/** Records what changed on each task between `before` and now. */
export async function recordTaskChanges(before: Map<string, TaskHistoryState>, actorId: string) {
  const after = await loadHistoryStates([...before.keys()]);
  const data = [...before].flatMap(([taskId, old]) => {
    const now = after.get(taskId);
    return now ? diffTaskHistory(old, now).map((event) => ({ ...event, taskId, actorId })) : [];
  });
  if (data.length) await prisma.taskEvent.createMany({ data });
}

export async function recordTaskCreated(taskId: string, actorId: string) {
  await prisma.taskEvent.create({ data: { taskId, actorId, kind: "CREATED" } });
}

/**
 * Who may comment on a task: its owner for a personal task; for a project
 * task, Owners and Editors, and its assignee even with view-only access.
 */
export async function canCommentOnTask(task: { userId: string; projectId: string | null; assignee: { userId: string | null } | null }, userId: string) {
  const assigneeUserId = task.assignee?.userId ?? null;
  // Only a project task that isn't assigned to this person needs their role in the project.
  const access = task.projectId && assigneeUserId !== userId ? await getProjectAccess(task.projectId, userId) : null;
  return mayCommentOnTask({ userId: task.userId, projectId: task.projectId, assigneeUserId }, userId, access?.accessLevel ?? null);
}
