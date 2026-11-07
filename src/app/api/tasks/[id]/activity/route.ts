import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { COMMENT_SELECT, commentJson, displayName, findVisibleTask } from "@/lib/task-comments-server";
import { canCommentOnTask } from "@/lib/task-history-server";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * A task's activity (#279): its comments and its history, oldest first, and
 * whether the caller may comment. Loaded when the task opens; never polled.
 */
export async function GET(_req: Request, context: RouteContext) {
  try {
    const user = await requireApiUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    const { id } = await context.params;

    const task = await findVisibleTask(id, user.id);
    if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });

    const [comments, events, canComment] = await Promise.all([
      prisma.taskComment.findMany({ where: { taskId: id }, orderBy: { createdAt: "asc" }, take: 500, select: COMMENT_SELECT }),
      prisma.taskEvent.findMany({
        where: { taskId: id },
        orderBy: { createdAt: "asc" },
        take: 500,
        select: { id: true, kind: true, fromValue: true, toValue: true, createdAt: true, actor: { select: { name: true, email: true } } },
      }),
      canCommentOnTask(task, user.id),
    ]);

    return NextResponse.json({
      comments: comments.map((comment) => commentJson(comment, user.id)),
      events: events.map(({ actor, ...event }) => ({ ...event, actor: displayName(actor) })),
      canComment,
    });
  } catch (error) {
    console.error("GET /api/tasks/[id]/activity error:", error);
    return NextResponse.json({ error: "Failed to load the activity" }, { status: 500 });
  }
}
