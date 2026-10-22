/**
 * Pure helpers for the home screen (DES-03). Every `now` here is the user's
 * wall clock (see `@/lib/user-time`), and every other Date is either a task
 * due date (a date without a time) or a wall-clock time already converted
 * with `toWallClock`.
 */
import { getLocalDateOnly } from "@/lib/task-date-buckets";

export type HomePriority = "HIGH" | "MEDIUM" | "LOW";
export type ProjectHealthStatus = "ON_TRACK" | "AT_RISK" | "STALE";

const DAY_MS = 86_400_000;
/** Days without an update before an active project counts as stale. */
export const STALE_AFTER_DAYS = 7;

const priorityRank: Record<HomePriority, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };

/** Whole days from `now`'s date to `date`'s date (negative = in the past). */
export function daysFrom(date: Date | string, now: Date) {
  return Math.round((getLocalDateOnly(date).getTime() - getLocalDateOnly(now).getTime()) / DAY_MS);
}

/** Overdue first, then due today, upcoming, and no due date; then by date and priority. */
export function sortFocusTasks<T extends { dueDate: Date | string | null; priority: HomePriority }>(tasks: T[], now: Date) {
  const bucket = (task: T) => {
    if (!task.dueDate) return 3;
    const diff = daysFrom(task.dueDate, now);
    return diff < 0 ? 0 : diff === 0 ? 1 : 2;
  };
  const time = (task: T) => (task.dueDate ? getLocalDateOnly(task.dueDate).getTime() : Number.POSITIVE_INFINITY);

  return [...tasks].sort(
    (a, b) => bucket(a) - bucket(b) || time(a) - time(b) || priorityRank[a.priority] - priorityRank[b.priority],
  );
}

/** "3 days late", "Yesterday", "Today", "Tomorrow", "Tue", or "Oct 30". */
export function dueLabel(dueDate: Date | string, now: Date) {
  const diff = daysFrom(dueDate, now);
  if (diff < -1) return `${-diff} days late`;
  if (diff === -1) return "Yesterday";
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  const date = getLocalDateOnly(dueDate);
  if (diff < 7) return new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(date);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(date);
}

/** How many of `dates` fall on each of the last `days` days, oldest first, ending today. */
export function dailyCounts(dates: Array<Date | string>, now: Date, days = 7) {
  const counts = Array.from({ length: days }, () => 0);
  for (const date of dates) {
    const index = days - 1 + daysFrom(date, now);
    if (index >= 0 && index < days) counts[index] += 1;
  }
  return counts;
}

/**
 * Open-and-overdue task counts at the end of each of the last `days` days.
 * A task counts on day D when it existed by then, was due before D, and was
 * not completed by the end of D.
 */
export function overdueCounts(
  tasks: Array<{ dueDate: Date | string; createdAt: Date; completedAt: Date | null }>,
  now: Date,
  days = 7,
) {
  return Array.from({ length: days }, (_, index) => {
    const offset = index - (days - 1);
    return tasks.filter((task) => {
      const created = daysFrom(task.createdAt, now) <= offset;
      const dueBefore = daysFrom(task.dueDate, now) < offset;
      const openAtEnd = !task.completedAt || daysFrom(task.completedAt, now) > offset;
      return created && dueBefore && openAtEnd;
    }).length;
  });
}

/** The automatic project status: overdue work is at risk, no updates for a week is stale. */
export function projectHealth(
  project: { totalTasks: number; doneTasks: number; overdueTasks: number; lastUpdate: Date },
  now: Date,
) {
  const percentDone = project.totalTasks ? Math.round((project.doneTasks / project.totalTasks) * 100) : 0;
  const idleDays = Math.max(0, -daysFrom(project.lastUpdate, now));
  const status: ProjectHealthStatus =
    project.overdueTasks > 0 ? "AT_RISK" : idleDays >= STALE_AFTER_DAYS ? "STALE" : "ON_TRACK";
  return { status, percentDone, idleDays };
}

export function greetingFor(hour: number) {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/** "4 tasks due today and 2 overdue." with the plural and empty cases. */
export function taskSummary(dueToday: number, overdue: number) {
  const tasks = (count: number) => `${count} task${count === 1 ? "" : "s"}`;
  if (!dueToday && !overdue) return "Nothing is due today.";
  if (!dueToday) return `${tasks(overdue)} overdue.`;
  return overdue ? `${tasks(dueToday)} due today and ${overdue} overdue.` : `${tasks(dueToday)} due today.`;
}

/**
 * "now", "12m", "3h", "2d", then a short date. Both arguments are real instants.
 * The date is in `timeZone` when given; the server passes the user's, since its own is UTC.
 */
export function relativeTime(instant: Date, realNow: Date, timeZone?: string | null) {
  const minutes = Math.floor((realNow.getTime() - instant.getTime()) / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: timeZone ?? undefined }).format(instant);
}

/** SVG paths for a sparkline: the line and the area under it. */
export function sparklinePaths(values: number[], width = 72, height = 26, padding = 3) {
  if (values.length === 0) return { line: "", area: "", last: { x: 0, y: height } };
  const max = Math.max(...values, 1);
  const step = values.length > 1 ? width / (values.length - 1) : 0;
  const points = values.map((value, index) => ({
    x: Number((index * step).toFixed(2)),
    y: Number((height - padding - (value / max) * (height - padding * 2)).toFixed(2)),
  }));
  const line = points.map((point, index) => `${index ? "L" : "M"}${point.x} ${point.y}`).join(" ");
  const area = `${line} L${points[points.length - 1].x} ${height} L0 ${height}Z`;
  return { line, area, last: points[points.length - 1] };
}
