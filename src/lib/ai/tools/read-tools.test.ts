import assert from "node:assert/strict";
import test from "node:test";
import { visibleEventWhere, visibleNoteWhere } from "../../note-access";
import { projectAccessWhere } from "../../project-access-core";
import { visibleTaskWhere } from "../../task-include";
import { toolDefinition, type ToolContext, type ToolDb } from "./define";
import { AGENT_TOOLS } from "./index";
import { WRITE_TOOLS } from "./write-tools";
import { excerpt, listEvents, listGoals, listOpenTasks, listProjects, MAX_PROJECTS, MAX_TASKS, percentOf, searchNotes, taskStats } from "./read-tools";

type Model = "task" | "event" | "project" | "note" | "weeklyGoal";
type FindManyArgs = { where: Record<string, unknown> & { AND?: unknown[] }; take?: number; select?: unknown };
type GroupByArgs = { by: string[]; where: FindManyArgs["where"]; _count: unknown };
/** The rows a query gets: always the same ones, or picked by the query. */
type Rows = unknown[] | ((args: FindManyArgs) => unknown[]);

/** A stand-in database: records each query and answers with the rows given (`groups` for groupBy). */
function fakeDb(rows: Partial<Record<Model, Rows>>, groups: unknown[] = []) {
  const calls: Array<{ model: Model; args: FindManyArgs }> = [];
  const groupCalls: GroupByArgs[] = [];
  const model = (name: Model) => ({
    findMany: async (args: FindManyArgs) => {
      calls.push({ model: name, args });
      const found = rows[name] ?? [];
      return typeof found === "function" ? found(args) : found;
    },
    groupBy: async (args: GroupByArgs) => {
      groupCalls.push(args);
      return groups;
    },
  });
  const db = { task: model("task"), event: model("event"), project: model("project"), note: model("note"), weeklyGoal: model("weeklyGoal") };
  return { db: db as unknown as ToolDb, calls, groupCalls };
}

const ME = "user-from-session";
/** Monday, November 16, 2026, 10:00 on the person's wall clock. */
const NOW = new Date(2026, 10, 16, 10, 0);

function contextWith(db: ToolDb): ToolContext {
  return { userId: ME, now: NOW, realNow: new Date("2026-11-16T15:00:00.000Z"), timeZone: null, db };
}

/** A due date as the server stores it: a date at midnight UTC. */
const due = (day: number) => new Date(Date.UTC(2026, 10, day));

function task(id: string, dueDate: Date | null, extra: Record<string, unknown> = {}) {
  return { id, title: `Task ${id}`, status: "TODO", priority: "NONE", dueDate, project: null, assignee: null, ...extra };
}

const TASKS = [
  task("a", due(14), { priority: "HIGH", project: { name: "Whitewall" }, assignee: { userId: ME } }),
  task("b", due(16), { status: "IN_PROGRESS" }),
  task("c", due(20)),
  task("d", due(30), { assignee: { userId: "someone-else" } }),
  task("e", null),
];

async function openTasks(args: unknown, rows: unknown[] = TASKS) {
  const { db, calls } = fakeDb({ task: rows });
  const input = listOpenTasks.input.parse(args);
  const output = await listOpenTasks.run(input, contextWith(db));
  return { output, where: calls[0].args.where, call: calls[0].args, data: output.data as { total: number | string; tasks: Array<Record<string, unknown>> } };
}

test("open tasks: only those the person can see, never done ones", async () => {
  const { where, data, output } = await openTasks({});
  assert.deepEqual(where.AND?.[0], visibleTaskWhere(ME), "the same filter as /api/tasks, for the session's user");
  assert.deepEqual(where.AND?.[1], { status: { not: "DONE" } });
  assert.equal(data.total, 5);
  assert.deepEqual(data.tasks[0], {
    id: "a",
    title: "Task a",
    status: "TODO",
    priority: "HIGH",
    due: "2026-11-14",
    when: "2 days late",
    project: "Whitewall",
    assignedToYou: true,
  });
  assert.deepEqual(data.tasks[1], { id: "b", title: "Task b", status: "IN_PROGRESS", due: "2026-11-16", when: "Today" }, "only the fields that are set");
  assert.equal(data.tasks[3].assignedToYou, undefined, "nobody else's name or account is sent");
  assert.deepEqual(data.tasks[4], { id: "e", title: "Task e", status: "TODO" });
  assert.deepEqual(output.sources[0], { kind: "task", id: "a", title: "Task a", href: "/tasks?task=a" });
});

