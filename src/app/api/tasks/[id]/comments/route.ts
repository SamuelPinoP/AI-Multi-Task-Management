import { after, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { notifyTaskComment } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";
import { consumeRateLimit } from "@/lib/rate-limit";
import { RATE_LIMITS } from "@/lib/rate-limit-core";
import { COMMENT_SELECT, commentJson, findVisibleTask } from "@/lib/task-comments-server";
import { cleanComment, COMMENT_MAX } from "@/lib/task-history";
import { canCommentOnTask } from "@/lib/task-history-server";

type RouteContext = { params: Promise<{ id: string }> };

/** Adds a comment to a task (#279). "@Name" notifies those members; the assignee hears about it too. */
export async function POST(req: Request, context: RouteContext) {
  try {
    const user = await requireApiUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    const { id } = await context.params;

    const body = (await req.json().catch(() => null)) as { body?: unknown } | null;
    const text = cleanComment(body?.body);
    if (!text) return NextResponse.json({ error: `Write a comment of up to ${COMMENT_MAX} characters.` }, { status: 400 });

    const task = await findVisibleTask(id, user.id);
    if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });
    if (!(await canCommentOnTask(task, user.id))) {
      return NextResponse.json({ error: "You can read this task's comments, but only its project's editors and assignee can add to them." }, { status: 403 });
    }

    const limit = await consumeRateLimit(RATE_LIMITS.taskComments, user.id);
    if (!limit.allowed) return NextResponse.json({ error: "That's a lot of comments at once. Try again in a minute." }, { status: 429 });

    const comment = await prisma.taskComment.create({ data: { taskId: id, authorId: user.id, body: text }, select: COMMENT_SELECT });
    after(() => notifyTaskComment({ task, author: user, body: text }));
    return NextResponse.json(commentJson(comment, user.id), { status: 201 });
  } catch (error) {
    console.error("POST /api/tasks/[id]/comments error:", error);
    return NextResponse.json({ error: "Failed to add the comment" }, { status: 500 });
  }
}
