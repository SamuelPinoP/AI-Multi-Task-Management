"use client";

/**
 * TasksPage
 * ---------
 * Main "Tasks" view for the AI-Multi Task-Management app.
 *
 * Responsibilities:
 * - Fetch and display the current user's tasks and projects.
 * - Provide a form to create new tasks (with priority, due date, recurrence,
 *   project, and assignee).
 * - Support inline editing, marking tasks complete/incomplete, and deleting
 *   tasks (with a confirmation dialog).
 * - Support searching, filtering (status/priority/project), and sorting the
 *   task list.
 * - Group visible tasks into "Overdue", "Due Today", and "Upcoming" sections
 *   based on due date urgency.
 * - Support deep-linking to a specific task via a `?task=<id>` query param,
 *   which opens that task in edit mode and scrolls it into view.
 *
 * This file intentionally keeps all data-fetching, filtering, and mutation
 * logic colocated in a single client component for simplicity. Shared
 * date-bucketing helpers live in `@/lib/task-date-buckets` and are reused by
 * both this page and the task board view.
 */

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  uiButtonClass,
  uiDangerButtonClass,
  uiPrimaryButtonClass,
} from "@/components/ui";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  compareTaskDueDates,
  formatTaskDueDate,
  formatTaskDueDateInput,
  getLocalDateOnly,
  getTaskDateBucket,
} from "@/lib/task-date-buckets";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Lifecycle state of a task. */
type TaskStatus = "TODO" | "IN_PROGRESS" | "DONE";

/** Relative importance of a task, used for sorting/filtering and UI badges. */
type Priority = "LOW" | "MEDIUM" | "HIGH";

/** How often a task repeats. "NONE" means it's a one-off task. */
type Recurrence = "NONE" | "DAILY" | "WEEKLY" | "BIWEEKLY" | "MONTHLY";

/** Completion filter applied to the visible task list. */
type TaskFilter = "ALL" | "ACTIVE" | "COMPLETED";

/** Sort order applied to the visible task list. */
type SortOption = "NEWEST" | "OLDEST" | "DUE_DATE_ASC" | "DUE_DATE_DESC";

/** A project a task can optionally belong to. */
type Project = {
  id: string;
  name: string;
  color: string | null;
};

/** A member of a project, eligible to be assigned to a task. */
type Member = {
  id: string;
  name: string;
  email: string | null;
  role: "OWNER" | "EDITOR" | "VIEWER";
};

/** A single task as returned by the `/api/tasks` endpoints. */
type Task = {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: Priority;
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
  recurrence: Recurrence;
  projectId: string | null;
  project: Project | null;
  assigneeId?: string | null;
  assignee: Member | null;
};

/**
 * Derived urgency bucket for a task based on its due date and status.
 * Completed tasks and tasks without a due date are always "NONE".
 */
type TaskUrgency = "OVERDUE" | "DUE_TODAY" | "DUE_SOON" | "NONE";

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Returns the local midnight `Date` for the given date, stripping the
 * time-of-day component. Thin wrapper around `getLocalDateOnly` used for
 * readability at call sites that are comparing "today" to a due date.
 */
function getLocalDayStart(date: Date) {
  return getLocalDateOnly(date);
}

/**
 * Determines how urgent a task is, for grouping and badge styling.
 *
 * Rules:
 * - Done tasks, or tasks with no due date, are never urgent ("NONE").
 * - Delegates the coarse bucketing (OVERDUE / DUE_TODAY) to
 *   `getTaskDateBucket`, which is shared with the task board view.
 * - Otherwise, computes the number of whole days between today and the due
 *   date; due dates within the next 3 days are flagged "DUE_SOON".
 */
function getTaskUrgency(task: Task): TaskUrgency {
  if (task.status === "DONE" || !task.dueDate) return "NONE";

  const bucket = getTaskDateBucket(task.dueDate);
  if (bucket === "OVERDUE") return "OVERDUE";
  if (bucket === "DUE_TODAY") return "DUE_TODAY";

  const dueDate = getLocalDateOnly(task.dueDate);
  const today = getLocalDayStart(new Date());
  const dayDiff = Math.round((dueDate.getTime() - today.getTime()) / 86400000);

  if (dayDiff <= 3) return "DUE_SOON";
  return "NONE";
}

/**
 * Formats a `Recurrence` value into a short, human-readable label used in
 * the "Repeats: ..." badge and summary line.
 */
