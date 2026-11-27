// The write tools of AI apps connected over MCP (#479). Unlike the in-app assistant's "propose"
// tools (write-tools.ts), each one plans and applies its change in one call: the app's own approval
// prompt is the person's confirmation. A tool first looks up what the change names, seeing exactly
// what the read tools see, then makes it through the app's shared write functions in one transaction
// (`ToolContext.writer`, src/lib/mcp/writes-server.ts), so the pages' access rules and project roles
// apply, and Activity and the task's history say which app made it.
//
// With no card to review in between, an item is named by its id or its exact title, never a part of
// it: when several fit, or none fits exactly, nothing changes, and the answer lists the closest ones
// with their ids. Deleting moves an item to the Trash, where it can be restored; nothing is deleted
// for good. The in-app assistant never gets these tools.
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { defineTool, optionalArgument, type Source, type ToolContext, type ToolOutput } from "@/lib/ai/tools/define";
import { dayKey } from "@/lib/ai/tools/read-tools";
import type { ToolWriter, WrittenItem } from "@/lib/ai/tools/writer";
import { parseEventCreateBody, parseEventUpdateBody } from "@/lib/event-fields";
import { eventTimeInputValue } from "@/lib/event-time";
import { LABELS_PER_TASK_MAX } from "@/lib/labels";
import { visibleEventWhere, visibleNoteWhere } from "@/lib/note-access";
import { PRIORITIES, priorityLabels, type Priority } from "@/lib/priority";
import { projectAccessWhere } from "@/lib/project-access-core";
import { describeRepeat, RECURRENCE_VALUES } from "@/lib/recurrence";
import { TASK_STATUSES, type TaskCreateData, type TaskUpdateData } from "@/lib/schemas/task";
import { formatTaskDayKey, parseTaskDueDateForStorage } from "@/lib/task-date-buckets";
import { cleanComment, COMMENT_MAX, STATUS_WORDS } from "@/lib/task-history";
import { visibleTaskWhere } from "@/lib/task-include";
import type { WriteRefusal } from "@/lib/writes";

/** Items read whose id or exact title is the one asked for. */
const MATCH_SCAN = 25;
/** Close matches listed when none, or several, fit exactly. */
const SHOWN_MATCHES = 5;
/** Labels or members listed when one asked for isn't there. */
const SHOWN_CHOICES = 20;
const TITLE_MAX = 500;
const NAME_MAX = 100;
const TEXT_MAX = 10_000;
/** How long a note can grow by appending: beyond it, the person edits the note in the app. */
const NOTE_CONTENT_MAX = 100_000;
const URL_MAX = 2_000;
/** Tasks one create_tasks call can add. */
export const MAX_NEW_TASKS = 25;
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

const clock = () => z.string().refine((value) => CLOCK.test(value), "Use a 24-hour time written HH:MM.");
const itemRef = (noun: string, lister: string) =>
  z.string().trim().min(1).max(TITLE_MAX).describe(`The ${noun}: its id from ${lister}, or its exact title.`);
const projectRef = (what: string) =>
  optionalArgument(z.string().trim().max(NAME_MAX)).describe(`${what}: the id or exact name of one of the person's projects, from list_projects.`);
const priorityInput = z.enum(PRIORITIES.filter((priority) => priority !== "NONE") as ["URGENT", "HIGH", "MEDIUM", "LOW"]);
const REPEATS = RECURRENCE_VALUES.filter((value) => value !== "NONE") as ["DAILY", "WEEKLY", "BIWEEKLY", "MONTHLY"];

function isWebAddress(value: string) {
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && url.hostname.length > 0;
  } catch {
    return false;
  }
}

/** A full http or https address, kept in one spelling (new URL's) so the same link always matches. */
const webAddress = z
  .string()
  .trim()
  .max(URL_MAX)
  .refine(isWebAddress, "Use a full web address that starts with https:// or http://.")
  .transform((value) => new URL(value).href);

/** Nothing changed, and why. AI apps get it as an error result. */
function refused(reason: string, extra: Record<string, unknown> = {}): ToolOutput {
  return { data: { changed: null, reason, ...extra }, sources: [], refused: true };
}

/** Nothing needed changing: the item already looks like that. */
function unchanged(reason: string, sources: Source[] = []): ToolOutput {
  return { data: { changed: null, reason }, sources };
}

/** What changed, named, with each item's id for later calls and a link to it in AI Multi. */
function changed(summary: string, items: Source[], extra: Record<string, unknown> = {}): ToolOutput {
  return { data: { changed: summary, items: items.map(({ kind, id, title }) => ({ kind, id, title })), ...extra }, sources: items };
}

/** The same refusal, about one item of several: "Task 2 (“Draft”): …". */
function about(problem: ToolOutput, which: string): ToolOutput {
  const data = problem.data as { reason: string };
  return { ...problem, data: { ...data, reason: `${which}: ${data.reason}` } };
}

/** The app's refusal of a write, as the AI app reads it. Nothing was changed: the transaction rolled back. */
function refusedBy(refusal: WriteRefusal, what: string): ToolOutput {
  const why = refusal.error.replace(/\.$/, "");
  if (refusal.status === 404) return refused(`Nothing was changed: ${what} isn't there any more.`);
  if (refusal.status === 403) return refused(`Nothing was changed: the person can't make this change (${why}).`);
  if (refusal.status === 429) return refused(`Nothing was changed: ${why}.`);
  return refused(`Nothing was changed: AI Multi refused it (${why}).`);
}

const NOT_ALLOWED = refused(
  "Nothing was changed: the person didn't allow this app to make changes in AI Multi. They can connect it again with changes allowed.",
);

/** The writer, when the person allowed this app to make changes. */
function writerOf(context: ToolContext): ToolWriter | null {
  return context.writer ?? null;
}

const quoted = (text: string) => `“${text.length > 80 ? `${text.slice(0, 79)}…` : text}”`;
const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

