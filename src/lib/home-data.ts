import "server-only";
import { ProjectStatus, Recurrence, TaskStatus } from "@prisma/client";
import { eventWallTime, toEventStorageTime } from "@/lib/event-time";
import {
  dailyCounts,
  daysFrom,
  overdueCounts,
  projectHealth,
  sortFocusTasks,
  type ProjectHealthStatus,
} from "@/lib/home-summary";
import { prisma } from "@/lib/prisma";
import { projectAccessWhere } from "@/lib/project-access";
import { occurrencesInRange } from "@/lib/event-occurrences";
import { normalizeRecurrence } from "@/lib/recurrence";
import { generateSmartPlanner, type PlannerSuggestion } from "@/lib/smart-planner";
import { getLocalDateOnly } from "@/lib/task-date-buckets";
import { toWallClock } from "@/lib/user-time";

const FOCUS_LIMIT = 6;
const PROJECT_HEALTH_LIMIT = 4;
const ACTIVITY_LIMIT = 6;

export type HomeFocusTask = {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: "HIGH" | "MEDIUM" | "LOW";
  dueDate: string | null;
  recurrence: Recurrence;
  projectId: string | null;
  assigneeId: string | null;
  project: { id: string; name: string; color: string | null } | null;
  assignee: { id: string; name: string } | null;
};

export type HomeEvent = {
  id: string;
  sourceId: string;
  title: string;
  location: string | null;
  /** Stored wall-clock times (see `@/lib/event-time`). */
  startTime: string;
  endTime: string | null;
  hasStartTime: boolean;
  project: { id: string; name: string; color: string | null } | null;
};

export type HomeProjectHealth = {
  id: string;
  name: string;
  color: string | null;
  status: ProjectHealthStatus;
  percentDone: number;
  totalTasks: number;
  doneTasks: number;
  overdueTasks: number;
  idleDays: number;
};

export type HomeActivity = {
  id: string;
  message: string;
  createdAt: Date;
  user: { id: string; name: string };
  project: { name: string; color: string | null } | null;
};

export type HomeData = {
  focus: HomeFocusTask[];
  openTaskCount: number;
  stats: {
    dueToday: number;
    overdue: number;
    doneThisWeek: number;
    doneLastWeek: number;
    dueTodaySeries: number[];
    overdueSeries: number[];
    doneSeries: number[];
  };
  todayEvents: HomeEvent[];
  suggestion: PlannerSuggestion | null;
  projects: HomeProjectHealth[];
  activity: HomeActivity[];
  shortcuts: { project: { id: string; name: string; color: string | null } | null; note: { id: string; title: string } | null };
};

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

/**
 * Everything the home screen shows. `now` is the user's wall clock and
 * `timeZone` their browser's zone (null falls back to the server's clock).
 */
