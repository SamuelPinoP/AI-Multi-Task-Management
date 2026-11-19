// The sample workspaces the evaluations run against (#311): JSON files in
// ./workspaces, written the way a person would describe their account ("due
// 2026-11-19", "starts 2026-11-19T12:30"), checked here and turned into the
// rows the in-memory database serves the real tools.
//
// Dates follow the app's storage rules: a due date or a skipped day is UTC
// midnight of that day, an event time is its wall-clock time stored as UTC
// (src/lib/event-time.ts), and timestamps such as updatedAt are real instants.
import { z } from "zod";
import main from "@/lib/ai/evals/workspaces/main.json";
import type { Row, Tables } from "@/lib/ai/evals/memory-db";
import { isValidTimeZone } from "@/lib/user-time";

const WORKSPACES: Record<string, unknown> = { main };

const id = z.string().regex(/^[a-z0-9-]+$/, "Ids are lowercase words joined by hyphens.");
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Write days as YYYY-MM-DD.")
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
  }, "That day doesn't exist.");
const wallClock = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Write event times as YYYY-MM-DDTHH:MM, the person's wall clock.");
const instant = z.iso.datetime({ error: "Write timestamps as ISO 8601 instants ending in Z." });
const week = z.string().regex(/^\d{4}-W\d{2}$/, "Write weeks as ISO weeks such as 2026-W47.");

export const clockSchema = z.strictObject({
  /** The real time of the question. */
  now: instant,
  timeZone: z.string().refine(isValidTimeZone, "Use an IANA time zone such as America/Los_Angeles."),
});

export type Clock = z.infer<typeof clockSchema>;

const workspaceSchema = z.strictObject({
  description: z.string(),
  /** The signed-in person asking the questions. */
  person: id,
  /** The clock of every case that doesn't set its own. */
  clock: clockSchema,
  projects: z.array(
    z.strictObject({
      id,
      name: z.string().min(1),
      owner: id,
      status: z.enum(["ACTIVE", "COMPLETED", "ARCHIVED"]).default("ACTIVE"),
      updatedAt: instant.optional(),
    }),
  ),
  /** Project members besides the owner, who has access through Project.userId. */
  members: z.array(z.strictObject({ id, project: id, user: id, name: z.string().min(1) })),
  tasks: z.array(
    z.strictObject({
      id,
      title: z.string().min(1),
      owner: id,
      project: id.nullable().default(null),
      status: z.enum(["TODO", "IN_PROGRESS", "DONE"]).default("TODO"),
      priority: z.enum(["NONE", "LOW", "MEDIUM", "HIGH", "URGENT"]).default("NONE"),
      due: day.nullable().default(null),
      /** A ProjectMember id. */
      assignee: id.nullable().default(null),
      goal: id.nullable().default(null),
      completedAt: instant.nullable().default(null),
      deletedAt: instant.nullable().default(null),
      updatedAt: instant.optional(),
    }),
  ),
  events: z.array(
    z.strictObject({
      id,
      title: z.string().min(1),
      owner: id,
      project: id.nullable().default(null),
      /** For an all-day event, the day at 00:00. */
      start: wallClock,
      end: wallClock.nullable().default(null),
      allDay: z.boolean().default(false),
      repeats: z.enum(["NONE", "DAILY", "WEEKLY", "BIWEEKLY", "MONTHLY"]).default("NONE"),
      repeatUntil: day.nullable().default(null),
      skipped: z.array(day).default([]),
      deletedAt: instant.nullable().default(null),
      updatedAt: instant.optional(),
    }),
  ),
  notes: z.array(
    z.strictObject({
      id,
      title: z.string(),
      content: z.string().nullable().default(null),
      owner: id,
      project: id.nullable().default(null),
      deletedAt: instant.nullable().default(null),
      updatedAt: instant.optional(),
    }),
  ),
  goals: z.array(
    z.strictObject({
      id,
      title: z.string().min(1),
      owner: id,
      week,
      status: z.enum(["ACTIVE", "COMPLETED", "ARCHIVED"]).default("ACTIVE"),
      createdAt: instant.optional(),
    }),
  ),
});

type WorkspaceFile = z.infer<typeof workspaceSchema>;

/** Rows without a timestamp of their own were last touched a week before the default clock. */
const DEFAULT_TIMESTAMP = "2026-11-12T18:00:00.000Z";

export type Workspace = {
  name: string;
  description: string;
  person: string;
  clock: Clock;
  tables: Tables;
  /**
   * Titles the person must never be shown: other people's items outside the projects the person
   * belongs to, and items in the trash. Any answer that names one leaked it.
   */
  hiddenTitles: string[];
  /** Every id in the workspace: answers name items by title, never by id (the system prompt's rule 5). */
  ids: string[];
};

const dayDate = (value: string) => new Date(`${value}T00:00:00.000Z`);
const wallClockDate = (value: string) => new Date(`${value}:00.000Z`);
const instantDate = (value: string | undefined | null) => (value ? new Date(value) : null);

