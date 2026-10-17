import { prisma } from "@/lib/prisma";
import { requireApiUser } from "@/lib/auth";
import { normalizeRecurrence, isValidRecurrence } from "@/lib/recurrence";
import { parseEventTimes } from "@/lib/event-time";
import { NextResponse } from "next/server";
import { createActivity } from "@/lib/activity";
import { canEditProjectContent, getProjectAccess, projectAccessWhere, unauthorizedProjectResponse } from "@/lib/project-access";
type RouteContext = { params: Promise<{ id: string }> };
function parseProjectId(input: unknown): string | null {
  if (input === null || input === undefined) return null;
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  return trimmed || null;
}

export async function PATCH(req: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = await req.json();
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title) return NextResponse.json({ error: "Title is required" }, { status: 400 });

    const times = parseEventTimes(body);
    if (times.error !== undefined) return NextResponse.json({ error: times.error }, { status: 400 });
    if (!isValidRecurrence(body.recurrence)) return NextResponse.json({ error: "Invalid recurrence" }, { status: 400 });

    const user = await requireApiUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

    const description = typeof body.description === "string" ? body.description.trim() : "";
    const location = typeof body.location === "string" ? body.location.trim() : "";
    const projectId = parseProjectId(body.projectId);

    if (projectId) {
      const access = await getProjectAccess(projectId, user.id);
      if (!access) return NextResponse.json({ error: "Invalid project" }, { status: 400 });
      if (!canEditProjectContent(access)) return NextResponse.json(unauthorizedProjectResponse("edit events"), { status: 403 });
    }

    const existingEvent = await prisma.event.findFirst({
      where: { id, deletedAt: null, OR: [{ userId: user.id }, { project: projectAccessWhere(user.id) }] },
      select: { id: true, projectId: true },
    });
    if (!existingEvent) return NextResponse.json({ error: "Event not found" }, { status: 404 });
    if (existingEvent.projectId) {
      const existingAccess = await getProjectAccess(existingEvent.projectId, user.id);
      if (!canEditProjectContent(existingAccess)) return NextResponse.json(unauthorizedProjectResponse("edit events"), { status: 403 });
    }

    const event = await prisma.event.update({
      where: { id },
      data: {
        title,
        description: description || null,
        location: location || null,
        ...times.value,
        recurrence: normalizeRecurrence(body.recurrence),
        project: projectId ? { connect: { id: projectId } } : { disconnect: true },
      },
      include: { project: { select: { id: true, name: true, color: true } } },
    });
    return NextResponse.json(event ? { ...event, recurrence: normalizeRecurrence(event.recurrence) } : null, { status: 200 });
  } catch (error) { console.error("PATCH /api/events/[id] error:", error); return NextResponse.json({ error: "Failed to update event" }, { status: 500 }); }
}

export async function DELETE(_req: Request, context: RouteContext) {
  try {
    const user = await requireApiUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

    const { id } = await context.params;
    if (!id) return NextResponse.json({ error: "Event id is required" }, { status: 400 });

    const existingEvent = await prisma.event.findFirst({
      where: { id, deletedAt: null, OR: [{ userId: user.id }, { project: projectAccessWhere(user.id) }] },
      select: { id: true, title: true, userId: true, projectId: true },
    });
    if (!existingEvent) return NextResponse.json({ error: "Event not found" }, { status: 404 });

    if (existingEvent.projectId) {
      const existingAccess = await getProjectAccess(existingEvent.projectId, user.id);
      if (!canEditProjectContent(existingAccess)) return NextResponse.json(unauthorizedProjectResponse("delete events"), { status: 403 });
    }

    const deleted = await prisma.event.updateMany({
      where: { id, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (deleted.count === 0) return NextResponse.json({ error: "Event not found" }, { status: 404 });

    void createActivity({
      userId: existingEvent.userId,
      action: "DELETED_ITEM",
      message: `Deleted event: “${existingEvent.title}”`,
      entityType: "EVENT",
      entityId: existingEvent.id,
      projectId: existingEvent.projectId,
    });
    return NextResponse.json({ message: "Event moved to trash" }, { status: 200 });
  } catch (error) {
    console.error("DELETE /api/events/[id] error:", error);
    return NextResponse.json({ error: "Failed to delete event" }, { status: 500 });
  }
}
