"use client";

/**
 * EventsPage
 * ----------
 * Client-side page component for the "Events" feature of the AI-Multi
 * Task-Management app.
 *
 * Responsibilities:
 *  - Fetch the user's events and projects from the API on mount.
 *  - Provide a form to create new events (with optional recurrence and
 *    project association).
 *  - Render a month calendar with per-day event counts, and a detail list
 *    of events for whichever day is selected.
 *  - Render a chronological list of events grouped into sections
 *    (Today / Upcoming Soon / Later / Past), filterable by project.
 *  - Support inline editing and deletion (with confirmation) of events.
 *  - Support deep-linking: if the URL contains an `event` query param,
 *    the matching event is highlighted, scrolled into view, and opened
 *    for editing automatically.
 */

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { uiPrimaryButtonClass } from "@/components/ui";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  expandRecurringEventsForRange,
  formatRecurrenceLabel,
  normalizeRecurrence,
} from "@/lib/recurrence";
import { getLocalDateOnly } from "@/lib/task-date-buckets";

/** Supported recurrence patterns for an event. */
type Recurrence = "NONE" | "DAILY" | "WEEKLY" | "BIWEEKLY" | "MONTHLY";

/**
 * Shape of an event as used by the UI. Mirrors the API's event response,
 * with an added optional `sourceEventId` used when an event has been
 * "expanded" from a recurring series into individual calendar occurrences
 * (see `expandRecurringEventsForRange`), so each occurrence can be traced
 * back to the original stored event.
 */
type EventItem = {
  id: string;
  /** Present on expanded recurrence occurrences; points back to the original event's id. */
  sourceEventId?: string;
  title: string;
  description: string | null;
  location: string | null;
  /** ISO datetime string for when the event starts. */
  startTime: string;
  /** ISO datetime string for when the event ends, or null if unset. */
  endTime: string | null;
  /** Whether the user specified a start time (vs. an all-day/date-only event). */
  hasStartTime: boolean;
  /** Whether the user specified an end time. */
  hasEndTime: boolean;
  createdAt: string;
  updatedAt: string;
  recurrence?: Recurrence | null;
  projectId?: string | null;
  /** Populated project relation, if the event belongs to one. */
  project?: Project | null;
};

/** Minimal project shape needed to display project filters/badges. */
type Project = { id: string; name: string; color: string | null };

/** Sentinel value for the "show events from every project" filter option. */
const ALL_PROJECTS_FILTER = "ALL";
/** Sentinel value for the "show only events with no project" filter option. */
const NO_PROJECT_FILTER = "NO_PROJECT";

/**
 * Formats an ISO datetime string as a medium date + short time string,
 * e.g. "Jan 5, 2025, 3:00 PM", using the browser's locale.
 */
function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

/**
 * Formats a Date as a `YYYY-MM-DD` key using LOCAL (not UTC) date parts.
 * Used as the canonical lookup key for grouping events by calendar day.
 */
function formatDayKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Formats an ISO datetime string as a short local time, e.g. "3:00 PM".
 */
function formatTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeStyle: "short",
  }).format(new Date(value));
}

/**
 * Returns the local, time-stripped (midnight) Date for a given date/string.
 * Thin wrapper around the shared `getLocalDateOnly` utility so this file's
 * calendar-bucketing logic reads consistently as "day starts".
 */
function getLocalDayStart(date: Date | string) {
  return getLocalDateOnly(date);
}

/**
 * Compares two dates/strings to see if they fall on the same local calendar
 * day (ignoring time-of-day).
 */
function isSameLocalDay(left: Date | string, right: Date | string) {
  return formatDayKey(getLocalDayStart(left)) === formatDayKey(getLocalDayStart(right));
}

/** Whether an event's start time falls on the same local day as `now`. */
function isEventToday(event: EventItem, now: Date) {
  return isSameLocalDay(event.startTime, now);
}

/**
 * Validates the create/edit event form fields before submitting to the API.
 *
 * Rules enforced:
 *  - Title must be non-empty (after trimming whitespace).
 *  - Start date is required.
 *  - End date, if provided, cannot be earlier than the start date.
 *  - If start and end dates are the same day and both times are provided,
 *    the end time must be strictly after the start time.
 *
 * @returns An empty string if valid, otherwise a human-readable error message.
 */
