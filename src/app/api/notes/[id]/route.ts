import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

const DEMO_USER_EMAIL = "samuel@example.com";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(req: Request, context: RouteContext) {
  try {
    const { id } = await context.params;

    if (!id) {
      return NextResponse.json({ error: "Note id is required" }, { status: 400 });
    }

    const body = await req.json();
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const contentInput = typeof body.content === "string" ? body.content.trim() : "";
    const projectId = typeof body.projectId === "string" && body.projectId.trim() ? body.projectId : null;

    if (!title) {
      return NextResponse.json({ error: "Title is required" }, { status: 400 });
    }

    let projectIdToSave: string | null = null;
    if (projectId) {
      const project = await prisma.project.findFirst({
        where: {
          id: projectId,
          user: { email: DEMO_USER_EMAIL },
        },
      });
      if (!project) {
        return NextResponse.json({ error: "Invalid project" }, { status: 400 });
      }
      projectIdToSave = project.id;
    }

    const updated = await prisma.note.updateMany({
      where: {
        id,
        deletedAt: null,
        user: {
          email: DEMO_USER_EMAIL,
        },
      },
      data: {
        title,
        content: contentInput || null,
        projectId: projectIdToSave,
      },
    });

    if (updated.count === 0) {
      return NextResponse.json({ error: "Note not found" }, { status: 404 });
    }

    const note = await prisma.note.findUnique({ where: { id }, include: { project: true } });

    return NextResponse.json(note, { status: 200 });
  } catch (error) {
    console.error("PATCH /api/notes/[id] error:", error);
    return NextResponse.json({ error: "Failed to update note" }, { status: 500 });
  }
}

export async function DELETE(_req: Request, context: RouteContext) {
  try {
    const { id } = await context.params;

    if (!id) {
      return NextResponse.json({ error: "Note id is required" }, { status: 400 });
    }

    const deleted = await prisma.note.updateMany({
      where: {
        id,
        deletedAt: null,
        user: {
          email: DEMO_USER_EMAIL,
        },
      },
      data: {
        deletedAt: new Date(),
      },
    });

    if (deleted.count === 0) {
      return NextResponse.json({ error: "Note not found" }, { status: 404 });
    }

    return NextResponse.json({ message: "Note moved to trash" }, { status: 200 });
  } catch (error) {
    console.error("DELETE /api/notes/[id] error:", error);
    return NextResponse.json({ error: "Failed to delete note" }, { status: 500 });
  }
}
