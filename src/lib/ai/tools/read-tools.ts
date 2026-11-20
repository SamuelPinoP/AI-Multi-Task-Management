// The AI assistant's read-only tools (#307): open tasks, events in a date
// range, projects with their health, notes by search, weekly goals and task
// counts (#453). Each
// one sees exactly what the matching page and API route show the person, with
// the same filters (visibleTaskWhere, visibleEventWhere, projectAccessWhere,
// visibleNoteWhere, and goals by owner), and sends the model only the fields a
// question needs: no descriptions, no other people's names or emails.
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { defineTool, type Source } from "@/lib/ai/tools/define";
import { occurrencesInRange } from "@/lib/event-occurrences";
import { eventTimeInputValue } from "@/lib/event-time";
import { daysFrom, dueLabel, projectHealth } from "@/lib/home-summary";
import { visibleEventWhere, visibleNoteWhere } from "@/lib/note-access";
import { projectAccessWhere } from "@/lib/project-access-core";
import { normalizeRecurrence, storedDayKey } from "@/lib/recurrence";
import { formatTaskDayKey, getLocalDateOnly } from "@/lib/task-date-buckets";
import { visibleTaskWhere } from "@/lib/task-include";
import { dayKeyInZone, toWallClock } from "@/lib/user-time";
import { weekKeyOf, weekLabel, weekStart } from "@/lib/weekly-review";

const DAY_MS = 86_400_000;
export const MAX_TASKS = 25;
/** Open tasks read before the exact due-date filter; well above what anyone keeps open. */
const TASK_SCAN = 200;
export const MAX_EVENTS = 40;
export const MAX_EVENT_RANGE_DAYS = 31;
export const MAX_PROJECTS = 20;
export const MAX_NOTES = 8;
export const MAX_GOALS = 20;
/** Characters of a note sent around the words searched for. */
const EXCERPT_CHARS = 240;

function isDayKey(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toISOString().slice(0, 10) === value;
}

/**
 * A date written YYYY-MM-DD. Checked in code rather than with a JSON Schema pattern, which not
 * every provider accepts. The write tools (./write-tools.ts) take dates the same way.
 */
export function dayKey(description: string) {
  return z.string().refine(isDayKey, "Use a real date written YYYY-MM-DD.").describe(description);
}

function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

function localDay(key: string, endOfDay = false) {
  const [year, month, day] = key.split("-").map(Number);
  return endOfDay ? new Date(year, month - 1, day, 23, 59, 59, 999) : new Date(year, month - 1, day);
}

