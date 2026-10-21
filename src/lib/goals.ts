import "server-only";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { projectAccessWhere } from "@/lib/project-access";
import { formatTaskDayKey } from "@/lib/task-date-buckets";
import { toWallClock } from "@/lib/user-time";
import { shiftWeek, weekDayKeys, weekKeyOf, weekLabel, weeklyReview, weekStart } from "@/lib/weekly-review";

/** Tasks that count as "mine" in the review: ones I created, or ones assigned to me. */
export function myTasksWhere(userId: string) {
  return {
    deletedAt: null,
    AND: [
      { OR: [{ userId }, { project: projectAccessWhere(userId) }] },
      { OR: [{ userId }, { assignee: { userId } }] },
    ],
  } satisfies Prisma.TaskWhereInput;
}

/** Tasks the user can change: personal ones, or ones in projects where they're Owner or Editor. */
export function editableTaskWhere(userId: string) {
  return {
    deletedAt: null,
    OR: [
      { projectId: null, userId },
      { project: { OR: [{ userId }, { members: { some: { userId, role: { not: "VIEWER" } } } }] } },
    ],
  } satisfies Prisma.TaskWhereInput;
}

const taskSelect = { id: true, title: true, status: true, dueDate: true, completedAt: true, goalId: true } as const;

/** A valid week key from the request, or the user's current week. */
export function resolveWeek(value: string | null, now: Date) {
  return value && weekStart(value) ? value : weekKeyOf(now);
}

/** Due dates within these day keys, with a day of slack each side for time zones. */
function dueDateRange(dayKeys: string[]) {
  const [year, month, day] = dayKeys[0].split("-").map(Number);
  const [lastYear, lastMonth, lastDay] = dayKeys[dayKeys.length - 1].split("-").map(Number);
  return { gte: new Date(Date.UTC(year, month - 1, day - 1)), lt: new Date(Date.UTC(lastYear, lastMonth - 1, lastDay + 2)) };
}

/**
 * Everything the Goals page shows for one week: the week's goals with their
 * linked tasks, the review (done, slipped, next) and tasks to link.
 */
export async function loadGoalsWeek(userId: string, key: string, timeZone: string | null) {
  const now = toWallClock(timeZone);
  const nextKey = shiftWeek(key, 1);
  const days = [...weekDayKeys(key), ...weekDayKeys(nextKey)];
  const monday = weekStart(key) as Date;

  const [goals, weekTasks, candidates] = await Promise.all([
    prisma.weeklyGoal.findMany({
      where: { userId, targetWeek: { in: [key, nextKey] }, status: { not: "ARCHIVED" } },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        title: true,
        status: true,
        targetWeek: true,
        tasks: { where: { deletedAt: null }, orderBy: { createdAt: "asc" }, select: taskSelect },
      },
    }),
    prisma.task.findMany({
      where: {
        ...myTasksWhere(userId),
        OR: [
          { dueDate: dueDateRange(days) },
          // Completed this week: a day of slack each side, then filtered on the wall clock.
          { completedAt: { gte: new Date(monday.getTime() - 2 * 86_400_000), lt: new Date(monday.getTime() + 9 * 86_400_000) } },
        ],
      },
      orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
      select: taskSelect,
    }),
    prisma.task.findMany({
      where: { ...editableTaskWhere(userId), status: { not: "DONE" }, goalId: null },
      orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
      take: 100,
      select: { id: true, title: true },
    }),
  ]);

  const wall = <T extends { completedAt: Date | null }>(task: T) => ({
    ...task,
    completedAt: task.completedAt ? toWallClock(timeZone, task.completedAt) : null,
  });
  const review = weeklyReview(key, weekTasks.map(wall), goals, now);
  const serialize = (task: (typeof weekTasks)[number]) => ({
    id: task.id,
    title: task.title,
    status: task.status,
    goalId: task.goalId,
    dueDate: task.dueDate ? formatTaskDayKey(task.dueDate) : null,
  });
  const goalSummary = (goal: (typeof goals)[number]) => ({
    id: goal.id,
    title: goal.title,
    status: goal.status,
    targetWeek: goal.targetWeek,
    tasks: goal.tasks.map(serialize),
  });

  return {
    week: {
      key,
      label: weekLabel(key),
      previous: shiftWeek(key, -1),
      next: nextKey,
      isCurrent: key === weekKeyOf(now),
      // Friday to Sunday of the current week: time to review.
      reviewTime: key === weekKeyOf(now) && [5, 6, 0].includes(now.getDay()),
    },
    goals: goals.filter((goal) => goal.targetWeek === key).map(goalSummary),
    review: {
      done: review.done.map(serialize),
      slipped: review.slipped.map(serialize),
      openGoals: review.openGoals.map(goalSummary),
      nextTasks: review.nextTasks.map(serialize),
      nextGoals: review.nextGoals.map(goalSummary),
    },
    candidates,
  };
}

export type GoalsWeek = Awaited<ReturnType<typeof loadGoalsWeek>>;
