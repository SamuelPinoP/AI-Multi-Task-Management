import { NextResponse } from "next/server";
import { parseChatRequest } from "@/lib/ai/chat";
import { hasAcceptedNotice, NOTICE_REQUIRED_MESSAGE } from "@/lib/ai/notice";
import { streamAgentChat } from "@/lib/ai/server";
import { requireApiUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { consumeRateLimit, rateLimitedResponse } from "@/lib/rate-limit";
import { RATE_LIMITS } from "@/lib/rate-limit-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The agent's own deadline is 30 seconds (src/lib/ai/agent-loop.ts); this leaves room for the planner and the log.
export const maxDuration = 60;

/**
 * The AI assistant (#307): `{ messages: [{ role: "user" | "assistant", content }] }`, the last one
 * the person's. Answers with a stream of JSON lines (see `ChatEvent` in src/lib/ai/chat.ts).
 * Signed-in accounts only, not guests, and only once they've agreed to the data notice: until then
 * nothing of theirs is sent to a model provider.
 */
export async function POST(request: Request) {
  const user = await requireApiUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (user.isGuest) return NextResponse.json({ error: "Create an account to use the AI assistant." }, { status: 403 });

  const parsed = parseChatRequest(await request.json().catch(() => null));
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const account = await prisma.user.findUnique({ where: { id: user.id }, select: { aiNoticeAcceptedAt: true } });
  if (!hasAcceptedNotice(account?.aiNoticeAcceptedAt)) {
    return NextResponse.json({ error: NOTICE_REQUIRED_MESSAGE, code: "notice_required" }, { status: 403 });
  }

  const limit = await consumeRateLimit(RATE_LIMITS.agentChatUser, user.id);
  if (!limit.allowed) return rateLimitedResponse("messages to the assistant", limit);

  return streamAgentChat({
    userId: user.id,
    request: parsed.request,
    signal: request.signal,
    country: request.headers.get("x-vercel-ip-country"),
  });
}
