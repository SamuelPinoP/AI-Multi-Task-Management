"use client";

import { useMemo, useState } from "react";
import { expandRecurringEventsForRange, normalizeRecurrence } from "@/lib/recurrence";

type Recurrence = "NONE" | "DAILY" | "WEEKLY" | "BIWEEKLY" | "MONTHLY";

type ProjectCalendarEvent = {
  id: string;
  sourceEventId?: string;
  title: string;
  startTime: string;
  endTime: string | null;
  hasStartTime: boolean;
  hasEndTime: boolean;
  recurrence?: Recurrence | null;
};

type ProjectCalendarProps = {
  projectColor?: string | null;
  events: ProjectCalendarEvent[];
};

function formatDayKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("en-US", { timeStyle: "short" }).format(new Date(value));
}

export function ProjectCalendar({ projectColor, events }: ProjectCalendarProps) {
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [selectedDayKey, setSelectedDayKey] = useState(() => formatDayKey(new Date()));

  const normalizedEvents = useMemo(
    () => events.map((event) => ({ ...event, recurrence: normalizeRecurrence(event.recurrence) })),
    [events]
  );

  const monthDays = useMemo(() => {
    const monthStart = new Date(month.getFullYear(), month.getMonth(), 1);
    const monthEnd = new Date(month.getFullYear(), month.getMonth() + 1, 0);

    const calendarStart = new Date(monthStart);
    calendarStart.setDate(calendarStart.getDate() - monthStart.getDay());

    const calendarEnd = new Date(monthEnd);
    calendarEnd.setDate(calendarEnd.getDate() + (6 - monthEnd.getDay()));

    const days: Date[] = [];
    const cursor = new Date(calendarStart);

    while (cursor <= calendarEnd) {
      days.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }

    return days;
  }, [month]);

  const visibleRange = useMemo(() => {
    const start = new Date(monthDays[0]);
    start.setHours(0, 0, 0, 0);

    const end = new Date(monthDays[monthDays.length - 1]);
    end.setHours(23, 59, 59, 999);

    return { start, end };
  }, [monthDays]);

  const expandedEvents = useMemo(() => {
    const eventsWithSourceId = normalizedEvents.map((event) => ({ ...event, sourceEventId: event.id }));
    return expandRecurringEventsForRange(eventsWithSourceId, visibleRange.start, visibleRange.end);
  }, [normalizedEvents, visibleRange]);

  const eventsByDay = useMemo(() => {
    return expandedEvents.reduce<Record<string, ProjectCalendarEvent[]>>((acc, event) => {
      const key = formatDayKey(new Date(event.startTime));
      if (!acc[key]) acc[key] = [];
      acc[key].push(event);
      return acc;
    }, {});
  }, [expandedEvents]);

  const selectedDayEvents = useMemo(() => {
    const dayEvents = eventsByDay[selectedDayKey] ?? [];
    return [...dayEvents].sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
  }, [eventsByDay, selectedDayKey]);

  const selectedDayLabel = useMemo(() => {
    const [year, monthNum, day] = selectedDayKey.split("-").map(Number);
    return new Intl.DateTimeFormat("en-US", { dateStyle: "full" }).format(
      new Date(year, monthNum - 1, day)
    );
  }, [selectedDayKey]);

  if (events.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-zinc-300 p-5 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300">
        No project events yet. Assign events to this project to see them in a calendar.
      </p>
    );
  }

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/40">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-xl font-semibold">
          {new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(month)}
        </h3>
        <div className="flex items-center gap-2">
          <button onClick={() => setMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))} className="rounded-lg border border-zinc-300 px-3 py-2 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800">Previous</button>
          <button onClick={() => setMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))} className="rounded-lg border border-zinc-300 px-3 py-2 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800">Next</button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div>
          <div className="mb-3 grid grid-cols-7 gap-2 text-center text-xs font-semibold uppercase tracking-wide text-zinc-500">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => <span key={day}>{day}</span>)}
          </div>
          <div className="grid grid-cols-7 gap-2">
            {monthDays.map((day) => {
              const dayKey = formatDayKey(day);
              const isCurrentMonth = day.getMonth() === month.getMonth();
              const isToday = dayKey === formatDayKey(new Date());
              const isSelected = dayKey === selectedDayKey;
              const dayEvents = eventsByDay[dayKey] ?? [];
              const eventCount = dayEvents.length;

              return (
                <button key={dayKey} onClick={() => setSelectedDayKey(dayKey)} className={`min-h-24 rounded-xl border p-3 text-left transition ${isSelected ? "border-black bg-zinc-100 dark:bg-zinc-800" : "border-zinc-200 hover:border-zinc-400 dark:border-zinc-700"} ${!isCurrentMonth ? "opacity-45" : ""}`}>
                  <div className="flex items-start justify-between gap-2">
                    <span className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-sm ${isToday ? "bg-blue-600 font-semibold text-white" : ""}`}>{day.getDate()}</span>
                    {eventCount > 0 && <span className="rounded-full bg-black px-2 py-0.5 text-xs text-white">{eventCount}</span>}
                  </div>
                  {eventCount > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {dayEvents.slice(0, 3).map((event) => (
                        <span key={event.id} className="h-2 w-2 rounded-full" style={{ backgroundColor: projectColor || "#18181b" }} />
                      ))}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <aside className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-700">
          <h4 className="text-lg font-semibold">{selectedDayLabel}</h4>
          <p className="mt-1 text-sm text-zinc-500">
            {selectedDayEvents.length === 0
              ? "No project events planned for this day."
              : `${selectedDayEvents.length} project event${selectedDayEvents.length > 1 ? "s" : ""}`}
          </p>

          <div className="mt-4 space-y-3">
            {selectedDayEvents.map((event) => (
              <article key={event.id} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-700">
                <div className="flex items-center gap-2">
                  <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: projectColor || "#18181b" }} />
                  <p className="font-medium">{event.title}</p>
                </div>
                <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                  {event.hasStartTime ? formatTime(event.startTime) : "Time not specified"}
                  {event.endTime && event.hasEndTime ? ` - ${formatTime(event.endTime)}` : ""}
                </p>
              </article>
            ))}
          </div>
        </aside>
      </div>
    </section>
  );
}
