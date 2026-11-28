import "server-only";

// The Estimate button and the estimates subtasks get from their parent, on the server (#540): who
// may get one, the request and its row in the usage log, and the writes. A write adds the Estimate
// section only to a task that still has none, and only if its description is as it was just read,
// so an estimate never overwrites a person's edit. The task's history shows it as the person's
// change, via AI Multi. The rules are in estimate-core.ts.
import { allowanceFor, exhaustedCap, untilReset, type Allowance } from "@/lib/ai/allowance";
import { readAgentConfig, type AgentConfig } from "@/lib/ai/config";
import {
  buttonPlan,
  estimateBlock,
  estimateButtonState,
  estimatedDescription,
  followPlan,
  runEstimate,
  type EstimateBlock,
  type EstimateFailure,
  type EstimateFollowUp,
  type EstimatePlan,
  type EstimateRun,
} from "@/lib/ai/estimate-core";
import type { EstimateButtonState } from "@/lib/ai/estimate-client";
import { NOTICE_REQUIRED_MESSAGE } from "@/lib/ai/notice";
import { createProvider } from "@/lib/ai/providers";
import type { Provider } from "@/lib/ai/types";
import { modelRequestsToday, saveRun } from "@/lib/ai/usage-log";
import { refreshCalendarFeeds } from "@/lib/calendar-feed-store";
import { hasEstimate, type EstimateStep } from "@/lib/estimates";
import { prisma } from "@/lib/prisma";
import { canEditProjectContent, getProjectAccess, unauthorizedProjectResponse } from "@/lib/project-access";
import { consumeRateLimit } from "@/lib/rate-limit";
import { RATE_LIMITS } from "@/lib/rate-limit-core";
import { loadHistoryStates, recordTaskChanges } from "@/lib/task-history-server";
import { taskInclude, visibleTaskWhere } from "@/lib/task-include";
import type { TaskWithDetails } from "@/lib/task-writes";

/** What estimates are made through, in the task's history: the in-app AI, for the person. */
const VIA = "AI Multi";

const TASK_SELECT = { id: true, title: true, description: true, parentId: true, userId: true, projectId: true } as const;

type Ready = { block: null; config: AgentConfig; provider: Provider; allowance: Allowance };

/**
 * Whether the person may get estimates now (estimateBlock), and if so the provider to ask and
 * today's allowance. Their account is read here, not taken from the caller.
 */
async function readiness(userId: string, country: string | null, now: Date): Promise<{ block: EstimateBlock } | Ready> {
  const config = readAgentConfig(process.env);
  const provider = createProvider(config, process.env);
  const account = await prisma.user.findUnique({ where: { id: userId }, select: { isGuest: true, aiNoticeAcceptedAt: true } });
  const block = estimateBlock({
    isGuest: account?.isGuest ?? true,
    noticeAcceptedAt: account?.aiNoticeAcceptedAt,
    config,
    hasProvider: provider !== null,
    country,
  });
  if (block || !provider) return { block: block ?? "disabled" };
  return { block: null, config, provider, allowance: allowanceFor(await modelRequestsToday(userId, now), config.caps, now) };
}

/**
 * The Estimate button on the page of a task without an estimate that the person may change: ready,
 * or used up until the allowance resets. Null when they can't use the AI, so the page shows none.
 */
export async function estimateButtonFor(userId: string, country: string | null, now = new Date()): Promise<EstimateButtonState | null> {
  const ready = await readiness(userId, country, now);
  return ready.block ? null : estimateButtonState(ready.allowance);
}

/** The task's subtasks the person can see, oldest first, as the task's page lists them. */
function subtasksOf(parentId: string, userId: string) {
  return prisma.task.findMany({
    where: { parentId, ...visibleTaskWhere(userId) },
    orderBy: { createdAt: "asc" },
    select: { id: true, title: true, description: true },
  });
}

/** Whether the person may change a task in `projectId`: every task of their own, and a project's as its Editor or above. */
async function mayEdit(projectId: string | null, userId: string) {
  return !projectId || canEditProjectContent(await getProjectAccess(projectId, userId));
}

/**
 * Asks the model, logs the run, and reports a failure to the server log: never the task's content.
 * Nothing cancels it: someone who leaves the page still gets the estimate they asked for.
 */
async function ask(userId: string, { config, provider }: Ready, plan: EstimatePlan) {
  const startedAt = new Date();
  const run = await runEstimate({ provider, model: config.model, plan, signal: new AbortController().signal });
  if (run.error) {
    console.error("estimate_provider_error", {
      provider: run.record.provider,
      model: run.record.model,
      kind: run.error.kind,
      status: run.error.status ?? null,
      message: run.error.message,
    });
  } else if (run.failure && run.failure !== "cancelled") {
    console.warn("estimate_failed", { provider: run.record.provider, model: run.record.model, outcome: run.record.outcome, validationFailures: run.record.validationFailures });
  }
  await saveRun(userId, run.record, startedAt);
  return run;
}

/**
 * Writes each estimate into its task's description, in one transaction, and records it in the
 * task's history as the person's change via AI Multi. A task that has an estimate by now, or whose
 * description changed between the read and the write, is left as it is. Returns the ids written.
 */
async function writeEstimates(userId: string, run: EstimateRun) {
  const ids = [...run.estimates.keys()];
  return prisma.$transaction(async (tx) => {
    const rows = await tx.task.findMany({ where: { id: { in: ids }, deletedAt: null }, select: { id: true, description: true, parentId: true } });
    const before = await loadHistoryStates(
      rows.map((row) => row.id),
      tx,
    );
    const written: string[] = [];
    for (const row of rows) {
      const estimate = run.estimates.get(row.id);
      if (!estimate || hasEstimate(row.description)) continue;
      const { count } = await tx.task.updateMany({
        where: { id: row.id, deletedAt: null, description: row.description },
        data: { description: estimatedDescription(row.description, estimate, row.parentId !== null) },
      });
      if (count) written.push(row.id);
    }
    await recordTaskChanges(new Map([...before].filter(([id]) => written.includes(id))), { id: userId, via: VIA }, tx);
    return written;
  });
}

