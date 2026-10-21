"use client";

/**
 * Events: the agenda first, the form second (DES-02).
 *
 * - Quick entry takes a title and opens the New event sheet for the date and time.
 * - An agenda of today and the next 60 days, grouped by day. Repeating events
 *   show their real occurrences (they used to appear only on their first date).
 * - Past events behind a toggle.
 * - On wide screens, a month calendar with the selected day's events.
 * - `?event=<id>` opens that event in the sheet (links from search and Home).
 *
 * Event times are stored wall-clock values; see `@/lib/event-time`.
 */

import { CalendarDays, ChevronLeft, ChevronRight, MoreHorizontal, Pencil, Plus, Repeat, Search, Trash2 } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useEffectEvent, useMemo, useState, type FormEvent } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EventSheet, type EventInput, type EventItem, type EventProject } from "@/components/events/event-sheet";
import { uiButtonClass, uiPrimaryButtonClass } from "@/components/ui";
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
import { describeRepeat, normalizeRecurrence } from "@/lib/recurrence";
import { formatTaskDayKey, getLocalDateOnly } from "@/lib/task-date-buckets";
import { notifyWorkspaceChanged } from "@/lib/workspace-events";

const AGENDA_DAYS = 60;
const PAST_LIMIT = 30;
const ALL = "ALL";
const NO_PROJECT = "NO_PROJECT";

const controlClass =
  "min-w-0 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/25";

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
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
      <span className="w-[4.5rem] shrink-0 text-xs tabular-nums text-muted sm:w-24">
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

