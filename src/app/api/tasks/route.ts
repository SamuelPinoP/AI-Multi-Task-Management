import { Priority, Recurrence, TaskStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireApiUser } from "@/lib/auth";
import { after, NextResponse } from "next/server";
import { createActivity } from "@/lib/activity";
import { parseTaskDueDateForStorage } from "@/lib/task-date-buckets";
import { projectAccessWhere, getProjectAccess, canEditProjectContent, unauthorizedProjectResponse } from "@/lib/project-access";
import { taskInclude, visibleTaskWhere } from "@/lib/task-include";
import { visibleNoteWhere } from "@/lib/note-access";
import { assigneeForNewTask, runOwnerEmailAutomation } from "@/lib/project-automations";


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
    const body = await req.json();
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const descriptionInput = typeof body.description === "string" ? body.description.trim() : "";
    let projectId = parseId(body.projectId);
    const assigneeId = parseId(body.assigneeId);
    const parentId = parseId(body.parentId);
    const noteId = parseId(body.noteId);

    if (!title) return NextResponse.json({ error: "Title is required" }, { status: 400 });
    if (body.status && !isValidStatus(body.status)) return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    if (body.priority && !isValidPriority(body.priority)) return NextResponse.json({ error: "Invalid priority" }, { status: 400 });
    if (body.recurrence && !isValidRecurrence(body.recurrence)) return NextResponse.json({ error: "Invalid recurrence" }, { status: 400 });

    let dueDate: Date | null = null;
    if (body.dueDate) {
      const parsed = parseTaskDueDateForStorage(body.dueDate);
      if (!parsed) return NextResponse.json({ error: "Invalid due date" }, { status: 400 });
      dueDate = parsed;
    }

    const user = await requireApiUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

    // A subtask (SMART-02) goes in its parent's project, one level deep.
    if (parentId) {
      const parent = await prisma.task.findFirst({
        where: { id: parentId, ...visibleTaskWhere(user.id) },
        select: { projectId: true, parentId: true },
      });
      if (!parent) return NextResponse.json({ error: "Invalid parent task" }, { status: 400 });
      if (parent.parentId) return NextResponse.json({ error: "Subtasks can't have their own subtasks" }, { status: 400 });
      projectId = parent.projectId;
    }

    // A task made from a note (SMART-05) goes in the note's project.
    if (noteId) {
      const note = await prisma.note.findFirst({ where: { id: noteId, ...visibleNoteWhere(user.id) }, select: { projectId: true } });
      if (!note) return NextResponse.json({ error: "Invalid note" }, { status: 400 });
      // A subtask keeps its parent's project.
      if (!parentId) projectId = note.projectId;
    }

    if (projectId) {
      const access = await getProjectAccess(projectId, user.id);
      if (!access) return NextResponse.json({ error: "Invalid project" }, { status: 400 });
      if (!canEditProjectContent(access)) return NextResponse.json(unauthorizedProjectResponse("create tasks"), { status: 403 });
    }

    if (assigneeId) {
      if (!projectId) return NextResponse.json({ error: "Assignee requires a project" }, { status: 400 });
      const member = await prisma.projectMember.findFirst({ where: { id: assigneeId, projectId } });
      if (!member) return NextResponse.json({ error: "Invalid assignee" }, { status: 400 });
    }

    const status = isValidStatus(body.status) ? body.status : TaskStatus.TODO;
    const isSubtask = Boolean(parentId);
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
        // The project's "assign new tasks" rule (SMART-11) fills an empty assignee.
        assigneeId: await assigneeForNewTask(projectId, { assigneeId, isSubtask }),
        parentId,
        noteId,
      },
      include: taskInclude(user.id),
    });

    void createActivity({ userId: user.id, action: status === TaskStatus.DONE ? "COMPLETED_TASK" : "CREATED_TASK", message: `${status === TaskStatus.DONE ? "Completed task" : "Created task"}: “${task.title}”`, entityType: "TASK", entityId: task.id, projectId: task.projectId });
    // Email rules (SMART-11) run after the response. Subtasks are checklist items; they don't trigger rules.
    if (task.projectId && !isSubtask) {
      const origin = new URL(req.url).origin;
      after(() => runOwnerEmailAutomation({ trigger: "TASK_CREATED", task, actorId: user.id, origin }));
      if (status === TaskStatus.DONE) after(() => runOwnerEmailAutomation({ trigger: "TASK_COMPLETED", task, actorId: user.id, origin }));
    }
    return NextResponse.json(task, { status: 201 });
  } catch (error) {
    console.error("POST /api/tasks error:", error);
    return NextResponse.json({ error: "Failed to create task" }, { status: 500 });
  }
}