test("open tasks: due filters are exact in the person's day, with a day to spare in the query", async () => {
  const overdue = await openTasks({ due: "overdue" });
  assert.deepEqual(overdue.where.AND?.[2], { dueDate: { lt: new Date(Date.UTC(2026, 10, 17)) } });
  assert.deepEqual(overdue.data.tasks.map((item) => item.id), ["a"]);

  const today = await openTasks({ due: "today" });
  assert.deepEqual(today.where.AND?.[2], { dueDate: { gte: new Date(Date.UTC(2026, 10, 15)), lt: new Date(Date.UTC(2026, 10, 18)) } });
  assert.deepEqual(today.data.tasks.map((item) => item.id), ["b"]);

  const week = await openTasks({ due: "next_7_days" });
  assert.deepEqual(week.data.tasks.map((item) => item.id), ["b", "c"]);

  const undated = await openTasks({ due: "no_due_date" }, [TASKS[4]]);
  assert.deepEqual(undated.where.AND?.[2], { dueDate: null });
  assert.deepEqual(undated.data.tasks.map((item) => item.id), ["e"]);
});

test("open tasks: by project name or id, and by status", async () => {
  const { where } = await openTasks({ project: "  whitewall ", status: "IN_PROGRESS" });
  assert.deepEqual(where.AND?.[1], { status: "IN_PROGRESS" });
  assert.deepEqual(where.AND?.[3], {
    OR: [{ projectId: "whitewall" }, { project: { name: { contains: "whitewall", mode: "insensitive" } } }],
  });
  assert.deepEqual(where.AND?.[0], visibleTaskWhere(ME), "a project filter never widens what the person can see");
});

test("open tasks: at most 25, and says when there are more", async () => {
  const many = Array.from({ length: 30 }, (_, index) => task(`t${index}`, null));
  const { data } = await openTasks({}, many);
  assert.equal(data.tasks.length, MAX_TASKS);
  assert.equal(data.total, 30);

  const huge = Array.from({ length: 200 }, (_, index) => task(`t${index}`, null));
  assert.equal((await openTasks({}, huge)).data.total, "200 or more");
});

test("open tasks: invalid arguments are refused before any query", () => {
  for (const args of [{ due: "yesterday" }, { status: "DONE" }, { project: "" }, { userId: "someone-else" }]) {
    assert.equal(listOpenTasks.input.safeParse(args).success, false, JSON.stringify(args));
  }
});

const event = (id: string, fields: Record<string, unknown>) => ({
  id,
  title: `Event ${id}`,
  startTime: new Date("2026-11-17T09:00:00.000Z"),
  endTime: null,
  hasStartTime: true,
  hasEndTime: false,
  recurrence: "NONE",
  repeatUntil: null,
  skippedDates: [],
  project: null,
  ...fields,
});

