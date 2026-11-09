import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import {
  DIRECT_MESSAGE_MAX,
  DIRECT_MESSAGE_SELECT,
  directChatAccess,
  directChatVersion,
  ensureDirectChat,
  getDirectMessages,
  markDirectChatsRead,
  NO_LONGER_SHARED_ERROR,
  serializeDirectMessage,
} from "@/lib/direct-chats";
import { prisma } from "@/lib/prisma";
import { consumeRateLimit, rateLimitedResponse } from "@/lib/rate-limit";
import { RATE_LIMITS } from "@/lib/rate-limit-core";

/**
 * The direct chat with one person (#387), keyed by their user id, in the
 * project chat's shape so the same chat view shows it. Anyone you share a
 * project with, or already have a chat with, is reachable; to anyone else the
 * chat isn't there (404).
 */
type RouteContext = { params: Promise<{ userId: string }> };

/** The chat for its two people, polled by the open chat; `version` changes with every add, edit, delete and pin. */
export async function GET(req: Request, context: RouteContext) {
  try {
    const user = await requireApiUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    const { userId: personId } = await context.params;
    const access = await directChatAccess(user.id, personId);
    if (!access) return NextResponse.json({ error: "Chat not found" }, { status: 404 });

    const version = await directChatVersion(access.chatId);
    if (new URL(req.url).searchParams.get("version") === version) return NextResponse.json({ version, changed: false });
    return NextResponse.json({ version, changed: true, comments: await getDirectMessages(access.chatId) });
  } catch (error) {
    console.error("GET /api/direct-chats/[userId]/comments error:", error);
    return NextResponse.json({ error: "Failed to load the chat" }, { status: 500 });
  }
}

/** Sends a message. The first one makes the chat; sending needs a project you both are in. */
export async function POST(req: Request, context: RouteContext) {
  try {
    const user = await requireApiUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    const { userId: personId } = await context.params;

    if (!req.headers.get("content-type")?.includes("application/json")) {
      return NextResponse.json({ error: "Direct messages are text only." }, { status: 415 });
    }
    const body = (await req.json().catch(() => null)) as { message?: unknown } | null;
    const message = typeof body?.message === "string" ? body.message.replace(/\r\n/g, "\n").trim() : "";
    if (!message) return NextResponse.json({ error: "Write a message first." }, { status: 400 });
    if (message.length > DIRECT_MESSAGE_MAX) {
      return NextResponse.json({ error: `Messages can be up to ${DIRECT_MESSAGE_MAX} characters.` }, { status: 400 });
    }

    const access = await directChatAccess(user.id, personId);
    if (!access) return NextResponse.json({ error: "Chat not found" }, { status: 404 });
    if (!access.canSend) return NextResponse.json({ error: NO_LONGER_SHARED_ERROR }, { status: 403 });

    const limit = await consumeRateLimit(RATE_LIMITS.directMessagesUser, user.id);
    if (!limit.allowed) return rateLimitedResponse("messages", limit);

    const chatId = access.chatId ?? (await ensureDirectChat(user.id, personId));
    const created = await prisma.directMessage.create({
      data: { chatId, userId: user.id, message },
      select: DIRECT_MESSAGE_SELECT,
    });
    // Writing counts as reading: your own message is never unread for you.
    await markDirectChatsRead(user.id, [chatId]);
    return NextResponse.json(serializeDirectMessage(created), { status: 201 });
  } catch (error) {
    console.error("POST /api/direct-chats/[userId]/comments error:", error);
    return NextResponse.json({ error: "Failed to send the message" }, { status: 500 });
  }
}
