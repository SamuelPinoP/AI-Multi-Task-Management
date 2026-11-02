"use client";

/**
 * The Calendar's Agenda tab (DES-13; the Month tab is /events/calendar): the agenda first, the form second (DES-02).
 *
 * - Quick entry takes a title and opens the New event sheet for the date and time.
 * - An agenda of today and the next 60 days, grouped by day. Repeating events
 *   show their real occurrences (they used to appear only on their first date).
 *   Due tasks show too, behind the "Show tasks" switch the Month tab shares (DES-17).
 * - Below 1024px, a week strip above the agenda jumps to a day and follows the
 *   scroll, and every day of the window has a line, empty or not (DES-17).
 * - Past events behind a toggle.
 * - On wide screens, a month calendar with the selected day's events.
 * - `?event=<id>` opens that event in the sheet (links from search and Home).
 *
 * Event times are stored wall-clock values; see `@/lib/event-time`.
 */

import { Check, ChevronLeft, ChevronRight, MoreHorizontal, Pencil, Plus, Repeat, Search, Trash2 } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useEffectEvent, useMemo, useRef, useState, type FormEvent } from "react";
import { CalendarHeader } from "@/components/events/calendar-header";
import { ShowTasksSwitch } from "@/components/events/show-tasks-switch";
import { WeekStrip, type WeekStripDay } from "@/components/events/week-strip";
import { saveTaskStatus } from "@/components/home/save-task-status";
import type { HomeFocusTask } from "@/lib/home-data";
import { useShowTasks } from "@/lib/show-tasks";
import { DeleteEventDialog, deleteEventDays, type DeleteEventTarget, type DeleteScope } from "@/components/events/delete-event-dialog";
import { EventSheet, eventRequestBody, type EventInput, type EventItem, type EventProject } from "@/components/events/event-sheet";
import { uiButtonClass } from "@/components/ui";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/toaster";
import { cn } from "@/lib/cn";
import { formatEventTime } from "@/lib/event-time";
import { projectColor } from "@/lib/project-color";
import { occurrencesInRange } from "@/lib/event-occurrences";
import { describeRepeat, normalizeRecurrence, storedDayKey } from "@/lib/recurrence";
import { formatTaskDayKey, getLocalDateOnly } from "@/lib/task-date-buckets";
import { useRefreshOnReturn } from "@/lib/use-page-activity";
import { notifyWorkspaceChanged } from "@/lib/workspace-events";

const AGENDA_DAYS = 60;
const PAST_LIMIT = 30;
const ALL = "ALL";
const NO_PROJECT = "NO_PROJECT";

const controlClass =
  "min-w-0 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/25";

/** A due task as `/api/tasks` returns it (DES-17: the agenda shows them beside events). */
type AgendaTask = HomeFocusTask;

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

/** `YYYY-MM-DD` to a local date. */
function dateFromKey(key: string) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

/** The Sunday that starts the week of a day key, as a key. */
function weekStartKey(key: string) {
  const date = dateFromKey(key);
  return formatTaskDayKey(addDays(date, -date.getDay()));
}

function shiftKey(key: string, days: number) {
  return formatTaskDayKey(addDays(dateFromKey(key), days));
}

function dayLabel(dayKey: string, todayKey: string, tomorrowKey: string) {
  if (dayKey === todayKey) return "Today";
  if (dayKey === tomorrowKey) return "Tomorrow";
  const [year, month, day] = dayKey.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" }).format(new Date(year, month - 1, day));
}

function timeRange(event: EventItem) {
  if (!event.hasStartTime) return "All day";
  const start = formatEventTime(event.startTime);
  if (!event.endTime || !event.hasEndTime) return start;
  // A multi-day event shows its end date too.
  const sameDay = formatTaskDayKey(event.endTime) === formatTaskDayKey(event.startTime);
  return sameDay ? `${start} – ${formatEventTime(event.endTime)}` : `${start} – ${dayLabel(formatTaskDayKey(event.endTime), "", "")}`;
}

async function errorMessage(response: Response, fallback: string) {
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? fallback;
}