function validateEventInput(input: {
  title: string;
  startDate: string;
  startTime?: string;
  endDate?: string;
  endTime?: string;
}) {
  if (!input.title.trim()) return "Title is required.";
  if (!input.startDate) return "Start date is required.";
  if (input.endDate && input.endDate < input.startDate)
    return "End date cannot be before start date.";
  if (
    input.endDate &&
    input.endDate === input.startDate &&
    input.startTime &&
    input.endTime &&
    input.endTime <= input.startTime
  ) {
    return "End time must be after start time when the dates are the same.";
  }
  return "";
}

export default function EventsPage() {
  // ---------------------------------------------------------------------
  // Core data state
  // ---------------------------------------------------------------------
  /** All events belonging to the current user, as returned by the API. */
  const [events, setEvents] = useState<EventItem[]>([]);
  /** All projects belonging to the current user, used for filters/badges/selects. */
  const [projects, setProjects] = useState<Project[]>([]);

  // ---------------------------------------------------------------------
  // Async / loading state
  // ---------------------------------------------------------------------
  /** True while the initial events fetch is in flight (controls the loading message). */
  const [fetching, setFetching] = useState(true);
  /** True while the "create event" request is in flight. */
  const [loading, setLoading] = useState(false);
  /** True while an "edit event" save request is in flight. */
  const [savingEdit, setSavingEdit] = useState(false);
  /** Id of the event currently being deleted, or null if none. Used to show a per-item spinner state. */
  const [deletingEventId, setDeletingEventId] = useState<string | null>(null);
  /** Id of the event currently open in inline-edit mode, or null if none. */
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  /** Current error message shown near the create form, or empty string if none. */
  const [error, setError] = useState("");
  /** Id of the event pending delete confirmation (drives the ConfirmDialog), or null if closed. */
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // ---------------------------------------------------------------------
  // Calendar navigation state
  // ---------------------------------------------------------------------
  /** First-of-month Date representing which month the calendar grid is showing. */
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  /** `YYYY-MM-DD` key for the day currently selected in the calendar (defaults to today). */
  const [selectedDayKey, setSelectedDayKey] = useState(() =>
    formatDayKey(new Date()),
  );

  // ---------------------------------------------------------------------
  // "Create event" form state
  // ---------------------------------------------------------------------
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [startDate, setStartDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endDate, setEndDate] = useState("");
  const [endTime, setEndTime] = useState("");
  const [recurrence, setRecurrence] = useState<Recurrence>("NONE");
  const [projectId, setProjectId] = useState("");

  // ---------------------------------------------------------------------
  // "Edit event" (inline) form state — mirrors the create form fields,
  // but scoped to whichever event is being edited (`editingEventId`).
  // ---------------------------------------------------------------------
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editLocation, setEditLocation] = useState("");
  const [editStartDate, setEditStartDate] = useState("");
  const [editStartTime, setEditStartTime] = useState("");
  const [editEndDate, setEditEndDate] = useState("");
  const [editEndTime, setEditEndTime] = useState("");
  const [editRecurrence, setEditRecurrence] = useState<Recurrence>("NONE");
  const [editProjectId, setEditProjectId] = useState("");

  /** Currently selected project filter: ALL_PROJECTS_FILTER, NO_PROJECT_FILTER, or a project id. */
  const [projectFilter, setProjectFilter] = useState(ALL_PROJECTS_FILTER);

  // ---------------------------------------------------------------------
  // Deep-link support: ?event=<id> in the URL highlights & opens an event
  // ---------------------------------------------------------------------
  const searchParams = useSearchParams();
  /** Event id requested via the `event` query param, if any. */
  const highlightedEventId = searchParams.get("event");
  /** Ref to the DOM node of the highlighted event's <article>, used to scroll it into view. */
  const highlightedEventRef = useRef<HTMLElement | null>(null);

  // ---------------------------------------------------------------------
  // Derived data (memoized)
  // ---------------------------------------------------------------------

  /**
   * Events filtered by the active project filter and sorted chronologically
   * by local start day. This is the base list that both the "list" section
   * and (indirectly) other derived views build on.
   */
  const visibleEvents = useMemo(() => {
    return events
      .filter((event) => {
        if (projectFilter === ALL_PROJECTS_FILTER) return true;
        if (projectFilter === NO_PROJECT_FILTER)
          return event.projectId === null || event.projectId === undefined;
        return event.projectId === projectFilter;
      })
      .sort(
        (a, b) =>
          getLocalDayStart(a.startTime).getTime() - getLocalDayStart(b.startTime).getTime(),
      );
  }, [events, projectFilter]);

  /** The Project object matching the current project filter, or null if filtering by ALL/NO_PROJECT. */
  const selectedProject = useMemo(
    () => projects.find((project) => project.id === projectFilter) ?? null,
    [projects, projectFilter],
  );

  /**
   * Buckets `visibleEvents` into four display sections for the "Your Events"
   * list, relative to the current moment:
   *  - Today: starts on the same local day as now.
   *  - Upcoming Soon: starts between tomorrow and 7 days from today (inclusive).
   *  - Later: starts more than 7 days from today.
   *  - Past: has already ended (or started, if no end time) before today.
   */
  const eventSections = useMemo(() => {
    const now = new Date();
    const todayStart = getLocalDayStart(now);
    const tomorrowStart = new Date(todayStart);
    tomorrowStart.setDate(tomorrowStart.getDate() + 1);
    const soonBoundary = new Date(todayStart);
    soonBoundary.setDate(soonBoundary.getDate() + 7);

    const today = visibleEvents.filter((event) => isEventToday(event, now));
    const upcoming = visibleEvents.filter((event) => {
      const start = getLocalDayStart(event.startTime);
      return start >= tomorrowStart && start <= soonBoundary;
    });
    const later = visibleEvents.filter(
      (event) => getLocalDayStart(event.startTime) > soonBoundary,
    );
    const past = visibleEvents.filter((event) =>
      event.endTime
        ? getLocalDayStart(event.endTime) < todayStart
        : getLocalDayStart(event.startTime) < todayStart,
    );

    return [
      { key: "TODAY", title: "Today", events: today },
      { key: "UPCOMING", title: "Upcoming Soon", events: upcoming },
      { key: "LATER", title: "Later", events: later },
      { key: "PAST", title: "Past", events: past },
    ] as const;
  }, [visibleEvents]);

  /**
   * Full grid of Date objects to render in the calendar, covering the
   * displayed month padded out to whole weeks (Sunday-start) before the
   * 1st and after the last day, so the grid is always a rectangle of
   * complete weeks.
   */
  const calendarDays = useMemo(() => {
    const monthStart = new Date(
      calendarMonth.getFullYear(),
      calendarMonth.getMonth(),
      1,
    );
    const monthEnd = new Date(
      calendarMonth.getFullYear(),
      calendarMonth.getMonth() + 1,
      0,
    );
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

  /**
   * The inclusive [start, end] Date range covered by `calendarDays`
   * (start of first day through end of last day), used as bounds when
   * expanding recurring events into individual occurrences.
   */
  const visibleCalendarRange = useMemo(() => {
    const start = new Date(calendarDays[0]);
    start.setHours(0, 0, 0, 0);

    const end = new Date(calendarDays[calendarDays.length - 1]);
    end.setHours(23, 59, 59, 999);

    return { start, end };
  }, [calendarDays]);

  /**
   * All events (including recurring-series occurrences) that fall within
   * the visible calendar range. Each event is tagged with `sourceEventId`
   * pointing back to its original stored event before being expanded.
   */
  const expandedCalendarEvents = useMemo(() => {
    const eventsWithSourceId = events.map((event) => ({
      ...event,
      sourceEventId: event.id,
    }));

    return expandRecurringEventsForRange(
      eventsWithSourceId,
      visibleCalendarRange.start,
      visibleCalendarRange.end,
    );
  }, [events, visibleCalendarRange]);

  /**
   * `expandedCalendarEvents` grouped by local day key (`YYYY-MM-DD`),
   * used to render event counts/badges on each calendar cell and to look
   * up events for the selected day.
   */
  const calendarEventsByDay = useMemo(() => {
    return expandedCalendarEvents.reduce<Record<string, EventItem[]>>(
      (acc, event) => {
        const key = formatDayKey(getLocalDayStart(event.startTime));
        if (!acc[key]) {
          acc[key] = [];
        }
        acc[key].push(event);
        return acc;
      },
      {},
    );
  }, [expandedCalendarEvents]);

  /**
   * Same grouping as `calendarEventsByDay`, but restricted to events
   * belonging to the currently selected project filter. Returns an empty
   * object when the filter is ALL or NO_PROJECT, since this is only used
   * to render a secondary "N in <project>" count on calendar cells when a
   * specific project is selected.
   */
  const selectedProjectCalendarEventsByDay = useMemo(() => {
    if (
      projectFilter === ALL_PROJECTS_FILTER ||
      projectFilter === NO_PROJECT_FILTER
    ) {
      return {} as Record<string, EventItem[]>;
    }
    return expandedCalendarEvents.reduce<Record<string, EventItem[]>>(
      (acc, event) => {
        if (event.projectId !== projectFilter) return acc;
        const key = formatDayKey(getLocalDayStart(event.startTime));
        if (!acc[key]) {
          acc[key] = [];
        }
        acc[key].push(event);
        return acc;
      },
      {},
    );
  }, [expandedCalendarEvents, projectFilter]);

  /**
   * Events to display in the "Events on <selected day>" panel: all events
   * for `selectedDayKey`, further filtered down to "no project" events
   * when that filter is active, sorted chronologically.
   */
  const selectedDayEvents = useMemo(() => {
    let eventsForDay = calendarEventsByDay[selectedDayKey] ?? [];
    if (projectFilter === NO_PROJECT_FILTER) {
      eventsForDay = eventsForDay.filter(
        (event) => event.projectId === null || event.projectId === undefined,
      );
    }
    return [...eventsForDay].sort(
      (a, b) =>
        getLocalDayStart(a.startTime).getTime() - getLocalDayStart(b.startTime).getTime(),
    );
  }, [calendarEventsByDay, selectedDayKey, projectFilter]);

  /** Human-readable full date label (e.g. "Monday, January 5, 2025") for `selectedDayKey`. */
  const selectedDayLabel = useMemo(() => {
    const [year, month, day] = selectedDayKey.split("-").map(Number);
    return new Intl.DateTimeFormat("en-US", { dateStyle: "full" }).format(
      new Date(year, month - 1, day),
    );
  }, [selectedDayKey]);

  // ---------------------------------------------------------------------
  // Calendar navigation handlers
  // ---------------------------------------------------------------------

  /** Moves the calendar view back one month. */
  function goToPreviousMonth() {
    setCalendarMonth(
      (prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1),
    );
  }

  /** Moves the calendar view forward one month. */
  function goToNextMonth() {
    setCalendarMonth(
      (prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1),
    );
  }

  // ---------------------------------------------------------------------
  // Data fetching
  // ---------------------------------------------------------------------

  /**
   * Fetches the current user's events from `/api/events`, normalizes each
   * event's recurrence value, and stores the result in state.
   *
   * @param showLoading When true (default), toggles the `fetching` flag so
   *   the UI shows a "Loading events..." message. Pass false for background
   *   refreshes (e.g. after create/edit) so the list doesn't flash a loader.
   */
  async function fetchEvents(showLoading = true) {
    try {
      if (showLoading) setFetching(true);
      setError("");

      const res = await fetch("/api/events");
      if (!res.ok) {
        throw new Error("Failed to fetch events");
      }

      const data = (await res.json()) as EventItem[];
      setEvents(
        data.map((event) => ({
          ...event,
          recurrence: normalizeRecurrence(event.recurrence),
        })),
      );
    } catch {
      setError("Could not load events.");
    } finally {
      setFetching(false);
    }
  }

  /** Fetches the current user's projects from `/api/projects` and stores them in state. */
  async function fetchProjects() {
    const res = await fetch("/api/projects");
    if (!res.ok) throw new Error("Failed to fetch projects");
    const data = (await res.json()) as Project[];
    setProjects(data);
  }

  /** On mount: load events and projects in parallel. */
  useEffect(() => {
    async function loadInitialEvents() {
      await Promise.all([fetchEvents(), fetchProjects()]);
    }

    void loadInitialEvents();
  }, []);

  /**
   * Deep-link handling: once events have loaded, if the URL specifies
   * `?event=<id>`, this:
   *  1. Clears the project filter (so the event is guaranteed visible).
   *  2. Navigates the calendar to the month/day containing the event.
   *  3. Opens the event in inline-edit mode.
   *  4. Scrolls the corresponding list item into view.
   *
   * Runs whenever `events`, `fetching`, or `highlightedEventId` change, but
   * no-ops if there's no id to highlight or events are still loading.
   */
  useEffect(() => {
    if (!highlightedEventId || fetching) return;
    const event = events.find((item) => item.id === highlightedEventId);
    if (!event) return;
    const timer = window.setTimeout(() => {
      setProjectFilter(ALL_PROJECTS_FILTER);
      setSelectedDayKey(formatDayKey(getLocalDayStart(event.startTime)));
      const eventDay = getLocalDayStart(event.startTime);
      setCalendarMonth(
        new Date(eventDay.getFullYear(), eventDay.getMonth(), 1),
      );
      startEditing(event);
      window.requestAnimationFrame(() => {
        highlightedEventRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [events, fetching, highlightedEventId]);

  // ---------------------------------------------------------------------
  // Create / Edit / Delete handlers
  // ---------------------------------------------------------------------

  /**
   * Handles submission of the "Create Event" form: validates input,
   * POSTs to `/api/events`, resets the form on success, and refreshes
   * the events list in the background.
   */
  async function handleCreateEvent(e: FormEvent) {
    e.preventDefault();

    const createValidationError = validateEventInput({
      title,
      startDate,
      startTime,
      endDate,
      endTime,
    });
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

      // Reset the create form back to its default empty state.
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

  /**
   * Opens `event` for inline editing: populates the edit form fields from
   * the event's current values (splitting the ISO start/end datetimes back
   * into separate date/time inputs) and marks it as the active edit target.
   */
  function startEditing(event: EventItem) {
    setEditingEventId(event.id);
    setEditTitle(event.title);
    setEditDescription(event.description ?? "");
    setEditLocation(event.location ?? "");
    const start = new Date(event.startTime);
    setEditStartDate(formatDayKey(getLocalDayStart(event.startTime)));
    setEditStartTime(
      event.hasStartTime ? start.toTimeString().slice(0, 5) : "",
    );
    if (event.endTime) {
      const end = new Date(event.endTime);
      setEditEndDate(formatDayKey(getLocalDayStart(event.endTime)));
      setEditEndTime(event.hasEndTime ? end.toTimeString().slice(0, 5) : "");
    } else {
      setEditEndDate("");
      setEditEndTime("");
    }
    setEditRecurrence(normalizeRecurrence(event.recurrence));
    setEditProjectId(event.projectId ?? "");
    setError("");
  }

  /** Closes inline-edit mode and resets all edit-form fields to their defaults. */
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

  /**
   * Validates the edit form and, if valid, PATCHes the event at `eventId`
   * with the current edit-form values. On success, replaces the event in
   * local state with the server's updated copy and exits edit mode.
   */
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
      setEvents((prev) =>
        prev.map((event) => (event.id === eventId ? updated : event)),
      );
      cancelEditing();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update event.");
    } finally {
      setSavingEdit(false);
    }
  }

  /**
   * Deletes the event at `eventId` via the API (soft-delete / move to
   * Trash, per the confirm dialog copy). On success, removes it from local
   * state and, if it was the event currently being edited, exits edit mode.
   */
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

  // ---------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------
  return (
    <>
      <main className="min-h-screen px-6 py-10">
        <div className="mx-auto max-w-4xl">
          {/* Page header with title/description and a link to the full calendar view */}
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
              {/* Calendar icon */}
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

          {/* ------------------------------------------------------------
              Create Event form
          ------------------------------------------------------------- */}
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
              {/* Start date/time row */}
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1">
                  <span className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
                    Beginning date
                  </span>
                  <input
                    type="date"
                    required
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 px-4 py-3 outline-none focus:border-black"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
                    Beginning time
                  </span>
                  <input
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 px-4 py-3 outline-none focus:border-black"
                  />
                </label>
              </div>
              {/* End date/time row */}
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1">
                  <span className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
                    End date
                  </span>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 px-4 py-3 outline-none focus:border-black"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
                    End time
                  </span>
                  <input
                    type="time"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 px-4 py-3 outline-none focus:border-black"
                  />
                </label>
              </div>
              {/* Project association */}
              <select
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 px-4 py-3 outline-none focus:border-black"
              >
                <option value="">No project</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
              {/* Recurrence pattern */}
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

          {/* ------------------------------------------------------------
              Calendar: month grid + selected-day event list
          ------------------------------------------------------------- */}
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

            {/* Weekday header row (Sun–Sat) */}
            <div className="mb-3 grid grid-cols-7 gap-2 text-center text-xs font-semibold uppercase tracking-wide text-zinc-500">
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
                <span key={day}>{day}</span>
              ))}
            </div>

            {/* Month grid: one button per day, showing an event-count badge */}
            <div className="grid grid-cols-7 gap-2">
              {calendarDays.map((day) => {
                const dayKey = formatDayKey(day);
                const totalEventCount =
                  calendarEventsByDay[dayKey]?.length ?? 0;
                const selectedProjectCount =
                  selectedProjectCalendarEventsByDay[dayKey]?.length ?? 0;
                const noProjectCount = (
                  calendarEventsByDay[dayKey] ?? []
                ).filter(
                  (event) =>
                    event.projectId === null || event.projectId === undefined,
                ).length;
                // When filtering to "No project", show only that count;
                // otherwise show the total count for the day regardless of
                // which specific project filter (if any) is active.
                const eventCount =
                  projectFilter === NO_PROJECT_FILTER
                    ? noProjectCount
                    : totalEventCount;
                const isCurrentMonth =
                  day.getMonth() === calendarMonth.getMonth();
                const isSelected = dayKey === selectedDayKey;
                const isToday = dayKey === formatDayKey(new Date());

                return (
                  <button
                    key={dayKey}
                    onClick={() => setSelectedDayKey(dayKey)}
                    className={`min-h-20 rounded-xl border p-2 text-left transition ${
                      isSelected
                        ? "border-black bg-zinc-100 dark:bg-zinc-800"
                        : "border-zinc-200 dark:border-zinc-700 hover:border-zinc-400"
                    } ${!isCurrentMonth ? "opacity-50" : ""}`}
                  >
                    <div className="flex items-center justify-between">
                      <span
                        className={`text-sm ${isToday ? "font-bold text-blue-700" : ""}`}
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
                        <p className="text-xs text-zinc-600 dark:text-zinc-300">
                          {eventCount === 1
                            ? "1 event"
                            : `${eventCount} events`}
                        </p>
                        {/* Secondary count of events in the actively-filtered project */}
                        {selectedProject && selectedProjectCount > 0 && (
                          <p
                            className="text-xs"
                            style={{
                              color: selectedProject.color ?? undefined,
                            }}
                          >
                            {selectedProjectCount} in {selectedProject.name}
                          </p>
                        )}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Detail panel: events on the currently selected calendar day */}
            <div className="mt-6 rounded-xl border border-zinc-200 dark:border-zinc-700 p-4">
              <h3 className="mb-3 text-lg font-semibold">
                Events on {selectedDayLabel}
              </h3>
              {selectedDayEvents.length === 0 ? (
                <p className="text-sm text-zinc-600 dark:text-zinc-300">
                  No events for this day.
                </p>
              ) : (
                <ul className="space-y-3">
                  {selectedDayEvents.map((event) => (
                    <li
                      key={event.id}
                      className={`rounded-lg border border-zinc-200 p-3 dark:border-zinc-700 ${
                        // Dim events that don't match a specific active project filter
                        // (they're still shown because they fall on the selected day).
                        projectFilter !== ALL_PROJECTS_FILTER &&
                        projectFilter !== NO_PROJECT_FILTER &&
                        event.projectId !== projectFilter
                          ? "opacity-55"
                          : ""
                      }`}
                      style={
                        selectedProject &&
                        event.projectId === selectedProject.id
                          ? {
                              // Highlight events belonging to the selected project
                              // with a colored left border.
                              borderLeftWidth: 4,
                              borderLeftColor:
                                selectedProject.color ?? "#18181b",
                            }
                          : undefined
                      }
                    >
                      <p className="font-medium">{event.title}</p>
                      <p className="text-sm text-zinc-600 dark:text-zinc-300">
                        {event.hasStartTime
                          ? formatTime(event.startTime)
                          : "Time not specified"}
                        {event.endTime && event.hasEndTime
                          ? ` - ${formatTime(event.endTime)}`
                          : ""}
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

          {/* ------------------------------------------------------------
              Your Events: full chronological, sectioned, filterable list
          ------------------------------------------------------------- */}
          <section>
            <h2 className="mb-4 text-2xl font-semibold">Your Events</h2>
            {/* Project filter dropdown, shared by both the calendar and this list */}
            <div className="mb-4">
              <select
                value={projectFilter}
                onChange={(e) => setProjectFilter(e.target.value)}
                className="w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 outline-none focus:border-black dark:border-zinc-700 sm:max-w-xs"
              >
                <option value={ALL_PROJECTS_FILTER}>All projects</option>
                <option value={NO_PROJECT_FILTER}>No project</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </div>
            {fetching ? (
              <p className="text-zinc-600 dark:text-zinc-300">
                Loading events...
              </p>
            ) : visibleEvents.length === 0 ? (
              <p className="text-zinc-600 dark:text-zinc-300">No events yet.</p>
            ) : (
              <div className="space-y-6">
                {/* One block per section: Today / Upcoming Soon / Later / Past */}
                {eventSections.map((section) => (
                  <div key={section.key}>
                    <h3 className="mb-3 text-lg font-semibold text-gray-800">
                      {section.title}
                    </h3>
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
                          // "Starts soon" = starts strictly in the future but within the next 48 hours.
                          const startsSoon =
                            new Date(event.startTime).getTime() >
                              now.getTime() &&
                            new Date(event.startTime).getTime() <=
                              now.getTime() + 48 * 60 * 60 * 1000;
                          const badgeText = today
                            ? "Today"
                            : startsSoon
                              ? "Soon"
                              : null;
                          const badgeStyles = today
                            ? "text-emerald-700"
                            : "text-blue-700";
                          const cardStyles = today
                            ? "border-emerald-200 bg-emerald-50"
                            : startsSoon
                              ? "border-blue-200 bg-blue-50"
                              : "border-zinc-200 dark:border-zinc-800";

                          return (
                            <article
                              key={event.id}
                              // Attach the scroll-into-view ref only to the
                              // event matching the ?event= deep link.
                              ref={
                                highlightedEventId === event.id
                                  ? highlightedEventRef
                                  : null
                              }
                              className={`rounded-2xl border p-5 shadow-sm ${cardStyles} ${highlightedEventId === event.id ? "ring-4 ring-blue-300 dark:ring-blue-800" : ""}`}
                            >
                              {isEditing ? (
                                // ---------------- Inline edit form ----------------
                                <div className="space-y-3">
                                  <input
                                    value={editTitle}
                                    onChange={(e) =>
                                      setEditTitle(e.target.value)
                                    }
                                    className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 px-3 py-2 outline-none focus:border-black"
                                  />
                                  <textarea
                                    value={editDescription}
                                    onChange={(e) =>
                                      setEditDescription(e.target.value)
                                    }
                                    rows={3}
                                    className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 px-3 py-2 outline-none focus:border-black"
                                  />
                                  <input
                                    value={editLocation}
                                    onChange={(e) =>
                                      setEditLocation(e.target.value)
                                    }
                                    className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 px-3 py-2 outline-none focus:border-black"
                                  />
                                  <div className="grid gap-3 sm:grid-cols-2">
                                    <label className="space-y-1">
                                      <span className="text-xs font-medium text-zinc-700 dark:text-zinc-200">
                                        Beginning date
                                      </span>
                                      <input
                                        type="date"
                                        required
                                        value={editStartDate}
                                        onChange={(e) =>
                                          setEditStartDate(e.target.value)
                                        }
                                        className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 px-3 py-2 outline-none focus:border-black"
                                      />
                                    </label>
                                    <label className="space-y-1">
                                      <span className="text-xs font-medium text-zinc-700 dark:text-zinc-200">
                                        Beginning time
                                      </span>
                                      <input
                                        type="time"
                                        value={editStartTime}
                                        onChange={(e) =>
                                          setEditStartTime(e.target.value)
                                        }
                                        className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 px-3 py-2 outline-none focus:border-black"
                                      />
                                    </label>
                                  </div>
                                  <div className="grid gap-3 sm:grid-cols-2">
                                    <label className="space-y-1">
                                      <span className="text-xs font-medium text-zinc-700 dark:text-zinc-200">
                                        End date
                                      </span>
                                      <input
                                        type="date"
                                        value={editEndDate}
                                        onChange={(e) =>
                                          setEditEndDate(e.target.value)
                                        }
                                        className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 px-3 py-2 outline-none focus:border-black"
                                      />
                                    </label>
                                    <label className="space-y-1">
                                      <span className="text-xs font-medium text-zinc-700 dark:text-zinc-200">
                                        End time
                                      </span>
                                      <input
                                        type="time"
                                        value={editEndTime}
                                        onChange={(e) =>
                                          setEditEndTime(e.target.value)
                                        }
                                        className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 px-3 py-2 outline-none focus:border-black"
                                      />
                                    </label>
                                  </div>
                                  <select
                                    value={editProjectId}
                                    onChange={(e) =>
                                      setEditProjectId(e.target.value)
                                    }
                                    className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 px-3 py-2 outline-none focus:border-black"
                                  >
                                    <option value="">No project</option>
                                    {projects.map((project) => (
                                      <option
                                        key={project.id}
                                        value={project.id}
                                      >
                                        {project.name}
                                      </option>
                                    ))}
                                  </select>
                                  <select
                                    value={editRecurrence}
                                    onChange={(e) =>
                                      setEditRecurrence(
                                        e.target.value as Recurrence,
                                      )
                                    }
                                    className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 px-3 py-2 outline-none focus:border-black"
                                  >
                                    <option value="NONE">
                                      Does not repeat
                                    </option>
                                    <option value="DAILY">Daily</option>
                                    <option value="WEEKLY">Weekly</option>
                                    <option value="BIWEEKLY">
                                      Every 2 weeks
                                    </option>
                                    <option value="MONTHLY">Monthly</option>
                                  </select>
                                  <div className="flex flex-wrap gap-2">
                                    <button
                                      onClick={() =>
                                        void handleSaveEdit(event.id)
                                      }
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
                                // ---------------- Read-only event card ----------------
                                <>
                                  <div className="flex items-start justify-between gap-3">
                                    <h3 className="text-xl font-semibold">
                                      {event.title}
                                    </h3>
                                    <div className="flex flex-wrap items-center gap-2">
                                      {event.recurrence !== "NONE" && (
                                        <span className="rounded-full border border-violet-500 px-2.5 py-1 text-xs font-medium text-violet-700">
                                          Repeats{" "}
                                          {formatRecurrenceLabel(
                                            event.recurrence,
                                          )}
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
                                        <span
                                          className="rounded-full border px-2.5 py-1 text-xs font-medium text-zinc-700"
                                          style={{
                                            borderColor:
                                              event.project.color ?? undefined,
                                          }}
                                        >
                                          {event.project.name}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                  {event.description ? (
                                    <p className="mt-2 text-gray-700">
                                      {event.description}
                                    </p>
                                  ) : (
                                    <p className="mt-2 text-gray-500">
                                      No description.
                                    </p>
                                  )}
                                  {event.location ? (
                                    <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
                                      Location: {event.location}
                                    </p>
                                  ) : (
                                    <p className="mt-2 text-sm text-gray-500">
                                      No location set.
                                    </p>
                                  )}
                                  <p className="mt-2 text-sm text-gray-700">
                                    Start: {formatDateTime(event.startTime)}
                                  </p>
                                  <p className="mt-1 text-sm text-gray-700">
                                    End:{" "}
                                    {event.endTime
                                      ? formatDateTime(event.endTime)
                                      : "Not specified"}
                                  </p>
                                  <p className="mt-1 text-sm text-gray-700">
                                    Repeats:{" "}
                                    {formatRecurrenceLabel(event.recurrence)}
                                  </p>
                                  <div className="mt-4 flex gap-2">
                                    <button
                                      onClick={() => startEditing(event)}
                                      className="rounded-xl border border-zinc-300 dark:border-zinc-700 px-4 py-2"
                                    >
                                      Edit
                                    </button>
                                    <button
                                      onClick={(e) => {
                                        // Prevent the click from bubbling to any
                                        // ancestor click handlers on the card.
                                        e.stopPropagation();
                                        setConfirmDeleteId(event.id);
                                      }}
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
      {/* Confirmation modal shown before permanently triggering a delete request */}
      <ConfirmDialog
        open={Boolean(confirmDeleteId)}
        title="Confirm delete"
        message="This will move the item to Trash."
        loading={Boolean(deletingEventId)}
        onCancel={() => setConfirmDeleteId(null)}
        onConfirm={() => {
          if (confirmDeleteId) void handleDeleteEvent(confirmDeleteId);
          setConfirmDeleteId(null);
        }}
      />
    </>
  );
}