const links = {
  task: (item: WrittenItem): Source => ({ kind: "task", id: item.id, title: item.title, href: `/tasks/${encodeURIComponent(item.id)}` }),
  event: (item: WrittenItem): Source => ({ kind: "event", id: item.id, title: item.title, href: `/events?event=${encodeURIComponent(item.id)}` }),
  note: (item: WrittenItem): Source => ({ kind: "note", id: item.id, title: item.title, href: `/notes?openNote=${encodeURIComponent(item.id)}` }),
  project: (item: { id: string; name: string }): Source => ({ kind: "project", id: item.id, title: item.name, href: `/projects/${encodeURIComponent(item.id)}` }),
  /** An item in the Trash, which the Trash page lists. */
  trashed: (kind: "task" | "event" | "note", item: WrittenItem): Source => ({ kind, id: item.id, title: item.title, href: "/trash" }),
};

type Found<Item> = { item: Item; problem?: undefined } | { problem: ToolOutput; item?: undefined };

/**
 * The one item `wanted` names: the row with that id, else the only one with that exact title,
 * ignoring case. `named` holds the rows whose id or title is `wanted`; `close` finds rows whose
 * title contains it, listed with their ids when nothing fits exactly.
 */
async function choose<Row extends { id: string }>(
  wanted: string,
  named: Row[],
  close: () => Promise<Row[]>,
  { noun, label, describe }: { noun: string; label: (row: Row) => string; describe: (row: Row) => Record<string, unknown> },
): Promise<Found<Row>> {
  const byId = named.find((row) => row.id === wanted);
  if (byId) return { item: byId };
  const key = wanted.trim().toLowerCase();
  const exact = named.filter((row) => label(row).trim().toLowerCase() === key);
  if (exact.length === 1) return { item: exact[0] };
  const listed = (rows: Row[]) => rows.slice(0, SHOWN_MATCHES).map((row) => ({ id: row.id, ...describe(row) }));
  if (exact.length > 1) {
    return {
      problem: refused(`${exact.length} ${noun}s are called "${wanted}", so it isn't clear which one is meant. Nothing was changed: ask the person, or call again with the id of the one they mean.`, {
        matches: listed(exact),
      }),
    };
  }
  const nearby = await close();
  if (nearby.length) {
    return {
      problem: refused(`No ${noun} is called exactly "${wanted}". Nothing was changed: if the person means one of these, call again with its id.`, {
        matches: listed(nearby),
      }),
    };
  }
  return { problem: refused(`No ${noun} the person can see is called "${wanted}". Nothing was changed.`) };
}

const TASK_SELECT = {
  id: true,
  title: true,
  description: true,
  status: true,
  priority: true,
  dueDate: true,
  recurrence: true,
  userId: true,
  projectId: true,
  parentId: true,
  assigneeId: true,
  project: { select: { id: true, name: true } },
  assignee: { select: { id: true, name: true } },
  labels: { select: { label: { select: { id: true, name: true } } } },
} satisfies Prisma.TaskSelect;

type TaskRow = Prisma.TaskGetPayload<{ select: typeof TASK_SELECT }>;

const describeTask = (task: TaskRow) => ({
  title: task.title,
  status: task.status,
  ...(task.project ? { project: task.project.name } : {}),
  ...(task.dueDate ? { due: formatTaskDayKey(task.dueDate) } : {}),
});

/** A task the person can see, by id or exact title; `only` narrows it, such as to open tasks. */
async function findTask(wanted: string, context: ToolContext, only: Prisma.TaskWhereInput = {}): Promise<Found<TaskRow>> {
  const visible: Prisma.TaskWhereInput = { AND: [visibleTaskWhere(context.userId), only] };
  const find = (match: Prisma.TaskWhereInput, take: number) =>
    context.db.task.findMany({ where: { AND: [visible, match] }, orderBy: [{ updatedAt: "desc" }], take, select: TASK_SELECT });
  const named = await find({ OR: [{ id: wanted }, { title: { equals: wanted, mode: "insensitive" } }] }, MATCH_SCAN);
  return choose(wanted, named, () => find({ title: { contains: wanted, mode: "insensitive" } }, SHOWN_MATCHES), {
    noun: "task",
    label: (task) => task.title,
    describe: describeTask,
  });
}

type ProjectRow = { id: string; name: string };

/** One of the person's projects, by id or exact name. */
async function findProject(wanted: string, context: ToolContext): Promise<Found<ProjectRow>> {
  const find = (match: Prisma.ProjectWhereInput, take: number) =>
    context.db.project.findMany({
      where: { AND: [projectAccessWhere(context.userId), match] },
      orderBy: [{ updatedAt: "desc" }],
      take,
      select: { id: true, name: true },
    });
  const named = await find({ OR: [{ id: wanted }, { name: { equals: wanted, mode: "insensitive" } }] }, MATCH_SCAN);
  return choose(wanted, named, () => find({ name: { contains: wanted, mode: "insensitive" } }, SHOWN_MATCHES), {
    noun: "project",
    label: (project) => project.name,
    describe: (project) => ({ name: project.name }),
  });
}

const EVENT_SELECT = {
  id: true,
  title: true,
  description: true,
  location: true,
  startTime: true,
  endTime: true,
  hasStartTime: true,
  hasEndTime: true,
  recurrence: true,
  repeatUntil: true,
  projectId: true,
  project: { select: { id: true, name: true } },
} satisfies Prisma.EventSelect;

type EventRow = Prisma.EventGetPayload<{ select: typeof EVENT_SELECT }>;

/** A stored wall-clock time's day, `YYYY-MM-DD` (src/lib/event-time.ts). */
const storedDay = (value: Date) => value.toISOString().slice(0, 10);

