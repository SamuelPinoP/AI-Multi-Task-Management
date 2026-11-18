import { NextResponse } from "next/server";
import { agentAccount, deleteAllChats, listChats } from "@/lib/ai/chat-history";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The person's AI chats (#452), the newest first: `{ chats: [{ id, title, updatedAt }] }`, at most
 * MAX_CHATS. Read when a chat list shows, never on page loads. Nothing is sent to a model.
 */
export async function GET() {
  const { user, response } = await agentAccount();
  if (!user) return response;
  return NextResponse.json({ chats: await listChats(user.id) }, { headers: { "Cache-Control": "no-store" } });
}

/** Deletes every one of the person's AI chats, for good: `{ deleted }`, how many there were. */
export async function DELETE() {
  const { user, response } = await agentAccount();
  if (!user) return response;
  return NextResponse.json({ deleted: await deleteAllChats(user.id) });
}
