"use client";

import Link from "next/link";
import { uiButtonClass, uiDangerButtonClass, uiPrimaryButtonClass } from "@/components/ui";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";

type TaskStatus = "TODO" | "IN_PROGRESS" | "DONE";
type Priority = "LOW" | "MEDIUM" | "HIGH";
type Recurrence = "NONE" | "DAILY" | "WEEKLY" | "BIWEEKLY" | "MONTHLY";
type TaskFilter = "ALL" | "ACTIVE" | "COMPLETED";
type SortOption = "NEWEST" | "OLDEST" | "DUE_DATE_ASC" | "DUE_DATE_DESC";

type Project = {
  id: string;
  name: string;
  color: string | null;
};

type Member = { id: string; name: string; email: string | null; role: "OWNER" | "MEMBER" | "VIEWER" };

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
  assignee: Member | null;
};

type TaskUrgency = "OVERDUE" | "DUE_TODAY" | "DUE_SOON" | "NONE";

function getLocalDayStart(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function getTaskUrgency(task: Task): TaskUrgency {
  if (task.status === "DONE" || !task.dueDate) return "NONE";

  const dueDate = getLocalDayStart(new Date(task.dueDate));
  const today = getLocalDayStart(new Date());
  const dayDiff = Math.floor((dueDate.getTime() - today.getTime()) / 86400000);

  if (dayDiff < 0) return "OVERDUE";
  if (dayDiff === 0) return "DUE_TODAY";
  if (dayDiff <= 3) return "DUE_SOON";
  return "NONE";
}

function formatRecurrenceLabel(recurrence: Recurrence) {
  if (recurrence === "NONE") return "No";
  if (recurrence === "BIWEEKLY") return "every 2 weeks";
  return recurrence.toLowerCase();
}

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [fetching, setFetching] = useState(true);
  const [loading, setLoading] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingTaskId, setDeletingTaskId] = useState<string | null>(null);
  const [togglingTaskId, setTogglingTaskId] = useState<string | null>(null);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const [filter, setFilter] = useState<TaskFilter>("ALL");
  const [priorityFilter, setPriorityFilter] = useState<"ALL" | Priority>("ALL");
  const [sortBy, setSortBy] = useState<SortOption>("NEWEST");
  const [searchQuery, setSearchQuery] = useState("");
  const [projectFilter, setProjectFilter] = useState("");

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<TaskStatus>("TODO");
  const [priority, setPriority] = useState<Priority>("MEDIUM");
  const [dueDate, setDueDate] = useState("");
  const [recurrence, setRecurrence] = useState<Recurrence>("NONE");
  const [projectId, setProjectId] = useState("");

  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editStatus, setEditStatus] = useState<TaskStatus>("TODO");
  const [editPriority, setEditPriority] = useState<Priority>("MEDIUM");
  const [editDueDate, setEditDueDate] = useState("");
  const [editRecurrence, setEditRecurrence] = useState<Recurrence>("NONE");
  const [editProjectId, setEditProjectId] = useState("");

  const visibleTasks = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();

    const filtered = tasks
      .filter((task) => {
        if (!normalizedQuery) return true;

        const titleMatches = task.title.toLowerCase().includes(normalizedQuery);
        const descriptionMatches = (task.description ?? "")
          .toLowerCase()
          .includes(normalizedQuery);

        return titleMatches || descriptionMatches;
      })
      .filter((task) => {
        if (filter === "ACTIVE") return task.status !== "DONE";
        if (filter === "COMPLETED") return task.status === "DONE";
        return true;
      })
      .filter((task) => {
        if (priorityFilter === "ALL") return true;
        return task.priority === priorityFilter;
      })
      .filter((task) => {
        if (!projectFilter) return true;
        return task.projectId === projectFilter;
      });

    const sorted = [...filtered].sort((a, b) => {
      if (sortBy === "NEWEST") {
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      }

      if (sortBy === "OLDEST") {
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      }

      const aDue = a.dueDate ? new Date(a.dueDate).getTime() : Number.POSITIVE_INFINITY;
      const bDue = b.dueDate ? new Date(b.dueDate).getTime() : Number.POSITIVE_INFINITY;

      if (sortBy === "DUE_DATE_ASC") return aDue - bDue;
      return bDue - aDue;
    });

    return sorted;
  }, [tasks, searchQuery, filter, priorityFilter, sortBy, projectFilter]);

  const taskSections = useMemo(() => {
    const overdue = visibleTasks.filter((task) => getTaskUrgency(task) === "OVERDUE");
    const dueToday = visibleTasks.filter((task) => getTaskUrgency(task) === "DUE_TODAY");
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

  useEffect(() => {
    async function loadInitialTasks() {
      await Promise.all([fetchTasks(), fetchProjects()]);
    }

    void loadInitialTasks();
  }, []);

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
          assigneeId: "",
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
      await fetchTasks(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not create task.";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  function startEditing(task: Task) {
    setEditingTaskId(task.id);
    setEditTitle(task.title);
    setEditDescription(task.description ?? "");
    setEditStatus(task.status);
    setEditPriority(task.priority);
    setEditDueDate(task.dueDate ? new Date(task.dueDate).toISOString().slice(0, 10) : "");
    setEditRecurrence(task.recurrence);
    setEditProjectId(task.projectId ?? "");
    setError("");
  }

  function cancelEditing() {
    setEditingTaskId(null);
    setEditTitle("");
    setEditDescription("");
    setEditStatus("TODO");
    setEditPriority("MEDIUM");
    setEditDueDate("");
    setEditRecurrence("NONE");
    setEditProjectId("");
  }

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
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Failed to update task");
      }

      const updatedTask = (await res.json()) as Task;
      setTasks((prev) => prev.map((task) => (task.id === taskId ? updatedTask : task)));
      cancelEditing();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not update task.";
      setError(message);
    } finally {
      setSavingEdit(false);
    }
  }

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
          dueDate: task.dueDate ? new Date(task.dueDate).toISOString().slice(0, 10) : null,
          recurrence: task.recurrence,
          projectId: task.projectId ?? "",
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Failed to update task status");
      }

      const updatedTask = (await res.json()) as Task;
      setTasks((prev) => prev.map((item) => (item.id === task.id ? updatedTask : item)));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not update task status.";
      setError(message);
    } finally {
      setTogglingTaskId(null);
    }
  }

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
      const message = err instanceof Error ? err.message : "Could not delete task.";
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
          <Link href="/tasks/board" className="rounded-xl border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800">
            Open Task Board
          </Link>
        </div>
        <p className="mb-8 text-zinc-600 dark:text-zinc-300">Create and manage your tasks for AI-Multi Task-Management.</p>

        <section className="mb-10 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-6 shadow-sm">
          <h2 className="mb-4 text-2xl font-semibold">Create Task</h2>
          <form onSubmit={handleCreateTask} className="space-y-4">
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Task title" className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 px-4 py-3 outline-none focus:border-black" />
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description (optional)" rows={4} className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 px-4 py-3 outline-none focus:border-black" />
            <div className="grid gap-3 sm:grid-cols-5">
              <select value={status} onChange={(e) => setStatus(e.target.value as TaskStatus)} className="rounded-xl border border-zinc-300 dark:border-zinc-700 px-4 py-3 outline-none focus:border-black">
                <option value="TODO">To Do</option><option value="IN_PROGRESS">In Progress</option><option value="DONE">Done</option>
              </select>
              <select value={priority} onChange={(e) => setPriority(e.target.value as Priority)} className="rounded-xl border border-zinc-300 dark:border-zinc-700 px-4 py-3 outline-none focus:border-black">
                <option value="LOW">Low</option><option value="MEDIUM">Medium</option><option value="HIGH">High</option>
              </select>
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="rounded-xl border border-zinc-300 dark:border-zinc-700 px-4 py-3 outline-none focus:border-black" />
              <select value={recurrence} onChange={(e) => setRecurrence(e.target.value as Recurrence)} className="rounded-xl border border-zinc-300 dark:border-zinc-700 px-4 py-3 outline-none focus:border-black">
                <option value="NONE">Does not repeat</option><option value="DAILY">Daily</option><option value="WEEKLY">Weekly</option><option value="BIWEEKLY">Every 2 weeks</option><option value="MONTHLY">Monthly</option>
              </select>
              <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="rounded-xl border border-zinc-300 dark:border-zinc-700 px-4 py-3 outline-none focus:border-black">
                <option value="">No project</option>
                {projects.map((project) => (<option key={project.id} value={project.id}>{project.name}</option>))}
              </select>
            </div>
            <button type="submit" disabled={loading} className="rounded-xl bg-black px-5 py-3 text-white transition hover:opacity-90 disabled:opacity-50">{loading ? "Creating..." : "Create Task"}</button>
          </form>
          {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
        </section>

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
            <select value={filter} onChange={(e) => setFilter(e.target.value as TaskFilter)} className="rounded-xl border border-zinc-300 dark:border-zinc-700 px-3 py-2 text-sm outline-none focus:border-black">
              <option value="ALL">All Tasks</option>
              <option value="ACTIVE">Active</option>
              <option value="COMPLETED">Completed</option>
            </select>
            <select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value as "ALL" | Priority)} className="rounded-xl border border-zinc-300 dark:border-zinc-700 px-3 py-2 text-sm outline-none focus:border-black">
              <option value="ALL">All Priorities</option>
              <option value="LOW">Low Priority</option>
              <option value="MEDIUM">Medium Priority</option>
              <option value="HIGH">High Priority</option>
            </select>
            <select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)} className="rounded-xl border border-zinc-300 dark:border-zinc-700 px-3 py-2 text-sm outline-none focus:border-black">
              <option value="">All Projects</option>
              {projects.map((project) => (<option key={project.id} value={project.id}>{project.name}</option>))}
            </select>
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value as SortOption)} className="rounded-xl border border-zinc-300 dark:border-zinc-700 px-3 py-2 text-sm outline-none focus:border-black">
              <option value="NEWEST">Newest First</option>
              <option value="OLDEST">Oldest First</option>
              <option value="DUE_DATE_ASC">Due Date (Soonest)</option>
              <option value="DUE_DATE_DESC">Due Date (Latest)</option>
            </select>
          </div>

          {fetching ? <p className="text-zinc-600 dark:text-zinc-300">Loading tasks...</p> : visibleTasks.length === 0 ? <p className="text-zinc-600 dark:text-zinc-300">No tasks match your current search/filters.</p> : (
            <div className="space-y-6">
              {taskSections.map((section) => (
                <div key={section.key}>
                  <h3 className="mb-3 text-lg font-semibold text-gray-800">{section.title}</h3>
                  {section.tasks.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-zinc-200 dark:border-zinc-800 px-4 py-3 text-sm text-gray-500">
                      No tasks in this section.
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
                    className={`rounded-2xl border p-5 shadow-sm ${urgencyStyles}`}
                  >
                    {isEditing ? (
                      <div className="space-y-3">
                        <input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 px-4 py-2 outline-none focus:border-black" />
                        <textarea value={editDescription} onChange={(e) => setEditDescription(e.target.value)} rows={4} className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 px-4 py-3 outline-none focus:border-black" />
                        <div className="grid gap-3 sm:grid-cols-5">
                          <select value={editStatus} onChange={(e) => setEditStatus(e.target.value as TaskStatus)} className="rounded-xl border border-zinc-300 dark:border-zinc-700 px-4 py-3 outline-none focus:border-black"><option value="TODO">To Do</option><option value="IN_PROGRESS">In Progress</option><option value="DONE">Done</option></select>
                          <select value={editPriority} onChange={(e) => setEditPriority(e.target.value as Priority)} className="rounded-xl border border-zinc-300 dark:border-zinc-700 px-4 py-3 outline-none focus:border-black"><option value="LOW">Low</option><option value="MEDIUM">Medium</option><option value="HIGH">High</option></select>
                          <input type="date" value={editDueDate} onChange={(e) => setEditDueDate(e.target.value)} className="rounded-xl border border-zinc-300 dark:border-zinc-700 px-4 py-3 outline-none focus:border-black" />
                          <select value={editRecurrence} onChange={(e) => setEditRecurrence(e.target.value as Recurrence)} className="rounded-xl border border-zinc-300 dark:border-zinc-700 px-4 py-3 outline-none focus:border-black"><option value="NONE">Does not repeat</option><option value="DAILY">Daily</option><option value="WEEKLY">Weekly</option><option value="BIWEEKLY">Every 2 weeks</option><option value="MONTHLY">Monthly</option></select>
                          <select value={editProjectId} onChange={(e) => setEditProjectId(e.target.value)} className="rounded-xl border border-zinc-300 dark:border-zinc-700 px-4 py-3 outline-none focus:border-black"><option value="">No project</option>{projects.map((project) => (<option key={project.id} value={project.id}>{project.name}</option>))}</select>
                        </div>
                        <div className="flex gap-2">
                          <button type="button" onClick={() => void handleSaveEdit(task.id)} disabled={savingEdit} className={uiPrimaryButtonClass}>{savingEdit ? "Saving..." : "Save"}</button>
                          <button type="button" onClick={cancelEditing} disabled={savingEdit} className={uiButtonClass}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <h3 className="text-xl font-semibold">{task.title}</h3>
                            {task.recurrence !== "NONE" && (<span className="mt-2 mr-2 inline-block rounded-full border border-violet-500 px-2.5 py-1 text-xs font-medium text-violet-700">Repeats {formatRecurrenceLabel(task.recurrence)}</span>)}
                            {task.assignee && <span className="rounded-full border px-2.5 py-1 text-xs font-medium">Assigned to: {task.assignee.name}</span>}
                              {task.project && (<span className="mt-2 mr-2 inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium" style={{ borderColor: task.project.color ?? undefined }}><span className="h-2 w-2 rounded-full" style={{ backgroundColor: task.project.color ?? "currentColor" }} />{task.project.name}</span>)}
                            {urgencyLabel && (
                              <span
                                className={`mt-2 inline-block rounded-full border border-current px-2.5 py-1 text-xs font-medium ${urgencyLabelStyles}`}
                              >
                                {urgencyLabel}
                              </span>
                            )}
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <button type="button" onClick={() => startEditing(task)} className={uiButtonClass}>Edit</button>
                            <button type="button" onClick={() => void handleToggleComplete(task)} disabled={isToggling} className="rounded-lg border border-green-300 px-3 py-1.5 text-sm font-medium text-green-700 disabled:opacity-60">{isToggling ? "Updating..." : task.status === "DONE" ? "Mark Incomplete" : "Mark Done"}</button>
                            <button type="button" onClick={() => setConfirmDeleteId(task.id)} disabled={isDeleting} className={uiDangerButtonClass}>{isDeleting ? "Deleting..." : "Delete"}</button>
                          </div>
                        </div>
                        <p className="mt-2 text-gray-700">{task.description || "No description."}</p>
                        <div className="mt-3 flex flex-wrap gap-3 text-sm text-zinc-600 dark:text-zinc-300">
                          <span>Status: <strong>{task.status}</strong></span>
                          <span>Priority: <strong>{task.priority}</strong></span>
                          <span>Due: <strong>{task.dueDate ? new Date(task.dueDate).toLocaleDateString() : "No due date"}</strong></span>
                          <span>Repeats: <strong>{formatRecurrenceLabel(task.recurrence)}</strong></span>
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
    <ConfirmDialog open={Boolean(confirmDeleteId)} title="Confirm delete" message="This will move the item to Trash." loading={Boolean(deletingTaskId)} onCancel={() => setConfirmDeleteId(null)} onConfirm={() => { if (confirmDeleteId) void handleDeleteTask(confirmDeleteId); setConfirmDeleteId(null); }} />
    </>
  );
}
