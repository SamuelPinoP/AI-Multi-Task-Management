"use client";

import { Crosshair, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useSyncExternalStore, type ReactNode } from "react";
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/cn";
import { formatEventTime } from "@/lib/event-time";
import { priorityLabels, type Priority } from "@/lib/priority";
import { projectColor } from "@/lib/project-color";
import { describeRepeat, normalizeRecurrence } from "@/lib/recurrence";

/** Repeat patterns an event or a task can have. */
export type CalendarRecurrence = "NONE" | "DAILY" | "WEEKLY" | "BIWEEKLY" | "MONTHLY";

export type CalendarProject = { id: string; name: string; color: string | null };

/**
 * An event as the Month tab draws it. `sourceEventId` points an occurrence of a
 * repeating event back to the stored event, so opening or deleting it reaches
 * the real record rather than the virtual occurrence.
 */
export type CalendarEvent = {
  id: string;
  sourceEventId?: string;
  title: string;
  description: string | null;
  location: string | null;
  startTime: string;
  endTime: string | null;
  hasStartTime: boolean;
  hasEndTime: boolean;
  recurrence?: CalendarRecurrence | null;
  /** The last day a repeat can start on; null keeps repeating. */
  repeatUntil?: string | null;
  /** Days deleted from the series (CAL-03). */
  skippedDates?: string[];
  projectId?: string | null;
  project?: CalendarProject | null;
};

export type CalendarTaskStatus = "TODO" | "IN_PROGRESS" | "DONE";

/** A task as the Month tab draws it: on its due day. */
export type CalendarTask = {
  id: string;
  title: string;
  description?: string | null;
  status: CalendarTaskStatus;
  priority: Priority;
  dueDate: string | null;
  recurrence?: CalendarRecurrence | null;
  projectId?: string | null;
  project?: CalendarProject | null;
  assignee?: { id: string } | null;
};

const statusWords: Record<CalendarTaskStatus, string> = { TODO: "To do", IN_PROGRESS: "In progress", DONE: "Done" };

/** An item's project color, or the accent for items without a project. */
function itemColor(item: { project?: CalendarProject | null }) {
  return item.project ? projectColor(item.project) : "var(--accent)";
}

/** Untimed events first, then by start time. */
export function compareEvents(a: CalendarEvent, b: CalendarEvent) {
  return Number(a.hasStartTime) - Number(b.hasStartTime) || new Date(a.startTime).getTime() - new Date(b.startTime).getTime();
}

const WIDE_QUERY = "(min-width: 640px)";

/** True on screens where the month shows as a grid of day cells (Tailwind's `sm`); false on phones and on the server. */
export function useWideScreen() {
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia(WIDE_QUERY);
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
    () => window.matchMedia(WIDE_QUERY).matches,
    () => false,
  );
}

/**
 * A day's events and tasks, with their actions: open or delete an event, open
 * or finish a task. The phone's list under the grid and the day pop-over on
 * wider screens both use it. A highlighted task says so in words, not only in
 * color (#363).
 */