test("events: a date range, repeats expanded, in the person's wall-clock times", async () => {
  const { db, calls } = fakeDb({
    event: [
      event("meeting", {
        startTime: new Date("2026-11-17T09:00:00.000Z"),
        endTime: new Date("2026-11-17T10:30:00.000Z"),
        hasEndTime: true,
        project: { name: "Whitewall" },
      }),
      event("standup", {
        startTime: new Date("2026-11-02T14:00:00.000Z"),
        recurrence: "WEEKLY",
        skippedDates: [new Date("2026-11-23T00:00:00.000Z")],
      }),
      event("offsite", { startTime: new Date("2026-11-18T00:00:00.000Z"), hasStartTime: false }),
    ],
  });
  const output = await listEvents.run(listEvents.input.parse({ from: "2026-11-16", to: "2026-11-30" }), contextWith(db));
  const where = calls[0].args.where;
  assert.deepEqual(where.AND?.[0], visibleEventWhere(ME));
  assert.deepEqual(where.AND?.[1], { startTime: { lte: new Date("2026-11-30T23:59:59.999Z") } });

  const data = output.data as { total: number; events: Array<Record<string, unknown>> };
  assert.deepEqual(data.events, [
    { id: "standup", title: "Event standup", date: "2026-11-16", start: "14:00", repeats: "weekly" },
    { id: "meeting", title: "Event meeting", date: "2026-11-17", start: "09:00", end: "10:30", project: "Whitewall" },
    { id: "offsite", title: "Event offsite", date: "2026-11-18", allDay: true },
    { id: "standup", title: "Event standup", date: "2026-11-30", start: "14:00", repeats: "weekly" },
  ]);
  assert.deepEqual(
    output.sources.map((source) => source.href),
    ["/events?event=standup", "/events?event=meeting", "/events?event=offsite"],
    "one link per event, however often it repeats",
  );
});

test("events: the range must be real dates, in order, at most 31 days", () => {
  const error = (args: unknown) => {
    const parsed = listEvents.input.safeParse(args);
    return parsed.success ? null : parsed.error.issues[0].message;
  };
  assert.equal(error({ from: "2026-11-16", to: "2026-11-16" }), null);
  assert.equal(error({ from: "2026-11-20", to: "2026-11-16" }), "to can't be before from.");
  assert.equal(error({ from: "2026-11-01", to: "2026-12-15" }), "Ask for at most 31 days at a time.");
  assert.equal(error({ from: "2026-02-30", to: "2026-03-01" }), "Use a real date written YYYY-MM-DD.");
  assert.equal(error({ from: "tomorrow", to: "2026-11-16" }), "Use a real date written YYYY-MM-DD.");
  assert.notEqual(error({ from: "2026-11-16", to: "2026-11-17", userId: "x" }), null);
});

test("projects: the person's projects with Home's health", async () => {
  const { db, calls } = fakeDb({
    project: [
      {
        id: "p1",
        name: "Whitewall",
        status: "ACTIVE",
        updatedAt: new Date(2026, 10, 15, 12),
        tasks: [
          { status: "DONE", dueDate: due(10), updatedAt: new Date(2026, 10, 14) },
          { status: "TODO", dueDate: due(10), updatedAt: new Date(2026, 10, 14) },
        ],
      },
      { id: "p2", name: "Garden", status: "ACTIVE", updatedAt: new Date(2026, 10, 15, 12), tasks: [] },
    ],
  });
  const output = await listProjects.run(listProjects.input.parse({}), contextWith(db));
  assert.deepEqual(calls[0].args.where, { AND: [projectAccessWhere(ME), { status: "ACTIVE" }] });
  assert.deepEqual((output.data as { projects: unknown[] }).projects, [
    { id: "p1", name: "Whitewall", health: "AT_RISK", percentDone: 50, openTasks: 1, overdueTasks: 1, daysSinceUpdate: 1 },
    { id: "p2", name: "Garden", health: "NOT_STARTED", percentDone: 0, openTasks: 0, overdueTasks: 0, daysSinceUpdate: 1 },
  ]);
  assert.deepEqual(output.sources[0], { kind: "project", id: "p1", title: "Whitewall", href: "/projects/p1" });

  const archived = fakeDb({ project: [{ id: "p3", name: "Old", status: "ARCHIVED", updatedAt: new Date(2026, 9, 1), tasks: [] }] });
  const old = await listProjects.run(listProjects.input.parse({ status: "ARCHIVED" }), contextWith(archived.db));
  assert.deepEqual(archived.calls[0].args.where.AND?.[1], { status: "ARCHIVED" });
  assert.equal(((old.data as { projects: Array<Record<string, unknown>> }).projects[0]).status, "ARCHIVED");
});

