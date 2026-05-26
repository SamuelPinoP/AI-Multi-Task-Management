import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createActivity } from "@/lib/activity";

const DEMO_USER_EMAIL = "samuel@example.com";
type RouteContext = { params: Promise<{ id: string }> };

export async function POST(req: Request, context: RouteContext) {
  try {
    const { id: projectId } = await context.params;
    const body = await req.json();
    const message = typeof body.message === "string" ? body.message.trim() : "";

    if (!message) {
      return NextResponse.json({ error: "Comment message is required" }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { email: DEMO_USER_EMAIL } });
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

    const project = await prisma.project.findFirst({ where: { id: projectId, userId: user.id }, select: { id: true, name: true } });
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    const comment = await prisma.projectComment.create({
      data: { projectId: project.id, userId: user.id, message },
      include: { user: { select: { name: true, email: true } } },
    });

    await createActivity({
      userId: user.id,
      projectId: project.id,
      action: "CREATED_PROJECT",
      entityType: "PROJECT",
      entityId: project.id,
      message: `Added a discussion comment in project \"${project.name}\".`,
    });

    return NextResponse.json(
      {
        id: comment.id,
        message: comment.message,
        createdAt: comment.createdAt,
        updatedAt: comment.updatedAt,
        author: { name: comment.user.name, email: comment.user.email },
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("POST /api/projects/[id]/comments error:", error);
    return NextResponse.json({ error: "Failed to create project comment" }, { status: 500 });
  }
}
