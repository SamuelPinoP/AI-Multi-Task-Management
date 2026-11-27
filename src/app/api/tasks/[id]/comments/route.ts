import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { addTaskComment, commentJson } from "@/lib/task-comments-server";
import { cleanComment, COMMENT_MAX } from "@/lib/task-history";
import { runFollowUps } from "@/lib/writes";

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

    // The rules are in addTaskComment, which connected AI apps' comments follow too (#479).
    const result = await addTaskComment(user, id, text);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    runFollowUps(user, [result.followUp]);
    return NextResponse.json(commentJson(result.value, user.id), { status: 201 });
  } catch (error) {
    console.error("POST /api/tasks/[id]/comments error:", error);
    return NextResponse.json({ error: "Failed to add the comment" }, { status: 500 });
  }
}
