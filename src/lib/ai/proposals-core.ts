// The AI assistant's proposals on the server (#310), the parts that need no database: reading the
// stored steps back, how the chat shows a stored proposal, what Apply was asked to apply, what the
// person is told when a step is refused, and what a change to a task hands the app's rules. Kept
// free of server-only imports so it can be unit tested with plain Node; ./proposals-server.ts
// stores, applies and cancels.
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import {
  MAX_PROPOSAL_STEPS,
  isExisting,
  proposalState,
  stepTitle,
  type ItemRef,
  type ProposalLink,
  type ProposalStep,
  type ProposalStepKind,
  type ProposalView,
  type StoredProposalStatus,
} from "@/lib/ai/proposals";
import { PRIORITIES } from "@/lib/priority";
import type { TaskUpdateData } from "@/lib/schemas/task";
import { parseTaskDueDateForStorage } from "@/lib/task-date-buckets";

const existingItem = z.object({ id: z.string().min(1), name: z.string() });
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const existingTask = existingItem.extend({ project: z.string().nullable(), dueDate: day.nullable() });
const itemRef = z.union([existingItem, z.object({ ref: z.string().min(1), name: z.string() })]);
const priority = z.enum(PRIORITIES);
const status = z.enum(["TODO", "IN_PROGRESS", "DONE"]);
const time = z.string().regex(/^\d{2}:\d{2}$/);
const text = z.string().nullable();

const taskChange = z.discriminatedUnion("field", [
  z.object({ field: z.literal("title"), from: z.string(), to: z.string().min(1) }),
  z.object({ field: z.literal("description"), from: text, to: text }),
  z.object({ field: z.literal("dueDate"), from: day.nullable(), to: day.nullable() }),
  z.object({ field: z.literal("priority"), from: priority, to: priority }),
  z.object({ field: z.literal("status"), from: status, to: status }),
  z.object({ field: z.literal("project"), from: existingItem.nullable(), to: itemRef.nullable() }),
]);

const stepSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("create_project"), ref: z.string().min(1), name: z.string().min(1), description: text }),
  z.object({
    kind: z.literal("create_task"),
    ref: z.string().min(1),
    title: z.string().min(1),
    description: text,
    dueDate: day.nullable(),
    priority,
    project: itemRef.nullable(),
    parent: itemRef.nullable(),
  }),
  z.object({ kind: z.literal("update_task"), task: existingTask, changes: z.array(taskChange).min(1) }),
  z.object({ kind: z.literal("complete_task"), task: existingTask }),
  z.object({
    kind: z.literal("create_event"),
    ref: z.string().min(1),
    title: z.string().min(1),
    date: day,
    startTime: time.nullable(),
    endTime: time.nullable(),
    description: text,
    project: itemRef.nullable(),
  }),
  z.object({ kind: z.literal("trash_task"), task: existingTask }),
]);

/** Every ref names an earlier step that creates that kind of item, and no two steps share one. */
function refsResolve(steps: ProposalStep[]) {
  const made = new Map<string, ProposalStepKind>();
  for (const step of steps) {
    const pointers: Array<[ItemRef | null, ProposalStepKind]> =
      step.kind === "create_task"
        ? [
            [step.project, "create_project"],
            [step.parent, "create_task"],
          ]
        : step.kind === "create_event"
          ? [[step.project, "create_project"]]
          : step.kind === "update_task"
            ? step.changes.flatMap((change): Array<[ItemRef | null, ProposalStepKind]> => (change.field === "project" ? [[change.to, "create_project"]] : []))
            : [];
    if (pointers.some(([item, kind]) => item && !isExisting(item) && made.get(item.ref) !== kind)) return false;
    if ("ref" in step) {
      if (made.has(step.ref)) return false;
      made.set(step.ref, step.kind);
    }
  }
  return true;
}

/** A proposal's steps as stored (a JSON column), or null when they aren't what the tools write. */
export function storedSteps(value: unknown): ProposalStep[] | null {
  const parsed = z.array(stepSchema).min(1).max(MAX_PROPOSAL_STEPS).safeParse(value);
  return parsed.success && refsResolve(parsed.data) ? parsed.data : null;
}