/** One of the person's events, by id or exact title. A repeating event is one item. */
async function findEvent(wanted: string, context: ToolContext): Promise<Found<EventRow>> {
  const find = (match: Prisma.EventWhereInput, take: number) =>
    context.db.event.findMany({ where: { AND: [visibleEventWhere(context.userId), match] }, orderBy: [{ startTime: "asc" }], take, select: EVENT_SELECT });
  const named = await find({ OR: [{ id: wanted }, { title: { equals: wanted, mode: "insensitive" } }] }, MATCH_SCAN);
  return choose(wanted, named, () => find({ title: { contains: wanted, mode: "insensitive" } }, SHOWN_MATCHES), {
    noun: "event",
    label: (event) => event.title,
    describe: (event) => ({
      title: event.title,
      date: storedDay(event.startTime),
      ...(event.hasStartTime ? { time: eventTimeInputValue(event.startTime) } : {}),
      ...(event.recurrence !== "NONE" ? { repeats: event.recurrence.toLowerCase() } : {}),
      ...(event.project ? { project: event.project.name } : {}),
    }),
  });
}

const NOTE_SELECT = { id: true, title: true, content: true, projectId: true, project: { select: { id: true, name: true } } } satisfies Prisma.NoteSelect;

type NoteRow = Prisma.NoteGetPayload<{ select: typeof NOTE_SELECT }>;

const noteTitle = (note: { title: string }) => note.title || "Untitled note";

/** One of the person's notes, by id or exact title. A note without a title has only its id. */
async function findNote(wanted: string, context: ToolContext): Promise<Found<NoteRow>> {
  const find = (match: Prisma.NoteWhereInput, take: number) =>
    context.db.note.findMany({ where: { AND: [visibleNoteWhere(context.userId), match] }, orderBy: [{ updatedAt: "desc" }], take, select: NOTE_SELECT });
  const named = await find({ OR: [{ id: wanted }, { title: { equals: wanted, mode: "insensitive" } }] }, MATCH_SCAN);
  return choose(wanted, named, () => find({ title: { contains: wanted, mode: "insensitive" } }, SHOWN_MATCHES), {
    noun: "note",
    label: (note) => note.title,
    describe: (note) => ({ title: noteTitle(note), ...(note.project ? { project: note.project.name } : {}) }),
  });
}

/** A member of the project, by their name as the project shows it, or "me" for the person. */
async function findMember(wanted: string, projectId: string, projectName: string, context: ToolContext): Promise<Found<{ id: string; name: string }>> {
  const members = await context.db.projectMember.findMany({
    where: { projectId },
    orderBy: [{ name: "asc" }],
    take: 200,
    select: { id: true, name: true, userId: true },
  });
  const key = wanted.trim().toLowerCase();
  const matches = key === "me" ? members.filter((member) => member.userId === context.userId) : members.filter((member) => member.id === wanted || member.name.trim().toLowerCase() === key);
  if (matches.length === 1) return { item: { id: matches[0].id, name: matches[0].name } };
  const names = members.slice(0, SHOWN_CHOICES).map((member) => member.name);
  if (matches.length > 1) {
    return { problem: refused(`${matches.length} members of ${quoted(projectName)} are called "${wanted}". Nothing was changed: ask the person which one they mean.`) };
  }
  return { problem: refused(`No member of ${quoted(projectName)} is called "${wanted}". Nothing was changed.`, { members: names }) };
}

/** The labels `names` names, among the project's labels for a project task, or the owner's own for theirs. */
async function findLabels(names: string[], scope: { projectId: string; projectName: string } | { userId: string }, context: ToolContext): Promise<Found<Array<{ id: string; name: string }>>> {
  const labels = await context.db.label.findMany({
    where: "projectId" in scope ? { projectId: scope.projectId } : { userId: scope.userId, projectId: null },
    orderBy: [{ name: "asc" }],
    take: 200,
    select: { id: true, name: true },
  });
  const byName = new Map(labels.map((label) => [label.name.trim().toLowerCase(), label]));
  const missing = names.filter((name) => !byName.has(name.trim().toLowerCase()));
  if (missing.length) {
    const where = "projectId" in scope ? `${quoted(scope.projectName)}` : "the person's own labels";
    return {
      problem: refused(`${missing.map((name) => `"${name}"`).join(", ")} ${missing.length === 1 ? "isn't a label" : "aren't labels"} in ${where}. Nothing was changed: labels are added in the app.`, {
        labels: labels.slice(0, SHOWN_CHOICES).map((label) => label.name),
      }),
    };
  }
  const chosen = new Map(names.map((name) => byName.get(name.trim().toLowerCase())!).map((label) => [label.id, label]));
  return { item: [...chosen.values()] };
}

/** The task's fields as they are, which a change starts from: updateTask replaces all of them, as the task's edit form does. */
function currentTask(task: TaskRow): TaskUpdateData {
  return {
    title: task.title,
    status: task.status,
    priority: task.priority,
    recurrence: task.recurrence,
    dueDate: task.dueDate,
    description: task.description ?? "",
    projectId: task.projectId,
    assigneeId: task.assigneeId,
  };
}

const newTaskInput = z.strictObject({
  title: z.string().trim().min(1).max(TITLE_MAX).describe("The task's title."),
  description: optionalArgument(z.string().trim().max(TEXT_MAX)).describe("Details, when the person gave some."),
  dueDate: optionalArgument(dayKey()).describe("When it's due, YYYY-MM-DD."),
  priority: optionalArgument(priorityInput).describe("Only when the person asked for one."),
  project: projectRef("The project it goes in. Leave it out for a task of the person's own"),
  parent: optionalArgument(z.string().trim().max(TITLE_MAX)).describe(
    "To make it a subtask: the id or exact title of its parent task, which can't be a subtask itself. A subtask goes in its parent's project.",
  ),
  sourceUrl: optionalArgument(webAddress).describe(
    "The web address the task comes from, such as a pull request's. When a task in the same project already has it, this one is skipped, so asking again makes no duplicates.",
  ),
});

type PlannedTask = { input: TaskCreateData; sourceUrl?: string; projectName: string | null };

