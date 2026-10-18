import type { Prisma, ProjectMemberRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizeAuthEmail, type AuthUser } from "@/lib/auth";
import { sendProjectInvitationEmail } from "@/lib/email";

// What owners see about an invitation. Never select the invited user here:
// owners must not learn whether an email belongs to a registered account.
export const OWNER_INVITATION_SELECT = {
  id: true,
  invitedEmail: true,
  status: true,
  createdAt: true,
  role: true,
} as const satisfies Prisma.ProjectInvitationSelect;

type InvitationCheck =
  | { ok: true; invitedUserId: string | null }
  | { ok: false; error: string; status: 400 | 409 };

export async function checkProjectInvitation({
  projectId,
  invitedEmail,
  inviter,
}: {
  projectId: string;
  invitedEmail: string;
  inviter: Pick<AuthUser, "email">;
}): Promise<InvitationCheck> {
  if (invitedEmail === normalizeAuthEmail(inviter.email)) {
    return { ok: false, error: "You cannot invite yourself", status: 400 };
  }

  const invitedUser = await prisma.user.findUnique({ where: { email: invitedEmail }, select: { id: true } });

  const existingMember = await prisma.projectMember.findFirst({
    where: { projectId, OR: [{ email: invitedEmail }, ...(invitedUser ? [{ userId: invitedUser.id }] : [])] },
    select: { id: true },
  });
  if (existingMember) return { ok: false, error: "This user is already a project member", status: 409 };

  const duplicatePending = await prisma.projectInvitation.findFirst({
    where: { projectId, invitedEmail, status: "PENDING" },
    select: { id: true },
  });
  if (duplicatePending) return { ok: false, error: "A pending invitation already exists for this user", status: 409 };

  return { ok: true, invitedUserId: invitedUser?.id ?? null };
}

export function createPendingInvitation(
  db: Prisma.TransactionClient,
  data: { projectId: string; inviterUserId: string; invitedEmail: string; invitedUserId: string | null; role: ProjectMemberRole },
) {
  return db.projectInvitation.create({ data, select: OWNER_INVITATION_SELECT });
}

export function sendInvitationEmail({
  req,
  inviter,
  invitedEmail,
  projectName,
}: {
  req: Request;
  inviter: Pick<AuthUser, "name" | "email">;
  invitedEmail: string;
  projectName: string;
}) {
  return sendProjectInvitationEmail({
    to: invitedEmail,
    inviterName: inviter.name,
    inviterEmail: inviter.email,
    projectName,
    fallbackOrigin: new URL(req.url).origin,
  });
}
