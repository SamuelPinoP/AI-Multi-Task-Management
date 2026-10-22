import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { automaticAssignee, describeAutomation, shouldEmailOwner, type AutomationTrigger } from "@/lib/project-automations-core";
import { sendTaskAutomationEmail } from "@/lib/email";
import { consumeRateLimit } from "@/lib/rate-limit";
import { RATE_LIMITS } from "@/lib/rate-limit-core";

export const AUTOMATION_SELECT = {
  id: true,
  trigger: true,
  action: true,
  memberId: true,
  enabled: true,
  member: { select: { name: true } },
} as const satisfies Prisma.ProjectAutomationSelect;

type AutomationRow = Prisma.ProjectAutomationGetPayload<{ select: typeof AUTOMATION_SELECT }>;

/** A rule as the API and the project page show it. */
export function automationJson({ member, ...rule }: AutomationRow) {
  return { ...rule, memberName: member?.name ?? null, label: describeAutomation({ ...rule, memberName: member?.name }) };
}

export type AutomationView = ReturnType<typeof automationJson>;

/** Who a new project task is assigned to, after the project's "assign new tasks" rule (SMART-11). */
export async function assigneeForNewTask(projectId: string | null, task: { assigneeId: string | null; isSubtask: boolean }) {
  if (!projectId || task.assigneeId || task.isSubtask) return task.assigneeId;
  const rules = await prisma.projectAutomation.findMany({
    where: { projectId, trigger: "TASK_CREATED", action: "ASSIGN_MEMBER", enabled: true },
    orderBy: { createdAt: "asc" },
    select: { trigger: true, action: true, enabled: true, memberId: true },
  });
  return automaticAssignee(rules, task);
}

/**
 * Runs the project's "email the owner" rule for a task event. Meant for
 * `after()`, so the request doesn't wait on the mail server. Emails per
 * project are capped (RATE_LIMITS.automationEmailsProject); past the cap
 * they're skipped, not queued.
 */
export async function runOwnerEmailAutomation({
  trigger,
  task,
  actorId,
  origin,
}: {
  trigger: AutomationTrigger;
  task: { id: string; title: string; projectId: string | null };
  actorId: string;
  origin: string;
}) {
  if (!task.projectId) return;
  try {
    const rule = await prisma.projectAutomation.findFirst({
      where: { projectId: task.projectId, trigger, action: "EMAIL_OWNER", enabled: true },
      select: { project: { select: { id: true, name: true, user: { select: { id: true, email: true, isGuest: true } } } } },
    });
    if (!rule || !shouldEmailOwner(rule.project.user, actorId)) return;

    const limit = await consumeRateLimit(RATE_LIMITS.automationEmailsProject, rule.project.id);
    if (!limit.allowed) {
      console.warn("Automation email skipped: project over its hourly limit.", { projectId: rule.project.id });
      return;
    }

    const actor = await prisma.user.findUnique({ where: { id: actorId }, select: { name: true, email: true } });
    const result = await sendTaskAutomationEmail({
      to: rule.project.user.email,
      trigger,
      taskTitle: task.title,
      projectId: rule.project.id,
      projectName: rule.project.name,
      actorName: actor?.name?.trim() || actor?.email || "A teammate",
      fallbackOrigin: origin,
    });
    if (result.status === "failed") console.warn("Automation email failed.", { projectId: rule.project.id });
  } catch (error) {
    console.error("Project automation failed:", error);
  }
}
