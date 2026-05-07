import { Recurrence } from "@prisma/client";

export type CalendarEvent = {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  recurrence: Recurrence;
  startTime: string | null;
  endTime: string | null;
  recurrenceWeekday: number | null;
  recurrenceDayOfMonth: number | null;
  recurrenceStartDate: string | null;
  recurrenceEndDate: string | null;
};

export type EventOccurrence = {
  id: string;
  sourceEventId: string;
  title: string;
  description: string | null;
  location: string | null;
  recurrence: Recurrence;
  start: Date;
  end: Date;
  allDay: boolean;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(date: Date) { return new Date(date.getFullYear(), date.getMonth(), date.getDate()); }

function withTime(day: Date, source: Date | null) {
  if (!source) return new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9, 0);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), source.getHours(), source.getMinutes());
}

export function expandEventsForRange(events: CalendarEvent[], rangeStart: Date, rangeEnd: Date) {
  const out: EventOccurrence[] = [];
  for (const event of events) {
    const start = event.startTime ? new Date(event.startTime) : null;
    const end = event.endTime ? new Date(event.endTime) : null;
    const durationMs = start && end && end > start ? end.getTime() - start.getTime() : 60 * 60 * 1000;

    if (event.recurrence === Recurrence.NONE) {
      if (!start || !end) continue;
      if (end < rangeStart || start > rangeEnd) continue;
      out.push({ id: event.id, sourceEventId: event.id, title: event.title, description: event.description, location: event.location, recurrence: event.recurrence, start, end, allDay: false });
      continue;
    }

    const recurStart = event.recurrenceStartDate ? startOfDay(new Date(event.recurrenceStartDate)) : startOfDay(rangeStart);
    const recurEnd = event.recurrenceEndDate ? startOfDay(new Date(event.recurrenceEndDate)) : startOfDay(rangeEnd);
    const visibleStart = startOfDay(rangeStart > recurStart ? rangeStart : recurStart);
    const visibleEnd = startOfDay(rangeEnd < recurEnd ? rangeEnd : recurEnd);

    for (let day = new Date(visibleStart); day <= visibleEnd; day = new Date(day.getTime() + DAY_MS)) {
      const dayOfWeek = day.getDay();
      const dayOfMonth = day.getDate();
      let matches = false;
      if (event.recurrence === Recurrence.DAILY) matches = true;
      if (event.recurrence === Recurrence.WEEKLY) matches = dayOfWeek === (event.recurrenceWeekday ?? (start?.getDay() ?? dayOfWeek));
      if (event.recurrence === Recurrence.BIWEEKLY) {
        const anchor = startOfDay(start ?? recurStart);
        const weeks = Math.floor((startOfDay(day).getTime() - anchor.getTime()) / (7 * DAY_MS));
        matches = dayOfWeek === (event.recurrenceWeekday ?? anchor.getDay()) && weeks >= 0 && weeks % 2 === 0;
      }
      if (event.recurrence === Recurrence.MONTHLY) matches = dayOfMonth === (event.recurrenceDayOfMonth ?? (start?.getDate() ?? 1));
      if (!matches) continue;
      const occStart = withTime(day, start);
      const occEnd = new Date(occStart.getTime() + durationMs);
      out.push({ id: `${event.id}-${day.toISOString().slice(0,10)}`, sourceEventId: event.id, title: event.title, description: event.description, location: event.location, recurrence: event.recurrence, start: occStart, end: occEnd, allDay: !start });
    }
  }
  return out.sort((a, b) => a.start.getTime() - b.start.getTime());
}
