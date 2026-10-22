import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { chatProjectsWhere, markChatsRead } from "@/lib/project-chat-unread";

/** "Mark all read" on the Chats page: every chat the hub lists counts as read up to now. */
export async function POST() {
  try {
    const user = await requireApiUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

    const projects = await prisma.project.findMany({ where: chatProjectsWhere(user.id), select: { id: true } });
    await markChatsRead(user.id, projects.map((project) => project.id));
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("POST /api/chats/read error:", error);
    return NextResponse.json({ error: "Failed to mark chats as read" }, { status: 500 });
  }
}
