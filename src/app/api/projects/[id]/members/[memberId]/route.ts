import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiUser } from "@/lib/auth";
import { canManageProjectMembers, getProjectAccess, unauthorizedProjectResponse } from "@/lib/project-access";
import { canChangeRole, canRemoveMember, parseAssignableRole } from "@/lib/project-roles";

type RouteContext = { params: Promise<{ id: string; memberId: string }> };

/** The caller's access, when they may manage this project's members: the owner or an admin (#385). */
async function requireManager(projectId: string, userId: string) {
  const access = await getProjectAccess(projectId, userId);
  return canManageProjectMembers(access) ? access : null;
}

export async function PATCH(req: Request, context: RouteContext) {
  try {
    const { id: projectId, memberId } = await context.params;
    const user = await requireApiUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    const access = await requireManager(projectId, user.id);
    if (!access) return NextResponse.json(unauthorizedProjectResponse("change member roles"), { status: 403 });
    const body = await req.json().catch(() => ({}));
    const role = parseAssignableRole(body.role, { required: true });
    if (!role) return NextResponse.json({ error: "Role must be Admin or Editor." }, { status: 400 });
    const member = await prisma.projectMember.findFirst({ where: { id: memberId, projectId }, select: { id: true, role: true, userId: true } });
    if (!member) return NextResponse.json({ error: "Member not found" }, { status: 404 });
    if (member.userId === user.id) return NextResponse.json({ error: "You can't change your own role." }, { status: 400 });
    if (!canChangeRole(access.accessLevel, member.role, role)) {
      return NextResponse.json({ error: "Only the project owner can dismiss an admin." }, { status: 403 });
    }
    const updated = await prisma.projectMember.update({ where: { id: member.id }, data: { role } });
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
    const access = await requireManager(projectId, user.id);
    if (!access) return NextResponse.json(unauthorizedProjectResponse("remove members"), { status: 403 });
    const member = await prisma.projectMember.findFirst({ where: { id: memberId, projectId }, select: { id: true, role: true, userId: true } });
    if (!member) return NextResponse.json({ error: "Member not found" }, { status: 404 });
    if (member.userId === user.id) return NextResponse.json({ error: "You can't remove yourself here." }, { status: 400 });
    if (!canRemoveMember(access.accessLevel, member.role)) {
      return NextResponse.json({ error: "Only the project owner can remove an admin." }, { status: 403 });
    }
    await prisma.projectMember.delete({ where: { id: member.id } });
    return NextResponse.json({ message: "Member removed" });
  } catch (error) {
    console.error("DELETE /api/projects/[id]/members/[memberId] error:", error);
    return NextResponse.json({ error: "Failed to remove member" }, { status: 500 });
  }
}
