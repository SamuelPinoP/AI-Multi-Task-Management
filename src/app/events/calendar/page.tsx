"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  expandRecurringEventsForRange,
  formatRecurrenceLabel,
  normalizeRecurrence,
} from "@/lib/recurrence";

type Recurrence = "NONE" | "DAILY" | "WEEKLY" | "BIWEEKLY" | "MONTHLY";

type EventItem = {
  id: string;
  sourceEventId?: string;
  title: string;
  description: string | null;
  location: string | null;
  startTime: string;
  endTime: string | null;
  hasStartTime: boolean;
  hasEndTime: boolean;
  recurrence?: Recurrence | null;
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

export default function EventsCalendarPage() {
  const [events, setEvents] = useState<EventItem[]>([]);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState("");
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [selectedDayKey, setSelectedDayKey] = useState(() => formatDayKey(new Date()));
  const [deletingEventId, setDeletingEventId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  useEffect(() => {
    async function loadEvents() {
      try {
        setFetching(true);
        setError("");

        const response = await fetch("/api/events", { cache: "no-store" });
        if (!response.ok) {
          throw new Error("Failed to fetch events");
        }

        const data = (await response.json()) as EventItem[];
        setEvents(data.map((event) => ({ ...event, recurrence: normalizeRecurrence(event.recurrence) })));
      } catch {
        setError("Could not load events for the calendar.");
      } finally {
        setFetching(false);
      }
    }

    void loadEvents();
  }, []);

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
    const eventsWithSourceId = events.map((event) => ({
      ...event,
      sourceEventId: event.id,
    }));
    return expandRecurringEventsForRange(eventsWithSourceId, visibleRange.start, visibleRange.end);
  }, [events, visibleRange]);

  const eventsByDay = useMemo(() => {
    return expandedEvents.reduce<Record<string, EventItem[]>>((acc, event) => {
      const key = formatDayKey(new Date(event.startTime));
      if (!acc[key]) {
        acc[key] = [];
      }
      acc[key].push(event);
      return acc;
    }, {});
  }, [expandedEvents]);

  const selectedDayEvents = useMemo(() => {
    const dayEvents = eventsByDay[selectedDayKey] ?? [];
    return [...dayEvents].sort(
      (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
    );
  }, [eventsByDay, selectedDayKey]);

  const selectedDayLabel = useMemo(() => {
    const [year, monthNum, day] = selectedDayKey.split("-").map(Number);
    return new Intl.DateTimeFormat("en-US", { dateStyle: "full" }).format(
      new Date(year, monthNum - 1, day)
    );
  }, [selectedDayKey]);

  async function handleDeleteEvent(eventId: string) {
    try {
      setDeletingEventId(eventId);
      setError("");
      const res = await fetch(`/api/events/${eventId}`, { method: "DELETE" });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Failed to delete event");
      }

      setEvents((prev) => prev.filter((event) => event.id !== eventId));
      setConfirmDeleteId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete event.");
    } finally {
      setDeletingEventId(null);
    }
  }

  return (
    <main className="min-h-screen px-6 py-10">
      <div className="mx-auto max-w-7xl">
        <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-4xl font-bold">Full Calendar</h1>
            <p className="mt-2 text-zinc-600 dark:text-zinc-300">
              Explore all events in a larger monthly view with day-by-day details.
            </p>
          </div>
          <Link
            href="/events"
            className="rounded-xl border border-zinc-300 px-4 py-2 text-sm font-medium transition hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Back to Events
          </Link>
        </div>

        {error && <p className="mb-6 text-sm text-red-600">{error}</p>}

        <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/40">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-2xl font-semibold">
              {new Intl.DateTimeFormat("en-US", {
                month: "long",
                year: "numeric",
              }).format(month)}
            </h2>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))}
                className="rounded-lg border border-zinc-300 px-3 py-2 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                Previous
              </button>
              <button
                onClick={() => setMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))}
                className="rounded-lg border border-zinc-300 px-3 py-2 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                Next
              </button>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
            <div>
              <div className="mb-3 grid grid-cols-7 gap-2 text-center text-xs font-semibold uppercase tracking-wide text-zinc-500">
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
                  <span key={day}>{day}</span>
                ))}
              </div>

              <div className="grid grid-cols-7 gap-2">
                {monthDays.map((day) => {
                  const dayKey = formatDayKey(day);
                  const isCurrentMonth = day.getMonth() === month.getMonth();
                  const isToday = dayKey === formatDayKey(new Date());
                  const isSelected = dayKey === selectedDayKey;
                  const eventCount = eventsByDay[dayKey]?.length ?? 0;

                  return (
                    <button
                      key={dayKey}
                      onClick={() => setSelectedDayKey(dayKey)}
                      className={`min-h-28 rounded-xl border p-3 text-left transition ${
                        isSelected
                          ? "border-black bg-zinc-100 dark:bg-zinc-800"
                          : "border-zinc-200 hover:border-zinc-400 dark:border-zinc-700"
                      } ${!isCurrentMonth ? "opacity-45" : ""}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span
                          className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-sm ${
                            isToday ? "bg-blue-600 font-semibold text-white" : ""
                          }`}
                        >
                          {day.getDate()}
                        </span>
                        {eventCount > 0 && (
                          <span className="rounded-full bg-black px-2 py-0.5 text-xs text-white">
                            {eventCount}
                          </span>
                        )}
                      </div>

                      {eventCount > 0 && (
                        <div className="mt-2 space-y-1">
                          {(eventsByDay[dayKey] ?? []).slice(0, 2).map((event) => (
                            <p
                              key={event.id}
                              className="truncate rounded bg-zinc-200/70 px-1.5 py-0.5 text-xs text-zinc-800 dark:bg-zinc-700 dark:text-zinc-100"
                            >
                              {event.hasStartTime ? formatTime(event.startTime) : "No time"} {event.title}
                            </p>
                          ))}
                          {eventCount > 2 && (
                            <p className="text-xs text-zinc-500">+{eventCount - 2} more</p>
                          )}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            <aside className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-700">
              <h3 className="text-lg font-semibold">{selectedDayLabel}</h3>
              <p className="mt-1 text-sm text-zinc-500">
                {selectedDayEvents.length === 0
                  ? "No events planned for this day."
                  : `${selectedDayEvents.length} event${selectedDayEvents.length > 1 ? "s" : ""} scheduled`}
              </p>

              <div className="mt-4 space-y-3">
                {selectedDayEvents.map((event) => (
                  <article
                    key={event.id}
                    className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-700"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <p className="font-medium">{event.title}</p>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(event.sourceEventId ?? event.id)}
                        disabled={deletingEventId === (event.sourceEventId ?? event.id)}
                        className="inline-flex shrink-0 items-center rounded-md bg-red-600 px-2.5 py-1 text-xs font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {deletingEventId === (event.sourceEventId ?? event.id) ? "Deleting..." : "Delete"}
                      </button>
                    </div>
                    <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                      {event.hasStartTime ? formatTime(event.startTime) : "Time not specified"}{event.endTime && event.hasEndTime ? ` - ${formatTime(event.endTime)}` : ""}
                    </p>
                    {event.location && (
                      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">{event.location}</p>
                    )}
                    <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                      Repeats: {formatRecurrenceLabel(event.recurrence)}
                    </p>
                    {event.description && (
                      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                        {event.description}
                      </p>
                    )}
                  </article>
                ))}

                {!fetching && selectedDayEvents.length === 0 && (
                  <p className="rounded-lg border border-dashed border-zinc-200 px-3 py-4 text-sm text-zinc-500 dark:border-zinc-700">
                    Select another day or create an event from the Events page.
                  </p>
                )}

                {fetching && (
                  <p className="text-sm text-zinc-500">Loading events for calendar...</p>
                )}
              </div>
            </aside>
          </div>
        </section>
      </div>
      <ConfirmDialog
        open={confirmDeleteId !== null}
        title="Delete event?"
        message="This will move the event to Trash. You can restore it later from the Trash page."
        confirmLabel="Move to Trash"
        loading={deletingEventId !== null}
        onCancel={() => {
          if (deletingEventId) return;
          setConfirmDeleteId(null);
        }}
        onConfirm={() => {
          if (!confirmDeleteId) return;
          void handleDeleteEvent(confirmDeleteId);
        }}
      />
    </main>
  );
}
