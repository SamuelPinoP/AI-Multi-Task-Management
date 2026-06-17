import { prisma } from "@/lib/prisma";
import { requireApiUser } from "@/lib/auth";
import { NextResponse } from "next/server";
import { createActivity } from "@/lib/activity";
import { projectAccessWhere, getProjectAccess, canEditProjectContent, unauthorizedProjectResponse } from "@/lib/project-access";


function parseProjectId(input: unknown): string | null {
  if (typeof input !== "string") {
    return null;
  }

  const trimmed = input.trim();
  return trimmed || null;
}

export async function GET() {
  try {
    const authUser = await requireApiUser();
    if (!authUser) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

    const notes = await prisma.note.findMany({
      where: { deletedAt: null, OR: [{ userId: authUser.id }, { project: projectAccessWhere(authUser.id) }] },
      orderBy: { createdAt: "desc" },
      include: { project: { select: { id: true, name: true, color: true } } },
    });

    return NextResponse.json(notes);
  } catch (error) {
    console.error("GET /api/notes error:", error);
    return NextResponse.json({ error: "Failed to fetch notes" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const contentInput = typeof body.content === "string" ? body.content.trim() : "";
    const projectId = parseProjectId(body.projectId);

    if (!title) {
      return NextResponse.json({ error: "Title is required" }, { status: 400 });
    }

    const user = await requireApiUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

    if (projectId) {
      const access = await getProjectAccess(projectId, user.id);
      if (!access) return NextResponse.json({ error: "Invalid project" }, { status: 400 });
      if (!canEditProjectContent(access)) return NextResponse.json(unauthorizedProjectResponse("create notes"), { status: 403 });
    }

    const note = await prisma.note.create({
      data: {
        title,
        content: contentInput || null,
        userId: user.id,
        projectId,
      },
      include: {
        project: {
          select: { id: true, name: true, color: true },
        },
      },
    });

    void createActivity({
      userId: user.id,
      action: "CREATED_NOTE",
      message: `Created note: “${note.title}”`,
      entityType: "NOTE",
      entityId: note.id,
      projectId: note.projectId,
    });

    return NextResponse.json(note, { status: 201 });
  } catch (error) {
    console.error("POST /api/notes error:", error);
    return NextResponse.json({ error: "Failed to create note" }, { status: 500 });
  }
}
