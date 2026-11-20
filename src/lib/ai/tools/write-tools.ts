// The AI assistant's write tools (#310). None of them changes anything. Each one looks up what the
// change needs, seeing exactly what the read tools see, and adds a step to the answer's proposal
// (`ToolContext.draft`). The chat shows the whole proposal as one card, and only the person can
// apply it there, where the app's own rules run again, all in one transaction
// (src/lib/ai/proposals-server.ts). When a request names an item that several match, or none, the
// tool proposes nothing and says so, and the model asks the person instead of guessing.
import { z } from "zod";
import {
  MAX_PROPOSAL_STEPS,
  takeRef,
  type ExistingTask,
  type ItemRef,
  type ProposalDraft,
  type ProposalStep,
  type TaskChange,
  type TaskStatus,
} from "@/lib/ai/proposals";
import { defineTool, type ToolContext, type ToolOutput } from "@/lib/ai/tools/define";
import { dayKey } from "@/lib/ai/tools/read-tools";
import { parseEventTimes } from "@/lib/event-time";
import { PRIORITIES, type Priority } from "@/lib/priority";
import { projectAccessWhere } from "@/lib/project-access-core";
import { formatTaskDayKey } from "@/lib/task-date-buckets";
import { visibleTaskWhere } from "@/lib/task-include";

/** Items read to find the one a request names. */
const MATCH_SCAN = 50;
/** Matches listed when several fit, for the model to ask which one. */
const SHOWN_MATCHES = 5;
const TITLE_MAX = 200;
const NAME_MAX = 100;
const TEXT_MAX = 2000;
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

const reference = (what: string) => z.string().trim().min(1).max(TITLE_MAX).describe(what);
const clock = (description: string) =>
  z
    .string()
    .refine((value) => CLOCK.test(value), "Use a 24-hour time written HH:MM.")
    .describe(description);

const TASK_SELECT = {
  id: true,
  title: true,
  description: true,
  status: true,
  priority: true,
  dueDate: true,
  parentId: true,
  projectId: true,
  project: { select: { id: true, name: true } },
} as const;

type TaskRow = {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: Priority;
  dueDate: Date | null;
  parentId: string | null;
  projectId: string | null;
  project: { id: string; name: string } | null;
};

/** What a tool tells the model when it proposed nothing, and why. */
function notProposed(reason: string, extra: Record<string, unknown> = {}): ToolOutput {
  return { data: { proposed: null, reason, ...extra }, sources: [] };
}

/** The step added, as the model reads it back. */
function proposed(draft: ProposalDraft, step: ProposalStep, summary: string): ToolOutput {
  draft.steps.push(step);
  const ref = "ref" in step ? { ref: step.ref } : {};
  return { data: { proposed: summary, ...ref, proposedSoFar: draft.steps.length }, sources: [] };
}

type Found<Item> = { item: Item; problem?: undefined } | { problem: ToolOutput; item?: undefined };

/** The answer's draft, or why nothing can be proposed: none (a lookup outside a chat), or it's full. */
function draftFor(context: ToolContext): { draft: ProposalDraft; problem?: undefined } | { problem: ToolOutput; draft?: undefined } {
  if (!context.draft) return { problem: notProposed("Changes can't be proposed here.") };
  if (context.draft.steps.length >= MAX_PROPOSAL_STEPS) {
    return { problem: notProposed(`One answer can propose at most ${MAX_PROPOSAL_STEPS} changes; this one has that many already.`) };
  }
  return { draft: context.draft };
}

/**
 * The one item `wanted` names among `rows`: its id, else the only title that matches exactly
 * (ignoring case), else the only one containing it. Several, or none: why nothing was proposed.
 */
function pickOne<Row extends { id: string }>(
  rows: Row[],
  wanted: string,
  label: (row: Row) => string,
  describe: (row: Row) => Record<string, unknown>,
  noun: string,
): Found<Row> {
  const byId = rows.find((row) => row.id === wanted);
  if (byId) return { item: byId };
  const key = wanted.toLowerCase();
  const exact = rows.filter((row) => label(row).trim().toLowerCase() === key);
  const matches = exact.length ? exact : rows;
  if (matches.length === 1) return { item: matches[0] };
  if (!matches.length) return { problem: notProposed(`No ${noun} the person can change matches "${wanted}".`) };
  return {
    problem: notProposed(`${matches.length} ${noun}s match "${wanted}", so it isn't clear which one is meant.`, {
      matches: matches.slice(0, SHOWN_MATCHES).map(describe),
    }),
  };
}

