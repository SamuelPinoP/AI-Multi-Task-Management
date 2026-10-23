import { toEventStorageTime } from "@/lib/event-time";

export const RECURRENCE_VALUES = [
  "NONE",
  "DAILY",
  "WEEKLY",
  "BIWEEKLY",
  "MONTHLY",
] as const;

export type RecurrenceValue = (typeof RECURRENCE_VALUES)[number];

export function isValidRecurrence(value: unknown): value is RecurrenceValue {
  return typeof value === "string" && RECURRENCE_VALUES.includes(value as RecurrenceValue);
}

export function normalizeRecurrence(value: unknown): RecurrenceValue {
  return isValidRecurrence(value) ? value : "NONE";
}

export function formatRecurrenceLabel(value: unknown) {
  const recurrence = normalizeRecurrence(value);
  if (recurrence === "NONE") return "No";
  if (recurrence === "BIWEEKLY") return "every 2 weeks";
  return recurrence.toLowerCase();
}

/** "Repeats weekly", or "Repeats weekly until Dec 31, 2026". */
export function describeRepeat(recurrence: unknown, repeatUntil?: string | Date | null) {
  const label = `Repeats ${formatRecurrenceLabel(recurrence)}`;
  if (!repeatUntil) return label;
  const until = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(repeatUntil));
  return `${label} until ${until}`;
}

export type RecurringEventBase = {
  id: string;
  startTime: string;
  /** The end of the first occurrence; every repeat lasts as long. */
  endTime: string | null;
  hasStartTime?: boolean;
  hasEndTime?: boolean;
  recurrence?: RecurrenceValue | null;
  /** The last day a repeat can start on (a stored wall-clock date). Empty: it keeps repeating. */
  repeatUntil?: string | Date | null;
  /** Days deleted from the series (stored dates); no repeat starts on them (CAL-03). */
  skippedDates?: Array<string | Date> | null;
};

/** The fields that set how long each occurrence lasts (stored values, as strings or Dates). */
type OccurrenceTimes = {
  startTime: string | Date;
  endTime: string | Date | null;
  recurrence?: RecurrenceValue | null;
  repeatUntil?: string | Date | null;
};

const DAY_MS = 86_400_000;
const STEP_DAYS = { DAILY: 1, WEEKLY: 7, BIWEEKLY: 14 } as const;
const MAX_OCCURRENCES = 1000;

/** `YYYY-MM-DD` of a stored wall-clock value: the local day it falls on. */
export function storedDayKey(value: string | Date) {
  return new Date(value).toISOString().slice(0, 10);
}

/**
 * Before "Repeat until" existed, a repeating event's end date was also the end
 * of its series. The migration that added `repeatUntil` copied those end dates
 * into it, so such an event ends on its `repeatUntil` day, later than it starts.
 * Each of its repeats ends at the end time on its own day.
 */
function endsWithItsSeries(event: OccurrenceTimes) {
  if (normalizeRecurrence(event.recurrence) === "NONE" || !event.endTime || !event.repeatUntil) return false;
  const endDay = storedDayKey(event.endTime);
  return endDay === storedDayKey(event.repeatUntil) && endDay > storedDayKey(event.startTime);
}

/** How long each occurrence of an event lasts, in milliseconds. */
export function occurrenceDurationMs(event: OccurrenceTimes) {
  if (!event.endTime) return 0;
  const duration = new Date(event.endTime).getTime() - new Date(event.startTime).getTime();
  // Same clock time as the stored end, on the day each repeat starts (or the next day, if it ends before it starts).
  return endsWithItsSeries(event) ? duration % DAY_MS : duration;
}

/** The end of an event's first occurrence (what an edit form shows as its end). */
export function firstOccurrenceEnd(event: OccurrenceTimes) {
  if (!event.endTime) return null;
  return new Date(new Date(event.startTime).getTime() + occurrenceDurationMs(event)).toISOString();
}

