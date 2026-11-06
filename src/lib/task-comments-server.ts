import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { visibleTaskWhere } from "@/lib/task-include";

/** A person as the activity feed shows them: never their email, unless it's all we have. */
export function displayName(person: { name: string | null; email: string } | null) {
  if (!person) return "Someone";
  return person.name?.trim() || person.email.split("@")[0];
}

export const COMMENT_TASK_SELECT = {
  id: true,
  title: true,
  userId: true,
  projectId: true,
  assignee: { select: { userId: true } },
  project: { select: { name: true, userId: true } },
} satisfies Prisma.TaskSelect;

/** The task, if the user can see it. */
export function findVisibleTask(id: string, userId: string) {
  return prisma.task.findFirst({ where: { id, ...visibleTaskWhere(userId) }, select: COMMENT_TASK_SELECT });
}

export const COMMENT_SELECT = {
  id: true,
  body: true,
  createdAt: true,
  editedAt: true,
  author: { select: { id: true, name: true, email: true } },
} satisfies Prisma.TaskCommentSelect;

type CommentRow = Prisma.TaskCommentGetPayload<{ select: typeof COMMENT_SELECT }>;

/** A comment as the API returns it. */
export function commentJson(comment: CommentRow, userId: string) {
  return {
    id: comment.id,
    body: comment.body,
    createdAt: comment.createdAt,
    editedAt: comment.editedAt,
    author: { id: comment.author.id, name: displayName(comment.author) },
    mine: comment.author.id === userId,
  };
}
