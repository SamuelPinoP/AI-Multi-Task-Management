import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { findEditableTask } from "@/lib/task-access";

type RouteContext = { params: Promise<{ id: string; blockedById: string }> };

/** Stops the task waiting on `blockedById` (SMART-02). */
export async function DELETE(_req: Request, context: RouteContext) {
  try {
    const user = await requireApiUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

    const { id, blockedById } = await context.params;
    const found = await findEditableTask(id, user.id);
    if (found.response) return found.response;

    await prisma.taskDependency.deleteMany({ where: { taskId: id, blockedById } });
    return NextResponse.json({ message: "Dependency removed" }, { status: 200 });
  } catch (error) {
    console.error("DELETE /api/tasks/[id]/dependencies/[blockedById] error:", error);
    return NextResponse.json({ error: "Failed to remove the dependency" }, { status: 500 });
  }
}
