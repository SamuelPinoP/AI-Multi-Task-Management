import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { findEditableTask } from "@/lib/task-access";
import { visibleTaskWhere } from "@/lib/task-include";
import { createsDependencyCycle } from "@/lib/task-relations";

type RouteContext = { params: Promise<{ id: string }> };

/** Marks the task as blocked by another one (SMART-02). Body: `{ blockedById }`. */
export async function POST(req: Request, context: RouteContext) {
  try {
    const user = await requireApiUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

    const { id } = await context.params;
    const body = await req.json().catch(() => null);
    const blockedById = typeof body?.blockedById === "string" ? body.blockedById.trim() : "";
    if (!blockedById) return NextResponse.json({ error: "Pick the task this one waits on" }, { status: 400 });

    const found = await findEditableTask(id, user.id);
    if (found.response) return found.response;

    const blocker = await prisma.task.findFirst({
      where: { id: blockedById, ...visibleTaskWhere(user.id) },
      select: { id: true, title: true, status: true },
    });
    if (!blocker) return NextResponse.json({ error: "Invalid blocking task" }, { status: 400 });

    const loop = await createsDependencyCycle(id, blockedById, (taskIds) =>
      prisma.taskDependency.findMany({ where: { taskId: { in: taskIds } }, select: { taskId: true, blockedById: true } }),
    );
    if (loop) return NextResponse.json({ error: "These tasks would end up waiting on each other." }, { status: 400 });

    await prisma.taskDependency.upsert({
      where: { taskId_blockedById: { taskId: id, blockedById } },
      create: { taskId: id, blockedById },
      update: {},
    });
    return NextResponse.json({ blockedBy: blocker }, { status: 201 });
  } catch (error) {
    console.error("POST /api/tasks/[id]/dependencies error:", error);
    return NextResponse.json({ error: "Failed to add the dependency" }, { status: 500 });
  }
}
