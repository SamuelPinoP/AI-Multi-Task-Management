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
 * One task in the list (#281, design 1B): the checkbox on the left selects it
 * for bulk changes, and the Mark done button on the right completes it in one
 * click, turning green. The title opens the task.
 */
export function TaskRow({
  task,
  now,
  highlighted,
  selected,
  busy,
  showProject = true,
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
  busy: boolean;
  /** Off when the row sits under its project's own header. */
  showProject?: boolean;
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

  return (
    <li
      ref={ref}
      id={`task-${task.id}`}
      className={cn(
        "flex min-h-14 items-center gap-2 border-t border-line py-1.5 pl-1.5 pr-2 first:border-t-0 sm:gap-2.5 sm:pr-3",
        selected ? "bg-accent-soft/70" : highlighted && "bg-accent-soft/40",
      )}
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={selected}
        aria-label={`Select ${task.title}`}
        onClick={(event: MouseEvent) => onSelect(task, event.shiftKey)}
        className="group grid h-9 w-9 shrink-0 place-items-center rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <span
          aria-hidden="true"
          className={cn(
            "grid h-4 w-4 place-items-center rounded border-[1.5px] transition-colors",
            selected ? "border-accent bg-accent text-accent-ink" : "border-muted group-hover:border-accent",
          )}
        >
          <Check className={cn("h-3 w-3", selected ? "opacity-100" : "opacity-0")} />
        </span>
      </button>

      {/* The title is the button's whole label; its ::after covers the description too, so both open the task. */}
      <div className="relative min-w-0 flex-1">
        <button
          type="button"
          onClick={() => onOpen(task)}
          aria-describedby={task.description ? `task-${task.id}-description` : undefined}
          className={cn(
            "block w-full text-left after:absolute after:inset-0 after:rounded-md focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-accent",
            !done && "hover:text-accent",
          )}
        >
          <span className={cn("block truncate text-[0.9375rem] leading-6", done && "text-muted line-through")}>{task.title}</span>
        </button>
        {task.description ? (
          <span id={`task-${task.id}-description`} className="hidden truncate text-[0.8125rem] text-muted sm:block">
            {task.description}
          </span>
        ) : null}
      </div>

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
      <PriorityBadge priority={task.priority} muted={done} />
      {showProject && task.project ? (
        <span className="hidden max-w-32 shrink-0 items-center gap-1.5 truncate text-xs text-muted lg:inline-flex">
          <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-[3px]" style={{ backgroundColor: projectColor(task.project) }} />
          <span className="truncate">{task.project.name}</span>
        </span>
      ) : null}
      {task.dueDate ? (
        <span className={cn("shrink-0 whitespace-nowrap text-xs", late ? "font-semibold text-danger" : "text-muted")}>
          {dueLabel(task.dueDate, now)}
        </span>
      ) : null}
      {task.assignee ? (
        <span
          title={`Assigned to ${task.assignee.name}`}
          className="hidden h-6 w-6 shrink-0 place-items-center rounded-full text-2xs font-bold text-white sm:grid"
          style={{ backgroundColor: paletteColor(task.assignee.id) }}
        >
          <span aria-hidden="true">{task.assignee.name.charAt(0).toUpperCase()}</span>
          <span className="sr-only">Assigned to {task.assignee.name}</span>
        </span>
      ) : null}

      {/* The name starts with the visible words, as axe asks, then names the task. */}
      <button
        type="button"
        aria-pressed={done}
        aria-label={`${done ? "Done" : "Mark done"}: ${task.title}`}
        disabled={busy}
        onClick={() => onToggle(task)}
        className={cn(
          "group inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-2 text-[0.8125rem] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60 sm:pl-1.5 sm:pr-3",
          done
            ? "border-success bg-success text-success-ink hover:bg-success/90"
            : "border-line bg-surface text-muted hover:border-success hover:bg-success-soft hover:text-success",
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            "grid h-5 w-5 place-items-center rounded-full border-[1.5px]",
            done ? "border-success-ink" : "border-current",
          )}
        >
          <Check className={cn("h-3 w-3", done ? "opacity-100" : "opacity-60 group-hover:opacity-100")} strokeWidth={3} />
        </span>
        <span className="sr-only sm:not-sr-only">{done ? "Done" : "Mark done"}</span>
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`More actions for ${task.title}`}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted outline-none hover:bg-surface-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-accent"
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