test("notes: title or text, any case, and an excerpt rather than the note", async () => {
  const long = `${"Intro. ".repeat(40)}The budget for Whitewall is set. ${"More text. ".repeat(40)}`;
  const { db, calls } = fakeDb({
    note: [
      { id: "n1", title: "Planning", content: long, updatedAt: new Date("2026-11-15T20:00:00.000Z"), project: { name: "Whitewall" } },
      { id: "n2", title: "", content: null, updatedAt: new Date("2026-11-01T08:00:00.000Z"), project: null },
    ],
  });
  const output = await searchNotes.run(searchNotes.input.parse({ query: " budget " }), contextWith(db));
  assert.deepEqual(calls[0].args.where, {
    AND: [
      visibleNoteWhere(ME),
      { OR: [{ title: { contains: "budget", mode: "insensitive" } }, { content: { contains: "budget", mode: "insensitive" } }] },
    ],
  });
  const notes = (output.data as { notes: Array<Record<string, unknown>> }).notes;
  assert.equal(notes[0].title, "Planning");
  assert.equal(notes[0].project, "Whitewall");
  assert.equal(notes[0].updated, "2026-11-15");
  assert.match(String(notes[0].excerpt), /^….*The budget for Whitewall is set\..*…$/);
  assert.ok(String(notes[0].excerpt).length <= 242);
  assert.deepEqual(notes[1], { id: "n2", title: "Untitled note", updated: "2026-11-01", excerpt: "" });
  assert.equal(output.sources[1].href, "/notes?openNote=n2");
  assert.equal(searchNotes.input.safeParse({ query: "a" }).success, false);
});

test("excerpt: short notes whole, long ones around the words, on one line", () => {
  assert.equal(excerpt("Buy milk\n\nand eggs", "milk"), "Buy milk and eggs");
  assert.equal(excerpt(null, "milk"), "");
  const text = `${"a".repeat(300)} target ${"b".repeat(300)}`;
  const cut = excerpt(text, "TARGET");
  assert.ok(cut.startsWith("…") && cut.endsWith("…") && cut.includes("target"));
  assert.ok(excerpt(`${"word ".repeat(100)}`, "missing").startsWith("word"), "no match: the start of the note");
});

test("goals: this week's by default, the person's own only", async () => {
  const { db, calls } = fakeDb({
    weeklyGoal: [{ id: "g1", title: "Ship the agent", status: "ACTIVE", tasks: [{ status: "DONE" }, { status: "TODO" }] }],
  });
  const output = await listGoals.run(listGoals.input.parse({}), contextWith(db));
  assert.deepEqual(calls[0].args.where, { userId: ME, targetWeek: "2026-W47", status: { not: "ARCHIVED" } });
  assert.deepEqual(output.data, {
    week: "2026-W47",
    dates: "Nov 16 – 22",
    isThisWeek: true,
    goals: [{ id: "g1", title: "Ship the agent", status: "ACTIVE", linkedTasks: 2, linkedTasksDone: 1 }],
  });
  assert.equal(output.sources[0].href, "/goals?week=2026-W47");

  const other = fakeDb({ weeklyGoal: [] });
  const last = await listGoals.run(listGoals.input.parse({ week: "2026-W46" }), contextWith(other.db));
  assert.equal(other.calls[0].args.where.targetWeek, "2026-W46");
  assert.equal((last.data as { isThisWeek: boolean }).isThisWeek, false);
  for (const week of ["2026-W60", "next week", "2026-47"]) assert.equal(listGoals.input.safeParse({ week }).success, false, week);
});

