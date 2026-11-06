"use client";

import {
  ArrowLeft,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CircleCheck,
  CornerLeftUp,
  FileText,
  Link2,
  Lock,
  MoreHorizontal,
  Plus,
  Repeat,
  RotateCcw,
  Tag,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent, useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "@/components/ui/toaster";
import { cn } from "@/lib/cn";
import { labelsOfTask } from "@/lib/labels";
import { PRIORITY_MENU_ORDER, priorityLabels } from "@/lib/priority";
import { projectColor } from "@/lib/project-color";
import { formatTaskDueDateInput } from "@/lib/task-date-buckets";
import { TASK_TITLE_MAX } from "@/lib/task-history";
import { openBlockers, subtaskProgress } from "@/lib/task-relations";
import { notifyWorkspaceChanged } from "@/lib/workspace-events";
import { dueDayName, DueDatePicker } from "./due-date-picker";
import { LabelChip } from "./label-chip";
import { LabelPicker } from "./label-picker";
import { currentLabels, loadLabels, scopeKeyFor, useLabels } from "./label-store";
import { loadProjectMembers } from "./load-members";
import { MemberAvatar } from "./member-avatar";
import { PriorityBadge } from "./priority-badge";
import { PropertyPicker } from "./property-picker";
import { ProgressRing } from "./task-badges";
import { TaskActivity } from "./task-activity";
import { taskRequestBody } from "./task-sheet";
import { recurrenceLabels, statusLabels, type Member, type Project, type Recurrence, type RelatedTask, type Task, type TaskInput, type TaskStatus } from "./types";

type ProjectItem = Project & { accessLevel?: "OWNER" | "EDITOR" | "VIEWER"; status?: string };

/** The Tasks page keeps the order it showed, so a task page can step to the previous and next task. */
export const TASK_ORDER_KEY = "tasks:order";

const valueClass =
  "flex min-h-9 w-full min-w-0 items-center gap-2 rounded-lg px-2 text-left text-sm text-ink outline-none transition-colors hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default disabled:hover:bg-transparent";

function inputFromTask(task: Task): TaskInput {
  return {
    title: task.title,
    description: task.description ?? "",
    status: task.status,
    priority: task.priority,
    dueDate: task.dueDate ? formatTaskDueDateInput(task.dueDate) : "",
    recurrence: task.recurrence,
    projectId: task.projectId ?? "",
    assigneeId: task.assignee?.id ?? task.assigneeId ?? "",
  };
}

async function errorMessage(response: Response, fallback: string) {
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? fallback;
}

function StatusIcon({ status, className }: { status: TaskStatus; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid h-4 w-4 shrink-0 place-items-center rounded-full border-[1.5px]",
        status === "DONE" ? "border-success bg-success text-success-ink" : status === "IN_PROGRESS" ? "border-warning" : "border-muted",
        className,
      )}
    >
      {status === "DONE" ? <Check className="h-2.5 w-2.5" strokeWidth={3.5} /> : status === "IN_PROGRESS" ? <span className="h-1.5 w-1.5 rounded-full bg-warning" /> : null}
    </span>
  );
}

