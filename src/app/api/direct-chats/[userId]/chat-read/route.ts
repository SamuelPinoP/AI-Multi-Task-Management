import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { directChatAccess, markDirectChatsRead } from "@/lib/direct-chats";

type RouteContext = { params: Promise<{ userId: string }> };

/** The open chat saw new messages: they count as read (#387), as in a project chat. */
export async function POST(_req: Request, context: RouteContext) {
  try {
    const user = await requireApiUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    const { userId: personId } = await context.params;
    const access = await directChatAccess(user.id, personId);
    if (!access) return NextResponse.json({ error: "Chat not found" }, { status: 404 });
    if (access.chatId) await markDirectChatsRead(user.id, [access.chatId]);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("POST /api/direct-chats/[userId]/chat-read error:", error);
    return NextResponse.json({ error: "Failed to mark the chat as read" }, { status: 500 });
  }
}
