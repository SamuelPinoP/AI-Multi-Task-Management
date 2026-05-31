import { ProjectStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireApiUser } from "@/lib/auth";
import { NextResponse } from "next/server";


type RouteContext = {
  params: Promise<{ id: string }>;
};

function parseProjectStatus(value: unknown): ProjectStatus | null {
  if (typeof value !== "string") return null;
  return Object.values(ProjectStatus).includes(value as ProjectStatus) ? (value as ProjectStatus) : null;
}

export async function GET(_req: Request, context: RouteContext) {
  try {
    const user = await requireApiUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

    const { id } = await context.params;

    if (!id) {
      return NextResponse.json({ error: "Project id is required" }, { status: 400 });
    }

    const project = await prisma.project.findFirst({
      where: {
        id,
        userId: user.id,
      },
      include: {
        notes: {
          where: { deletedAt: null },
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            title: true,
            content: true,
            createdAt: true,
            updatedAt: true,
          },
        },
        members: {
          orderBy: { createdAt: "asc" },
          include: {
            notes: {
              where: {
                OR: [
                  { visibility: "TEAM" },
                  { createdByUserId: user.id },
                ],
              },
              orderBy: { createdAt: "desc" },
              select: { id: true, message: true, createdAt: true, visibility: true, createdByUserId: true },
            },
          },
        },
        comments: {
          orderBy: { createdAt: "asc" },
          include: {
            user: {
              select: { id: true, name: true, email: true },
            },
            attachments: { orderBy: { createdAt: "asc" } },
          },
        },
      },
    });

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    return NextResponse.json(project);
  } catch (error) {
    console.error("GET /api/projects/[id] error:", error);
    return NextResponse.json({ error: "Failed to fetch project" }, { status: 500 });
  }
}

export async function PATCH(req: Request, context: RouteContext) {
  try {
    const user = await requireApiUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

    const { id } = await context.params;
    if (!id) return NextResponse.json({ error: "Project id is required" }, { status: 400 });

    const body = await req.json();
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const descriptionInput = typeof body.description === "string" ? body.description.trim() : "";
    const colorInput = typeof body.color === "string" ? body.color.trim() : "";
    const statusInput = parseProjectStatus(body.status);

    if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });

    const data: { name: string; description: string | null; color: string | null; status?: ProjectStatus } = {
      name,
      description: descriptionInput || null,
      color: colorInput || null,
    };

    if (statusInput) data.status = statusInput;

    const updated = await prisma.project.updateMany({ where: { id, userId: user.id }, data });
    if (updated.count === 0) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    const project = await prisma.project.findUnique({ where: { id } });
    return NextResponse.json(project);
  } catch (error) {
    console.error("PATCH /api/projects/[id] error:", error);
    return NextResponse.json({ error: "Failed to update project" }, { status: 500 });
  }
}

export async function DELETE(_req: Request, context: RouteContext) {
  try {
    const user = await requireApiUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

    const { id } = await context.params;
    if (!id) return NextResponse.json({ error: "Project id is required" }, { status: 400 });

    const deleted = await prisma.project.deleteMany({ where: { id, userId: user.id } });
    if (deleted.count === 0) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    return NextResponse.json({ message: "Project deleted" });
  } catch (error) {
    console.error("DELETE /api/projects/[id] error:", error);
    return NextResponse.json({ error: "Failed to delete project" }, { status: 500 });
  }
}
