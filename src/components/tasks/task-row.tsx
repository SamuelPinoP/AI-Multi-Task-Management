"use client";

import { Check, MoreHorizontal, Pencil, Repeat, Trash2 } from "lucide-react";
import type { Ref } from "react";
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
import { recurrenceLabels, type Task } from "./types";

const priorityShort = { HIGH: "High", MEDIUM: "Med", LOW: "Low" } as const;

/** One task in the list: complete it in place, open it to edit, or delete it. */
export function TaskRow({
  task,
  now,
  highlighted,
  busy,
  onToggle,
  onOpen,
  onDelete,
  ref,
}: {
  task: Task;
  now: Date;
  highlighted: boolean;
  busy: boolean;
  onToggle: (task: Task) => void;
  onOpen: (task: Task) => void;
  onDelete: (task: Task) => void;
  ref?: Ref<HTMLLIElement>;
}) {
  const done = task.status === "DONE";
  const late = !done && Boolean(task.dueDate) && daysFrom(task.dueDate as string, now) < 0;

  return (
    <li
      ref={ref}
      id={`task-${task.id}`}
      className={cn(
        "flex items-center gap-2.5 border-t border-line px-3 py-2 first:border-t-0 sm:px-4",
        highlighted && "bg-accent-soft/60",
      )}
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        aria-label={done ? `Mark ${task.title} as not done` : `Complete ${task.title}`}
        disabled={busy}
        onClick={() => onToggle(task)}
        className={cn(
          "group grid h-4 w-4 shrink-0 place-items-center rounded border-[1.5px] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50",
          done ? "border-accent bg-accent text-accent-ink" : "border-muted hover:border-accent hover:bg-accent-soft",
        )}
      >
        <Check aria-hidden="true" className={cn("h-3 w-3", done ? "opacity-100" : "text-accent opacity-0 group-hover:opacity-100")} />
      </button>

      <button
        type="button"
        onClick={() => onOpen(task)}
        aria-label={task.title}
        aria-describedby={task.description ? `task-${task.id}-description` : undefined}
        className="min-w-0 flex-1 text-left"
      >
        <span className={cn("block truncate text-sm", done ? "text-muted line-through" : "hover:text-accent")}>{task.title}</span>
        {task.description ? (
          <span id={`task-${task.id}-description`} className="hidden truncate text-xs text-muted sm:block">
            {task.description}
          </span>
        ) : null}
      </button>

      {task.recurrence !== "NONE" ? (
        <span title={recurrenceLabels[task.recurrence]} className="hidden shrink-0 text-muted sm:inline">
          <Repeat aria-hidden="true" className="h-3.5 w-3.5" />
          <span className="sr-only">{recurrenceLabels[task.recurrence]}</span>
        </span>
      ) : null}
      {task.status === "IN_PROGRESS" ? (
        <span className="hidden shrink-0 rounded bg-accent-soft px-1.5 text-[10px] font-bold text-accent sm:inline">In progress</span>
      ) : null}
      <span
        className={cn(
          "shrink-0 rounded border px-1.5 text-[10px] font-bold",
          task.priority === "HIGH" && !done ? "border-danger/35 text-danger" : "border-line bg-canvas text-muted",
        )}
      >
        {priorityShort[task.priority]}
      </span>
      {task.project ? (
        <span className="hidden max-w-32 shrink-0 items-center gap-1.5 truncate text-xs text-muted md:inline-flex">
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
          className="hidden h-5 w-5 shrink-0 place-items-center rounded-full text-[9.5px] font-bold text-white sm:grid"
          style={{ backgroundColor: paletteColor(task.assignee.id) }}
        >
          <span aria-hidden="true">{task.assignee.name.charAt(0).toUpperCase()}</span>
          <span className="sr-only">Assigned to {task.assignee.name}</span>
        </span>
      ) : null}

      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`More actions for ${task.title}`}
          className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-muted outline-none hover:bg-surface-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-accent"
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
