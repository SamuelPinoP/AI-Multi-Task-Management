/**
 * Project health and insights (SMART-03): progress, a burn-up chart from
 * `completedAt`, the overdue ratio, stale tasks and an automatic status.
 *
 * Like `@/lib/home-summary`, every Date here is the user's wall clock (convert
 * timestamps with `toWallClock` first), except due dates, which have no time.
 */
import { daysFrom, projectHealth, type ProjectHealthStatus } from "@/lib/home-summary";

/** Open tasks with no update for this many days are listed as stale. */
export const STALE_TASK_DAYS = 14;
/** The burn-up chart covers at most 12 weeks and at least one. */
const MAX_BURN_UP_DAYS = 84;
const MIN_BURN_UP_DAYS = 7;
const DAY_MS = 86_400_000;

export type InsightTask = {
  id: string;
  title: string;
  status: "TODO" | "IN_PROGRESS" | "DONE";
  dueDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
};

export type BurnUpPoint = { date: Date; scope: number; done: number };

export type ProjectInsights = {
  total: number;
  open: number;
  done: number;
  percentDone: number;
  overdue: number;
  /** Overdue share of open tasks, 0 to 100. */
  overduePercent: number;
  doneThisWeek: number;
  staleTasks: Array<{ id: string; title: string; idleDays: number }>;
  status: ProjectHealthStatus;
  /** One line explaining the status. */
  reason: string;
  burnUp: BurnUpPoint[];
};

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/** When a finished task was completed; older tasks without `completedAt` fall back to their last update. */
function completionDate(task: InsightTask) {
  return task.status === "DONE" ? (task.completedAt ?? task.updatedAt) : null;
}

/**
 * Tasks in scope and tasks done at the end of each day, from the first task to
 * today: daily up to a month, weekly beyond that, capped at 12 weeks.
 */
export function burnUp(tasks: InsightTask[], now: Date): BurnUpPoint[] {
  const today = startOfDay(now);
  const earliest = tasks.reduce((min, task) => (task.createdAt < min ? task.createdAt : min), today);
  const days = Math.round((today.getTime() - startOfDay(earliest).getTime()) / DAY_MS);
  const clamped = Math.max(MIN_BURN_UP_DAYS, Math.min(MAX_BURN_UP_DAYS, days));
  const step = clamped > 31 ? 7 : 1;
  const span = Math.ceil(clamped / step) * step;

  const points: BurnUpPoint[] = [];
  for (let offset = span; offset >= 0; offset -= step) {
    const date = addDays(today, -offset);
    const end = addDays(date, 1);
    points.push({
      date,
      scope: tasks.filter((task) => task.createdAt < end).length,
      done: tasks.filter((task) => {
        const completed = completionDate(task);
        return completed !== null && completed < end;
      }).length,
    });
  }
  return points;
}

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

export function projectInsights(tasks: InsightTask[], project: { updatedAt: Date }, now: Date): ProjectInsights {
  const openTasks = tasks.filter((task) => task.status !== "DONE");
  const done = tasks.length - openTasks.length;
  const overdue = openTasks.filter((task) => task.dueDate && daysFrom(task.dueDate, now) < 0).length;
  const doneThisWeek = tasks.filter((task) => {
    const completed = completionDate(task);
    return completed !== null && daysFrom(completed, now) > -7;
  }).length;
  const staleTasks = openTasks
    .map((task) => ({ id: task.id, title: task.title, idleDays: -daysFrom(task.updatedAt, now) }))
    .filter((task) => task.idleDays >= STALE_TASK_DAYS)
    .sort((a, b) => b.idleDays - a.idleDays);

  const inProgress = openTasks.filter((task) => task.status === "IN_PROGRESS").length;
  const lastUpdate = tasks.reduce((latest, task) => (task.updatedAt > latest ? task.updatedAt : latest), project.updatedAt);
  const health = projectHealth({ totalTasks: tasks.length, doneTasks: done, inProgressTasks: inProgress, overdueTasks: overdue, lastUpdate }, now);
  const reason =
    health.status === "AT_RISK"
      ? `${plural(overdue, "task")} past due`
      : health.status === "STALE"
        ? `No updates in ${plural(health.idleDays, "day")}`
        : tasks.length === 0
          ? "No tasks yet"
          : health.status === "NOT_STARTED"
            ? "No task done or in progress yet"
            : openTasks.length === 0
              ? "Every task is done"
              : "Nothing is overdue";

  return {
    total: tasks.length,
    open: openTasks.length,
    done,
    percentDone: health.percentDone,
    overdue,
    overduePercent: openTasks.length ? Math.round((overdue / openTasks.length) * 100) : 0,
    doneThisWeek,
    staleTasks,
    status: health.status,
    reason,
    burnUp: burnUp(tasks, now),
  };
}
