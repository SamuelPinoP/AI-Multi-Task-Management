import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { createActivity } from "@/lib/activity";

const DEMO_USER_EMAIL = "samuel@example.com";

export async function GET() {
  try {
    const user = await prisma.user.findUnique({
      where: { email: DEMO_USER_EMAIL },
      include: {
        projects: {
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json(user.projects);
  } catch (error) {
    console.error("GET /api/projects error:", error);
    return NextResponse.json({ error: "Failed to fetch projects" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const descriptionInput = typeof body.description === "string" ? body.description.trim() : "";
    const colorInput = typeof body.color === "string" ? body.color.trim() : "";

    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { email: DEMO_USER_EMAIL },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const project = await prisma.project.create({
      data: {
        name,
        description: descriptionInput || null,
        color: colorInput || null,
        userId: user.id,
      },
    });

    void createActivity({
      userId: user.id,
      action: "CREATED_PROJECT",
      message: `Created project: “${project.name}”`,
      entityType: "PROJECT",
      entityId: project.id,
      projectId: project.id,
    });

    return NextResponse.json(project, { status: 201 });
  } catch (error) {
    console.error("POST /api/projects error:", error);
    return NextResponse.json({ error: "Failed to create project" }, { status: 500 });
  }
}
