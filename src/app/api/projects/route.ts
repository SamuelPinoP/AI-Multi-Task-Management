import { ProjectStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireApiUser } from "@/lib/auth";
import { NextResponse } from "next/server";
import { createActivity } from "@/lib/activity";

function parseProjectStatus(value: unknown): ProjectStatus | null {
  if (typeof value !== "string") return null;
  return Object.values(ProjectStatus).includes(value as ProjectStatus) ? (value as ProjectStatus) : null;
}

export async function GET(req: Request) {
  try {
    const user = await requireApiUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const statusFilter = parseProjectStatus(searchParams.get("status"));

    const projects = await prisma.project.findMany({
      where: { userId: user.id, ...(statusFilter ? { status: statusFilter } : {}) },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(projects);
  } catch (error) {
    console.error("GET /api/projects error:", error);
    return NextResponse.json({ error: "Failed to fetch projects" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireApiUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

    const body = await req.json();
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const descriptionInput = typeof body.description === "string" ? body.description.trim() : "";
    const colorInput = typeof body.color === "string" ? body.color.trim() : "";

    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
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
