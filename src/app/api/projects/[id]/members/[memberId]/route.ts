import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const DEMO_USER_EMAIL = "samuel@example.com";

type RouteContext = {
  params: Promise<{ id: string; memberId: string }>;
};

export async function DELETE(_req: Request, context: RouteContext) {
  try {
    const { id: projectId, memberId } = await context.params;

    const user = await prisma.user.findUnique({ where: { email: DEMO_USER_EMAIL } });
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
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
