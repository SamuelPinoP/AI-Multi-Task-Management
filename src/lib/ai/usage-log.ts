import "server-only";

// The AI's usage log (#307): a row in AgentRun for every message to the assistant and every
// estimate (#540), without their content, and the counts the daily caps read from it.
import { quotaDayStart } from "@/lib/ai/allowance";
import type { RunRecord } from "@/lib/ai/chat";
import { prisma } from "@/lib/prisma";

/** Model requests counted since the quota day began (allowance.ts): the person's own, and everyone's. */
export async function modelRequestsToday(userId: string, now = new Date()) {
  const since = quotaDayStart(now);
  const [user, app] = await Promise.all([
    prisma.agentRun.aggregate({ where: { userId, createdAt: { gte: since } }, _sum: { modelRequests: true } }),
    prisma.agentRun.aggregate({ where: { createdAt: { gte: since } }, _sum: { modelRequests: true } }),
  ]);
  return { user: user._sum.modelRequests ?? 0, app: app._sum.modelRequests ?? 0 };
}

/** Logs a run that started at `startedAt`. Never throws. */
export async function saveRun(userId: string, record: RunRecord, startedAt: Date) {
  try {
    await prisma.agentRun.create({
      data: { userId, createdAt: startedAt, latencyMs: Date.now() - startedAt.getTime(), ...record },
    });
  } catch (error) {
    // The answer has already gone out; losing one row only undercounts the caps a little.
    console.error("agent_run_log_failed", { error: error instanceof Error ? error.name : "UnknownError" });
  }
}
