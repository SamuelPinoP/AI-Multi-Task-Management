import { ProjectMemberRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const DEMO_USER_EMAIL = "samuel@example.com";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function isValidRole(value: unknown): value is ProjectMemberRole {
  return typeof value === "string" && Object.values(ProjectMemberRole).includes(value as ProjectMemberRole);
}

export async function POST(req: Request, context: RouteContext) {
  try {
    const { id: projectId } = await context.params;
    const body = await req.json();
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const emailInput = typeof body.email === "string" ? body.email.trim() : "";

    if (!name) {
      return NextResponse.json({ error: "Member name is required" }, { status: 400 });
    }

    if (!isValidRole(body.role)) {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { email: DEMO_USER_EMAIL } });
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const project = await prisma.project.findFirst({ where: { id: projectId, userId: user.id } });
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const member = await prisma.projectMember.create({
      data: {
        projectId,
        name,
        email: emailInput || null,
        role: body.role,
      },
    });

    return NextResponse.json(member, { status: 201 });
  } catch (error) {
    console.error("POST /api/projects/[id]/members error:", error);
    return NextResponse.json({ error: "Failed to add member" }, { status: 500 });
  }
}