test("every tool has a provider-safe name and a schema without patterns; only the change tools propose (#310)", () => {
  const names = AGENT_TOOLS.map((tool) => tool.name);
  assert.deepEqual(names, [
    "list_open_tasks",
    "list_events",
    "list_projects",
    "task_stats",
    "search_notes",
    "list_goals",
    "create_project",
    "create_task",
    "create_ticket",
    "update_task",
    "complete_task",
    "create_event",
    "trash_task",
  ]);
  for (const tool of AGENT_TOOLS) {
    assert.equal(tool.access, WRITE_TOOLS.some((write) => write.name === tool.name) ? "propose" : "read", tool.name);
    assert.match(tool.name, /^[a-z][a-z_]{2,40}$/);
    const schema = JSON.stringify(toolDefinition(tool).parameters);
    assert.doesNotMatch(schema, /"\$schema"|"pattern"/, tool.name);
    assert.match(schema, /"additionalProperties":false/, tool.name);
  }
});

type StatsRow = { name?: string; status?: string; total: number; done: number; toDo: number; inProgress: number; percentDone: number; percentToDo: number; overdue: number; doneLast7Days: number };
type StatsData = { overall: StatsRow; projects: StatsRow[]; moreProjects?: number; countedUpTo?: string };

/** Counts as groupBy returns them: one row per project and status. */
const group = (projectId: string | null, status: string, count: number) => ({ projectId, status, _count: { _all: count } });

/** task_stats over a stand-in database: grouped counts, overdue candidates and recently done tasks. */
async function stats(
  args: unknown,
  { groups = [] as unknown[], late = [] as unknown[], recent = [] as unknown[], projects = [] as unknown[] } = {},
) {
  // The tool reads tasks twice: open ones due before tomorrow, then recently done ones.
  const pick = (query: FindManyArgs) => ((query.where.AND?.[1] as { status?: unknown } | undefined)?.status === "DONE" ? recent : late);
  const { db, calls, groupCalls } = fakeDb({ task: pick, project: projects }, groups);
  const output = await taskStats.run(taskStats.input.parse(args), contextWith(db));
  return { output, calls, groupCalls, data: output.data as StatsData };
}

/** Samuel's example: 33% done in AI Multi, 20% in Babel, and 75% of all tasks left. */
const EXAMPLE = {
  groups: [
    group("p1", "DONE", 4),
    group("p1", "IN_PROGRESS", 2),
    group("p1", "TODO", 6),
    group("p2", "DONE", 2),
    group("p2", "TODO", 8),
    group(null, "DONE", 1),
    group(null, "TODO", 5),
  ],
  projects: [
    { id: "p2", name: "Babel", status: "ACTIVE" },
    { id: "p1", name: "AI Multi", status: "ACTIVE" },
  ],
};

test("task stats: counts what the person can see, in the database, with Home's rounding", async () => {
  const { data, groupCalls, calls, output } = await stats({}, EXAMPLE);

  assert.equal(groupCalls.length, 1, "the database counts; tasks aren't read one by one");
  assert.deepEqual(groupCalls[0].by, ["projectId", "status"]);
  assert.deepEqual(groupCalls[0].where.AND?.[0], visibleTaskWhere(ME), "the same filter as /api/tasks, for the session's user");
  for (const call of calls.filter((call) => call.model === "task")) {
    assert.deepEqual((call.args.where.AND?.[0] as FindManyArgs["where"]).AND?.[0], visibleTaskWhere(ME));
    assert.ok(call.args.take, "the day-check reads are capped");
  }

  assert.deepEqual(data.overall, { total: 28, done: 7, toDo: 21, inProgress: 2, percentDone: 25, percentToDo: 75, overdue: 0, doneLast7Days: 0 });
  assert.deepEqual(
    data.projects.map((row) => [row.name, row.total, row.percentDone, row.percentToDo]),
    [
      ["AI Multi", 12, 33, 67],
      ["Babel", 10, 20, 80],
      ["No project", 6, 17, 83],
    ],
    "most tasks first; tasks outside any project are grouped, and the shares add up to 100",
  );
  assert.deepEqual(data.projects[0], { name: "AI Multi", total: 12, done: 4, toDo: 8, inProgress: 2, percentDone: 33, percentToDo: 67, overdue: 0, doneLast7Days: 0 });
  assert.deepEqual(output.sources, [
    { kind: "project", id: "p1", title: "AI Multi", href: "/projects/p1" },
    { kind: "project", id: "p2", title: "Babel", href: "/projects/p2" },
  ]);
  assert.equal(percentOf(1, 3) + (100 - percentOf(1, 3)), 100);
  assert.equal(percentOf(0, 0), 0);
});

