import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeAuthEmail, requireApiUser } from "@/lib/auth";
import { canManageProjectMembers, getProjectAccess } from "@/lib/project-access";
import { displayName } from "@/lib/direct-chats-core";
import { sharedProjects } from "@/lib/direct-chats";
import { checkProjectInvitation, createPendingInvitation, sendInvitationEmail } from "@/lib/project-invitations";
import { isInProject } from "@/lib/project-people";
import { parseAssignableRole, type AssignableRole } from "@/lib/project-roles";


type RouteContext = {
  params: Promise<{ id: string }>;
};

// No userId: the response must not reveal whether the email has an account.
const MEMBER_SELECT = { id: true, name: true, email: true, role: true, createdAt: true } as const;

/**
 * Someone the owner or an admin already shares another project with joins at
 * once (#393, "Already in Multi"); anyone else needs an invitation to accept.
 */
async function addTeammate(projectId: string, actorId: string, personId: string, role: AssignableRole) {
  const person = await prisma.user.findUnique({ where: { id: personId }, select: { id: true, name: true, email: true, isGuest: true } });
  if (!person || person.isGuest || person.id === actorId) return NextResponse.json({ error: "Person not found" }, { status: 404 });
  if (await isInProject(projectId, person.id)) return NextResponse.json({ error: "They're already in this project." }, { status: 409 });
  if ((await sharedProjects(actorId, person.id)).length === 0) {
    return NextResponse.json({ error: "Add people you already share a project with; invite anyone else." }, { status: 403 });
  }
  const email = normalizeAuthEmail(person.email);
  const member = await prisma.$transaction(async (tx) => {
    const created = await tx.projectMember.create({
      data: { projectId, userId: person.id, name: displayName(person), email, role },
      select: { id: true, userId: true, name: true, role: true },
    });
    // An invitation still waiting for them is settled: they're in.
    await tx.projectInvitation.updateMany({
      where: { projectId, status: "PENDING", OR: [{ invitedUserId: person.id }, { invitedEmail: email }] },
      data: { status: "ACCEPTED", invitedUserId: person.id },
    });
    return created;
  });
  return NextResponse.json({ member }, { status: 201 });
}

export async function POST(req: Request, context: RouteContext) {
  try {
    const user = await requireApiUser();
    if (!user) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const { id: projectId } = await context.params;
    const body = await req.json();
    const personId = typeof body.userId === "string" ? body.userId.trim() : "";
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const emailInput = typeof body.email === "string" ? normalizeAuthEmail(body.email) : "";

    if (!name && !personId) {
      return NextResponse.json({ error: "Member name is required" }, { status: 400 });
    }

    const role = parseAssignableRole(body.role, { required: true });
    if (!role) {
      return NextResponse.json({ error: "Role must be Admin or Editor." }, { status: 400 });
    }

    // The owner and admins add members (#385).
    const access = await getProjectAccess(projectId, user.id);
    const project = canManageProjectMembers(access)
      ? await prisma.project.findUnique({ where: { id: projectId }, select: { id: true, name: true } })
      : null;
    if (!project) {
      return NextResponse.json({ error: "Only the project owner and admins can add members." }, { status: 403 });
    }
    if (personId) return addTeammate(projectId, user.id, personId, role);

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