export function CalendarDayDetails({
  events,
  tasks,
  highlightedTaskId,
  showTasks,
  fetching,
  deletingEventId,
  completingTaskId,
  onOpenEvent,
  onDeleteEvent,
  onCompleteTask,
}: {
  events: CalendarEvent[];
  tasks: CalendarTask[];
  highlightedTaskId: string | null;
  showTasks: boolean;
  fetching: boolean;
  /** The stored event being deleted, for its button's busy state. */
  deletingEventId: string | null;
  completingTaskId: string | null;
  onOpenEvent: (event: CalendarEvent) => void;
  onDeleteEvent: (event: CalendarEvent) => void;
  onCompleteTask: (task: CalendarTask) => void;
}) {
  const count = events.length + tasks.length;

  function renderTask(task: CalendarTask) {
    const done = task.status === "DONE";
    const highlighted = task.id === highlightedTaskId;
    return (
      <article
        key={task.id}
        className={cn(
          "relative flex items-start gap-2.5 rounded-lg border px-2.5 py-2 text-sm transition-colors",
          highlighted ? "border-accent bg-accent-soft ring-1 ring-accent" : "border-line hover:border-accent/50 hover:bg-accent-soft/40",
        )}
      >
        <span
          aria-hidden="true"
          className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded-full border-[1.5px]"
          style={{ borderColor: itemColor(task), backgroundColor: done ? itemColor(task) : undefined }}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            {/* The title opens the task's page; its ::after covers the card. */}
            <Link
              href={`/tasks/${encodeURIComponent(task.id)}`}
              className={cn(
                "min-w-0 break-words font-medium after:absolute after:inset-0 after:rounded-lg focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-accent",
                done && "text-muted line-through",
              )}
            >
              {task.title}
            </Link>
            {done ? (
              <span className="relative z-10 shrink-0 rounded-full bg-sunken px-2 py-0.5 text-xs font-semibold text-muted">Done</span>
            ) : (
              <button
                type="button"
                onClick={() => onCompleteTask(task)}
                disabled={completingTaskId === task.id}
                aria-busy={completingTaskId === task.id}
                aria-label={`Mark done: ${task.title}`}
                className="relative z-10 -my-0.5 shrink-0 rounded-full bg-success px-2.5 py-1 text-xs font-semibold text-success-ink transition-colors hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Mark done
              </button>
            )}
          </div>
          <p className="mt-0.5 text-xs text-muted">
            {highlighted ? <span className="font-semibold text-accent">Highlighted from Tasks · </span> : null}
            {statusWords[task.status]} · {priorityLabels[task.priority]}
            {task.project ? ` · ${task.project.name}` : ""}
          </p>
        </div>
      </article>
    );
  }

  return (
    <>
      <p className="mt-0.5 text-sm text-muted">
        {count === 0
          ? showTasks
            ? "No events or tasks planned for this day."
            : "No events planned for this day."
          : `${count} item${count === 1 ? "" : "s"} scheduled`}
      </p>
      <div className="mt-2.5 grid gap-1.5">
        {/* The highlighted task leads, as it does in the grid; then events, then the other tasks. */}
        {tasks.filter((task) => task.id === highlightedTaskId).map(renderTask)}
        {events.map((event) => (
          <article
            key={event.id}
            className="relative flex items-start gap-2.5 rounded-lg border border-line px-2.5 py-2 text-sm transition-colors hover:border-accent/50 hover:bg-accent-soft/40"
          >
            <span aria-hidden="true" className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: itemColor(event) }} />
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                {/* The title opens the event; its ::after covers the card, so the whole card is clickable. */}
                <button
                  type="button"
                  onClick={() => onOpenEvent(event)}
                  className="min-w-0 break-words text-left font-medium after:absolute after:inset-0 after:rounded-lg focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-accent"
                >
                  {event.title}
                </button>
                {/* A small trash button keeps the list compact; z-10 keeps it above the title's ::after. */}
                <button
                  type="button"
                  aria-label={`Delete ${event.title}`}
                  title="Delete"
                  onClick={() => onDeleteEvent(event)}
                  disabled={deletingEventId === (event.sourceEventId ?? event.id)}
                  className="relative z-10 -my-1 grid h-7 w-7 shrink-0 place-items-center rounded-full text-muted outline-none transition-colors hover:bg-danger/10 hover:text-danger focus-visible:ring-2 focus-visible:ring-danger disabled:opacity-50"
                >
                  <Trash2 aria-hidden="true" className="h-4 w-4" />
                </button>
              </div>
              <p className="mt-0.5 text-xs tabular-nums text-muted">
                {event.hasStartTime ? (
                  <>
                    <span>{formatEventTime(event.startTime)}</span>
                    {event.endTime && event.hasEndTime ? <span> – {formatEventTime(event.endTime)}</span> : null}
                  </>
                ) : (
                  <span>All day</span>
                )}
                {event.location ? <span> · {event.location}</span> : null}
              </p>
              {normalizeRecurrence(event.recurrence) !== "NONE" ? <p className="text-xs text-muted">{describeRepeat(event.recurrence, event.repeatUntil)}</p> : null}
              {event.description ? <p className="mt-0.5 line-clamp-2 text-xs text-muted">{event.description}</p> : null}
            </div>
          </article>
        ))}

        {tasks.filter((task) => task.id !== highlightedTaskId).map(renderTask)}

        {!fetching && count === 0 ? (
          <p className="rounded-lg border border-dashed border-line px-3 py-4 text-sm text-muted">Select another day or create an event or due task.</p>
        ) : null}
        {fetching ? <p className="text-sm text-muted">Loading calendar items...</p> : null}
      </div>
    </>
  );
}

/** How many items a day cell lists before "+N more". */
const CELL_ITEMS = 3;

/**
 * One day of the month grid on wider screens (design 4B, #363): its number,
 * up to three events and tasks, and "+N more". A click anywhere on it, or on
 * its number (the keyboard's way in), opens the day in a pop-over.
 */
