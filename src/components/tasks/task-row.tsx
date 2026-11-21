"use client";

import { Check, MoreHorizontal, Pencil, Repeat, Trash2 } from "lucide-react";
import type { MouseEvent, Ref } from "react";
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