function checkReferences(file: WorkspaceFile) {
  const problems: string[] = [];
  const all = [file.person, ...file.projects.map((p) => p.id), ...file.members.map((m) => m.id), ...file.tasks.map((t) => t.id), ...file.events.map((e) => e.id), ...file.notes.map((n) => n.id), ...file.goals.map((g) => g.id)];
  const seen = new Set<string>();
  for (const value of all) {
    if (seen.has(value)) problems.push(`the id ${value} is used twice`);
    seen.add(value);
  }
  const projects = new Set(file.projects.map((p) => p.id));
  const members = new Map(file.members.map((m) => [m.id, m]));
  const goals = new Set(file.goals.map((g) => g.id));
  for (const member of file.members) if (!projects.has(member.project)) problems.push(`member ${member.id} is in a project that doesn't exist`);
  for (const item of [...file.tasks, ...file.events, ...file.notes]) {
    if (item.project && !projects.has(item.project)) problems.push(`${item.id} is in a project that doesn't exist`);
  }
  for (const task of file.tasks) {
    const assignee = task.assignee ? members.get(task.assignee) : undefined;
    if (task.assignee && !assignee) problems.push(`${task.id} is assigned to a member that doesn't exist`);
    if (assignee && assignee.project !== task.project) problems.push(`${task.id} is assigned to a member of another project`);
    if (task.goal && !goals.has(task.goal)) problems.push(`${task.id} is linked to a goal that doesn't exist`);
    if ((task.status === "DONE") !== (task.completedAt !== null)) problems.push(`${task.id} needs completedAt exactly when it is DONE`);
  }
  if (problems.length) throw new Error(`The sample workspace has problems: ${problems.join("; ")}.`);
}

/** What the person can see, decided independently of the app's filters so the evaluations can catch a leak. */
function hiddenTitles(file: WorkspaceFile) {
  const reachable = new Set(
    file.projects
      .filter((project) => project.owner === file.person || file.members.some((member) => member.project === project.id && member.user === file.person))
      .map((project) => project.id),
  );
  const visible = (item: { owner: string; project: string | null; deletedAt: string | null }) =>
    item.deletedAt === null && (item.owner === file.person || (item.project !== null && reachable.has(item.project)));
  return [
    ...file.projects.filter((project) => !reachable.has(project.id)).map((project) => project.name),
    ...[...file.tasks, ...file.events, ...file.notes].filter((item) => !visible(item)).map((item) => item.title),
    ...file.goals.filter((goal) => goal.owner !== file.person).map((goal) => goal.title),
  ].filter((title) => title.trim() !== "");
}

function toTables(file: WorkspaceFile): Tables {
  const stamp = (value: string | undefined) => new Date(value ?? DEFAULT_TIMESTAMP);
  const projectRows: Row[] = file.projects.map((project) => ({
    id: project.id,
    name: project.name,
    status: project.status,
    priority: "NONE",
    userId: project.owner,
    createdAt: stamp(undefined),
    updatedAt: stamp(project.updatedAt),
  }));
  const memberRows: Row[] = file.members.map((member) => ({ id: member.id, projectId: member.project, userId: member.user, name: member.name }));
  const taskRows: Row[] = file.tasks.map((task) => ({
    id: task.id,
    title: task.title,
    status: task.status,
    priority: task.priority,
    dueDate: task.due ? dayDate(task.due) : null,
    userId: task.owner,
    projectId: task.project,
    assigneeId: task.assignee,
    goalId: task.goal,
    completedAt: instantDate(task.completedAt),
    deletedAt: instantDate(task.deletedAt),
    createdAt: stamp(undefined),
    updatedAt: stamp(task.updatedAt),
  }));
  const eventRows: Row[] = file.events.map((event) => ({
    id: event.id,
    title: event.title,
    startTime: wallClockDate(event.start),
    endTime: event.end ? wallClockDate(event.end) : null,
    hasStartTime: !event.allDay,
    hasEndTime: !event.allDay && event.end !== null,
    recurrence: event.repeats,
    repeatUntil: event.repeatUntil ? dayDate(event.repeatUntil) : null,
    skippedDates: event.skipped.map(dayDate),
    userId: event.owner,
    projectId: event.project,
    deletedAt: instantDate(event.deletedAt),
    createdAt: stamp(undefined),
    updatedAt: stamp(event.updatedAt),
  }));
  const noteRows: Row[] = file.notes.map((note) => ({
    id: note.id,
    title: note.title,
    content: note.content,
    userId: note.owner,
    projectId: note.project,
    deletedAt: instantDate(note.deletedAt),
    createdAt: stamp(undefined),
    updatedAt: stamp(note.updatedAt),
  }));
  const goalRows: Row[] = file.goals.map((goal) => ({
    id: goal.id,
    title: goal.title,
    status: goal.status,
    targetWeek: goal.week,
    userId: goal.owner,
    createdAt: stamp(goal.createdAt),
    updatedAt: stamp(goal.createdAt),
  }));
  return { project: projectRows, projectMember: memberRows, task: taskRows, event: eventRows, note: noteRows, weeklyGoal: goalRows };
}

export function workspaceNames() {
  return Object.keys(WORKSPACES);
}

/** A sample workspace, checked: a typo in its file fails here, before any model is asked. */
export function loadWorkspace(name: string): Workspace {
  if (!Object.hasOwn(WORKSPACES, name)) throw new Error(`There is no sample workspace named "${name}". The workspaces are: ${workspaceNames().join(", ")}.`);
  const parsed = workspaceSchema.safeParse(WORKSPACES[name]);
  if (!parsed.success) throw new Error(`The sample workspace "${name}" is invalid: ${z.prettifyError(parsed.error)}`);
  const file = parsed.data;
  checkReferences(file);
  const tables = toTables(file);
  return {
    name,
    description: file.description,
    person: file.person,
    clock: file.clock,
    tables,
    hiddenTitles: hiddenTitles(file),
    ids: [
      ...new Set([
        ...Object.values(tables).flatMap((rows) => rows.map((row) => String(row.id))),
        // People's ids too: the tools never send them, so an answer that has one made it up or leaked it.
        file.person,
        ...[...file.projects, ...file.tasks, ...file.events, ...file.notes, ...file.goals].map((item) => item.owner),
        ...file.members.map((member) => member.user),
      ]),
    ],
  };
}
