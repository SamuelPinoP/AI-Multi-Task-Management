import { expandRecurringEventsForRange, normalizeRecurrence, type RecurringEventBase } from "@/lib/recurrence";
import { formatTaskDayKey, getLocalDateOnly } from "@/lib/task-date-buckets";

type OccurrenceSource = RecurringEventBase & { hasStartTime: boolean };

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

/**
 * Occurrences between `rangeStart` and `rangeEnd` (local dates, inclusive):
 * repeats are expanded, and one-off events that span several days are listed
 * on each day they cover, as all-day entries after their first day. Each
 * occurrence carries `sourceEventId`, the stored event's id.
 */
export function occurrencesInRange<T extends OccurrenceSource>(events: T[], rangeStart: Date, rangeEnd: Date) {
  const occurrences: Array<T & { sourceEventId: string }> = expandRecurringEventsForRange(
    events.map((event) => ({ ...event, sourceEventId: event.id })),
    rangeStart,
    rangeEnd,
  );
  const firstDayInRange = getLocalDateOnly(rangeStart);
  for (const event of events) {
    if (normalizeRecurrence(event.recurrence) !== "NONE" || !event.endTime) continue;
    const firstDay = getLocalDateOnly(event.startTime);
    const lastDay = getLocalDateOnly(event.endTime);
    for (let day = addDays(firstDay, 1); day <= lastDay; day = addDays(day, 1)) {
      if (day < firstDayInRange || day > rangeEnd) continue;
      const key = formatTaskDayKey(day);
      occurrences.push({
        ...event,
        id: `${event.id}-${key}`,
        sourceEventId: event.id,
        // Midnight of that day as a stored wall-clock value (see @/lib/event-time).
        startTime: `${key}T00:00:00.000Z`,
        hasStartTime: false,
      });
    }
  }
  return occurrences;
}
