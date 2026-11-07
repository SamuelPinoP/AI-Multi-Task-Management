"use client";

/**
 * Tasks: the list first, the form second (DES-02).
 *
 * - A one-line quick add and a "New task" sheet for full details.
 * - All, Active and Done beside the title; search, priority, labels, project
 *   and sort in one row, which turns into the bulk bar while tasks are selected.
 * - One card per project (design 1B, #348): tasks with no project first, then
 *   projects by priority, ties in the sidebar's order. Inside a card, tasks
 *   are grouped into Overdue, Today, Upcoming, No due date and Done.
 * - Each card links to its project's Calendar and Notes; "No project" moves
 *   its tasks into a project.
 * - Mark done completes a task in place; open it to edit in a side sheet.
 * - `?task=<id>` opens that task (links from search, Home and the Planner).
 * - Subtasks live inside their parent's sheet; the row shows a progress ring,
 *   and "Blocked" while the task waits on open tasks (SMART-02).
 */

import { CalendarDays, ChevronDown, NotebookText, Plus, Search } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { QuickAdd } from "@/components/home/quick-add";
import { BulkBar, type BulkNames } from "@/components/tasks/bulk-bar";
import { PriorityBadge } from "@/components/tasks/priority-badge";
import { LabelFilter } from "@/components/tasks/label-filter";
import { loadLabels, useLabels } from "@/components/tasks/label-store";
import { TaskRow } from "@/components/tasks/task-row";
import { TASK_ORDER_KEY } from "@/components/tasks/task-page-view";
import { taskRequestBody } from "@/components/tasks/task-sheet";
import type { Priority, Project, Task, TaskInput, TaskStatus } from "@/components/tasks/types";
import { uiButtonClass, uiPrimaryButtonClass } from "@/components/ui";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "@/components/ui/toaster";
import { cn } from "@/lib/cn";
import { daysFrom } from "@/lib/home-summary";
import { labelsOfTask, matchesLabelFilter } from "@/lib/labels";
import { comparePriority, PRIORITIES, priorityLabels } from "@/lib/priority";
import { projectColor } from "@/lib/project-color";
import { describeBulkChange, type BulkTaskChange, type TaskSnapshot } from "@/lib/task-bulk";
import { compareTaskDueDates, formatTaskDueDateInput } from "@/lib/task-date-buckets";
import { topLevelTasks } from "@/lib/task-relations";
import { useRefreshOnReturn } from "@/lib/use-page-activity";
import { notifyWorkspaceChanged, openNewTask, TASK_CREATED_EVENT } from "@/lib/workspace-events";

/** A project from /api/projects, with the caller's access. */
type ProjectItem = Project & { accessLevel?: "OWNER" | "EDITOR" | "VIEWER"; status?: string; updatedAt?: string };

type StatusFilter = "ALL" | "OPEN" | "DONE";
type SortOption = "DUE_DATE_ASC" | "DUE_DATE_DESC" | "NEWEST" | "OLDEST";
type SectionKey = "OVERDUE" | "TODAY" | "UPCOMING" | "NO_DATE" | "DONE";

const SECTION_ORDER: SectionKey[] = ["OVERDUE", "TODAY", "UPCOMING", "NO_DATE", "DONE"];

const statusTabs: [StatusFilter, string][] = [
  ["ALL", "All"],
  ["OPEN", "Active"],
  ["DONE", "Done"],
];

const headerLinkClass =
  "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2 text-[0.8125rem] font-medium text-muted outline-none transition-colors hover:bg-surface hover:text-accent focus-visible:ring-2 focus-visible:ring-accent";

const sectionTitles: Record<SectionKey, string> = {
  OVERDUE: "Overdue",
  TODAY: "Today",
  UPCOMING: "Upcoming",
  NO_DATE: "No due date",
  DONE: "Done",
};

const controlClass =
  "min-w-0 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/25";

/** The priority, project and sort filters: at least 8.5rem each on phones, sized to their labels from 640px. */
const filterClass = `${controlClass} flex-1 basis-34 sm:flex-none sm:basis-auto`;

