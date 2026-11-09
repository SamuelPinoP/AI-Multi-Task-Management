"use client";

/**
 * EventsCalendarPage
 * -------------------
 * The Calendar's Month tab (DES-13; the Agenda tab is /events), as design 4B,
 * which the owner picked on November 7 (#363):
 *
 *  - On wider screens the month fills the page as one grid with hairline
 *    borders. Each day lists up to three events and due tasks ("+N more" for
 *    the rest), and a click opens the day in a pop-over with every item and
 *    its actions: open or delete an event, open or finish a task.
 *  - Phones keep the month (or one week) as a grid of dots with the selected
 *    day's list under it (DES-16).
 *  - `?project=<id>` (or `none`) opens filtered to one project, from the Tasks
 *    page's project cards (#348).
 *  - `?task=<id>`, from a task page's "Show in calendar" (#352), opens on the
 *    task's due day and highlights it, with a banner that says why. A task
 *    without a due date gets one by picking a day.
 *  - "Show tasks" hides or shows due tasks (remembered per browser), and "New
 *    event" opens the event sheet on the selected day (CAL-01). Deleting a
 *    repeating event asks which days (CAL-03).
 */

import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Crosshair } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { CalendarHeader } from "@/components/events/calendar-header";
import {
  CalendarDayCell,
  CalendarDayDetails,
  compareEvents,
  useWideScreen,
  type CalendarEvent,
  type CalendarProject,
  type CalendarTask,
  type CalendarTaskStatus,
} from "@/components/events/calendar-day";
import { EventSheet, eventRequestBody, type EventInput } from "@/components/events/event-sheet";
import { DeleteEventDialog, deleteEventDays, type DeleteEventTarget, type DeleteScope } from "@/components/events/delete-event-dialog";
import { ShowTasksSwitch } from "@/components/events/show-tasks-switch";
import { uiButtonClass } from "@/components/ui";
import { toast } from "@/components/ui/toaster";
import { useTodayKey } from "@/components/user-time-zone";
import { cn } from "@/lib/cn";
import { projectColor } from "@/lib/project-color";
import { expandRecurringEventsForRange, normalizeRecurrence, storedDayKey } from "@/lib/recurrence";
import { useShowTasks } from "@/lib/show-tasks";
import { getLocalDateOnly } from "@/lib/task-date-buckets";
import { useRefreshOnReturn } from "@/lib/use-page-activity";
import { notifyWorkspaceChanged } from "@/lib/workspace-events";

/** Sentinel value for the "show items from every project" filter option. */
const ALL_PROJECTS_FILTER = "ALL";
/** Sentinel value for the "show only items with no project" filter option. */
const NO_PROJECT_FILTER = "NO_PROJECT";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Whether an item in this project passes the project filter. */
function inProjectFilter(filter: string, projectId: string | null | undefined) {
  if (filter === ALL_PROJECTS_FILTER) return true;
  if (filter === NO_PROJECT_FILTER) return !projectId;
  return projectId === filter;
}

/** A `YYYY-MM-DD` key from a Date's LOCAL parts: how days are grouped and compared. */
function formatDayKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateFromKey(key: string) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

/** "Thursday, November 12, 2026": how a day is named on its button and in its details. */
function fullDayLabel(date: Date) {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "full" }).format(date);
}

/** "Thursday, Nov 12": the due day in the highlight banner. */
function bannerDayLabel(date: Date) {
  return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "short", day: "numeric" }).format(date);
}