function Property({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[6rem_minmax(0,1fr)] items-start gap-1 py-0.5">
      <span className="pl-2 pt-2 text-[0.8125rem] text-muted">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

const noopSubscribe = () => () => {};

/**
 * A task as a page (#352, design 2A, as the owner chose it on November 6):
 * the title, description, sub-tasks and activity on the left; the properties
 * on the right, ending in a large green Mark done under "Blocked by", so
 * people always know where it is. On a phone the properties come right after
 * the title.
 */
export function TaskPageView({ initialTask, parent, canEdit }: { initialTask: Task; parent: RelatedTask | null; canEdit: boolean }) {
  const router = useRouter();
  const [task, setTask] = useState(initialTask);
  const [loadedId, setLoadedId] = useState(initialTask.id);
  const [title, setTitle] = useState(initialTask.title);
  const [description, setDescription] = useState(initialTask.description ?? "");
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [members, setMembers] = useState<{ projectId: string; list: Member[] } | null>(null);
  const [candidates, setCandidates] = useState<Task[] | null>(null);
  const [subtaskTitle, setSubtaskTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const allLabels = useLabels();

  // A new task page (the next task, a sub-task) starts from its own data.
  if (initialTask.id !== loadedId) {
    setLoadedId(initialTask.id);
    setTask(initialTask);
    setTitle(initialTask.title);
    setDescription(initialTask.description ?? "");
    setCandidates(null);
  }

  const done = task.status === "DONE";
  const isSubtask = Boolean(task.parentId);
  // Renames and new colors from "Edit labels…" show at once.
  const labels = labelsOfTask(task).map((label) => allLabels?.find((item) => item.id === label.id) ?? label);
  const progress = subtaskProgress(task.subtasks);
  const blockers = (task.blockedBy ?? []).map((row) => row.blockedBy);
  const waiting = done ? [] : openBlockers(task.blockedBy);
  const project = task.project ? (projects.find((item) => item.id === task.project?.id) ?? task.project) : null;
  const editableProjects = projects.filter((item) => item.accessLevel !== "VIEWER" && item.status !== "ARCHIVED");
  const memberList = task.projectId && members?.projectId === task.projectId ? members.list : [];

  // Previous and next follow the order the Tasks page last showed.
  const orderJson = useSyncExternalStore(
    noopSubscribe,
    () => {
      try {
        return window.sessionStorage.getItem(TASK_ORDER_KEY);
      } catch {
        return null;
      }
    },
    () => null,
  );
  const order = (() => {
    try {
      return orderJson ? (JSON.parse(orderJson) as string[]) : [];
    } catch {
      return [];
    }
  })();
  const position = order.indexOf(task.id);

  useEffect(() => {
    let cancelled = false;
    async function loadOptions() {
      const response = await fetch("/api/projects").catch(() => null);
      if (!cancelled && response?.ok) setProjects((await response.json()) as ProjectItem[]);
      await loadLabels();
    }
    void loadOptions();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const projectId = task.projectId;
    if (!projectId) return;
    let cancelled = false;
    void loadProjectMembers(projectId).then((list) => {
      if (!cancelled) setMembers({ projectId, list });
    });
    return () => {
      cancelled = true;
    };
  }, [task.projectId]);

  // Escape goes back to the list, unless a menu, dialog or field has it. A picker that
  // closed on this Escape is already gone from the page, but it marked the event as handled.
  const onKey = useEffectEvent((event: KeyboardEvent) => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('input, textarea, select, [contenteditable=true], [role="dialog"], [role="menu"]') || document.querySelector('[role="dialog"], [role="menu"]')) return;
    router.push("/tasks");
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKey(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  async function refresh() {
    const response = await fetch(`/api/tasks/${task.id}`, { cache: "no-store" });
    if (response.ok) setTask((await response.json()) as Task);
  }

  /** Saves one change; the API takes the whole task, so the rest is sent as it is. */
  async function save(change: Partial<TaskInput>, success?: string) {
    if (!canEdit) return false;
    setBusy(true);
    try {
      const response = await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(taskRequestBody({ ...inputFromTask(task), ...change })),
      });
      if (!response.ok) throw new Error(await errorMessage(response, "Could not save the change."));
      const updated = (await response.json()) as Task;
      setTask(updated);
      notifyWorkspaceChanged();
      if (success) toast.success(success, { description: updated.title });
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save the change.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  function saveTitle() {
    const next = title.replace(/\s+/g, " ").trim();
    if (!next) {
      setTitle(task.title);
      return;
    }
    if (next !== task.title) void save({ title: next });
  }

  function saveDescription() {
    if (description.trim() !== (task.description ?? "")) void save({ description: description.trim() });
  }

  async function setSubtaskStatus(subtask: RelatedTask) {
    const response = await fetch("/api/tasks/bulk", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [subtask.id], change: { status: subtask.status === "DONE" ? "TODO" : "DONE" } }),
    });
    if (!response.ok) toast.error(await errorMessage(response, "Could not update the sub-task."));
    await refresh();
  }

  async function addSubtask(event: FormEvent) {
    event.preventDefault();
    const next = subtaskTitle.trim();
    if (!next) return;
    const response = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: next, parentId: task.id }),
    });
    if (!response.ok) {
      toast.error(await errorMessage(response, "Could not add the sub-task."));
      return;
    }
    setSubtaskTitle("");
    notifyWorkspaceChanged();
    await refresh();
  }

  async function loadCandidates(open: boolean) {
    if (!open || candidates) return;
    const response = await fetch("/api/tasks", { cache: "no-store" });
    if (!response.ok) return;
    const all = (await response.json()) as Task[];
    const taken = new Set([task.id, ...blockers.map((blocker) => blocker.id)]);
    setCandidates(all.filter((item) => !taken.has(item.id) && item.status !== "DONE" && item.parentId !== task.id));
  }

  async function changeBlocker(id: string, add: boolean) {
    const response = await fetch(add ? `/api/tasks/${task.id}/dependencies` : `/api/tasks/${task.id}/dependencies/${id}`, {
      method: add ? "POST" : "DELETE",
      headers: { "Content-Type": "application/json" },
      body: add ? JSON.stringify({ blockedById: id }) : undefined,
    });
    if (!response.ok) toast.error(await errorMessage(response, add ? "Could not add it." : "Could not remove it."));
    setCandidates(null);
    await refresh();
  }

  async function deleteTask() {
    setBusy(true);
    const response = await fetch(`/api/tasks/${task.id}`, { method: "DELETE" });
    setBusy(false);
    setConfirmDelete(false);
    if (!response.ok) {
      toast.error(await errorMessage(response, "Could not delete the task."));
      return;
    }
    notifyWorkspaceChanged();
    toast.success("Moved to Trash", {
      description: task.title,
      action: {
        label: "Undo",
        onClick: () =>
          void fetch("/api/trash", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ type: "task", id: task.id }),
          }).then((restored) => {
            if (restored.ok) router.push(`/tasks/${task.id}`);
          }),
      },
    });
    router.push("/tasks");
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast.success("Link copied");
    } catch {
      toast.error("Could not copy the link.");
    }
  }

  return (
    <div className="min-h-full">
      <div className="sticky top-0 z-10 flex h-13 items-center gap-1.5 border-b border-line bg-canvas/95 px-3 backdrop-blur sm:px-5">
        <Link
          href="/tasks"
          aria-label="Back to Tasks"
          title="Back to Tasks (Esc)"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted outline-none hover:bg-surface-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-accent"
        >
          <ArrowLeft aria-hidden="true" className="h-4 w-4" />
        </Link>
        <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-[0.8125rem] text-muted">
          <Link href="/tasks" className="shrink-0 hover:text-ink">
            Tasks
          </Link>
          {project ? (
            <>
              <ChevronRight aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
              <Link href={`/projects/${project.id}`} className="hidden min-w-0 items-center gap-1.5 hover:text-ink sm:inline-flex">
                <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-[3px]" style={{ backgroundColor: projectColor(project) }} />
                <span className="truncate">{project.name}</span>
              </Link>
            </>
          ) : null}
          {parent ? (
            <>
              <ChevronRight aria-hidden="true" className="hidden h-3.5 w-3.5 shrink-0 sm:block" />
              <Link href={`/tasks/${parent.id}`} className="hidden max-w-40 truncate hover:text-ink md:inline">
                {parent.title}
              </Link>
            </>
          ) : null}
          <ChevronRight aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
          <span aria-current="page" className="min-w-0 truncate font-medium text-ink">
            {task.title}
          </span>
        </nav>
        <span className="flex-1" />
        {position >= 0 && order.length > 1 ? (
          <div className="hidden items-center sm:flex">
            <span className="px-1.5 font-mono text-xs tabular-nums text-muted">
              {position + 1} / {order.length}
            </span>
            <Link
              href={position > 0 ? `/tasks/${order[position - 1]}` : "#"}
              aria-label="Previous task"
              aria-disabled={position === 0}
              className={cn("grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-surface-hover hover:text-ink", position === 0 && "pointer-events-none opacity-40")}
            >
              <ChevronUp aria-hidden="true" className="h-4 w-4" />
            </Link>
            <Link
              href={position < order.length - 1 ? `/tasks/${order[position + 1]}` : "#"}
              aria-label="Next task"
              aria-disabled={position === order.length - 1}
              className={cn("grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-surface-hover hover:text-ink", position === order.length - 1 && "pointer-events-none opacity-40")}
            >
              <ChevronDown aria-hidden="true" className="h-4 w-4" />
            </Link>
          </div>
        ) : null}
        <Link
          href={`/events/calendar?task=${task.id}`}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 text-[0.8125rem] font-medium outline-none hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent"
        >
          <CalendarDays aria-hidden="true" className="h-4 w-4 text-muted" />
          <span className="sr-only sm:not-sr-only">Show in calendar</span>
        </Link>
        <button
          type="button"
          onClick={() => void copyLink()}
          aria-label="Copy link"
          title="Copy link"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted outline-none hover:bg-surface-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-accent"
        >
          <Link2 aria-hidden="true" className="h-4 w-4" />
        </button>
        {canEdit ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label="More actions"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted outline-none hover:bg-surface-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-accent"
            >
              <MoreHorizontal aria-hidden="true" className="h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setConfirmDelete(true)} className="text-danger [&_svg]:text-danger">
                <Trash2 />
                Delete task
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-x-10 gap-y-6 px-4 py-6 sm:px-8 lg:grid-cols-[minmax(0,1fr)_19rem] lg:py-9">
        <div className="lg:col-start-1 lg:row-start-1">
          <label htmlFor="task-title" className="sr-only">
            Title
          </label>
          <textarea
            id="task-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onBlur={saveTitle}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                event.currentTarget.blur();
              }
            }}
            readOnly={!canEdit}
            rows={1}
            maxLength={TASK_TITLE_MAX}
            className={cn(
              "block w-full resize-none overflow-hidden bg-transparent text-[1.625rem] font-semibold leading-tight tracking-[-0.015em] text-ink outline-none [field-sizing:content] placeholder:text-muted focus:rounded-lg focus:ring-2 focus:ring-accent/25",
              done && "text-muted line-through",
            )}
          />
          {!canEdit ? <p className="mt-2 text-xs text-muted">You can view this task; only its project&rsquo;s editors can change it.</p> : null}
          {parent || task.noteId ? (
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.8125rem]">
              {parent ? (
                <Link href={`/tasks/${parent.id}`} className="inline-flex min-w-0 items-center gap-1.5 text-muted hover:text-accent">
                  <CornerLeftUp aria-hidden="true" className="h-4 w-4 shrink-0" />
                  <span className="truncate">Sub-task of {parent.title}</span>
                </Link>
              ) : null}
              {task.noteId ? (
                <Link href={`/notes?openNote=${task.noteId}&focus=content`} className="inline-flex items-center gap-1.5 font-medium text-accent hover:underline">
                  <FileText aria-hidden="true" className="h-4 w-4" />
                  Open the note this task came from
                </Link>
              ) : null}
            </div>
          ) : null}
        </div>

        <aside aria-label="Properties" className="lg:col-start-2 lg:row-span-2 lg:row-start-1">
          <div className="rounded-xl border border-line bg-surface p-2 shadow-card lg:sticky lg:top-20">
            <p className="px-2 pb-1 pt-1.5 text-xs font-semibold uppercase tracking-wider text-muted">Properties</p>
            <Property label="Status">
              <PropertyPicker
                label="Change status"
                value={task.status}
                options={(Object.keys(statusLabels) as TaskStatus[]).map((status) => ({ value: status, label: statusLabels[status], icon: <StatusIcon status={status} /> }))}
                onSelect={(status) => void save({ status })}
              >
                <button type="button" disabled={!canEdit || busy} className={valueClass} aria-label={`Status: ${statusLabels[task.status]}`}>
                  <StatusIcon status={task.status} />
                  {statusLabels[task.status]}
                </button>
              </PropertyPicker>
            </Property>
            <Property label="Priority">
              <PropertyPicker
                label="Change priority"
                value={task.priority}
                options={PRIORITY_MENU_ORDER.map((priority) => ({ value: priority, label: priorityLabels[priority] }))}
                onSelect={(priority) => void save({ priority })}
              >
                <button type="button" disabled={!canEdit || busy} className={valueClass} aria-label={`Priority: ${priorityLabels[task.priority]}`}>
                  {task.priority === "NONE" ? <span className="text-muted">No priority</span> : <PriorityBadge priority={task.priority} className="text-xs" />}
                </button>
              </PropertyPicker>
            </Property>
            <Property label="Assignee">
              <PropertyPicker
                label="Assign to"
                heading={project ? `Members of ${project.name}` : undefined}
                value={task.assignee?.id ?? ""}
                options={[
                  { value: "", label: "Unassigned", icon: <UserRound /> },
                  ...memberList.map((member) => ({ value: member.id, label: member.name, icon: <MemberAvatar id={member.id} name={member.name} /> })),
                ]}
                onSelect={(id) => {
                  const member = memberList.find((item) => item.id === id);
                  void save({ assigneeId: id }, member ? `Assigned to ${member.name}` : undefined);
                }}
              >
                <button
                  type="button"
                  disabled={!canEdit || busy || !task.projectId}
                  title={task.projectId ? undefined : "Add the task to a project to assign it"}
                  className={valueClass}
                  // With an assignee the text names it: axe counts the avatar's hidden initial as visible text.
                  aria-label={task.assignee ? undefined : `Assignee: ${task.projectId ? "Unassigned" : "Needs a project"}`}
                >
                  {task.assignee ? (
                    <>
                      <span className="sr-only">Assignee: </span>
                      <MemberAvatar id={task.assignee.id} name={task.assignee.name} />
                      <span className="truncate">{task.assignee.name}</span>
                    </>
                  ) : (
                    <span className="flex items-center gap-2 text-muted">
                      <UserRound aria-hidden="true" className="h-4 w-4" />
                      {task.projectId ? "Unassigned" : "Needs a project"}
                    </span>
                  )}
                </button>
              </PropertyPicker>
            </Property>
            <Property label="Labels">
              <div className="flex flex-wrap items-center gap-1 px-1 py-1">
                {labels.map((label) => (
                  <LabelChip key={label.id} label={label} />
                ))}
                {canEdit ? (
                  <LabelPicker
                    scope={scopeKeyFor(task.projectId)}
                    scopeName={project?.name ?? "Personal"}
                    selectedIds={labels.map((label) => label.id)}
                    onChange={(ids) => {
                      // Drop labels deleted under "Edit labels…". Read the store now, not this render's
                      // copy: a label created in the picker joins the store just before this runs.
                      const known = currentLabels();
                      void save({ labelIds: ids.filter((id) => !known || known.some((label) => label.id === id)) });
                    }}
                  >
                    <button
                      type="button"
                      aria-label={labels.length ? "Change labels" : "Add labels"}
                      className="inline-flex h-7 items-center gap-1 rounded-full border border-dashed border-line px-2 text-xs text-muted outline-none hover:border-accent hover:text-accent focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      {labels.length ? <Plus aria-hidden="true" className="h-3.5 w-3.5" /> : <Tag aria-hidden="true" className="h-3.5 w-3.5" />}
                      {labels.length ? null : "Add labels"}
                    </button>
                  </LabelPicker>
                ) : labels.length ? null : (
                  <span className="px-1 text-sm text-muted">None</span>
                )}
              </div>
            </Property>
            <Property label="Project">
              <PropertyPicker
                label="Move to project"
                value={task.projectId ?? ""}
                options={[
                  { value: "", label: "No project", icon: <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full border-[1.5px] border-dashed border-muted" /> },
                  ...editableProjects.map((item) => ({
                    value: item.id,
                    label: item.name,
                    icon: <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: projectColor(item) }} />,
                  })),
                ]}
                onSelect={(id) => {
                  const item = editableProjects.find((candidate) => candidate.id === id);
                  // A task's assignee and labels belong to its project, so they reset when it moves.
                  void save({ projectId: id, assigneeId: "", labelIds: [] }, item ? `Moved to ${item.name}` : undefined);
                }}
              >
                <button
                  type="button"
                  disabled={!canEdit || busy || isSubtask}
                  title={isSubtask ? "A sub-task stays in its parent's project" : undefined}
                  className={valueClass}
                  aria-label={`Project: ${project?.name ?? "Add project"}`}
                >
                  {project ? (
                    <>
                      <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: projectColor(project) }} />
                      <span className="truncate">{project.name}</span>
                    </>
                  ) : (
                    <span className="text-muted">Add project</span>
                  )}
                </button>
              </PropertyPicker>
            </Property>
            <Property label="Due date">
              <DueDatePicker
                value={task.dueDate ? formatTaskDueDateInput(task.dueDate) : ""}
                onChange={(key) => void save({ dueDate: key ?? "" })}
                disabled={!canEdit || busy}
              >
                {/* Without a date the button's own text, "Add due date", names it. */}
                <button type="button" className={valueClass} aria-label={task.dueDate ? `Due date: ${dueDayName(formatTaskDueDateInput(task.dueDate))}` : undefined}>
                  <CalendarDays aria-hidden="true" className="h-4 w-4 text-muted" />
                  {task.dueDate ? dueDayName(formatTaskDueDateInput(task.dueDate)) : <span className="text-muted">Add due date</span>}
                </button>
              </DueDatePicker>
            </Property>
            <Property label="Repeats">
              <PropertyPicker
                label="Repeat"
                value={task.recurrence}
                options={(Object.keys(recurrenceLabels) as Recurrence[]).map((recurrence) => ({ value: recurrence, label: recurrenceLabels[recurrence] }))}
                onSelect={(recurrence) => void save({ recurrence })}
              >
                <button type="button" disabled={!canEdit || busy} className={valueClass} aria-label={`Repeats: ${recurrenceLabels[task.recurrence]}`}>
                  <Repeat aria-hidden="true" className="h-4 w-4 text-muted" />
                  <span className={cn(task.recurrence === "NONE" && "text-muted")}>{recurrenceLabels[task.recurrence]}</span>
                </button>
              </PropertyPicker>
            </Property>
            <Property label="Blocked by">
              <div className="grid gap-0.5 py-0.5">
                {blockers.map((blocker) => (
                  <div key={blocker.id} className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm">
                    <StatusIcon status={blocker.status} />
                    <Link href={`/tasks/${blocker.id}`} className={cn("min-w-0 flex-1 truncate hover:text-accent", blocker.status === "DONE" && "text-muted line-through")}>
                      {blocker.title}
                    </Link>
                    {canEdit ? (
                      <button
                        type="button"
                        onClick={() => void changeBlocker(blocker.id, false)}
                        aria-label={`Stop waiting on ${blocker.title}`}
                        className="grid h-6 w-6 shrink-0 place-items-center rounded text-muted hover:bg-surface-hover hover:text-ink"
                      >
                        <X aria-hidden="true" className="h-3.5 w-3.5" />
                      </button>
                    ) : null}
                  </div>
                ))}
                {canEdit ? (
                  <Popover onOpenChange={(open) => void loadCandidates(open)}>
                    <PopoverTrigger asChild>
                      <button type="button" className={cn(valueClass, "text-muted")}>
                        <Lock aria-hidden="true" className="h-4 w-4" />
                        {blockers.length ? "Add another" : "Add a task"}
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-72 p-0">
                      <Command loop label="Find a task this one waits on">
                        <CommandInput placeholder="Find a task…" className="h-10" />
                        <CommandList className="max-h-64 p-1">
                          <CommandEmpty className="py-4">{candidates ? "No open task matches." : "Loading tasks…"}</CommandEmpty>
                          {(candidates ?? []).map((candidate) => (
                            <CommandItem key={candidate.id} value={`${candidate.title} ${candidate.id}`} onSelect={() => void changeBlocker(candidate.id, true)}>
                              <StatusIcon status={candidate.status} />
                              <span className="min-w-0 flex-1 truncate">{candidate.title}</span>
                            </CommandItem>
                          ))}
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                ) : blockers.length ? null : (
                  <span className="px-2 py-1.5 text-sm text-muted">Nothing</span>
                )}
                {waiting.length ? <p className="px-2 text-xs text-caution">Waiting on {waiting.length} open task{waiting.length === 1 ? "" : "s"}.</p> : null}
              </div>
            </Property>

            {/* The owner asked for a big, very green Mark done under "Blocked by": hard to miss, always in the same place. */}
            {canEdit ? (
              <button
                type="button"
                onClick={() => void save({ status: done ? "TODO" : "DONE" }, done ? "Task reopened" : "Task completed")}
                disabled={busy}
                aria-pressed={done}
                className={cn(
                  "mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-xl text-base font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:opacity-70",
                  done
                    ? "border-2 border-success bg-success-soft text-success hover:bg-success/15"
                    : "bg-success text-success-ink shadow-[0_8px_20px_-8px_var(--success)] hover:bg-success/90",
                )}
              >
                {done ? <RotateCcw aria-hidden="true" className="h-5 w-5" /> : <CircleCheck aria-hidden="true" className="h-5 w-5" />}
                {done ? "Done · Reopen" : "Mark done"}
              </button>
            ) : (
              <p className="mt-3 rounded-xl bg-sunken px-3 py-2.5 text-center text-sm text-muted">{statusLabels[task.status]}</p>
            )}
          </div>
        </aside>

        <div className="grid content-start gap-8 lg:col-start-1 lg:row-start-2">
          <div>
            <label htmlFor="task-description" className="sr-only">
              Description
            </label>
            <textarea
              id="task-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              onBlur={saveDescription}
              readOnly={!canEdit}
              placeholder={canEdit ? "Add a description…" : "No description."}
              rows={3}
              className="block min-h-24 w-full resize-y rounded-lg bg-transparent text-[0.9375rem] leading-7 text-ink outline-none [field-sizing:content] placeholder:text-muted focus:ring-2 focus:ring-accent/25"
            />
          </div>

          {!isSubtask ? (
            <section aria-labelledby="subtasks-heading" className="grid gap-2">
              <h2 id="subtasks-heading" className="flex items-center gap-2 text-sm font-semibold">
                Sub-tasks
                {progress.total ? <ProgressRing done={progress.done} total={progress.total} /> : null}
              </h2>
              {task.subtasks?.length ? (
                <ul className="overflow-hidden rounded-xl border border-line bg-surface">
                  {task.subtasks.map((subtask) => (
                    <li key={subtask.id} className="flex min-h-11 items-center gap-2.5 border-t border-line px-2 first:border-t-0">
                      <button
                        type="button"
                        onClick={() => void setSubtaskStatus(subtask)}
                        disabled={!canEdit}
                        aria-pressed={subtask.status === "DONE"}
                        aria-label={`${subtask.status === "DONE" ? "Done" : "Mark done"}: ${subtask.title}`}
                        className="grid h-8 w-8 place-items-center rounded-lg outline-none hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent"
                      >
                        <StatusIcon status={subtask.status} />
                      </button>
                      <Link href={`/tasks/${subtask.id}`} className={cn("min-w-0 flex-1 truncate text-sm hover:text-accent", subtask.status === "DONE" && "text-muted line-through")}>
                        {subtask.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : null}
              {canEdit ? (
                <form onSubmit={addSubtask} className="flex items-center gap-2">
                  <label htmlFor="new-subtask" className="sr-only">
                    Add a sub-task
                  </label>
                  <input
                    id="new-subtask"
                    value={subtaskTitle}
                    onChange={(event) => setSubtaskTitle(event.target.value)}
                    maxLength={TASK_TITLE_MAX}
                    placeholder="Add a sub-task and press Enter"
                    className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none placeholder:text-muted focus:border-accent focus:ring-2 focus:ring-accent/25"
                  />
                </form>
              ) : null}
            </section>
          ) : null}

          <TaskActivity key={task.id} taskId={task.id} refreshKey={task.updatedAt} />
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete this task?"
        message={`“${task.title}” moves to Trash, where you can restore it.`}
        loading={busy}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => void deleteTask()}
      />
    </div>
  );
}
