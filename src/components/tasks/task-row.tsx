"use client";

import { Check, MoreHorizontal, Pencil, Repeat, Trash2 } from "lucide-react";
import { useRef, type MouseEvent, type PointerEvent, type Ref } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/cn";
import { daysFrom, dueLabel } from "@/lib/home-summary";
import { paletteColor, projectColor } from "@/lib/project-color";
import { labelsOfTask } from "@/lib/labels";
import { openBlockers, subtaskProgress } from "@/lib/task-relations";
import { LabelChips } from "./label-chip";
import { PriorityBadge } from "./priority-badge";
import { BlockedBadge, ProgressRing } from "./task-badges";
import { recurrenceLabels, type Task } from "./types";

/**
 * One task as one line (#520, design 1D, after #281's 1B): the select box on the left, shown on
 * hover and while tasks are selected; the title, with its description beside it in grey; then,
 * in columns that line up down the list, the priority, due date and assignee, a Mark done button
 * and ⋯. The title opens the task.
 */
export function TaskRow({
  task,
  now,
  highlighted,
  selected,
  selecting,
  busy,
  showProject = true,
  showDescription = true,
  onSelect,
  onToggle,
  onOpen,
  onDelete,
  ref,
}: {
  task: Task;
  now: Date;
  highlighted: boolean;
  selected: boolean;
  /** Some task is selected, so every row shows its select box. */
  selecting: boolean;
  busy: boolean;
  /** Off when the row sits under its project's own band. */
  showProject?: boolean;
  /** The Display menu's "Descriptions". */
  showDescription?: boolean;
  /** `range` is true for Shift+click, which selects from the last clicked row. */
  onSelect: (task: Task, range: boolean) => void;
  onToggle: (task: Task) => void;
  onOpen: (task: Task) => void;
  onDelete: (task: Task) => void;
  ref?: Ref<HTMLLIElement>;
}) {
  const done = task.status === "DONE";
  const late = !done && Boolean(task.dueDate) && daysFrom(task.dueDate as string, now) < 0;
  const progress = subtaskProgress(task.subtasks);
  const blockers = done ? [] : openBlockers(task.blockedBy);
  const description = showDescription ? task.description : null;

  return (
    <li
      ref={ref}
      id={`task-${task.id}`}
      className={cn(
        "group/row flex h-10 items-center gap-1 pl-1.5 pr-2 transition-colors sm:pl-2 sm:pr-2.5",
        selected ? "bg-accent-soft/70" : highlighted ? "bg-accent-soft/40" : "hover:bg-surface-hover/70",
      )}
    >
      {/* Shown on hover, as in Linear, and always on screens without hover. */}
      <button
        type="button"
        role="checkbox"
        aria-checked={selected}
        aria-label={`Select ${task.title}`}
        onClick={(event: MouseEvent) => onSelect(task, event.shiftKey)}
        className={cn(
          "group/check grid h-7 w-7 shrink-0 place-items-center rounded-md outline-none transition-opacity focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-accent [@media(hover:none)]:opacity-100",
          selected || selecting ? "opacity-100" : "opacity-0 group-hover/row:opacity-100",
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            "grid h-4 w-4 place-items-center rounded border-[1.5px] transition-colors",
            selected ? "border-accent bg-accent text-accent-ink" : "border-muted group-hover/check:border-accent",
          )}
        >
          <Check className={cn("h-3 w-3", selected ? "opacity-100" : "opacity-0")} />
        </span>
      </button>

      {/* The title is the button's whole label; its ::after covers the description too, so both open the task. */}
      <div className="relative ml-1.5 flex h-full min-w-0 flex-1 items-center gap-2.5">
        <button
          type="button"
          onClick={() => onOpen(task)}
          aria-describedby={description ? `task-${task.id}-description` : undefined}
          className={cn(
            "min-w-0 flex-none truncate text-left text-[0.9375rem] leading-6 after:absolute after:inset-0 after:rounded-md focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-accent",
            description ? "max-w-[72%]" : "max-w-full",
            done ? "text-muted line-through" : "hover:text-accent",
          )}
        >
          {task.title}
        </button>
        {description ? (
          <span id={`task-${task.id}-description`} className="hidden min-w-0 flex-1 truncate text-[0.8125rem] text-muted sm:block">
            {description}
          </span>
        ) : null}
      </div>

      {/* The details, then the columns: from 640px each column keeps its width, so they line up down the list. */}
      <div className="ml-2 flex shrink-0 items-center gap-2 sm:ml-3 sm:gap-3">
        <LabelChips labels={labelsOfTask(task)} className="hidden md:flex" />
        {blockers.length ? <BlockedBadge titles={blockers.map((blocker) => blocker.title)} /> : null}
        {progress.total ? <ProgressRing done={progress.done} total={progress.total} /> : null}
        {task.recurrence !== "NONE" ? (
          <span title={recurrenceLabels[task.recurrence]} className="hidden shrink-0 text-muted sm:inline">
            <Repeat aria-hidden="true" className="h-3.5 w-3.5" />
            <span className="sr-only">{recurrenceLabels[task.recurrence]}</span>
          </span>
        ) : null}
        {task.status === "IN_PROGRESS" ? (
          <span className="hidden shrink-0 rounded bg-accent-soft px-1.5 text-2xs font-bold text-accent sm:inline">In progress</span>
        ) : null}
        {showProject && task.project ? (
          <span className="hidden max-w-32 shrink-0 items-center gap-1.5 truncate text-xs text-muted lg:inline-flex">
            <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-[3px]" style={{ backgroundColor: projectColor(task.project) }} />
            <span className="truncate">{task.project.name}</span>
          </span>
        ) : null}
        <span className="flex shrink-0 justify-end sm:w-14">
          <PriorityBadge priority={task.priority} muted={done} />
        </span>
        <span className={cn("shrink-0 whitespace-nowrap text-right text-xs sm:w-19", late ? "font-semibold text-danger" : "text-muted")}>
          {task.dueDate ? dueLabel(task.dueDate, now) : null}
        </span>
        <span className="hidden w-5.5 shrink-0 place-items-center sm:grid">
          {task.assignee ? (
            <span
              title={`Assigned to ${task.assignee.name}`}
              className="grid h-5.5 w-5.5 place-items-center rounded-full text-2xs font-bold text-white"
              style={{ backgroundColor: paletteColor(task.assignee.id) }}
            >
              <span aria-hidden="true">{task.assignee.name.charAt(0).toUpperCase()}</span>
              <span className="sr-only">Assigned to {task.assignee.name}</span>
            </span>
          ) : null}
        </span>

        <span className="flex shrink-0 justify-end sm:w-25">
          {/* The name starts with the visible words, as axe asks, then names the task. */}
          <button
            type="button"
            aria-pressed={done}
            aria-label={`${done ? "Done" : "Mark done"}: ${task.title}`}
            disabled={busy}
            onClick={() => onToggle(task)}
            className={cn(
              "group/done inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-1 text-[0.78125rem] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60 sm:pr-2.5",
              done
                ? "border-success bg-success text-success-ink hover:bg-success/90"
                : "border-line bg-surface text-muted hover:border-success hover:bg-success-soft hover:text-success",
            )}
          >
            <span
              aria-hidden="true"
              className={cn("grid h-4.5 w-4.5 place-items-center rounded-full border-[1.5px]", done ? "border-success-ink" : "border-current")}
            >
              <Check className={cn("h-2.5 w-2.5", done ? "opacity-100" : "opacity-60 group-hover/done:opacity-100")} strokeWidth={3.5} />
            </span>
            <span className="sr-only sm:not-sr-only">{done ? "Done" : "Mark done"}</span>
          </button>
        </span>
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`More actions for ${task.title}`}
          className="ml-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted outline-none hover:bg-surface-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-accent data-[state=open]:bg-surface-hover data-[state=open]:text-ink"
        >
          <MoreHorizontal aria-hidden="true" className="h-4 w-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => onOpen(task)}>
            <Pencil />
            Edit
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => onDelete(task)} className="text-danger [&_svg]:text-danger">
            <Trash2 />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

