"use client";

/**
 * Tasks (#520, design 1D): the list fills the width, from the sidebar to the scrollbar, like Linear.
 *
 * - One header row: the title, All / Active / Done, search, Filter (priorities, projects, labels)
 *   and Display (sort, descriptions).
 * - The quick add is a full-width row under it, and the only way to add on this page; the sidebar's
 *   New task and the N key stay. While tasks are selected, the bulk bar floats at the bottom.
 * - One band per project (#348): tasks with no project first, then projects by priority, ties in the
 *   sidebar's order. A band folds, adds a task in its project (+), and opens the project's Calendar,
 *   notes and page (⋯); "No project" moves its tasks into a project.
 * - Inside a band, tasks are grouped into Overdue, Today, Upcoming, No due date and Done; Done
 *   starts folded, except on the Done tab.
 * - Each task is one line (`TaskRow`); Mark done completes it in place, with Undo in its message.
 * - `?task=<id>` opens that task's page (links from search, Home and the Planner).
 * - Subtasks live inside their parent; the row shows a progress ring, and "Blocked" while the task
 *   waits on open tasks (SMART-02).
 */

import { CalendarDays, ChevronDown, FolderOpen, MoreHorizontal, NotebookText, Plus, Search } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { QuickAdd } from "@/components/home/quick-add";
import { BulkBar, type BulkNames } from "@/components/tasks/bulk-bar";
import { loadLabels, useLabels } from "@/components/tasks/label-store";
import { PriorityBadge } from "@/components/tasks/priority-badge";
import { NO_PROJECT, noTaskFilters, TaskDisplayMenu, TaskFilterMenu, type TaskFilters, type TaskSort } from "@/components/tasks/task-list-menus";
import { TASK_ORDER_KEY } from "@/components/tasks/task-page-view";
import { TaskRow } from "@/components/tasks/task-row";
import { taskRequestBody } from "@/components/tasks/task-sheet";
import type { Project, Task, TaskInput, TaskStatus } from "@/components/tasks/types";
import { uiButtonClass } from "@/components/ui";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "@/components/ui/toaster";
import { cn } from "@/lib/cn";
import { daysFrom } from "@/lib/home-summary";
import { labelsOfTask, matchesLabelFilter } from "@/lib/labels";
import { comparePriority, priorityLabels } from "@/lib/priority";
import { projectColor } from "@/lib/project-color";
import { describeBulkChange, type BulkTaskChange, type TaskSnapshot } from "@/lib/task-bulk";
import { compareTaskDueDates, formatTaskDueDateInput } from "@/lib/task-date-buckets";
import { topLevelTasks } from "@/lib/task-relations";
import { useRefreshOnReturn } from "@/lib/use-page-activity";
import { notifyWorkspaceChanged, quickAddInProject, TASK_CREATED_EVENT } from "@/lib/workspace-events";

/** A project from /api/projects, with the caller's access. */
type ProjectItem = Project & { status?: string; updatedAt?: string };

type StatusFilter = "ALL" | "OPEN" | "DONE";
type SectionKey = "OVERDUE" | "TODAY" | "UPCOMING" | "NO_DATE" | "DONE";

const SECTION_ORDER: SectionKey[] = ["OVERDUE", "TODAY", "UPCOMING", "NO_DATE", "DONE"];

const statusTabs: [StatusFilter, string][] = [
  ["ALL", "All"],
  ["OPEN", "Active"],
  ["DONE", "Done"],
];

const sectionTitles: Record<SectionKey, string> = {
  OVERDUE: "Overdue",
  TODAY: "Today",
  UPCOMING: "Upcoming",
  NO_DATE: "No due date",
  DONE: "Done",
};

/** The band's small square buttons: + and ⋯. */
const bandButtonClass =
  "grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted outline-none transition-colors hover:bg-surface-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-accent data-[state=open]:bg-surface-hover data-[state=open]:text-ink";

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