export const createTasks = defineTool({
  name: "create_tasks",
  label: "Creating tasks",
  title: "Create tasks",
  description:
    "Creates 1 to 25 tasks in AI Multi for the person, each in one of their projects or as their own, or as a subtask. Give each task that comes from a web page, such as a pull request or an issue, its sourceUrl: a task whose address already has a task in the same project is skipped and reported, so running the same request twice adds nothing. If any task's project or parent can't be found, nothing is created. Returns each new task's id and link.",
  input: z.strictObject({ tasks: z.array(newTaskInput).min(1).max(MAX_NEW_TASKS).describe("The tasks to create, in order.") }),
  access: "write",
  writeHints: { destructive: false, idempotent: false },
  async run({ tasks }, context) {
    const writer = writerOf(context);
    if (!writer) return NOT_ALLOWED;

    // Every task's project or parent first: one that can't be found stops them all.
    const planned: PlannedTask[] = [];
    for (const [index, task] of tasks.entries()) {
      const which = tasks.length > 1 ? `Task ${index + 1} (${quoted(task.title)})` : quoted(task.title);
      let projectId: string | null = null;
      let projectName: string | null = null;
      let parentId: string | null = null;
      if (task.parent) {
        const parent = await findTask(task.parent, context);
        if (parent.problem) return about(parent.problem, which);
        if (parent.item.parentId) return refused(`${which}: ${quoted(parent.item.title)} is a subtask, and subtasks can't have their own subtasks. Nothing was changed.`);
        // A subtask goes in its parent's project, as in the app (SMART-02).
        parentId = parent.item.id;
        projectId = parent.item.projectId;
        projectName = parent.item.project?.name ?? null;
      } else if (task.project) {
        const project = await findProject(task.project, context);
        if (project.problem) return about(project.problem, which);
        projectId = project.item.id;
        projectName = project.item.name;
      }
      planned.push({
        input: {
          title: task.title,
          description: task.description ?? "",
          dueDate: task.dueDate ? parseTaskDueDateForStorage(task.dueDate) : null,
          priority: task.priority,
          projectId,
          assigneeId: null,
          parentId,
          noteId: null,
        },
        sourceUrl: task.sourceUrl,
        projectName,
      });
    }

    const result = await writer.apply(async (writes) => {
      const created: Array<WrittenItem & { projectName: string | null }> = [];
      const skipped: Array<{ title: string; sourceUrl: string; existing: WrittenItem }> = [];
      // Links this call adds, so the same one twice in a call makes one task.
      const added = new Map<string, WrittenItem>();
      for (const { input, sourceUrl, projectName } of planned) {
        const place = `${input.projectId ?? ""} ${sourceUrl}`;
        if (sourceUrl) {
          const existing = added.get(place) ?? (await writes.findTaskForSourceLink(sourceUrl, input.projectId));
          if (existing) {
            skipped.push({ title: input.title, sourceUrl, existing });
            continue;
          }
        }
        const task = await writes.createTask(input);
        if (sourceUrl) {
          await writes.addSourceLink(task.id, sourceUrl);
          added.set(place, task);
        }
        created.push({ id: task.id, title: task.title, projectName });
      }
      return { created, skipped };
    });
    if (!result.ok) return refusedBy(result, tasks.length > 1 ? "a task's project or parent" : quoted(tasks[0].title));

    const { created, skipped } = result.value;
    const parts = [
      created.length ? `Created ${count(created.length, "task")}` : "Created no tasks",
      skipped.length ? `skipped ${count(skipped.length, "task")} whose web address already has one` : null,
    ].filter(Boolean);
    const summary = `${parts.join("; ")}.`;
    const data = {
      created: created.map((task) => ({ id: task.id, title: task.title, ...(task.projectName ? { project: task.projectName } : {}) })),
      skipped: skipped.map((task) => ({ title: task.title, sourceUrl: task.sourceUrl, existingTask: { id: task.existing.id, title: task.existing.title } })),
    };
    const sources = [...created.map(links.task), ...skipped.map((task) => links.task(task.existing))];
    if (!created.length) return { data: { changed: null, reason: summary, ...data }, sources };
    return { data: { changed: summary, ...data }, sources };
  },
});

