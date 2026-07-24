"use client";

/**
 * EventsCalendarPage
 * -------------------
 * The "Full Calendar" page: a larger, combined month view that shows both
 * events and tasks-with-due-dates side by side, with a day-detail sidebar.
 *
 * Responsibilities:
 *  - Fetch events, tasks, and projects in parallel on mount.
 *  - Render a month grid (desktop) or a rolling 3-day view (mobile) showing
 *    per-day previews of events and due tasks, filterable by project.
 *  - Show full details for whichever day is selected in a side panel,
 *    including the ability to open an event for editing (navigates to the
 *    /events page with a deep-link query param) or open a task.
 *  - Allow marking a task done directly from the calendar, and deleting an
 *    event (with confirmation) directly from the day-detail panel.
 */

import { useRouter } from "next/navigation";
import { BackLink, uiButtonClass, uiCardClass } from "@/components/ui";
import { useEffect, useMemo, useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  expandRecurringEventsForRange,
  formatRecurrenceLabel,
  normalizeRecurrence,
} from "@/lib/recurrence";
import { formatTaskDueDate, getLocalDateOnly } from "@/lib/task-date-buckets";

/** Supported recurrence patterns for an event or recurring task. */
type Recurrence = "NONE" | "DAILY" | "WEEKLY" | "BIWEEKLY" | "MONTHLY";

/**
 * Shape of an event as used by the UI. `sourceEventId` is populated once an
 * event has been expanded into a concrete occurrence of a recurring series
 * (see `expandRecurringEventsForRange`), pointing back to the original
 * stored event's id — needed so actions like "open" or "delete" target the
 * real record rather than a virtual occurrence.
 */
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
  projectId?: string | null;
  project?: Project | null;
};

type TaskStatus = "TODO" | "IN_PROGRESS" | "DONE";
type Priority = "LOW" | "MEDIUM" | "HIGH";

/** Shape of a task as used by the UI (only tasks with a due date appear on this calendar). */
type TaskItem = {
  id: string;
  title: string;
  description?: string | null;
  status: TaskStatus;
  priority: Priority;
  dueDate: string | null;
  recurrence?: Recurrence | null;
  projectId?: string | null;
  project?: Project | null;
  assignee?: { id: string } | null;
};

/** Minimal project shape needed to display project filters/badges. */
type Project = { id: string; name: string; color: string | null };

/** Sentinel value for the "show items from every project" filter option. */
const ALL_PROJECTS_FILTER = "ALL";
/** Sentinel value for the "show only items with no project" filter option. */
const NO_PROJECT_FILTER = "NO_PROJECT";

/**
 * Formats a Date as a `YYYY-MM-DD` key using LOCAL (not UTC) date parts.
 * Used as the canonical lookup key for grouping events/tasks by calendar day.
 */
function formatDayKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Formats an ISO datetime string as a short local time, e.g. "3:00 PM". */
function formatTime(value: string) {
  return new Intl.DateTimeFormat("en-US", { timeStyle: "short" }).format(
    new Date(value),
  );
}