export async function getHomeData(userId: string, now: Date, timeZone: string | null): Promise<HomeData> {
  const realNow = new Date();
  const wall = (instant: Date) => toWallClock(timeZone, instant);
  const todayStart = getLocalDateOnly(now);
  const tomorrowStart = addDays(todayStart, 1);
  const weekStart = addDays(todayStart, -6);
  const accessibleTasks = { deletedAt: null, OR: [{ userId }, { project: projectAccessWhere(userId) }] };

  const [openTasks, recentlyDone, dueThisWeek, events, projects, activities, planner, shortcut, lastNote, fallbackProject] =
    await Promise.all([
      prisma.task.findMany({
        where: { ...accessibleTasks, status: { not: TaskStatus.DONE } },
        select: {
          id: true,
          title: true,
          description: true,
          status: true,
          priority: true,
          dueDate: true,
          recurrence: true,
          projectId: true,
          assigneeId: true,
          createdAt: true,
          project: { select: { id: true, name: true, color: true } },
          assignee: { select: { id: true, name: true } },
        },
        orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
        take: 500,
      }),
      // Completions over the last two weeks, for "Done this week" and the overdue trend.
      prisma.task.findMany({
        where: { ...accessibleTasks, status: TaskStatus.DONE, completedAt: { gte: addDays(realNow, -15) } },
        select: { dueDate: true, createdAt: true, completedAt: true },
      }),
      prisma.task.findMany({
        where: { ...accessibleTasks, dueDate: { gte: weekStart, lt: tomorrowStart } },
        select: { dueDate: true },
      }),
      prisma.event.findMany({
        where: {
          AND: [
            { deletedAt: null, OR: [{ userId }, { project: projectAccessWhere(userId) }] },
            { startTime: { lt: toEventStorageTime(tomorrowStart) } },
            {
              OR: [
                { startTime: { gte: toEventStorageTime(todayStart) } },
                { recurrence: { not: Recurrence.NONE } },
                // Started earlier and still going on today.
                { endTime: { gte: toEventStorageTime(todayStart) } },
              ],
            },
          ],
        },
        select: {
          id: true,
          title: true,
          location: true,
          startTime: true,
          endTime: true,
          hasStartTime: true,
          hasEndTime: true,
          recurrence: true,
          repeatUntil: true,
          project: { select: { id: true, name: true, color: true } },
        },
        orderBy: { startTime: "asc" },
      }),
      prisma.project.findMany({
        where: { AND: [projectAccessWhere(userId), { status: ProjectStatus.ACTIVE }] },
        select: {
          id: true,
          name: true,
          color: true,
          updatedAt: true,
          tasks: { where: { deletedAt: null }, select: { status: true, dueDate: true, updatedAt: true } },
        },
        orderBy: { updatedAt: "desc" },
        take: PROJECT_HEALTH_LIMIT,
      }),
      prisma.activity.findMany({
        where: { OR: [{ userId }, { project: projectAccessWhere(userId) }] },
        orderBy: { createdAt: "desc" },
        take: ACTIVITY_LIMIT,
        select: {
          id: true,
          message: true,
          createdAt: true,
          user: { select: { id: true, name: true, email: true } },
          project: { select: { name: true, color: true } },
        },
      }),
      generateSmartPlanner(userId, now, realNow),
      prisma.recentShortcut.findUnique({
        where: { userId },
        select: {
          project: {
            select: {
              id: true,
              name: true,
              color: true,
              status: true,
              userId: true,
              members: { where: { userId }, select: { userId: true } },
            },
          },
        },
      }),
      prisma.note.findFirst({
        where: { deletedAt: null, OR: [{ userId }, { project: projectAccessWhere(userId) }] },
        orderBy: { updatedAt: "desc" },
        select: { id: true, title: true },
      }),
      prisma.project.findFirst({
        where: { AND: [projectAccessWhere(userId), { status: ProjectStatus.ACTIVE }] },
        orderBy: { updatedAt: "desc" },
        select: { id: true, name: true, color: true },
      }),
    ]);

  const dueToday = openTasks.filter((task) => task.dueDate && daysFrom(task.dueDate, now) === 0).length;
  const overdue = openTasks.filter((task) => task.dueDate && daysFrom(task.dueDate, now) < 0).length;
  const completions = recentlyDone.flatMap((task) => (task.completedAt ? [wall(task.completedAt)] : []));
  const doneThisWeek = completions.filter((date) => daysFrom(date, now) >= -6).length;
  const doneLastWeek = completions.filter((date) => {
    const diff = daysFrom(date, now);
    return diff >= -13 && diff < -6;
  }).length;
  const overdueCandidates = [
    ...openTasks.map((task) => ({ dueDate: task.dueDate, createdAt: wall(task.createdAt), completedAt: null })),
    ...recentlyDone.map((task) => ({
      dueDate: task.dueDate,
      createdAt: wall(task.createdAt),
      completedAt: task.completedAt ? wall(task.completedAt) : null,
    })),
  ].flatMap((task) => (task.dueDate ? [{ ...task, dueDate: task.dueDate }] : []));

  const focus = sortFocusTasks(openTasks, now)
    .slice(0, FOCUS_LIMIT)
    .map((task) => ({
      id: task.id,
      title: task.title,
      description: task.description,
      status: task.status,
      priority: task.priority,
      dueDate: task.dueDate?.toISOString() ?? null,
      recurrence: task.recurrence,
      projectId: task.projectId,
      assigneeId: task.assigneeId,
      project: task.project,
      assignee: task.assignee,
    }));

  const todayEvents = occurrencesInRange(
    events.map((event) => ({
      ...event,
      startTime: event.startTime.toISOString(),
      endTime: event.endTime?.toISOString() ?? null,
      recurrence: normalizeRecurrence(event.recurrence),
    })),
    todayStart,
    tomorrowStart,
  )
    .filter((event) => {
      const start = eventWallTime(event.startTime);
      return start >= todayStart && start < tomorrowStart;
    })
    .sort((a, b) => Number(a.hasStartTime) - Number(b.hasStartTime) || a.startTime.localeCompare(b.startTime))
    .map((event) => ({
      id: event.id,
      sourceId: event.sourceEventId,
      title: event.title,
      location: event.location,
      startTime: event.startTime,
      endTime: event.endTime,
      hasStartTime: event.hasStartTime,
      project: event.project,
    }));

  const sectionOrder = ["urgent", "dueToday", "upcoming", "suggestedFocus", "projectFollowUp"];
  const suggestion =
    [...planner.sections].sort((a, b) => sectionOrder.indexOf(a.key) - sectionOrder.indexOf(b.key)).flatMap((section) => section.suggestions)[0] ??
    null;

  const projectHealthRows = projects.map((project) => {
    const doneTasks = project.tasks.filter((task) => task.status === TaskStatus.DONE).length;
    const overdueTasks = project.tasks.filter(
      (task) => task.status !== TaskStatus.DONE && task.dueDate && daysFrom(task.dueDate, now) < 0,
    ).length;
    const lastUpdate = project.tasks.reduce(
      (latest, task) => (task.updatedAt > latest ? task.updatedAt : latest),
      project.updatedAt,
    );
    const health = projectHealth(
      { totalTasks: project.tasks.length, doneTasks, overdueTasks, lastUpdate: wall(lastUpdate) },
      now,
    );
    return {
      id: project.id,
      name: project.name,
      color: project.color,
      totalTasks: project.tasks.length,
      doneTasks,
      overdueTasks,
      ...health,
    };
  });

  const recentProject =
    shortcut?.project &&
    shortcut.project.status === ProjectStatus.ACTIVE &&
    (shortcut.project.userId === userId || shortcut.project.members.length > 0)
      ? { id: shortcut.project.id, name: shortcut.project.name, color: shortcut.project.color }
      : fallbackProject;

  return {
    focus,
    openTaskCount: openTasks.length,
    stats: {
      dueToday,
      overdue,
      doneThisWeek,
      doneLastWeek,
      dueTodaySeries: dailyCounts(
        dueThisWeek.flatMap((task) => (task.dueDate ? [task.dueDate] : [])),
        now,
      ),
      overdueSeries: overdueCounts(overdueCandidates, now),
      doneSeries: dailyCounts(completions, now),
    },
    todayEvents,
    suggestion,
    projects: projectHealthRows,
    activity: activities.map((activity) => ({
      id: activity.id,
      message: activity.message,
      createdAt: activity.createdAt,
      user: { id: activity.user.id, name: activity.user.name || activity.user.email },
      project: activity.project,
    })),
    shortcuts: { project: recentProject, note: lastNote },
  };
}