/** How long a press takes to select a task on a phone, and how far the finger may drift meanwhile. */
const LONG_PRESS_MS = 450;
const LONG_PRESS_SLOP = 10;

/**
 * Press and hold (#521): calls `onLongPress` once a press has held still for LONG_PRESS_MS, and
 * swallows the click that ends it, so the task doesn't open too. Scrolling cancels it.
 */
function useLongPress(onLongPress: () => void) {
  const timer = useRef<number | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);

  function cancel() {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    start.current = null;
  }

  return {
    onPointerDown(event: PointerEvent) {
      if (event.button !== 0) return;
      cancel();
      fired.current = false;
      start.current = { x: event.clientX, y: event.clientY };
      timer.current = window.setTimeout(() => {
        timer.current = null;
        fired.current = true;
        navigator.vibrate?.(10);
        onLongPress();
      }, LONG_PRESS_MS);
    },
    onPointerMove(event: PointerEvent) {
      if (start.current && Math.hypot(event.clientX - start.current.x, event.clientY - start.current.y) > LONG_PRESS_SLOP) cancel();
    },
    onPointerUp: cancel,
    onPointerLeave: cancel,
    onPointerCancel: cancel,
    onClickCapture(event: MouseEvent) {
      if (!fired.current) return;
      fired.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
    // Android opens the link menu on a long press; here the press selects instead.
    onContextMenu(event: MouseEvent) {
      event.preventDefault();
    },
  };
}

