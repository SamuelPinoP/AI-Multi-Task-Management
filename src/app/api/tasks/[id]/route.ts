import { Priority, Recurrence, TaskStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { createActivity } from "@/lib/activity";

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

function isValidRecurrence(value: unknown): value is Recurrence {
  return typeof value === "string" && Object.values(Recurrence).includes(value as Recurrence);
}

function parseProjectId(input: unknown): string | null {
  if (typeof input !== "string") {
    return null;
  }

  const trimmed = input.trim();
  return trimmed || null;
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

    if (!isValidRecurrence(body.recurrence)) {
      return NextResponse.json({ error: "Invalid recurrence" }, { status: 400 });
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
    const projectId = parseProjectId(body.projectId);
    const assigneeId = parseProjectId(body.assigneeId);

    const user = await prisma.user.findUnique({ where: { email: DEMO_USER_EMAIL } });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if (projectId) {
      const project = await prisma.project.findFirst({
        where: { id: projectId, userId: user.id },
      });

      if (!project) {
        return NextResponse.json({ error: "Invalid project" }, { status: 400 });
      }
    }

    const existingTask = await prisma.task.findFirst({
      where: {
        id,
        deletedAt: null,
        user: { email: DEMO_USER_EMAIL },
      },
      select: { id: true, status: true, title: true, userId: true },
    });

    if (!existingTask) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

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
        recurrence: body.recurrence,
        projectId,
        assigneeId,
      },
    });

    if (updated.count === 0) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    const task = await prisma.task.findUnique({
      where: { id },
      include: {
        project: {
          select: { id: true, name: true, color: true },
        },
        assignee: {
          select: { id: true, name: true, email: true, role: true },
        },
      },
    });
    if (task && existingTask.status !== TaskStatus.DONE && task.status === TaskStatus.DONE) {
      void createActivity({
        userId: existingTask.userId,
        action: "COMPLETED_TASK",
        message: `Completed task: “${task.title}”`,
        entityType: "TASK",
        entityId: task.id,
        projectId: task.projectId,
      });
    }

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

    const existingTask = await prisma.task.findFirst({
      where: { id, deletedAt: null, user: { email: DEMO_USER_EMAIL } },
      select: { id: true, title: true, userId: true, projectId: true },
    });

    if (!existingTask) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    const deleted = await prisma.task.updateMany({
      where: {
        id,
        deletedAt: null,
        user: {
          email: DEMO_USER_EMAIL,
        },
      },
      data: {
        deletedAt: new Date(),
      },
    });

    if (deleted.count === 0) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    void createActivity({
      userId: existingTask.userId,
      action: "DELETED_ITEM",
      message: `Deleted task: “${existingTask.title}”`,
      entityType: "TASK",
      entityId: existingTask.id,
      projectId: existingTask.projectId,
    });

    return NextResponse.json({ message: "Task moved to trash" }, { status: 200 });
  } catch (error) {
    console.error("DELETE /api/tasks/[id] error:", error);
    return NextResponse.json({ error: "Failed to delete task" }, { status: 500 });
  }
}
