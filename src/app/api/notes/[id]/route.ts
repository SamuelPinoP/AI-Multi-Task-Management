import { prisma } from "@/lib/prisma";
import { requireApiUser } from "@/lib/auth";
import { NextResponse } from "next/server";
import { createActivity } from "@/lib/activity";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function parseProjectId(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  return trimmed || null;
}

export async function PATCH(req: Request, context: RouteContext) {
  try {
    const user = await requireApiUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

    const { id } = await context.params;
    if (!id) return NextResponse.json({ error: "Note id is required" }, { status: 400 });

    const body = await req.json();
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const contentInput = typeof body.content === "string" ? body.content.trim() : "";
    const projectId = parseProjectId(body.projectId);

    if (!title) return NextResponse.json({ error: "Title is required" }, { status: 400 });

    if (projectId) {
      const project = await prisma.project.findFirst({ where: { id: projectId, userId: user.id } });
      if (!project) return NextResponse.json({ error: "Invalid project" }, { status: 400 });
    }

    const updated = await prisma.note.updateMany({
      where: { id, deletedAt: null, userId: user.id },
      data: { title, content: contentInput || null, projectId },
    });

    if (updated.count === 0) return NextResponse.json({ error: "Note not found" }, { status: 404 });

    const note = await prisma.note.findUnique({
      where: { id },
      include: { project: { select: { id: true, name: true, color: true } } },
    });

    return NextResponse.json(note, { status: 200 });
  } catch (error) {
    console.error("PATCH /api/notes/[id] error:", error);
    return NextResponse.json({ error: "Failed to update note" }, { status: 500 });
  }
}

export async function DELETE(_req: Request, context: RouteContext) {
  try {
    const user = await requireApiUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

    const { id } = await context.params;
    if (!id) return NextResponse.json({ error: "Note id is required" }, { status: 400 });

    const existingNote = await prisma.note.findFirst({
      where: { id, deletedAt: null, userId: user.id },
      select: { id: true, title: true, userId: true, projectId: true },
    });

    if (!existingNote) return NextResponse.json({ error: "Note not found" }, { status: 404 });

    const deleted = await prisma.note.updateMany({
      where: { id, deletedAt: null, userId: user.id },
      data: { deletedAt: new Date() },
    });

    if (deleted.count === 0) return NextResponse.json({ error: "Note not found" }, { status: 404 });

    void createActivity({
      userId: existingNote.userId,
      action: "DELETED_ITEM",
      message: `Deleted note: “${existingNote.title}”`,
      entityType: "NOTE",
      entityId: existingNote.id,
      projectId: existingNote.projectId,
    });

    return NextResponse.json({ message: "Note moved to trash" }, { status: 200 });
  } catch (error) {
    console.error("DELETE /api/notes/[id] error:", error);
    return NextResponse.json({ error: "Failed to delete note" }, { status: 500 });
  }
}
