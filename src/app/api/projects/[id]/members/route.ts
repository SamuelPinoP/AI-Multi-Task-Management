import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeAuthEmail, requireApiUser } from "@/lib/auth";
import { checkProjectInvitation, createPendingInvitation, sendInvitationEmail } from "@/lib/project-invitations";


type RouteContext = {
  params: Promise<{ id: string }>;
};

// No userId: the response must not reveal whether the email has an account.
const MEMBER_SELECT = { id: true, name: true, email: true, role: true, createdAt: true } as const;

function isValidRole(value: unknown): value is "EDITOR" | "VIEWER" {
  return value === "EDITOR" || value === "VIEWER";
}

export async function POST(req: Request, context: RouteContext) {
  try {
    const { id: projectId } = await context.params;
    const body = await req.json();
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const emailInput = typeof body.email === "string" ? normalizeAuthEmail(body.email) : "";

    if (!name) {
      return NextResponse.json({ error: "Member name is required" }, { status: 400 });
    }

    if (!isValidRole(body.role)) {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }
    const role: "EDITOR" | "VIEWER" = body.role;

    const user = await requireApiUser();
    if (!user) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const project = await prisma.project.findFirst({ where: { id: projectId, userId: user.id }, select: { id: true, name: true } });
    if (!project) {
      return NextResponse.json({ error: "Only project owners can add members." }, { status: 403 });
    }

    let invitedUserId: string | null = null;
    if (emailInput) {
      const check = await checkProjectInvitation({ projectId, invitedEmail: emailInput, inviter: user });
      if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });
      invitedUserId = check.invitedUserId;
    }

    // Never link an account here. The member stays a placeholder until the
    // invitee accepts the invitation, which is what grants project access.
    const { member, invitation } = await prisma.$transaction(async (tx) => {
      const member = await tx.projectMember.create({
        data: { projectId, userId: null, name, email: emailInput || null, role },
        select: MEMBER_SELECT,
      });
      const invitation = emailInput
        ? await createPendingInvitation(tx, { projectId, inviterUserId: user.id, invitedEmail: emailInput, invitedUserId, role })
        : null;
      return { member, invitation };
    });

    const email = invitation
      ? await sendInvitationEmail({
          req,
          inviter: user,
          invitedEmail: invitation.invitedEmail,
          hasAccount: invitedUserId !== null,
          projectName: project.name,
        })
      : null;

    return NextResponse.json({ member, invitation, email }, { status: 201 });
  } catch (error) {
    console.error("POST /api/projects/[id]/members error:", error);
    return NextResponse.json({ error: "Failed to add member" }, { status: 500 });
  }
}
