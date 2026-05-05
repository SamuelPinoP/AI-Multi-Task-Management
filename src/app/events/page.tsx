"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";

type EventItem = {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  startTime: string;
  endTime: string;
  createdAt: string;
  updatedAt: string;
};

function toInputDateTime(value: string) {
  return new Date(value).toISOString().slice(0, 16);
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatDayKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeStyle: "short",
  }).format(new Date(value));
}

function getLocalDayStart(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function isEventToday(event: EventItem, now: Date) {
  const todayStart = getLocalDayStart(now);
  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setDate(tomorrowStart.getDate() + 1);
  const eventStart = new Date(event.startTime);
  return eventStart >= todayStart && eventStart < tomorrowStart;
}

export default function EventsPage() {
  const [events, setEvents] = useState<EventItem[]>([]);
  const [fetching, setFetching] = useState(true);
  const [loading, setLoading] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingEventId, setDeletingEventId] = useState<string | null>(null);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [selectedDayKey, setSelectedDayKey] = useState(() => formatDayKey(new Date()));

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");

  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editLocation, setEditLocation] = useState("");
  const [editStartTime, setEditStartTime] = useState("");
  const [editEndTime, setEditEndTime] = useState("");

  const visibleEvents = useMemo(() => {
    return [...events].sort(
      (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
    );
  }, [events]);

  const eventSections = useMemo(() => {
    const now = new Date();
    const soonBoundary = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const today = visibleEvents.filter((event) => isEventToday(event, now));
    const upcoming = visibleEvents.filter((event) => {
      const start = new Date(event.startTime);
      return start > now && start <= soonBoundary && !isEventToday(event, now);
    });
    const later = visibleEvents.filter((event) => new Date(event.startTime) > soonBoundary);
    const past = visibleEvents.filter((event) => new Date(event.endTime) < now);

    return [
      { key: "TODAY", title: "Today", events: today },
      { key: "UPCOMING", title: "Upcoming Soon", events: upcoming },
      { key: "LATER", title: "Later", events: later },
      { key: "PAST", title: "Past", events: past },
    ] as const;
  }, [visibleEvents]);

  const eventsByDay = useMemo(() => {
    return visibleEvents.reduce<Record<string, EventItem[]>>((acc, event) => {
      const key = formatDayKey(new Date(event.startTime));
      if (!acc[key]) {
        acc[key] = [];
      }
      acc[key].push(event);
      return acc;
    }, {});
  }, [visibleEvents]);

  const calendarDays = useMemo(() => {
    const monthStart = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1);
    const monthEnd = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 0);
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
  }, [calendarMonth]);

  const selectedDayEvents = useMemo(() => {
    const eventsForDay = eventsByDay[selectedDayKey] ?? [];
    return [...eventsForDay].sort(
      (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
    );
  }, [eventsByDay, selectedDayKey]);

  const selectedDayLabel = useMemo(() => {
    const [year, month, day] = selectedDayKey.split("-").map(Number);
    return new Intl.DateTimeFormat("en-US", { dateStyle: "full" }).format(
      new Date(year, month - 1, day)
    );
  }, [selectedDayKey]);

  function goToPreviousMonth() {
    setCalendarMonth(
      (prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1)
    );
  }

  function goToNextMonth() {
    setCalendarMonth(
      (prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1)
    );
  }

  async function fetchEvents(showLoading = true) {
    try {
      if (showLoading) setFetching(true);
      setError("");

      const res = await fetch("/api/events");
      if (!res.ok) {
        throw new Error("Failed to fetch events");
      }

      const data = (await res.json()) as EventItem[];
      setEvents(data);
    } catch {
      setError("Could not load events.");
    } finally {
      setFetching(false);
    }
  }

  useEffect(() => {
    async function loadInitialEvents() {
      await fetchEvents();
    }

    void loadInitialEvents();
  }, []);

  async function handleCreateEvent(e: FormEvent) {
    e.preventDefault();

    if (!title.trim()) {
      setError("Title is required.");
      return;
    }

    if (!startTime || !endTime) {
      setError("Start time and end time are required.");
      return;
    }

    if (new Date(endTime) <= new Date(startTime)) {
      setError("End time must be after start time.");
      return;
    }

    try {
      setLoading(true);
      setError("");

      const res = await fetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          description,
          location,
          startTime,
          endTime,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Failed to create event");
      }

      setTitle("");
      setDescription("");
      setLocation("");
      setStartTime("");
      setEndTime("");
      await fetchEvents(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create event.");
    } finally {
      setLoading(false);
    }
  }

  function startEditing(event: EventItem) {
    setEditingEventId(event.id);
    setEditTitle(event.title);
    setEditDescription(event.description ?? "");
    setEditLocation(event.location ?? "");
    setEditStartTime(toInputDateTime(event.startTime));
    setEditEndTime(toInputDateTime(event.endTime));
    setError("");
  }

  function cancelEditing() {
    setEditingEventId(null);
    setEditTitle("");
    setEditDescription("");
    setEditLocation("");
    setEditStartTime("");
    setEditEndTime("");
  }

  async function handleSaveEdit(eventId: string) {
    if (!editTitle.trim()) {
      setError("Title is required.");
      return;
    }

    if (!editStartTime || !editEndTime) {
      setError("Start time and end time are required.");
      return;
    }

    if (new Date(editEndTime) <= new Date(editStartTime)) {
      setError("End time must be after start time.");
      return;
    }

    try {
      setSavingEdit(true);
      setError("");

      const res = await fetch(`/api/events/${eventId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: editTitle,
          description: editDescription,
          location: editLocation,
          startTime: editStartTime,
          endTime: editEndTime,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Failed to update event");
      }

      const updated = (await res.json()) as EventItem;
      setEvents((prev) => prev.map((event) => (event.id === eventId ? updated : event)));
      cancelEditing();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update event.");
    } finally {
      setSavingEdit(false);
    }
  }

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
      if (editingEventId === eventId) {
        cancelEditing();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete event.");
    } finally {
      setDeletingEventId(null);
    }
  }

  return (
    <>
    <main className="min-h-screen px-6 py-10">
      <div className="mx-auto max-w-4xl">
        <h1 className="mb-2 text-4xl font-bold">Events</h1>
        <p className="mb-8 text-zinc-600 dark:text-zinc-300">
          Create and manage scheduled events for AI-Multi Task-Management.
        </p>

        <section className="mb-10 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-6 shadow-sm">
          <h2 className="mb-4 text-2xl font-semibold">Create Event</h2>

          <form onSubmit={handleCreateEvent} className="space-y-4">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Event title"
              className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 px-4 py-3 outline-none focus:border-black"
            />
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Description (optional)"
              rows={4}
              className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 px-4 py-3 outline-none focus:border-black"
            />
            <input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Location (optional)"
              className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 px-4 py-3 outline-none focus:border-black"
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <input
                type="datetime-local"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="rounded-xl border border-zinc-300 dark:border-zinc-700 px-4 py-3 outline-none focus:border-black"
              />
              <input
                type="datetime-local"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="rounded-xl border border-zinc-300 dark:border-zinc-700 px-4 py-3 outline-none focus:border-black"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="rounded-xl bg-black px-5 py-3 text-white transition hover:opacity-90 disabled:opacity-50"
            >
              {loading ? "Creating..." : "Create Event"}
            </button>
          </form>

          {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
        </section>

        <section className="mb-10 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-2xl font-semibold">Calendar</h2>
            <div className="flex items-center gap-2">
              <button
                onClick={goToPreviousMonth}
                className="rounded-lg border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 text-sm"
              >
                Previous
              </button>
              <p className="min-w-40 text-center text-sm font-medium">
                {new Intl.DateTimeFormat("en-US", {
                  month: "long",
                  year: "numeric",
                }).format(calendarMonth)}
              </p>
              <button
                onClick={goToNextMonth}
                className="rounded-lg border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 text-sm"
              >
                Next
              </button>
            </div>
          </div>

          <div className="mb-3 grid grid-cols-7 gap-2 text-center text-xs font-semibold uppercase tracking-wide text-zinc-500">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
              <span key={day}>{day}</span>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-2">
            {calendarDays.map((day) => {
              const dayKey = formatDayKey(day);
              const eventCount = eventsByDay[dayKey]?.length ?? 0;
              const isCurrentMonth = day.getMonth() === calendarMonth.getMonth();
              const isSelected = dayKey === selectedDayKey;
              const isToday = dayKey === formatDayKey(new Date());

              return (
                <button
                  key={dayKey}
                  onClick={() => setSelectedDayKey(dayKey)}
                  className={`min-h-20 rounded-xl border p-2 text-left transition ${isSelected
                    ? "border-black bg-zinc-100 dark:bg-zinc-800"
                    : "border-zinc-200 dark:border-zinc-700 hover:border-zinc-400"} ${!isCurrentMonth ? "opacity-50" : ""}`}
                >
                  <div className="flex items-center justify-between">
                    <span className={`text-sm ${isToday ? "font-bold text-blue-700" : ""}`}>
                      {day.getDate()}
                    </span>
                    {eventCount > 0 && (
                      <span className="rounded-full bg-black px-2 py-0.5 text-xs text-white">
                        {eventCount}
                      </span>
                    )}
                  </div>
                  {eventCount > 0 && (
                    <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-300">
                      {eventCount === 1 ? "1 event" : `${eventCount} events`}
                    </p>
                  )}
                </button>
              );
            })}
          </div>

          <div className="mt-6 rounded-xl border border-zinc-200 dark:border-zinc-700 p-4">
            <h3 className="mb-3 text-lg font-semibold">Events on {selectedDayLabel}</h3>
            {selectedDayEvents.length === 0 ? (
              <p className="text-sm text-zinc-600 dark:text-zinc-300">No events for this day.</p>
            ) : (
              <ul className="space-y-3">
                {selectedDayEvents.map((event) => (
                  <li key={event.id} className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-3">
                    <p className="font-medium">{event.title}</p>
                    <p className="text-sm text-zinc-600 dark:text-zinc-300">
                      {formatTime(event.startTime)} - {formatTime(event.endTime)}
                    </p>
                    {event.location && (
                      <p className="text-sm text-zinc-600 dark:text-zinc-300">
                        {event.location}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section>
          <h2 className="mb-4 text-2xl font-semibold">Your Events</h2>
          {fetching ? (
            <p className="text-zinc-600 dark:text-zinc-300">Loading events...</p>
          ) : visibleEvents.length === 0 ? (
            <p className="text-zinc-600 dark:text-zinc-300">No events yet.</p>
          ) : (
            <div className="space-y-6">
              {eventSections.map((section) => (
                <div key={section.key}>
                  <h3 className="mb-3 text-lg font-semibold text-gray-800">{section.title}</h3>
                  {section.events.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-zinc-200 dark:border-zinc-800 px-4 py-3 text-sm text-gray-500">
                      No events in this section.
                    </p>
                  ) : (
                    <div className="space-y-4">
                      {section.events.map((event) => {
                const isEditing = editingEventId === event.id;
                const isDeleting = deletingEventId === event.id;
                const now = new Date();
                const today = isEventToday(event, now);
                const startsSoon = new Date(event.startTime).getTime() > now.getTime()
                  && new Date(event.startTime).getTime() <= now.getTime() + 48 * 60 * 60 * 1000;
                const badgeText = today ? "Today" : startsSoon ? "Soon" : null;
                const badgeStyles = today ? "text-emerald-700" : "text-blue-700";
                const cardStyles = today
                  ? "border-emerald-200 bg-emerald-50"
                  : startsSoon
                    ? "border-blue-200 bg-blue-50"
                    : "border-zinc-200 dark:border-zinc-800";

                return (
                  <article
                    key={event.id}
                    className={`rounded-2xl border p-5 shadow-sm ${cardStyles}`}
                  >
                    {isEditing ? (
                      <div className="space-y-3">
                        <input
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 px-3 py-2 outline-none focus:border-black"
                        />
                        <textarea
                          value={editDescription}
                          onChange={(e) => setEditDescription(e.target.value)}
                          rows={3}
                          className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 px-3 py-2 outline-none focus:border-black"
                        />
                        <input
                          value={editLocation}
                          onChange={(e) => setEditLocation(e.target.value)}
                          className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 px-3 py-2 outline-none focus:border-black"
                        />
                        <div className="grid gap-3 sm:grid-cols-2">
                          <input
                            type="datetime-local"
                            value={editStartTime}
                            onChange={(e) => setEditStartTime(e.target.value)}
                            className="rounded-xl border border-zinc-300 dark:border-zinc-700 px-3 py-2 outline-none focus:border-black"
                          />
                          <input
                            type="datetime-local"
                            value={editEndTime}
                            onChange={(e) => setEditEndTime(e.target.value)}
                            className="rounded-xl border border-zinc-300 dark:border-zinc-700 px-3 py-2 outline-none focus:border-black"
                          />
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            onClick={() => void handleSaveEdit(event.id)}
                            disabled={savingEdit}
                            className="rounded-xl bg-black px-4 py-2 text-white disabled:opacity-50"
                          >
                            {savingEdit ? "Saving..." : "Save"}
                          </button>
                          <button
                            onClick={cancelEditing}
                            className="rounded-xl border border-zinc-300 dark:border-zinc-700 px-4 py-2"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-start justify-between gap-3">
                          <h3 className="text-xl font-semibold">{event.title}</h3>
                          {badgeText && (
                            <span
                              className={`rounded-full border border-current px-2.5 py-1 text-xs font-medium ${badgeStyles}`}
                            >
                              {badgeText}
                            </span>
                          )}
                        </div>
                        {event.description ? (
                          <p className="mt-2 text-gray-700">{event.description}</p>
                        ) : (
                          <p className="mt-2 text-gray-500">No description.</p>
                        )}
                        {event.location ? (
                          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">Location: {event.location}</p>
                        ) : (
                          <p className="mt-2 text-sm text-gray-500">No location set.</p>
                        )}
                        <p className="mt-2 text-sm text-gray-700">
                          Start: {formatDateTime(event.startTime)}
                        </p>
                        <p className="mt-1 text-sm text-gray-700">
                          End: {formatDateTime(event.endTime)}
                        </p>
                        <div className="mt-4 flex gap-2">
                          <button
                            onClick={() => startEditing(event)}
                            className="rounded-xl border border-zinc-300 dark:border-zinc-700 px-4 py-2"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => setConfirmDeleteId(event.id)}
                            disabled={isDeleting}
                            className="rounded-xl bg-red-600 px-4 py-2 text-white disabled:opacity-50"
                          >
                            {isDeleting ? "Deleting..." : "Delete"}
                          </button>
                        </div>
                      </>
                    )}
                  </article>
                );
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
    <ConfirmDialog open={Boolean(confirmDeleteId)} title="Confirm delete" message="This will move the item to Trash." loading={Boolean(deletingEventId)} onCancel={() => setConfirmDeleteId(null)} onConfirm={() => { if (confirmDeleteId) void handleDeleteEvent(confirmDeleteId); setConfirmDeleteId(null); }} />
    </>
  );
}
