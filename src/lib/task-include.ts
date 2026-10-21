import type { Prisma } from "@prisma/client";
import { projectAccessWhere } from "@/lib/project-access";

/** Tasks the user can see: their own, and tasks in projects they belong to. */
export function visibleTaskWhere(userId: string) {
  return { deletedAt: null, OR: [{ userId }, { project: projectAccessWhere(userId) }] } satisfies Prisma.TaskWhereInput;
}

/**
 * What task responses include: project, assignee, subtasks and blockers
 * (SMART-02). Subtasks and blockers are limited to tasks the user can see.
 */
export function taskInclude(userId: string) {
  const visible = visibleTaskWhere(userId);
  return {
    project: { select: { id: true, name: true, color: true } },
    assignee: { select: { id: true, name: true, email: true, role: true } },
    subtasks: { where: visible, orderBy: { createdAt: "asc" }, select: { id: true, title: true, status: true } },
    blockedBy: {
      where: { blockedBy: visible },
      orderBy: { createdAt: "asc" },
      select: { blockedBy: { select: { id: true, title: true, status: true } } },
    },
  } satisfies Prisma.TaskInclude;
}
