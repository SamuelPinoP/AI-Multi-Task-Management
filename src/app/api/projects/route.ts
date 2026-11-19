import { ProjectStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireApiUser } from "@/lib/auth";
import { NextResponse } from "next/server";
import { refreshCalendarFeeds } from "@/lib/calendar-feed-store";
import { parseEventTimes, parseRepeatUntil } from "@/lib/event-time";
import { projectAccessWhere, getProjectAccessForUser } from "@/lib/project-access";
import { findProjectTemplate, planTemplate } from "@/lib/project-templates";
import { parseTaskDueDateForStorage } from "@/lib/task-date-buckets";
import { getUserNow } from "@/lib/user-time-server";
import { guestLimitResponse } from "@/lib/guest-limits";
import { createProject, parseProjectCreateBody } from "@/lib/project-writes";

// About 20 inserts for the largest template; Prisma's 5-second default is tight on a cold database.
const TEMPLATE_TRANSACTION = { maxWait: 10_000, timeout: 20_000 };

function parseProjectStatus(value: unknown): ProjectStatus | null {
  if (typeof value !== "string") return null;
  return Object.values(ProjectStatus).includes(value as ProjectStatus) ? (value as ProjectStatus) : null;
}

export async function GET(req: Request) {
  try {
    const user = await requireApiUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const statusFilter = parseProjectStatus(searchParams.get("status"));

    const projects = await prisma.project.findMany({
      where: {
        AND: [
          projectAccessWhere(user.id),
          statusFilter ? { status: statusFilter } : {},
        ],
      },
      include: {
        members: { where: { userId: user.id }, select: { userId: true, role: true } },
        _count: { select: { members: true, tasks: { where: { deletedAt: null, status: { not: "DONE" } } } } },
        photo: { select: { updatedAt: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(projects.map((project) => {
      const access = getProjectAccessForUser(project, user.id);
      const { members, _count, photo, ...projectData } = project;
      void members;
      return {
        ...projectData,
        photoUpdatedAt: photo?.updatedAt.toISOString() ?? null,
        accessLevel: access?.accessLevel ?? "OWNER",
        memberRole: access?.memberRole ?? "OWNER",
        openTaskCount: _count.tasks,
        memberCount: _count.members,
      };
    }));
  } catch (error) {
    console.error("GET /api/projects error:", error);
    return NextResponse.json({ error: "Failed to fetch projects" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireApiUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

    const body = await req.json();
    const parsed = parseProjectCreateBody(body);
    if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const guestLimit = await guestLimitResponse(user, "projects");
    if (guestLimit) return guestLimit;

    // A template (SMART-11) adds starter tasks and check-ins, dated from today in the user's time zone.
    const template = body.templateId ? findProjectTemplate(body.templateId) : null;
    if (body.templateId && !template) return NextResponse.json({ error: "Unknown template" }, { status: 400 });
    const now = template ? await getUserNow() : null;
    const plan = template && now ? planTemplate(template, { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() }) : null;

    const project = await prisma.$transaction(async (tx) => {
      const { data } = parsed;
      // The rules for the project itself are shared with the AI's changes (src/lib/project-writes.ts).
      const created = await createProject(
        user,
        { ...data, description: data.description ?? template?.description ?? null, color: data.color ?? template?.color ?? null },
        tx,
      );
      if (!created.ok) throw new Error(created.error);
      if (!template || !plan) return created.value;

      for (const task of plan.tasks) {
        await tx.task.create({
          data: {
            title: task.title,
            status: task.status,
            priority: task.priority,
            recurrence: task.recurrence,
            dueDate: task.dueDate ? parseTaskDueDateForStorage(task.dueDate) : null,
            completedAt: task.status === "DONE" ? new Date() : null,
            userId: user.id,
            projectId: created.value.id,
            // The template's, not typed by the person, so a guest's limits leave them out (#458).
            isStarter: true,
            subtasks: { create: task.subtasks.map((title) => ({ title, userId: user.id, projectId: created.value.id, isStarter: true })) },
          },
        });
      }
      for (const event of plan.events) {
        const times = parseEventTimes(event);
        const repeatUntil = parseRepeatUntil(event, event.recurrence !== "NONE");
        // Unit tests keep every template valid; this guards against a bad edit.
        if (!times.value || repeatUntil.error !== undefined) throw new Error(`Template ${template.id} has an invalid event`);
        await tx.event.create({
          data: {
            title: event.title,
            description: event.description,
            ...times.value,
            recurrence: event.recurrence,
            repeatUntil: repeatUntil.value ?? null,
            userId: user.id,
            projectId: created.value.id,
            isStarter: true,
          },
        });
      }
      return created.value;
    }, TEMPLATE_TRANSACTION);

    if (template) refreshCalendarFeeds({ userIds: [user.id] });

    return NextResponse.json(project, { status: 201 });
  } catch (error) {
    console.error("POST /api/projects error:", error);
    return NextResponse.json({ error: "Failed to create project" }, { status: 500 });
  }
}
