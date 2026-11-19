import { prisma } from "@/lib/prisma";
import { requireApiUser } from "@/lib/auth";
import { NextResponse } from "next/server";
import { parseBody, taskUpdateSchema } from "@/lib/schemas/task";
import { taskInclude, visibleTaskWhere } from "@/lib/task-include";
import { trashTask, updateTask } from "@/lib/task-writes";
import { runFollowUps } from "@/lib/writes";

type RouteContext = {
  params: Promise<{ id: string }>;
};

/** One task, as the list returns it: for the task page to refresh (#352). */
export async function GET(_req: Request, context: RouteContext) {
  try {
    const user = await requireApiUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    const { id } = await context.params;
    const task = await prisma.task.findFirst({ where: { id, ...visibleTaskWhere(user.id) }, include: taskInclude(user.id) });
    if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });
    return NextResponse.json(task);
  } catch (error) {
    console.error("GET /api/tasks/[id] error:", error);
    return NextResponse.json({ error: "Failed to fetch the task" }, { status: 500 });
  }
}

export async function PATCH(req: Request, context: RouteContext) {
  try {
    const user = await requireApiUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

    const { id } = await context.params;

    if (!id) {
      return NextResponse.json({ error: "Task id is required" }, { status: 400 });
    }

    // Every field, checked as in src/lib/schemas/task.ts; the rules that need the database are in
    // updateTask, which the AI's changes use too.
    const parsed = parseBody(taskUpdateSchema, await req.json());
    if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

    const result = await updateTask(user, id, parsed.data);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    runFollowUps(user, [result.followUp]);
    return NextResponse.json(result.value, { status: 200 });
  } catch (error) {
    console.error("PATCH /api/tasks/[id] error:", error);
    return NextResponse.json({ error: "Failed to update task" }, { status: 500 });
  }
}

export async function DELETE(_req: Request, context: RouteContext) {
  try {
    const user = await requireApiUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

    const { id } = await context.params;

    if (!id) {
      return NextResponse.json({ error: "Task id is required" }, { status: 400 });
    }

    const result = await trashTask(user, id);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    runFollowUps(user, [result.followUp]);
    return NextResponse.json({ message: "Task moved to trash" }, { status: 200 });
  } catch (error) {
    console.error("DELETE /api/tasks/[id] error:", error);
    return NextResponse.json({ error: "Failed to delete task" }, { status: 500 });
  }
}