/**
 * One task on a phone (#521, design 2A): a circle on the left to mark it done; the title, with the
 * due date, label, subtasks, assignee and description on a line under it; the priority on the
 * right. Tapping the task opens it. Pressing and holding selects it; while tasks are selected the
 * circle becomes a select box and a tap selects, and the bulk bar does the rest.
 */
export function TaskRowPhone({
  task,
  now,
  highlighted,
  selected,
  selecting,
  busy,
  showDescription = true,
  onSelect,
  onToggle,
  onOpen,
  ref,
}: {
  task: Task;
  now: Date;
  highlighted: boolean;
  selected: boolean;
  /** Some task is selected, so a tap selects rather than opens. */
  selecting: boolean;
  busy: boolean;
  showDescription?: boolean;
  onSelect: (task: Task, range: boolean) => void;
  onToggle: (task: Task) => void;
  onOpen: (task: Task) => void;
  ref?: Ref<HTMLLIElement>;
}) {
  const done = task.status === "DONE";
  const days = task.dueDate ? daysFrom(task.dueDate, now) : null;
  const late = !done && days !== null && days < 0;
  const dueToday = !done && days === 0;
  const progress = subtaskProgress(task.subtasks);
  const blockers = done ? [] : openBlockers(task.blockedBy);
  const labels = labelsOfTask(task);
  const description = showDescription ? task.description : null;
  const press = useLongPress(() => onSelect(task, false));
  const hasDetails = Boolean(
    task.status === "IN_PROGRESS" || task.dueDate || labels.length || blockers.length || progress.total || task.assignee || description,
  );

  return (
    <li
      ref={ref}
      id={`task-${task.id}`}
      className={cn(
        // The line under each task starts at the title, as in iOS lists.
        "relative flex min-h-14 select-none items-start gap-0.5 py-1.5 pl-1 pr-3.5 transition-colors [-webkit-touch-callout:none] after:pointer-events-none after:absolute after:bottom-0 after:left-12 after:right-0 after:h-px after:bg-line",
        selected ? "bg-accent-soft/70" : highlighted ? "bg-accent-soft/40" : "bg-surface",
      )}
    >
      {selecting ? (
        <button
          type="button"
          role="checkbox"
          aria-checked={selected}
          aria-label={`Select ${task.title}`}
          onClick={() => onSelect(task, false)}
          className="relative z-10 grid h-11 w-11 shrink-0 place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <span
            aria-hidden="true"
            className={cn("grid h-5.5 w-5.5 place-items-center rounded-md border-[1.5px] transition-colors", selected ? "border-accent bg-accent text-accent-ink" : "border-muted")}
          >
            <Check className={cn("h-3.5 w-3.5", selected ? "opacity-100" : "opacity-0")} strokeWidth={3} />
          </span>
        </button>
      ) : (
        // The name starts with the words a sighted person would say, as on computers.
        <button
          type="button"
          aria-pressed={done}
          aria-label={`${done ? "Done" : "Mark done"}: ${task.title}`}
          disabled={busy}
          onClick={() => onToggle(task)}
          className="group/done relative z-10 grid h-11 w-11 shrink-0 place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60"
        >
          <span
            aria-hidden="true"
            className={cn(
              "grid h-5.5 w-5.5 place-items-center rounded-full border-[1.5px] transition-colors",
              done
                ? "border-success bg-success text-success-ink"
                : "border-muted/80 text-transparent group-hover/done:border-success group-hover/done:bg-success-soft group-hover/done:text-success",
            )}
          >
            <Check className="h-3.25 w-3.25" strokeWidth={3.2} />
          </span>
        </button>
      )}

      <div className="grid min-w-0 flex-1 gap-0.5 pb-1.5 pt-2.5">
        {/* The title's ::after covers the row, so a tap anywhere but the circle opens the task (or selects it). */}
        <button
          type="button"
          {...press}
          onClick={() => (selecting ? onSelect(task, false) : onOpen(task))}
          aria-describedby={description ? `task-${task.id}-description` : undefined}
          className={cn(
            "min-w-0 truncate text-left text-[0.9375rem] leading-5.5 outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-accent",
            done ? "text-muted line-through" : "text-ink",
          )}
        >
          {task.title}
        </button>
        {hasDetails ? (
          <span className="flex min-w-0 items-center gap-2 text-[0.78125rem] leading-4.5">
            {task.status === "IN_PROGRESS" ? <span className="shrink-0 font-semibold text-accent">In progress</span> : null}
            {task.dueDate ? (
              <span className={cn("shrink-0 whitespace-nowrap font-medium", late ? "font-semibold text-danger" : dueToday ? "text-success" : "text-muted")}>
                {dueLabel(task.dueDate, now)}
              </span>
            ) : null}
            {labels.length ? (
              <span className="inline-flex min-w-0 max-w-[45%] shrink-0 items-center gap-1.25 text-muted">
                <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: labels[0].color }} />
                <span className="truncate">{labels[0].name}</span>
                {labels.length > 1 ? <span className="shrink-0">+{labels.length - 1}</span> : null}
              </span>
            ) : null}
            {blockers.length ? <BlockedBadge titles={blockers.map((blocker) => blocker.title)} /> : null}
            {progress.total ? <ProgressRing done={progress.done} total={progress.total} /> : null}
            {task.assignee ? (
              <span
                title={`Assigned to ${task.assignee.name}`}
                className="grid h-4.5 w-4.5 shrink-0 place-items-center rounded-full text-[0.625rem] font-bold text-white"
                style={{ backgroundColor: paletteColor(task.assignee.id) }}
              >
                <span aria-hidden="true">{task.assignee.name.charAt(0).toUpperCase()}</span>
                <span className="sr-only">Assigned to {task.assignee.name}</span>
              </span>
            ) : null}
            {description ? (
              <span id={`task-${task.id}-description`} className="min-w-0 flex-1 truncate text-[0.8125rem] text-muted">
                {description}
              </span>
            ) : null}
          </span>
        ) : null}
      </div>

      <PriorityBadge priority={task.priority} muted={done} className="mt-3.25 shrink-0" />
    </li>
  );
}
