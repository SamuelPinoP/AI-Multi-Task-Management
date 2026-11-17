import { NextResponse } from "next/server";
import { allowanceFor } from "@/lib/ai/allowance";
import { answerMode, type AgentStatus } from "@/lib/ai/chat";
import { readAgentConfig } from "@/lib/ai/config";
import { hasAcceptedNotice } from "@/lib/ai/notice";
import { createProvider } from "@/lib/ai/providers";
import { modelRequestsToday } from "@/lib/ai/server";
import { requireApiUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * What the AI chat shows before the first question (#308): whether the person agreed to the data
 * notice, how much of today's allowance is left, and whether a model or the planner would answer
 * (see `AgentStatus`). Read when the chat opens, never on page loads. Nothing is sent to a model.
 */
export async function GET(request: Request) {
  const user = await requireApiUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (user.isGuest) return NextResponse.json({ error: "Create an account to use the AI assistant." }, { status: 403 });

  const [account, used] = await Promise.all([
    prisma.user.findUnique({ where: { id: user.id }, select: { aiNoticeAcceptedAt: true } }),
    modelRequestsToday(user.id),
  ]);
  const config = readAgentConfig(process.env);
  const allowance = allowanceFor(used, config.caps, new Date());
  const status: AgentStatus = {
    ...answerMode({
      config,
      hasProvider: createProvider(config, process.env) !== null,
      // Vercel sets it, as for the chat itself (region.ts).
      country: request.headers.get("x-vercel-ip-country"),
      allowance,
    }),
    noticeAccepted: hasAcceptedNotice(account?.aiNoticeAcceptedAt),
    allowance,
  };
  return NextResponse.json(status, { headers: { "Cache-Control": "no-store" } });
}
