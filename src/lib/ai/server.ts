import "server-only";

// The AI assistant on the server (#307): the real database, provider and
// planner behind runAgentChat, the streamed response, and the usage log.
import { quotaDayStart } from "@/lib/ai/allowance";
import { runAgentChat, type ChatEvent, type ChatRequest, type RunRecord } from "@/lib/ai/chat";
import { readAgentConfig } from "@/lib/ai/config";
import { plannerAnswer } from "@/lib/ai/fallback";
import { createProvider } from "@/lib/ai/providers";
import { AGENT_TOOLS } from "@/lib/ai/tools";
import { prisma } from "@/lib/prisma";
import { generateSmartPlanner } from "@/lib/smart-planner";
import { toWallClock } from "@/lib/user-time";
import { getUserTimeZone } from "@/lib/user-time-server";

/** Model requests counted since the quota day began (allowance.ts): the person's own, and everyone's. */
export async function modelRequestsToday(userId: string, now = new Date()) {
  const since = quotaDayStart(now);
  const [user, app] = await Promise.all([
    prisma.agentRun.aggregate({ where: { userId, createdAt: { gte: since } }, _sum: { modelRequests: true } }),
    prisma.agentRun.aggregate({ where: { createdAt: { gte: since } }, _sum: { modelRequests: true } }),
  ]);
  return { user: user._sum.modelRequests ?? 0, app: app._sum.modelRequests ?? 0 };
}

async function saveRun(userId: string, record: RunRecord, startedAt: Date) {
  try {
    await prisma.agentRun.create({
      data: { userId, createdAt: startedAt, latencyMs: Date.now() - startedAt.getTime(), ...record },
    });
  } catch (error) {
    // The answer has already gone out; losing one row only undercounts the caps a little.
    console.error("agent_run_log_failed", { error: error instanceof Error ? error.name : "UnknownError" });
  }
}

/** Answers one message as a stream of JSON lines (see `ChatEvent`), and logs the run when it ends. */
export async function streamAgentChat({ userId, request, signal }: { userId: string; request: ChatRequest; signal: AbortSignal }) {
  const startedAt = new Date();
  const config = readAgentConfig(process.env);
  if (config.disabledReason && config.disabledReason !== "missing_key") {
    console.warn("agent_misconfigured", { provider: config.provider, reason: config.disabledReason });
  }
  const timeZone = await getUserTimeZone();
  const realNow = new Date();
  const now = toWallClock(timeZone, realNow);
  const context = { userId, now, realNow, timeZone, db: prisma };

  // Stops the model and the tools when the person goes away.
  const gone = new AbortController();
  const leave = () => gone.abort();
  signal.addEventListener("abort", leave, { once: true });
  const encoder = new TextEncoder();
  let open = true;

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: ChatEvent) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          open = false;
        }
      };

      const { record, providerError, failure } = await runAgentChat(
        request,
        {
          config,
          provider: createProvider(config, process.env),
          tools: AGENT_TOOLS,
          context,
          usedToday: () => modelRequestsToday(userId, realNow),
          planner: async () => plannerAnswer(await generateSmartPlanner(userId, now, realNow)),
          signal: gone.signal,
        },
        emit,
      );
      if (providerError) {
        console.error("agent_provider_error", {
          provider: record.provider,
          model: record.model,
          kind: providerError.kind,
          status: providerError.status ?? null,
          message: providerError.message,
        });
      }
      // Names and codes only: a database error's message can quote the query, and with it what was searched for.
      if (failure) {
        console.error("agent_chat_failed", {
          error: failure instanceof Error ? failure.name : "UnknownError",
          code: typeof (failure as { code?: unknown })?.code === "string" ? (failure as { code: string }).code : null,
        });
      }

      // Written before the stream closes, so the row exists once the answer has fully arrived.
      await saveRun(userId, record, startedAt);
      signal.removeEventListener("abort", leave);
      if (open) {
        open = false;
        controller.close();
      }
    },
    cancel() {
      open = false;
      gone.abort();
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
