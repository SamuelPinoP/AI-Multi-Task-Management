import { NextResponse } from "next/server";
import { agentAccount, deleteChat, openChat, renameChat } from "@/lib/ai/chat-history";
import { CHAT_NOT_FOUND_MESSAGE, parseChatTitle } from "@/lib/ai/chat-history-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

// Another person's chat gets exactly this too, so nobody can tell it exists.
const notFound = () => NextResponse.json({ error: CHAT_NOT_FOUND_MESSAGE }, { status: 404 });

/**
 * One of the person's AI chats (#452) with its messages, oldest first (`StoredChat` in
 * src/lib/ai/chat-history-core.ts). Opening it starts its 90 days again (the daily cleanup).
 */
export async function GET(_request: Request, context: RouteContext) {
  const { user, response } = await agentAccount();
  if (!user) return response;
  const chat = await openChat(user.id, (await context.params).id);
  return chat ? NextResponse.json(chat, { headers: { "Cache-Control": "no-store" } }) : notFound();
}

/** Renames a chat: `{ title }`. Its place in the list stays the same. */
export async function PATCH(request: Request, context: RouteContext) {
  const { user, response } = await agentAccount();
  if (!user) return response;
  const parsed = parseChatTitle(await request.json().catch(() => null));
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const chat = await renameChat(user.id, (await context.params).id, parsed.title);
  return chat ? NextResponse.json(chat) : notFound();
}

/** Deletes a chat and its messages, for good. */
export async function DELETE(_request: Request, context: RouteContext) {
  const { user, response } = await agentAccount();
  if (!user) return response;
  return (await deleteChat(user.id, (await context.params).id)) ? NextResponse.json({ deleted: true }) : notFound();
}