// A page in the app, never another site: "/tasks?task=…", not "//example.com".
const link = z.object({ step: z.number().int().min(0), title: z.string(), href: z.string().regex(/^\/(?![/\\])/) });

/** The links stored with an applied proposal; none when they can't be read. */
export function storedLinks(value: unknown): ProposalLink[] {
  const parsed = z.array(link).max(MAX_PROPOSAL_STEPS).safeParse(value);
  return parsed.success ? parsed.data : [];
}

export const PROPOSAL_SELECT = { id: true, status: true, steps: true, applied: true, links: true, expiresAt: true, error: true } as const;

export type StoredProposalRow = {
  id: string;
  status: StoredProposalStatus;
  steps: Prisma.JsonValue;
  applied: number[];
  links: Prisma.JsonValue;
  expiresAt: Date;
  error: string | null;
};

/** A stored proposal as the chat shows it; null when its steps can't be read. */
export function proposalView(row: StoredProposalRow, now = new Date()): ProposalView | null {
  const steps = storedSteps(row.steps);
  if (!steps) return null;
  return {
    id: row.id,
    state: proposalState(row.status, row.expiresAt, now),
    expiresAt: row.expiresAt.toISOString(),
    steps,
    applied: row.applied.filter((index) => index >= 0 && index < steps.length),
    links: storedLinks(row.links),
    error: row.error,
  };
}

const CHOOSE_CHANGES = "Choose which changes to apply.";
const applyRequest = z.strictObject({ steps: z.array(z.number().int()).max(MAX_PROPOSAL_STEPS).optional() });

/**
 * What Apply was asked to apply: `{ "steps": [0, 2] }` names the steps the person ticked, by
 * index; no body, or no `steps`, means all of them (null). Whether those steps can go alone is
 * checked against the proposal (choiceProblem in ./proposals.ts).
 */
export function parseApplyRequest(raw: string): { ok: true; steps: number[] | null } | { ok: false; error: string } {
  if (!raw.trim()) return { ok: true, steps: null };
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return { ok: false, error: CHOOSE_CHANGES };
  }
  const parsed = applyRequest.safeParse(body);
  return parsed.success ? { ok: true, steps: parsed.data.steps ?? null } : { ok: false, error: CHOOSE_CHANGES };
}

/** What the person is told when the app's rules refuse a step: nothing changed, and why, in plain words. */
export function refusalMessage(step: ProposalStep, refusal: { status: number; error: string }) {
  const title = `“${stepTitle(step)}”`;
  if (refusal.status === 404) return `Nothing was changed: ${title} isn't there any more.`;
  if (refusal.status === 403) return `Nothing was changed: you can no longer make changes in the project for ${title}.`;
  return `Nothing was changed: ${title} couldn't be saved (${refusal.error.replace(/\.$/, "")}).`;
}

/** A task's fields as they are when a proposal is applied, which its change starts from. */
export type CurrentTask = Omit<TaskUpdateData, "description" | "labelIds"> & { description: string | null };

type TaskStep = Extract<ProposalStep, { kind: "update_task" | "complete_task" }>;

/**
 * What a change to a task hands updateTask, which replaces every field as the task's edit form
 * does: the task as it is now, with only the fields the step names changed. `idOf` gives a
 * project's id, also for one the proposal creates. A task that moves to another project loses its
 * assignee, a member of the old one. Labels are left out, so they stay.
 */
export function taskUpdateInput(current: CurrentTask, step: TaskStep, idOf: (item: ItemRef | null) => string | null): TaskUpdateData {
  const input: TaskUpdateData = { ...current, description: current.description ?? "" };
  if (step.kind === "complete_task") return { ...input, status: "DONE" };
  for (const change of step.changes) {
    switch (change.field) {
      case "title":
        input.title = change.to;
        break;
      case "description":
        input.description = change.to ?? "";
        break;
      case "dueDate":
        input.dueDate = change.to ? parseTaskDueDateForStorage(change.to) : null;
        break;
      case "priority":
        input.priority = change.to;
        break;
      case "status":
        input.status = change.to;
        break;
      case "project":
        input.projectId = idOf(change.to);
        input.assigneeId = null;
        break;
    }
  }
  return input;
}
