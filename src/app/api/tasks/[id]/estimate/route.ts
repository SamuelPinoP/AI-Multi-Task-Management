import { NextResponse } from "next/server";
import { agentAccount } from "@/lib/ai/chat-history";
import type { EstimateResponse } from "@/lib/ai/estimate-client";
import { estimateTask } from "@/lib/ai/estimate-server";
import { consumeRateLimit, rateLimitedResponse } from "@/lib/rate-limit";
import { RATE_LIMITS } from "@/lib/rate-limit-core";
import type { TaskWithDetails } from "@/lib/task-writes";
import { changeOrigin } from "@/lib/writes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The estimate's own deadline is 20 seconds (src/lib/ai/estimate-core.ts); this leaves room for the writes.
export const maxDuration = 60;

type RouteContext = { params: Promise<{ id: string }> };

/**
 * The Estimate button (#540): asks the AI how long the task will take, and its subtasks without an
 * estimate, in one model request, and writes the answers into their Estimate sections. Answers
 * `{ task, size, subtasks }`: the task as the task routes return it, its estimate, and how many of
 * its subtasks got one too. Refused, it answers `{ error }`, with `code: "used_up"` and `resetsAt`
 * once today's allowance is used up, or `code: "notice_required"` before the person agreed to the
 * AI's data notice. Signed-in accounts only, not guests.
 */
export async function POST(request: Request, context: RouteContext) {
  const { user, response } = await agentAccount();
  if (!user) return response;
  const limit = await consumeRateLimit(RATE_LIMITS.agentEstimateUser, user.id);
  if (!limit.allowed) return rateLimitedResponse("estimates", limit);
  try {
    const result = await estimateTask(user.id, (await context.params).id, changeOrigin(request));
    if (!result.ok) return NextResponse.json({ error: result.error, code: result.code, resetsAt: result.resetsAt }, { status: result.status });
    const body: EstimateResponse<TaskWithDetails> = { task: result.task, size: result.size, subtasks: result.subtasks };
    return NextResponse.json(body);
  } catch (error) {
    // Names and codes only: a database error's message can quote what was written.
    console.error("estimate_route_failed", {
      error: error instanceof Error ? error.name : "UnknownError",
      code: typeof (error as { code?: unknown })?.code === "string" ? (error as { code: string }).code : null,
    });
    return NextResponse.json({ error: "Something went wrong on our side. Try again in a moment." }, { status: 500 });
  }
}
