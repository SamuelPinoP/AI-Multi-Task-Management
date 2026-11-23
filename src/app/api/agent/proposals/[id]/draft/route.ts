import { NextResponse } from "next/server";
import { agentAccount } from "@/lib/ai/chat-history";
import { parseDraftEdit } from "@/lib/ai/proposals-core";
import { editDraft } from "@/lib/ai/proposals-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Saves the person's edits to a draft ticket in a pending proposal (#433), before they apply it:
 * `{ "step": 1, "description": "## Summary…" }` replaces the description of the new task at that
 * index. Nothing in the workspace changes; Apply creates the task with this description. Answers
 * `{ proposal }`, or `{ error, proposal }`: a step that isn't a new task (400), someone else's or a
 * missing proposal (404), or one already applied, cancelled or expired (409).
 */
export async function PATCH(request: Request, context: RouteContext) {
  const { user, response } = await agentAccount();
  if (!user) return response;
  const edit = parseDraftEdit(await request.text().catch(() => ""));
  if (!edit.ok) return NextResponse.json({ error: edit.error }, { status: 400 });
  try {
    const result = await editDraft(user.id, (await context.params).id, edit.step, edit.description);
    if (!result.ok) return NextResponse.json({ error: result.error, proposal: result.proposal }, { status: result.status });
    return NextResponse.json({ proposal: result.proposal });
  } catch (error) {
    console.error("agent_proposal_draft_failed", {
      error: error instanceof Error ? error.name : "UnknownError",
      code: typeof (error as { code?: unknown })?.code === "string" ? (error as { code: string }).code : null,
    });
    return NextResponse.json({ error: "Something went wrong on our side, and the draft wasn't saved. Try again in a moment." }, { status: 500 });
  }
}
