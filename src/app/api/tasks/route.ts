import { Priority, Recurrence, TaskStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { createActivity } from "@/lib/activity";

const DEMO_USER_EMAIL = "samuel@example.com";

function isValidStatus(value: unknown): value is TaskStatus {
  return typeof value === "string" && Object.values(TaskStatus).includes(value as TaskStatus);
}
function isValidPriority(value: unknown): value is Priority {
  return typeof value === "string" && Object.values(Priority).includes(value as Priority);
}
function isValidRecurrence(value: unknown): value is Recurrence {
  return typeof value === "string" && Object.values(Recurrence).includes(value as Recurrence);
}
function parseId(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  return trimmed || null;
}

export async function GET() {
  try {
    const user = await prisma.user.findUnique({
      where: { email: DEMO_USER_EMAIL },
      include: {
        tasks: {
          where: { deletedAt: null },
          orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
          include: {
            project: { select: { id: true, name: true, color: true } },
            assignee: { select: { id: true, name: true, email: true, role: true } },
          },
        },
      },
    });
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });
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
    const projectId = parseId(body.projectId);
    const assigneeId = parseId(body.assigneeId);

    if (!title) return NextResponse.json({ error: "Title is required" }, { status: 400 });
    if (body.status && !isValidStatus(body.status)) return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    if (body.priority && !isValidPriority(body.priority)) return NextResponse.json({ error: "Invalid priority" }, { status: 400 });
    if (body.recurrence && !isValidRecurrence(body.recurrence)) return NextResponse.json({ error: "Invalid recurrence" }, { status: 400 });

    let dueDate: Date | null = null;
    if (body.dueDate) {
      const parsed = new Date(body.dueDate);
      if (Number.isNaN(parsed.getTime())) return NextResponse.json({ error: "Invalid due date" }, { status: 400 });
      dueDate = parsed;
    }

    const user = await prisma.user.findUnique({ where: { email: DEMO_USER_EMAIL } });
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

    if (projectId) {
      const project = await prisma.project.findFirst({ where: { id: projectId, userId: user.id } });
      if (!project) return NextResponse.json({ error: "Invalid project" }, { status: 400 });
    }

    if (assigneeId) {
      if (!projectId) return NextResponse.json({ error: "Assignee requires a project" }, { status: 400 });
      const member = await prisma.projectMember.findFirst({ where: { id: assigneeId, projectId } });
      if (!member) return NextResponse.json({ error: "Invalid assignee" }, { status: 400 });
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
        recurrence: isValidRecurrence(body.recurrence) ? body.recurrence : Recurrence.NONE,
        userId: user.id,
        projectId,
        assigneeId,
      },
      include: {
        project: { select: { id: true, name: true, color: true } },
        assignee: { select: { id: true, name: true, email: true, role: true } },
      },
    });

    void createActivity({ userId: user.id, action: status === TaskStatus.DONE ? "COMPLETED_TASK" : "CREATED_TASK", message: `${status === TaskStatus.DONE ? "Completed task" : "Created task"}: “${task.title}”`, entityType: "TASK", entityId: task.id, projectId: task.projectId });
    return NextResponse.json(task, { status: 201 });
  } catch (error) {
    console.error("POST /api/tasks error:", error);
    return NextResponse.json({ error: "Failed to create task" }, { status: 500 });
  }
}