function formatRecurrenceLabel(recurrence: Recurrence) {
  if (recurrence === "NONE") return "No";
  if (recurrence === "BIWEEKLY") return "every 2 weeks";
  return recurrence.toLowerCase();
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function TasksPage() {
  // --- Core data -----------------------------------------------------------
  /** All tasks belonging to the current user, as loaded from the API. */
  const [tasks, setTasks] = useState<Task[]>([]);
  /** All projects available to the current user (for the project selects). */
  const [projects, setProjects] = useState<Project[]>([]);

  // --- Async / loading state -------------------------------------------------
  /** True while the initial tasks list is being fetched. */
  const [fetching, setFetching] = useState(true);
  /** True while a new task is being submitted via the create form. */
  const [loading, setLoading] = useState(false);
  /** True while an in-progress edit is being saved. */
  const [savingEdit, setSavingEdit] = useState(false);
  /** id of the task currently being deleted, if any (drives per-row spinner). */
  const [deletingTaskId, setDeletingTaskId] = useState<string | null>(null);
  /** id of the task whose completion state is being toggled, if any. */
  const [togglingTaskId, setTogglingTaskId] = useState<string | null>(null);
  /** id of the task currently open in inline edit mode, if any. */
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  /** Human-readable error message shown near the create form, if any. */
  const [error, setError] = useState("");
  /** id of the task pending delete confirmation via `ConfirmDialog`. */
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // --- Deep-linking (?task=<id>) ---------------------------------------------
  const searchParams = useSearchParams();
  /** Task id requested via the `task` query param, used to auto-open + highlight a task. */
  const highlightedTaskId = searchParams.get("task");
  /** Ref to the highlighted task's DOM node, used to scroll it into view. */
  const highlightedTaskRef = useRef<HTMLElement | null>(null);

  // --- List controls (search / filter / sort) --------------------------------
  const [filter, setFilter] = useState<TaskFilter>("ALL");
  const [priorityFilter, setPriorityFilter] = useState<"ALL" | Priority>("ALL");
  const [sortBy, setSortBy] = useState<SortOption>("NEWEST");
  const [searchQuery, setSearchQuery] = useState("");
  const [projectFilter, setProjectFilter] = useState("");

  // --- Create-task form state --------------------------------------------
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<TaskStatus>("TODO");
  const [priority, setPriority] = useState<Priority>("MEDIUM");
  const [dueDate, setDueDate] = useState("");
  const [recurrence, setRecurrence] = useState<Recurrence>("NONE");
  const [projectId, setProjectId] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  /**
   * Cache of project members keyed by project id, populated lazily the
   * first time a project's assignee dropdown is opened or a task tied to
   * that project is edited. Avoids refetching members repeatedly.
   */
  const [membersByProject, setMembersByProject] = useState<
    Record<string, Member[]>
  >({});

  // --- Edit-task form state (mirrors the create form, for the row being edited) --
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editStatus, setEditStatus] = useState<TaskStatus>("TODO");
  const [editPriority, setEditPriority] = useState<Priority>("MEDIUM");
  const [editDueDate, setEditDueDate] = useState("");
  const [editRecurrence, setEditRecurrence] = useState<Recurrence>("NONE");
  const [editProjectId, setEditProjectId] = useState("");
  const [editAssigneeId, setEditAssigneeId] = useState("");

  /**
   * Derived list of tasks after applying search, status filter, priority
   * filter, project filter, and the selected sort order. Recomputed only
   * when one of its dependencies changes.
   */
  const visibleTasks = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();

    const filtered = tasks
      // Text search over title + description.
      .filter((task) => {
        if (!normalizedQuery) return true;

        const titleMatches = task.title.toLowerCase().includes(normalizedQuery);
        const descriptionMatches = (task.description ?? "")
          .toLowerCase()
          .includes(normalizedQuery);

        return titleMatches || descriptionMatches;
      })
      // Completion status filter.
      .filter((task) => {
        if (filter === "ACTIVE") return task.status !== "DONE";
        if (filter === "COMPLETED") return task.status === "DONE";
        return true;
      })
      // Priority filter.
      .filter((task) => {
        if (priorityFilter === "ALL") return true;
        return task.priority === priorityFilter;
      })
      // Project filter.
      .filter((task) => {
        if (!projectFilter) return true;
        return task.projectId === projectFilter;
      });

    // Apply the selected sort order over the filtered results.
    const sorted = [...filtered].sort((a, b) => {
      if (sortBy === "NEWEST") {
        return (
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
      }

      if (sortBy === "OLDEST") {
        return (
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        );
      }

      // DUE_DATE_ASC / DUE_DATE_DESC: reuse the shared due-date comparator,
      // negating it for descending order.
      const dueDateComparison = compareTaskDueDates(a.dueDate, b.dueDate);

      if (sortBy === "DUE_DATE_ASC") return dueDateComparison;
      return -dueDateComparison;
    });

    return sorted;
  }, [tasks, searchQuery, filter, priorityFilter, sortBy, projectFilter]);

  /**
   * Deep-link effect: once tasks have loaded and a `?task=<id>` param is
   * present, reset all list controls (so the task is guaranteed to be
   * visible) and open that task in edit mode.
   */
  useEffect(() => {
    if (!highlightedTaskId || fetching) return;
    const task = tasks.find((item) => item.id === highlightedTaskId);
    if (!task) return;

    const timer = window.setTimeout(() => {
      setFilter("ALL");
      setPriorityFilter("ALL");
      setProjectFilter("");
      setSearchQuery("");
      startEditing(task);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fetching, highlightedTaskId, tasks]);

  /**
   * Deep-link effect: after the highlighted task's row has rendered (i.e.
   * `visibleTasks` includes it), smooth-scroll it into the center of the
   * viewport so the user can immediately see/edit it.
   */
  useEffect(() => {
    if (!highlightedTaskId || fetching) return;
    const timer = window.setTimeout(() => {
      highlightedTaskRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fetching, highlightedTaskId, visibleTasks]);

  /**
   * Groups `visibleTasks` into three display sections based on
   * `getTaskUrgency`: "Overdue", "Due Today", and "Upcoming" (which also
   * includes tasks due soon or with no near-term urgency).
   */
  const taskSections = useMemo(() => {
    const overdue = visibleTasks.filter(
      (task) => getTaskUrgency(task) === "OVERDUE",
    );
    const dueToday = visibleTasks.filter(
      (task) => getTaskUrgency(task) === "DUE_TODAY",
    );
    const upcoming = visibleTasks.filter((task) => {
      const urgency = getTaskUrgency(task);
      return urgency === "DUE_SOON" || urgency === "NONE";
    });

    return [
      { key: "OVERDUE", title: "Overdue", tasks: overdue },
      { key: "DUE_TODAY", title: "Due Today", tasks: dueToday },
      { key: "UPCOMING", title: "Upcoming", tasks: upcoming },
    ] as const;
  }, [visibleTasks]);

  /**
   * Loads the current user's tasks from `GET /api/tasks`.
   * @param showLoading When true (default), toggles the full-page
   *   "Loading tasks..." state; pass `false` for background refetches
   *   (e.g. after create/update) to avoid UI flicker.
   */
  async function fetchTasks(showLoading = true) {
    try {
      if (showLoading) setFetching(true);
      setError("");

      const res = await fetch("/api/tasks");
      if (!res.ok) {
        throw new Error("Failed to fetch tasks");
      }

      const data = (await res.json()) as Task[];
      setTasks(data);
    } catch {
      setError("Could not load tasks.");
    } finally {
      setFetching(false);
    }
  }

  /**
   * Lazily fetches and caches the member list for a project, used to
   * populate assignee dropdowns. No-ops if the project has no id or its
   * members are already cached.
   */
  async function fetchMembers(projectIdToLoad: string) {
    if (!projectIdToLoad || membersByProject[projectIdToLoad]) return;
    const res = await fetch(`/api/projects/${projectIdToLoad}`);
    if (!res.ok) return;
    const project = (await res.json()) as { members?: Member[] };
    setMembersByProject((prev) => ({
      ...prev,
      [projectIdToLoad]: project.members ?? [],
    }));
  }

  /**
   * Handles a project change in the **create** form: updates the selected
   * project, ensures its members are loaded (fetching + caching them if
   * needed), and clears the assignee selection if it's no longer a valid
   * member of the new project (or if "No project" was selected).
   */
  async function handleProjectChange(nextProjectId: string) {
    setProjectId(nextProjectId);
    if (!nextProjectId) {
      setAssigneeId("");
      return;
    }
    let members = membersByProject[nextProjectId];
    if (!members) {
      const res = await fetch(`/api/projects/${nextProjectId}`);
      if (res.ok) {
        const project = (await res.json()) as { members?: Member[] };
        members = project.members ?? [];
        setMembersByProject((prev) => ({
          ...prev,
          [nextProjectId]: members ?? [],
        }));
      }
    }
    if (!members?.some((member) => member.id === assigneeId)) setAssigneeId("");
  }

  /**
   * Same as `handleProjectChange`, but for the **edit** form's project
   * selector (operates on `editProjectId` / `editAssigneeId` instead).
   */
  async function handleEditProjectChange(nextProjectId: string) {
    setEditProjectId(nextProjectId);
    if (!nextProjectId) {
      setEditAssigneeId("");
      return;
    }
    let members = membersByProject[nextProjectId];
    if (!members) {
      const res = await fetch(`/api/projects/${nextProjectId}`);
      if (res.ok) {
        const project = (await res.json()) as { members?: Member[] };
        members = project.members ?? [];
        setMembersByProject((prev) => ({
          ...prev,
          [nextProjectId]: members ?? [],
        }));
      }
    }
    if (!members?.some((member) => member.id === editAssigneeId))
      setEditAssigneeId("");
  }

  /** Loads all projects available to the current user from `GET /api/projects`. */
  async function fetchProjects() {
    try {
      const res = await fetch("/api/projects");
      if (!res.ok) {
        throw new Error("Failed to fetch projects");
      }

      const data = (await res.json()) as Project[];
      setProjects(data);
    } catch {
      setError("Could not load projects.");
    }
  }

  /** On mount, load tasks and projects in parallel. */
  useEffect(() => {
    async function loadInitialTasks() {
      await Promise.all([fetchTasks(), fetchProjects()]);
    }

    void loadInitialTasks();
  }, []);

  /**
   * Submits the create-task form: validates the title, posts the new task
   * to `POST /api/tasks`, resets the form fields on success, and
   * refetches the task list (without the full-page loading state).
   */
  async function handleCreateTask(e: FormEvent) {
    e.preventDefault();

    if (!title.trim()) {
      setError("Title is required.");
      return;
    }

    try {
      setLoading(true);
      setError("");

      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          description,
          status,
          priority,
          dueDate: dueDate || null,
          recurrence,
          projectId,
          assigneeId,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Failed to create task");
      }

      setTitle("");
      setDescription("");
      setStatus("TODO");
      setPriority("MEDIUM");
      setDueDate("");
      setRecurrence("NONE");
      setProjectId("");
      setAssigneeId("");
      await fetchTasks(false);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Could not create task.";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  /**
   * Puts the given task into inline edit mode by seeding the edit-form
   * state from its current values, and prefetches its project's members
   * (if any) so the assignee dropdown is ready immediately.
   */
  function startEditing(task: Task) {
    setEditingTaskId(task.id);
    setEditTitle(task.title);
    setEditDescription(task.description ?? "");
    setEditStatus(task.status);
    setEditPriority(task.priority);
    setEditDueDate(
      task.dueDate ? formatTaskDueDateInput(task.dueDate) : "",
    );
    setEditRecurrence(task.recurrence);
    setEditProjectId(task.projectId ?? "");
    setEditAssigneeId(task.assignee?.id ?? "");
    if (task.projectId) void fetchMembers(task.projectId);
    setError("");
  }

  /** Exits inline edit mode and resets all edit-form fields to defaults. */
  function cancelEditing() {
    setEditingTaskId(null);
    setEditTitle("");
    setEditDescription("");
    setEditStatus("TODO");
    setEditPriority("MEDIUM");
    setEditDueDate("");
    setEditRecurrence("NONE");
    setEditProjectId("");
    setEditAssigneeId("");
  }

  /**
   * Saves changes from the edit form for the given task id via
   * `PATCH /api/tasks/:id`, updates the task in local state with the
   * server's response, and exits edit mode on success.
   */
  async function handleSaveEdit(taskId: string) {
    if (!editTitle.trim()) {
      setError("Title is required.");
      return;
    }

    try {
      setSavingEdit(true);
      setError("");

      const res = await fetch(`/api/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: editTitle,
          description: editDescription,
          status: editStatus,
          priority: editPriority,
          dueDate: editDueDate || null,
          recurrence: editRecurrence,
          projectId: editProjectId,
          assigneeId: editProjectId ? editAssigneeId : "",
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Failed to update task");
      }

      const updatedTask = (await res.json()) as Task;
      setTasks((prev) =>
        prev.map((task) => (task.id === taskId ? updatedTask : task)),
      );
      cancelEditing();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Could not update task.";
      setError(message);
    } finally {
      setSavingEdit(false);
    }
  }

  /**
   * Toggles a task between "DONE" and "TODO" via `PATCH /api/tasks/:id`,
   * sending along the task's other current fields unchanged. Updates the
   * task in local state with the server's response.
   */
  async function handleToggleComplete(task: Task) {
    const nextStatus: TaskStatus = task.status === "DONE" ? "TODO" : "DONE";

    try {
      setTogglingTaskId(task.id);
      setError("");

      const res = await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: task.title,
          description: task.description ?? "",
          status: nextStatus,
          priority: task.priority,
          dueDate: task.dueDate ? formatTaskDueDateInput(task.dueDate) : null,
          recurrence: task.recurrence,
          projectId: task.projectId ?? "",
          assigneeId: task.projectId ? (task.assignee?.id ?? "") : "",
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Failed to update task status");
      }

      const updatedTask = (await res.json()) as Task;
      setTasks((prev) =>
        prev.map((item) => (item.id === task.id ? updatedTask : item)),
      );
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Could not update task status.";
      setError(message);
    } finally {
      setTogglingTaskId(null);
    }
  }

  /**
   * Deletes a task via `DELETE /api/tasks/:id` (moves it to Trash per the
   * confirmation dialog's messaging), removes it from local state on
   * success, and exits edit mode if the deleted task was being edited.
   */
  async function handleDeleteTask(taskId: string) {
    try {
      setDeletingTaskId(taskId);
      setError("");

      const res = await fetch(`/api/tasks/${taskId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Failed to delete task");
      }

      setTasks((prev) => prev.filter((task) => task.id !== taskId));
      if (editingTaskId === taskId) {
        cancelEditing();
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Could not delete task.";
      setError(message);
    } finally {
      setDeletingTaskId(null);
    }
  }

  return (
    <>
      <main className="min-h-screen px-6 py-10">
        <div className="mx-auto max-w-4xl">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-4xl font-bold">Tasks</h1>
            <Link
              href="/tasks/board"
              className="rounded-xl border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              Open Task Board
            </Link>
          </div>
          <p className="mb-8 text-zinc-600 dark:text-zinc-300">
            Create and manage your tasks for AI-Multi Task-Management.
          </p>

          {/* Create Task form */}
          <section className="mb-10 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-6 shadow-sm">
            <h2 className="mb-4 text-2xl font-semibold">Create Task</h2>
            <form onSubmit={handleCreateTask} className="space-y-4">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Task title"
                className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 px-4 py-3 outline-none focus:border-black"
              />
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Description (optional)"
                rows={4}
                className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 px-4 py-3 outline-none focus:border-black"
              />
              <div className="grid gap-3 sm:grid-cols-5">
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as TaskStatus)}
                  className="rounded-xl border border-zinc-300 dark:border-zinc-700 px-4 py-3 outline-none focus:border-black"
                >
                  <option value="TODO">To Do</option>
                  <option value="IN_PROGRESS">In Progress</option>
                  <option value="DONE">Done</option>
                </select>
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as Priority)}
                  className="rounded-xl border border-zinc-300 dark:border-zinc-700 px-4 py-3 outline-none focus:border-black"
                >
                  <option value="LOW">Low</option>
                  <option value="MEDIUM">Medium</option>
                  <option value="HIGH">High</option>
                </select>
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="rounded-xl border border-zinc-300 dark:border-zinc-700 px-4 py-3 outline-none focus:border-black"
                />
                <select
                  value={recurrence}
                  onChange={(e) => setRecurrence(e.target.value as Recurrence)}
                  className="rounded-xl border border-zinc-300 dark:border-zinc-700 px-4 py-3 outline-none focus:border-black"
                >
                  <option value="NONE">Does not repeat</option>
                  <option value="DAILY">Daily</option>
                  <option value="WEEKLY">Weekly</option>
                  <option value="BIWEEKLY">Every 2 weeks</option>
                  <option value="MONTHLY">Monthly</option>
                </select>
                <select
                  value={projectId}
                  onChange={(e) => {
                    void handleProjectChange(e.target.value);
                  }}
                  className="rounded-xl border border-zinc-300 dark:border-zinc-700 px-4 py-3 outline-none focus:border-black"
                >
                  <option value="">No project</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
                <select
                  value={assigneeId}
                  onChange={(e) => setAssigneeId(e.target.value)}
                  onFocus={() => {
                    if (projectId) void fetchMembers(projectId);
                  }}
                  disabled={!projectId}
                  className="rounded-xl border border-zinc-300 dark:border-zinc-700 px-4 py-3 outline-none focus:border-black"
                >
                  <option value="">Unassigned</option>
                  {(membersByProject[projectId] ?? []).map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.name}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="submit"
                disabled={loading}
                className="rounded-xl bg-black px-5 py-3 text-white transition hover:opacity-90 disabled:opacity-50"
              >
                {loading ? "Creating..." : "Create Task"}
              </button>
            </form>
            {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
          </section>

          {/* Task list: search/filter/sort controls + grouped sections */}
          <section>
            <h2 className="mb-4 text-2xl font-semibold">Your Tasks</h2>
            <div className="mb-4 grid gap-3 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-4 sm:grid-cols-2">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search tasks by title or description..."
                className="rounded-xl border border-zinc-300 dark:border-zinc-700 px-3 py-2 text-sm outline-none focus:border-black sm:col-span-2"
              />
              <select
                value={filter}
                onChange={(e) => setFilter(e.target.value as TaskFilter)}
                className="rounded-xl border border-zinc-300 dark:border-zinc-700 px-3 py-2 text-sm outline-none focus:border-black"
              >
                <option value="ALL">All Tasks</option>
                <option value="ACTIVE">Active</option>
                <option value="COMPLETED">Completed</option>
              </select>
              <select
                value={priorityFilter}
                onChange={(e) =>
                  setPriorityFilter(e.target.value as "ALL" | Priority)
                }
                className="rounded-xl border border-zinc-300 dark:border-zinc-700 px-3 py-2 text-sm outline-none focus:border-black"
              >
                <option value="ALL">All Priorities</option>
                <option value="LOW">Low Priority</option>
                <option value="MEDIUM">Medium Priority</option>
                <option value="HIGH">High Priority</option>
              </select>
              <select
                value={projectFilter}
                onChange={(e) => setProjectFilter(e.target.value)}
                className="rounded-xl border border-zinc-300 dark:border-zinc-700 px-3 py-2 text-sm outline-none focus:border-black"
              >
                <option value="">All Projects</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortOption)}
                className="rounded-xl border border-zinc-300 dark:border-zinc-700 px-3 py-2 text-sm outline-none focus:border-black"
              >
                <option value="NEWEST">Newest First</option>
                <option value="OLDEST">Oldest First</option>
                <option value="DUE_DATE_ASC">Due Date (Soonest)</option>
                <option value="DUE_DATE_DESC">Due Date (Latest)</option>
              </select>
            </div>

            {fetching ? (
              <p className="text-zinc-600 dark:text-zinc-300">
                Loading tasks...
              </p>
            ) : visibleTasks.length === 0 ? (
              // Empty state: distinguishes "no tasks at all" from
              // "tasks exist but filters hide them".
              <div className="rounded-3xl border border-dashed border-zinc-300 bg-white/70 p-8 text-center dark:border-zinc-700 dark:bg-zinc-900/40">
                <h3 className="text-lg font-semibold">
                  {tasks.length === 0
                    ? "No tasks yet."
                    : "No tasks match your current filters."}
                </h3>
                <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-zinc-500 dark:text-zinc-400">
                  {tasks.length === 0
                    ? "Create your first task above with a priority, due date, project, or assignee. It will also appear in Today, Planner, Roadmap, and the task board when relevant."
                    : "Try clearing the search text, selecting all priorities, or switching back to all projects."}
                </p>
              </div>
            ) : (
              <div className="space-y-6">
                {/* Render each urgency section (Overdue / Due Today / Upcoming) */}
                {taskSections.map((section) => (
                  <div key={section.key}>
                    <h3 className="mb-3 text-lg font-semibold text-gray-800">
                      {section.title}
                    </h3>
                    {section.tasks.length === 0 ? (
                      <p className="rounded-xl border border-dashed border-zinc-200 dark:border-zinc-800 px-4 py-3 text-sm text-gray-500">
                        No tasks in this section yet.
                      </p>
                    ) : (
                      <div className="space-y-4">
                        {section.tasks.map((task) => {
                          const isEditing = editingTaskId === task.id;
                          const isDeleting = deletingTaskId === task.id;
                          const isToggling = togglingTaskId === task.id;
                          const urgency = getTaskUrgency(task);
                          const urgencyLabel =
                            urgency === "OVERDUE"
                              ? "Overdue"
                              : urgency === "DUE_TODAY"
                                ? "Due Today"
                                : urgency === "DUE_SOON"
                                  ? "Due Soon"
                                  : null;
                          const urgencyLabelStyles =
                            urgency === "OVERDUE"
                              ? "text-red-700"
                              : urgency === "DUE_TODAY"
                                ? "text-amber-700"
                                : "text-blue-700";
                          const urgencyStyles =
                            urgency === "OVERDUE"
                              ? "border-red-200 bg-red-50"
                              : urgency === "DUE_TODAY"
                                ? "border-amber-200 bg-amber-50"
                                : urgency === "DUE_SOON"
                                  ? "border-blue-200 bg-blue-50"
                                  : "border-zinc-200 dark:border-zinc-800";

                          return (
                            <article
                              key={task.id}
                              id={`task-${task.id}`}
                              ref={
                                highlightedTaskId === task.id
                                  ? highlightedTaskRef
                                  : null
                              }
                              className={`rounded-2xl border p-5 shadow-sm ${urgencyStyles} ${highlightedTaskId === task.id ? "ring-4 ring-blue-300 ring-offset-2 ring-offset-white dark:ring-blue-800 dark:ring-offset-zinc-950" : ""}`}
                            >
                              {isEditing ? (
                                // --- Inline edit form for this task ---
                                <div className="space-y-3">
                                  <input
                                    value={editTitle}
                                    onChange={(e) =>
                                      setEditTitle(e.target.value)
                                    }
                                    className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 px-4 py-2 outline-none focus:border-black"
                                  />
                                  <textarea
                                    value={editDescription}
                                    onChange={(e) =>
                                      setEditDescription(e.target.value)
                                    }
                                    rows={4}
                                    className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 px-4 py-3 outline-none focus:border-black"
                                  />
                                  <div className="grid gap-3 sm:grid-cols-5">
                                    <select
                                      value={editStatus}
                                      onChange={(e) =>
                                        setEditStatus(
                                          e.target.value as TaskStatus,
                                        )
                                      }
                                      className="rounded-xl border border-zinc-300 dark:border-zinc-700 px-4 py-3 outline-none focus:border-black"
                                    >
                                      <option value="TODO">To Do</option>
                                      <option value="IN_PROGRESS">
                                        In Progress
                                      </option>
                                      <option value="DONE">Done</option>
                                    </select>
                                    <select
                                      value={editPriority}
                                      onChange={(e) =>
                                        setEditPriority(
                                          e.target.value as Priority,
                                        )
                                      }
                                      className="rounded-xl border border-zinc-300 dark:border-zinc-700 px-4 py-3 outline-none focus:border-black"
                                    >
                                      <option value="LOW">Low</option>
                                      <option value="MEDIUM">Medium</option>
                                      <option value="HIGH">High</option>
                                    </select>
                                    <input
                                      type="date"
                                      value={editDueDate}
                                      onChange={(e) =>
                                        setEditDueDate(e.target.value)
                                      }
                                      className="rounded-xl border border-zinc-300 dark:border-zinc-700 px-4 py-3 outline-none focus:border-black"
                                    />
                                    <select
                                      value={editRecurrence}
                                      onChange={(e) =>
                                        setEditRecurrence(
                                          e.target.value as Recurrence,
                                        )
                                      }
                                      className="rounded-xl border border-zinc-300 dark:border-zinc-700 px-4 py-3 outline-none focus:border-black"
                                    >
                                      <option value="NONE">
                                        Does not repeat
                                      </option>
                                      <option value="DAILY">Daily</option>
                                      <option value="WEEKLY">Weekly</option>
                                      <option value="BIWEEKLY">
                                        Every 2 weeks
                                      </option>
                                      <option value="MONTHLY">Monthly</option>
                                    </select>
                                    <select
                                      value={editProjectId}
                                      onChange={(e) => {
                                        void handleEditProjectChange(
                                          e.target.value,
                                        );
                                      }}
                                      className="rounded-xl border border-zinc-300 dark:border-zinc-700 px-4 py-3 outline-none focus:border-black"
                                    >
                                      <option value="">No project</option>
                                      {projects.map((project) => (
                                        <option
                                          key={project.id}
                                          value={project.id}
                                        >
                                          {project.name}
                                        </option>
                                      ))}
                                    </select>
                                    <select
                                      value={editAssigneeId}
                                      onChange={(e) =>
                                        setEditAssigneeId(e.target.value)
                                      }
                                      onFocus={() => {
                                        if (editProjectId)
                                          void fetchMembers(editProjectId);
                                      }}
                                      disabled={!editProjectId}
                                      className="rounded-xl border border-zinc-300 dark:border-zinc-700 px-4 py-3 outline-none focus:border-black"
                                    >
                                      <option value="">Unassigned</option>
                                      {(
                                        membersByProject[editProjectId] ?? []
                                      ).map((member) => (
                                        <option
                                          key={member.id}
                                          value={member.id}
                                        >
                                          {member.name}
                                        </option>
                                      ))}
                                    </select>
                                  </div>
                                  <div className="flex gap-2">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        void handleSaveEdit(task.id)
                                      }
                                      disabled={savingEdit}
                                      className={uiPrimaryButtonClass}
                                    >
                                      {savingEdit ? "Saving..." : "Save"}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={cancelEditing}
                                      disabled={savingEdit}
                                      className={uiButtonClass}
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                // --- Read-only display for this task ---
                                <>
                                  <div className="flex items-start justify-between gap-4">
                                    <div>
                                      <h3 className="text-xl font-semibold">
                                        {task.title}
                                      </h3>
                                      {task.recurrence !== "NONE" && (
                                        <span className="mt-2 mr-2 inline-block rounded-full border border-violet-500 px-2.5 py-1 text-xs font-medium text-violet-700">
                                          Repeats{" "}
                                          {formatRecurrenceLabel(
                                            task.recurrence,
                                          )}
                                        </span>
                                      )}
                                      {task.assignee && (
                                        <span className="rounded-full border px-2.5 py-1 text-xs font-medium">
                                          Assigned to: {task.assignee.name}
                                        </span>
                                      )}
                                      {task.project && (
                                        <span
                                          className="mt-2 mr-2 inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium"
                                          style={{
                                            borderColor:
                                              task.project.color ?? undefined,
                                          }}
                                        >
                                          <span
                                            className="h-2 w-2 rounded-full"
                                            style={{
                                              backgroundColor:
                                                task.project.color ??
                                                "currentColor",
                                            }}
                                          />
                                          {task.project.name}
                                        </span>
                                      )}
                                      {urgencyLabel && (
                                        <span
                                          className={`mt-2 inline-block rounded-full border border-current px-2.5 py-1 text-xs font-medium ${urgencyLabelStyles}`}
                                        >
                                          {urgencyLabel}
                                        </span>
                                      )}
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                      <button
                                        type="button"
                                        onClick={() => startEditing(task)}
                                        className={uiButtonClass}
                                      >
                                        Edit
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          void handleToggleComplete(task)
                                        }
                                        disabled={isToggling}
                                        className="rounded-lg border border-green-300 px-3 py-1.5 text-sm font-medium text-green-700 disabled:opacity-60"
                                      >
                                        {isToggling
                                          ? "Updating..."
                                          : task.status === "DONE"
                                            ? "Mark Incomplete"
                                            : "Mark Done"}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setConfirmDeleteId(task.id)
                                        }
                                        disabled={isDeleting}
                                        className={uiDangerButtonClass}
                                      >
                                        {isDeleting ? "Deleting..." : "Delete"}
                                      </button>
                                    </div>
                                  </div>
                                  <p className="mt-2 text-gray-700">
                                    {task.description || "No description."}
                                  </p>
                                  <div className="mt-3 flex flex-wrap gap-3 text-sm text-zinc-600 dark:text-zinc-300">
                                    <span>
                                      Status: <strong>{task.status}</strong>
                                    </span>
                                    <span>
                                      Priority: <strong>{task.priority}</strong>
                                    </span>
                                    <span>
                                      Due:{" "}
                                      <strong>
                                        {task.dueDate
                                          ? formatTaskDueDate(task.dueDate)
                                          : "No due date"}
                                      </strong>
                                    </span>
                                    <span>
                                      Repeats:{" "}
                                      <strong>
                                        {formatRecurrenceLabel(task.recurrence)}
                                      </strong>
                                    </span>
                                  </div>
                                </>
                              )}
                            </article>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </main>
      {/* Delete confirmation dialog: moves the selected task to Trash. */}
      <ConfirmDialog
        open={Boolean(confirmDeleteId)}
        title="Confirm delete"
        message="This will move the item to Trash."
        loading={Boolean(deletingTaskId)}
        onCancel={() => setConfirmDeleteId(null)}
        onConfirm={() => {
          if (confirmDeleteId) void handleDeleteTask(confirmDeleteId);
          setConfirmDeleteId(null);
        }}
      />
    </>
  );
}