export default function EventsCalendarPage() {
  // ---------------------------------------------------------------------
  // Core data state
  // ---------------------------------------------------------------------
  /** All events belonging to the current user. */
  const [events, setEvents] = useState<EventItem[]>([]);
  const router = useRouter();
  /** All tasks belonging to the current user (later filtered down to those with a due date). */
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  /** All projects belonging to the current user, used for the filter dropdown and color accents. */
  const [projects, setProjects] = useState<Project[]>([]);
  /** Currently selected project filter: ALL_PROJECTS_FILTER, NO_PROJECT_FILTER, or a project id. */
  const [projectFilter, setProjectFilter] = useState(ALL_PROJECTS_FILTER);

  // ---------------------------------------------------------------------
  // Async / loading state
  // ---------------------------------------------------------------------
  /** True while the initial events/tasks/projects fetch is in flight. */
  const [fetching, setFetching] = useState(true);
  /** Current error message shown near the top of the page, or empty string if none. */
  const [error, setError] = useState("");

  // ---------------------------------------------------------------------
  // Calendar navigation state
  // ---------------------------------------------------------------------
  /** First-of-month Date representing which month the desktop calendar grid is showing. */
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  /** `YYYY-MM-DD` key for the day currently selected (drives the detail sidebar); defaults to today. */
  const [selectedDayKey, setSelectedDayKey] = useState(() =>
    formatDayKey(new Date()),
  );
  /** Start-of-day Date anchoring the mobile 3-day rolling view; defaults to today at midnight. */
  const [mobileRangeStart, setMobileRangeStart] = useState(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return today;
  });

  // ---------------------------------------------------------------------
  // Action state (delete event / complete task)
  // ---------------------------------------------------------------------
  /** Id of the event currently being deleted, or null if none — drives the button's "Deleting..." state. */
  const [deletingEventId, setDeletingEventId] = useState<string | null>(null);
  /** Id of the event pending delete confirmation (drives the ConfirmDialog), or null if closed. */
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  /** Id of the task currently being marked done, or null if none — drives the button's "Saving…" state. */
  const [completingTaskId, setCompletingTaskId] = useState<string | null>(null);

  /**
   * On mount: fetch events, tasks, and projects in parallel. Events have
   * their recurrence value normalized before being stored. Any failure in
   * events/tasks fetching surfaces a single generic error message.
   */
  useEffect(() => {
    async function loadEvents() {
      try {
        setFetching(true);
        setError("");

        const [eventsResponse, tasksResponse, projectsData] = await Promise.all(
          [
            fetch("/api/events", { cache: "no-store" }),
            fetch("/api/tasks", { cache: "no-store" }),
            fetch("/api/projects", { cache: "no-store" }).then(async (res) => {
              if (!res.ok) throw new Error("Failed to fetch projects");
              return res.json() as Promise<Project[]>;
            }),
          ],
        );
        if (!eventsResponse.ok || !tasksResponse.ok) {
          throw new Error("Failed to fetch calendar items");
        }

        const [eventsData, tasksData] = await Promise.all([
          eventsResponse.json() as Promise<EventItem[]>,
          tasksResponse.json() as Promise<TaskItem[]>,
        ]);
        setEvents(
          eventsData.map((event) => ({
            ...event,
            recurrence: normalizeRecurrence(event.recurrence),
          })),
        );
        setTasks(tasksData);
        setProjects(projectsData);
      } catch {
        setError("Could not load calendar items.");
      } finally {
        setFetching(false);
      }
    }

    void loadEvents();
  }, []);

  // ---------------------------------------------------------------------
  // Derived data (memoized)
  // ---------------------------------------------------------------------

  /**
   * Full grid of Date objects for the desktop month view, covering the
   * displayed month padded out to whole weeks (Sunday-start) before the
   * 1st and after the last day, so the grid is always a rectangle.
   */
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

  /**
   * The inclusive [start, end] Date range covered by `monthDays` (start of
   * first day through end of last day), used as bounds when expanding
   * recurring events into individual occurrences.
   */
  const visibleRange = useMemo(() => {
    const start = new Date(monthDays[0]);
    start.setHours(0, 0, 0, 0);

    const end = new Date(monthDays[monthDays.length - 1]);
    end.setHours(23, 59, 59, 999);

    return { start, end };
  }, [monthDays]);

  /**
   * All events (including recurring-series occurrences) that fall within
   * the visible month range. Each event is tagged with `sourceEventId`
   * pointing back to its original stored event before being expanded.
   */
  const expandedEvents = useMemo(() => {
    const eventsWithSourceId = events.map((event) => ({
      ...event,
      sourceEventId: event.id,
    }));
    return expandRecurringEventsForRange(
      eventsWithSourceId,
      visibleRange.start,
      visibleRange.end,
    );
  }, [events, visibleRange]);

  /** The Project object matching the current project filter, or null if filtering by ALL/NO_PROJECT. */
  const selectedProject = useMemo(
    () => projects.find((project) => project.id === projectFilter) ?? null,
    [projects, projectFilter],
  );

  /** `expandedEvents` narrowed down to the currently active project filter. */
  const filteredExpandedEvents = useMemo(() => {
    return expandedEvents.filter((event) => {
      if (projectFilter === ALL_PROJECTS_FILTER) return true;
      if (projectFilter === NO_PROJECT_FILTER)
        return event.projectId === null || event.projectId === undefined;
      return event.projectId === projectFilter;
    });
  }, [expandedEvents, projectFilter]);

  /** `filteredExpandedEvents` grouped by local day key (`YYYY-MM-DD`) for calendar-cell rendering. */
  const eventsByDay = useMemo(() => {
    return filteredExpandedEvents.reduce<Record<string, EventItem[]>>(
      (acc, event) => {
        const key = formatDayKey(getLocalDateOnly(event.startTime));
        if (!acc[key]) {
          acc[key] = [];
        }
        acc[key].push(event);
        return acc;
      },
      {},
    );
  }, [filteredExpandedEvents]);

  /**
   * Tasks that have a due date, narrowed down to the currently active
   * project filter. Tasks without a `dueDate` never appear on this
   * calendar, regardless of the filter.
   */
  const filteredTasks = useMemo(() => {
    return tasks.filter((task) => {
      if (!task.dueDate) return false;
      if (projectFilter === ALL_PROJECTS_FILTER) return true;
      if (projectFilter === NO_PROJECT_FILTER)
        return task.projectId === null || task.projectId === undefined;
      return task.projectId === projectFilter;
    });
  }, [projectFilter, tasks]);

  /** `filteredTasks` grouped by local due-date day key (`YYYY-MM-DD`) for calendar-cell rendering. */
  const tasksByDay = useMemo(() => {
    return filteredTasks.reduce<Record<string, TaskItem[]>>((acc, task) => {
      if (!task.dueDate) return acc;
      const key = formatDayKey(getLocalDateOnly(task.dueDate));
      if (!acc[key]) {
        acc[key] = [];
      }
      acc[key].push(task);
      return acc;
    }, {});
  }, [filteredTasks]);

  /** Events for `selectedDayKey`, sorted chronologically, shown in the day-detail sidebar. */
  const selectedDayEvents = useMemo(() => {
    const dayEvents = eventsByDay[selectedDayKey] ?? [];
    return [...dayEvents].sort(
      (a, b) =>
        getLocalDateOnly(a.startTime).getTime() - getLocalDateOnly(b.startTime).getTime(),
    );
  }, [eventsByDay, selectedDayKey]);

  /** Tasks due on `selectedDayKey`, shown in the day-detail sidebar. */
  const selectedDayTasks = useMemo(
    () => tasksByDay[selectedDayKey] ?? [],
    [selectedDayKey, tasksByDay],
  );

  /** The 3 consecutive days (starting at `mobileRangeStart`) shown in the mobile rolling view. */
  const mobileDays = useMemo(() => {
    return Array.from({ length: 3 }, (_, index) => {
      const day = new Date(mobileRangeStart);
      day.setDate(day.getDate() + index);
      return day;
    });
  }, [mobileRangeStart]);

  /** Human-readable "Mon D – Mon D" label describing the mobile 3-day range. */
  const mobileRangeLabel = useMemo(() => {
    const start = mobileDays[0];
    const end = mobileDays[mobileDays.length - 1];
    const formatter = new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
    });
    return `${formatter.format(start)} – ${formatter.format(end)}`;
  }, [mobileDays]);

  /** Human-readable full date label (e.g. "Monday, January 5, 2025") for `selectedDayKey`. */
  const selectedDayLabel = useMemo(() => {
    const [year, monthNum, day] = selectedDayKey.split("-").map(Number);
    return new Intl.DateTimeFormat("en-US", { dateStyle: "full" }).format(
      new Date(year, monthNum - 1, day),
    );
  }, [selectedDayKey]);

  // ---------------------------------------------------------------------
  // Action handlers
  // ---------------------------------------------------------------------

  /**
   * Navigates to the main Events page with a deep-link query param, which
   * causes that page to auto-select and open the event for editing.
   * Uses `sourceEventId` (the original stored event id) rather than the
   * expanded occurrence's id, since recurring occurrences are virtual.
   */
  function openEvent(event: EventItem) {
    router.push(
      `/events?event=${encodeURIComponent(event.sourceEventId ?? event.id)}`,
    );
  }

  /**
   * Marks `task` as done via a PATCH request, resubmitting all of its
   * existing fields alongside the new "DONE" status (the API expects a
   * full task payload, not a partial patch). Updates the task in local
   * state with the server's response on success.
   */
  async function handleCompleteTask(task: TaskItem) {
    try {
      setCompletingTaskId(task.id);
      setError("");
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: task.title,
          status: "DONE",
          description: task.description ?? "",
          priority: task.priority,
          dueDate: task.dueDate,
          recurrence: normalizeRecurrence(task.recurrence),
          projectId: task.projectId ?? "",
          assigneeId: task.assignee?.id ?? "",
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Failed to complete task");
      }
      const updatedTask = (await res.json()) as TaskItem;
      setTasks((prev) =>
        prev.map((item) => (item.id === task.id ? updatedTask : item)),
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not mark this task done. Please try again.",
      );
    } finally {
      setCompletingTaskId(null);
    }
  }

  /**
   * Deletes the event at `eventId` via the API (soft-delete / move to
   * Trash, per the confirm dialog copy). On success, removes it from local
   * state and closes the confirmation dialog.
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
      setConfirmDeleteId(null);
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
    <main className="min-h-screen px-6 py-10">
      <div className="mx-auto max-w-7xl">
        {/* Page header with title/description and a link back to the Events page */}
        <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-4xl font-bold">Full Calendar</h1>
            <p className="mt-2 text-zinc-600 dark:text-zinc-300">
              Explore all events in a larger monthly view with day-by-day
              details.
            </p>
          </div>
          <BackLink href="/events">Back to Events</BackLink>
        </div>

        {error && <p className="mb-6 text-sm text-red-600">{error}</p>}

        <section className={uiCardClass}>
          {/* Month heading + project filter + month navigation */}
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-2xl font-semibold">
              {new Intl.DateTimeFormat("en-US", {
                month: "long",
                year: "numeric",
              }).format(month)}
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={projectFilter}
                onChange={(e) => setProjectFilter(e.target.value)}
                className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
              >
                <option value={ALL_PROJECTS_FILTER}>All projects</option>
                <option value={NO_PROJECT_FILTER}>No project</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
              <button
                onClick={() =>
                  setMonth(
                    (prev) =>
                      new Date(prev.getFullYear(), prev.getMonth() - 1, 1),
                  )
                }
                className={uiButtonClass}
              >
                Previous
              </button>
              <button
                onClick={() =>
                  setMonth(
                    (prev) =>
                      new Date(prev.getFullYear(), prev.getMonth() + 1, 1),
                  )
                }
                className={uiButtonClass}
              >
                Next
              </button>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
            <div>
              {/* ------------------------------------------------------
                  Mobile-only: rolling 3-day view with Previous/Next nav
              ------------------------------------------------------- */}
              <div className="mb-4 flex items-center justify-between gap-3 sm:hidden">
                <button
                  type="button"
                  onClick={() =>
                    setMobileRangeStart((prev) => {
                      const next = new Date(prev);
                      next.setDate(next.getDate() - 3);
                      return next;
                    })
                  }
                  className={uiButtonClass}
                >
                  Previous 3 days
                </button>
                <p className="text-center text-sm font-semibold text-zinc-600 dark:text-zinc-300">
                  {mobileRangeLabel}
                </p>
                <button
                  type="button"
                  onClick={() =>
                    setMobileRangeStart((prev) => {
                      const next = new Date(prev);
                      next.setDate(next.getDate() + 3);
                      return next;
                    })
                  }
                  className={uiButtonClass}
                >
                  Next 3 days
                </button>
              </div>

              <div className="grid gap-3 sm:hidden">
                {mobileDays.map((day) => {
                  const dayKey = formatDayKey(day);
                  const isToday = dayKey === formatDayKey(new Date());
                  const isSelected = dayKey === selectedDayKey;
                  const dayEvents = eventsByDay[dayKey] ?? [];
                  const dayTasks = tasksByDay[dayKey] ?? [];
                  const itemCount = dayEvents.length + dayTasks.length;
                  return (
                    <button
                      key={dayKey}
                      type="button"
                      onClick={() => {
                        setSelectedDayKey(dayKey);
                        // Keep the (hidden, desktop-only) month state in sync
                        // so switching back to desktop view lands on the
                        // right month.
                        setMonth(
                          new Date(day.getFullYear(), day.getMonth(), 1),
                        );
                      }}
                      className={`w-full rounded-2xl border p-4 text-left transition ${
                        isSelected
                          ? "border-black bg-zinc-100 dark:bg-zinc-800"
                          : "border-zinc-200 bg-white/80 hover:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900/60"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                            {new Intl.DateTimeFormat("en-US", {
                              weekday: "long",
                            }).format(day)}
                          </p>
                          <p
                            className={`mt-1 text-2xl font-bold ${isToday ? "text-blue-600 dark:text-blue-300" : ""}`}
                          >
                            {new Intl.DateTimeFormat("en-US", {
                              month: "short",
                              day: "numeric",
                            }).format(day)}
                          </p>
                        </div>
                        <span className="rounded-full bg-zinc-950 px-2.5 py-1 text-xs font-semibold text-white dark:bg-zinc-100 dark:text-zinc-950">
                          {itemCount} {itemCount === 1 ? "item" : "items"}
                        </span>
                      </div>
                      <div className="mt-3 space-y-2">
                        {/* Preview up to 2 events... */}
                        {dayEvents.slice(0, 2).map((event) => (
                          <span
                            key={event.id}
                            className="block truncate rounded-xl bg-zinc-100 px-3 py-2 text-sm text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
                          >
                            {event.hasStartTime
                              ? formatTime(event.startTime)
                              : "No time"}{" "}
                            {event.title}
                          </span>
                        ))}
                        {/* ...then fill remaining preview slots (up to 3 total) with tasks */}
                        {dayTasks
                          .slice(
                            0,
                            Math.max(0, 3 - Math.min(dayEvents.length, 2)),
                          )
                          .map((task) => (
                            <p
                              key={task.id}
                              className={`truncate rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900/70 dark:bg-emerald-950/40 dark:text-emerald-200 ${task.status === "DONE" ? "opacity-60 line-through" : ""}`}
                            >
                              □ {task.title}
                            </p>
                          ))}
                        {itemCount === 0 && (
                          <p className="rounded-xl border border-dashed border-zinc-200 px-3 py-3 text-sm text-zinc-500 dark:border-zinc-700">
                            No items.
                          </p>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* ------------------------------------------------------
                  Desktop-only: full month grid
              ------------------------------------------------------- */}
              <div className="hidden sm:block">
                {/* Weekday header row (Sun–Sat) */}
                <div className="mb-3 grid grid-cols-7 gap-2 text-center text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(
                    (day) => (
                      <span key={day}>{day}</span>
                    ),
                  )}
                </div>

                <div className="grid grid-cols-7 gap-2">
                  {monthDays.map((day) => {
                    const dayKey = formatDayKey(day);
                    const isCurrentMonth = day.getMonth() === month.getMonth();
                    const isToday = dayKey === formatDayKey(new Date());
                    const isSelected = dayKey === selectedDayKey;
                    const eventCount = eventsByDay[dayKey]?.length ?? 0;
                    const taskCount = tasksByDay[dayKey]?.length ?? 0;
                    const itemCount = eventCount + taskCount;

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
                              isToday
                                ? "bg-blue-600 font-semibold text-white"
                                : ""
                            }`}
                          >
                            {day.getDate()}
                          </span>
                          {itemCount > 0 && (
                            <span className="rounded-full bg-black px-2 py-0.5 text-xs text-white">
                              {itemCount}
                            </span>
                          )}
                        </div>

                        {itemCount > 0 && (
                          <div className="mt-2 space-y-1">
                            {/* Preview up to 2 events, colored by the selected project if it matches */}
                            {(eventsByDay[dayKey] ?? [])
                              .slice(0, 2)
                              .map((event) => (
                                <span
                                  key={event.id}
                                  className="block truncate rounded border-l-2 bg-zinc-200/70 px-1.5 py-0.5 text-xs text-zinc-800 dark:bg-zinc-700 dark:text-zinc-100"
                                  style={
                                    selectedProject &&
                                    event.projectId === selectedProject.id
                                      ? {
                                          borderLeftColor:
                                            selectedProject.color ?? "#18181b",
                                        }
                                      : undefined
                                  }
                                >
                                  {event.hasStartTime
                                    ? formatTime(event.startTime)
                                    : "No time"}{" "}
                                  {event.title}
                                </span>
                              ))}
                            {/* Fill remaining preview slots (up to 2 total) with tasks */}
                            {(tasksByDay[dayKey] ?? [])
                              .slice(
                                0,
                                Math.max(0, 2 - Math.min(eventCount, 2)),
                              )
                              .map((task) => (
                                <p
                                  key={task.id}
                                  className={`truncate rounded border-l-2 border-emerald-500 bg-emerald-50 px-1.5 py-0.5 text-xs text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200 ${task.status === "DONE" ? "opacity-60 line-through" : ""}`}
                                >
                                  Task · {task.title}
                                </p>
                              ))}
                            {/* Overflow indicator when more than 2 items exist for the day */}
                            {itemCount > 2 && (
                              <p className="text-xs text-zinc-500">
                                +{itemCount - 2} more
                              </p>
                            )}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* ----------------------------------------------------------
                Sidebar: full detail list for the selected day
            ------------------------------------------------------------- */}
            <aside className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-700">
              <h3 className="text-lg font-semibold">{selectedDayLabel}</h3>
              <p className="mt-1 text-sm text-zinc-500">
                {selectedDayEvents.length + selectedDayTasks.length === 0
                  ? "No events or tasks planned for this day."
                  : `${selectedDayEvents.length + selectedDayTasks.length} item${selectedDayEvents.length + selectedDayTasks.length > 1 ? "s" : ""} scheduled`}
              </p>

              <div className="mt-4 space-y-3">
                {/* Full event cards: clicking opens the event for editing on the Events page */}
                {selectedDayEvents.map((event) => (
                  <article
                    key={event.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => openEvent(event)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") openEvent(event);
                    }}
                    className="cursor-pointer rounded-lg border border-zinc-200 p-3 transition hover:border-blue-300 hover:bg-blue-50/50 dark:border-zinc-700 dark:hover:border-blue-800 dark:hover:bg-blue-950/20"
                    style={
                      selectedProject && event.projectId === selectedProject.id
                        ? {
                            borderLeftWidth: 4,
                            borderLeftColor: selectedProject.color ?? "#18181b",
                          }
                        : undefined
                    }
                  >
                    <div className="flex items-start justify-between gap-3">
                      <p className="font-medium">{event.title}</p>
                      <button
                        type="button"
                        onClick={(e) => {
                          // Prevent the delete click from also triggering
                          // the card's onClick (which would navigate away).
                          e.stopPropagation();
                          setConfirmDeleteId(event.sourceEventId ?? event.id);
                        }}
                        disabled={
                          deletingEventId === (event.sourceEventId ?? event.id)
                        }
                        className="inline-flex shrink-0 items-center rounded-md bg-red-600 px-2.5 py-1 text-xs font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {deletingEventId === (event.sourceEventId ?? event.id)
                          ? "Deleting..."
                          : "Delete"}
                      </button>
                    </div>
                    <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                      {event.hasStartTime
                        ? formatTime(event.startTime)
                        : "Time not specified"}
                      {event.endTime && event.hasEndTime
                        ? ` - ${formatTime(event.endTime)}`
                        : ""}
                    </p>
                    {event.location && (
                      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                        {event.location}
                      </p>
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

                {/* Full task cards: clicking navigates to the Tasks page for that task */}
                {selectedDayTasks.map((task) => (
                  <article
                    key={task.id}
                    role="button"
                    tabIndex={0}
                    onClick={() =>
                      router.push(`/tasks?task=${encodeURIComponent(task.id)}`)
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        router.push(
                          `/tasks?task=${encodeURIComponent(task.id)}`,
                        );
                      }
                    }}
                    className={`cursor-pointer rounded-lg border border-emerald-200 bg-emerald-50/70 p-3 transition hover:border-emerald-400 hover:bg-emerald-50 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 dark:border-emerald-900/70 dark:bg-emerald-950/30 dark:hover:border-emerald-700 dark:focus:ring-offset-zinc-950 ${task.status === "DONE" ? "opacity-65" : ""}`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <p
                        className={`font-medium ${task.status === "DONE" ? "line-through" : ""}`}
                      >
                        {task.title}
                      </p>
                      {task.status === "DONE" ? (
                        <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-xs font-semibold text-white">
                          Task
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={(e) => {
                            // Prevent the "Done" click from also triggering
                            // the card's onClick (which would navigate away).
                            e.stopPropagation();
                            void handleCompleteTask(task);
                          }}
                          disabled={completingTaskId === task.id}
                          className="rounded-full bg-emerald-600 px-3 py-1 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {completingTaskId === task.id ? "Saving…" : "Done"}
                        </button>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-emerald-800 dark:text-emerald-200">
                      Status: {task.status.replace("_", " ")} · Priority:{" "}
                      {task.priority}
                    </p>
                    {task.dueDate && (
                      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                        Due{" "}
                        {formatTaskDueDate(task.dueDate)}
                      </p>
                    )}
                  </article>
                ))}

                {/* Empty state: nothing scheduled and fetch has completed */}
                {!fetching &&
                  selectedDayEvents.length === 0 &&
                  selectedDayTasks.length === 0 && (
                    <p className="rounded-lg border border-dashed border-zinc-200 px-3 py-4 text-sm text-zinc-500 dark:border-zinc-700">
                      Select another day or create an event or due task.
                    </p>
                  )}

                {fetching && (
                  <p className="text-sm text-zinc-500">
                    Loading calendar items...
                  </p>
                )}
              </div>
            </aside>
          </div>
        </section>
      </div>
      {/* Confirmation modal shown before permanently triggering an event delete request */}
      <ConfirmDialog
        open={confirmDeleteId !== null}
        title="Delete event?"
        message="This will move the event to Trash. You can restore it later from the Trash page."
        confirmLabel="Move to Trash"
        loading={deletingEventId !== null}
        onCancel={() => {
          // Ignore cancel attempts while a delete request is in flight.
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