function EventRow({
  event,
  highlighted,
  showDate = false,
  onOpen,
  onDelete,
}: {
  event: EventItem;
  highlighted: boolean;
  /** For lists not grouped by day (past events). */
  showDate?: boolean;
  onOpen: (event: EventItem) => void;
  onDelete: (event: EventItem) => void;
}) {
  const color = event.project ? projectColor(event.project) : "var(--accent)";
  const repeats = normalizeRecurrence(event.recurrence) !== "NONE";
  return (
    <li className={cn("flex items-center gap-3 border-t border-line px-3 py-2 first:border-t-0 sm:px-4", highlighted && "bg-accent-soft/60")}>
      <span className="w-[4.5rem] shrink-0 font-mono text-xs tabular-nums text-muted sm:w-24">
        {showDate ? <span className="block font-semibold text-ink">{dayLabel(formatTaskDayKey(event.startTime), "", "")}</span> : null}
        {timeRange(event)}
      </span>
      <span aria-hidden="true" className="h-8 w-[3px] shrink-0 rounded-full" style={{ backgroundColor: color }} />
      {/* The title is the button's whole label; its ::after covers the details line too, so both open the event. */}
      <div className="relative min-w-0 flex-1">
        <button
          type="button"
          onClick={() => onOpen(event)}
          className="block w-full text-left after:absolute after:inset-0 after:rounded-md hover:text-accent focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-accent"
        >
          <span className="block truncate text-sm font-medium">{event.title}</span>
        </button>
        {event.location || event.project ? (
          <span className="block truncate text-xs text-muted">
            {[event.location, event.project?.name].filter(Boolean).join(" · ")}
          </span>
        ) : null}
      </div>
      {repeats ? (
        <span title={describeRepeat(event.recurrence, event.repeatUntil)} className="shrink-0 text-muted">
          <Repeat aria-hidden="true" className="h-3.5 w-3.5" />
          <span className="sr-only">{describeRepeat(event.recurrence, event.repeatUntil)}</span>
        </span>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`More actions for ${event.title}`}
          className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-muted outline-none hover:bg-surface-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-accent"
        >
          <MoreHorizontal aria-hidden="true" className="h-4 w-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => onOpen(event)}>
            <Pencil />
            Edit
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => onDelete(event)} className="text-danger [&_svg]:text-danger">
            <Trash2 />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

/** A due task in the agenda: a box to tick it off, its title to open it on the Tasks page. */
function TaskRow({ task, busy, onToggle }: { task: AgendaTask; busy: boolean; onToggle: (task: AgendaTask) => void }) {
  const color = task.project ? projectColor(task.project) : "var(--accent)";
  const done = task.status === "DONE";
  return (
    <li className="flex items-center gap-3 border-t border-line px-3 py-2 first:border-t-0 sm:px-4">
      <span className="flex w-[4.5rem] shrink-0 sm:w-24">
        <button
          type="button"
          role="checkbox"
          aria-checked={done}
          aria-label={`Done: ${task.title}`}
          disabled={busy}
          onClick={() => onToggle(task)}
          className="-m-1.5 grid h-8 w-8 place-items-center rounded-lg outline-none hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60"
        >
          <span className={cn("grid h-4 w-4 place-items-center rounded border-2", done ? "border-accent bg-accent text-accent-ink" : "border-muted")}>
            {done ? <Check aria-hidden="true" className="h-3 w-3" strokeWidth={3} /> : null}
          </span>
        </button>
      </span>
      <span aria-hidden="true" className="h-8 w-[3px] shrink-0 rounded-full" style={{ backgroundColor: color }} />
      {/* The title is the link's whole name; its ::after covers the details line too. */}
      <div className="relative min-w-0 flex-1">
        <Link
          href={`/tasks?task=${encodeURIComponent(task.id)}`}
          className={cn(
            "block truncate text-sm font-medium after:absolute after:inset-0 after:rounded-md hover:text-accent focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-accent",
            done && "text-muted line-through",
          )}
        >
          {task.title}
        </Link>
        <span className="block truncate text-xs text-muted">{["Task", task.project?.name].filter(Boolean).join(" · ")}</span>
      </div>
      {task.priority === "HIGH" && !done ? (
        <span className="shrink-0 rounded-full bg-danger-soft px-2 py-0.5 text-2xs font-semibold text-danger">High</span>
      ) : null}
    </li>
  );
}

export default function EventsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const linkedEventId = searchParams.get("event");

  const [events, setEvents] = useState<EventItem[]>([]);
  /** Tasks with a due date; they show with the events while the shared "Show tasks" switch is on (DES-17). */
  const [tasks, setTasks] = useState<AgendaTask[]>([]);
  const [showTasks] = useShowTasks();
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  /** Phones and tablets: the day the week strip marks; its week is the strip's week (DES-17). */
  const [stripDayKey, setStripDayKey] = useState(() => formatTaskDayKey(new Date()));
  const [stripHeight, setStripHeight] = useState(0);
  const stripRef = useRef<HTMLDivElement>(null);
  /**
   * Where a jump to a tapped day left the agenda's scroll. Near the end of the
   * list the day can't reach the top, so the scroll position it lands on mustn't
   * move the strip to an earlier day; any other position is the user scrolling.
   */
  const jumpScrollTop = useRef<number | null>(null);
  const [projects, setProjects] = useState<EventProject[]>([]);
  const [fetching, setFetching] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [projectFilter, setProjectFilter] = useState(ALL);
  const [searchQuery, setSearchQuery] = useState("");
  const [showPast, setShowPast] = useState(false);
  const [quickTitle, setQuickTitle] = useState("");
  /** `day`: the occurrence the sheet was opened from, so its Delete can offer that day alone. */
  const [sheet, setSheet] = useState<{ open: boolean; event: EventItem | null; day?: string | null; draft?: Partial<EventInput> }>({
    open: false,
    event: null,
  });
  const [deleteTarget, setDeleteTarget] = useState<DeleteEventTarget | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [selectedDayKey, setSelectedDayKey] = useState(() => formatTaskDayKey(new Date()));

  async function fetchEvents() {
    try {
      const response = await fetch("/api/events");
      if (!response.ok) throw new Error();
      const data = (await response.json()) as EventItem[];
      setEvents(data.map((event) => ({ ...event, recurrence: normalizeRecurrence(event.recurrence) })));
      setLoadError("");
    } catch {
      setLoadError("Could not load events.");
    } finally {
      setFetching(false);
    }
  }

  async function fetchProjects() {
    try {
      const response = await fetch("/api/projects");
      if (response.ok) setProjects((await response.json()) as EventProject[]);
    } catch {
      // The project selects stay empty; events still load.
    }
  }

  async function fetchTasks() {
    try {
      const response = await fetch("/api/tasks");
      if (response.ok) setTasks(((await response.json()) as AgendaTask[]).filter((task) => task.dueDate));
    } catch {
      // The agenda keeps the tasks it has; events still load.
    }
  }

  useEffect(() => {
    async function loadInitialData() {
      await Promise.all([fetchEvents(), fetchTasks(), fetchProjects()]);
    }
    void loadInitialData();
  }, []);

  // Events and tasks added or moved on another device show up on coming back. An open event keeps its edits.
  useRefreshOnReturn(() => {
    void Promise.all([fetchEvents(), fetchTasks(), fetchProjects()]);
  });

  /** `?event=<id>`: clear the filters, show its month and open it. */
  const openLinkedEvent = useEffectEvent((event: EventItem) => {
    setProjectFilter(ALL);
    setSearchQuery("");
    const day = getLocalDateOnly(event.startTime);
    setSelectedDayKey(formatTaskDayKey(day));
    setCalendarMonth(new Date(day.getFullYear(), day.getMonth(), 1));
    setSheet({ open: true, event });
  });

  useEffect(() => {
    if (!linkedEventId || fetching) return;
    const event = events.find((item) => item.id === linkedEventId);
    if (!event) return;
    const timer = window.setTimeout(() => openLinkedEvent(event), 0);
    return () => window.clearTimeout(timer);
  }, [events, fetching, linkedEventId]);

  const filtered = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return events.filter(
      (event) =>
        (projectFilter === ALL || (projectFilter === NO_PROJECT ? !event.projectId : event.projectId === projectFilter)) &&
        (!query || [event.title, event.location ?? "", event.description ?? ""].some((text) => text.toLowerCase().includes(query))),
    );
  }, [events, projectFilter, searchQuery]);

  const now = new Date();
  const todayStart = getLocalDateOnly(now);
  const todayKey = formatTaskDayKey(todayStart);
  const tomorrowKey = formatTaskDayKey(addDays(todayStart, 1));

  const filteredTasks = useMemo(() => {
    if (!showTasks) return [];
    const query = searchQuery.trim().toLowerCase();
    return tasks.filter(
      (task) =>
        (projectFilter === ALL || (projectFilter === NO_PROJECT ? !task.projectId : task.projectId === projectFilter)) &&
        (!query || [task.title, task.description ?? ""].some((text) => text.toLowerCase().includes(query))),
    );
  }, [tasks, showTasks, projectFilter, searchQuery]);

  // Every day from today through the agenda window, with its events (occurrences) and due tasks, open ones first.
  const agendaDays = useMemo(() => {
    const start = getLocalDateOnly(new Date());
    const end = addDays(start, AGENDA_DAYS);
    end.setMilliseconds(-1);
    const occurrences = occurrencesInRange(filtered, start, end).sort(
      (a, b) =>
        formatTaskDayKey(a.startTime).localeCompare(formatTaskDayKey(b.startTime)) ||
        Number(a.hasStartTime) - Number(b.hasStartTime) ||
        a.startTime.localeCompare(b.startTime),
    );
    const eventDays = new Map<string, EventItem[]>();
    for (const occurrence of occurrences) {
      const key = formatTaskDayKey(occurrence.startTime);
      eventDays.set(key, [...(eventDays.get(key) ?? []), occurrence]);
    }
    const taskDays = new Map<string, AgendaTask[]>();
    for (const task of [...filteredTasks].sort((a, b) => Number(a.status === "DONE") - Number(b.status === "DONE"))) {
      const key = formatTaskDayKey(task.dueDate ?? "");
      taskDays.set(key, [...(taskDays.get(key) ?? []), task]);
    }
    return Array.from({ length: AGENDA_DAYS }, (_, index) => {
      const key = formatTaskDayKey(addDays(start, index));
      return { key, events: eventDays.get(key) ?? [], tasks: taskDays.get(key) ?? [] };
    });
  }, [filtered, filteredTasks]);
  const agendaIsEmpty = agendaDays.every((day) => day.events.length + day.tasks.length === 0);

  // Stored events that ended before today (repeating ones only once their series has ended).
  const past = useMemo(() => {
    const start = getLocalDateOnly(new Date());
    return filtered
      .filter((event) => {
        if (normalizeRecurrence(event.recurrence) !== "NONE") {
          return event.repeatUntil ? getLocalDateOnly(event.repeatUntil) < start : false;
        }
        return getLocalDateOnly(event.endTime ?? event.startTime) < start;
      })
      .sort((a, b) => b.startTime.localeCompare(a.startTime))
      .slice(0, PAST_LIMIT);
  }, [filtered]);

  const weekEndKey = formatTaskDayKey(addDays(todayStart, 7));
  const weekCount = agendaDays.filter((day) => day.key < weekEndKey).reduce((sum, day) => sum + day.events.length + day.tasks.length, 0);

  // The week strip (phones and tablets): the selected day's week, from today's week to the window's last.
  const lastAgendaKey = agendaDays[agendaDays.length - 1]?.key ?? todayKey;
  const stripWeekKey = weekStartKey(stripDayKey);
  const agendaByKey = new Map(agendaDays.map((day) => [day.key, day]));
  const stripDays: WeekStripDay[] = Array.from({ length: 7 }, (_, index) => {
    const key = shiftKey(stripWeekKey, index);
    const day = agendaByKey.get(key);
    const count = day ? day.events.length + day.tasks.length : 0;
    const date = dateFromKey(key);
    return {
      key,
      letter: "SMTWTFS"[index],
      date: date.getDate(),
      label: `${new Intl.DateTimeFormat("en-US", { dateStyle: "full" }).format(date)}${key === todayKey ? ", today" : ""}, ${
        count ? `${count} item${count === 1 ? "" : "s"}` : "nothing planned"
      }`,
      disabled: key < todayKey || key > lastAgendaKey,
      dots: day
        ? [
            ...day.events.map((event) => ({ id: event.id, color: event.project ? projectColor(event.project) : "var(--accent)", filled: true })),
            ...day.tasks.map((task) => ({ id: task.id, color: task.project ? projectColor(task.project) : "var(--accent)", filled: false })),
          ].slice(0, 3)
        : [],
    };
  });

  /** Marks a day in the strip and scrolls its agenda entry to just under the strip. */
  function jumpToDay(key: string) {
    setStripDayKey(key);
    const target = document.getElementById(`agenda-${key}`);
    if (!target) return;
    target.scrollIntoView({ block: "start" });
    jumpScrollTop.current = document.getElementById("main-content")?.scrollTop ?? null;
  }

  // The strip's height, so a day the strip jumps to isn't hidden under it. Zero on wide screens, where it's hidden.
  const stripShown = !fetching && !agendaIsEmpty;
  useEffect(() => {
    const strip = stripRef.current;
    if (!stripShown || !strip) return;
    const observer = new ResizeObserver(() => setStripHeight(strip.offsetHeight));
    observer.observe(strip);
    return () => observer.disconnect();
  }, [stripShown]);

  // As the agenda scrolls, the strip marks the day just under it, like Fantastical's DayTicker.
  useEffect(() => {
    const root = document.getElementById("main-content");
    if (!root || !stripHeight) return;
    const visible = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const key = (entry.target as HTMLElement).dataset.day;
          if (!key) continue;
          if (entry.isIntersecting) visible.add(key);
          else visible.delete(key);
        }
        if (jumpScrollTop.current !== null && root.scrollTop === jumpScrollTop.current) return;
        jumpScrollTop.current = null;
        if (visible.size === 0) return;
        setStripDayKey([...visible].sort()[0]);
      },
      // A band from the strip's bottom edge down to a third of the screen.
      { root, rootMargin: `-${stripHeight + 8}px 0px -65% 0px` },
    );
    root.querySelectorAll<HTMLElement>("[data-day]").forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [agendaDays, stripHeight]);

  /** Ticks a task off, or back on; a repeating task's next one comes back with the refetch. */
  async function toggleTask(task: AgendaTask) {
    const status = task.status === "DONE" ? "TODO" : "DONE";
    setBusyTaskId(task.id);
    try {
      await saveTaskStatus(task, status);
      setTasks((current) => current.map((item) => (item.id === task.id ? { ...item, status } : item)));
      notifyWorkspaceChanged();
      void fetchTasks();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update the task.");
    } finally {
      setBusyTaskId(null);
    }
  }

  // Month calendar (wide screens).
  const calendarDays = useMemo(() => {
    const first = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1);
    const last = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 0);
    const start = addDays(first, -first.getDay());
    const end = addDays(last, 6 - last.getDay());
    const days: Date[] = [];
    for (let cursor = start; cursor <= end; cursor = addDays(cursor, 1)) days.push(cursor);
    return days;
  }, [calendarMonth]);

  const eventsByDay = useMemo(() => {
    const rangeEnd = addDays(calendarDays[calendarDays.length - 1], 1);
    rangeEnd.setMilliseconds(-1);
    const map = new Map<string, EventItem[]>();
    for (const occurrence of occurrencesInRange(filtered, calendarDays[0], rangeEnd)) {
      const key = formatTaskDayKey(occurrence.startTime);
      map.set(key, [...(map.get(key) ?? []), occurrence]);
    }
    return map;
  }, [filtered, calendarDays]);

  const selectedDayEvents = [...(eventsByDay.get(selectedDayKey) ?? [])].sort(
    (a, b) => Number(a.hasStartTime) - Number(b.hasStartTime) || a.startTime.localeCompare(b.startTime),
  );

  /** The stored event behind an occurrence, and the day its repeat started (null for a stored event, as in Past). */
  function sourceAndDay(occurrence: EventItem) {
    const source = events.find((event) => event.id === (occurrence.sourceEventId ?? occurrence.id)) ?? occurrence;
    const day = occurrence.sourceEventId ? storedDayKey(occurrence.occurrenceStart ?? occurrence.startTime) : null;
    return { event: source, day };
  }

  function openEvent(occurrence: EventItem) {
    setSheet({ open: true, ...sourceAndDay(occurrence) });
  }

  function closeSheet(open: boolean) {
    setSheet((current) => ({ ...current, open }));
    if (!open && linkedEventId) router.replace(pathname, { scroll: false });
  }

  function startQuickEntry(formEvent: FormEvent) {
    formEvent.preventDefault();
    if (!quickTitle.trim()) return;
    setSheet({ open: true, event: null, draft: { title: quickTitle.trim(), startDate: selectedDayKey >= todayKey ? selectedDayKey : todayKey } });
    setQuickTitle("");
  }

  /** Creates notes for the event, in its project, and opens them (SMART-05). */
  async function writeMeetingNotes(event: EventItem) {
    const eventId = event.sourceEventId ?? event.id;
    try {
      const created = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: `Notes: ${event.title}`, content: "", projectId: event.projectId ?? null }),
      });
      const note = (await created.json().catch(() => null)) as { id?: string } | null;
      if (!created.ok || !note?.id) throw new Error();
      const linked = await fetch(`/api/notes/${note.id}/event`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId }),
      });
      if (!linked.ok) throw new Error();
      router.push(`/notes?openNote=${note.id}&focus=content`);
    } catch {
      toast.error("Could not start the notes.");
    }
  }

  async function saveEvent(input: EventInput) {
    const editing = sheet.event;
    const response = await fetch(editing ? `/api/events/${editing.id}` : "/api/events", {
      method: editing ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(eventRequestBody(input)),
    });
    if (!response.ok) return errorMessage(response, editing ? "Could not save the event." : "Could not create the event.");
    notifyWorkspaceChanged();
    await fetchEvents();
    toast.success(editing ? "Event saved" : "Event created", { description: input.title });
    return null;
  }

  /** Deletes the chosen days, or the whole event (CAL-03). */
  async function deleteEvent(target: DeleteEventTarget, scope: DeleteScope) {
    setDeleting(true);
    const deleted = await deleteEventDays(target, scope, {
      onChanged: (id, days) => {
        setEvents((current) => current.map((item) => (item.id === id ? { ...item, ...days } : item)));
        notifyWorkspaceChanged();
      },
      onDeleted: (id) => {
        setEvents((current) => current.filter((item) => item.id !== id));
        notifyWorkspaceChanged();
      },
    });
    // The sheet holds the series as it was; saving it would undo a new repeat-until.
    if (deleted && sheet.open && sheet.event?.id === target.event.id) closeSheet(false);
    setDeleting(false);
    setDeleteTarget(null);
  }

  const askDelete = (occurrence: EventItem) => setDeleteTarget(sourceAndDay(occurrence));

  return (
    <div className="mx-auto grid w-full grid-cols-1 max-w-6xl gap-4 px-4 py-5 sm:px-6 lg:px-8 lg:py-6">
      <CalendarHeader
        active="agenda"
        summary={fetching ? "Loading..." : `${weekCount} in the next 7 days`}
        onNewEvent={() => setSheet({ open: true, event: null, draft: { startDate: selectedDayKey >= todayKey ? selectedDayKey : todayKey } })}
      />

      <form
        onSubmit={startQuickEntry}
        className="flex items-center gap-2.5 rounded-xl border border-line bg-surface px-3 py-2 transition-colors focus-within:border-accent focus-within:ring-4 focus-within:ring-accent-soft"
      >
        <Plus aria-hidden="true" className="h-4 w-4 shrink-0 text-accent" />
        <label htmlFor="event-quick-title" className="sr-only">New event title</label>
        <input
          id="event-quick-title"
          value={quickTitle}
          onChange={(event) => setQuickTitle(event.target.value)}
          placeholder="Name an event and press Enter to pick the time"
          maxLength={200}
          autoComplete="off"
          className="min-w-0 flex-1 bg-transparent py-1 text-sm text-ink outline-none placeholder:text-muted"
        />
        <kbd className="hidden rounded border border-line px-1.5 font-mono text-2xs text-muted sm:inline">Enter</kbd>
      </form>

      <div className="flex flex-wrap items-center gap-2" role="search" aria-label="Filter events and tasks">
        <label className="relative flex min-w-48 flex-1 items-center">
          <span className="sr-only">Search events and tasks</span>
          <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 h-4 w-4 text-muted" />
          <input type="search" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search events and tasks" className={cn(controlClass, "w-full pl-8")} />
        </label>
        <select aria-label="Project" value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)} className={controlClass}>
          <option value={ALL}>All projects</option>
          <option value={NO_PROJECT}>No project</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>{project.name}</option>
          ))}
        </select>
        <ShowTasksSwitch className="py-1.5" />
      </div>

      {loadError ? (
        <p role="alert" className="rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
          {loadError}{" "}
          <button type="button" onClick={() => void fetchEvents()} className="font-semibold underline">Try again</button>
        </p>
      ) : null}

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="grid grid-cols-1 gap-3 lg:gap-4">
          {stripShown ? (
            <WeekStrip
              ref={stripRef}
              title={new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(dateFromKey(stripDayKey))}
              days={stripDays}
              selectedKey={stripDayKey}
              todayKey={todayKey}
              canGoBack={stripWeekKey > weekStartKey(todayKey)}
              canGoOn={shiftKey(stripWeekKey, 7) <= lastAgendaKey}
              onPick={jumpToDay}
              onPreviousWeek={() => {
                const previous = shiftKey(stripWeekKey, -7);
                jumpToDay(previous < todayKey ? todayKey : previous);
              }}
              onNextWeek={() => jumpToDay(shiftKey(stripWeekKey, 7))}
              onToday={() => jumpToDay(todayKey)}
            />
          ) : null}
          {fetching ? (
            <div className="grid gap-2" aria-busy="true" aria-label="Loading events">
              {Array.from({ length: 4 }, (_, index) => (
                <div key={index} className="h-12 animate-pulse rounded-xl border border-line bg-surface" />
              ))}
            </div>
          ) : agendaIsEmpty ? (
            <div className="rounded-xl border border-dashed border-line bg-surface px-6 py-10 text-center">
              <h2 className="text-base font-semibold">{events.length === 0 ? "No events yet." : "Nothing coming up."}</h2>
              <p className="mx-auto mt-1 max-w-md text-sm text-muted">
                {events.length === 0
                  ? "Add classes, meetings and deadlines; repeating ones show every time they happen."
                  : searchQuery || projectFilter !== ALL
                    ? "Nothing in the next 60 days matches these filters."
                    : "Nothing is scheduled in the next 60 days."}
              </p>
              {events.length === 0 ? (
                <label htmlFor="event-quick-title" className={cn(uiButtonClass, "mt-4 cursor-pointer px-3 py-1.5")}>
                  Add your first event
                </label>
              ) : null}
            </div>
          ) : (
            agendaDays.map(({ key, events: dayEvents, tasks: dayTasks }) =>
              dayEvents.length + dayTasks.length === 0 ? (
                // Below 1024 px every day has a line, so the week strip can jump to it; wide screens skip empty days.
                <p
                  key={key}
                  id={`agenda-${key}`}
                  data-day={key}
                  style={{ scrollMarginTop: stripHeight + 8 }}
                  className="flex items-baseline gap-2 px-1 text-sm lg:hidden"
                >
                  <span className="font-medium text-muted">{dayLabel(key, todayKey, tomorrowKey)}</span>
                  <span className="text-xs text-muted">Nothing planned</span>
                </p>
              ) : (
                <section
                  key={key}
                  id={`agenda-${key}`}
                  data-day={key}
                  style={{ scrollMarginTop: stripHeight + 8 }}
                  aria-labelledby={`day-${key}`}
                  className="rounded-xl border border-line bg-surface shadow-card"
                >
                  <h2 id={`day-${key}`} className="flex items-center gap-2 px-3 pb-1 pt-3 text-sm font-semibold sm:px-4">
                    <span className={key === todayKey ? "text-accent" : undefined}>{dayLabel(key, todayKey, tomorrowKey)}</span>
                    <span className="text-xs font-normal text-muted">{dayEvents.length + dayTasks.length}</span>
                  </h2>
                  <ul>
                    {dayEvents.map((event) => (
                      <EventRow
                        key={event.id}
                        event={event}
                        highlighted={(event.sourceEventId ?? event.id) === linkedEventId}
                        onOpen={openEvent}
                        onDelete={askDelete}
                      />
                    ))}
                    {dayTasks.map((task) => (
                      <TaskRow key={task.id} task={task} busy={busyTaskId === task.id} onToggle={(item) => void toggleTask(item)} />
                    ))}
                  </ul>
                </section>
              ),
            )
          )}

          {!fetching && past.length ? (
            <section aria-labelledby="past-events" className="rounded-xl border border-line bg-surface shadow-card">
              <h2 id="past-events" className="px-3 py-2 sm:px-4">
                <button
                  type="button"
                  aria-expanded={showPast}
                  onClick={() => setShowPast((value) => !value)}
                  className="flex w-full items-center justify-between text-sm font-semibold text-muted hover:text-ink"
                >
                  <span>{showPast ? "Hide past events" : `Show past events (${past.length})`}</span>
                  <ChevronRight aria-hidden="true" className={cn("h-4 w-4 transition-transform", showPast && "rotate-90")} />
                </button>
              </h2>
              {showPast ? (
                <ul>
                  {past.map((event) => (
                    <EventRow key={event.id} event={event} showDate highlighted={event.id === linkedEventId} onOpen={openEvent} onDelete={askDelete} />
                  ))}
                </ul>
              ) : null}
            </section>
          ) : null}
        </div>

        <aside aria-label="Month calendar" className="hidden rounded-xl border border-line bg-surface p-3 shadow-card lg:block">
          <div className="flex items-center justify-between">
            <button type="button" onClick={() => setCalendarMonth((month) => new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label="Previous month" className="grid h-7 w-7 place-items-center rounded-lg text-muted hover:bg-surface-hover hover:text-ink">
              <ChevronLeft aria-hidden="true" className="h-4 w-4" />
            </button>
            <h2 className="text-sm font-semibold">
              {new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(calendarMonth)}
            </h2>
            <button type="button" onClick={() => setCalendarMonth((month) => new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label="Next month" className="grid h-7 w-7 place-items-center rounded-lg text-muted hover:bg-surface-hover hover:text-ink">
              <ChevronRight aria-hidden="true" className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-2 grid grid-cols-7 text-center text-2xs font-semibold uppercase text-muted" aria-hidden="true">
            {["S", "M", "T", "W", "T", "F", "S"].map((day, index) => (
              <span key={index} className="py-1">{day}</span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-0.5">
            {calendarDays.map((day) => {
              const key = formatTaskDayKey(day);
              const count = eventsByDay.get(key)?.length ?? 0;
              const inMonth = day.getMonth() === calendarMonth.getMonth();
              const selected = key === selectedDayKey;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSelectedDayKey(key)}
                  aria-pressed={selected}
                  aria-label={`${new Intl.DateTimeFormat("en-US", { dateStyle: "full" }).format(day)}${count ? `, ${count} event${count === 1 ? "" : "s"}` : ""}`}
                  className={cn(
                    "relative grid h-9 place-items-center rounded-lg text-[13px] tabular-nums transition-colors",
                    selected ? "bg-accent font-semibold text-accent-ink" : "hover:bg-surface-hover",
                    !selected && key === todayKey && "font-bold text-accent",
                    !selected && !inMonth && "text-muted",
                  )}
                >
                  {day.getDate()}
                  {count ? (
                    <span aria-hidden="true" className={cn("absolute bottom-1 h-1 w-1 rounded-full", selected ? "bg-accent-ink" : "bg-accent")} />
                  ) : null}
                </button>
              );
            })}
          </div>
          <div className="mt-3 border-t border-line pt-3">
            <h3 className="text-xs font-semibold text-muted">{dayLabel(selectedDayKey, todayKey, tomorrowKey)}</h3>
            {selectedDayEvents.length ? (
              <ul className="mt-1.5 grid gap-1">
                {selectedDayEvents.map((event) => (
                  <li key={event.id}>
                    <button type="button" onClick={() => openEvent(event)} className="flex w-full items-start gap-2 rounded-lg px-1.5 py-1 text-left hover:bg-surface-hover">
                      <span aria-hidden="true" className="mt-1 h-2 w-2 shrink-0 rounded-[3px]" style={{ backgroundColor: event.project ? projectColor(event.project) : "var(--accent)" }} />
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-medium">{event.title}</span>
                        <span className="block text-xs text-muted">{timeRange(event)}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1.5 text-xs text-muted">Nothing scheduled.</p>
            )}
            <button
              type="button"
              onClick={() => setSheet({ open: true, event: null, draft: { startDate: selectedDayKey } })}
              className="mt-2 text-xs font-semibold text-accent hover:underline"
            >
              Add an event on this day
            </button>
          </div>
        </aside>
      </div>

      <EventSheet
        open={sheet.open}
        onOpenChange={closeSheet}
        event={sheet.event}
        draft={sheet.draft}
        projects={projects}
        onSubmit={saveEvent}
        onDelete={(event) => setDeleteTarget({ event, day: sheet.day ?? null })}
        onWriteNotes={(event) => void writeMeetingNotes(event)}
      />

      <DeleteEventDialog
        target={deleteTarget}
        loading={deleting}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={(scope) => {
          if (deleteTarget) void deleteEvent(deleteTarget, scope);
        }}
      />
    </div>
  );
}
