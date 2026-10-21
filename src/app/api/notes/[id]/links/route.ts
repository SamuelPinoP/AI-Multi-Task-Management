import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { visibleEventWhere, visibleNoteWhere } from "@/lib/note-access";
import { extractNoteLinks, linksTo, noteLinkKey } from "@/lib/note-links";
import { prisma } from "@/lib/prisma";
import { projectAccessWhere } from "@/lib/project-access";

type RouteContext = { params: Promise<{ id: string }> };

const DAY_MS = 86_400_000;

/**
 * What a note is connected to (SMART-05): tasks made from it, its event,
 * the notes it links to with [[title]], and the notes that link to it.
 * `events` lists the events it could belong to (same project, -30 to +60 days).
 */
export async function GET(_req: Request, context: RouteContext) {
  try {
    const user = await requireApiUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

    const { id } = await context.params;
    const note = await prisma.note.findFirst({
      where: { id, ...visibleNoteWhere(user.id) },
      select: { id: true, title: true, content: true, projectId: true, eventId: true },
    });
    if (!note) return NextResponse.json({ error: "Note not found" }, { status: 404 });

    const linkTitles = extractNoteLinks(note.content);
    const now = Date.now();
    const [tasks, event, events, linked, mentioning] = await Promise.all([
      prisma.task.findMany({
        where: { noteId: note.id, deletedAt: null, OR: [{ userId: user.id }, { project: projectAccessWhere(user.id) }] },
        orderBy: { createdAt: "asc" },
        select: { id: true, title: true, status: true },
      }),
      note.eventId
        ? prisma.event.findFirst({ where: { id: note.eventId, ...visibleEventWhere(user.id) }, select: { id: true, title: true, startTime: true } })
        : null,
      prisma.event.findMany({
        where: {
          ...visibleEventWhere(user.id),
          projectId: note.projectId,
          ...(note.projectId ? {} : { userId: user.id }),
          startTime: { gte: new Date(now - 30 * DAY_MS), lte: new Date(now + 60 * DAY_MS) },
        },
        orderBy: { startTime: "asc" },
        take: 100,
        select: { id: true, title: true, startTime: true },
      }),
      linkTitles.length
        ? prisma.note.findMany({
            where: { ...visibleNoteWhere(user.id), OR: linkTitles.map((title) => ({ title: { equals: title, mode: "insensitive" as const } })) },
            orderBy: { createdAt: "asc" },
            select: { id: true, title: true },
          })
        : [],
      note.title.trim()
        ? prisma.note.findMany({
            where: { ...visibleNoteWhere(user.id), id: { not: note.id }, content: { contains: "[[", mode: "insensitive" } },
            orderBy: { updatedAt: "desc" },
            take: 200,
            select: { id: true, title: true, content: true },
          })
        : [],
    ]);

    const byTitle = new Map(linked.map((item) => [noteLinkKey(item.title), item]));
    return NextResponse.json({
      tasks,
      event,
      events: event && !events.some((item) => item.id === event.id) ? [event, ...events] : events,
      links: linkTitles.map((title) => ({ title, note: byTitle.get(noteLinkKey(title)) ?? null })),
      backlinks: mentioning.filter((item) => linksTo(item.content, note.title)).map(({ id: noteId, title }) => ({ id: noteId, title })),
    });
  } catch (error) {
    console.error("GET /api/notes/[id]/links error:", error);
    return NextResponse.json({ error: "Failed to load links" }, { status: 500 });
  }
}
