export type TaskDateBucket = "OVERDUE" | "DUE_TODAY" | "UPCOMING";

const DAY_MS = 86_400_000;

function parseLocalDateOnly(value: Date | string) {
  if (typeof value === "string") {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
    if (match) {
      return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    }
    const parsed = new Date(value);
    return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
  }

  if (
    value.getUTCHours() === 0 &&
    value.getUTCMinutes() === 0 &&
    value.getUTCSeconds() === 0 &&
    value.getUTCMilliseconds() === 0
  ) {
    return new Date(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());
  }

  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

export function getLocalDateOnly(value: Date | string) {
  return parseLocalDateOnly(value);
}

export function formatTaskDueDate(value: Date | string, locales?: Intl.LocalesArgument) {
  return new Intl.DateTimeFormat(locales).format(getLocalDateOnly(value));
}

export function formatTaskDueDateInput(value: Date | string) {
  return formatTaskDayKey(getLocalDateOnly(value));
}

export function formatTaskDayKey(value: Date | string) {
  const date = getLocalDateOnly(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function parseTaskDueDateForStorage(value: string) {
  const date = getLocalDateOnly(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function compareTaskDueDates(
  a: Date | string | null | undefined,
  b: Date | string | null | undefined,
) {
  const aTime = a ? getLocalDateOnly(a).getTime() : Number.POSITIVE_INFINITY;
  const bTime = b ? getLocalDateOnly(b).getTime() : Number.POSITIVE_INFINITY;
  return aTime - bTime;
}

export function getTaskDateBucket(
  dueDate: Date | string | null | undefined,
  now: Date | string = new Date(),
): TaskDateBucket | null {
  if (!dueDate) return null;

  const dueStart = parseLocalDateOnly(dueDate);
  const todayStart = parseLocalDateOnly(now);
  const dayDiff = Math.round((dueStart.getTime() - todayStart.getTime()) / DAY_MS);

  if (dayDiff < 0) return "OVERDUE";
  if (dayDiff === 0) return "DUE_TODAY";
  return "UPCOMING";
}

export function isOverdueTask(
  dueDate: Date | string | null | undefined,
  now: Date | string = new Date(),
) {
  return getTaskDateBucket(dueDate, now) === "OVERDUE";
}

export function isDueTodayTask(
  dueDate: Date | string | null | undefined,
  now: Date | string = new Date(),
) {
  return getTaskDateBucket(dueDate, now) === "DUE_TODAY";
}
