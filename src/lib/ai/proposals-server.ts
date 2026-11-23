import "server-only";

// The AI assistant's proposals in the database (#310): stored with the answer that made them, then
// applied or cancelled by the person who asked, and only by them. Applying runs the steps the
// person ticked through the app's own rules (task-writes.ts, project-writes.ts, event-writes.ts)
// in one transaction, so either all of those change or none does; it re-checks what the person may
// change, and it makes no model request. Nothing the model says can apply a proposal: only these
// functions do, behind the person's Apply button.
import { PROPOSAL_SELECT, proposalView, refusalMessage, storedSteps, taskUpdateInput } from "@/lib/ai/proposals-core";
import {
  NOT_PENDING_MESSAGES,
  PROPOSAL_NOT_FOUND,
  PROPOSAL_TTL_MS,
  choiceProblem,
  isExisting,
  type ItemRef,
  type ProposalLink,
  type ProposalStep,
  type ProposalView,
} from "@/lib/ai/proposals";
import type { Db } from "@/lib/db-client";
import { createEvent, parseEventCreateBody } from "@/lib/event-writes";
import { prisma } from "@/lib/prisma";
import { createProject } from "@/lib/project-writes";
import { parseTaskDueDateForStorage } from "@/lib/task-date-buckets";
import { visibleTaskWhere } from "@/lib/task-include";
import { createTask, trashTask, updateTask } from "@/lib/task-writes";
import { runFollowUps, type FollowUp, type WriteActor, type WriteResult } from "@/lib/writes";

// Several changes make several inserts each; Prisma's 5-second default is tight on a cold database.
const APPLY_TRANSACTION = { maxWait: 10_000, timeout: 20_000 };

/** Stores the changes an answer proposed, pending for PROPOSAL_TTL_MS. The answer is linked when it's stored. */
export async function storeProposal(userId: string, steps: ProposalStep[], now = new Date()) {
  return prisma.agentProposal.create({
    data: { userId, steps, createdAt: now, expiresAt: new Date(now.getTime() + PROPOSAL_TTL_MS) },
    select: { id: true, expiresAt: true },
  });
}

export type ProposalOutcome = { ok: true; proposal: ProposalView } | { ok: false; status: 400 | 404 | 409; error: string; proposal: ProposalView | null };

/** A step the app's rules refused while applying: the transaction rolls back. */
class StepRefused extends Error {}

/** Someone applied or cancelled it first, or its hour ran out. */
class NotPending extends Error {}

function accepted<Value>(step: ProposalStep, result: WriteResult<Value>, followUps: FollowUp[]): Value {
  if (!result.ok) throw new StepRefused(refusalMessage(step, result));
  followUps.push(result.followUp);
  return result.value;
}

const taskHref = (id: string) => `/tasks?task=${encodeURIComponent(id)}`;

/**
 * Runs the steps `chosen` (by index), in order, through the app's rules, inside the transaction
 * `db` belongs to. A step that points at an item an earlier step creates finds it by its ref.
 * Returns the follow-ups to run once committed, and a link to each change.
 */
async function applySteps(actor: WriteActor, steps: ProposalStep[], chosen: number[], db: Db) {
  const created = new Map<string, string>();
  const followUps: FollowUp[] = [];
  const links: ProposalLink[] = [];
  const idOf = (item: ItemRef | null) => {
    if (!item) return null;
    if (isExisting(item)) return item.id;
    // Apply checks that every chosen step's new project or parent is chosen too, and comes first.
    const id = created.get(item.ref);
    if (!id) throw new StepRefused(`Nothing was changed: “${item.name}” wasn't created first.`);
    return id;
  };

  for (const index of chosen) {
    const step = steps[index];
    const link = (title: string, href: string) => links.push({ step: index, title, href });
    switch (step.kind) {
      case "create_project": {
        const project = accepted(step, await createProject(actor, { name: step.name, description: step.description, color: null, priority: "NONE" }, db), followUps);
        created.set(step.ref, project.id);
        link(project.name, `/projects/${encodeURIComponent(project.id)}`);
        break;
      }
      case "create_task": {
        const input = {
          title: step.title,
          description: step.description ?? "",
          dueDate: step.dueDate ? parseTaskDueDateForStorage(step.dueDate) : null,
          priority: step.priority,
          projectId: idOf(step.project),
          assigneeId: null,
          parentId: idOf(step.parent),
          noteId: null,
        };
        const task = accepted(step, await createTask(actor, input, db), followUps);
        created.set(step.ref, task.id);
        link(task.title, taskHref(task.id));
        break;
      }
      case "update_task":
      case "complete_task": {
        const current = await db.task.findFirst({
          where: { id: step.task.id, ...visibleTaskWhere(actor.id) },
          select: { title: true, description: true, status: true, priority: true, recurrence: true, dueDate: true, projectId: true, assigneeId: true },
        });
        if (!current) throw new StepRefused(refusalMessage(step, { status: 404, error: "Task not found" }));
        // Done since it was proposed: the person gets what they asked for, without a second entry in Activity.
        if (step.kind === "complete_task" && current.status === "DONE") {
          link(current.title, taskHref(step.task.id));
          break;
        }
        const task = accepted(step, await updateTask(actor, step.task.id, taskUpdateInput(current, step, idOf), db), followUps);
        link(task.title, taskHref(task.id));
        break;
      }
      case "create_event": {
        const parsed = parseEventCreateBody({
          title: step.title,
          startDate: step.date,
          startTime: step.startTime,
          endTime: step.endTime,
          description: step.description,
          projectId: idOf(step.project),
        });
        if ("error" in parsed) throw new StepRefused(refusalMessage(step, { status: 400, error: parsed.error }));
        const event = accepted(step, await createEvent(actor, parsed.data, db), followUps);
        link(event.title, `/events?event=${encodeURIComponent(event.id)}`);
        break;
      }
      case "trash_task": {
        const task = accepted(step, await trashTask(actor, step.task.id, db), followUps);
        link(task.title, "/trash");
        break;
      }
    }
  }
  return { followUps, links };
}