export function CalendarDayCell({
  day,
  label,
  inMonth,
  isToday,
  isPast,
  events,
  tasks,
  highlightedTaskId,
  open,
  onOpenChange,
  autoOpened,
  children,
}: {
  day: Date;
  /** "Thursday, November 12, 2026", for the button and the pop-over. */
  label: string;
  inMonth: boolean;
  isToday: boolean;
  /** Before today: open tasks here are overdue. */
  isPast: boolean;
  events: CalendarEvent[];
  tasks: CalendarTask[];
  highlightedTaskId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Opened by a link rather than a click: the pop-over shows without taking focus. */
  autoOpened: boolean;
  /** The pop-over's content. */
  children: ReactNode;
}) {
  const count = events.length + tasks.length;
  // The highlighted task comes first, so it's never hidden behind "+N more".
  const orderedTasks = [...tasks].sort(
    (a, b) => Number(b.id === highlightedTaskId) - Number(a.id === highlightedTaskId) || Number(a.status === "DONE") - Number(b.status === "DONE"),
  );
  const highlight = orderedTasks[0]?.id === highlightedTaskId ? orderedTasks.slice(0, 1) : [];
  const items = [
    ...highlight.map((task) => ({ kind: "task" as const, task })),
    ...events.map((event) => ({ kind: "event" as const, event })),
    ...orderedTasks.slice(highlight.length).map((task) => ({ kind: "task" as const, task })),
  ];
  const shown = items.length > CELL_ITEMS + 1 ? items.slice(0, CELL_ITEMS) : items;
  const more = items.length - shown.length;
  const buttonLabel = `${label}${isToday ? ", today" : ""}, ${count ? `${count} item${count === 1 ? "" : "s"}` : "nothing planned"}`;

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor asChild>
        <div
          // A click on the cell's free space opens the day too; the number button is the keyboard's way in.
          onClick={(event) => {
            if (!(event.target as HTMLElement).closest("button, a")) onOpenChange(true);
          }}
          className={cn(
            "flex h-32 min-w-0 cursor-pointer flex-col gap-0.5 overflow-hidden px-1.5 pb-1 pt-1 transition-colors",
            inMonth ? "bg-surface hover:bg-surface-hover/60" : "bg-sunken/70 hover:bg-surface-hover/60",
            open && "bg-accent-soft/50 hover:bg-accent-soft/50",
          )}
        >
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={buttonLabel}
              className={cn(
                "mx-auto grid h-6 min-w-6 shrink-0 place-items-center rounded-full px-1 text-[0.8125rem] tabular-nums outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent",
                isToday ? "bg-accent font-bold text-accent-ink" : inMonth ? "font-medium text-ink hover:bg-surface-hover" : "text-muted hover:bg-surface-hover",
              )}
            >
              {day.getDate()}
            </button>
          </PopoverTrigger>
          {shown.map((item) =>
            item.kind === "event" ? (
              <EventChip key={`event-${item.event.id}`} event={item.event} />
            ) : (
              <TaskChip key={`task-${item.task.id}`} task={item.task} overdue={isPast && item.task.status !== "DONE"} highlighted={item.task.id === highlightedTaskId} />
            ),
          )}
          {more > 0 ? <span className="px-1.5 text-xs font-medium text-muted">+{more} more</span> : null}
        </div>
      </PopoverAnchor>
      {/* Beside the day (Radix moves it to the other side near an edge), and never taller than the screen. */}
      <PopoverContent
        side="right"
        align="start"
        sideOffset={4}
        aria-label={label}
        onOpenAutoFocus={(event) => {
          if (autoOpened) event.preventDefault();
        }}
        className="max-h-[min(34rem,var(--radix-popover-content-available-height))] w-80 overflow-y-auto p-3"
      >
        <div className="flex items-start justify-between gap-2">
          <h3 className="pt-1 text-base font-semibold">{label}</h3>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label="Close"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted outline-none hover:bg-surface-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-accent"
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>
        {children}
      </PopoverContent>
    </Popover>
  );
}

function EventChip({ event }: { event: CalendarEvent }) {
  const color = itemColor(event);
  // Untimed events read as a tinted bar with just the title; timed ones lead with a dot and the time.
  return event.hasStartTime ? (
    <span className="flex h-5 min-w-0 shrink-0 items-center gap-1.5 rounded px-1.5 text-xs text-ink">
      <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
      <span className="shrink-0 tabular-nums text-muted">{formatEventTime(event.startTime)}</span>
      <span className="truncate">{event.title}</span>
    </span>
  ) : (
    <span className="flex h-5 min-w-0 shrink-0 items-center rounded px-1.5 text-xs font-medium text-ink" style={{ backgroundColor: `color-mix(in srgb, ${color} 18%, transparent)` }}>
      <span className="truncate">{event.title}</span>
    </span>
  );
}

function TaskChip({ task, overdue, highlighted }: { task: CalendarTask; overdue: boolean; highlighted: boolean }) {
  const color = itemColor(task);
  const done = task.status === "DONE";
  return (
    <span
      className={cn(
        "flex h-5 min-w-0 shrink-0 items-center gap-1.5 rounded px-1.5 text-xs",
        highlighted ? "bg-accent-soft font-semibold text-ink ring-2 ring-inset ring-accent" : done ? "text-muted" : overdue ? "text-danger" : "text-ink",
      )}
    >
      {highlighted ? (
        <Crosshair aria-hidden="true" className="h-3 w-3 shrink-0 text-accent" />
      ) : (
        <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full border-[1.5px]" style={{ borderColor: color, backgroundColor: done ? color : undefined }} />
      )}
      <span className={cn("truncate", done && "line-through")}>
        {highlighted ? <span className="sr-only">Highlighted: </span> : null}
        {task.title}
      </span>
    </span>
  );
}