/** A set with `key` added, or removed if it was there. */
function toggled(set: ReadonlySet<string>, key: string) {
  const next = new Set(set);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
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
  const [filters, setFilters] = useState<TaskFilters>(noTaskFilters);
  const labels = useLabels();
  const [sortBy, setSortBy] = useState<TaskSort>("DUE_DATE_ASC");
  const [showDescriptions, setShowDescriptions] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  // Folded project bands, and the bands whose Done section is open.
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set());
  const [doneOpen, setDoneOpen] = useState<ReadonlySet<string>>(() => new Set());

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
      // The project filters stay empty; tasks still load.
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

  // Tasks assigned or changed on another device show up on coming back.
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
        (!filters.priorities.size || filters.priorities.has(task.priority)) &&
        (!filters.projects.size || filters.projects.has(task.projectId ?? NO_PROJECT)) &&
        matchesLabelFilter(labelsOfTask(task).map((label) => label.id), filters.labels),
    );
    return filtered.sort((a, b) => {
      if (sortBy === "NEWEST") return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      if (sortBy === "OLDEST") return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      const comparison = compareTaskDueDates(a.dueDate, b.dueDate);
      return sortBy === "DUE_DATE_ASC" ? comparison : -comparison;
    });
  }, [tasks, searchQuery, statusFilter, filters, sortBy]);

  const now = new Date();
  // One band per project (#348): no project first, then by priority, ties in the sidebar's order.
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
      const key = projectId || NO_PROJECT;
      return {
        key,
        projectId: projectId || null,
        project,
        name: projectId ? (project?.name ?? groupTasks[0]?.project?.name ?? "Project") : "No project",
        color: projectId ? projectColor(project ?? groupTasks[0]?.project ?? { id: projectId, color: null }) : null,
        active: groupTasks.filter((task) => task.status !== "DONE").length,
        open: !folded.has(key),
        sections: SECTION_ORDER.map((sectionKey) => ({
          key: sectionKey,
          tasks: groupTasks.filter((task) => sectionFor(task, now) === sectionKey),
          // Done starts folded, so finished work doesn't push the open tasks down; the Done tab shows it all.
          shut: sectionKey === "DONE" && statusFilter !== "DONE" && !doneOpen.has(key),
        })).filter((section) => section.tasks.length),
      };
    })
    .sort((a, b) => {
      if (!a.projectId || !b.projectId) return a.projectId ? 1 : b.projectId ? -1 : 0;
      const order = (projectOrder.get(a.projectId) ?? Infinity) - (projectOrder.get(b.projectId) ?? Infinity);
      return order || a.name.localeCompare(b.name);
    });
  // The tasks on screen, in order: folded bands and a folded Done hide theirs.
  const shownTasks = projectGroups.flatMap((group) =>
    group.open ? group.sections.flatMap((section) => (section.shut ? [] : section.tasks)) : [],
  );

  // Bulk changes apply to the selected tasks still on screen, in the order shown.
  const shownIds = shownTasks.map((task) => task.id);
  const selectedTasks = shownTasks.filter((task) => selected.has(task.id));
  const bulkProjects = projects.filter((project) => project.status !== "ARCHIVED");

  const filtersActive =
    Boolean(searchQuery.trim()) || statusFilter !== "ALL" || filters.priorities.size > 0 || filters.projects.size > 0 || filters.labels.size > 0;

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

  function clearFilters() {
    setSearchQuery("");
    setStatusFilter("ALL");
    setFilters(noTaskFilters);
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

  /** Saves a new status; false if it failed, which the message explains. */
  async function setTaskStatus(task: Task, status: TaskStatus) {
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
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update the task.");
      return false;
    } finally {
      setBusyIds((ids) => ids.filter((id) => id !== task.id));
    }
  }

  async function toggleTask(task: Task) {
    const status: TaskStatus = task.status === "DONE" ? "TODO" : "DONE";
    if (!(await setTaskStatus(task, status)) || status !== "DONE") return;
    // A done task moves into the folded Done section, so its message can bring it back.
    toast.success("Task completed", {
      description: task.title,
      action: { label: "Undo", onClick: () => void setTaskStatus({ ...task, status }, task.status) },
    });
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

  /** "No project" moves its tasks into a project: the selected ones in the band, or all of them. */
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
    // No side margins (#520): the bands and rows run from the sidebar to the scrollbar, on the surface color down to
    // the bottom of the page (data-page-surface, read by the app shell's main).
    <div data-page-surface className="flex min-h-full flex-col bg-surface">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line bg-canvas px-4 py-3 sm:pl-6 sm:pr-4">
        <h1 className="text-title">Tasks</h1>
        <div role="radiogroup" aria-label="Status" className="flex shrink-0 rounded-[0.625rem] bg-sunken p-[0.1875rem]">
          {statusTabs.map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={statusFilter === value}
              onClick={() => setStatusFilter(value)}
              className={cn(
                "rounded-[0.4375rem] px-3 py-1 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent",
                statusFilter === value ? "bg-surface text-ink shadow-card" : "text-muted hover:text-ink",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <div role="search" aria-label="Filter tasks" className="flex min-w-0 flex-1 items-center justify-end gap-2 max-sm:basis-full sm:gap-3">
          <label className="relative flex min-w-30 basis-60 items-center max-sm:flex-1">
            <span className="sr-only">Search tasks</span>
            <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 h-4 w-4 text-muted" />
            <input
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search tasks"
              className="h-8.5 w-full min-w-0 rounded-lg border border-line bg-surface pl-8 pr-2.5 text-sm text-ink outline-none placeholder:text-muted focus:border-accent focus:ring-2 focus:ring-accent/25"
            />
          </label>
          <TaskFilterMenu filters={filters} projects={projects} labels={labels ?? []} onChange={setFilters} />
          <TaskDisplayMenu sort={sortBy} showDescriptions={showDescriptions} onSortChange={setSortBy} onShowDescriptionsChange={setShowDescriptions} />
        </div>
      </header>

      <QuickAdd variant="row" onAdded={() => void fetchTasks(false)} />

      {loadError ? (
        <p role="alert" className="border-b border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger sm:px-6">
          {loadError}{" "}
          <button type="button" onClick={() => void fetchTasks()} className="font-semibold underline">Try again</button>
        </p>
      ) : null}

      {fetching ? (
        <div aria-busy="true" aria-label="Loading tasks">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="flex h-10 items-center border-b border-line/60 px-4 sm:px-6">
              <span className="h-3 animate-pulse rounded bg-sunken" style={{ width: `${[42, 30, 55, 36, 48, 26][index]}%` }} />
            </div>
          ))}
        </div>
      ) : projectGroups.length === 0 ? (
        <div className="px-6 py-14 text-center">
          <h2 className="text-base font-semibold">{tasks.length === 0 ? "No tasks yet." : "No tasks match these filters."}</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted">
            {tasks.length === 0
              ? "Type one in the box above and press Enter, or press N for the full form."
              : "Clear the search or switch back to all tasks."}
          </p>
          {tasks.length !== 0 && filtersActive ? (
            <button type="button" onClick={clearFilters} className={cn(uiButtonClass, "mt-4 px-3 py-1.5")}>
              Clear filters
            </button>
          ) : null}
        </div>
      ) : (
        // While tasks are selected, room to scroll the last ones above the floating bulk bar.
        <div className={selectedTasks.length ? "pb-20" : "pb-6"}>
          {projectGroups.map((group, index) => {
            const groupTasks = group.sections.flatMap((section) => section.tasks);
            const scope = group.projectId ?? NO_PROJECT;
            const tasksId = `group-${group.key}-tasks`;
            return (
              <section key={group.key} aria-labelledby={`group-${group.key}`}>
                {/* One line at any width: a long project name truncates rather than pushing the buttons onto a second row. */}
                <div className={cn("flex h-10 items-center gap-2 border-b border-line bg-sunken pl-2.5 pr-2 sm:pr-3", index > 0 && "border-t")}>
                  <button
                    type="button"
                    aria-expanded={group.open}
                    aria-controls={group.open ? tasksId : undefined}
                    aria-label={`${group.open ? "Fold" : "Unfold"} ${group.name}`}
                    title={group.open ? "Fold" : "Unfold"}
                    onClick={() => setFolded((current) => toggled(current, group.key))}
                    className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-muted outline-none transition-colors hover:bg-surface-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    <ChevronDown aria-hidden="true" className={cn("h-3.5 w-3.5 transition-transform", !group.open && "-rotate-90")} />
                  </button>
                  {group.projectId ? (
                    <>
                      <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: group.color ?? undefined }} />
                      <h2 id={`group-${group.key}`} className="min-w-0 truncate text-[0.90625rem] font-semibold">
                        <Link href={`/projects/${group.projectId}`} title={group.name} className="rounded outline-none hover:text-accent focus-visible:ring-2 focus-visible:ring-accent">
                          {group.name}
                        </Link>
                      </h2>
                      <PriorityBadge priority={group.project?.priority ?? "NONE"} className="shrink-0" />
                    </>
                  ) : (
                    <h2 id={`group-${group.key}`} className="min-w-0">
                      {/* "No project" is itself the button that files these tasks into a project. */}
                      <Popover>
                        <PopoverTrigger asChild>
                          <button
                            type="button"
                            title="Move these tasks to a project"
                            className="-ml-1 inline-flex h-7 items-center gap-2 rounded-md px-1.5 text-[0.90625rem] font-semibold outline-none transition-colors hover:bg-surface-hover hover:text-accent focus-visible:ring-2 focus-visible:ring-accent"
                          >
                            <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full border-[1.5px] border-dashed border-muted" />
                            No project
                            <ChevronDown aria-hidden="true" className="h-3.5 w-3.5 text-muted" />
                          </button>
                        </PopoverTrigger>
                        <PopoverContent align="start" className="w-64 p-1">
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
                  <span className="shrink-0 text-[0.78125rem] tabular-nums text-muted">
                    {group.active}
                    <span className="sr-only"> active</span>
                  </span>
                  <span aria-hidden="true" className="flex-1" />
                  {/* The add box above, with this band's project picked. */}
                  <button
                    type="button"
                    onClick={() => quickAddInProject(group.projectId ?? "")}
                    aria-label={group.projectId ? `New task in ${group.name}` : "New task with no project"}
                    title={group.projectId ? `New task in ${group.name}` : "New task with no project"}
                    className={bandButtonClass}
                  >
                    <Plus aria-hidden="true" className="h-4 w-4" />
                  </button>
                  {/* The project's Calendar and notes moved in here (#520), so the band holds one calendar-free line. */}
                  <DropdownMenu>
                    <DropdownMenuTrigger aria-label={`More for ${group.name}`} title="More" className={bandButtonClass}>
                      <MoreHorizontal aria-hidden="true" className="h-4 w-4" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem asChild>
                        <Link href={`/events/calendar?project=${scope}`}>
                          <CalendarDays />
                          Open in Calendar
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link href={`/notes?project=${scope}`}>
                          <NotebookText />
                          {group.projectId ? "Project notes" : "Notes with no project"}
                        </Link>
                      </DropdownMenuItem>
                      {group.projectId ? (
                        <DropdownMenuItem asChild>
                          <Link href={`/projects/${group.projectId}`}>
                            <FolderOpen />
                            Open project
                          </Link>
                        </DropdownMenuItem>
                      ) : null}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                {group.open ? (
                  <div id={tasksId}>
                    {group.sections.map((section) => {
                      const headingId = `section-${group.key}-${section.key}`;
                      const sectionTasksId = `${headingId}-tasks`;
                      return (
                        <section key={section.key} aria-labelledby={headingId}>
                          {/* Indented a little past the task titles; Done's fold arrow sits in front of its name. */}
                          <h3
                            id={headingId}
                            className={cn(
                              "flex h-8 items-end gap-2 pb-1 pl-11 pr-4 text-2xs font-semibold uppercase tracking-wider sm:pl-13",
                              section.key === "OVERDUE" ? "text-danger" : "text-muted",
                            )}
                          >
                            {/* Done folds, except on the Done tab, which shows it all. */}
                            {section.key === "DONE" && statusFilter !== "DONE" ? (
                              <button
                                type="button"
                                aria-expanded={!section.shut}
                                aria-controls={section.shut ? undefined : sectionTasksId}
                                onClick={() => setDoneOpen((current) => toggled(current, group.key))}
                                className="-ml-5 inline-flex items-center gap-1.5 rounded uppercase tracking-wider outline-none transition-colors hover:text-ink focus-visible:ring-2 focus-visible:ring-accent"
                              >
                                <ChevronDown aria-hidden="true" className={cn("h-3.5 w-3.5 transition-transform", section.shut && "-rotate-90")} />
                                {sectionTitles[section.key]}
                                <span className="font-mono tabular-nums">{section.tasks.length}</span>
                              </button>
                            ) : (
                              <>
                                {sectionTitles[section.key]}
                                <span className="font-mono tabular-nums">{section.tasks.length}</span>
                              </>
                            )}
                          </h3>
                          {section.shut ? null : (
                            <ul id={sectionTasksId}>
                              {section.tasks.map((task) => (
                                <TaskRow
                                  key={task.id}
                                  ref={task.id === linkedTaskId ? linkedRowRef : undefined}
                                  task={task}
                                  now={now}
                                  highlighted={task.id === linkedTaskId}
                                  busy={busyIds.includes(task.id)}
                                  showProject={false}
                                  showDescription={showDescriptions}
                                  onToggle={(item) => void toggleTask(item)}
                                  onOpen={openTask}
                                  onDelete={setConfirmDelete}
                                  selected={selected.has(task.id)}
                                  selecting={selectedTasks.length > 0}
                                  onSelect={selectTask}
                                />
                              ))}
                            </ul>
                          )}
                        </section>
                      );
                    })}
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>
      )}

      {/* While tasks are selected, the bulk bar floats at the bottom of the list, as in Linear (design 1D). The empty
          strip it hangs from sticks to the bottom as the list scrolls, and takes no room. Sticking keeps clear of
          main's bottom padding, the space for the AI bar and the phone's tabs (--page-end); with none, 1.5rem. */}
      {selectedTasks.length ? (
        <div className="pointer-events-none sticky bottom-[max(0rem,calc(1.5rem-var(--page-end,0rem)))] z-20 mt-auto h-0">
          <div className="pointer-events-auto absolute bottom-0 left-1/2 w-max max-w-[calc(100%-2rem)] -translate-x-1/2 animate-[ui-pop-in_120ms_ease-out]">
            <BulkBar
              tasks={selectedTasks}
              projects={bulkProjects}
              labels={labels ?? []}
              busy={bulkBusy}
              onClear={clearSelection}
              onChange={(change, names) => void applyBulk(change, names)}
              onDelete={() => setConfirmBulkDelete(true)}
              className="shadow-raised"
            />
          </div>
        </div>
      ) : null}

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
