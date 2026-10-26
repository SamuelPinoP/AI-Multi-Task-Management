"use client";

/**
 * Tasks: the list first, the form second (DES-02).
 *
 * - A one-line quick add and a "New task" sheet for full details.
 * - Search, status, priority, project and sort controls in one row.
 * - Tasks grouped into Overdue, Today, Upcoming, No due date and Done.
 * - Complete a task in place; open it to edit in a side sheet.
 * - `?task=<id>` opens that task (links from search, Home and the Planner).
 * - Subtasks live inside their parent's sheet; the row shows a progress ring,
 *   and "Blocked" while the task waits on open tasks (SMART-02).
 */

import { Plus, Search, SquareKanban } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { QuickAdd } from "@/components/home/quick-add";
import { TaskRow } from "@/components/tasks/task-row";
import type { TaskRelations } from "@/components/tasks/task-relations-panel";
import { TaskSheet } from "@/components/tasks/task-sheet";
import type { Priority, Project, Task, TaskInput, TaskStatus } from "@/components/tasks/types";
import { uiButtonClass, uiPrimaryButtonClass } from "@/components/ui";
import { toast } from "@/components/ui/toaster";
import { cn } from "@/lib/cn";
import { daysFrom } from "@/lib/home-summary";
import { compareTaskDueDates, formatTaskDueDateInput } from "@/lib/task-date-buckets";
import { topLevelTasks } from "@/lib/task-relations";
import { useRefreshOnReturn } from "@/lib/use-page-activity";
import { notifyWorkspaceChanged, TASK_CREATED_EVENT } from "@/lib/workspace-events";

type StatusFilter = "ALL" | "OPEN" | "DONE";
type SortOption = "DUE_DATE_ASC" | "DUE_DATE_DESC" | "NEWEST" | "OLDEST";
type SectionKey = "OVERDUE" | "TODAY" | "UPCOMING" | "NO_DATE" | "DONE";

const sectionTitles: Record<SectionKey, string> = {
  OVERDUE: "Overdue",
  TODAY: "Today",
  UPCOMING: "Upcoming",
  NO_DATE: "No due date",
  DONE: "Done",
};

const controlClass =
  "min-w-0 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/25";

function sectionFor(task: Task, now: Date): SectionKey {
  if (task.status === "DONE") return "DONE";
  if (!task.dueDate) return "NO_DATE";
  const diff = daysFrom(task.dueDate, now);
  return diff < 0 ? "OVERDUE" : diff === 0 ? "TODAY" : "UPCOMING";
}

/** The body the task API expects; it replaces every field. */
function taskBody(input: TaskInput) {
  return {
    title: input.title,
    description: input.description,
    status: input.status,
    priority: input.priority,
    dueDate: input.dueDate || null,
    recurrence: input.recurrence,
    projectId: input.projectId,
    assigneeId: input.projectId ? input.assigneeId : "",
  };
}

function inputFromTask(task: Task, overrides: Partial<TaskInput> = {}): TaskInput {
  return {
    title: task.title,
    description: task.description ?? "",
    status: task.status,
    priority: task.priority,
    dueDate: task.dueDate ? formatTaskDueDateInput(task.dueDate) : "",
    recurrence: task.recurrence,
    projectId: task.projectId ?? "",
    assigneeId: task.assignee?.id ?? task.assigneeId ?? "",
    ...overrides,
  };
}

async function errorMessage(response: Response, fallback: string) {
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? fallback;
}