export default function EventsCalendarPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const wide = useWideScreen();

  // ---------------------------------------------------------------------
  // Data
  // ---------------------------------------------------------------------
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  /** Every task the user can see; the calendar shows those with a due date. */
  const [tasks, setTasks] = useState<CalendarTask[]>([]);
  const [projects, setProjects] = useState<CalendarProject[]>([]);
  /** ALL_PROJECTS_FILTER, NO_PROJECT_FILTER or a project id; `?project=<id>` (or `none`) sets it (#348). */
  const [projectFilter, setProjectFilter] = useState(() => {
    const project = searchParams.get("project");
    return project === "none" ? NO_PROJECT_FILTER : project || ALL_PROJECTS_FILTER;
  });
  /** Whether due tasks appear, shared with the Agenda tab; the server render always shows them. */
  const [showTasks] = useShowTasks();
  const [newEventSheet, setNewEventSheet] = useState<{ open: boolean; draft?: Partial<EventInput> }>({ open: false });
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState("");

  // ---------------------------------------------------------------------
  // Where the calendar is
  // ---------------------------------------------------------------------
  /** Today in the reader's zone; `new Date()` would give the server's day, which is UTC's (#381). */
  const todayKey = useTodayKey();
  /** The first of the month on screen. */
  const [month, setMonth] = useState(() => {
    const today = dateFromKey(todayKey);
    return new Date(today.getFullYear(), today.getMonth(), 1);
  });
  /** The selected day: the phone's list shows it, and New event starts on it. */
  const [selectedDayKey, setSelectedDayKey] = useState(todayKey);
  // The page hydrates on the server's idea of today. When the browser's differs (no `tz` cookie
  // yet, or midnight passed), a calendar still on the old today moves to the new one.
  const [shownTodayKey, setShownTodayKey] = useState(todayKey);
  if (shownTodayKey !== todayKey) {
    setShownTodayKey(todayKey);
    if (selectedDayKey === shownTodayKey) {
      const today = dateFromKey(todayKey);
      setSelectedDayKey(todayKey);
      setMonth(new Date(today.getFullYear(), today.getMonth(), 1));
    }
  }
  /** Wider screens: the day whose pop-over is open. */
  const [openDayKey, setOpenDayKey] = useState<string | null>(null);
  /** The pop-over was opened by a link, so it shows without taking focus. */
  const [autoOpened, setAutoOpened] = useState(false);
  /** Phones only: the grid shows just the selected day's week, so the list gets more room (DES-16). */
  const [phoneWeekOnly, setPhoneWeekOnly] = useState(false);

  // ---------------------------------------------------------------------
  // The highlighted task (`?task=<id>`, #363)
  // ---------------------------------------------------------------------
  const linkedTaskId = searchParams.get("task");
  const linkedTask = linkedTaskId ? (tasks.find((task) => task.id === linkedTaskId) ?? null) : null;
  const [jumpedTo, setJumpedTo] = useState<string | null>(null);
  // Once the tasks load, open on the task's due day, with the day's details open on wider screens.
  if (linkedTaskId && !fetching && jumpedTo !== linkedTaskId) {
    setJumpedTo(linkedTaskId);
    if (linkedTask?.dueDate) {
      const day = getLocalDateOnly(linkedTask.dueDate);
      setMonth(new Date(day.getFullYear(), day.getMonth(), 1));
      setSelectedDayKey(formatDayKey(day));
      if (wide) {
        setOpenDayKey(formatDayKey(day));
        setAutoOpened(true);
      }
    }
  }
  /** A highlighted task without a due date: picking a day sets one. */
  const pickingDueDate = Boolean(linkedTask && !linkedTask.dueDate);
  const [settingDueDate, setSettingDueDate] = useState(false);

  // ---------------------------------------------------------------------
  // Actions in flight
  // ---------------------------------------------------------------------
  /** The event (and the day it was picked on) waiting in the delete dialog. */
  const [deleteTarget, setDeleteTarget] = useState<DeleteEventTarget | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [completingTaskId, setCompletingTaskId] = useState<string | null>(null);

  /**
   * Fetches events, tasks and projects in parallel: on mount, and quietly on
   * coming back to the page. A quiet refresh keeps what's shown if it fails.
   */
  async function loadItems(showLoading = true) {
    try {
      if (showLoading) {
        setFetching(true);
        setError("");
      }
      const [eventsResponse, tasksResponse, projectsData] = await Promise.all([
        fetch("/api/events", { cache: "no-store" }),
        fetch("/api/tasks", { cache: "no-store" }),
        fetch("/api/projects", { cache: "no-store" }).then(async (res) => {
          if (!res.ok) throw new Error("Failed to fetch projects");
          return res.json() as Promise<CalendarProject[]>;
        }),
      ]);
      if (!eventsResponse.ok || !tasksResponse.ok) throw new Error("Failed to fetch calendar items");
      const [eventsData, tasksData] = await Promise.all([eventsResponse.json() as Promise<CalendarEvent[]>, tasksResponse.json() as Promise<CalendarTask[]>]);
      setEvents(eventsData.map((event) => ({ ...event, recurrence: normalizeRecurrence(event.recurrence) })));
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
  // Derived data
  // ---------------------------------------------------------------------

  /** The month padded to whole weeks (Sunday first), so the grid is a rectangle. */
  const monthDays = useMemo(() => {
    const monthStart = new Date(month.getFullYear(), month.getMonth(), 1);
    const monthEnd = new Date(month.getFullYear(), month.getMonth() + 1, 0);
    const cursor = new Date(monthStart);
    cursor.setDate(cursor.getDate() - monthStart.getDay());
    const calendarEnd = new Date(monthEnd);
    calendarEnd.setDate(calendarEnd.getDate() + (6 - monthEnd.getDay()));
    const days: Date[] = [];
    while (cursor <= calendarEnd) {
      days.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    return days;
  }, [month]);

  /** Every occurrence of every event inside the grid's days, repeats expanded. */
  const expandedEvents = useMemo(() => {
    const start = new Date(monthDays[0]);
    start.setHours(0, 0, 0, 0);
    const end = new Date(monthDays[monthDays.length - 1]);
    end.setHours(23, 59, 59, 999);
    return expandRecurringEventsForRange(
      events.map((event) => ({ ...event, sourceEventId: event.id })),
      start,
      end,
    );
  }, [events, monthDays]);

  const selectedProject = useMemo(() => projects.find((project) => project.id === projectFilter) ?? null, [projects, projectFilter]);

  /** Events by local day key, in the project filter, untimed first and then by time. */
  const eventsByDay = useMemo(() => {
    const byDay: Record<string, CalendarEvent[]> = {};
    for (const event of expandedEvents) {
      if (!inProjectFilter(projectFilter, event.projectId)) continue;
      const key = formatDayKey(getLocalDateOnly(event.startTime));
      (byDay[key] ??= []).push(event);
    }
    for (const list of Object.values(byDay)) list.sort(compareEvents);
    return byDay;
  }, [expandedEvents, projectFilter]);

  /**
   * Tasks by local due day. Tasks without a due date never show, and none
   * show while "Show tasks" is off, except the highlighted task: it's the one
   * you came to see, so it shows whatever the filters say.
   */
  const tasksByDay = useMemo(() => {
    const byDay: Record<string, CalendarTask[]> = {};
    for (const task of tasks) {
      if (!task.dueDate) continue;
      if (task.id !== linkedTaskId && (!showTasks || !inProjectFilter(projectFilter, task.projectId))) continue;
      const key = formatDayKey(getLocalDateOnly(task.dueDate));
      (byDay[key] ??= []).push(task);
    }
    return byDay;
  }, [linkedTaskId, projectFilter, showTasks, tasks]);

  /** The phone grid's days: the whole month, or just the selected day's week. */
  const phoneDays = useMemo(() => {
    if (!phoneWeekOnly) return monthDays;
    const start = monthDays.findIndex((day) => formatDayKey(day) === selectedDayKey);
    const weekStart = start - (start % 7);
    return start < 0 ? monthDays.slice(0, 7) : monthDays.slice(weekStart, weekStart + 7);
  }, [monthDays, phoneWeekOnly, selectedDayKey]);

  const linkedDayKey = linkedTask?.dueDate ? formatDayKey(getLocalDateOnly(linkedTask.dueDate)) : null;

  // ---------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------

  /** Selects a day and shows its month, as a tap on the phone grid does. */
  function selectDay(day: Date) {
    setSelectedDayKey(formatDayKey(day));
    setMonth(new Date(day.getFullYear(), day.getMonth(), 1));
  }

  /** Today, Previous and Next: a week at a time while the phone shows one week, else a month. */
  function moveView(direction: -1 | 0 | 1) {
    setOpenDayKey(null);
    if (direction === 0) {
      selectDay(dateFromKey(todayKey));
      return;
    }
    if (phoneWeekOnly && !wide) {
      const selected = dateFromKey(selectedDayKey);
      selectDay(new Date(selected.getFullYear(), selected.getMonth(), selected.getDate() + 7 * direction));
      return;
    }
    // Land on today in this month and on the 1st in any other.
    const first = new Date(month.getFullYear(), month.getMonth() + direction, 1);
    const today = dateFromKey(todayKey);
    selectDay(first.getFullYear() === today.getFullYear() && first.getMonth() === today.getMonth() ? today : first);
  }

  /** A day was picked: it sets the highlighted task's missing due date, or opens the day. */
  function pickDay(dayKey: string) {
    if (pickingDueDate) {
      void setLinkedDueDate(dayKey);
      return;
    }
    setSelectedDayKey(dayKey);
    setOpenDayKey(dayKey);
    setAutoOpened(false);
  }

  /** Opens the event on the Agenda tab, which opens it for editing. */
  function openEvent(event: CalendarEvent) {
    router.push(`/events?event=${encodeURIComponent(event.sourceEventId ?? event.id)}`);
  }

  /** Removes the highlight: the link loses its `task`, and keeps its `project`. */
  function clearHighlight() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("task");
    const query = params.toString();
    router.replace(`/events/calendar${query ? `?${query}` : ""}`, { scroll: false });
  }

  /** Creates the event from the sheet and selects its first day; returns the sheet's error, or null. */
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
    const created = (await res.json()) as CalendarEvent;
    setEvents((prev) => [...prev, { ...created, recurrence: normalizeRecurrence(created.recurrence) }]);
    selectDay(getLocalDateOnly(created.startTime));
    notifyWorkspaceChanged();
    toast.success("Event created", { description: created.title });
    return null;
  }

  /**
   * Saves a change to a task. The API takes the whole task, so its other
   * fields go along as they are (labels stay when `labelIds` is left out).
   */
  async function patchTask(task: CalendarTask, change: { status?: CalendarTaskStatus; dueDate?: string | null }) {
    try {
      setError("");
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: task.title,
          status: change.status ?? task.status,
          description: task.description ?? "",
          priority: task.priority,
          dueDate: change.dueDate !== undefined ? change.dueDate : task.dueDate,
          recurrence: normalizeRecurrence(task.recurrence),
          projectId: task.projectId ?? "",
          assigneeId: task.assignee?.id ?? "",
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Could not save the task.");
      }
      const updated = (await res.json()) as CalendarTask;
      setTasks((prev) => prev.map((item) => (item.id === task.id ? updated : item)));
      notifyWorkspaceChanged();
      return updated;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the task. Please try again.");
      return null;
    }
  }

  async function handleCompleteTask(task: CalendarTask) {
    setCompletingTaskId(task.id);
    await patchTask(task, { status: "DONE" });
    setCompletingTaskId(null);
  }

  /** Gives the highlighted task the picked day as its due date, with Undo. */
  async function setLinkedDueDate(dayKey: string) {
    if (!linkedTask || settingDueDate) return;
    setSettingDueDate(true);
    const updated = await patchTask(linkedTask, { dueDate: dayKey });
    setSettingDueDate(false);
    if (!updated) return;
    setSelectedDayKey(dayKey);
    if (wide) {
      setOpenDayKey(dayKey);
      setAutoOpened(false);
    }
    toast.success("Due date set", {
      description: `${updated.title} · ${bannerDayLabel(dateFromKey(dayKey))}`,
      action: { label: "Undo", onClick: () => void patchTask(updated, { dueDate: null }) },
    });
  }

  /** Opens the delete dialog for an occurrence: its stored event, and the day it falls on. */
  function askDeleteEvent(occurrence: CalendarEvent) {
    const source = events.find((event) => event.id === (occurrence.sourceEventId ?? occurrence.id)) ?? occurrence;
    setDeleteTarget({ event: source, day: storedDayKey(occurrence.startTime) });
  }

  /** Deletes the chosen days (CAL-03), or moves the whole event to Trash; Undo brings days back. */
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

  /** A day's details, for the phone's list and the wider screens' pop-over. */
  function dayDetails(dayKey: string) {
    return (
      <CalendarDayDetails
        events={eventsByDay[dayKey] ?? []}
        tasks={tasksByDay[dayKey] ?? []}
        highlightedTaskId={linkedTaskId}
        showTasks={showTasks}
        fetching={fetching}
        deletingEventId={deleting ? (deleteTarget?.event.id ?? null) : null}
        completingTaskId={completingTaskId}
        onOpenEvent={openEvent}
        onDeleteEvent={askDeleteEvent}
        onCompleteTask={(task) => void handleCompleteTask(task)}
      />
    );
  }

  const monthTitle = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(month);
  const stepLabel = phoneWeekOnly && !wide ? "week" : "month";
  const navButtonClass =
    "grid h-11 w-11 place-items-center rounded-lg text-muted outline-none transition-colors hover:bg-surface-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-accent sm:h-9 sm:w-9";

  return (
    // Wider than the Agenda's frame: the month uses the page's width (#363).
    <div className="mx-auto w-full max-w-[120rem] px-4 py-5 sm:px-6 lg:px-8 lg:py-6">
      <div className="grid grid-cols-1 gap-4">
        <CalendarHeader
          active="month"
          summary="Events and due tasks"
          // The selected day, in the project being viewed.
          onNewEvent={() => setNewEventSheet({ open: true, draft: { startDate: selectedDayKey, projectId: selectedProject?.id ?? "" } })}
        />

        {error ? <p className="text-sm text-danger">{error}</p> : null}

        {/* Why a task is highlighted (#363): it was opened from Tasks with "Show in calendar". */}
        {linkedTaskId && !fetching ? (
          <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-accent/40 bg-accent-soft px-4 py-2.5 text-sm text-ink">
            <Crosshair aria-hidden="true" className="h-4 w-4 shrink-0 text-accent" />
            {/* At least 16rem for the text: on a phone the buttons wrap under it instead of squeezing it. */}
            <p className="min-w-0 flex-1 basis-64">
              {!linkedTask ? (
                "That task isn't on your calendar: it may have been deleted, or it's in a project you can't see."
              ) : pickingDueDate ? (
                <>
                  <b className="font-semibold">“{linkedTask.title}”</b> has no due date yet. {settingDueDate ? "Saving…" : "Pick a day below to set one."}
                </>
              ) : linkedDayKey ? (
                <>
                  <b className="font-semibold">“{linkedTask.title}”</b>{" "}
                  {linkedTask.status === "DONE"
                    ? `was due ${bannerDayLabel(dateFromKey(linkedDayKey))} and is done.`
                    : linkedDayKey < todayKey
                      ? `was due ${bannerDayLabel(dateFromKey(linkedDayKey))} and is overdue.`
                      : `is due ${bannerDayLabel(dateFromKey(linkedDayKey))}.`}{" "}
                  Highlighted because you opened it from Tasks.
                </>
              ) : null}
            </p>
            <span className="flex items-center gap-1 max-sm:pl-5">
              {linkedTask ? (
                <Link href={`/tasks/${encodeURIComponent(linkedTask.id)}`} className="rounded-md px-2 py-1 font-semibold text-accent outline-none hover:bg-accent/10 focus-visible:ring-2 focus-visible:ring-accent">
                  Open task
                </Link>
              ) : null}
              <button type="button" onClick={clearHighlight} className="rounded-md px-2 py-1 font-semibold text-accent outline-none hover:bg-accent/10 focus-visible:ring-2 focus-visible:ring-accent">
                Clear highlight
              </button>
            </span>
          </div>
        ) : null}

        {/* Today, Previous, Next and the month, then the filters. On a phone the month and its
            buttons share the first row and the filters take the next. */}
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="order-1 min-w-0 flex-1 truncate text-lg font-semibold sm:order-2 sm:ml-1 sm:flex-none sm:text-2xl">{monthTitle}</h2>
          <div className="order-2 flex items-center gap-1 sm:order-1">
            <button type="button" onClick={() => moveView(0)} className={cn(uiButtonClass, "rounded-full px-3 py-1.5")}>
              Today
            </button>
            <button type="button" onClick={() => moveView(-1)} aria-label={`Previous ${stepLabel}`} className={navButtonClass}>
              <ChevronLeft aria-hidden="true" className="h-5 w-5" />
            </button>
            <button type="button" onClick={() => moveView(1)} aria-label={`Next ${stepLabel}`} className={navButtonClass}>
              <ChevronRight aria-hidden="true" className="h-5 w-5" />
            </button>
          </div>
          <span aria-hidden="true" className="hidden sm:order-3 sm:block sm:flex-1" />
          <div className="order-3 flex w-full min-w-0 items-center gap-2 sm:order-4 sm:w-auto">
            <select
              aria-label="Project"
              value={projectFilter}
              onChange={(event) => setProjectFilter(event.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink sm:flex-none"
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
          </div>
        </div>

        {/* ----------------------------------------------------------
            Phones: the month (or one week) as a grid of days with a dot
            per item; the selected day's items are listed below (DES-16).
        ----------------------------------------------------------- */}
        <div className="sm:hidden">
          <div aria-hidden="true" className="grid grid-cols-7 pb-1 text-center text-2xs font-semibold text-muted">
            {["S", "M", "T", "W", "T", "F", "S"].map((day, index) => (
              <span key={index}>{day}</span>
            ))}
          </div>
          <div id="calendar-phone-grid" className="grid grid-cols-7">
            {phoneDays.map((day) => {
              const dayKey = formatDayKey(day);
              const isToday = dayKey === todayKey;
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
                  onClick={() => {
                    if (pickingDueDate) void setLinkedDueDate(dayKey);
                    else selectDay(day);
                  }}
                  aria-pressed={isSelected}
                  aria-label={`${fullDayLabel(day)}${isToday ? ", today" : ""}, ${itemCount ? `${itemCount} item${itemCount === 1 ? "" : "s"}` : "nothing planned"}`}
                  className="grid h-12 content-start justify-items-center gap-1 rounded-lg pt-1 outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <span
                    className={cn(
                      "grid h-8 w-8 place-items-center rounded-full text-sm tabular-nums",
                      isSelected ? "bg-accent font-semibold text-accent-ink" : isToday ? "bg-accent-soft font-semibold text-accent" : inMonth ? "text-ink" : "text-muted",
                      // The highlighted task's day keeps a ring, so it's easy to find again.
                      dayKey === linkedDayKey && !isSelected && "ring-2 ring-accent",
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
          {/* The selected day's list sits right under the grid. */}
          <aside aria-labelledby="calendar-selected-day">
            <h3 id="calendar-selected-day" className="text-base font-semibold">
              {fullDayLabel(dateFromKey(selectedDayKey))}
            </h3>
            {dayDetails(selectedDayKey)}
          </aside>
        </div>

        {/* ----------------------------------------------------------
            Wider screens: the month as one grid with hairline borders
            (design 4B); a day opens in a pop-over.
        ----------------------------------------------------------- */}
        <section aria-label={monthTitle} className="hidden overflow-hidden rounded-xl border border-line bg-line shadow-card sm:block">
          <div aria-hidden="true" className="grid grid-cols-7 gap-px border-b border-line">
            {WEEKDAYS.map((day) => (
              <span key={day} className="bg-sunken py-2 text-center text-2xs font-semibold uppercase tracking-wider text-muted">
                {day}
              </span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-px">
            {monthDays.map((day) => {
              const dayKey = formatDayKey(day);
              return (
                <CalendarDayCell
                  key={dayKey}
                  day={day}
                  label={fullDayLabel(day)}
                  inMonth={day.getMonth() === month.getMonth()}
                  isToday={dayKey === todayKey}
                  isPast={dayKey < todayKey}
                  events={eventsByDay[dayKey] ?? []}
                  tasks={tasksByDay[dayKey] ?? []}
                  highlightedTaskId={linkedTaskId}
                  open={openDayKey === dayKey}
                  onOpenChange={(open) => {
                    if (open) pickDay(dayKey);
                    else if (openDayKey === dayKey) setOpenDayKey(null);
                  }}
                  autoOpened={autoOpened}
                >
                  {dayDetails(dayKey)}
                </CalendarDayCell>
              );
            })}
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
