import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { INBOX_LIMIT } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";

/** The bell's inbox (SMART-08): the latest notifications and how many are unread. */
export async function GET() {
  const user = await requireApiUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const [notifications, unread] = await Promise.all([
    prisma.notification.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: INBOX_LIMIT,
      select: { id: true, type: true, title: true, body: true, url: true, readAt: true, createdAt: true },
    }),
    prisma.notification.count({ where: { userId: user.id, readAt: null } }),
  ]);
  return NextResponse.json({ notifications, unread });
}
