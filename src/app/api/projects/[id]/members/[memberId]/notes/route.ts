import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiUser } from "@/lib/auth";
import { projectAccessWhereForProject } from "@/lib/project-access";

type RouteContext = { params: Promise<{ id: string; memberId: string }> };

export async function POST(req: Request, context: RouteContext) {
  try {
    const { id: projectId, memberId } = await context.params;
    const body = await req.json();
    const message = typeof body.message === "string" ? body.message.trim() : "";
    const visibility = body.visibility === "PRIVATE" ? "PRIVATE" : "TEAM";
    if (!message) return NextResponse.json({ error: "Message is required" }, { status: 400 });
    const user = await requireApiUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    const project = await prisma.project.findFirst({ where: projectAccessWhereForProject(projectId, user.id) });
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
    const member = await prisma.projectMember.findFirst({ where: { id: memberId, projectId }, select: { id: true } });
    if (!member) return NextResponse.json({ error: "Member not found" }, { status: 404 });
    const note = await prisma.projectMemberNote.create({
      data: { memberId, message, visibility, createdByUserId: user.id },
      select: { id: true, message: true, visibility: true, createdAt: true, createdByUserId: true },
    });
    return NextResponse.json(note, { status: 201 });
  } catch (error) {
    console.error("POST /api/projects/[id]/members/[memberId]/notes error:", error);
    return NextResponse.json({ error: "Failed to create member note" }, { status: 500 });
  }
}
