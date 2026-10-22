import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { getProjectAccess } from "@/lib/project-access";
import { markChatsRead } from "@/lib/project-chat-unread";

type RouteContext = { params: Promise<{ id: string }> };

/** Marks a project's chat read up to now: the open chat calls it when new messages arrive while it's showing. */
export async function POST(_req: Request, context: RouteContext) {
  try {
    const user = await requireApiUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

    const { id: projectId } = await context.params;
    if (!(await getProjectAccess(projectId, user.id))) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    await markChatsRead(user.id, [projectId]);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("POST /api/projects/[id]/chat-read error:", error);
    return NextResponse.json({ error: "Failed to mark the chat as read" }, { status: 500 });
  }
}
