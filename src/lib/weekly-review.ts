/**
 * Goals and the weekly review (SMART-04). Weeks run Monday to Sunday and are
 * keyed by ISO week, e.g. "2026-W43" (stored in WeeklyGoal.targetWeek).
 *
 * Every Date here is the user's wall clock (see `@/lib/user-time`) or a task
 * due date (a date without a time).
 */
import { formatTaskDayKey } from "@/lib/task-date-buckets";

const WEEK_KEY = /^(\d{4})-W(\d{2})$/;

function addDays(date: Date, days: number) {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  result.setDate(result.getDate() + days);
  return result;
}

/** Monday of the week that holds `date`, at local midnight. */
export function mondayOf(date: Date) {
  return addDays(date, -((date.getDay() + 6) % 7));
}

/** The ISO week key of a date: the week belongs to the year of its Thursday. */
export function weekKeyOf(date: Date) {
  const thursday = addDays(mondayOf(date), 3);
  const firstThursday = addDays(mondayOf(new Date(thursday.getFullYear(), 0, 4)), 3);
  const week = Math.round((thursday.getTime() - firstThursday.getTime()) / (7 * 86_400_000)) + 1;
  return `${thursday.getFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** Monday of a week key, or null when the key isn't a real week. */
export function weekStart(key: string) {
  const match = WEEK_KEY.exec(key);
  if (!match) return null;
  const year = Number(match[1]);
  const week = Number(match[2]);
  if (week < 1 || week > 53) return null;
  const monday = addDays(mondayOf(new Date(year, 0, 4)), (week - 1) * 7);
  return weekKeyOf(monday) === key ? monday : null;
}

export function shiftWeek(key: string, weeks: number) {
  const monday = weekStart(key);
  return monday ? weekKeyOf(addDays(monday, weeks * 7)) : key;
}

/** "Oct 19 – 25", or "Oct 26 – Nov 1" across months. */
export function weekLabel(key: string) {
  const monday = weekStart(key);
  if (!monday) return key;
  const sunday = addDays(monday, 6);
  const month = (date: Date) => date.toLocaleDateString("en-US", { month: "short" });
  return month(monday) === month(sunday)
    ? `${month(monday)} ${monday.getDate()} – ${sunday.getDate()}`
    : `${month(monday)} ${monday.getDate()} – ${month(sunday)} ${sunday.getDate()}`;
}

/** The week's days as YYYY-MM-DD keys, Monday first. */
export function weekDayKeys(key: string) {
  const monday = weekStart(key);
  return monday ? Array.from({ length: 7 }, (_, index) => formatTaskDayKey(addDays(monday, index))) : [];
}

/** The same weekday a week later, as a YYYY-MM-DD key. */
export function nextWeekDayKey(dueDate: Date | string) {
  const [year, month, day] = formatTaskDayKey(dueDate).split("-").map(Number);
  return formatTaskDayKey(addDays(new Date(year, month - 1, day), 7));
}

type ReviewTask = {
  id: string;
  title: string;
  status: "TODO" | "IN_PROGRESS" | "DONE";
  dueDate: Date | null;
  /** Wall clock. */
  completedAt: Date | null;
};
type ReviewGoal = { id: string; title: string; status: "ACTIVE" | "COMPLETED" | "ARCHIVED"; targetWeek: string };

export type WeeklyReview<T extends ReviewTask, G extends ReviewGoal> = {
  done: T[];
  /** Due this week (up to today) and still open. */
  slipped: T[];
  /** This week's goals that aren't achieved. */
  openGoals: G[];
  /** Due next week, and next week's goals. */
  nextTasks: T[];
  nextGoals: G[];
};

/**
 * Sorts a week's tasks and goals into what got done, what slipped and what's
 * next. `now` decides how much of the current week has passed.
 */
export function weeklyReview<T extends ReviewTask, G extends ReviewGoal>(
  key: string,
  tasks: T[],
  goals: G[],
  now: Date,
): WeeklyReview<T, G> {
  const days = weekDayKeys(key);
  const nextKey = shiftWeek(key, 1);
  const nextDays = new Set(weekDayKeys(nextKey));
  const today = formatTaskDayKey(now);
  const thisWeek = new Set(days);
  const passed = new Set(days.filter((day) => day <= today));

  return {
    done: tasks.filter((task) => task.status === "DONE" && task.completedAt && thisWeek.has(formatTaskDayKey(task.completedAt))),
    slipped: tasks.filter((task) => task.status !== "DONE" && task.dueDate && passed.has(formatTaskDayKey(task.dueDate))),
    openGoals: goals.filter((goal) => goal.targetWeek === key && goal.status === "ACTIVE"),
    nextTasks: tasks.filter((task) => task.status !== "DONE" && task.dueDate && nextDays.has(formatTaskDayKey(task.dueDate))),
    nextGoals: goals.filter((goal) => goal.targetWeek === nextKey && goal.status !== "ARCHIVED"),
  };
}