export default function EventsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const linkedEventId = searchParams.get("event");

  const [events, setEvents] = useState<EventItem[]>([]);
  const [projects, setProjects] = useState<EventProject[]>([]);
  const [fetching, setFetching] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [projectFilter, setProjectFilter] = useState(ALL);
  const [searchQuery, setSearchQuery] = useState("");
  const [showPast, setShowPast] = useState(false);
  const [quickTitle, setQuickTitle] = useState("");
  const [sheet, setSheet] = useState<{ open: boolean; event: EventItem | null; draft?: Partial<EventInput> }>({ open: false, event: null });
  const [confirmDelete, setConfirmDelete] = useState<EventItem | null>(null);
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

  useEffect(() => {
    async function loadInitialData() {
      await Promise.all([fetchEvents(), fetchProjects()]);
    }
    void loadInitialData();
  }, []);

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

  // Occurrences from today through the agenda window, grouped by day.
  const agenda = useMemo(() => {
    const start = getLocalDateOnly(new Date());
    const end = addDays(start, AGENDA_DAYS);
    end.setMilliseconds(-1);
    const occurrences = occurrencesInRange(filtered, start, end).sort(
      (a, b) =>
        formatTaskDayKey(a.startTime).localeCompare(formatTaskDayKey(b.startTime)) ||
        Number(a.hasStartTime) - Number(b.hasStartTime) ||
        a.startTime.localeCompare(b.startTime),
    );
    const days = new Map<string, EventItem[]>();
    for (const occurrence of occurrences) {
      const key = formatTaskDayKey(occurrence.startTime);
      days.set(key, [...(days.get(key) ?? []), occurrence]);
    }
    return [...days.entries()];
  }, [filtered]);

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

  const weekCount = agenda.filter(([key]) => key < formatTaskDayKey(addDays(todayStart, 7))).reduce((sum, [, items]) => sum + items.length, 0);

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

  function openEvent(occurrence: EventItem) {
    const source = events.find((event) => event.id === (occurrence.sourceEventId ?? occurrence.id)) ?? occurrence;
    setSheet({ open: true, event: source });
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
      body: JSON.stringify({
        ...input,
        startTime: input.startTime || null,
        endDate: input.endDate || null,
        endTime: input.endTime || null,
        repeatUntil: input.repeatUntil || null,
      }),
    });
    if (!response.ok) return errorMessage(response, editing ? "Could not save the event." : "Could not create the event.");
    notifyWorkspaceChanged();
    await fetchEvents();
    toast.success(editing ? "Event saved" : "Event created", { description: input.title });
    return null;
  }

  async function deleteEvent(event: EventItem) {
    setDeleting(true);
    try {
      const response = await fetch(`/api/events/${event.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await errorMessage(response, "Could not delete the event."));
      setEvents((current) => current.filter((item) => item.id !== event.id));
      notifyWorkspaceChanged();
      if (sheet.event?.id === event.id) closeSheet(false);
      toast.success("Moved to Trash", { description: event.title });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete the event.");
    } finally {
      setDeleting(false);
      setConfirmDelete(null);
    }
  }

  const askDelete = (occurrence: EventItem) =>
    setConfirmDelete(events.find((event) => event.id === (occurrence.sourceEventId ?? occurrence.id)) ?? occurrence);

  return (
    <div className="mx-auto grid w-full max-w-6xl gap-4 px-4 py-5 sm:px-6 lg:px-8 lg:py-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Events</h1>
          <p className="mt-0.5 text-sm text-muted">
            {fetching ? "Loading..." : `${weekCount} in the next 7 days`}
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/events/calendar" className={cn(uiButtonClass, "px-3 py-1.5")}>
            <CalendarDays aria-hidden="true" className="h-4 w-4 text-muted" />
            Calendar
          </Link>
          <button
            type="button"
            onClick={() => setSheet({ open: true, event: null, draft: { startDate: selectedDayKey >= todayKey ? selectedDayKey : todayKey } })}
            className={cn(uiPrimaryButtonClass, "px-3 py-1.5")}
          >
            <Plus aria-hidden="true" className="h-4 w-4" />
            New event
          </button>
        </div>
      </header>

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
        <kbd className="hidden rounded border border-line px-1.5 font-sans text-[10px] text-muted sm:inline">Enter</kbd>
      </form>

      <div className="flex flex-wrap items-center gap-2" role="search" aria-label="Filter events">
        <label className="relative flex min-w-48 flex-1 items-center">
          <span className="sr-only">Search events</span>
          <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 h-4 w-4 text-muted" />
          <input type="search" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search events" className={cn(controlClass, "w-full pl-8")} />
        </label>
        <select aria-label="Project" value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)} className={controlClass}>
          <option value={ALL}>All projects</option>
          <option value={NO_PROJECT}>No project</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>{project.name}</option>
          ))}
        </select>
      </div>

      {loadError ? (
        <p role="alert" className="rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
          {loadError}{" "}
          <button type="button" onClick={() => void fetchEvents()} className="font-semibold underline">Try again</button>
        </p>
      ) : null}

      <div className="grid items-start gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="grid gap-4">
          {fetching ? (
            <div className="grid gap-2" aria-busy="true" aria-label="Loading events">
              {Array.from({ length: 4 }, (_, index) => (
                <div key={index} className="h-12 animate-pulse rounded-xl border border-line bg-surface" />
              ))}
            </div>
          ) : agenda.length === 0 ? (
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
            agenda.map(([key, items]) => (
              <section key={key} aria-labelledby={`day-${key}`} className="rounded-xl border border-line bg-surface">
                <h2 id={`day-${key}`} className="flex items-center gap-2 px-3 pb-1 pt-3 text-sm font-semibold sm:px-4">
                  <span className={key === todayKey ? "text-accent" : undefined}>{dayLabel(key, todayKey, tomorrowKey)}</span>
                  <span className="text-xs font-normal text-muted">{items.length}</span>
                </h2>
                <ul>
                  {items.map((event) => (
                    <EventRow
                      key={event.id}
                      event={event}
                      highlighted={(event.sourceEventId ?? event.id) === linkedEventId}
                      onOpen={openEvent}
                      onDelete={askDelete}
                    />
                  ))}
                </ul>
              </section>
            ))
          )}

          {!fetching && past.length ? (
            <section aria-labelledby="past-events" className="rounded-xl border border-line bg-surface">
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

        <aside aria-label="Month calendar" className="hidden rounded-xl border border-line bg-surface p-3 lg:block">
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
          <div className="mt-2 grid grid-cols-7 text-center text-[10.5px] font-semibold uppercase text-muted" aria-hidden="true">
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
        onDelete={setConfirmDelete}
        onWriteNotes={(event) => void writeMeetingNotes(event)}
      />

      <ConfirmDialog
        open={Boolean(confirmDelete)}
        title="Delete this event?"
        message={
          confirmDelete
            ? `“${confirmDelete.title}”${normalizeRecurrence(confirmDelete.recurrence) !== "NONE" ? " and all its repeats" : ""} move to Trash, where you can restore it.`
            : ""
        }
        loading={deleting}
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => {
          if (confirmDelete) void deleteEvent(confirmDelete);
        }}
      />
    </div>
  );
}