test("task stats: overdue and done this week are decided by day, as Home decides them", async () => {
  const { data, calls } = await stats(
    {},
    {
      ...EXAMPLE,
      late: [
        { projectId: "p1", dueDate: due(14) }, // 2 days late
        { projectId: "p1", dueDate: due(16) }, // due today: not late
        { projectId: null, dueDate: due(15) }, // yesterday
      ],
      recent: [
        { projectId: "p2", completedAt: new Date(2026, 10, 10, 9, 0) }, // 6 days ago: this week
        { projectId: "p2", completedAt: new Date(2026, 10, 9, 23, 0) }, // 7 days ago: not
        { projectId: "p1", completedAt: new Date(2026, 10, 16, 8, 0) }, // today
      ],
    },
  );
  const [late, recent] = calls.filter((call) => call.model === "task");
  assert.deepEqual(late.args.where.AND?.slice(1), [{ status: { not: "DONE" } }, { dueDate: { lt: due(17) } }], "a day to spare before the exact check");
  assert.deepEqual(recent.args.where.AND?.[1], { status: "DONE" });

  assert.equal(data.overall.overdue, 2);
  assert.equal(data.overall.doneLast7Days, 2);
  assert.deepEqual(
    data.projects.map((row) => [row.name, row.overdue, row.doneLast7Days]),
    [
      ["AI Multi", 1, 1],
      ["Babel", 0, 1],
      ["No project", 1, 0],
    ],
  );
});

test("task stats: one project by name or id, its status when it isn't active, and a capped list", async () => {
  const one = await stats({ project: "babel" }, { groups: [group("p2", "DONE", 1)], projects: [{ id: "p2", name: "Babel", status: "ARCHIVED" }] });
  assert.deepEqual(one.groupCalls[0].where.AND?.[1], {
    OR: [{ projectId: "babel" }, { project: { name: { contains: "babel", mode: "insensitive" } } }],
  });
  assert.equal(one.data.projects[0].status, "ARCHIVED");
  assert.equal(one.data.overall.percentToDo, 0, "everything done");

  const many = Array.from({ length: MAX_PROJECTS + 3 }, (_, index) => `p${index}`);
  const capped = await stats(
    {},
    {
      groups: many.map((id, index) => group(id, "TODO", index + 1)),
      projects: many.map((id) => ({ id, name: `Project ${id}`, status: "ACTIVE" })),
    },
  );
  assert.equal(capped.data.projects.length, MAX_PROJECTS);
  assert.equal(capped.data.projects[0].name, `Project p${MAX_PROJECTS + 2}`, "the biggest first");
  assert.equal(capped.data.moreProjects, 3);
  assert.equal(capped.data.overall.total, ((MAX_PROJECTS + 3) * (MAX_PROJECTS + 4)) / 2, "the totals still count every project");

  const empty = await stats({});
  assert.deepEqual(empty.data, {
    overall: { total: 0, done: 0, toDo: 0, inProgress: 0, percentDone: 0, percentToDo: 0, overdue: 0, doneLast7Days: 0 },
    projects: [],
  });
  assert.equal(empty.calls.filter((call) => call.model === "project").length, 0, "no project lookup without projects");

  for (const project of ["", " ", "x".repeat(121)]) assert.equal(taskStats.input.safeParse({ project }).success, false, JSON.stringify(project));
  assert.equal(taskStats.input.safeParse({ userId: "someone-else" }).success, false, "no unknown arguments");
});