export default function TasksPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const linkedTaskId = searchParams.get("task");

  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [fetching, setFetching] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [busyIds, setBusyIds] = useState<string[]>([]);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [priorityFilter, setPriorityFilter] = useState<"ALL" | Priority>("ALL");
  const [projectFilter, setProjectFilter] = useState("");
  const [sortBy, setSortBy] = useState<SortOption>("DUE_DATE_ASC");
  const [searchQuery, setSearchQuery] = useState("");

  const [sheet, setSheet] = useState<{ open: boolean; task: Task | null }>({ open: false, task: null });
  const [confirmDelete, setConfirmDelete] = useState<Task | null>(null);
  const [deleting, setDeleting] = useState(false);
  const linkedRowRef = useRef<HTMLLIElement | null>(null);

  async function fetchTasks(showLoading = true) {
    try {
      if (showLoading) setFetching(true);
      const response = await fetch("/api/tasks");
      if (!response.ok) throw new Error();
      setTasks((await response.json()) as Task[]);
      setLoadError("");
    } catch {
      setLoadError("Could not load tasks.");
    } finally {
      setFetching(false);
    }
  }

  async function fetchProjects() {
    try {
      const response = await fetch("/api/projects");
      if (response.ok) setProjects((await response.json()) as Project[]);
    } catch {
      // The project selects stay empty; tasks still load.
    }
  }

  useEffect(() => {
    async function loadInitialData() {
      await Promise.all([fetchTasks(), fetchProjects()]);
    }
    void loadInitialData();
  }, []);

  /** Refetch when the app shell's New task dialog adds a task. */
  useEffect(() => {
    const refresh = () => void fetchTasks(false);
    window.addEventListener(TASK_CREATED_EVENT, refresh);
    return () => window.removeEventListener(TASK_CREATED_EVENT, refresh);
  }, []);

  // Tasks assigned or changed on another device show up on coming back. An open
  // task keeps its edits: the sheet only resets its form for a different task.
  useRefreshOnReturn(() => {
    void Promise.all([fetchTasks(false), fetchProjects()]);
  });

  /** `?task=<id>`: clear the filters so the task is visible and open it. */
  const openLinkedTask = useEffectEvent((task: Task) => {
    setStatusFilter("ALL");
    setPriorityFilter("ALL");
    setProjectFilter("");
    setSearchQuery("");
    setSheet({ open: true, task });
  });

  useEffect(() => {
    if (!linkedTaskId || fetching) return;
    const task = tasks.find((item) => item.id === linkedTaskId);
    if (!task) return;
    const timer = window.setTimeout(() => {
      openLinkedTask(task);
      linkedRowRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fetching, linkedTaskId, tasks]);

  const visibleTasks = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    // Subtasks show inside their parent, except when searching.
    const filtered = (query ? tasks : topLevelTasks(tasks)).filter(
      (task) =>
        (!query || task.title.toLowerCase().includes(query) || (task.description ?? "").toLowerCase().includes(query)) &&
        (statusFilter === "ALL" || (statusFilter === "DONE") === (task.status === "DONE")) &&
        (priorityFilter === "ALL" || task.priority === priorityFilter) &&
        (!projectFilter || task.projectId === projectFilter),
    );
    return filtered.sort((a, b) => {
      if (sortBy === "NEWEST") return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      if (sortBy === "OLDEST") return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      const comparison = compareTaskDueDates(a.dueDate, b.dueDate);
      return sortBy === "DUE_DATE_ASC" ? comparison : -comparison;
    });
  }, [tasks, searchQuery, statusFilter, priorityFilter, projectFilter, sortBy]);

  const now = new Date();
  const groups: Record<SectionKey, Task[]> = { OVERDUE: [], TODAY: [], UPCOMING: [], NO_DATE: [], DONE: [] };
  for (const task of visibleTasks) groups[sectionFor(task, now)].push(task);
  const sections = (Object.keys(groups) as SectionKey[])
    .map((key) => ({ key, tasks: groups[key] }))
    .filter((section) => section.tasks.length);

  const openCount = tasks.filter((task) => task.status !== "DONE").length;
  const doneCount = tasks.length - openCount;
  const filtersActive = Boolean(searchQuery.trim()) || statusFilter !== "ALL" || priorityFilter !== "ALL" || Boolean(projectFilter);

  // The sheet follows the latest copy of its task, so subtasks and blockers update in place.
  const sheetTask = sheet.task ? (tasks.find((task) => task.id === sheet.task?.id) ?? sheet.task) : null;

  async function request(url: string, init: RequestInit, fallback: string) {
    try {
      const response = await fetch(url, { headers: { "Content-Type": "application/json" }, ...init });
      if (!response.ok) return errorMessage(response, fallback);
      notifyWorkspaceChanged();
      await fetchTasks(false);
      return null;
    } catch {
      return fallback;
    }
  }

  function relationsFor(task: Task): TaskRelations {
    const blockerIds = new Set((task.blockedBy ?? []).map((item) => item.blockedBy.id));
    const subtasks = tasks.filter((item) => item.parentId === task.id);
    const parent = task.parentId ? tasks.find((item) => item.id === task.parentId) : undefined;
    return {
      parent: parent ? { id: parent.id, title: parent.title, status: parent.status } : null,
      subtasks,
      blockers: (task.blockedBy ?? []).map((item) => item.blockedBy),
      candidates: tasks.filter(
        (item) => item.id !== task.id && item.status !== "DONE" && !blockerIds.has(item.id) && item.parentId !== task.id,
      ),
      onAddSubtask: (title) =>
        request("/api/tasks", { method: "POST", body: JSON.stringify({ title, parentId: task.id }) }, "Could not add the subtask."),
      onToggleSubtask: (subtask) => void toggleTask(subtask),
      onOpenTask: (id) => {
        const next = tasks.find((item) => item.id === id);
        if (next) setSheet({ open: true, task: next });
      },
      onAddBlocker: (id) =>
        request(`/api/tasks/${task.id}/dependencies`, { method: "POST", body: JSON.stringify({ blockedById: id }) }, "Could not add it."),
      onRemoveBlocker: (id) => request(`/api/tasks/${task.id}/dependencies/${id}`, { method: "DELETE" }, "Could not remove it."),
    };
  }

  function closeSheet(open: boolean) {
    setSheet((current) => ({ ...current, open }));
    // Drop ?task= so the sheet doesn't reopen on the next refetch.
    if (!open && linkedTaskId) router.replace(pathname, { scroll: false });
  }

  async function saveTask(input: TaskInput) {
    const editing = sheet.task;
    const response = await fetch(editing ? `/api/tasks/${editing.id}` : "/api/tasks", {
      method: editing ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(taskBody(input)),
    });
    if (!response.ok) return errorMessage(response, editing ? "Could not save the task." : "Could not create the task.");
    notifyWorkspaceChanged();
    await fetchTasks(false);
    toast.success(editing ? "Task saved" : "Task created", { description: input.title });
    return null;
  }

  async function toggleTask(task: Task) {
    const status: TaskStatus = task.status === "DONE" ? "TODO" : "DONE";
    setBusyIds((ids) => [...ids, task.id]);
    try {
      const response = await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(taskBody(inputFromTask(task, { status }))),
      });
      if (!response.ok) throw new Error(await errorMessage(response, "Could not update the task."));
      await response.json();
      // Refetch: the parent's progress ring and other tasks' "Blocked" badges may change too.
      await fetchTasks(false);
      notifyWorkspaceChanged();
      if (status === "DONE") toast.success("Task completed", { description: task.title });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update the task.");
    } finally {
      setBusyIds((ids) => ids.filter((id) => id !== task.id));
    }
  }

  async function deleteTask(task: Task) {
    setDeleting(true);
    try {
      const response = await fetch(`/api/tasks/${task.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await errorMessage(response, "Could not delete the task."));
      setTasks((current) => current.filter((item) => item.id !== task.id));
      notifyWorkspaceChanged();
      if (sheet.task?.id === task.id) closeSheet(false);
      toast.success("Moved to Trash", {
        description: task.title,
        action: { label: "Open Trash", onClick: () => router.push("/trash") },
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete the task.");
    } finally {
      setDeleting(false);
      setConfirmDelete(null);
    }
  }

  return (
    <div className="mx-auto grid w-full grid-cols-1 max-w-5xl gap-4 px-4 py-5 sm:px-6 lg:px-8 lg:py-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Tasks</h1>
          <p className="mt-0.5 text-sm text-muted">
            {fetching ? "Loading..." : `${openCount} open · ${doneCount} done`}
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/board" className={cn(uiButtonClass, "px-3 py-1.5")}>
            <SquareKanban aria-hidden="true" className="h-4 w-4 text-muted" />
            Board
          </Link>
          <button type="button" onClick={() => setSheet({ open: true, task: null })} className={cn(uiPrimaryButtonClass, "px-3 py-1.5")}>
            <Plus aria-hidden="true" className="h-4 w-4" />
            New task
          </button>
        </div>
      </header>

      <QuickAdd onAdded={() => void fetchTasks(false)} />

      <div className="flex flex-wrap items-center gap-2" role="search" aria-label="Filter tasks">
        <label className="relative flex min-w-48 flex-1 items-center">
          <span className="sr-only">Search tasks</span>
          <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 h-4 w-4 text-muted" />
          <input
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search tasks"
            className={cn(controlClass, "w-full pl-8")}
          />
        </label>
        <div role="radiogroup" aria-label="Status" className="flex rounded-lg border border-line bg-surface p-0.5">
          {(["ALL", "OPEN", "DONE"] as StatusFilter[]).map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={statusFilter === value}
              onClick={() => setStatusFilter(value)}
              className={cn(
                "rounded-md px-2.5 py-1 text-sm transition-colors",
                statusFilter === value ? "bg-accent-soft font-semibold text-accent" : "text-muted hover:text-ink",
              )}
            >
              {value === "ALL" ? "All" : value === "OPEN" ? "Open" : "Done"}
            </button>
          ))}
        </div>
        <div className="grid w-full grid-cols-3 gap-2 sm:flex sm:w-auto">
          <select aria-label="Priority" value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value as "ALL" | Priority)} className={controlClass}>
            <option value="ALL">Any priority</option>
            <option value="HIGH">High</option>
            <option value="MEDIUM">Medium</option>
            <option value="LOW">Low</option>
          </select>
          <select aria-label="Project" value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)} className={controlClass}>
            <option value="">All projects</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>{project.name}</option>
            ))}
          </select>
          <select aria-label="Sort" value={sortBy} onChange={(event) => setSortBy(event.target.value as SortOption)} className={controlClass}>
            <option value="DUE_DATE_ASC">Due soonest</option>
            <option value="DUE_DATE_DESC">Due latest</option>
            <option value="NEWEST">Newest</option>
            <option value="OLDEST">Oldest</option>
          </select>
        </div>
      </div>

      {loadError ? (
        <p role="alert" className="rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
          {loadError}{" "}
          <button type="button" onClick={() => void fetchTasks()} className="font-semibold underline">Try again</button>
        </p>
      ) : null}

      {fetching ? (
        <div className="grid gap-2" aria-busy="true" aria-label="Loading tasks">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="h-11 animate-pulse rounded-xl border border-line bg-surface" />
          ))}
        </div>
      ) : sections.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line bg-surface px-6 py-10 text-center">
          <h2 className="text-base font-semibold">{tasks.length === 0 ? "No tasks yet." : "No tasks match these filters."}</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted">
            {tasks.length === 0
              ? "Type one in the box above and press Enter, or use New task for the details."
              : "Clear the search or switch back to all tasks."}
          </p>
          {tasks.length !== 0 && filtersActive ? (
            <button
              type="button"
              onClick={() => {
                setSearchQuery("");
                setStatusFilter("ALL");
                setPriorityFilter("ALL");
                setProjectFilter("");
              }}
              className={cn(uiButtonClass, "mt-4 px-3 py-1.5")}
            >
              Clear filters
            </button>
          ) : null}
        </div>
      ) : (
        sections.map((section) => (
          <section key={section.key} aria-labelledby={`section-${section.key}`} className="rounded-xl border border-line bg-surface">
            <h2 id={`section-${section.key}`} className="flex items-center gap-2 px-3 pb-1 pt-3 text-sm font-semibold sm:px-4">
              <span className={section.key === "OVERDUE" ? "text-danger" : undefined}>{sectionTitles[section.key]}</span>
              <span className="text-xs font-normal text-muted">{section.tasks.length}</span>
            </h2>
            <ul>
              {section.tasks.map((task) => (
                <TaskRow
                  key={task.id}
                  ref={task.id === linkedTaskId ? linkedRowRef : undefined}
                  task={task}
                  now={now}
                  highlighted={task.id === linkedTaskId}
                  busy={busyIds.includes(task.id)}
                  onToggle={(item) => void toggleTask(item)}
                  onOpen={(item) => setSheet({ open: true, task: item })}
                  onDelete={setConfirmDelete}
                />
              ))}
            </ul>
          </section>
        ))
      )}

      <TaskSheet
        open={sheet.open}
        onOpenChange={closeSheet}
        task={sheetTask}
        projects={projects}
        onSubmit={saveTask}
        onDelete={setConfirmDelete}
        relations={sheetTask ? relationsFor(sheetTask) : undefined}
      />

      <ConfirmDialog
        open={Boolean(confirmDelete)}
        title="Delete this task?"
        message={confirmDelete ? `“${confirmDelete.title}” moves to Trash, where you can restore it.` : ""}
        loading={deleting}
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => {
          if (confirmDelete) void deleteTask(confirmDelete);
        }}
      />
    </div>
  );
}