export const updateTask = defineTool({
  name: "update_task",
  label: "Changing a task",
  title: "Change a task",
  description:
    "Changes one of the person's tasks: its title, description, status, priority, due date, project, assignee or labels. Give only what changes. Moving it to another project removes its assignee, a member of the old one, unless you give a new one.",
  input: z
    .strictObject({
      task: itemRef("task", "list_open_tasks"),
      title: optionalArgument(z.string().trim().max(TITLE_MAX)).describe("A new title."),
      description: optionalArgument(z.string().trim().max(TEXT_MAX)).describe("A new description, which replaces the old one."),
      clearDescription: optionalArgument(z.boolean()).describe("true to remove the description."),
      status: optionalArgument(z.enum(TASK_STATUSES)).describe("A new status."),
      priority: optionalArgument(z.enum(PRIORITIES)).describe("A new priority; NONE removes it."),
      dueDate: optionalArgument(dayKey()).describe("A new due date, YYYY-MM-DD."),
      clearDueDate: optionalArgument(z.boolean()).describe("true to remove the due date."),
      project: projectRef("Moves it to this project"),
      removeFromProject: optionalArgument(z.boolean()).describe("true to take it out of its project, making it the person's own task."),
      assignee: optionalArgument(z.string().trim().max(NAME_MAX)).describe('Assigns it to a member of its project: their name as the project shows it, or "me" for the person.'),
      unassign: optionalArgument(z.boolean()).describe("true to leave it unassigned."),
      labels: optionalArgument(z.array(z.string().trim().min(1).max(NAME_MAX)).max(LABELS_PER_TASK_MAX)).describe(
        "All its labels from now on, by name: its project's labels, or the person's own for a task of theirs. [] removes them all.",
      ),
    })
    .superRefine((args, issues) => {
      if (args.project !== undefined && args.removeFromProject) issues.addIssue({ code: "custom", message: "Give project or removeFromProject, not both." });
      if (args.assignee !== undefined && args.unassign) issues.addIssue({ code: "custom", message: "Give assignee or unassign, not both." });
    }),
  access: "write",
  writeHints: { destructive: false, idempotent: true },
  async run(args, context) {
    const writer = writerOf(context);
    if (!writer) return NOT_ALLOWED;
    const found = await findTask(args.task, context);
    if (found.problem) return found.problem;
    const task = found.item;
    const input = currentTask(task);
    const changes: string[] = [];

    if (args.title !== undefined && args.title !== task.title) {
      input.title = args.title;
      changes.push(`renamed it ${quoted(args.title)}`);
    }
    // An empty description counts as left out, like any optional argument: clearDescription removes it.
    const description = task.description || null;
    const newDescription = args.description ?? (args.clearDescription ? null : description);
    if (newDescription !== description) {
      input.description = newDescription ?? "";
      changes.push(newDescription ? "changed the description" : "removed the description");
    }
    if (args.status !== undefined && args.status !== task.status) {
      input.status = args.status;
      changes.push(`moved it to ${STATUS_WORDS[args.status]}`);
    }
    if (args.priority !== undefined && args.priority !== task.priority) {
      input.priority = args.priority;
      changes.push(args.priority === "NONE" ? "removed the priority" : `set the priority to ${priorityLabels[args.priority as Priority]}`);
    }
    const due = task.dueDate ? formatTaskDayKey(task.dueDate) : null;
    const newDue = args.dueDate ?? (args.clearDueDate ? null : due);
    if (newDue !== due) {
      input.dueDate = newDue ? parseTaskDueDateForStorage(newDue) : null;
      changes.push(newDue ? `set the due date to ${newDue}` : "removed the due date");
    }

    let projectName = task.project?.name ?? null;
    if (args.project !== undefined || args.removeFromProject) {
      if (task.parentId) return refused(`${quoted(task.title)} is a subtask, so it stays in its parent's project. Nothing was changed.`);
      if (args.project !== undefined) {
        const target = await findProject(args.project, context);
        if (target.problem) return target.problem;
        if (target.item.id !== task.projectId) {
          input.projectId = target.item.id;
          projectName = target.item.name;
          changes.push(`moved it to ${quoted(target.item.name)}`);
        }
      } else if (task.projectId) {
        input.projectId = null;
        projectName = null;
        changes.push(`took it out of ${quoted(task.project?.name ?? "its project")}`);
      }
    }
    const movedProject = input.projectId !== task.projectId;
    // The old assignee was a member of the old project.
    if (movedProject) input.assigneeId = null;

    if (args.assignee !== undefined) {
      if (!input.projectId || !projectName) return refused(`${quoted(task.title)} isn't in a project, and only a project's tasks have assignees. Nothing was changed.`);
      const member = await findMember(args.assignee, input.projectId, projectName, context);
      if (member.problem) return member.problem;
      input.assigneeId = member.item.id;
      if (member.item.id !== task.assigneeId) changes.push(`assigned it to ${member.item.name}`);
    } else if (task.assigneeId && !input.assigneeId) {
      changes.push(movedProject ? `unassigned ${task.assignee?.name ?? "it"}, a member of the old project` : `unassigned ${task.assignee?.name ?? "it"}`);
    } else if (args.unassign && task.assigneeId) {
      input.assigneeId = null;
      changes.push(`unassigned ${task.assignee?.name ?? "it"}`);
    }

    if (args.labels !== undefined) {
      const scope = input.projectId && projectName ? { projectId: input.projectId, projectName } : { userId: task.userId };
      const labels = await findLabels(args.labels, scope, context);
      if (labels.problem) return labels.problem;
      const ids = labels.item.map((label) => label.id);
      const before = task.labels.map((row) => row.label.id).sort().join(" ");
      if (movedProject || [...ids].sort().join(" ") !== before) {
        input.labelIds = ids;
        changes.push(ids.length ? `set its labels to ${labels.item.map((label) => quoted(label.name)).join(", ")}` : "removed its labels");
      }
    }

    if (!changes.length) return unchanged(`${quoted(task.title)} already looks like that, so nothing was changed.`, [links.task(task)]);
    const result = await writer.apply((writes) => writes.updateTask(task.id, input));
    if (!result.ok) return refusedBy(result, quoted(task.title));
    return changed(`Changed ${quoted(task.title)}: ${changes.join("; ")}.`, [links.task(result.value)]);
  },
});

export const completeTask = defineTool({
  name: "complete_task",
  label: "Marking a task done",
  title: "Mark a task done",
  description: "Marks one of the person's open tasks as done.",
  input: z.strictObject({ task: itemRef("task", "list_open_tasks") }),
  access: "write",
  writeHints: { destructive: false, idempotent: true },
  async run({ task: wanted }, context) {
    const writer = writerOf(context);
    if (!writer) return NOT_ALLOWED;
    // Open tasks first: "the report" means the one still to do, if any is.
    const open = await findTask(wanted, context, { status: { not: "DONE" } });
    if (open.problem) {
      const any = await findTask(wanted, context);
      if (any.item?.status === "DONE") return unchanged(`${quoted(any.item.title)} is already done, so nothing was changed.`, [links.task(any.item)]);
      return open.problem;
    }
    const task = open.item;
    const result = await writer.apply((writes) => writes.updateTask(task.id, { ...currentTask(task), status: "DONE" }));
    if (!result.ok) return refusedBy(result, quoted(task.title));
    return changed(`Marked ${quoted(task.title)} as done.`, [links.task(result.value)]);
  },
});

