import { prisma } from "@/lib/prisma";
import { requireApiUser } from "@/lib/auth";
import { normalizeRecurrence, isValidRecurrence } from "@/lib/recurrence";
import { parseEventTimes, parseRepeatUntil } from "@/lib/event-time";
import { NextResponse } from "next/server";
import { createActivity } from "@/lib/activity";
import { projectAccessWhere, getProjectAccess, canEditProjectContent, unauthorizedProjectResponse } from "@/lib/project-access";
import { visibleNoteWhere } from "@/lib/note-access";

function parseProjectId(input: unknown): string | null {
  if (input === null || input === undefined) return null;
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  return trimmed || null;
}

export async function GET() { /* unchanged */
  try {
    const authUser = await requireApiUser();
    if (!authUser) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    const events = await prisma.event.findMany({ where: { deletedAt: null, OR: [{ userId: authUser.id }, { project: projectAccessWhere(authUser.id) }] }, orderBy: [{ startTime: "asc" }, { createdAt: "desc" }], include: { project: { select: { id: true, name: true, color: true } }, notes: { where: visibleNoteWhere(authUser.id), orderBy: { createdAt: "asc" }, select: { id: true, title: true } } } });
    return NextResponse.json(events.map((event) => ({ ...event, recurrence: normalizeRecurrence(event.recurrence) })));
  } catch (error) {
    console.error("GET /api/events error:", error);
    return NextResponse.json({ error: "Failed to fetch events" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title) return NextResponse.json({ error: "Title is required" }, { status: 400 });

    const times = parseEventTimes(body);
    if (times.error !== undefined) return NextResponse.json({ error: times.error }, { status: 400 });

    const user = await requireApiUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    if (body.recurrence && !isValidRecurrence(body.recurrence)) return NextResponse.json({ error: "Invalid recurrence" }, { status: 400 });
    const recurrence = normalizeRecurrence(body.recurrence);
    const repeatUntil = parseRepeatUntil(body, recurrence !== "NONE");
    if (repeatUntil.error !== undefined) return NextResponse.json({ error: repeatUntil.error }, { status: 400 });

    const description = typeof body.description === "string" ? body.description.trim() : "";
    const location = typeof body.location === "string" ? body.location.trim() : "";
    const projectId = parseProjectId(body.projectId);

    if (projectId) {
      const access = await getProjectAccess(projectId, user.id);
      if (!access) return NextResponse.json({ error: "Invalid project" }, { status: 400 });
      if (!canEditProjectContent(access)) return NextResponse.json(unauthorizedProjectResponse("create events"), { status: 403 });
    }

    const event = await prisma.event.create({
      data: {
        title,
        description: description || null,
        location: location || null,
        ...times.value,
        recurrence,
        repeatUntil: repeatUntil.value,
        user: { connect: { id: user.id } },
        project: projectId ? { connect: { id: projectId } } : undefined,
      },
      include: { project: { select: { id: true, name: true, color: true } } },
    });
    void createActivity({
      userId: user.id,
      action: "CREATED_EVENT",
      message: `Created event: “${event.title}”`,
      entityType: "EVENT",
      entityId: event.id,
      projectId: event.projectId,
    });

    return NextResponse.json(event, { status: 201 });
  } catch (error) {
    console.error("POST /api/events error:", error);
    return NextResponse.json({ error: "Failed to create event" }, { status: 500 });
  }
}
