import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { editableTaskWhere } from "@/lib/goals";
import { prisma } from "@/lib/prisma";

type RouteContext = { params: Promise<{ id: string; taskId: string }> };

/** Unlinks a task from the goal; the task itself stays. */
export async function DELETE(_req: Request, context: RouteContext) {
  try {
    const user = await requireApiUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

    const { id, taskId } = await context.params;
    const goal = await prisma.weeklyGoal.findFirst({ where: { id, userId: user.id }, select: { id: true } });
    if (!goal) return NextResponse.json({ error: "Goal not found" }, { status: 404 });

    const unlinked = await prisma.task.updateMany({ where: { id: taskId, goalId: goal.id, ...editableTaskWhere(user.id) }, data: { goalId: null } });
    if (unlinked.count === 0) return NextResponse.json({ error: "Task not found" }, { status: 404 });
    return NextResponse.json({ message: "Task unlinked" });
  } catch (error) {
    console.error("DELETE /api/goals/[id]/tasks/[taskId] error:", error);
    return NextResponse.json({ error: "Failed to unlink the task" }, { status: 500 });
  }
}
