import { Priority, TaskStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

const DEMO_USER_EMAIL = "samuel@example.com";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function isValidStatus(value: unknown): value is TaskStatus {
  return typeof value === "string" && Object.values(TaskStatus).includes(value as TaskStatus);
}

function isValidPriority(value: unknown): value is Priority {
  return typeof value === "string" && Object.values(Priority).includes(value as Priority);
}

export async function PATCH(req: Request, context: RouteContext) {
  try {
    const { id } = await context.params;

    if (!id) {
      return NextResponse.json({ error: "Task id is required" }, { status: 400 });
    }

    const body = await req.json();

    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title) {
      return NextResponse.json({ error: "Title is required" }, { status: 400 });
    }

    if (!isValidStatus(body.status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }

    if (!isValidPriority(body.priority)) {
      return NextResponse.json({ error: "Invalid priority" }, { status: 400 });
    }

    let dueDate: Date | null = null;
    if (body.dueDate) {
      const parsed = new Date(body.dueDate);
      if (Number.isNaN(parsed.getTime())) {
        return NextResponse.json({ error: "Invalid due date" }, { status: 400 });
      }
      dueDate = parsed;
    }

    const description = typeof body.description === "string" ? body.description.trim() : "";

    const updated = await prisma.task.updateMany({
      where: {
        id,
        deletedAt: null,
        user: {
          email: DEMO_USER_EMAIL,
        },
      },
      data: {
        title,
        description: description || null,
        status: body.status,
        priority: body.priority,
        dueDate,
        completedAt: body.status === TaskStatus.DONE ? new Date() : null,
      },
      data: { deletedAt: new Date() },
    });

    if (updated.count === 0) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    const task = await prisma.task.findUnique({ where: { id } });
    return NextResponse.json(task, { status: 200 });
  } catch (error) {
    console.error("PATCH /api/tasks/[id] error:", error);
    return NextResponse.json({ error: "Failed to update task" }, { status: 500 });
  }
}

export async function DELETE(_req: Request, context: RouteContext) {
  try {
    const { id } = await context.params;

    if (!id) {
      return NextResponse.json({ error: "Task id is required" }, { status: 400 });
    }

    const deleted = await prisma.task.updateMany({
      where: {
        id,
        deletedAt: null,
        user: {
          email: DEMO_USER_EMAIL,
        },
      },
      data: { deletedAt: new Date() },
    });

    if (deleted.count === 0) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    return NextResponse.json({ message: "Task moved to trash" }, { status: 200 });
  } catch (error) {
    console.error("DELETE /api/tasks/[id] error:", error);
    return NextResponse.json({ error: "Failed to delete task" }, { status: 500 });
  }
}
