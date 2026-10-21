import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { visibleEventWhere, visibleNoteWhere } from "@/lib/note-access";
import { prisma } from "@/lib/prisma";
import { canEditProjectContent, getProjectAccess, unauthorizedProjectResponse } from "@/lib/project-access";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Sets the event a note is for, e.g. meeting notes (SMART-05). Body:
 * `{ eventId }`, or `{ eventId: null }` to clear it. The event must be one
 * you can see, in the note's project (or, for a personal note, your own).
 */
export async function PUT(req: Request, context: RouteContext) {
  try {
    const user = await requireApiUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

    const { id } = await context.params;
    const body = await req.json().catch(() => null);
    const eventId = typeof body?.eventId === "string" && body.eventId ? body.eventId : null;

    const note = await prisma.note.findFirst({ where: { id, ...visibleNoteWhere(user.id) }, select: { projectId: true } });
    if (!note) return NextResponse.json({ error: "Note not found" }, { status: 404 });
    if (note.projectId && !canEditProjectContent(await getProjectAccess(note.projectId, user.id))) {
      return NextResponse.json(unauthorizedProjectResponse("edit notes"), { status: 403 });
    }

    if (eventId) {
      const event = await prisma.event.findFirst({ where: { id: eventId, ...visibleEventWhere(user.id) }, select: { projectId: true, userId: true } });
      const sameScope = event && (note.projectId ? event.projectId === note.projectId : !event.projectId && event.userId === user.id);
      if (!sameScope) return NextResponse.json({ error: "Pick an event from the same project as the note" }, { status: 400 });
    }

    await prisma.note.update({ where: { id }, data: { eventId } });
    return NextResponse.json({ eventId });
  } catch (error) {
    console.error("PUT /api/notes/[id]/event error:", error);
    return NextResponse.json({ error: "Failed to update the note" }, { status: 500 });
  }
}
