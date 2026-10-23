// The calendar subscription feed (SMART-09) as iCalendar text (RFC 5545).
// Pure functions only; src/app/api/calendar/[file]/route.ts loads the data.
//
// Event times are stored as wall-clock values (see @/lib/event-time), so they
// go out as "floating" times with no time zone: 9:00 stays 9:00 in whatever
// time zone the calendar app is in, as it does in AI Multi.

import { firstOccurrenceEnd, normalizeRecurrence, type RecurrenceValue } from "@/lib/recurrence";

export type FeedEvent = {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  startTime: Date;
  endTime: Date | null;
  hasStartTime: boolean;
  hasEndTime: boolean;
  recurrence: RecurrenceValue;
  repeatUntil: Date | null;
  /** Days deleted from the series (CAL-03); they go out as EXDATE. */
  skippedDates: Date[];
  updatedAt: Date;
  projectName: string | null;
};

export type FeedTask = {
  id: string;
  title: string;
  description: string | null;
  dueDate: Date;
  updatedAt: Date;
  projectName: string | null;
};

const DAY_MS = 86_400_000;
const UID_DOMAIN = "ai-multi";

/** Escapes a TEXT value: backslashes, semicolons, commas and line breaks. */
export function escapeText(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Folds a content line to at most 75 octets, continuing with a space (RFC 5545 §3.1). */
export function foldLine(line: string) {
  const encoder = new TextEncoder();
  const parts: string[] = [];
  let current = "";
  let size = 0;
  for (const char of line) {
    const charSize = encoder.encode(char).length;
    // Continuation lines start with a space, which counts toward their 75.
    const limit = parts.length === 0 ? 75 : 74;
    if (size + charSize > limit) {
      parts.push(current);
      current = "";
      size = 0;
    }
    current += char;
    size += charSize;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

const pad = (value: number) => String(value).padStart(2, "0");

/** `YYYYMMDD` of a stored wall-clock value. */
function dateValue(value: Date) {
  return `${value.getUTCFullYear()}${pad(value.getUTCMonth() + 1)}${pad(value.getUTCDate())}`;
}

/** Floating `YYYYMMDDTHHMMSS` of a stored wall-clock value. */
function floatingDateTime(value: Date) {
  return `${dateValue(value)}T${pad(value.getUTCHours())}${pad(value.getUTCMinutes())}${pad(value.getUTCSeconds())}`;
}

/** A real instant in UTC, for DTSTAMP. */
function utcDateTime(value: Date) {
  return `${floatingDateTime(value)}Z`;
}

function startOfNextDay(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()) + DAY_MS);
}

/**
 * The repeat rule, matching @/lib/recurrence: monthly repeats on the 29th to
 * 31st fall on the month's last day when it is shorter, which BYSETPOS=-1
 * over the candidate days expresses. `repeatUntil` is the last day a repeat
 * can start on.
 */
export function repeatRule(event: Pick<FeedEvent, "recurrence" | "repeatUntil" | "startTime" | "hasStartTime">) {
  const recurrence = normalizeRecurrence(event.recurrence);
  if (recurrence === "NONE") return null;
  const parts =
    recurrence === "DAILY"
      ? ["FREQ=DAILY"]
      : recurrence === "WEEKLY"
        ? ["FREQ=WEEKLY"]
        : recurrence === "BIWEEKLY"
          ? ["FREQ=WEEKLY", "INTERVAL=2"]
          : ["FREQ=MONTHLY"];
  const day = event.startTime.getUTCDate();
  if (recurrence === "MONTHLY" && day > 28) {
    const days = Array.from({ length: day - 27 }, (_, index) => 28 + index);
    parts.push(`BYMONTHDAY=${days.join(",")}`, "BYSETPOS=-1");
  }
  if (event.repeatUntil) {
    // UNTIL takes the same form as DTSTART: a date for all-day events, else a floating time.
    parts.push(`UNTIL=${event.hasStartTime ? `${dateValue(event.repeatUntil)}T235959` : dateValue(event.repeatUntil)}`);
  }
  return parts.join(";");
}

/**
 * The days left out of a repeat, in the same form as DTSTART: dates for
 * all-day events, else the start time on each day.
 */
export function exceptionDates(event: Pick<FeedEvent, "skippedDates" | "startTime" | "hasStartTime">) {
  if (!event.skippedDates.length) return null;
  const time = `T${pad(event.startTime.getUTCHours())}${pad(event.startTime.getUTCMinutes())}${pad(event.startTime.getUTCSeconds())}`;
  const values = [...event.skippedDates]
    .sort((a, b) => a.getTime() - b.getTime())
    .map((day) => (event.hasStartTime ? `${dateValue(day)}${time}` : dateValue(day)));
  return event.hasStartTime ? `EXDATE:${values.join(",")}` : `EXDATE;VALUE=DATE:${values.join(",")}`;
}

function eventLines(event: FeedEvent, appUrl: string) {
  const end = firstOccurrenceEnd(event);
  const endDate = end ? new Date(end) : null;
  const lines = [
    "BEGIN:VEVENT",
    `UID:event-${event.id}@${UID_DOMAIN}`,
    `DTSTAMP:${utcDateTime(event.updatedAt)}`,
    `SUMMARY:${escapeText(event.title)}`,
  ];

  if (!event.hasStartTime) {
    // All day: DTEND is the day after the last day.
    lines.push(`DTSTART;VALUE=DATE:${dateValue(event.startTime)}`);
    lines.push(`DTEND;VALUE=DATE:${dateValue(startOfNextDay(endDate ?? event.startTime))}`);
  } else {
    lines.push(`DTSTART:${floatingDateTime(event.startTime)}`);
    // An end date without an end time runs to the end of that day.
    if (endDate) lines.push(`DTEND:${floatingDateTime(event.hasEndTime ? endDate : startOfNextDay(endDate))}`);
  }

  const rule = repeatRule(event);
  if (rule) {
    lines.push(`RRULE:${rule}`);
    const exceptions = exceptionDates(event);
    if (exceptions) lines.push(exceptions);
  }
  if (event.location) lines.push(`LOCATION:${escapeText(event.location)}`);
  const description = [event.projectName ? `Project: ${event.projectName}` : null, event.description].filter(Boolean).join("\n\n");
  if (description) lines.push(`DESCRIPTION:${escapeText(description)}`);
  lines.push(`URL:${appUrl}/events`, "END:VEVENT");
  return lines;
}

function taskLines(task: FeedTask, appUrl: string) {
  const description = [task.projectName ? `Project: ${task.projectName}` : null, task.description].filter(Boolean).join("\n\n");
  return [
    "BEGIN:VEVENT",
    `UID:task-${task.id}@${UID_DOMAIN}`,
    `DTSTAMP:${utcDateTime(task.updatedAt)}`,
    `SUMMARY:${escapeText(`Due: ${task.title}`)}`,
    `DTSTART;VALUE=DATE:${dateValue(task.dueDate)}`,
    `DTEND;VALUE=DATE:${dateValue(startOfNextDay(task.dueDate))}`,
    // Free time: a due date is a reminder, not a meeting.
    "TRANSP:TRANSPARENT",
    ...(description ? [`DESCRIPTION:${escapeText(description)}`] : []),
    `URL:${appUrl}/tasks`,
    "END:VEVENT",
  ];
}

/** The whole feed, with CRLF line endings and folded lines. */
export function buildCalendarFeed({ events, tasks, appUrl }: { events: FeedEvent[]; tasks: FeedTask[]; appUrl: string }) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//AI Multi//Calendar feed//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:AI Multi",
    "X-WR-CALDESC:Events and due tasks from AI Multi",
    // Ask calendar apps to check for changes every hour (most decide for themselves).
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
    ...events.flatMap((event) => eventLines(event, appUrl)),
    ...tasks.flatMap((task) => taskLines(task, appUrl)),
    "END:VCALENDAR",
  ];
  return `${lines.map(foldLine).join("\r\n")}\r\n`;
}

/** Feed links are `<token>.ics`; the token is 24 random bytes in base64url. */
export function tokenFromFeedFile(file: string) {
  const match = /^([A-Za-z0-9_-]{32})\.ics$/.exec(file);
  return match ? match[1] : null;
}
