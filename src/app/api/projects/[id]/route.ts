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
      return NextResponse.json({ error: "Project id is required" }, { status: 400 });
    }

    const body = await req.json();
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const descriptionInput = typeof body.description === "string" ? body.description.trim() : "";
    const colorInput = typeof body.color === "string" ? body.color.trim() : "";

    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    const updated = await prisma.project.updateMany({
      where: {
        id,
        user: {
          email: DEMO_USER_EMAIL,
        },
      },
      data: {
        name,
        description: descriptionInput || null,
        color: colorInput || null,
      },
    });

    if (updated.count === 0) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const project = await prisma.project.findUnique({ where: { id } });

    return NextResponse.json(project);
  } catch (error) {
    console.error("PATCH /api/projects/[id] error:", error);
    return NextResponse.json({ error: "Failed to update project" }, { status: 500 });
  }
}

export async function DELETE(_req: Request, context: RouteContext) {
  try {
    const { id } = await context.params;

    if (!id) {
      return NextResponse.json({ error: "Project id is required" }, { status: 400 });
    }

    const deleted = await prisma.project.deleteMany({
      where: {
        id,
        user: {
          email: DEMO_USER_EMAIL,
        },
      },
    });

    if (deleted.count === 0) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    return NextResponse.json({ message: "Project deleted" });
  } catch (error) {
    console.error("DELETE /api/projects/[id] error:", error);
    return NextResponse.json({ error: "Failed to delete project" }, { status: 500 });
  }
}
