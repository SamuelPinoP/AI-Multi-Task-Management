"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { uiPrimaryButtonClass } from "@/components/ui";
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
  createdAt: string;
  updatedAt: string;
  recurrence?: Recurrence | null;
  projectId?: string | null;
  project?: Project | null;
};
type Project = { id: string; name: string; color: string | null };
const ALL_PROJECTS_FILTER = "ALL";
const NO_PROJECT_FILTER = "NO_PROJECT";

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


function validateEventInput(input: {
  title: string;
  startDate: string;
  startTime?: string;
  endDate?: string;
  endTime?: string;
}) {
  if (!input.title.trim()) return "Title is required.";
  if (!input.startDate) return "Start date is required.";
  if (input.endDate && input.endDate < input.startDate) return "End date cannot be before start date.";
  if (input.endDate && input.endDate === input.startDate && input.startTime && input.endTime && input.endTime <= input.startTime) {
    return "End time must be after start time when the dates are the same.";
  }
  return "";
}
export default function EventsPage() {
  const [events, setEvents] = useState<EventItem[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
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
  const [startDate, setStartDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endDate, setEndDate] = useState("");
  const [endTime, setEndTime] = useState("");
  const [recurrence, setRecurrence] = useState<Recurrence>("NONE");
  const [projectId, setProjectId] = useState("");

  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editLocation, setEditLocation] = useState("");
  const [editStartDate, setEditStartDate] = useState("");
  const [editStartTime, setEditStartTime] = useState("");
  const [editEndDate, setEditEndDate] = useState("");
  const [editEndTime, setEditEndTime] = useState("");
  const [editRecurrence, setEditRecurrence] = useState<Recurrence>("NONE");
  const [editProjectId, setEditProjectId] = useState("");
  const [projectFilter, setProjectFilter] = useState(ALL_PROJECTS_FILTER);
  const [highlightedEventId, setHighlightedEventId] = useState<string | null>(null);

  const visibleEvents = useMemo(() => {
    return events.filter((event) => {
      if (projectFilter === ALL_PROJECTS_FILTER) return true;
      if (projectFilter === NO_PROJECT_FILTER) return event.projectId === null || event.projectId === undefined;
      return event.projectId === projectFilter;
    }).sort(
      (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
    );
  }, [events, projectFilter]);
  const selectedProject = useMemo(
    () => projects.find((project) => project.id === projectFilter) ?? null,
    [projects, projectFilter]
  );

  const eventSections = useMemo(() => {
    const now = new Date();
    const soonBoundary = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const today = visibleEvents.filter((event) => isEventToday(event, now));
    const upcoming = visibleEvents.filter((event) => {
      const start = new Date(event.startTime);
      return start > now && start <= soonBoundary && !isEventToday(event, now);
    });
    const later = visibleEvents.filter((event) => new Date(event.startTime) > soonBoundary);
    const past = visibleEvents.filter((event) => event.endTime ? new Date(event.endTime) < now : false);

    return [
      { key: "TODAY", title: "Today", events: today },
      { key: "UPCOMING", title: "Upcoming Soon", events: upcoming },
      { key: "LATER", title: "Later", events: later },
      { key: "PAST", title: "Past", events: past },
    ] as const;
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

  const visibleCalendarRange = useMemo(() => {
    const start = new Date(calendarDays[0]);
    start.setHours(0, 0, 0, 0);

    const end = new Date(calendarDays[calendarDays.length - 1]);
    end.setHours(23, 59, 59, 999);

    return { start, end };
  }, [calendarDays]);

  const expandedCalendarEvents = useMemo(() => {
    const eventsWithSourceId = events.map((event) => ({
      ...event,
      sourceEventId: event.id,
    }));

    return expandRecurringEventsForRange(
      eventsWithSourceId,
      visibleCalendarRange.start,
      visibleCalendarRange.end
    );
  }, [events, visibleCalendarRange]);

  const calendarEventsByDay = useMemo(() => {
    return expandedCalendarEvents.reduce<Record<string, EventItem[]>>((acc, event) => {
      const key = formatDayKey(new Date(event.startTime));
      if (!acc[key]) {
        acc[key] = [];
      }
      acc[key].push(event);
      return acc;
    }, {});
  }, [expandedCalendarEvents]);

  const selectedProjectCalendarEventsByDay = useMemo(() => {
    if (projectFilter === ALL_PROJECTS_FILTER || projectFilter === NO_PROJECT_FILTER) {
      return {} as Record<string, EventItem[]>;
    }
    return expandedCalendarEvents.reduce<Record<string, EventItem[]>>((acc, event) => {
      if (event.projectId !== projectFilter) return acc;
      const key = formatDayKey(new Date(event.startTime));
      if (!acc[key]) {
        acc[key] = [];
      }
      acc[key].push(event);
      return acc;
    }, {});
  }, [expandedCalendarEvents, projectFilter]);

  const selectedDayEvents = useMemo(() => {
    let eventsForDay = calendarEventsByDay[selectedDayKey] ?? [];
    if (projectFilter === NO_PROJECT_FILTER) {
      eventsForDay = eventsForDay.filter((event) => event.projectId === null || event.projectId === undefined);
    }
    return [...eventsForDay].sort(
      (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
    );
  }, [calendarEventsByDay, selectedDayKey, projectFilter]);

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
      setEvents(data.map((event) => ({ ...event, recurrence: normalizeRecurrence(event.recurrence) })));
    } catch {
      setError("Could not load events.");
    } finally {
      setFetching(false);
    }
  }
  async function fetchProjects() {
    const res = await fetch("/api/projects");
    if (!res.ok) throw new Error("Failed to fetch projects");
    const data = (await res.json()) as Project[];
    setProjects(data);
  }

  useEffect(() => {
    async function loadInitialEvents() {
      await Promise.all([fetchEvents(), fetchProjects()]);
    }

    void loadInitialEvents();
  }, []);


  useEffect(() => {
    if (fetching || events.length === 0) return;
    const eventId = new URLSearchParams(window.location.search).get("event");
    if (!eventId) return;
    const event = events.find((item) => item.id === eventId);
    if (!event) return;

    const timer = window.setTimeout(() => {
      setHighlightedEventId(eventId);
      startEditing(event);
      setSelectedDayKey(formatDayKey(new Date(event.startTime)));
      setCalendarMonth(new Date(new Date(event.startTime).getFullYear(), new Date(event.startTime).getMonth(), 1));
      document.getElementById(`event-${eventId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [events, fetching]);

  async function handleCreateEvent(e: FormEvent) {
    e.preventDefault();

    const createValidationError = validateEventInput({ title, startDate, startTime, endDate, endTime });
    if (createValidationError) {
      setError(createValidationError);
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
          startDate,
          startTime: startTime || null,
          endDate: endDate || null,
          endTime: endTime || null,
          recurrence,
          projectId,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Failed to create event");
      }

      setTitle("");
      setDescription("");
      setLocation("");
      setStartDate("");
      setStartTime("");
      setEndDate("");
      setEndTime("");
      setRecurrence("NONE");
      setProjectId("");
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
    const start = new Date(event.startTime);
    setEditStartDate(start.toISOString().slice(0,10));
    setEditStartTime(event.hasStartTime ? start.toISOString().slice(11,16) : "");
    if (event.endTime) { const end = new Date(event.endTime); setEditEndDate(end.toISOString().slice(0,10)); setEditEndTime(event.hasEndTime ? end.toISOString().slice(11,16) : ""); } else { setEditEndDate(""); setEditEndTime(""); }
    setEditRecurrence(normalizeRecurrence(event.recurrence));
    setEditProjectId(event.projectId ?? "");
    setError("");
  }

  function cancelEditing() {
    setEditingEventId(null);
    setEditTitle("");
    setEditDescription("");
    setEditLocation("");
    setEditStartDate("");
    setEditStartTime("");
    setEditEndDate("");
    setEditEndTime("");
    setEditRecurrence("NONE");
    setEditProjectId("");
  }

  async function handleSaveEdit(eventId: string) {
    const editValidationError = validateEventInput({
      title: editTitle,
      startDate: editStartDate,
      startTime: editStartTime,
      endDate: editEndDate,
      endTime: editEndTime,
    });
    if (editValidationError) {
      setError(editValidationError);
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
          startDate: editStartDate,
          startTime: editStartTime || null,
          endDate: editEndDate || null,
          endTime: editEndTime || null,
          recurrence: editRecurrence,
          projectId: editProjectId,
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
        <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="mb-2 text-4xl font-bold">Events</h1>
            <p className="text-zinc-600 dark:text-zinc-300">
              Create and manage scheduled events for AI-Multi Task-Management.
            </p>
          </div>
          <Link
            href="/events/calendar"
            aria-label="Open full calendar view"
            className={`${uiPrimaryButtonClass} gap-2 py-2.5`}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="h-4 w-4"
              aria-hidden="true"
            >
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            Full Calendar
          </Link>
        </div>

        <section className="mb-10 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-6 shadow-sm">
          <h2 className="mb-4 text-2xl font-semibold">Create Event</h2>

          <form onSubmit={handleCreateEvent} className="space-y-4">
            <input
              required
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
              <label className="space-y-1">
                <span className="text-sm font-medium text-zinc-700 dark:text-zinc-200">Beginning date</span>
                <input
                type="date"
                required
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 px-4 py-3 outline-none focus:border-black"
              />
              </label>
              <label className="space-y-1">
                <span className="text-sm font-medium text-zinc-700 dark:text-zinc-200">Beginning time</span>
                <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 px-4 py-3 outline-none focus:border-black"
              />
              </label>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1">
                <span className="text-sm font-medium text-zinc-700 dark:text-zinc-200">End date</span>
                <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 px-4 py-3 outline-none focus:border-black" />
              </label>
              <label className="space-y-1">
                <span className="text-sm font-medium text-zinc-700 dark:text-zinc-200">End time</span>
                <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 px-4 py-3 outline-none focus:border-black" />
              </label>
            </div>
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 px-4 py-3 outline-none focus:border-black"
            >
              <option value="">No project</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>{project.name}</option>
              ))}
            </select>
            <select
              value={recurrence}
              onChange={(e) => setRecurrence(e.target.value as Recurrence)}
              className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 px-4 py-3 outline-none focus:border-black"
            >
              <option value="NONE">Does not repeat</option>
              <option value="DAILY">Daily</option>
              <option value="WEEKLY">Weekly</option>
              <option value="BIWEEKLY">Every 2 weeks</option>
              <option value="MONTHLY">Monthly</option>
            </select>
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
              const totalEventCount = calendarEventsByDay[dayKey]?.length ?? 0;
              const selectedProjectCount = selectedProjectCalendarEventsByDay[dayKey]?.length ?? 0;
              const noProjectCount = (calendarEventsByDay[dayKey] ?? []).filter(
                (event) => event.projectId === null || event.projectId === undefined
              ).length;
              const eventCount = projectFilter === NO_PROJECT_FILTER ? noProjectCount : totalEventCount;
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
                    <div className="mt-2 space-y-1">
                      <p className="text-xs text-zinc-600 dark:text-zinc-300">
                        {eventCount === 1 ? "1 event" : `${eventCount} events`}
                      </p>
                      {selectedProject && selectedProjectCount > 0 && (
                        <p className="text-xs" style={{ color: selectedProject.color ?? undefined }}>
                          {selectedProjectCount} in {selectedProject.name}
                        </p>
                      )}
                    </div>
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
                  <li
                    key={event.id}
                    className={`rounded-lg border p-3 transition ${highlightedEventId === (event.sourceEventId ?? event.id) ? "border-blue-400 bg-blue-50 ring-2 ring-blue-200 dark:border-blue-700 dark:bg-blue-950/20 dark:ring-blue-900" : "border-zinc-200 dark:border-zinc-700"} ${
                      projectFilter !== ALL_PROJECTS_FILTER &&
                      projectFilter !== NO_PROJECT_FILTER &&
                      event.projectId !== projectFilter
                        ? "opacity-55"
                        : ""
                    }`}
                    style={
                      selectedProject && event.projectId === selectedProject.id
                        ? { borderLeftWidth: 4, borderLeftColor: selectedProject.color ?? "#18181b" }
                        : undefined
                    }
                  >
                    <p className="font-medium">{event.title}</p>
                    <p className="text-sm text-zinc-600 dark:text-zinc-300">
                      {event.hasStartTime ? formatTime(event.startTime) : "Time not specified"}{event.endTime && event.hasEndTime ? ` - ${formatTime(event.endTime)}` : ""}
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
          <div className="mb-4">
            <select
              value={projectFilter}
              onChange={(e) => setProjectFilter(e.target.value)}
              className="w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 outline-none focus:border-black dark:border-zinc-700 sm:max-w-xs"
            >
              <option value={ALL_PROJECTS_FILTER}>All projects</option>
              <option value={NO_PROJECT_FILTER}>No project</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>{project.name}</option>
              ))}
            </select>
          </div>
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
                    id={`event-${event.id}`}
                    className={`rounded-2xl border p-5 shadow-sm ${highlightedEventId === event.id ? "ring-4 ring-blue-200 dark:ring-blue-900" : ""} ${cardStyles}`}
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
                          <label className="space-y-1">
                            <span className="text-xs font-medium text-zinc-700 dark:text-zinc-200">Beginning date</span>
                            <input type="date" required value={editStartDate} onChange={(e) => setEditStartDate(e.target.value)} className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 px-3 py-2 outline-none focus:border-black" />
                          </label>
                          <label className="space-y-1">
                            <span className="text-xs font-medium text-zinc-700 dark:text-zinc-200">Beginning time</span>
                            <input type="time" value={editStartTime} onChange={(e) => setEditStartTime(e.target.value)} className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 px-3 py-2 outline-none focus:border-black" />
                          </label>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <label className="space-y-1">
                            <span className="text-xs font-medium text-zinc-700 dark:text-zinc-200">End date</span>
                            <input type="date" value={editEndDate} onChange={(e) => setEditEndDate(e.target.value)} className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 px-3 py-2 outline-none focus:border-black" />
                          </label>
                          <label className="space-y-1">
                            <span className="text-xs font-medium text-zinc-700 dark:text-zinc-200">End time</span>
                            <input type="time" value={editEndTime} onChange={(e) => setEditEndTime(e.target.value)} className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 px-3 py-2 outline-none focus:border-black" />
                          </label>
                        </div>
                        <select
                          value={editProjectId}
                          onChange={(e) => setEditProjectId(e.target.value)}
                          className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 px-3 py-2 outline-none focus:border-black"
                        >
                          <option value="">No project</option>
                          {projects.map((project) => (
                            <option key={project.id} value={project.id}>{project.name}</option>
                          ))}
                        </select>
                        <select
                          value={editRecurrence}
                          onChange={(e) => setEditRecurrence(e.target.value as Recurrence)}
                          className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 px-3 py-2 outline-none focus:border-black"
                        >
                          <option value="NONE">Does not repeat</option>
                          <option value="DAILY">Daily</option>
                          <option value="WEEKLY">Weekly</option>
                          <option value="BIWEEKLY">Every 2 weeks</option>
                          <option value="MONTHLY">Monthly</option>
                        </select>
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
                          <div className="flex flex-wrap items-center gap-2">
                            {event.recurrence !== "NONE" && (
                              <span className="rounded-full border border-violet-500 px-2.5 py-1 text-xs font-medium text-violet-700">
                                Repeats {formatRecurrenceLabel(event.recurrence)}
                              </span>
                            )}
                            {badgeText && (
                              <span
                                className={`rounded-full border border-current px-2.5 py-1 text-xs font-medium ${badgeStyles}`}
                              >
                                {badgeText}
                              </span>
                            )}
                            {event.project && (
                              <span className="rounded-full border px-2.5 py-1 text-xs font-medium text-zinc-700" style={{ borderColor: event.project.color ?? undefined }}>
                                {event.project.name}
                              </span>
                            )}
                          </div>
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
                          End: {event.endTime ? formatDateTime(event.endTime) : "Not specified"}
                        </p>
                        <p className="mt-1 text-sm text-gray-700">
                          Repeats: {formatRecurrenceLabel(event.recurrence)}
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
