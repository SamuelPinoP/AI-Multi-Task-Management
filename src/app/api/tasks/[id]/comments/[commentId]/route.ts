import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { COMMENT_SELECT, commentJson, findVisibleTask } from "@/lib/task-comments-server";
import { cleanComment, COMMENT_MAX } from "@/lib/task-history";

type RouteContext = { params: Promise<{ id: string; commentId: string }> };

/** The comment, when the user can see its task and wrote it; otherwise the response to send. */
async function findOwnComment(taskId: string, commentId: string, userId: string) {
  const task = await findVisibleTask(taskId, userId);
  if (!task) return { response: NextResponse.json({ error: "Task not found" }, { status: 404 }) };
  const comment = await prisma.taskComment.findFirst({ where: { id: commentId, taskId }, select: { id: true, authorId: true } });
  if (!comment) return { response: NextResponse.json({ error: "Comment not found" }, { status: 404 }) };
  if (comment.authorId !== userId) {
    return { response: NextResponse.json({ error: "Only the person who wrote a comment can change it." }, { status: 403 }) };
  }
  return { comment };
}

/** Edits your own comment (#279). */
export async function PATCH(req: Request, context: RouteContext) {
  try {
    const user = await requireApiUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    const { id, commentId } = await context.params;

    const body = (await req.json().catch(() => null)) as { body?: unknown } | null;
    const text = cleanComment(body?.body);
    if (!text) return NextResponse.json({ error: `Write a comment of up to ${COMMENT_MAX} characters.` }, { status: 400 });

    const found = await findOwnComment(id, commentId, user.id);
    if (found.response) return found.response;

    const comment = await prisma.taskComment.update({
      where: { id: commentId },
      data: { body: text, editedAt: new Date() },
      select: COMMENT_SELECT,
    });
    return NextResponse.json(commentJson(comment, user.id));
  } catch (error) {
    console.error("PATCH /api/tasks/[id]/comments/[commentId] error:", error);
    return NextResponse.json({ error: "Failed to edit the comment" }, { status: 500 });
  }
}

/** Deletes your own comment (#279). */
export async function DELETE(_req: Request, context: RouteContext) {
  try {
    const user = await requireApiUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    const { id, commentId } = await context.params;

    const found = await findOwnComment(id, commentId, user.id);
    if (found.response) return found.response;

    await prisma.taskComment.delete({ where: { id: commentId } });
    return NextResponse.json({ message: "Comment deleted" });
  } catch (error) {
    console.error("DELETE /api/tasks/[id]/comments/[commentId] error:", error);
    return NextResponse.json({ error: "Failed to delete the comment" }, { status: 500 });
  }
}