export const commentOnTask = defineTool({
  name: "comment_on_task",
  label: "Commenting on a task",
  title: "Comment on a task",
  description:
    "Adds a comment to one of the person's tasks, as the person. \"@Name\" lets that member of the task's project know, and the task's assignee hears about it too.",
  input: z.strictObject({
    task: itemRef("task", "list_open_tasks"),
    comment: z.string().trim().min(1).max(COMMENT_MAX).describe("The comment, in the person's words."),
  }),
  access: "write",
  writeHints: { destructive: false, idempotent: false },
  async run({ task: wanted, comment }, context) {
    const writer = writerOf(context);
    if (!writer) return NOT_ALLOWED;
    const found = await findTask(wanted, context);
    if (found.problem) return found.problem;
    const task = found.item;
    const body = cleanComment(comment);
    if (!body) return refused(`Write a comment of up to ${COMMENT_MAX} characters. Nothing was changed.`);
    const result = await writer.apply((writes) => writes.addComment(task.id, body));
    if (!result.ok) return refusedBy(result, quoted(task.title));
    return changed(`Commented on ${quoted(task.title)}.`, [links.task(task)], { commentId: result.value.id });
  },
});

export const deleteTask = defineTool({
  name: "delete_task",
  label: "Moving a task to the Trash",
  title: "Move a task to the Trash",
  description:
    "Moves one of the person's tasks to the Trash, where they can restore it, only when they asked for it to be deleted. Nothing is deleted for good. One task per call.",
  input: z.strictObject({ task: itemRef("task", "list_open_tasks") }),
  access: "write",
  writeHints: { destructive: true, idempotent: true },
  async run({ task: wanted }, context) {
    const writer = writerOf(context);
    if (!writer) return NOT_ALLOWED;
    const found = await findTask(wanted, context);
    if (found.problem) return found.problem;
    const result = await writer.apply((writes) => writes.trashTask(found.item.id));
    if (!result.ok) return refusedBy(result, quoted(found.item.title));
    return changed(`Moved ${quoted(found.item.title)} to the Trash, where the person can restore it.`, [links.trashed("task", result.value)]);
  },
});

const eventFields = {
  description: optionalArgument(z.string().trim().max(TEXT_MAX)).describe("Details, when the person gave some."),
  location: optionalArgument(z.string().trim().max(NAME_MAX)).describe("Where it happens."),
  repeatUntil: optionalArgument(dayKey()).describe("The last day it can repeat on, YYYY-MM-DD. Leave it out to keep repeating."),
};

/** "on 2026-11-27 at 15:00", "on 2026-11-27, all day", with how it repeats. */
function describeWhen({ startDate, startTime, recurrence, repeatUntil }: { startDate: string; startTime: string | null; recurrence: string; repeatUntil: Date | null | undefined }) {
  const day = `on ${startDate}${startTime ? ` at ${startTime}` : ", all day"}`;
  return recurrence === "NONE" ? day : `${day}, ${describeRepeat(recurrence, repeatUntil).replace(/^Repeats /, "repeating ")}`;
}

export const createEvent = defineTool({
  name: "create_event",
  label: "Adding an event",
  title: "Add an event",
  description:
    "Adds a calendar event for the person, such as a meeting or a deadline, in one of their projects or as their own. Without a start time it lasts all day. It can repeat daily, weekly, every 2 weeks or monthly.",
  input: z.strictObject({
    title: z.string().trim().min(1).max(TITLE_MAX).describe("The event's title."),
    date: dayKey("The day it happens, or starts, YYYY-MM-DD."),
    startTime: optionalArgument(clock()).describe("When it starts, HH:MM in 24-hour time, in the person's time zone. Leave it out for an all-day event."),
    endTime: optionalArgument(clock()).describe("When it ends, HH:MM in 24-hour time."),
    endDate: optionalArgument(dayKey()).describe("The day it ends, YYYY-MM-DD, when that isn't the day it starts."),
    ...eventFields,
    project: projectRef("The project it belongs to. Leave it out for an event of the person's own"),
    repeat: optionalArgument(z.enum(REPEATS)).describe("How it repeats: DAILY, WEEKLY, BIWEEKLY (every 2 weeks) or MONTHLY. Leave it out for a one-off event."),
  }),
  access: "write",
  writeHints: { destructive: false, idempotent: false },
  async run(args, context) {
    const writer = writerOf(context);
    if (!writer) return NOT_ALLOWED;
    if (args.endTime && !args.startTime) return refused("An end time needs a start time. Nothing was changed.");
    if (args.repeatUntil && !args.repeat) return refused("repeatUntil is for a repeating event: give repeat too. Nothing was changed.");

    let project: ProjectRow | null = null;
    if (args.project) {
      const found = await findProject(args.project, context);
      if (found.problem) return found.problem;
      project = found.item;
    }
    // The same checks as the event form's (src/lib/event-fields.ts).
    const parsed = parseEventCreateBody({
      title: args.title,
      startDate: args.date,
      startTime: args.startTime ?? null,
      endDate: args.endDate ?? null,
      endTime: args.endTime ?? null,
      description: args.description ?? null,
      location: args.location ?? null,
      projectId: project?.id ?? null,
      recurrence: args.repeat ?? "NONE",
      repeatUntil: args.repeatUntil ?? null,
    });
    if ("error" in parsed) return refused(`${parsed.error}. Nothing was changed.`);

    const result = await writer.apply((writes) => writes.createEvent(parsed.data));
    if (!result.ok) return refusedBy(result, quoted(args.title));
    const when = describeWhen({ startDate: args.date, startTime: args.startTime ?? null, recurrence: parsed.data.recurrence, repeatUntil: parsed.data.repeatUntil });
    return changed(`Added ${quoted(result.value.title)} ${when}${project ? ` in ${quoted(project.name)}` : ""}.`, [links.event(result.value)]);
  },
});

type EventTimesInput = { date?: string; startTime?: string; endTime?: string; endDate?: string; allDay?: boolean };

/**
 * The event form's date and time fields after a change: the event as it is, with what the call
 * gives. When the start moves and the end isn't given, the event keeps its length, as calendars do.
 */
