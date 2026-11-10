import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeAuthEmail, requireApiUser } from "@/lib/auth";
import { consumeRateLimit, rateLimitedResponse } from "@/lib/rate-limit";
import { RATE_LIMITS } from "@/lib/rate-limit-core";
import {
  checkProjectInvitation,
  createPendingInvitation,
  OWNER_INVITATION_SELECT,
  ownerInvitationJson,
  sendInvitationEmail,
} from "@/lib/project-invitations";
import { findByUsername } from "@/lib/project-people";
import { canManageProjectMembers, getProjectAccess } from "@/lib/project-access";
import { parseAssignableRole } from "@/lib/project-roles";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: Request, context: RouteContext) {
  try {
    const user = await requireApiUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

    const { id: projectId } = await context.params;
    // The owner and admins manage invitations (#385); to anyone else the project isn't there.
    if (!canManageProjectMembers(await getProjectAccess(projectId, user.id))) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const invitations = await prisma.projectInvitation.findMany({
      where: { projectId, status: "PENDING" },
      orderBy: { createdAt: "desc" },
      select: OWNER_INVITATION_SELECT,
    });

    return NextResponse.json(invitations.map(ownerInvitationJson));
  } catch (error) {
    console.error("GET /api/projects/[id]/invitations error:", error);
    return NextResponse.json({ error: "Failed to fetch project invitations" }, { status: 500 });
  }
}

export async function POST(req: Request, context: RouteContext) {
  try {
    const user = await requireApiUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    const inviteLimit = await consumeRateLimit(RATE_LIMITS.invitationsUser, user.id);
    if (!inviteLimit.allowed) return rateLimitedResponse("invitations", inviteLimit);

    const { id: projectId } = await context.params;
    const body = await req.json().catch(() => ({}));
    const invitedEmail = typeof body.email === "string" ? normalizeAuthEmail(body.email) : "";
    const username = typeof body.username === "string" ? body.username.trim() : "";
    const role = parseAssignableRole(body.role);

    if (!invitedEmail && !username) return NextResponse.json({ error: "Invitee email is required" }, { status: 400 });
    if (!role) return NextResponse.json({ error: "Role must be Admin or Editor." }, { status: 400 });

    if (!canManageProjectMembers(await getProjectAccess(projectId, user.id))) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true, name: true } });
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    // By username (#393): the invitation goes to their account and email, and the inviter never sees the address.
    if (username) {
      const person = await findByUsername(projectId, user.id, username);
      if (!person) return NextResponse.json({ error: "No one outside this project has that username." }, { status: 404 });
      const account = await prisma.user.findUniqueOrThrow({ where: { id: person.id }, select: { email: true } });
      const email = normalizeAuthEmail(account.email);
      const check = await checkProjectInvitation({ projectId, invitedEmail: email, inviter: user });
      if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });
      const invitation = await createPendingInvitation(prisma, {
        projectId,
        inviterUserId: user.id,
        invitedEmail: email,
        invitedUserId: person.id,
        invitedUsername: person.username,
        role,
      });
      await sendInvitationEmail({ req, inviter: user, invitedEmail: email, hasAccount: true, projectName: project.name });
      return NextResponse.json(
        { invitation: ownerInvitationJson(invitation), message: `Invitation sent to @${person.username}.` },
        { status: 201 },
      );
    }

    const check = await checkProjectInvitation({ projectId, invitedEmail, inviter: user });
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

    const invitation = await createPendingInvitation(prisma, {
      projectId,
      inviterUserId: user.id,
      invitedEmail,
      invitedUserId: check.invitedUserId,
      role,
    });

    const email = await sendInvitationEmail({
      req,
      inviter: user,
      invitedEmail,
      hasAccount: check.invitedUserId !== null,
      projectName: project.name,
    });

    return NextResponse.json({ invitation: ownerInvitationJson(invitation), email, message: email.message }, { status: 201 });
  } catch (error) {
    console.error("POST /api/projects/[id]/invitations error:", error);
    return NextResponse.json({ error: "Failed to create project invitation" }, { status: 500 });
  }
}
