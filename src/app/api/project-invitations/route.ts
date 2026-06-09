import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeAuthEmail, requireApiUser } from "@/lib/auth";

export async function GET() {
  try {
    const user = await requireApiUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

    const invitations = await prisma.projectInvitation.findMany({
      where: {
        status: "PENDING",
        OR: [{ invitedUserId: user.id }, { invitedEmail: normalizeAuthEmail(user.email) }],
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        invitedEmail: true,
        status: true,
        createdAt: true,
        project: { select: { id: true, name: true, description: true, color: true, status: true } },
        inviterUser: { select: { name: true, email: true } },
      },
    });

    return NextResponse.json(invitations);
  } catch (error) {
    console.error("GET /api/project-invitations error:", error);
    return NextResponse.json({ error: "Failed to fetch invitations" }, { status: 500 });
  }
}
