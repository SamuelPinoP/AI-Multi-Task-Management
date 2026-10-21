/**
 * Event times are stored as wall-clock values: the date and time the user
 * typed, written to the database as if they were UTC. "9:00 AM on Oct 20" is
 * stored as 2026-10-20T09:00:00.000Z whether the server runs in UTC (Vercel)
 * or in the developer's own time zone, and whatever time zone the browser is in.
 *
 * Read stored event times only through these helpers:
 *  - `formatEventTime` / `formatEventDateTime` / `eventTimeInputValue` show them.
 *  - `eventWallTime` turns one into a local Date with the same wall-clock
 *    fields, so it can be compared with other local dates (now, today's start,
 *    a calendar cell).
 *  - `toEventStorageTime` goes the other way, for query bounds and ranges.
 */

const DATE_INPUT_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_INPUT_PATTERN = /^(\d{2}):(\d{2})$/;

type DateParts = { year: number; month: number; day: number };
type TimeParts = { hours: number; minutes: number };

export type ParsedEventTimes = {
  startTime: Date;
  endTime: Date | null;
  hasStartTime: boolean;
  hasEndTime: boolean;
};

export type EventTimeInput = {
  startDate: unknown;
  startTime: unknown;
  endDate: unknown;
  endTime: unknown;
};

function isBlank(value: unknown) {
  return value === null || value === undefined || (typeof value === "string" && !value.trim());
}

/** Parses a `YYYY-MM-DD` value from an `<input type="date">`. */
function parseDateInput(value: unknown): DateParts | null {
  if (typeof value !== "string") return null;
  const match = DATE_INPUT_PATTERN.exec(value.trim());
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return null;
  }

  return { year, month, day };
}

/** Parses an `HH:MM` value from an `<input type="time">`. */
function parseTimeInput(value: unknown): TimeParts | null {
  if (typeof value !== "string") return null;
  const match = TIME_INPUT_PATTERN.exec(value.trim());
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return { hours, minutes };
}

function toStoredDate(date: DateParts, time: TimeParts | null) {
  return new Date(
    Date.UTC(date.year, date.month - 1, date.day, time?.hours ?? 0, time?.minutes ?? 0),
  );
}

function compareDates(a: DateParts, b: DateParts) {
  return a.year - b.year || a.month - b.month || a.day - b.day;
}

/**
 * Validates the date and time fields of an event request and converts them to
 * the stored wall-clock representation. The result never depends on the time
 * zone of the machine running it.
 */
export function parseEventTimes(
  input: EventTimeInput,
): { value: ParsedEventTimes; error?: undefined } | { error: string; value?: undefined } {
  if (isBlank(input.startDate)) return { error: "Start date is required" };

  const startDate = parseDateInput(input.startDate);
  if (!startDate) return { error: "Invalid start date" };

  const typedEndDate = isBlank(input.endDate) ? null : parseDateInput(input.endDate);
  if (!isBlank(input.endDate) && !typedEndDate) return { error: "Invalid end date" };

  const startTime = isBlank(input.startTime) ? null : parseTimeInput(input.startTime);
  if (!isBlank(input.startTime) && !startTime) return { error: "Invalid start time" };

  const endTime = isBlank(input.endTime) ? null : parseTimeInput(input.endTime);
  if (!isBlank(input.endTime) && !endTime) return { error: "Invalid end time" };

  // An end time without an end date ends on the start date ("9:00 to 9:15").
  const endDate = typedEndDate ?? (endTime ? startDate : null);

  if (endDate && compareDates(endDate, startDate) < 0) {
    return { error: "End date cannot be before start date" };
  }

  if (endDate && startTime && endTime && compareDates(endDate, startDate) === 0) {
    const startMinutes = startTime.hours * 60 + startTime.minutes;
    const endMinutes = endTime.hours * 60 + endTime.minutes;
    if (endMinutes <= startMinutes) {
      return { error: "End time must be after start time when dates are the same" };
    }
  }

  return {
    value: {
      startTime: toStoredDate(startDate, startTime),
      endTime: endDate ? toStoredDate(endDate, endTime) : null,
      hasStartTime: Boolean(startTime),
      hasEndTime: Boolean(endTime),
    },
  };
}

/**
 * Validates a repeating event's "Repeat until" date: the last day a repeat can
 * start on, stored as that date's midnight. Blank, or an event that doesn't
 * repeat, gives null (it keeps repeating, or has no repeats).
 */
export function parseRepeatUntil(
  input: { startDate: unknown; repeatUntil: unknown },
  repeats: boolean,
): { value: Date | null; error?: undefined } | { error: string; value?: undefined } {
  if (!repeats || isBlank(input.repeatUntil)) return { value: null };
  const until = parseDateInput(input.repeatUntil);
  if (!until) return { error: "Invalid repeat-until date" };
  const startDate = parseDateInput(input.startDate);
  if (startDate && compareDates(until, startDate) < 0) return { error: "Repeat until cannot be before the start date" };
  return { value: toStoredDate(until, null) };
}

/**
 * Returns a local Date whose year, month, day, hours and minutes match the
 * stored event's wall clock. Use it to compare an event with local dates.
 */
export function eventWallTime(value: string | Date) {
  const stored = new Date(value);
  return new Date(
    stored.getUTCFullYear(),
    stored.getUTCMonth(),
    stored.getUTCDate(),
    stored.getUTCHours(),
    stored.getUTCMinutes(),
    stored.getUTCSeconds(),
    stored.getUTCMilliseconds(),
  );
}

/** Converts a local Date into the stored wall-clock representation. */
export function toEventStorageTime(local: Date) {
  return new Date(
    Date.UTC(
      local.getFullYear(),
      local.getMonth(),
      local.getDate(),
      local.getHours(),
      local.getMinutes(),
      local.getSeconds(),
      local.getMilliseconds(),
    ),
  );
}

/** Formats a stored event time as a short time, e.g. "9:00 AM". */
export function formatEventTime(value: string | Date) {
  return new Intl.DateTimeFormat("en-US", {
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}

/** Formats a stored event time as a date and time, e.g. "Oct 20, 2026, 9:00 AM". */
export function formatEventDateTime(value: string | Date) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}

/** Returns the `HH:MM` value an `<input type="time">` needs for a stored event time. */
export function eventTimeInputValue(value: string | Date) {
  const stored = new Date(value);
  const hours = String(stored.getUTCHours()).padStart(2, "0");
  const minutes = String(stored.getUTCMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}
