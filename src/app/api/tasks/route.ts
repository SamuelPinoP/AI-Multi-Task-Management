import { Priority, TaskStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

const DEMO_USER_EMAIL = "samuel@example.com";

function isValidStatus(value: unknown): value is TaskStatus {
  return typeof value === "string" && Object.values(TaskStatus).includes(value as TaskStatus);
}

function isValidPriority(value: unknown): value is Priority {
  return typeof value === "string" && Object.values(Priority).includes(value as Priority);
}

export async function GET() {
  try {
    const user = await prisma.user.findUnique({
      where: { email: DEMO_USER_EMAIL },
      include: {
        tasks: {
          where: { deletedAt: null },
          orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
        },
      },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json(user.tasks);
  } catch (error) {
    console.error("GET /api/tasks error:", error);
    return NextResponse.json({ error: "Failed to fetch tasks" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const descriptionInput = typeof body.description === "string" ? body.description.trim() : "";

    if (!title) {
      return NextResponse.json({ error: "Title is required" }, { status: 400 });
    }

    if (body.status && !isValidStatus(body.status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }

    if (body.priority && !isValidPriority(body.priority)) {
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

    const user = await prisma.user.findUnique({ where: { email: DEMO_USER_EMAIL } });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const status = isValidStatus(body.status) ? body.status : TaskStatus.TODO;

    const task = await prisma.task.create({
      data: {
        title,
        description: descriptionInput || null,
        status,
        priority: isValidPriority(body.priority) ? body.priority : Priority.MEDIUM,
        dueDate,
        completedAt: status === TaskStatus.DONE ? new Date() : null,
        userId: user.id,
      },
    });

    return NextResponse.json(task, { status: 201 });
  } catch (error) {
    console.error("POST /api/tasks error:", error);
    return NextResponse.json({ error: "Failed to create task" }, { status: 500 });
  }
}
