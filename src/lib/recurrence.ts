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

export type RecurringEventBase = {
  id: string;
  startTime: string;
  endTime: string | null;
  hasStartTime?: boolean;
  hasEndTime?: boolean;
  recurrence?: RecurrenceValue | null;
};

function isSameOrBefore(a: Date, b: Date) {
  return a.getTime() <= b.getTime();
}

function addByRecurrence(date: Date, recurrence: RecurrenceValue) {
  const next = new Date(date);
  if (recurrence === "DAILY") next.setUTCDate(next.getUTCDate() + 1);
  if (recurrence === "WEEKLY") next.setUTCDate(next.getUTCDate() + 7);
  if (recurrence === "BIWEEKLY") next.setUTCDate(next.getUTCDate() + 14);
  if (recurrence === "MONTHLY") next.setUTCMonth(next.getUTCMonth() + 1);
  return next;
}

export function expandRecurringEventsForRange<T extends RecurringEventBase>(
  events: T[],
  rangeStart: Date,
  rangeEnd: Date
): T[] {
  return events.flatMap((event) => {
    const recurrence = normalizeRecurrence(event.recurrence);
    if (recurrence === "NONE") {
      const eventStart = new Date(event.startTime);
      if (eventStart < rangeStart || eventStart > rangeEnd) return [];
      return [event];
    }

    const baseStart = new Date(event.startTime);
    const hasEndBoundary = Boolean(event.endTime);
    const baseEnd = hasEndBoundary ? new Date(event.endTime as string) : null;
    const durationMs = baseEnd ? baseEnd.getTime() - baseStart.getTime() : 0;
    let occurrenceStart = new Date(baseStart);
    const expanded: T[] = [];

    let safetyCounter = 0;

    while (isSameOrBefore(occurrenceStart, rangeEnd) && (!baseEnd || isSameOrBefore(occurrenceStart, baseEnd))) {
      safetyCounter += 1;
      if (safetyCounter > 1000) break;

      if (occurrenceStart >= rangeStart) {
        const occurrenceEnd = new Date(occurrenceStart.getTime() + durationMs);
        expanded.push({
          ...event,
          id: `${event.id}-${occurrenceStart.toISOString()}`,
          startTime: occurrenceStart.toISOString(),
          endTime: event.hasEndTime ? occurrenceEnd.toISOString() : null,
        });
      }

      occurrenceStart = addByRecurrence(occurrenceStart, recurrence);
    }

    return expanded;
  });
}
