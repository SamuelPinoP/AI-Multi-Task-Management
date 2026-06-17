import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeAuthEmail, requireApiUser } from "@/lib/auth";

type RouteContext = { params: Promise<{ invitationId: string }> };

export async function PATCH(req: Request, context: RouteContext) {
  try {
    const user = await requireApiUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

    const { invitationId } = await context.params;
    const body = await req.json().catch(() => ({}));
    const action = typeof body.action === "string" ? body.action.toUpperCase() : "";
    if (action !== "ACCEPT" && action !== "DECLINE") {
      return NextResponse.json({ error: "Action must be ACCEPT or DECLINE" }, { status: 400 });
    }

    const invitation = await prisma.projectInvitation.findFirst({
      where: {
        id: invitationId,
        status: "PENDING",
        OR: [{ invitedUserId: user.id }, { invitedEmail: normalizeAuthEmail(user.email) }],
      },
      include: { project: { select: { id: true, userId: true } } },
    });

    if (!invitation) return NextResponse.json({ error: "Invitation not found" }, { status: 404 });
    if (invitation.project.userId === user.id) {
      return NextResponse.json({ error: "Project owners cannot accept their own invitations" }, { status: 400 });
    }

    if (action === "DECLINE") {
      const declined = await prisma.projectInvitation.update({
        where: { id: invitation.id },
        data: { status: "DECLINED", invitedUserId: user.id },
        select: { id: true, status: true },
      });
      return NextResponse.json(declined);
    }

    const accepted = await prisma.$transaction(async (tx) => {
      const updatedInvitation = await tx.projectInvitation.update({
        where: { id: invitation.id },
        data: { status: "ACCEPTED", invitedUserId: user.id },
        select: { id: true, status: true, projectId: true },
      });

      await tx.projectMember.upsert({
        where: { projectId_userId: { projectId: invitation.projectId, userId: user.id } },
        update: { email: normalizeAuthEmail(user.email), name: user.name || user.email, role: invitation.role },
        create: {
          projectId: invitation.projectId,
          userId: user.id,
          name: user.name || user.email,
          email: normalizeAuthEmail(user.email),
          role: invitation.role,
        },
      });

      return updatedInvitation;
    });

    return NextResponse.json(accepted);
  } catch (error) {
    console.error("PATCH /api/project-invitations/[invitationId] error:", error);
    return NextResponse.json({ error: "Failed to update invitation" }, { status: 500 });
  }
}