function sectionFor(task: Task, now: Date): SectionKey {
  if (task.status === "DONE") return "DONE";
  if (!task.dueDate) return "NO_DATE";
  const diff = daysFrom(task.dueDate, now);
  return diff < 0 ? "OVERDUE" : diff === 0 ? "TODAY" : "UPCOMING";
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
  const searchParams = useSearchParams();
  const linkedTaskId = searchParams.get("task");

  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [fetching, setFetching] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [busyIds, setBusyIds] = useState<string[]>([]);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [priorityFilter, setPriorityFilter] = useState<"ALL" | Priority>("ALL");
  const [projectFilter, setProjectFilter] = useState("");
  const [labelFilter, setLabelFilter] = useState<Set<string>>(() => new Set());
  const labels = useLabels();
  const [sortBy, setSortBy] = useState<SortOption>("DUE_DATE_ASC");
  const [searchQuery, setSearchQuery] = useState("");

  const [confirmDelete, setConfirmDelete] = useState<Task | null>(null);
  // Selection for bulk changes (#281): ids, plus the last clicked row for Shift+click ranges.
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [anchorId, setAnchorId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
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
      if (response.ok) setProjects((await response.json()) as ProjectItem[]);
    } catch {
      // The project selects stay empty; tasks still load.
    }
  }

  useEffect(() => {
    async function loadInitialData() {
      await Promise.all([fetchTasks(), fetchProjects(), loadLabels(true)]);
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
    void Promise.all([fetchTasks(false), fetchProjects(), loadLabels(true)]);
  });

  // Old links (`?task=<id>` from search, Home, emails and notifications) open the task's page (#352).
  useEffect(() => {
    if (linkedTaskId) router.replace(`/tasks/${encodeURIComponent(linkedTaskId)}`);
  }, [linkedTaskId, router]);

  const visibleTasks = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    // Subtasks show inside their parent, except when searching.
    const filtered = (query ? tasks : topLevelTasks(tasks)).filter(
      (task) =>
        (!query || task.title.toLowerCase().includes(query) || (task.description ?? "").toLowerCase().includes(query)) &&
        (statusFilter === "ALL" || (statusFilter === "DONE") === (task.status === "DONE")) &&
        (priorityFilter === "ALL" || task.priority === priorityFilter) &&
        (!projectFilter || task.projectId === projectFilter) &&
        matchesLabelFilter(labelsOfTask(task).map((label) => label.id), labelFilter),
    );
    return filtered.sort((a, b) => {
      if (sortBy === "NEWEST") return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      if (sortBy === "OLDEST") return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      const comparison = compareTaskDueDates(a.dueDate, b.dueDate);
      return sortBy === "DUE_DATE_ASC" ? comparison : -comparison;
    });
  }, [tasks, searchQuery, statusFilter, priorityFilter, projectFilter, labelFilter, sortBy]);

  const now = new Date();
  // One card per project (#348): no project first, then by priority, ties in the sidebar's order.
  const projectOrder = new Map(
    [...projects]
      .sort((a, b) => comparePriority(a.priority ?? "NONE", b.priority ?? "NONE") || (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""))
      .map((project, index) => [project.id, index]),
  );
  const byProject = new Map<string, Task[]>();
  for (const task of visibleTasks) byProject.set(task.projectId ?? "", [...(byProject.get(task.projectId ?? "") ?? []), task]);
  const projectGroups = [...byProject]
    .map(([projectId, groupTasks]) => {
      const project = projects.find((item) => item.id === projectId) ?? null;
      return {
        key: projectId || "none",
        projectId: projectId || null,
        project,
        name: projectId ? (project?.name ?? groupTasks[0]?.project?.name ?? "Project") : "No project",
        color: projectId ? projectColor(project ?? groupTasks[0]?.project ?? { id: projectId, color: null }) : null,
        active: groupTasks.filter((task) => task.status !== "DONE").length,
        sections: SECTION_ORDER.map((key) => ({ key, tasks: groupTasks.filter((task) => sectionFor(task, now) === key) })).filter(
          (section) => section.tasks.length,
        ),
      };
    })
    .sort((a, b) => {
      if (!a.projectId || !b.projectId) return a.projectId ? 1 : b.projectId ? -1 : 0;
      const order = (projectOrder.get(a.projectId) ?? Infinity) - (projectOrder.get(b.projectId) ?? Infinity);
      return order || a.name.localeCompare(b.name);
    });
  const shownTasks = projectGroups.flatMap((group) => group.sections.flatMap((section) => section.tasks));

  // Bulk changes apply to the selected tasks still on screen, in the order shown.
  const shownIds = shownTasks.map((task) => task.id);
  const selectedTasks = shownTasks.filter((task) => selected.has(task.id));
  const bulkProjects = projects.filter((project) => project.accessLevel !== "VIEWER" && project.status !== "ARCHIVED");

  const filtersActive =
    Boolean(searchQuery.trim()) || statusFilter !== "ALL" || priorityFilter !== "ALL" || Boolean(projectFilter) || labelFilter.size > 0;

  function selectTask(task: Task, range: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      const from = anchorId ? shownIds.indexOf(anchorId) : -1;
      const to = shownIds.indexOf(task.id);
      if (range && from >= 0 && to >= 0) {
        for (const id of shownIds.slice(Math.min(from, to), Math.max(from, to) + 1)) next.add(id);
      } else if (next.has(task.id)) next.delete(task.id);
      else next.add(task.id);
      return next;
    });
    setAnchorId(task.id);
  }

  function clearSelection() {
    setSelected(new Set());
    setAnchorId(null);
  }

  // Ctrl+A (Cmd+A on a Mac) selects every task shown; Escape clears the selection.
  const onSelectionKey = useEffectEvent((event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest("input, textarea, select, [contenteditable=true]") || document.querySelector('[role="dialog"], [role="menu"]')) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a" && shownIds.length) {
      event.preventDefault();
      setSelected(new Set(shownIds));
    } else if (event.key === "Escape" && selected.size) {
      clearSelection();
    }
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => onSelectionKey(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  async function sendBulk(body: unknown, method = "PATCH") {
    const response = await fetch("/api/tasks/bulk", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!response.ok) throw new Error(await errorMessage(response, "Could not change the tasks."));
    return response.json();
  }

  async function undoBulk(previous: TaskSnapshot[]) {
    try {
      await sendBulk({ restore: previous });
      notifyWorkspaceChanged();
      await fetchTasks(false);
      toast.success("Change undone");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not undo the change.");
    }
  }

  async function applyBulk(change: BulkTaskChange, names: BulkNames = {}, ids = selectedTasks.map((task) => task.id)) {
    if (!ids.length || bulkBusy) return;
    setBulkBusy(true);
    try {
      const result = (await sendBulk({ ids, change })) as { previous: TaskSnapshot[] };
      notifyWorkspaceChanged();
      await fetchTasks(false);
      toast.success(describeBulkChange(change, ids.length, names), {
        action: { label: "Undo", onClick: () => void undoBulk(result.previous) },
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not change the tasks.");
    } finally {
      setBulkBusy(false);
    }
  }

  async function deleteSelected() {
    const ids = selectedTasks.map((task) => task.id);
    setBulkBusy(true);
    try {
      await sendBulk({ ids }, "DELETE");
      setTasks((current) => current.filter((task) => !ids.includes(task.id)));
      clearSelection();
      notifyWorkspaceChanged();
      toast.success(`${ids.length} task${ids.length === 1 ? "" : "s"} moved to Trash`, {
        action: {
          label: "Undo",
          onClick: () =>
            void (async () => {
              const response = await fetch("/api/trash", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ type: "task", ids }),
              });
              if (!response.ok) {
                toast.error(await errorMessage(response, "Could not restore the tasks."));
                return;
              }
              notifyWorkspaceChanged();
              await fetchTasks(false);
              toast.success("Tasks restored");
            })(),
        },
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete the tasks.");
    } finally {
      setBulkBusy(false);
      setConfirmBulkDelete(false);
    }
  }

  /** Opens a task as its page, remembering the order shown for its previous and next buttons. */
  function openTask(task: Task) {
    try {
      window.sessionStorage.setItem(TASK_ORDER_KEY, JSON.stringify(shownIds));
    } catch {
      // Private windows can refuse storage; the page then hides previous and next.
    }
    router.push(`/tasks/${task.id}`);
  }

  async function toggleTask(task: Task) {
    const status: TaskStatus = task.status === "DONE" ? "TODO" : "DONE";
    setBusyIds((ids) => [...ids, task.id]);
    try {
      const response = await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(taskRequestBody(inputFromTask(task, { status }))),
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

  /** "No project" moves its tasks into a project: the selected ones in the card, or all of them. */
  function moveUnfiled(groupTasks: Task[], project: ProjectItem) {
    const chosen = groupTasks.filter((task) => selected.has(task.id));
    const ids = (chosen.length ? chosen : groupTasks).filter((task) => !task.parentId).map((task) => task.id);
    if (!ids.length) {
      toast.error("Sub-tasks stay in their parent's project.");
      return;
    }
    void applyBulk({ projectId: project.id }, { project: project.name }, ids);
  }

  return (
    <div className="mx-auto grid w-full max-w-6xl grid-cols-1 gap-4 px-4 py-5 sm:px-6 lg:px-8 lg:py-6">
      {/* The status tabs sit by the title, a step smaller than it (design 1B with 1C's header). */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <h1 className="text-title">Tasks</h1>
          <div role="radiogroup" aria-label="Status" className="flex rounded-xl bg-sunken p-1">
            {statusTabs.map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={statusFilter === value}
                onClick={() => setStatusFilter(value)}
                className={cn(
                  "rounded-lg px-3.5 py-1.5 text-[0.9375rem] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent",
                  statusFilter === value ? "bg-surface text-ink shadow-card" : "text-muted hover:text-ink",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <button type="button" onClick={() => openNewTask()} className={cn(uiPrimaryButtonClass, "px-3 py-1.5")}>
          <Plus aria-hidden="true" className="h-4 w-4" />
          New task
        </button>
      </header>

      <QuickAdd onAdded={() => void fetchTasks(false)} />

      {selectedTasks.length ? (
        <BulkBar
          tasks={selectedTasks}
          projects={bulkProjects}
          labels={labels ?? []}
          busy={bulkBusy}
          onClear={clearSelection}
          onChange={(change, names) => void applyBulk(change, names)}
          onDelete={() => setConfirmBulkDelete(true)}
        />
      ) : (
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
        {/* On phones the filters share rows two by two, so their 16px labels (#337) aren't cut off. */}
        <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:flex-nowrap">
          <select aria-label="Priority" value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value as "ALL" | Priority)} className={filterClass}>
            <option value="ALL">Any priority</option>
            {PRIORITIES.map((value) => (
              <option key={value} value={value}>{priorityLabels[value]}</option>
            ))}
          </select>
          <LabelFilter labels={labels ?? []} projects={projects} selected={labelFilter} onChange={setLabelFilter} className="flex-1 basis-34 sm:flex-none sm:basis-auto" />
          <select aria-label="Project" value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)} className={filterClass}>
            <option value="">All projects</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>{project.name}</option>
            ))}
          </select>
          <select aria-label="Sort" value={sortBy} onChange={(event) => setSortBy(event.target.value as SortOption)} className={filterClass}>
            <option value="DUE_DATE_ASC">Due soonest</option>
            <option value="DUE_DATE_DESC">Due latest</option>
            <option value="NEWEST">Newest</option>
            <option value="OLDEST">Oldest</option>
          </select>
        </div>
      </div>
      )}

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
      ) : projectGroups.length === 0 ? (
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
                setLabelFilter(new Set());
              }}
              className={cn(uiButtonClass, "mt-4 px-3 py-1.5")}
            >
              Clear filters
            </button>
          ) : null}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5">
          {projectGroups.map((group) => {
            const groupTasks = group.sections.flatMap((section) => section.tasks);
            const scope = group.projectId ?? "none";
            const canAdd = !group.project || group.project.accessLevel !== "VIEWER";
            return (
              <section key={group.key} aria-labelledby={`group-${group.key}`} className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
                <div className="flex min-h-12 flex-wrap items-center gap-x-2.5 gap-y-1 border-b border-line bg-sunken py-1.5 pl-3.5 pr-2 sm:pl-4">
                  {group.projectId ? (
                    <>
                      <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: group.color ?? undefined }} />
                      <h2 id={`group-${group.key}`} className="min-w-0 truncate text-[0.9375rem] font-semibold">
                        <Link href={`/projects/${group.projectId}`} className="rounded outline-none hover:text-accent focus-visible:ring-2 focus-visible:ring-accent">
                          {group.name}
                        </Link>
                      </h2>
                      <PriorityBadge priority={group.project?.priority ?? "NONE"} />
                    </>
                  ) : (
                    <h2 id={`group-${group.key}`} className="min-w-0">
                      {/* "No project" is itself the button that files these tasks into a project. */}
                      <Popover>
                        <PopoverTrigger asChild>
                          <button
                            type="button"
                            title="Move these tasks to a project"
                            className="-ml-1.5 inline-flex h-8 items-center gap-2 rounded-lg px-1.5 text-[0.9375rem] font-semibold outline-none transition-colors hover:bg-surface hover:text-accent focus-visible:ring-2 focus-visible:ring-accent"
                          >
                            <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full border-[1.5px] border-dashed border-muted" />
                            No project
                            <ChevronDown aria-hidden="true" className="h-4 w-4 text-muted" />
                          </button>
                        </PopoverTrigger>
                        <PopoverContent className="w-64 p-1">
                          <p className="px-2.5 pb-1.5 pt-2 text-xs text-muted">
                            {(() => {
                              const chosen = groupTasks.filter((task) => selected.has(task.id)).length;
                              const count = chosen || groupTasks.filter((task) => !task.parentId).length;
                              return `Move ${chosen ? "the selected" : count === 1 ? "this" : `these ${count}`} task${count === 1 ? "" : "s"} to…`;
                            })()}
                          </p>
                          {bulkProjects.length ? (
                            bulkProjects.map((project) => (
                              <button
                                key={project.id}
                                type="button"
                                onClick={() => moveUnfiled(groupTasks, project)}
                                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm outline-none hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent"
                              >
                                <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: projectColor(project) }} />
                                <span className="min-w-0 flex-1 truncate">{project.name}</span>
                                {project.priority && project.priority !== "NONE" ? <span className="text-xs text-muted">{priorityLabels[project.priority]}</span> : null}
                              </button>
                            ))
                          ) : (
                            <p className="px-2.5 py-2 text-sm text-muted">No projects yet. Create one from the sidebar.</p>
                          )}
                        </PopoverContent>
                      </Popover>
                    </h2>
                  )}
                  <span className="shrink-0 text-xs text-muted">{group.active} active</span>
                  <span aria-hidden="true" className="flex-1" />
                  <Link
                    href={`/events/calendar?project=${group.projectId ?? "none"}`}
                    aria-label={`Calendar for ${group.projectId ? group.name : "tasks with no project"}`}
                    title={`Calendar for ${group.projectId ? group.name : "tasks with no project"}`}
                    className={headerLinkClass}
                  >
                    <CalendarDays aria-hidden="true" className="h-4 w-4" />
                    <span className="hidden sm:inline">Calendar</span>
                  </Link>
                  <Link href={`/notes?project=${scope}`} aria-label={group.projectId ? `Notes for ${group.name}` : "Notes with no project"} title={group.projectId ? `Notes for ${group.name}` : "Notes with no project"} className={headerLinkClass}>
                    <NotebookText aria-hidden="true" className="h-4 w-4" />
                  </Link>
                  {canAdd ? (
                    <button
                      type="button"
                      onClick={() => openNewTask({ projectId: group.projectId ?? undefined })}
                      aria-label={group.projectId ? `New task in ${group.name}` : "New task with no project"}
                      title={group.projectId ? `New task in ${group.name}` : "New task with no project"}
                      className={headerLinkClass}
                    >
                      <Plus aria-hidden="true" className="h-4 w-4" />
                    </button>
                  ) : null}
                </div>
                {group.sections.map((section) => (
                  <section key={section.key} aria-labelledby={`section-${group.key}-${section.key}`}>
                    <h3
                      id={`section-${group.key}-${section.key}`}
                      className={cn(
                        "flex items-center gap-2 px-4 pb-1 pt-3 text-2xs font-semibold uppercase tracking-wider",
                        section.key === "OVERDUE" ? "text-danger" : "text-muted",
                      )}
                    >
                      {sectionTitles[section.key]}
                      <span className="font-mono tabular-nums">{section.tasks.length}</span>
                    </h3>
                    <ul>
                      {section.tasks.map((task) => (
                        <TaskRow
                          key={task.id}
                          ref={task.id === linkedTaskId ? linkedRowRef : undefined}
                          task={task}
                          now={now}
                          highlighted={task.id === linkedTaskId}
                          busy={busyIds.includes(task.id)}
                          showProject={false}
                          onToggle={(item) => void toggleTask(item)}
                          onOpen={openTask}
                          onDelete={setConfirmDelete}
                          selected={selected.has(task.id)}
                          onSelect={selectTask}
                        />
                      ))}
                    </ul>
                  </section>
                ))}
              </section>
            );
          })}
        </div>
      )}


      <ConfirmDialog
        open={confirmBulkDelete}
        title={`Delete ${selectedTasks.length} task${selectedTasks.length === 1 ? "" : "s"}?`}
        message="They move to Trash, where you can restore them. Undo in the next message puts them all back."
        loading={bulkBusy}
        onCancel={() => setConfirmBulkDelete(false)}
        onConfirm={() => void deleteSelected()}
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