export function changedEventTimes(event: Pick<EventRow, "startTime" | "endTime" | "hasStartTime" | "hasEndTime">, args: EventTimesInput) {
  const startDate = args.date ?? storedDay(event.startTime);
  const startTime = args.allDay ? null : (args.startTime ?? (event.hasStartTime ? eventTimeInputValue(event.startTime) : null));
  const startMoved = args.date !== undefined || args.startTime !== undefined || args.allDay === true;
  let endDate: string | null;
  let endTime: string | null;
  if (event.endTime && startMoved && args.endDate === undefined && args.endTime === undefined) {
    const length = event.endTime.getTime() - event.startTime.getTime();
    const end = new Date(Date.parse(`${startDate}T${startTime ?? "00:00"}:00.000Z`) + length);
    endDate = storedDay(end);
    endTime = args.allDay || !event.hasEndTime ? null : eventTimeInputValue(end);
    // A meeting made all-day that way ends the day it starts, so it has no end of its own.
    if (!endTime && endDate === startDate) endDate = null;
  } else {
    endDate = args.endDate ?? (event.endTime ? storedDay(event.endTime) : null);
    endTime = args.allDay ? null : (args.endTime ?? (event.hasEndTime && event.endTime ? eventTimeInputValue(event.endTime) : null));
  }
  return { startDate, startTime, endDate, endTime };
}

export const updateEvent = defineTool({
  name: "update_event",
  label: "Changing an event",
  title: "Change an event",
  description:
    "Changes one of the person's calendar events: its title, day, times, details, location, project, or how it repeats. Give only what changes. A repeating event changes as a whole. When the start moves and the end isn't given, it keeps its length.",
  input: z
    .strictObject({
      event: itemRef("event", "list_events"),
      title: optionalArgument(z.string().trim().max(TITLE_MAX)).describe("A new title."),
      date: optionalArgument(dayKey()).describe("A new day it happens, or starts, YYYY-MM-DD."),
      startTime: optionalArgument(clock()).describe("A new start time, HH:MM in 24-hour time."),
      endTime: optionalArgument(clock()).describe("A new end time, HH:MM in 24-hour time."),
      endDate: optionalArgument(dayKey()).describe("A new day it ends, YYYY-MM-DD."),
      allDay: optionalArgument(z.boolean()).describe("true to make it last all day, without times."),
      ...eventFields,
      clearDescription: optionalArgument(z.boolean()).describe("true to remove the details."),
      clearLocation: optionalArgument(z.boolean()).describe("true to remove the location."),
      project: projectRef("Moves it to this project"),
      removeFromProject: optionalArgument(z.boolean()).describe("true to take it out of its project, making it the person's own event."),
      repeat: optionalArgument(z.enum(RECURRENCE_VALUES)).describe("How it repeats from now on: DAILY, WEEKLY, BIWEEKLY (every 2 weeks), MONTHLY, or NONE to stop."),
      clearRepeatUntil: optionalArgument(z.boolean()).describe("true to keep it repeating with no last day."),
    })
    .superRefine((args, issues) => {
      if (args.allDay && (args.startTime !== undefined || args.endTime !== undefined)) {
        issues.addIssue({ code: "custom", message: "An all-day event has no times: give allDay or times, not both." });
      }
      if (args.project !== undefined && args.removeFromProject) issues.addIssue({ code: "custom", message: "Give project or removeFromProject, not both." });
      if (args.repeatUntil !== undefined && args.clearRepeatUntil) issues.addIssue({ code: "custom", message: "Give repeatUntil or clearRepeatUntil, not both." });
    }),
  access: "write",
  writeHints: { destructive: false, idempotent: true },
  async run(args, context) {
    const writer = writerOf(context);
    if (!writer) return NOT_ALLOWED;
    const found = await findEvent(args.event, context);
    if (found.problem) return found.problem;
    const event = found.item;

    let projectId = event.projectId;
    let projectName = event.project?.name ?? null;
    if (args.project !== undefined) {
      const target = await findProject(args.project, context);
      if (target.problem) return target.problem;
      projectId = target.item.id;
      projectName = target.item.name;
    } else if (args.removeFromProject) {
      projectId = null;
      projectName = null;
    }

    const times = changedEventTimes(event, args);
    const recurrence = args.repeat ?? event.recurrence;
    const parsed = parseEventUpdateBody({
      title: args.title ?? event.title,
      ...times,
      description: args.clearDescription ? null : (args.description ?? event.description),
      location: args.clearLocation ? null : (args.location ?? event.location),
      projectId,
      recurrence,
      // Left out, the last day stays as it is, unless it stops repeating.
      repeatUntil: args.clearRepeatUntil ? null : args.repeatUntil,
    });
    if ("error" in parsed) return refused(`${parsed.error}. Nothing was changed.`);
    const next = parsed.data;

    const changes: string[] = [];
    if (next.title !== event.title) changes.push(`renamed it ${quoted(next.title)}`);
    const sameTime = (a: Date | null, b: Date | null) => (a?.getTime() ?? null) === (b?.getTime() ?? null);
    const repeatUntil = next.repeatUntil === undefined ? event.repeatUntil : next.repeatUntil;
    const moved =
      !sameTime(next.times.startTime, event.startTime) ||
      !sameTime(next.times.endTime, event.endTime) ||
      next.times.hasStartTime !== event.hasStartTime ||
      next.times.hasEndTime !== event.hasEndTime;
    if (moved) changes.push(`moved it to ${times.startDate}${times.startTime ? ` at ${times.startTime}${times.endTime ? `–${times.endTime}` : ""}` : ", all day"}${times.endDate && times.endDate !== times.startDate ? ` until ${times.endDate}` : ""}`);
    if (next.recurrence !== event.recurrence || !sameTime(repeatUntil, event.repeatUntil)) {
      changes.push(next.recurrence === "NONE" ? "stopped it repeating" : describeRepeat(next.recurrence, repeatUntil).replace(/^Repeats /, "set it to repeat "));
    }
    if (next.description !== (event.description || null)) changes.push(next.description ? "changed the details" : "removed the details");
    if (next.location !== (event.location || null)) changes.push(next.location ? `set the location to ${quoted(next.location)}` : "removed the location");
    if (next.projectId !== event.projectId) changes.push(projectName ? `moved it to ${quoted(projectName)}` : `took it out of ${quoted(event.project?.name ?? "its project")}`);

    const link = links.event({ id: event.id, title: event.title });
    if (!changes.length) return unchanged(`${quoted(event.title)} already looks like that, so nothing was changed.`, [link]);
    const result = await writer.apply((writes) => writes.updateEvent(event.id, next));
    if (!result.ok) return refusedBy(result, quoted(event.title));
    return changed(`Changed ${quoted(event.title)}: ${changes.join("; ")}.`, [links.event(result.value)]);
  },
});