async function currentView(userId: string, proposalId: string, now: Date) {
  const row = await prisma.agentProposal.findFirst({ where: { id: proposalId, userId }, select: PROPOSAL_SELECT });
  return row ? proposalView(row, now) : null;
}

function notPending(view: ProposalView | null): ProposalOutcome {
  if (!view) return { ok: false, status: 404, error: PROPOSAL_NOT_FOUND, proposal: null };
  const error = view.state === "pending" ? PROPOSAL_NOT_FOUND : (view.error ?? NOT_PENDING_MESSAGES[view.state]);
  return { ok: false, status: 409, error, proposal: view };
}

/**
 * Applies a pending proposal of the person's: the steps they ticked (`chosen`, by index; null for
 * all of them), every one of those or none. Steps that need a new project or task need it chosen
 * too; asking for one without it is refused, and the proposal stays pending. The proposal is
 * claimed in the same transaction as the changes, so a second Apply waits for the first and then
 * finds nothing pending. A refused step leaves it FAILED, with why, and nothing changed.
 */
export async function applyProposal(person: WriteActor, proposalId: string, chosen: number[] | null, now = new Date()): Promise<ProposalOutcome> {
  const view = await currentView(person.id, proposalId, now);
  if (!view || view.state !== "pending") return notPending(view);
  const steps = chosen ?? view.steps.map((_, index) => index);
  const problem = choiceProblem(view.steps, steps);
  if (problem) return { ok: false, status: 400, error: problem, proposal: view };
  const applied = [...steps].sort((a, b) => a - b);

  const actor: WriteActor = { id: person.id, name: person.name, email: person.email, via: "AI Multi" };
  try {
    const { followUps, links, steps: appliedSteps } = await prisma.$transaction(async (tx) => {
      const claimed = await tx.agentProposal.updateMany({
        where: { id: proposalId, userId: actor.id, status: "PENDING", expiresAt: { gt: now } },
        data: { status: "APPLIED", decidedAt: now, applied },
      });
      if (!claimed.count) throw new NotPending();
      // The steps as they are now, once claimed: a draft ticket edited a moment ago goes in as edited (#433).
      const stored = await tx.agentProposal.findUnique({ where: { id: proposalId }, select: { steps: true } });
      const current = storedSteps(stored?.steps) ?? view.steps;
      const result = await applySteps(actor, current, applied, tx);
      await tx.agentProposal.update({ where: { id: proposalId }, data: { links: result.links } });
      return { ...result, steps: current };
    }, APPLY_TRANSACTION);
    runFollowUps(actor, followUps);
    return { ok: true, proposal: { ...view, steps: appliedSteps, state: "applied", applied, links } };
  } catch (error) {
    if (error instanceof NotPending) return notPending(await currentView(person.id, proposalId, now));
    if (!(error instanceof StepRefused)) throw error;
    await prisma.agentProposal.updateMany({
      where: { id: proposalId, userId: person.id, status: "PENDING" },
      data: { status: "FAILED", error: error.message, decidedAt: now },
    });
    return { ok: false, status: 409, error: error.message, proposal: { ...view, state: "failed", error: error.message } };
  }
}

/**
 * Changes the description of a new task in a pending proposal of the person's (#433): their edits
 * to its draft ticket, before they apply it. Nothing else in a step can change, so the card still
 * says what applying it does. One UPDATE writes just that description, so two edits at once don't
 * undo each other, and none lands once the proposal is applied or cancelled. Nothing in the
 * workspace changes.
 */
export async function editDraft(userId: string, proposalId: string, step: number, description: string, now = new Date()): Promise<ProposalOutcome> {
  const view = await currentView(userId, proposalId, now);
  if (!view || view.state !== "pending") return notPending(view);
  if (view.steps[step]?.kind !== "create_task") {
    return { ok: false, status: 400, error: "Only a new task's description can be changed before it's applied.", proposal: view };
  }
  const value = description || null;
  const changed = await prisma.$executeRaw`
    UPDATE "AgentProposal"
    SET "steps" = jsonb_set("steps", ARRAY[${String(step)}::text, 'description'], COALESCE(to_jsonb(${value}::text), 'null'::jsonb))
    WHERE "id" = ${proposalId} AND "userId" = ${userId} AND "status" = 'PENDING' AND "steps" -> ${step}::int ->> 'kind' = 'create_task'`;
  const updated = await currentView(userId, proposalId, now);
  if (!changed || !updated) return notPending(updated);
  return { ok: true, proposal: updated };
}

/** Cancels a pending proposal of the person's. Nothing changes. */
export async function cancelProposal(userId: string, proposalId: string, now = new Date()): Promise<ProposalOutcome> {
  const cancelled = await prisma.agentProposal.updateMany({
    where: { id: proposalId, userId, status: "PENDING" },
    data: { status: "CANCELLED", decidedAt: now },
  });
  const view = await currentView(userId, proposalId, now);
  if (!cancelled.count || !view) return notPending(view);
  return { ok: true, proposal: view };
}
