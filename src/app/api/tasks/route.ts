import { prisma } from "@/lib/prisma";
import { requireApiUser } from "@/lib/auth";
import { NextResponse } from "next/server";
import { projectAccessWhere } from "@/lib/project-access";
import { taskInclude } from "@/lib/task-include";
import { guestLimitResponse } from "@/lib/guest-limits";
import { parseBody, taskCreateSchema } from "@/lib/schemas/task";
import { createTask } from "@/lib/task-writes";
import { runFollowUps } from "@/lib/writes";

export async function GET() {
  try {
    const authUser = await requireApiUser();
    if (!authUser) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

    const tasks = await prisma.task.findMany({
      where: {
        deletedAt: null,
        OR: [{ userId: authUser.id }, { project: projectAccessWhere(authUser.id) }],
      },
      orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
      include: taskInclude(authUser.id),
    });
    return NextResponse.json(tasks);
  } catch (error) {
    console.error("GET /api/tasks error:", error);
    return NextResponse.json({ error: "Failed to fetch tasks" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    // The body is checked first (src/lib/schemas/task.ts), then the account; the rules that need the
    // database (parent, note, project, assignee, labels) are in createTask, which the AI's changes use too.
    const parsed = parseBody(taskCreateSchema, await req.json());
    if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

    const user = await requireApiUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    const guestLimit = await guestLimitResponse(user, "tasks");
    if (guestLimit) return guestLimit;

    const result = await createTask(user, parsed.data);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    runFollowUps(user, [result.followUp]);
    return NextResponse.json(result.value, { status: 201 });
  } catch (error) {
    console.error("POST /api/tasks error:", error);
    return NextResponse.json({ error: "Failed to create task" }, { status: 500 });
  }
}
