"use client";

/**
 * EventsCalendarPage
 * -------------------
 * The Calendar's Month tab (DES-13; the Agenda tab is /events): a larger,
 * combined month view that shows both events and tasks-with-due-dates
 * side by side, with a day-detail sidebar.
 *
 * Responsibilities:
 *  - Fetch events, tasks, and projects in parallel on mount.
 *  - Render a month grid with per-day previews of events and due tasks
 *    (wider screens) or, on a phone, a compact month grid with a dot per item
 *    that can shrink to one week (DES-16); both filterable by project.
 *  - Show full details for whichever day is selected in a side panel,
 *    including the ability to open an event for editing (navigates to the
 *    Agenda tab with a deep-link query param) or open a task.
 *  - Allow marking a task done directly from the calendar, and deleting an
 *    event (with confirmation) directly from the day-detail panel; for a
 *    repeating event, only that day, that day and later ones, or all (CAL-03).
 *  - "Show tasks" hides or shows due tasks (remembered per browser), and
 *    "New event" opens the event sheet on the selected day (CAL-01).
 */

import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarHeader } from "@/components/events/calendar-header";
import { EventSheet, eventRequestBody, type EventInput } from "@/components/events/event-sheet";
import { uiButtonClass, uiCardClass } from "@/components/ui";
import { DeleteButton } from "@/components/ui/delete-button";
import { toast } from "@/components/ui/toaster";
import { useEffect, useMemo, useState } from "react";
import { ShowTasksSwitch } from "@/components/events/show-tasks-switch";
import { useShowTasks } from "@/lib/show-tasks";
import {
  DeleteEventDialog,
  deleteEventDays,
  type DeleteEventTarget,
  type DeleteScope,
} from "@/components/events/delete-event-dialog";
import { cn } from "@/lib/cn";
import { projectColor } from "@/lib/project-color";
import { useRefreshOnReturn } from "@/lib/use-page-activity";
import { notifyWorkspaceChanged } from "@/lib/workspace-events";
import {
  describeRepeat,
  expandRecurringEventsForRange,
  formatRecurrenceLabel,
  normalizeRecurrence,
  storedDayKey,
} from "@/lib/recurrence";
import { formatTaskDueDate, getLocalDateOnly } from "@/lib/task-date-buckets";
import { formatEventTime } from "@/lib/event-time";

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
  /** The last day a repeat can start on; null keeps repeating. */
  repeatUntil?: string | null;
  /** Days deleted from the series (CAL-03). */
  skippedDates?: string[];
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
  /** Whether due tasks appear on the calendar, shared with the Agenda tab; the server render always shows them. */
  const [showTasks] = useShowTasks();
  /** The New event sheet and the day it opens on. */
  const [newEventSheet, setNewEventSheet] = useState<{ open: boolean; draft?: Partial<EventInput> }>({ open: false });

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
  /** Phones only: the grid shows just the selected day's week, so the day's list gets more room (DES-16). */
  const [phoneWeekOnly, setPhoneWeekOnly] = useState(false);

  // ---------------------------------------------------------------------
  // Action state (delete event / complete task)
  // ---------------------------------------------------------------------
  /** The event (and the day it was picked on) waiting in the delete dialog, or null when it's closed. */
  const [deleteTarget, setDeleteTarget] = useState<DeleteEventTarget | null>(null);
  /** True while a delete request runs — drives the "Deleting..." states. */
  const [deleting, setDeleting] = useState(false);
  /** Id of the task currently being marked done, or null if none — drives the button's "Saving…" state. */
  const [completingTaskId, setCompletingTaskId] = useState<string | null>(null);

  /**
   * Fetch events, tasks, and projects in parallel: on mount, and quietly on
   * coming back to the page. Events have their recurrence value normalized
   * before being stored. Any failure in events/tasks fetching surfaces a
   * single generic error message, except a quiet refresh keeps what's shown.
   */
  async function loadItems(showLoading = true) {
    try {
      if (showLoading) {
        setFetching(true);
        setError("");
      }

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
      setError("");
    } catch {
      if (showLoading) setError("Could not load calendar items.");
    } finally {
      if (showLoading) setFetching(false);
    }
  }

  useEffect(() => {
    async function loadInitialData() {
      await loadItems();
    }
    void loadInitialData();
  }, []);

  // Events and tasks changed on another device show up on coming back.
  useRefreshOnReturn(() => void loadItems(false));

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
   * calendar, regardless of the filter, and none do while "Show tasks" is off.
   */
  const filteredTasks = useMemo(() => {
    if (!showTasks) return [];
    return tasks.filter((task) => {
      if (!task.dueDate) return false;
      if (projectFilter === ALL_PROJECTS_FILTER) return true;
      if (projectFilter === NO_PROJECT_FILTER)
        return task.projectId === null || task.projectId === undefined;
      return task.projectId === projectFilter;
    });
  }, [projectFilter, showTasks, tasks]);

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

  /**
   * The days in the phone grid: the whole month, or only the selected day's
   * week. That week is always inside `monthDays`, because picking a day also
   * shows its month.
   */
  const phoneDays = useMemo(() => {
    if (!phoneWeekOnly) return monthDays;
    const start = monthDays.findIndex((day) => formatDayKey(day) === selectedDayKey);
    const weekStart = start - (start % 7);
    return start < 0 ? monthDays.slice(0, 7) : monthDays.slice(weekStart, weekStart + 7);
  }, [monthDays, phoneWeekOnly, selectedDayKey]);

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

  /** Selects a day and shows its month, as a tap on the phone grid does. */
  function selectDay(day: Date) {
    setSelectedDayKey(formatDayKey(day));
    setMonth(new Date(day.getFullYear(), day.getMonth(), 1));
  }

  /**
   * The phone's Previous and Next: a week at a time while the grid shows one
   * week, otherwise a month, landing on today in this month and on the 1st in
   * any other.
   */
  function movePhoneView(direction: -1 | 1) {
    if (phoneWeekOnly) {
      const [year, monthNum, day] = selectedDayKey.split("-").map(Number);
      selectDay(new Date(year, monthNum - 1, day + 7 * direction));
      return;
    }
    const first = new Date(month.getFullYear(), month.getMonth() + direction, 1);
    const today = new Date();
    const isThisMonth = first.getFullYear() === today.getFullYear() && first.getMonth() === today.getMonth();
    selectDay(isThisMonth ? today : first);
  }

  /**
   * Navigates to the Agenda tab (/events) with a deep-link query param, which
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
   * Creates the event from the New event sheet, adds it to local state and
   * selects its first day. Returns an error message for the sheet, or null.
   */
  async function handleCreateEvent(input: EventInput) {
    const res = await fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(eventRequestBody(input)),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      return (data?.error as string | undefined) ?? "Could not create the event.";
    }
    const created = (await res.json()) as EventItem;
    setEvents((prev) => [
      ...prev,
      { ...created, recurrence: normalizeRecurrence(created.recurrence) },
    ]);
    const day = getLocalDateOnly(created.startTime);
    setSelectedDayKey(formatDayKey(day));
    setMonth(new Date(day.getFullYear(), day.getMonth(), 1));
    notifyWorkspaceChanged();
    toast.success("Event created", { description: created.title });
    return null;
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
   * Opens the delete dialog for an occurrence: the stored event behind it,
   * and the day it falls on, so a repeating event can lose just that day.
   */
  function askDeleteEvent(occurrence: EventItem) {
    const source =
      events.find((event) => event.id === (occurrence.sourceEventId ?? occurrence.id)) ?? occurrence;
    setDeleteTarget({ event: source, day: storedDayKey(occurrence.startTime) });
  }

  /**
   * Deletes the chosen days (CAL-03), or moves the whole event to Trash, and
   * updates local state; deleted days come back with the toast's Undo.
   */
  async function handleDeleteEvent(target: DeleteEventTarget, scope: DeleteScope) {
    setDeleting(true);
    await deleteEventDays(target, scope, {
      onChanged: (id, days) => {
        setEvents((prev) => prev.map((event) => (event.id === id ? { ...event, ...days } : event)));
        notifyWorkspaceChanged();
      },
      onDeleted: (id) => {
        setEvents((prev) => prev.filter((event) => event.id !== id));
        notifyWorkspaceChanged();
      },
    });
    setDeleting(false);
    setDeleteTarget(null);
  }

  // ---------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------
  return (
    // The same frame and header as the Agenda tab, so switching tabs moves nothing but the view.
    <div className="mx-auto w-full max-w-6xl px-4 py-5 sm:px-6 lg:px-8 lg:py-6">
      <div className="grid grid-cols-1 gap-4">
        <CalendarHeader
          active="month"
          summary="Events and due tasks"
          // The selected day, in the project being viewed.
          onNewEvent={() => setNewEventSheet({ open: true, draft: { startDate: selectedDayKey, projectId: selectedProject?.id ?? "" } })}
        />

        {error && <p className="text-sm text-red-600">{error}</p>}

        <section className={cn(uiCardClass, "p-3 sm:p-6")}>
          {/* Month heading + project filter + month navigation. On a phone the month's
              own row holds Today, Previous and Next, and the filters take the next row. */}
          <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 sm:mb-5">
            <h2 className="min-w-0 flex-1 truncate text-lg font-semibold sm:flex-none sm:text-2xl">
              {new Intl.DateTimeFormat("en-US", {
                month: "long",
                year: "numeric",
              }).format(month)}
            </h2>
            <div className="flex items-center gap-1 sm:hidden">
              <button type="button" onClick={() => selectDay(new Date())} className={cn(uiButtonClass, "rounded-full px-3 py-1.5")}>
                Today
              </button>
              <button
                type="button"
                onClick={() => movePhoneView(-1)}
                aria-label={phoneWeekOnly ? "Previous week" : "Previous month"}
                className="grid h-11 w-11 place-items-center rounded-lg text-muted hover:bg-surface-hover hover:text-ink"
              >
                <ChevronLeft aria-hidden="true" className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={() => movePhoneView(1)}
                aria-label={phoneWeekOnly ? "Next week" : "Next month"}
                className="grid h-11 w-11 place-items-center rounded-lg text-muted hover:bg-surface-hover hover:text-ink"
              >
                <ChevronRight aria-hidden="true" className="h-5 w-5" />
              </button>
            </div>
            <div className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto">
              <select aria-label="Project"
                value={projectFilter}
                onChange={(e) => setProjectFilter(e.target.value)}
                className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 sm:flex-none"
              >
                <option value={ALL_PROJECTS_FILTER}>All projects</option>
                <option value={NO_PROJECT_FILTER}>No project</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
              <ShowTasksSwitch />
              <button
                onClick={() =>
                  setMonth(
                    (prev) =>
                      new Date(prev.getFullYear(), prev.getMonth() - 1, 1),
                  )
                }
                className={cn(uiButtonClass, "hidden sm:inline-flex")}
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
                className={cn(uiButtonClass, "hidden sm:inline-flex")}
              >
                Next
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-0 sm:gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <div>
              {/* ------------------------------------------------------
                  Phones: the month (or one week) as a grid of days with a
                  dot per item; the selected day's items are listed below
                  (DES-16, like Apple Calendar's list view).
              ------------------------------------------------------- */}
              <div className="sm:hidden">
                <div aria-hidden="true" className="grid grid-cols-7 pb-1 text-center text-2xs font-semibold text-muted">
                  {["S", "M", "T", "W", "T", "F", "S"].map((day, index) => (
                    <span key={index}>{day}</span>
                  ))}
                </div>
                <div id="calendar-phone-grid" className="grid grid-cols-7">
                  {phoneDays.map((day) => {
                    const dayKey = formatDayKey(day);
                    const isToday = dayKey === formatDayKey(new Date());
                    const isSelected = dayKey === selectedDayKey;
                    const inMonth = phoneWeekOnly || day.getMonth() === month.getMonth();
                    const dayEvents = eventsByDay[dayKey] ?? [];
                    const dayTasks = tasksByDay[dayKey] ?? [];
                    const itemCount = dayEvents.length + dayTasks.length;
                    // Events are filled dots and tasks are rings, in their project's color.
                    const dots = [
                      ...dayEvents.map((event) => ({ id: event.id, color: event.project ? projectColor(event.project) : "var(--accent)", filled: true })),
                      ...dayTasks.map((task) => ({ id: task.id, color: task.project ? projectColor(task.project) : "var(--accent)", filled: false })),
                    ].slice(0, 3);
                    return (
                      <button
                        key={dayKey}
                        type="button"
                        onClick={() => selectDay(day)}
                        aria-pressed={isSelected}
                        aria-label={`${new Intl.DateTimeFormat("en-US", { dateStyle: "full" }).format(day)}${isToday ? ", today" : ""}, ${
                          itemCount ? `${itemCount} item${itemCount === 1 ? "" : "s"}` : "nothing planned"
                        }`}
                        className="grid h-12 content-start justify-items-center gap-1 rounded-lg pt-1 outline-none focus-visible:ring-2 focus-visible:ring-accent"
                      >
                        <span
                          className={cn(
                            "grid h-8 w-8 place-items-center rounded-full text-sm tabular-nums",
                            isSelected
                              ? "bg-accent font-semibold text-accent-ink"
                              : isToday
                                ? "bg-accent-soft font-semibold text-accent"
                                : inMonth
                                  ? "text-ink"
                                  : "text-muted",
                          )}
                        >
                          {day.getDate()}
                        </span>
                        <span aria-hidden="true" className="flex h-1.5 gap-0.5">
                          {dots.map((dot) => (
                            <span
                              key={dot.id}
                              className="h-1.5 w-1.5 rounded-full border-[1.5px]"
                              style={{ borderColor: dot.color, backgroundColor: dot.filled ? dot.color : "transparent" }}
                            />
                          ))}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <div className="mb-3 flex justify-center border-b border-line pb-2">
                  <button
                    type="button"
                    onClick={() => setPhoneWeekOnly((weekOnly) => !weekOnly)}
                    aria-controls="calendar-phone-grid"
                    aria-expanded={!phoneWeekOnly}
                    className="inline-flex h-9 items-center gap-1 rounded-full px-3 text-xs font-medium text-muted hover:bg-surface-hover hover:text-ink"
                  >
                    {phoneWeekOnly ? <ChevronDown aria-hidden="true" className="h-4 w-4" /> : <ChevronUp aria-hidden="true" className="h-4 w-4" />}
                    {phoneWeekOnly ? "Show the month" : "Show one week"}
                  </button>
                </div>
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
                        } ${!isCurrentMonth ? "bg-zinc-50/60 text-zinc-500 dark:bg-zinc-900/30" : ""}`}
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
                            <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-medium text-accent-ink">
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
                                    ? formatEventTime(event.startTime)
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
                                  className={`truncate rounded border-l-2 border-accent bg-accent-soft px-1.5 py-0.5 text-xs text-accent ${task.status === "DONE" ? "opacity-60 line-through" : ""}`}
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
            {/* On a phone the day's list sits right under the grid, without a frame of its own. */}
            <aside
              aria-labelledby="calendar-selected-day"
              className="rounded-xl sm:border sm:border-zinc-200 sm:p-4 sm:dark:border-zinc-700"
            >
              <h3 id="calendar-selected-day" className="text-base font-semibold sm:text-lg">
                {selectedDayLabel}
              </h3>
              <p className="mt-0.5 text-sm text-zinc-500 sm:mt-1">
                {selectedDayEvents.length + selectedDayTasks.length === 0
                  ? showTasks
                    ? "No events or tasks planned for this day."
                    : "No events planned for this day."
                  : `${selectedDayEvents.length + selectedDayTasks.length} item${selectedDayEvents.length + selectedDayTasks.length > 1 ? "s" : ""} scheduled`}
              </p>

              <div className="mt-3 space-y-2 sm:mt-4 sm:space-y-3">
                {/* Full event cards: clicking opens the event for editing on the Agenda tab.
                    On a phone the time moves to a column on the left and the card loses its extra lines. */}
                {selectedDayEvents.map((event) => (
                  <article
                    key={event.id}
                    className="relative flex items-start gap-3 rounded-lg border border-zinc-200 p-2.5 transition hover:border-accent/50 hover:bg-accent-soft/40 dark:border-zinc-700 sm:block sm:p-3"
                    style={
                      selectedProject && event.projectId === selectedProject.id
                        ? {
                            borderLeftWidth: 4,
                            borderLeftColor: selectedProject.color ?? "#18181b",
                          }
                        : undefined
                    }
                  >
                    <p className="w-16 shrink-0 pt-px text-right text-[13px] font-medium tabular-nums sm:hidden">
                      {event.hasStartTime ? formatEventTime(event.startTime) : "All day"}
                    </p>
                    <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      {/* The title opens the event; its ::after covers the card so the whole card is clickable. */}
                      <button
                        type="button"
                        onClick={() => openEvent(event)}
                        className="text-left font-medium after:absolute after:inset-0 after:rounded-lg focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-accent"
                      >
                        {event.title}
                      </button>
                      {/* z-10 keeps it above the title's ::after. */}
                      <DeleteButton
                        size="sm"
                        aria-label={`Delete ${event.title}`}
                        onClick={() => askDeleteEvent(event)}
                        loading={deleting && deleteTarget?.event.id === (event.sourceEventId ?? event.id)}
                        className="z-10"
                      />
                    </div>
                    <p className={cn("mt-1 text-sm text-zinc-600 dark:text-zinc-300", !(event.endTime && event.hasEndTime) && "hidden sm:block")}>
                      <span className="hidden sm:inline">
                        {event.hasStartTime
                          ? formatEventTime(event.startTime)
                          : "Time not specified"}
                      </span>
                      {event.endTime && event.hasEndTime ? (
                        <>
                          <span className="hidden sm:inline"> - </span>
                          <span className="sm:hidden">Until </span>
                          {formatEventTime(event.endTime)}
                        </>
                      ) : null}
                    </p>
                    {event.location && (
                      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                        {event.location}
                      </p>
                    )}
                    <p className={cn("mt-1 text-sm text-zinc-600 dark:text-zinc-300", normalizeRecurrence(event.recurrence) === "NONE" && "hidden sm:block")}>
                      {normalizeRecurrence(event.recurrence) === "NONE"
                        ? `Repeats: ${formatRecurrenceLabel(event.recurrence)}`
                        : describeRepeat(event.recurrence, event.repeatUntil)}
                    </p>
                    {event.description && (
                      <p className="mt-1 line-clamp-2 text-sm text-zinc-600 dark:text-zinc-300 sm:line-clamp-none">
                        {event.description}
                      </p>
                    )}
                    </div>
                  </article>
                ))}

                {/* Full task cards: clicking navigates to the Tasks page for that task */}
                {selectedDayTasks.map((task) => (
                  <article
                    key={task.id}
                    className={`relative rounded-lg border border-accent/30 bg-accent-soft/60 p-2.5 transition hover:border-accent/50 hover:bg-accent-soft sm:p-3 ${task.status === "DONE" ? "opacity-65" : ""}`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      {/* The title opens the task; its ::after covers the card so the whole card is clickable. */}
                      <Link
                        href={`/tasks?task=${encodeURIComponent(task.id)}`}
                        className={`font-medium after:absolute after:inset-0 after:rounded-lg focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-accent ${task.status === "DONE" ? "line-through" : ""}`}
                      >
                        {task.title}
                      </Link>
                      {task.status === "DONE" ? (
                        <span className="relative z-10 rounded-full bg-accent px-2 py-0.5 text-xs font-semibold text-accent-ink">
                          Task
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void handleCompleteTask(task)}
                          disabled={completingTaskId === task.id}
                          className="relative z-10 rounded-full bg-accent px-3 py-1 text-xs font-semibold text-accent-ink transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {completingTaskId === task.id ? "Saving…" : "Done"}
                        </button>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-accent">
                      Status: {task.status.replace("_", " ")} · Priority:{" "}
                      {task.priority}
                    </p>
                    {/* A phone shows the day right above the list, so the date isn't repeated. */}
                    {task.dueDate && (
                      <p className="mt-1 hidden text-sm text-zinc-600 dark:text-zinc-300 sm:block">
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
      <EventSheet
        open={newEventSheet.open}
        onOpenChange={(open) => setNewEventSheet((current) => ({ ...current, open }))}
        draft={newEventSheet.draft}
        projects={projects}
        onSubmit={handleCreateEvent}
      />
      {/* Asks which days of a repeating event to delete; other events confirm the move to Trash. */}
      <DeleteEventDialog
        target={deleteTarget}
        loading={deleting}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={(scope) => {
          if (deleteTarget) void handleDeleteEvent(deleteTarget, scope);
        }}
      />
    </div>
  );
}
