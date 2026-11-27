import "server-only";
import type { Prisma } from "@prisma/client";
import type { Db } from "@/lib/db-client";
import { prisma } from "@/lib/prisma";
import { consumeRateLimit } from "@/lib/rate-limit";
import { RATE_LIMITS } from "@/lib/rate-limit-core";
import { canCommentOnTask } from "@/lib/task-history-server";
import { visibleTaskWhere } from "@/lib/task-include";
import { refuse, type WriteActor, type WriteResult } from "@/lib/writes";

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
export function findVisibleTask(id: string, userId: string, db: Db = prisma) {
  return db.task.findFirst({ where: { id, ...visibleTaskWhere(userId) }, select: COMMENT_TASK_SELECT });
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

export const COMMENT_NOT_ALLOWED = "You can read this task's comments, but only its project's editors and assignee can add to them.";
export const TOO_MANY_COMMENTS = "That's a lot of comments at once. Try again in a minute.";

/**
 * Adds a comment, already cleaned (cleanComment), to a task the person can see (#279): the rules of
 * POST /api/tasks/[id]/comments, which connected AI apps' comments follow too (#479). "@Name"
 * notifies those members, and the assignee hears about it, once the comment is committed.
 */
export async function addTaskComment(actor: WriteActor, taskId: string, body: string, db: Db = prisma): Promise<WriteResult<CommentRow>> {
  const task = await findVisibleTask(taskId, actor.id, db);
  if (!task) return refuse(404, "Task not found");
  if (!(await canCommentOnTask(task, actor.id, db))) return refuse(403, COMMENT_NOT_ALLOWED);

  const limit = await consumeRateLimit(RATE_LIMITS.taskComments, actor.id);
  if (!limit.allowed) return refuse(429, TOO_MANY_COMMENTS);

  const comment = await db.taskComment.create({ data: { taskId, authorId: actor.id, body }, select: COMMENT_SELECT });
  return { ok: true, value: comment, followUp: { commented: { task, author: actor, body } } };
}