function describeTask(task: TaskRow) {
  return {
    title: task.title,
    status: task.status,
    ...(task.project ? { project: task.project.name } : {}),
    ...(task.dueDate ? { due: formatTaskDayKey(task.dueDate) } : {}),
  };
}

/** The person's task that `wanted` names (its id or title), among those they can see and change. */
async function findTask(wanted: string, context: ToolContext, filter: (task: TaskRow) => boolean = () => true): Promise<Found<TaskRow>> {
  const rows = (await context.db.task.findMany({
    where: { AND: [visibleTaskWhere(context.userId), { OR: [{ id: wanted }, { title: { contains: wanted, mode: "insensitive" } }] }] },
    orderBy: [{ updatedAt: "desc" }],
    take: MATCH_SCAN,
    select: TASK_SELECT,
  })) as TaskRow[];
  return pickOne(rows.filter(filter), wanted, (task) => task.title, describeTask, "task");
}

/** A project for a new item: one this answer creates (its ref or name), or one of the person's. */
async function findProject(wanted: string, context: ToolContext, draft: ProposalDraft): Promise<Found<ItemRef>> {
  const key = wanted.toLowerCase();
  const created = draft.steps.flatMap((step) => (step.kind === "create_project" ? [step] : []));
  const fresh = created.find((step) => step.ref === wanted) ?? created.find((step) => step.name.trim().toLowerCase() === key);
  if (fresh) return { item: { ref: fresh.ref, name: fresh.name } };

  const rows = await context.db.project.findMany({
    where: { AND: [projectAccessWhere(context.userId), { OR: [{ id: wanted }, { name: { contains: wanted, mode: "insensitive" } }] }] },
    orderBy: [{ updatedAt: "desc" }],
    take: MATCH_SCAN,
    select: { id: true, name: true },
  });
  const found = pickOne(rows, wanted, (project) => project.name, (project) => ({ name: project.name }), "project");
  return found.item ? { item: { id: found.item.id, name: found.item.name } } : found;
}

/** A parent for a new subtask: a task this answer creates, or one of the person's that isn't a subtask itself. */
async function findParent(
  wanted: string,
  context: ToolContext,
  draft: ProposalDraft,
): Promise<{ parent: ItemRef; project: ItemRef | null; problem?: undefined } | { problem: ToolOutput }> {
  const key = wanted.toLowerCase();
  const created = draft.steps.flatMap((step) => (step.kind === "create_task" ? [step] : []));
  const fresh = created.find((step) => step.ref === wanted) ?? created.find((step) => step.title.trim().toLowerCase() === key);
  if (fresh) {
    if (fresh.parent) return { problem: notProposed(`"${fresh.title}" is a subtask, and subtasks can't have their own subtasks.`) };
    return { parent: { ref: fresh.ref, name: fresh.title }, project: fresh.project };
  }
  const found = await findTask(wanted, context);
  if (found.problem) return { problem: found.problem };
  const task = found.item;
  if (task.parentId) return { problem: notProposed(`"${task.title}" is a subtask, and subtasks can't have their own subtasks.`) };
  return { parent: { id: task.id, name: task.title }, project: task.project ? { id: task.project.id, name: task.project.name } : null };
}

/** The task as the card shows it: where it is and when it's due, as when the change was proposed. */
function existing(task: TaskRow): ExistingTask {
  return { id: task.id, name: task.title, project: task.project?.name ?? null, dueDate: task.dueDate ? formatTaskDayKey(task.dueDate) : null };
}

const FIELD_NAMES: Record<TaskChange["field"], string> = {
  title: "title",
  description: "description",
  dueDate: "due date",
  priority: "priority",
  status: "status",
  project: "project",
};

/** "due date 2026-11-19 to 2026-11-23", as the model reads it back; long text cut short. */
function describeChange(change: TaskChange) {
  const value = (side: TaskChange["from"] | TaskChange["to"]) => {
    const text = side === null ? "none" : typeof side === "object" ? side.name : side;
    return text.length > 80 ? `${text.slice(0, 79)}…` : text;
  };
  return `${FIELD_NAMES[change.field]} ${value(change.from)} to ${value(change.to)}`;
}

const priorityInput = z.enum(PRIORITIES.filter((priority) => priority !== "NONE") as ["URGENT", "HIGH", "MEDIUM", "LOW"]);

