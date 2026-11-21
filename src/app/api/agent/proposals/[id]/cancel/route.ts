import { NextResponse } from "next/server";
import { agentAccount } from "@/lib/ai/chat-history";
import { cancelProposal } from "@/lib/ai/proposals-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Cancels the changes an AI answer proposed (#310); nothing changes. Answers `{ proposal }`, or
 * `{ error, proposal }` when it isn't pending any more (409) or isn't the person's (404).
 */
export async function POST(_request: Request, context: RouteContext) {
  const { user, response } = await agentAccount();
  if (!user) return response;
  const result = await cancelProposal(user.id, (await context.params).id);
  if (!result.ok) return NextResponse.json({ error: result.error, proposal: result.proposal }, { status: result.status });
  return NextResponse.json({ proposal: result.proposal });
}
