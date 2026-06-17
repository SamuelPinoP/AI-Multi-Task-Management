import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiUser } from "@/lib/auth";
import { unauthorizedProjectResponse } from "@/lib/project-access";

type RouteContext = { params: Promise<{ id: string; memberId: string }> };

function isAssignableRole(role: unknown): role is "EDITOR" | "VIEWER" {
  return role === "EDITOR" || role === "VIEWER";
}

async function requireOwner(projectId: string, userId: string) {
  return prisma.project.findFirst({ where: { id: projectId, userId }, select: { id: true } });
}

export async function PATCH(req: Request, context: RouteContext) {
  try {
    const { id: projectId, memberId } = await context.params;
    const user = await requireApiUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    const project = await requireOwner(projectId, user.id);
    if (!project) return NextResponse.json(unauthorizedProjectResponse("change member roles"), { status: 403 });
    const body = await req.json().catch(() => ({}));
    if (!isAssignableRole(body.role)) return NextResponse.json({ error: "Role must be Editor or Viewer." }, { status: 400 });
    const member = await prisma.projectMember.findFirst({ where: { id: memberId, projectId }, select: { id: true, role: true } });
    if (!member) return NextResponse.json({ error: "Member not found" }, { status: 404 });
    if (member.role === "OWNER") return NextResponse.json({ error: "Project owners cannot be demoted here." }, { status: 400 });
    const updated = await prisma.projectMember.update({ where: { id: member.id }, data: { role: body.role } });
    return NextResponse.json(updated);
  } catch (error) {
    console.error("PATCH /api/projects/[id]/members/[memberId] error:", error);
    return NextResponse.json({ error: "Failed to update member role" }, { status: 500 });
  }
}

export async function DELETE(_req: Request, context: RouteContext) {
  try {
    const { id: projectId, memberId } = await context.params;
    const user = await requireApiUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    const project = await requireOwner(projectId, user.id);
    if (!project) return NextResponse.json(unauthorizedProjectResponse("remove members"), { status: 403 });
    const member = await prisma.projectMember.findFirst({ where: { id: memberId, projectId }, select: { id: true, role: true, userId: true } });
    if (!member) return NextResponse.json({ error: "Member not found" }, { status: 404 });
    if (member.role === "OWNER" || member.userId === user.id) return NextResponse.json({ error: "Owners cannot remove themselves or other owner records." }, { status: 400 });
    await prisma.projectMember.delete({ where: { id: member.id } });
    return NextResponse.json({ message: "Member removed" });
  } catch (error) {
    console.error("DELETE /api/projects/[id]/members/[memberId] error:", error);
    return NextResponse.json({ error: "Failed to remove member" }, { status: 500 });
  }
}