export const createProject = defineTool({
  name: "create_project",
  label: "Preparing a new project",
  description:
    "Proposes a new project. Nothing changes until the person applies the proposal in the app. Returns a ref, such as new-1, that create_task and create_event take as the project of items that go in it.",
  input: z.strictObject({
    name: z.string().trim().min(1).max(NAME_MAX).describe("The project's name."),
    description: z.string().trim().max(TEXT_MAX).optional().describe("What the project is for, when the person said."),
  }),
  access: "propose",
  // So tasks and events proposed in the same breath find the new project by its name.
  runsFirst: true,
  async run({ name, description }, context) {
    const { draft, problem } = draftFor(context);
    if (problem) return problem;
    return proposed(draft, { kind: "create_project", ref: takeRef(draft), name, description: description || null }, `New project "${name}"`);
  },
});

export const createTask = defineTool({
  name: "create_task",
  label: "Preparing a new task",
  description:
    "Proposes a new task, or a subtask under a parent task. Nothing changes until the person applies the proposal in the app. Returns a ref that later calls can use as a parent.",
  input: z.strictObject({
    title: z.string().trim().min(1).max(TITLE_MAX).describe("The task's title."),
    description: z.string().trim().max(TEXT_MAX).optional().describe("Details, when the person gave some."),
    dueDate: dayKey("When it's due, YYYY-MM-DD.").optional(),
    priority: priorityInput.optional().describe("Only when the person asked for one."),
    project: z
      .string()
      .trim()
      .min(1)
      .max(NAME_MAX)
      .optional()
      .describe("The project it goes in: the name or id of one of the person's projects, or the ref create_project returned."),
    parent: reference("To make it a subtask: the parent task's title or id, or the ref create_task returned for a new one.").optional(),
  }),
  access: "propose",
  async run({ title, description, dueDate, priority, project, parent }, context) {
    const { draft, problem } = draftFor(context);
    if (problem) return problem;

    let projectRef: ItemRef | null = null;
    let parentRef: ItemRef | null = null;
    if (parent) {
      // A subtask goes in its parent's project, as in the app (SMART-02).
      const found = await findParent(parent, context, draft);
      if (found.problem) return found.problem;
      parentRef = found.parent;
      projectRef = found.project;
    } else if (project) {
      const found = await findProject(project, context, draft);
      if (found.problem) return found.problem;
      projectRef = found.item;
    }

    const step: ProposalStep = {
      kind: "create_task",
      ref: takeRef(draft),
      title,
      description: description || null,
      dueDate: dueDate ?? null,
      priority: priority ?? "NONE",
      project: projectRef,
      parent: parentRef,
    };
    const where = parentRef ? ` under "${parentRef.name}"` : projectRef ? ` in "${projectRef.name}"` : "";
    return proposed(draft, step, `New ${parentRef ? "subtask" : "task"} "${title}"${where}`);
  },
});

export const updateTask = defineTool({
  name: "update_task",
  label: "Preparing a change",
  description:
    "Proposes changes to one of the person's tasks: its title, description, due date, priority, status or project. Nothing changes until the person applies the proposal in the app. Give only the fields to change.",
  input: z.strictObject({
    task: reference("The task: its title, or its id from list_open_tasks."),
    title: z.string().trim().min(1).max(TITLE_MAX).optional().describe("A new title."),
    description: z.string().trim().max(TEXT_MAX).optional().describe("A new description; an empty one removes it."),
    dueDate: dayKey("A new due date, YYYY-MM-DD.").optional(),
    clearDueDate: z.boolean().optional().describe("true to remove the due date."),
    priority: z.enum(PRIORITIES).optional().describe("A new priority; NONE removes it."),
    status: z.enum(["TODO", "IN_PROGRESS", "DONE"]).optional().describe("A new status."),
    project: z
      .string()
      .trim()
      .min(1)
      .max(NAME_MAX)
      .optional()
      .describe("Moves it to this project: the name or id of one of the person's projects, or the ref create_project returned."),
  }),
  access: "propose",
  async run(args, context) {
    const { draft, problem } = draftFor(context);
    if (problem) return problem;
    const found = await findTask(args.task, context);
    if (found.problem) return found.problem;
    const task = found.item;

    const changes: TaskChange[] = [];
    if (args.title !== undefined && args.title !== task.title) changes.push({ field: "title", from: task.title, to: args.title });
    if (args.description !== undefined && (args.description || null) !== task.description) {
      changes.push({ field: "description", from: task.description, to: args.description || null });
    }
    const due = task.dueDate ? formatTaskDayKey(task.dueDate) : null;
    const newDue = args.dueDate ?? (args.clearDueDate ? null : due);
    if (newDue !== due) changes.push({ field: "dueDate", from: due, to: newDue });
    if (args.priority !== undefined && args.priority !== task.priority) changes.push({ field: "priority", from: task.priority, to: args.priority });
    if (args.status !== undefined && args.status !== task.status) changes.push({ field: "status", from: task.status, to: args.status });
    if (args.project !== undefined) {
      if (task.parentId) return notProposed(`"${task.title}" is a subtask, so it stays in its parent's project.`);
      const target = await findProject(args.project, context, draft);
      if (target.problem) return target.problem;
      const sameProject = "id" in target.item && target.item.id === task.projectId;
      if (!sameProject) changes.push({ field: "project", from: task.project ? { id: task.project.id, name: task.project.name } : null, to: target.item });
    }
    if (!changes.length) return notProposed(`"${task.title}" already looks like that, so there's nothing to change.`);

    return proposed(draft, { kind: "update_task", task: existing(task), changes }, `Change "${task.title}": ${changes.map(describeChange).join("; ")}`);
  },
});

