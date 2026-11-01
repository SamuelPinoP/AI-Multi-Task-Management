/**
 * Pure helpers for the home screen (DES-03). Every `now` here is the user's
 * wall clock (see `@/lib/user-time`), and every other Date is either a task
 * due date (a date without a time) or a wall-clock time already converted
 * with `toWallClock`.
 */
import { getLocalDateOnly } from "@/lib/task-date-buckets";

export type HomePriority = "HIGH" | "MEDIUM" | "LOW";
export type ProjectHealthStatus = "ON_TRACK" | "AT_RISK" | "STALE" | "NOT_STARTED";

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

/**
 * The automatic project status: overdue work is at risk, no updates for a week
 * is stale, and a project with nothing done or in progress hasn't started (DES-11).
 */
export function projectHealth(
  project: { totalTasks: number; doneTasks: number; inProgressTasks: number; overdueTasks: number; lastUpdate: Date },
  now: Date,
) {
  const percentDone = project.totalTasks ? Math.round((project.doneTasks / project.totalTasks) * 100) : 0;
  const idleDays = Math.max(0, -daysFrom(project.lastUpdate, now));
  const status: ProjectHealthStatus =
    project.overdueTasks > 0
      ? "AT_RISK"
      : idleDays >= STALE_AFTER_DAYS
        ? "STALE"
        : !project.doneTasks && !project.inProgressTasks
          ? "NOT_STARTED"
          : "ON_TRACK";
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

/** Bar heights from 0 to 1 for a 7-day chart, scaled to the busiest day (DES-10). */
export function barHeights(values: number[]) {
  const max = Math.max(0, ...values);
  return values.map((value) => (max ? value / max : 0));
}

/**
 * An Activity message as the rest of a sentence that starts with a name (DES-11):
 * "Created task: “Draft”" becomes "created the task “Draft”".
 */
export function activityAction(message: string) {
  const text = message.trim().replace(/\.$/, "");
  const labelled = text.match(/^([A-Z][a-z]+) ([a-z]+): (.+)$/);
  if (labelled) return `${labelled[1].toLowerCase()} the ${labelled[2]} ${labelled[3]}`;
  return /^[A-Z][a-z]/.test(text) ? text.charAt(0).toLowerCase() + text.slice(1) : text;
}

/** "45 min", "1 h" or "1 h 50 min". */
export function formatMinutes(minutes: number) {
  const total = Math.max(0, Math.round(minutes));
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (!hours) return `${rest} min`;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

/** Short names for the last `days` days, oldest first, ending with "Today". */
export function weekDayLabels(now: Date, days = 7) {
  const weekday = new Intl.DateTimeFormat("en-US", { weekday: "short" });
  return Array.from({ length: days }, (_, index) =>
    index === days - 1 ? "Today" : weekday.format(new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1 - index))),
  );
}

/** "Wed 0, Thu 1, …, Today 3": a 7-day series with its days, for screen readers. */
export function describeWeek(values: number[], now: Date) {
  const days = weekDayLabels(now, values.length);
  return values.map((value, index) => `${days[index]} ${value}`).join(", ");
}

/**
 * Home's "Now and next" band (DES-10). Now is the timed event under way at `now`,
 * or else the top Focus task; Next is the next timed event to start. Times are
 * wall-clock Dates (`eventWallTime`), and an event without an end time is never
 * under way. With no events and no tasks, the band is `empty`.
 */
export function nowAndNext<E extends { start: Date; end: Date | null; hasStartTime: boolean }, T>(
  events: E[],
  now: Date,
  focus: T[] = [],
) {
  const timed = events.filter((event) => event.hasStartTime).sort((a, b) => a.start.getTime() - b.start.getTime());
  const current = timed.find((event) => event.start <= now && event.end !== null && event.end > now) ?? null;
  return {
    current,
    task: current ? null : (focus[0] ?? null),
    next: timed.find((event) => event.start > now) ?? null,
    empty: !events.length && !focus.length,
  };
}

/**
 * The band's Suggested next: the planner's first suggestion that isn't an event
 * (Now and Next show those) or the task Now already shows.
 */
export function bandSuggestion<S extends { kind: string; related?: { type: string; id: string } }>(
  suggestions: S[],
  nowTaskId: string | null,
) {
  return (
    suggestions.find(
      (suggestion) =>
        suggestion.kind !== "EVENT" && !(suggestion.related?.type === "TASK" && suggestion.related.id === nowTaskId),
    ) ?? null
  );
}