/** Why the button got no estimate, with the status and message the route answers with. */
export type EstimateRefusal = {
  ok: false;
  status: 403 | 404 | 409 | 429 | 502 | 503 | 504;
  error: string;
  /** "notice_required": the chat's notice opens; "used_up": the button says when it's back. */
  code?: "notice_required" | "used_up";
  /** When the allowance resets, for "used_up" (ISO 8601). */
  resetsAt?: string;
};

export type EstimateOutcome = { ok: true; task: TaskWithDetails; size: EstimateStep; subtasks: number } | EstimateRefusal;

function refusal(status: EstimateRefusal["status"], error: string): EstimateRefusal {
  return { ok: false, status, error };
}

const BLOCKED: Record<EstimateBlock, EstimateRefusal> = {
  guest: refusal(403, "Create an account to use the AI assistant."),
  notice: { ...refusal(403, NOTICE_REQUIRED_MESSAGE), code: "notice_required" },
  disabled: refusal(503, "The AI assistant isn't available here."),
  region: refusal(403, "The AI assistant isn't available in your country yet."),
};

const FAILED: Record<EstimateFailure, EstimateRefusal> = {
  rate_limited: refusal(503, "The AI service is busy right now. Try again in a minute."),
  unavailable: refusal(503, "The AI service isn't answering right now. Try again later."),
  timeout: refusal(504, "The AI service took too long to answer. Try again."),
  rejected: refusal(502, "The AI couldn't estimate this task. Try again later."),
  invalid: refusal(502, "The AI couldn't estimate this task. Try again."),
  cancelled: refusal(503, "The estimate was cancelled."),
};

/** The button once today's allowance is used up: which one, and when it resets. */
function usedUp(allowance: Allowance, now: Date): EstimateRefusal {
  const error =
    exhaustedCap(allowance) === "app"
      ? `The AI assistant has reached today's limit for everyone. It resets in ${untilReset(allowance, now)}.`
      : `You've used today's AI allowance of ${allowance.user.limit} requests. It resets in ${untilReset(allowance, now)}.`;
  return { ok: false, status: 429, error, code: "used_up", resetsAt: allowance.resetsAt };
}

/**
 * The Estimate button (#540): the task's estimate, and those of its subtasks that have none, from
 * one model request. Only for a task without an estimate that the person may change.
 */
export async function estimateTask(userId: string, taskId: string, { country, now = new Date() }: { country: string | null; now?: Date }): Promise<EstimateOutcome> {
  const task = await prisma.task.findFirst({ where: { id: taskId, ...visibleTaskWhere(userId) }, select: TASK_SELECT });
  if (!task) return refusal(404, "Task not found");
  if (!(await mayEdit(task.projectId, userId))) return refusal(403, unauthorizedProjectResponse("edit tasks").error);
  const plan = buttonPlan(task, await subtasksOf(task.id, userId));
  if (!plan) return refusal(409, "This task already has an estimate.");

  const ready = await readiness(userId, country, now);
  if (ready.block) return BLOCKED[ready.block];
  if (exhaustedCap(ready.allowance)) return usedUp(ready.allowance, now);

  const run = await ask(userId, ready, plan);
  if (run.failure) return FAILED[run.failure];

  const written = await writeEstimates(userId, run);
  // The calendar feeds show descriptions.
  if (written.length) refreshCalendarFeeds({ userIds: [task.userId], projectIds: [task.projectId] });
  const estimate = run.estimates.get(task.id);
  // Someone gave it an estimate, or trashed it, while the model answered.
  if (!estimate || !written.includes(task.id)) return refusal(409, "This task changed while the AI estimated it. Reload to see it.");
  const updated = await prisma.task.findUnique({ where: { id: task.id }, include: taskInclude(userId) });
  if (!updated) return refusal(404, "Task not found");
  return { ok: true, task: updated, size: estimate.size, subtasks: written.length - 1 };
}

/**
 * Estimates a parent's subtasks that follow its estimate (#540), once a subtask is created under
 * it or it gets its estimate: one request, as the person who made the change, after the response.
 * It skips quietly when they can't use the AI, today's allowance is used up, or nothing needs one,
 * and never fails the change.
 */
export async function estimateSubtasks(userId: string, { parentId, subtaskIds }: EstimateFollowUp, country: string | null, now = new Date()) {
  try {
    const parent = await prisma.task.findFirst({ where: { id: parentId, ...visibleTaskWhere(userId) }, select: TASK_SELECT });
    if (!parent || parent.parentId || !(await mayEdit(parent.projectId, userId))) return;
    const plan = followPlan(parent, await subtasksOf(parent.id, userId), subtaskIds);
    if (!plan) return;

    const ready = await readiness(userId, country, now);
    if (ready.block || exhaustedCap(ready.allowance)) return;
    if (!(await consumeRateLimit(RATE_LIMITS.agentEstimateUser, userId, now)).allowed) return;

    const run = await ask(userId, ready, plan);
    if (run.failure) return;
    const written = await writeEstimates(userId, run);
    if (written.length) refreshCalendarFeeds({ userIds: [parent.userId], projectIds: [parent.projectId] });
  } catch (error) {
    console.error("estimate_subtasks_failed", { error: error instanceof Error ? error.name : "UnknownError" });
  }
}
