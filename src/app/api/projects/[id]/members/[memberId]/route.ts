import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiUser } from "@/lib/auth";


type RouteContext = {
  params: Promise<{ id: string; memberId: string }>;
};

export async function DELETE(_req: Request, context: RouteContext) {
  try {
    const { id: projectId, memberId } = await context.params;

    const user = await requireApiUser();
    if (!user) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const project = await prisma.project.findFirst({ where: { id: projectId, userId: user.id } });
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const member = await prisma.projectMember.findFirst({
      where: { id: memberId, projectId },
      select: { id: true, role: true },
    });

    if (!member) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }

    if (member.role === "OWNER") {
      return NextResponse.json({ error: "Owner cannot be removed" }, { status: 400 });
    }

    await prisma.projectMember.delete({ where: { id: member.id } });

    return NextResponse.json({ message: "Member removed" });
  } catch (error) {
    console.error("DELETE /api/projects/[id]/members/[memberId] error:", error);
    return NextResponse.json({ error: "Failed to remove member" }, { status: 500 });
  }
}
