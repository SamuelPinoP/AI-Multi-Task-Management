import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeAuthEmail, requireApiUser } from "@/lib/auth";
import { sendProjectInvitationEmail } from "@/lib/email";
import { ProjectMemberRole } from "@prisma/client";

const INVITATION_SELECT = {
  id: true,
  invitedEmail: true,
  status: true,
  createdAt: true,
  invitedUser: { select: { id: true, name: true, email: true } },
  role: true,
} as const;

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: Request, context: RouteContext) {
  try {
    const user = await requireApiUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

    const { id: projectId } = await context.params;
    const project = await prisma.project.findFirst({ where: { id: projectId, userId: user.id }, select: { id: true } });
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    const invitations = await prisma.projectInvitation.findMany({
      where: { projectId, status: "PENDING" },
      orderBy: { createdAt: "desc" },
      select: INVITATION_SELECT,
    });

    return NextResponse.json(invitations);
  } catch (error) {
    console.error("GET /api/projects/[id]/invitations error:", error);
    return NextResponse.json({ error: "Failed to fetch project invitations" }, { status: 500 });
  }
}

export async function POST(req: Request, context: RouteContext) {
  try {
    const user = await requireApiUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

    const { id: projectId } = await context.params;
    const body = await req.json().catch(() => ({}));
    const invitedEmail = typeof body.email === "string" ? normalizeAuthEmail(body.email) : "";
    const role = body.role === ProjectMemberRole.VIEWER ? ProjectMemberRole.VIEWER : ProjectMemberRole.EDITOR;

    if (!invitedEmail) return NextResponse.json({ error: "Invitee email is required" }, { status: 400 });
    if (invitedEmail === normalizeAuthEmail(user.email)) {
      return NextResponse.json({ error: "You cannot invite yourself" }, { status: 400 });
    }

    const project = await prisma.project.findFirst({ where: { id: projectId, userId: user.id }, select: { id: true, name: true } });
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    const invitedUser = await prisma.user.findUnique({ where: { email: invitedEmail }, select: { id: true, name: true, email: true } });

    const existingMember = await prisma.projectMember.findFirst({
      where: { projectId, OR: [{ email: invitedEmail }, ...(invitedUser ? [{ userId: invitedUser.id }] : [])] },
      select: { id: true },
    });
    if (existingMember) return NextResponse.json({ error: "This user is already a project member" }, { status: 409 });

    const duplicatePending = await prisma.projectInvitation.findFirst({
      where: { projectId, invitedEmail, status: "PENDING" },
      select: { id: true },
    });
    if (duplicatePending) return NextResponse.json({ error: "A pending invitation already exists for this user" }, { status: 409 });

    const invitation = await prisma.projectInvitation.create({
      data: {
        projectId,
        inviterUserId: user.id,
        invitedEmail,
        invitedUserId: invitedUser?.id,
        role,
      },
      select: INVITATION_SELECT,
    });

    const email = await sendProjectInvitationEmail({
      to: invitedEmail,
      inviterName: user.name,
      inviterEmail: user.email,
      projectName: project.name,
      fallbackOrigin: new URL(req.url).origin,
    });

    return NextResponse.json({ invitation, email, message: email.message }, { status: 201 });
  } catch (error) {
    console.error("POST /api/projects/[id]/invitations error:", error);
    return NextResponse.json({ error: "Failed to create project invitation" }, { status: 500 });
  }
}