/** Up to EXCERPT_CHARS of `content` around the first place `query` appears, on one line. */
export function excerpt(content: string | null, query: string) {
  const text = (content ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= EXCERPT_CHARS) return text;
  const at = text.toLowerCase().indexOf(query.toLowerCase());
  const start = at < 0 ? 0 : Math.max(0, at - Math.floor(EXCERPT_CHARS / 3));
  const end = Math.min(text.length, start + EXCERPT_CHARS);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`;
}

export const listOpenTasks = defineTool({
  name: "list_open_tasks",
  label: "Checking your open tasks",
  description:
    "Lists the person's open tasks (not done), their own and those in projects they belong to, soonest due first, at most 25. Can filter by when they're due, by project and by status.",
  input: z.strictObject({
    due: z
      .enum(["overdue", "today", "next_7_days", "no_due_date"])
      .optional()
      .describe("overdue: past their due date. today: due today. next_7_days: due today or in the next 7 days. no_due_date: without one. Leave out for every open task."),
    project: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .optional()
      .describe("Only tasks in this project: its name, part of its name, or its id from list_projects."),
    status: z.enum(["TODO", "IN_PROGRESS"]).optional().describe("Only tasks to do, or only tasks in progress."),
  }),
  access: "read",
  async run({ due, project, status }, { userId, now, db }) {
    const today = getLocalDateOnly(now);
    const day = (offset: number) => new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate() + offset));
    // Due dates have no time, and how they're stored depends on the server's time zone. The query
    // narrows with a day to spare on each side; daysFrom, as on Home, then decides exactly.
    const dueWhere =
      due === "overdue"
        ? { dueDate: { lt: day(1) } }
        : due === "today"
          ? { dueDate: { gte: day(-1), lt: day(2) } }
          : due === "next_7_days"
            ? { dueDate: { gte: day(-1), lt: day(9) } }
            : due === "no_due_date"
              ? { dueDate: null }
              : {};
    const tasks = await db.task.findMany({
      where: {
        AND: [
          visibleTaskWhere(userId),
          status ? { status } : { status: { not: "DONE" } },
          dueWhere,
          project
            ? { OR: [{ projectId: project }, { project: { name: { contains: project, mode: "insensitive" } } }] }
            : {},
        ],
      },
      orderBy: [{ dueDate: "asc" }, { priority: "desc" }, { updatedAt: "desc" }],
      take: TASK_SCAN,
      select: {
        id: true,
        title: true,
        status: true,
        priority: true,
        dueDate: true,
        project: { select: { name: true } },
        assignee: { select: { userId: true } },
      },
    });
    const matches = tasks.filter((task) => {
      if (due === "overdue" || due === "today" || due === "next_7_days") {
        if (!task.dueDate) return false;
        const days = daysFrom(task.dueDate, now);
        return due === "overdue" ? days < 0 : due === "today" ? days === 0 : days >= 0 && days <= 7;
      }
      return true;
    });
    const shown = matches.slice(0, MAX_TASKS);

    return {
      data: {
        total: tasks.length === TASK_SCAN ? `${matches.length} or more` : matches.length,
        tasks: shown.map((task) => ({
          id: task.id,
          title: task.title,
          status: task.status,
          ...(task.priority !== "NONE" ? { priority: task.priority } : {}),
          ...(task.dueDate ? { due: formatTaskDayKey(task.dueDate), when: dueLabel(task.dueDate, now) } : {}),
          ...(task.project ? { project: task.project.name } : {}),
          ...(task.assignee?.userId === userId ? { assignedToYou: true } : {}),
        })),
      },
      sources: shown.map((task) => ({ kind: "task", id: task.id, title: task.title, href: `/tasks?task=${encodeURIComponent(task.id)}` })),
    };
  },
});

export const listEvents = defineTool({
  name: "list_events",
  label: "Checking your calendar",
  description:
    "Lists the events on the person's calendar between two dates, repeats included, earliest first, at most 40. Times are the person's own wall-clock times.",
  input: z
    .strictObject({
      from: dayKey("The first day, YYYY-MM-DD."),
      to: dayKey(`The last day, YYYY-MM-DD: the same as from for a single day, at most ${MAX_EVENT_RANGE_DAYS} days after it.`),
    })
    .refine(({ from, to }) => !isDayKey(from) || !isDayKey(to) || daysBetween(from, to) >= 0, {
      message: "to can't be before from.",
      path: ["to"],
    })
    .refine(({ from, to }) => !isDayKey(from) || !isDayKey(to) || daysBetween(from, to) <= MAX_EVENT_RANGE_DAYS, {
      message: `Ask for at most ${MAX_EVENT_RANGE_DAYS} days at a time.`,
      path: ["to"],
    }),
  access: "read",
  async run({ from, to }, { userId, db }) {
    const rangeStart = localDay(from);
    const rangeEnd = localDay(to, true);
    // Event times are stored as wall-clock values (src/lib/event-time.ts), so these bounds are plain UTC dates.
    const events = await db.event.findMany({
      where: {
        AND: [
          visibleEventWhere(userId),
          { startTime: { lte: new Date(`${to}T23:59:59.999Z`) } },
          // Repeats are expanded below; a one-off event matters if it starts in the range or runs into it.
          {
            OR: [
              { recurrence: { not: "NONE" } },
              { startTime: { gte: new Date(`${from}T00:00:00.000Z`) } },
              { endTime: { gte: new Date(`${from}T00:00:00.000Z`) } },
            ],
          },
        ],
      },
      orderBy: { startTime: "asc" },
      take: 500,
      select: {
        id: true,
        title: true,
        startTime: true,
        endTime: true,
        hasStartTime: true,
        hasEndTime: true,
        recurrence: true,
        repeatUntil: true,
        skippedDates: true,
        project: { select: { name: true } },
      },
    });
    const occurrences = occurrencesInRange(
      events.map((event) => ({
        ...event,
        startTime: event.startTime.toISOString(),
        endTime: event.endTime?.toISOString() ?? null,
        recurrence: normalizeRecurrence(event.recurrence),
      })),
      rangeStart,
      rangeEnd,
    ).sort((a, b) => a.startTime.localeCompare(b.startTime));
    const shown = occurrences.slice(0, MAX_EVENTS);
    const sources = new Map<string, Source>();
    for (const event of shown) {
      sources.set(event.sourceEventId, {
        kind: "event",
        id: event.sourceEventId,
        title: event.title,
        href: `/events?event=${encodeURIComponent(event.sourceEventId)}`,
      });
    }

    return {
      data: {
        from,
        to,
        total: occurrences.length,
        events: shown.map((event) => ({
          id: event.sourceEventId,
          title: event.title,
          date: storedDayKey(event.startTime),
          ...(event.hasStartTime ? { start: eventTimeInputValue(event.startTime) } : { allDay: true }),
          ...(event.hasStartTime && event.hasEndTime && event.endTime ? { end: eventTimeInputValue(event.endTime) } : {}),
          ...(event.recurrence !== "NONE" ? { repeats: event.recurrence.toLowerCase() } : {}),
          ...(event.project ? { project: event.project.name } : {}),
        })),
      },
      sources: [...sources.values()],
    };
  },
});

export const listProjects = defineTool({
  name: "list_projects",
  label: "Checking your projects",
  description:
    "Lists the projects the person owns or belongs to, most recently updated first, at most 20, with their health as Home shows it: ON_TRACK, AT_RISK (tasks past due), STALE (no update in 7 days) or NOT_STARTED.",
  input: z.strictObject({
    status: z.enum(["ACTIVE", "COMPLETED", "ARCHIVED"]).optional().describe("Leave out for active projects."),
  }),
  access: "read",
  async run({ status }, { userId, now, timeZone, db }) {
    const projects = await db.project.findMany({
      where: { AND: [projectAccessWhere(userId), { status: status ?? "ACTIVE" }] },
      orderBy: { updatedAt: "desc" },
      take: MAX_PROJECTS,
      select: {
        id: true,
        name: true,
        status: true,
        updatedAt: true,
        tasks: { where: { deletedAt: null }, select: { status: true, dueDate: true, updatedAt: true } },
      },
    });

    return {
      data: {
        projects: projects.map((project) => {
          const open = project.tasks.filter((task) => task.status !== "DONE");
          const overdue = open.filter((task) => task.dueDate && daysFrom(task.dueDate, now) < 0).length;
          const lastUpdate = project.tasks.reduce((latest, task) => (task.updatedAt > latest ? task.updatedAt : latest), project.updatedAt);
          const health = projectHealth(
            {
              totalTasks: project.tasks.length,
              doneTasks: project.tasks.length - open.length,
              inProgressTasks: open.filter((task) => task.status === "IN_PROGRESS").length,
              overdueTasks: overdue,
              lastUpdate: toWallClock(timeZone, lastUpdate),
            },
            now,
          );
          return {
            id: project.id,
            name: project.name,
            ...(project.status !== "ACTIVE" ? { status: project.status } : {}),
            health: health.status,
            percentDone: health.percentDone,
            openTasks: open.length,
            overdueTasks: overdue,
            daysSinceUpdate: health.idleDays,
          };
        }),
      },
      sources: projects.map((project) => ({ kind: "project", id: project.id, title: project.name, href: `/projects/${encodeURIComponent(project.id)}` })),
    };
  },
});

export const searchNotes = defineTool({
  name: "search_notes",
  label: "Searching your notes",
  description:
    "Finds the person's notes, their own and those in their projects, whose title or text contains the words, newest first, at most 8. Returns a short excerpt of each, not the whole note.",
  input: z.strictObject({
    query: z.string().trim().min(2).max(80).describe("The words to look for, as they'd appear in the note."),
  }),
  access: "read",
  async run({ query }, { userId, timeZone, db }) {
    const notes = await db.note.findMany({
      where: {
        AND: [
          visibleNoteWhere(userId),
          {
            OR: [
              { title: { contains: query, mode: "insensitive" } },
              { content: { contains: query, mode: "insensitive" } },
            ],
          },
        ],
      },
      orderBy: { updatedAt: "desc" },
      take: MAX_NOTES,
      select: { id: true, title: true, content: true, updatedAt: true, project: { select: { name: true } } },
    });

    return {
      data: {
        query,
        notes: notes.map((note) => ({
          id: note.id,
          title: note.title || "Untitled note",
          ...(note.project ? { project: note.project.name } : {}),
          updated: dayKeyInZone(timeZone, note.updatedAt),
          excerpt: excerpt(note.content, query),
        })),
      },
      sources: notes.map((note) => ({
        kind: "note",
        id: note.id,
        title: note.title || "Untitled note",
        href: `/notes?openNote=${encodeURIComponent(note.id)}`,
      })),
    };
  },
});

export const listGoals = defineTool({
  name: "list_goals",
  label: "Checking your goals",
  description:
    "Lists the person's weekly goals for one week (this week unless another is given), with how many of each goal's linked tasks are done.",
  input: z.strictObject({
    week: z
      .string()
      .refine((week) => weekStart(week) !== null, "Use an ISO week such as 2026-W47.")
      .optional()
      .describe("An ISO week such as 2026-W47. Leave out for this week."),
  }),
  access: "read",
  async run({ week }, { userId, now, db }) {
    const key = week ?? weekKeyOf(now);
    // Goals are personal: the same filter as the Goals page (src/lib/goals.ts).
    const goals = await db.weeklyGoal.findMany({
      where: { userId, targetWeek: key, status: { not: "ARCHIVED" } },
      orderBy: { createdAt: "asc" },
      take: MAX_GOALS,
      select: { id: true, title: true, status: true, tasks: { where: { deletedAt: null }, select: { status: true } } },
    });

    return {
      data: {
        week: key,
        dates: weekLabel(key),
        isThisWeek: key === weekKeyOf(now),
        goals: goals.map((goal) => ({
          id: goal.id,
          title: goal.title,
          status: goal.status,
          linkedTasks: goal.tasks.length,
          linkedTasksDone: goal.tasks.filter((task) => task.status === "DONE").length,
        })),
      },
      sources: goals.map((goal) => ({ kind: "goal", id: goal.id, title: goal.title, href: `/goals?week=${encodeURIComponent(key)}` })),
    };
  },
});

/** A whole-number share, rounded as Home rounds a project's progress. */
export function percentOf(part: number, whole: number) {
  return whole ? Math.round((part / whole) * 100) : 0;
}

/** Overdue and recently done tasks read for exact day checks; far more than anyone has. */
const STATS_SCAN = 1000;

type StatCounts = { total: number; done: number; inProgress: number; overdue: number; doneLast7Days: number };

/** The person-facing numbers for one group of tasks; to-do and done shares always add up to 100. */
function statsRow(counts: StatCounts) {
  const percentDone = percentOf(counts.done, counts.total);
  return {
    total: counts.total,
    done: counts.done,
    toDo: counts.total - counts.done,
    inProgress: counts.inProgress,
    percentDone,
    percentToDo: counts.total ? 100 - percentDone : 0,
    overdue: counts.overdue,
    doneLast7Days: counts.doneLast7Days,
  };
}

export const taskStats = defineTool({
  name: "task_stats",
  label: "Counting your tasks",
  description:
    "Counts the tasks the person can see, overall and per project (most tasks first, at most 20; tasks outside any project are \"No project\"): total, done, to do (in progress included), the percent done and to do, overdue, and done in the last 7 days. Use it for progress, analytics or \"how am I doing\" questions, and repeat its numbers instead of working them out.",
  input: z.strictObject({
    project: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .optional()
      .describe("Only this project: its name, part of its name, or its id from list_projects."),
  }),
  access: "read",
  async run({ project }, { userId, now, realNow, timeZone, db }) {
    const where: Prisma.TaskWhereInput = {
      AND: [
        visibleTaskWhere(userId),
        project ? { OR: [{ projectId: project }, { project: { name: { contains: project, mode: "insensitive" } } }] } : {},
      ],
    };
    const today = getLocalDateOnly(now);
    const tomorrow = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate() + 1));
    // The database counts; only overdue and recently done tasks are read, for the exact day
    // checks Home makes. Due dates are narrowed with a day to spare, as in list_open_tasks.
    const [groups, late, recent] = await Promise.all([
      db.task.groupBy({ by: ["projectId", "status"], where, _count: { _all: true } }),
      db.task.findMany({
        where: { AND: [where, { status: { not: "DONE" } }, { dueDate: { lt: tomorrow } }] },
        select: { projectId: true, dueDate: true },
        take: STATS_SCAN,
      }),
      db.task.findMany({
        where: { AND: [where, { status: "DONE" }, { completedAt: { gte: new Date(realNow.getTime() - 8 * DAY_MS) } }] },
        select: { projectId: true, completedAt: true },
        take: STATS_SCAN,
      }),
    ]);

    const byProject = new Map<string | null, StatCounts>();
    const countsFor = (projectId: string | null) => {
      let counts = byProject.get(projectId);
      if (!counts) {
        counts = { total: 0, done: 0, inProgress: 0, overdue: 0, doneLast7Days: 0 };
        byProject.set(projectId, counts);
      }
      return counts;
    };
    for (const group of groups) {
      const counts = countsFor(group.projectId);
      counts.total += group._count._all;
      if (group.status === "DONE") counts.done += group._count._all;
      if (group.status === "IN_PROGRESS") counts.inProgress += group._count._all;
    }
    for (const task of late) {
      if (task.dueDate && daysFrom(task.dueDate, now) < 0) countsFor(task.projectId).overdue += 1;
    }
    for (const task of recent) {
      // "This week" as on Home: today and the 6 days before, on the person's clock.
      if (task.completedAt && daysFrom(toWallClock(timeZone, task.completedAt), now) >= -6) countsFor(task.projectId).doneLast7Days += 1;
    }

    const ids = [...byProject.keys()].filter((id): id is string => id !== null);
    const projects = ids.length
      ? await db.project.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, status: true } })
      : [];
    const projectsById = new Map(projects.map((found) => [found.id, found]));
    const rows = [...byProject.entries()]
      .map(([id, counts]) => ({ id, found: id ? projectsById.get(id) : undefined, counts }))
      .sort((a, b) => b.counts.total - a.counts.total || (a.found?.name ?? "").localeCompare(b.found?.name ?? ""));
    const shown = rows.slice(0, MAX_PROJECTS);
    const overall = rows.reduce(
      (sum, row) => ({
        total: sum.total + row.counts.total,
        done: sum.done + row.counts.done,
        inProgress: sum.inProgress + row.counts.inProgress,
        overdue: sum.overdue + row.counts.overdue,
        doneLast7Days: sum.doneLast7Days + row.counts.doneLast7Days,
      }),
      { total: 0, done: 0, inProgress: 0, overdue: 0, doneLast7Days: 0 },
    );
    const capped = late.length === STATS_SCAN || recent.length === STATS_SCAN;

    return {
      data: {
        overall: statsRow(overall),
        projects: shown.map(({ id, found, counts }) => ({
          name: id ? (found?.name ?? "A project") : "No project",
          ...(found && found.status !== "ACTIVE" ? { status: found.status } : {}),
          ...statsRow(counts),
        })),
        ...(rows.length > shown.length ? { moreProjects: rows.length - shown.length } : {}),
        ...(capped ? { countedUpTo: `Overdue and recently done tasks were counted up to ${STATS_SCAN}.` } : {}),
      },
      sources: shown.flatMap(({ found }): Source[] =>
        found ? [{ kind: "project", id: found.id, title: found.name, href: `/projects/${encodeURIComponent(found.id)}` }] : [],
      ),
    };
  },
});
