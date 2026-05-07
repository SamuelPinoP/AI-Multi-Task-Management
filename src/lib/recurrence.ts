import { Recurrence } from "@prisma/client";

export const RECURRENCE_VALUES = [
  "NONE",
  "DAILY",
  "WEEKLY",
  "BIWEEKLY",
  "MONTHLY",
] as const;

export type RecurrenceValue = (typeof RECURRENCE_VALUES)[number];

export function isValidRecurrence(value: unknown): value is Recurrence {
  return typeof value === "string" && RECURRENCE_VALUES.includes(value as RecurrenceValue);
}

export function normalizeRecurrence(value: unknown): Recurrence {
  return isValidRecurrence(value) ? value : Recurrence.NONE;
}

export function formatRecurrenceLabel(value: unknown) {
  const recurrence = normalizeRecurrence(value);
  if (recurrence === Recurrence.NONE) return "No";
  if (recurrence === Recurrence.BIWEEKLY) return "every 2 weeks";
  return recurrence.toLowerCase();
}

export type RecurringEventBase = {
  id: string;
  startTime: string;
  endTime: string;
  recurrence?: Recurrence | null;
};

function isSameOrBefore(a: Date, b: Date) {
  return a.getTime() <= b.getTime();
}

function addByRecurrence(date: Date, recurrence: Recurrence) {
  const next = new Date(date);
  if (recurrence === Recurrence.DAILY) next.setUTCDate(next.getUTCDate() + 1);
  if (recurrence === Recurrence.WEEKLY) next.setUTCDate(next.getUTCDate() + 7);
  if (recurrence === Recurrence.BIWEEKLY) next.setUTCDate(next.getUTCDate() + 14);
  if (recurrence === Recurrence.MONTHLY) next.setUTCMonth(next.getUTCMonth() + 1);
  return next;
}

export function expandRecurringEventsForRange<T extends RecurringEventBase>(
  events: T[],
  rangeStart: Date,
  rangeEnd: Date
): T[] {
  return events.flatMap((event) => {
    const recurrence = normalizeRecurrence(event.recurrence);
    if (recurrence === Recurrence.NONE) {
      const eventStart = new Date(event.startTime);
      if (eventStart < rangeStart || eventStart > rangeEnd) return [];
      return [event];
    }

    const baseStart = new Date(event.startTime);
    const baseEnd = new Date(event.endTime);
    const durationMs = baseEnd.getTime() - baseStart.getTime();
    let occurrenceStart = new Date(baseStart);
    const expanded: T[] = [];

    let safetyCounter = 0;

    while (isSameOrBefore(occurrenceStart, rangeEnd)) {
      safetyCounter += 1;
      if (safetyCounter > 1000) break;

      if (occurrenceStart >= rangeStart) {
        const occurrenceEnd = new Date(occurrenceStart.getTime() + durationMs);
        expanded.push({
          ...event,
          id: `${event.id}-${occurrenceStart.toISOString()}`,
          startTime: occurrenceStart.toISOString(),
          endTime: occurrenceEnd.toISOString(),
        });
      }

      occurrenceStart = addByRecurrence(occurrenceStart, recurrence);
    }

    return expanded;
  });
}