export const deleteEvent = defineTool({
  name: "delete_event",
  label: "Moving an event to the Trash",
  title: "Move an event to the Trash",
  description:
    "Moves one of the person's calendar events to the Trash, where they can restore it, only when they asked for it to be deleted. A repeating event goes as a whole. Nothing is deleted for good.",
  input: z.strictObject({ event: itemRef("event", "list_events") }),
  access: "write",
  writeHints: { destructive: true, idempotent: true },
  async run({ event: wanted }, context) {
    const writer = writerOf(context);
    if (!writer) return NOT_ALLOWED;
    const found = await findEvent(wanted, context);
    if (found.problem) return found.problem;
    const result = await writer.apply((writes) => writes.trashEvent(found.item.id));
    if (!result.ok) return refusedBy(result, quoted(found.item.title));
    return changed(`Moved ${quoted(found.item.title)} to the Trash, where the person can restore it.`, [links.trashed("event", result.value)]);
  },
});

export const createNote = defineTool({
  name: "create_note",
  label: "Writing a note",
  title: "Write a note",
  description: "Writes a new note for the person, in one of their projects or as their own.",
  input: z.strictObject({
    title: z.string().trim().min(1).max(TITLE_MAX).describe("The note's title."),
    content: optionalArgument(z.string().trim().max(TEXT_MAX)).describe("What the note says."),
    project: projectRef("The project it belongs to. Leave it out for a note of the person's own"),
  }),
  access: "write",
  writeHints: { destructive: false, idempotent: false },
  async run({ title, content, project: wanted }, context) {
    const writer = writerOf(context);
    if (!writer) return NOT_ALLOWED;
    let project: ProjectRow | null = null;
    if (wanted) {
      const found = await findProject(wanted, context);
      if (found.problem) return found.problem;
      project = found.item;
    }
    const result = await writer.apply((writes) => writes.createNote({ title, content: content ?? null, projectId: project?.id ?? null }));
    if (!result.ok) return refusedBy(result, quoted(title));
    return changed(`Wrote the note ${quoted(title)}${project ? ` in ${quoted(project.name)}` : ""}.`, [links.note(result.value)]);
  },
});

export const appendToNote = defineTool({
  name: "append_to_note",
  label: "Adding to a note",
  title: "Add to a note",
  description: "Adds text at the end of one of the person's notes, as a new paragraph. What the note already says stays as it is.",
  input: z.strictObject({
    note: itemRef("note", "search_notes"),
    text: z.string().trim().min(1).max(TEXT_MAX).describe("What to add."),
  }),
  access: "write",
  writeHints: { destructive: false, idempotent: false },
  async run({ note: wanted, text }, context) {
    const writer = writerOf(context);
    if (!writer) return NOT_ALLOWED;
    const found = await findNote(wanted, context);
    if (found.problem) return found.problem;
    const note = found.item;
    const before = note.content?.trimEnd() ?? "";
    const content = before ? `${before}\n\n${text}` : text;
    if (content.length > NOTE_CONTENT_MAX) return refused(`${quoted(noteTitle(note))} would grow too long. Nothing was changed: the person can edit it in the app.`);
    const result = await writer.apply((writes) => writes.updateNote(note.id, { title: note.title, content, projectId: note.projectId }));
    if (!result.ok) return refusedBy(result, quoted(noteTitle(note)));
    return changed(`Added to ${quoted(noteTitle(note))}.`, [links.note(result.value)]);
  },
});

export const deleteNote = defineTool({
  name: "delete_note",
  label: "Moving a note to the Trash",
  title: "Move a note to the Trash",
  description: "Moves one of the person's notes to the Trash, where they can restore it, only when they asked for it to be deleted. Nothing is deleted for good.",
  input: z.strictObject({ note: itemRef("note", "search_notes") }),
  access: "write",
  writeHints: { destructive: true, idempotent: true },
  async run({ note: wanted }, context) {
    const writer = writerOf(context);
    if (!writer) return NOT_ALLOWED;
    const found = await findNote(wanted, context);
    if (found.problem) return found.problem;
    const title = noteTitle(found.item);
    const result = await writer.apply((writes) => writes.trashNote(found.item.id));
    if (!result.ok) return refusedBy(result, quoted(title));
    return changed(`Moved ${quoted(title)} to the Trash, where the person can restore it.`, [links.trashed("note", result.value)]);
  },
});

export const createProject = defineTool({
  name: "create_project",
  label: "Creating a project",
  title: "Create a project",
  description: "Creates a new project, owned by the person. Tasks, events and notes go in it by its name or id.",
  input: z.strictObject({
    name: z.string().trim().min(1).max(NAME_MAX).describe("The project's name."),
    description: optionalArgument(z.string().trim().max(TEXT_MAX)).describe("What the project is for, when the person said."),
  }),
  access: "write",
  writeHints: { destructive: false, idempotent: false },
  async run({ name, description }, context) {
    const writer = writerOf(context);
    if (!writer) return NOT_ALLOWED;
    const result = await writer.apply((writes) => writes.createProject({ name, description: description ?? null }));
    if (!result.ok) return refusedBy(result, quoted(name));
    return changed(`Created the project ${quoted(result.value.name)}.`, [links.project(result.value)]);
  },
});

/** Every write tool AI apps connected over MCP get, with the person's permission to make changes (#479). */
export const CHANGE_TOOLS = [
  createTasks,
  updateTask,
  completeTask,
  commentOnTask,
  createEvent,
  updateEvent,
  createNote,
  appendToNote,
  createProject,
  deleteTask,
  deleteEvent,
  deleteNote,
];
