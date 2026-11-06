"use client";

import { CalendarDays, Check, CircleCheck, Flag, FolderInput, Minus, Tag, Trash2, UserRound, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/cn";
import { labelsOfTask, type Label } from "@/lib/labels";
import { PRIORITY_MENU_ORDER, priorityLabels } from "@/lib/priority";
import { projectColor } from "@/lib/project-color";
import type { BulkTaskChange } from "@/lib/task-bulk";
import { formatTaskDayKey } from "@/lib/task-date-buckets";
import { labelsInScope, scopeKeyFor } from "./label-store";
import { loadProjectMembers } from "./load-members";
import type { Member, Task } from "./types";

type ProjectOption = { id: string; name: string; color: string | null };

/** Names for the toast, such as the project or person picked. */
export type BulkNames = { project?: string; assignee?: string; label?: string; due?: string };

const buttonClass =
  "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2 text-[0.8125rem] font-medium text-ink outline-none transition-colors hover:bg-surface focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50 sm:px-2.5 [&_svg]:h-4 [&_svg]:w-4 [&_svg]:shrink-0";

function BarButton({ icon, children, className, ...props }: { icon: ReactNode; children: ReactNode } & React.ComponentProps<"button">) {
  return (
    <button type="button" className={cn(buttonClass, className)} {...props}>
      {icon}
      <span className="sr-only md:not-sr-only">{children}</span>
    </button>
  );
}

function dayFromToday(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return formatTaskDayKey(date);
}

function nextMonday() {
  const date = new Date();
  date.setDate(date.getDate() + (((8 - date.getDay()) % 7) || 7));
  return formatTaskDayKey(date);
}

function dueName(key: string) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

/**
 * The bar that replaces the filters while tasks are selected (#281, design
 * 1B): mark them done, set their priority, labels, project, due date or
 * assignee, or move them to the Trash. Every change is one request.
 */
export function BulkBar({
  tasks,
  projects,
  labels,
  busy,
  onClear,
  onChange,
  onDelete,
}: {
  /** The selected tasks. */
  tasks: Task[];
  /** Projects the user can add tasks to. */
  projects: ProjectOption[];
  /** Every label the user can see. */
  labels: readonly Label[];
  busy: boolean;
  onClear: () => void;
  onChange: (change: BulkTaskChange, names?: BulkNames) => void;
  onDelete: () => void;
}) {
  const [members, setMembers] = useState<{ projectId: string; list: Member[] } | null>(null);
  const [dateInput, setDateInput] = useState("");
  const [dueOpen, setDueOpen] = useState(false);

  const count = tasks.length;
  const allDone = tasks.every((task) => task.status === "DONE");
  // Labels and assignees belong to one project (or to the owner's personal set), so they need one shared scope.
  const scopes = new Set(tasks.map((task) => scopeKeyFor(task.projectId)));
  const scope = scopes.size === 1 ? [...scopes][0] : null;
  const projectIds = new Set(tasks.map((task) => task.projectId ?? ""));
  const sharedProjectId = projectIds.size === 1 ? [...projectIds][0] : "";
  const scopeLabels = scope ? labelsInScope(labels, scope) : [];
  const hasSubtasks = tasks.some((task) => task.parentId);

  function loadMembers(open: boolean) {
    if (!open || !sharedProjectId || members?.projectId === sharedProjectId) return;
    void loadProjectMembers(sharedProjectId).then((list) => setMembers({ projectId: sharedProjectId, list }));
  }

  function toggleLabel(label: Label) {
    const withIt = tasks.filter((task) => labelsOfTask(task).some((item) => item.id === label.id)).length;
    if (withIt === count) onChange({ removeLabelIds: [label.id] }, { label: label.name });
    else onChange({ addLabelIds: [label.id] }, { label: label.name });
  }

  function setDue(key: string | null) {
    setDueOpen(false);
    setDateInput("");
    onChange({ dueDate: key }, key ? { due: dueName(key) } : {});
  }

  return (
    <div
      role="toolbar"
      aria-label="Selected tasks"
      className="flex min-h-11 w-full items-center gap-0.5 overflow-x-auto rounded-xl border border-accent/60 bg-accent-soft px-1.5 py-1"
    >
      <button
        type="button"
        onClick={onClear}
        aria-label="Clear the selection"
        className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-accent outline-none hover:bg-surface focus-visible:ring-2 focus-visible:ring-accent"
      >
        <X aria-hidden="true" className="h-4 w-4" />
      </button>
      <span aria-live="polite" className="shrink-0 whitespace-nowrap pl-0.5 pr-2 text-sm font-semibold text-accent">
        {count} selected
      </span>
      <span aria-hidden="true" className="mx-1 h-5 w-px shrink-0 bg-accent/30" />

      <BarButton
        icon={<CircleCheck />}
        disabled={busy}
        onClick={() => onChange({ status: allDone ? "TODO" : "DONE" })}
        className={allDone ? undefined : "text-success"}
      >
        {allDone ? "Mark active" : "Mark done"}
      </BarButton>

      <DropdownMenu>
        <DropdownMenuTrigger asChild disabled={busy}>
          <BarButton icon={<Flag />}>Priority</BarButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {PRIORITY_MENU_ORDER.map((priority) => (
            <DropdownMenuItem key={priority} onSelect={() => onChange({ priority })}>
              {priorityLabels[priority]}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <Popover>
        <PopoverTrigger asChild disabled={busy || !scope}>
          <BarButton icon={<Tag />} title={scope ? undefined : "Pick tasks from one project to label them together"}>
            Labels
          </BarButton>
        </PopoverTrigger>
        <PopoverContent className="w-60 p-1">
          {scopeLabels.length ? (
            <ul aria-label="Labels" className="grid">
              {scopeLabels.map((label) => {
                const withIt = tasks.filter((task) => labelsOfTask(task).some((item) => item.id === label.id)).length;
                const state = withIt === count ? "all" : withIt ? "some" : "none";
                return (
                  <li key={label.id}>
                    <button
                      type="button"
                      onClick={() => toggleLabel(label)}
                      aria-pressed={state === "all" ? true : state === "some" ? "mixed" : false}
                      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm outline-none hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      <span
                        aria-hidden="true"
                        className={cn(
                          "grid h-4 w-4 shrink-0 place-items-center rounded border-[1.5px]",
                          state === "none" ? "border-muted" : "border-accent bg-accent text-accent-ink",
                        )}
                      >
                        {state === "all" ? <Check className="h-3 w-3" /> : state === "some" ? <Minus className="h-3 w-3" /> : null}
                      </span>
                      <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: label.color }} />
                      <span className="min-w-0 flex-1 truncate">{label.name}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="px-2.5 py-3 text-sm text-muted">No labels here yet. Add them from a task first.</p>
          )}
        </PopoverContent>
      </Popover>

      <DropdownMenu>
        <DropdownMenuTrigger asChild disabled={busy || hasSubtasks}>
          <BarButton icon={<FolderInput />} title={hasSubtasks ? "Sub-tasks stay in their parent's project" : undefined}>
            Project
          </BarButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
          <DropdownMenuItem onSelect={() => onChange({ projectId: null })}>
            <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full border-[1.5px] border-dashed border-muted" />
            No project
          </DropdownMenuItem>
          {projects.length ? <DropdownMenuSeparator /> : null}
          {projects.map((project) => (
            <DropdownMenuItem key={project.id} onSelect={() => onChange({ projectId: project.id }, { project: project.name })}>
              <span aria-hidden="true" className="h-2.5 w-2.5 rounded-[3px]" style={{ backgroundColor: projectColor(project) }} />
              {project.name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <Popover open={dueOpen} onOpenChange={setDueOpen}>
        <PopoverTrigger asChild disabled={busy}>
          <BarButton icon={<CalendarDays />}>Due date</BarButton>
        </PopoverTrigger>
        <PopoverContent className="w-60 p-1">
          {[
            ["Today", dayFromToday(0)],
            ["Tomorrow", dayFromToday(1)],
            ["Next week", nextMonday()],
          ].map(([name, key]) => (
            <button
              key={name}
              type="button"
              onClick={() => setDue(key)}
              className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-sm outline-none hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent"
            >
              {name}
              <span className="text-xs text-muted">{dueName(key)}</span>
            </button>
          ))}
          <form
            className="flex items-center gap-1.5 border-t border-line px-1.5 pb-1 pt-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (dateInput) setDue(dateInput);
            }}
          >
            <label className="sr-only" htmlFor="bulk-due-date">
              Pick a date
            </label>
            <input
              id="bulk-due-date"
              type="date"
              value={dateInput}
              onChange={(event) => setDateInput(event.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-2 py-1 text-sm text-ink outline-none focus:border-accent"
            />
            <button type="submit" disabled={!dateInput} className="rounded-lg bg-accent px-2.5 py-1 text-sm font-medium text-accent-ink disabled:opacity-50">
              Set
            </button>
          </form>
          <button
            type="button"
            onClick={() => setDue(null)}
            className="mt-1 flex w-full items-center rounded-lg px-2.5 py-1.5 text-left text-sm text-muted outline-none hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent"
          >
            No due date
          </button>
        </PopoverContent>
      </Popover>

      <DropdownMenu onOpenChange={loadMembers}>
        <DropdownMenuTrigger asChild disabled={busy || !sharedProjectId}>
          <BarButton icon={<UserRound />} title={sharedProjectId ? undefined : "Pick tasks from one project to assign them"}>
            Assignee
          </BarButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel>{members?.projectId === sharedProjectId ? "Assign to" : "Loading members…"}</DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => onChange({ assigneeId: null })}>Unassigned</DropdownMenuItem>
          {(members?.projectId === sharedProjectId ? members.list : []).map((member) => (
            <DropdownMenuItem key={member.id} onSelect={() => onChange({ assigneeId: member.id }, { assignee: member.name })}>
              {member.name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <span aria-hidden="true" className="ml-auto" />
      <BarButton icon={<Trash2 />} disabled={busy} onClick={onDelete} className="text-danger hover:bg-danger-soft">
        Delete
      </BarButton>
    </div>
  );
}