/** The `n`th repeat after `base`. Monthly repeats stay on the same day, or the month's last day when it is shorter. */
function nthOccurrence(base: Date, recurrence: Exclude<RecurrenceValue, "NONE">, n: number) {
  if (recurrence !== "MONTHLY") return new Date(base.getTime() + n * STEP_DAYS[recurrence] * DAY_MS);
  const year = base.getUTCFullYear();
  const month = base.getUTCMonth() + n;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(year, month, Math.min(base.getUTCDate(), lastDay), base.getUTCHours(), base.getUTCMinutes(), base.getUTCSeconds(), base.getUTCMilliseconds()),
  );
}

/** The first `n` whose occurrence could fall on or after `rangeStart`. */
function firstIndexInRange(base: Date, recurrence: Exclude<RecurrenceValue, "NONE">, rangeStart: Date) {
  if (rangeStart <= base) return 0;
  if (recurrence !== "MONTHLY") return Math.floor((rangeStart.getTime() - base.getTime()) / (STEP_DAYS[recurrence] * DAY_MS));
  const months = (rangeStart.getUTCFullYear() - base.getUTCFullYear()) * 12 + rangeStart.getUTCMonth() - base.getUTCMonth();
  return Math.max(0, months - 1);
}

/** Whether a repeat of `event` starts on `dayKey` (`YYYY-MM-DD`), counting skipped days. */
export function repeatsOnDay(event: RecurringEventBase, dayKey: string) {
  const [year, month, day] = dayKey.split("-").map(Number);
  const dayStart = new Date(year, month - 1, day);
  const dayEnd = new Date(year, month - 1, day, 23, 59, 59, 999);
  return expandRecurringEventsForRange([{ ...event, skippedDates: [] }], dayStart, dayEnd).length > 0;
}

/**
 * Expands recurring events into the occurrences between `localRangeStart` and
 * `localRangeEnd`. The bounds are local dates (like a calendar's first and last
 * cell); event times are stored as wall-clock values (see `@/lib/event-time`),
 * so the bounds are converted to that form before comparing.
 *
 * Each occurrence lasts as long as the first one (`startTime` to `endTime`).
 * A series stops after its `repeatUntil` day, or keeps going when it has none,
 * and has no occurrence on its `skippedDates`.
 */
export function expandRecurringEventsForRange<T extends RecurringEventBase>(
  events: T[],
  localRangeStart: Date,
  localRangeEnd: Date
): T[] {
  const rangeStart = toEventStorageTime(localRangeStart);
  const rangeEnd = toEventStorageTime(localRangeEnd);

  return events.flatMap((event) => {
    const recurrence = normalizeRecurrence(event.recurrence);
    if (recurrence === "NONE") {
      const eventStart = new Date(event.startTime);
      if (eventStart < rangeStart || eventStart > rangeEnd) return [];
      return [event];
    }

    const baseStart = new Date(event.startTime);
    const seriesEnd = event.repeatUntil ? new Date(`${storedDayKey(event.repeatUntil)}T23:59:59.999Z`) : null;
    const lastStart = seriesEnd && seriesEnd < rangeEnd ? seriesEnd : rangeEnd;
    const durationMs = occurrenceDurationMs(event);
    const skipped = new Set((event.skippedDates ?? []).map(storedDayKey));
    const expanded: T[] = [];

    for (let n = firstIndexInRange(baseStart, recurrence, rangeStart); expanded.length < MAX_OCCURRENCES; n += 1) {
      const occurrenceStart = nthOccurrence(baseStart, recurrence, n);
      if (occurrenceStart > lastStart) break;
      if (occurrenceStart < rangeStart) continue;
      if (skipped.has(storedDayKey(occurrenceStart))) continue;
      expanded.push({
        ...event,
        id: `${event.id}-${occurrenceStart.toISOString()}`,
        startTime: occurrenceStart.toISOString(),
        endTime: event.hasEndTime && event.endTime ? new Date(occurrenceStart.getTime() + durationMs).toISOString() : null,
      });
    }

    return expanded;
  });
}
