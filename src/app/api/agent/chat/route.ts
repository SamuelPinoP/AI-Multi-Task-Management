import { NextResponse } from "next/server";
import { MAX_MESSAGES, parseChatRequest } from "@/lib/ai/chat";
import { agentAccount, chatToContinue } from "@/lib/ai/chat-history";
import { CHAT_FULL_MESSAGE, CHAT_NOT_FOUND_MESSAGE } from "@/lib/ai/chat-history-core";
import { hasAcceptedNotice, NOTICE_REQUIRED_MESSAGE } from "@/lib/ai/notice";
import { streamAgentChat } from "@/lib/ai/server";
import { prisma } from "@/lib/prisma";
import { consumeRateLimit, rateLimitedResponse } from "@/lib/rate-limit";
import { RATE_LIMITS } from "@/lib/rate-limit-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The agent's own deadline is 30 seconds (src/lib/ai/agent-loop.ts); this leaves room for the planner and the log.
export const maxDuration = 60;

/**
 * The AI assistant (#307): `{ message, chatId? }`, the person's question and the stored chat it
 * continues (#452; none starts a new one). The model's earlier messages come from that chat in the
 * database, never from the browser. Answers with a stream of JSON lines (see `ChatEvent` in
 * src/lib/ai/chat.ts), whose `done` names the chat the question and answer were stored in.
 * Signed-in accounts only, not guests, and only once they've agreed to the data notice: until then
 * nothing of theirs is sent to a model provider.
 */
export async function POST(request: Request) {
  const { user, response } = await agentAccount();
  if (!user) return response;

  const parsed = parseChatRequest(await request.json().catch(() => null));
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const account = await prisma.user.findUnique({ where: { id: user.id }, select: { aiNoticeAcceptedAt: true } });
  if (!hasAcceptedNotice(account?.aiNoticeAcceptedAt)) {
    return NextResponse.json({ error: NOTICE_REQUIRED_MESSAGE, code: "notice_required" }, { status: 403 });
  }

  const limit = await consumeRateLimit(RATE_LIMITS.agentChatUser, user.id);
  if (!limit.allowed) return rateLimitedResponse("messages to the assistant", limit);

  const { chatId, message } = parsed.request;
  const chat = chatId ? await chatToContinue(user.id, chatId) : null;
  // Another person's chat gets the same answer as a missing one.
  if (chatId && !chat) return NextResponse.json({ error: CHAT_NOT_FOUND_MESSAGE }, { status: 404 });
  if (chat && chat.messageCount + 2 > MAX_MESSAGES) return NextResponse.json({ error: CHAT_FULL_MESSAGE }, { status: 409 });

  return streamAgentChat({
    userId: user.id,
    question: message,
    chat,
    signal: request.signal,
    country: request.headers.get("x-vercel-ip-country"),
  });
}
