import { NextResponse } from "next/server";
import { createActivity } from "@/lib/activity";
import { requireApiUser } from "@/lib/auth";
import { editableTaskWhere } from "@/lib/goals";
import { prisma } from "@/lib/prisma";
import { projectAccessWhere } from "@/lib/project-access";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Links a task to the goal (SMART-04): `{ taskId }` links an existing task
 * you can edit; `{ title }` creates a new personal task for the goal.
 */
export async function POST(req: Request, context: RouteContext) {
  try {
    const user = await requireApiUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

    const { id } = await context.params;
    const goal = await prisma.weeklyGoal.findFirst({ where: { id, userId: user.id }, select: { id: true } });
    if (!goal) return NextResponse.json({ error: "Goal not found" }, { status: 404 });

    const body = await req.json().catch(() => null);
    const title = typeof body?.title === "string" ? body.title.trim().slice(0, 200) : "";
    const taskId = typeof body?.taskId === "string" ? body.taskId : "";

    if (title) {
      const task = await prisma.task.create({ data: { title, userId: user.id, goalId: goal.id }, select: { id: true, title: true } });
      void createActivity({ userId: user.id, action: "CREATED_TASK", message: `Created task: “${task.title}”`, entityType: "TASK", entityId: task.id });
      return NextResponse.json(task, { status: 201 });
    }
    if (!taskId) return NextResponse.json({ error: "Pick a task or type a title" }, { status: 400 });

    const linked = await prisma.task.updateMany({ where: { id: taskId, ...editableTaskWhere(user.id) }, data: { goalId: goal.id } });
    if (linked.count === 0) {
      // Say "can't edit" only to people who can already see the task.
      const visible = await prisma.task.findFirst({
        where: { id: taskId, deletedAt: null, OR: [{ userId: user.id }, { project: projectAccessWhere(user.id) }] },
        select: { id: true },
      });
      return visible
        ? NextResponse.json({ error: "You can't change this task" }, { status: 403 })
        : NextResponse.json({ error: "Task not found" }, { status: 404 });
    }
    return NextResponse.json({ id: taskId }, { status: 200 });
  } catch (error) {
    console.error("POST /api/goals/[id]/tasks error:", error);
    return NextResponse.json({ error: "Failed to link the task" }, { status: 500 });
  }
}
