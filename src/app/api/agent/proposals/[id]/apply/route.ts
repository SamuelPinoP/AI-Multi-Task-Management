import { NextResponse } from "next/server";
import { agentAccount } from "@/lib/ai/chat-history";
import { parseApplyRequest } from "@/lib/ai/proposals-core";
import { applyProposal } from "@/lib/ai/proposals-server";
import { changeOrigin } from "@/lib/writes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// New subtasks under a task with an estimate get theirs after the response (#540), with a 20-second deadline.
export const maxDuration = 60;

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Applies the changes an AI answer proposed (#310) as the person who asked for them: only their
 * Apply button calls this, never the model. The body `{ "steps": [0, 2] }` names the changes they
 * ticked, by index; with none, all of them apply. Every one of those applies, or none does.
 * Answers `{ proposal }`, applied, with links to what changed. When it can't be applied, it
 * answers `{ error, proposal }`, and nothing changed: a change chosen without the new project or
 * task it goes in (400, still pending), someone else's or a missing proposal (404), or one already
 * applied, cancelled or expired, or a change the app's rules refused (409).
 */
export async function POST(request: Request, context: RouteContext) {
  const { user, response } = await agentAccount();
  if (!user) return response;
  const choice = parseApplyRequest(await request.text().catch(() => ""));
  if (!choice.ok) return NextResponse.json({ error: choice.error }, { status: 400 });
  try {
    const result = await applyProposal(user, (await context.params).id, choice.steps, changeOrigin(request));
    if (!result.ok) return NextResponse.json({ error: result.error, proposal: result.proposal }, { status: result.status });
    return NextResponse.json({ proposal: result.proposal });
  } catch (error) {
    // The transaction rolled back. Names and codes only: a database error's message can quote what was written.
    console.error("agent_proposal_apply_failed", {
      error: error instanceof Error ? error.name : "UnknownError",
      code: typeof (error as { code?: unknown })?.code === "string" ? (error as { code: string }).code : null,
    });
    return NextResponse.json({ error: "Something went wrong on our side, and nothing was changed. Try again in a moment." }, { status: 500 });
  }
}
