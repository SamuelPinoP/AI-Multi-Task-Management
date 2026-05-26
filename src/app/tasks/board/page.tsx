"use client";

import { BackLink, uiButtonClass, uiCardClass } from "@/components/ui";
import { useEffect, useMemo, useState } from "react";

type TaskStatus = "TODO" | "IN_PROGRESS" | "DONE";
type Priority = "LOW" | "MEDIUM" | "HIGH";
type Recurrence = "NONE" | "DAILY" | "WEEKLY" | "BIWEEKLY" | "MONTHLY";

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
  recurrence: Recurrence;
  projectId: string | null;
  project: Project | null;
  assignee: Member | null;
};

const STATUS_COLUMNS: Array<{ status: TaskStatus; title: string }> = [
  { status: "TODO", title: "To Do" },
  { status: "IN_PROGRESS", title: "In Progress" },
  { status: "DONE", title: "Done" },
];

function getLocalDayStart(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function getDueIndicator(task: Task): { label: string; className: string } | null {
  if (!task.dueDate || task.status === "DONE") return null;

  const dueDate = getLocalDayStart(new Date(task.dueDate));
  const today = getLocalDayStart(new Date());
  const dayDiff = Math.floor((dueDate.getTime() - today.getTime()) / 86400000);

  if (dayDiff < 0) return { label: "Overdue", className: "border-red-200 bg-red-50 text-red-700" };
  if (dayDiff === 0) return { label: "Due Today", className: "border-amber-200 bg-amber-50 text-amber-700" };
  return null;
}

export default function TaskBoardPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectFilter, setProjectFilter] = useState("");
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState("");
  const [updatingTaskId, setUpdatingTaskId] = useState<string | null>(null);

  const filteredTasks = useMemo(
    () => tasks.filter((task) => !projectFilter || task.projectId === projectFilter),
    [tasks, projectFilter],
  );

  useEffect(() => {
    async function loadBoardData() {
      try {
        setFetching(true);
        setError("");

        const [tasksRes, projectsRes] = await Promise.all([fetch("/api/tasks"), fetch("/api/projects")]);

        if (!tasksRes.ok) {
          throw new Error("Failed to fetch tasks");
        }

        if (!projectsRes.ok) {
          throw new Error("Failed to fetch projects");
        }

        const [tasksData, projectsData] = (await Promise.all([tasksRes.json(), projectsRes.json()])) as [Task[], Project[]];
        setTasks(tasksData);
        setProjects(projectsData);
      } catch {
        setError("Could not load board data.");
      } finally {
        setFetching(false);
      }
    }

    void loadBoardData();
  }, []);

  async function moveTask(task: Task, status: TaskStatus) {
    if (task.status === status) return;

    try {
      setUpdatingTaskId(task.id);
      setError("");

      const res = await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: task.title,
          description: task.description ?? "",
          status,
          priority: task.priority,
          dueDate: task.dueDate,
          recurrence: task.recurrence,
          projectId: task.projectId ?? "",
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Failed to update task");
      }

      const updatedTask = (await res.json()) as Task;
      setTasks((prev) => prev.map((currentTask) => (currentTask.id === task.id ? updatedTask : currentTask)));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not update task.";
      setError(message);
    } finally {
      setUpdatingTaskId(null);
    }
  }

  return (
    <main className="min-h-screen px-6 py-10">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-4xl font-bold">Task Planning Board</h1>
            <p className="text-zinc-600 dark:text-zinc-300">Manage tasks visually by status.</p>
          </div>
          <BackLink href="/tasks">Back to Tasks List</BackLink>
        </div>

        <div className={`${uiCardClass} mb-6 p-4`}>
          <label htmlFor="projectFilter" className="mb-2 block text-sm font-medium">Filter by project</label>
          <select id="projectFilter" value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)} className="w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-black dark:border-zinc-700 sm:w-80">
            <option value="">All Projects</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>{project.name}</option>
            ))}
          </select>
        </div>

        {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

        {fetching ? (
          <p className="text-zinc-600 dark:text-zinc-300">Loading board...</p>
        ) : (
          <div className="grid gap-4 lg:grid-cols-3">
            {STATUS_COLUMNS.map((column) => {
              const columnTasks = filteredTasks.filter((task) => task.status === column.status);

              return (
                <section key={column.status} className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/40">
                  <div className="mb-4 flex items-center justify-between">
                    <h2 className="text-lg font-semibold">{column.title}</h2>
                    <span className="rounded-full bg-zinc-200 px-2 py-0.5 text-xs font-medium dark:bg-zinc-700">{columnTasks.length}</span>
                  </div>

                  {columnTasks.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-zinc-300 px-3 py-5 text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
                      No tasks in this column.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {columnTasks.map((task) => {
                        const dueIndicator = getDueIndicator(task);

                        return (
                          <article key={task.id} className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
                            <h3 className="font-semibold">{task.title}</h3>
                            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">{task.description || "No description."}</p>

                            <div className="mt-3 flex flex-wrap gap-2">
                              <span className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700">Priority: {task.priority}</span>
                              {task.dueDate && <span className="rounded-full border border-zinc-300 px-2.5 py-1 text-xs font-medium">Due: {new Date(task.dueDate).toLocaleDateString()}</span>}
                              {task.assignee && <span className="rounded-full border px-2.5 py-1 text-xs font-medium">Assigned to: {task.assignee.name}</span>}
                              {task.project && (
                                <span className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium" style={{ borderColor: task.project.color ?? undefined }}>
                                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: task.project.color ?? "currentColor" }} />
                                  {task.project.name}
                                </span>
                              )}
                              {dueIndicator && <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${dueIndicator.className}`}>{dueIndicator.label}</span>}
                            </div>

                            <div className="mt-4 flex flex-wrap gap-2">
                              {STATUS_COLUMNS.filter((option) => option.status !== task.status).map((option) => (
                                <button key={option.status} type="button" disabled={updatingTaskId === task.id} onClick={() => void moveTask(task, option.status)} className={`${uiButtonClass} rounded-lg px-2.5 py-1.5 text-xs`}>
                                  Move to {option.title}
                                </button>
                              ))}
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