export const completeTask = defineTool({
  name: "complete_task",
  label: "Preparing to mark a task done",
  description: "Proposes marking one of the person's open tasks as done. Nothing changes until the person applies the proposal in the app.",
  input: z.strictObject({ task: reference("The task: its title, or its id from list_open_tasks.") }),
  access: "propose",
  async run({ task: wanted }, context) {
    const { draft, problem } = draftFor(context);
    if (problem) return problem;
    // Open tasks first: "the report" means the one still to do, if any is.
    const open = await findTask(wanted, context, (task) => task.status !== "DONE");
    if (open.item) return proposed(draft, { kind: "complete_task", task: existing(open.item) }, `Mark "${open.item.title}" as done`);
    const any = await findTask(wanted, context);
    if (any.item) return notProposed(`"${any.item.title}" is already done.`);
    return open.problem;
  },
});

export const createEvent = defineTool({
  name: "create_event",
  label: "Preparing a new event",
  description:
    "Proposes a calendar event, such as a meeting or a deadline. Without a start time it lasts all day. Nothing changes until the person applies the proposal in the app.",
  input: z.strictObject({
    title: z.string().trim().min(1).max(TITLE_MAX).describe("The event's title."),
    date: dayKey("The day it happens, YYYY-MM-DD."),
    startTime: clock("When it starts, HH:MM in 24-hour time, in the person's time zone. Leave out for an all-day event.").optional(),
    endTime: clock("When it ends, HH:MM in 24-hour time, on the same day.").optional(),
    description: z.string().trim().max(TEXT_MAX).optional().describe("Details, when the person gave some."),
    project: z
      .string()
      .trim()
      .min(1)
      .max(NAME_MAX)
      .optional()
      .describe("The project it belongs to: the name or id of one of the person's projects, or the ref create_project returned."),
  }),
  access: "propose",
  async run({ title, date, startTime, endTime, description, project }, context) {
    const { draft, problem } = draftFor(context);
    if (problem) return problem;
    if (endTime && !startTime) return notProposed("An end time needs a start time.");
    // The same checks as the event form's (src/lib/event-time.ts).
    const times = parseEventTimes({ startDate: date, startTime: startTime ?? null, endDate: null, endTime: endTime ?? null });
    if (times.error !== undefined) return notProposed(times.error);

    let projectRef: ItemRef | null = null;
    if (project) {
      const found = await findProject(project, context, draft);
      if (found.problem) return found.problem;
      projectRef = found.item;
    }
    const step: ProposalStep = {
      kind: "create_event",
      ref: takeRef(draft),
      title,
      date,
      startTime: startTime ?? null,
      endTime: endTime ?? null,
      description: description || null,
      project: projectRef,
    };
    return proposed(draft, step, `New event "${title}" on ${date}${startTime ? ` at ${startTime}` : ", all day"}`);
  },
});

export const trashTask = defineTool({
  name: "trash_task",
  label: "Preparing to move a task to the Trash",
  description:
    "Proposes moving one of the person's tasks to the Trash, where they can restore it. Call it once per task. Nothing changes until the person applies the proposal in the app.",
  input: z.strictObject({ task: reference("The task: its title, or its id from list_open_tasks.") }),
  access: "propose",
  async run({ task: wanted }, context) {
    const { draft, problem } = draftFor(context);
    if (problem) return problem;
    const found = await findTask(wanted, context);
    if (found.problem) return found.problem;
    if (draft.steps.some((step) => step.kind === "trash_task" && step.task.id === found.item.id)) {
      return notProposed(`"${found.item.title}" is already in this proposal.`);
    }
    return proposed(draft, { kind: "trash_task", task: existing(found.item) }, `Move "${found.item.title}" to the Trash`);
  },
});

export const WRITE_TOOLS = [createProject, createTask, updateTask, completeTask, createEvent, trashTask];
