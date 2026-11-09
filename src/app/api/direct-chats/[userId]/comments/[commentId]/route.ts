import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { DIRECT_MESSAGE_MAX, DIRECT_MESSAGE_SELECT, directChatAccess, serializeDirectMessage } from "@/lib/direct-chats";
import { prisma } from "@/lib/prisma";

type RouteContext = { params: Promise<{ userId: string; commentId: string }> };

/** Your own message in the chat with this person; like a project chat message, only its author edits, pins or deletes it. */
async function getOwnMessage(personId: string, messageId: string) {
  const user = await requireApiUser();
  if (!user) return { error: NextResponse.json({ error: "Authentication required" }, { status: 401 }) };
  const access = await directChatAccess(user.id, personId);
  if (!access?.chatId) return { error: NextResponse.json({ error: "Chat not found" }, { status: 404 }) };

  const message = await prisma.directMessage.findFirst({
    where: { id: messageId, chatId: access.chatId },
    select: { id: true, userId: true, updatedAt: true },
  });
  if (!message) return { error: NextResponse.json({ error: "Message not found" }, { status: 404 }) };
  if (message.userId !== user.id) return { error: NextResponse.json({ error: "You can only change your own messages." }, { status: 403 }) };
  return { message };
}

export async function PATCH(req: Request, context: RouteContext) {
  try {
    const { userId: personId, commentId } = await context.params;
    const result = await getOwnMessage(personId, commentId);
    if ("error" in result) return result.error;

    const body = (await req.json().catch(() => ({}))) as { message?: unknown; pinned?: unknown };
    const hasMessage = typeof body.message === "string";
    const hasPinned = typeof body.pinned === "boolean";
    if (!hasMessage && !hasPinned) return NextResponse.json({ error: "Message or pinned state is required" }, { status: 400 });

    const text = hasMessage ? (body.message as string).replace(/\r\n/g, "\n").trim() : "";
    if (hasMessage && !text) return NextResponse.json({ error: "Edited message cannot be empty." }, { status: 400 });
    if (text.length > DIRECT_MESSAGE_MAX) {
      return NextResponse.json({ error: `Messages can be up to ${DIRECT_MESSAGE_MAX} characters.` }, { status: 400 });
    }

    const updated = await prisma.directMessage.update({
      where: { id: result.message.id },
      data: {
        ...(hasMessage ? { message: text } : {}),
        // Pinning alone doesn't mark the message as edited.
        ...(hasPinned ? { pinned: body.pinned as boolean, ...(!hasMessage ? { updatedAt: result.message.updatedAt } : {}) } : {}),
      },
      select: DIRECT_MESSAGE_SELECT,
    });
    return NextResponse.json(serializeDirectMessage(updated));
  } catch (error) {
    console.error("PATCH /api/direct-chats/[userId]/comments/[commentId] error:", error);
    return NextResponse.json({ error: "Failed to update the message" }, { status: 500 });
  }
}

export async function DELETE(_req: Request, context: RouteContext) {
  try {
    const { userId: personId, commentId } = await context.params;
    const result = await getOwnMessage(personId, commentId);
    if ("error" in result) return result.error;
    await prisma.directMessage.delete({ where: { id: result.message.id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("DELETE /api/direct-chats/[userId]/comments/[commentId] error:", error);
    return NextResponse.json({ error: "Failed to delete the message" }, { status: 500 });
  }
}
