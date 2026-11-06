import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { canEditProjectContent, getProjectAccess, projectAccessWhere } from "@/lib/project-access";
import { LABELS_PER_TASK_MAX } from "@/lib/labels";

/**
 * Who owns a set of labels (#276): a project's labels, or one person's
 * personal labels. A project task takes its project's labels; a personal task
 * takes its owner's.
 */
export type LabelScope = { projectId: string } | { userId: string };

export function labelScopeFor(task: { projectId: string | null; userId: string }): LabelScope {
  return task.projectId ? { projectId: task.projectId } : { userId: task.userId };
}

export function labelScopeWhere(scope: LabelScope): Prisma.LabelWhereInput {
  return "projectId" in scope ? { projectId: scope.projectId } : { userId: scope.userId, projectId: null };
}

/** Labels the user can see: their personal ones, and those of every project they belong to. */
export function visibleLabelWhere(userId: string): Prisma.LabelWhereInput {
  return { OR: [{ userId, projectId: null }, { project: projectAccessWhere(userId) }] };
}

export const LABEL_SELECT = { id: true, name: true, color: true, projectId: true } satisfies Prisma.LabelSelect;

/**
 * Checks the `labelIds` a task request sends: a list of distinct ids, all in
 * the task's scope. Returns the ids, `undefined` when the request left labels
 * out (keep them as they are), or an error for a 400.
 */
export async function resolveTaskLabelIds(input: unknown, scope: LabelScope): Promise<{ ids?: string[]; error?: string }> {
  if (input === undefined) return {};
  if (!Array.isArray(input) || input.some((id) => typeof id !== "string" || !id)) return { error: "Invalid labels" };
  const ids = [...new Set(input as string[])];
  if (ids.length > LABELS_PER_TASK_MAX) return { error: `A task can have at most ${LABELS_PER_TASK_MAX} labels` };
  if (!ids.length) return { ids };
  const found = await prisma.label.count({ where: { id: { in: ids }, ...labelScopeWhere(scope) } });
  return found === ids.length ? { ids } : { error: "Invalid label" };
}

/** Sets a task's labels to exactly `ids`. */
export async function setTaskLabels(taskId: string, ids: string[]) {
  await prisma.$transaction([
    prisma.taskLabel.deleteMany({ where: { taskId, labelId: { notIn: ids } } }),
    prisma.taskLabel.createMany({ data: ids.map((labelId) => ({ taskId, labelId })), skipDuplicates: true }),
  ]);
}

/** After a task moves to another project (or out of one), drops the labels that belonged to the old scope. */
export async function dropLabelsOutsideScope(taskIds: string[], scope: LabelScope) {
  if (!taskIds.length) return;
  await prisma.taskLabel.deleteMany({ where: { taskId: { in: taskIds }, NOT: { label: labelScopeWhere(scope) } } });
}

/** Whether the user may rename, recolor or delete a label: their own personal one, or one in a project they can edit. */
export async function canManageLabel(label: { userId: string | null; projectId: string | null }, userId: string) {
  if (label.projectId) return canEditProjectContent(await getProjectAccess(label.projectId, userId));
  return label.userId === userId;
}
