// Kept free of server-only imports so it can be unit tested with plain Node.

/** Whether `value` is a time zone this runtime knows, such as "America/New_York". */
export function isTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || !value || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** The date ("YYYY-MM-DD") and hour on the wall clock of `timeZone` at `now`. */
export function wallClock(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "00";
  return { date: `${part("year")}-${part("month")}-${part("day")}`, hour: Number(part("hour")) };
}

/** A "YYYY-MM-DD" date `days` later (or earlier). */
export function shiftDate(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

const time = (hour: number, minute = 0) => `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;

/**
 * The dates in a new guest's sample workspace (#460), on the visitor's own calendar: tasks due
 * yesterday, today and tomorrow, so Home has something overdue, due and coming, and a design review
 * two hours from now, which Home shows as Next. Late in the evening the review moves to tomorrow
 * morning. The team standup repeats every week from tomorrow.
 */
export function sampleSchedule(now: Date, timeZone: string) {
  const { date: today, hour } = wallClock(now, timeZone);
  const reviewHour = hour + 2;
  const review =
    reviewHour <= 20
      ? { date: today, start: time(reviewHour), end: time(reviewHour, 30) }
      : { date: shiftDate(today, 1), start: time(10), end: time(10, 30) };
  return {
    yesterday: shiftDate(today, -1),
    today,
    tomorrow: shiftDate(today, 1),
    review,
    standup: { date: shiftDate(today, 1), start: time(9, 30), end: time(9, 45) },
  };
}
