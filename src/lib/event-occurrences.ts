import { eventWallTime } from "@/lib/event-time";
import { expandRecurringEventsForRange, firstOccurrenceEnd, type RecurringEventBase } from "@/lib/recurrence";
import { formatTaskDayKey, getLocalDateOnly } from "@/lib/task-date-buckets";

type OccurrenceSource = RecurringEventBase & { hasStartTime: boolean };

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

/** Days after its first that each occurrence of `event` also covers. */
function extraDays(event: OccurrenceSource) {
  const end = firstOccurrenceEnd(event);
  if (!end) return 0;
  const days = (getLocalDateOnly(end).getTime() - getLocalDateOnly(event.startTime).getTime()) / 86_400_000;
  return Math.max(0, Math.round(days));
}

/**
 * Occurrences between `rangeStart` and `rangeEnd` (local dates, inclusive):
 * repeats are expanded, and events that span several days (one-off or each
 * repeat) are listed on each day they cover, as all-day entries after their
 * first day. Each occurrence carries `sourceEventId`, the stored event's id.
 */
export function occurrencesInRange<T extends OccurrenceSource>(events: T[], rangeStart: Date, rangeEnd: Date) {
  const occurrences: Array<T & { sourceEventId: string }> = [];
  const firstDayInRange = getLocalDateOnly(rangeStart);
  for (const event of events) {
    const span = extraDays(event);
    // Start earlier by the span, so an occurrence that began before the range but runs into it is found.
    const starts = expandRecurringEventsForRange([{ ...event, sourceEventId: event.id }], addDays(rangeStart, -span), rangeEnd);
    for (const occurrence of starts) {
      if (eventWallTime(occurrence.startTime) >= rangeStart) occurrences.push(occurrence);
      const firstDay = getLocalDateOnly(occurrence.startTime);
      for (let offset = 1; offset <= span; offset += 1) {
        const day = addDays(firstDay, offset);
        if (day < firstDayInRange || day > rangeEnd) continue;
        const key = formatTaskDayKey(day);
        occurrences.push({
          ...occurrence,
          id: `${occurrence.id}-${key}`,
          // Midnight of that day as a stored wall-clock value (see @/lib/event-time).
          startTime: `${key}T00:00:00.000Z`,
          hasStartTime: false,
        });
      }
    }
  }
  return occurrences;
}
